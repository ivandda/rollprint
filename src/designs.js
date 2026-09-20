/** @import { Arrangement } from "./imaging/arrangement.js" */
/** @import { LabelTemplate, Values } from "./labels/template.js" */
/** @import { Marker } from "./markers.js" */
/** @import { TextCard } from "./imaging/text-card.js" */
/** @import { Bitmap, Media } from "./printers/types.js" */
/** @import { ScryfallCard } from "./scryfall/client.js" */
import { CENTERED } from "./imaging/arrangement.js";
import { canvasContext } from "./imaging/canvas-text.js";
import { cardSize, renderCard, TONES } from "./imaging/card.js";
import { foldedPage, foldMargin } from "./imaging/fold.js";
import { loadFonts } from "./imaging/fonts.js";
import { loadImage } from "./imaging/images.js";
import { labelLength, renderLabel } from "./imaging/label-render.js";
import { layoutMarkers, renderMarkers } from "./imaging/marker-sheet.js";
import { loadSymbols } from "./imaging/symbols.js";
import { layoutTextCard, renderTextCard, textMeasure } from "./imaging/text-card.js";
import { firstValue, imageIdsOf } from "./labels/template.js";
import { allMarkers } from "./markers.js";
import { cardFaces, cardText, imageUrl } from "./scryfall/client.js";
import { loadStoredImage } from "./store.js";

/**
 * What a label shows, as plain data: enough to draw it again on any label size, and to save it with
 * the print list.
 * @typedef {CardDesign | TokenDesign | MarkersDesign | LabelDesign} Design
 */

/**
 * @typedef {object} CardDesign
 * @property {"card"} type
 * @property {ScryfallCard} card  The chosen printing.
 * @property {number} face
 * @property {boolean} [bothSides]  Both faces of a double-faced card: on one piece to fold on a
 *   continuous roll, otherwise on a label each. `face` is then ignored.
 * @property {"image" | "text"} [style]  Card image when missing, as saved before text style existed.
 * @property {Darkness} darkness
 * @property {boolean} cropBorder  Card image: leave out the black border.
 * @property {boolean} [art]  Text: include the art.
 */

/**
 * A custom card, as saved in this browser. Without a mana cost it's a token.
 * @typedef {object} Token
 * @property {string} id
 * @property {string} name
 * @property {string} [manaCost]  e.g. "{2}{G}". Missing on tokens saved before cards had one.
 * @property {string} typeLine
 * @property {string} power
 * @property {string} toughness
 * @property {string} rules
 * @property {TokenArt} [art]
 */

/**
 * A token's image, and how it is arranged in the art box. It is either an image the user added,
 * saved in this browser under an ID, or art from Scryfall.
 * @typedef {Arrangement & { source: { image: string } | { url: string } }} TokenArt
 */

/** @typedef {Token & { type: "token", darkness: Darkness }} TokenDesign */

/**
 * The custom card inside a label's design, without how the label prints it.
 * @param {TokenDesign} design
 * @returns {Token}
 */
export function tokenOf({ id, name, manaCost, typeLine, power, toughness, rules, art }) {
  return { id, name, manaCost, typeLine, power, toughness, rules, art };
}

/**
 * Markers packed onto as few labels as they need. `custom` has the markers typed in that are counted.
 * @typedef {{ type: "markers", counts: Record<string, number>, custom?: Marker[] }} MarkersDesign
 */

/**
 * A template of your own, filled in: one label for each set of values. The template is kept with
 * the label, so the label stays as it was even if the template changes or goes.
 * @typedef {{ type: "label", template: LabelTemplate, rows: Values[], darkness?: Darkness }} LabelDesign
 */

/** @typedef {keyof typeof TONES} Darkness */

/** @typedef {(typeof TONES)[Darkness]} Tone */

export const DARKNESS = Object.keys(TONES);

/**
 * Draws a design for a label size. Most designs fill one label; markers can continue onto more.
 * @param {Design} design
 * @param {Media} media
 * @returns {Promise<Bitmap[]>}
 */
