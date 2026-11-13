/**
 * Live widgets. Timer state lives here, not in React, so a Pomodoro keeps
 * counting while you are on another tab or the window is hidden.
 */
import { useSyncExternalStore } from 'react';
import {
  alarmFrame,
  clockFrame,
  graphFrame,
  liveSource,
  meterFrame,
  spectrumFrame,
  spectrumSmoother,
  textSource,
  tickerLine,
  timerFrame,
  weatherFrame,
  weatherKind,
  type Frame,
  type Quote,
} from '@matrix-bridge/core';
import { getSettings, player, updateSettings } from './bridge';
import { audioBands, fetchText, systemStats } from './native';

export function startClock(hour12: boolean): void {
  void player.play(liveSource('widget: clock', 500, () => clockFrame(new Date(), hour12)));
}

export function startMeter(): void {
  let latest: Frame = meterFrame(0, 0);
  const sample = () =>
    void systemStats()
      .then(({ cpu, ram }) => (latest = meterFrame(cpu, ram)))
      .catch(() => {});
  sample();
  void player.play(
    liveSource('widget: system meter', 1000, () => {
      sample();
      return latest;
    }),
  );
}

/** CPU load over the last 25 seconds as a bar chart. */
export function startGraph(): void {
  const history: number[] = [];
  void player.play(
    liveSource('widget: load graph', 1000, () => {
      void systemStats()
        .then(({ cpu }) => {
          history.push(cpu);
          if (history.length > 25) history.shift();
        })
        .catch(() => {});
      return graphFrame(history);
    }),
  );
}

/** A spectrum of whatever this PC is playing: bass on the left, treble on the right. */
export function startVisualiser(): void {
  const smooth = spectrumSmoother();
  let raw: number[] = [];
  void player.play(
    liveSource('widget: visualiser', 35, () => {
      // The answer lands a moment later and is drawn on the next frame.
      void audioBands()
        .then((bands) => (raw = bands))
        .catch(() => {});
      const { levels, peaks } = smooth(raw);
      return spectrumFrame(levels, peaks);
    }),
  );
}

// ---- ticker -------------------------------------------------------------------------

const TICKER_LABEL = 'widget: ticker';
const TICKER_EVERY_MS = 60_000;
let tickerTimer: ReturnType<typeof setInterval> | null = null;

/** Turns what people type ("btc", "AAPL", "reliance.ns") into a Yahoo Finance symbol. */
export function tickerSymbol(input: string): string | null {
  const s = input.trim().toUpperCase();
  if (!/^[A-Z0-9^][A-Z0-9.=^-]{0,14}$/.test(s)) return null;
  return ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB', 'LTC'].includes(s) ? `${s}-USD` : s;
}

/**
 * One quote from Yahoo Finance's chart endpoint. It needs no key but is not an
 * official API, so it may change or go away without notice.
 */
async function quote(symbol: string): Promise<Quote> {
  const text = await fetchText(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`);
  const meta = (JSON.parse(text) as { chart?: { result?: Array<{ meta?: Record<string, unknown> }> } }).chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== 'number') throw new Error(`No price for ${symbol}`);
  const previous = meta?.chartPreviousClose;
  const changePercent = typeof previous === 'number' && previous > 0 ? ((price - previous) / previous) * 100 : null;
  return { symbol: symbol.replace(/-USD$|\.[A-Z]+$/, ''), price, changePercent };
}

/** Starts the ticker. Resolves with a message if no price could be fetched. */
export async function startTicker(): Promise<string | null> {
  const symbols = getSettings().widgets.ticker;
  if (symbols.length === 0) return 'Add a symbol first.';
  const load = async () => (await Promise.allSettled(symbols.map(quote))).flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const show = (quotes: Quote[]) => void player.play({ ...textSource(tickerLine(quotes), { speedMs: 55 }), label: TICKER_LABEL });
  const quotes = await load();
  if (quotes.length === 0) return 'Could not fetch any prices. Check the symbols and your connection.';
  show(quotes);
  if (tickerTimer) clearInterval(tickerTimer);
  tickerTimer = setInterval(() => {
    if (player.label !== TICKER_LABEL) {
      clearInterval(tickerTimer!);
      tickerTimer = null;
      return;
    }
    void load().then((fresh) => {
      if (fresh.length > 0 && player.label === TICKER_LABEL) show(fresh);
    });
  }, TICKER_EVERY_MS);
  return null;
}

// ---- weather ------------------------------------------------------------------------

const WEATHER_LABEL = 'widget: weather';
const WEATHER_EVERY_MS = 15 * 60_000;

/** Looks a town up with Open-Meteo (free, no key) and remembers where it is. */
export async function setWeatherPlace(name: string, fahrenheit: boolean): Promise<string | null> {
  const text = await fetchText(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(name.trim())}`);
  const hit = (JSON.parse(text) as { results?: Array<{ name: string; country_code?: string; latitude: number; longitude: number }> }).results?.[0];
  if (!hit) return `Could not find "${name.trim()}".`;
  const place = hit.country_code ? `${hit.name}, ${hit.country_code}` : hit.name;
  updateSettings({ widgets: { ...getSettings().widgets, weather: { place, latitude: hit.latitude, longitude: hit.longitude, fahrenheit } } });
  return null;
}

