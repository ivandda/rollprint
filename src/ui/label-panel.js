/** @import { Darkness, Design, LabelDesign, Token } from "../designs.js" */
/** @import { MarkerSelection } from "../markers.js" */
/** @import { PrintList, PrintListItem } from "../print-list.js" */
/** @import { PrinterConnection } from "../printers/connection.js" */
/** @import { Bitmap, Media } from "../printers/types.js" */
/** @import { ScryfallCard, ScryfallClient } from "../scryfall/client.js" */
/** @import { Sources } from "./panel/source.js" */
/**
 * How changing a label from the print list ended: saved, left as it was, the label was already
 * gone, or the panel moved on to something else.
 * @typedef {"saved" | "cancelled" | "gone" | "dropped"} EditResult
 */
/** @import { LabelSize } from "./label-size.js" */
import { DARKNESS, describeDesign, pageCount, renderDesign } from "../designs.js";
import { cardSize } from "../imaging/card.js";
import { clampCopies } from "../print-list.js";
import { drawBitmap, element, problemMessage, showProblem } from "./dom.js";
import { createCardSource } from "./panel/card-source.js";
import { createLabelSource } from "./panel/label-source.js";
import { createMarkersSource } from "./panel/markers-source.js";
import { createTokenSource } from "./panel/token-source.js";
import { preparePrinter } from "./printer-button.js";
import { readSetting, writeSetting } from "./settings.js";
import { bindStepper } from "./stepper.js";
import { toast } from "./toast.js";

