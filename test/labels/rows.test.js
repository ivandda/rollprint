import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRows, rowsToText } from "../../src/labels/rows.js";

const FIELDS = [
  { name: "Product", multiline: false },
  { name: "Price", multiline: false },
];

test("one label per line, columns in the fields' order, blank lines skipped", () => {
  assert.deepEqual(parseRows("Honey, 5\n\nJam,4\n", FIELDS), [
    { Product: "Honey", Price: "5" },
    { Product: "Jam", Price: "4" },
  ]);
});

test("tabs win over commas when the text has any", () => {
  assert.deepEqual(parseRows("Honey, raw\t5\nJam\t4", FIELDS), [
    { Product: "Honey, raw", Price: "5" },
    { Product: "Jam", Price: "4" },
  ]);
});

test("a first line of field names sets which column is which", () => {
  assert.deepEqual(parseRows("price,PRODUCT\n5,Honey", FIELDS), [{ Product: "Honey", Price: "5" }]);
  // A line that only looks like a header is data.
  assert.deepEqual(parseRows("Honey,Price\n5,Jam", FIELDS), [
    { Product: "Honey", Price: "Price" },
    { Product: "5", Price: "Jam" },
  ]);
});

test("quotes protect commas and doubled quotes are one", () => {
  assert.deepEqual(parseRows('"Honey, raw",5\n"Say ""hi""",4', FIELDS), [
    { Product: "Honey, raw", Price: "5" },
    { Product: 'Say "hi"', Price: "4" },
  ]);
});

test("with one field, a line is the value, commas and all", () => {
  const [address] = FIELDS;
  assert.deepEqual(parseRows('12 Main St, Springfield\n"Quoted", too', [address]), [
    { Product: "12 Main St, Springfield" },
    { Product: '"Quoted", too' },
  ]);
  const text = rowsToText([{ Product: "12 Main St, Springfield" }], [address]);
  assert.deepEqual(parseRows(text, [address]), [{ Product: "12 Main St, Springfield" }]);
});

test("extra cells are dropped and missing ones left out", () => {
  assert.deepEqual(parseRows("Honey,5,extra\nJam", FIELDS), [
    { Product: "Honey", Price: "5" },
    { Product: "Jam" },
  ]);
});

test("rows written as text read back the same, with newlines flattened", () => {
  const rows = [
    { Product: "Honey\nraw", Price: "5" },
    { Product: "Jam", Price: "" },
  ];
  const text = rowsToText(rows, FIELDS);
  assert.equal(text, "Product\tPrice\nHoney raw\t5\nJam\t");
  assert.deepEqual(parseRows(text, FIELDS), [
    { Product: "Honey raw", Price: "5" },
    { Product: "Jam", Price: "" },
  ]);
});
