/** @import { Bitmap, Media } from "../printers/types.js" */
/** @import { Arrangement } from "./arrangement.js" */
/** @import { Word } from "./rules-text.js" */
import { placeImage } from "./arrangement.js";
import { ditherToBitmap, pasteBitmap, thresholdToBitmap } from "./bitmap.js";
import { canvasContext, fitLine, TEXT_THRESHOLD } from "./canvas-text.js";
import { cardSize } from "./card.js";
import { font } from "./fonts.js";
import { fitRules, parseRules, textHeight, wrapParagraph } from "./rules-text.js";

const CARD_WIDTH_MM = 63;
const LINE_HEIGHT = 1.25;
/** Symbols are drawn about as tall as capital letters and spaced like a wide letter. */
const SYMBOL_SIZE = 0.8;
const SYMBOL_ADVANCE = 1;
/** Height ÷ width of the art box at its smallest, when long rules text needs the room. */
const MIN_ART_ASPECT = 0.5;
/** Sizes in millimetres of a real card. */
const PADDING = 3;
const NAME_ROW = 8;
const TYPE_ROW = 7;
const STATS_HEIGHT = 9;
const GAP = 2;

/**
 * @typedef {object} TextCard
 * @property {string} name
 * @property {string} manaCost  e.g. "{2}{G}"; empty for tokens.
 * @property {string} typeLine
 * @property {string} rules
 * @property {string} stats  Power and toughness, such as "1/1", or loyalty; empty if none.
 * @property {{ image: ImageBitmap, arrangement: Arrangement }} [art]
 */

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */

/**
 * Widths of rules text at a size, in dots.
 * @typedef {{ word: (word: Word, size: number) => number, space: (size: number) => number }} TextMeasure
 */

/**
 * Measures rules text the way a text card draws it, with each symbol as wide as a wide letter.
 * @param {OffscreenCanvasRenderingContext2D} context
 * @returns {TextMeasure}
 */
export function textMeasure(context) {
  /**
   * @param {Word} word
   * @param {number} size
   */
  const word = (word, size) => {
    context.font = font(400, size);
    return word.reduce(
      (total, piece) =>
        total + (piece.symbol ? size * SYMBOL_ADVANCE : context.measureText(piece.text).width),
      0,
    );
  };
  return { word, space: (size) => word([{ text: " ", symbol: false }], size) };
}

/**
 * Where the parts of a text card go on the label, in dots. The card is as large as a card image
 * would print. The rules text gets the room it needs at its largest size and the art takes the
 * rest; long text shrinks the art down to a minimum, and then the text.
 * @param {{ rules: string, stats: string, hasArt: boolean }} card
 * @param {Media} media
 * @param {TextMeasure} measure
 */
export function layoutTextCard({ rules, stats, hasArt }, media, measure) {
  const box = cardSize(media);
  const width = media.printableWidth;
  const height = media.printableHeight || box.height;
  const mm = box.width / CARD_WIDTH_MM;
  const frame = {
    x: Math.round((width - box.width) / 2),
    y: Math.round((height - box.height) / 2),
    width: box.width,
    height: box.height,
  };
  const inner = {
    left: frame.x + PADDING * mm,
    right: frame.x + frame.width - PADDING * mm,
    top: frame.y + PADDING * mm,
    bottom: frame.y + frame.height - PADDING * mm,
  };
  const nameBottom = inner.top + NAME_ROW * mm;
  const rulesBottom = stats ? inner.bottom - (STATS_HEIGHT + 1) * mm : inner.bottom;
  const rulesSize = { largest: (hasArt ? 4.5 : 6) * mm, smallest: 2.4 * mm };

  /** @type {Rect | undefined} */
  let art;
  let typeTop = nameBottom + 1 * mm;
  if (hasArt) {
    const top = Math.round(nameBottom + GAP * mm);
    const artWidth = Math.round(inner.right - inner.left);
    const room = rulesBottom - (1 + TYPE_ROW + GAP) * mm - top;
    const size = rulesSize.largest;
    const wrapped = parseRules(rules).map((paragraph) =>
      wrapParagraph(paragraph, artWidth, (word) => measure.word(word, size), measure.space(size)),
    );
    const text = textHeight(wrapped, size, LINE_HEIGHT);
    const artHeight = Math.max(
      1,
      Math.floor(Math.min(room, Math.max(artWidth * MIN_ART_ASPECT, room - text))),
    );
    art = { x: Math.round(inner.left), y: top, width: artWidth, height: artHeight };
    typeTop = top + artHeight + 1 * mm;
  }
  const typeBottom = typeTop + TYPE_ROW * mm;
  return {
    width,
    height,
    mm,
    frame,
    inner,
    nameBottom,
    art,
    typeTop,
    typeBottom,
    rulesTop: typeBottom + GAP * mm,
    rulesBottom,
    rulesSize,
  };
}

/**
 * Lays a card out as text: name and mana cost, optional art, type line, rules text and
 * power/toughness. Text prints solid black; only the art is dithered.
 * @param {TextCard} card
 * @param {Media} media
 * @param {object} options
 * @param {{ black: number, white: number, gamma: number }} options.tone  Applied to the art.
 * @param {Map<string, CanvasImageSource>} options.symbols  Pictures of symbols such as "{T}".
 * @returns {Bitmap}
 */
