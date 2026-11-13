/**
 * Frames for things that take over the matrix for a while: a job's progress,
 * the on-air light, the sound visualiser, a load graph, a game HUD, the
 * weather, and the wording of the price ticker.
 */
import { drawCentered, drawStrip, renderText, renderTiny, TINY_HEIGHT } from './font';
import { blankFrame, isLed, setPixel, type Frame } from './frame';
import { SIZE } from './protocol';
import { drawRing } from './widgets';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
const TEXT_Y = Math.floor((SIZE - TINY_HEIGHT) / 2);

/** A horizontal bar, two rows tall and 17 cells wide, with a dim track. `y` is its top row. */
function drawBar(frame: Frame, fraction: number, y: number, brightness = 200): void {
  const barWidth = 17;
  const x0 = (SIZE - barWidth) / 2;
  const lit = Math.round(clamp(fraction, 0, 1) * barWidth);
  for (let i = 0; i < barWidth; i++) {
    const v = i < lit ? brightness : 22;
    setPixel(frame, x0 + i, y, v);
    setPixel(frame, x0 + i, y + 1, v);
  }
}

/** Progress of a long job (a download, a build): the ring fills and the number counts up. 0-100. */
export function progressFrame(percent: number): Frame {
  const frame = blankFrame();
  const p = clamp(percent, 0, 100);
  drawRing(frame, p / 100);
  drawCentered(frame, renderTiny(`${Math.round(p)}%`), TEXT_Y);
  return frame;
}

/**
 * "You are live": a full ring that breathes, with a short word in the middle
 * (MIC, CAM). `tick` alternates the ring between bright and dim.
 */
export function onAirFrame(word: string, tick: number): Frame {
  const frame = blankFrame();
  drawRing(frame, 1, tick % 2 === 0 ? 255 : 90);
  drawCentered(frame, renderText(word.toUpperCase()), Math.floor((SIZE - 7) / 2));
  return frame;
}

/** How many bars the visualiser shows: one per frequency band, bass on the left. */
export const SPECTRUM_BARS = 12;

/** For each bar's column, how many LEDs there are between the middle row and the rim. */
const BAR_REACH: readonly number[] = Array.from({ length: SPECTRUM_BARS }, (_, i) => {
  const mid = (SIZE - 1) / 2;
  let reach = 0;
  while (isLed(1 + i * 2, mid - reach - 1)) reach++;
  return reach;
});

/**
 * A spectrum: one bar per band growing both ways from the middle row, so a loud
 * passage fills out the circle. Each bar's full height is the rim at its column.
 * `levels` are 0-1, bass first. `peaks` (optional, same scale) draws a cap that
 * the caller lets fall slowly, so a hit stays readable after the bar drops.
 */
export function spectrumFrame(levels: readonly number[], peaks: readonly number[] = []): Frame {
  const frame = blankFrame();
  const mid = (SIZE - 1) / 2;
  for (let i = 0; i < SPECTRUM_BARS; i++) {
    const x = 1 + i * 2;
    const reach = BAR_REACH[i]!;
    const height = clamp(levels[i] ?? 0, 0, 1) * reach;
    const half = Math.floor(height + 0.001);
    const shade = (d: number) => 230 - (d / reach) * 110;
    // The middle row fades in with the bar, so silence is a dark matrix.
    setPixel(frame, x, mid, Math.round(255 * Math.min(1, height)));
    for (let d = 1; d <= half; d++) {
      setPixel(frame, x, mid - d, Math.round(shade(d)));
      setPixel(frame, x, mid + d, Math.round(shade(d)));
    }
    // The part of a dot the bar has not reached yet shows as a dimmer dot, so
    // bars glide between heights instead of stepping a whole dot at a time.
    const tip = Math.round(shade(half + 1) * (height - half));
    if (half < reach && tip > 12) {
      setPixel(frame, x, mid - half - 1, tip);
      setPixel(frame, x, mid + half + 1, tip);
    }
    const cap = Math.round(clamp(peaks[i] ?? 0, 0, 1) * reach);
    if (cap > half + 1) {
      setPixel(frame, x, mid - cap, 255);
      setPixel(frame, x, mid + cap, 255);
    }
  }
  return frame;
}

/**
 * Turns raw band levels into something pleasant to watch. Bars jump up at once
 * and sink back gradually, caps hang and then fall, and the whole picture is
 * scaled to recent loudness so quiet playback still moves.
 */
