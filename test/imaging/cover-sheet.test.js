import assert from "node:assert/strict";
import { test } from "node:test";
import { COVER_ASPECT, COVER_SIZES } from "../../src/books/shelf.js";
import { layoutCovers } from "../../src/imaging/cover-sheet.js";
import { MEDIA } from "../../src/printers/brother-ql/media.js";

/** @param {string} id */
function media(id) {
  const found = MEDIA.find((label) => label.id === id);
  assert.ok(found, `unknown label ${id}`);
  return found;
}

/**
 * @param {number} count
 * @param {number} [cover]
 */
const shelf = (count, cover = 1) => [
  { id: `OL${cover}W`, title: "Dune", author: "Frank Herbert", cover, count },
];

const SIZES = /** @type {(keyof typeof COVER_SIZES)[]} */ (Object.keys(COVER_SIZES));

test("every size divides the label's width exactly, leaving no blank strip", () => {
  const label = media("62");
  for (const size of SIZES) {
    const [page] = layoutCovers(shelf(COVER_SIZES[size].across), size, label);
    const row = page.covers;
    assert.equal(row.length, COVER_SIZES[size].across, size);
    assert.equal(row[0].cell.x, 0, size);
    for (const [index, { cell }] of row.entries()) {
      if (index > 0) assert.equal(cell.x, row[index - 1].cell.x + row[index - 1].cell.width, size);
    }
    const last = row.at(-1);
    assert.ok(last);
    assert.equal(last.cell.x + last.cell.width, label.printableWidth, size);
  }
});

test("a cover fills its cell when the label is long enough for it", () => {
  const [page] = layoutCovers(shelf(2), "large", media("62"));
  for (const { cell, cover } of page.covers) {
    assert.deepEqual({ ...cover }, { ...cell });
    assert.equal(cover.height, Math.round(cover.width * COVER_ASPECT));
  }
});

test("rows stack with no space and continue onto the next label when one is full", () => {
  const label = media("62x100");
  const pages = layoutCovers(shelf(10), "medium", label);
  const { height } = pages[0].covers[0].cell;
  const perPage = 3 * Math.floor(label.printableHeight / height);
  assert.deepEqual(
    pages.map((page) => page.covers.length),
    [perPage, 10 - perPage].filter(Boolean),
  );
  for (const page of pages) {
    for (const [index, { cell }] of page.covers.entries()) {
      assert.equal(cell.y, Math.floor(index / 3) * height);
    }
  }
});

test("a cover too tall for the label shrinks and centres instead of being cut in half", () => {
  const label = media("62x29");
  const [page] = layoutCovers(shelf(2), "large", label);
  for (const { cell, cover } of page.covers) {
    assert.equal(cell.height, label.printableHeight, "the cell still fills the label");
    assert.ok(cover.width < cell.width, "the cover narrows to keep its shape");
    // A whole number of dots can be half a dot off the exact proportion, which no one can see.
    assert.ok(Math.abs(cover.height - cover.width * COVER_ASPECT) <= 1, "still cover-shaped");
    const before = cover.x - cell.x;
    const after = cell.x + cell.width - (cover.x + cover.width);
    assert.ok(Math.abs(before - after) <= 1, `centred: ${before} before, ${after} after`);
  }
});

test("a full-label cover is the largest one the label fits", () => {
  const [tall] = layoutCovers(shelf(1), "full", media("62x100"));
  const { cover } = tall.covers[0];
  assert.equal(cover.width, media("62x100").printableWidth, "as wide as the label");
  assert.equal(cover.height, Math.round(cover.width * COVER_ASPECT));

  const [short] = layoutCovers(shelf(1), "full", media("62x29"));
  assert.equal(short.covers[0].cover.height, media("62x29").printableHeight, "as tall as the label");
});

test("a continuous roll is cut to the length the covers need", () => {
  const label = media("62");
  const [page] = layoutCovers(shelf(4), "large", label);
  const rows = 2;
  assert.equal(page.height, rows * page.covers[0].cell.height);
  assert.equal(page.area.height, page.height);
});

test("an empty shelf still makes one blank page, so the preview has something to show", () => {
  const pages = layoutCovers([], "medium", media("62"));
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0].covers, []);
  assert.ok(pages[0].height > 0);
});

test("a round label keeps the covers inside the square that fits the circle", () => {
  const label = media("d24");
  const [page] = layoutCovers(shelf(2), "large", label);
  assert.ok(page.area.x > 0, "inset from the label's edge");
  assert.equal(page.area.width, page.area.height, "a square");
  assert.equal(page.covers[0].cell.x, page.area.x);
  const last = page.covers.at(-1);
  assert.ok(last);
  assert.equal(last.cell.x + last.cell.width, page.area.x + page.area.width);
});

test("each book prints as many covers as its count says, in the order of the shelf", () => {
  const books = [
    { id: "a", title: "A", author: "", cover: 1, count: 2 },
    { id: "b", title: "B", author: "", cover: 2, count: 1 },
    { id: "c", title: "C", author: "", cover: 3, count: 3 },
  ];
  const [page] = layoutCovers(books, "small", media("62"));
  assert.deepEqual(
    page.covers.map(({ book }) => book.id),
    ["a", "a", "b", "c", "c", "c"],
  );
});
