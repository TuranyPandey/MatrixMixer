/**
 * Connectors: things that reach the matrix without you sending them. They run
 * here, not in React, so they keep working on any tab and with the window hidden.
 * Each one ends in `notify`, which shows a notice and then hands the matrix back.
 */
import { useSyncExternalStore } from 'react';
import { githubNews, noticeSource, type GithubActivity, type GithubRun, type GithubSnapshot } from '@matrix-bridge/core';
import { apiNotices, getSettings, player, updateSettings, type ConnectorSettings } from './bridge';
import { githubGet } from './native';

export type Notice = { from: string; text: string; at: number };

export type ConnectorState = {
  github: { checkedAt: number | null; error: string | null };
  battery: { supported: boolean; level: number | null; charging: boolean | null };
  /** Newest first. */
  recent: Notice[];
};

let state: ConnectorState = {
  github: { checkedAt: null, error: null },
  battery: { supported: true, level: null, charging: null },
  recent: [],
};
const listeners = new Set<() => void>();

function publish(patch: Partial<ConnectorState>): void {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export function useConnectors(): ConnectorState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

/** Shows a notice on the matrix and keeps it in the recent list. */
export function notify(from: string, text: string): void {
  player.notify(noticeSource(text));
  publish({ recent: [{ from, text, at: Date.now() }, ...state.recent].slice(0, 6) });
}

/** Run after connector settings change. activities.ts adds its own here. */
export const afterConnectorChange = new Set<() => void>();

/** Changes connector settings and applies them straight away. */
export function updateConnectors(patch: Partial<ConnectorSettings>): void {
  updateSettings({ connectors: { ...getSettings().connectors, ...patch } });
  sync();
  afterConnectorChange.forEach((fn) => fn());
}

// ---- GitHub -----------------------------------------------------------------------

const GITHUB_EVERY_MS = 60_000;
let githubTimer: ReturnType<typeof setInterval> | null = null;
let githubBusy = false;
const snapshots = new Map<string, GithubSnapshot>();

/** Accepts `owner/repo` or a pasted github.com link. Returns null if it is neither. */
export function parseRepo(input: string): string | null {
  const clean = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const parts = clean.split('/');
  return parts.length >= 2 && /^[\w.-]+$/.test(parts[0]!) && /^[\w.-]+$/.test(parts[1]!) ? `${parts[0]}/${parts[1]}` : null;
}

async function checkGithub(): Promise<void> {
  if (githubBusy) return;
  githubBusy = true;
  const { repos, pushes, ci } = getSettings().connectors.github;
  let error: string | null = null;
  for (const repo of repos) {
    try {
      const [activity, runs] = await Promise.all([
        githubGet(`repos/${repo}/activity?per_page=20`),
        githubGet(`repos/${repo}/actions/runs?per_page=20`),
      ]);
      const news = githubNews(
        repo,
        snapshots.get(repo) ?? null,
        Array.isArray(activity) ? (activity as GithubActivity[]) : [],
        (runs as { workflow_runs?: GithubRun[] } | null)?.workflow_runs ?? [],
        { pushes, ci },
      );
      snapshots.set(repo, news.snapshot);
      news.messages.forEach((text) => notify('GitHub', text));
    } catch (err) {
      error = `${repo}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  githubBusy = false;
  publish({ github: { checkedAt: Date.now(), error } });
}

function syncGithub(): void {
  const { enabled, repos } = getSettings().connectors.github;
  // Forget repositories that are no longer watched, so adding one back starts fresh.
  for (const repo of [...snapshots.keys()]) if (!enabled || !repos.includes(repo)) snapshots.delete(repo);
  if (enabled && repos.length > 0) {
    githubTimer ??= setInterval(() => void checkGithub(), GITHUB_EVERY_MS);
    void checkGithub();
  } else {
    if (githubTimer) clearInterval(githubTimer);
    githubTimer = null;
    publish({ github: { checkedAt: null, error: null } });
  }
}

// ---- PC battery -------------------------------------------------------------------

type BatteryManager = EventTarget & { level: number; charging: boolean };
let wasLow = false;
let wasFull = false;

function readBattery(battery: BatteryManager, quiet: boolean): void {
  const percent = Math.round(battery.level * 100);
  publish({ battery: { supported: true, level: percent, charging: battery.charging } });
  const { enabled, low } = getSettings().connectors.battery;
  const isLow = !battery.charging && percent <= low;
  const isFull = battery.charging && percent >= 100;
  if (enabled && !quiet) {
    if (isLow && !wasLow) notify('Battery', `PC BATTERY ${percent}%`);
    if (isFull && !wasFull) notify('Battery', 'PC FULLY CHARGED');
  }
  wasLow = isLow;
  wasFull = isFull;
}

async function watchBattery(): Promise<void> {
  const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryManager> }).getBattery;
  if (!getBattery) return publish({ battery: { supported: false, level: null, charging: null } });
  try {
    const battery = await getBattery.call(navigator);
    battery.addEventListener('levelchange', () => readBattery(battery, false));
    battery.addEventListener('chargingchange', () => readBattery(battery, false));
    // Take stock quietly: no notice just because the app started on a full or low battery.
    readBattery(battery, true);
  } catch {
    publish({ battery: { supported: false, level: null, charging: null } });
  }
}

// ---- start ------------------------------------------------------------------------

function sync(): void {
  syncGithub();
}

apiNotices.add((text) => notify('Script', text));
void watchBattery();
sync();
