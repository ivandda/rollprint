/** @import { Cell, LabelTemplate, Part, TextSize, Values } from "../labels/template.js" */
/** @import { Media } from "../printers/types.js" */
import { isSplit, leavesOf } from "../labels/cells.js";
import { BARCODE_HEIGHTS, fill, isQuarterTurned, TEXT_SIZES } from "../labels/template.js";
import { barcodeModules, code128, code128Text } from "./barcode.js";

/** Room between the border and the content, in millimetres. */
export const MARGINS = { s: 1.5, m: 3, l: 5 };
/** Border thickness in millimetres. */
export const BORDERS = { none: 0, thin: 0.4, thick: 1.2, rounded: 0.4 };
/** Lines between cells, in millimetres. */
export const LINES = { thin: 0.3, thick: 0.8 };
/** Between cells, in millimetres. */
const CELL_GAP = 2;
/** Between a heading and its text, as a fraction of the text's size. */
const HEADING_GAP = 0.25;
const LINE_HEIGHT = 1.2;
/** A label on a continuous roll is never shorter or longer than this, in millimetres. */
export const AUTO_LENGTH_MM = { min: 12, max: 300 };
/** Text that doesn't fit its cell is shrunk, down to this fraction of its size. */
const SMALLEST_SCALE = 0.4;
/** The smallest a barcode's module prints, in dots, so that it still scans. */
export const LEAST_MODULE_DOTS = 2;
/** Room for the text under a barcode, as a multiple of its size. */
const BARCODE_TEXT_LINE = 1.4;

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
/** @typedef {{ width: number, height: number }} Size */

/** Lines of text at a size, ready to draw. @typedef {{ size: number, lines: string[], bold: boolean }} PlacedText */

/**
 * A part where it goes, in dots: text takes its cell's width and sits in the middle of its height;
 * an image or QR code keeps its proportions in the middle of its cell; a barcode carries its bar
 * widths and the text under them.
 * @typedef {Rect & {
 *   part: Part,
 *   heading?: PlacedText,
 *   text?: PlacedText,
 *   bars?: number[],
 *   barHeight?: number,
 *   caption?: PlacedText,
 *   code?: string,
 * }} PlacedPart
 */

/**
 * @typedef {object} LabelLayout
 * @property {number} width
 * @property {number} height
 * @property {number} dotsPerMm
 * @property {Rect} [border]  Where the border is drawn, if the template has one.
 * @property {(Rect & { index: number })[]} cells  Every cell, numbered the way the designer shows them.
 * @property {Rect[]} lines  Lines between cells, when the template has them.
 * @property {PlacedPart[]} parts
 */

/**
 * Where everything goes on a label, in dots. The cells split the room inside the margins at their
 * shares, with a gap between them, and each part sits in the middle of its cell. On a label as
 * long as its content, the label grows until every cell fits its part, within limits. When the
 * content is taller than its cells anyway, every size shrinks alike until it fits.
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
  const gap = CELL_GAP * mm;
  const line = template.lines ? Math.max(1, Math.round(LINES[template.lines] * mm)) : 0;
  const autoWidth = frame.width === 0;
  const autoHeight = frame.height === 0;
  const longest = Math.round(AUTO_LENGTH_MM.max * mm);
  const shortest = Math.round(AUTO_LENGTH_MM.min * mm);
  const leaves = leavesOf(template.cell);

  /**
   * The cells' boxes for content of a size.
   * @param {number} width
   * @param {number} height
   */
  const boxes = (width, height) => cellBoxes(template.cell, { x: 0, y: 0, width, height }, gap, line);

  /**
   * Each part placed in its cell at a scale of the named sizes, with how much its cell is short.
   * @param {Size} content
   * @param {number} scale
   */
  const place = (content, scale) => {
    const { cells, lines } = boxes(content.width, content.height);
    /** @type {PlacedPart[]} */
    const parts = [];
    let short = 1;
    leaves.forEach(({ leaf }, index) => {
      if (!leaf.part) return;
      const result = placePart(leaf.part, values, cells[index], scale, measure, mm);
      if (!result) return;
      parts.push(result.placed);
      // Images and codes fit their cells by construction; text and bars may be too tall.
      if (result.natural.height > cells[index].height)
        short = Math.min(short, cells[index].height / result.natural.height);
    });
    return { cells, lines, parts, short };
  };

  // The content's size: what the paper gives, or what the parts need along a free side.
  const content = {
    width: (autoWidth ? longest : frame.width) - 2 * inset,
    height: (autoHeight ? longest : frame.height) - 2 * inset,
  };
  if (autoWidth || autoHeight) {
    const axis = autoWidth ? "width" : "height";
    // Along a free side a cell's size is a share of the whole less some gaps: a straight line,
    // read off the sizes at 0 and 1. The parts are measured in cells of the longest label.
    const atZero = boxes(autoWidth ? 0 : content.width, autoHeight ? 0 : content.height).cells;
    const atOne = boxes(autoWidth ? 1 : content.width, autoHeight ? 1 : content.height).cells;
    const capped = boxes(content.width, content.height).cells;
    let needed = 0;
    leaves.forEach(({ leaf }, index) => {
      if (!leaf.part) return;
      const result = placePart(
        leaf.part,
        values,
        { ...capped[index], [axis]: Number.POSITIVE_INFINITY },
        1,
        measure,
        mm,
      );
      if (!result) return;
      const slope = atOne[index][axis] - atZero[index][axis];
      if (slope > 0) needed = Math.max(needed, (result.natural[axis] - atZero[index][axis]) / slope);
    });
    content[axis] = clamp(Math.ceil(needed) + 2 * inset, shortest, longest) - 2 * inset;
  }

  let scale = 1;
  let placed = place(content, scale);
  for (let attempt = 0; attempt < 4 && placed.short < 0.995 && scale > SMALLEST_SCALE; attempt++) {
    scale = Math.max(SMALLEST_SCALE, scale * placed.short);
    placed = place(content, scale);
  }

  const width = content.width + 2 * inset;
  const height = content.height + 2 * inset;
  /** @param {Rect} rect @returns {Rect} */
  const onLabel = (rect) => ({
    x: Math.round(rect.x + inset),
    y: Math.round(rect.y + inset),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  });
  return {
    width,
    height,
    dotsPerMm,
    border: border ? { x: 0, y: 0, width, height } : undefined,
    cells: placed.cells.map((rect, index) => ({ ...onLabel(rect), index: index + 1 })),
    lines: placed.lines.map(onLabel),
    parts: placed.parts.map((part) => ({ ...part, ...onLabel(part) })),
  };
}

