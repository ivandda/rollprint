/** @import { LabelDesign } from "../../designs.js" */
/** @import { Block, ImageBlock, LabelTemplate, Row, TextSize } from "../../labels/template.js" */
/** @import { LabelSize } from "../label-size.js" */
import { FONTS, loadFonts } from "../../imaging/fonts.js";
import { prepareImage } from "../../imaging/images.js";
import { AUTO_LENGTH_MM } from "../../imaging/label-layout.js";
import { renderLabel } from "../../imaging/label-render.js";
import { STARTERS } from "../../labels/starters.js";
import {
  BARCODE_HEIGHTS,
  barcodeBlock,
  fieldsOf,
  IMAGE_WIDTHS,
  imageBlock,
  imageIdsOf,
  qrBlock,
  sampleValues,
  TEXT_SIZES,
  textBlock,
} from "../../labels/template.js";
import {
  LINK_PARAM,
  readTemplateFile,
  readTemplateLink,
  templateLink,
  writeTemplateFile,
} from "../../labels/template-file.js";
import { templateStore, tokenStore } from "../../store.js";
import { addressParam, updateAddress } from "../address.js";
import { drawBitmap, element, showProblem } from "../dom.js";
import { toast } from "../toast.js";

const SAVE_DELAY_MS = 400;
const MOST_BLOCKS_IN_A_ROW = 3;

/** What a new row or block starts as. */
const NEW_BLOCKS = /** @type {const} */ ({
  text: { name: "Text", make: () => textBlock({ text: "{Text}" }) },
  image: { name: "Image", make: () => /** @type {Block} */ (imageBlock()) },
  qr: { name: "QR code", make: () => /** @type {Block} */ (qrBlock()) },
  barcode: { name: "Barcode", make: () => /** @type {Block} */ (barcodeBlock()) },
  divider: { name: "Divider", make: () => /** @type {Block} */ ({ type: "divider", weight: "thin" }) },
  space: { name: "Space", make: () => /** @type {Block} */ ({ type: "space", size: "m" }) },
});

/** @returns {LabelTemplate} */
const blankTemplate = () => ({
  id: crypto.randomUUID(),
  name: "",
  orientation: "landscape",
  border: "none",
  margin: "m",
  rows: [{ blocks: [textBlock({ text: "{Text}", size: "fit", align: "center", bold: true })] }],
});

/** @param {LabelTemplate} template */
const titleOf = (template) => template.name.trim() || "Untitled template";

/**
 * The Templates tab: My templates, saved in this browser, and the designer for one. Templates save
 * themselves as they are edited.
 * @param {object} options
 * @param {LabelSize} options.labelSize  For the previews in My templates.
 * @param {(design: LabelDesign | undefined) => void} options.onShow  The template being designed
 *   changed, or none while My templates is shown.
 * @param {(templates: LabelTemplate[]) => void} options.onSaved  My templates changed.
 * @param {(template: LabelTemplate) => void} options.onPrint  Fill in and print this template.
 * @param {() => void} options.onPreview  Shows the label, on small screens.
 */
