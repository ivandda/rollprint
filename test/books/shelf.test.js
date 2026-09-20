import assert from "node:assert/strict";
import { test } from "node:test";
/** @import { ShelfBook } from "../../src/books/shelf.js" */
import {
  addBook,
  bookCoverUrl,
  MAX_BOOKS,
  MAX_COPIES,
  readShelf,
  setCount,
  setHighRes,
  shelfTotal,
} from "../../src/books/shelf.js";

/** @param {number} n */
const found = (n) => ({ id: `OL${n}W`, title: `Book ${n}`, author: "Someone", year: 1999, cover: n });

test("a book picked twice is counted twice instead of listed twice", () => {
  const shelf = addBook(addBook([], found(1)), found(1));
  assert.equal(shelf.length, 1);
  assert.equal(shelf[0].count, 2);
});

test("a shelf can't grow past its limit", () => {
  /** @type {ShelfBook[]} */
  let shelf = [];
  for (let n = 0; n <= MAX_BOOKS + 5; n++) shelf = addBook(shelf, found(n));
  assert.equal(shelf.length, MAX_BOOKS);
});

test("counting a book down to none takes it off the shelf", () => {
  const shelf = addBook(addBook([], found(1)), found(2));
  assert.deepEqual(
    setCount(shelf, "OL1W", 0).map(({ id }) => id),
    ["OL2W"],
  );
});

test("a count is a whole number within the limit", () => {
  const shelf = addBook([], found(1));
  assert.equal(setCount(shelf, "OL1W", 3.6)[0].count, 4);
  assert.equal(setCount(shelf, "OL1W", MAX_COPIES + 10)[0].count, MAX_COPIES);
  assert.equal(setCount(shelf, "OL1W", Number.NaN).length, 0);
});

test("the total counts every copy", () => {
  const shelf = setCount(addBook(addBook([], found(1)), found(2)), "OL1W", 4);
  assert.equal(shelfTotal(shelf), 5);
});

test("a sharper cover is printed instead of Open Library's, and can be put back", () => {
  const url = "https://is1-ssl.mzstatic.com/image/thumb/a/b/c.jpg/1400x1400bb.jpg";
  const shelf = setHighRes(addBook([], found(7)), "OL7W", url);
  assert.equal(bookCoverUrl(shelf[0]), url);
  const back = setHighRes(shelf, "OL7W", undefined);
  assert.equal(bookCoverUrl(back[0]), "https://covers.openlibrary.org/b/id/7-L.jpg");
  assert.ok(!("highRes" in back[0]), "the sharper cover is forgotten, not left as undefined");
});

test("a book with no cover at all has nothing to print", () => {
  assert.equal(bookCoverUrl({ id: "x", title: "X", author: "", count: 1 }), undefined);
});

test("saved shelves are read back without trusting what they say", () => {
  const shelf = readShelf([
    { id: "ok", title: "  Kept  ", author: " A ", year: 1970, cover: 5, count: "3" },
    { id: "ok", title: "Duplicate id", cover: 6, count: 1 },
    { id: "nocover", title: "Nothing to print", count: 1 },
    { id: "blank", title: "   ", cover: 7, count: 1 },
    { id: "nocount", title: "Counted at least once", cover: 8, count: 0 },
    "not an object",
    null,
  ]);
  assert.deepEqual(
    shelf.map(({ id, title, author, count }) => ({ id, title, author, count })),
    [
      { id: "ok", title: "Kept", author: "A", count: 3 },
      { id: "nocount", title: "Counted at least once", author: "", count: 1 },
    ],
  );
});

test("a saved cover address may only point at the hosts covers come from", () => {
  /** @param {unknown} highRes */
  const address = (highRes) => readShelf([{ id: "a", title: "A", highRes, count: 1 }])[0]?.highRes;
  assert.equal(
    address("https://covers.openlibrary.org/b/id/1-L.jpg"),
    "https://covers.openlibrary.org/b/id/1-L.jpg",
  );
  assert.match(String(address("https://is5-ssl.mzstatic.com/image/thumb/x/1400x1400bb.jpg")), /mzstatic/);
  assert.equal(address("https://example.com/tracker.gif"), undefined);
  assert.equal(address("http://covers.openlibrary.org/b/id/1-L.jpg"), undefined, "https only");
  assert.equal(address("javascript:alert(1)"), undefined);
  assert.equal(address("not a url"), undefined);
});

test("readShelf ignores anything that isn't a list", () => {
  assert.deepEqual(readShelf(undefined), []);
  assert.deepEqual(readShelf({ id: "a" }), []);
});
