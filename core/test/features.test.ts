import { describe, expect, it } from 'vitest';
import {
  AMBIENT_STYLES,
  DESIGNS,
  RING,
  ambientAnimation,
  ambientStill,
  countdownFrame,
  lifeStep,
  seededRandom,
  SIZE,
  formatPrice,
  gameFrame,
  getPixel,
  graphFrame,
  isLed,
  onAirFrame,
  progressFrame,
  spectrumFrame,
  spectrumSmoother,
  tickerLine,
  upcomingEvents,
  weatherFrame,
  weatherKind,
} from '../src/index';

const lit = (frame: Uint8Array) => frame.reduce((n, v) => n + (v > 100 ? 1 : 0), 0);
const ringLit = (frame: Uint8Array) => RING.filter(([x, y]) => getPixel(frame, x, y) > 100).length;

describe('activity frames', () => {
  it('progress fills the ring in step with the number', () => {
    expect(ringLit(progressFrame(0))).toBe(0);
    expect(ringLit(progressFrame(50))).toBe(Math.round(RING.length / 2));
    expect(ringLit(progressFrame(250))).toBe(RING.length);
    expect(ringLit(progressFrame(NaN))).toBe(0);
  });

  it('on air keeps the whole ring lit and breathes', () => {
    const [x, y] = RING[0]!;
    expect(getPixel(onAirFrame('MIC', 0), x, y)).toBe(255);
    expect(getPixel(onAirFrame('MIC', 1), x, y)).toBeLessThan(255);
    expect(lit(onAirFrame('MIC', 0))).toBeGreaterThan(RING.length);
  });

  it('spectrum bars grow from the middle to the rim of the circle', () => {
    const loud = spectrumFrame(Array(12).fill(1));
    expect(spectrumFrame([]).every((v) => v === 0)).toBe(true); // silence is fully dark
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        // Full bars fill their columns exactly: lit wherever there is an LED, never outside.
        if (x % 2 === 1) expect(getPixel(loud, x, y) > 0).toBe(isLed(x, y));
        expect(getPixel(loud, x, y)).toBe(getPixel(loud, x, SIZE - 1 - y));
      }
    }
    const bass = spectrumFrame([1]);
    expect(getPixel(bass, 1, 10)).toBeGreaterThan(100);
    expect(getPixel(bass, 23, 10)).toBe(0);
  });

  it('spectrum caps sit above their bars', () => {
    const frame = spectrumFrame([0, 0, 0, 0, 0, 0.2], [0, 0, 0, 0, 0, 1]);
    expect(getPixel(frame, 11, 0)).toBe(255);
    expect(getPixel(frame, 11, 5)).toBe(0);
  });

  it('smoother rises fast, sinks slowly and lets caps hang', () => {
    const smooth = spectrumSmoother();
    const hit = [1, ...Array(11).fill(0)];
    const quiet = Array(12).fill(0);
    const first = smooth(hit).levels[0]!;
    expect(first).toBeGreaterThan(0.5);
    expect(first).toBeLessThan(1);
    for (let i = 0; i < 6; i++) smooth(hit);
    expect(smooth(hit).levels[0]).toBe(1);
    const after = smooth(quiet);
    expect(after.levels[0]).toBeGreaterThan(0.9);
    expect(after.levels[0]).toBeLessThan(1);
    expect(after.peaks[0]).toBe(1);
    for (let i = 0; i < 80; i++) smooth(quiet);
    expect(smooth(quiet)).toEqual({ levels: quiet, peaks: quiet });
  });

  it('a bar between two heights shows a dimmer dot at its tip', () => {
    const reachAtCentre = 12;
    const frame = spectrumFrame([0, 0, 0, 0, 0, 2.5 / reachAtCentre]);
    expect(getPixel(frame, 11, 12 - 2)).toBeGreaterThan(200);
    expect(getPixel(frame, 11, 12 - 3)).toBeGreaterThan(60);
    expect(getPixel(frame, 11, 12 - 3)).toBeLessThan(getPixel(frame, 11, 12 - 2));
    expect(getPixel(frame, 11, 12 - 4)).toBe(0);
  });

  it('smoother scales to recent loudness without zooming in on near-silence', () => {
    const smooth = spectrumSmoother();
    expect(smooth(Array(12).fill(0.05)).levels[0]).toBe(0);
    const soft = spectrumSmoother();
    for (let i = 0; i < 2000; i++) soft(Array(12).fill(0.4));
    expect(soft(Array(12).fill(0.4)).levels[0]).toBe(1);
  });

  it('graph puts the newest sample on the right', () => {
    const frame = graphFrame([100]);
    expect(getPixel(frame, 24, 12)).toBeGreaterThan(0);
    expect(getPixel(frame, 12, 12)).toBe(0);
    expect(lit(graphFrame(Array(25).fill(100)))).toBeGreaterThan(lit(graphFrame(Array(25).fill(10))));
  });

  it('game HUD shows health on the ring and ammo on the bar', () => {
    expect(ringLit(gameFrame(100, null))).toBe(RING.length);
    expect(ringLit(gameFrame(0, 1))).toBe(0);
    expect(lit(gameFrame(50, 1))).toBeGreaterThan(lit(gameFrame(50, 0)));
  });

  it('weather picks a picture and draws the temperature', () => {
    expect(weatherKind(0)).toBe('clear');
    expect(weatherKind(3)).toBe('cloud');
    expect(weatherKind(63)).toBe('rain');
    expect(weatherKind(73)).toBe('snow');
    expect(weatherKind(96)).toBe('storm');
    expect(weatherKind(45)).toBe('fog');
    expect(lit(weatherFrame(-12, 'snow'))).toBeGreaterThan(lit(weatherFrame(7, 'snow')));
  });
});

