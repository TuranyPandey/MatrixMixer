/**
 * Ambient animations: nothing to read, just something alive on the back of the
 * phone. Each one is a small simulation that hands out its next frame per call.
 */
import { applyMask, blankFrame, isLed, setPixel, type Frame } from './frame';
import { PIXELS, SIZE } from './protocol';

export type AmbientStyle = 'rain' | 'stars' | 'life';

export const AMBIENT_STYLES: ReadonlyArray<{ id: AmbientStyle; name: string; intervalMs: number }> = [
  { id: 'rain', name: 'Rain', intervalMs: 70 },
  { id: 'stars', name: 'Starfield', intervalMs: 60 },
  { id: 'life', name: 'Game of Life', intervalMs: 220 },
];

type Random = () => number;

/** A repeatable stand-in for Math.random, for previews and tests. */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Starts an animation. Each call of the returned function is the next frame. */
export function ambientAnimation(style: AmbientStyle, random: Random = Math.random): () => Frame {
  if (style === 'rain') return rain(random);
  if (style === 'stars') return stars(random);
  return life(random);
}

/** Drops fall at their own speeds, each with a tail that fades behind it. */
function rain(random: Random): () => Frame {
  type Drop = { x: number; y: number; speed: number; tail: number };
  const drops: Drop[] = [];
  return () => {
    if (drops.length < 20 && random() < 0.5) {
      drops.push({ x: Math.floor(random() * SIZE), y: -1, speed: 0.35 + random() * 0.55, tail: 3 + Math.floor(random() * 5) });
    }
    const frame = blankFrame();
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]!;
      d.y += d.speed;
      if (d.y - d.tail > SIZE) {
        drops.splice(i, 1);
        continue;
      }
      const head = Math.floor(d.y);
      for (let t = 0; t <= d.tail; t++) {
        const y = head - t;
        const value = t === 0 ? 255 : 150 * (1 - t / (d.tail + 1));
        if (y >= 0 && y < SIZE && value > frame[y * SIZE + d.x]!) setPixel(frame, d.x, y, value);
      }
    }
    return applyMask(frame);
  };
}

/** Stars drift out from the middle, speeding up and brightening as they pass. */
function stars(random: Random): () => Frame {
  type Star = { angle: number; r: number; speed: number };
  const mid = (SIZE - 1) / 2;
  const fresh = (r: number): Star => ({ angle: random() * Math.PI * 2, r, speed: 0.02 + random() * 0.05 });
  // Start spread out, so the first frame is already a sky and not a single dot.
  const field: Star[] = Array.from({ length: 30 }, () => fresh(random() * mid));
  return () => {
    const frame = blankFrame();
    field.forEach((s, i) => {
      s.r += s.speed * (1 + s.r * 0.35);
      if (s.r > mid + 1) field[i] = s = fresh(0.5 + random());
      const x = Math.round(mid + Math.cos(s.angle) * s.r);
      const y = Math.round(mid + Math.sin(s.angle) * s.r);
      const value = 40 + (s.r / mid) * 215;
      if (value > (frame[y * SIZE + x] ?? 255)) setPixel(frame, x, y, value);
    });
    return applyMask(frame);
  };
}

/**
 * One generation of Conway's Game of Life on the round matrix. `cells` holds 1
 * for alive; cells that are not real LEDs stay dead, so the rim is the edge of the world.
 */
export function lifeStep(cells: Uint8Array): Uint8Array {
  const next = new Uint8Array(PIXELS);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!isLed(x, y)) continue;
      let around = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx !== 0 || dy !== 0) && isLed(x + dx, y + dy)) around += cells[(y + dy) * SIZE + x + dx]!;
        }
      }
      const alive = cells[y * SIZE + x] === 1;
      if (around === 3 || (alive && around === 2)) next[y * SIZE + x] = 1;
    }
  }
  return next;
}

/** Life that never gets stuck: when it dies out or starts repeating, it is reseeded. */
function life(random: Random): () => Frame {
  let cells: Uint8Array = new Uint8Array(PIXELS);
  let ages: Uint8Array = new Uint8Array(PIXELS);
  let recent: string[] = [];
  /** Generations left to show a repeating pattern before starting over. */
  let ending = -1;
  const seed = () => {
    cells = new Uint8Array(PIXELS);
    ages = new Uint8Array(PIXELS);
    recent = [];
    ending = -1;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (isLed(x, y) && random() < 0.34) cells[y * SIZE + x] = 1;
  };
  seed();
  return () => {
    const frame = blankFrame();
    // Newborn cells are brightest; ones that have lasted settle to a steady glow.
    for (let i = 0; i < PIXELS; i++) if (cells[i]) frame[i] = ages[i] === 0 ? 255 : ages[i] === 1 ? 180 : 120;

    const next = lifeStep(cells);
    for (let i = 0; i < PIXELS; i++) ages[i] = next[i] && cells[i] ? Math.min(2, ages[i]! + 1) : 0;
    cells = next;

    if (ending > 0) ending--;
    else if (ending === 0) seed();
    else {
      const key = cells.join('');
      if (recent.includes(key)) ending = key.includes('1') ? 14 : 2;
      recent = [...recent, key].slice(-8);
    }
    return frame;
  };
}

const stills = new Map<AmbientStyle, Frame>();

/** A typical moment of an animation, always the same one. For small previews. */
export function ambientStill(style: AmbientStyle): Frame {
  let frame = stills.get(style);
  if (!frame) {
    const next = ambientAnimation(style, seededRandom(7));
    frame = next();
    for (let i = 0; i < (style === 'life' ? 6 : 60); i++) frame = next();
    stills.set(style, frame);
  }
  return frame;
}
