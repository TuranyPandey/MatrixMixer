import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ConnectionState, Frame } from '@matrix-bridge/core';
import { clearMatrix, player, setBrightness, updateSettings, useBridge } from './bridge';
import { ConnectorsPanel } from './ConnectorsPanel';
import { DotText } from './DotText';
import { MatrixView } from './MatrixView';
import { isTauri } from './native';
import { ButtonsPanel, ConnectPanel, DeveloperPanel, DrawPanel, ImagePanel, TextPanel, WidgetsPanel } from './panels';

const TABS = [
  { id: 'connect', label: 'Phone', Panel: ConnectPanel },
  { id: 'text', label: 'Text', Panel: TextPanel },
  { id: 'draw', label: 'Draw', Panel: DrawPanel },
  { id: 'image', label: 'Image', Panel: ImagePanel },
  { id: 'widgets', label: 'Widgets', Panel: WidgetsPanel },
  { id: 'connectors', label: 'Connectors', Panel: ConnectorsPanel },
  { id: 'buttons', label: 'Button', Panel: ButtonsPanel },
  { id: 'developer', label: 'Developer', Panel: DeveloperPanel },
] as const;

type TabId = (typeof TABS)[number]['id'];

const STATUS: Record<ConnectionState, string> = {
  offline: 'No phone on the line',
  connecting: 'Dialling',
  pairing: 'Waiting for the code',
  connected: 'Linked',
  reconnecting: 'Lost it. Redialling',
};

/** Island positions, in the order of Settings.islandPlace. */
const PLACES = ['Top left', 'Top centre', 'Top right', 'Bottom left', 'Bottom centre', 'Bottom right'];

export function App() {
  const bridge = useBridge();
  const [tab, setTab] = useState<TabId>(bridge.settings.token ? 'text' : 'connect');
  // Windows keeps this setting (a Run entry in the registry), so ask it rather than remember it.
  const [autostart, setAutostart] = useState(false);
  useEffect(() => {
    if (isTauri) void invoke<boolean>('autostart_get').then(setAutostart).catch(() => {});
  }, []);
  const Panel = TABS.find((t) => t.id === tab)!.Panel;
  const subscribe = useCallback((draw: (frame: Frame) => void) => {
    draw(player.current);
    return player.onFrame(draw);
  }, []);

  return (
    <div className="shell">
      <nav className="nav" aria-label="Sections">
        <div className="brand" role="img" aria-label="MatrixMixer">
          <DotText text="Matrix" cell={3} />
          <DotText text="Mixer" cell={3} color="#e5262b" />
        </div>
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            <span className="tab-label">{t.label}</span>
            {t.id === 'connect' && <span className={`dot ${bridge.connection}`} aria-hidden="true" />}
          </button>
        ))}
        <div className="nav-foot">Community project. Not affiliated with Nothing.</div>
      </nav>

      <main className="main">
        {bridge.error && (
          <div className="banner" role="alert">
            {bridge.error}
          </div>
        )}
        <div className="page" key={tab}>
          <Panel go={(id: string) => setTab(id as TabId)} />
        </div>
      </main>

      <aside className={`side ${bridge.connection}${bridge.playing ? ' lit' : ''}`} aria-label="Live preview">
        <div className="label">On the matrix</div>
        <MatrixView subscribe={subscribe} size={250} label="Live preview of the Glyph Matrix" />
        <div className="now">
          <span className="now-tag">{bridge.playing ? 'Now showing' : 'Dark'}</span>
          {bridge.playing ?? 'Send something to light it up'}
        </div>

        <div className={`status ${bridge.connection}`}>
          <span className={`dot ${bridge.connection}`} aria-hidden="true" />
          {STATUS[bridge.connection]}
          {bridge.connection === 'connected' && bridge.phoneName ? ` to ${bridge.phoneName}` : ''}
        </div>
        {bridge.connection !== 'connected' && (
          <p className="hint">The preview still works. Frames reach the phone once it is connected.</p>
        )}

        <label className="field">
          <span className="label">Brightness</span>
          <input
            type="range"
            min={10}
            max={255}
            value={bridge.settings.brightness}
            onChange={(ev) => setBrightness(Number(ev.target.value))}
          />
        </label>
        <button className="ghost" onClick={clearMatrix} disabled={!bridge.playing}>
          Clear matrix
        </button>
        {isTauri && (
          <label className="check island-toggle">
            <input
              type="checkbox"
              checked={autostart}
              onChange={(ev) => {
                const enabled = ev.target.checked;
                setAutostart(enabled);
                void invoke('autostart_set', { enabled }).catch(() => setAutostart(!enabled));
              }}
            />
            Start with Windows
          </label>
        )}
        <label className="check island-toggle">
          <input type="checkbox" checked={bridge.settings.island} onChange={(ev) => updateSettings({ island: ev.target.checked })} />
          Island on the desktop
        </label>
        {bridge.settings.island && (
          <div className="place" role="radiogroup" aria-label="Where the island sits on the screen">
            {PLACES.map((name, place) => (
              <button
                key={name}
                role="radio"
                aria-checked={bridge.settings.islandPlace === place}
                aria-label={name}
                title={name}
                className={bridge.settings.islandPlace === place ? 'place-spot active' : 'place-spot'}
                onClick={() => updateSettings({ islandPlace: place })}
              />
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
