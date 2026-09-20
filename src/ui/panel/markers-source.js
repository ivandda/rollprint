/** @import { MarkersDesign } from "../../designs.js" */
/** @import { MarkerSelection } from "../../markers.js" */
/** @import { PanelHooks, Source } from "./source.js" */
import { pageCount } from "../../designs.js";
import { markerTotal } from "../../markers.js";

/**
 * Markers on the label, packed onto as few pages as they need.
 * @param {object} options
 * @param {PanelHooks} options.panel
 * @returns {Source<MarkersDesign> & { show: (selection: MarkerSelection) => void }}
 */
export function createMarkersSource({ panel }) {
  /** @type {MarkerSelection} */
  let selection = { counts: {}, custom: [] };

  const design = () => {
    const { counts, custom } = selection;
    return /** @type {MarkersDesign} */ ({
      type: "markers",
      counts,
      custom: custom.filter(({ id }) => counts[id]),
    });
  };

  /** @param {MarkerSelection} next */
  function show(next) {
    const same = panel.isActive("markers");
    selection = next;
    panel.refresh({ quiet: same && panel.hasPage() });
  }

  return {
    type: "markers",
    show,
    design,

    heading(media) {
      const total = markerTotal(selection.counts);
      const sheets = pageCount(design(), media);
      return {
        name: "Markers",
        detail:
          total === 0
            ? "Pick markers to print"
            : `${total} ${total === 1 ? "marker" : "markers"} on ${sheets} ${sheets === 1 ? "page" : "pages"}`,
      };
    },

    empty: () => markerTotal(selection.counts) === 0,
    usesDarkness: () => false,
    showOptions() {},

    load(saved) {
      show({ counts: saved.counts, custom: saved.custom ?? [] });
    },

    options: () => undefined,
    restoreOptions() {},
  };
}
