import { describe, expect, it } from 'vitest';
import {
  LED_COUNT,
  PIXELS,
  RING,
  ROW_WIDTHS,
  SIZE,
  animationSource,
  applyMask,
  blankFrame,
  clockFrame,
  decodePcMessage,
  decodePhoneMessage,
  encode,
  formatDuration,
  frameToAscii,
  githubNews,
  isLed,
  meterFrame,
  noticeSource,
  renderText,
  renderTiny,
  rgbaToFrame,
  scrollFrame,
  scrollLength,
  staticTextFrame,
  textSource,
  timerFrame,
  Player,
} from '@matrix-bridge/core';

describe('matrix shape', () => {
  it('has 489 LEDs in a symmetric circle', () => {
    expect(LED_COUNT).toBe(489);
    expect(ROW_WIDTHS).toHaveLength(SIZE);
    expect([...ROW_WIDTHS].reverse()).toEqual([...ROW_WIDTHS]);
    expect(isLed(0, 0)).toBe(false);
    expect(isLed(12, 0)).toBe(true);
    expect(isLed(0, 12)).toBe(true);
    // The shape is the same turned on its side.
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) expect(isLed(x, y)).toBe(isLed(y, x));
  });

  it('masks the corners', () => {
    const full = new Uint8Array(PIXELS).fill(255);
    const masked = applyMask(full);
    expect(masked.filter((v) => v > 0)).toHaveLength(489);
  });

  it('has a ring that starts at the top and has no duplicates', () => {
    expect(RING[0]).toEqual([12, 0]);
    expect(new Set(RING.map(([x, y]) => `${x},${y}`)).size).toBe(RING.length);
    expect(RING.every(([x, y]) => isLed(x, y))).toBe(true);
  });
});

describe('protocol', () => {
  it('round-trips a frame', () => {
    const px = Array.from({ length: PIXELS }, (_, i) => i % 256);
    expect(decodePcMessage(encode({ t: 'frame', px }))).toEqual({ t: 'frame', px });
  });

  it('rejects bad frames', () => {
    expect(decodePcMessage(JSON.stringify({ t: 'frame', px: [1, 2, 3] }))).toBeNull();
    expect(decodePcMessage(JSON.stringify({ t: 'frame', px: new Array(PIXELS).fill(256) }))).toBeNull();
    expect(decodePcMessage(JSON.stringify({ t: 'frame', px: new Array(PIXELS).fill(1.5) }))).toBeNull();
    expect(decodePcMessage('not json')).toBeNull();
    expect(decodePcMessage('[]')).toBeNull();
    expect(decodePcMessage(JSON.stringify({ t: 'nope' }))).toBeNull();
  });

  it('only accepts 6-digit pairing codes', () => {
    expect(decodePcMessage(JSON.stringify({ t: 'pair', code: '123456', name: 'pc' }))).not.toBeNull();
    expect(decodePcMessage(JSON.stringify({ t: 'pair', code: '12345', name: 'pc' }))).toBeNull();
    expect(decodePcMessage(JSON.stringify({ t: 'pair', code: 123456, name: 'pc' }))).toBeNull();
  });

  it('reads phone messages', () => {
    expect(decodePhoneMessage('{"t":"event","source":"button","action":"long"}')).toEqual({
      t: 'event',
      source: 'button',
      action: 'long',
    });
    expect(decodePhoneMessage('{"t":"event","source":"button","action":"smash"}')).toBeNull();
    expect(decodePhoneMessage('{"t":"error","code":"bad_code","message":"x"}')?.t).toBe('error');
  });
});

