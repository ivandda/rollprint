/** @import { Cell, LabelTemplate, Part } from "./template.js" */
import { barcodePart, imagePart, qrPart, textPart } from "./template.js";

/** @param {Part} part @returns {Cell} */
const cell = (part) => ({ part });
/** @param {number} share @param {Cell} first @param {Cell} second @returns {Cell} */
const across = (share, first, second) => ({ split: "across", share, first, second });
/** @param {number} share @param {Cell} first @param {Cell} second @returns {Cell} */
const down = (share, first, second) => ({ split: "down", share, first, second });

/**
 * Templates everyone starts with. They are made of the same cells as any other, so they double as
 * examples. Their IDs are fixed, so values typed into them are remembered.
 * @type {LabelTemplate[]}
 */
export const STARTERS = [
  {
    id: "starter-text",
    name: "Text",
    orientation: "landscape",
    border: "none",
    margin: "m",
    cell: cell(textPart({ text: "{Text}", size: "fit", align: "center", bold: true })),
  },
  {
    id: "starter-product",
    name: "Product",
    orientation: "landscape",
    border: "thin",
    margin: "m",
    cell: down(
      2 / 3,
      across(
        1 / 3,
        cell(imagePart()),
        cell(textPart({ heading: "{Product}", headingSize: "l", text: "{Detail}", size: "s" })),
      ),
      cell(textPart({ text: "www.example.com", size: "xs", align: "end" })),
    ),
  },
  {
    id: "starter-address",
    name: "Address",
    orientation: "landscape",
    border: "none",
    margin: "l",
    cell: cell(textPart({ text: "{Address}", size: "m" })),
  },
  {
    id: "starter-name-tag",
    name: "Name tag",
    orientation: "landscape",
    border: "thin",
    margin: "m",
    cell: down(
      1 / 3,
      cell(textPart({ text: "Hello, my name is", size: "s", align: "center" })),
      cell(textPart({ heading: "{Name}", headingSize: "fit", align: "center" })),
    ),
  },
  {
    id: "starter-shelf",
    name: "Shelf",
    orientation: "landscape",
    border: "thick",
    margin: "m",
    cell: down(
      2 / 3,
      cell(textPart({ heading: "{Name}", headingSize: "fit", align: "center" })),
      cell(textPart({ text: "{Detail}", size: "s", align: "center" })),
    ),
  },
  {
    id: "starter-qr-link",
    name: "QR link",
    orientation: "landscape",
    border: "none",
    margin: "m",
    cell: across(
      1 / 3,
      cell(qrPart({ content: "{Link}" })),
      cell(textPart({ heading: "{Title}", headingSize: "l", text: "Scan for more", size: "s" })),
    ),
  },
  {
    id: "starter-inventory",
    name: "Inventory",
    orientation: "landscape",
    border: "none",
    margin: "m",
    font: "mono",
    cell: down(
      1 / 3,
      cell(textPart({ heading: "{Item}", headingSize: "m" })),
      cell(barcodePart({ content: "{Code}", height: "m", text: true })),
    ),
  },
  {
    id: "starter-date",
    name: "Date",
    orientation: "landscape",
    border: "none",
    margin: "m",
    cell: down(
      1 / 2,
      cell(textPart({ heading: "{Contents}", headingSize: "l" })),
      cell(textPart({ text: "Opened {Date}", size: "m" })),
    ),
  },
];
