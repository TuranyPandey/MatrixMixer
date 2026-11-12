/**
 * Live widgets. Timer state lives here, not in React, so a Pomodoro keeps
 * counting while you are on another tab or the window is hidden.
 */
import { useSyncExternalStore } from 'react';
import { alarmFrame, clockFrame, liveSource, meterFrame, timerFrame, type Frame } from '@matrix-bridge/core';
import { player } from './bridge';
import { systemStats } from './native';

export function startClock(hour12: boolean): void {
  void player.play(liveSource('widget: clock', 500, () => clockFrame(new Date(), hour12)));
}

export function startMeter(): void {
  let latest: Frame = meterFrame(0, 0);
  const sample = () =>
    void systemStats()
      .then(({ cpu, ram }) => (latest = meterFrame(cpu, ram)))
      .catch(() => {});
  sample();
  void player.play(
    liveSource('widget: system meter', 1000, () => {
      sample();
      return latest;
    }),
  );
}

// ---- timers (Pomodoro and plain countdown share one engine) ----------------------

export type TimerState = {
  kind: 'pomodoro' | 'countdown';
  phase: 'focus' | 'break' | 'done';
  running: boolean;
  /** Seconds left in this phase. */
  remaining: number;
  total: number;
  focusMinutes: number;
  breakMinutes: number;
  /** Completed focus sessions since the timer was started. */
  rounds: number;
};

let timer: TimerState | null = null;
/** Wall-clock time the current phase ends, while running. */
let endsAt = 0;
const listeners = new Set<() => void>();
const LABEL = 'widget: timer';

function publish(next: TimerState | null): void {
  timer = next;
  listeners.forEach((fn) => fn());
}

export function useTimer(): TimerState | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => timer,
  );
}

function render(tick: number): Frame | null {
  if (!timer) return null;
  if (timer.running) {
    const remaining = Math.max(0, (endsAt - Date.now()) / 1000);
    if (remaining <= 0) advance();
    else if (Math.ceil(remaining) !== Math.ceil(timer.remaining)) publish({ ...timer, remaining });
    else timer.remaining = remaining;
  }
  if (!timer) return null;
  if (timer.phase === 'done') return alarmFrame(Math.floor(tick / 2));
  return timerFrame(timer.remaining, timer.total, timer.phase === 'break');
}

/** Moves to the next phase when the clock runs out. */
function advance(): void {
  if (!timer) return;
  if (timer.kind === 'countdown') {
    publish({ ...timer, phase: 'done', running: false, remaining: 0 });
    return;
  }
  const toBreak = timer.phase === 'focus';
  const total = (toBreak ? timer.breakMinutes : timer.focusMinutes) * 60;
  endsAt = Date.now() + total * 1000;
  publish({
    ...timer,
    phase: toBreak ? 'break' : 'focus',
    remaining: total,
    total,
    rounds: timer.rounds + (toBreak ? 1 : 0),
  });
}

function show(): void {
  if (player.label !== LABEL) void player.play(liveSource(LABEL, 250, render));
}

export function startPomodoro(focusMinutes: number, breakMinutes: number): void {
  const total = focusMinutes * 60;
  endsAt = Date.now() + total * 1000;
  publish({ kind: 'pomodoro', phase: 'focus', running: true, remaining: total, total, focusMinutes, breakMinutes, rounds: 0 });
  show();
}

export function startCountdown(minutes: number): void {
  const total = Math.max(1, Math.round(minutes * 60));
  endsAt = Date.now() + total * 1000;
  publish({ kind: 'countdown', phase: 'focus', running: true, remaining: total, total, focusMinutes: minutes, breakMinutes: 0, rounds: 0 });
  show();
}

export function toggleTimer(): void {
  if (!timer || timer.phase === 'done') return;
  if (timer.running) publish({ ...timer, running: false });
  else {
    endsAt = Date.now() + timer.remaining * 1000;
    publish({ ...timer, running: true });
  }
  show();
}

export function stopTimer(): void {
  const wasShowing = player.label === LABEL;
  publish(null);
  if (wasShowing) player.stop();
}

// If something else takes over the matrix, a running timer keeps counting in the
// background; tick it so the panel stays right and the phase still changes.
setInterval(() => {
  if (timer?.running && player.label !== LABEL) render(0);
}, 500);
