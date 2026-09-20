/** @import { LabelDesign } from "../../designs.js" */
/** @import { Block, ImageBlock, LabelTemplate, Row, TextBlock, TextSize } from "../../labels/template.js" */
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
import { drawBitmap, dropDown, element, showProblem } from "../dom.js";
import { toast } from "../toast.js";

const SAVE_DELAY_MS = 400;
/** How many parts can print side by side. */
const MOST_BESIDE = 3;

/** What can be put on a label, and what each starts as. */
const PARTS = /** @type {const} */ ({
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
 * A block as the designer shows it: in reading order, with whether it sits beside the one before
 * it. The rows a template prints in follow from that.
 * @typedef {{ block: Block, beside: boolean }} Part
 */

/** @param {Row[]} rows @returns {Part[]} */
const partsOf = (rows) =>
  rows.flatMap(({ blocks }) => blocks.map((block, index) => ({ block, beside: index > 0 })));

/** @param {Part[]} parts @returns {Row[]} */
function rowsOf(parts) {
  /** @type {Row[]} */
  const rows = [];
  for (const { block, beside } of parts) {
    const last = rows.at(-1);
    if (beside && last) last.blocks.push(block);
    else rows.push({ blocks: [block] });
  }
  return rows;
}

/**
 * The parts with the blocks at two places swapped. Where each place sits, beside or below, stays,
 * so moving a part never changes the shape of the label.
 * @param {Part[]} parts
 * @param {number} from
 * @param {number} to
 */
function swapped(parts, from, to) {
  const blocks = parts.map(({ block }) => block);
  [blocks[from], blocks[to]] = [blocks[to], blocks[from]];
  return parts.map((part, index) => ({ ...part, block: blocks[index] }));
}

/**
 * The Templates tab: My templates, saved in this browser, and the designer for one. Templates save
 * themselves as they are edited.
 * @param {object} options
 * @param {LabelSize} options.labelSize  For the previews in My templates, and whether a roll is loaded.
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
    parts: element("#template-parts", HTMLElement),
    addPart: element("#add-part", HTMLElement),
    imageFile: element("#template-image-file", HTMLInputElement),
    lengthField: element("#length-field", HTMLElement),
    lengthFixed: element("#template-length-fixed", HTMLElement),
    lengthMm: element("#template-length-mm", HTMLInputElement),
    status: element("#template-status", HTMLElement),
    preview: element("#preview-template", HTMLButtonElement),
    actions: element("#template-actions", HTMLElement),
    print: element("#print-template", HTMLButtonElement),
    more: element("#template-more", HTMLButtonElement),
    menu: element("#template-menu", HTMLElement),
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
  };
  const choice = {
    font: element("#template-font", HTMLSelectElement),
    border: element("#template-border", HTMLSelectElement),
    margin: element("#template-margin", HTMLSelectElement),
    orientation: element("#template-orientation", HTMLSelectElement),
    length: element("#template-length", HTMLSelectElement),
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

  /* The template's look */

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
    if (target.closest("#template-parts")) {
      partInput(target);
      return;
    }
    const fixed = choice.length.value === "fixed";
    const typed = Number(ui.lengthMm.value);
    const lengthMm = Math.min(Math.max(typed, AUTO_LENGTH_MM.min), AUTO_LENGTH_MM.max);
    template = {
      ...template,
      name: ui.name.value,
      orientation: choice.orientation.value === "portrait" ? "portrait" : "landscape",
      border: /** @type {LabelTemplate["border"]} */ (choice.border.value),
      margin: /** @type {LabelTemplate["margin"]} */ (choice.margin.value),
      lengthMm: fixed && typed > 0 ? lengthMm : undefined,
      font: /** @type {LabelTemplate["font"]} */ (choice.font.value in FONTS ? choice.font.value : "sans"),
    };
    ui.lengthFixed.hidden = !fixed;
    if (fixed && target === choice.length) ui.lengthMm.focus();
    changed();
  });

  // The length field shows the limit it was kept to, once it is left.
  ui.lengthMm.addEventListener("change", () => {
    if (template.lengthMm) ui.lengthMm.value = String(template.lengthMm);
  });

  /** The length only matters on a continuous roll; a die-cut label has its own. */
  function showLengthField() {
    ui.lengthField.hidden = Boolean(labelSize.current.lengthMm);
  }

  labelSize.addEventListener("change", () => {
    showLengthField();
    if (!ui.library.hidden) showLists();
  });

  /* The parts of the label */

  /** The row and block a control belongs to. @param {Element} target */
  function placeOf(target) {
    const part = target.closest(".part");
    const { row = "-1", block = "-1" } = part instanceof HTMLElement ? part.dataset : {};
    return { row: Number(row), block: Number(block) };
  }

  /**
   * Keeps what was typed into a part's controls, without redrawing the list, so typing goes on.
   * @param {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} target
   */
  function partInput(target) {
    const { row, block } = placeOf(target);
    if (!template.rows[row]?.blocks[block]) return;
    const setting = target.dataset.setting ?? target.name;
    const value =
      target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value;
    updateBlock(row, block, (current) => /** @type {Block} */ ({ ...current, [setting]: value }));
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
    showParts();
    changed();
  }

  /** The parts as one list; those that print side by side are bracketed together. */
  function showParts() {
    let index = 0;
    ui.parts.replaceChildren(
      ...template.rows.map((row, r) => {
        const holder = Object.assign(document.createElement("div"), { className: "part-row" });
        holder.append(...row.blocks.map((block, b) => partElement(block, r, b, index++)));
        return holder;
      }),
    );
  }

  /**
   * @param {Block} block
   * @param {number} row
   * @param {number} position  In its row.
   * @param {number} index  In reading order.
   */
  function partElement(block, row, position, index) {
    const parts = partsOf(template.rows);
    const holder = Object.assign(document.createElement("div"), { className: "part" });
    holder.dataset.row = String(row);
    holder.dataset.block = String(position);
    const head = Object.assign(document.createElement("div"), { className: "part-head" });
    head.append(
      Object.assign(document.createElement("span"), {
        className: "part-kind",
        textContent: PARTS[block.type].name,
      }),
    );
    if (index > 0) {
      const beside = position > 0;
      // Joining the row above is offered while the two rows together fit side by side.
      const full =
        !beside && template.rows[row - 1].blocks.length + template.rows[row].blocks.length > MOST_BESIDE;
      const toggle = tool(
        beside ? "Put it on its own line" : "Put it beside the one above",
        "Beside the one above",
        full,
        () => setRows(rowsOf(parts.map((part, i) => (i === index ? { ...part, beside: !beside } : part)))),
      );
      toggle.setAttribute("aria-pressed", String(beside));
      head.append(toggle);
    }
    head.append(
      tool("Move up", "↑", index === 0, () => setRows(rowsOf(swapped(parts, index, index - 1)))),
      tool("Move down", "↓", index === parts.length - 1, () =>
        setRows(rowsOf(swapped(parts, index, index + 1))),
      ),
      tool("Remove", "Remove", false, () => {
        const rows = template.rows
          .map((other, r) => (r === row ? { blocks: other.blocks.filter((_, b) => b !== position) } : other))
          .filter((other) => other.blocks.length > 0);
        setRows(rows);
      }),
    );
    holder.append(head, ...partControls(block, row, position));
    return holder;
  }

  /**
   * @param {Block} block
   * @param {number} row
   * @param {number} position
   * @returns {HTMLElement[]}
   */
  function partControls(block, row, position) {
    const id = `part-${row}-${position}`;
    const grid = Object.assign(document.createElement("div"), { className: "part-grid" });
    const widths = /** @type {(keyof typeof IMAGE_WIDTHS)[]} */ (Object.keys(IMAGE_WIDTHS));
    const widthNames = widths.map((width) => IMAGE_WIDTHS[width].name);
    switch (block.type) {
      case "text":
        return [textControls(block, row, position, id)];
      case "image":
        return imageControls(block, row, position, id);
      case "divider": {
        const weight = select(["thin", "thick"], ["Thin", "Thick"], block.weight, "weight");
        grid.append(labelFor("Line", id, weight), weight);
        break;
      }
      case "space": {
        const size = select(["s", "m", "l"], ["Small", "Medium", "Large"], block.size, "size");
        grid.append(labelFor("Height", id, size), size);
        break;
      }
      case "qr": {
        const content = input(block.content, "content", "A link or text, e.g. {Link}");
        const width = select(widths, widthNames, block.width, "width");
        grid.append(
          labelFor("Content", id, content),
          content,
          labelFor("Width", `${id}-width`, width),
          width,
        );
        break;
      }
      case "barcode": {
        const content = input(block.content, "content", "Letters and digits, e.g. {Code}");
        const heights = /** @type {(keyof typeof BARCODE_HEIGHTS)[]} */ (Object.keys(BARCODE_HEIGHTS));
        const height = select(heights, ["Small", "Medium", "Large"], block.height, "height");
        grid.append(
          labelFor("Content", id, content),
          content,
          labelFor("Height", `${id}-height`, height),
          line(height, checkbox("text", block.text, "Text under it")),
        );
        break;
      }
    }
    return [grid];
  }

  /**
   * A text's controls: the text and its size, how it is aligned, and a heading above it once one
   * is wanted.
   * @param {TextBlock} block
   * @param {number} row
   * @param {number} position
   * @param {string} id
   */
  function textControls(block, row, position, id) {
    const sizes = /** @type {TextSize[]} */ (Object.keys(TEXT_SIZES));
    const names = sizes.map((size) => TEXT_SIZES[size].name);
    const heading = input(block.heading, "heading", "");
    const headingLabel = labelFor("Heading", `${id}-heading`, heading);
    const headingPair = pair(heading, select(sizes, names, block.headingSize, "headingSize", "Heading size"));
    const text = Object.assign(document.createElement("textarea"), {
      name: "text",
      value: block.text,
      rows: 2,
    });
    const align = Object.assign(document.createElement("div"), { className: "segmented" });
    for (const [value, name] of [
      ["start", "Left"],
      ["center", "Centre"],
      ["end", "Right"],
    ]) {
      const label = document.createElement("label");
      // Each part's radios are their own group.
      const radio = Object.assign(document.createElement("input"), {
        type: "radio",
        name: `align-${row}-${position}`,
        value,
        checked: block.align === value,
      });
      radio.dataset.setting = "align";
      label.append(radio, Object.assign(document.createElement("span"), { textContent: name }));
      align.append(label);
    }
    const addHeading = Object.assign(document.createElement("button"), {
      type: "button",
      className: "text-button tool",
      textContent: "Add a heading",
    });
    addHeading.addEventListener("click", () => {
      headingLabel.hidden = headingPair.hidden = false;
      addHeading.hidden = true;
      heading.focus();
    });
    headingLabel.hidden = headingPair.hidden = !block.heading;
    addHeading.hidden = Boolean(block.heading);
    const grid = Object.assign(document.createElement("div"), { className: "part-grid" });
    grid.append(
      headingLabel,
      headingPair,
      labelFor("Text", `${id}-text`, text),
      pair(text, select(sizes, names, block.size, "size", "Text size")),
      line(align, checkbox("bold", block.bold, "Bold"), addHeading),
    );
    return grid;
  }

  /**
   * @param {ImageBlock} block
   * @param {number} row
   * @param {number} position
   * @param {string} id
   * @returns {HTMLElement[]}
   */
  function imageControls(block, row, position, id) {
    const drop = Object.assign(document.createElement("div"), { className: "image-drop part-image" });
    const choose = Object.assign(document.createElement("button"), {
      type: "button",
      className: "button small",
      textContent: block.image ? "Replace" : "Choose image",
    });
    choose.addEventListener("click", () => {
      pendingImage = { row, position };
      ui.imageFile.click();
    });
    if (block.image) {
      const thumbnail = Object.assign(document.createElement("img"), { className: "part-thumb", alt: "" });
      tokenStore
        .getImage(block.image.id)
        .then((blob) => {
          if (!(blob instanceof Blob)) return;
          thumbnail.src = URL.createObjectURL(blob);
          thumbnail.onload = () => URL.revokeObjectURL(thumbnail.src);
        })
        .catch(() => {
          // The part can be changed without its picture.
        });
      const remove = Object.assign(document.createElement("button"), {
        type: "button",
        className: "button small",
        textContent: "Remove image",
      });
      remove.addEventListener("click", () => {
        updateBlock(row, position, (b) => ({ ...b, image: undefined }));
        showParts();
      });
      drop.append(thumbnail, choose, remove);
    } else {
      drop.append(
        Object.assign(document.createElement("p"), { textContent: "Drop an image here, or" }),
        choose,
      );
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
    const width = select(
      widths,
      widths.map((w) => IMAGE_WIDTHS[w].name),
      block.width,
      "width",
    );
    const kind = select(["logo", "photo"], ["Logo, crisp", "Photo, dithered"], block.treatment, "treatment");
    const show = select(["fit", "fill"], ["Whole image", "Fill the box"], block.show, "show");
    const grid = Object.assign(document.createElement("div"), { className: "part-grid" });
    grid.append(
      labelFor("Width", `${id}-width`, width),
      width,
      labelFor("Kind", `${id}-kind`, kind),
      kind,
      labelFor("Show", `${id}-show`, show),
      show,
    );
    return [drop, grid];
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
    showParts();
  }

  for (const { name, make } of Object.values(PARTS)) {
    const button = Object.assign(document.createElement("button"), {
      type: "button",
      className: "button small",
      textContent: name,
    });
    button.setAttribute("aria-label", `Add ${name.toLowerCase()}`);
    button.addEventListener("click", () => {
      setRows([...template.rows, { blocks: [make()] }]);
      const added = ui.parts.lastElementChild?.lastElementChild;
      for (const control of added?.querySelectorAll("input, textarea, select, .button") ?? []) {
        if (!(control instanceof HTMLElement) || !control.checkVisibility()) continue;
        control.focus();
        break;
      }
    });
    ui.addPart.append(button);
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
   * @param {string} value
   * @param {string} name
   * @param {string} placeholder
   */
  const input = (value, name, placeholder) =>
    Object.assign(document.createElement("input"), { name, value, placeholder, autocomplete: "off" });

  /**
   * @template {string} T
   * @param {readonly T[]} values
   * @param {readonly string[]} names
   * @param {T} chosen
   * @param {string} name
   * @param {string} [label]  When no label is shown beside it.
   */
  function select(values, names, chosen, name, label) {
    const menu = Object.assign(document.createElement("select"), { name });
    menu.append(...values.map((value, i) => new Option(names[i], value, false, value === chosen)));
    if (label) menu.setAttribute("aria-label", label);
    return menu;
  }

  /**
   * @param {string} name
   * @param {boolean} checked
   * @param {string} text
   */
  function checkbox(name, checked, text) {
    const label = Object.assign(document.createElement("label"), { className: "checkbox" });
    label.append(Object.assign(document.createElement("input"), { type: "checkbox", name, checked }), text);
    return label;
  }

  /**
   * A label for a control, which gets the ID.
   * @param {string} text
   * @param {string} id
   * @param {HTMLElement} control
   */
  function labelFor(text, id, control) {
    control.id = id;
    return Object.assign(document.createElement("label"), { htmlFor: id, textContent: text });
  }

  /** A text and its size, side by side. @param {HTMLElement[]} parts */
  function pair(...parts) {
    const holder = Object.assign(document.createElement("div"), { className: "part-pair" });
    holder.append(...parts);
    return holder;
  }

  /** Small controls in a line. @param {HTMLElement[]} parts */
  function line(...parts) {
    const holder = Object.assign(document.createElement("div"), { className: "part-line" });
    holder.append(...parts);
    return holder;
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
    ui.lengthFixed.hidden = !next.lengthMm;
    showLengthField();
    ui.status.textContent = "";
    delete ui.status.dataset.tone;
    ui.library.hidden = true;
    ui.editor.hidden = false;
    showParts();
    showActions();
    onShow(design());
  }

  /** @param {boolean} [confirmingDelete] */
  function showActions(confirmingDelete = false) {
    ui.toLibrary.hidden = saved.length === 0;
    ui.saveState.textContent = !isSaved() ? "" : canSave ? "Saved in this browser" : "Not saved";
    ui.actions.hidden = confirmingDelete;
    ui.more.hidden = !isSaved();
    // A template with images is too big for a link; it travels as a file.
    ui.link.hidden = imageIdsOf(template).length > 0;
    ui.deleteConfirm.hidden = !confirmingDelete;
    ui.deleteQuestion.textContent = `Delete ${titleOf(template)}?`;
  }

  ui.preview.addEventListener("click", onPreview);
  ui.print.addEventListener("click", () => {
    // The Print tab shows saved templates and starters, so an opened starter becomes one of yours.
    save();
    onPrint(template);
  });

  dropDown(ui.menu, ui.more);
  ui.menu.addEventListener("click", (event) => {
    if (event.target instanceof HTMLButtonElement) ui.menu.hidePopover();
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
    ui.more.focus();
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
