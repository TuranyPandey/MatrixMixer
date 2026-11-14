/**
 * The app's one connection and one player, kept outside React so they survive
 * tab switches and the window being hidden to the tray.
 */
import { useSyncExternalStore } from 'react';
import {
  DEFAULT_PORT,
  MatrixClient,
  Player,
  frameFromArray,
  noticeSource,
  rgbaToFrame,
  textSource,
  type ButtonAction,
  type ConnectionState,
  type Frame,
  type ImageOptions,
} from '@matrix-bridge/core';
import { onApiRequest, pcName, reportStatus, runAction, transport, type ApiRequest } from './native';

// ---- settings (remembered between launches) --------------------------------

export type ActionKind =
  | 'none'
  | 'play_pause'
  | 'next_track'
  | 'previous_track'
  | 'mute_volume'
  | 'mute_mic'
  | 'lock'
  | 'command'
  /** Step to the next widget in `widgets.rotation`. Runs in this app, not as a system action. */
  | 'next_widget';
export type ButtonBinding = { kind: ActionKind; command: string };

/** Things that reach the matrix on their own. See connectors.ts. */
export type ConnectorSettings = {
  github: { enabled: boolean; repos: string[]; pushes: boolean; ci: boolean };
  battery: { enabled: boolean; low: number };
  /** Ring lights up while the microphone or camera is in use. */
  onair: { enabled: boolean; mic: boolean; camera: boolean };
  /** A notice when a new track starts. */
  music: { enabled: boolean };
  /** Notices before events from a private .ics link. `lead` is minutes of warning. */
  calendar: { enabled: boolean; url: string; lead: number };
  /** Game HUD. `token` is what the game must send along; made once, on first use. */
  game: { enabled: boolean; token: string };
};

export type WidgetSettings = {
  /** Yahoo Finance symbols: AAPL, BTC-USD, RELIANCE.NS. */
  ticker: string[];
  weather: { place: string; latitude: number; longitude: number; fahrenheit: boolean } | null;
  /** Clock widget: 12-hour instead of 24-hour. */
  hour12: boolean;
  /** Widgets the Glyph Button steps through with its "Next widget" action, in order. */
  rotation: string[];
};

export type Settings = {
  host: string;
  port: number;
  token: string | null;
  brightness: number;
  buttons: Record<ButtonAction, ButtonBinding>;
  connectors: ConnectorSettings;
  /** Show the floating island on the desktop. See islandHost.ts. */
  island: boolean;
  /** Where the island sits: 0-2 along the top (left, centre, right), 3-5 along the bottom. */
  islandPlace: number;
  widgets: WidgetSettings;
  /** Master speed for everything that scrolls: milliseconds per step, lower is faster. */
  textSpeed: number;
  /** A patch of dot matrix that follows the pointer around the main window. */
  cursorDots: boolean;
  /** Its radius in pixels. */
  cursorRadius: number;
};

const DEFAULTS: Settings = {
  host: '',
  port: DEFAULT_PORT,
  token: null,
  brightness: 255,
  buttons: {
    long: { kind: 'play_pause', command: '' },
    down: { kind: 'none', command: '' },
    up: { kind: 'none', command: '' },
  },
  connectors: {
    github: { enabled: false, repos: [], pushes: true, ci: true },
    battery: { enabled: false, low: 20 },
    onair: { enabled: false, mic: true, camera: true },
    music: { enabled: false },
    calendar: { enabled: false, url: '', lead: 10 },
    game: { enabled: false, token: '' },
  },
  widgets: { ticker: ['BTC-USD', 'ETH-USD', 'AAPL'], weather: null, hour12: false, rotation: ['clock', 'system meter', 'load graph', 'visualiser'] },
  textSpeed: 60,
  cursorDots: true,
  cursorRadius: 110,
  island: true,
  islandPlace: 1,
};

const KEY = 'matrix-bridge.settings';

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return {
      ...DEFAULTS,
      ...saved,
      buttons: { ...DEFAULTS.buttons, ...saved.buttons },
      connectors: {
        github: { ...DEFAULTS.connectors.github, ...saved.connectors?.github },
        battery: { ...DEFAULTS.connectors.battery, ...saved.connectors?.battery },
        onair: { ...DEFAULTS.connectors.onair, ...saved.connectors?.onair },
        music: { ...DEFAULTS.connectors.music, ...saved.connectors?.music },
        calendar: { ...DEFAULTS.connectors.calendar, ...saved.connectors?.calendar },
        game: { ...DEFAULTS.connectors.game, ...saved.connectors?.game },
      },
      widgets: { ...DEFAULTS.widgets, ...saved.widgets },
    };
  } catch {
    return DEFAULTS;
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state.settings));
  } catch {
    /* storage unavailable: settings just last for this session */
  }
}

