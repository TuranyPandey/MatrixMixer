import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { createInterface } from 'node:readline/promises';
import {
  DEFAULT_PORT,
  MDNS_SERVICE,
  MatrixClient,
  Player,
  frameFromArray,
  staticSource,
  textSource,
  type Frame,
  type ImageOptions,
  type Source,
} from '@matrix-bridge/core';
import { readApiInfo, readConfig, writeConfig, type ApiInfo } from './config';
import { imageFileToFrame } from './imagefile';
import { runSimulatorCli } from './sim';

const HELP = `matrix - push things to your Phone (3) Glyph Matrix

Usage
  matrix send <text> [--loops n | --forever] [--speed ms]   scroll text
  matrix image <file.png|jpg> [--invert] [--dither] [--contain] [--hold sec]
  matrix frame <file.json | ->                              625 values, 0-255
  matrix brightness <0-255>
  matrix clear
  matrix status

  matrix discover                 find phones on this network
  matrix pair <host> [--port n]   pair this terminal directly with a phone
  matrix sim [--port n]           run a fake phone in this terminal

Options
  --direct      talk to the phone directly, even if the desktop app is running
  --host, --port, --token   override the saved direct connection

When the Matrix Bridge desktop app is running, commands go through it.
Otherwise they connect straight to the phone you set up with "matrix pair".
`;

// ---- argument parsing ------------------------------------------------------

type Args = { positional: string[]; flags: Map<string, string | true> };

const BOOLEAN_FLAGS = new Set(['direct', 'forever', 'invert', 'dither', 'contain', 'help']);

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--') && arg.length > 2) {
      const [name, inline] = arg.slice(2).split('=', 2) as [string, string | undefined];
      if (inline !== undefined) flags.set(name, inline);
      else if (BOOLEAN_FLAGS.has(name)) flags.set(name, true);
      else {
        const value = argv[++i];
        if (value === undefined) fail(`--${name} needs a value`);
        flags.set(name, value);
      }
    } else positional.push(arg);
  }
  return { positional, flags };
}

function fail(message: string): never {
  console.error(`matrix: ${message}`);
  process.exit(1);
}

function numberFlag(args: Args, name: string, fallback: number, min: number, max: number): number {
  const raw = args.flags.get(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) fail(`--${name} must be a number from ${min} to ${max}`);
  return n;
}

// ---- two ways to reach the matrix -----------------------------------------

/** Asks the running desktop app to do it. Returns false if the app is not there. */
async function viaApp(
  api: ApiInfo,
  path: string,
  body?: { json: unknown },
): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${api.port}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${api.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body.json) : undefined,
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 401) fail('The desktop app rejected the token in ~/.matrix-bridge/api.json. Restart the app.');
    if (!res.ok) fail(`Desktop app answered ${res.status}: ${await res.text()}`);
    if (!body) console.log(await res.text());
    return true;
  } catch (err) {
    if (err instanceof Error && /fetch failed|timeout|aborted|ECONNREFUSED/i.test(`${err.message} ${String(err.cause ?? '')}`)) {
      return false; // app not running
    }
    throw err;
  }
}

/** Set just before we hang up on purpose, so the disconnect is not reported as a failure. */
let hangingUp = false;
function hangUp(client: MatrixClient): void {
  hangingUp = true;
  client.disconnect();
}

function directClient(args: Args): MatrixClient {
  const config = readConfig();
  const host = (args.flags.get('host') as string | undefined) ?? config.host;
  const token = (args.flags.get('token') as string | undefined) ?? config.token;
  if (!host || !token) {
    fail('No phone set up. Start the desktop app, or run "matrix pair <phone-ip>" first.');
  }
  const port = numberFlag(args, 'port', config.port ?? DEFAULT_PORT, 1, 65535);
  return new MatrixClient({ host, port, token, name: `${hostname()} (CLI)`, autoReconnect: false });
}

