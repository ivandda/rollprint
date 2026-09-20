/** @import { Design } from "../designs.js" */
/** @import { PrintList, PrintListItem } from "../print-list.js" */
/** @import { PrinterConnection } from "../printers/connection.js" */
/** @import { Bitmap, Media } from "../printers/types.js" */
/** @import { LabelSize } from "./label-size.js" */
import { describeDesign, pageCount, paperLength, renderDesign } from "../designs.js";
import { drawBitmap, element, problemMessage, showProblem } from "./dom.js";
import { preparePrinter } from "./printer-button.js";
import { bindStepper } from "./stepper.js";
import { toast } from "./toast.js";

/**
 * The print list, in a side sheet: saved items with their copies, printed together in one job.
 * @param {object} options
 * @param {PrinterConnection} options.printer
 * @param {LabelSize} options.labelSize
 * @param {PrintList} options.printList
 * @param {(item: PrintListItem) => void} options.onEdit  Opens a label's options in the panel.
 */
export function createPrintListDialog({ printer, labelSize, printList, onEdit }) {
  const ui = {
    open: element("#open-list", HTMLButtonElement),
    count: element("#list-count", HTMLElement),
    dialog: element("#print-list", HTMLDialogElement),
    clear: element("#clear-list", HTMLButtonElement),
    close: element("#close-list", HTMLButtonElement),
    empty: element("#list-empty", HTMLElement),
    items: element("#list-items", HTMLUListElement),
    template: element("#list-item", HTMLTemplateElement),
    paper: element("#list-paper", HTMLElement),
    printAll: element("#print-all", HTMLButtonElement),
    status: element("#list-status", HTMLElement),
  };
  /**
   * Rows by item ID, with previews drawn for `rowsMedia`. The design they were built from is kept,
   * so a label changed in the panel gets a new row.
   * @type {Map<string, { row: HTMLElement, design: Design }>}
   */
  const rows = new Map();
  /** @type {Media | undefined} */
  let rowsMedia;
  let printing = false;

  ui.open.addEventListener("click", () => open());

  /** @param {string} [focusId]  A row to return to, after its label was changed. */
  function open(focusId) {
    ui.status.textContent = "";
    ui.dialog.showModal();
    showItems();
    const edit = focusId ? rows.get(focusId)?.row.querySelector(".edit") : undefined;
    if (edit instanceof HTMLElement) {
      edit.scrollIntoView({ block: "nearest" });
      edit.focus();
    }
  }
  ui.close.addEventListener("click", () => ui.dialog.close());
  // A click on the dimmed page around the sheet closes it.
  ui.dialog.addEventListener("click", (event) => {
    if (event.target === ui.dialog) ui.dialog.close();
  });
  ui.clear.addEventListener("click", () => {
    printList.clear();
    ui.close.focus();
  });
  ui.printAll.addEventListener("click", printAll);

  printList.addEventListener("change", () => {
    showCount();
    if (ui.dialog.open) showItems();
  });
  labelSize.addEventListener("change", () => {
    if (ui.dialog.open) showItems();
  });
  printer.addEventListener("change", updatePrintAll);

  function showCount() {
    const count = printList.items.length;
    ui.count.textContent = String(count);
    ui.count.hidden = count === 0;
    ui.open.setAttribute("aria-label", `Print list, ${count} ${count === 1 ? "item" : "items"}`);
  }

  function showItems() {
    const media = labelSize.current;
    if (media !== rowsMedia) {
      rows.clear();
      ui.items.replaceChildren();
      rowsMedia = media;
    }
    for (const [id, { row }] of rows) {
      if (printList.items.some((item) => item.id === id)) continue;
      row.remove();
      rows.delete(id);
    }
    for (const item of printList.items) {
      const shown = rows.get(item.id);
      if (shown && shown.design !== item.design) {
        // The label was changed in the panel: its row is drawn again where it is.
        const row = buildRow(item, media);
        shown.row.replaceWith(row);
        rows.set(item.id, { row, design: item.design });
      } else if (!shown) {
        const row = buildRow(item, media);
        ui.items.append(row);
        rows.set(item.id, { row, design: item.design });
      }
      const copies = /** @type {HTMLInputElement} */ (
        /** @type {{ row: HTMLElement }} */ (rows.get(item.id)).row.querySelector("input")
      );
      if (document.activeElement !== copies) copies.value = String(item.copies);
    }
    ui.empty.hidden = printList.items.length > 0;
    ui.clear.hidden = printList.items.length === 0;
    updatePrintAll();
  }

  /**
   * @param {PrintListItem} item
   * @param {Media} media
   */
  function buildRow(item, media) {
    const row = /** @type {HTMLElement} */ (ui.template.content.firstElementChild?.cloneNode(true));
    /** @param {string} selector */
    const part = (selector) => /** @type {HTMLElement} */ (row.querySelector(selector));
    const { name, detail } = describeDesign(item.design);
    part(".list-name").textContent = name;
    part(".list-detail").textContent = detail;

    const preview = /** @type {HTMLCanvasElement} */ (part("canvas"));
    preview.setAttribute("aria-label", `Preview of ${name}`);
    renderDesign(item.design, media)
      .then(([page]) => drawBitmap(preview, page))
      .catch(() => {
        // The row works without its preview, e.g. while offline.
      });

    bindStepper(part(".stepper"), (copies) => printList.setCopies(item.id, copies));
    const edit = part(".edit");
    edit.setAttribute("aria-label", `Edit ${name}`);
    edit.addEventListener("click", () => {
      ui.dialog.close();
      onEdit(item);
    });

    const remove = part(".remove");
    remove.setAttribute("aria-label", `Remove ${name}`);
    remove.addEventListener("click", () => {
      // Keep keyboard focus in the sheet: on a neighbouring row's Remove button, or on Close.
      const neighbour = (row.nextElementSibling ?? row.previousElementSibling)?.querySelector(".remove");
      (neighbour instanceof HTMLElement ? neighbour : ui.close).focus();
      printList.remove(item.id);
    });

    return row;
  }

  async function printAll() {
    if (printing || printList.items.length === 0) return;
    ui.status.textContent = "";
    const advice = await preparePrinter(printer);
    if (printer.state.kind !== "ready") {
      showProblem(ui.status, advice.text, advice.link);
      return;
    }

    const { media } = printer.state;
    printing = true;
    updatePrintAll();
    try {
      /** @type {Bitmap[]} */
      const pages = [];
      for (const item of printList.items) {
        const rendered = await renderDesign(item.design, media);
        for (let copy = 0; copy < item.copies; copy++) pages.push(...rendered);
      }
      await printer.print(pages);
      toast(pages.length === 1 ? "Printed." : `Printed ${pages.length} pages.`);
    } catch (error) {
      showProblem(ui.status, problemMessage(error));
    } finally {
      printing = false;
      updatePrintAll();
    }
  }

  function updatePrintAll() {
    const media = labelSize.current;
    const pages = printList.items.reduce((sum, item) => sum + item.copies * pageCount(item.design, media), 0);
    // On die-cut labels the page count already says how much of the roll is used.
    ui.paper.hidden = pages === 0 || media.lengthMm > 0;
    if (!ui.paper.hidden) {
      ui.paper.textContent = `Uses about ${formatLength(paperLength(printList.items, media))} of the roll.`;
    }
    if (printer.state.kind === "unsupported") {
      ui.printAll.disabled = true;
      ui.printAll.textContent = "Printing needs Chrome or Edge";
      return;
    }
    ui.printAll.disabled = printing || pages === 0 || printer.state.kind === "connecting";
    ui.printAll.textContent = printing ? "Printing…" : pages === 1 ? "Print 1 page" : `Print ${pages} pages`;
  }

  showCount();

  return { open };
}

/** @param {number} mm */
const formatLength = (mm) =>
  mm < 1000 ? `${Math.max(1, Math.round(mm / 10))} cm` : `${(mm / 1000).toFixed(1)} m`;