export async function renderDesign(design, media) {
  if (design.type === "markers") {
    await loadFonts();
    return renderMarkers(design.counts, media, design.custom);
  }
  if (design.type === "label") {
    const [images] = await Promise.all([
      loadTemplateImages(design.template),
      loadFonts(design.template.font),
    ]);
    const tone = TONES[design.darkness ?? "normal"];
    return design.rows.map((values) => renderLabel(design.template, values, media, { images, tone }));
  }

  const tone = TONES[design.darkness];
  if (design.type === "token") {
    const art = design.art && { image: await loadArt(design.art), arrangement: design.art };
    const text = {
      name: design.name,
      manaCost: design.manaCost ?? "",
      typeLine: design.typeLine,
      rules: design.rules,
      stats: statsOf(design),
    };
    return [await renderText({ ...text, art }, media, tone)];
  }

  if (!printsBothSides(design)) return [await renderFace(design, design.face, media, tone)];
  const [front, back] = await Promise.all([0, 1].map((face) => renderFace(design, face, media, tone)));
  return media.lengthMm ? [front, back] : [foldedPage(front, back, media)];
}

/**
 * One of the labels a design prints on, without drawing the others.
 * @param {Design} design
 * @param {Media} media
 * @param {number} index
 * @returns {Promise<Bitmap>}
 */
export async function renderPage(design, media, index) {
  if (design.type === "label") {
    const [page] = await renderDesign({ ...design, rows: [design.rows[index]] }, media);
    return page;
  }
  return (await renderDesign(design, media))[index];
}

/**
 * @param {CardDesign} design
 * @param {number} face
 * @param {Media} media
 * @param {Tone} tone
 */
async function renderFace(design, face, media, tone) {
  const { card } = design;
  if (design.style === "text") {
    const artUrl = design.art ? imageUrl(card, face, "art_crop") : undefined;
    const art = artUrl ? { image: await loadImage(artUrl), arrangement: CENTERED } : undefined;
    const { name, manaCost, typeLine, rules, stats } = cardText(card, face);
    return renderText({ name, manaCost, typeLine, rules, stats, art }, media, tone);
  }

  // The PNG is larger than the print head is wide and has no JPEG blur on small text.
  const url = imageUrl(card, face, "png") ?? imageUrl(card, face);
  if (!url) throw new Error(`Scryfall has no image of ${card.name}.`);
  const image = await loadImage(url);
  return renderCard(image, media, {
    tone,
    cropBorder: design.cropBorder && card.border_color !== "borderless",
  });
}

/**
 * Whether a design prints both faces of a double-faced card.
 * @param {Design} design
 * @returns {boolean}
 */
export const printsBothSides = (design) =>
  design.type === "card" && Boolean(design.bothSides) && cardFaces(design.card).length > 1;

/**
 * How long each label a design prints on is, in dots, without drawing it.
 * @param {Design} design
 * @param {Media} media
 */
export function labelLengths(design, media) {
  if (design.type === "markers") {
    return layoutMarkers(design.counts, media, design.custom).map((page) => page.height);
  }
  if (design.type === "label") {
    return design.rows.map((values) => labelLength(design.template, values, media));
  }
  const length = media.printableHeight || cardSize(media).height;
  if (!printsBothSides(design)) return [length];
  return media.lengthMm ? [length, length] : [2 * (length + foldMargin(media))];
}

/**
 * How many labels a design prints on, without drawing it.
 * @param {Design} design
 * @param {Media} media
 */
export function pageCount(design, media) {
  if (design.type === "label") return design.rows.length;
  return labelLengths(design, media).length;
}

/**
 * About how much paper labels take on a continuous roll, in millimetres: every copy of every label,
 * with the blank paper fed at its ends.
 * @param {readonly { design: Design, copies: number }[]} items
 * @param {Media} media
 */
