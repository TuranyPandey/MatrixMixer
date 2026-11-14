import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_IMAGE_OPTIONS,
  DEFAULT_PORT,
  LED_COUNT,
  PIXELS,
  SIZE,
  animationSource,
  applyMask,
  blankFrame,
  type ButtonAction,
  type Frame,
  type ImageOptions,
} from '@matrix-bridge/core';
import {
  bitmapToFrame,
  connect,
  disconnect,
  forgetPhone,
  pair,
  player,
  runBinding,
  sendText,
  updateSettings,
  useBridge,
  type ActionKind,
} from './bridge';
import { DotText } from './DotText';
import { MatrixView } from './MatrixView';
import { apiInfo, discoverPhones, isTauri, type ApiInfo, type FoundPhone } from './native';
import { ROTATABLE } from './widgets';

type PanelProps = { go: (tab: string) => void };

/** False where something else already names the page (the mode row on the stage). */
export const ShowTitles = createContext(true);

/** Page heading set in the matrix's own dot font, with one line that says what the page is for. */
export function PageTitle({ title, lede }: { title: string; lede: string }) {
  if (!useContext(ShowTitles)) return null;
  return (
    <header className="page-head">
      <h1 aria-label={title}>
        <DotText text={title} cell={4} />
      </h1>
      <p className="lede">{lede}</p>
    </header>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

// ---- Phone ------------------------------------------------------------------------

export function ConnectPanel({ go }: PanelProps) {
  const bridge = useBridge();
  const [host, setHost] = useState(bridge.settings.host);
  const [port, setPort] = useState(String(bridge.settings.port));
  const [code, setCode] = useState('');
  const [found, setFound] = useState<FoundPhone[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const search = async () => {
    setSearching(true);
    setSearchError(null);
    try {
      setFound(await discoverPhones());
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    }
    setSearching(false);
  };

  const portNumber = Number(port);
  const portOk = Number.isInteger(portNumber) && portNumber > 0 && portNumber < 65536;

  if (bridge.connection === 'connected') {
    return (
      <>
        <PageTitle title="Phone" lede="Get your phone on the line. You only pair once." />
        <Section title="Connected">
          <p className="big">{bridge.phoneName ?? 'Phone'}</p>
          <p className="muted mono">
            {bridge.settings.host}:{bridge.settings.port}
          </p>
          <div className="row">
            <button onClick={() => go('text')}>Send something</button>
            <button className="ghost" onClick={disconnect}>
              Disconnect
            </button>
            <button className="ghost danger" onClick={forgetPhone}>
              Forget this phone
            </button>
          </div>
        </Section>
        <Section title="Glyph Button">
          <p>
            {bridge.toyActive
              ? 'The PC Remote toy is selected on the phone. A long-press of the Glyph Button now reaches this PC.'
              : 'Not active. On the phone, add the "PC Remote" toy and press the Glyph Button until its arrow icon shows.'}
          </p>
          <button className="ghost" onClick={() => go('buttons')}>
            Choose what the button does
          </button>
        </Section>
      </>
    );
  }

  if (bridge.connection === 'pairing') {
    const ready = /^\d{6}$/.test(code.replace(/\s/g, ''));
    return (
      <>
        <PageTitle title="Phone" lede="Get your phone on the line. You only pair once." />
        <Section title="Enter the code">
          <p>
            Open MatrixMixer on {bridge.phoneName ?? 'the phone'} and type the 6-digit pairing code it shows. You only do
            this once per PC.
          </p>
          <form
            className="row"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (ready && !bridge.pairPending) pair(code.replace(/\s/g, ''));
            }}
          >
            <input
              className="code"
              inputMode="numeric"
              autoFocus
              aria-label="Pairing code"
              placeholder="000000"
              maxLength={7}
              value={code}
              onChange={(ev) => setCode(ev.target.value.replace(/[^\d\s]/g, ''))}
            />
            <button type="submit" disabled={!ready || bridge.pairPending}>
              {bridge.pairPending ? 'Checking' : 'Pair'}
            </button>
            <button type="button" className="ghost" onClick={disconnect}>
              Cancel
            </button>
          </form>
        </Section>
      </>
    );
  }

  const busy = bridge.connection === 'connecting' || bridge.connection === 'reconnecting';
  return (
    <>
      <PageTitle title="Phone" lede="Get your phone on the line. You only pair once." />
      {busy && (
        <Section title={bridge.connection === 'connecting' ? 'Connecting' : 'Reconnecting'}>
          <p>
            Trying {bridge.settings.host}:{bridge.settings.port}. This keeps retrying until the phone answers.
          </p>
          <button className="ghost" onClick={disconnect}>
            Stop trying
          </button>
        </Section>
      )}

      <Section title="Find your phone">
        <p>Start MatrixMixer on the phone first. Both devices need to be on the same Wi-Fi.</p>
        <div className="row">
          <button onClick={search} disabled={searching}>
            {searching ? 'Searching' : 'Search this network'}
          </button>
        </div>
        {searchError && <p className="warn">{searchError}</p>}
        {found && found.length === 0 && (
          <p className="warn">
            No phones answered. College and hostel Wi-Fi often blocks this kind of search. Type the address shown in the
            phone app below, or use USB.
          </p>
        )}
        {found?.map((phone) => (
          <button key={`${phone.host}:${phone.port}`} className="found" onClick={() => void connect(phone.host, phone.port)}>
            <span>{phone.name}</span>
            <span className="mono muted">
              {phone.host}:{phone.port}
            </span>
          </button>
        ))}
      </Section>

      <Section title="Or type the address">
        <form
          className="row end"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (host.trim() && portOk) void connect(host.trim(), portNumber);
          }}
        >
          <label className="field grow">
            <span className="label">Address</span>
            <input value={host} onChange={(ev) => setHost(ev.target.value)} placeholder="192.168.1.23" spellCheck={false} />
          </label>
          <label className="field">
            <span className="label">Port</span>
            <input className="short" value={port} onChange={(ev) => setPort(ev.target.value)} inputMode="numeric" />
          </label>
          <button type="submit" disabled={!host.trim() || !portOk}>
            Connect
          </button>
        </form>
        {!portOk && <p className="warn">Port is a number from 1 to 65535. The default is {DEFAULT_PORT}.</p>}
      </Section>

      <Section title="Over USB">
        <p>Works on any network. With the phone plugged in and USB debugging on, run this once per session:</p>
        <pre>adb forward tcp:{DEFAULT_PORT} tcp:{DEFAULT_PORT}</pre>
        <button className="ghost" onClick={() => void connect('127.0.0.1', DEFAULT_PORT)}>
          Connect over USB
        </button>
      </Section>
    </>
  );
}