/** Connects straight to the phone and resolves once it is ready for frames. */
function connectDirect(args: Args): Promise<MatrixClient> {
  const client = directClient(args);
  return new Promise((resolve) => {
    const timer = setTimeout(() => fail(`No answer from ${client.url}. Is the phone app running and on this network?`), 6000);
    client.on('error', (code, message) => {
      if (code === 'version') return console.error(`matrix: warning: ${message}`);
      clearTimeout(timer);
      fail(code === 'bad_token' ? 'The phone no longer knows this computer. Run "matrix pair" again.' : message);
    });
    client.on('state', (state) => {
      if (state === 'connected') {
        clearTimeout(timer);
        resolve(client);
      } else if (state === 'offline' && !hangingUp) {
        clearTimeout(timer);
        fail(`Lost the connection to ${client.url}`);
      }
    });
    client.connect();
  });
}

/**
 * Plays a source over a direct connection, then hangs up.
 * `until` is 'done' for sources that end by themselves (scrolling text), or a
 * number of milliseconds to stay connected for ones that never end (a still frame).
 */
async function playDirect(args: Args, source: Source, until: 'done' | number): Promise<void> {
  const client = await connectDirect(args);
  const player = new Player();
  const unsubscribe = player.onFrame((frame) => client.sendFrame(frame));
  const done = player.play(source);
  if (until === 'done') await done;
  else await new Promise((r) => setTimeout(r, Math.max(until, 150)));
  await client.flush();
  unsubscribe(); // so stopping the player does not blank what we just sent
  player.stop();
  await new Promise((r) => setTimeout(r, 80)); // let the last frame leave the socket
  hangUp(client);
}

function useApp(args: Args): ApiInfo | null {
  return args.flags.has('direct') ? null : readApiInfo();
}

// ---- commands --------------------------------------------------------------

async function cmdSend(args: Args): Promise<void> {
  const text = args.positional.slice(1).join(' ');
  if (!text) fail('Nothing to send. Try: matrix send "build passed"');
  const loops = args.flags.has('forever') ? Infinity : numberFlag(args, 'loops', 1, 1, 1000);
  const speedMs = numberFlag(args, 'speed', 60, 20, 1000);
  const api = useApp(args);
  if (api && (await viaApp(api, '/text', { json: { text, loops: Number.isFinite(loops) ? loops : null, speedMs } }))) return;
  await playDirect(args, textSource(text, { loops, speedMs }), 'done');
}

