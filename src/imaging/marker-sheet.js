/** @import { Marker } from "../markers.js" */
/** @import { Rect } from "./cut-lines.js" */
/** @import { Bitmap, Media } from "../printers/types.js" */
import { allMarkers } from "../markers.js";
import { thresholdToBitmap } from "./bitmap.js";
import { canvasContext, fitLine, TEXT_THRESHOLD } from "./canvas-text.js";
import { drawCutLines } from "./cut-lines.js";
import { font } from "./fonts.js";
import { parseRules, wrapParagraph } from "./rules-text.js";

/** Marker sizes in millimetres, before stretching to fill a row or shrinking to fit a small label. */
const SIZES = {
  game: { width: 27, height: 22 },
  tracker: { width: 56, height: 14 },
  keyword: { width: 27, height: 9 },
};
/** Length of a continuous label that has no markers on it yet. */
const EMPTY_LENGTH_MM = 20;

/** How long a strip of markers grows on a continuous roll before the next strip starts. */
const MAX_ROLL_LENGTH_MM = 300;
const REMINDER_LINES = 4;

/**
 * @typedef {object} PlacedMarker
 * @property {Marker} marker
 * @property {number} unit  Dots per millimetre of the marker's design, after any shrinking.
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} MarkerPage
 * @property {number} height
 * @property {Rect} area  Where the markers go. Its edges are cut by the printer or are the label's own.
 * @property {PlacedMarker[]} markers
 */

/**
 * Where markers go on labels: the counts, in catalogue order, packed edge to edge in rows with no
 * space between them, so one cut separates two markers. A row holds markers of one kind, stretched
 * to fill the width. Rows continue onto more labels when one is full. Round labels use the square
 * inside the circle. Sizes are in dots.
 * @param {Record<string, number>} counts  By marker ID.
 * @param {Media} media
 * @param {Marker[]} [custom]  Markers typed in, printed after the keywords.
 * @returns {MarkerPage[]}
 */
export function layoutMarkers(counts, media, custom = []) {
  const dotsPerMm = media.dpi / 25.4;
  const side = Math.floor(media.printableWidth / Math.SQRT2);
  const round = media.shape === "round";
  const frame = round
    ? { x: Math.round((media.printableWidth - side) / 2), width: side, height: side }
    : { x: 0, width: media.printableWidth, height: media.printableHeight };
  const frameY = round ? Math.round((media.printableHeight - side) / 2) : 0;

  /** @type {{ marker: Marker, unit: number, height: number }[][]} */
  const rows = [];
  for (const kind of /** @type {const} */ (["game", "tracker", "keyword"])) {
    const size = SIZES[kind];
    const unit = dotsPerMm * Math.min(1, frame.width / (size.width * dotsPerMm));
    const height = Math.floor(size.height * unit);
    const perRow = Math.max(1, Math.floor(frame.width / (size.width * unit)));
    const markers = allMarkers(custom)
      .filter((marker) => marker.kind === kind)
      .flatMap((marker) => Array.from({ length: counts[marker.id] ?? 0 }, () => ({ marker, unit, height })));
    for (let start = 0; start < markers.length; start += perRow)
      rows.push(markers.slice(start, start + perRow));
  }

  // A continuous roll has no length of its own, so markers are cut into strips this long. Any
  // longer and the printer refuses the page: the smallest maximum is 11811 dots, about a metre.
  const limit = frame.height || Math.round(MAX_ROLL_LENGTH_MM * dotsPerMm);

  /** @type {MarkerPage[]} */
  const pages = [];
  /** @type {PlacedMarker[]} */
  let placed = [];
  let used = 0;
  const finishPage = () => {
    const height = media.printableHeight || Math.max(used, Math.round(EMPTY_LENGTH_MM * dotsPerMm));
    const area = { x: frame.x, y: frameY, width: frame.width, height: frame.height || height };
    pages.push({ height, area, markers: placed });
    placed = [];
    used = 0;
  };
  for (const row of rows) {
    const rowHeight = Math.min(row[0].height, limit);
    if (placed.length > 0 && used + rowHeight > limit) finishPage();
    row.forEach(({ marker, unit }, index) => {
      const left = Math.round((index * frame.width) / row.length);
      const right = Math.round(((index + 1) * frame.width) / row.length);
      placed.push({
        marker,
        unit,
        x: frame.x + left,
        y: frameY + used,
        width: right - left,
        height: rowHeight,
      });
    });
    used += rowHeight;
  }
  if (placed.length > 0 || pages.length === 0) finishPage();
  return pages;
}