// ---- Text -------------------------------------------------------------------------

export function TextPanel(_: PanelProps) {
  const [text, setText] = useState('HELLO');
  const [loops, setLoops] = useState('1');
  const send = (value = text) => {
    if (!value.trim()) return;
    // A set number of passes goes over what is showing, then gives the matrix back to it.
    sendText(value, { loops: loops === 'forever' ? Infinity : Number(loops) });
  };
  return (
    <>
      <PageTitle title="Text" lede="Say it in 25 dots. Long messages scroll." />
      <Section title="Message">
        <form
          className="compose"
          onSubmit={(ev) => {
            ev.preventDefault();
            send();
          }}
        >
          <input aria-label="Message" value={text} onChange={(ev) => setText(ev.target.value)} maxLength={200} autoFocus />
          <select aria-label="Repeat" value={loops} onChange={(ev) => setLoops(ev.target.value)}>
            <option value="1">Once</option>
            <option value="3">3 times</option>
            <option value="10">10 times</option>
            <option value="forever">Keep scrolling</option>
          </select>
          <button type="submit" disabled={!text.trim()}>
            Send
          </button>
        </form>
        <div className="row wrap presets">
          {['BRB', 'IN A CALL', 'DO NOT DISTURB', 'BUILD PASSED', 'LUNCH'].map((preset) => (
            <button
              key={preset}
              className="chip"
              onClick={() => {
                setText(preset);
                send(preset);
              }}
            >
              {preset}
            </button>
          ))}
        </div>
        <p className="hint">
          It passes over whatever is showing, then that comes back: a widget stays on until you take it off. Keep scrolling replaces it instead. Speed is the Text speed slider next to the matrix.
        </p>
      </Section>
    </>
  );
}

// ---- Draw -------------------------------------------------------------------------

type SavedDrawing = { name: string; px: number[] };
const DRAWINGS_KEY = 'matrix-bridge.drawings';

