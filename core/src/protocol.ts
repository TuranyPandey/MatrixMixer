/**
 * MatrixMixer wire protocol, version 1.
 *
 * JSON text messages over a WebSocket. The phone is the server, the PC is the
 * client. Every message is an object with a `t` (type) field.
 * See docs/PROTOCOL.md for the full conversation.
 */

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 8765;
/** DNS-SD service type the phone advertises. */
export const MDNS_SERVICE = '_matrixbridge._tcp';

/** Phone (3) Glyph Matrix is a 25x25 grid (489 of the 625 cells are real LEDs). */
export const SIZE = 25;
export const PIXELS = SIZE * SIZE;

// ---- PC -> phone -----------------------------------------------------------

export type PairMessage = { t: 'pair'; code: string; name: string };
export type AuthMessage = { t: 'auth'; token: string; name?: string };
/** `px` is 625 brightness values, row by row from the top-left, each 0-255. */
export type FrameMessage = { t: 'frame'; px: number[] };
/** Global brightness the phone multiplies every frame by. 0-255. */
export type BrightnessMessage = { t: 'brightness'; value: number };
export type ClearMessage = { t: 'clear' };
export type PingMessage = { t: 'ping' };

export type PcMessage =
  | PairMessage
  | AuthMessage
  | FrameMessage
  | BrightnessMessage
  | ClearMessage
  | PingMessage;

// ---- phone -> PC -----------------------------------------------------------

export type HelloMessage = { t: 'hello'; v: number; device: string; name: string; size: number };
export type PairedMessage = { t: 'paired'; token: string };
export type ReadyMessage = { t: 'ready' };
export type ErrorCode = 'bad_code' | 'bad_token' | 'unauthorized' | 'bad_message' | 'locked';
export type ErrorMessage = { t: 'error'; code: ErrorCode; message: string };
export type ButtonAction = 'down' | 'up' | 'long';
/** Glyph Button activity. Only sent while the "PC Remote" toy is the selected Glyph Toy. */
export type EventMessage = { t: 'event'; source: 'button'; action: ButtonAction };
/** `toy` is true while the PC Remote toy is selected on the phone. */
export type StatusMessage = { t: 'status'; toy: boolean };
export type PongMessage = { t: 'pong' };

export type PhoneMessage =
  | HelloMessage
  | PairedMessage
  | ReadyMessage
  | ErrorMessage
  | EventMessage
  | StatusMessage
  | PongMessage;

// ---- encode / decode -------------------------------------------------------

export function encode(msg: PcMessage | PhoneMessage): string {
  return JSON.stringify(msg);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parse(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return isObj(v) && typeof v.t === 'string' ? v : null;
  } catch {
    return null;
  }
}

const isByte = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255;

/** Validates a message sent by the PC. Returns null if it is malformed. */
export function decodePcMessage(text: string): PcMessage | null {
  const m = parse(text);
  if (!m) return null;
  switch (m.t) {
    case 'pair':
      return typeof m.code === 'string' && /^\d{6}$/.test(m.code)
        ? { t: 'pair', code: m.code, name: typeof m.name === 'string' ? m.name.slice(0, 64) : 'PC' }
        : null;
    case 'auth':
      return typeof m.token === 'string' && m.token.length > 0 && m.token.length <= 256
        ? { t: 'auth', token: m.token, name: typeof m.name === 'string' ? m.name.slice(0, 64) : undefined }
        : null;
    case 'frame':
      return Array.isArray(m.px) && m.px.length === PIXELS && m.px.every(isByte)
        ? { t: 'frame', px: m.px as number[] }
        : null;
    case 'brightness':
      return isByte(m.value) ? { t: 'brightness', value: m.value } : null;
    case 'clear':
      return { t: 'clear' };
    case 'ping':
      return { t: 'ping' };
    default:
      return null;
  }
}

const ERROR_CODES: ErrorCode[] = ['bad_code', 'bad_token', 'unauthorized', 'bad_message', 'locked'];

/** Validates a message sent by the phone. Returns null if it is malformed. */
export function decodePhoneMessage(text: string): PhoneMessage | null {
  const m = parse(text);
  if (!m) return null;
  switch (m.t) {
    case 'hello':
      return typeof m.v === 'number'
        ? {
            t: 'hello',
            v: m.v,
            device: typeof m.device === 'string' ? m.device : 'unknown',
            name: typeof m.name === 'string' ? m.name : 'Phone',
            size: typeof m.size === 'number' ? m.size : SIZE,
          }
        : null;
    case 'paired':
      return typeof m.token === 'string' && m.token ? { t: 'paired', token: m.token } : null;
    case 'ready':
      return { t: 'ready' };
    case 'error':
      return ERROR_CODES.includes(m.code as ErrorCode)
        ? { t: 'error', code: m.code as ErrorCode, message: typeof m.message === 'string' ? m.message : '' }
        : null;
    case 'event':
      return m.source === 'button' && (m.action === 'down' || m.action === 'up' || m.action === 'long')
        ? { t: 'event', source: 'button', action: m.action }
        : null;
    case 'status':
      return typeof m.toy === 'boolean' ? { t: 'status', toy: m.toy } : null;
    case 'pong':
      return { t: 'pong' };
    default:
      return null;
  }
}
