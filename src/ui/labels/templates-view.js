/** @import { LabelDesign } from "../../designs.js" */
/** @import { Path } from "../../labels/cells.js" */
/** @import { Cell, ImagePart, LabelTemplate, Part, TextPart, TextSize } from "../../labels/template.js" */
/** @import { LabelSize } from "../label-size.js" */
import { FONTS, loadFonts } from "../../imaging/fonts.js";
import { prepareImage } from "../../imaging/images.js";
import { AUTO_LENGTH_MM } from "../../imaging/label-layout.js";
import { layoutOn, renderLabel } from "../../imaging/label-render.js";
import {
  cellAt,
  isSplit,
  leavesOf,
  removeAt,
  shareOf,
  splitAt,
  withPart,
  withShare,
} from "../../labels/cells.js";
import { STARTERS } from "../../labels/starters.js";
import {
  BARCODE_HEIGHTS,
  barcodePart,
  fieldsOf,
  imageIdsOf,
  imagePart,
  qrPart,
  SHARES,
  sampleValues,
  TEXT_SIZES,
  TURNS,
  textPart,
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

/** What a cell can hold, and what each starts as. */
const PARTS = /** @type {const} */ ({
  text: { name: "Text", make: () => /** @type {Part} */ (textPart({ text: "{Text}" })) },
  image: { name: "Image", make: () => /** @type {Part} */ (imagePart()) },
  qr: { name: "QR code", make: () => /** @type {Part} */ (qrPart()) },
  barcode: { name: "Barcode", make: () => /** @type {Part} */ (barcodePart()) },
});

/** @returns {LabelTemplate} */
const blankTemplate = () => ({
  id: crypto.randomUUID(),
  name: "",
  orientation: "landscape",
  border: "none",
  margin: "m",
  cell: { part: textPart({ text: "{Text}", size: "fit", align: "center", bold: true }) },
});

/** @param {LabelTemplate} template */
const titleOf = (template) => template.name.trim() || "Untitled template";

/**
 * The Templates tab: My templates, saved in this browser, and the designer for one. A template is
 * designed in two steps: its layout, a map of numbered cells, then what each cell holds. Templates
 * save themselves as they are edited.
 * @param {object} options
 * @param {LabelSize} options.labelSize  For the previews and the map, and whether a roll is loaded.
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
    map: element("#cell-map", HTMLElement),
    changeLayout: element("#change-layout", HTMLButtonElement),
    layoutTools: element("#layout-tools", HTMLElement),
    layoutCell: element("#layout-cell", HTMLElement),
    splitAcross: element("#split-across", HTMLButtonElement),
    splitDown: element("#split-down", HTMLButtonElement),
    shareField: element("#share-field", HTMLElement),
    removeCell: element("#remove-cell", HTMLButtonElement),
    cellTitle: element("#cell-title", HTMLElement),
    cellKind: element("#cell-kind", HTMLSelectElement),
    cellPart: element("#cell-part", HTMLElement),
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
    lines: element("#template-lines", HTMLSelectElement),
    share: /** @type {RadioNodeList} */ (ui.form.elements.namedItem("share")),
  };

  /** Saved templates, by name. @type {LabelTemplate[]} */
  let saved = [];
  /** The template in the designer, shown unless My templates is. */
  let template = blankTemplate();
  let editing = false;
  /** The cell being filled in. @type {Path} */
  let selected = [];
  /** Whether the layout tools are out. */
  let changingLayout = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let saveTimer;
  let canSave = true;

  const isSaved = () => saved.some((other) => other.id === template.id);
  /** The template with sample values, shown the way it reads. @returns {LabelDesign} */
  const design = () => ({ type: "label", template, rows: [sampleValues(template)], upright: true });

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
    if (target === ui.cellKind) {
      const kind = /** @type {keyof typeof PARTS | "none"} */ (ui.cellKind.value);
      setCell(withPart(template.cell, selected, kind === "none" ? undefined : PARTS[kind].make()));
      focusFirst(ui.cellPart);
      return;
    }
    if (target.name === "share") {
      setCell(withShare(template.cell, selected, SHARES[Number(choice.share.value)].share));
      return;
    }
    if (target.closest("#cell-part")) {
      partInput(target);
      return;
    }
    const fixed = choice.length.value === "fixed";
    const typed = Number(ui.lengthMm.value);
    const lengthMm = Math.min(Math.max(typed, AUTO_LENGTH_MM.min), AUTO_LENGTH_MM.max);
    const lines = choice.lines.value;
    template = {
      ...template,
      name: ui.name.value,
      orientation: choice.orientation.value === "portrait" ? "portrait" : "landscape",
      border: /** @type {LabelTemplate["border"]} */ (choice.border.value),
      margin: /** @type {LabelTemplate["margin"]} */ (choice.margin.value),
      lengthMm: fixed && typed > 0 ? lengthMm : undefined,
      font: /** @type {LabelTemplate["font"]} */ (choice.font.value in FONTS ? choice.font.value : "sans"),
      lines: lines === "thin" || lines === "thick" ? lines : undefined,
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
    if (editing) showMap();
    if (!ui.library.hidden) showLists();
  });

  /* The layout: a map of numbered cells */

  /** @param {Cell} cell */
  function setCell(cell) {
    template = { ...template, cell };
    showMap();
    showCell();
    changed();
  }

  /** The number of the cell at a path, as the map shows it. @param {Path} path */
  const numberOf = (path) =>
    leavesOf(template.cell).findIndex(({ path: other }) => samePath(other, path)) + 1;

  /** @param {Path} a @param {Path} b */
  const samePath = (a, b) => a.length === b.length && a.every((step, i) => step === b[i]);

  /** The first cell under a path that holds something, or could. @param {Path} path */
  function leafUnder(path) {
    const steps = [...path];
    while (isSplit(cellAt(template.cell, steps))) steps.push("first");
    return steps;
  }

  /** Draws the map in the label's proportions, the way the label reads, and marks the chosen cell. */
  function showMap() {
    if (numberOf(selected) === 0) selected = leafUnder([]);
    const { width, height } = layoutOn(template, sampleValues(template), labelSize.current);
    ui.map.style.setProperty("--map-aspect", String(width / Math.max(height, 1)));
    let number = 0;
    /**
     * @param {Cell} cell
     * @param {Path} path
     * @returns {HTMLElement}
     */
    const build = (cell, path) => {
      if (isSplit(cell)) {
        const holder = Object.assign(document.createElement("div"), {
          className: `cell-split ${cell.split}`,
        });
        const first = build(cell.first, [...path, "first"]);
        const second = build(cell.second, [...path, "second"]);
        first.style.flex = `${cell.share} 1 0`;
        second.style.flex = `${1 - cell.share} 1 0`;
        holder.append(first, second);
        return holder;
      }
      number++;
      const kind = cell.part ? PARTS[cell.part.type].name : "Empty";
      const button = Object.assign(document.createElement("button"), { type: "button", className: "cell" });
      button.setAttribute("aria-pressed", String(samePath(path, selected)));
      button.setAttribute("aria-label", `Cell ${number}, ${kind.toLowerCase()}`);
      button.append(
        Object.assign(document.createElement("span"), {
          className: "cell-number",
          textContent: String(number),
        }),
        Object.assign(document.createElement("span"), { className: "cell-holds", textContent: kind }),
      );
      button.addEventListener("click", () => {
        selected = path;
        showMap();
        showCell();
      });
      return button;
    };
    ui.map.replaceChildren(build(template.cell, []));
    showLayoutTools();
  }

  function showLayoutTools() {
    ui.changeLayout.setAttribute("aria-pressed", String(changingLayout));
    ui.layoutTools.hidden = !changingLayout;
    ui.layoutCell.textContent = `Cell ${numberOf(selected)}`;
    const share = shareOf(template.cell, selected);
    ui.shareField.hidden = share === undefined;
    ui.removeCell.hidden = selected.length === 0;
    if (share === undefined) return;
    const index = SHARES.findIndex((option) => Math.abs(option.share - share) < 0.01);
    choice.share.value = index < 0 ? "" : String(index);
  }

  ui.changeLayout.addEventListener("click", () => {
    changingLayout = !changingLayout;
    showLayoutTools();
    if (changingLayout) ui.splitAcross.focus();
  });
  ui.splitAcross.addEventListener("click", () => split("across"));
  ui.splitDown.addEventListener("click", () => split("down"));
  /** @param {"across" | "down"} direction */
  function split(direction) {
    const cell = splitAt(template.cell, selected, direction);
    selected = [...selected, "first"];
    setCell(cell);
  }
  ui.removeCell.addEventListener("click", () => {
    const cell = removeAt(template.cell, selected);
    template = { ...template, cell };
    selected = leafUnder(selected.slice(0, -1));
    setCell(cell);
    (ui.removeCell.hidden ? ui.changeLayout : ui.removeCell).focus();
  });

  /* The chosen cell */

  /** Shows what the chosen cell holds, and its controls. */
  function showCell() {
    const leaf = cellAt(template.cell, selected);
    const part = isSplit(leaf) ? undefined : leaf.part;
    ui.cellTitle.textContent = `Cell ${numberOf(selected)}`;
    ui.cellKind.value = part?.type ?? "none";
    ui.cellPart.replaceChildren(...(part ? partControls(part) : []));
    ui.cellPart.hidden = !part;
  }

  /** @param {HTMLElement} holder */
  function focusFirst(holder) {
    for (const control of holder.querySelectorAll("input, textarea, select, .button")) {
      if (!(control instanceof HTMLElement) || !control.checkVisibility()) continue;
      control.focus();
      break;
    }
  }

  /**
   * Keeps what was typed into the cell's controls, without redrawing them, so typing goes on.
   * @param {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} target
   */
  function partInput(target) {
    const leaf = cellAt(template.cell, selected);
    if (isSplit(leaf) || !leaf.part) return;
    const setting = target.dataset.setting ?? target.name;
    const value =
      target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value;
    setPart(selected, /** @type {Part} */ ({ ...leaf.part, [setting]: value }));
  }

  /**
   * @param {Path} path
   * @param {Part} part
   */
  function setPart(path, part) {
    template = { ...template, cell: withPart(template.cell, path, part) };
    changed();
  }

  /**
   * @param {Part} part
   * @returns {HTMLElement[]}
   */
  function partControls(part) {
    const grid = Object.assign(document.createElement("div"), { className: "part-grid" });
    switch (part.type) {
      case "text":
        return [textControls(part)];
      case "image":
        return imageControls(part);
      case "qr": {
        const content = input(part.content, "content", "A link or text, e.g. {Link}");
        grid.append(labelFor("Content", "cell-content", content), content);
        break;
      }
      case "barcode": {
        const content = input(part.content, "content", "Letters and digits, e.g. {Code}");
        const heights = /** @type {(keyof typeof BARCODE_HEIGHTS)[]} */ (Object.keys(BARCODE_HEIGHTS));
        const height = select(heights, ["Small", "Medium", "Large"], part.height, "height");
        grid.append(
          labelFor("Content", "cell-content", content),
          content,
          labelFor("Height", "cell-height", height),
          line(height, checkbox("text", part.text, "Text under it")),
        );
        break;
      }
    }
    return [grid];
  }

  /**
   * A text's controls: the text and its size, how it is aligned, and a heading above it once one
   * is wanted.
   * @param {TextPart} part
   */
  function textControls(part) {
    const sizes = /** @type {TextSize[]} */ (Object.keys(TEXT_SIZES));
    const names = sizes.map((size) => TEXT_SIZES[size].name);
    const heading = input(part.heading, "heading", "");
    const headingLabel = labelFor("Heading", "cell-heading", heading);
    const headingPair = pair(heading, select(sizes, names, part.headingSize, "headingSize", "Heading size"));
    const text = Object.assign(document.createElement("textarea"), {
      name: "text",
      value: part.text,
      rows: 2,
    });
    const align = Object.assign(document.createElement("div"), { className: "segmented" });
    for (const [value, name] of [
      ["start", "Left"],
      ["center", "Centre"],
      ["end", "Right"],
    ]) {
      const label = document.createElement("label");
      const radio = Object.assign(document.createElement("input"), {
        type: "radio",
        name: "align",
        value,
        checked: part.align === value,
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
    headingLabel.hidden = headingPair.hidden = !part.heading;
    addHeading.hidden = Boolean(part.heading);
    const grid = Object.assign(document.createElement("div"), { className: "part-grid" });
    grid.append(
      headingLabel,
      headingPair,
      labelFor("Text", "cell-text", text),
      pair(text, select(sizes, names, part.size, "size", "Text size")),
      line(align, checkbox("bold", part.bold, "Bold"), addHeading),
    );
    return grid;
  }

  /**
   * @param {ImagePart} part
   * @returns {HTMLElement[]}
   */
  function imageControls(part) {
    const path = selected;
    const drop = Object.assign(document.createElement("div"), { className: "image-drop part-image" });
    const choose = Object.assign(document.createElement("button"), {
      type: "button",
      className: "button small",
      textContent: part.image ? "Replace" : "Choose image",
    });
    choose.addEventListener("click", () => {
      pendingImage = path;
      ui.imageFile.click();
    });
    if (part.image) {
      const thumbnail = Object.assign(document.createElement("img"), { className: "part-thumb", alt: "" });
      tokenStore
        .getImage(part.image.id)
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
        setPart(path, { ...part, image: undefined });
        showCell();
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
      if (file) useImage(file, path);
    });
    const kind = select(["logo", "photo"], ["Logo, crisp", "Photo, dithered"], part.treatment, "treatment");
    const show = select(["fit", "fill"], ["Whole image", "Fill the cell"], part.show, "show");
    const turns = /** @type {(keyof typeof TURNS)[]} */ (Object.keys(TURNS));
    const turn = select(
      turns,
      turns.map((t) => TURNS[t].name),
      part.turn ?? "none",
      "turn",
    );
    const grid = Object.assign(document.createElement("div"), { className: "part-grid" });
    grid.append(
      labelFor("Kind", "cell-kind-of-image", kind),
      kind,
      labelFor("Show", "cell-show", show),
      show,
      labelFor("Turn", "cell-turn", turn),
      turn,
    );
    return [drop, grid];
  }

  /** The cell waiting for the file being chosen. @type {Path | undefined} */
  let pendingImage;

  ui.imageFile.addEventListener("change", () => {
    const [file] = ui.imageFile.files ?? [];
    ui.imageFile.value = "";
    if (file && pendingImage) useImage(file, pendingImage);
    pendingImage = undefined;
  });

  /**
   * Saves an image in this browser and puts it in a cell. Its size is kept with the part so the
   * label can be laid out before the image is loaded.
   * @param {File} file
   * @param {Path} path
   */
  async function useImage(file, path) {
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
    const leaf = cellAt(template.cell, path);
    if (isSplit(leaf) || leaf.part?.type !== "image") return;
    setPart(path, { ...leaf.part, image: { id, ...size } });
    if (samePath(path, selected)) showCell();
  }

  /* Elements */

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
    selected = [];
    changingLayout = false;
    ui.name.value = next.name;
    choice.orientation.value = next.orientation;
    choice.border.value = next.border;
    choice.margin.value = next.margin;
    choice.length.value = next.lengthMm ? "fixed" : "auto";
    choice.font.value = next.font ?? "sans";
    choice.lines.value = next.lines ?? "none";
    ui.lengthMm.value = next.lengthMm ? String(next.lengthMm) : "";
    ui.lengthFixed.hidden = !next.lengthMm;
    showLengthField();
    ui.status.textContent = "";
    delete ui.status.dataset.tone;
    ui.library.hidden = true;
    ui.editor.hidden = false;
    showMap();
    showCell();
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
