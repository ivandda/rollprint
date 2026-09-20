import assert from "node:assert/strict";
import { test } from "node:test";
import { barcodeModules } from "../../src/imaging/barcode.js";
import {
  AUTO_LENGTH_MM,
  frameOf,
  isTurned,
  LEAST_MODULE_DOTS,
  LINES,
  layoutLabel,
  MARGINS,
} from "../../src/imaging/label-layout.js";
import {
  BARCODE_HEIGHTS,
  barcodePart,
  imagePart,
  qrPart,
  TEXT_SIZES,
  textPart,
} from "../../src/labels/template.js";
import { MEDIA } from "../../src/printers/brother-ql/media.js";

const DPMM = 300 / 25.4;
/** Between cells, as the layout has it. */
const GAP = 2 * DPMM;
/** Each character is half the text size wide. @type {import("../../src/imaging/label-layout.js").MeasureText} */
const measure = (text, size) => text.length * size * 0.5;
/** @param {"s" | "m" | "l"} margin */
const inset = (margin) => Math.round(MARGINS[margin] * DPMM);
/** @param {import("../../src/labels/template.js").TextSize} size */
const dots = (size) => TEXT_SIZES[size].mm * DPMM;

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
  margin: "s",
  cell: {},
  ...template,
});

/** @param {import("../../src/labels/template.js").Part} part @returns {import("../../src/labels/template.js").Cell} */
const cell = (part) => ({ part });
/** @type {(share: number, first: import("../../src/labels/template.js").Cell, second: import("../../src/labels/template.js").Cell) => import("../../src/labels/template.js").Cell} */
const across = (share, first, second) => ({ split: "across", share, first, second });
/** @type {(share: number, first: import("../../src/labels/template.js").Cell, second: import("../../src/labels/template.js").Cell) => import("../../src/labels/template.js").Cell} */
const down = (share, first, second) => ({ split: "down", share, first, second });

/** @param {number} a @param {number} b @param {number} [within] */
const near = (a, b, within = 1.5) => assert.ok(Math.abs(a - b) <= within, `${a} is not near ${b}`);

test("landscape reads along the longer side, portrait along the shorter; a roll leaves the length free", () => {
  // A 62 × 29 label is wider than it is long: landscape reads across, portrait along.
  assert.deepEqual(frameOf(template({ orientation: "landscape" }), media("62x29")), {
    width: 696,
    height: 271,
  });
  assert.deepEqual(frameOf(template({}), media("62x29")), { width: 271, height: 696 });
  assert.equal(isTurned(template({}), media("62x29")), true);
  assert.equal(isTurned(template({ orientation: "landscape" }), media("62x29")), false);
  // A 62 × 100 label is longer than it is wide: landscape reads along the roll.
  assert.deepEqual(frameOf(template({ orientation: "landscape" }), media("62x100")), {
    width: 1109,
    height: 696,
  });
  assert.deepEqual(frameOf(template({}), media("62x100")), { width: 696, height: 1109 });
  // A continuous roll leaves the length to the content, unless the template fixes it, within limits.
  assert.deepEqual(frameOf(template({ orientation: "landscape" }), media("62")), { width: 0, height: 696 });
  assert.deepEqual(frameOf(template({}), media("62")), { width: 696, height: 0 });
  assert.deepEqual(frameOf(template({ lengthMm: 3000 }), media("62")), {
    width: 696,
    height: Math.round(AUTO_LENGTH_MM.max * DPMM),
  });
});

test("cells split the room at their shares with a gap between, numbered in reading order", () => {
  const t = template({
    cell: across(1 / 3, cell(textPart({ text: "A" })), down(1 / 2, cell(textPart({ text: "B" })), {})),
  });
  const layout = layoutLabel(t, {}, { width: 900, height: 400 }, DPMM, measure);
  const [one, two, three] = layout.cells;
  const content = { width: 900 - 2 * inset("s"), height: 400 - 2 * inset("s") };
  assert.deepEqual(
    layout.cells.map(({ index }) => index),
    [1, 2, 3],
  );
  assert.equal(one.x, inset("s"));
  near(one.width, (content.width - GAP) / 3);
  assert.equal(one.height, content.height);
  near(two.x, one.x + one.width + GAP);
  near(two.width, content.width - one.width - GAP);
  assert.equal(two.width, three.width);
  near(two.height, (content.height - GAP) / 2);
  near(three.y, two.y + two.height + GAP);
  assert.equal(layout.lines.length, 0);
  // Every part sits in the middle of its cell, and text takes its cell's width.
  const [a, b] = layout.parts;
  assert.equal(a.width, one.width);
  near(a.y + a.height / 2, one.y + one.height / 2);
  near(b.y + b.height / 2, two.y + two.height / 2);
});

