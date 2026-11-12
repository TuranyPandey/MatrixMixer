import { PIXELS, SIZE } from './protocol';

/** One matrix image: 625 brightness values (0-255), row by row from the top-left. */
export type Frame = Uint8Array;

/**
 * How many LEDs each of the 25 rows really has, centred. The matrix is a
 * circle, so the corners of the 25x25 grid do not exist. Taken from the LED
 * positions in Nothing's own Glyph Toy preview template; 489 LEDs in total.
 */
export const ROW_WIDTHS: readonly number[] = [
  7, 11, 15, 17, 19, 21, 21, 23, 23, 25, 25, 25, 25, 25, 25, 25, 23, 23, 21, 21, 19, 17, 15, 11, 7,
];

export const LED_COUNT = ROW_WIDTHS.reduce((a, b) => a + b, 0);

/** True if (x, y) is a real LED and not a missing corner cell. */
export function isLed(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false;
  const pad = (SIZE - ROW_WIDTHS[y]!) / 2;
  return x >= pad && x < SIZE - pad;
}

export function blankFrame(): Frame {
  return new Uint8Array(PIXELS);
}

export function setPixel(frame: Frame, x: number, y: number, value: number): void {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  frame[y * SIZE + x] = Math.max(0, Math.min(255, Math.round(value)));
}

export function getPixel(frame: Frame, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return 0;
  return frame[y * SIZE + x]!;
}

/** Zeroes the cells that are not real LEDs. Returns a new frame. */
export function applyMask(frame: Frame): Frame {
  const out = new Uint8Array(PIXELS);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (isLed(x, y)) out[y * SIZE + x] = frame[y * SIZE + x]!;
    }
  }
  return out;
}

export function framesEqual(a: Frame, b: Frame): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function frameFromArray(px: ArrayLike<number>): Frame {
  if (px.length !== PIXELS) throw new Error(`A frame needs ${PIXELS} values, got ${px.length}`);
  const out = new Uint8Array(PIXELS);
  for (let i = 0; i < PIXELS; i++) out[i] = Math.max(0, Math.min(255, Math.round(px[i]!)));
  return out;
}

/** Brightest of two frames per pixel. Handy for layering a widget over a ring. */
export function mergeFrames(a: Frame, b: Frame): Frame {
  const out = new Uint8Array(PIXELS);
  for (let i = 0; i < PIXELS; i++) out[i] = Math.max(a[i]!, b[i]!);
  return out;
}

/** Text picture of a frame, for terminals and test snapshots. */
export function frameToAscii(frame: Frame): string {
  const shades = ' .:+#';
  let s = '';
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = frame[y * SIZE + x]!;
      s += isLed(x, y) ? shades[Math.min(4, Math.ceil((v / 255) * 4))] : ' ';
    }
    s += '\n';
  }
  return s;
}
