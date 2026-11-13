import { useCallback, useState } from 'react';
import type { ConnectionState, Frame } from '@matrix-bridge/core';
import { clearMatrix, player, setBrightness, useBridge } from './bridge';
import { ConnectorsPanel } from './ConnectorsPanel';
import { DotText } from './DotText';
import { MatrixView } from './MatrixView';
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
        <div className="brand" role="img" aria-label="Matrix Bridge">
          <DotText text="Matrix" cell={3} />
          <DotText text="Bridge" cell={3} color="#e5262b" />
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
      </aside>
    </div>
  );
}
