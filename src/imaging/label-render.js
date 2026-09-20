/** @import { LabelTemplate, Values } from "../labels/template.js" */
/** @import { Bitmap, Media } from "../printers/types.js" */
/** @import { FontName } from "./fonts.js" */
/** @import { LabelLayout, MeasureText, PlacedBlock } from "./label-layout.js" */

import { BARCODE_HEIGHTS, isQuarterTurned, TURNS } from "../labels/template.js";
import { QrCode } from "../vendor/qrcodegen.js";
import { placeImage } from "./arrangement.js";
import { barcodeModules, QUIET_ZONE } from "./barcode.js";
import { ditherToBitmap, pasteBitmap, rotateBitmap, thresholdToBitmap } from "./bitmap.js";
import { canvasContext, TEXT_THRESHOLD } from "./canvas-text.js";
import { TONES } from "./card.js";
import { font } from "./fonts.js";
import { BORDERS, frameOf, isTurned, LEAST_MODULE_DOTS, layoutLabel } from "./label-layout.js";

/** Blank modules around a QR code, so a scanner finds it. */
const QR_QUIET_ZONE = 2;

const DIVIDERS = { thin: 0.3, thick: 0.8 };
const ROUNDED_RADIUS_MM = 2;
/** Keeps a logo's anti-aliased edges, so thin lines still print. */
const LOGO_THRESHOLD = 170;

/**
 * How a label is drawn beyond its layout.
 * @typedef {object} RenderOptions
 * @property {boolean} [upright]  Not turned for landscape, for a small picture of the template.
 * @property {Map<string, ImageBitmap>} [images]  The template's images, decoded, by ID. A missing
 *   image leaves its box blank.
 * @property {{ black: number, white: number, gamma: number }} [tone]  Applied to photos.
 */

/**
 * Measures text the way the label is drawn.
 * @param {OffscreenCanvasRenderingContext2D} context
 * @param {FontName} [fontName]
 * @returns {MeasureText}
 */
export function labelMeasure(context, fontName) {
  return (text, size, bold) => {
    context.font = font(bold ? 700 : 400, size, fontName);
    return context.measureText(text).width;
  };
}

/**
 * Where a filled template's parts go on a paper.
 * @param {LabelTemplate} template
 * @param {Values} values
 * @param {Media} media
 */
export function layoutOn(template, values, media) {
  const frame = frameOf(template, media);
  const measure = labelMeasure(canvasContext(1, 1), template.font);
  return layoutLabel(template, values, frame, media.dpi / 25.4, measure);
}

/**
 * How long the label prints, in dots along the roll.
 * @param {LabelTemplate} template
 * @param {Values} values
 * @param {Media} media
 */
export function labelLength(template, values, media) {
  if (media.printableHeight) return media.printableHeight;
  const { width, height } = layoutOn(template, values, media);
  return isTurned(template, media) ? width : height;
}

/**
 * Draws a filled template on a paper, as it prints: turned for landscape, and in the middle of a
 * round label.
 * @param {LabelTemplate} template
 * @param {Values} values
 * @param {Media} media
 * @param {RenderOptions} [options]
 * @returns {Bitmap}
 */
export function renderLabel(template, values, media, { upright = false, images, tone = TONES.normal } = {}) {
  const layout = layoutOn(template, values, media);
  const drawn = draw(layout, template);
  for (const placed of layout.blocks) {
    const { block } = placed;
    if (block.type !== "image" || !block.image) continue;
    const image = images?.get(block.image.id);
    if (image) pasteBitmap(drawn, renderImage(image, placed, block, tone), placed.x, placed.y);
  }
  if (upright) return drawn;
  const turned = isTurned(template, media) ? rotateBitmap(drawn) : drawn;
  if (media.shape !== "round") return turned;
  const page = {
    width: media.printableWidth,
    height: media.printableHeight,
    pixels: new Uint8Array(media.printableWidth * media.printableHeight),
  };
  pasteBitmap(
    page,
    turned,
    Math.round((page.width - turned.width) / 2),
    Math.round((page.height - turned.height) / 2),
  );
  return page;
}

/**
 * @param {LabelLayout} layout
 * @param {LabelTemplate} template
 * @returns {Bitmap}
 */
function draw(layout, template) {
  const { width, height, dotsPerMm: mm } = layout;
  const context = canvasContext(width, height);
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "black";
  context.strokeStyle = "black";
  context.textBaseline = "alphabetic";

  if (layout.border) {
    const thickness = BORDERS[template.border] * mm;
    context.lineWidth = thickness;
    context.beginPath();
    const inset = thickness / 2;
    if (template.border === "rounded") {
      context.roundRect(inset, inset, width - thickness, height - thickness, ROUNDED_RADIUS_MM * mm);
    } else {
      context.rect(inset, inset, width - thickness, height - thickness);
    }
    context.stroke();
  }

  // Whatever still doesn't fit is cut at the border rather than drawn over it.
  const edge = BORDERS[template.border] * mm;
  context.beginPath();
  context.rect(edge, edge, width - 2 * edge, height - 2 * edge);
  context.clip();
  for (const placed of layout.blocks) drawBlock(context, placed, mm, template);
  return thresholdToBitmap(context.getImageData(0, 0, width, height), TEXT_THRESHOLD);
}

