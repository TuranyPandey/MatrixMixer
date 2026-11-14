/**
 * Widgets mode: a shelf of small live matrices, one per widget. Clicking one
 * puts it on the real matrix (clicking it again takes it off) and opens its
 * options underneath, so there is one widget's worth of controls on screen at
 * a time instead of a page of every option for every widget.
 */
import { useEffect, useRef, useState } from 'react';
import {
  alarmFrame,
  clockFrame,
  formatDuration,
  graphFrame,
  meterFrame,
  renderText,
  spectrumFrame,
  staticTextFrame,
  timerFrame,
  weatherFrame,
  type Frame,
} from '@matrix-bridge/core';
import { clearMatrix, player, updateSettings, useBridge } from './bridge';
import { MatrixView } from './MatrixView';
import { isTauri, systemStats } from './native';
import {
  latestWeather,
  setWeatherPlace,
  showTimer,
  startClock,
  startCountdown,
  startPomodoro,
  startTicker,
  startWeather,
  stopTimer,
  tickerSymbol,
  toggleTimer,
  toggleWidget,
  useTimer,
  type TimerState,
  type WeatherNow,
  type WidgetName,
} from './widgets';

type ShelfId = WidgetName | 'timer';

const SHELF: Array<{ id: ShelfId; name: string; about: string }> = [
  { id: 'clock', name: 'Clock', about: 'The time, big enough to read from across the desk.' },
  { id: 'timer', name: 'Timer', about: 'A Pomodoro or a plain countdown. The ring drains as time runs out; break time is dimmer than focus time.' },
  { id: 'system meter', name: 'System', about: 'Ring and number show CPU load. The bar underneath is memory in use.' },
  { id: 'load graph', name: 'Load', about: 'CPU load over the last 25 seconds as a bar chart, newest on the right.' },
  { id: 'visualiser', name: 'Visualiser', about: 'A spectrum of whatever this PC is playing: bass on the left, treble on the right, with caps that hang on the hits.' },
  { id: 'ticker', name: 'Ticker', about: "Prices scroll past with today's change, refreshed every minute." },
  { id: 'weather', name: 'Weather', about: 'A small picture of the sky with the temperature under it, refreshed every 15 minutes.' },
];

/** A spectrum that looks like music, for the shelf. The real one only runs when shown. */
const SAMPLE_BANDS = [0.5, 0.82, 0.95, 0.7, 0.58, 0.74, 0.46, 0.36, 0.5, 0.3, 0.2, 0.12];

