/** Drawing text on a canvas for thermal printing. */

import { font } from "./fonts.js";

/** Keeps the grey edges of letters when converting to dots, so thin strokes of small text still print. */
export const TEXT_THRESHOLD = 190;

/**
 * The largest size, up to `largest`, at which one line of text fits the width; at least half of it.
 * @param {OffscreenCanvasRenderingContext2D} context
 * @param {string} text
 * @param {number} weight
 * @param {number} largest
 * @param {number} width
 */
export function fitLine(context, text, weight, largest, width) {
  context.font = font(weight, largest);
  const measured = context.measureText(text).width;
  return measured > width ? Math.max(largest / 2, (largest * width) / measured) : largest;
}

/**
 * @param {number} width
 * @param {number} height
 */
export function canvasContext(width, height) {
  const context = new OffscreenCanvas(width, height).getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  return context;
}