describe('text', () => {
  it('renders letters proportionally', () => {
    expect(renderText('I').width).toBe(3);
    expect(renderText('A').width).toBe(5);
    expect(renderText('AI').width).toBe(5 + 1 + 3);
    expect(renderText('').width).toBe(0);
  });

  it('draws a recognisable glyph', () => {
    expect(frameToAscii(staticTextFrame(renderText('Hi'))).split('\n').slice(9, 16)).toMatchInlineSnapshot(`
      [
        "        #   #  #         ",
        "        #   #            ",
        "        #   # ##         ",
        "        #####  #         ",
        "        #   #  #         ",
        "        #   #  #         ",
        "        #   # ###        ",
      ]
    `);
  });

  it('scrolls from fully off the right to fully off the left', () => {
    const strip = renderText('HELLO WORLD');
    const sum = (step: number) => scrollFrame(strip, step).reduce((a, b) => a + b, 0);
    expect(sum(0)).toBe(0);
    expect(sum(10)).toBeGreaterThan(0);
    expect(sum(scrollLength(strip) - 1)).toBeGreaterThan(0);
    expect(sum(scrollLength(strip))).toBe(0); // wraps
  });

  it('tiny digits are 3 wide and the clock fits', () => {
    expect(renderTiny('8').width).toBe(3);
    expect(renderTiny('12:34').width).toBe(17);
  });

  it('text source ends after its loops', () => {
    const src = textSource('HELLO WORLD', { loops: 2 });
    const length = scrollLength(renderText('HELLO WORLD'));
    expect(src.next(length * 2 - 1)).not.toBeNull();
    expect(src.next(length * 2)).toBeNull();
  });
});

describe('images', () => {
  const solid = (w: number, h: number, fn: (x: number, y: number) => number) => {
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = fn(x, y);
        rgba.set([v, v, v, 255], (y * w + x) * 4);
      }
    return rgba;
  };

  it('keeps left/right orientation and masks corners', () => {
    const frame = rgbaToFrame(solid(100, 100, (x) => (x < 50 ? 255 : 0)), 100, 100, { gamma: 1 });
    expect(frame[12 * SIZE + 2]).toBe(255);
    expect(frame[12 * SIZE + 22]).toBe(0);
    expect(frame[0]).toBe(0);
  });

  it('inverts', () => {
    const frame = rgbaToFrame(solid(50, 50, (x) => (x < 25 ? 255 : 0)), 50, 50, { invert: true, gamma: 1 });
    expect(frame[12 * SIZE + 2]).toBe(0);
    expect(frame[12 * SIZE + 22]).toBe(255);
  });

  it('dithers a mid grey into roughly half the pixels', () => {
    const rgba = solid(25, 25, () => 128);
    const frame = rgbaToFrame(rgba, 25, 25, { normalize: false, gamma: 1, levels: 2, dither: true });
    const on = frame.filter((v) => v === 255).length;
    expect(frame.every((v) => v === 0 || v === 255)).toBe(true);
    expect(on).toBeGreaterThan(489 * 0.4);
    expect(on).toBeLessThan(489 * 0.6);
  });

  it('treats transparent pixels as black', () => {
    const rgba = new Uint8Array(10 * 10 * 4).fill(255);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 0;
    expect(rgbaToFrame(rgba, 10, 10, { normalize: false }).every((v) => v === 0)).toBe(true);
  });

  it('rejects mismatched data', () => {
    expect(() => rgbaToFrame(new Uint8Array(8), 10, 10)).toThrow();
  });
});

describe('widgets', () => {
  it('formats durations', () => {
    expect(formatDuration(25 * 60)).toBe('25:00');
    expect(formatDuration(59.2)).toBe('01:00');
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(2 * 3600 + 5 * 60)).toBe('2:05');
  });

  it('timer ring drains', () => {
    const lit = (f: Uint8Array) => RING.filter(([x, y]) => f[y * SIZE + x] === 255).length;
    expect(lit(timerFrame(1500, 1500))).toBe(RING.length);
    expect(lit(timerFrame(750, 1500))).toBe(Math.round(RING.length / 2));
    expect(lit(timerFrame(0, 1500))).toBe(0);
  });

  it('clock and meter draw inside the circle', () => {
    for (const frame of [clockFrame(new Date(2026, 10, 13, 9, 41, 30)), meterFrame(42, 77), meterFrame(100, 100)]) {
      expect(applyMask(frame)).toEqual(frame);
      expect(frame.some((v) => v === 255)).toBe(true);
    }
  });
});

