/** @import { Row } from "./template.js" */

/**
 * Moving a block around the label with four arrows, the way the label reads. Left and right swap
 * it with its neighbour in the row. Up and down take it into the row that way when the row has
 * room, else onto a row of its own one step that way; a block alone on its row swaps rows with a
 * full one. Every move is undone by the opposite arrow, or two.
 */

/** How many blocks can share a row. */
export const MOST_IN_A_ROW = 3;

/**
 * The rows with a block swapped with its neighbour, or undefined when it has none that way.
 * @param {Row[]} rows
 * @param {number} row
 * @param {number} position
 * @param {-1 | 1} step
 * @returns {Row[] | undefined}
 */
export function movedInRow(rows, row, position, step) {
  const blocks = [...rows[row].blocks];
  const other = position + step;
  if (other < 0 || other >= blocks.length) return undefined;
  [blocks[position], blocks[other]] = [blocks[other], blocks[position]];
  return rows.map((current, index) => (index === row ? { blocks } : current));
}

/**
 * The rows with a block moved up or down, or undefined when it is as far as it goes.
 * @param {Row[]} rows
 * @param {number} row
 * @param {number} position
 * @param {-1 | 1} step
 * @returns {Row[] | undefined}
 */
export function movedBetweenRows(rows, row, position, step) {
  const block = rows[row].blocks[position];
  const alone = rows[row].blocks.length === 1;
  const neighbour = rows[row + step];
  const next = rows.map((current, index) =>
    index === row ? { blocks: current.blocks.filter((_, i) => i !== position) } : current,
  );
  const ownRow = () => next.splice(step < 0 ? row : row + 1, 0, { blocks: [block] });
  if (!neighbour) {
    if (alone) return undefined;
    ownRow();
  } else if (neighbour.blocks.length < MOST_IN_A_ROW) {
    next[row + step] = { blocks: step < 0 ? [...neighbour.blocks, block] : [block, ...neighbour.blocks] };
  } else if (alone) {
    next[row] = neighbour;
    next[row + step] = { blocks: [block] };
  } else {
    ownRow();
  }
  return next.filter(({ blocks }) => blocks.length > 0);
}
