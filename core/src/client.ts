import { framesEqual, type Frame } from './frame';
import {
  DEFAULT_PORT,
  MAX_STORED_FRAMES,
  PROTOCOL_VERSION,
  decodePhoneMessage,
  encode,
  type ButtonAction,
  type ErrorCode,
  type PcMessage,
} from './protocol';

/**
 * A minimal socket. The CLI and browser use the built-in WebSocket; the Tauri
 * app plugs in its own so the connection is made from Rust, outside the
 * webview's mixed-content rules.
 */
export type Transport = { send(text: string): void; close(): void };
export type TransportHandlers = { onMessage(text: string): void; onClose(): void };
/** Opens a socket. Resolves once it is open, rejects if it cannot connect. */
export type TransportFactory = (url: string, handlers: TransportHandlers) => Promise<Transport>;

/** Transport on the standard WebSocket global (browsers, Node 22+). */
export const webSocketTransport: TransportFactory = (url, handlers) =>
  new Promise((resolve, reject) => {
    let opened = false;
    const ws = new WebSocket(url);
    ws.onopen = () => {
      opened = true;
      resolve({ send: (text) => ws.send(text), close: () => ws.close() });
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') handlers.onMessage(ev.data);
    };
    ws.onerror = () => {
      if (!opened) reject(new Error(`Could not connect to ${url}`));
    };
    ws.onclose = () => {
      if (opened) handlers.onClose();
    };
  });

export type ConnectionState =
  /** Not connected and not trying. */
  | 'offline'
  | 'connecting'
  /** Socket is open but the phone wants a pairing code. */
  | 'pairing'
  | 'connected'
  /** Lost the phone; retrying in the background. */
  | 'reconnecting';

export type ClientOptions = {
  host: string;
  port?: number;
  /** Name shown on the phone's list of paired computers. */
  name: string;
  /** Token from a previous pairing, if any. */
  token?: string | null;
  transport?: TransportFactory;
  /** Reconnect when the connection drops. Default true. */
  autoReconnect?: boolean;
  /** Cap on frames sent per second. Extra frames are dropped, newest wins. Default 20. */
  maxFps?: number;
};

export type ClientEvents = {
  state: (state: ConnectionState) => void;
  /** Pairing succeeded. Save the token and pass it in next time. */
  paired: (token: string) => void;
  button: (action: ButtonAction) => void;
  /** The PC Remote toy was selected or deselected on the phone. */
  toy: (active: boolean) => void;
  /** The phone saved the glyph sent with `store()`. */
  stored: (name: string) => void;
  /** The phone's own battery, 0-100. */
  battery: (level: number, charging: boolean) => void;
  error: (code: ErrorCode | 'connect_failed' | 'version', message: string) => void;
};

const PING_MS = 5000;
const DEAD_MS = 13000;

/** Connection to one phone: handshake, pairing, keep-alive, reconnects and frame throttling. */
export class MatrixClient {
  state: ConnectionState = 'offline';
  /** Name the phone reported in its hello. */
  phoneName: string | null = null;
  toyActive = false;

  private opts: Required<Omit<ClientOptions, 'token'>> & { token: string | null };
  private transport: Transport | null = null;
  private listeners: { [K in keyof ClientEvents]: Set<ClientEvents[K]> } = {
    state: new Set(),
    paired: new Set(),
    button: new Set(),
    toy: new Set(),
    stored: new Set(),
    battery: new Set(),
    error: new Set(),
  };
  private wanted = false;
  private attempt = 0;
  private generation = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeard = 0;

  private lastSent: Frame | null = null;
  private pending: Frame | null = null;
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFrameAt = 0;
  private brightness: number | null = null;
  /** A `pair` was sent and the phone has not answered yet. */
  private pairSent = false;

  constructor(options: ClientOptions) {
    this.opts = {
      port: DEFAULT_PORT,
      transport: webSocketTransport,
      autoReconnect: true,
      maxFps: 20,
      ...options,
      token: options.token ?? null,
    };
  }

  get url(): string {
    const host = this.opts.host.includes(':') && !this.opts.host.startsWith('[') ? `[${this.opts.host}]` : this.opts.host;
    return `ws://${host}:${this.opts.port}`;
  }

  get token(): string | null {
    return this.opts.token;
  }

  on<K extends keyof ClientEvents>(event: K, fn: ClientEvents[K]): () => void {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }

  private emit<K extends keyof ClientEvents>(event: K, ...args: Parameters<ClientEvents[K]>): void {
    for (const fn of this.listeners[event]) (fn as (...a: Parameters<ClientEvents[K]>) => void)(...args);
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit('state', state);
  }

  /** Starts connecting and keeps the connection alive until `disconnect()`. */
  connect(): void {
    this.wanted = true;
    this.attempt = 0;
    void this.open();
  }

  disconnect(): void {
    this.wanted = false;
    this.teardown();
    this.setState('offline');
  }

  /** True between `pair()` and the phone's answer. */
  get pairing(): boolean {
    return this.pairSent;
  }

  /** Sends the 6-digit code shown on the phone. Result arrives as `paired` or `error`. Ignored while an attempt is pending. */
  pair(code: string): void {
    // One attempt at a time: a code works once, so a second copy sent before the
    // answer would come back as bad_code after the first one had already paired.
    if (this.state !== 'pairing' || this.pairSent) return;
    this.pairSent = true;
    this.sendRaw({ t: 'pair', code: code.trim(), name: this.opts.name });
  }

