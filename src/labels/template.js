/**
 * A label template: rows of blocks that re-flow to whatever paper is loaded, with the text that
 * changes from label to label written as placeholders like {Product}.
 */

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
 * @typedef {object} TextBlock
 * @property {"text"} type
 * @property {string} heading
 * @property {TextSize} headingSize
 * @property {string} text  Lines separated by newlines.
 * @property {TextSize} size
 * @property {Align} align
 * @property {boolean} bold  The text; the heading is always bold.
 */

/** @typedef {{ type: "divider", weight: "thin" | "thick" }} DividerBlock */
/** @typedef {{ type: "space", size: "s" | "m" | "l" }} SpaceBlock */

/** How much of the label an image takes, across its row. */
export const IMAGE_WIDTHS = /** @type {const} */ ({
  quarter: { name: "A quarter", fraction: 0.25 },
  third: { name: "A third", fraction: 1 / 3 },
  half: { name: "Half", fraction: 0.5 },
  full: { name: "All of it", fraction: 1 },
});

/**
 * An image saved in this browser, with its size so the label can be laid out before it is loaded.
 * @typedef {{ id: string, width: number, height: number }} StoredImage
 */

/**
 * A picture: a logo, printed crisp, or a photo, dithered. Without an image yet it takes no room.
 * @typedef {object} ImageBlock
 * @property {"image"} type
 * @property {StoredImage} [image]
 * @property {keyof typeof IMAGE_WIDTHS} width
 * @property {"logo" | "photo"} treatment
 * @property {"fit" | "fill"} show  The whole image inside its box, or the box filled and the image cropped.
 */

/**
 * A QR code of some text, which can hold placeholders, e.g. a link for each product.
 * @typedef {{ type: "qr", content: string, width: keyof typeof IMAGE_WIDTHS }} QrBlock
 */

/** How tall a barcode's bars are, in millimetres. */
export const BARCODE_HEIGHTS = /** @type {const} */ ({ s: 8, m: 12, l: 18 });

/**
 * A Code 128 barcode of some text, which can hold placeholders, with the text under it if wanted.
 * @typedef {{ type: "barcode", content: string, height: keyof typeof BARCODE_HEIGHTS, text: boolean }} BarcodeBlock
 */

/** @typedef {TextBlock | DividerBlock | SpaceBlock | ImageBlock | QrBlock | BarcodeBlock} Block */

/** Blocks side by side, sharing the width. @typedef {{ blocks: Block[] }} Row */

/**
 * @typedef {object} LabelTemplate
 * @property {string} id
 * @property {string} name
 * @property {"portrait" | "landscape"} orientation  Landscape reads along the label's longer side.
 * @property {"none" | "thin" | "thick" | "rounded"} border
 * @property {"s" | "m" | "l"} margin  Room between the border and the content.
 * @property {number} [lengthMm]  A fixed length on continuous rolls; without it, the content decides.
 * @property {import("../imaging/fonts.js").FontName} [font]  Sans when missing.
 * @property {Row[]} rows
 */

/** What goes in a template's placeholders, by name. @typedef {Record<string, string>} Values */

/** A placeholder: a name in braces. */
const PLACEHOLDER = /\{([^{}]+)\}/g;

/**
 * A field the template needs filled in.
 * @typedef {object} Field
 * @property {string} name
 * @property {boolean} multiline  The placeholder is a text block's whole text, so it can hold lines.
 */

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
  for (const { blocks } of template.rows) {
    for (const block of blocks) {
      if (block.type === "qr" || block.type === "barcode") collect(block.content, false);
      if (block.type !== "text") continue;
      collect(block.heading, false);
      collect(block.text, isOnlyPlaceholder(block.text));
    }
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
  return text.replace(PLACEHOLDER, (_, name) => values[name.trim()] ?? "");
}

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
  return fields.length > 0 && fields.every(({ name }) => !(values[name] ?? "").trim());
}

/**
 * The text that stands for a filled template, e.g. in the print list: its first value with anything
 * in it, on one line.
 * @param {LabelTemplate} template
 * @param {Values} values
 */
export function firstValue(template, values) {
  for (const { name } of fieldsOf(template)) {
    const value = (values[name] ?? "").trim().split("\n")[0];
    if (value) return value;
  }
  return "";
}

/**
 * A text block with the usual choices.
 * @param {Partial<TextBlock>} [block]
 * @returns {TextBlock}
 */
export const textBlock = (block = {}) => ({
  type: "text",
  heading: "",
  headingSize: "l",
  text: "",
  size: "m",
  align: "start",
  bold: false,
  ...block,
});

/**
 * An image block with the usual choices.
 * @param {Partial<ImageBlock>} [block]
 * @returns {ImageBlock}
 */
export const imageBlock = (block = {}) => ({
  type: "image",
  width: "third",
  treatment: "logo",
  show: "fit",
  ...block,
});

/**
 * The IDs of the images a template uses.
 * @param {LabelTemplate} template
 */
export function imageIdsOf(template) {
  return template.rows.flatMap(({ blocks }) =>
    blocks.flatMap((block) => (block.type === "image" && block.image ? [block.image.id] : [])),
  );
}

/**
 * @param {Partial<QrBlock>} [block]
 * @returns {QrBlock}
 */
export const qrBlock = (block = {}) => ({ type: "qr", content: "{Link}", width: "third", ...block });

/**
 * @param {Partial<BarcodeBlock>} [block]
 * @returns {BarcodeBlock}
 */
export const barcodeBlock = (block = {}) => ({
  type: "barcode",
  content: "{Code}",
  height: "m",
  text: true,
  ...block,
});
