// Draws the app icon (a lit two-headed arrow on the round dot matrix) as a 1024px PNG.
// Run: node scripts/make-icon.mjs && npm run tauri -w desktop -- icon ../scripts/icon-source.png
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { PNG } = createRequire(new URL('../cli/package.json', import.meta.url))('pngjs');

const ROWS = [7, 11, 15, 17, 19, 21, 21, 23, 23, 25, 25, 25, 25, 25, 25, 25, 23, 23, 21, 21, 19, 17, 15, 11, 7];
const ART = ['..#.....#..', '.##.....##.', '###########', '.##.....##.', '..#.....#..'];
const S = 1024;
const png = new PNG({ width: S, height: S });
const lit = (x, y) => ART[y - 10]?.[x - 7] === '#';
const disc = S * 0.47;
const cell = (S * 0.82) / 25;
const origin = (S - cell * 25) / 2;

for (let py = 0; py < S; py++) {
  for (let px = 0; px < S; px++) {
    const i = (py * S + px) * 4;
    const d = Math.hypot(px - S / 2 + 0.5, py - S / 2 + 0.5);
    let v = 0;
    let a = Math.max(0, Math.min(1, disc - d)); // black disc, soft edge
    const gx = Math.floor((px - origin) / cell);
    const gy = Math.floor((py - origin) / cell);
    if (gy >= 0 && gy < 25 && gx >= 0 && gx < 25 && Math.abs(gx - 12) <= (ROWS[gy] - 1) / 2) {
      const cx = origin + (gx + 0.5) * cell;
      const cy = origin + (gy + 0.5) * cell;
      const edge = Math.max(0, Math.min(1, cell * 0.38 - Math.hypot(px + 0.5 - cx, py + 0.5 - cy)));
      v = Math.round(edge * (lit(gx, gy) ? 255 : 38));
    }
    png.data[i] = png.data[i + 1] = png.data[i + 2] = v;
    png.data[i + 3] = Math.round(a * 255);
  }
}
writeFileSync(new URL('./icon-source.png', import.meta.url), PNG.sync.write(png));
console.log('wrote scripts/icon-source.png');
