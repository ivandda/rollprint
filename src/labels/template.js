/**
 * A label template: a layout of cells that re-flows to whatever paper is loaded, each cell holding
 * one part, with the text that changes from label to label written as placeholders like {Product}.
 */
import { leavesOf, splitAll } from "./cells.js";

/** Named text sizes, as the height of the type in millimetres; Fit is as large as the room allows. */
export const TEXT_SIZES = /** @type {const} */ ({
  xs: { name: "Tiny", mm: 2.5 },
  s: { name: "Small", mm: 3.2 },
  m: { name: "Medium", mm: 4.2 },
  l: { name: "Large", mm: 6 },
  xl: { name: "Huge", mm: 9 },
  fit: { name: "Fit", mm: 0 },
});

/** @typedef {keyof typeof TEXT_SIZES} TextSize */
/** @typedef {"start" | "center" | "end"} Align */

/**
 * Text, with an optional heading above it in its own size. Either can hold placeholders.
 * @typedef {object} TextPart
 * @property {"text"} type
 * @property {string} heading
 * @property {TextSize} headingSize
 * @property {string} text  Lines separated by newlines.
 * @property {TextSize} size
 * @property {Align} align
 * @property {boolean} bold  The text; the heading is always bold.
 */

/**
 * An image saved in this browser, with its size so the label can be laid out before it is loaded.
 * @typedef {{ id: string, width: number, height: number }} StoredImage
 */

/** How an image is turned: upright, a quarter turn either way, or a half turn. */
export const TURNS = /** @type {const} */ ({
  none: { name: "Upright", radians: 0 },
  left: { name: "A quarter left", radians: -Math.PI / 2 },
  half: { name: "Upside down", radians: Math.PI },
  right: { name: "A quarter right", radians: Math.PI / 2 },
});

/**
 * A picture: a logo, printed crisp, or a photo, dithered. It takes its cell, whole or filling it.
 * @typedef {object} ImagePart
 * @property {"image"} type
 * @property {StoredImage} [image]
 * @property {"logo" | "photo"} treatment
 * @property {"fit" | "fill"} show  The whole image inside its cell, or the cell filled and the image cropped.
 * @property {keyof typeof TURNS} [turn]  Upright when missing.
 */

/** Whether an image is turned a quarter, so its sides swap. @param {ImagePart} part */
export const isQuarterTurned = (part) => part.turn === "left" || part.turn === "right";

/**
 * A QR code of some text, which can hold placeholders, e.g. a link for each product.
 * @typedef {{ type: "qr", content: string }} QrPart
 */

/** How tall a barcode's bars are, in millimetres. */
export const BARCODE_HEIGHTS = /** @type {const} */ ({ s: 8, m: 12, l: 18 });

/**
 * A Code 128 barcode of some text, which can hold placeholders, with the text under it if wanted.
 * @typedef {{ type: "barcode", content: string, height: keyof typeof BARCODE_HEIGHTS, text: boolean }} BarcodePart
 */

/** @typedef {TextPart | ImagePart | QrPart | BarcodePart} Part */

/**
 * A cell of the label: a part, or nothing yet; or two cells side by side (across) or one above the
 * other (down), the first taking a share of the room.
 * @typedef {{ part?: Part }} Leaf
 * @typedef {{ split: "across" | "down", share: number, first: Cell, second: Cell }} Split
 * @typedef {Leaf | Split} Cell
 */

/** The shares a cell can be given of its split. */
export const SHARES = /** @type {const} */ ([
  { share: 1 / 3, name: "A third" },
  { share: 1 / 2, name: "Half" },
  { share: 2 / 3, name: "Two thirds" },
]);

/**
 * @typedef {object} LabelTemplate
 * @property {string} id
 * @property {string} name
 * @property {"portrait" | "landscape"} orientation  Landscape reads along the label's longer side.
 * @property {"none" | "thin" | "thick" | "rounded"} border
 * @property {"s" | "m" | "l"} margin  Room between the border and the content.
 * @property {number} [lengthMm]  A fixed length on continuous rolls; without it, the content decides.
 * @property {import("../imaging/fonts.js").FontName} [font]  Sans when missing.
 * @property {"thin" | "thick"} [lines]  Lines between the cells; none when missing.
 * @property {Cell} cell
 */

/** What goes in a template's placeholders, by name. @typedef {Record<string, string>} Values */

/** A placeholder: a name in braces. */
const PLACEHOLDER = /\{([^{}]+)\}/g;

/**
 * A field the template needs filled in.
 * @typedef {object} Field
 * @property {string} name
 * @property {boolean} multiline  The placeholder is a text part's whole text, so it can hold lines.
 */

/**
 * The parts a template's cells hold, in reading order.
 * @param {LabelTemplate} template
 * @returns {Part[]}
 */
export const partsOf = (template) =>
  leavesOf(template.cell).flatMap(({ leaf }) => (leaf.part ? [leaf.part] : []));

/**
 * The fields a template's placeholders ask for, once each, in the order they appear.
 * @param {LabelTemplate} template
 * @returns {Field[]}
 */