  /**
   * Queues a frame. Identical frames are skipped and the rate is capped, so
   * callers can push as often as they like.
   */
  sendFrame(frame: Frame): void {
    this.pending = frame;
    if (this.frameTimer || this.state !== 'connected') return;
    const wait = Math.max(0, 1000 / this.opts.maxFps - (Date.now() - this.lastFrameAt));
    this.frameTimer = setTimeout(() => this.flushFrame(), wait);
  }

  /** 0-255. Remembered and re-sent after a reconnect. */
  setBrightness(value: number): void {
    this.brightness = Math.max(0, Math.min(255, Math.round(value)));
    if (this.state === 'connected') this.sendRaw({ t: 'brightness', value: this.brightness });
  }

  clear(): void {
    this.pending = null;
    this.lastSent = null;
    if (this.state === 'connected') this.sendRaw({ t: 'clear' });
  }

  /**
   * Asks the phone to keep a picture or animation, to show with no PC connected.
   * Answered with a `stored` event. Returns false if there is no connection to send it on.
   */
  store(name: string, frames: Frame[], delayMs: number): boolean {
    if (this.state !== 'connected' || frames.length === 0) return false;
    const delay = Math.max(50, Math.min(1000, Math.round(delayMs)));
    this.sendRaw({ t: 'store', name: name.slice(0, 40), frames: frames.slice(0, MAX_STORED_FRAMES).map((f) => Array.from(f)), delay });
    return true;
  }

  /** Resolves once everything queued has been handed to the socket. */
  async flush(): Promise<void> {
    while (this.frameTimer) await new Promise((r) => setTimeout(r, 10));
  }

  // ---- internals -----------------------------------------------------------

  private flushFrame(): void {
    this.frameTimer = null;
    const frame = this.pending;
    this.pending = null;
    if (!frame || this.state !== 'connected') return;
    if (this.lastSent && framesEqual(frame, this.lastSent)) return;
    this.sendRaw({ t: 'frame', px: Array.from(frame) });
    this.lastSent = frame.slice();
    this.lastFrameAt = Date.now();
  }

  private sendRaw(msg: PcMessage): void {
    try {
      this.transport?.send(encode(msg));
    } catch {
      this.handleClose(this.generation);
    }
  }

  private async open(): Promise<void> {
    this.teardown();
    const gen = ++this.generation;
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting');
    try {
      const transport = await this.opts.transport(this.url, {
        onMessage: (text) => gen === this.generation && this.handleMessage(text),
        onClose: () => this.handleClose(gen),
      });
      if (gen !== this.generation || !this.wanted) return transport.close();
      this.transport = transport;
      this.lastHeard = Date.now();
      this.pingTimer = setInterval(() => {
        if (Date.now() - this.lastHeard > DEAD_MS) return this.handleClose(gen);
        this.sendRaw({ t: 'ping' });
      }, PING_MS);
    } catch (err) {
      if (gen !== this.generation) return;
      if (this.attempt === 0) this.emit('error', 'connect_failed', err instanceof Error ? err.message : String(err));
      this.handleClose(gen);
    }
  }

  private handleMessage(text: string): void {
    this.lastHeard = Date.now();
    const msg = decodePhoneMessage(text);
    if (!msg) return;
    switch (msg.t) {
      case 'hello':
        this.phoneName = msg.name;
        if (msg.v !== PROTOCOL_VERSION) {
          this.emit('error', 'version', `Phone speaks protocol v${msg.v}, this app speaks v${PROTOCOL_VERSION}. Update both.`);
        }
        if (this.opts.token) this.sendRaw({ t: 'auth', token: this.opts.token, name: this.opts.name });
        else this.setState('pairing');
        break;
      case 'paired':
        this.pairSent = false;
        this.opts.token = msg.token;
        this.emit('paired', msg.token);
        break;
      case 'ready':
        this.attempt = 0;
        this.lastSent = null;
        this.setState('connected');
        if (this.brightness !== null) this.sendRaw({ t: 'brightness', value: this.brightness });
        if (this.pending) this.sendFrame(this.pending);
        break;
      case 'error':
        if (msg.code === 'bad_code' || msg.code === 'locked') this.pairSent = false;
        if (msg.code === 'bad_token') {
          // The phone forgot us (app data cleared, or unpaired there). Pair again.
          this.opts.token = null;
          this.setState('pairing');
        }
        this.emit('error', msg.code, msg.message);
        break;
      case 'event':
        this.emit('button', msg.action);
        break;
      case 'status':
        this.toyActive = msg.toy;
        this.emit('toy', msg.toy);
        break;
      case 'stored':
        this.emit('stored', msg.name);
        break;
      case 'battery':
        this.emit('battery', msg.level, msg.charging);
        break;
      case 'pong':
        break;
    }
  }

  private handleClose(gen: number): void {
    if (gen !== this.generation) return;
    this.teardown();
    if (!this.wanted || !this.opts.autoReconnect) {
      this.wanted = false;
      return this.setState('offline');
    }
    this.setState('reconnecting');
    const delay = Math.min(10000, 500 * 2 ** Math.min(this.attempt, 5));
    this.attempt++;
    this.retryTimer = setTimeout(() => void this.open(), delay);
  }

  private teardown(): void {
    this.generation++;
    this.pairSent = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.retryTimer = this.pingTimer = this.frameTimer = null;
    const t = this.transport;
    this.transport = null;
    try {
      t?.close();
    } catch {
      /* already closed */
    }
  }
}
