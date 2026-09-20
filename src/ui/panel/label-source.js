/** @import { LabelDesign } from "../../designs.js" */
/** @import { PanelHooks, Source } from "./source.js" */
import { firstValue, isBlank } from "../../labels/template.js";

/**
 * A template of your own on the label, filled in.
 * @param {object} options
 * @param {PanelHooks} options.panel
 * @returns {Source<LabelDesign> & { show: (design: LabelDesign) => void, clear: () => void }}
 */
export function createLabelSource({ panel }) {
  /** @type {LabelDesign | undefined} */
  let design;

  /** @param {LabelDesign} next */
  function show(next) {
    const same = panel.isActive("label") && design?.template.id === next.template.id;
    design = next;
    panel.refresh({ quiet: same && panel.hasPage() });
  }

  return {
    type: "label",
    show,

    clear() {
      design = undefined;
    },

    design: () => design,

    heading() {
      if (!design) return { name: "", detail: "" };
      const { template, rows } = design;
      const detail = rows.length === 1 ? firstValue(template, rows[0]) : `${rows.length} labels`;
      return { name: template.name.trim() || "Untitled template", detail };
    },

    empty() {
      if (!design) return true;
      const { template, rows } = design;
      return rows.length === 0 || rows.every((values) => isBlank(template, values));
    },
    usesDarkness: () => false,
    showOptions() {},
    load: show,
    options: () => undefined,
    restoreOptions() {},
  };
}
