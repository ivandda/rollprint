/** @import { Design } from "./designs.js" */
import { upgradeTemplate } from "./labels/template.js";
import { localStore } from "./storage.js";

/**
 * @typedef {object} PrintListItem
 * @property {string} id
 * @property {Design} design
 * @property {number} copies
 */

const STORAGE_KEY = "print-list";
export const MAX_COPIES = 20;

/** @param {unknown} value */
export const clampCopies = (value) => Math.min(Math.max(Math.round(Number(value)) || 1, 1), MAX_COPIES);

/** Labels to print together later, saved in this browser. Dispatches "change" after every edit. */
export class PrintList extends EventTarget {
  /** @type {readonly PrintListItem[]} */
  items = [];
  #storage;

  /** @param {Pick<Storage, "getItem" | "setItem">} [storage]  Missing where the browser blocks storage. */
  constructor(storage = localStore()) {
    super();
    this.#storage = storage;
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "[]");
      if (Array.isArray(saved)) this.items = saved.filter(isItem).map(upgraded);
    } catch {
      // A damaged list starts empty.
    }
  }

  /**
   * @param {Design} design
   * @param {number} copies
   */
  add(design, copies) {
    this.#update([...this.items, { id: crypto.randomUUID(), design, copies: clampCopies(copies) }]);
  }

  /**
   * Changes a label already in the list, keeping its place.
   * @param {string} id
   * @param {Design} design
   * @param {number} copies
   * @returns {boolean}  Whether the label was still in the list.
   */
  replace(id, design, copies) {
    if (!this.items.some((item) => item.id === id)) return false;
    this.#update(
      this.items.map((item) => (item.id === id ? { ...item, design, copies: clampCopies(copies) } : item)),
    );
    return true;
  }

  /** @param {string} id */
  remove(id) {
    this.#update(this.items.filter((item) => item.id !== id));
  }

  /**
   * @param {string} id
   * @param {number} copies
   */
  setCopies(id, copies) {
    this.#update(
      this.items.map((item) => (item.id === id ? { ...item, copies: clampCopies(copies) } : item)),
    );
  }

  clear() {
    this.#update([]);
  }

  /** @param {readonly PrintListItem[]} items */
  #update(items) {
    this.items = items;
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage is full or unavailable; the list then lasts for this visit.
    }
    this.dispatchEvent(new Event("change"));
  }
}

/**
 * An item saved before label templates had cells, brought up to date.
 * @param {PrintListItem} item
 * @returns {PrintListItem}
 */
const upgraded = (item) =>
  item.design.type === "label"
    ? { ...item, design: { ...item.design, template: upgradeTemplate(item.design.template) } }
    : item;

/** @param {any} item */
const isItem = (item) =>
  typeof item?.id === "string" && typeof item.design?.type === "string" && Number.isInteger(item.copies);
