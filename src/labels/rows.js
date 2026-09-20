/** @import { Field, Values } from "./template.js" */

/**
 * Values for many labels from pasted text: one label per line. With several fields, the cells are
 * separated by tabs, or by commas when there are no tabs (quotes protect commas, as in a CSV). A
 * first line made only of field names sets which column is which; otherwise the columns follow
 * the fields' order. Blank lines are skipped.
 * @param {string} text
 * @param {Field[]} fields
 * @returns {Values[]}
 */
export function parseRows(text, fields) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0 || fields.length === 0) return [];
  const separator = text.includes("\t") ? "\t" : ",";
  const rows = lines.map((line) => splitLine(line, separator));
  const names = fields.map(({ name }) => name);
  const lower = names.map((name) => name.toLowerCase());
  const first = rows[0].map((cell) => cell.trim().toLowerCase());
  const hasHeader = first.length > 0 && first.every((cell) => lower.includes(cell)) && first.some(Boolean);
  const order = hasHeader ? first.map((cell) => names[lower.indexOf(cell)]) : names;
  return rows.slice(hasHeader ? 1 : 0).map((cells) => {
    /** @type {Values} */
    const values = {};
    cells.forEach((cell, index) => {
      const name = order[index];
      if (name !== undefined) values[name] = cell.trim();
    });
    return values;
  });
}

/**
 * The cells of one line. Commas inside double quotes don't split, and doubled quotes are one.
 * @param {string} line
 * @param {string} separator
 */
function splitLine(line, separator) {
  if (separator === "\t") return line.split("\t");
  /** @type {string[]} */
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else cell += char;
  }
  cells.push(cell);
  return cells;
}

/**
 * Rows as text that parseRows reads back: a header line, then tab-separated cells, so a list from
 * the print list can be changed. Newlines inside a value become spaces.
 * @param {Values[]} rows
 * @param {Field[]} fields
 */
export function rowsToText(rows, fields) {
  const names = fields.map(({ name }) => name);
  const lines = rows.map((values) =>
    names.map((name) => (values[name] ?? "").replace(/\s*\n\s*/g, " ")).join("\t"),
  );
  return [names.join("\t"), ...lines].join("\n");
}
