/** @import { Token, TokenArt } from "../designs.js" */
/** @import { PrintList } from "../print-list.js" */
/** @import { ScryfallCard } from "../scryfall/client.js" */
/** @import { LabelSize } from "./label-size.js" */
import { readBackup, writeBackup } from "../backup.js";
import { cardLink, LINK_PARAM, readCardLink } from "../card-link.js";
import { customKind, isBlankToken, renderDesign } from "../designs.js";
import { CENTERED } from "../imaging/arrangement.js";
import { prepareImage } from "../imaging/images.js";
import { cardText, imageUrl } from "../scryfall/client.js";
import { tokenStore } from "../token-store.js";
import { addressParam, updateAddress } from "./address.js";
import { drawBitmap, element, showProblem } from "./dom.js";
import { toast } from "./toast.js";

const SAVE_DELAY_MS = 400;

/** @returns {Token} */
const blankToken = () => ({
  id: crypto.randomUUID(),
  name: "",
  manaCost: "",
  typeLine: "",
  power: "",
  toughness: "",
  rules: "",
});

/** @param {Token} token */
const titleOf = (token) => token.name.trim() || "Untitled card";

/** @param {TokenArt | undefined} art */
const storedImageOf = (art) => (art && "image" in art.source ? art.source.image : undefined);

/**
 * The Create tab: My cards, the custom cards and tokens saved in this browser, and the form for
 * editing one. Cards save themselves as they are edited.
 * @param {object} options
 * @param {PrintList} options.printList  Its labels can use images of cards that were deleted.
 * @param {LabelSize} options.labelSize  For the previews in My cards.
 * @param {(token: Token | undefined) => void} options.onShow  Called whenever the card being edited
 *   changes, and with none when My cards is shown.
 * @param {() => void} options.onPreview  Shows the label, on small screens.
 */