test("lines are drawn between the cells when asked", () => {
  const t = template({ lines: "thin", cell: across(1 / 2, cell(textPart({ text: "A" })), {}) });
  const layout = layoutLabel(t, {}, { width: 600, height: 400 }, DPMM, measure);
  const [line] = layout.lines;
  const [one] = layout.cells;
  assert.equal(layout.lines.length, 1);
  assert.equal(line.width, Math.max(1, Math.round(LINES.thin * DPMM)));
  assert.equal(line.height, one.height);
  near(line.x + line.width / 2, one.x + one.width + GAP / 2);
});

test("text wraps to its cell, and a word wider than the cell breaks where it reaches the edge", () => {
  const t = template({ cell: cell(textPart({ text: "aaaa bbbb cccc dddd", size: "m" })) });
  const narrow = layoutLabel(t, {}, { width: 200, height: 0 }, DPMM, measure);
  const wide = layoutLabel(t, {}, { width: 2000, height: 0 }, DPMM, measure);
  assert.equal(wide.parts[0].text?.lines.length, 1);
  assert.ok((narrow.parts[0].text?.lines.length ?? 0) > 1);
  const word = "abcdefghijklmnopqrstuvwxyz";
  const long = template({ cell: cell(textPart({ text: `${word} end`, size: "m" })) });
  const { lines, size } = layoutLabel(long, {}, { width: 200, height: 0 }, DPMM, measure).parts[0].text ?? {
    lines: [],
    size: 0,
  };
  const width = 200 - 2 * inset("s");
  assert.ok(lines.length > 2);
  for (const line of lines) assert.ok(measure(line, size, false) <= width, line);
  assert.equal(lines.join("").replace(" ", ""), `${word}end`);
});

test("Fit text is as large as its cell allows: by its height on a label, by its width when the length is free", () => {
  const t = template({ cell: cell(textPart({ text: "Hello", size: "fit" })) });
  const fixed = layoutLabel(t, {}, { width: 500, height: 100 }, DPMM, measure);
  assert.equal(fixed.parts[0].text?.size, Math.floor((100 - 2 * inset("s")) / 1.2));
  const free = layoutLabel(t, {}, { width: 500, height: 0 }, DPMM, measure);
  const size = Math.floor((500 - 2 * inset("s")) / 2.5); // 5 characters at half the size each
  assert.equal(free.parts[0].text?.size, size);
  near(free.height, size * 1.2 + 2 * inset("s"));
});

test("a label as long as its content grows until every cell fits what it holds, within limits", () => {
  const t = template({
    margin: "m",
    cell: down(
      1 / 2,
      cell(textPart({ text: "a\nb\nc", size: "l" })),
      cell(textPart({ text: "x", size: "s" })),
    ),
  });
  const layout = layoutLabel(t, {}, { width: 696, height: 0 }, DPMM, measure);
  // The first cell is half the content less the gap, and must hold three lines.
  near(layout.height, 2 * (3 * dots("l") * 1.2) + GAP + 2 * inset("m"));
  const [one, two] = layout.cells;
  assert.ok(one.height >= (layout.parts[0].height ?? 0) - 1);
  assert.equal(two.y + two.height, layout.height - inset("m"));
  const tiny = template({ cell: cell(textPart({ text: "Hi", size: "xs" })) });
  assert.equal(
    layoutLabel(tiny, {}, { width: 696, height: 0 }, DPMM, measure).height,
    Math.round(AUTO_LENGTH_MM.min * DPMM),
  );
  const longest = Math.round(AUTO_LENGTH_MM.max * DPMM);
  const tall = template({ cell: cell(textPart({ text: "line\n".repeat(40), size: "xl" })) });
  const capped = layoutLabel(tall, {}, { width: 696, height: 0 }, DPMM, measure);
  const [part] = capped.parts;
  assert.equal(capped.height, longest);
  assert.ok(part.y + part.height <= longest - inset("s") + 1);
  assert.ok((part.text?.size ?? 0) < dots("xl"));
});

test("a label as wide as its content grows the same way, and wraps text to the longest label", () => {
  const t = template({
    margin: "m",
    cell: across(
      1 / 2,
      cell(textPart({ text: "Short", size: "m" })),
      cell(textPart({ text: "Longer text here", size: "m" })),
    ),
  });
  const layout = layoutLabel(t, {}, { width: 0, height: 696 }, DPMM, measure);
  const natural = "Longer text here".length * dots("m") * 0.5;
  near(layout.width, 2 * natural + GAP + 2 * inset("m"));
  const longest = Math.round(AUTO_LENGTH_MM.max * DPMM);
  const wide = template({ cell: cell(textPart({ text: "word ".repeat(200), size: "m" })) });
  const along = layoutLabel(wide, {}, { width: 0, height: 696 }, DPMM, measure);
  const { lines, size } = along.parts[0].text ?? { lines: [], size: 0 };
  assert.ok(along.width <= longest && along.width > longest * 0.9, String(along.width));
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(measure(line, size, false) <= longest - 2 * inset("s"));
});

