import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { rgbaToFrame, type Frame, type ImageOptions } from '@matrix-bridge/core';

/** Reads a PNG or JPEG from disk and shrinks it to a matrix frame. */
export function imageFileToFrame(path: string, options: Partial<ImageOptions>): Frame {
  const bytes = readFileSync(path);
  const isPng = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (isPng) {
    const png = PNG.sync.read(bytes);
    return rgbaToFrame(png.data, png.width, png.height, options);
  }
  if (isJpeg) {
    const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    return rgbaToFrame(img.data, img.width, img.height, options);
  }
  throw new Error('Only PNG and JPEG files are supported here. Use the desktop app for GIFs.');
}
