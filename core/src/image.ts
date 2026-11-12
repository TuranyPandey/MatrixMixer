import { applyMask, type Frame } from './frame';
import { PIXELS, SIZE } from './protocol';

export type ImageOptions = {
  /** `cover` crops to a centred square; `contain` keeps the whole image and pads with black. */
  fit: 'cover' | 'contain';
  /** Swap light and dark. Useful for dark logos on a white background. */
  invert: boolean;
  /** Stretch the darkest pixel to 0 and the brightest to 255 before anything else. */
  normalize: boolean;
  /** >1 darkens mid-tones, <1 lifts them. LEDs look washed out without some gamma. */
  gamma: number;
  /**
   * How many brightness steps to keep. 2 is pure on/off, 256 keeps everything.
   * With `dither` on, the lost detail is spread to neighbours (Floyd-Steinberg).
   */
  levels: number;
  dither: boolean;
};

export const DEFAULT_IMAGE_OPTIONS: ImageOptions = {
  fit: 'cover',
  invert: false,
  normalize: true,
  gamma: 1.6,
  levels: 256,
  dither: false,
};

/**
 * Turns RGBA pixels (any size) into a 25x25 frame.
 * Transparent pixels count as black. Area-averages when shrinking, so thin
 * lines fade instead of vanishing.
 */
export function rgbaToFrame(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  options: Partial<ImageOptions> = {},
): Frame {
  const o = { ...DEFAULT_IMAGE_OPTIONS, ...options };
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) {
    throw new Error('Image data does not match its width and height');
  }

  // Region of the source that maps onto the 25x25 grid (may extend past the image for `contain`).
  const side = o.fit === 'cover' ? Math.min(width, height) : Math.max(width, height);
  const ox = (width - side) / 2;
  const oy = (height - side) / 2;
  const cell = side / SIZE;

  const lum = new Float32Array(PIXELS);
  for (let gy = 0; gy < SIZE; gy++) {
    for (let gx = 0; gx < SIZE; gx++) {
      const x0 = ox + gx * cell;
      const y0 = oy + gy * cell;
      const sx0 = Math.floor(x0);
      const sy0 = Math.floor(y0);
      const sx1 = Math.max(sx0 + 1, Math.ceil(x0 + cell));
      const sy1 = Math.max(sy0 + 1, Math.ceil(y0 + cell));
      let sum = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          count++;
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue; // padding = black
          const i = (sy * width + sx) * 4;
          const a = rgba[i + 3]! / 255;
          sum += (0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!) * a;
        }
      }
      lum[gy * SIZE + gx] = count ? sum / count / 255 : 0;
    }
  }

  if (o.normalize) {
    let lo = 1;
    let hi = 0;
    for (const v of lum) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo > 0.02) for (let i = 0; i < PIXELS; i++) lum[i] = (lum[i]! - lo) / (hi - lo);
  }

  for (let i = 0; i < PIXELS; i++) {
    let v = o.invert ? 1 - lum[i]! : lum[i]!;
    v = Math.pow(Math.max(0, Math.min(1, v)), o.gamma);
    lum[i] = v;
  }

  const levels = Math.max(2, Math.min(256, Math.round(o.levels)));
  const quantize = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * (levels - 1)) / (levels - 1);
  const out = new Uint8Array(PIXELS);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const old = lum[i]!;
      const q = quantize(old);
      out[i] = Math.round(q * 255);
      if (o.dither && levels < 256) {
        const err = old - q;
        if (x + 1 < SIZE) lum[i + 1] = lum[i + 1]! + (err * 7) / 16;
        if (y + 1 < SIZE) {
          if (x > 0) lum[i + SIZE - 1] = lum[i + SIZE - 1]! + (err * 3) / 16;
          lum[i + SIZE] = lum[i + SIZE]! + (err * 5) / 16;
          if (x + 1 < SIZE) lum[i + SIZE + 1] = lum[i + SIZE + 1]! + err / 16;
        }
      }
    }
  }
  return applyMask(out);
}