async function cmdImage(args: Args): Promise<void> {
  const file = args.positional[1];
  if (!file) fail('Which file? Try: matrix image logo.png');
  const options: Partial<ImageOptions> = {
    invert: args.flags.has('invert'),
    fit: args.flags.has('contain') ? 'contain' : 'cover',
    ...(args.flags.has('dither') ? { dither: true, levels: 2 } : {}),
  };
  let frame: Frame;
  try {
    frame = imageFileToFrame(file, options);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  await showFrame(args, frame, `image: ${file}`);
}

async function cmdFrame(args: Args): Promise<void> {
  const file = args.positional[1];
  if (!file) fail('Give a JSON file with 625 numbers, or "-" to read stdin');
  let frame: Frame;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8'));
    const px = Array.isArray(parsed) ? parsed : (parsed as { px?: unknown }).px;
    if (!Array.isArray(px)) throw new Error('Expected an array, or an object with a "px" array');
    frame = frameFromArray(px.flat() as number[]);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  await showFrame(args, frame, 'frame');
}

async function showFrame(args: Args, frame: Frame, label: string): Promise<void> {
  const api = useApp(args);
  if (api && (await viaApp(api, '/frame', { json: { px: Array.from(frame) } }))) return;
  const holdSeconds = numberFlag(args, 'hold', 0, 0, 86400);
  await playDirect(args, staticSource(frame, label), holdSeconds * 1000);
  if (holdSeconds === 0) console.error('Sent. The phone keeps it for about 30 seconds after this command exits; use --hold <sec> to stay connected.');
}

async function cmdSimple(args: Args, path: '/clear' | '/brightness'): Promise<void> {
  let value = 0;
  if (path === '/brightness') {
    value = Number(args.positional[1]);
    if (!Number.isInteger(value) || value < 0 || value > 255) fail('Brightness is a whole number from 0 to 255');
  }
  const api = useApp(args);
  if (api && (await viaApp(api, path, { json: path === '/brightness' ? { value } : {} }))) return;
  const client = await connectDirect(args);
  if (path === '/clear') client.clear();
  else client.setBrightness(value);
  await new Promise((r) => setTimeout(r, 120));
  hangUp(client);
}

async function cmdStatus(args: Args): Promise<void> {
  const api = useApp(args);
  if (api && (await viaApp(api, '/status'))) return;
  const config = readConfig();
  if (!config.host) return console.log('Desktop app is not running and no direct phone is paired.');
  const client = await connectDirect(args);
  console.log(`Direct: connected to ${client.phoneName ?? 'phone'} at ${client.url}`);
  hangUp(client);
}

async function cmdDiscover(): Promise<void> {
  const { Bonjour } = await import('bonjour-service');
  const bonjour = new Bonjour();
  const type = MDNS_SERVICE.replace(/^_/, '').replace(/\._tcp$/, '');
  const seen = new Set<string>();
  console.log('Looking for phones for 3 seconds...');
  bonjour.find({ type }, (service) => {
    const address = service.addresses?.find((a) => !a.includes(':')) ?? service.host;
    const key = `${address}:${service.port}`;
    if (seen.has(key)) return;
    seen.add(key);
    console.log(`  ${service.name}  ->  ${key}`);
  });
  await new Promise((r) => setTimeout(r, 3000));
  bonjour.destroy();
  if (seen.size === 0) {
    console.log('None found. Check the phone app is running and both devices are on the same Wi-Fi.');
    console.log('College and hostel networks often block this: use USB instead (see docs/SETUP.md).');
  }
}

async function cmdPair(args: Args): Promise<void> {
  const host = args.positional[1] ?? (args.flags.get('host') as string | undefined);
  if (!host) fail('Which phone? Try "matrix discover", then "matrix pair <ip>". Over USB the host is 127.0.0.1.');
  const port = numberFlag(args, 'port', DEFAULT_PORT, 1, 65535);
  const client = new MatrixClient({ host, port, name: `${hostname()} (CLI)`, autoReconnect: false });
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  await new Promise<void>((resolve) => {
    const ask = async () => {
      const code = (args.flags.get('code') as string | undefined) ?? (await rl.question('6-digit code shown in the phone app: '));
      args.flags.delete('code');
      client.pair(code);
    };
    client.on('state', (state) => {
      if (state === 'pairing') void ask();
      if (state === 'connected') resolve();
      if (state === 'offline' && !hangingUp) fail(`Could not reach ${client.url}`);
    });
    client.on('error', (code, message) => {
      console.error(`matrix: ${message}`);
      if (code === 'bad_code') void ask();
      else if (code !== 'version') process.exit(1);
    });
    client.on('paired', (token) => writeConfig({ host, port, token }));
    client.connect();
  });
  rl.close();
  console.log(`Paired with ${client.phoneName ?? host}. Try: matrix --direct send "hello"`);
  hangUp(client);
}

// ---- main ------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0];
  if (!command || args.flags.has('help') || command === 'help') return void console.log(HELP);
  switch (command) {
    case 'send':
    case 'text':
      return cmdSend(args);
    case 'image':
      return cmdImage(args);
    case 'frame':
      return cmdFrame(args);
    case 'clear':
      return cmdSimple(args, '/clear');
    case 'brightness':
      return cmdSimple(args, '/brightness');
    case 'status':
      return cmdStatus(args);
    case 'discover':
      return cmdDiscover();
    case 'pair':
      return cmdPair(args);
    case 'sim':
      return runSimulatorCli(numberFlag(args, 'port', DEFAULT_PORT, 1, 65535));
    default:
      fail(`Unknown command "${command}". Run "matrix help".`);
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