// ---- observable state ---------------------------------------------------------

export type BridgeState = {
  settings: Settings;
  connection: ConnectionState;
  phoneName: string | null;
  toyActive: boolean;
  /** Last problem worth showing, in plain words. Cleared on the next success. */
  error: string | null;
  /** A pairing code was sent and the phone has not answered yet. */
  pairPending: boolean;
  /** What is on the matrix right now, e.g. "text: hello". Null when blank. */
  playing: string | null;
  lastButton: { action: ButtonAction; at: number; result: string } | null;
};

let state: BridgeState = {
  settings: loadSettings(),
  connection: 'offline',
  phoneName: null,
  toyActive: false,
  error: null,
  pairPending: false,
  playing: null,
  lastButton: null,
};

const subscribers = new Set<() => void>();

function set(patch: Partial<BridgeState>): void {
  state = { ...state, ...patch };
  subscribers.forEach((fn) => fn());
  reportStatus({
    ok: true,
    state: state.connection,
    phone: state.phoneName,
    playing: state.playing,
    toy: state.toyActive,
  });
}

export function useBridge(): BridgeState {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => state,
  );
}

/** For code outside React (the island host). Returns the unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function getState(): BridgeState {
  return state;
}

/** For code outside React (connectors, widgets). */
/** The master text speed, as a function, so text that is already scrolling follows the slider. */
export const textSpeed = (): number => state.settings.textSpeed;
/** Notices pass a little quicker than ordinary text. */
export const noticeSpeed = (): number => state.settings.textSpeed * 0.75;

/**
 * Sends text to the matrix. A set number of passes goes over whatever is
 * showing and then hands the matrix back to it (or leaves it dark if nothing
 * was). "Forever" replaces what is showing, like any other source.
 */
export function sendText(text: string, options: { loops?: number; speedMs?: number | (() => number) } = {}): void {
  const { loops = 1, speedMs = textSpeed } = options;
  const source = textSource(text, { loops, speedMs });
  if (Number.isFinite(loops)) player.interject(source);
  else void player.play(source);
}

export function getSettings(): Settings {
  return state.settings;
}

export function updateSettings(patch: Partial<Settings>): void {
  set({ settings: { ...state.settings, ...patch } });
  saveSettings();
}

// ---- player and connection -----------------------------------------------------

export const player = new Player();
let client: MatrixClient | null = null;

player.onFrame((frame) => client?.sendFrame(frame));
player.onSourceChange((label) => set({ playing: label }));

const ERROR_TEXT: Record<string, string> = {
  bad_code: 'That code does not match the one on the phone.',
  locked: 'Too many wrong codes. Wait 30 seconds and use the new code on the phone.',
  bad_token: 'The phone no longer knows this PC. Enter the code on the phone to pair again.',
  connect_failed: 'Could not reach the phone. Check the app is started and both devices are on the same network.',
};

export async function connect(host: string, port: number): Promise<void> {
  client?.disconnect();
  updateSettings({ host, port });
  const name = await pcName();
  const c = new MatrixClient({ host, port, name, token: state.settings.token, transport });
  client = c;
  c.on('state', (connection) => {
    if (client !== c) return;
    set({ connection, phoneName: c.phoneName, pairPending: c.pairing, ...(connection === 'connected' ? { error: null } : {}) });
    // Whatever is playing shows up straight away after a (re)connect.
    if (connection === 'connected') c.sendFrame(player.current);
  });
  c.on('paired', (token) => updateSettings({ token }));
  c.on('toy', (toyActive) => set({ toyActive }));
  c.on('error', (code, message) => {
    // A client that was replaced may still be closing; what it hears is no longer news.
    if (client !== c) return;
    if (code === 'bad_token') updateSettings({ token: null });
    // Pairing errors only mean something while pairing. Once linked they are stale.
    if ((code === 'bad_code' || code === 'locked') && c.state !== 'pairing') return;
    set({ error: ERROR_TEXT[code] ?? message, pairPending: c.pairing });
  });
  c.on('button', (action) => void handleButton(action));
  c.setBrightness(state.settings.brightness);
  set({ error: null, toyActive: false });
  c.connect();
}

export function disconnect(): void {
  client?.disconnect();
  client = null;
  set({ connection: 'offline', toyActive: false });
}

export function clearError(): void {
  set({ error: null });
}

export function pair(code: string): void {
  if (!client || client.pairing) return;
  client.pair(code);
  set({ error: null, pairPending: client.pairing });
}

/** Forget the pairing on this PC. The phone keeps its side until "Forget" is tapped there. */
export function forgetPhone(): void {
  disconnect();
  updateSettings({ token: null });
}