describe('ticker', () => {
  it('shortens prices', () => {
    expect(formatPrice(97234)).toBe('97.2K');
    expect(formatPrice(1234567)).toBe('1.23M');
    expect(formatPrice(184.4)).toBe('184');
    expect(formatPrice(3.416)).toBe('3.42');
    expect(formatPrice(0.04123)).toBe('0.0412');
  });

  it('builds one line', () => {
    const line = tickerLine([
      { symbol: 'btc', price: 97234, changePercent: 1.23 },
      { symbol: 'AAPL', price: 184, changePercent: -0.4 },
      { symbol: 'X', price: 2 },
    ]);
    expect(line).toBe('BTC 97.2K +1.2%   AAPL 184 -0.4%   X 2.00');
  });
});

describe('calendar', () => {
  const wrap = (events: string[][]) =>
    ['BEGIN:VCALENDAR', ...events.flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']), 'END:VCALENDAR', ''].join('\r\n');
  const utc = (text: string) => Date.parse(text);
  const FAR = utc('2030-01-01T00:00:00Z');

  it('finds a single event in the window, with folded and escaped text', () => {
    const ics = wrap([
      ['SUMMARY:Stand-up\\, team', '  sync', 'DTSTART:20261113T093000Z'],
      ['SUMMARY:Later', 'DTSTART:20261120T093000Z'],
    ]);
    const events = upcomingEvents(ics, utc('2026-11-13T00:00:00Z'), utc('2026-11-14T00:00:00Z'));
    expect(events).toEqual([{ title: 'Stand-up, team sync', start: utc('2026-11-13T09:30:00Z'), allDay: false }]);
  });

  it('converts a named time zone', () => {
    const ics = wrap([['SUMMARY:Call', 'DTSTART;TZID=Asia/Kolkata:20261113T150000']]);
    expect(upcomingEvents(ics, 0, FAR)[0]!.start).toBe(utc('2026-11-13T09:30:00Z'));
  });

  it('repeats weekly on the listed days, minus exclusions', () => {
    const ics = wrap([['SUMMARY:Gym', 'DTSTART:20261102T180000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', 'EXDATE:20261111T180000Z']]);
    const days = upcomingEvents(ics, utc('2026-11-09T00:00:00Z'), utc('2026-11-15T23:59:59Z')).map((e) => new Date(e.start).toISOString().slice(0, 10));
    expect(days).toEqual(['2026-11-09', '2026-11-13']);
  });

  it('honours INTERVAL, COUNT and UNTIL', () => {
    const counted = wrap([['SUMMARY:A', 'DTSTART:20261101T100000Z', 'RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3']]);
    expect(upcomingEvents(counted, 0, FAR).map((e) => new Date(e.start).getUTCDate())).toEqual([1, 3, 5]);
    const until = wrap([['SUMMARY:B', 'DTSTART:20261101T100000Z', 'RRULE:FREQ=DAILY;UNTIL=20261103T100000Z']]);
    expect(upcomingEvents(until, 0, FAR)).toHaveLength(3);
  });

  it('skips cancelled events and rules it does not understand', () => {
    const ics = wrap([
      ['SUMMARY:Off', 'STATUS:CANCELLED', 'DTSTART:20261113T093000Z'],
      ['SUMMARY:Second Tuesday', 'DTSTART:20261110T093000Z', 'RRULE:FREQ=MONTHLY;BYDAY=2TU'],
    ]);
    expect(upcomingEvents(ics, 0, FAR)).toEqual([]);
  });
});

describe('meeting countdown', () => {
  it('drains clockwise from the top and ends dark', () => {
    const full = lit(countdownFrame(1));
    expect(full).toBeGreaterThan(450);
    expect(lit(countdownFrame(0.5))).toBeGreaterThan(full * 0.45);
    expect(lit(countdownFrame(0.5))).toBeLessThan(full * 0.55);
    expect(lit(countdownFrame(0))).toBe(0);
    // Half gone: the right half (the first half of the time) is what has emptied.
    const half = countdownFrame(0.5);
    expect(getPixel(half, 18, 12)).toBeLessThan(100);
    expect(getPixel(half, 6, 12)).toBeGreaterThan(100);
  });
});

describe('ready-made designs', () => {
  it.each(DESIGNS.map((d) => [d.name, d.frame] as const))('%s is drawn and sits inside the circle', (_name, frame) => {
    expect(lit(frame)).toBeGreaterThan(60);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (!isLed(x, y)) expect(getPixel(frame, x, y)).toBe(0);
    // Whole 2x2 blocks only: nothing was clipped by the round edge.
    expect(lit(frame) % 4).toBe(0);
  });
});

describe('ambient animations', () => {
  const blinker = () => {
    const cells = new Uint8Array(SIZE * SIZE);
    for (const x of [11, 12, 13]) cells[12 * SIZE + x] = 1;
    return cells;
  };

  it('life follows the rules: a blinker flips and flips back', () => {
    const once = lifeStep(blinker());
    expect([11, 12, 13].map((y) => once[y * SIZE + 12])).toEqual([1, 1, 1]);
    expect(once.reduce((n, v) => n + v, 0)).toBe(3);
    expect(Array.from(lifeStep(once))).toEqual(Array.from(blinker()));
  });

  it('life never grows past the rim', () => {
    const full = new Uint8Array(SIZE * SIZE).fill(1);
    const next = lifeStep(full);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (!isLed(x, y)) expect(next[y * SIZE + x]).toBe(0);
  });

  it.each(AMBIENT_STYLES.map((s) => s.id))('%s keeps moving, stays on real LEDs and never goes dark for long', (style) => {
    const next = ambientAnimation(style, seededRandom(1));
    const frames = Array.from({ length: 400 }, () => next());
    for (const frame of frames) {
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (!isLed(x, y)) expect(getPixel(frame, x, y)).toBe(0);
    }
    // After a short warm-up there is always something lit, including across a Life reseed.
    const dark = frames.slice(20).filter((f) => f.every((v) => v === 0)).length;
    expect(dark).toBeLessThan(4);
    expect(new Set(frames.slice(20).map((f) => f.join())).size).toBeGreaterThan(40);
  });

  it('the still is the same every time', () => {
    expect(ambientStill('rain')).toBe(ambientStill('rain'));
    expect(lit(ambientStill('stars'))).toBeGreaterThan(3);
  });
});
