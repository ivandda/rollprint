/**
 * The typefaces a label can use. All are bundled under the SIL Open Font License (src/fonts), so a
 * template prints the same on every computer.
 */
export const FONTS = /** @type {const} */ ({
  sans: { name: "Sans", family: '"Atkinson Hyperlegible Next"' },
  serif: { name: "Serif", family: '"Source Serif 4"' },
  mono: { name: "Mono", family: '"JetBrains Mono"' },
  condensed: { name: "Condensed", family: "Oswald" },
});

/** @typedef {keyof typeof FONTS} FontName */

/**
 * The CSS font for a canvas.
 * @param {number} weight
 * @param {number} size  In pixels.
 * @param {FontName} [name]
 */
export function font(weight, size, name = "sans") {
  return `${weight} ${size}px ${FONTS[name].family}, system-ui, sans-serif`;
}

/**
 * Waits for a typeface, which a canvas doesn't load by itself.
 * @param {FontName} [name]
 */
export async function loadFonts(name = "sans") {
  await Promise.all([document.fonts.load(font(400, 16, name)), document.fonts.load(font(700, 16, name))]);
}