/**
 * Draws markers on as many labels as they need, with a dashed line to cut along between neighbours.
 * @param {Record<string, number>} counts
 * @param {Media} media
 * @param {Marker[]} [custom]
 * @returns {Bitmap[]}
 */
export function renderMarkers(counts, media, custom = []) {
  const round = media.shape === "round";
  return layoutMarkers(counts, media, custom).map(({ height, area, markers }) => {
    const context = canvasContext(media.printableWidth, height);
    context.fillStyle = "white";
    context.fillRect(0, 0, media.printableWidth, height);
    context.fillStyle = "black";
    context.textAlign = "center";
    for (const placed of markers) drawMarker(context, placed);
    drawCutLines(context, markers, round ? undefined : area, media.dpi / 25.4);
    return thresholdToBitmap(context.getImageData(0, 0, media.printableWidth, height), TEXT_THRESHOLD);
  });
}

/**
 * @param {OffscreenCanvasRenderingContext2D} context
 * @param {PlacedMarker} placed
 */
function drawMarker(context, { marker, unit, x, y, width, height }) {
  const inner = width - 3 * unit;
  const centerX = x + width / 2;

  if (marker.kind === "keyword") {
    const size = fitLine(context, marker.name, 700, 4.2 * unit, inner);
    context.font = font(700, size);
    context.fillText(marker.name, centerX, y + height / 2 + size * 0.36);
    return;
  }

  const nameSize = fitLine(context, marker.name, 700, 4 * unit, inner);
  context.font = font(700, nameSize);
  context.fillText(marker.name, centerX, y + 5.5 * unit);

  if (marker.kind === "game") {
    const [words = []] = parseRules(marker.reminder ?? "");
    let size = 2.3 * unit;
    let lines = reminderLines(context, words, size, inner);
    while (lines.length > REMINDER_LINES && size > 1.6 * unit) {
      size -= 0.1 * unit;
      lines = reminderLines(context, words, size, inner);
    }
    for (const [index, text] of lines.entries()) {
      context.fillText(text, centerX, y + 10 * unit + index * size * 1.25);
    }
    return;
  }

  // Trackers: a numbered box for each step, to mark with a pen or a clip.
  const count = marker.track ?? 0;
  const spacing = 0.8 * unit;
  const box = Math.min(5 * unit, (inner - spacing * (count - 1)) / count);
  let boxX = centerX - (count * box + (count - 1) * spacing) / 2;
  const boxY = y + height - 1.5 * unit - box;
  context.strokeStyle = "black";
  context.lineWidth = Math.max(1, 0.25 * unit);
  context.font = font(700, box * 0.55);
  for (let step = 1; step <= count; step++) {
    context.strokeRect(boxX, boxY, box, box);
    context.fillText(String(step), boxX + box / 2, boxY + box * 0.7);
    boxX += box + spacing;
  }
}

/**
 * @param {OffscreenCanvasRenderingContext2D} context
 * @param {import("./rules-text.js").Word[]} words
 * @param {number} size
 * @param {number} width
 */
function reminderLines(context, words, size, width) {
  context.font = font(400, size);
  /** @param {import("./rules-text.js").Word} word */
  const text = (word) => word.map((piece) => piece.text).join("");
  return wrapParagraph(
    words,
    width,
    (word) => context.measureText(text(word)).width,
    context.measureText(" ").width,
  ).map((line) => line.map(text).join(" "));
}
