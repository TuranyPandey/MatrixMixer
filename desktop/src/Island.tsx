/**
 * The island: a small always-on-top pill at the top of the screen that mirrors
 * the matrix. Hovering opens quick controls. Runs in its own window
 * (island.html) and talks to the main window through islandLink.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { formatDuration, frameFromArray, tickerLine, type ConnectionState, type Frame } from '@matrix-bridge/core';
import { receive, send, type IslandLive, type IslandState, type IslandWidget } from './islandLink';
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

/** One line of the Widgets tab: a live reading. Clicking it puts that widget on the matrix, or takes it off. */
function Reading(props: {
  name: string;
  on: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div className={props.on ? 'island-row on' : 'island-row'}>
      <button
        className="read"
        aria-pressed={props.on}
        disabled={props.disabled}
        title={props.title ?? (props.on ? 'On the matrix. Click to take it off' : 'Click to put it on the matrix')}
        onClick={props.onClick}
      >
        <span className="pip" aria-hidden="true" />
        <span className="name">{props.name}</span>
        {props.children}
      </button>
      {props.extra}
    </div>
  );
}

function Widgets({ live, playing, notReady }: { live: IslandLive | null; playing: string | null; notReady: IslandWidget[] }) {
  const [now, setNow] = useState(() => new Date());
  const history = useRef<number[]>([]);
  const [, redraw] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // One reading arrives a second; keep the last 25 for the graph, like the matrix does.
  useEffect(() => {
    if (live?.cpu == null) return;
    history.current = [...history.current, live.cpu].slice(-25);
    redraw((n) => n + 1);
  }, [live]);

  const on = (name: IslandWidget) => playing === `widget: ${name}`;
  const toggle = (name: IslandWidget) => () => send('island:from', { t: 'widget', name });
  const quiet = (text: string) => <span className="value quiet">{text}</span>;

  const fetched = live?.quotes != null;
  const quotes = live?.quotes ?? [];
  // With several symbols, step through them every three seconds.
  const quote = quotes.length > 0 ? quotes[Math.floor(now.getTime() / 3000) % quotes.length]! : null;
  const weather = live?.weather ?? null;
  const timer = live?.timer ?? null;

  return (
    <div className="island-widgets">
      <Reading name="Clock" on={on('clock')} onClick={toggle('clock')}>
        <span className="value">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
      </Reading>

      <Reading
        name="Timer"
        on={playing === 'widget: timer'}
        title={!timer ? 'Start a 25 minute focus timer' : timer.phase === 'done' ? 'Dismiss' : timer.running ? 'Pause' : 'Resume'}
        onClick={() => send('island:from', { t: 'timer', do: !timer ? 'start' : timer.phase === 'done' ? 'stop' : 'toggle' })}
        extra={
          timer &&
          timer.phase !== 'done' && (
            <button className="stop" aria-label="Stop timer" title="Stop timer" onClick={() => send('island:from', { t: 'timer', do: 'stop' })}>
              x
            </button>
          )
        }
      >
        {!timer ? (
          quiet('Start 25:00')
        ) : timer.phase === 'done' ? (
          <span className="value">Time's up</span>
        ) : (
          <span className={timer.running ? 'value' : 'value quiet'}>
            {timer.phase === 'break' ? 'Break ' : ''}
            {formatDuration(timer.remaining)}
            {timer.running ? '' : ' paused'}
          </span>
        )}
      </Reading>

      <Reading name="System" on={on('system meter')} onClick={toggle('system meter')}>
        {live?.cpu == null ? quiet('Reading') : <span className="value">{`CPU ${live.cpu}%  RAM ${live.ram}%`}</span>}
      </Reading>

      <Reading name="Load" on={on('load graph')} onClick={toggle('load graph')}>
        <span className="island-spark" aria-label="CPU load over the last 25 seconds">
          {history.current.map((v, i) => (
            <i key={i} style={{ height: `${Math.max(4, Math.min(100, v))}%` }} />
          ))}
        </span>
      </Reading>

      <Reading
        name="Ticker"
        on={on('ticker')}
        disabled={!on('ticker') && notReady.includes('ticker')}
        title={notReady.includes('ticker') ? 'Add symbols in the app first' : undefined}
        onClick={toggle('ticker')}
      >
        {notReady.includes('ticker') ? quiet('No symbols') : quote ? <span className="value">{tickerLine([quote])}</span> : quiet(fetched ? 'No prices' : 'Fetching')}
      </Reading>

      <Reading
        name="Weather"
        on={on('weather')}
        disabled={!on('weather') && notReady.includes('weather')}
        title={notReady.includes('weather') ? 'Set a place in the app first' : weather ? weather.place : undefined}
        onClick={toggle('weather')}
      >
        {notReady.includes('weather')
          ? quiet('No place set')
          : weather
            ? <span className="value">{`${weather.kind} ${Math.round(weather.temperature)}\u00b0${weather.fahrenheit ? 'F' : 'C'}`}</span>
            : quiet('Fetching')}
      </Reading>

      <Reading name="Visualiser" on={on('visualiser')} onClick={toggle('visualiser')}>
        {quiet(on('visualiser') ? 'Playing' : 'Spectrum')}
      </Reading>
    </div>
  );
}

export function Island() {
  const [state, setState] = useState<IslandState | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [tab, setTab] = useState<'text' | 'widgets'>('text');
  const [live, setLive] = useState<IslandLive | null>(null);
  const frame = useRef<Frame>(new Uint8Array(625));
  const painters = useRef(new Set<(frame: Frame) => void>());
  const fold = useRef<number | undefined>(undefined);
  const typing = useRef(false);

  useEffect(() => {
    const stop = receive('island:to', (message) => {
      if (message.t === 'state') setState(message.state);
      else if (message.t === 'live') setLive(message.live);
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
  }, []);

  // The window is sized natively: the Widgets tab needs a taller panel than the Text tab.
  const widgetsUp = open && tab === 'widgets';
  useEffect(() => {
    if (isTauri) void invoke('island_expand', { expanded: open, tall: widgetsUp }).catch(() => {});
  }, [open, widgetsUp]);

  // Readings are only gathered while the Widgets tab is on screen.
  useEffect(() => {
    if (!widgetsUp) return;
    send('island:from', { t: 'watch', on: true });
    return () => send('island:from', { t: 'watch', on: false });
  }, [widgetsUp]);

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

          <div className="island-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'text'} className={tab === 'text' ? 'on' : ''} onClick={() => setTab('text')}>
              Text
            </button>
            <button role="tab" aria-selected={tab === 'widgets'} className={tab === 'widgets' ? 'on' : ''} onClick={() => setTab('widgets')}>
              Widgets
            </button>
          </div>

          {tab === 'text' ? (
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
          ) : (
            <Widgets live={live} playing={playing} notReady={state?.notReady ?? []} />
          )}

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