test("content taller than its cell shrinks every size alike", () => {
  const t = template({
    margin: "m",
    cell: cell(textPart({ heading: "Head", headingSize: "xl", text: "a\nb\nc\nd", size: "l" })),
  });
  const layout = layoutLabel(t, {}, { width: 696, height: 300 }, DPMM, measure);
  const [part] = layout.parts;
  assert.ok(part.y >= inset("m"));
  assert.ok(part.y + part.height <= 300 - inset("m") + 1);
  assert.ok((part.heading?.size ?? 0) < dots("xl"));
  const ratio = (part.heading?.size ?? 0) / (part.text?.size ?? 1);
  assert.ok(Math.abs(ratio - TEXT_SIZES.xl.mm / TEXT_SIZES.l.mm) < 0.05);
});

test("placeholders are filled before measuring, and a border is drawn around the whole label", () => {
  const t = template({ border: "thick", cell: cell(textPart({ text: "{Name}", size: "m" })) });
  const layout = layoutLabel(t, { Name: "Ada" }, { width: 300, height: 100 }, DPMM, measure);
  assert.deepEqual(layout.parts[0].text?.lines, ["Ada"]);
  assert.deepEqual(layout.border, { x: 0, y: 0, width: 300, height: 100 });
});

test("an image keeps its proportions in the middle of its cell, turned a quarter swaps them, and fill takes the cell", () => {
  const logo = { id: "img", width: 200, height: 100 };
  const frame = { width: 600, height: 300 };
  const content = { width: 600 - 2 * inset("s"), height: 300 - 2 * inset("s") };
  const [fit] = layoutLabel(
    template({ cell: cell(imagePart({ image: logo })) }),
    {},
    frame,
    DPMM,
    measure,
  ).parts;
  assert.equal(fit.height, content.height);
  assert.equal(fit.width, content.height * 2);
  near(fit.x, inset("s") + (content.width - fit.width) / 2);
  const [turned] = layoutLabel(
    template({ cell: cell(imagePart({ image: logo, turn: "left" })) }),
    {},
    frame,
    DPMM,
    measure,
  ).parts;
  assert.equal(turned.height, content.height);
  assert.equal(turned.width, Math.round(content.height / 2));
  const [fill] = layoutLabel(
    template({ cell: cell(imagePart({ image: logo, show: "fill" })) }),
    {},
    frame,
    DPMM,
    measure,
  ).parts;
  assert.deepEqual(
    [fill.x, fill.y, fill.width, fill.height],
    [inset("s"), inset("s"), content.width, content.height],
  );
  // Without an image there is nothing to place, and on a label as long as its content the image decides the length.
  assert.equal(layoutLabel(template({ cell: cell(imagePart()) }), {}, frame, DPMM, measure).parts.length, 0);
  const free = layoutLabel(
    template({ cell: cell(imagePart({ image: logo })) }),
    {},
    { width: 696, height: 0 },
    DPMM,
    measure,
  );
  near(free.height, (696 - 2 * inset("s")) / 2 + 2 * inset("s"));
});

test("a QR code is the square inside its cell, and nothing while its content is empty", () => {
  const t = template({
    cell: across(1 / 2, cell(qrPart({ content: "{Link}" })), cell(textPart({ text: "T" }))),
  });
  const layout = layoutLabel(t, { Link: "https://example.com" }, { width: 600, height: 400 }, DPMM, measure);
  const [qr] = layout.parts;
  const [one] = layout.cells;
  assert.equal(qr.width, qr.height);
  assert.equal(qr.height, Math.min(one.width, one.height));
  assert.equal(qr.code, "https://example.com");
  assert.equal(layoutLabel(t, {}, { width: 600, height: 400 }, DPMM, measure).parts.length, 1);
});

test("a barcode is as wide as its cell, or as its bars when they are wider, and its text says what they say", () => {
  const t = template({ cell: cell(barcodePart({ content: "{Code}", height: "l", text: true })) });
  const layout = layoutLabel(t, { Code: "AB-123" }, { width: 900, height: 400 }, DPMM, measure);
  const [bar] = layout.parts;
  assert.equal(bar.width, 900 - 2 * inset("s"));
  assert.ok(bar.bars && bar.bars.length > 0);
  assert.deepEqual(bar.caption?.lines, ["AB-123"]);
  near(bar.barHeight ?? 0, BARCODE_HEIGHTS.l * DPMM);
  assert.ok(bar.height > BARCODE_HEIGHTS.l * DPMM);
  const narrow = layoutLabel(
    t,
    { Code: "A-very-long-code-café" },
    { width: 200, height: 400 },
    DPMM,
    measure,
  );
  const [wide] = narrow.parts;
  assert.equal(wide.width, barcodeModules(wide.bars ?? []) * LEAST_MODULE_DOTS);
  assert.ok(wide.width > 200);
  assert.equal(wide.x, inset("s"));
  assert.deepEqual(wide.caption?.lines, ["A-very-long-code-caf?"]);
  const bare = layoutLabel(
    template({ cell: cell(barcodePart({ content: "X", height: "s", text: false })) }),
    {},
    { width: 900, height: 400 },
    DPMM,
    measure,
  );
  assert.equal(bare.parts[0].caption, undefined);
  near(bare.parts[0].height, BARCODE_HEIGHTS.s * DPMM);
});
