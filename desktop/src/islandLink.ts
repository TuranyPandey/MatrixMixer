/**
 * The wire between the main window and the island window. The main window owns
 * the phone connection and the player; the island only mirrors them and sends
 * commands back. Must not import bridge.ts, or the island would open a second
 * connection to the phone.
 *
 * In the desktop app this rides on Tauri events. In a plain browser
 * (`npm run dev:web`, open /island.html in a second tab) it uses a BroadcastChannel.
 */
import { emit, listen } from '@tauri-apps/api/event';
import type { ConnectionState } from '@matrix-bridge/core';
import { isTauri } from './native';

export type IslandState = {
  connection: ConnectionState;
  phoneName: string | null;
  /** What is on the matrix, e.g. "text: hello". Null when blank. */
  playing: string | null;
  brightness: number;
  /** A job in progress, 0-100. Null when none. */
  progress: number | null;
  /** The microphone or camera is in use. */
  onAir: boolean;
  /** Widgets that cannot start yet: no ticker symbols, or no place set for the weather. */
  notReady: IslandWidget[];
};

/** Widgets the island can put on the matrix, by what follows "widget: " in `playing`. */
export type IslandWidget = 'clock' | 'system meter' | 'load graph' | 'visualiser' | 'ticker' | 'weather';

/** Readings for the island's Widgets tab. Only sent while that tab is open. */
export type IslandLive = {
  /** Percent, 0-100. Null until the first reading. */
  cpu: number | null;
  ram: number | null;
  /** Null until the first answer; empty if no price could be fetched. */
  quotes: { symbol: string; price: number; changePercent?: number | null }[] | null;
  weather: { place: string; temperature: number; kind: string; fahrenheit: boolean } | null;
  timer: { remaining: number; phase: 'focus' | 'break' | 'done'; running: boolean } | null;
};

/** Main window to island. */
export type ToIsland = { t: 'state'; state: IslandState } | { t: 'frame'; px: number[] } | { t: 'live'; live: IslandLive };

/** Island to main window. */
export type FromIsland =
  | { t: 'hello' }
  | { t: 'text'; text: string }
  | { t: 'widget'; name: IslandWidget }
  /** The Widgets tab came into view (or went away): start or stop sending readings. */
  | { t: 'watch'; on: boolean }
  /** `start` begins a 25/5 Pomodoro, `toggle` pauses or resumes, `stop` ends or dismisses. */
  | { t: 'timer'; do: 'start' | 'toggle' | 'stop' }
  | { t: 'brightness'; value: number }
  | { t: 'clear' }
  | { t: 'open' }
  | { t: 'hide' };

type Channels = { 'island:to': ToIsland; 'island:from': FromIsland };

const channels = new Map<string, BroadcastChannel>();
function channel(name: string): BroadcastChannel {
  let bc = channels.get(name);
  if (!bc) channels.set(name, (bc = new BroadcastChannel(`matrix-bridge.${name}`)));
  return bc;
}

export function send<K extends keyof Channels>(name: K, message: Channels[K]): void {
  if (isTauri) void emit(name, message).catch(() => {});
  else channel(name).postMessage(message);
}

/** Returns the function that stops listening. */
export function receive<K extends keyof Channels>(name: K, handler: (message: Channels[K]) => void): () => void {
  if (isTauri) {
    const stop = listen<Channels[K]>(name, (event) => handler(event.payload));
    return () => void stop.then((fn) => fn());
  }
  const bc = channel(name);
  const onMessage = (event: MessageEvent) => handler(event.data as Channels[K]);
  bc.addEventListener('message', onMessage);
  return () => bc.removeEventListener('message', onMessage);
}
