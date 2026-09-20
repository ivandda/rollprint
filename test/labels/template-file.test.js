import assert from "node:assert/strict";
import { test } from "node:test";
import { STARTERS } from "../../src/labels/starters.js";
import { imageBlock, textBlock } from "../../src/labels/template.js";
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
    rows: [
      {
        blocks: [
          imageBlock({ image: { id: "img1", width: 20, height: 10 } }),
          textBlock({ heading: "{Product}" }),
        ],
      },
    ],
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
    rows: [
      {
        blocks: [{ type: "text", heading: 1, size: "huge", align: "middle", bold: "yes" }, { type: "video" }],
      },
      { blocks: [] },
      "nonsense",
    ],
  });
  assert.deepEqual(template, {
    id: "x",
    name: "",
    orientation: "landscape",
    border: "none",
    margin: "m",
    rows: [
      {
        blocks: [
          { type: "text", heading: "", headingSize: "l", text: "", size: "m", align: "start", bold: false },
        ],
      },
    ],
  });
  assert.equal(templateOf({ name: "no id", rows: [] }), undefined);
  assert.equal(templateOf(null), undefined);
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
