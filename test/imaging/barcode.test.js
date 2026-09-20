import assert from "node:assert/strict";
import { test } from "node:test";
import {
  barcodeModules,
  code128,
  code128Checksum,
  code128Values,
  QUIET_ZONE,
} from "../../src/imaging/barcode.js";

test("text is encoded in subset B, with the checksum weighted by position", () => {
  // Start B, then P J J 1 2 3 C: 104 + 48×1 + 42×2 + 42×3 + 17×4 + 18×5 + 19×6 + 35×7 = 879, and 879 mod 103 = 55.
  const values = code128Values("PJJ123C");
  assert.deepEqual(values, [104, 48, 42, 42, 17, 18, 19, 35]);
  assert.equal(code128Checksum(values), 55);
});

test("runs of four or more digits are packed two to a symbol in subset C", () => {
  assert.deepEqual(code128Values("12345678"), [105, 12, 34, 56, 78]);
  assert.deepEqual(code128Values("AB123456"), [104, 33, 34, 99, 12, 34, 56]);
  // An odd digit at the end goes back to subset B.
  assert.deepEqual(code128Values("1234567"), [105, 12, 34, 56, 100, 23]);
  // Short runs stay in B.
  assert.deepEqual(code128Values("A12B"), [104, 33, 17, 18, 34]);
});

test("characters outside printable ASCII become question marks", () => {
  assert.deepEqual(code128Values("é"), [104, "?".charCodeAt(0) - 32]);
});

test("every symbol is 11 modules wide and the stop 13, with the widths starting on a bar", () => {
  const widths = code128("Rollprint 2026");
  const values = code128Values("Rollprint 2026");
  assert.equal(widths.length, (values.length + 1) * 6 + 7);
  assert.equal(
    widths.reduce((sum, width) => sum + width, 0),
    (values.length + 1) * 11 + 13,
  );
  assert.equal(barcodeModules(widths), (values.length + 1) * 11 + 13 + 2 * QUIET_ZONE);
});

test("the bars of a known code match the standard patterns", () => {
  // Start B, "A" (value 33), checksum (104 + 33) % 103 = 34, stop.
  assert.deepEqual(code128("A"), [2, 1, 1, 2, 1, 4, 1, 1, 1, 3, 2, 3, 1, 3, 1, 1, 2, 3, 2, 3, 3, 1, 1, 1, 2]);
});
