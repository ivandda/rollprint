import assert from "node:assert/strict";
import { test } from "node:test";
import { barcodeModules } from "../../src/imaging/barcode.js";
import {
  AUTO_LENGTH_MM,
  frameOf,
  isTurned,
  LEAST_MODULE_DOTS,
  layoutLabel,
  MARGINS,
} from "../../src/imaging/label-layout.js";
import {
  BARCODE_HEIGHTS,
  barcodeBlock,
  imageBlock,
  qrBlock,
  TEXT_SIZES,
  textBlock,
} from "../../src/labels/template.js";
import { MEDIA } from "../../src/printers/brother-ql/media.js";

const DPMM = 300 / 25.4;
/** Each character is half the text size wide. @type {import("../../src/imaging/label-layout.js").MeasureText} */
const measure = (text, size) => text.length * size * 0.5;

/** @param {string} id */
function media(id) {
  const found = MEDIA.find((label) => label.id === id);
  assert.ok(found, `unknown label ${id}`);
  return found;
}

/**
 * @param {Partial<import("../../src/labels/template.js").LabelTemplate>} template
 * @returns {import("../../src/labels/template.js").LabelTemplate}
 */
const template = (template) => ({
  id: "t",
  name: "T",
  orientation: "portrait",
  border: "none",
  margin: "m",
  rows: [],
  ...template,
});

test("landscape reads along the longer side, portrait along the shorter; a roll leaves the length free", () => {
  // A 62 × 29 label is wider than it is long: landscape reads across, portrait along.
  assert.deepEqual(frameOf(template({ orientation: "landscape" }), media("62x29")), {
    width: 696,
    height: 271,
  });
  assert.deepEqual(frameOf(template({}), media("62x29")), { width: 271, height: 696 });
  assert.equal(isTurned(template({}), media("62x29")), true);
  // A 62 × 100 label is longer than it is wide: landscape reads along the roll.
  assert.deepEqual(frameOf(template({ orientation: "landscape" }), media("62x100")), {
    width: 1109,
    height: 696,
  });
  assert.deepEqual(frameOf(template({}), media("62x100")), { width: 696, height: 1109 });
  // A continuous roll is as long as the content, so landscape runs along it.
  assert.deepEqual(frameOf(template({}), media("62")), { width: 696, height: 0 });
  // A fixed length keeps within the limits a roll has.
  assert.deepEqual(frameOf(template({ lengthMm: 3000 }), media("62")), {
    width: 696,
    height: Math.round(AUTO_LENGTH_MM.max * DPMM),
  });
  assert.deepEqual(frameOf(template({ orientation: "landscape" }), media("62")), { width: 0, height: 696 });
  // A fixed 50 mm piece of a 62 mm roll is wider than it is long, like a 62 × 50 label.
  const piece = Math.round(50 * DPMM);
  assert.deepEqual(frameOf(template({ orientation: "landscape", lengthMm: 50 }), media("62")), {
    width: 696,
    height: piece,
  });
  assert.deepEqual(frameOf(template({ lengthMm: 50 }), media("62")), { width: piece, height: 696 });
  const round = frameOf(template({ orientation: "landscape" }), media("d58"));
  assert.equal(round.width, round.height);
  assert.equal(round.width, Math.floor(media("d58").printableWidth / Math.SQRT2));
});

test("rows stack from the top with named sizes and sit in the middle of a fixed label", () => {
  const t = template({
    rows: [
      { blocks: [textBlock({ text: "One", size: "m" })] },
      { blocks: [textBlock({ text: "Two", size: "m" })] },
    ],
  });
  const layout = layoutLabel(t, {}, { width: 696, height: 400 }, DPMM, measure);
  const [one, two] = layout.blocks;
  const line = TEXT_SIZES.m.mm * DPMM * 1.2;
  assert.equal(one.text?.size, TEXT_SIZES.m.mm * DPMM);
  assert.ok(two.y > one.y + line - 1);
  const content = two.y + two.height - one.y;
  assert.ok(Math.abs(one.y - (400 - content) / 2) <= 1, "centred vertically");
  assert.equal(one.x, Math.round(MARGINS.m * DPMM));
  assert.equal(one.width, 696 - 2 * Math.round(MARGINS.m * DPMM));
});

test("blocks in a row share the width", () => {
  const t = template({
    margin: "s",
    rows: [{ blocks: [textBlock({ text: "L" }), textBlock({ text: "R" })] }],
  });
  const layout = layoutLabel(t, {}, { width: 700, height: 300 }, DPMM, measure);
  const [left, right] = layout.blocks;
  assert.equal(left.width, right.width);
  assert.ok(right.x > left.x + left.width);
  assert.ok(right.x + right.width <= 700);
});

