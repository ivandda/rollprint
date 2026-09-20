/** @import { LabelTemplate, Values } from "../labels/template.js" */
/** @import { Bitmap, Media } from "../printers/types.js" */
/** @import { LabelLayout, MeasureText, PlacedBlock } from "./label-layout.js" */
import { pasteBitmap, rotateBitmap, thresholdToBitmap } from "./bitmap.js";
import { canvasContext, font, TEXT_THRESHOLD } from "./canvas-text.js";
import { BORDERS, frameOf, layoutLabel } from "./label-layout.js";

const DIVIDERS = { thin: 0.3, thick: 0.8 };
const ROUNDED_RADIUS_MM = 2;

/**
 * Measures text the way the label is drawn.
 * @param {OffscreenCanvasRenderingContext2D} context
 * @returns {MeasureText}
 */
export function labelMeasure(context) {
  return (text, size, bold) => {
    context.font = font(bold ? 700 : 400, size);
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
  return layoutLabel(template, values, frame, media.dpi / 25.4, labelMeasure(canvasContext(1, 1)));
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
  return template.orientation === "landscape" ? width : height;
}

/**
 * Draws a filled template on a paper, as it prints: turned for landscape, and in the middle of a
 * round label. `upright` leaves it the way it reads, for a small picture of the template.
 * @param {LabelTemplate} template
 * @param {Values} values
 * @param {Media} media
 * @param {{ upright?: boolean }} [options]
 * @returns {Bitmap}
 */
export function renderLabel(template, values, media, { upright = false } = {}) {
  const layout = layoutOn(template, values, media);
  const drawn = draw(layout, template);
  if (upright) return drawn;
  const turned =
    template.orientation === "landscape" && media.shape !== "round" ? rotateBitmap(drawn) : drawn;
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

  for (const placed of layout.blocks) drawBlock(context, placed, mm);
  return thresholdToBitmap(context.getImageData(0, 0, width, height), TEXT_THRESHOLD);
}

/**
 * @param {OffscreenCanvasRenderingContext2D} context
 * @param {PlacedBlock} placed
 * @param {number} mm
 */
function drawBlock(context, placed, mm) {
  const { block } = placed;
  if (block.type === "space") return;
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
    context.font = font(part.bold ? 700 : 400, part.size);
    for (const line of part.lines) {
      // The baseline sits so that capitals are centred in the line's height.
      context.fillText(line, x, y + part.size * 0.95, placed.width);
      y += part.size * 1.2;
    }
  }
  context.textAlign = "left";
}
