/** @import { Block, LabelTemplate, TextSize, Values } from "../labels/template.js" */
/** @import { Media } from "../printers/types.js" */
import { BARCODE_HEIGHTS, fill, IMAGE_WIDTHS, TEXT_SIZES } from "../labels/template.js";
import { barcodeModules, code128, code128Text } from "./barcode.js";

/** Room between the border and the content, in millimetres. */
export const MARGINS = { s: 1.5, m: 3, l: 5 };
/** Border thickness in millimetres. */
export const BORDERS = { none: 0, thin: 0.4, thick: 1.2, rounded: 0.4 };
const SPACES = { s: 2, m: 4, l: 8 };
const DIVIDERS = { thin: 0.3, thick: 0.8 };
/** Room around a divider's line, in millimetres. */
const DIVIDER_ROOM = 1.5;
/** Between rows, and between blocks side by side, in millimetres. */
const ROW_GAP = 1;
const BLOCK_GAP = 2;
/** Between a heading and its text, as a fraction of the text's size. */
const HEADING_GAP = 0.25;
const LINE_HEIGHT = 1.2;
/** A label on a continuous roll is never shorter or longer than this, in millimetres. */
export const AUTO_LENGTH_MM = { min: 12, max: 300 };
/** Text that doesn't fit its label is shrunk, down to this fraction of its size. */
const SMALLEST_SCALE = 0.4;

/**
 * The width of text drawn at a size, in dots. The measuring is passed in, so the layout works
 * without a canvas.
 * @typedef {(text: string, size: number, bold: boolean) => number} MeasureText
 */

/**
 * The room a label has: its width across the print head, and its height along the roll, in dots.
 * One of them is 0 when the content decides it, on a continuous roll.
 * @typedef {{ width: number, height: number }} Frame
 */

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */

/** Lines of text at a size, ready to draw. @typedef {{ size: number, lines: string[], bold: boolean }} PlacedText */

/** The smallest a barcode's module prints, in dots, so that it still scans. */
export const LEAST_MODULE_DOTS = 2;
/** Room for the text under a barcode, as a multiple of its size. */
const BARCODE_TEXT_LINE = 1.4;

/**
 * A block where it goes. `room` is the width it may take, infinite when the label is as wide as
 * its content; `width` is what it takes until the rows are laid out, then its share of the row.
 * An image or QR code keeps the width its block asks for, and so does a barcode whose bars are
 * wider than its row. A barcode carries its bar widths and the text under it, if any.
 * @typedef {Rect & {
 *   block: Block,
 *   room: number,
 *   fixed?: boolean,
 *   heading?: PlacedText,
 *   text?: PlacedText,
 *   bars?: number[],
 *   caption?: PlacedText,
 *   code?: string,
 * }} PlacedBlock
 */

/**
 * @typedef {object} LabelLayout
 * @property {number} width
 * @property {number} height
 * @property {number} dotsPerMm
 * @property {Rect} [border]  Where the border is drawn, if the template has one.
 * @property {PlacedBlock[]} blocks
 */

/**
 * Where everything goes on a label, in dots. Rows stack from the top; an image takes the share of
 * the width its block asks for and the other blocks in its row split the rest. Named sizes are
 * what they say; Fit text takes the room left once the other rows have theirs. When the content is
 * taller than a fixed label, every size shrinks alike until it fits; when it is shorter, it sits
 * in the middle.
 * @param {LabelTemplate} template
 * @param {Values} values
 * @param {Frame} frame
 * @param {number} dotsPerMm
 * @param {MeasureText} measure
 * @returns {LabelLayout}
 */
