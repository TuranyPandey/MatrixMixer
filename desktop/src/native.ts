/**
 * Everything that needs the Tauri shell. In a plain browser (`npm run dev:web`)
 * these fall back to harmless stand-ins, so the UI can be developed against
 * `matrix sim` without building the native app.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import TauriWebSocket from '@tauri-apps/plugin-websocket';
import { webSocketTransport, type TransportFactory } from '@matrix-bridge/core';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type FoundPhone = { name: string; host: string; port: number };
export type ApiInfo = { port: number; token: string };
export type ApiRequest = { path: string; query: string; body: string; bodyBase64: string };

/**
 * Socket opened from Rust instead of the webview. Webviews on macOS and Linux
 * refuse plain ws:// to a LAN address; Rust has no such rule.
 */
const tauriTransport: TransportFactory = async (url, handlers) => {
  const ws = await TauriWebSocket.connect(url);
  let closed = false;
  const closeOnce = () => {
    if (closed) return;
    closed = true;
    handlers.onClose();
  };
  ws.addListener((msg) => {
    if (msg.type === 'Text') handlers.onMessage(msg.data);
    else if (msg.type === 'Close' || (msg.type as string) === 'Error') closeOnce();
  });
  return {
    send: (text) => void ws.send(text).catch(closeOnce),
    close: () => {
      closed = true;
      void ws.disconnect().catch(() => {});
    },
  };
};

export const transport: TransportFactory = isTauri ? tauriTransport : webSocketTransport;

export async function discoverPhones(): Promise<FoundPhone[]> {
  if (!isTauri) throw new Error('Searching the network needs the desktop app. Type the address instead.');
  return invoke<FoundPhone[]>('discover');
}

export async function pcName(): Promise<string> {
  return isTauri ? invoke<string>('pc_name') : 'Browser';
}

export async function systemStats(): Promise<{ cpu: number; ram: number }> {
  if (isTauri) return invoke('system_stats');
  // Browser stand-in: a slow wave so the widget visibly works.
  const t = Date.now() / 1000;
  return { cpu: 50 + 40 * Math.sin(t / 3), ram: 62 };
}

/** Runs a Glyph Button action on this PC. Names are listed in src-tauri/src/actions.rs. */
export async function runAction(kind: string, arg?: string): Promise<void> {
  if (!isTauri) {
    console.info(`[browser] would run action "${kind}"`, arg ?? '');
    return;
  }
  await invoke('run_action', { kind, arg: arg ?? null });
}

/**
 * Read-only GitHub lookup for the GitHub connector. `path` is like
 * `repos/owner/repo/activity?per_page=20`. The desktop app asks through the
 * GitHub CLI, so no token is handled here; a browser can only see public repositories.
 */
export async function githubGet(path: string): Promise<unknown> {
  if (isTauri) return JSON.parse(await invoke<string>('github_get', { path }));
  const res = await fetch(`https://api.github.com/${path}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(res.status === 404 ? 'Not found (or private)' : `GitHub answered ${res.status}`);
  return res.json();
}

export async function apiInfo(): Promise<ApiInfo | null> {
  return isTauri ? invoke<ApiInfo>('api_info') : null;
}

export function reportStatus(status: unknown): void {
  if (isTauri) void invoke('set_status', { status: JSON.stringify(status) }).catch(() => {});
}

export function onApiRequest(handler: (request: ApiRequest) => void): void {
  if (isTauri) void listen<ApiRequest>('api-request', (event) => handler(event.payload));
}
