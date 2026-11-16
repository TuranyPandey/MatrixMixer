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
  keepOnPhone,
  player,
  runBinding,
  sendText,
  updateSettings,
  useBridge,
  type ActionKind,
} from './bridge';
import { DotText } from './DotText';
import { MAX_FRAMES, fitFrames, onEdit, saveImage, type SavedImage } from './library';
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

const isBlank = (frame: Frame) => frame.every((v) => v === 0);

const BRUSHES = [
  { label: 'Bright', value: 255 },
  { label: 'Dim', value: 80 },
  { label: 'Erase', value: 0 },
];

export function DrawPanel(_: PanelProps) {
  // A drawing is one frame; add more and it is an animation.
  const [frames, setFrames] = useState<Frame[]>(() => [blankFrame()]);
  const [at, setAt] = useState(0);
  const [delay, setDelay] = useState(200);
  const [playing, setPlaying] = useState(false);
  /** What came of the last "Keep on phone". */
  const [kept, setKept] = useState<{ ok: boolean; text: string } | null>(null);
  const frame = frames[at] ?? frames[0]!;
  const [brush, setBrush] = useState(255);
  const [live, setLive] = useState(true);
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);
  const [savedAs, setSavedAs] = useState<string | null>(null);

  const apply = (next: Frame) => {
    // Drawing on a moving picture makes no sense: editing stops the playback.
    setPlaying(false);
    setFrames((list) => list.map((f, i) => (i === at ? next : f)));
    if (live) player.show(next, 'drawing');
  };
  const goTo = (index: number, list = frames) => {
    setPlaying(false);
    setAt(index);
    if (live) player.show(list[index]!, 'drawing');
  };
  const addFrame = () => {
    // A copy of the frame you are on, so the next step of the movement is a small change.
    const list = [...frames.slice(0, at + 1), frame.slice(), ...frames.slice(at + 1)];
    setFrames(list);
    goTo(at + 1, list);
  };
  const removeFrame = () => {
    const list = frames.filter((_, i) => i !== at);
    setFrames(list);
    goTo(Math.max(0, at - 1), list);
  };
  const open = (d: SavedImage) => {
    const list = (d.frames?.length ? d.frames : [d.px]).slice(0, MAX_FRAMES).map((px) => Uint8Array.from(px));
    setFrames(list);
    setDelay(Math.max(50, Math.min(1000, d.delay ?? 200)));
    goTo(0, list);
  };

  // Playing loops the frames here and on the matrix, in step.
  useEffect(() => {
    if (!playing) return;
    void player.play(animationSource(frames, delay, true, 'drawing'));
    const id = window.setInterval(() => setAt((i) => (i + 1) % frames.length), delay);
    return () => window.clearInterval(id);
  }, [playing, delay, frames]);
  const paint = (x: number, y: number) => {
    if (frame[y * SIZE + x] === brush) return;
    const next = frame.slice();
    next[y * SIZE + x] = brush;
    apply(next);
  };
  // "Edit" on the Saved view sends the picture here.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => onEdit((image) => openRef.current(image)), []);
  const empty = isBlank(frame);
  const allEmpty = frames.every(isBlank);

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
                if (!clean || allEmpty) return;
                const saved: SavedImage = { name: clean, px: Array.from(frames[0]!) };
                if (frames.length > 1) Object.assign(saved, { frames: frames.map((f) => Array.from(f)), delay });
                saveImage(saved);
                setSavedAs(clean);
                setName('');
              }}
            >
              <span className="label">Keep it</span>
              <div className="row">
                <input aria-label="Name for this drawing" value={name} onChange={(ev) => setName(ev.target.value)} maxLength={40} placeholder="Name it" />
                <button type="submit" className="ghost" disabled={!name.trim() || allEmpty}>
                  Save
                </button>
              </div>
              {savedAs && <span className="hint">Saved as "{savedAs}". It is under Saved, and in the island.</span>}
            </form>
          </div>
        </div>
        <div className="frames">
          <span className="label">Frames</span>
          <div className="frame-strip">
            {frames.map((f, i) => (
              <button key={i} className={i === at ? 'frame on' : 'frame'} aria-label={`Frame ${i + 1}`} aria-pressed={i === at} onClick={() => goTo(i)}>
                <MatrixView frame={f} size={44} label={`Frame ${i + 1}`} />
              </button>
            ))}
            <button className="ghost" disabled={frames.length >= MAX_FRAMES} onClick={addFrame}>
              Add frame
            </button>
            {frames.length > 1 && (
              <button className="ghost" onClick={removeFrame}>
                Delete frame
              </button>
            )}
          </div>
          {frames.length > 1 && (
            <div className="row end">
              <label className="field frame-time">
                <span className="label">Each frame: {delay} ms</span>
                <input type="range" min={50} max={1000} step={50} value={delay} onChange={(ev) => setDelay(Number(ev.target.value))} />
              </label>
              <button
                onClick={() => {
                  if (playing) goTo(at);
                  else setPlaying(true);
                }}
              >
                {playing ? 'Stop' : 'Play on matrix'}
              </button>
            </div>
          )}
          <div className="row keep-phone">
            <button
              className="ghost"
              disabled={allEmpty}
              title="The phone keeps it and can show it with no PC: its My Glyph toy, or while the PC is away"
              onClick={() => {
                const label = name.trim() || 'My glyph';
                setKept({ ok: true, text: 'Sending' });
                keepOnPhone(label, frames, delay).then(
                  () => setKept({ ok: true, text: `On the phone as "${label}". Add the My Glyph toy there to show it without the PC.` }),
                  (err) => setKept({ ok: false, text: err instanceof Error ? err.message : String(err) }),
                );
              }}
            >
              Keep on phone
            </button>
            {kept && <span className={kept.ok ? 'muted' : 'warn'}>{kept.text}</span>}
          </div>
          <p className="hint">
            {frames.length === 1
              ? 'Add a frame to turn the drawing into an animation. Each new frame starts as a copy of the one you are on.'
              : `${frames.length} frames, ${((frames.length * delay) / 1000).toFixed(1)} seconds a loop. Save keeps the whole animation.`}
          </p>
        </div>
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
  const [saveName, setSaveName] = useState('');
  const [savedAs, setSavedAs] = useState<string | null>(null);
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
      // The file's own name is a fair first guess at what to call it.
      setSaveName(file.name.replace(/\.[^.]+$/, '').slice(0, 40));
      setSavedAs(null);
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
              <form
                className="save"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const clean = saveName.trim();
                  if (!clean || frames.length === 0) return;
                  // Saved as it looks now, with the fit and contrast chosen above.
                  const fitted = fitFrames(frames, decoded.delays);
                  const image: SavedImage = { name: clean, px: Array.from(fitted.frames[0]!) };
                  if (fitted.frames.length > 1) Object.assign(image, { frames: fitted.frames.map((f) => Array.from(f)), delay: fitted.delay });
                  saveImage(image);
                  setSavedAs(clean);
                }}
              >
                <span className="label">Keep it</span>
                <div className="row">
                  <input aria-label="Name for this picture" value={saveName} onChange={(ev) => setSaveName(ev.target.value)} maxLength={40} placeholder="Name it" />
                  <button type="submit" className="ghost" disabled={!saveName.trim()}>
                    Save
                  </button>
                </div>
                {savedAs && <span className="hint">Saved as "{savedAs}". It is under Saved, and in the island.</span>}
                {animated && frames.length > MAX_FRAMES && <span className="hint">Long animations are saved as {MAX_FRAMES} frames.</span>}
              </form>
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
  { kind: 'play_pause', label: 'Play / pause' },
  { kind: 'next_track', label: 'Next track' },
  { kind: 'previous_track', label: 'Previous track' },
  { kind: 'mute_volume', label: 'Mute sound' },
  { kind: 'mute_mic', label: 'Mute microphone' },
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
  const { buttons, widgets } = bridge.settings;
  const usesNext = Object.values(buttons).some((b) => b.kind === 'next_widget');
  const setBinding = (action: ButtonAction, patch: Partial<{ kind: ActionKind; command: string }>) =>
    updateSettings({ buttons: { ...buttons, [action]: { ...buttons[action], ...patch } } });
  const test = (label: string, binding: (typeof buttons)[ButtonAction]) => {
    setTestResult(null);
    runBinding(binding).then(
      (result) => setTestResult(`${label}: ${result === 'Done' ? 'ran' : result}`),
      (err) => setTestResult(`${label}: ${err instanceof Error ? err.message : String(err)}`),
    );
  };
  const long = buttons.long;
  const live = bridge.connection === 'connected' && bridge.toyActive;

  return (
    <>
      <PageTitle title="Glyph Button" lede="One button on the back of the phone. Your PC on the other end." />
      <section className="card">
        <div className="card-head">
          <h2>Long-press</h2>
          <button className="ghost" disabled={long.kind === 'none'} onClick={() => test('Long-press', long)}>
            Try it now
          </button>
        </div>
        <p className="gb-status">
          <span className={live ? 'dot connected' : 'dot'} aria-hidden="true" />
          {bridge.connection !== 'connected'
            ? 'No phone linked, so the button cannot reach this PC yet.'
            : live
              ? 'The button is live: PC Remote is the selected toy.'
              : 'Not live. On the phone, short-press the Glyph Button until the two-headed arrow shows.'}
        </p>
        <p>Hold the Glyph Button and this PC will:</p>
        <div className="action-grid" role="radiogroup" aria-label="What a long-press does">
          {ACTIONS.map((a) => (
            <button
              key={a.kind}
              role="radio"
              aria-checked={long.kind === a.kind}
              className={long.kind === a.kind ? 'chip on' : 'chip'}
              onClick={() => setBinding('long', { kind: a.kind })}
            >
              {a.label}
            </button>
          ))}
        </div>
        {long.kind === 'command' && (
          <>
            <input
              className="mono gb-command"
              aria-label="Command for a long-press"
              placeholder="e.g. notepad.exe  or  python C:\scripts\deploy.py"
              value={long.command}
              spellCheck={false}
              onChange={(ev) => setBinding('long', { command: ev.target.value })}
            />
            <p className="hint">It runs on this PC with your user account, exactly as typed. Only add one you would run yourself.</p>
          </>
        )}
        {usesNext && (
          <div className="gb-rotation">
            <span className="label">Next widget steps through</span>
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
            <p className="hint">In this order. Ticker and Weather are skipped until they are set up in Widgets.</p>
          </div>
        )}
        {testResult && <p className="mono muted">{testResult}</p>}
        {bridge.lastButton && (
          <p className="mono muted">
            Last press: {bridge.lastButton.action} at {new Date(bridge.lastButton.at).toLocaleTimeString()} · {bridge.lastButton.result}
          </p>
        )}
      </section>

      <details className="more">
        <summary>Set up the phone</summary>
        <p>
          Nothing OS only shares the Glyph Button with the Glyph Toy that is currently selected. On the phone, add the "PC Remote" toy
          (Settings, Glyph Interface, Glyph Toys), then short-press the Glyph Button until its two-headed arrow appears. From then on a
          long-press reaches this PC. A short press is never sent; it moves on to the next toy.
        </p>
      </details>

      <details className="more">
        <summary>Other gestures</summary>
        <p className="hint">
          These fire on every press, including the short presses that switch toys, so they go off by accident. Leave them on "Do nothing"
          unless you have a use for them.
        </p>
        {GESTURES.filter((g) => g.action !== 'long').map(({ action, label, hint }) => {
          const binding = buttons[action];
          return (
            <div key={action} className="binding">
              <div>
                <div>{label}</div>
                <div className="hint">{hint}</div>
              </div>
              <select aria-label={`Action for ${label}`} value={binding.kind} onChange={(ev) => setBinding(action, { kind: ev.target.value as ActionKind })}>
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
                  placeholder="e.g. notepad.exe"
                  value={binding.command}
                  spellCheck={false}
                  onChange={(ev) => setBinding(action, { command: ev.target.value })}
                />
              )}
              <button className="ghost" disabled={binding.kind === 'none'} onClick={() => test(label, binding)}>
                Test
              </button>
            </div>
          );
        })}
      </details>
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
