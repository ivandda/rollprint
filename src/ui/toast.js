import { element } from "./dom.js";

const SHOWN_MS = 4000;
const SHOWN_WITH_ACTION_MS = 7000;
const MOST_SHOWN = 3;

/**
 * A short confirmation at the bottom of the screen that goes away by itself, such as "Added to the
 * print list". Problems and anything that needs reading stay on the page instead.
 * @param {string} text
 * @param {{ text: string, onClick: () => void }} [action]  A button in the toast, e.g. Open.
 */
export function toast(text, action) {
  const stack = element("#toasts", HTMLElement);
  const item = Object.assign(document.createElement("output"), { className: "toast" });
  item.append(Object.assign(document.createElement("span"), { textContent: text }));
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    item.remove();
    if (stack.childElementCount === 0) stack.hidePopover();
  };
  if (action) {
    const button = Object.assign(document.createElement("button"), {
      type: "button",
      textContent: action.text,
    });
    button.addEventListener("click", () => {
      dismiss();
      action.onClick();
    });
    item.append(button);
  }
  while (stack.childElementCount >= MOST_SHOWN) stack.firstElementChild?.remove();
  stack.append(item);
  // Shown again each time so the stack sits above a sheet opened after the last toast.
  if (stack.matches(":popover-open")) stack.hidePopover();
  stack.showPopover();
  timer = setTimeout(dismiss, action ? SHOWN_WITH_ACTION_MS : SHOWN_MS);
}
