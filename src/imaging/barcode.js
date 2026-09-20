/**
 * Code 128 barcodes: any printable ASCII, with runs of digits packed two to a symbol. The result is
 * a list of bar and space widths in modules, to be drawn at whatever module width scans.
 */

/** Bar and space widths of every symbol, in modules; value 106 is the stop symbol. */
const PATTERNS = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "2331112",
];

const START_B = 104;
const START_C = 105;
const CODE_C = 99;
const CODE_B = 100;
const STOP = 106;
/** Blank modules on each side, so a scanner finds the edges. */
export const QUIET_ZONE = 10;

/**
 * Text as Code 128 carries it: characters outside printable ASCII become "?".
 * @param {string} text
 */
export function code128Text(text) {
  return [...text]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code <= 126 ? char : "?";
    })
    .join("");
}

/**
 * The symbol values for text, choosing subset C for runs of four or more digits (two per symbol) and
 * subset B otherwise.
 * @param {string} text
 * @returns {number[]}  Without the checksum and stop.
 */
export function code128Values(text) {
  const chars = [...code128Text(text)];
  /** @type {number[]} */
  const values = [];
  /** @type {"B" | "C" | undefined} */
  let subset;
  let i = 0;
  /** @param {number} at */
  const digitsFrom = (at) => {
    let n = 0;
    while (at + n < chars.length && /\d/.test(chars[at + n])) n++;
    return n;
  };
  while (i < chars.length) {
    const digits = digitsFrom(i);
    const wantC = digits >= 4 || (digits >= 2 && i + digits === chars.length && subset === "C");
    if (wantC && subset !== "C") {
      values.push(subset === undefined ? START_C : CODE_C);
      subset = "C";
    } else if (!wantC && subset !== "B") {
      values.push(subset === undefined ? START_B : CODE_B);
      subset = "B";
    }
    if (subset === "C") {
      values.push(Number(chars[i] + chars[i + 1]));
      i += 2;
      // An odd digit left over goes in subset B.
      if (digitsFrom(i) === 1) {
        values.push(CODE_B);
        subset = "B";
      }
    } else {
      values.push(chars[i].charCodeAt(0) - 32);
      i += 1;
    }
  }
  if (values.length === 0) values.push(START_B);
  return values;
}

/**
 * The checksum symbol: the start value plus each value weighted by its position, modulo 103.
 * @param {number[]} values
 */
export const code128Checksum = (values) =>
  values.reduce((sum, value, index) => sum + value * Math.max(1, index), 0) % 103;

/**
 * A Code 128 barcode as bars and spaces, starting with a bar: widths in modules, quiet zones not
 * included.
 * @param {string} text
 * @returns {number[]}
 */
export function code128(text) {
  const values = code128Values(text);
  const symbols = [...values, code128Checksum(values), STOP];
  return symbols.flatMap((value) => [...PATTERNS[value]].map(Number));
}

/**
 * The width of a barcode in modules, quiet zones included.
 * @param {number[]} widths  From code128().
 */
export const barcodeModules = (widths) => widths.reduce((sum, width) => sum + width, 0) + 2 * QUIET_ZONE;