export function fieldsOf(template) {
  /** @type {Map<string, Field>} */
  const fields = new Map();
  /**
   * @param {string} text
   * @param {boolean} multiline
   */
  const collect = (text, multiline) => {
    for (const [, name] of text.matchAll(PLACEHOLDER)) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const field = fields.get(trimmed);
      if (field) field.multiline ||= multiline;
      else fields.set(trimmed, { name: trimmed, multiline });
    }
  };
  for (const part of partsOf(template)) {
    if (part.type === "qr" || part.type === "barcode") collect(part.content, false);
    if (part.type !== "text") continue;
    collect(part.heading, false);
    collect(part.text, isOnlyPlaceholder(part.text));
  }
  return [...fields.values()];
}

/** @param {string} text */
const isOnlyPlaceholder = (text) => /^\s*\{[^{}]+\}\s*$/.test(text);

/**
 * The text with its placeholders filled in; a missing value leaves nothing.
 * @param {string} text
 * @param {Values} values
 */
export function fill(text, values) {
  return text.replace(PLACEHOLDER, (_, name) => fieldValue(values, name.trim()));
}

/** A field's value, or nothing; never what every object inherits, like `constructor`.
 * @param {Values} values @param {string} name */
const fieldValue = (values, name) => (Object.hasOwn(values, name) ? values[name] : "");

/**
 * Values that show a template as its designer sees it: each field says its own name.
 * @param {LabelTemplate} template
 * @returns {Values}
 */
export function sampleValues(template) {
  return Object.fromEntries(fieldsOf(template).map(({ name }) => [name, name]));
}

/**
 * Whether values fill a template with anything at all. A template without fields is never empty.
 * @param {LabelTemplate} template
 * @param {Values} values
 */
export function isBlank(template, values) {
  const fields = fieldsOf(template);
  return fields.length > 0 && fields.every(({ name }) => !fieldValue(values, name).trim());
}

/**
 * The text that stands for a filled template, e.g. in the print list: its first value with anything
 * in it, on one line.
 * @param {LabelTemplate} template
 * @param {Values} values
 */
export function firstValue(template, values) {
  for (const { name } of fieldsOf(template)) {
    const value = fieldValue(values, name).trim().split("\n")[0];
    if (value) return value;
  }
  return "";
}

/**
 * A text part with the usual choices.
 * @param {Partial<TextPart>} [part]
 * @returns {TextPart}
 */
export const textPart = (part = {}) => ({
  type: "text",
  heading: "",
  headingSize: "l",
  text: "",
  size: "m",
  align: "start",
  bold: false,
  ...part,
});

/**
 * An image part with the usual choices.
 * @param {Partial<ImagePart>} [part]
 * @returns {ImagePart}
 */
export const imagePart = (part = {}) => ({ type: "image", treatment: "logo", show: "fit", ...part });

/**
 * @param {Partial<QrPart>} [part]
 * @returns {QrPart}
 */
export const qrPart = (part = {}) => ({ type: "qr", content: "{Link}", ...part });

/**
 * @param {Partial<BarcodePart>} [part]
 * @returns {BarcodePart}
 */
export const barcodePart = (part = {}) => ({
  type: "barcode",
  content: "{Code}",
  height: "m",
  text: true,
  ...part,
});

/**
 * The IDs of the images a template uses.
 * @param {LabelTemplate} template
 */
export function imageIdsOf(template) {
  return partsOf(template).flatMap((part) => (part.type === "image" && part.image ? [part.image.id] : []));
}

/** How wide an image or QR code was, before cells, as a share of its row. */
const OLD_WIDTHS = /** @type {Record<string, number>} */ ({
  quarter: 0.25,
  third: 1 / 3,
  half: 0.5,
  full: 1,
});

/**
 * A template saved before templates had cells, when they were rows of blocks, brought up to date;
 * anything else comes back as it is. Rows become cells one above the other and blocks in a row
 * cells across it, an image's width becomes its cell's share, a divider becomes lines between the
 * cells and a space an empty cell.
 * @param {any} raw
 * @returns {any}
 */
export function upgradeTemplate(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.rows) || raw.cell) return raw;
  const { rows, ...rest } = raw;
  /** @type {"thin" | "thick" | undefined} */
  let lines;
  /** @type {Cell[]} */
  const cells = [];
  for (const row of rows) {
    const blocks = /** @type {any[]} */ (Array.isArray(row?.blocks) ? row.blocks : []).filter(
      (block) => block && typeof block === "object",
    );
    for (const block of blocks) {
      if (block.type === "divider") lines = block.weight === "thick" ? "thick" : (lines ?? "thin");
    }
    const kept = blocks.filter((block) => block.type !== "divider");
    if (kept.length === 0) continue;
    const asked = kept.map((block) =>
      block.type === "image" || block.type === "qr" ? (OLD_WIDTHS[block.width] ?? 1 / 3) : 0,
    );
    const free = asked.filter((share) => share === 0).length;
    const left = Math.max(0, 1 - asked.reduce((sum, share) => sum + share, 0)) / Math.max(free, 1);
    cells.push(
      splitAll(
        "across",
        kept.map(oldPart),
        asked.map((share) => share || left),
      ),
    );
  }
  const cell = splitAll(
    "down",
    cells,
    cells.map(() => 1),
  );
  return { ...rest, ...(lines && { lines }), cell };
}

/** @param {any} block @returns {Cell} */
function oldPart(block) {
  if (block.type === "image" || block.type === "qr") {
    const { width, ...part } = block;
    return { part };
  }
  if (block.type === "text" || block.type === "barcode") return { part: block };
  return {};
}
