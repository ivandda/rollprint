import { addressParam, updateAddress } from "./address.js";
import { dropDown, element } from "./dom.js";
import { readSetting, writeSetting } from "./settings.js";

/** @typedef {"find" | "create" | "markers" | "deck" | "labels" | "templates"} Mode */
/** @typedef {"cards" | "labels"} Space */

/** The two halves of the app: Magic cards, and labels of your own. Each has its own modes. */
const SPACES = /** @type {const} */ ({
  cards: { name: "Cards", home: "find", modes: ["find", "create", "markers", "deck"] },
  labels: { name: "Labels", home: "labels", modes: ["labels", "templates"] },
});

/** @type {Record<Mode, string>} */
const BACK_LABELS = {
  find: "Back to results",
  create: "Back to the card",
  markers: "Back to the markers",
  deck: "Back to the deck",
  labels: "Back to the fields",
  templates: "Back to the template",
};

/** @param {Mode} mode */
const spaceOf = (mode) => (SPACES.labels.modes.some((other) => other === mode) ? "labels" : "cards");

/** @param {unknown} value */
const isMode = (value) => Object.values(SPACES).some(({ modes }) => modes.some((mode) => mode === value));

/**
 * Which half of the app is shown, chosen from the menu on the header, and which of its tabs. The
 * choice is kept in the address, and the half in this browser for next time.
 * @param {(mode: Mode) => void} onChange
 */
export function createModes(onChange) {
  const inputs = [...document.querySelectorAll('input[name="mode"]')].filter(
    (input) => input instanceof HTMLInputElement,
  );
  const back = element("#back", HTMLButtonElement);
  const switcher = element("#mode-switch", HTMLButtonElement);
  const spaceName = element("#mode-name", HTMLElement);
  const menu = element("#mode-menu", HTMLElement);
  const options = [...menu.querySelectorAll("button")];
  const current = () => /** @type {Mode} */ (document.body.dataset.mode);

  /** @param {Mode} mode */
  function show(mode) {
    const space = spaceOf(mode);
    for (const input of inputs) input.checked = input.value === mode;
    document.body.dataset.mode = mode;
    document.body.dataset.space = space;
    spaceName.textContent = SPACES[space].name;
    for (const option of options) {
      if (option.dataset.space === space) option.setAttribute("aria-current", "true");
      else option.removeAttribute("aria-current");
    }
    document.title = space === "cards" ? "Rollprint" : "Labels · Rollprint";
    back.textContent = BACK_LABELS[mode];
    writeSetting("space", space);
    rememberMode();
    onChange(mode);
  }

  function rememberMode() {
    updateAddress({ mode: current() === "find" ? undefined : current() });
  }

  for (const input of inputs) {
    input.addEventListener("change", () => show(/** @type {Mode} */ (input.value)));
  }
  for (const option of options) {
    option.addEventListener("click", () => {
      menu.hidePopover();
      const space = /** @type {Space} */ (option.dataset.space);
      if (space !== spaceOf(current())) show(SPACES[space].home);
    });
  }
  dropDown(menu, switcher);
  menu.addEventListener("toggle", (event) => {
    if (!(event instanceof ToggleEvent) || event.newState !== "open") return;
    options.find((option) => option.dataset.space === document.body.dataset.space)?.focus();
  });
  // Going back returns to an address saved before the mode may have changed, so it is written again.
  addEventListener("popstate", rememberMode);

  const linked = addressParam("mode");
  if (isMode(linked)) show(/** @type {Mode} */ (linked));
  else if (linked === null && readSetting("space") === "labels" && !addressParam("card")) show("labels");
  else show("find");

  return {
    show,

    /**
     * Whether the other half of the app can be chosen: not while a label from the list is changed,
     * when the tabs are out of reach too.
     * @param {boolean} allowed
     */
    allowSwitching(allowed) {
      switcher.disabled = !allowed;
    },

    /** Puts the Back button's label back, after it pointed at the print list. */
    refreshBack() {
      back.textContent = BACK_LABELS[current()];
    },
  };
}
