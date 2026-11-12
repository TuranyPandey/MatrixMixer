import { drawCentered, renderTiny, TINY_HEIGHT } from './font';
import { blankFrame, isLed, setPixel, type Frame } from './frame';
import { SIZE } from './protocol';

/**
 * The outermost LEDs of the circle, ordered clockwise starting at 12 o'clock.
 * Widgets use it as a progress ring.
 */
export const RING: ReadonlyArray<readonly [number, number]> = (() => {
  const cells: Array<[number, number, number]> = [];
  const c = (SIZE - 1) / 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!isLed(x, y)) continue;
      const edge = !isLed(x - 1, y) || !isLed(x + 1, y) || !isLed(x, y - 1) || !isLed(x, y + 1);
      if (!edge) continue;
      let angle = Math.atan2(x - c, -(y - c)); // 0 at the top, growing clockwise
      if (angle < 0) angle += Math.PI * 2;
      cells.push([x, y, angle]);
    }
  }
  cells.sort((a, b) => a[2] - b[2]);
  return cells.map(([x, y]) => [x, y] as const);
})();

/** Lights the first `fraction` of the ring, with the rest dim so the track is visible. */
export function drawRing(frame: Frame, fraction: number, brightness = 255, track = 18): void {
  const lit = Math.round(Math.max(0, Math.min(1, fraction)) * RING.length);
  RING.forEach(([x, y], i) => setPixel(frame, x, y, i < lit ? brightness : track));
}

const two = (n: number) => String(Math.floor(n)).padStart(2, '0');

/** `MM:SS` up to 99:59, then `H:MM`. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  if (s < 6000) return `${two(s / 60)}:${two(s % 60)}`;
  return `${Math.floor(s / 3600)}:${two((s % 3600) / 60)}`;
}

const TEXT_Y = Math.floor((SIZE - TINY_HEIGHT) / 2);

/** HH:MM with a ring that fills once a minute. */
export function clockFrame(now: Date, hour12 = false): Frame {
  const frame = blankFrame();
  let h = now.getHours();
  if (hour12) h = h % 12 || 12;
  drawRing(frame, now.getSeconds() / 59, 110);
  drawCentered(frame, renderTiny(`${two(h)}:${two(now.getMinutes())}`), TEXT_Y);
  return frame;
}

/**
 * Time left with a ring that drains as the timer runs down.
 * `dim` is for the break half of a Pomodoro so the two phases look different at a glance.
 */
export function timerFrame(remainingSeconds: number, totalSeconds: number, dim = false): Frame {
  const frame = blankFrame();
  const fraction = totalSeconds > 0 ? remainingSeconds / totalSeconds : 0;
  drawRing(frame, fraction, dim ? 90 : 255);
  drawCentered(frame, renderTiny(formatDuration(remainingSeconds)), TEXT_Y, dim ? 150 : 255);
  return frame;
}

/** Flashing frame for "time's up". `tick` alternates on and off. */
export function alarmFrame(tick: number): Frame {
  const frame = blankFrame();
  if (tick % 2 === 0) {
    drawRing(frame, 1, 255);
    drawCentered(frame, renderTiny('00:00'), TEXT_Y);
  }
  return frame;
}

/**
 * System meter. Ring and number show CPU %, the bar underneath shows RAM %.
 * Both inputs are 0-100.
 */
export function meterFrame(cpuPercent: number, ramPercent: number): Frame {
  const frame = blankFrame();
  const cpu = Math.max(0, Math.min(100, cpuPercent));
  const ram = Math.max(0, Math.min(100, ramPercent));
  drawRing(frame, cpu / 100, 255);
  drawCentered(frame, renderTiny(`${Math.round(cpu)}%`.padStart(3, ' ')), 7);
  // RAM bar: 17 cells wide on rows 16-17, where the circle is still 23 wide.
  const barWidth = 17;
  const x0 = (SIZE - barWidth) / 2;
  const lit = Math.round((ram / 100) * barWidth);
  for (let i = 0; i < barWidth; i++) {
    const v = i < lit ? 200 : 22;
    setPixel(frame, x0 + i, 16, v);
    setPixel(frame, x0 + i, 17, v);
  }
  return frame;
}
