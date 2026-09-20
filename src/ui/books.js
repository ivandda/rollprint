/** @import { Book, BookClient } from "../books/client.js" */
/** @import { ShelfBook } from "../books/shelf.js" */
import { coverUrl } from "../books/client.js";
import { addBook, MAX_BOOKS, readShelf, setCount, setHighRes, shelfTotal } from "../books/shelf.js";
import { element, problemMessage, showMessage, showProblem } from "./dom.js";
import { readSetting, writeSetting } from "./settings.js";
import { bindStepper } from "./stepper.js";
import { toast } from "./toast.js";

/**
 * The books whose covers are to be printed, and how many of each, remembered in this browser.
 * Searching asks Open Library; a book is added by picking it from the results. Open Library's own
 * covers stop at 500 pixels tall, so each book can be offered a sharper one from Apple, which is
 * matched on the title and author and has to be looked at before it is accepted.
 * @param {object} options
 * @param {BookClient} options.books
 * @param {(shelf: ShelfBook[]) => void} options.onChange
 * @param {() => void} options.onPreview  Shows the label, on small screens.
 */
export function createBooks({ books, onChange, onPreview }) {
  const ui = {
    form: element("#book-search", HTMLFormElement),
    query: element("#book-query", HTMLInputElement),
    status: element("#book-status", HTMLElement),
    results: element("#book-results", HTMLUListElement),
    resultTemplate: element("#book-result", HTMLTemplateElement),
    shelf: element("#shelf", HTMLUListElement),
    shelfTemplate: element("#shelf-row", HTMLTemplateElement),
    shelfEmpty: element("#shelf-empty", HTMLElement),
    shelfCount: element("#shelf-count", HTMLElement),
    clear: element("#clear-books", HTMLButtonElement),
    preview: element("#preview-books", HTMLButtonElement),
  };

  let shelf = readShelf(readSetting("shelf"));
  /** The search this reply belongs to, so a slow one can't overwrite a newer one. */
  let searching = 0;

  /* Searching */

  ui.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = ui.query.value.trim();
    if (!query) {
      showProblem(ui.status, "Type a title, an author or an ISBN first.");
      ui.query.focus();
      return;
    }
    const attempt = ++searching;
    showMessage(ui.status, "Searching…");
    try {
      const found = await books.search(query);
      if (attempt !== searching) return;
      showResults(found);
      showMessage(ui.status, found.length === 0 ? `No books with a cover match “${query}”.` : "");
    } catch (error) {
      if (attempt !== searching) return;
      ui.results.replaceChildren();
      showProblem(ui.status, problemMessage(error));
    }
  });

  /** @param {Book[]} found */
  function showResults(found) {
    ui.results.replaceChildren(...found.map(resultCard));
  }

  /** @param {Book} book */
  function resultCard(book) {
    const item = /** @type {HTMLElement} */ (ui.resultTemplate.content.firstElementChild?.cloneNode(true));
    const button = /** @type {HTMLButtonElement} */ (item.querySelector("button"));
    const image = /** @type {HTMLImageElement} */ (item.querySelector("img"));
    if (book.cover !== undefined) image.src = coverUrl(book.cover, "M");
    image.alt = "";
    setText(item, ".book-title", book.title);
    setText(item, ".book-author", [book.author, book.year].filter(Boolean).join(" · "));
    button.setAttribute("aria-label", `Add ${book.title}`);
    button.addEventListener("click", () => {
      const next = addBook(shelf, book);
      if (next === shelf) {
        showProblem(ui.status, `That's the most books you can print at once. Remove one to add another.`);
        return;
      }
      update(next);
      toast(`Added ${book.title}.`);
    });
    return item;
  }

  /* The shelf */

  /** @param {ShelfBook} book */
  function shelfRow(book) {
    const row = /** @type {HTMLElement} */ (ui.shelfTemplate.content.firstElementChild?.cloneNode(true));
    const image = /** @type {HTMLImageElement} */ (row.querySelector("img"));
    const title = /** @type {HTMLElement} */ (row.querySelector(".shelf-title"));
    const input = /** @type {HTMLInputElement} */ (row.querySelector("input"));
    const sharper = /** @type {HTMLButtonElement} */ (row.querySelector(".sharper"));
    const remove = /** @type {HTMLButtonElement} */ (row.querySelector(".remove"));
    const offer = /** @type {HTMLElement} */ (row.querySelector(".sharper-offer"));

    image.src = book.highRes ?? (book.cover === undefined ? "" : coverUrl(book.cover, "M"));
    image.alt = "";
    title.textContent = book.title;
    title.id = `shelf-${book.id}`;
    setText(row, ".shelf-author", book.author);
    input.value = String(book.count);
    input.setAttribute("aria-labelledby", title.id);
    remove.setAttribute("aria-label", `Remove ${book.title}`);
    bindStepper(/** @type {HTMLElement} */ (row.querySelector(".stepper")), (count) => {
      update(setCount(shelf, book.id, count));
    });

    remove.addEventListener("click", () => {
      const index = shelf.findIndex((other) => other.id === book.id);
      update(setCount(shelf, book.id, 0));
      // Keep keyboard focus nearby: on the Remove button now in its place, or on the search box.
      const next = ui.shelf.children[Math.min(index, shelf.length - 1)]?.querySelector(".remove");
      (next instanceof HTMLElement ? next : ui.query).focus();
      toast(`Removed ${book.title}.`);
    });

    bindSharper({ book, sharper, offer });
    return row;
  }

  /**
   * The offer of a sharper cover, which is only ever applied by the reader: Apple's search matches
   * on the title and author, and returns its closest guess rather than nothing when it has no copy
   * of the book, so the cover it finds has to be looked at before it is used.
   * @param {object} options
   * @param {ShelfBook} options.book
   * @param {HTMLButtonElement} options.sharper
   * @param {HTMLElement} options.offer
   */
  function bindSharper({ book, sharper, offer }) {
    if (book.highRes) {
      sharper.textContent = "Undo sharper cover";
      sharper.addEventListener("click", () => {
        update(setHighRes(shelf, book.id, undefined));
        toast(`Put back Open Library's cover of ${book.title}.`);
      });
      return;
    }
    sharper.addEventListener("click", async () => {
      sharper.disabled = true;
      sharper.textContent = "Looking…";
      try {
        const found = await books.highResCover(book);
        if (!found) {
          offer.hidden = false;
          offer.textContent = "No sharper cover of this book was found.";
          return;
        }
        showOffer({ book, offer, found });
      } catch (error) {
        offer.hidden = false;
        offer.textContent = problemMessage(error);
      } finally {
        sharper.disabled = false;
        sharper.textContent = "Sharper cover";
      }
    });
  }

  /**
   * @param {object} options
   * @param {ShelfBook} options.book
   * @param {HTMLElement} options.offer
   * @param {{ url: string, title: string, author: string }} options.found
   */
  function showOffer({ book, offer, found }) {
    const image = Object.assign(document.createElement("img"), { src: found.url, alt: "", loading: "lazy" });
    const named = [found.title, found.author].filter(Boolean).join(" · ");
    const text = Object.assign(document.createElement("span"), {
      className: "offer-text",
      // The reader is told which book was matched, because it is often not the one they asked for.
      textContent: named ? `Apple has ${named}. Print this cover instead?` : "Print this cover instead?",
    });
    const use = Object.assign(document.createElement("button"), {
      type: "button",
      className: "text-button",
      textContent: "Use it",
    });
    use.addEventListener("click", () => {
      update(setHighRes(shelf, book.id, found.url));
      toast(`Using the sharper cover of ${book.title}.`);
    });
    const no = Object.assign(document.createElement("button"), {
      type: "button",
      className: "text-button",
      textContent: "No thanks",
    });
    no.addEventListener("click", () => {
      offer.hidden = true;
      offer.replaceChildren();
    });
    offer.hidden = false;
    offer.replaceChildren(image, text, use, no);
  }

  function showShelf() {
    ui.shelf.replaceChildren(...shelf.map(shelfRow));
    const total = shelfTotal(shelf);
    ui.shelf.hidden = shelf.length === 0;
    ui.shelfEmpty.hidden = shelf.length > 0;
    ui.clear.hidden = shelf.length === 0;
    ui.shelfCount.textContent =
      total === 0
        ? ""
        : `${total} ${total === 1 ? "cover" : "covers"}, ${shelf.length} of ${MAX_BOOKS} books`;
  }

  /** @param {ShelfBook[]} next */
  function update(next) {
    shelf = next;
    writeSetting("shelf", shelf);
    showShelf();
    onChange(shelf);
  }

  ui.clear.addEventListener("click", () => {
    update([]);
    ui.query.focus();
  });
  ui.preview.addEventListener("click", onPreview);
  showShelf();

  return {
    current: () => shelf,

    /**
     * Shows a sheet from the print list, so that changing it changes the shelf it was made from.
     * @param {ShelfBook[]} next
     */
    show(next) {
      shelf = readShelf(next);
      writeSetting("shelf", shelf);
      showShelf();
      onChange(shelf);
    },
  };
}

/**
 * @param {HTMLElement} root
 * @param {string} selector
 * @param {string} text
 */
function setText(root, selector, text) {
  const target = root.querySelector(selector);
  if (target) target.textContent = text;
}
