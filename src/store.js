/** @import { Token } from "./designs.js" */
/** @import { LabelTemplate } from "./labels/template.js" */
import { upgradeTemplate } from "./labels/template.js";

/** Named before the app was; renaming it would lose what people saved. */
const DATABASE = "mtg-thermal-printer";
const VERSION = 2;

/** @type {Promise<IDBDatabase> | undefined} */
let opening;

/** @type {Map<string, Promise<ImageBitmap>>} */
const bitmaps = new Map();

function database() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const { objectStoreNames: existing } = request.result;
      if (!existing.contains("tokens")) request.result.createObjectStore("tokens", { keyPath: "id" });
      if (!existing.contains("images")) request.result.createObjectStore("images");
      if (!existing.contains("templates")) request.result.createObjectStore("templates", { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      // A newer build in another tab wants to upgrade: letting go lets it, and the next call reopens.
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(
        new Error("Another tab of this page is holding what you saved. Close it, then reload this one."),
      );
  });
  opening.catch(() => {
    opening = undefined;
  });
  return opening;
}

/**
 * @template T
 * @param {"tokens" | "images" | "templates"} name
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest<T>} operation
 * @returns {Promise<T>}
 */
async function run(name, mode, operation) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(name, mode);
    const request = operation(transaction.objectStore(name));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Storage that fills up or is taken away aborts the transaction without failing the request,
    // which would otherwise leave this promise pending for good.
    transaction.onabort = () => reject(transaction.error ?? new Error("The browser stopped saving"));
  });
}

/** Custom cards and tokens and the images added to them, saved in this browser's IndexedDB. */
export const tokenStore = {
  /** @returns {Promise<Token[]>} */
  list: () => run("tokens", "readonly", (store) => store.getAll()),

  /** @param {Token} token */
  save: (token) => run("tokens", "readwrite", (store) => store.put(token)),

  /** @param {string} id */
  delete: (id) => run("tokens", "readwrite", (store) => store.delete(id)),

  /**
   * @param {Blob} image
   * @returns {Promise<string>}  The image's ID.
   */
  async saveImage(image) {
    const id = crypto.randomUUID();
    await run("images", "readwrite", (store) => store.put(image, id));
    return id;
  },

  /**
   * @param {string} id
   * @returns {Promise<Blob | undefined>}
   */
  getImage: (id) => run("images", "readonly", (store) => store.get(id)),

  /**
   * Saves an image under a known ID, e.g. from a backup.
   * @param {string} id
   * @param {Blob} image
   */
  putImage: (id, image) => run("images", "readwrite", (store) => store.put(image, id)),

  /** @returns {Promise<string[]>} */
  imageIds: () => run("images", "readonly", (store) => store.getAllKeys()).then((keys) => keys.map(String)),

  /** @param {string} id */
  deleteImage(id) {
    bitmaps.delete(id);
    return run("images", "readwrite", (store) => store.delete(id));
  },
};

/** Label templates of your own, saved in this browser's IndexedDB. */
export const templateStore = {
  /** Every saved template, those from before templates had cells brought up to date. @returns {Promise<LabelTemplate[]>} */
  list: async () => (await run("templates", "readonly", (store) => store.getAll())).map(upgradeTemplate),

  /** @param {LabelTemplate} template */
  save: (template) => run("templates", "readwrite", (store) => store.put(template)),

  /** @param {string} id */
  delete: (id) => run("templates", "readwrite", (store) => store.delete(id)),
};

/**
 * A saved image, decoded for drawing.
 * @param {string} id
 */
export function loadStoredImage(id) {
  let bitmap = bitmaps.get(id);
  if (!bitmap) {
    bitmap = run("images", "readonly", (store) => store.get(id)).then((blob) => {
      if (!(blob instanceof Blob)) throw new Error("This card's image is no longer saved in this browser.");
      return createImageBitmap(blob);
    });
    bitmaps.set(id, bitmap);
    bitmap.catch(() => bitmaps.delete(id));
  }
  return bitmap;
}