/**
 * A QR code in its square, as large as whole modules allow, in the middle.
 * @param {OffscreenCanvasRenderingContext2D} context
 * @param {PlacedBlock} placed
 * @param {string} content
 */
function drawQr(context, placed, content) {
  if (!content) return;
  const code = QrCode.encodeText(content, QrCode.Ecc.MEDIUM);
  const module = Math.floor(placed.width / (code.size + 2 * QR_QUIET_ZONE));
  if (module < 1) return;
  const side = code.size * module;
  const left = Math.round(placed.x + (placed.width - side) / 2);
  const top = Math.round(placed.y + (placed.height - side) / 2);
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (code.getModule(x, y)) context.fillRect(left + x * module, top + y * module, module, module);
    }
  }
}

/**
 * A barcode's bars at the widest whole-dot module its block allows, in the middle, with its text
 * under it.
 * @param {OffscreenCanvasRenderingContext2D} context
 * @param {PlacedBlock} placed
 * @param {number} barHeight
 */
function drawBarcode(context, placed, barHeight) {
  if (!placed.bars) return;
  const module = Math.max(LEAST_MODULE_DOTS, Math.floor(placed.width / barcodeModules(placed.bars)));
  const total = barcodeModules(placed.bars) * module;
  let x = Math.round(placed.x + (placed.width - total) / 2) + QUIET_ZONE * module;
  const top = placed.y;
  placed.bars.forEach((width, index) => {
    if (index % 2 === 0) context.fillRect(x, top, width * module, barHeight);
    x += width * module;
  });
  if (placed.caption) {
    context.font = font(400, placed.caption.size);
    context.textAlign = "center";
    context.fillText(
      placed.caption.lines[0],
      placed.x + placed.width / 2,
      placed.y + placed.height - placed.caption.size * 0.25,
      placed.width,
    );
    context.textAlign = "left";
  }
}

/**
 * An image in its box, turned as its block asks: the whole of it, or the box filled and the image
 * cropped in the middle. A logo is thresholded so its lines stay crisp; a photo is dithered.
 * @param {ImageBitmap} image
 * @param {PlacedBlock} box
 * @param {import("../labels/template.js").ImageBlock} block
 * @param {{ black: number, white: number, gamma: number }} tone
 */
function renderImage(image, box, block, tone) {
  const context = canvasContext(box.width, box.height);
  context.fillStyle = "white";
  context.fillRect(0, 0, box.width, box.height);
  // The image is placed in the box as it will be once turned, then drawn turned about the middle.
  const inner = isQuarterTurned(block) ? { width: box.height, height: box.width } : box;
  const place = placeImage(image, inner, { fit: block.show, zoom: 1, x: 0.5, y: 0.5 });
  context.translate(box.width / 2, box.height / 2);
  context.rotate(TURNS[block.turn ?? "none"].radians);
  context.translate(-inner.width / 2, -inner.height / 2);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, place.x, place.y, place.width, place.height);
  const pixels = context.getImageData(0, 0, box.width, box.height);
  return block.treatment === "photo"
    ? ditherToBitmap(pixels, tone)
    : thresholdToBitmap(pixels, LOGO_THRESHOLD);
}

/**
 * @param {OffscreenCanvasRenderingContext2D} context
 * @param {PlacedBlock} placed
 * @param {number} mm
 * @param {LabelTemplate} template
 */
function drawBlock(context, placed, mm, template) {
  const { block } = placed;
  if (block.type === "space" || block.type === "image") return;
  if (block.type === "qr") {
    drawQr(context, placed, placed.code ?? "");
    return;
  }
  if (block.type === "barcode") {
    drawBarcode(context, placed, BARCODE_HEIGHTS[block.height] * mm);
    return;
  }
  if (block.type === "divider") {
    const thickness = Math.max(1, Math.round(DIVIDERS[block.weight] * mm));
    context.fillRect(
      placed.x,
      Math.round(placed.y + (placed.height - thickness) / 2),
      placed.width,
      thickness,
    );
    return;
  }
  const x = { start: placed.x, center: placed.x + placed.width / 2, end: placed.x + placed.width }[
    block.align
  ];
  context.textAlign = block.align === "start" ? "left" : block.align === "end" ? "right" : "center";
  let y = placed.y;
  for (const part of [placed.heading, placed.text]) {
    if (!part) continue;
    if (part === placed.text && placed.heading) y += part.size * 0.25;
    context.font = font(part.bold ? 700 : 400, part.size, template.font);
    for (const line of part.lines) {
      // The baseline sits so that capitals are centred in the line's height.
      context.fillText(line, x, y + part.size * 0.95, placed.width);
      y += part.size * 1.2;
    }
  }
  context.textAlign = "left";
}
