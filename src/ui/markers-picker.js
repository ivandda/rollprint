/** @import { Marker, MarkerSelection } from "../markers.js" */
import {
  customMarker,
  customMarkers,
  MARKER_GROUPS,
  MARKERS,
  MAX_CUSTOM,
  markerCounts,
  markerTotal,
} from "../markers.js";
import { element, showMessage, showProblem } from "./dom.js";
import { readSetting, writeSetting } from "./settings.js";
import { bindStepper } from "./stepper.js";
import { toast } from "./toast.js";

/**
 * The markers to print and how many of each, including markers typed in, remembered in this browser.
 * @param {object} options
 * @param {(selection: MarkerSelection) => void} options.onChange
 * @param {() => void} options.onPreview  Shows the label, on small screens.
 */
export function createMarkersPicker({ onChange, onPreview }) {
  const ui = {
    groups: element("#marker-groups", HTMLElement),
    template: element("#marker-row", HTMLTemplateElement),
    customList: element("#custom-markers", HTMLUListElement),
    addForm: element("#add-marker", HTMLFormElement),
    addText: element("#marker-text", HTMLInputElement),
    addButton: element("#add-marker-button", HTMLButtonElement),
    customStatus: element("#custom-status", HTMLElement),
    clear: element("#clear-markers", HTMLButtonElement),
    preview: element("#preview-markers", HTMLButtonElement),
  };
  let custom = customMarkers(readSetting("customMarkers"));
  let counts = markerCounts(readSetting("markers"), custom);
  /** Count inputs by marker ID. @type {Map<string, HTMLInputElement>} */
  const inputs = new Map();
  const selection = () => ({ counts, custom });

  ui.groups.replaceChildren(
    ...MARKER_GROUPS.map(({ kind, name }) => {
      const group = Object.assign(document.createElement("section"), { className: "marker-group" });
      const list = document.createElement("ul");
      list.append(...MARKERS.filter((marker) => marker.kind === kind).map(markerRow));
      group.append(Object.assign(document.createElement("h2"), { textContent: name }), list);
      return group;
    }),
  );

  /** @param {Marker} marker */
  function markerRow(marker) {
    const row = /** @type {HTMLElement} */ (ui.template.content.firstElementChild?.cloneNode(true));
    const name = /** @type {HTMLElement} */ (row.querySelector(".marker-name"));
    const input = /** @type {HTMLInputElement} */ (row.querySelector("input"));
    const [fewer, more] = row.querySelectorAll("button");
    name.textContent = marker.name;
    name.id = `marker-${marker.id}`;
    input.setAttribute("aria-labelledby", name.id);
    input.value = String(counts[marker.id] ?? 0);
    fewer.setAttribute("aria-label", `One fewer: ${marker.name}`);
    more.setAttribute("aria-label", `One more: ${marker.name}`);
    inputs.set(marker.id, input);
    bindStepper(
      /** @type {HTMLElement} */ (row.querySelector(".stepper")),
      (count) => update({ ...counts, [marker.id]: count }),
      { min: 0 },
    );
    return row;
  }

  /* Markers typed in */

  /** @param {Marker} marker */
  function customRow(marker) {
    const row = markerRow(marker);
    const remove = Object.assign(document.createElement("button"), {
      type: "button",
      className: "remove",
      textContent: "Remove",
    });
    remove.setAttribute("aria-label", `Remove ${marker.name}`);
    remove.addEventListener("click", () => {
      const index = custom.findIndex((other) => other.id === marker.id);
      custom = custom.filter((other) => other.id !== marker.id);
      inputs.delete(marker.id);
      update(counts);
      showCustom();
      // Keep keyboard focus nearby: on the Remove button now in its place, or on the text field.
      const next = ui.customList.children[Math.min(index, custom.length - 1)]?.querySelector(".remove");
      (next instanceof HTMLElement ? next : ui.addText).focus();
      toast(`Removed ${marker.name}.`);
    });
    row.append(remove);
    return row;
  }

  function showCustom() {
    ui.customList.replaceChildren(...custom.map(customRow));
    ui.customList.hidden = custom.length === 0;
    const full = custom.length >= MAX_CUSTOM;
    ui.addText.disabled = full;
    ui.addButton.disabled = full;
  }

  ui.addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = ui.addText.value.trim();
    if (!name) {
      showProblem(ui.customStatus, "Type the marker's text first.");
      ui.addText.focus();
      return;
    }
    ui.addText.value = "";
    const existing = [...MARKERS, ...custom].find(
      (marker) => marker.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      update({ ...counts, [existing.id]: (counts[existing.id] ?? 0) + 1 });
      const input = inputs.get(existing.id);
      if (input) input.value = String(counts[existing.id] ?? 0);
      showMessage(ui.customStatus, `${existing.name} is already in the list, so it got one more.`);
      return;
    }
    const marker = customMarker(name);
    custom = [...custom, marker];
    update({ ...counts, [marker.id]: 1 });
    showCustom();
    toast(`Added ${marker.name}.`);
    showMessage(
      ui.customStatus,
      custom.length >= MAX_CUSTOM ? "That's the most markers you can add. Remove one to add another." : "",
    );
    ui.addText.focus();
  });

  /** @param {Record<string, number>} next */
  function update(next) {
    counts = markerCounts(next, custom);
    writeSetting("markers", counts);
    writeSetting("customMarkers", custom);
    ui.clear.hidden = markerTotal(counts) === 0;
    onChange(selection());
  }

  /**
   * Shows a marker sheet from the print list, adding any markers typed in that it needs.
   * @param {MarkerSelection} selection
   */
  function show({ counts: next, custom: theirs = [] }) {
    const extra = theirs.filter((marker) => !custom.some((other) => other.id === marker.id));
    if (extra.length > 0) {
      custom = [...custom, ...extra].slice(0, MAX_CUSTOM);
      showCustom();
    }
    counts = markerCounts(next, custom);
    for (const [id, input] of inputs) input.value = String(counts[id] ?? 0);
    writeSetting("markers", counts);
    writeSetting("customMarkers", custom);
    ui.clear.hidden = markerTotal(counts) === 0;
    onChange(selection());
  }

  ui.clear.addEventListener("click", () => {
    for (const input of inputs.values()) input.value = "0";
    update({});
    inputs.values().next().value?.focus();
  });
  ui.preview.addEventListener("click", onPreview);
  showCustom();
  ui.clear.hidden = markerTotal(counts) === 0;

  return { current: selection, show };
}
