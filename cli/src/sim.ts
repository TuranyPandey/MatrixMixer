import { randomBytes, randomInt } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  DEFAULT_PORT,
  MDNS_SERVICE,
  PROTOCOL_VERSION,
  SIZE,
  blankFrame,
  decodePcMessage,
  encode,
  frameFromArray,
  isLed,
  type ButtonAction,
  type Frame,
  type PhoneMessage,
} from '@matrix-bridge/core';

/**
 * A pretend Phone (3). Speaks the same protocol as the Android app, so the
 * desktop app and CLI can be built and tested with no phone on the desk.
 * Keep its rules in step with android/.../BridgeServer.kt.
 */
export type SimulatorOptions = {
  port?: number;
  /** Fix the pairing code (tests). Random otherwise. */
  code?: string;
  /** Announce on the network so `matrix discover` and the desktop app find it. */
  advertise?: boolean;
  onFrame?: (frame: Frame, brightness: number) => void;
  onLog?: (line: string) => void;
};

export type Simulator = {
  port: number;
  /** Current pairing code. Changes after every successful pairing. */
  readonly code: string;
  readonly frame: Frame;
  readonly brightness: number;
  readonly clients: number;
  /** Pretend the Glyph Button was used. Only delivered while the toy is "selected". */
  pressButton(action: ButtonAction): void;
  /** Pretend the PC Remote toy was selected or deselected. */
  setToy(active: boolean): void;
  close(): Promise<void>;
};

const MAX_BAD_CODES = 5;
const LOCK_MS = 30_000;

const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export async function startSimulator(options: SimulatorOptions = {}): Promise<Simulator> {
  const log = options.onLog ?? (() => {});
  const tokens = new Set<string>();
  const authed = new Set<WebSocket>();
  let code = options.code ?? newCode();
  let badCodes = 0;
  let lockedUntil = 0;
  let frame = blankFrame();
  let brightness = 255;
  let toy = false;

  const wss = new WebSocketServer({ port: options.port ?? DEFAULT_PORT });
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });
  const address = wss.address();
  const port = typeof address === 'object' && address ? address.port : (options.port ?? DEFAULT_PORT);

  const send = (ws: WebSocket, msg: PhoneMessage) => ws.send(encode(msg));
  const show = () => options.onFrame?.(frame, brightness);

  const accept = (ws: WebSocket) => {
    authed.add(ws);
    send(ws, { t: 'ready' });
    send(ws, { t: 'status', toy });
  };

  wss.on('connection', (ws) => {
    send(ws, { t: 'hello', v: PROTOCOL_VERSION, device: 'simulator', name: 'Simulated Phone (3)', size: SIZE });
    ws.on('close', () => authed.delete(ws));
    ws.on('message', (data, isBinary) => {
      const msg = isBinary ? null : decodePcMessage(data.toString());
      if (!msg) return send(ws, { t: 'error', code: 'bad_message', message: 'Could not read that message' });
      if (msg.t === 'ping') return send(ws, { t: 'pong' });

      if (msg.t === 'pair') {
        if (Date.now() < lockedUntil) {
          return send(ws, { t: 'error', code: 'locked', message: 'Too many wrong codes. Wait 30 seconds.' });
        }
        if (msg.code !== code) {
          if (++badCodes >= MAX_BAD_CODES) {
            badCodes = 0;
            lockedUntil = Date.now() + LOCK_MS;
            code = options.code ?? newCode();
          }
          return send(ws, { t: 'error', code: 'bad_code', message: 'That code does not match the phone' });
        }
        badCodes = 0;
        const token = randomBytes(24).toString('base64url');
        tokens.add(token);
        code = options.code ?? newCode();
        log(`Paired with "${msg.name}". New code: ${code}`);
        send(ws, { t: 'paired', token });
        return accept(ws);
      }

      if (msg.t === 'auth') {
        if (!tokens.has(msg.token)) {
          return send(ws, { t: 'error', code: 'bad_token', message: 'This computer is not paired' });
        }
        return accept(ws);
      }

      if (!authed.has(ws)) {
        return send(ws, { t: 'error', code: 'unauthorized', message: 'Pair first' });
      }
      if (msg.t === 'frame') frame = frameFromArray(msg.px);
      else if (msg.t === 'brightness') brightness = msg.value;
      else if (msg.t === 'clear') frame = blankFrame();
      show();
    });
  });

  let unpublish: (() => void) | null = null;
  if (options.advertise) {
    try {
      const { Bonjour } = await import('bonjour-service');
      const bonjour = new Bonjour();
      const type = MDNS_SERVICE.replace(/^_/, '').replace(/\._tcp$/, '');
      bonjour.publish({ name: 'MatrixMixer Simulator', type, port });
      unpublish = () => bonjour.destroy();
    } catch (err) {
      log(`mDNS advertising unavailable: ${err instanceof Error ? err.message : err}`);
    }
  }

  return {
    port,
    get code() {
      return code;
    },
    get frame() {
      return frame;
    },
    get brightness() {
      return brightness;
    },
    get clients() {
      return authed.size;
    },
    pressButton(action) {
      if (!toy) return;
      for (const ws of authed) send(ws, { t: 'event', source: 'button', action });
    },
    setToy(active) {
      toy = active;
      for (const ws of authed) send(ws, { t: 'status', toy });
    },
    close() {
      unpublish?.();
      for (const ws of wss.clients) ws.terminate();
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
}

/** Draws a frame in the terminal with greyscale dots, two characters per LED. */
export function renderAnsi(frame: Frame, brightness: number): string {
  let out = '';
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!isLed(x, y)) {
        out += '  ';
        continue;
      }
      const v = Math.round((frame[y * SIZE + x]! * brightness) / 255);
      const g = 28 + Math.round((v / 255) * 227);
      out += `\x1b[38;2;${g};${g};${g}m● `;
    }
    out += '\x1b[0m\n';
  }
  return out;
}

