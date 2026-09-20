/** @import { LabelDesign } from "../../designs.js" */
/** @import { LabelTemplate, Values } from "../../labels/template.js" */
/** @import { LabelSize } from "../label-size.js" */
import { loadFonts } from "../../imaging/fonts.js";
import { renderLabel } from "../../imaging/label-render.js";
import { parseRows, rowsToText } from "../../labels/rows.js";
import { STARTERS } from "../../labels/starters.js";
import { fieldsOf, sampleValues } from "../../labels/template.js";
import { drawBitmap, element } from "../dom.js";
import { readSetting, writeSetting } from "../settings.js";

const SHOW_DELAY_MS = 150;

/**
 * The Labels view: pick a template, fill in its fields, and the label is ready to print. What was
 * typed into each template is remembered in this browser.
 * @param {object} options
 * @param {LabelSize} options.labelSize  For the template previews.
 * @param {(design: LabelDesign) => void} options.onShow  The label changed.
 * @param {() => void} options.onPreview  Shows the label, on small screens.
 */
export function createPrintView({ labelSize, onShow, onPreview }) {
  const ui = {
    list: element("#template-list", HTMLUListElement),
    fields: element("#label-fields", HTMLFormElement),
    fillChoice: element("#fill-choice", HTMLElement),
    manyField: element("#label-many-field", HTMLElement),
    many: element("#label-many", HTMLTextAreaElement),
    count: element("#label-count", HTMLElement),
    preview: element("#preview-label", HTMLButtonElement),
  };
  const fillChoice = [...ui.fillChoice.querySelectorAll("input")];
  /** Templates of your own first, then the starters. @type {LabelTemplate[]} */
  let templates = STARTERS;
  /** @type {LabelTemplate} */
  let template = templates.find(({ id }) => id === readSetting("labelTemplate")) ?? templates[0];
  /** @type {Values} */
  let values = rememberedValues(template);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** Many labels from a pasted list, rather than one from the fields. */
  let many = false;
  let list = "";
  /**
   * The user's own template and values, put back once a label from the print list is done with.
   * @type {{ template: LabelTemplate, values: Values, many: boolean, list: string } | undefined}
   */
  let own;

  /** @returns {LabelDesign} */
  const design = () => ({
    type: "label",
    template,
    rows: many ? parseRows(list, fieldsOf(template)) : [values],
  });

  /** @param {LabelTemplate} chosen */
  function rememberedValues(chosen) {
    const all = readSetting("labelValues");
    const saved =
      all && typeof all === "object" ? /** @type {Record<string, unknown>} */ (all)[chosen.id] : undefined;
    if (!saved || typeof saved !== "object") return {};
    return Object.fromEntries(Object.entries(saved).filter((entry) => typeof entry[1] === "string"));
  }

  function rememberValues() {
    const all = readSetting("labelValues");
    writeSetting("labelValues", { ...(all && typeof all === "object" ? all : {}), [template.id]: values });
  }

  /* Templates */

  function showTemplates() {
    const media = labelSize.current;
    ui.list.replaceChildren(
      ...templates.map((other) => {
        const item = document.createElement("li");
        const button = Object.assign(document.createElement("button"), {
          type: "button",
          className: "template",
        });
        button.dataset.id = other.id;
        button.setAttribute("aria-pressed", String(other.id === template.id));
        const preview = Object.assign(document.createElement("canvas"), { width: 120, height: 60 });
        preview.setAttribute("aria-hidden", "true");
        const name = Object.assign(document.createElement("span"), {
          className: "template-name",
          textContent: other.name,
        });
        button.append(preview, name);
        button.addEventListener("click", () => choose(other));
        item.append(button);
        loadFonts(other.font)
          .then(() => drawBitmap(preview, renderLabel(other, sampleValues(other), media, { upright: true })))
          .catch(() => {
            // The template can be chosen without its preview.
          });
        return item;
      }),
    );
  }

  /** @param {LabelTemplate} chosen */
  function choose(chosen) {
    template = chosen;
    values = rememberedValues(chosen);
    writeSetting("labelTemplate", chosen.id);
    markChosen();
    showFields();
    onShow(design());
    const first = ui.fields.querySelector("input, textarea");
    if (first instanceof HTMLElement) first.focus();
  }

  function markChosen() {
    for (const button of ui.list.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.id === template.id));
    }
  }

  /* Fields */

  function showFields() {
    ui.fields.replaceChildren(
      ...fieldsOf(template).map(({ name, multiline }) => {
        const field = Object.assign(document.createElement("div"), { className: "form-field" });
        const id = `label-field-${name.replace(/\W+/g, "-").toLowerCase()}`;
        const label = Object.assign(document.createElement("label"), { textContent: name, htmlFor: id });
        const input = multiline
          ? Object.assign(document.createElement("textarea"), { rows: 3 })
          : Object.assign(document.createElement("input"), { autocomplete: "off" });
        input.id = id;
        input.name = name;
        input.value = values[name] ?? "";
        input.addEventListener("input", () => {
          values = { ...values, [name]: input.value };
          // A label from the print list has its own values; they aren't what the user typed last.
          if (!own) rememberValues();
          clearTimeout(timer);
          timer = setTimeout(() => onShow(design()), SHOW_DELAY_MS);
        });
        field.append(label, input);
        return field;
      }),
    );
  }

  ui.fields.addEventListener("submit", (event) => {
    event.preventDefault();
    onPreview();
  });

  /* Many labels from a list */

  for (const input of fillChoice) {
    input.addEventListener("change", () => {
      many = input.value === "many";
      showMany();
      onShow(design());
      const first = many ? ui.many : ui.fields.querySelector("input, textarea");
      if (first instanceof HTMLElement) first.focus();
    });
  }

  ui.many.addEventListener("input", () => {
    list = ui.many.value;
    showCount();
    clearTimeout(timer);
    timer = setTimeout(() => onShow(design()), SHOW_DELAY_MS);
  });

  function showMany() {
    for (const input of fillChoice) input.checked = input.value === (many ? "many" : "one");
    ui.fields.hidden = many;
    ui.manyField.hidden = !many;
    ui.many.value = list;
    showCount();
  }

  function showCount() {
    const count = many ? parseRows(list, fieldsOf(template)).length : 0;
    ui.count.textContent = count === 0 ? "" : count === 1 ? "1 label" : `${count} labels`;
  }
  ui.preview.addEventListener("click", onPreview);
  labelSize.addEventListener("change", showTemplates);

  showTemplates();
  showFields();
  showMany();

  return {
    current: design,

    /**
     * My templates changed: they come before the starters. A template that went away gives way to
     * the first one.
     * @param {LabelTemplate[]} saved
     */
    setSaved(saved) {
      templates = [...saved, ...STARTERS];
      const shown = templates.find(({ id }) => id === template.id);
      if (shown && shown !== template && !own) {
        template = shown;
        showFields();
        onShow(design());
      } else if (!shown && !own) {
        choose(templates[0]);
      }
      showTemplates();
    },

    /**
     * Picks a template, e.g. one just designed.
     * @param {LabelTemplate} chosen
     */
    choose(chosen) {
      if (own) return;
      choose(chosen);
    },

    /**
     * Shows a label from the print list, with its own copy of the template, until `restore`.
     * @param {LabelDesign} saved
     */
    edit(saved) {
      own ??= { template, values, many, list };
      template = saved.template;
      many = saved.rows.length > 1;
      values = saved.rows[0] ?? {};
      list = many ? rowsToText(saved.rows, fieldsOf(saved.template)) : "";
      markChosen();
      showFields();
      showMany();
    },

    /** Puts back what the user was filling in before a label from the print list took over. */
    restore() {
      if (!own) return;
      ({ template, values, many, list } = own);
      own = undefined;
      markChosen();
      showFields();
      showMany();
      onShow(design());
    },
  };
}