export function paperLength(items, media) {
  const margins = 2 * (media.feedMargin ?? 0);
  let dots = 0;
  for (const { design, copies } of items) {
    for (const length of labelLengths(design, media)) dots += copies * (length + margins);
  }
  return (dots * 25.4) / media.dpi;
}

/**
 * @param {TextCard} card
 * @param {Media} media
 * @param {Tone} tone
 */
async function renderText(card, media, tone) {
  const [symbols] = await Promise.all([loadSymbols(`${card.manaCost} ${card.rules}`), loadFonts()]);
  return renderTextCard(card, media, { tone, symbols });
}

/**
 * A template's images, decoded, by ID. One that is no longer saved is left out, so the label still
 * prints without it.
 * @param {LabelTemplate} template
 */
export async function loadTemplateImages(template) {
  const ids = [...new Set(imageIdsOf(template))];
  const loaded = await Promise.all(ids.map((id) => loadStoredImage(id).catch(() => undefined)));
  return new Map(ids.flatMap((id, i) => (loaded[i] ? [[id, loaded[i]]] : [])));
}

/**
 * A token's image, decoded.
 * @param {TokenArt} art
 */
export function loadArt(art) {
  return "url" in art.source ? loadImage(art.source.url) : loadStoredImage(art.source.image);
}

/**
 * Where a token's image goes on the label, so it can be arranged there. Call it once the design has
 * been drawn, so the typeface is loaded and text is measured as it was drawn.
 * @param {Design} design
 * @param {Media} media
 */
export function artBoxOf(design, media) {
  if (design.type !== "token" || !design.art) return undefined;
  const measure = textMeasure(canvasContext(1, 1));
  return layoutTextCard({ rules: design.rules, stats: statsOf(design), hasArt: true }, media, measure).art;
}

/**
 * Whether a token has nothing on it yet.
 * @param {Token} token
 */
export function isBlankToken(token) {
  const { name, manaCost, typeLine, power, toughness, rules, art } = token;
  return !name.trim() && !manaCost && !typeLine.trim() && !power && !toughness && !rules.trim() && !art;
}

/**
 * "Custom card", or "Custom token" when it has no mana cost.
 * @param {Token} token
 */
export const customKind = (token) => (token.manaCost ? "Custom card" : "Custom token");

/** @param {{ power: string, toughness: string }} token */
const statsOf = ({ power, toughness }) => (power || toughness ? `${power}/${toughness}` : "");

/**
 * A name and a short description of the choices made, e.g. for the print list.
 * @param {Design} design
 */
export function describeDesign(design) {
  if (design.type === "label") {
    const { template, rows } = design;
    const detail = rows.length === 1 ? firstValue(template, rows[0]) : `${rows.length} labels`;
    return { name: template.name.trim() || "Untitled template", detail };
  }
  if (design.type === "markers") {
    const chosen = allMarkers(design.custom ?? [])
      .filter(({ id }) => design.counts[id])
      .map(({ id, name }) => (design.counts[id] > 1 ? `${name} ×${design.counts[id]}` : name));
    const detail =
      chosen.length > 3
        ? `${chosen.slice(0, 3).join(", ")} and ${chosen.length - 3} more`
        : chosen.join(", ");
    return { name: "Markers", detail };
  }
  if (design.type === "token") {
    const details = [customKind(design)];
    if (design.art && design.darkness !== "normal") details.push(design.darkness);
    return { name: design.name.trim() || "Untitled card", detail: details.join(", ") };
  }
  const { card, face, style, darkness, cropBorder, art } = design;
  const both = printsBothSides(design);
  const details = [`${card.set_name}, #${card.collector_number}`];
  if (both) details.push("both sides");
  if (style === "text") details.push(art ? "text with art" : "text");
  else if (cropBorder) details.push("no border");
  if (darkness !== "normal" && (style !== "text" || art)) details.push(darkness);
  return { name: (!both && cardFaces(card)[face]?.name) || card.name, detail: details.join(", ") };
}
