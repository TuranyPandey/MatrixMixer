/**
 * The main window. One "stage": the matrix big at the top, what it is showing
 * and its brightness under it, then the modes that put things on it. Everything
 * about setting up (phone, connectors, button, desktop) lives on one Settings page.
 */
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ConnectionState, Frame } from '@matrix-bridge/core';
import { clearError, clearMatrix, player, setBrightness, updateSettings, useBridge } from './bridge';
import { ConnectorsPanel } from './ConnectorsPanel';
import { CursorDots } from './CursorDots';
import { DotText } from './DotText';
import { MatrixView } from './MatrixView';
import { isTauri } from './native';
import {
  ButtonsPanel,
  ConnectPanel,
  DeveloperPanel,
  DrawPanel,
  ImagePanel,
  PageTitle,
  ShowTitles,
  TextPanel,
} from './panels';
import { WidgetsPanel } from './WidgetsPanel';
import { describeShowing } from './showing';

const MODES = [
  { id: 'text', label: 'Text', Panel: TextPanel },
  { id: 'draw', label: 'Draw', Panel: DrawPanel },
  { id: 'image', label: 'Image', Panel: ImagePanel },
  { id: 'widgets', label: 'Widgets', Panel: WidgetsPanel },
] as const;

const SETTINGS = [
  { id: 'connect', label: 'Phone', Panel: ConnectPanel },
  { id: 'connectors', label: 'Connectors', Panel: ConnectorsPanel },
  { id: 'buttons', label: 'Glyph Button', Panel: ButtonsPanel },
  { id: 'desktop', label: 'Desktop', Panel: DesktopPanel },
  { id: 'developer', label: 'Developer', Panel: DeveloperPanel },
] as const;

type ModeId = (typeof MODES)[number]['id'];
type SettingId = (typeof SETTINGS)[number]['id'];

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
  const [mode, setMode] = useState<ModeId>('text');
  // Not paired yet: open on the page that gets a phone on the line.
  const [setting, setSetting] = useState<SettingId | null>(bridge.settings.token ? null : 'connect');

  // Panels ask to go somewhere by id; it may be a mode or a settings page.
  const go = useCallback((id: string) => {
    if (MODES.some((m) => m.id === id)) {
      setMode(id as ModeId);
      setSetting(null);
    } else if (SETTINGS.some((s) => s.id === id)) setSetting(id as SettingId);
  }, []);

  return (
    <div className="app">
      {bridge.settings.cursorDots && <CursorDots radius={bridge.settings.cursorRadius} />}
      <header className="topbar">
        <button className="brand" aria-label="MatrixMixer, back to the matrix" onClick={() => setSetting(null)}>
          <DotText text="Matrix" cell={2.5} />
          <DotText text="Mixer" cell={2.5} color="#e5262b" />
        </button>
        <span className="topbar-gap" />
        <button className={`status ${bridge.connection}`} onClick={() => go('connect')} title="Phone settings">
          <span className={`dot ${bridge.connection}`} aria-hidden="true" />
          {STATUS[bridge.connection]}
          {bridge.connection === 'connected' && bridge.phoneName ? ` to ${bridge.phoneName}` : ''}
        </button>
        <button
          className={setting ? 'top-link on' : 'top-link'}
          aria-pressed={setting !== null}
          onClick={() => setSetting(setting ? null : 'connect')}
        >
          {setting ? 'Done' : 'Settings'}
        </button>
      </header>

      {bridge.error && (
        <div className="banner" role="alert">
          <span className="banner-text">{bridge.error}</span>
          <button className="link" aria-label="Dismiss" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}

      {setting ? <SettingsView current={setting} pick={setSetting} go={go} /> : <StageView mode={mode} pick={setMode} go={go} />}
    </div>
  );
}

