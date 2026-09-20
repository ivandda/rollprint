/** @import { Darkness, Design, Token } from "../designs.js" */
/** @import { MarkerSelection } from "../markers.js" */
/** @import { PrintList, PrintListItem } from "../print-list.js" */
/** @import { PrinterConnection } from "../printers/connection.js" */
/** @import { Bitmap, Media } from "../printers/types.js" */
/** @import { ScryfallCard, ScryfallClient } from "../scryfall/client.js" */
/** @import { Rect } from "./art-arranger.js" */
/**
 * How changing a label from the print list ended: saved, left as it was, the label was already
 * gone, or the panel moved on to something else.
 * @typedef {"saved" | "cancelled" | "gone" | "dropped"} EditResult
 */
/** @import { LabelSize } from "./label-size.js" */
import {
  artBoxOf,
  customKind,
  DARKNESS,
  describeDesign,
  isBlankToken,
  loadArt,
  pageCount,
  renderDesign,
  tokenOf,
} from "../designs.js";
import { cardSize } from "../imaging/card.js";
import { markerTotal } from "../markers.js";
import { clampCopies } from "../print-list.js";
import { cardFaces, madeBy, pickCard } from "../scryfall/client.js";
import { updateAddress } from "./address.js";
import { bindArtArranger } from "./art-arranger.js";
import { cardThumbnail, drawBitmap, element, problemMessage, showProblem } from "./dom.js";
import { preparePrinter } from "./printer-button.js";
import { readSetting, writeSetting } from "./settings.js";
import { bindStepper } from "./stepper.js";
import { toast } from "./toast.js";

/**
 * The label being made, from a card or a custom token: its preview, the print options, and
 * printing it or adding it to the print list.
 * @param {object} options
 * @param {ScryfallClient} options.scryfall
 * @param {PrinterConnection} options.printer
 * @param {LabelSize} options.labelSize
 * @param {PrintList} options.printList
 * @param {(token: Token, fromList: boolean) => void} options.onTokenChange  The token's image was
 *   arranged. `fromList` means it belongs to a label from the print list, not to My cards.
 * @param {(card: ScryfallCard, face: number) => void} options.onCustomize
 * @param {(result: EditResult, id: string) => void} options.onEditEnd  How changing a label ended.
 * @param {() => void} options.openList  Opens the print list, from the toast after adding to it.
 */
