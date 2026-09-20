/** @import { BackupImage } from "../backup.js" */
/** @import { FontName } from "../imaging/fonts.js" */
/** @import { Cell, LabelTemplate, Part } from "./template.js" */
import { fromBase64, toBase64 } from "../backup.js";
import { FONTS } from "../imaging/fonts.js";
import { BARCODE_HEIGHTS, TEXT_SIZES, TURNS, upgradeTemplate } from "./template.js";

/**
 * A template as a file, with its images, so it can be handed to someone else or kept; and as a
 * link when it has no images. Both carry the same JSON.
 */

const FORMAT = "rollprint/template";
/** Version 1 had rows of blocks; version 2 has cells. */
const VERSION = 2;
const NOT_A_TEMPLATE = "This file isn't a label template. Choose a file made with Export.";
export const LINK_PARAM = "template";

/**
 * @param {LabelTemplate} template
 * @param {Map<string, BackupImage>} images  The images the template uses, by ID.
 * @returns {string}
 */
export function writeTemplateFile(template, images) {
  /** @type {Record<string, { type: string, data: string }>} */
  const encoded = {};
  for (const [id, { type, bytes }] of images) encoded[id] = { type, data: toBase64(bytes) };
  return JSON.stringify({ format: FORMAT, version: VERSION, template, images: encoded });
}

/**
 * The template and images in a file.
 * @param {string} text
 * @returns {{ template: LabelTemplate, images: Map<string, BackupImage> }}
 * @throws {Error} with a message to show, when the file isn't a template.
 */
export function readTemplateFile(text) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error(NOT_A_TEMPLATE);
  }
  if (file?.format !== FORMAT || typeof file.version !== "number") throw new Error(NOT_A_TEMPLATE);
  if (file.version > VERSION) {
    throw new Error("This template was made by a newer version of this page. Reload the page and try again.");
  }
  const template = templateOf(file.version < VERSION ? upgradeTemplate(file.template) : file.template);
  if (!template) throw new Error(NOT_A_TEMPLATE);
  /** @type {Map<string, BackupImage>} */
  const images = new Map();
  for (const [id, image] of Object.entries(file.images ?? {})) {
    if (typeof image?.type !== "string" || !image.type.startsWith("image/") || typeof image.data !== "string")
      continue;
    try {
      images.set(id, { type: image.type, bytes: fromBase64(image.data) });
    } catch {
      // A damaged image is left out; its cell comes back empty.
    }
  }
  return { template, images };
}

/**
 * A link that carries a template without images.
 * @param {LabelTemplate} template
 * @param {string} page  The app's address.
 */
export function templateLink(template, page) {
  const url = new URL(page);
  url.search = new URLSearchParams({
    mode: "templates",
    [LINK_PARAM]: encode(JSON.stringify({ format: FORMAT, version: VERSION, template })),
  }).toString();
  url.hash = "";
  return url.href;
}

/**
 * The template a link carries, or undefined when the link is damaged.
 * @param {string} value  The link's parameter.
 */
export function readTemplateLink(value) {
  try {
    return readTemplateFile(decode(value)).template;
  } catch {
    return undefined;
  }
}

/**
 * A template from untrusted JSON, with anything unexpected dropped or given a default, or undefined
 * when it isn't one at all.
 * @param {unknown} value
 * @returns {LabelTemplate | undefined}
 */
export function templateOf(value) {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.cell)) return undefined;
  const lengthMm = Number(value.lengthMm);
  const font = oneOf(value.font, /** @type {FontName[]} */ (Object.keys(FONTS)), "sans");
  const lines = /** @type {const} */ (["thin", "thick"]).find((option) => option === value.lines);
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : "",
    orientation: value.orientation === "portrait" ? "portrait" : "landscape",
    border: oneOf(value.border, ["none", "thin", "thick", "rounded"], "none"),
    margin: oneOf(value.margin, ["s", "m", "l"], "m"),
    ...(lengthMm > 0 && { lengthMm }),
    ...(font !== "sans" && { font }),
    ...(lines && { lines }),
    cell: cellOf(value.cell),
  };
}

/**
 * @param {unknown} value
 * @returns {Cell}
 */
function cellOf(value) {
  if (!isRecord(value)) return {};
  if (value.split === "across" || value.split === "down") {
    const share = Number(value.share);
    return {
      split: value.split,
      share: share > 0 && share < 1 ? share : 1 / 2,
      first: cellOf(value.first),
      second: cellOf(value.second),
    };
  }
  const part = partOf(value.part);
  return part ? { part } : {};
}

/**
 * @param {unknown} value
 * @returns {Part | undefined}
 */
function partOf(value) {
  if (!isRecord(value)) return undefined;
  const sizes = /** @type {(keyof typeof TEXT_SIZES)[]} */ (Object.keys(TEXT_SIZES));
  switch (value.type) {
    case "text":
      return {
        type: "text",
        heading: text(value.heading),
        headingSize: oneOf(value.headingSize, sizes, "l"),
        text: text(value.text),
        size: oneOf(value.size, sizes, "m"),
        align: oneOf(value.align, ["start", "center", "end"], "start"),
        bold: value.bold === true,
      };
    case "image": {
      const image = value.image;
      const stored =
        isRecord(image) && typeof image.id === "string" && Number(image.width) > 0 && Number(image.height) > 0
          ? { id: image.id, width: Number(image.width), height: Number(image.height) }
          : undefined;
      const turn = oneOf(value.turn, /** @type {(keyof typeof TURNS)[]} */ (Object.keys(TURNS)), "none");
      return {
        type: "image",
        ...(stored && { image: stored }),
        treatment: oneOf(value.treatment, ["logo", "photo"], "logo"),
        show: oneOf(value.show, ["fit", "fill"], "fit"),
        ...(turn !== "none" && { turn }),
      };
    }
    case "qr":
      return { type: "qr", content: text(value.content) };
    case "barcode":
      return {
        type: "barcode",
        content: text(value.content),
        height: oneOf(
          value.height,
          /** @type {(keyof typeof BARCODE_HEIGHTS)[]} */ (Object.keys(BARCODE_HEIGHTS)),
          "m",
        ),
        text: value.text !== false,
      };
    default:
      return undefined;
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === "object" && value !== null;

/** @param {unknown} value */
const text = (value) => (typeof value === "string" ? value : "");

/**
 * @template {string} T
 * @param {unknown} value
 * @param {readonly T[]} allowed
 * @param {T} fallback
 */
const oneOf = (value, allowed, fallback) => allowed.find((option) => option === value) ?? fallback;

/**
 * Base64 with the URL-safe alphabet and no padding, so it needs no escaping in an address.
 * @param {string} value
 */
const encode = (value) =>
  toBase64(new TextEncoder().encode(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

/** @param {string} value */
const decode = (value) =>
  new TextDecoder("utf-8", { fatal: true }).decode(
    fromBase64(value.replaceAll("-", "+").replaceAll("_", "/")),
  );
