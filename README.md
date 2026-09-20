# Rollprint

Print on a thermal label printer straight from the browser over [WebUSB](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API). No drivers, no installs, no account: everything stays in your browser. Three modes, switched from the menu in the header: **Labels** prints labels of your own from templates, **Cards** (the original MTG Thermal Printer) prints Magic: The Gathering cards and tokens as stickers, and **Books** prints book covers.

**[Open the app](https://ivandda.github.io/rollprint/)**

## Labels

**Print.** Pick a template, fill in its fields, print. Starters cover the usual labels: Text, Product, Address, Name tag, Shelf, QR link, Inventory, Date. What you typed is remembered per template. To print many at once, paste a list with one label per line (tabs or commas between fields, an optional first line naming them): the whole list is one print list item with a page per line.

**Templates.** Design your own in the Templates tab, in two steps. First the layout: the label is a map of numbered cells, and any cell can be split in two, side by side or one above the other, at a third, a half or two thirds. Then each cell: pick its number on the map and say what it holds.

- **Text**, with an optional heading, in named sizes (Tiny to Huge, or Fit, as large as the cell allows), aligned and bold as you like.
- **Image**: a logo, printed crisp, or a photo, dithered; whole in its cell or filling it, turned if need be.
- **QR code** of a link or any text, and **barcode** (Code 128) with its text under it, both scaled to whole dots so they scan.
- Nothing: an empty cell is spacing. Lines can be drawn between the cells.

Anything written in braces, like `{Product}`, becomes a field to fill in. A template also chooses a typeface (Sans, Serif, Mono or Condensed, all bundled so it prints the same everywhere), a border, margins, an orientation and, on a continuous roll, a fixed length or the content's. Templates re-flow to whatever paper is loaded: die-cut labels, continuous rolls and round labels. Landscape reads along the label's longer side; a label as long as its content grows until every cell fits what it holds.

**Sharing.** Export a template with its images as a file and import it in another browser, or copy a link for a template without images. That is how a shop hands its product label to everyone who prints: design it once, export it, and each computer imports the file and fills in the fields. Templates and their images are saved in the browser and never leave it.

## Books

Search [Open Library](https://openlibrary.org) by title, author or ISBN and pick the books you want. Each one you pick joins **Your covers** with a count, so a cover can be printed once or a dozen times.

**Size.** One choice decides everything: a cover is printed **Full label**, or **Large**, **Medium** or **Small**, which fit two, three or four across. Each size divides the label's width exactly, so no strip of paper is wasted down the side, and covers pack edge to edge in rows over as few labels as they need, with a dashed line to cut along between neighbours — the same way markers print. A label too short for the size chosen shrinks its covers to fit rather than cutting them in half.

**Sharper covers.** Open Library's covers stop at 500 pixels tall, which is less than a 62 mm label prints. **Sharper cover** looks the book up in Apple's ebook catalogue, whose artwork is about 1400 tall. That search matches on the title and author and will confidently return a different book, so the cover it finds is shown next to the one you have and only used if you accept it.

Your covers are saved in this browser and never leave it.

## Cards (MTG Thermal Printer)

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

Brother's software won't work with the printer while WinUSB is installed. To undo it, uninstall the device in Device Manager with its driver removed, then reconnect the printer. For a workplace that also prints from Brother's own software, that is the trade-off to weigh before switching a printer over.

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

**Layout:** `src/labels/` holds templates as data (cells and parts, placeholders, starters, files and links, lists); `src/imaging/label-layout.js` lays a template out (pure, tested with a fake text measure) and `label-render.js` draws it; `src/ui/labels/` is the Print tab and the designer. Cards live in `src/scryfall/`, `src/imaging/text-card.js` and the rest of `src/ui/`. Books live in `src/books/` (the Open Library client, and the shelf as data) with `src/imaging/cover-sheet.js` laying the covers out (pure, tested against every label size) and `src/ui/books.js` for the tab. Whatever is printed is a *design*, plain data in `src/designs.js` that the print list saves and redraws for the loaded paper; `src/ui/panel/` has one *source* per kind of design behind the shared label panel.

**Adding a printer:** `src/transport/` moves bytes (WebUSB), and `src/printers/` has one driver per printer family. Implement `PrinterDriver` from `src/printers/types.js` and register it in `src/printers/index.js`. The Brother QL tests compare against output from brother_ql (`test/fixtures/brother-ql/generate.py`).

## Credits and license

Card data and images from [Scryfall](https://scryfall.com), within its [rate limits](https://scryfall.com/docs/api/rate-limits). Book data and covers from [Open Library](https://openlibrary.org/developers/api), a project of the Internet Archive, within its rate limits; sharper covers from Apple's [iTunes Search API](https://performance-partners.apple.com/search-api). Covers are fetched when they are printed and belong to their publishers. Typefaces, all under the SIL OFL: [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next), [Source Serif 4](https://github.com/adobe-fonts/source-serif), [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) and [Oswald](https://github.com/googlefonts/OswaldFont). QR codes by [Nayuki's qrcodegen](https://www.nayuki.io/page/qr-code-generator-library) (MIT), vendored in `src/vendor`.

Copyright © 2026 Ivan, under the [GNU AGPL-3.0](LICENSE): free to use, share and change, and any version you distribute or host must stay open source.

Magic: The Gathering is a trademark of Wizards of the Coast. Not affiliated with Wizards of the Coast, Scryfall or Brother.
