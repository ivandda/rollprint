import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ditherToBitmap,
  pasteBitmap,
  rotateBitmap,
  shrinkBitmap,
  thresholdToBitmap,
} from "../../src/imaging/bitmap.js";

/**
 * A uniform image of one grey level.
 * @param {number} grey
 * @param {number} [size]
 */
function solid(grey, size = 32) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) data.set([grey, grey, grey, 255], i);
  return { width: size, height: size, data };
}

/** @param {{ pixels: Uint8Array }} bitmap */
const inkRatio = ({ pixels }) => pixels.reduce((sum, ink) => sum + ink, 0) / pixels.length;

test("threshold: dark pixels print black; light and transparent pixels stay white", () => {
  // biome-ignore format: one RGBA pixel per line
  const data = Uint8ClampedArray.of(
    0, 0, 0, 255, // black
    255, 255, 255, 255, // white
    90, 90, 90, 255, // dark grey
    0, 0, 0, 0, // transparent
  );
  assert.deepEqual([...thresholdToBitmap({ width: 2, height: 2, data }).pixels], [1, 0, 1, 0]);
});

test("dither: near-black and near-white become solid, so text and frames stay crisp", () => {
  assert.equal(inkRatio(ditherToBitmap(solid(30))), 1);
  assert.equal(inkRatio(ditherToBitmap(solid(210))), 0);
});

test("dither: midtones become a proportional dot pattern", () => {
  const ratio = inkRatio(ditherToBitmap(solid(118)));
  assert.ok(ratio > 0.4 && ratio < 0.6, `ink ratio ${ratio}`);
});

test("shrinking averages the dots under each pixel into a grey", () => {
  const checkerboard = { width: 2, height: 2, pixels: Uint8Array.of(1, 0, 0, 1) };
  assert.deepEqual([...shrinkBitmap(checkerboard, 1).data], [127, 127, 127, 255]);
});

test("shrinking keeps the bitmap's proportions", () => {
  const page = { width: 696, height: 1109, pixels: new Uint8Array(696 * 1109).fill(1) };
  const preview = shrinkBitmap(page, 232);
  assert.deepEqual([preview.width, preview.height], [232, 370]);
  assert.equal(preview.data[0], 0);
});

test("pasting copies dots and cuts them off at the edges", () => {
  const target = { width: 4, height: 3, pixels: new Uint8Array(12) };
  const source = { width: 2, height: 2, pixels: Uint8Array.of(1, 1, 1, 0) };
  pasteBitmap(target, source, 3, -1);
  pasteBitmap(target, source, 0, 1);
  assert.deepEqual([...target.pixels], [0, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0]);
});

test("a higher threshold turns light grey into ink", () => {
  const grey = { width: 1, height: 1, data: Uint8ClampedArray.of(160, 160, 160, 255) };
  assert.deepEqual([...thresholdToBitmap(grey).pixels], [0]);
  assert.deepEqual([...thresholdToBitmap(grey, 190).pixels], [1]);
});

test("a quarter turn clockwise sends the top row to the right edge", () => {
  const bitmap = { width: 3, height: 2, pixels: Uint8Array.from([1, 0, 0, 0, 0, 1]) };
  const turned = rotateBitmap(bitmap);
  assert.equal(turned.width, 2);
  assert.equal(turned.height, 3);
  // (0,0) was top-left: it is now top-right. (2,1) was bottom-right: it is now bottom-left.
  assert.deepEqual([...turned.pixels], [0, 1, 0, 0, 1, 0]);
});
