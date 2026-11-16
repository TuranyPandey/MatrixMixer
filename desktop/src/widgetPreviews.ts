/**
 * What each widget would look like right now, as frames for the small
 * matrices on the widget shelf (main window) and in the island. Pure: it must
 * not import bridge.ts, because the island uses it too.
 */
import {
  alarmFrame,
  ambientStill,
  clockFrame,
  graphFrame,
  meterFrame,
  renderText,
  spectrumFrame,
  staticTextFrame,
  timerFrame,
  weatherFrame,
  type AmbientStyle,
  type Frame,
  type WeatherKind,
} from '@matrix-bridge/core';

export type ShelfId = 'clock' | 'timer' | 'system meter' | 'load graph' | 'visualiser' | 'ticker' | 'weather' | 'ambient';

export const SHELF: Array<{ id: ShelfId; name: string; about: string }> = [
  { id: 'clock', name: 'Clock', about: 'The time, big enough to read from across the desk.' },
  { id: 'timer', name: 'Timer', about: 'A Pomodoro or a plain countdown. The ring drains as time runs out; break time is dimmer than focus time.' },
  { id: 'system meter', name: 'System', about: 'Ring and number show CPU load. The bar underneath is memory in use.' },
  { id: 'load graph', name: 'Load', about: 'CPU load over the last 25 seconds as a bar chart, newest on the right.' },
  { id: 'visualiser', name: 'Visualiser', about: 'A spectrum of whatever this PC is playing: bass on the left, treble on the right, with caps that hang on the hits.' },
  { id: 'ticker', name: 'Ticker', about: "Prices scroll past with today's change, refreshed every minute." },
  { id: 'weather', name: 'Weather', about: 'A small picture of the sky with the temperature under it, refreshed every 15 minutes.' },
  { id: 'ambient', name: 'Ambient', about: 'Nothing to read, just something alive on the back of the phone.' },
];

/** A spectrum that looks like music. The real one only runs while the visualiser is shown. */
const SAMPLE_BANDS = [0.5, 0.82, 0.95, 0.7, 0.58, 0.74, 0.46, 0.36, 0.5, 0.3, 0.2, 0.12];

export type PreviewInput = {
  now: Date;
  hour12: boolean;
  timer: { remaining: number; total: number; phase: 'focus' | 'break' | 'done' } | null;
  cpu: number;
  ram: number;
  /** CPU readings, oldest first. */
  history: readonly number[];
  /** First ticker symbol, e.g. "BTC-USD". */
  symbol: string | null;
  weather: { temperature: number; kind: string } | null;
  ambient: AmbientStyle;
};

export function previewFrames(p: PreviewInput): Record<ShelfId, Frame> {
  return {
    clock: clockFrame(p.now, p.hour12),
    timer: !p.timer
      ? timerFrame(25 * 60 * 0.7, 25 * 60)
      : p.timer.phase === 'done'
        ? alarmFrame(p.now.getSeconds())
        : timerFrame(p.timer.remaining, p.timer.total, p.timer.phase === 'break'),
    'system meter': meterFrame(p.cpu, p.ram),
    'load graph': graphFrame(p.history),
    visualiser: spectrumFrame(SAMPLE_BANDS, SAMPLE_BANDS),
    ticker: staticTextFrame(renderText((p.symbol ?? 'BTC').replace(/-USD$|\..*$/, '').slice(0, 4))),
    weather: p.weather ? weatherFrame(p.weather.temperature, p.weather.kind as WeatherKind) : weatherFrame(21, 'clear'),
    ambient: ambientStill(p.ambient),
  };
}
