import assert from "node:assert/strict";
import { test } from "node:test";
import { STARTERS } from "../../src/labels/starters.js";
import { imagePart, textPart } from "../../src/labels/template.js";
import {
  readTemplateFile,
  readTemplateLink,
  templateLink,
  templateOf,
  writeTemplateFile,
} from "../../src/labels/template-file.js";

const PAGE = "https://ivandda.github.io/rollprint/?mode=labels#x";

test("a template with an image goes to a file and comes back the same", () => {
  /** @type {import("../../src/labels/template.js").LabelTemplate} */
  const template = {
    id: "t1",
    name: "Product",
    orientation: "landscape",
    border: "thin",
    margin: "m",
    font: "serif",
    lines: "thin",
    cell: {
      split: "across",
      share: 1 / 3,
      first: { part: imagePart({ image: { id: "img1", width: 20, height: 10 }, turn: "half" }) },
      second: { part: textPart({ heading: "{Product}" }) },
    },
  };
  const images = new Map([["img1", { type: "image/png", bytes: Uint8Array.from([1, 2, 3]) }]]);
  const text = writeTemplateFile(template, images);
  const read = readTemplateFile(text);
  assert.deepEqual(read.template, template);
  assert.deepEqual([...(read.images.get("img1")?.bytes ?? [])], [1, 2, 3]);
});

test("a file that isn't a template is refused with a message", () => {
  assert.throws(() => readTemplateFile("not json"), /isn't a label template/);
  assert.throws(() => readTemplateFile(JSON.stringify({ format: "other" })), /isn't a label template/);
  assert.throws(
    () => readTemplateFile(JSON.stringify({ format: "rollprint/template", version: 9, template: {} })),
    /newer version/,
  );
});

test("unexpected values are dropped or given defaults", () => {
  const template = templateOf({
    id: "x",
    name: 7,
    orientation: "sideways",
    border: "dotted",
    margin: "xl",
    font: "comic",
    lengthMm: "abc",
    lines: "dotted",
    cell: {
      split: "across",
      share: 5,
      first: { part: { type: "text", heading: 1, size: "huge", align: "middle", bold: "yes" } },
      second: { split: "diagonal", part: { type: "video" } },
    },
  });
  assert.deepEqual(template, {
    id: "x",
    name: "",
    orientation: "landscape",
    border: "none",
    margin: "m",
    cell: {
      split: "across",
      share: 1 / 2,
      first: {
        part: {
          type: "text",
          heading: "",
          headingSize: "l",
          text: "",
          size: "m",
          align: "start",
          bold: false,
        },
      },
      second: {},
    },
  });
  assert.equal(templateOf({ name: "no id", cell: {} }), undefined);
  assert.equal(templateOf({ id: "rows only", rows: [] }), undefined);
  assert.equal(templateOf(null), undefined);
});

test("an image keeps its turn, and an unknown turn is upright", () => {
  /** @param {unknown} turn */
  const read = (turn) => {
    const template = templateOf({ id: "x", cell: { part: { type: "image", turn } } });
    const cell = template?.cell;
    return cell && "part" in cell && cell.part?.type === "image" ? cell.part.turn : "not an image";
  };
  assert.equal(read("half"), "half");
  assert.equal(read("sideways"), undefined);
  assert.equal(read(undefined), undefined);
});

test("a file from before cells, with rows of blocks, opens as cells", () => {
  const file = JSON.stringify({
    format: "rollprint/template",
    version: 1,
    template: {
      id: "old",
      name: "Old",
      orientation: "landscape",
      border: "none",
      margin: "m",
      rows: [
        {
          blocks: [
            { type: "image", width: "half", treatment: "logo", show: "fit" },
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
        { blocks: [{ type: "space", size: "m" }] },
      ],
    },
  });
  assert.deepEqual(readTemplateFile(file).template, {
    id: "old",
    name: "Old",
    orientation: "landscape",
    border: "none",
    margin: "m",
    cell: {
      split: "down",
      share: 1 / 2,
      first: {
        split: "across",
        share: 1 / 2,
        first: { part: imagePart() },
        second: { part: textPart({ text: "{Name}" }) },
      },
      second: {},
    },
  });
});

test("every starter survives the round trip through a link", () => {
  for (const starter of STARTERS) {
    const url = new URL(templateLink(starter, PAGE));
    assert.equal(url.searchParams.get("mode"), "templates");
    assert.equal(url.hash, "");
    const value = url.searchParams.get("template");
    assert.ok(value && !/[+/=]/.test(value), "URL-safe");
    assert.deepEqual(readTemplateLink(value), starter, starter.name);
  }
  assert.equal(readTemplateLink("damaged"), undefined);
});