/** What each widget would look like right now, for the shelf. */
function usePreviews(hour12: boolean, timer: TimerState | null, firstSymbol: string | undefined): Record<ShelfId, Frame> {
  const [now, setNow] = useState(() => new Date());
  const [stats, setStats] = useState({ cpu: 0, ram: 0 });
  const history = useRef<number[]>([]);
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const weatherSet = useBridge().settings.widgets.weather;

  useEffect(() => {
    const read = () => {
      setNow(new Date());
      void systemStats()
        .then((s) => {
          history.current = [...history.current, s.cpu].slice(-25);
          setStats(s);
        })
        .catch(() => {});
    };
    read();
    const id = window.setInterval(read, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    void latestWeather()
      .then((w) => alive && setWeather(w))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [weatherSet]);

  return {
    clock: clockFrame(now, hour12),
    timer: !timer
      ? timerFrame(25 * 60 * 0.7, 25 * 60)
      : timer.phase === 'done'
        ? alarmFrame(now.getSeconds())
        : timerFrame(timer.remaining, timer.total, timer.phase === 'break'),
    'system meter': meterFrame(stats.cpu, stats.ram),
    'load graph': graphFrame(history.current),
    visualiser: spectrumFrame(SAMPLE_BANDS, SAMPLE_BANDS),
    ticker: staticTextFrame(renderText((firstSymbol ?? 'BTC').replace(/-USD$|\..*$/, '').slice(0, 4))),
    weather: weather && weatherSet ? weatherFrame(weather.temperature, weather.kind) : weatherFrame(21, 'clear'),
  };
}

export function WidgetsPanel(_: { go: (tab: string) => void }) {
  const bridge = useBridge();
  const timer = useTimer();
  const { widgets } = bridge.settings;
  const hour12 = widgets.hour12;
  const showingId = bridge.playing?.startsWith('widget: ') ? (bridge.playing.slice(8) as ShelfId) : null;
  // Open on whatever is on the matrix, so its options are right there.
  const [picked, setPicked] = useState<ShelfId>(showingId ?? 'clock');
  const [problem, setProblem] = useState<string | null>(null);
  const previews = usePreviews(hour12, timer, widgets.ticker[0]);

  const ready = (id: ShelfId) => (id === 'ticker' ? widgets.ticker.length > 0 : id === 'weather' ? widgets.weather !== null : true);

  /** Starts a widget, or takes it off if it is the one showing. The timer has its own start buttons. */
  const toggle = (id: ShelfId) => {
    setProblem(null);
    if (id === 'timer') {
      // A timer off the matrix keeps counting; this only decides whether it is on show.
      if (showingId === 'timer') clearMatrix();
      else if (timer) showTimer();
      return;
    }
    if (!ready(id) && showingId !== id) return;
    void toggleWidget(id, { hour12 }).then(setProblem, (err) => setProblem(err instanceof Error ? err.message : String(err)));
  };
  const pick = (id: ShelfId) => {
    setPicked(id);
    toggle(id);
  };

  const current = SHELF.find((w) => w.id === picked)!;
  const isShowing = showingId === picked;

  return (
    <>
      <div className="shelf" role="listbox" aria-label="Widgets">
        {SHELF.map((w) => (
          <button
            key={w.id}
            role="option"
            aria-selected={w.id === picked}
            className={`shelf-item${w.id === picked ? ' picked' : ''}${w.id === showingId ? ' on' : ''}`}
            title={w.id === showingId ? `${w.name} is on the matrix. Click to take it off` : `Show ${w.name}`}
            onClick={() => pick(w.id)}
          >
            <MatrixView frame={previews[w.id]} size={78} label={`${w.name} preview`} />
            <span className="shelf-name">{w.name}</span>
          </button>
        ))}
      </div>

      <section className="card widget-detail">
        <div className="card-head">
          <h2>{current.name}</h2>
          {picked !== 'timer' && (
            <button className={isShowing ? 'ghost' : ''} disabled={!isShowing && !ready(picked)} onClick={() => toggle(picked)}>
              {isShowing ? 'Take it off' : 'Show on matrix'}
            </button>
          )}
        </div>
        <p>{current.about}</p>

        {picked === 'clock' && (
          <label className="check">
            <input
              type="checkbox"
              checked={hour12}
              onChange={(ev) => {
                updateSettings({ widgets: { ...widgets, hour12: ev.target.checked } });
                if (showingId === 'clock') startClock(ev.target.checked);
              }}
            />
            12-hour
          </label>
        )}
        {picked === 'timer' && <TimerOptions timer={timer} />}
        {picked === 'system meter' && !isTauri && <p className="hint">Running in a browser, so these numbers are made up. The desktop app reads real ones.</p>}
        {picked === 'visualiser' && (
          <p className="hint">It scales itself to the volume, so quiet playback still moves. The sound is analysed as it plays and never stored.</p>
        )}
        {picked === 'ticker' && <TickerOptions />}
        {picked === 'weather' && <WeatherOptions showing={isShowing} report={setProblem} />}
        {problem && <p className="warn">{problem}</p>}
      </section>
    </>
  );
}

function NumberField(props: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className="field">
      <span className="label">{props.label}</span>
      <input
        className="short"
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(ev) => props.onChange(Math.max(props.min, Math.min(props.max, Math.round(Number(ev.target.value)) || props.min)))}
      />
    </label>
  );
}

