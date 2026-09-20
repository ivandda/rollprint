/** @import { BookDesign } from "../../designs.js" */
/** @import { CoverSize, ShelfBook } from "../../books/shelf.js" */
/** @import { Media } from "../../printers/types.js" */
/** @import { PanelHooks, Source } from "./source.js" */
import { COVER_SIZES, isCoverSize, shelfTotal } from "../../books/shelf.js";
import { pageCount } from "../../designs.js";
import { element } from "../dom.js";
import { readSetting, writeSetting } from "../settings.js";

/**
 * Book covers on the label, at one of the sizes they print at. The size is the only choice the
 * sheet has: the covers themselves, and how many of each, are picked in the Books tab.
 * @param {object} options
 * @param {PanelHooks} options.panel
 * @returns {Source<BookDesign> & { show: (shelf: ShelfBook[]) => void }}
 */
export function createBookSource({ panel }) {
  const ui = {
    sizeField: element("#cover-size-field", HTMLFieldSetElement),
    size: element("#cover-size", HTMLSelectElement),
  };
  /** @type {ShelfBook[]} */
  let shelf = [];

  const saved = readSetting("coverSize");
  ui.size.value = isCoverSize(saved) ? saved : "full";
  /** @returns {CoverSize} */
  const size = () => (isCoverSize(ui.size.value) ? ui.size.value : "full");

  /** @param {BookDesign["darkness"]} darkness */
  const design = (darkness) => /** @type {BookDesign} */ ({ type: "book", shelf, size: size(), darkness });

  /** @param {ShelfBook[]} next */
  function show(next) {
    const same = panel.isActive("book");
    shelf = next;
    panel.refresh({ quiet: same && panel.hasPage() });
  }

  ui.size.addEventListener("change", () => {
    if (!panel.isEditing()) writeSetting("coverSize", ui.size.value);
    panel.refresh();
  });

  return {
    type: "book",
    show,
    design,

    heading(/** @type {Media} */ media) {
      const total = shelfTotal(shelf);
      if (total === 0) return { name: "Book covers", detail: "Pick books to print" };
      const pages = pageCount(design("normal"), media);
      const covers = `${total} ${total === 1 ? "cover" : "covers"}`;
      return {
        name: total === 1 ? "Book cover" : "Book covers",
        detail: `${covers} on ${pages} ${pages === 1 ? "page" : "pages"}, ${COVER_SIZES[size()].detail}`,
      };
    },

    empty: () => shelfTotal(shelf) === 0,
    // Covers are photographs, so how dark they print makes a real difference to them.
    usesDarkness: () => true,

    showOptions(active) {
      ui.sizeField.hidden = !active;
    },

    load(design) {
      ui.size.value = isCoverSize(design.size) ? design.size : "full";
      show(design.shelf);
    },

    options: () => ui.size.value,
    restoreOptions(saved) {
      if (isCoverSize(saved)) ui.size.value = saved;
    },
  };
}
