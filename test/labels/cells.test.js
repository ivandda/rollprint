import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cellAt,
  leavesOf,
  removeAt,
  shareOf,
  splitAll,
  splitAt,
  withPart,
  withShare,
} from "../../src/labels/cells.js";
import { textPart, upgradeTemplate } from "../../src/labels/template.js";

/** @param {string} text @returns {import("../../src/labels/template.js").Cell} */
const leaf = (text) => ({ part: textPart({ text }) });
/** @param {import("../../src/labels/template.js").Cell} cell */
const picture = (cell) =>
  leavesOf(cell)
    .map(({ leaf: l, path }) => `${l.part?.type === "text" ? l.part.text : "·"}@${path.join("/") || "top"}`)
    .join(" ");

/** A on the left; B over C on the right. @type {import("../../src/labels/template.js").Cell} */
const TREE = {
  split: "across",
  share: 1 / 3,
  first: leaf("A"),
  second: { split: "down", share: 1 / 2, first: leaf("B"), second: leaf("C") },
};

test("cells come in reading order, each knowing where it is", () => {
  assert.equal(picture(TREE), "A@first B@second/first C@second/second");
  assert.equal(picture(leaf("Only")), "Only@top");
  assert.deepEqual(cellAt(TREE, ["second", "first"]), leaf("B"));
});

test("splitting a cell keeps what it held in the first half, at half", () => {
  const split = splitAt(TREE, ["first"], "down");
  assert.equal(picture(split), "A@first/first ·@first/second B@second/first C@second/second");
  assert.equal(shareOf(split, ["first", "first"]), 1 / 2);
});

test("removing a cell gives its place to the other half; the only cell is emptied instead", () => {
  assert.equal(picture(removeAt(TREE, ["second", "first"])), "A@first C@second");
  assert.equal(picture(removeAt(TREE, ["first"])), "B@first C@second");
  assert.deepEqual(removeAt(leaf("Only"), []), {});
});

test("a cell's share is of its split, and giving it one leaves the rest to the other half", () => {
  /** @param {number | undefined} a @param {number} b */
  const near = (a, b) => assert.ok(a !== undefined && Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
  near(shareOf(TREE, ["first"]), 1 / 3);
  near(shareOf(TREE, ["second"]), 2 / 3);
  assert.equal(shareOf(TREE, []), undefined);
  const wider = withShare(TREE, ["second"], 1 / 3);
  near(shareOf(wider, ["first"]), 2 / 3);
  assert.equal(withShare(TREE, [], 1 / 3), TREE);
});

test("a cell holds a part, or nothing", () => {
  assert.equal(
    picture(withPart(TREE, ["first"], textPart({ text: "Z" }))),
    "Z@first B@second/first C@second/second",
  );
  assert.equal(picture(withPart(TREE, ["first"], undefined)), "·@first B@second/first C@second/second");
});

test("cells one after another take their weights of the room", () => {
  const cells = [leaf("A"), leaf("B"), leaf("C")];
  const equal = splitAll("down", cells, [1, 1, 1]);
  assert.equal(picture(equal), "A@first B@second/first C@second/second");
  assert.equal(shareOf(equal, ["first"]), 1 / 3);
  assert.equal(shareOf(equal, ["second", "first"]), 1 / 2);
  assert.deepEqual(splitAll("down", [], []), {});
  assert.deepEqual(splitAll("down", [leaf("A")], [1]), leaf("A"));
});

test("a template from before cells, rows of blocks, is brought up to date", () => {
  const old = {
    id: "old",
    name: "Old",
    orientation: "landscape",
    border: "none",
    margin: "m",
    rows: [
      {
        blocks: [
          { type: "image", width: "third", treatment: "logo", show: "fit" },
          {
            type: "text",
            heading: "",
            headingSize: "l",
            text: "{Name}",
            size: "m",
            align: "start",
            bold: false,
          },
        ],
      },
      { blocks: [{ type: "divider", weight: "thick" }] },
      { blocks: [{ type: "space", size: "m" }] },
    ],
  };
  assert.deepEqual(upgradeTemplate(old), {
    id: "old",
    name: "Old",
    orientation: "landscape",
    border: "none",
    margin: "m",
    lines: "thick",
    cell: {
      split: "down",
      share: 1 / 2,
      first: {
        split: "across",
        share: 1 / 3,
        first: { part: { type: "image", treatment: "logo", show: "fit" } },
        second: {
          part: {
            type: "text",
            heading: "",
            headingSize: "l",
            text: "{Name}",
            size: "m",
            align: "start",
            bold: false,
          },
        },
      },
      second: {},
    },
  });
  const current = { id: "new", cell: leaf("A") };
  assert.equal(upgradeTemplate(current), current);
  assert.equal(upgradeTemplate(null), null);
});