/** Interactive simulator for `matrix sim`. */
export async function runSimulatorCli(port: number): Promise<void> {
  let status = '';
  const draw = (frame: Frame, brightness: number) => {
    process.stdout.write('\x1b[H' + renderAnsi(frame, brightness));
    process.stdout.write(`\x1b[K\n\x1b[K${header()}\n\x1b[K${status}\n`);
  };
  const sim = await startSimulator({
    port,
    advertise: true,
    onFrame: draw,
    onLog: (line) => {
      status = line;
      draw(sim.frame, sim.brightness);
    },
  });
  let toy = false;
  const header = () =>
    `Simulated Phone (3) on port ${sim.port}  |  pairing code ${sim.code}  |  toy ${toy ? 'ON' : 'off'}\n` +
    `\x1b[Kkeys: [t] select/deselect PC Remote toy   [b] long-press   [d] touch down   [u] touch up   [q] quit`;

  process.stdout.write('\x1b[2J\x1b[?25l');
  draw(sim.frame, sim.brightness);

  const quit = async () => {
    process.stdout.write('\x1b[?25h\n');
    await sim.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void quit());
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (buf) => {
      const key = buf.toString();
      if (key === 'q' || key === '\u0003') return void quit();
      if (key === 't') {
        toy = !toy;
        sim.setToy(toy);
        status = toy ? 'PC Remote toy selected: button events are live' : 'Toy deselected';
      } else if (key === 'b' || key === 'd' || key === 'u') {
        const action: ButtonAction = key === 'b' ? 'long' : key === 'd' ? 'down' : 'up';
        status = toy ? `Sent button "${action}"` : 'Press [t] first: buttons only work while the toy is selected';
        sim.pressButton(action);
      }
      draw(sim.frame, sim.brightness);
    });
  }
  await new Promise(() => {}); // run until quit
}
