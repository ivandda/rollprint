import assert from "node:assert/strict";
import { test } from "node:test";
import { movedBetweenRows, movedInRow } from "../../src/labels/arrange.js";
import { textBlock } from "../../src/labels/template.js";

/** @param {string} text */
const block = (text) => textBlock({ text });
/** Rows written as strings, one letter per block, e.g. "AB C" is [A B] over [C]. @param {string} picture */
const rows = (picture) => picture.split(" ").map((row) => ({ blocks: [...row].map(block) }));
/** @param {import("../../src/labels/template.js").Row[] | undefined} result */
const picture = (result) =>
  result?.map(({ blocks }) => blocks.map((b) => (b.type === "text" ? b.text : "?")).join("")).join(" ");

test("left and right swap a block with its neighbour in the row, and stop at the ends", () => {
  assert.equal(picture(movedInRow(rows("ABC"), 0, 1, 1)), "ACB");
  assert.equal(picture(movedInRow(rows("ABC"), 0, 1, -1)), "BAC");
  assert.equal(movedInRow(rows("ABC"), 0, 0, -1), undefined);
  assert.equal(movedInRow(rows("ABC"), 0, 2, 1), undefined);
  assert.equal(movedInRow(rows("A B"), 0, 0, 1), undefined);
});

test("up and down take a block into the row that way when it has room", () => {
  assert.equal(picture(movedBetweenRows(rows("A B"), 1, 0, -1)), "AB");
  assert.equal(picture(movedBetweenRows(rows("AB C"), 0, 1, 1)), "A BC");
  // It joins at the near end, so the reading order is kept.
  assert.equal(picture(movedBetweenRows(rows("A BC"), 1, 1, -1)), "AC B");
});

test("a block leaving a shared row gets a row of its own when there is no room that way", () => {
  assert.equal(picture(movedBetweenRows(rows("AB"), 0, 1, -1)), "B A");
  assert.equal(picture(movedBetweenRows(rows("AB"), 0, 0, 1)), "B A");
  assert.equal(picture(movedBetweenRows(rows("ABC DE"), 1, 0, -1)), "ABC D E");
});

test("a block alone on its row swaps rows with a full one, and stops at the edge", () => {
  assert.equal(picture(movedBetweenRows(rows("ABC D"), 1, 0, -1)), "D ABC");
  assert.equal(picture(movedBetweenRows(rows("A BCD"), 0, 0, 1)), "BCD A");
  assert.equal(movedBetweenRows(rows("A B"), 0, 0, -1), undefined);
  assert.equal(movedBetweenRows(rows("A B"), 1, 0, 1), undefined);
});

test("every move is undone by the opposite arrow, or by two", () => {
  const joined = movedBetweenRows(rows("A B"), 1, 0, -1);
  assert.equal(picture(joined), "AB");
  assert.equal(picture(joined && movedBetweenRows(joined, 0, 1, 1)), "A B");
  const above = joined && movedBetweenRows(joined, 0, 1, -1);
  assert.equal(picture(above), "B A");
});
