/** @import { Book } from "./client.js" */
import { coverUrl } from "./client.js";

/**
 * The books picked to print and how many of each. The shelf is the catalogue: unlike markers, which
 * are a fixed list with a count each, a book is only on the shelf because it was searched for and
 * chosen, so its count lives with it.
 */

/**
 * @typedef {object} ShelfBook
 * @property {string} id  Open Library's work key.
 * @property {string} title
 * @property {string} author
 * @property {number} [year]
 * @property {number} [cover]  Open Library's cover ID.
 * @property {string} [highRes]  A sharper cover accepted from Apple, printed instead of that one.
 * @property {number} count  How many of this cover to print.
 */

/** @typedef {keyof typeof COVER_SIZES} CoverSize */

/** How many of one book, and how many books, can be on the shelf. */
export const MAX_COPIES = 20;
export const MAX_BOOKS = 40;

/** A cover's height divided by its width. Covers vary; printing them all alike keeps the grid even. */
export const COVER_ASPECT = 1.5;

/**
 * The sizes a cover prints at. `across` is how many fit side by side, so each size divides the
 * label's width exactly and no strip of paper is left blank down the side. "Full label" is the one
 * that fits the label's height too, which is what makes it different from Large on a long label and
 * the only size that fits on a short one.
 */
export const COVER_SIZES = {
  full: { name: "Full label", across: 1, detail: "one cover, as large as the label allows" },
  large: { name: "Large", across: 2, detail: "two across" },
  medium: { name: "Medium", across: 3, detail: "three across" },
  small: { name: "Small", across: 4, detail: "four across" },
};

/**
 * @param {unknown} value
 * @returns {value is CoverSize}
 */
export const isCoverSize = (value) => typeof value === "string" && value in COVER_SIZES;

/**
 * The cover to print for a book: the sharper one if it has been accepted, else Open Library's
 * largest. A book with neither has nothing to print.
 * @param {ShelfBook} book
 * @returns {string | undefined}
 */
export const bookCoverUrl = (book) =>
  book.highRes ?? (book.cover === undefined ? undefined : coverUrl(book.cover, "L"));

/** How many covers the shelf prints in all. @param {ShelfBook[]} shelf */
export const shelfTotal = (shelf) => shelf.reduce((total, book) => total + book.count, 0);

/**
 * The shelf with a book added, or with one more of it when it is already there. A full shelf is
 * returned unchanged, so the caller can tell nothing happened.
 * @param {ShelfBook[]} shelf
 * @param {Book} book
 * @returns {ShelfBook[]}
 */
export function addBook(shelf, book) {
  const existing = shelf.find((other) => other.id === book.id);
  if (existing) return setCount(shelf, book.id, existing.count + 1);
  if (shelf.length >= MAX_BOOKS) return shelf;
  const { id, title, author, year, cover } = book;
  return [...shelf, { id, title, author, year, cover, count: 1 }];
}

/**
 * The shelf with one book's count changed. A count of none takes the book off the shelf.
 * @param {ShelfBook[]} shelf
 * @param {string} id
 * @param {number} count
 * @returns {ShelfBook[]}
 */
export function setCount(shelf, id, count) {
  const wanted = Math.min(Math.max(Math.round(count) || 0, 0), MAX_COPIES);
  if (wanted === 0) return shelf.filter((book) => book.id !== id);
  return shelf.map((book) => (book.id === id ? { ...book, count: wanted } : book));
}

/**
 * The shelf with a sharper cover accepted for one book, or with the one it had put back.
 * @param {ShelfBook[]} shelf
 * @param {string} id
 * @param {string | undefined} url
 * @returns {ShelfBook[]}
 */
export function setHighRes(shelf, id, url) {
  return shelf.map((book) => {
    if (book.id !== id) return book;
    const { highRes: _, ...rest } = book;
    return url ? { ...rest, highRes: url } : rest;
  });
}

/**
 * A shelf from saved or shared data: books with a title and something to print, each counted a
 * whole number of times up to twenty.
 * @param {unknown} value
 * @returns {ShelfBook[]}
 */
export function readShelf(value) {
  if (!Array.isArray(value)) return [];
  /** @type {ShelfBook[]} */
  const shelf = [];
  for (const entry of value) {
    if (typeof entry?.id !== "string" || typeof entry.title !== "string" || !entry.title.trim()) continue;
    if (shelf.some((book) => book.id === entry.id)) continue;
    const cover = typeof entry.cover === "number" && entry.cover > 0 ? entry.cover : undefined;
    const highRes =
      typeof entry.highRes === "string" && isCoverAddress(entry.highRes) ? entry.highRes : undefined;
    if (cover === undefined && highRes === undefined) continue;
    const count = Math.min(Math.max(Math.round(Number(entry.count)) || 0, 1), MAX_COPIES);
    shelf.push({
      id: entry.id,
      title: entry.title.trim(),
      author: typeof entry.author === "string" ? entry.author.trim() : "",
      year: typeof entry.year === "number" ? entry.year : undefined,
      cover,
      highRes,
      count,
    });
    if (shelf.length >= MAX_BOOKS) break;
  }
  return shelf;
}

/**
 * Whether a saved address is one of the cover hosts this app may load, so that data restored from
 * the browser can't point the page somewhere else.
 * @param {string} value
 */
function isCoverAddress(value) {
  try {
    const { protocol, host } = new URL(value);
    return protocol === "https:" && (host === "covers.openlibrary.org" || host.endsWith(".mzstatic.com"));
  } catch {
    return false;
  }
}