export function createTokenEditor({ printList, labelSize, onShow, onPreview }) {
  const ui = {
    library: element("#card-library", HTMLElement),
    libraryStatus: element("#library-status", HTMLElement),
    newToken: element("#new-token", HTMLButtonElement),
    tokenList: element("#token-list", HTMLUListElement),
    itemTemplate: element("#library-item", HTMLTemplateElement),
    editor: element("#card-editor", HTMLElement),
    toLibrary: element("#to-library", HTMLButtonElement),
    saveState: element("#save-state", HTMLElement),
    form: element("#token-form", HTMLFormElement),
    name: element("#token-name", HTMLInputElement),
    manaCost: element("#token-cost", HTMLInputElement),
    typeLine: element("#token-type", HTMLInputElement),
    power: element("#token-power", HTMLInputElement),
    toughness: element("#token-toughness", HTMLInputElement),
    rules: element("#token-rules", HTMLTextAreaElement),
    imageFile: element("#token-image", HTMLInputElement),
    imageDrop: element("#image-drop", HTMLElement),
    imageEmpty: element("#image-empty", HTMLElement),
    chooseImage: element("#choose-image", HTMLButtonElement),
    imageChosen: element("#image-chosen", HTMLElement),
    replaceImage: element("#replace-image", HTMLButtonElement),
    removeImage: element("#remove-image", HTMLButtonElement),
    status: element("#token-status", HTMLElement),
    preview: element("#preview-token", HTMLButtonElement),
    actions: element("#editor-actions", HTMLElement),
    share: element("#share-token", HTMLButtonElement),
    duplicate: element("#duplicate-token", HTMLButtonElement),
    deleteToken: element("#delete-token", HTMLButtonElement),
    deleteConfirm: element("#delete-confirm", HTMLElement),
    deleteQuestion: element("#delete-question", HTMLElement),
    confirmDelete: element("#confirm-delete", HTMLButtonElement),
    cancelDelete: element("#cancel-delete", HTMLButtonElement),
    backUp: element("#back-up", HTMLButtonElement),
    restore: element("#restore", HTMLButtonElement),
    restoreFirst: element("#restore-first", HTMLButtonElement),
    restoreFile: element("#restore-file", HTMLInputElement),
  };

  /** Saved cards, by name. @type {Token[]} */
  let saved = [];
  /** The card in the form, which is shown unless My cards is. */
  let token = blankToken();
  let editing = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let saveTimer;
  let canSave = true;

  const isSaved = () => saved.some((other) => other.id === token.id);

  /* Form */

  ui.form.addEventListener("submit", (event) => event.preventDefault());
  ui.form.addEventListener("input", (event) => {
    if (event.target === ui.imageFile) return;
    token = {
      ...token,
      name: ui.name.value,
      manaCost: ui.manaCost.value.trim(),
      typeLine: ui.typeLine.value,
      power: ui.power.value.trim(),
      toughness: ui.toughness.value.trim(),
      rules: ui.rules.value,
    };
    changed();
  });
  ui.preview.addEventListener("click", onPreview);

  /* Image */

  ui.chooseImage.addEventListener("click", () => ui.imageFile.click());
  ui.replaceImage.addEventListener("click", () => ui.imageFile.click());
  ui.imageFile.addEventListener("change", () => {
    const [file] = ui.imageFile.files ?? [];
    ui.imageFile.value = "";
    if (file) useImage(file);
  });

  ui.imageDrop.addEventListener("dragover", (event) => {
    event.preventDefault();
    ui.imageDrop.classList.add("dragging");
  });
  ui.imageDrop.addEventListener("dragleave", () => ui.imageDrop.classList.remove("dragging"));
  ui.imageDrop.addEventListener("drop", (event) => {
    event.preventDefault();
    ui.imageDrop.classList.remove("dragging");
    const [file] = event.dataTransfer?.files ?? [];
    if (file) useImage(file);
  });

  document.addEventListener("paste", (event) => {
    const file = [...(event.clipboardData?.files ?? [])].find((pasted) => pasted.type.startsWith("image/"));
    if (document.body.dataset.mode !== "create" || !editing || !file) return;
    event.preventDefault();
    useImage(file);
  });

  ui.removeImage.addEventListener("click", () => {
    const removed = token.art;
    token = { ...token, art: undefined };
    changed();
    releaseImage(removed);
    toast("Image removed.");
    ui.chooseImage.focus();
  });

  /** @param {File} file */
  async function useImage(file) {
    if (!file.type.startsWith("image/")) {
      showProblem(ui.status, "That file isn't an image. Choose a JPEG, PNG or WebP image.");
      return;
    }
    ui.status.textContent = "Adding the image…";
    let image;
    try {
      image = await prepareImage(file);
    } catch {
      showProblem(ui.status, "This image can't be opened here. Choose a JPEG, PNG or WebP image.");
      return;
    }
    let id;
    try {
      id = await tokenStore.saveImage(image);
    } catch {
      showProblem(ui.status, "This browser can't save images, so the image can't be added.");
      return;
    }
    const replaced = token.art;
    token = { ...token, art: { ...CENTERED, source: { image: id } } };
    ui.status.textContent = "";
    changed();
    releaseImage(replaced);
  }

  /**
   * Deletes a saved image once no card and no label in the print list uses it.
   * @param {TokenArt | undefined} art
   */
  function releaseImage(art) {
    const id = storedImageOf(art);
    if (id && !imagesInUse().has(id)) tokenStore.deleteImage(id).catch(() => {});
  }

  function imagesInUse() {
    const fromCards = [token, ...saved].map((other) => storedImageOf(other.art));
    const fromList = printList.items.map(({ design }) =>
      design.type === "token" ? storedImageOf(design.art) : undefined,
    );
    return new Set([...fromCards, ...fromList]);
  }

  /* Saving */

  function changed() {
    showImage();
    onShow(token);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  /** Saves the card, unless it's still blank. My cards has it straight away, even if storage fails. */
  async function save() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const current = token;
    // A card that was never saved isn't worth saving while it's still blank; one that was saved is
    // kept as the user left it, rather than reverting to what it used to say.
    if (isBlankToken(current) && !saved.some((other) => other.id === current.id)) return;
    saved = byName([...saved.filter((other) => other.id !== current.id), current]);
    showActions();
    if (!canSave) return;
    try {
      await tokenStore.save(current);
    } catch {
      canSave = false;
      showProblem(ui.status, "This browser can't save your cards, so they last until the page is closed.");
      showActions();
    }
  }

  function saveNow() {
    if (saveTimer !== undefined) save();
  }

  // Closing the tab inside the save delay would lose the last edit, so it is written on the way out.
  addEventListener("pagehide", saveNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveNow();
  });

  /* My cards */

  ui.newToken.addEventListener("click", () => {
    edit(blankToken());
    ui.name.focus();
  });

  ui.toLibrary.addEventListener("click", () => {
    const shown = token.id;
    showLibrary();
    const button = [...ui.tokenList.querySelectorAll("button")].find((item) => item.dataset.id === shown);
    (button ?? ui.newToken).focus();
  });

  labelSize.addEventListener("change", () => {
    if (!ui.library.hidden) showList();
  });

  /** @param {string} [problem]  e.g. what a restored backup was missing. */
  function showLibrary(problem) {
    saveNow();
    editing = false;
    ui.editor.hidden = true;
    ui.library.hidden = false;
    if (problem) showProblem(ui.libraryStatus, problem);
    else ui.libraryStatus.textContent = "";
    showList();
    onShow(undefined);
  }

  function showList() {
    const media = labelSize.current;
    ui.tokenList.replaceChildren(
      ...saved.map((other) => {
        const item = /** @type {HTMLElement} */ (ui.itemTemplate.content.firstElementChild?.cloneNode(true));
        const button = /** @type {HTMLButtonElement} */ (item.querySelector("button"));
        const stats = other.power || other.toughness ? `${other.power}/${other.toughness}` : "";
        /** @type {HTMLElement} */ (item.querySelector(".library-name")).textContent = titleOf(other);
        /** @type {HTMLElement} */ (item.querySelector(".library-detail")).textContent = [
          other.typeLine.trim() || customKind(other),
          stats,
        ]
          .filter(Boolean)
          .join(" · ");
        button.dataset.id = other.id;
        button.addEventListener("click", () => {
          edit(other);
          ui.name.focus();
        });
        const preview = /** @type {HTMLCanvasElement} */ (item.querySelector("canvas"));
        renderDesign({ ...other, type: "token", darkness: "normal" }, media)
          .then(([page]) => drawBitmap(preview, page))
          .catch(() => {
            // The card can be opened without its preview.
          });
        return item;
      }),
    );
  }

  /* Editing */

  /** @param {Token} next */
  function edit(next) {
    saveNow();
    token = next;
    editing = true;
    ui.name.value = next.name;
    ui.manaCost.value = next.manaCost ?? "";
    ui.typeLine.value = next.typeLine;
    ui.power.value = next.power;
    ui.toughness.value = next.toughness;
    ui.rules.value = next.rules;
    ui.status.textContent = "";
    delete ui.status.dataset.tone;
    ui.library.hidden = true;
    ui.editor.hidden = false;
    showImage();
    showActions();
    onShow(token);
  }

  function showImage() {
    ui.imageEmpty.hidden = Boolean(token.art);
    ui.imageChosen.hidden = !token.art;
  }

  /** @param {boolean} [confirmingDelete] */
  function showActions(confirmingDelete = false) {
    ui.toLibrary.hidden = saved.length === 0;
    ui.restoreFirst.hidden = saved.length > 0;
    ui.saveState.textContent = !isSaved() ? "" : canSave ? "Saved in this browser" : "Not saved";
    ui.actions.hidden = confirmingDelete || !isSaved();
    ui.deleteConfirm.hidden = !confirmingDelete;
    ui.deleteQuestion.textContent = `Delete ${titleOf(token)}?`;
  }

  ui.duplicate.addEventListener("click", () => {
    saveNow();
    const original = token;
    edit({ ...original, id: crypto.randomUUID() });
    save();
    ui.status.textContent = `This is a copy of ${titleOf(original)}. Change what you need.`;
    ui.name.focus();
  });

  /* Links */

  ui.share.addEventListener("click", async () => {
    saveNow();
    const link = cardLink(token, `${location.origin}${location.pathname}`);
    const leftOut = storedImageOf(token.art)
      ? " It leaves out the image you added, which stays on this device."
      : "";
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copied.");
      ui.status.textContent = `Opening the link adds a copy of ${titleOf(token)} to My cards.${leftOut}`;
    } catch {
      const field = Object.assign(document.createElement("input"), {
        className: "link-field",
        value: link,
        readOnly: true,
      });
      field.setAttribute("aria-label", `Link to ${titleOf(token)}`);
      ui.status.replaceChildren(`Copy this link to share ${titleOf(token)}.${leftOut}`, field);
      field.select();
    }
  });

  /**
   * Opens a card from a shared link, adding it to My cards unless it's there already.
   * @param {string} value  The link's parameter.
   */
  function openShared(value) {
    const shared = readCardLink(value);
    if (!shared) {
      const message = "This card link is damaged. Ask for the link again.";
      if (saved.length > 0) {
        showLibrary(message);
      } else {
        edit(blankToken());
        showProblem(ui.status, message);
      }
      return;
    }
    const existing = saved.find((other) => other.id === shared.id);
    edit(existing ?? shared);
    if (existing) {
      ui.status.textContent = `${titleOf(existing)} is already in My cards.`;
    } else {
      save();
      toast(`Added ${titleOf(shared)} to My cards.`);
    }
  }

  ui.deleteToken.addEventListener("click", () => {
    showActions(true);
    ui.cancelDelete.focus();
  });
  ui.cancelDelete.addEventListener("click", () => {
    showActions();
    ui.deleteToken.focus();
  });
  ui.confirmDelete.addEventListener("click", async () => {
    const deleted = token;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    saved = saved.filter((other) => other.id !== deleted.id);
    toast(`Deleted ${titleOf(deleted)}.`);
    if (saved.length > 0) {
      showLibrary();
      ui.newToken.focus();
    } else {
      edit(blankToken());
      ui.name.focus();
    }
    await tokenStore.delete(deleted.id).catch(() => {});
    releaseImage(deleted.art);
  });

  /* Backups */

  ui.backUp.addEventListener("click", backUp);
  ui.restore.addEventListener("click", () => ui.restoreFile.click());
  ui.restoreFirst.addEventListener("click", () => ui.restoreFile.click());
  ui.restoreFile.addEventListener("change", () => {
    const [file] = ui.restoreFile.files ?? [];
    ui.restoreFile.value = "";
    if (file) restore(file);
  });

  /** Downloads a file with every saved card and the images added to them. */
  async function backUp() {
    saveNow();
    /** @type {Map<string, import("../backup.js").BackupImage>} */
    const images = new Map();
    for (const card of saved) {
      const id = storedImageOf(card.art);
      if (!id || images.has(id)) continue;
      const blob = await tokenStore.getImage(id).catch(() => undefined);
      if (blob instanceof Blob) {
        images.set(id, { type: blob.type || "image/webp", bytes: new Uint8Array(await blob.arrayBuffer()) });
      }
    }
    const file = new Blob([writeBackup(saved, images)], { type: "application/json" });
    const link = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(file),
      download: `my-cards-${new Date().toISOString().slice(0, 10)}.json`,
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast(
      saved.length === 1 ? "Downloaded a backup of 1 card." : `Downloaded a backup of ${saved.length} cards.`,
    );
  }

  /**
   * Adds the cards in a backup to My cards, leaving out the ones already here.
   * @param {File} file
   */
  async function restore(file) {
    const status = editing ? ui.status : ui.libraryStatus;
    let backup;
    try {
      backup = readBackup(await file.text());
    } catch (error) {
      showProblem(status, error instanceof Error ? error.message : String(error));
      return;
    }
    if (!canSave) {
      showProblem(status, "This browser can't save your cards, so the backup can't be restored here.");
      return;
    }
    const added = backup.cards.filter((card) => !saved.some((other) => other.id === card.id));
    const already = backup.cards.length - added.length;
    let written = 0;
    try {
      for (const card of added) {
        const id = storedImageOf(card.art);
        const image = id && backup.images.get(id);
        if (id && image) await tokenStore.putImage(id, new Blob([image.bytes], { type: image.type }));
        await tokenStore.save(card);
        saved = byName([...saved, card]);
        written++;
      }
    } catch {
      // Whatever was written is already in My cards, so it is shown rather than left hidden.
      showLibrary(
        written === 0
          ? "This browser couldn't save the cards from the backup."
          : `Restored ${written} of ${added.length} cards; this browser couldn't save the rest.`,
      );
      return;
    }
    if (backup.cards.length === 0) {
      showProblem(status, "This backup has no cards.");
      return;
    }
    const restored = added.length === 1 ? "Restored 1 card." : `Restored ${added.length} cards.`;
    const skipped = already === 1 ? "1 was already in My cards." : `${already} were already in My cards.`;
    showLibrary();
    toast(
      added.length === 0
        ? "Every card in this backup is already in My cards."
        : already
          ? `${restored} ${skipped}`
          : restored,
    );
    ui.newToken.focus();
  }

  /** @param {Token[]} tokens */
  const byName = (tokens) => tokens.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));

  /* Start: a card from a shared link, My cards, or a blank card when there are none. */

  const linked = addressParam(LINK_PARAM);
  // Reloading the page shouldn't add the card again.
  if (linked !== null) updateAddress({ [LINK_PARAM]: undefined });

  tokenStore.list().then(
    async (tokens) => {
      // A card made before the list loaded, e.g. with Customize, is already in `saved`.
      saved = byName([
        ...tokens.filter((stored) => !saved.some((other) => other.id === stored.id)),
        ...saved,
      ]);
      if (linked !== null) openShared(linked);
      else if (editing) showActions();
      else if (saved.length > 0) showLibrary();
      else edit(blankToken());
      // Remove images left behind, e.g. by labels removed from the print list after their card was deleted.
      const inUse = imagesInUse();
      for (const id of await tokenStore.imageIds()) {
        if (!inUse.has(id)) tokenStore.deleteImage(id).catch(() => {});
      }
    },
    () => {
      canSave = false;
      if (linked !== null) openShared(linked);
      else if (!editing) edit(blankToken());
    },
  );

  return {
    /** The card being edited, or none while My cards is shown. */
    current: () => (editing ? token : undefined),

    /**
     * Keeps a change made outside the form, such as arranging the image on the label.
     * @param {Token} next
     * @param {{ save?: boolean }} [options]  A label from the print list is not saved to My cards.
     */
    update(next, { save: keep = true } = {}) {
      token = next;
      if (!keep) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, SAVE_DELAY_MS);
    },

    /**
     * Opens a card in the editor, such as one from the print list, saved here or not.
     * @param {Token} next
     */
    show(next) {
      edit(next);
    },

    /**
     * Starts a new card from a Scryfall card's text and art.
     * @param {ScryfallCard} card
     * @param {number} face
     */
    createFrom(card, face) {
      const text = cardText(card, face);
      const art = imageUrl(card, face, "art_crop");
      edit({
        id: crypto.randomUUID(),
        name: text.name,
        manaCost: text.manaCost,
        typeLine: text.typeLine,
        power: text.power,
        toughness: text.toughness,
        rules: text.rules,
        art: art ? { ...CENTERED, source: { url: art } } : undefined,
      });
      save();
    },
  };
}