test("text wraps to the block's width", () => {
  const t = template({ rows: [{ blocks: [textBlock({ text: "aaaa bbbb cccc dddd", size: "m" })] }] });
  const narrow = layoutLabel(t, {}, { width: 200, height: 0 }, DPMM, measure);
  const wide = layoutLabel(t, {}, { width: 2000, height: 0 }, DPMM, measure);
  assert.equal(wide.blocks[0].text?.lines.length, 1);
  assert.ok((narrow.blocks[0].text?.lines.length ?? 0) > 1);
});

test("a word wider than its block is broken where it reaches the edge", () => {
  const word = "abcdefghijklmnopqrstuvwxyz";
  const t = template({ rows: [{ blocks: [textBlock({ text: `${word} end`, size: "m" })] }] });
  const layout = layoutLabel(t, {}, { width: 200, height: 0 }, DPMM, measure);
  const { lines, size } = layout.blocks[0].text ?? { lines: [], size: 0 };
  const width = 200 - 2 * Math.round(MARGINS.m * DPMM);
  assert.ok(lines.length > 2);
  for (const line of lines) assert.ok(measure(line, size, false) <= width, line);
  assert.equal(lines.join("").replace(" ", ""), `${word}end`);
});

test("text on a label as long as its content wraps and shrinks to the longest label a roll allows", () => {
  const longest = Math.round(AUTO_LENGTH_MM.max * DPMM);
  const inset = Math.round(MARGINS.m * DPMM);
  const wide = template({ rows: [{ blocks: [textBlock({ text: "word ".repeat(200), size: "m" })] }] });
  const across = layoutLabel(wide, {}, { width: 0, height: 696 }, DPMM, measure);
  const { lines, size } = across.blocks[0].text ?? { lines: [], size: 0 };
  // The lines wrap just short of the limit, so the label is as long as they are.
  assert.ok(across.width <= longest && across.width > longest * 0.9, String(across.width));
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(measure(line, size, false) <= longest - 2 * inset);
  const tall = template({ rows: [{ blocks: [textBlock({ text: "line\n".repeat(40), size: "xl" })] }] });
  const along = layoutLabel(tall, {}, { width: 696, height: 0 }, DPMM, measure);
  const [block] = along.blocks;
  assert.equal(along.height, longest);
  assert.ok(block.y + block.height <= longest - inset + 1);
  assert.ok((block.text?.size ?? 0) < TEXT_SIZES.xl.mm * DPMM);
});

test("Fit text fills the width when the length is free, and the room left when it is fixed", () => {
  const t = template({ margin: "s", rows: [{ blocks: [textBlock({ text: "Hello", size: "fit" })] }] });
  const free = layoutLabel(t, {}, { width: 500, height: 0 }, DPMM, measure);
  const width = 500 - 2 * Math.round(MARGINS.s * DPMM);
  assert.equal(free.blocks[0].text?.size, Math.floor(width / 2.5)); // 5 characters at half the size each
  const fixed = layoutLabel(t, {}, { width: 500, height: 100 }, DPMM, measure);
  const room = 100 - 2 * Math.round(MARGINS.s * DPMM);
  assert.equal(fixed.blocks[0].text?.size, Math.floor(room / 1.2));
});

test("Fit text takes what the named rows leave", () => {
  const t = template({
    margin: "s",
    rows: [
      { blocks: [textBlock({ text: "Small line", size: "s" })] },
      { blocks: [textBlock({ text: "BIG", size: "fit" })] },
    ],
  });
  const layout = layoutLabel(t, {}, { width: 2000, height: 300 }, DPMM, measure);
  const [small, big] = layout.blocks;
  assert.ok((big.text?.size ?? 0) > (small.text?.size ?? 0));
  assert.ok(big.y + big.height <= 300 - Math.round(MARGINS.s * DPMM) + 1);
});

test("a continuous label is as long as its content, within limits", () => {
  const short = template({ rows: [{ blocks: [textBlock({ text: "Hi", size: "s" })] }] });
  assert.equal(
    layoutLabel(short, {}, { width: 696, height: 0 }, DPMM, measure).height,
    Math.round(AUTO_LENGTH_MM.min * DPMM),
  );
  const long = template({ rows: [{ blocks: [textBlock({ text: "line\n".repeat(200), size: "xl" })] }] });
  assert.equal(
    layoutLabel(long, {}, { width: 696, height: 0 }, DPMM, measure).height,
    Math.round(AUTO_LENGTH_MM.max * DPMM),
  );
  const some = template({ rows: [{ blocks: [textBlock({ text: "a\nb\nc\nd\ne\nf", size: "l" })] }] });
  const layout = layoutLabel(some, {}, { width: 696, height: 0 }, DPMM, measure);
  const inset = Math.round(MARGINS.m * DPMM);
  assert.equal(layout.height, Math.round(6 * TEXT_SIZES.l.mm * DPMM * 1.2 + 2 * inset));
});

