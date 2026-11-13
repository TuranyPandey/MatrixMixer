/**
 * The island: a small always-on-top pill at the top of the screen that mirrors
 * the matrix. Hovering opens quick controls. Runs in its own window
 * (island.html) and talks to the main window through islandLink.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { frameFromArray, type ConnectionState, type Frame } from '@matrix-bridge/core';
import { receive, send, type IslandState } from './islandLink';
import { MatrixView } from './MatrixView';
import { isTauri } from './native';

const STATUS: Record<ConnectionState, string> = {
  offline: 'No phone on the line',
  connecting: 'Dialling',
  pairing: 'Waiting for the code',
  connected: 'Linked',
  reconnecting: 'Lost it. Redialling',
};

/** How long the pointer may be away before the panel folds up. */
const FOLD_MS = 350;

export function Island() {
  const [state, setState] = useState<IslandState | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const frame = useRef<Frame>(new Uint8Array(625));
  const painters = useRef(new Set<(frame: Frame) => void>());
  const fold = useRef<number | undefined>(undefined);
  const typing = useRef(false);

  useEffect(() => {
    const stop = receive('island:to', (message) => {
      if (message.t === 'state') setState(message.state);
      else {
        frame.current = frameFromArray(message.px);
        painters.current.forEach((draw) => draw(frame.current));
      }
    });
    send('island:from', { t: 'hello' });
    return stop;
  }, []);

  const subscribe = useCallback((draw: (frame: Frame) => void) => {
    draw(frame.current);
    painters.current.add(draw);
    return () => void painters.current.delete(draw);
  }, []);

  const expand = useCallback((next: boolean) => {
    window.clearTimeout(fold.current);
    setOpen(next);
    if (isTauri) void invoke('island_expand', { expanded: next }).catch(() => {});
  }, []);

  const leave = useCallback(() => {
    window.clearTimeout(fold.current);
    // Do not fold up under someone who is still typing.
    fold.current = window.setTimeout(() => {
      if (!typing.current) expand(false);
    }, FOLD_MS);
  }, [expand]);

  // The native side watches the pointer while the panel is open (see island_expand in lib.rs).
  useEffect(() => {
    if (!isTauri) return;
    const stop = listen<boolean>('island-pointer', (event) => {
      if (event.payload) window.clearTimeout(fold.current);
      else leave();
    });
    return () => void stop.then((fn) => fn());
  }, [leave]);

  useEffect(() => {
    const onBlur = () => {
      typing.current = false;
      expand(false);
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [expand]);

  const connection = state?.connection ?? 'offline';
  const playing = state?.playing ?? null;
  const progress = state?.progress ?? null;

  return (
    <div className={open ? 'island-pill open' : 'island-pill'} onMouseEnter={() => expand(true)} onMouseLeave={leave}>
      {!open ? (
        <div className="island-rest">
          <MatrixView subscribe={subscribe} size={28} label="What is on the matrix" />
          <span className="island-now">{playing ?? 'Dark'}</span>
          {state?.onAir && <span className="island-air">On air</span>}
          {progress !== null && <span className="island-pct">{progress}%</span>}
          <span className={`dot ${connection}`} aria-hidden="true" />
          {progress !== null && <span className="island-bar" style={{ width: `${progress}%` }} />}
        </div>
      ) : (
        <div className="island-panel">
          <div className="island-head">
            <MatrixView subscribe={subscribe} size={84} label="What is on the matrix" />
            <div className="island-info">
              <div className="label">{playing ? 'Now showing' : 'Dark'}</div>
              <div className="island-now">{playing ?? 'Send something to light it up'}</div>
              <div className="island-status">
                <span className={`dot ${connection}`} aria-hidden="true" />
                {STATUS[connection]}
                {connection === 'connected' && state?.phoneName ? ` to ${state.phoneName}` : ''}
              </div>
              <input
                type="range"
                aria-label="Brightness"
                min={10}
                max={255}
                value={state?.brightness ?? 255}
                onChange={(ev) => {
                  const value = Number(ev.target.value);
                  setState((s) => s && { ...s, brightness: value });
                  send('island:from', { t: 'brightness', value });
                }}
              />
            </div>
          </div>

          <form
            className="island-send"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!text.trim()) return;
              send('island:from', { t: 'text', text });
              setText('');
            }}
          >
            <input
              type="text"
              aria-label="Text for the matrix"
              placeholder="Say something, then Enter"
              value={text}
              onChange={(ev) => setText(ev.target.value)}
              onFocus={() => (typing.current = true)}
              onBlur={() => (typing.current = false)}
            />
          </form>

          <div className="island-actions">
            <button className="chip" onClick={() => send('island:from', { t: 'clear' })} disabled={!playing}>
              Clear
            </button>
            <span className="island-gap" />
            <button className="link" onClick={() => send('island:from', { t: 'open' })}>
              Open app
            </button>
            <button className="link" onClick={() => send('island:from', { t: 'hide' })}>
              Hide
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
