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
  | 'command';
export type ButtonBinding = { kind: ActionKind; command: string };

export type Settings = {
  host: string;
  port: number;
  token: string | null;
  brightness: number;
  buttons: Record<ButtonAction, ButtonBinding>;
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
};

const KEY = 'matrix-bridge.settings';

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { ...DEFAULTS, ...saved, buttons: { ...DEFAULTS.buttons, ...saved.buttons } };
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
    set({ connection, phoneName: c.phoneName, ...(connection === 'connected' ? { error: null } : {}) });
    // Whatever is playing shows up straight away after a (re)connect.
    if (connection === 'connected') c.sendFrame(player.current);
  });
  c.on('paired', (token) => updateSettings({ token }));
  c.on('toy', (toyActive) => set({ toyActive }));
  c.on('error', (code, message) => {
    if (code === 'bad_token') updateSettings({ token: null });
    set({ error: ERROR_TEXT[code] ?? message });
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

export function pair(code: string): void {
  set({ error: null });
  client?.pair(code);
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

async function handleButton(action: ButtonAction): Promise<void> {
  const binding = state.settings.buttons[action];
  let result = 'No action set';
  if (binding.kind !== 'none') {
    try {
      await runAction(binding.kind, binding.command);
      result = 'Done';
    } catch (err) {
      result = err instanceof Error ? err.message : String(err);
    }
  }
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

async function handleApi(request: ApiRequest): Promise<void> {
  try {
    const body = request.body ? (JSON.parse(request.body) as Record<string, unknown>) : {};
    const query = new URLSearchParams(request.query);
    switch (request.path) {
      case '/text': {
        const text = typeof body.text === 'string' ? body.text : '';
        if (!text) return;
        const loops = typeof body.loops === 'number' && body.loops > 0 ? body.loops : Infinity;
        const speedMs = typeof body.speedMs === 'number' ? Math.max(20, Math.min(1000, body.speedMs)) : 60;
        void player.play(textSource(text, { loops, speedMs }));
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
