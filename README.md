# Rollprint

Print on a thermal label printer straight from the browser over [WebUSB](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API). No drivers or installs. Two modes, switched from the menu in the header: **Cards** prints Magic: The Gathering cards and tokens as stickers, and **Labels** prints labels of your own from templates.

**[Open the app](https://ivandda.github.io/rollprint/)**

## Labels

- Pick a template (Text, Address, Name tag, Shelf, Date), fill in its fields and print. What you typed is remembered per template.
- **Design your own templates**: rows of blocks (text with a heading, images, dividers, spaces; up to three side by side), a border, margins, orientation and length. Anything in braces, like `{Product}`, becomes a field to fill in. Templates and their images are saved in your browser and never leave it.
- **Logos and photos**: a logo prints crisp, a photo is dithered with the darkness of your choice. An image takes a quarter, a third, half or all of the label's width.
- **QR codes and barcodes**: a QR code of a link or text per label, and Code 128 barcodes with the text under them, scaled to whole dots so they scan.
- **Typefaces**: Sans, Serif, Mono or Condensed per template, bundled so a template prints the same everywhere.
- Templates re-flow to whatever paper is loaded: die-cut labels, continuous rolls (as long as the content needs) and round labels.
- Landscape templates run along the roll; Fit text takes the room the other rows leave.
- **Many labels from a list**: paste one label per line (tabs or commas between fields, an optional first line naming them). The whole list is one print list item with a page per line.
- **Share templates**: export a template with its images as a file and import it elsewhere, or copy a link for a template without images.
- Labels go in the same print list as cards, with copies, and can be changed from there.

## Cards

- **Search** tokens or any paper card, with [Scryfall syntax](https://scryfall.com/docs/syntax) (`c:g power>=4`). Pick the printing and side, or both sides of a double-faced card to fold, and open the tokens and emblems a card makes.
- **Preview** the exact black-and-white print, with darkness, paper size and border options.
- **Print as image or text**: large rules text with mana symbols, art optional.
- **Create your own** cards and tokens, or customize any card. Saved in your browser, with backup to a file.
- **Print markers**: The Monarch, Day and Night, trackers, keywords or your own, packed onto few pages.
- **Print a deck**: paste a decklist to add its cards to the print list with their counts, basic lands optional and double-faced cards on both sides, plus every token, emblem and game card it makes.
- **Print list**: queue pages with their own options and copies, change any of them later, and print them at once.
- **Share** a card by its link, including cards you made (text and Scryfall art).

On 62 × 100 mm die-cut labels (Brother DK-11202) a card prints at 59 × 82 mm, about 94% of real size.

## Requirements

- **Chrome or Edge** on desktop or Android. Other browsers can search and preview, but not print.
- **A Brother QL printer over USB**, with Editor Lite turned off (green light off).

| Printer | Status |
| --- | --- |
| QL-700 | Tested on macOS |
| QL-500, 550, 560, 570, 600, 650TD, 710W, 720NW, 800, 810W, 820NWB | Untested |
| QL-1050, 1060N, 1100, 1110NWB, 1115NWB (labels up to 104 mm) | Untested |

The untested models get the same bytes [brother_ql](https://github.com/pklaus/brother_ql) sends them. If you have one, please [open an issue](https://github.com/ivandda/rollprint/issues) and say whether it prints. Windows and Linux aren't tested yet.

## Windows

Browsers can only use USB devices running Microsoft's WinUSB driver ([why](https://developer.chrome.com/docs/capabilities/build-for-webusb#windows)), so the printer needs a one-time change:

1. Plug in and turn on the printer, with Editor Lite off.
2. Open [Zadig](https://zadig.akeo.ie), choose **Options → List All Devices** and pick the printer.
3. Choose **WinUSB**, click **Replace Driver**, then reload the app and click **Connect printer**.

Brother's software won't work with the printer while WinUSB is installed. To undo it, uninstall the device in Device Manager with its driver removed, then reconnect the printer.

## Development

Node.js 24+. No build step: the browser loads `src/` as is.

```sh
npm install
npm test            # unit tests
npm run lint        # Biome
npm run typecheck   # TypeScript on the JSDoc types
python3 -m http.server 8000
```

Pushes to `main` run the checks and deploy to GitHub Pages.

**Adding a printer:** `src/transport/` moves bytes (WebUSB), and `src/printers/` has one driver per printer family. Implement `PrinterDriver` from `src/printers/types.js` and register it in `src/printers/index.js`. The Brother QL tests compare against output from brother_ql (`test/fixtures/brother-ql/generate.py`).

## Credits and license

Card data and images from [Scryfall](https://scryfall.com), within its [rate limits](https://scryfall.com/docs/api/rate-limits). Typefaces, all under the SIL OFL: [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next), [Source Serif 4](https://github.com/adobe-fonts/source-serif), [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) and [Oswald](https://github.com/googlefonts/OswaldFont). QR codes by [Nayuki's qrcodegen](https://www.nayuki.io/page/qr-code-generator-library) (MIT), vendored in `src/vendor`.

Copyright © 2026 Ivan, under the [GNU AGPL-3.0](LICENSE): free to use, share and change, and any version you distribute or host must stay open source.

Magic: The Gathering is a trademark of Wizards of the Coast. Not affiliated with Wizards of the Coast, Scryfall or Brother.
