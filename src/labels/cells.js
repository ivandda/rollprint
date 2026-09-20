/** @import { Cell, Part, Split } from "./template.js" */

/**
 * The cells of a label as a tree: a cell is a part, or nothing yet, or a split into two cells. The
 * designer builds the tree with these, one change at a time; nothing here changes a tree in place.
 */

/** Where a cell is: which way to go at each split, from the top. @typedef {("first" | "second")[]} Path */

/** Whether a cell is split in two. @param {Cell} cell @returns {cell is Split} */
export const isSplit = (cell) => "split" in cell;

/**
 * The cells that hold something, or could, in reading order, each with where it is.
 * @param {Cell} cell
 * @param {Path} [path]
 * @returns {{ leaf: { part?: Part }, path: Path }[]}
 */
export function leavesOf(cell, path = []) {
  if (!isSplit(cell)) return [{ leaf: cell, path }];
  return [...leavesOf(cell.first, [...path, "first"]), ...leavesOf(cell.second, [...path, "second"])];
}

/**
 * The cell at a path.
 * @param {Cell} cell
 * @param {Path} path
 * @returns {Cell}
 */
export function cellAt(cell, path) {
  let found = cell;
  for (const step of path) {
    if (!isSplit(found)) throw new Error("No cell there");
    found = found[step];
  }
  return found;
}

/**
 * The tree with the cell at a path replaced.
 * @param {Cell} cell
 * @param {Path} path
 * @param {Cell} replacement
 * @returns {Cell}
 */
export function replaceAt(cell, path, replacement) {
  if (path.length === 0) return replacement;
  if (!isSplit(cell)) return cell;
  const [step, ...rest] = path;
  return { ...cell, [step]: replaceAt(cell[step], rest, replacement) };
}

/**
 * The tree with a cell split in two halves, what it held staying in the first.
 * @param {Cell} cell
 * @param {Path} path
 * @param {Split["split"]} split
 */
export function splitAt(cell, path, split) {
  return replaceAt(cell, path, { split, share: 1 / 2, first: cellAt(cell, path), second: {} });
}

/**
 * The tree without a cell: the other half of its split takes the split's place. The only cell
 * can't go, so it is emptied instead.
 * @param {Cell} cell
 * @param {Path} path
 */
export function removeAt(cell, path) {
  if (path.length === 0) return {};
  const above = path.slice(0, -1);
  const parent = cellAt(cell, above);
  if (!isSplit(parent)) return cell;
  return replaceAt(cell, above, path.at(-1) === "first" ? parent.second : parent.first);
}

/**
 * The share of its split a cell has, or undefined for the only cell.
 * @param {Cell} cell
 * @param {Path} path
 */
export function shareOf(cell, path) {
  if (path.length === 0) return undefined;
  const parent = cellAt(cell, path.slice(0, -1));
  if (!isSplit(parent)) return undefined;
  return path.at(-1) === "first" ? parent.share : 1 - parent.share;
}

/**
 * The tree with a cell given a share of its split; the other half gets the rest.
 * @param {Cell} cell
 * @param {Path} path
 * @param {number} share
 */
export function withShare(cell, path, share) {
  if (path.length === 0) return cell;
  const above = path.slice(0, -1);
  const parent = cellAt(cell, above);
  if (!isSplit(parent)) return cell;
  return replaceAt(cell, above, { ...parent, share: path.at(-1) === "first" ? share : 1 - share });
}

/**
 * The tree with a cell holding a part, or nothing.
 * @param {Cell} cell
 * @param {Path} path
 * @param {Part | undefined} part
 */
export function withPart(cell, path, part) {
  return replaceAt(cell, path, part ? { part } : {});
}

/**
 * Cells laid out one after another, each taking its weight of the room: nested splits, the first
 * taking its share and the rest sharing what is left.
 * @param {Split["split"]} split
 * @param {Cell[]} cells
 * @param {number[]} weights
 * @returns {Cell}
 */
export function splitAll(split, cells, weights) {
  if (cells.length === 0) return {};
  if (cells.length === 1) return cells[0];
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const share = total > 0 ? weights[0] / total : 1 / cells.length;
  return { split, share, first: cells[0], second: splitAll(split, cells.slice(1), weights.slice(1)) };
}
