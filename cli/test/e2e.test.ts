import { afterEach, describe, expect, it } from 'vitest';
import { MatrixClient, blankFrame, type ConnectionState } from '@matrix-bridge/core';
import { startSimulator, type Simulator } from '../src/sim';

let sim: Simulator | null = null;
const clients: MatrixClient[] = [];

afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  await sim?.close();
  sim = null;
});

function client(port: number, token?: string): MatrixClient {
  const c = new MatrixClient({ host: '127.0.0.1', port, name: 'test', token, maxFps: 200 });
  clients.push(c);
  return c;
}

const until = (c: MatrixClient, state: ConnectionState) =>
  new Promise<void>((resolve) => {
    if (c.state === state) return resolve();
    const off = c.on('state', (s) => s === state && (off(), resolve()));
  });

const waitFor = async (check: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('PC <-> phone over a real socket', () => {
  it('pairs, sends frames, and reconnects with the token', async () => {
    sim = await startSimulator({ port: 0, code: '123456' });
    const a = client(sim.port);
    let token = '';
    a.on('paired', (t) => (token = t));
    a.connect();
    await until(a, 'pairing');

    const errors: string[] = [];
    a.on('error', (code) => errors.push(code));
    a.pair('000000');
    await waitFor(() => errors.includes('bad_code'));
    expect(a.state).toBe('pairing');

    a.pair('123456');
    await until(a, 'connected');
    expect(token).not.toBe('');

    const frame = blankFrame();
    frame[12 * 25 + 12] = 200;
    a.sendFrame(frame);
    await waitFor(() => sim!.frame[12 * 25 + 12] === 200);

    a.setBrightness(40);
    await waitFor(() => sim!.brightness === 40);
    a.clear();
    await waitFor(() => sim!.frame.every((v) => v === 0));
    a.disconnect();

    const b = client(sim.port, token);
    b.connect();
    await until(b, 'connected');
  });

  it('refuses frames from a client that has not paired', async () => {
    sim = await startSimulator({ port: 0, code: '123456' });
    const ws = new WebSocket(`ws://127.0.0.1:${sim.port}`);
    const messages: string[] = [];
    ws.onmessage = (ev) => messages.push(String(ev.data));
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ t: 'frame', px: new Array(625).fill(255) }));
    await waitFor(() => messages.some((m) => m.includes('unauthorized')));
    expect(sim.frame.every((v) => v === 0)).toBe(true);
    ws.close();
  });

  it('asks to pair again when the phone has forgotten the token', async () => {
    sim = await startSimulator({ port: 0 });
    const c = client(sim.port, 'stale-token');
    c.connect();
    await until(c, 'pairing');
    expect(c.token).toBeNull();
  });

  it('locks pairing after five wrong codes', async () => {
    sim = await startSimulator({ port: 0, code: '123456' });
    const c = client(sim.port);
    const errors: string[] = [];
    c.on('error', (code) => errors.push(code));
    c.connect();
    await until(c, 'pairing');
    for (let i = 0; i < 6; i++) c.pair('999999');
    await waitFor(() => errors.includes('locked'));
    c.pair('123456');
    await waitFor(() => errors.filter((e) => e === 'locked').length >= 2);
    expect(c.state).toBe('pairing');
  });

  it('delivers button events only while the toy is selected', async () => {
    sim = await startSimulator({ port: 0, code: '123456' });
    const c = client(sim.port);
    const presses: string[] = [];
    c.on('button', (a) => presses.push(a));
    c.connect();
    await until(c, 'pairing');
    c.pair('123456');
    await until(c, 'connected');

    sim.pressButton('long');
    sim.setToy(true);
    await waitFor(() => c.toyActive);
    sim.pressButton('long');
    await waitFor(() => presses.length === 1);
    expect(presses).toEqual(['long']);
  });

  it('reconnects by itself after the phone restarts', async () => {
    sim = await startSimulator({ port: 0, code: '123456' });
    const port = sim.port;
    const c = client(port);
    c.connect();
    await until(c, 'pairing');
    c.pair('123456');
    await until(c, 'connected');

    await sim.close();
    await until(c, 'reconnecting');
    sim = await startSimulator({ port, code: '123456' });
    // A restarted simulator has no memory of the token, like a phone whose app data was cleared.
    await until(c, 'pairing');
  }, 15000);
});