function StageView({ mode, pick, go }: { mode: ModeId; pick: (id: ModeId) => void; go: (id: string) => void }) {
  const bridge = useBridge();
  const subscribe = useCallback((draw: (frame: Frame) => void) => {
    draw(player.current);
    return player.onFrame(draw);
  }, []);
  const showing = describeShowing(bridge.playing);
  const Panel = MODES.find((m) => m.id === mode)!.Panel;

  return (
    <main className="scroll">
      <section className={`hero ${bridge.connection}${showing ? ' lit' : ''}`} aria-label="The matrix">
        <MatrixView subscribe={subscribe} size={212} label="Live preview of the Glyph Matrix" />
        <div className="hero-side">
          <div className="now">
            <span className="now-tag">{showing ? showing.kind : 'Dark'}</span>
            <span className="now-detail">{showing ? showing.detail : 'Nothing on the matrix'}</span>
          </div>
          {bridge.connection === 'offline' && (
            <p className="hint">
              Only this preview is lit.{' '}
              <button className="inline" onClick={() => go('connect')}>
                Link a phone
              </button>
            </p>
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
          <label className="field">
            <span className="label">Text speed</span>
            {/* Runs slow to fast; the setting is milliseconds per step, so it is flipped. */}
            <input
              type="range"
              min={20}
              max={160}
              step={5}
              value={180 - bridge.settings.textSpeed}
              onChange={(ev) => updateSettings({ textSpeed: 180 - Number(ev.target.value) })}
            />
          </label>
          <button className="ghost" onClick={clearMatrix} disabled={!bridge.playing}>
            Clear
          </button>
        </div>
      </section>

      <nav className="modes" aria-label="What to put on the matrix" role="tablist">
        {MODES.map((m) => (
          <button key={m.id} role="tab" aria-selected={m.id === mode} className={m.id === mode ? 'mode on' : 'mode'} onClick={() => pick(m.id)}>
            {m.label}
          </button>
        ))}
      </nav>

      <div className="page" key={mode}>
        {/* The mode row already names the page, so the big dot titles stay on the Settings pages. */}
        <ShowTitles.Provider value={false}>
          <Panel go={go} />
        </ShowTitles.Provider>
      </div>
    </main>
  );
}

function SettingsView({ current, pick, go }: { current: SettingId; pick: (id: SettingId) => void; go: (id: string) => void }) {
  const Panel = SETTINGS.find((s) => s.id === current)!.Panel;
  const bridge = useBridge();
  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings">
        {SETTINGS.map((s) => (
          <button key={s.id} className={s.id === current ? 'tab active' : 'tab'} onClick={() => pick(s.id)}>
            <span className="tab-label">{s.label}</span>
            {s.id === 'connect' && <span className={`dot ${bridge.connection}`} aria-hidden="true" />}
          </button>
        ))}
        <div className="nav-foot">Community project. Not affiliated with Nothing.</div>
      </nav>
      <main className="scroll">
        <div className="page" key={current}>
          <Panel go={go} />
        </div>
      </main>
    </div>
  );
}

/** Settings > Desktop: what MatrixMixer does on this PC outside its window. */
function DesktopPanel(_: { go: (id: string) => void }) {
  const bridge = useBridge();
  // Windows keeps this setting (a Run entry in the registry), so ask it rather than remember it.
  const [autostart, setAutostart] = useState(false);
  useEffect(() => {
    if (isTauri) void invoke<boolean>('autostart_get').then(setAutostart).catch(() => {});
  }, []);

  return (
    <>
      <PageTitle title="Desktop" lede="How MatrixMixer sits on this PC when its window is closed." />
      <section className="card">
        <h2>Island</h2>
        <p>A small pill that mirrors the matrix and stays on top of other windows. Hover it for quick controls and widgets.</p>
        <label className="check">
          <input type="checkbox" checked={bridge.settings.island} onChange={(ev) => updateSettings({ island: ev.target.checked })} />
          Show the island
        </label>
        {bridge.settings.island && (
          <>
            <span className="label place-label">Where it sits</span>
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
          </>
        )}
      </section>
      <section className="card">
        <h2>Pointer</h2>
        <p>A patch of dot matrix lights up under the pointer as it moves around this window.</p>
        <label className="check">
          <input type="checkbox" checked={bridge.settings.cursorDots} onChange={(ev) => updateSettings({ cursorDots: ev.target.checked })} />
          Light the dots under the pointer
        </label>
        {bridge.settings.cursorDots && (
          <label className="field radius-field">
            <span className="label">Radius: {bridge.settings.cursorRadius} px</span>
            <input
              type="range"
              min={40}
              max={320}
              step={10}
              value={bridge.settings.cursorRadius}
              onChange={(ev) => updateSettings({ cursorRadius: Number(ev.target.value) })}
            />
          </label>
        )}
      </section>
      <section className="card">
        <h2>Start up</h2>
        {isTauri ? (
          <label className="check">
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
        ) : (
          <p className="muted">Only in the desktop app.</p>
        )}
        <p className="hint">Started with Windows, it waits in the tray. Closing the window also keeps it running there; Quit is in the tray menu.</p>
      </section>
    </>
  );
}
