/** @import { Bitmap, Media } from "../printers/types.js" */
import { pasteBitmap } from "./bitmap.js";
import { CUT_LINE } from "./cut-lines.js";

/** Blank paper on each side of the fold where the printer doesn't say how much it feeds, in millimetres. */
const FOLD_MARGIN_MM = 3;

/**
 * Blank dots on each side of the fold: as much as the printer feeds at the ends of the piece, so both
 * halves come out the same length.
 * @param {Media} media
 */
export const foldMargin = (media) => media.feedMargin ?? Math.round((FOLD_MARGIN_MM * media.dpi) / 25.4);

/**
 * Both faces of a double-faced card on one piece of a continuous roll, to fold in the middle: the
 * front on top, and the back below it upside down, so that once folded and turned over sideways like
 * a real card it reads upright. A dashed line marks the fold.
 * @param {Bitmap} front
 * @param {Bitmap} back  As wide as the front.
 * @param {Media} media
 * @returns {Bitmap}
 */
export function foldedPage(front, back, media) {
  const { width } = front;
  const margin = foldMargin(media);
  const fold = front.height + margin;
  const height = fold + margin + back.height;
  const page = { width, height, pixels: new Uint8Array(width * height) };
  pasteBitmap(page, front, 0, 0);
  // Reversing the rows and the dots in them turns the picture upside down.
  pasteBitmap(page, { ...back, pixels: back.pixels.slice().reverse() }, 0, fold + margin);

  const dotsPerMm = media.dpi / 25.4;
  const thickness = Math.max(1, Math.round(CUT_LINE.width * dotsPerMm));
  const period = (CUT_LINE.dash + CUT_LINE.gap) * dotsPerMm;
  const top = fold - Math.floor(thickness / 2);
  for (let x = 0; x < width; x++) {
    if (x % period >= CUT_LINE.dash * dotsPerMm) continue;
    for (let y = top; y < top + thickness; y++) page.pixels[y * width + x] = 1;
  }
  return page;
}
