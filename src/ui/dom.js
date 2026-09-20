/** @import { Bitmap } from "../printers/types.js" */
/** @import { ScryfallCard } from "../scryfall/client.js" */
import { shrinkBitmap } from "../imaging/bitmap.js";
import { imageUrl } from "../scryfall/client.js";

/**
 * The element matching a selector, checked to be of the expected type.
 * @template {Element} T
 * @param {string} selector
 * @param {new () => T} type
 * @returns {T}
 */
export function element(selector, type) {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Missing element ${selector}`);
  return found;
}

/**
 * Draws a label at the size its canvas is shown, so it stays sharp on any screen.
 * @param {HTMLCanvasElement} canvas
 * @param {Bitmap} page
 */
export function drawBitmap(canvas, page) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const { width, height, data } = shrinkBitmap(
    page,
    Math.round(canvas.clientWidth * devicePixelRatio) || page.width,
  );
  canvas.width = width;
  canvas.height = height;
  context.putImageData(new ImageData(data, width, height), 0, 0);
}

/**
 * @param {ScryfallCard} card
 * @param {"small" | "normal"} size
 * @param {string} className
 */
export function cardThumbnail(card, size, className) {
  const image = Object.assign(document.createElement("img"), {
    className,
    alt: "",
    loading: "lazy",
    decoding: "async",
  });
  const url = imageUrl(card, 0, size);
  if (url) image.src = url;
  return image;
}

/**
 * A message for something that went wrong while drawing or printing a label.
 * @param {unknown} error
 */
export function problemMessage(error) {
  if (error instanceof TypeError) {
    return "Couldn't download the card image. Check your connection and try again.";
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Shows a message, followed by a link when there's more help elsewhere.
 * @param {HTMLElement} target
 * @param {string} text
 * @param {{ href: string, text: string }} [link]
 * @param {"problem"} [tone]  A problem is shown on a coloured background.
 */
export function showMessage(target, text, link, tone) {
  if (tone) target.dataset.tone = tone;
  else delete target.dataset.tone;
  if (!link) {
    target.textContent = text;
    return;
  }
  const anchor = Object.assign(document.createElement("a"), {
    href: link.href,
    textContent: link.text,
    target: "_blank",
    rel: "noopener",
  });
  target.replaceChildren(text, " ", anchor);
}

/**
 * Shows something that went wrong where the user was working, on a coloured background.
 * @param {HTMLElement} target
 * @param {string} text
 * @param {{ href: string, text: string }} [link]
 */
export function showProblem(target, text, link) {
  showMessage(target, text, link, "problem");
}
