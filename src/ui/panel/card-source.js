/** @import { CardDesign, Darkness } from "../../designs.js" */
/** @import { Media } from "../../printers/types.js" */
/** @import { ScryfallCard, ScryfallClient } from "../../scryfall/client.js" */
/** @import { PanelHooks, Source } from "./source.js" */
import { cardFaces, madeBy, pickCard } from "../../scryfall/client.js";
import { updateAddress } from "../address.js";
import { cardThumbnail, element } from "../dom.js";
import { readSetting, writeSetting } from "../settings.js";

/** The user's own choices, put back after a print list label is done with. */
/** @typedef {{ style: string, cropBorder: boolean, art: boolean }} CardOptions */

/**
 * A Scryfall card on the label: the chosen printing and side, the tokens it makes, and the card
 * image or text style with its options.
 * @param {object} options
 * @param {ScryfallClient} options.scryfall
 * @param {PanelHooks} options.panel
 * @param {(card: ScryfallCard, face: number) => void} options.onCustomize
 * @returns {Source<CardDesign> & {
 *   show: (card: ScryfallCard, face?: number | "both") => void,
 *   resume: () => void,
 *   current: () => ScryfallCard | undefined,
 * }}
 */
export function createCardSource({ scryfall, panel, onCustomize }) {
  const ui = {
    customize: element("#customize", HTMLButtonElement),
    printings: element("#printings", HTMLElement),
    related: element("#related", HTMLElement),
    relatedList: element("#related-list", HTMLUListElement),
    facesField: element("#faces-field", HTMLFieldSetElement),
    faces: element("#faces", HTMLElement),
    bothHint: element("#both-hint", HTMLElement),
    styleField: element("#style-field", HTMLFieldSetElement),
    borderOption: element("#border-option", HTMLElement),
    cropBorder: element("#crop-border", HTMLInputElement),
    artOption: element("#art-option", HTMLElement),
    includeArt: element("#include-art", HTMLInputElement),
    cardName: element("#card-name", HTMLElement),
  };
  const controls = element("#controls", HTMLFormElement);
  const styleChoice = /** @type {RadioNodeList} */ (controls.elements.namedItem("style"));

  /** The chosen printing. @type {ScryfallCard | undefined} */
  let card;
  let face = 0;
  /** Both faces of a double-faced card instead of `face`. */
  let bothSides = false;
  let relatedId = 0;

  const style = () => (styleChoice.value === "text" ? "text" : "image");
  const textStyle = () => style() === "text";

  /**
   * @param {ScryfallCard} next
   * @param {number | "both"} [side]
   */
  function show(next, side = 0) {
    card = next;
    bothSides = side === "both";
    face = side === "both" ? 0 : side;
    ui.printings.replaceChildren();
    showPrinting();
    loadPrintings(next);
    loadRelated(next);
  }

  /** @param {ScryfallCard} shown */
  async function loadPrintings(shown) {
    if (!shown.oracle_id) return;
    try {
      const { data } = await scryfall.search(`oracleid:${shown.oracle_id} game:paper`, {
        unique: "prints",
        order: "released",
      });
      if (card?.oracle_id !== shown.oracle_id) return;
      if (data.length > 1) ui.printings.replaceChildren(...data.map(printingButton));
      markChosenPrinting();
    } catch {
      // Other printings are optional: the card that was picked can still be printed.
    }
  }

  /**
   * Lists the tokens, emblems and game cards the card makes, so they can be opened from here.
   * @param {ScryfallCard} shown
   */
  async function loadRelated(shown) {
    const id = ++relatedId;
    ui.relatedList.replaceChildren();
    panel.refreshOptions();
    const parts = madeBy(shown);
    if (parts.length === 0) return;
    try {
      const { cards } = await scryfall.collection(parts.map((part) => ({ id: part.id })));
      if (id !== relatedId) return;
      ui.relatedList.replaceChildren(...cards.map(relatedItem));
      panel.refreshOptions();
    } catch {
      // The card prints without them.
    }
  }

  /** @param {ScryfallCard} related */
  function relatedItem(related) {
    const button = Object.assign(document.createElement("button"), { type: "button" });
    if (related.type_line) button.title = related.type_line;
    button.append(
      cardThumbnail(related, "small", "related-image"),
      Object.assign(document.createElement("span"), { className: "related-name", textContent: related.name }),
    );
    button.addEventListener("click", () => {
      show(related);
      ui.cardName.focus();
    });
    const item = document.createElement("li");
    item.append(button);
    return item;
  }

  /** @param {ScryfallCard} printing */
  function printingButton(printing) {
    const button = document.createElement("button");
    const description = `${printing.set_name}, #${printing.collector_number}`;
    Object.assign(button, { type: "button", title: description });
    button.dataset.id = printing.id;
    button.setAttribute("aria-label", description);
    button.append(cardThumbnail(printing, "small", "printing-image"));
    button.addEventListener("click", () => {
      card = printing;
      showPrinting();
    });
    return button;
  }

  function markChosenPrinting() {
    for (const button of ui.printings.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.id === card?.id));
    }
  }

  function showPrinting() {
    if (!card) return;
    const faces = cardFaces(card);
    if (!faces[face]) face = 0;
    if (faces.length < 2) bothSides = false;
    /**
     * Sides are named by where they are, which fits the panel; the face's own name is in the tooltip,
     * for screen readers, and in the heading.
     * @param {string} value
     * @param {string} text
     * @param {string} title
     * @param {boolean} checked
     */
    const choice = (value, text, title, checked) => {
      const input = Object.assign(document.createElement("input"), {
        type: "radio",
        name: "face",
        value,
        checked,
      });
      input.setAttribute("aria-label", title);
      const label = Object.assign(document.createElement("label"), { title });
      label.append(input, Object.assign(document.createElement("span"), { textContent: text }));
      return label;
    };
    ui.faces.replaceChildren(
      ...faces.map((side, index) =>
        choice(String(index), index === 0 ? "Front" : "Back", side.name, !bothSides && index === face),
      ),
      ...(faces.length > 1 ? [choice("both", "Both sides", "Both sides", bothSides)] : []),
    );
    markChosenPrinting();
    rememberCard();
    panel.refresh();
  }

  /** Keeps the printing and side in the address, so the page can be bookmarked or shared. */
  function rememberCard() {
    const side = bothSides ? "both" : face ? String(face) : undefined;
    updateAddress({ card: card?.id, face: side });
  }

  ui.customize.addEventListener("click", () => {
    if (card) onCustomize(card, face);
  });

  ui.cropBorder.checked = readSetting("cropBorder") === true;
  styleChoice.value = readSetting("style") === "text" ? "text" : "image";
  ui.includeArt.checked = readSetting("art") === true;

  return {
    type: "card",
    show,
    /** Shows the chosen card again, after the panel showed something else. */
    resume: showPrinting,
    current: () => card,

    design(darkness) {
      if (!card) return undefined;
      return {
        type: "card",
        card: pickCard(card),
        face,
        bothSides,
        style: style(),
        darkness,
        cropBorder: ui.cropBorder.checked,
        art: ui.includeArt.checked,
      };
    },

    heading() {
      if (!card) return { name: "", detail: "" };
      return {
        name: (!bothSides && cardFaces(card)[face]?.name) || card.name,
        detail: `${card.set_name}, #${card.collector_number}`,
      };
    },

    empty: () => !card,

    usesDarkness: () => Boolean(card) && (!textStyle() || ui.includeArt.checked),

    showOptions(active, media) {
      ui.customize.hidden = !active || !card;
      ui.printings.hidden = !active;
      ui.related.hidden = !active || ui.relatedList.childElementCount === 0;
      ui.facesField.hidden = !active || !card || cardFaces(card).length < 2;
      ui.bothHint.hidden = ui.facesField.hidden || !bothSides;
      ui.bothHint.textContent = media.lengthMm
        ? "Each side prints on its own page."
        : "Both sides print on one piece. Fold it on the dashed line.";
      ui.styleField.hidden = !active;
      ui.borderOption.hidden = !active || textStyle();
      ui.artOption.hidden = !active || !textStyle();
    },

    load(saved) {
      styleChoice.value = saved.style === "text" ? "text" : "image";
      ui.cropBorder.checked = saved.cropBorder;
      ui.includeArt.checked = saved.art === true;
      show(saved.card, saved.bothSides ? "both" : saved.face);
    },

    /** @returns {CardOptions} */
    options: () => ({
      style: styleChoice.value,
      cropBorder: ui.cropBorder.checked,
      art: ui.includeArt.checked,
    }),

    restoreOptions(saved) {
      const { style: previousStyle, cropBorder, art } = /** @type {CardOptions} */ (saved);
      styleChoice.value = previousStyle;
      ui.cropBorder.checked = cropBorder;
      ui.includeArt.checked = art;
    },

    changed(target, editing) {
      if (target.name === "face") {
        bothSides = target.value === "both";
        if (!bothSides) face = Number(target.value);
      }
      // A label from the print list carries its own options; they aren't the user's defaults.
      if (!editing) {
        writeSetting("style", style());
        writeSetting("cropBorder", ui.cropBorder.checked);
        writeSetting("art", ui.includeArt.checked);
      }
      rememberCard();
    },
  };
}
