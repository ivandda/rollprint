/** @import { LabelTemplate } from "./template.js" */
import { barcodeBlock, imageBlock, qrBlock, textBlock } from "./template.js";

/**
 * Templates everyone starts with. They are made of the same blocks as any other, so they double as
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
    rows: [{ blocks: [textBlock({ text: "{Text}", size: "fit", align: "center", bold: true })] }],
  },
  {
    id: "starter-product",
    name: "Product",
    orientation: "landscape",
    border: "thin",
    margin: "m",
    rows: [
      {
        blocks: [
          imageBlock({ width: "third" }),
          textBlock({ heading: "{Product}", headingSize: "l", text: "{Detail}", size: "s" }),
        ],
      },
      { blocks: [textBlock({ text: "www.example.com", size: "xs", align: "end" })] },
    ],
  },
  {
    id: "starter-address",
    name: "Address",
    orientation: "landscape",
    border: "none",
    margin: "l",
    rows: [{ blocks: [textBlock({ text: "{Address}", size: "m" })] }],
  },
  {
    id: "starter-name-tag",
    name: "Name tag",
    orientation: "landscape",
    border: "thin",
    margin: "m",
    rows: [
      { blocks: [textBlock({ text: "Hello, my name is", size: "s", align: "center" })] },
      { blocks: [textBlock({ heading: "{Name}", headingSize: "fit", align: "center" })] },
    ],
  },
  {
    id: "starter-shelf",
    name: "Shelf",
    orientation: "landscape",
    border: "thick",
    margin: "m",
    rows: [
      { blocks: [textBlock({ heading: "{Name}", headingSize: "fit", align: "center" })] },
      { blocks: [textBlock({ text: "{Detail}", size: "s", align: "center" })] },
    ],
  },
  {
    id: "starter-qr-link",
    name: "QR link",
    orientation: "landscape",
    border: "none",
    margin: "m",
    rows: [
      {
        blocks: [
          qrBlock({ content: "{Link}", width: "third" }),
          textBlock({ heading: "{Title}", headingSize: "l", text: "Scan for more", size: "s" }),
        ],
      },
    ],
  },
  {
    id: "starter-inventory",
    name: "Inventory",
    orientation: "landscape",
    border: "none",
    margin: "m",
    font: "mono",
    rows: [
      { blocks: [textBlock({ heading: "{Item}", headingSize: "m" })] },
      { blocks: [barcodeBlock({ content: "{Code}", height: "m", text: true })] },
    ],
  },
  {
    id: "starter-date",
    name: "Date",
    orientation: "landscape",
    border: "none",
    margin: "m",
    rows: [
      { blocks: [textBlock({ heading: "{Contents}", headingSize: "l" })] },
      { blocks: [textBlock({ text: "Opened {Date}", size: "m" })] },
    ],
  },
];
