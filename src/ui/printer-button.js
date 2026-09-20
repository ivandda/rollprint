/** @import { PrinterConnection } from "../printers/connection.js" */
import { drivers } from "../printers/index.js";
import { element } from "./dom.js";

/** @typedef {{ text: string, link?: { href: string, text: string } }} Advice */

const ON_WINDOWS = /Windows/.test(navigator.userAgent);
const WINDOWS_GUIDE = {
  href: "https://github.com/ivandda/rollprint#windows",
  text: "How to set it up",
};

const PRINTER_TIP = [
  "Printer not listed? Check that it's on and plugged in by USB.",
  ...new Set(drivers.flatMap((driver) => driver.setupTip ?? [])),
].join(" ");

/**
 * Gets a printer ready to print. If none is connected the user picks one; otherwise it is checked
 * again, which catches a roll swapped since the last check.
 * @param {PrinterConnection} printer
 * @returns {Promise<Advice>}  What the user should know if the printer isn't ready; empty text if it is.
 */
export async function preparePrinter(printer) {
  if (printer.state.kind === "disconnected") await printer.choose();
  else await printer.refresh();

  const { state } = printer;
  if (state.kind === "disconnected") return { text: PRINTER_TIP };
  if (state.kind === "error" && state.blocked && ON_WINDOWS) {
    return {
      text: "Windows needs a one-time driver change before the browser can use this printer.",
      link: WINDOWS_GUIDE,
    };
  }
  if (state.kind === "error") return { text: `${state.printer}: ${state.message}` };
  return { text: "" };
}

/**
 * The header button that shows the printer's state. Clicking it connects or checks the printer.
 * @param {PrinterConnection} printer
 * @param {(text: string, link?: Advice["link"]) => void} showMessage
 */
export function bindPrinterButton(printer, showMessage) {
  const button = element("#printer", HTMLButtonElement);

  function show() {
    const { state } = printer;
    button.dataset.state = state.kind;
    button.hidden = state.kind === "unsupported";
    button.disabled = state.kind === "connecting";
    if (state.kind === "ready") showText(state.printer, state.media.name);
    else if (state.kind === "error") showText(state.printer, state.message);
    else showText(state.kind === "connecting" ? "Connecting…" : "Connect printer");
  }

  /**
   * @param {string} name
   * @param {string} [detail]
   */
  function showText(name, detail) {
    const parts = detail
      ? [name, Object.assign(document.createElement("span"), { className: "detail", textContent: detail })]
      : [name];
    button.replaceChildren(...parts);
    button.title = detail ? `${name}: ${detail}` : name;
  }

  printer.addEventListener("change", show);
  button.addEventListener("click", async () => {
    const advice = await preparePrinter(printer);
    if (advice.text) showMessage(advice.text, advice.link);
  });
  show();
}
