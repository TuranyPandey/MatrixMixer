import { useCallback, useState } from 'react';
import type { ConnectionState, Frame } from '@matrix-bridge/core';
import { clearMatrix, player, setBrightness, useBridge } from './bridge';
import { MatrixView } from './MatrixView';
import { ButtonsPanel, ConnectPanel, DeveloperPanel, DrawPanel, ImagePanel, TextPanel, WidgetsPanel } from './panels';

const TABS = [
  { id: 'connect', label: 'Phone', Panel: ConnectPanel },
  { id: 'text', label: 'Text', Panel: TextPanel },
  { id: 'draw', label: 'Draw', Panel: DrawPanel },
  { id: 'image', label: 'Image', Panel: ImagePanel },
  { id: 'widgets', label: 'Widgets', Panel: WidgetsPanel },
  { id: 'buttons', label: 'Button', Panel: ButtonsPanel },
  { id: 'developer', label: 'Developer', Panel: DeveloperPanel },
] as const;

type TabId = (typeof TABS)[number]['id'];

const STATUS: Record<ConnectionState, string> = {
  offline: 'Not connected',
  connecting: 'Connecting',
  pairing: 'Waiting for code',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
};

export function App() {
  const bridge = useBridge();
  const [tab, setTab] = useState<TabId>(bridge.settings.token ? 'text' : 'connect');
  const Panel = TABS.find((t) => t.id === tab)!.Panel;
  const subscribe = useCallback((draw: (frame: Frame) => void) => {
    draw(player.current);
    return player.onFrame(draw);
  }, []);

  return (
    <div className="shell">
      <nav className="nav" aria-label="Sections">
        <div className="brand">
          MATRIX
          <br />
          BRIDGE
        </div>
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
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
        <Panel go={(id: string) => setTab(id as TabId)} />
      </main>

      <aside className="side" aria-label="Live preview">
        <div className="label">On the matrix</div>
        <MatrixView subscribe={subscribe} size={250} label="Live preview of the Glyph Matrix" />
        <div className="now">{bridge.playing ?? 'Nothing'}</div>

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
      </aside>
    </div>
  );
}
