/**
 * Activities: things that hold the matrix for as long as they are going on,
 * then hand it back. A job's progress, the on-air light, the track that just
 * started, the run-up to the next meeting, a game's HUD.
 *
 * Like connectors.ts they live outside React so they work on any tab and with
 * the window hidden, and they go through `player.notify`, so whatever was
 * showing before comes back afterwards. Sending something else to the matrix
 * while one is up dismisses it until the next time it starts.
 */
import { useSyncExternalStore } from 'react';
import { countdownFrame, gameFrame, liveSource, onAirFrame, progressFrame, upcomingEvents, type CalendarEvent } from '@matrix-bridge/core';
import { apiHandlers, getSettings, player, registerAction } from './bridge';
import { afterConnectorChange, notify } from './connectors';
import { fetchText, micToggle, nowPlaying, onAir } from './native';

export type ActivityState = {
  /** A job in progress, 0-100. Null when none. */
  progress: { value: number; label: string } | null;
  /** `muted` is the system microphone's mute switch, whether or not anything is using the microphone. */
  onAir: { mic: boolean; camera: boolean; muted: boolean };
  /** What Windows says is playing. Null when nothing is. */
  track: { title: string; artist: string; playing: boolean } | null;
  calendar: { checkedAt: number | null; error: string | null; next: CalendarEvent | null };
  /** When the last game update came in. */
  gameAt: number | null;
};

let state: ActivityState = {
  progress: null,
  onAir: { mic: false, camera: false, muted: false },
  track: null,
  calendar: { checkedAt: null, error: null, next: null },
  gameAt: null,
};
const listeners = new Set<() => void>();