/**
 * The boxes of a cell's leaves, in reading order, and the lines between them: a split gives its
 * first cell its share of the room less the gap, and the second the rest.
 * @param {Cell} cell
 * @param {Rect} rect
 * @param {number} gap
 * @param {number} line  Thickness of the lines between cells, or 0 for none.
 * @returns {{ cells: Rect[], lines: Rect[] }}
 */
function cellBoxes(cell, rect, gap, line) {
  if (!isSplit(cell)) return { cells: [rect], lines: [] };
  const across = cell.split === "across";
  const room = (across ? rect.width : rect.height) - gap;
  const first = room * cell.share;
  const one = cellBoxes(
    cell.first,
    across ? { ...rect, width: first } : { ...rect, height: first },
    gap,
    line,
  );
  const two = cellBoxes(
    cell.second,
    across
      ? { ...rect, x: rect.x + first + gap, width: room - first }
      : { ...rect, y: rect.y + first + gap, height: room - first },
    gap,
    line,
  );
  const between = across
    ? { x: rect.x + first + (gap - line) / 2, y: rect.y, width: line, height: rect.height }
    : { x: rect.x, y: rect.y + first + (gap - line) / 2, width: rect.width, height: line };
  return {
    cells: [...one.cells, ...two.cells],
    lines: [...(line ? [between] : []), ...one.lines, ...two.lines],
  };
}

/**
 * A part in its cell: where it goes, and the room it wants. A side of the box may be infinite,
 * when the label is as long as its content that way; the part then says how much it needs.
 * @param {Part} part
 * @param {Values} values
 * @param {Rect} box
 * @param {number} scale
 * @param {MeasureText} measure
 * @param {number} mm
 * @returns {{ placed: PlacedPart, natural: Size } | undefined}  Nothing for an empty part.
 */
function placePart(part, values, box, scale, measure, mm) {
  /** @param {TextSize} size */
  const dots = (size) => TEXT_SIZES[size].mm * mm * scale;
  if (part.type === "image") {
    if (!part.image) return undefined;
    const upright = part.image.height / part.image.width;
    const natural = fitBox(box, isQuarterTurned(part) ? 1 / upright : upright);
    const whole = part.show === "fit" || !Number.isFinite(box.width) || !Number.isFinite(box.height);
    return { natural, placed: { part, ...centred(box, whole ? natural : box) } };
  }
  if (part.type === "qr") {
    const code = fill(part.content, values).trim();
    if (!code) return undefined;
    const side = Math.min(box.width, box.height);
    return {
      natural: { width: side, height: side },
      placed: { part, code, ...centred(box, { width: side, height: side }) },
    };
  }
  if (part.type === "barcode") {
    const content = fill(part.content, values).trim();
    if (!content) return undefined;
    const bars = code128(content);
    const size = TEXT_SIZES.xs.mm * mm * scale;
    const caption = part.text ? { size, bold: false, lines: [code128Text(content)] } : undefined;
    // As wide as its bars at the smallest module that scans; a wider cell spreads them. A narrower
    // cell can't make them narrower, so they run over its edge in plain sight.
    const least = barcodeModules(bars) * LEAST_MODULE_DOTS;
    const barHeight = BARCODE_HEIGHTS[part.height] * mm * scale;
    const height = barHeight + (caption ? size * BARCODE_TEXT_LINE : 0);
    const width = Math.max(Number.isFinite(box.width) ? box.width : 0, least);
    return {
      natural: { width: least, height },
      placed: { part, bars, barHeight, caption, ...centred(box, { width, height }) },
    };
  }
  const heading = fill(part.heading, values).trim();
  const text = fill(part.text, values).trim();
  if (!heading && !text) return undefined;
  const placed = {
    part,
    heading: heading ? wrapText(heading, dots(part.headingSize), true, box.width, measure) : undefined,
    text: text ? wrapText(text, dots(part.size), part.bold, box.width, measure) : undefined,
  };
  fitText(placed, box, measure, mm);
  const natural = textSize(placed, measure);
  return {
    natural,
    placed: {
      ...placed,
      x: box.x,
      y: box.y + Math.max(0, (box.height - natural.height) / 2),
      width: box.width,
      height: natural.height,
    },
  };
}