export function layoutLabel(template, values, frame, dotsPerMm, measure) {
  const mm = dotsPerMm;
  const border = BORDERS[template.border] * mm;
  const inset = Math.round(border + MARGINS[template.margin] * mm);
  const autoWidth = frame.width === 0;
  const autoHeight = frame.height === 0;

  /**
   * Lays the rows out at a scale of the named sizes, returning them and how tall they are.
   * @param {number} scale
   */
  const place = (scale) => {
    /** @param {TextSize} size */
    const dots = (size) => TEXT_SIZES[size].mm * mm * scale;
    const contentWidth = autoWidth ? Number.POSITIVE_INFINITY : frame.width - 2 * inset;
    const contentHeight = autoHeight ? Number.POSITIVE_INFINITY : frame.height - 2 * inset;
    // Images are a share of the label's width, or of its height when the width is up to the content.
    const imageBasis = autoWidth ? contentHeight : contentWidth;
    const rowGap = ROW_GAP * mm;

    // Every block at its named size; Fit text is measured later, once the room left is known.
    const rows = template.rows.map(({ blocks }) => {
      const gaps = (blocks.length - 1) * BLOCK_GAP * mm;
      const images = blocks.map((block) => imageSize(block, values, imageBasis, contentHeight));
      const imagesWidth = images.reduce((sum, size) => sum + (size?.width ?? 0), 0);
      const flexible = images.filter((size) => !size).length;
      const share = autoWidth
        ? Number.POSITIVE_INFINITY
        : Math.max(0, contentWidth - gaps - imagesWidth) / flexible;
      return blocks.map((block, i) => {
        const size = images[i];
        if (size) {
          const code = block.type === "qr" ? fill(block.content, values).trim() : undefined;
          return { block, room: size.width, fixed: true, x: 0, y: 0, ...size, code };
        }
        return placeBlock(block, values, share, dots, measure, mm);
      });
    });
    const fixedHeight = rows.reduce((sum, blocks) => sum + rowHeight(blocks), 0) + rowGap * (rows.length - 1);

    if (!autoHeight) {
      // Fit text gets an equal share of what the other rows leave.
      const fitRows = rows.filter((blocks) => blocks.some(hasFitText));
      const room = Math.max(0, frame.height - 2 * inset - fixedHeight);
      for (const blocks of fitRows) {
        for (const placed of blocks) fitText(placed, room / fitRows.length, measure, mm);
      }
    } else {
      for (const blocks of rows)
        for (const placed of blocks) fitText(placed, Number.POSITIVE_INFINITY, measure, mm);
    }

    // In a label as wide as its content, blocks take the width of the widest row so text aligns.
    const width = autoWidth
      ? Math.max(
          ...rows.map(
            (blocks) =>
              blocks.reduce((sum, { width: w }) => sum + w, 0) + (blocks.length - 1) * BLOCK_GAP * mm,
          ),
          0,
        )
      : contentWidth;
    let y = 0;
    for (const blocks of rows) {
      const height = rowHeight(blocks);
      const fixedWidth = blocks.reduce((sum, placed) => sum + (placed.fixed ? placed.width : 0), 0);
      const flexible = blocks.filter((placed) => !placed.fixed).length;
      const share = Math.max(0, width - (blocks.length - 1) * BLOCK_GAP * mm - fixedWidth) / flexible;
      let x = 0;
      for (const placed of blocks) {
        placed.x = x;
        if (!placed.fixed) placed.width = share;
        placed.y = y + (height - placed.height) / 2;
        x += placed.width + BLOCK_GAP * mm;
      }
      y += height + rowGap;
    }
    const height = Math.max(0, y - rowGap);
    return { blocks: rows.flat(), width, height };
  };

  let scale = 1;
  let content = place(scale);
  if (!autoHeight) {
    const room = frame.height - 2 * inset;
    // Fit text takes what is left, so only the named sizes can make the content too tall.
    for (let attempt = 0; attempt < 4 && content.height > room + 0.5; attempt++) {
      scale = Math.max(SMALLEST_SCALE, (scale * room) / content.height);
      content = place(scale);
      if (scale === SMALLEST_SCALE) break;
    }
  }

  const width = autoWidth ? autoLength(content.width + 2 * inset, mm) : frame.width;
  const height = autoHeight ? autoLength(content.height + 2 * inset, mm) : frame.height;
  const left = inset;
  const top = Math.round(inset + Math.max(0, (height - 2 * inset - content.height) / 2));
  for (const block of content.blocks) {
    block.x = Math.round(block.x + left);
    block.y = Math.round(block.y + top);
    block.width = Math.round(block.width);
    block.height = Math.round(block.height);
  }
  return {
    width,
    height,
    dotsPerMm,
    border: border ? { x: 0, y: 0, width, height } : undefined,
    blocks: content.blocks,
  };
}