export function renderTextCard(card, media, { tone, symbols }) {
  const context = canvasContext(media.printableWidth, media.printableHeight || cardSize(media).height);
  const measure = textMeasure(context);
  const layout = layoutTextCard(
    { rules: card.rules, stats: card.stats, hasArt: Boolean(card.art) },
    media,
    measure,
  );
  const { width, height, mm, frame, inner } = layout;
  const innerWidth = inner.right - inner.left;

  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "black";
  context.strokeStyle = "black";

  /**
   * Draws a word's text and symbols from `x` on a baseline, and returns where it ends.
   * @param {Word} word
   * @param {number} x
   * @param {number} baseline
   * @param {number} size
   * @param {number} weight
   */
  const drawWord = (word, x, baseline, size, weight) => {
    for (const piece of word) {
      const picture = piece.symbol && symbols.get(piece.text);
      if (picture) {
        const symbolSize = size * SYMBOL_SIZE;
        const centerX = x + (size * SYMBOL_ADVANCE) / 2;
        const centerY = baseline - size * 0.36;
        context.drawImage(
          picture,
          centerX - symbolSize / 2,
          centerY - symbolSize / 2,
          symbolSize,
          symbolSize,
        );
        // Only the symbol's glyph is drawn, so its disc is outlined.
        context.beginPath();
        context.lineWidth = Math.max(1, size * 0.06);
        context.arc(centerX, centerY, symbolSize / 2, 0, 2 * Math.PI);
        context.stroke();
        x += size * SYMBOL_ADVANCE;
      } else {
        context.font = font(weight, size);
        context.fillText(piece.text, x, baseline);
        x += context.measureText(piece.text).width;
      }
    }
    return x;
  };

  // Frame
  context.lineWidth = 0.6 * mm;
  context.beginPath();
  context.roundRect(
    frame.x + 0.3 * mm,
    frame.y + 0.3 * mm,
    frame.width - 0.6 * mm,
    frame.height - 0.6 * mm,
    3 * mm,
  );
  context.stroke();

  // Name and mana cost
  const nameBaseline = inner.top + NAME_ROW * mm * 0.68;
  const cost = parseRules(card.manaCost).flat();
  const costSize = 4.5 * mm;
  const costWidth = cost.reduce((total, word) => total + measure.word(word, costSize), 0);
  const nameWidth = innerWidth - (costWidth ? costWidth + 2 * mm : 0);
  const nameSize = fitLine(context, card.name, 700, 5.5 * mm, nameWidth);
  context.font = font(700, nameSize);
  context.fillText(card.name, inner.left, nameBaseline, nameWidth);
  let costX = inner.right - costWidth;
  for (const word of cost) costX = drawWord(word, costX, nameBaseline, costSize, 700);
  rule(context, inner.left, inner.right, layout.nameBottom, 0.4 * mm);

  // Art box outline; the art itself is dithered separately and pasted in at the end.
  if (layout.art) {
    const { x, y, width: artWidth, height: artHeight } = layout.art;
    context.lineWidth = 0.4 * mm;
    context.strokeRect(x - 0.2 * mm, y - 0.2 * mm, artWidth + 0.4 * mm, artHeight + 0.4 * mm);
  }

  // Type line
  const typeSize = fitLine(context, card.typeLine, 700, 4 * mm, innerWidth);
  context.font = font(700, typeSize);
  context.fillText(card.typeLine, inner.left, layout.typeTop + TYPE_ROW * mm * 0.66, innerWidth);
  rule(context, inner.left, inner.right, layout.typeBottom, 0.4 * mm);

  // Power and toughness
  if (card.stats) {
    const statsSize = 6 * mm;
    const statsHeight = STATS_HEIGHT * mm;
    context.font = font(700, statsSize);
    const statsWidth = context.measureText(card.stats).width + 5 * mm;
    context.lineWidth = 0.6 * mm;
    context.beginPath();
    context.roundRect(
      inner.right - statsWidth,
      inner.bottom - statsHeight,
      statsWidth,
      statsHeight,
      1.5 * mm,
    );
    context.stroke();
    context.textAlign = "center";
    context.fillText(
      card.stats,
      inner.right - statsWidth / 2,
      inner.bottom - statsHeight / 2 + statsSize * 0.36,
    );
    context.textAlign = "start";
  }

  // Rules text
  const fitted = fitRules(
    parseRules(card.rules),
    {
      width: innerWidth,
      height: layout.rulesBottom - layout.rulesTop,
      ...layout.rulesSize,
      lineHeight: LINE_HEIGHT,
    },
    measure.word,
    measure.space,
  );
  const lineStep = fitted.size * LINE_HEIGHT;
  let y = layout.rulesTop;
  for (const lines of fitted.paragraphs) {
    for (const line of lines) {
      y += lineStep;
      let x = inner.left;
      for (const word of line)
        x = drawWord(word, x, y - fitted.size * 0.3, fitted.size, 400) + measure.space(fitted.size);
    }
    y += lineStep / 2;
  }

  const page = thresholdToBitmap(context.getImageData(0, 0, width, height), TEXT_THRESHOLD);
  if (card.art && layout.art)
    pasteBitmap(page, renderArt(card.art, layout.art, tone), layout.art.x, layout.art.y);
  return page;
}

/**
 * The art placed in its box as arranged, never stretched, and dithered like a card image.
 * @param {{ image: ImageBitmap, arrangement: Arrangement }} art
 * @param {Rect} box
 * @param {{ black: number, white: number, gamma: number }} tone
 */
function renderArt({ image, arrangement }, box, tone) {
  const context = canvasContext(box.width, box.height);
  context.fillStyle = "white";
  context.fillRect(0, 0, box.width, box.height);
  const place = placeImage(image, box, arrangement);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, place.x, place.y, place.width, place.height);
  return ditherToBitmap(context.getImageData(0, 0, box.width, box.height), tone);
}

/**
 * @param {OffscreenCanvasRenderingContext2D} context
 * @param {number} from
 * @param {number} to
 * @param {number} y
 * @param {number} thickness
 */
function rule(context, from, to, y, thickness) {
  context.fillRect(from, y - thickness / 2, to - from, thickness);
}