test("a label as wide as its content keeps within the same limits", () => {
  const short = template({ rows: [{ blocks: [textBlock({ text: "Hi", size: "s" })] }] });
  assert.equal(
    layoutLabel(short, {}, { width: 0, height: 696 }, DPMM, measure).width,
    Math.round(AUTO_LENGTH_MM.min * DPMM),
  );
  const long = template({ rows: [{ blocks: [textBlock({ text: "word ".repeat(200), size: "xl" })] }] });
  const longest = Math.round(AUTO_LENGTH_MM.max * DPMM);
  const { width } = layoutLabel(long, {}, { width: 0, height: 696 }, DPMM, measure);
  // The words wrap just short of the limit, so the label is as long as the lines are.
  assert.ok(width <= longest && width > longest * 0.9, String(width));
});

test("a label as wide as its content gets the widest row, and other rows stretch to it", () => {
  const t = template({
    margin: "s",
    rows: [
      { blocks: [textBlock({ text: "Short", size: "m" })] },
      { blocks: [textBlock({ text: "A much longer line", size: "m" })] },
    ],
  });
  const layout = layoutLabel(t, {}, { width: 0, height: 696 }, DPMM, measure);
  const size = TEXT_SIZES.m.mm * DPMM;
  const widest = "A much longer line".length * size * 0.5;
  assert.equal(layout.width, Math.round(widest + 2 * Math.round(MARGINS.s * DPMM)));
  assert.equal(layout.blocks[0].width, layout.blocks[1].width);
});

test("content taller than a fixed label shrinks every size alike", () => {
  const t = template({
    rows: [{ blocks: [textBlock({ heading: "Head", headingSize: "xl", text: "a\nb\nc\nd", size: "l" })] }],
  });
  const layout = layoutLabel(t, {}, { width: 696, height: 300 }, DPMM, measure);
  const [block] = layout.blocks;
  assert.ok(block.y >= 0);
  assert.ok(block.y + block.height <= 300 + 1);
  assert.ok((block.heading?.size ?? 0) < TEXT_SIZES.xl.mm * DPMM);
  const ratio = (block.heading?.size ?? 0) / (block.text?.size ?? 1);
  assert.ok(Math.abs(ratio - TEXT_SIZES.xl.mm / TEXT_SIZES.l.mm) < 0.05);
});

test("placeholders are filled before measuring, and a border is drawn around the whole label", () => {
  const t = template({ border: "thick", rows: [{ blocks: [textBlock({ text: "{Name}", size: "m" })] }] });
  const layout = layoutLabel(t, { Name: "Ada" }, { width: 300, height: 100 }, DPMM, measure);
  assert.deepEqual(layout.blocks[0].text?.lines, ["Ada"]);
  assert.deepEqual(layout.border, { x: 0, y: 0, width: 300, height: 100 });
});

test("an image takes its share of the width, as tall as its proportions, and the text takes the rest", () => {
  const logo = { id: "img", width: 200, height: 100 };
  const t = template({
    margin: "s",
    rows: [{ blocks: [imageBlock({ image: logo, width: "third" }), textBlock({ text: "Name", size: "m" })] }],
  });
  const layout = layoutLabel(t, {}, { width: 900, height: 400 }, DPMM, measure);
  const [image, text] = layout.blocks;
  const content = 900 - 2 * Math.round(MARGINS.s * DPMM);
  assert.equal(image.width, Math.round(content / 3));
  assert.equal(image.height, Math.round(content / 6));
  assert.ok(text.x > image.x + image.width);
  assert.equal(text.x + text.width, Math.round(MARGINS.s * DPMM) + content);
  // Without an image the block takes no room at all.
  const empty = layoutLabel(
    { ...t, rows: [{ blocks: [imageBlock(), textBlock({ text: "Name" })] }] },
    {},
    { width: 900, height: 400 },
    DPMM,
    measure,
  );
  assert.equal(empty.blocks[0].width, 0);
  assert.equal(empty.blocks[1].width, content - Math.round(2 * DPMM));
});