function publish(patch: Partial<ActivityState>): void {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export function onActivity(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getActivity(): ActivityState {
  return state;
}

export function useActivity(): ActivityState {
  return useSyncExternalStore(onActivity, getActivity);
}

// ---- progress ring ("matrix progress 42 BUILD") ------------------------------------

/** A job nobody has updated for this long is taken to have died. */
const PROGRESS_STALE_MS = 15 * 60_000;
/** How long a finished ring stays full before the matrix is handed back. */
const PROGRESS_LINGER_MS = 1200;
let progressAt = 0;
let progressDoneAt = 0;
let progressShown = false;

/** Sets the ring. 100 or more finishes the job; null takes the ring down without a word. */
export function setProgress(value: number | null, label = ''): void {
  if (value === null || !Number.isFinite(value)) {
    progressShown = false;
    return publish({ progress: null });
  }
  const name = label.trim().toUpperCase().slice(0, 24);
  const next = { value: Math.max(0, Math.min(100, value)), label: name || state.progress?.label || '' };
  progressAt = Date.now();
  const finishing = next.value >= 100 && progressDoneAt === 0;
  if (next.value < 100) progressDoneAt = 0;
  else if (finishing) progressDoneAt = Date.now();
  publish({ progress: next });

  if (!progressShown) {
    progressShown = true;
    player.notify(
      liveSource(next.label ? `progress: ${next.label}` : 'progress', 250, () => {
        const p = state.progress;
        if (!p) return null;
        const over = progressDoneAt > 0 ? Date.now() - progressDoneAt > PROGRESS_LINGER_MS : Date.now() - progressAt > PROGRESS_STALE_MS;
        if (!over) return progressFrame(p.value);
        progressShown = false;
        progressDoneAt = 0;
        publish({ progress: null });
        return null;
      }),
    );
  }
  // Queued behind the ring, so it passes once the ring has been seen full.
  if (finishing) notify('Script', next.label ? `${next.label} DONE` : 'DONE');
}

apiHandlers.set('/progress', (body) => {
  const value = body.done === true ? 100 : body.clear === true ? null : typeof body.value === 'number' ? body.value : NaN;
  if (value !== null && Number.isNaN(value)) return;
  setProgress(value, typeof body.label === 'string' ? body.label : '');
});

// ---- on-air light -------------------------------------------------------------------

const ON_AIR_EVERY_MS = 3000;
let onAirTimer: ReturnType<typeof setInterval> | null = null;

function onAirWord(): string | null {
  const { mic, camera } = getSettings().connectors.onair;
  const live = { mic: mic && state.onAir.mic, camera: camera && state.onAir.camera };
  // The camera cannot be muted from here, so it wins. A muted microphone still counts as a call going on.
  return live.camera ? 'CAM' : live.mic ? (state.onAir.muted ? 'MUTED' : 'MIC') : null;
}

async function checkOnAir(): Promise<void> {
  const before = onAirWord();
  try {
    publish({ onAir: await onAir() });
  } catch {
    return;
  }
  if (!before && onAirWord()) {
    player.notify(
      liveSource('on air', 700, (tick) => {
        const word = getSettings().connectors.onair.enabled ? onAirWord() : null;
        // Live breathes; muted holds still and dim, so the two cannot be mistaken for each other.
        return word ? onAirFrame(word, word === 'MUTED' ? 1 : tick) : null;
      }),
    );
  }
}

/**
 * "Mute microphone" for the Glyph Button: flips the system mute switch. With the
 * on-air light up, the light itself changes; otherwise a word passes to say which way it went.
 */
registerAction('mute_mic', async () => {
  const muted = await micToggle();
  const lightUp = getSettings().connectors.onair.enabled && onAirWord() !== null;
  publish({ onAir: { ...state.onAir, muted } });
  if (!lightUp) notify('Microphone', muted ? 'MIC OFF' : 'MIC ON');
  return muted ? 'Microphone muted' : 'Microphone live';
});

// ---- now playing --------------------------------------------------------------------

const MUSIC_EVERY_MS = 4000;
let musicTimer: ReturnType<typeof setInterval> | null = null;
let lastTrack = '';

async function checkMusic(): Promise<void> {
  let track: ActivityState['track'];
  try {
    track = await nowPlaying();
  } catch {
    return;
  }
  publish({ track });
  if (!track?.playing || !track.title) return;
  const line = track.artist ? `${track.title} - ${track.artist}` : track.title;
  if (line === lastTrack) return;
  // Stay quiet about whatever was already playing when the connector came on.
  const first = lastTrack === '';
  lastTrack = line;
  if (!first) notify('Music', line.toUpperCase());
}

// ---- calendar -----------------------------------------------------------------------

const CALENDAR_FETCH_MS = 10 * 60_000;
const CALENDAR_CHECK_MS = 30_000;
let calendarTimer: ReturnType<typeof setInterval> | null = null;
let calendarText = '';
let calendarFetchedAt = 0;
let calendarUrl = '';
const announced = new Set<string>();

async function checkCalendar(): Promise<void> {
  const { url, lead } = getSettings().connectors.calendar;
  if (!url) return;
  const now = Date.now();
  if (url !== calendarUrl || now - calendarFetchedAt > CALENDAR_FETCH_MS) {
    calendarUrl = url;
    calendarFetchedAt = now;
    try {
      const text = await fetchText(url);
      if (!text.includes('BEGIN:VCALENDAR')) throw new Error('That link did not return a calendar (.ics) file');
      calendarText = text;
      publish({ calendar: { ...state.calendar, checkedAt: now, error: null } });
    } catch (err) {
      publish({ calendar: { ...state.calendar, checkedAt: now, error: err instanceof Error ? err.message : String(err) } });
    }
  }
  if (!calendarText) return;
  const timed = upcomingEvents(calendarText, now - 60_000, now + 24 * 3_600_000).filter((e) => !e.allDay);
  publish({ calendar: { ...state.calendar, next: timed.find((e) => e.start > now) ?? null } });
  for (const event of timed) {
    const minutes = Math.round((event.start - now) / 60_000);
    const title = event.title.toUpperCase().slice(0, 60);
    const say = (stage: string, text: string) => {
      const key = `${stage}|${event.start}|${event.title}`;
      if (announced.has(key)) return;
      announced.add(key);
      notify('Calendar', text);
    };
    if (minutes <= 0) say('now', `NOW: ${title}`);
    else if (minutes <= lead) {
      say('soon', `IN ${minutes} MIN: ${title}`);
      countDownTo(event, lead);
    }
  }
}

/** After the warning has passed, a disk drains until the event starts. Once per event. */
function countDownTo(event: CalendarEvent, lead: number): void {
  if (!getSettings().connectors.calendar.countdown) return;
  const key = `disk|${event.start}|${event.title}`;
  if (announced.has(key)) return;
  announced.add(key);
  player.notify(
    liveSource(`meeting: ${event.title.slice(0, 40)}`, 1000, () => {
      const { enabled, countdown } = getSettings().connectors.calendar;
      const left = event.start - Date.now();
      return enabled && countdown && left > 0 ? countdownFrame(left / (lead * 60_000)) : null;
    }),
  );
}

// ---- reminder -----------------------------------------------------------------------

let reminderTimer: ReturnType<typeof setInterval> | null = null;
let reminderKey = '';

function syncReminder(): void {
  const { enabled, text, every: minutes } = getSettings().connectors.reminder;
  const key = enabled && text.trim() ? `${minutes}|${text}` : '';
  if (key === reminderKey) return;
  reminderKey = key;
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = key ? setInterval(() => notify('Reminder', text.trim().toUpperCase()), Math.max(1, minutes) * 60_000) : null;
}

// ---- game HUD (Counter-Strike 2 game state integration) ------------------------------

const GAME_QUIET_MS = 20_000;
let game: { health: number; ammo: number | null } | null = null;
let gameShown = false;

type GameState = {
  auth?: { token?: string };
  player?: { state?: { health?: number }; weapons?: Record<string, { state?: string; ammo_clip?: number; ammo_clip_max?: number }> };
};

apiHandlers.set('/game', (raw) => {
  const body = raw as GameState;
  const { game: settings } = getSettings().connectors;
  if (!settings.enabled || !settings.token || body.auth?.token !== settings.token) return;
  const health = body.player?.state?.health;
  if (typeof health !== 'number') return;
  const weapon = Object.values(body.player?.weapons ?? {}).find((w) => w.state === 'active');
  const ammo = weapon && typeof weapon.ammo_clip === 'number' && weapon.ammo_clip_max ? weapon.ammo_clip / weapon.ammo_clip_max : null;
  game = { health, ammo };
  publish({ gameAt: Date.now() });
  if (gameShown) return;
  gameShown = true;
  player.notify(
    liveSource('game: CS2', 200, () => {
      const fresh = game && state.gameAt && Date.now() - state.gameAt < GAME_QUIET_MS && getSettings().connectors.game.enabled;
      if (fresh) return gameFrame(game!.health, game!.ammo);
      gameShown = false;
      return null;
    }),
  );
});

// ---- start --------------------------------------------------------------------------

function every(timer: ReturnType<typeof setInterval> | null, on: boolean, ms: number, run: () => Promise<void>) {
  if (on && !timer) {
    void run();
    return setInterval(() => void run(), ms);
  }
  if (!on && timer) {
    clearInterval(timer);
    return null;
  }
  return timer;
}

/** Starts and stops the polling to match the settings. Call after changing them. */
export function syncActivities(): void {
  const { onair, music, calendar } = getSettings().connectors;
  onAirTimer = every(onAirTimer, onair.enabled, ON_AIR_EVERY_MS, checkOnAir);
  if (!onair.enabled) publish({ onAir: { ...state.onAir, mic: false, camera: false } });
  syncReminder();
  musicTimer = every(musicTimer, music.enabled, MUSIC_EVERY_MS, checkMusic);
  if (!music.enabled) lastTrack = '';
  const calendarOn = calendar.enabled && calendar.url.trim() !== '';
  calendarTimer = every(calendarTimer, calendarOn, CALENDAR_CHECK_MS, checkCalendar);
  if (calendarOn) void checkCalendar();
  else publish({ calendar: { checkedAt: null, error: null, next: null } });
}

afterConnectorChange.add(syncActivities);
syncActivities();
