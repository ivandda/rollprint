/** @import { CoverSize, ShelfBook } from "../books/shelf.js" */
/** @import { Rect } from "./cut-lines.js" */
/** @import { Bitmap, Media } from "../printers/types.js" */
import { bookCoverUrl, COVER_ASPECT, COVER_SIZES } from "../books/shelf.js";
import { ditherToBitmap } from "./bitmap.js";
import { canvasContext } from "./canvas-text.js";
import { TONES } from "./card.js";
import { drawCutLines } from "./cut-lines.js";

/**
 * Where book covers go on labels: every cover the same size, packed edge to edge in rows so one cut
 * separates two of them, continuing onto more labels when one is full. Each size divides the
 * label's width exactly, so no strip of paper is left blank down the side. A cover too tall for the
 * label shrinks and sits in the middle of its cell, keeping the cut lines where they were.
 */

/** Length of a continuous label that has no covers on it yet. */
const EMPTY_LENGTH_MM = 20;
/** How long a strip of covers grows on a continuous roll before the next strip starts. */
const MAX_ROLL_LENGTH_MM = 300;

/**
 * @typedef {object} PlacedCover
 * @property {ShelfBook} book
 * @property {Rect} cell  The room this cover has, whose edges are cut.
 * @property {Rect} cover  Where the cover is drawn, in the middle of its cell.
 */

/**
 * @typedef {object} CoverPage
 * @property {number} height
 * @property {Rect} area  Where the covers go. Its edges are cut by the printer or are the label's own.
 * @property {PlacedCover[]} covers
 */

/**
 * @param {ShelfBook[]} shelf
 * @param {CoverSize} size
 * @param {Media} media
 * @returns {CoverPage[]}
 */
export function layoutCovers(shelf, size, media) {
  const dotsPerMm = media.dpi / 25.4;
  const side = Math.floor(media.printableWidth / Math.SQRT2);
  const round = media.shape === "round";
  const frame = round
    ? { x: Math.round((media.printableWidth - side) / 2), width: side, height: side }
    : { x: 0, width: media.printableWidth, height: media.printableHeight };
  const frameY = round ? Math.round((media.printableHeight - side) / 2) : 0;

  const across = COVER_SIZES[size].across;
  const cellWidth = frame.width / across;
  // The row is as tall as a cover of that width, unless the label is shorter than that.
  const tallest = frame.height || Number.POSITIVE_INFINITY;
  const rowHeight = Math.min(Math.round(cellWidth * COVER_ASPECT), tallest);

  const wanted = shelf.flatMap(({ count, ...book }) =>
    Array.from({ length: count }, () => ({ ...book, count })),
  );

  // A continuous roll has no length of its own, so covers are cut into strips this long. Any longer
  // and the printer refuses the page.
  const limit = frame.height || Math.round(MAX_ROLL_LENGTH_MM * dotsPerMm);

  /** @type {CoverPage[]} */
  const pages = [];
  /** @type {PlacedCover[]} */
  let placed = [];
  let used = 0;
  const finishPage = () => {
    const height = media.printableHeight || Math.max(used, Math.round(EMPTY_LENGTH_MM * dotsPerMm));
    const area = { x: frame.x, y: frameY, width: frame.width, height: frame.height || height };
    pages.push({ height, area, covers: placed });
    placed = [];
    used = 0;
  };

  for (let start = 0; start < wanted.length; start += across) {
    const row = wanted.slice(start, start + across);
    const height = Math.min(rowHeight, limit);
    if (placed.length > 0 && used + height > limit) finishPage();
    row.forEach((book, index) => {
      const left = Math.round((index * frame.width) / across);
      const right = Math.round(((index + 1) * frame.width) / across);
      const cell = { x: frame.x + left, y: frameY + used, width: right - left, height };
      placed.push({ book, cell, cover: fitCover(cell) });
    });
    used += height;
  }
  if (placed.length > 0 || pages.length === 0) finishPage();
  return pages;
}

/**
 * The largest cover that fits a cell, in the middle of it. It fills the cell exactly unless the
 * label was too short for the size chosen, in which case it shrinks rather than being cut in half.
 * @param {Rect} cell
 * @returns {Rect}
 */
function fitCover({ x, y, width, height }) {
  const tall = Math.round(width * COVER_ASPECT) > height;
  const coverWidth = tall ? Math.round(height / COVER_ASPECT) : width;
  const coverHeight = tall ? height : Math.round(width * COVER_ASPECT);
  return {
    x: x + Math.round((width - coverWidth) / 2),
    y: y + Math.round((height - coverHeight) / 2),
    width: coverWidth,
    height: coverHeight,
  };
}

/**
 * Draws covers on as many labels as they need, with a dashed line to cut along between neighbours.
 * A cover whose proportions differ from the rest is cropped to fit, never stretched, so that every
 * cover on the sheet is the same shape.
 * @param {ShelfBook[]} shelf
 * @param {CoverSize} size
 * @param {Media} media
 * @param {Map<string, ImageBitmap>} images  Decoded covers, by the address they were loaded from.
 * @param {{ tone?: { black: number, white: number, gamma: number } }} [options]
 * @returns {Bitmap[]}
 */
export function renderCovers(shelf, size, media, images, { tone = TONES.normal } = {}) {
  const round = media.shape === "round";
  return layoutCovers(shelf, size, media).map(({ height, area, covers }) => {
    const context = canvasContext(media.printableWidth, height);
    context.fillStyle = "white";
    context.fillRect(0, 0, media.printableWidth, height);
    context.imageSmoothingQuality = "high";
    for (const placed of covers) drawCover(context, placed, images);
    drawCutLines(
      context,
      covers.map(({ cell }) => cell),
      round ? undefined : area,
      media.dpi / 25.4,
    );
    return ditherToBitmap(context.getImageData(0, 0, media.printableWidth, height), tone);
  });
}

/**
 * @param {OffscreenCanvasRenderingContext2D} context
 * @param {PlacedCover} placed
 * @param {Map<string, ImageBitmap>} images
 */
function drawCover(context, { book, cover }, images) {
  const url = bookCoverUrl(book);
  const image = url && images.get(url);
  if (!image) throw new Error(`The cover of ${book.title} didn't load.`);

  // Covers are not all the same shape, so the middle of this one fills the room it has.
  const scale = Math.max(cover.width / image.width, cover.height / image.height);
  const cropWidth = cover.width / scale;
  const cropHeight = cover.height / scale;
  context.drawImage(
    image,
    (image.width - cropWidth) / 2,
    (image.height - cropHeight) / 2,
    cropWidth,
    cropHeight,
    cover.x,
    cover.y,
    cover.width,
    cover.height,
  );
}