describe('player', () => {
  it('plays a finite source to the end and blanks', async () => {
    const player = new Player();
    const frames: number[] = [];
    player.onFrame((f) => frames.push(f.reduce((a, b) => a + b, 0)));
    const a = blankFrame();
    a[12 * SIZE + 12] = 255;
    await player.play(animationSource([a, a], 30, false));
    expect(frames.length).toBe(3);
    expect(frames.at(-1)).toBe(0);
    expect(player.label).toBeNull();
  });

  it('shows a notice, then goes back to what was playing', async () => {
    const player = new Player();
    const labels: (string | null)[] = [];
    player.onSourceChange((label) => labels.push(label));
    const dot = blankFrame();
    dot[12 * SIZE + 12] = 255;
    player.show(dot, 'base');
    player.notify(animationSource([dot, dot], 30, false, 'first'));
    player.notify(animationSource([dot], 30, false, 'second'));
    await new Promise((r) => setTimeout(r, 250));
    expect(labels.filter((l) => l !== null)).toEqual(['base', 'first', 'second', 'base']);
    expect(player.label).toBe('base');
    player.stop();
  });

  it('does not go back if the user plays something during a notice', async () => {
    const player = new Player();
    const dot = blankFrame();
    player.show(dot, 'base');
    player.notify(animationSource([dot, dot, dot, dot], 30, false, 'notice'));
    player.show(dot, 'chosen');
    await new Promise((r) => setTimeout(r, 200));
    expect(player.label).toBe('chosen');
    player.stop();
  });

  it('a notice blinks the ring, passes once and ends', () => {
    const source = noticeSource('HI');
    let ticks = 0;
    while (source.next(ticks) !== null && ticks < 10_000) ticks++;
    expect(ticks).toBeGreaterThan(10);
    expect(ticks).toBeLessThan(200);
    const lit = (tick: number) => source.next(tick)!.reduce((a, b) => a + (b ? 1 : 0), 0);
    expect(lit(0)).toBe(RING.length);
    expect(lit(3)).toBe(0);
  });

  it('resolves the old play when a new source replaces it', async () => {
    const player = new Player();
    const first = player.play(textSource('forever and ever and ever'));
    player.show(blankFrame());
    await first;
    player.stop();
  });
});

describe('github connector', () => {
  const push = (id: number, type = 'push') => ({ id, ref: 'refs/heads/main', activity_type: type, actor: { login: 'octocat' } });
  const run = (id: number, status: string, conclusion: string | null) => ({ id, name: 'Build', head_branch: 'main', status, conclusion });

  it('takes stock on the first poll without replaying history', () => {
    const news = githubNews('me/repo', null, [push(2), push(1)], [run(10, 'completed', 'success')]);
    expect(news.messages).toEqual([]);
    expect(news.snapshot).toEqual({ activity: [2, 1], runs: [10] });
  });

  it('reports new pushes oldest first, and CI once it finishes', () => {
    const first = githubNews('me/repo', null, [push(1)], [run(10, 'in_progress', null)]);
    const second = githubNews('me/repo', first.snapshot, [push(3, 'force_push'), push(2), push(1)], [run(10, 'in_progress', null)]);
    expect(second.messages).toEqual(['REPO: OCTOCAT PUSHED TO MAIN', 'REPO: OCTOCAT FORCE-PUSHED MAIN']);
    const third = githubNews('me/repo', second.snapshot, [push(3), push(2), push(1)], [run(10, 'completed', 'failure')]);
    expect(third.messages).toEqual(['REPO: BUILD FAILED ON MAIN']);
    const fourth = githubNews('me/repo', third.snapshot, [push(3)], [run(10, 'completed', 'failure')]);
    expect(fourth.messages).toEqual([]);
  });

  it('respects what is switched off and stays quiet about cancelled runs', () => {
    const base = githubNews('me/repo', null, [], []).snapshot;
    const news = githubNews('me/repo', base, [push(1)], [run(10, 'completed', 'success'), run(11, 'completed', 'cancelled')], { pushes: false, ci: true });
    expect(news.messages).toEqual(['REPO: BUILD PASSED ON MAIN']);
  });
});