/**
 * The label being made: its preview, the print options every label shares, and printing it or
 * adding it to the print list. What the label is made from is one of the sources in ./panel.
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
    pages: element("#pages", HTMLElement),
    previousPage: element("#previous-page", HTMLButtonElement),
    nextPage: element("#next-page", HTMLButtonElement),
    pageNumber: element("#page-number", HTMLElement),
    heading: element("#card-heading", HTMLElement),
    cardName: element("#card-name", HTMLElement),
    cardSet: element("#card-set", HTMLElement),
    controls: element("#controls", HTMLFormElement),
    darknessField: element("#darkness-field", HTMLFieldSetElement),
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

  const state = {
    /** What the label is made from. @type {Design["type"]} */
    source: "card",
    /** Every label the design prints on, and the one shown. @type {Bitmap[]} */
    pages: [],
    pageIndex: 0,
    /** The shown label as it will print. @type {Bitmap | undefined} */
    page: undefined,
    /** The print list label being changed, if any. @type {string | undefined} */
    editing: undefined,
    printing: false,
  };
  /**
   * The panel's own options and copies, put back when a label from the list is done with.
   * @type {{ copies: string, darkness: string, sources: Record<string, unknown> } | undefined}
   */
  let previous;
  let renderId = 0;

  const panel = {
    /** @param {{ quiet?: boolean }} [options] */
    refresh({ quiet = false } = {}) {
      showHeading();
      showOptions();
      updatePreview(quiet);
    },
    refreshOptions: () => showOptions(),
    /** @param {Design["type"]} type */
    isActive: (type) => state.source === type,
    hasPage: () => state.page !== undefined,
    isEditing: () => Boolean(state.editing),
  };
  const card = createCardSource({
    scryfall,
    panel,
    onCustomize(chosen, face) {
      // A card of your own is a new label, so the one in the list is left as it was.
      endEdit("dropped");
      onCustomize(chosen, face);
    },
  });
  const token = createTokenSource({ panel, page: () => state.page, onChange: onTokenChange });
  const markers = createMarkersSource({ panel });
  const label = createLabelSource({ panel });
  /** @type {Sources} */
  const sources = { card, token, markers, label };
  const active = () => sources[state.source];

  const darkness = () => /** @type {Darkness} */ (darknessChoice.value || "normal");
  const copies = () => clampCopies(ui.copies.value);
  const design = () => active().design(darkness());

  /* What is shown */

  /**
   * @param {ScryfallCard} chosen
   * @param {number | "both"} [face]
   */
  function showCard(chosen, face = 0) {
    state.source = "card";
    ui.status.textContent = "";
    card.show(chosen, face);
  }

  /** Goes back to the chosen card, if there is one, after making a token. */
  function showCards() {
    state.source = "card";
    if (card.current()) card.resume();
    else showEmpty();
  }

  /** @param {Token | undefined} next  None while My cards is shown. */
  function showToken(next) {
    if (!next) {
      // My cards is shown: there is no card to change any more.
      if (state.editing) endEdit("dropped");
      state.source = "token";
      token.clear();
      showEmpty();
      return;
    }
    state.source = "token";
    token.show(next);
  }

  /** @param {MarkerSelection} selection */
  function showMarkers(selection) {
    state.source = "markers";
    markers.show(selection);
  }

  /**
   * @param {LabelDesign | undefined} design  None while there is no template to fill.
   * @param {{ sample?: boolean }} [options]  A template being designed, shown with sample values.
   */
  function showLabel(design, options) {
    if (state.editing && (!design || options?.sample)) endEdit("dropped");
    state.source = "label";
    if (design) {
      label.show(design, options);
      return;
    }
    label.clear();
    showEmpty();
  }

  /** A blank label, before a card is picked or while My cards is shown. */
  function showEmpty() {
    renderId++;
    state.page = undefined;
    state.pages = [];
    ui.label.dataset.state = "empty";
    showPages();
    ui.heading.hidden = true;
    showOptions();
    showLabelSize(labelSize.current);
    updateButtons();
  }

  function showHeading() {
    ui.heading.hidden = false;
    const { name, detail } = active().heading(labelSize.current);
    ui.cardName.textContent = name;
    ui.cardSet.textContent = detail;
    ui.preview.setAttribute("aria-label", `Preview of ${name}`);
  }

  /** Shows only the options that change the label. */
  function showOptions() {
    const media = labelSize.current;
    for (const source of Object.values(sources)) source.showOptions(source === active(), media);
    ui.darknessField.hidden = !active().usesDarkness();
  }

  /* Preview */

  /** @param {boolean} [quiet]  Redraw without the loading state, e.g. while the image is moved. */
  async function updatePreview(quiet = false) {
    const current = design();
    if (!current) return;
    const source = active();
    const id = ++renderId;
    const media = labelSize.current;
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
      // The design came from this very source, whichever one it is.
      await /** @type {(design: Design, media: Media) => Promise<void>} */ (source.rendered ?? noop)(
        current,
        media,
      );
      if (id !== renderId) return;
      state.pages = pages;
      state.pageIndex = Math.min(state.pageIndex, pages.length - 1);
      state.page = pages[state.pageIndex];
      drawBitmap(ui.preview, state.page);
      ui.label.dataset.state = "ready";
    } catch (error) {
      if (id !== renderId) return;
      state.page = undefined;
      state.pages = [];
      ui.label.dataset.state = "empty";
      showProblem(ui.status, problemMessage(error));
    }
    showOptions();
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
      darkness: darknessChoice.value,
      sources: Object.fromEntries(Object.entries(sources).map(([type, source]) => [type, source.options()])),
    };
    state.editing = id;
    const { name, detail } = describeDesign(saved);
    ui.editingWhat.textContent = detail ? `${name} — ${detail}` : name;
    document.body.dataset.editing = saved.type;
    ui.copies.value = String(count);
    ui.status.textContent = "";
    if ("darkness" in saved) darknessChoice.value = saved.darkness;
    state.source = saved.type;
    /** @type {(design: Design) => void} */ (sources[saved.type].load)(saved);
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
      darknessChoice.value = previous.darkness;
      for (const [type, source] of Object.entries(sources)) source.restoreOptions(previous.sources[type]);
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
    const nothingToPrint = active().empty();
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
    if (!(target instanceof HTMLInputElement) || target === ui.copies || target.closest("#arrange-fields"))
      return;
    // A label from the print list carries its own options; they aren't the user's defaults.
    if (!state.editing) writeSetting("darkness", darkness());
    active().changed?.(target, Boolean(state.editing));
    panel.refresh();
  });

  ui.controls.addEventListener("submit", (event) => {
    event.preventDefault();
    printLabel();
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
  showOptions();
  showLabelSize(labelSize.current);
  updateButtons();

  return {
    showCard,
    showCards,
    showMarkers,
    showToken,
    showLabel,
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

const noop = async () => {};
