/**
 * Main-window side of the island: keeps the island window fed with what is on
 * the matrix and carries out the commands it sends back.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { textSource } from '@matrix-bridge/core';
import { getActivity, onActivity } from './activities';
import { clearMatrix, getState, player, setBrightness, subscribe, updateSettings } from './bridge';
import { receive, send, type IslandLive, type IslandState, type IslandWidget } from './islandLink';
import { isTauri, systemStats } from './native';
import { getTimer, latestQuotes, latestWeather, onTimer, startPomodoro, stopTimer, toggleTimer, toggleWidget } from './widgets';

function snapshot(): IslandState {
  const s = getState();
  const a = getActivity();
  const { onair } = s.settings.connectors;
  const { ticker, weather } = s.settings.widgets;
  const notReady: IslandWidget[] = [];
  if (ticker.length === 0) notReady.push('ticker');
  if (!weather) notReady.push('weather');
  return {
    connection: s.connection,
    phoneName: s.phoneName,
    playing: s.playing,
    brightness: s.settings.brightness,
    progress: a.progress ? Math.round(a.progress.value) : null,
    onAir: onair.enabled && ((onair.mic && a.onAir.mic) || (onair.camera && a.onAir.camera)),
    notReady,
  };
}

export function startIslandHost(): void {
  let shown = '';
  let last = '';

  const sync = () => {
    const { island: on, islandPlace: place } = getState().settings;
    if (`${on}:${place}` !== shown) {
      shown = `${on}:${place}`;
      if (isTauri) void invoke('island_show', { visible: on, place }).catch(() => {});
    }
    if (!on) return;
    const state = snapshot();
    const key = JSON.stringify(state);
    if (key === last) return;
    last = key;
    send('island:to', { t: 'state', state });
  };

  // Readings for the island's Widgets tab, gathered only while it is on screen.
  const live: IslandLive = { cpu: null, ram: null, quotes: null, weather: null, timer: null };
  let watching: ReturnType<typeof setInterval> | null = null;
  const sendLive = () => {
    const t = getTimer();
    live.timer = t && { remaining: t.remaining, phase: t.phase, running: t.running };
    send('island:to', { t: 'live', live });
  };
  const read = () => {
    void systemStats()
      .then(({ cpu, ram }) => {
        live.cpu = Math.round(cpu);
        live.ram = Math.round(ram);
      })
      .catch(() => {});
    // Both of these answer from a cache and only go out to the network when it is stale.
    void latestQuotes()
      .then((quotes) => (live.quotes = quotes))
      .catch(() => {});
    void latestWeather()
      .then((now) => (live.weather = now))
      .catch(() => {});
    sendLive();
  };
  const watch = (on: boolean) => {
    if (watching) clearInterval(watching);
    watching = null;
    if (!on) return;
    read();
    watching = setInterval(read, 1000);
  };
  onTimer(() => {
    if (watching) sendLive();
  });

  subscribe(sync);
  onActivity(sync);
  player.onFrame((frame) => {
    if (getState().settings.island) send('island:to', { t: 'frame', px: Array.from(frame) });
  });

  receive('island:from', (message) => {
    switch (message.t) {
      case 'hello':
        // The island (re)loaded: give it everything.
        last = '';
        watch(false);
        sync();
        send('island:to', { t: 'frame', px: Array.from(player.current) });
        break;
      case 'text':
        // Passes once, then stays put until something else takes the matrix.
        if (message.text.trim()) void player.play(textSource(message.text.trim(), { loops: 1, hold: true, speedMs: 60 }));
        break;
      case 'widget':
        void toggleWidget(message.name).catch(() => {});
        break;
      case 'watch':
        watch(message.on);
        break;
      case 'timer':
        if (message.do === 'start') startPomodoro(25, 5);
        else if (message.do === 'toggle') toggleTimer();
        else stopTimer();
        break;
      case 'brightness':
        setBrightness(Math.max(10, Math.min(255, Math.round(message.value))));
        break;
      case 'clear':
        clearMatrix();
        break;
      case 'open':
        if (isTauri) void invoke('show_main').catch(() => {});
        break;
      case 'hide':
        updateSettings({ island: false });
        break;
    }
  });

  // Tray menu: "Show or hide the island".
  if (isTauri) void listen('island-toggle', () => updateSettings({ island: !getState().settings.island }));

  sync();
}