test("a tall image is capped at the label's height, and shares the height on a label as wide as its content", () => {
  const tall = { id: "img", width: 100, height: 400 };
  const t = template({ margin: "s", rows: [{ blocks: [imageBlock({ image: tall, width: "full" })] }] });
  const fixed = layoutLabel(t, {}, { width: 600, height: 300 }, DPMM, measure);
  const room = 300 - 2 * Math.round(MARGINS.s * DPMM);
  assert.equal(fixed.blocks[0].height, room);
  assert.equal(fixed.blocks[0].width, Math.round(room / 4));
  const square = { id: "img", width: 300, height: 300 };
  const wide = layoutLabel(
    { ...t, rows: [{ blocks: [imageBlock({ image: square, width: "half" })] }] },
    {},
    { width: 0, height: 696 },
    DPMM,
    measure,
  );
  const across = 696 - 2 * Math.round(MARGINS.s * DPMM);
  assert.equal(wide.blocks[0].height, Math.round(across / 2));
  assert.equal(wide.blocks[0].width, Math.round(across / 2));
});

test("an image turned a quarter is as tall as it was wide", () => {
  const image = { id: "i", width: 20, height: 10 };
  const flat = template({ rows: [{ blocks: [imageBlock({ image, width: "half" })] }] });
  const turned = template({ rows: [{ blocks: [imageBlock({ image, width: "half", turn: "left" })] }] });
  const [wide] = layoutLabel(flat, {}, { width: 696, height: 0 }, DPMM, measure).blocks;
  const [tall] = layoutLabel(turned, {}, { width: 696, height: 0 }, DPMM, measure).blocks;
  assert.equal(wide.width, tall.width);
  assert.ok(Math.abs(wide.height - wide.width / 2) <= 1);
  assert.ok(Math.abs(tall.height - tall.width * 2) <= 1);
});

test("a QR code is a square share of the width, and nothing while its content is empty", () => {
  const t = template({
    margin: "s",
    rows: [{ blocks: [qrBlock({ content: "{Link}", width: "half" }), textBlock({ text: "T" })] }],
  });
  const content = 600 - 2 * Math.round(MARGINS.s * DPMM);
  const layout = layoutLabel(t, { Link: "https://example.com" }, { width: 600, height: 400 }, DPMM, measure);
  const [qr] = layout.blocks;
  assert.equal(qr.width, Math.round(content / 2));
  assert.equal(qr.height, qr.width);
  assert.equal(qr.code, "https://example.com");
  const empty = layoutLabel(t, {}, { width: 600, height: 400 }, DPMM, measure);
  assert.equal(empty.blocks[0].width, 0);
});

test("a barcode is as wide as its row, as tall as chosen plus its text, and knows its bars", () => {
  const t = template({
    margin: "s",
    rows: [{ blocks: [barcodeBlock({ content: "{Code}", height: "l", text: true })] }],
  });
  const layout = layoutLabel(t, { Code: "AB-123" }, { width: 900, height: 400 }, DPMM, measure);
  const [bar] = layout.blocks;
  assert.equal(bar.width, 900 - 2 * Math.round(MARGINS.s * DPMM));
  assert.ok(bar.bars && bar.bars.length > 0);
  assert.deepEqual(bar.caption?.lines, ["AB-123"]);
  assert.ok(bar.height > BARCODE_HEIGHTS.l * DPMM);
  const bare = layoutLabel(
    { ...t, rows: [{ blocks: [barcodeBlock({ content: "X", height: "s", text: false })] }] },
    {},
    { width: 900, height: 400 },
    DPMM,
    measure,
  );
  assert.equal(bare.blocks[0].height, Math.round(BARCODE_HEIGHTS.s * DPMM));
  // On a label as wide as its content, the bars set the width at the smallest module that scans.
  const wide = layoutLabel(t, { Code: "AB-123" }, { width: 0, height: 696 }, DPMM, measure);
  assert.ok(wide.blocks[0].width > 0);
  assert.equal(wide.width, wide.blocks[0].width + 2 * Math.round(MARGINS.s * DPMM));
});

test("a barcode too wide for its row keeps the width of its bars, and its text says what they say", () => {
  const t = template({
    margin: "s",
    rows: [{ blocks: [barcodeBlock({ content: "{Code}", height: "m", text: true })] }],
  });
  const code = "ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789-café";
  const [bar] = layoutLabel(t, { Code: code }, { width: 300, height: 400 }, DPMM, measure).blocks;
  assert.ok(bar.bars);
  assert.equal(bar.width, barcodeModules(bar.bars) * LEAST_MODULE_DOTS);
  assert.ok(bar.width > 300);
  assert.deepEqual(bar.caption?.lines, ["ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789-caf?"]);
});