export function spectrumSmoother(): (raw: readonly number[]) => { levels: number[]; peaks: number[] } {
  const levels = new Array<number>(SPECTRUM_BARS).fill(0);
  const peaks = new Array<number>(SPECTRUM_BARS).fill(0);
  const held = new Array<number>(SPECTRUM_BARS).fill(0);
  /** The level that counts as "full height" right now. */
  let ceiling = 0.6;
  return (raw) => {
    const loudest = Math.max(0, ...raw.slice(0, SPECTRUM_BARS));
    // Follow loud passages straight away; relax over a few seconds. Never zoom in on near-silence.
    ceiling = Math.max(0.35, loudest, ceiling * 0.997);
    for (let i = 0; i < SPECTRUM_BARS; i++) {
      // Only the top stretch below the ceiling is drawn: that is where music moves.
      const target = clamp(((raw[i] ?? 0) / ceiling - 0.45) / 0.55, 0, 1);
      const now = levels[i]!;
      // Rise most of the way each frame (quick, but not a jump); fall at a steady, slower pace.
      const next = target > now ? now + (target - now) * 0.6 : Math.max(target, now - 0.06);
      levels[i] = Math.abs(target - next) < 0.01 ? target : next;
      if (levels[i]! >= peaks[i]!) {
        peaks[i] = levels[i]!;
        held[i] = 10;
      } else if (held[i]! > 0) held[i]!--;
      else peaks[i] = Math.max(levels[i]!, peaks[i]! - 0.035);
    }
    return { levels: [...levels], peaks: [...peaks] };
  };
}

/** A load history as a bar chart: one column per sample, newest on the right. Values are 0-100. */
export function graphFrame(history: readonly number[]): Frame {
  const frame = blankFrame();
  const recent = history.slice(-SIZE);
  const offset = SIZE - recent.length;
  recent.forEach((value, i) => {
    const height = Math.max(1, Math.round((clamp(value, 0, 100) / 100) * 19));
    for (let h = 0; h < height; h++) setPixel(frame, offset + i, 21 - h, h === height - 1 ? 255 : 110);
  });
  return frame;
}

/** Game HUD: ring and number show health (0-100); the bar shows ammo left in the clip (0-1), if known. */
export function gameFrame(health: number, ammo: number | null): Frame {
  const frame = blankFrame();
  const hp = clamp(health, 0, 100);
  drawRing(frame, hp / 100);
  drawCentered(frame, renderTiny(String(Math.round(hp))), ammo === null ? TEXT_Y : 7);
  if (ammo !== null) drawBar(frame, ammo, 16);
  return frame;
}

export type WeatherKind = 'clear' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog';

/** 9x7 pictures, one per kind of weather. `#` is lit, `+` is dim. */
const WEATHER_ICONS: Record<WeatherKind, readonly string[]> = {
  clear: ['#...#...#', '..+###+..', '.+#####+.', '#.#####.#', '.+#####+.', '..+###+..', '#...#...#'],
  cloud: ['.........', '...###...', '..#####..', '.#######.', '#########', '#########', '.#######.'],
  rain: ['...###...', '.#######.', '#########', '.#######.', '.........', '.#..#..#.', '#..#..#..'],
  snow: ['...###...', '.#######.', '#########', '.#######.', '.........', '#..#..#..', '..#..#..#'],
  storm: ['...###...', '.#######.', '#########', '.#######.', '....##...', '...##....', '..#......'],
  fog: ['.........', '.#######.', '.........', '#########', '.........', '.#######.', '.........'],
};

/** Open-Meteo's WMO weather codes, reduced to the pictures above. */
export function weatherKind(code: number): WeatherKind {
  if (code === 0 || code === 1) return 'clear';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 51) return 'rain';
  return 'cloud';
}

/** A weather picture with the temperature (whole degrees, either unit) underneath. */
export function weatherFrame(temperature: number, kind: WeatherKind): Frame {
  const frame = blankFrame();
  WEATHER_ICONS[kind].forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '.') setPixel(frame, 8 + x, 3 + y, row[x] === '#' ? 255 : 110);
    }
  });
  const strip = renderTiny(String(Math.round(clamp(temperature, -99, 199))));
  const x0 = Math.floor((SIZE - strip.width - 2) / 2);
  drawStrip(frame, strip, x0, 14);
  setPixel(frame, x0 + strip.width + 1, 14, 255); // degree mark
  return frame;
}

/** Short price for a 25-dot display: 97.2K, 1.23M, 184, 3.42, 0.0412. */
export function formatPrice(value: number): string {
  const v = Math.abs(value);
  if (v >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (v >= 1e4) return `${(value / 1e3).toFixed(1)}K`;
  if (v >= 100) return value.toFixed(0);
  if (v >= 1) return value.toFixed(2);
  return value.toPrecision(3);
}

export type Quote = { symbol: string; price: number; changePercent?: number | null };

/** One line for the ticker: `BTC 97.2K +1.2%   AAPL 184 -0.4%`. */
export function tickerLine(quotes: readonly Quote[]): string {
  return quotes
    .map((q) => {
      const c = q.changePercent;
      const change = typeof c === 'number' && Number.isFinite(c) ? ` ${c >= 0 ? '+' : ''}${c.toFixed(1)}%` : '';
      return `${q.symbol.toUpperCase()} ${formatPrice(q.price)}${change}`;
    })
    .join('   ');
}