export function createTemplatesView({ labelSize, onShow, onSaved, onPrint, onPreview }) {
  const ui = {
    library: element("#template-library", HTMLElement),
    libraryStatus: element("#template-library-status", HTMLElement),
    newTemplate: element("#new-template", HTMLButtonElement),
    savedList: element("#saved-templates", HTMLUListElement),
    starterList: element("#starter-templates", HTMLUListElement),
    itemTemplate: element("#library-item", HTMLTemplateElement),
    editor: element("#template-editor", HTMLElement),
    toLibrary: element("#to-templates", HTMLButtonElement),
    saveState: element("#template-save-state", HTMLElement),
    form: element("#template-form", HTMLFormElement),
    name: element("#template-name", HTMLInputElement),
    lengthField: element("#length-field", HTMLFieldSetElement),
    lengthMm: element("#template-length-mm", HTMLInputElement),
    rows: element("#template-rows", HTMLElement),
    addRow: element("#add-row", HTMLElement),
    status: element("#template-status", HTMLElement),
    preview: element("#preview-template", HTMLButtonElement),
    actions: element("#template-actions", HTMLElement),
    print: element("#print-template", HTMLButtonElement),
    duplicate: element("#duplicate-template", HTMLButtonElement),
    exportTemplate: element("#export-template", HTMLButtonElement),
    link: element("#link-template", HTMLButtonElement),
    importTemplate: element("#import-template", HTMLButtonElement),
    importFile: element("#template-file", HTMLInputElement),
    deleteTemplate: element("#delete-template", HTMLButtonElement),
    deleteConfirm: element("#template-delete-confirm", HTMLElement),
    deleteQuestion: element("#template-delete-question", HTMLElement),
    confirmDelete: element("#confirm-delete-template", HTMLButtonElement),
    cancelDelete: element("#cancel-delete-template", HTMLButtonElement),
    imageFile: element("#template-image-file", HTMLInputElement),
  };
  const choice = {
    orientation: /** @type {RadioNodeList} */ (ui.form.elements.namedItem("orientation")),
    border: /** @type {RadioNodeList} */ (ui.form.elements.namedItem("border")),
    margin: /** @type {RadioNodeList} */ (ui.form.elements.namedItem("margin")),
    length: /** @type {RadioNodeList} */ (ui.form.elements.namedItem("length")),
    font: element("#template-font", HTMLSelectElement),
  };

  /** Saved templates, by name. @type {LabelTemplate[]} */
  let saved = [];
  /** The template in the designer, shown unless My templates is. */
  let template = blankTemplate();
  let editing = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let saveTimer;
  let canSave = true;

  const isSaved = () => saved.some((other) => other.id === template.id);
  /** @returns {LabelDesign} */
  const design = () => ({ type: "label", template, rows: [sampleValues(template)] });

  /* The template's own settings */

  ui.form.addEventListener("submit", (event) => event.preventDefault());
  ui.form.addEventListener("input", (event) => {
    const target = event.target;
    if (
      !(
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
    )
      return;
    if (target.closest("#template-rows")) {
      blockInput(target);
      return;
    }
    const fixed = choice.length.value === "fixed";
    const typed = Number(ui.lengthMm.value);
    const lengthMm = Math.min(Math.max(typed, AUTO_LENGTH_MM.min), AUTO_LENGTH_MM.max);
    template = {
      ...template,
      name: ui.name.value,
      orientation: choice.orientation.value === "portrait" ? "portrait" : "landscape",
      border: /** @type {LabelTemplate["border"]} */ (choice.border.value || "none"),
      margin: /** @type {LabelTemplate["margin"]} */ (choice.margin.value || "m"),
      lengthMm: fixed && typed > 0 ? lengthMm : undefined,
      font: /** @type {LabelTemplate["font"]} */ (choice.font.value in FONTS ? choice.font.value : "sans"),
    };
    ui.lengthMm.disabled = !fixed;
    changed();
  });

  // The length field shows the limit it was kept to, once it is left.
  ui.lengthMm.addEventListener("change", () => {
    if (template.lengthMm) ui.lengthMm.value = String(template.lengthMm);
  });

  /* Rows and blocks */

  /** The row and block an input belongs to. @param {Element} target */
  const placeOf = (target) => {
    const holder = target.closest("[data-row]");
    return {
      row: Number(holder instanceof HTMLElement ? holder.dataset.row : -1),
      block: Number(
        target.closest("[data-block]") instanceof HTMLElement
          ? /** @type {HTMLElement} */ (target.closest("[data-block]")).dataset.block
          : -1,
      ),
    };
  };

  /**
   * Keeps what was typed into a block's controls, without redrawing the rows, so typing goes on.
   * @param {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} target
   */
  function blockInput(target) {
    const { row, block } = placeOf(target);
    const current = template.rows[row]?.blocks[block];
    if (!current) return;
    const setting = target.dataset.setting ?? target.name;
    /** @type {Block} */
    let next;
    const value =
      target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value;
    next = /** @type {Block} */ ({ ...current, [setting]: value });
    updateBlock(row, block, () => next);
  }

  /**
   * @param {number} row
   * @param {number} block
   * @param {(block: Block) => Block} change
   */
  function updateBlock(row, block, change) {
    const rows = template.rows.map((other, index) =>
      index === row ? { blocks: other.blocks.map((b, i) => (i === block ? change(b) : b)) } : other,
    );
    template = { ...template, rows };
    changed();
  }

  /** @param {Row[]} rows */
  function setRows(rows) {
    template = { ...template, rows };
    showRows();
    changed();
  }

  function showRows() {
    ui.rows.replaceChildren(...template.rows.map(rowElement));
    ui.rows.hidden = template.rows.length === 0;
  }

  /**
   * @param {Row} row
   * @param {number} index
   */
  function rowElement(row, index) {
    const holder = Object.assign(document.createElement("div"), { className: "template-row" });
    holder.dataset.row = String(index);
    const blocks = Object.assign(document.createElement("div"), { className: "row-blocks" });
    blocks.append(
      ...row.blocks.map((block, position) => blockElement(block, index, position, row.blocks.length)),
    );
    const tools = Object.assign(document.createElement("div"), { className: "row-tools" });
    const label = Object.assign(document.createElement("span"), {
      className: "row-label",
      textContent: `Row ${index + 1}`,
    });
    tools.append(
      label,
      tool("Move up", "↑", index === 0, () => setRows(moved(template.rows, index, index - 1))),
      tool("Move down", "↓", index === template.rows.length - 1, () =>
        setRows(moved(template.rows, index, index + 1)),
      ),
      ...(row.blocks.length < MOST_BLOCKS_IN_A_ROW ? [addBesideMenu(index)] : []),
      tool("Remove row", "Remove", false, () => setRows(template.rows.filter((_, i) => i !== index))),
    );
    holder.append(tools, blocks);
    return holder;
  }

  /** @param {number} row */
  function addBesideMenu(row) {
    const holder = Object.assign(document.createElement("span"), { className: "add-beside" });
    holder.append(
      Object.assign(document.createElement("span"), { className: "add-label", textContent: "Add beside:" }),
      ...Object.values(NEW_BLOCKS).map(({ name, make }) =>
        tool(`Add ${name.toLowerCase()} beside`, name, false, () => {
          const rows = template.rows.map((other, i) =>
            i === row ? { blocks: [...other.blocks, make()] } : other,
          );
          setRows(rows);
        }),
      ),
    );
    return holder;
  }

  /**
   * @param {Block} block
   * @param {number} row
   * @param {number} position
   * @param {number} count  Blocks in the row.
   */
  function blockElement(block, row, position, count) {
    const holder = Object.assign(document.createElement("div"), { className: "template-block" });
    holder.dataset.block = String(position);
    const head = Object.assign(document.createElement("div"), { className: "block-head" });
    head.append(
      Object.assign(document.createElement("span"), {
        className: "block-kind",
        textContent: NEW_BLOCKS[block.type].name,
      }),
      tool("Move left", "←", position === 0, () => swapBlocks(row, position, position - 1)),
      tool("Move right", "→", position === count - 1, () => swapBlocks(row, position, position + 1)),
      tool("Remove block", "×", false, () => {
        const rows = template.rows
          .map((other, i) => (i === row ? { blocks: other.blocks.filter((_, b) => b !== position) } : other))
          .filter((other) => other.blocks.length > 0);
        setRows(rows);
      }),
    );
    holder.append(head, ...blockControls(block, row, position));
    return holder;
  }

  /**
   * @param {number} row
   * @param {number} from
   * @param {number} to
   */
  function swapBlocks(row, from, to) {
    setRows(template.rows.map((other, i) => (i === row ? { blocks: moved(other.blocks, from, to) } : other)));
  }

  /**
   * @param {Block} block
   * @param {number} row
   * @param {number} position
   * @returns {HTMLElement[]}
   */
  function blockControls(block, row, position) {
    const id = `block-${row}-${position}`;
    if (block.type === "divider") {
      return [labelled("Line", id, select(["thin", "thick"], ["Thin", "Thick"], block.weight, "weight"))];
    }
    if (block.type === "space") {
      return [
        labelled("Height", id, select(["s", "m", "l"], ["Small", "Medium", "Large"], block.size, "size")),
      ];
    }
    if (block.type === "image") return imageControls(block, row, position, id);
    const widths = /** @type {(keyof typeof IMAGE_WIDTHS)[]} */ (Object.keys(IMAGE_WIDTHS));
    if (block.type === "qr") {
      const content = Object.assign(document.createElement("input"), {
        name: "content",
        value: block.content,
        autocomplete: "off",
        placeholder: "A link or text, e.g. {Link}",
      });
      const widthNames = widths.map((w) => IMAGE_WIDTHS[w].name);
      return [
        pair(
          labelled("Content", `${id}-content`, content),
          labelled("Takes", `${id}-width`, select(widths, widthNames, block.width, "width")),
        ),
      ];
    }
    if (block.type === "barcode") {
      const content = Object.assign(document.createElement("input"), {
        name: "content",
        value: block.content,
        autocomplete: "off",
        placeholder: "Letters and digits, e.g. {Code}",
      });
      const heights = /** @type {(keyof typeof BARCODE_HEIGHTS)[]} */ (Object.keys(BARCODE_HEIGHTS));
      const caption = document.createElement("label");
      caption.className = "checkbox";
      caption.append(
        Object.assign(document.createElement("input"), {
          type: "checkbox",
          name: "text",
          checked: block.text,
        }),
        "Text under it",
      );
      return [
        pair(
          labelled("Content", `${id}-content`, content),
          labelled(
            "Height",
            `${id}-height`,
            select(heights, ["Small", "Medium", "Large"], block.height, "height"),
          ),
        ),
        caption,
      ];
    }
    const sizes = /** @type {TextSize[]} */ (Object.keys(TEXT_SIZES));
    const names = sizes.map((size) => TEXT_SIZES[size].name);
    const heading = Object.assign(document.createElement("input"), {
      name: "heading",
      value: block.heading,
      autocomplete: "off",
      placeholder: "Optional, above the text",
    });
    const text = Object.assign(document.createElement("textarea"), {
      name: "text",
      value: block.text,
      rows: 2,
    });
    const align = document.createElement("div");
    align.className = "segmented small";
    for (const [value, name] of [
      ["start", "Left"],
      ["center", "Centre"],
      ["end", "Right"],
    ]) {
      const label = document.createElement("label");
      // Each block's radios are their own group.
      const input = Object.assign(document.createElement("input"), {
        type: "radio",
        name: `align-${row}-${position}`,
        value,
        checked: block.align === value,
      });
      input.dataset.setting = "align";
      label.append(input, Object.assign(document.createElement("span"), { textContent: name }));
      align.append(label);
    }
    const bold = document.createElement("label");
    bold.className = "checkbox";
    bold.append(
      Object.assign(document.createElement("input"), { type: "checkbox", name: "bold", checked: block.bold }),
      "Bold",
    );
    return [
      pair(
        labelled("Heading", `${id}-heading`, heading),
        labelled("Size", `${id}-heading-size`, select(sizes, names, block.headingSize, "headingSize")),
      ),
      pair(
        labelled("Text", `${id}-text`, text),
        labelled("Size", `${id}-text-size`, select(sizes, names, block.size, "size")),
      ),
      pair(align, bold),
    ];
  }

  /**
   * @param {ImageBlock} block
   * @param {number} row
   * @param {number} position
   * @param {string} id
   * @returns {HTMLElement[]}
   */
  function imageControls(block, row, position, id) {
    const drop = Object.assign(document.createElement("div"), { className: "image-drop block-image" });
    const choose = Object.assign(document.createElement("button"), {
      type: "button",
      className: "button small",
      textContent: block.image ? "Replace image" : "Choose image",
    });
    choose.addEventListener("click", () => {
      pendingImage = { row, position };
      ui.imageFile.click();
    });
    const words = Object.assign(document.createElement("p"), {
      textContent: block.image ? "Image added. Drop another here to replace it." : "Drop an image here, or",
    });
    drop.append(words, choose);
    if (block.image) {
      const remove = Object.assign(document.createElement("button"), {
        type: "button",
        className: "button small",
        textContent: "Remove image",
      });
      remove.addEventListener("click", () => {
        updateBlock(row, position, (b) => ({ ...b, image: undefined }));
        showRows();
      });
      drop.append(remove);
    }
    drop.addEventListener("dragover", (event) => {
      event.preventDefault();
      drop.classList.add("dragging");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      drop.classList.remove("dragging");
      const [file] = event.dataTransfer?.files ?? [];
      if (file) useImage(file, row, position);
    });
    const widths = /** @type {(keyof typeof IMAGE_WIDTHS)[]} */ (Object.keys(IMAGE_WIDTHS));
    const widthNames = widths.map((w) => IMAGE_WIDTHS[w].name);
    return [
      drop,
      pair(
        labelled("Takes", `${id}-width`, select(widths, widthNames, block.width, "width")),
        labelled(
          "Kind",
          `${id}-treatment`,
          select(["logo", "photo"], ["Logo, crisp", "Photo, dithered"], block.treatment, "treatment"),
        ),
        labelled(
          "Show",
          `${id}-show`,
          select(["fit", "fill"], ["Whole image", "Fill the box"], block.show, "show"),
        ),
      ),
    ];
  }

  /** The block waiting for the file being chosen. @type {{ row: number, position: number } | undefined} */
  let pendingImage;

  ui.imageFile.addEventListener("change", () => {
    const [file] = ui.imageFile.files ?? [];
    ui.imageFile.value = "";
    if (file && pendingImage) useImage(file, pendingImage.row, pendingImage.position);
    pendingImage = undefined;
  });

  /**
   * Saves an image in this browser and puts it in a block. Its size is kept with the block so the
   * label can be laid out before the image is loaded.
   * @param {File} file
   * @param {number} row
   * @param {number} position
   */
  async function useImage(file, row, position) {
    if (!file.type.startsWith("image/")) {
      showProblem(ui.status, "That file isn't an image. Choose a JPEG, PNG, WebP or SVG image.");
      return;
    }
    ui.status.textContent = "Adding the image…";
    let image;
    let size;
    try {
      image = await prepareImage(file);
      const bitmap = await createImageBitmap(image);
      size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
    } catch {
      showProblem(ui.status, "This image can't be opened here. Choose a JPEG, PNG, WebP or SVG image.");
      return;
    }
    let id;
    try {
      id = await tokenStore.saveImage(image);
    } catch {
      showProblem(ui.status, "This browser can't save images, so the image can't be added.");
      return;
    }
    ui.status.textContent = "";
    updateBlock(row, position, (b) => ({ ...b, image: { id, ...size } }));
    showRows();
  }

  /* Elements */

  /**
   * @param {string} title
   * @param {string} text
   * @param {boolean} disabled
   * @param {() => void} onClick
   */
  function tool(title, text, disabled, onClick) {
    const button = Object.assign(document.createElement("button"), {
      type: "button",
      className: "text-button tool",
      textContent: text,
      title,
      disabled,
    });
    button.setAttribute("aria-label", title);
    button.addEventListener("click", onClick);
    return button;
  }

  /**
   * @template {string} T
   * @param {readonly T[]} values
   * @param {readonly string[]} names
   * @param {T} chosen
   * @param {string} name
   */
  function select(values, names, chosen, name) {
    const menu = Object.assign(document.createElement("select"), { name });
    menu.append(...values.map((value, i) => new Option(names[i], value, false, value === chosen)));
    return menu;
  }

  /**
   * @param {string} text
   * @param {string} id
   * @param {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} control
   */
  function labelled(text, id, control) {
    const field = Object.assign(document.createElement("div"), { className: "block-field" });
    control.id = id;
    field.append(Object.assign(document.createElement("label"), { htmlFor: id, textContent: text }), control);
    return field;
  }

  /** @param {HTMLElement[]} parts */
  function pair(...parts) {
    const holder = Object.assign(document.createElement("div"), { className: "block-pair" });
    holder.append(...parts);
    return holder;
  }

  /**
   * @template T
   * @param {readonly T[]} items
   * @param {number} from
   * @param {number} to
   */
  function moved(items, from, to) {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  }

  for (const { name, make } of Object.values(NEW_BLOCKS)) {
    const button = Object.assign(document.createElement("button"), {
      type: "button",
      className: "button small",
      textContent: name,
    });
    button.setAttribute("aria-label", `Add a row with ${name.toLowerCase()}`);
    button.addEventListener("click", () => {
      setRows([...template.rows, { blocks: [make()] }]);
      const added = ui.rows.lastElementChild?.querySelector("input, textarea, select");
      if (added instanceof HTMLElement) added.focus();
    });
    ui.addRow.append(button);
  }

  /* Saving */

  function changed() {
    onShow(design());
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  async function save() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const current = template;
    saved = byName([...saved.filter((other) => other.id !== current.id), current]);
    showActions();
    onSaved(saved);
    if (!canSave) return;
    try {
      await templateStore.save(current);
    } catch {
      canSave = false;
      showProblem(
        ui.status,
        "This browser can't save your templates, so they last until the page is closed.",
      );
      showActions();
    }
  }

  function saveNow() {
    if (saveTimer !== undefined) save();
  }

  addEventListener("pagehide", saveNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveNow();
  });

  /* My templates */

  ui.newTemplate.addEventListener("click", () => {
    edit(blankTemplate());
    ui.name.focus();
  });

  ui.toLibrary.addEventListener("click", () => {
    const shown = template.id;
    showLibrary();
    const button = [...ui.savedList.querySelectorAll("button")].find((item) => item.dataset.id === shown);
    (button ?? ui.newTemplate).focus();
  });

  labelSize.addEventListener("change", () => {
    if (!ui.library.hidden) showLists();
  });

  /** @param {string} [problem]  e.g. why a link couldn't be opened. */
  function showLibrary(problem) {
    saveNow();
    editing = false;
    ui.editor.hidden = true;
    ui.library.hidden = false;
    if (problem) showProblem(ui.libraryStatus, problem);
    else ui.libraryStatus.textContent = "";
    showLists();
    onShow(undefined);
  }

  function showLists() {
    ui.savedList.replaceChildren(...saved.map((other) => listItem(other, () => edit(other))));
    ui.starterList.replaceChildren(
      ...STARTERS.map((starter) => listItem(starter, () => edit({ ...starter, id: crypto.randomUUID() }))),
    );
  }

  /**
   * @param {LabelTemplate} other
   * @param {() => void} onOpen
   */
  function listItem(other, onOpen) {
    const media = labelSize.current;
    const item = /** @type {HTMLElement} */ (ui.itemTemplate.content.firstElementChild?.cloneNode(true));
    const button = /** @type {HTMLButtonElement} */ (item.querySelector("button"));
    const fields = fieldsOf(other).length;
    /** @type {HTMLElement} */ (item.querySelector(".library-name")).textContent = titleOf(other);
    /** @type {HTMLElement} */ (item.querySelector(".library-detail")).textContent = [
      fields === 1 ? "1 field" : `${fields} fields`,
      other.orientation,
    ].join(" · ");
    button.dataset.id = other.id;
    button.addEventListener("click", () => {
      onOpen();
      ui.name.focus();
    });
    const preview = /** @type {HTMLCanvasElement} */ (item.querySelector("canvas"));
    loadFonts(other.font)
      .then(() => drawBitmap(preview, renderLabel(other, sampleValues(other), media, { upright: true })))
      .catch(() => {
        // The template can be opened without its preview.
      });
    return item;
  }

  /* Designing */

  /** @param {LabelTemplate} next */
  function edit(next) {
    saveNow();
    template = next;
    editing = true;
    ui.name.value = next.name;
    choice.orientation.value = next.orientation;
    choice.border.value = next.border;
    choice.margin.value = next.margin;
    choice.length.value = next.lengthMm ? "fixed" : "auto";
    choice.font.value = next.font ?? "sans";
    ui.lengthMm.value = next.lengthMm ? String(next.lengthMm) : "";
    ui.lengthMm.disabled = !next.lengthMm;
    ui.status.textContent = "";
    delete ui.status.dataset.tone;
    ui.library.hidden = true;
    ui.editor.hidden = false;
    showRows();
    showActions();
    onShow(design());
  }

  /** @param {boolean} [confirmingDelete] */
  function showActions(confirmingDelete = false) {
    ui.toLibrary.hidden = saved.length === 0;
    ui.saveState.textContent = !isSaved() ? "" : canSave ? "Saved in this browser" : "Not saved";
    ui.actions.hidden = confirmingDelete;
    ui.duplicate.hidden = !isSaved();
    ui.exportTemplate.hidden = !isSaved();
    // A template with images is too big for a link; it travels as a file.
    ui.link.hidden = !isSaved() || imageIdsOf(template).length > 0;
    ui.deleteTemplate.hidden = !isSaved();
    ui.deleteConfirm.hidden = !confirmingDelete;
    ui.deleteQuestion.textContent = `Delete ${titleOf(template)}?`;
  }

  ui.preview.addEventListener("click", onPreview);
  ui.print.addEventListener("click", () => {
    // The Print tab shows saved templates and starters, so an opened starter becomes one of yours.
    save();
    onPrint(template);
  });

  /* Files and links */

  ui.exportTemplate.addEventListener("click", async () => {
    saveNow();
    /** @type {Map<string, import("../../backup.js").BackupImage>} */
    const images = new Map();
    for (const id of new Set(imageIdsOf(template))) {
      const blob = await tokenStore.getImage(id).catch(() => undefined);
      if (blob instanceof Blob) {
        images.set(id, { type: blob.type || "image/webp", bytes: new Uint8Array(await blob.arrayBuffer()) });
      }
    }
    const file = new Blob([writeTemplateFile(template, images)], { type: "application/json" });
    const name =
      titleOf(template)
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "template";
    const anchor = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(file),
      download: `${name}.rollprint.json`,
    });
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    toast(`Exported ${titleOf(template)}.`);
  });

  ui.link.addEventListener("click", async () => {
    saveNow();
    const link = templateLink(template, `${location.origin}${location.pathname}`);
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copied.");
      ui.status.textContent = `Opening the link adds ${titleOf(template)} to My templates.`;
    } catch {
      const field = Object.assign(document.createElement("input"), {
        className: "link-field",
        value: link,
        readOnly: true,
      });
      field.setAttribute("aria-label", `Link to ${titleOf(template)}`);
      ui.status.replaceChildren(`Copy this link to share ${titleOf(template)}.`, field);
      field.select();
    }
  });

  ui.importTemplate.addEventListener("click", () => ui.importFile.click());
  ui.importFile.addEventListener("change", () => {
    const [file] = ui.importFile.files ?? [];
    ui.importFile.value = "";
    if (file) importFile(file);
  });

  /**
   * Adds the template in a file to My templates, with its images; a template already here with the
   * same ID is updated.
   * @param {File} file
   */
  async function importFile(file) {
    let read;
    try {
      read = readTemplateFile(await file.text());
    } catch (error) {
      showProblem(ui.libraryStatus, error instanceof Error ? error.message : String(error));
      return;
    }
    try {
      for (const [id, image] of read.images) {
        await tokenStore.putImage(id, new Blob([image.bytes], { type: image.type }));
      }
    } catch {
      showProblem(ui.libraryStatus, "This browser can't save the template's images.");
      return;
    }
    const existed = saved.some((other) => other.id === read.template.id);
    edit(read.template);
    await save();
    toast(existed ? `Updated ${titleOf(read.template)}.` : `Imported ${titleOf(read.template)}.`);
  }

  /**
   * Opens a template from a shared link, adding it to My templates unless it's there already.
   * @param {string} value  The link's parameter.
   */
  function openShared(value) {
    const shared = readTemplateLink(value);
    if (!shared) {
      const message = "This template link is damaged. Ask for the link again.";
      if (saved.length > 0) showLibrary(message);
      else {
        edit(blankTemplate());
        showProblem(ui.status, message);
      }
      return;
    }
    const existing = saved.find((other) => other.id === shared.id);
    edit(existing ?? shared);
    if (existing) {
      ui.status.textContent = `${titleOf(existing)} is already in My templates.`;
    } else {
      save();
      toast(`Added ${titleOf(shared)} to My templates.`);
    }
  }

  ui.duplicate.addEventListener("click", () => {
    saveNow();
    const original = template;
    edit({ ...original, id: crypto.randomUUID(), name: `${titleOf(original)} copy` });
    save();
    ui.name.focus();
    ui.name.select();
  });

  ui.deleteTemplate.addEventListener("click", () => {
    showActions(true);
    ui.cancelDelete.focus();
  });
  ui.cancelDelete.addEventListener("click", () => {
    showActions();
    ui.deleteTemplate.focus();
  });
  ui.confirmDelete.addEventListener("click", async () => {
    const deleted = template;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    saved = saved.filter((other) => other.id !== deleted.id);
    onSaved(saved);
    toast(`Deleted ${titleOf(deleted)}.`);
    if (saved.length > 0) {
      showLibrary();
      ui.newTemplate.focus();
    } else {
      edit(blankTemplate());
      ui.name.focus();
    }
    await templateStore.delete(deleted.id).catch(() => {});
  });

  /** @param {LabelTemplate[]} templates */
  const byName = (templates) => templates.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));

  /* Start: a template from a shared link, My templates, or a blank template when there are none. */

  const linked = addressParam(LINK_PARAM);
  // Reloading the page shouldn't add the template again.
  if (linked !== null) updateAddress({ [LINK_PARAM]: undefined });

  templateStore.list().then(
    (templates) => {
      saved = byName(templates);
      onSaved(saved);
      if (linked !== null) openShared(linked);
      else if (editing) showActions();
      else if (saved.length > 0) showLibrary();
      else edit(blankTemplate());
    },
    () => {
      canSave = false;
      if (linked !== null) openShared(linked);
      else if (!editing) edit(blankTemplate());
    },
  );

  return {
    /** The template being designed with sample values, or none while My templates is shown. */
    current: () => (editing ? design() : undefined),
  };
}