/**
 * @param {Block} block
 * @param {Values} values
 * @param {number} width  Room across, or infinite when the label is as wide as its content.
 * @param {(size: TextSize) => number} dots
 * @param {MeasureText} measure
 * @param {number} mm
 * @returns {PlacedBlock}
 */
function placeBlock(block, values, width, dots, measure, mm) {
  const placed = { block, x: 0, y: 0, width: 0, height: 0, room: width };
  if (block.type === "image" || block.type === "qr") return { ...placed, fixed: true };
  if (block.type === "barcode") {
    const content = fill(block.content, values).trim();
    if (!content) return placed;
    const bars = code128(content);
    const size = TEXT_SIZES.xs.mm * mm;
    const caption = block.text ? { size, bold: false, lines: [code128Text(content)] } : undefined;
    // As wide as its bars at the smallest module that scans; a wider block spreads them. A row with
    // less room can't make them narrower, so they keep their width and run over its edge in plain sight.
    const least = barcodeModules(bars) * LEAST_MODULE_DOTS;
    return {
      ...placed,
      bars,
      caption,
      fixed: least > width,
      width: least,
      height: BARCODE_HEIGHTS[block.height] * mm + (caption ? size * BARCODE_TEXT_LINE : 0),
    };
  }
  if (block.type === "space") return { ...placed, height: SPACES[block.size] * mm };
  if (block.type === "divider")
    return { ...placed, height: (DIVIDERS[block.weight] + 2 * DIVIDER_ROOM) * mm };
  const heading = fill(block.heading, values).trim();
  const text = fill(block.text, values).trim();
  const result = {
    ...placed,
    heading: heading ? wrapText(heading, dots(block.headingSize), true, width, measure) : undefined,
    text: text ? wrapText(text, dots(block.size), block.bold, width, measure) : undefined,
  };
  sizeTextBlock(result, measure);
  return result;
}

/**
 * The box an image or QR code takes: its share of the label across, as tall as the image's
 * proportions make it (square for a QR code), and never taller than the label. Nothing without an
 * image.
 * @param {Block} block
 * @param {Values} values
 * @param {number} basis  What the share is of.
 * @param {number} tallest
 */
function imageSize(block, values, basis, tallest) {
  if (block.type !== "image" && block.type !== "qr") return undefined;
  if (block.type === "image" && !block.image) return { width: 0, height: 0 };
  if (block.type === "qr" && !fill(block.content, values).trim()) return { width: 0, height: 0 };
  const aspect = block.type === "image" && block.image ? block.image.height / block.image.width : 1;
  let width = IMAGE_WIDTHS[block.width].fraction * basis;
  let height = width * aspect;
  if (height > tallest) {
    height = tallest;
    width = height / aspect;
  }
  return { width, height };
}

/**
 * Text broken into lines no wider than `width`; a size of 0 means Fit, measured later.
 * @param {string} text
 * @param {number} size
 * @param {boolean} bold
 * @param {number} width
 * @param {MeasureText} measure
 * @returns {PlacedText}
 */
function wrapText(text, size, bold, width, measure) {
  const paragraphs = text.split("\n").map((line) => line.trim());
  if (!size || width === Number.POSITIVE_INFINITY) return { size, bold, lines: paragraphs };
  /** @type {string[]} */
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const longer = line ? `${line} ${word}` : word;
      if (line && measure(longer, size, bold) > width) {
        lines.push(line);
        line = word;
      } else {
        line = longer;
      }
    }
    lines.push(line);
  }
  return { size, bold, lines };
}

/**
 * Gives Fit text the largest size at which its lines fit the block's width and its share of the
 * height, then sizes the block.
 * @param {PlacedBlock} placed
 * @param {number} room  Height to share with the block's other text, or infinite.
 * @param {MeasureText} measure
 * @param {number} mm
 */
