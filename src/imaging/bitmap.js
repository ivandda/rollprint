/** @import { Bitmap } from "../printers/types.js" */

/** @typedef {{ width: number, height: number, data: Uint8ClampedArray }} RgbaImage  e.g. canvas ImageData */

/**
 * Converts drawings (text, lines) to a 1-bit bitmap: anything darker than `threshold` prints black.
 * A higher threshold keeps the anti-aliased edges of small text, which makes it bolder.
 * @param {RgbaImage} image
 * @param {number} [threshold]  Brightness 0–255.
 * @returns {Bitmap}
 */
export function thresholdToBitmap(image, threshold = 128) {
  const pixels = Uint8Array.from(paperBrightness(image), (value) => (value < threshold ? 1 : 0));
  return { width: image.width, height: image.height, pixels };
}

/**
 * Converts photos and card art to a 1-bit bitmap. A tone curve first turns everything darker than
 * `black` into pure black and lighter than `white` into pure white, so text and frames stay crisp;
 * Floyd–Steinberg dithering then renders the midtones.
 * @param {RgbaImage} image
 * @param {{ black?: number, white?: number, gamma?: number }} [tone]
 * @returns {Bitmap}
 */
export function ditherToBitmap(image, { black = 40, white = 195, gamma = 0.9 } = {}) {
  const { width, height } = image;
  const values = paperBrightness(image).map(
    (value) => Math.min(Math.max((value - black) / (white - black), 0), 1) ** gamma * 255,
  );
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const ink = values[i] < 128;
      pixels[i] = ink ? 1 : 0;
      const error = values[i] - (ink ? 0 : 255);
      if (x + 1 < width) values[i + 1] += (error * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) values[i + width - 1] += (error * 3) / 16;
        values[i + width] += (error * 5) / 16;
        if (x + 1 < width) values[i + width + 1] += error / 16;
      }
    }
  }
  return { width, height, pixels };
}

/**
 * Shrinks a bitmap for display by averaging the dots under each screen pixel into a grey, the way
 * they blend on paper at arm's length. Letting the browser scale 1-bit dots turns them into noise.
 * @param {Bitmap} bitmap
 * @param {number} width  Display width in device pixels.
 */
export function shrinkBitmap(bitmap, width) {
  const scale = bitmap.width / width;
  const height = Math.max(1, Math.round(bitmap.height / scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const top = Math.floor(y * scale);
    const bottom = Math.max(top + 1, Math.min(bitmap.height, Math.floor((y + 1) * scale)));
    for (let x = 0; x < width; x++) {
      const left = Math.floor(x * scale);
      const right = Math.max(left + 1, Math.min(bitmap.width, Math.floor((x + 1) * scale)));
      let ink = 0;
      for (let row = top; row < bottom; row++) {
        for (let column = left; column < right; column++) ink += bitmap.pixels[row * bitmap.width + column];
      }
      const grey = 255 - Math.round((255 * ink) / ((bottom - top) * (right - left)));
      data.set([grey, grey, grey, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/**
 * Copies `source` onto `target` with its top-left corner at (x, y), cut off at the target's edges.
 * @param {Bitmap} target
 * @param {Bitmap} source
 * @param {number} x
 * @param {number} y
 */
export function pasteBitmap(target, source, x, y) {
  for (let row = Math.max(0, -y); row < source.height && y + row < target.height; row++) {
    const from = row * source.width;
    const to = (y + row) * target.width + x;
    const start = Math.max(0, -x);
    const end = Math.min(source.width, target.width - x);
    if (end > start) target.pixels.set(source.pixels.subarray(from + start, from + end), to + start);
  }
}

/**
 * Brightness of each pixel as it would look on white paper (transparent means paper), 0–255,
 * with the ITU-R 601 luma weights that Pillow's grayscale conversion also uses.
 * @param {RgbaImage} image
 */
function paperBrightness({ width, height, data }) {
  const values = new Float32Array(width * height);
  for (let i = 0; i < values.length; i++) {
    const offset = i * 4;
    const luma = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
    values[i] = 255 - (data[offset + 3] / 255) * (255 - luma);
  }
  return values;
}

/**
 * The bitmap turned a quarter turn clockwise, so what ran across it runs along the roll.
 * @param {Bitmap} bitmap
 * @returns {Bitmap}
 */
export function rotateBitmap({ width, height, pixels }) {
  const turned = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const column = height - 1 - y;
    for (let x = 0; x < width; x++) turned[x * height + column] = pixels[y * width + x];
  }
  return { width: height, height: width, pixels: turned };
}