function loadDrawings(): SavedDrawing[] {
  try {
    const list = JSON.parse(localStorage.getItem(DRAWINGS_KEY) ?? '[]') as SavedDrawing[];
    return Array.isArray(list) ? list.filter((d) => Array.isArray(d.px) && d.px.length === PIXELS) : [];
  } catch {
    return [];
  }
}

const BRUSHES = [
  { label: 'Bright', value: 255 },
  { label: 'Dim', value: 80 },
  { label: 'Erase', value: 0 },
];

export function DrawPanel(_: PanelProps) {
  const [frame, setFrame] = useState<Frame>(() => blankFrame());
  const [brush, setBrush] = useState(255);
  const [live, setLive] = useState(true);
  const [name, setName] = useState('');
  const [drawings, setDrawings] = useState(loadDrawings);
  const [copied, setCopied] = useState(false);

  const apply = (next: Frame) => {
    setFrame(next);
    if (live) player.show(next, 'drawing');
  };
  const paint = (x: number, y: number) => {
    if (frame[y * SIZE + x] === brush) return;
    const next = frame.slice();
    next[y * SIZE + x] = brush;
    apply(next);
  };
  const persist = (list: SavedDrawing[]) => {
    setDrawings(list);
    try {
      localStorage.setItem(DRAWINGS_KEY, JSON.stringify(list));
    } catch {
      /* not saved; still usable this session */
    }
  };
  const empty = frame.every((v) => v === 0);

  return (
    <>
      <PageTitle title="Draw" lede={`${LED_COUNT} LEDs and a mouse. Make them count.`} />
      <Section title="Pixel editor">
        <div className="draw">
          <MatrixView frame={frame} size={320} onPaint={paint} label="Drawing canvas, 25 by 25 dots" />
          <div className="tools">
            <span className="label">Brush</span>
            <div className="segmented" role="group" aria-label="Brush">
              {BRUSHES.map((b) => (
                <button key={b.label} className={brush === b.value ? 'on' : ''} onClick={() => setBrush(b.value)}>
                  {b.label}
                </button>
              ))}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={live}
                onChange={(ev) => {
                  setLive(ev.target.checked);
                  if (ev.target.checked) player.show(frame, 'drawing');
                }}
              />
              Show on the matrix as I draw
            </label>
            {!live && <button onClick={() => player.show(frame, 'drawing')}>Send to matrix</button>}
            <div className="row wrap tool-actions">
              <button className="ghost" disabled={empty} onClick={() => apply(applyMask(frame.map((v) => 255 - v)))}>
                Invert
              </button>
              <button className="ghost" disabled={empty} onClick={() => apply(blankFrame())}>
                Clear
              </button>
              <button
                className="ghost"
                disabled={empty}
                title='Works with "matrix frame"'
                onClick={() => {
                  void navigator.clipboard?.writeText(JSON.stringify(Array.from(frame))).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                {copied ? 'Copied' : 'Copy JSON'}
              </button>
            </div>
            <form
              className="save"
              onSubmit={(ev) => {
                ev.preventDefault();
                const clean = name.trim();
                if (!clean || empty) return;
                persist([{ name: clean, px: Array.from(frame) }, ...drawings.filter((d) => d.name !== clean)]);
                setName('');
              }}
            >
              <span className="label">Keep it</span>
              <div className="row">
                <input aria-label="Name for this drawing" value={name} onChange={(ev) => setName(ev.target.value)} maxLength={40} placeholder="Name it" />
                <button type="submit" className="ghost" disabled={!name.trim() || empty}>
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      </Section>
      <Section title="Saved drawings">
        {drawings.length === 0 ? (
          <p className="muted">Nothing saved yet. Draw something, name it and save it.</p>
        ) : (
          <div className="gallery">
            {drawings.map((d) => (
              <div key={d.name} className="thumb">
                <button className="thumb-open" onClick={() => apply(Uint8Array.from(d.px))} title={`Open ${d.name}`}>
                  <MatrixView frame={Uint8Array.from(d.px)} size={84} label={d.name} />
                  <span>{d.name}</span>
                </button>
                <button className="link danger" onClick={() => persist(drawings.filter((x) => x.name !== d.name))}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

// ---- Image ------------------------------------------------------------------------

type Decoded = { name: string; sources: HTMLCanvasElement[]; delays: number[] };

/** Minimal typing for the WebCodecs GIF decoder (Chromium/WebView2 only). */
type GifDecoder = {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(options: { frameIndex: number }): Promise<{ image: CanvasImageSource & { displayWidth: number; displayHeight: number; duration: number | null; close(): void } }>;
  close(): void;
};

const MAX_GIF_FRAMES = 150;

function toCanvas(image: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const scale = Math.min(1, 200 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function decodeFile(file: File): Promise<Decoded> {
  const Decoder = (window as unknown as { ImageDecoder?: new (init: { data: ArrayBuffer; type: string }) => GifDecoder }).ImageDecoder;
  if (file.type === 'image/gif' && Decoder) {
    const decoder = new Decoder({ data: await file.arrayBuffer(), type: file.type });
    await decoder.tracks.ready;
    const count = Math.min(decoder.tracks.selectedTrack?.frameCount ?? 1, MAX_GIF_FRAMES);
    const sources: HTMLCanvasElement[] = [];
    const delays: number[] = [];
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      sources.push(toCanvas(image, image.displayWidth, image.displayHeight));
      delays.push(Math.max(30, (image.duration ?? 100_000) / 1000));
      image.close();
    }
    decoder.close();
    return { name: file.name, sources, delays };
  }
  const bitmap = await createImageBitmap(file);
  const sources = [toCanvas(bitmap, bitmap.width, bitmap.height)];
  bitmap.close();
  return { name: file.name, sources, delays: [0] };
}

export function ImagePanel(_: PanelProps) {
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [options, setOptions] = useState<ImageOptions>(DEFAULT_IMAGE_OPTIONS);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const frames = useMemo(
    () => decoded?.sources.map((c) => bitmapToFrame(c, c.width, c.height, options)) ?? [],
    [decoded, options],
  );
  const animated = frames.length > 1;

  // Flip through GIF frames in the local preview.
  useEffect(() => {
    setPreviewIndex(0);
    if (!decoded || !animated) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      i = (i + 1) % decoded.sources.length;
      setPreviewIndex(i);
      timer = setTimeout(step, decoded.delays[i]);
    };
    timer = setTimeout(step, decoded.delays[0]);
    return () => clearTimeout(timer);
  }, [decoded, animated]);

  const open = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setDecoded(await decodeFile(file));
    } catch {
      setDecoded(null);
      setError(`Could not open ${file.name}. Use a PNG, JPEG, GIF or WebP image.`);
    }
  };
  const set = (patch: Partial<ImageOptions>) => setOptions((o) => ({ ...o, ...patch }));
  const send = () => {
    if (!decoded || frames.length === 0) return;
    if (animated) void player.play(animationSource(frames, decoded.delays, true, `gif: ${decoded.name}`));
    else player.show(frames[0]!, `image: ${decoded.name}`);
  };

  return (
    <>
      <PageTitle title="Image" lede="Any picture or GIF, squashed down to 25 by 25." />
      <Section title="Picture or GIF">
        <div
          className={`drop${dragging ? ' over' : ''}${decoded ? '' : ' empty'}`}
          onDragOver={(ev) => {
            ev.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(ev) => {
            ev.preventDefault();
            setDragging(false);
            void open(ev.dataTransfer.files[0]);
          }}
        >
          <input ref={input} type="file" accept="image/*" hidden onChange={(ev) => void open(ev.target.files?.[0])} />
          <button onClick={() => input.current?.click()}>Choose image</button>
          <span className="muted">or drop one here</span>
        </div>
        {error && <p className="warn">{error}</p>}
        {!decoded && !error && (
          <p className="hint">Simple, high-contrast images work best: logos, icons, pixel art. 25 dots is not much.</p>
        )}

        {decoded && (
          <div className="draw">
            <MatrixView frame={frames[previewIndex] ?? frames[0]} size={236} label={`Preview of ${decoded.name}`} />
            <div className="tools">
              <div className="muted">
                {decoded.name}
                {animated ? ` · ${frames.length} frames` : ''}
              </div>
              <div className="label">Fit</div>
              <div className="segmented">
                <button className={options.fit === 'cover' ? 'on' : ''} onClick={() => set({ fit: 'cover' })}>
                  Fill
                </button>
                <button className={options.fit === 'contain' ? 'on' : ''} onClick={() => set({ fit: 'contain' })}>
                  Whole image
                </button>
              </div>
              <label className="field">
                <span className="label">Contrast</span>
                <input
                  type="range"
                  min={0.4}
                  max={3}
                  step={0.1}
                  value={options.gamma}
                  onChange={(ev) => set({ gamma: Number(ev.target.value) })}
                />
              </label>
              <label className="check">
                <input type="checkbox" checked={options.invert} onChange={(ev) => set({ invert: ev.target.checked })} />
                Invert (for dark art on a light background)
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={options.levels === 2}
                  onChange={(ev) => set(ev.target.checked ? { levels: 2, dither: true } : { levels: 256, dither: false })}
                />
                On/off dots only (dithered)
              </label>
              <button onClick={send}>{animated ? 'Play on matrix' : 'Send to matrix'}</button>
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

// ---- Glyph Button -----------------------------------------------------------------

const ACTIONS: Array<{ kind: ActionKind; label: string }> = [
  { kind: 'none', label: 'Do nothing' },
  { kind: 'next_widget', label: 'Next widget' },
  { kind: 'play_pause', label: 'Play / pause media' },
  { kind: 'next_track', label: 'Next track' },
  { kind: 'previous_track', label: 'Previous track' },
  { kind: 'mute_volume', label: 'Mute sound' },
  { kind: 'mute_mic', label: 'Mute microphone (Win+Alt+K)' },
  { kind: 'lock', label: 'Lock this PC' },
  { kind: 'command', label: 'Run a command' },
];

const GESTURES: Array<{ action: ButtonAction; label: string; hint: string }> = [
  { action: 'long', label: 'Long-press', hint: 'The reliable one. Start here.' },
  { action: 'down', label: 'Touch down', hint: 'Fires the moment a finger lands.' },
  { action: 'up', label: 'Touch up', hint: 'Fires on release.' },
];

export function ButtonsPanel(_: PanelProps) {
  const bridge = useBridge();
  const [testResult, setTestResult] = useState<string | null>(null);
  const { buttons } = bridge.settings;
  const { widgets } = bridge.settings;
  const usesNext = Object.values(buttons).some((b) => b.kind === 'next_widget');
  const setBinding = (action: ButtonAction, patch: Partial<{ kind: ActionKind; command: string }>) =>
    updateSettings({ buttons: { ...buttons, [action]: { ...buttons[action], ...patch } } });

  return (
    <>
      <PageTitle title="Glyph Button" lede="One button on the back of the phone. Your PC on the other end." />
      <Section title="How it works">
        <p>
          Nothing OS only shares the Glyph Button with the Glyph Toy that is currently selected. So: on the phone, add the
          "PC Remote" toy, then short-press the Glyph Button until its arrow icon appears. From then on the gestures below
          reach this PC. A short press is never sent; it moves to the next toy.
        </p>
        <p className={bridge.toyActive ? 'ok' : 'muted'}>
          {bridge.connection !== 'connected'
            ? 'Phone not connected.'
            : bridge.toyActive
              ? 'PC Remote is selected. The button is live.'
              : 'PC Remote is not the selected toy right now.'}
        </p>
        {bridge.lastButton && (
          <p className="mono muted">
            Last: {bridge.lastButton.action} at {new Date(bridge.lastButton.at).toLocaleTimeString()} · {bridge.lastButton.result}
          </p>
        )}
      </Section>

      <Section title="Actions">
        {GESTURES.map(({ action, label, hint }) => {
          const binding = buttons[action];
          return (
            <div key={action} className="binding">
              <div>
                <div>{label}</div>
                <div className="hint">{hint}</div>
              </div>
              <select
                aria-label={`Action for ${label}`}
                value={binding.kind}
                onChange={(ev) => setBinding(action, { kind: ev.target.value as ActionKind })}
              >
                {ACTIONS.map((a) => (
                  <option key={a.kind} value={a.kind}>
                    {a.label}
                  </option>
                ))}
              </select>
              {binding.kind === 'command' && (
                <input
                  className="command mono"
                  aria-label={`Command for ${label}`}
                  placeholder='e.g. notepad.exe  or  python C:\scripts\deploy.py'
                  value={binding.command}
                  spellCheck={false}
                  onChange={(ev) => setBinding(action, { command: ev.target.value })}
                />
              )}
              <button
                className="ghost"
                disabled={binding.kind === 'none'}
                onClick={() => {
                  setTestResult(null);
                  runBinding(binding).then(
                    (result) => setTestResult(`${label}: ${result === 'Done' ? 'ran' : result}`),
                    (err) => setTestResult(`${label}: ${err instanceof Error ? err.message : String(err)}`),
                  );
                }}
              >
                Test
              </button>
            </div>
          );
        })}
        {testResult && <p className="mono muted">{testResult}</p>}
        <p className="hint">
          Commands run on this PC with your user account, exactly as typed. Only add ones you would run yourself.
        </p>
      </Section>

      <Section title="Next widget">
        <p>
          Bind a gesture to "Next widget" and each press steps the matrix to the next one of these, so you can flip
          through them from the back of the phone without touching the PC.
        </p>
        <div className="row wrap">
          {ROTATABLE.map((w) => {
            const on = widgets.rotation.includes(w.name);
            return (
              <button
                key={w.name}
                className={on ? 'chip on' : 'chip'}
                aria-pressed={on}
                onClick={() =>
                  updateSettings({
                    widgets: { ...widgets, rotation: on ? widgets.rotation.filter((n) => n !== w.name) : [...widgets.rotation, w.name] },
                  })
                }
              >
                {w.label}
              </button>
            );
          })}
        </div>
        <p className="hint">
          {usesNext
            ? 'They come round in the order shown here. Ticker and Weather are skipped until they are set up in Widgets.'
            : 'No gesture is set to "Next widget" yet. Long-press is the one to use.'}
        </p>
      </Section>
    </>
  );
}

// ---- Developer ----------------------------------------------------------------------

export function DeveloperPanel(_: PanelProps) {
  const [info, setInfo] = useState<ApiInfo | null>(null);
  const [reveal, setReveal] = useState(false);
  useEffect(() => void apiInfo().then(setInfo), []);
  const base = info ? `http://127.0.0.1:${info.port}` : 'http://127.0.0.1:8766';
  const token = info ? (reveal ? info.token : '$TOKEN') : '$TOKEN';

  return (
    <>
      <PageTitle title="Developer" lede="Script it. Pipe it. Wire it into your builds." />
      <Section title="matrix CLI">
        <p>Any script can push to the matrix while this app is running.</p>
        <pre>{`matrix send "build passed"
matrix progress 42 BUILD
matrix image logo.png --invert
matrix brightness 120
matrix clear`}</pre>
        <p className="hint">
          Install it from the repo with "npm install -g ./cli". Example: npm test && matrix send "tests passed" || matrix send "TESTS FAILED"
        </p>
      </Section>

      <Section title="Local HTTP API">
        {info && info.port !== 0 ? (
          <>
            <p>
              Listening on <span className="mono">{base}</span>, this computer only. Every request needs the token.
            </p>
            <div className="row">
              <code className="token">{reveal ? info.token : '•'.repeat(24)}</code>
              <button className="ghost" onClick={() => setReveal(!reveal)}>
                {reveal ? 'Hide token' : 'Show token'}
              </button>
            </div>
            <p className="hint">Also saved in ~/.matrix-bridge/api.json, which is where the CLI reads it. It changes every launch.</p>
          </>
        ) : (
          <p className="muted">
            {isTauri ? 'The API could not start. Is another copy of the app running?' : 'The API runs inside the desktop app, not in a browser.'}
          </p>
        )}
        <pre>{`curl -X POST ${base}/text \\
  -H "Authorization: Bearer ${token}" \\
  -d '{"text":"hello","loops":2}'

POST /text        {"text": "...", "loops": 2, "speedMs": 60}
POST /notify      {"text": "..."}             passes once, then hands the matrix back
POST /progress    {"value": 0-100, "label": "BUILD"}   or {"done": true}, {"clear": true}
POST /frame       {"px": [625 numbers, 0-255, row by row]}
POST /image       body = PNG/JPEG/GIF bytes   ?invert=1&dither=1&fit=contain
POST /brightness  {"value": 0-255}
POST /clear
GET  /status`}</pre>
        <p className="hint">
          The matrix is a 25 x 25 grid, but it is round: only {LED_COUNT} of the {PIXELS} cells are real LEDs. Corner values are ignored.
        </p>
      </Section>
    </>
  );
}