function fitText(placed, room, measure, mm) {
  const fitting = [placed.heading, placed.text].filter((part) => part && !part.size);
  if (fitting.length === 0) return;
  const fixed = [placed.heading, placed.text].filter((part) => part?.size);
  const used = fixed.reduce((sum, part) => sum + (part ? part.lines.length * part.size * LINE_HEIGHT : 0), 0);
  const gap = placed.heading && placed.text ? HEADING_GAP : 0;
  for (const part of fitting) {
    if (!part) continue;
    const widest = Math.max(...part.lines.map((line) => measure(line, 100, part.bold)), 1) / 100;
    const byWidth = placed.room / widest;
    const heightLeft = (room - used) / fitting.length;
    const byHeight = heightLeft / (part.lines.length * LINE_HEIGHT + gap);
    const largest = Math.max(
      TEXT_SIZES.xs.mm * mm * 0.5,
      Math.min(byWidth, byHeight, TEXT_SIZES.xl.mm * mm * 3),
    );
    part.size = Math.floor(largest);
  }
  sizeTextBlock(placed, measure);
}

/**
 * Sizes a text block to its lines: as wide as the widest, as tall as they stack.
 * @param {PlacedBlock} placed
 * @param {MeasureText} measure
 */
function sizeTextBlock(placed, measure) {
  const parts = [placed.heading, placed.text].filter((part) => part !== undefined);
  const sized = parts.filter((part) => part.size > 0);
  placed.width = Math.max(
    0,
    ...sized.flatMap((part) => part.lines.map((line) => measure(line, part.size, part.bold))),
  );
  const gap = placed.heading?.size && placed.text?.size ? placed.text.size * HEADING_GAP : 0;
  placed.height = sized.reduce((sum, part) => sum + part.lines.length * part.size * LINE_HEIGHT, 0) + gap;
}

/** @param {PlacedBlock[]} blocks */
const rowHeight = (blocks) => Math.max(0, ...blocks.map(({ height }) => height));

/** @param {PlacedBlock} placed */
const hasFitText = ({ heading, text }) => Boolean((heading && !heading.size) || (text && !text.size));

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * How long a label on a continuous roll is for content of a length, in dots: the same, within limits.
 * @param {number} dots
 * @param {number} mm  Dots per millimetre.
 */
const autoLength = (dots, mm) =>
  clamp(Math.round(dots), Math.round(AUTO_LENGTH_MM.min * mm), Math.round(AUTO_LENGTH_MM.max * mm));

/**
 * How long the label is along the roll, in dots: what the template fixes, else what the paper has,
 * which is 0 on a continuous roll.
 * @param {LabelTemplate} template
 * @param {Media} media
 */
const lengthOf = (template, media) =>
  template.lengthMm ? Math.round((template.lengthMm * media.dpi) / 25.4) : media.printableHeight;

/**
 * Whether the label is drawn turned a quarter turn, so its lines run along the roll. Landscape
 * reads along the label's longer side and portrait along its shorter one: on a continuous roll or
 * a long die-cut label that is along the roll, on a wide short label it is across. Round labels
 * are never turned.
 * @param {LabelTemplate} template
 * @param {Media} media
 */
export function isTurned(template, media) {
  if (media.shape === "round") return false;
  const length = lengthOf(template, media);
  const longSideAlong = length === 0 || length >= media.printableWidth;
  return template.orientation === "landscape" ? longSideAlong : !longSideAlong;
}

/**
 * The frame a template lays out in on a paper, before any turn. Round labels use the square inside
 * the circle.
 * @param {LabelTemplate} template
 * @param {Media} media
 * @returns {Frame}
 */
export function frameOf(template, media) {
  if (media.shape === "round") {
    const side = Math.floor(media.printableWidth / Math.SQRT2);
    return { width: side, height: side };
  }
  const length = lengthOf(template, media);
  return isTurned(template, media)
    ? { width: length, height: media.printableWidth }
    : { width: media.printableWidth, height: length };
}
