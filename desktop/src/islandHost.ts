/**
 * Main-window side of the island: keeps the island window fed with what is on
 * the matrix and carries out the commands it sends back.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { textSource } from '@matrix-bridge/core';
import { getActivity, onActivity } from './activities';
import { clearMatrix, getState, player, setBrightness, subscribe, updateSettings } from './bridge';
import { receive, send, type IslandState } from './islandLink';
import { isTauri } from './native';

function snapshot(): IslandState {
  const s = getState();
  const a = getActivity();
  const { onair } = s.settings.connectors;
  return {
    connection: s.connection,
    phoneName: s.phoneName,
    playing: s.playing,
    brightness: s.settings.brightness,
    progress: a.progress ? Math.round(a.progress.value) : null,
    onAir: onair.enabled && ((onair.mic && a.onAir.mic) || (onair.camera && a.onAir.camera)),
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
        sync();
        send('island:to', { t: 'frame', px: Array.from(player.current) });
        break;
      case 'text':
        if (message.text.trim()) void player.play(textSource(message.text.trim(), { loops: Infinity, speedMs: 60 }));
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