export function setBrightness(value: number): void {
  updateSettings({ brightness: value });
  client?.setBrightness(value);
}

export function clearMatrix(): void {
  player.stop();
  client?.clear();
}

/** Actions carried out inside this app instead of by the system (see `registerAction`). */
const localActions = new Map<string, () => Promise<string>>();

/**
 * Lets another module provide a button action. widgets.ts uses this for
 * "Next widget": it imports this file, so this file cannot import it back.
 * The function resolves with a few words for the "Last:" line.
 */
export function registerAction(kind: ActionKind, run: () => Promise<string>): void {
  localActions.set(kind, run);
}

/** Runs what a gesture is bound to. Resolves with a few words on what happened. */
export async function runBinding(binding: ButtonBinding): Promise<string> {
  const local = localActions.get(binding.kind);
  if (local) return local();
  await runAction(binding.kind, binding.command);
  return 'Done';
}

async function handleButton(action: ButtonAction): Promise<void> {
  const binding = state.settings.buttons[action];
  let result = 'No action set';
  if (binding.kind !== 'none') {
    try {
      result = await runBinding(binding);
    } catch (err) {
      result = err instanceof Error ? err.message : String(err);
    }
  }
  // A long-press is followed by "up" straight away. A gesture with no action must not hide the result of one that ran.
  const last = state.lastButton;
  if (binding.kind === 'none' && last && last.result !== 'No action set' && Date.now() - last.at < 3000) return;
  set({ lastButton: { action, at: Date.now(), result } });
}

// ---- images ------------------------------------------------------------------------

/** Draws any image source the browser can decode and reduces it to a frame. */
export function bitmapToFrame(image: CanvasImageSource, width: number, height: number, options: Partial<ImageOptions>): Frame {
  // Shrinking 4000px photos in JS is slow; let the canvas do most of it first.
  const scale = Math.min(1, 200 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, w, h);
  return rgbaToFrame(ctx.getImageData(0, 0, w, h).data, w, h, options);
}

// ---- local API requests (from the CLI and scripts) ---------------------------------

/** Endpoints handled elsewhere (activities.ts): path to handler, given the parsed JSON body. */
export const apiHandlers = new Map<string, (body: Record<string, unknown>) => void>();

/** Who to hand `POST /notify` texts to. Empty means "just show it". */
export const apiNotices = new Set<(text: string) => void>();

async function handleApi(request: ApiRequest): Promise<void> {
  try {
    const body = request.body ? (JSON.parse(request.body) as Record<string, unknown>) : {};
    const query = new URLSearchParams(request.query);
    switch (request.path) {
      case '/text': {
        const text = typeof body.text === 'string' ? body.text : '';
        if (!text) return;
        const loops = typeof body.loops === 'number' && body.loops > 0 ? body.loops : Infinity;
        // No speed given: follow the master speed, live.
        const speedMs = typeof body.speedMs === 'number' ? Math.max(20, Math.min(1000, body.speedMs)) : textSpeed;
        sendText(text, { loops, speedMs });
        break;
      }
      case '/notify': {
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text) return;
        // connectors.ts listens here so script notices show up in its recent list too.
        if (apiNotices.size > 0) apiNotices.forEach((fn) => fn(text));
        else player.notify(noticeSource(text, noticeSpeed));
        break;
      }
      case '/frame':
        if (Array.isArray(body.px)) player.show(frameFromArray(body.px as number[]), 'frame (API)');
        break;
      case '/image': {
        const bytes = Uint8Array.from(atob(request.bodyBase64), (ch) => ch.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes]));
        const flag = (name: string) => ['1', 'true'].includes(query.get(name) ?? '');
        player.show(
          bitmapToFrame(bitmap, bitmap.width, bitmap.height, {
            invert: flag('invert'),
            fit: query.get('fit') === 'contain' ? 'contain' : 'cover',
            ...(flag('dither') ? { dither: true, levels: 2 } : {}),
          }),
          'image (API)',
        );
        bitmap.close();
        break;
      }
      case '/clear':
        clearMatrix();
        break;
      case '/brightness':
        if (typeof body.value === 'number') setBrightness(Math.max(0, Math.min(255, Math.round(body.value))));
        break;
      default:
        apiHandlers.get(request.path)?.(body);
    }
  } catch (err) {
    set({ error: `API request ${request.path} failed: ${err instanceof Error ? err.message : err}` });
  }
}

onApiRequest((request) => void handleApi(request));

// Reconnect to the last phone on launch.
if (state.settings.host && state.settings.token) {
  void connect(state.settings.host, state.settings.port);
}