export function createLabelPanel({
  scryfall,
  printer,
  labelSize,
  printList,
  onTokenChange,
  onCustomize,
  onEditEnd,
  openList,
}) {
  const ui = {
    label: element("#label", HTMLElement),
    labelWidth: element("#label-width", HTMLElement),
    labelLength: element("#label-length", HTMLElement),
    preview: element("#preview", HTMLCanvasElement),
    arrangeHint: element("#arrange-hint", HTMLElement),
    pages: element("#pages", HTMLElement),
    previousPage: element("#previous-page", HTMLButtonElement),
    nextPage: element("#next-page", HTMLButtonElement),
    pageNumber: element("#page-number", HTMLElement),
    heading: element("#card-heading", HTMLElement),
    cardName: element("#card-name", HTMLElement),
    cardSet: element("#card-set", HTMLElement),
    customize: element("#customize", HTMLButtonElement),
    printings: element("#printings", HTMLElement),
    related: element("#related", HTMLElement),
    relatedList: element("#related-list", HTMLUListElement),
    controls: element("#controls", HTMLFormElement),
    facesField: element("#faces-field", HTMLFieldSetElement),
    faces: element("#faces", HTMLElement),
    bothHint: element("#both-hint", HTMLElement),
    styleField: element("#style-field", HTMLFieldSetElement),
    arrangeFields: element("#arrange-fields", HTMLElement),
    darknessField: element("#darkness-field", HTMLFieldSetElement),
    borderOption: element("#border-option", HTMLElement),
    cropBorder: element("#crop-border", HTMLInputElement),
    artOption: element("#art-option", HTMLElement),
    includeArt: element("#include-art", HTMLInputElement),
    editingScreen: element("#editing-screen", HTMLElement),
    editingWhat: element("#editing-what", HTMLElement),
    cancelTop: element("#cancel-edit-top", HTMLButtonElement),
    saveTop: element("#save-edit-top", HTMLButtonElement),
    cancelEdit: element("#cancel-edit", HTMLButtonElement),
    copiesStepper: element("#copies-stepper", HTMLElement),
    copies: element("#copies", HTMLInputElement),
    addToList: element("#add-to-list", HTMLButtonElement),
    print: element("#print", HTMLButtonElement),
    status: element("#print-status", HTMLElement),
  };
  const darknessChoice = /** @type {RadioNodeList} */ (ui.controls.elements.namedItem("darkness"));
  const styleChoice = /** @type {RadioNodeList} */ (ui.controls.elements.namedItem("style"));

  const state = {
    /** What the label is made from. @type {"card" | "token" | "markers"} */
    source: "card",
    /** The chosen printing. @type {ScryfallCard | undefined} */
    card: undefined,
    face: 0,
    /** Both faces of a double-faced card instead of `face`. */
    bothSides: false,
    /** @type {Token | undefined} */
    token: undefined,
    /** @type {MarkerSelection} */
    markers: { counts: {}, custom: [] },
    /** Every label the design prints on, and the one shown. @type {Bitmap[]} */
    pages: [],
    pageIndex: 0,
    /** The shown label as it will print. @type {Bitmap | undefined} */
    page: undefined,
    /** The token's image and where it is on the label, for arranging it. @type {ImageBitmap | undefined} */
    artImage: undefined,
    /** @type {Rect | undefined} */
    artBox: undefined,
    /** The print list label being changed, if any. @type {string | undefined} */
    editing: undefined,
    printing: false,
  };
  /**
   * The panel's own options and copies, put back when a label from the list is done with.
   * @type {{ copies: string, style: string, darkness: string, cropBorder: boolean, art: boolean } | undefined}
   */
  let previous;
  let renderId = 0;
  let relatedId = 0;
  let arrangeFrame = 0;

  const darkness = () => /** @type {Darkness} */ (darknessChoice.value || "normal");
  const style = () => (styleChoice.value === "text" ? "text" : "image");
  const copies = () => clampCopies(ui.copies.value);

  /** @returns {Design | undefined} */
  function design() {
    if (state.source === "token") {
      return state.token && { ...state.token, type: /** @type {const} */ ("token"), darkness: darkness() };
    }
    if (state.source === "markers") {
      const { counts, custom } = state.markers;
      return { type: "markers", counts, custom: custom.filter(({ id }) => counts[id]) };
    }
    if (!state.card) return undefined;
    return {
      type: "card",
      card: pickCard(state.card),
      face: state.face,
      bothSides: state.bothSides,
      style: style(),
      darkness: darkness(),
      cropBorder: ui.cropBorder.checked,
      art: ui.includeArt.checked,
    };
  }

  /* Cards */

  /**
   * @param {ScryfallCard} card
   * @param {number | "both"} [face]
   */
  function showCard(card, face = 0) {
    state.source = "card";
    state.card = card;
    state.bothSides = face === "both";
    state.face = face === "both" ? 0 : face;
    ui.printings.replaceChildren();
    ui.status.textContent = "";
    showPrinting();
    loadPrintings(card);
    loadRelated(card);
  }

  /** Goes back to the chosen card, if there is one, after making a token. */
  function showCards() {
    if (state.card) {
      state.source = "card";
      showPrinting();
      return;
    }
    showEmpty("card");
  }

  /**
   * A blank label, before a card is picked or while My cards is shown.
   * @param {"card" | "token"} source
   */
  function showEmpty(source) {
    state.source = source;
    state.token = undefined;
    renderId++;
    state.page = undefined;
    state.pages = [];
    state.artBox = undefined;
    ui.label.dataset.state = "empty";
    showPages();
    ui.heading.hidden = true;
    showOptions();
    showArrangeable();
    showLabelSize(labelSize.current);
    updateButtons();
  }

  /** @param {ScryfallCard} card */
  async function loadPrintings(card) {
    if (!card.oracle_id) return;
    try {
      const { data } = await scryfall.search(`oracleid:${card.oracle_id} game:paper`, {
        unique: "prints",
        order: "released",
      });
      if (state.card?.oracle_id !== card.oracle_id) return;
      if (data.length > 1) ui.printings.replaceChildren(...data.map(printingButton));
      markChosenPrinting();
    } catch {
      // Other printings are optional: the card that was picked can still be printed.
    }
  }

  /**
   * Lists the tokens, emblems and game cards the card makes, so they can be opened from here.
   * @param {ScryfallCard} card
   */
  async function loadRelated(card) {
    const id = ++relatedId;
    ui.relatedList.replaceChildren();
    showOptions();
    const parts = madeBy(card);
    if (parts.length === 0) return;
    try {
      const { cards } = await scryfall.collection(parts.map((part) => ({ id: part.id })));
      if (id !== relatedId) return;
      ui.relatedList.replaceChildren(...cards.map(relatedItem));
      showOptions();
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
      showCard(related);
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
      state.card = printing;
      showPrinting();
    });
    return button;
  }

  function markChosenPrinting() {
    for (const button of ui.printings.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.id === state.card?.id));
    }
  }

  function showPrinting() {
    const card = state.card;
    if (!card) return;
    const faces = cardFaces(card);
    if (!faces[state.face]) state.face = 0;
    if (faces.length < 2) state.bothSides = false;
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
      ...faces.map((face, index) =>
        choice(
          String(index),
          index === 0 ? "Front" : "Back",
          face.name,
          !state.bothSides && index === state.face,
        ),
      ),
      ...(faces.length > 1 ? [choice("both", "Both sides", "Both sides", state.bothSides)] : []),
    );
    showHeading();
    showOptions();
    markChosenPrinting();
    rememberCard();
    updatePreview();
  }

  /** Keeps the printing and side in the address, so the page can be bookmarked or shared. */
  function rememberCard() {
    const face = state.bothSides ? "both" : state.face ? String(state.face) : undefined;
    updateAddress({ card: state.card?.id, face });
  }

  /* Tokens */

  /** @param {Token | undefined} token  None while My cards is shown. */
  function showToken(token) {
    if (!token) {
      // My cards is shown: there is no card to change any more.
      if (state.editing) endEdit("dropped");
      showEmpty("token");
      return;
    }
    const sameToken = state.source === "token" && state.token?.id === token.id;
    state.source = "token";
    state.token = token;
    showHeading();
    showOptions();
    updatePreview(sameToken && state.page !== undefined);
  }

  /* Markers */

  /** @param {MarkerSelection} selection */
  function showMarkers(selection) {
    const sameSource = state.source === "markers";
    state.source = "markers";
    state.markers = selection;
    showHeading();
    showOptions();
    updatePreview(sameSource && state.page !== undefined);
  }

  const arranger = bindArtArranger({
    canvas: ui.preview,
    target() {
      const { page, artBox, artImage, token } = state;
      if (state.source !== "token" || !page || !artBox || !artImage || !token?.art) return undefined;
      return { page, box: artBox, image: artImage, arrangement: token.art };
    },
    onArrange(arrangement) {
      if (!state.token?.art) return;
      state.token = { ...state.token, art: { ...state.token.art, ...arrangement } };
      onTokenChange(state.token, Boolean(state.editing));
      cancelAnimationFrame(arrangeFrame);
      arrangeFrame = requestAnimationFrame(() => updatePreview(true));
    },
  });

  /* What is shown */

  function showHeading() {
    ui.heading.hidden = false;
    let name = "";
    if (state.source === "markers") {
      const total = markerTotal(state.markers.counts);
      const sheets = pageCount({ type: "markers", ...state.markers }, labelSize.current);
      name = "Markers";
      ui.cardSet.textContent =
        total === 0
          ? "Pick markers to print"
          : `${total} ${total === 1 ? "marker" : "markers"} on ${sheets} ${sheets === 1 ? "page" : "pages"}`;
    } else if (state.source === "token") {
      name = state.token?.name.trim() || "New card";
      ui.cardSet.textContent = state.token ? customKind(state.token) : "";
    } else if (state.card) {
      name = (!state.bothSides && cardFaces(state.card)[state.face]?.name) || state.card.name;
      ui.cardSet.textContent = `${state.card.set_name}, #${state.card.collector_number}`;
    }
    ui.cardName.textContent = name;
    ui.preview.setAttribute("aria-label", `Preview of ${name}`);
  }

  /** Shows only the options that change the label. */
  function showOptions() {
    const { source } = state;
    const card = source === "card";
    const text = source === "token" || style() === "text";
    const hasArt = source === "token" ? Boolean(state.token?.art) : card && (!text || ui.includeArt.checked);
    ui.customize.hidden = !card || !state.card;
    ui.printings.hidden = !card;
    ui.related.hidden = !card || ui.relatedList.childElementCount === 0;
    ui.facesField.hidden = !card || !state.card || cardFaces(state.card).length < 2;
    ui.bothHint.hidden = ui.facesField.hidden || !state.bothSides;
    ui.bothHint.textContent = labelSize.current.lengthMm
      ? "Each side prints on its own page."
      : "Both sides print on one piece. Fold it on the dashed line.";
    ui.styleField.hidden = !card;
    ui.borderOption.hidden = !card || text;
    ui.artOption.hidden = !card || !text;
    ui.arrangeFields.hidden = !(source === "token" && state.token?.art);
    ui.darknessField.hidden = !hasArt;
  }

  /** Lets the token's image be dragged on the preview, and focused to move it with keys. */
  function showArrangeable() {
    const arrangeable = state.source === "token" && Boolean(state.artBox);
    ui.label.classList.toggle("arrangeable", arrangeable);
    ui.arrangeHint.hidden = !arrangeable;
    if (arrangeable) ui.preview.tabIndex = 0;
    else ui.preview.removeAttribute("tabindex");
    if (arrangeable && state.token?.art) arranger.sync(state.token.art);
  }

  /* Preview */

  /** @param {boolean} [quiet]  Redraw without the loading state, e.g. while the image is moved. */
  async function updatePreview(quiet = false) {
    const current = design();
    if (!current) return;
    const id = ++renderId;
    const media = labelSize.current;
    if (state.source === "markers") showHeading(); // the page count depends on the paper size
    if (!quiet) {
      state.page = undefined;
      state.pages = [];
      state.pageIndex = 0;
      showPages();
      ui.status.textContent = "";
      ui.label.dataset.state = "loading";
    }
    showLabelSize(media);
    updateButtons();

    try {
      const pages = await renderDesign(current, media);
      const artImage = current.type === "token" && current.art ? await loadArt(current.art) : undefined;
      if (id !== renderId) return;
      state.pages = pages;
      state.pageIndex = Math.min(state.pageIndex, pages.length - 1);
      state.page = pages[state.pageIndex];
      state.artImage = artImage;
      state.artBox = artImage ? artBoxOf(current, media) : undefined;
      drawBitmap(ui.preview, state.page);
      ui.label.dataset.state = "ready";
    } catch (error) {
      if (id !== renderId) return;
      state.page = undefined;
      state.pages = [];
      state.artBox = undefined;
      ui.label.dataset.state = "empty";
      showProblem(ui.status, problemMessage(error));
    }
    showArrangeable();
    showPages();
    updateButtons();
  }

  /** Shows previous and next buttons when the design prints on more than one label. */
  function showPages() {
    const count = state.pages.length;
    ui.pages.hidden = count < 2;
    if (count < 2) return;
    const focused = document.activeElement;
    ui.pageNumber.textContent = `Page ${state.pageIndex + 1} of ${count}`;
    ui.previousPage.disabled = state.pageIndex === 0;
    ui.nextPage.disabled = state.pageIndex === count - 1;
    // A button disabled while focused would drop keyboard focus, so it moves to the other one.
    if (focused instanceof HTMLButtonElement && focused.disabled) {
      (focused === ui.nextPage ? ui.previousPage : ui.nextPage).focus();
    }
  }

  /** @param {number} step */
  function turnPage(step) {
    const index = state.pageIndex + step;
    if (!state.pages[index]) return;
    state.pageIndex = index;
    state.page = state.pages[index];
    drawBitmap(ui.preview, state.page);
    showPages();
  }

  /**
   * Labels the dimension lines and gives the blank label the roll's shape.
   * @param {Media} media
   */
  function showLabelSize(media) {
    ui.labelWidth.textContent = `${media.widthMm} mm`;
    ui.labelLength.textContent = media.lengthMm ? `${media.lengthMm} mm` : "continuous";
    ui.label.classList.toggle("continuous", !media.lengthMm);
    ui.label.classList.toggle("round", media.shape === "round");
    if (!state.page) {
      ui.preview.width = media.printableWidth;
      ui.preview.height = media.printableHeight || cardSize(media).height;
    }
  }

  /* Printing */

  async function printLabel() {
    const current = design();
    if (!current || state.printing || state.editing) return;
    ui.status.textContent = "";
    const advice = await preparePrinter(printer);
    if (printer.state.kind !== "ready") {
      showProblem(ui.status, advice.text, advice.link);
      return;
    }

    const { media } = printer.state;
    const count = copies();
    state.printing = true;
    ui.label.classList.add("feeding");
    updateButtons();
    try {
      const pages = await renderDesign(current, media);
      const all = Array.from({ length: count }, () => pages).flat();
      await printer.print(all);
      toast(all.length === 1 ? "Printed." : `Printed ${all.length} pages.`);
    } catch (error) {
      showProblem(ui.status, problemMessage(error));
    } finally {
      state.printing = false;
      ui.label.classList.remove("feeding");
      updateButtons();
    }
  }

  function addToList() {
    const current = design();
    if (!current) return;
    const count = copies();
    if (state.editing) {
      endEdit(printList.replace(state.editing, current, count) ? "saved" : "gone");
      return;
    }
    printList.add(current, count);
    const pages = count * pageCount(current, labelSize.current);
    toast(pages === 1 ? "Added to the print list." : `Added ${pages} pages to the print list.`, {
      text: "Open",
      onClick: openList,
    });
  }

  /**
   * Loads a label from the print list so its options can be changed.
   * @param {PrintListItem} item
   */
  function editItem({ id, design: saved, copies: count }) {
    previous ??= {
      copies: ui.copies.value,
      style: styleChoice.value,
      darkness: darknessChoice.value,
      cropBorder: ui.cropBorder.checked,
      art: ui.includeArt.checked,
    };
    state.editing = id;
    const { name, detail } = describeDesign(saved);
    ui.editingWhat.textContent = detail ? `${name} — ${detail}` : name;
    document.body.dataset.editing = saved.type;
    ui.copies.value = String(count);
    ui.status.textContent = "";
    if (saved.type === "card") {
      styleChoice.value = saved.style === "text" ? "text" : "image";
      darknessChoice.value = saved.darkness;
      ui.cropBorder.checked = saved.cropBorder;
      ui.includeArt.checked = saved.art === true;
      showCard(saved.card, saved.bothSides ? "both" : saved.face);
    } else if (saved.type === "token") {
      darknessChoice.value = saved.darkness;
      showToken(tokenOf(saved));
    } else {
      showMarkers({ counts: saved.counts, custom: saved.custom ?? [] });
    }
    updateButtons();
  }

  /** @param {EditResult} result */
  function endEdit(result) {
    const id = state.editing;
    if (!id) return;
    state.editing = undefined;
    delete document.body.dataset.editing;
    if (previous) {
      // The label's own options and copies belong to it, not to whatever is printed next.
      ui.copies.value = previous.copies;
      styleChoice.value = previous.style;
      darknessChoice.value = previous.darkness;
      ui.cropBorder.checked = previous.cropBorder;
      ui.includeArt.checked = previous.art;
      previous = undefined;
      showOptions();
      if (design()) updatePreview();
    }
    updateButtons();
    onEditEnd(result, id);
  }

  function updateButtons() {
    const count = copies();
    const editing = Boolean(state.editing);
    ui.editingScreen.hidden = !editing;
    ui.cancelEdit.hidden = !editing;
    ui.addToList.textContent = editing ? "Save changes" : "Add to list";
    ui.addToList.classList.toggle("primary", editing);
    // Printing isn't what this screen is for, so Print gives way to Cancel and Save changes.
    ui.print.hidden = editing;
    const nothingToPrint = {
      card: !state.card,
      token: !state.token || isBlankToken(state.token),
      markers: markerTotal(state.markers.counts) === 0,
    }[state.source];
    ui.addToList.disabled = nothingToPrint;
    ui.saveTop.disabled = nothingToPrint;
    if (printer.state.kind === "unsupported") {
      ui.print.disabled = true;
      ui.print.textContent = "Printing needs Chrome or Edge";
      return;
    }
    ui.print.disabled =
      nothingToPrint || !state.page || state.printing || printer.state.kind === "connecting";
    const current = design();
    const pages = count * (current ? pageCount(current, labelSize.current) : 1);
    ui.print.textContent = state.printing ? "Printing…" : pages === 1 ? "Print" : `Print ${pages} pages`;
  }

  /* Events */

  ui.controls.addEventListener("change", (event) => {
    const target = event.target;
    // The label size menu, the copies stepper and the image controls have their own listeners.
    if (!(target instanceof HTMLInputElement) || target === ui.copies || ui.arrangeFields.contains(target))
      return;
    if (target.name === "face") {
      state.bothSides = target.value === "both";
      if (!state.bothSides) state.face = Number(target.value);
    }
    // A label from the print list carries its own options; they aren't the user's defaults.
    if (!state.editing) {
      writeSetting("style", style());
      writeSetting("darkness", darkness());
      writeSetting("cropBorder", ui.cropBorder.checked);
      writeSetting("art", ui.includeArt.checked);
    }
    if (state.source === "card") rememberCard();
    showHeading();
    showOptions();
    updatePreview();
  });

  ui.controls.addEventListener("submit", (event) => {
    event.preventDefault();
    printLabel();
  });

  ui.customize.addEventListener("click", () => {
    if (!state.card) return;
    const { card, face } = state;
    // A card of your own is a new label, so the one in the list is left as it was.
    endEdit("dropped");
    onCustomize(card, face);
  });
  ui.addToList.addEventListener("click", addToList);
  ui.cancelEdit.addEventListener("click", () => endEdit("cancelled"));
  ui.cancelTop.addEventListener("click", () => endEdit("cancelled"));
  ui.saveTop.addEventListener("click", addToList);
  ui.previousPage.addEventListener("click", () => turnPage(-1));
  ui.nextPage.addEventListener("click", () => turnPage(1));
  bindStepper(ui.copiesStepper, updateButtons);

  labelSize.addEventListener("change", () => {
    showOptions();
    if (design()) updatePreview();
    else showLabelSize(labelSize.current);
  });

  printer.addEventListener("change", () => {
    if (printer.state.kind === "ready" && !state.printing) ui.status.textContent = "";
    updateButtons();
  });

  new ResizeObserver(() => {
    if (state.page) drawBitmap(ui.preview, state.page);
  }).observe(ui.preview);

  /* Start */

  const savedDarkness = readSetting("darkness");
  if (typeof savedDarkness === "string" && DARKNESS.includes(savedDarkness))
    darknessChoice.value = savedDarkness;
  ui.cropBorder.checked = readSetting("cropBorder") === true;
  styleChoice.value = readSetting("style") === "text" ? "text" : "image";
  ui.includeArt.checked = readSetting("art") === true;
  showOptions();
  showLabelSize(labelSize.current);
  updateButtons();

  return {
    showCard,
    showCards,
    showMarkers,
    showToken,
    editItem,

    /** Leaves a label from the print list as it was, if one is being changed. */
    cancelEdit: () => endEdit("cancelled"),
    /**
     * @param {string} text
     * @param {{ href: string, text: string }} [link]
     */
    showStatus(text, link) {
      showProblem(ui.status, text, link);
    },
  };
}
