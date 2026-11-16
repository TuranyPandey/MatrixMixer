/**
 * The island: a small always-on-top pill at the top of the screen that mirrors
 * the matrix. Hovering opens quick controls. Runs in its own window
 * (island.html) and talks to the main window through islandLink.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AMBIENT_STYLES, formatDuration, frameFromArray, tickerLine, type ConnectionState, type Frame } from '@matrix-bridge/core';
import { receive, send, type IslandImage, type IslandLive, type IslandState, type IslandWidget } from './islandLink';
import { MatrixView } from './MatrixView';
import { isTauri } from './native';
import { describeShowing, showingLine } from './showing';
import { SHELF, previewFrames, type ShelfId } from './widgetPreviews';

const STATUS: Record<ConnectionState, string> = {
  offline: 'No phone on the line',
  connecting: 'Dialling',
  pairing: 'Waiting for the code',
  connected: 'Linked',
  reconnecting: 'Lost it. Redialling',
};

/** How long the pointer may be away before the panel folds up. */
const FOLD_MS = 350;

/**
 * The Widgets tab: the same shelf of small live matrices as the main window.
 * Clicking one only picks it; the line under the shelf reads it out and holds
 * the button that puts it on the matrix or takes it off.
 */
function Widgets({ live, playing, notReady }: { live: IslandLive | null; playing: string | null; notReady: IslandWidget[] }) {
  const [now, setNow] = useState(() => new Date());
  const history = useRef<number[]>([]);
  const showing = playing?.startsWith('widget: ') ? (playing.slice(8) as ShelfId) : null;
  const [focus, setFocus] = useState<ShelfId>(showing ?? 'clock');

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // One reading arrives a second; keep the last 25 for the graph, like the matrix does.
  const cpu = live?.cpu ?? null;
  useEffect(() => {
    if (cpu !== null) history.current = [...history.current, cpu].slice(-25);
    // Deliberately on every reading, not only when the number changes.
  }, [live, cpu]);

  const timer = live?.timer ?? null;
  const frames = previewFrames({
    now,
    hour12: live?.hour12 ?? false,
    timer,
    cpu: cpu ?? 0,
    ram: live?.ram ?? 0,
    history: history.current,
    symbol: live?.symbol ?? null,
    weather: live?.weather ?? null,
    ambient: live?.ambient ?? 'rain',
  });

  const blocked = (id: ShelfId) => id !== 'timer' && id !== showing && notReady.includes(id);
  /** Puts the picked widget on the matrix or takes it off; for the timer, starts, pauses or dismisses it. */
  const act = (id: ShelfId) => {
    if (blocked(id)) return;
    if (id !== 'timer') send('island:from', { t: 'widget', name: id });
    else send('island:from', { t: 'timer', do: !timer ? 'start' : timer.phase === 'done' ? 'stop' : 'toggle' });
  };
  const actLabel =
    focus !== 'timer'
      ? focus === showing
        ? 'Take off'
        : 'Show'
      : !timer
        ? 'Start'
        : timer.phase === 'done'
          ? 'Dismiss'
          : timer.running
            ? 'Pause'
            : 'Resume';

  const quotes = live?.quotes ?? [];
  // With several symbols, step through them every three seconds.
  const quote = quotes.length > 0 ? quotes[Math.floor(now.getTime() / 3000) % quotes.length]! : null;
  const weather = live?.weather ?? null;
  const reading: Record<ShelfId, string> = {
    clock: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: live?.hour12 ?? false }),
    timer: !timer
      ? '25 minutes of focus'
      : timer.phase === 'done'
        ? "Time's up"
        : `${timer.phase === 'break' ? 'Break ' : ''}${formatDuration(timer.remaining)}${timer.running ? '' : ' paused'}`,
    'system meter': cpu === null ? 'Reading' : `CPU ${cpu}%  RAM ${live?.ram ?? 0}%`,
    'load graph': cpu === null ? 'Reading' : `CPU ${cpu}% now, last 25 seconds`,
    visualiser: showing === 'visualiser' ? 'Playing' : 'Spectrum of what this PC plays',
    ticker: notReady.includes('ticker') ? 'Add symbols in the app first' : quote ? tickerLine([quote]) : live?.quotes != null ? 'No prices' : 'Fetching',
    weather: notReady.includes('weather')
      ? 'Set a place in the app first'
      : weather
        ? `${weather.place}  ${Math.round(weather.temperature)}\u00b0${weather.fahrenheit ? 'F' : 'C'}`
        : 'Fetching',
    ambient: AMBIENT_STYLES.find((s) => s.id === (live?.ambient ?? 'rain'))!.name,
  };
  const name = SHELF.find((w) => w.id === focus)!.name;

  return (
    <div className="island-widgets">
      <div className="island-shelf" role="listbox" aria-label="Widgets">
        {SHELF.map((w) => (
          <button
            key={w.id}
            role="option"
            aria-selected={w.id === showing}
            aria-label={w.name}
            className={`island-item${w.id === showing ? ' on' : ''}${w.id === focus ? ' focus' : ''}`}
            title={`${w.name}. Double-click to ${w.id === showing ? 'take it off' : 'put it on the matrix'}`}
            // A click only picks. Pointing or clicking around the shelf never changes the matrix.
            onClick={() => setFocus(w.id)}
            onDoubleClick={() => act(w.id)}
          >
            <MatrixView frame={frames[w.id]} size={40} label={`${w.name} preview`} />
          </button>
        ))}
      </div>
      <div className={focus === showing ? 'island-read on' : 'island-read'}>
        <span className="name">{name}</span>
        <span className="value">{reading[focus]}</span>
        <button className="act" disabled={blocked(focus)} onClick={() => act(focus)}>
          {actLabel}
        </button>
        {focus === 'timer' && timer && timer.phase !== 'done' && (
          <button className="stop" aria-label="Stop timer" title="Stop timer" onClick={() => send('island:from', { t: 'timer', do: 'stop' })}>
            Stop
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The Images tab: every saved and ready-made picture in one row that scrolls
 * sideways. Like the widget shelf, a click only picks; the button shows it.
 */
function Images({ images, playing }: { images: IslandImage[] | null; playing: string | null }) {
  const showing = images?.find((i) => playing === `image: ${i.name}`)?.id ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const focus = images?.find((i) => i.id === (picked ?? showing)) ?? images?.[0] ?? null;
  const act = (image: IslandImage) => send('island:from', image.id === showing ? { t: 'clear' } : { t: 'image', id: image.id });

  if (!images) return <div className="island-read"><span className="value">Fetching</span></div>;
  return (
    <div className="island-widgets">
      <div
        className="island-strip"
        role="listbox"
        aria-label="Pictures"
        // A mouse wheel moves the row sideways; there is nothing to scroll up or down here.
        onWheel={(ev) => (ev.currentTarget.scrollLeft += ev.deltaY + ev.deltaX)}
      >
        {images.map((image) => (
          <button
            key={image.id}
            role="option"
            aria-selected={image.id === showing}
            aria-label={image.name}
            className={`island-item${image.id === showing ? ' on' : ''}${image.id === focus?.id ? ' focus' : ''}`}
            title={`${image.name}. Double-click to ${image.id === showing ? 'take it off' : 'put it on the matrix'}`}
            onClick={() => setPicked(image.id)}
            onDoubleClick={() => act(image)}
          >
            <MatrixView frame={frameFromArray(image.px)} size={40} label={image.name} />
          </button>
        ))}
      </div>
      {focus && (
        <div className={focus.id === showing ? 'island-read on' : 'island-read'}>
          <span className="name">{focus.name}</span>
          <span className="value">
            {focus.frames > 1 ? `${focus.frames} frames` : focus.builtin ? 'Ready-made' : 'Yours'} · {images.length} to scroll through
          </span>
          <button className="act" onClick={() => act(focus)}>
            {focus.id === showing ? 'Take off' : 'Show'}
          </button>
        </div>
      )}
    </div>
  );
}

export function Island() {
  const [state, setState] = useState<IslandState | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [tab, setTab] = useState<'text' | 'widgets' | 'images'>('text');
  const [images, setImages] = useState<IslandImage[] | null>(null);
  const [live, setLive] = useState<IslandLive | null>(null);
  const frame = useRef<Frame>(new Uint8Array(625));
  const painters = useRef(new Set<(frame: Frame) => void>());
  const fold = useRef<number | undefined>(undefined);
  const typing = useRef(false);

  useEffect(() => {
    const stop = receive('island:to', (message) => {
      if (message.t === 'state') setState(message.state);
      else if (message.t === 'live') setLive(message.live);
      else if (message.t === 'images') setImages(message.images);
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

  // The window is sized natively: the Widgets and Images tabs need a taller panel than the Text tab.
  const widgetsUp = open && tab === 'widgets';
  const imagesUp = open && tab === 'images';
  const tall = widgetsUp || imagesUp;
  useEffect(() => {
    if (isTauri) void invoke('island_expand', { expanded: open, tall }).catch(() => {});
  }, [open, tall]);

  // The library is fetched when its tab comes into view; later changes arrive by themselves.
  useEffect(() => {
    if (imagesUp) send('island:from', { t: 'images' });
  }, [imagesUp]);

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
          <span className={playing ? 'island-now' : 'island-now quiet'}>{showingLine(playing) ?? 'Dark'}</span>
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
              <div className={playing ? 'label lit' : 'label'}>{describeShowing(playing)?.kind ?? 'Dark'}</div>
              <div className={playing ? 'island-now big' : 'island-now big quiet'}>{describeShowing(playing)?.detail ?? 'Nothing on the matrix'}</div>
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
            <button role="tab" aria-selected={tab === 'images'} className={tab === 'images' ? 'on' : ''} onClick={() => setTab('images')}>
              Images
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
          ) : tab === 'widgets' ? (
            <Widgets live={live} playing={playing} notReady={state?.notReady ?? []} />
          ) : (
            <Images images={images} playing={playing} />
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