function TimerOptions({ timer }: { timer: TimerState | null }) {
  const [focus, setFocus] = useState(25);
  const [rest, setRest] = useState(5);
  const [minutes, setMinutes] = useState(10);

  if (timer) {
    return (
      <>
        <p className="big mono">{formatDuration(timer.remaining)}</p>
        <p className="muted">
          {timer.phase === 'done'
            ? "Time's up."
            : timer.kind === 'countdown'
              ? 'Countdown'
              : `${timer.phase === 'focus' ? 'Focus' : 'Break'} · ${timer.rounds} focus ${timer.rounds === 1 ? 'session' : 'sessions'} done`}
          {!timer.running && timer.phase !== 'done' ? ' · paused' : ''}
        </p>
        <div className="row">
          {timer.phase !== 'done' && <button onClick={toggleTimer}>{timer.running ? 'Pause' : 'Resume'}</button>}
          <button className="ghost" onClick={stopTimer}>
            {timer.phase === 'done' ? 'Dismiss' : 'Stop timer'}
          </button>
        </div>
      </>
    );
  }
  return (
    <div className="pair">
      <div>
        <span className="label">Pomodoro</span>
        <div className="row end">
          <NumberField label="Focus (min)" value={focus} min={1} max={180} onChange={setFocus} />
          <NumberField label="Break (min)" value={rest} min={1} max={60} onChange={setRest} />
          <button onClick={() => startPomodoro(focus, rest)}>Start</button>
        </div>
      </div>
      <div>
        <span className="label">Countdown</span>
        <div className="row end">
          <NumberField label="Minutes" value={minutes} min={1} max={600} onChange={setMinutes} />
          <button className="ghost" onClick={() => startCountdown(minutes)}>
            Start
          </button>
        </div>
      </div>
    </div>
  );
}

function TickerOptions() {
  const { widgets } = useBridge().settings;
  const [symbol, setSymbol] = useState('');
  const parsed = tickerSymbol(symbol);
  const save = (ticker: string[]) => {
    updateSettings({ widgets: { ...widgets, ticker } });
    // Already scrolling: pick the change up now rather than at the next refresh.
    if (player.label === 'widget: ticker' && ticker.length > 0) void startTicker();
  };
  return (
    <>
      <form
        className="row end"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!parsed) return;
          save([...widgets.ticker.filter((s) => s !== parsed), parsed].slice(-8));
          setSymbol('');
        }}
      >
        <label className="field grow">
          <span className="label">Add a symbol</span>
          <input value={symbol} onChange={(ev) => setSymbol(ev.target.value)} placeholder="AAPL, BTC, RELIANCE.NS" spellCheck={false} />
        </label>
        <button type="submit" className="ghost" disabled={!parsed}>
          Add
        </button>
      </form>
      <div className="row wrap">
        {widgets.ticker.length === 0 && <span className="muted">No symbols yet. Add one to start the ticker.</span>}
        {widgets.ticker.map((s) => (
          <button key={s} className="chip" title={`Remove ${s}`} onClick={() => save(widgets.ticker.filter((x) => x !== s))}>
            {s} ×
          </button>
        ))}
      </div>
      <p className="hint">Prices come from Yahoo Finance's public quote feed, which is unofficial and can be delayed. Not for trading on.</p>
    </>
  );
}

function WeatherOptions({ showing, report }: { showing: boolean; report: (problem: string | null) => void }) {
  const { widgets } = useBridge().settings;
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const fahrenheit = widgets.weather?.fahrenheit ?? false;
  const run = (job: () => Promise<string | null>) => {
    setBusy(true);
    job()
      .then(report, (err) => report(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <form
        className="row end"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (place.trim()) run(async () => (await setWeatherPlace(place, fahrenheit)) ?? (setPlace(''), startWeather()));
        }}
      >
        <label className="field grow">
          <span className="label">{widgets.weather ? `Place: ${widgets.weather.place}` : 'Town or city'}</span>
          <input value={place} onChange={(ev) => setPlace(ev.target.value)} placeholder={widgets.weather ? 'Change it' : 'London'} />
        </label>
        <button type="submit" className="ghost" disabled={busy || !place.trim()}>
          {busy ? 'Looking' : 'Set place'}
        </button>
      </form>
      <label className="check">
        <input
          type="checkbox"
          checked={fahrenheit}
          disabled={!widgets.weather}
          onChange={(ev) => {
            if (!widgets.weather) return;
            updateSettings({ widgets: { ...widgets, weather: { ...widgets.weather, fahrenheit: ev.target.checked } } });
            if (showing) run(startWeather);
          }}
        />
        Fahrenheit
      </label>
      <p className="hint">Weather from Open-Meteo. The town you type is sent to them to look it up.</p>
    </>
  );
}