async function readWeather(): Promise<Frame> {
  const w = getSettings().widgets.weather!;
  const unit = w.fahrenheit ? '&temperature_unit=fahrenheit' : '';
  const text = await fetchText(
    `https://api.open-meteo.com/v1/forecast?latitude=${w.latitude}&longitude=${w.longitude}&current=temperature_2m,weather_code${unit}`,
  );
  const current = (JSON.parse(text) as { current?: { temperature_2m?: number; weather_code?: number } }).current;
  if (typeof current?.temperature_2m !== 'number') throw new Error('No weather came back');
  return weatherFrame(current.temperature_2m, weatherKind(current.weather_code ?? 3));
}

/** Shows the weather for the saved place. Resolves with a message if it could not be read. */
export async function startWeather(): Promise<string | null> {
  if (!getSettings().widgets.weather) return 'Set a place first.';
  let frame: Frame;
  try {
    frame = await readWeather();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  let readAt = Date.now();
  void player.play(
    liveSource(WEATHER_LABEL, 5000, () => {
      if (Date.now() - readAt > WEATHER_EVERY_MS) {
        readAt = Date.now();
        void readWeather()
          .then((fresh) => (frame = fresh))
          .catch(() => {});
      }
      return frame;
    }),
  );
  return null;
}

// ---- timers (Pomodoro and plain countdown share one engine) ----------------------

export type TimerState = {
  kind: 'pomodoro' | 'countdown';
  phase: 'focus' | 'break' | 'done';
  running: boolean;
  /** Seconds left in this phase. */
  remaining: number;
  total: number;
  focusMinutes: number;
  breakMinutes: number;
  /** Completed focus sessions since the timer was started. */
  rounds: number;
};

let timer: TimerState | null = null;
/** Wall-clock time the current phase ends, while running. */
let endsAt = 0;
const listeners = new Set<() => void>();
const LABEL = 'widget: timer';

function publish(next: TimerState | null): void {
  timer = next;
  listeners.forEach((fn) => fn());
}

export function useTimer(): TimerState | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => timer,
  );
}

function render(tick: number): Frame | null {
  if (!timer) return null;
  if (timer.running) {
    const remaining = Math.max(0, (endsAt - Date.now()) / 1000);
    if (remaining <= 0) advance();
    else if (Math.ceil(remaining) !== Math.ceil(timer.remaining)) publish({ ...timer, remaining });
    else timer.remaining = remaining;
  }
  if (!timer) return null;
  if (timer.phase === 'done') return alarmFrame(Math.floor(tick / 2));
  return timerFrame(timer.remaining, timer.total, timer.phase === 'break');
}

/** Moves to the next phase when the clock runs out. */
function advance(): void {
  if (!timer) return;
  if (timer.kind === 'countdown') {
    publish({ ...timer, phase: 'done', running: false, remaining: 0 });
    return;
  }
  const toBreak = timer.phase === 'focus';
  const total = (toBreak ? timer.breakMinutes : timer.focusMinutes) * 60;
  endsAt = Date.now() + total * 1000;
  publish({
    ...timer,
    phase: toBreak ? 'break' : 'focus',
    remaining: total,
    total,
    rounds: timer.rounds + (toBreak ? 1 : 0),
  });
}

function show(): void {
  if (player.label !== LABEL) void player.play(liveSource(LABEL, 250, render));
}

export function startPomodoro(focusMinutes: number, breakMinutes: number): void {
  const total = focusMinutes * 60;
  endsAt = Date.now() + total * 1000;
  publish({ kind: 'pomodoro', phase: 'focus', running: true, remaining: total, total, focusMinutes, breakMinutes, rounds: 0 });
  show();
}

export function startCountdown(minutes: number): void {
  const total = Math.max(1, Math.round(minutes * 60));
  endsAt = Date.now() + total * 1000;
  publish({ kind: 'countdown', phase: 'focus', running: true, remaining: total, total, focusMinutes: minutes, breakMinutes: 0, rounds: 0 });
  show();
}

export function toggleTimer(): void {
  if (!timer || timer.phase === 'done') return;
  if (timer.running) publish({ ...timer, running: false });
  else {
    endsAt = Date.now() + timer.remaining * 1000;
    publish({ ...timer, running: true });
  }
  show();
}

export function stopTimer(): void {
  const wasShowing = player.label === LABEL;
  publish(null);
  if (wasShowing) player.stop();
}

// If something else takes over the matrix, a running timer keeps counting in the
// background; tick it so the panel stays right and the phase still changes.
setInterval(() => {
  if (timer?.running && player.label !== LABEL) render(0);
}, 500);
