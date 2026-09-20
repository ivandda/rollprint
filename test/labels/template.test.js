import assert from "node:assert/strict";
import { test } from "node:test";
import { STARTERS } from "../../src/labels/starters.js";
import { fieldsOf, fill, firstValue, isBlank, sampleValues, textBlock } from "../../src/labels/template.js";

/** @type {import("../../src/labels/template.js").LabelTemplate} */
const PRODUCT = {
  id: "t1",
  name: "Product",
  orientation: "portrait",
  border: "thin",
  margin: "m",
  rows: [
    { blocks: [textBlock({ heading: "{Product}", text: "Batch {Batch} · best before {Date}" })] },
    { blocks: [textBlock({ text: "{Notes}" }), textBlock({ text: "Made by {Product} Co." })] },
  ],
};

test("fields come from placeholders once each, in order; a whole-text placeholder takes lines", () => {
  assert.deepEqual(fieldsOf(PRODUCT), [
    { name: "Product", multiline: false },
    { name: "Batch", multiline: false },
    { name: "Date", multiline: false },
    { name: "Notes", multiline: true },
  ]);
});

test("a name used both alone and inside a line can hold lines", () => {
  const template = {
    ...PRODUCT,
    rows: [{ blocks: [textBlock({ heading: "Re: {Notes}", text: "{Notes}" })] }],
  };
  assert.deepEqual(fieldsOf(template), [{ name: "Notes", multiline: true }]);
});

test("filling replaces placeholders and leaves nothing for missing values", () => {
  assert.equal(fill("Batch {Batch} · {Date}", { Batch: "7" }), "Batch 7 · ");
  assert.equal(fill("No fields", {}), "No fields");
  assert.equal(fill("{ Spaced }", { Spaced: "ok" }), "ok");
});

test("sample values name the fields, so the designer sees where they go", () => {
  assert.deepEqual(sampleValues(PRODUCT), {
    Product: "Product",
    Batch: "Batch",
    Date: "Date",
    Notes: "Notes",
  });
});

test("a label is blank when every field is empty, never when there are no fields", () => {
  assert.equal(isBlank(PRODUCT, {}), true);
  assert.equal(isBlank(PRODUCT, { Notes: "  " }), true);
  assert.equal(isBlank(PRODUCT, { Date: "2026" }), false);
  assert.equal(isBlank({ ...PRODUCT, rows: [{ blocks: [textBlock({ text: "Fixed" })] }] }, {}), false);
});

test("a field named like something every object has is only a field", () => {
  const t = { ...PRODUCT, rows: [{ blocks: [textBlock({ text: "{constructor} {toString}" })] }] };
  assert.equal(isBlank(t, {}), true);
  assert.equal(fill("{constructor} {toString}", {}), " ");
  assert.equal(firstValue(t, { toString: "x" }), "x");
});

test("the first value stands for the label, on one line", () => {
  assert.equal(firstValue(PRODUCT, { Batch: "7" }), "7");
  assert.equal(firstValue(PRODUCT, { Notes: "line one\nline two" }), "line one");
  assert.equal(firstValue(PRODUCT, {}), "");
});

test("every starter has a distinct ID and at least one field", () => {
  assert.equal(new Set(STARTERS.map(({ id }) => id)).size, STARTERS.length);
  for (const starter of STARTERS) assert.ok(fieldsOf(starter).length > 0, starter.name);
});