/**
 * The largest box of some proportions inside another, either of whose sides may be infinite.
 * @param {Size} box
 * @param {number} aspect  Height over width.
 * @returns {Size}
 */
function fitBox(box, aspect) {
  const width = Math.min(box.width, box.height / aspect);
  return { width, height: width * aspect };
}

/**
 * A box of a size in the middle of another, or at its start when it is bigger.
 * @param {Rect} box
 * @param {Size} size
 * @returns {Rect}
 */
const centred = (box, size) => ({
  x: box.x + Math.max(0, (box.width - size.width) / 2),
  y: box.y + Math.max(0, (box.height - size.height) / 2),
  width: size.width,
  height: size.height,
});

/**
 * Text broken into lines no wider than `width`, between words where it can and inside a word that
 * is wider on its own; a size of 0 means Fit, measured later.
 * @param {string} text
 * @param {number} size
 * @param {boolean} bold
 * @param {number} width
 * @param {MeasureText} measure
 * @returns {PlacedText}
 */
function wrapText(text, size, bold, width, measure) {
  const paragraphs = text.split("\n").map((line) => line.trim());
  if (!size || !Number.isFinite(width)) return { size, bold, lines: paragraphs };
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
      while (line.length > 1 && measure(line, size, bold) > width) {
        let end = line.length - 1;
        while (end > 1 && measure(line.slice(0, end), size, bold) > width) end--;
        lines.push(line.slice(0, end));
        line = line.slice(end);
      }
    }
    lines.push(line);
  }
  return { size, bold, lines };
}

/**
 * Gives Fit text the largest size at which its lines fit the cell's width and its share of the
 * cell's height, either of which may be infinite.
 * @param {{ heading?: PlacedText, text?: PlacedText }} placed
 * @param {Size} box
 * @param {MeasureText} measure
 * @param {number} mm
 */
function fitText(placed, box, measure, mm) {
  const fitting = [placed.heading, placed.text].filter((part) => part && !part.size);
  if (fitting.length === 0) return;
  const fixed = [placed.heading, placed.text].filter((part) => part?.size);
  const used = fixed.reduce((sum, part) => sum + (part ? part.lines.length * part.size * LINE_HEIGHT : 0), 0);
  const gap = placed.heading && placed.text ? HEADING_GAP : 0;
  for (const part of fitting) {
    if (!part) continue;
    const widest = Math.max(...part.lines.map((line) => measure(line, 100, part.bold)), 1) / 100;
    const byWidth = box.width / widest;
    const byHeight = (box.height - used) / fitting.length / (part.lines.length * LINE_HEIGHT + gap);
    const largest = Math.max(
      TEXT_SIZES.xs.mm * mm * 0.5,
      Math.min(byWidth, byHeight, TEXT_SIZES.xl.mm * mm * 3),
    );
    part.size = Math.floor(largest);
  }
}

/**
 * The room text takes: as wide as its widest line, as tall as its lines stack.
 * @param {{ heading?: PlacedText, text?: PlacedText }} placed
 * @param {MeasureText} measure
 * @returns {Size}
 */
function textSize(placed, measure) {
  const parts = [placed.heading, placed.text].filter((part) => part !== undefined);
  const gap = placed.heading && placed.text ? placed.text.size * HEADING_GAP : 0;
  return {
    width: Math.max(
      0,
      ...parts.flatMap((part) => part.lines.map((line) => measure(line, part.size, part.bold))),
    ),
    height: parts.reduce((sum, part) => sum + part.lines.length * part.size * LINE_HEIGHT, 0) + gap,
  };
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * How long the label is along the roll, in dots: what the template fixes, within the limits a roll
 * has, else what the paper has, which is 0 on a continuous roll.
 * @param {LabelTemplate} template
 * @param {Media} media
 */
const lengthOf = (template, media) =>
  template.lengthMm
    ? Math.round((clamp(template.lengthMm, AUTO_LENGTH_MM.min, AUTO_LENGTH_MM.max) * media.dpi) / 25.4)
    : media.printableHeight;

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
