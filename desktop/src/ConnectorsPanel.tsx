import { createContext, useContext, useEffect, useState } from 'react';
import { setProgress, useActivity } from './activities';
import { useBridge } from './bridge';
import { notify, parseRepo, updateConnectors, useConnectors } from './connectors';
import { apiInfo, isTauri } from './native';
import { DESIGNS, ICONS, countdownFrame, gameFrame, onAirFrame, progressFrame, type Frame } from '@matrix-bridge/core';
import { MatrixView } from './MatrixView';
import { PageTitle } from './panels';

/**
 * What each connector puts on the matrix, for the shelf. The real frame where
 * the connector has one (the on-air ring, the meeting disk, the game HUD, the
 * progress ring); a small picture where it only ever sends words.
 */
const PREVIEWS: Array<{ title: string; label: string; frame: Frame }> = [
  { title: 'GitHub', label: 'GitHub', frame: ICONS.branch },
  { title: 'PC battery', label: 'Battery', frame: ICONS.battery },
  { title: 'On air', label: 'On air', frame: onAirFrame('MIC', 0) },
  { title: 'Now playing', label: 'Playing', frame: DESIGNS.find((d) => d.name === 'Note')!.frame },
  { title: 'Calendar', label: 'Calendar', frame: countdownFrame(0.7) },
  { title: 'Reminder', label: 'Reminder', frame: ICONS.bell },
  { title: 'Game HUD', label: 'Game', frame: gameFrame(72, 0.6) },
  { title: 'Your scripts', label: 'Scripts', frame: progressFrame(42) },
];

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Which connector is picked on the shelf. Only that one's details are on the page. */
const Picked = createContext<string>('');

/**
 * The details of one connector: its switch, what it sees right now, and its
 * options. Renders nothing unless it is the one picked on the shelf.
 */
function Connector(props: { title: string; summary: string; on?: boolean; onToggle?: (on: boolean) => void; children: React.ReactNode }) {
  if (useContext(Picked) !== props.title) return null;
  return (
    <section className="card widget-detail">
      <div className="card-head">
        <h2>{props.title}</h2>
        {props.onToggle && (
          <label className="switch-label">
            <span className={props.on ? 'ok' : 'muted'}>{props.on ? 'On' : 'Off'}</span>
            <input
              type="checkbox"
              className="switch"
              checked={props.on ?? false}
              aria-label={`${props.title} connector`}
              onChange={(ev) => props.onToggle!(ev.target.checked)}
            />
          </label>
        )}
      </div>
      {props.on && (
        <p className="conn-now">
          <span className="dot connected" aria-hidden="true" />
          {props.summary}
        </p>
      )}
      {props.children}
    </section>
  );
}

export function ConnectorsPanel(_: { go: (tab: string) => void }) {
  const { connectors } = useBridge().settings;
  const live = useConnectors();
  const { github, battery, onair, music, calendar, reminder, game } = connectors;
  const [word, setWord] = useState(reminder.text);
  const activity = useActivity();
  const [repo, setRepo] = useState('');
  const [link, setLink] = useState(calendar.url);
  const [port, setPort] = useState(8766);
  useEffect(() => void apiInfo().then((info) => info && info.port !== 0 && setPort(info.port)), []);
  const setOnair = (patch: Partial<typeof onair>) => updateConnectors({ onair: { ...onair, ...patch } });
  const setCalendar = (patch: Partial<typeof calendar>) => updateConnectors({ calendar: { ...calendar, ...patch } });
  const linkOk = /^https:\/\/\S+$/.test(link.trim().replace(/^webcal:/i, 'https:'));
  const parsed = parseRepo(repo);

  const setGithub = (patch: Partial<typeof github>) => updateConnectors({ github: { ...github, ...patch } });
  const setBattery = (patch: Partial<typeof battery>) => updateConnectors({ battery: { ...battery, ...patch } });
  const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Off: what it would do. On: what it sees right now.
  const summary = {
    github: !github.enabled
      ? 'Pushes and check results from repositories you watch'
      : github.repos.length === 0
        ? 'Add a repository to watch'
        : `Watching ${github.repos.length === 1 ? github.repos[0] : `${github.repos.length} repositories`}`,
    battery: !battery.enabled
      ? 'A warning when this PC runs low, and when it is full again'
      : !live.battery.supported
        ? 'This PC does not report a battery'
        : live.battery.level === null
          ? 'Reading the battery'
          : `${live.battery.level}%, ${live.battery.charging ? 'plugged in' : 'on battery'}. Warns at ${battery.low}%`,
    onair: !onair.enabled
      ? 'The ring lights while your microphone or camera is in use'
      : activity.onAir.camera
        ? 'Camera in use'
        : activity.onAir.mic
          ? activity.onAir.muted
            ? 'Microphone in use, muted'
            : 'Microphone in use'
          : 'Nothing in use right now',
    music: !music.enabled
      ? 'The title passes by when a new track starts'
      : activity.track?.title
        ? `${activity.track.playing ? 'Playing' : 'Paused'}: ${activity.track.title}`
        : 'Nothing is playing',
    calendar: !calendar.enabled
      ? 'A heads-up before each meeting'
      : !calendar.url
        ? 'Add your calendar link'
        : activity.calendar.error
          ? 'Could not read the calendar'
          : activity.calendar.next
            ? `Next: ${activity.calendar.next.title} at ${clock(activity.calendar.next.start)}`
            : 'Nothing in the next 24 hours',
    reminder: !reminder.enabled ? 'A word that passes every so often: STRETCH, WATER' : `${reminder.text} every ${reminder.every} minutes`,
    game: !game.enabled ? 'Health and ammo from Counter-Strike 2' : activity.gameAt ? `Last update at ${time(activity.gameAt)}` : 'Waiting for the game',
  };

  const isOn: Record<string, boolean> = {
    GitHub: github.enabled,
    'PC battery': battery.enabled,
    'On air': onair.enabled,
    'Now playing': music.enabled,
    Calendar: calendar.enabled,
    Reminder: reminder.enabled,
    'Game HUD': game.enabled,
  };
  // Open on something that is switched on, so its live reading is the first thing seen.
  const [picked, setPicked] = useState(() => PREVIEWS.find((p) => isOn[p.title])?.title ?? PREVIEWS[0]!.title);
  const running = PREVIEWS.filter((p) => isOn[p.title]).length;

  return (
    <Picked.Provider value={picked}>
      <PageTitle title="Connectors" lede="Things that reach the matrix on their own, then hand it back." />
      <div className="shelf conn-shelf" role="listbox" aria-label="Connectors">
        {PREVIEWS.map((p) => (
          <button
            key={p.title}
            role="option"
            aria-selected={p.title === picked}
            className={`shelf-item${p.title === picked ? ' picked' : ''}${isOn[p.title] ? ' on' : ' off'}`}
            title={p.title in isOn ? `${p.title}: ${isOn[p.title] ? 'on' : 'off'}` : p.title}
            onClick={() => setPicked(p.title)}
          >
            <MatrixView frame={p.frame} size={78} label={`What ${p.title} puts on the matrix`} />
            <span className="shelf-name">{p.label}</span>
          </button>
        ))}
      </div>
      <p className="conn-lede">
        These reach the matrix on their own, then hand it back. {running === 0 ? 'None is switched on yet.' : `${running} switched on, ringed in red.`}
      </p>

      <Connector title="GitHub" summary={summary.github} on={github.enabled} onToggle={(enabled) => setGithub({ enabled })}>
        <p>
          The ring blinks and a line scrolls past when someone pushes to a repository you watch, or when its checks pass or
          fail. Checked once a minute.
        </p>
        <form
          className="row end"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!parsed) return;
            setGithub({ repos: [...github.repos.filter((r) => r !== parsed), parsed], enabled: true });
            setRepo('');
          }}
        >
          <label className="field grow">
            <span className="label">Repository</span>
            <input value={repo} onChange={(ev) => setRepo(ev.target.value)} placeholder="owner/repo, or paste its link" spellCheck={false} />
          </label>
          <button type="submit" disabled={!parsed}>
            Watch
          </button>
        </form>
        {github.repos.length === 0 ? (
          <p className="muted">Not watching anything yet.</p>
        ) : (
          <ul className="list">
            {github.repos.map((r) => (
              <li key={r}>
                <span className="mono">{r}</span>
                <button className="link danger" onClick={() => setGithub({ repos: github.repos.filter((x) => x !== r) })}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row wrap">
          <label className="check">
            <input type="checkbox" checked={github.pushes} onChange={(ev) => setGithub({ pushes: ev.target.checked })} />
            Pushes and merges
          </label>
          <label className="check">
            <input type="checkbox" checked={github.ci} onChange={(ev) => setGithub({ ci: ev.target.checked })} />
            Checks passing or failing
          </label>
        </div>
        {live.github.error && <p className="warn">{live.github.error}</p>}
        <p className="hint">
          {github.enabled && github.repos.length > 0
            ? live.github.checkedAt
              ? `Last checked at ${time(live.github.checkedAt)}. Only things that happen from now on are shown.`
              : 'Checking for the first time.'
            : 'Switched off.'}{' '}
          {isTauri
            ? 'Uses the GitHub CLI you are logged in to, so private repositories work.'
            : 'Running in a browser: public repositories only.'}
        </p>
        <button className="ghost" onClick={() => notify('GitHub', 'MATRIXMIXER: OCTOCAT PUSHED TO MAIN')}>
          Show a sample
        </button>
      </Connector>

      <Connector title="PC battery" summary={summary.battery} on={battery.enabled} onToggle={(enabled) => setBattery({ enabled })}>
        <p>A heads-up when this PC's battery runs low, and another when it is full again.</p>
        <div className="row end">
          <label className="field">
            <span className="label">Warn at</span>
            <select value={battery.low} onChange={(ev) => setBattery({ low: Number(ev.target.value) })}>
              {[10, 15, 20, 30].map((n) => (
                <option key={n} value={n}>
                  {n}%
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="hint">
          {!live.battery.supported
            ? 'This PC does not report a battery.'
            : live.battery.level === null
              ? 'Reading the battery.'
              : `Right now: ${live.battery.level}%, ${live.battery.charging ? 'plugged in' : 'on battery'}.`}
        </p>
      </Connector>

      <Connector title="On air" summary={summary.onair} on={onair.enabled} onToggle={(enabled) => setOnair({ enabled })}>
        <p>The whole ring lights and breathes while an app is using your microphone or camera, so people behind you can tell you are in a call. Mute the microphone and it holds still and reads MUTED.</p>
        <div className="row wrap">
          <label className="check">
            <input type="checkbox" checked={onair.mic} onChange={(ev) => setOnair({ mic: ev.target.checked })} />
            Microphone
          </label>
          <label className="check">
            <input type="checkbox" checked={onair.camera} onChange={(ev) => setOnair({ camera: ev.target.checked })} />
            Camera
          </label>
        </div>
        <p className="hint">
          {!isTauri
            ? 'Needs the desktop app on Windows.'
            : !onair.enabled
              ? 'Switched off.'
              : `Right now: microphone ${activity.onAir.mic ? (activity.onAir.muted ? 'in use, muted' : 'in use') : 'free'}, camera ${activity.onAir.camera ? 'in use' : 'free'}. Checked every 3 seconds.`}
        </p>
        <p className="hint">
          MUTED follows the microphone switch in Windows, which the Glyph Button can flip ("Mute microphone"). It cannot see the mute
          button inside Teams, Zoom or Discord.
        </p>
      </Connector>

      <Connector title="Now playing" summary={summary.music} on={music.enabled} onToggle={(enabled) => updateConnectors({ music: { enabled } })}>
        <p>The title and artist pass by once whenever a new track starts, from Spotify, a browser tab or any player Windows knows about.</p>
        <p className="hint">
          {!isTauri
            ? 'Needs the desktop app on Windows.'
            : !music.enabled
              ? 'Switched off.'
              : activity.track?.title
                ? `${activity.track.playing ? 'Playing' : 'Paused'}: ${activity.track.title}${activity.track.artist ? ` - ${activity.track.artist}` : ''}`
                : 'Nothing is playing.'}{' '}
          For bars that move with the sound, see Visualiser on the Widgets tab.
        </p>
      </Connector>

      <Connector title="Calendar" summary={summary.calendar} on={calendar.enabled} onToggle={(enabled) => setCalendar({ enabled })}>
        <p>A heads-up before each event, and another when it starts. Works with the private .ics link from Google Calendar, Outlook or iCloud.</p>
        <form
          className="row end"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (linkOk) setCalendar({ url: link.trim().replace(/^webcal:/i, 'https:'), enabled: true });
          }}
        >
          <label className="field grow">
            <span className="label">Calendar link (.ics)</span>
            <input value={link} onChange={(ev) => setLink(ev.target.value)} placeholder="https://calendar.google.com/calendar/ical/.../basic.ics" spellCheck={false} />
          </label>
          <label className="field">
            <span className="label">Warn</span>
            <select value={calendar.lead} onChange={(ev) => setCalendar({ lead: Number(ev.target.value) })}>
              {[5, 10, 15, 30].map((n) => (
                <option key={n} value={n}>
                  {n} min before
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={!linkOk || link.trim() === calendar.url}>
            Save
          </button>
        </form>
        <label className="check">
          <input type="checkbox" checked={calendar.countdown} onChange={(ev) => setCalendar({ countdown: ev.target.checked })} />
          Then count down to it: a disk that drains until the meeting starts
        </label>
        {activity.calendar.error && <p className="warn">{activity.calendar.error}</p>}
        <p className="hint">
          {!calendar.enabled || !calendar.url
            ? 'In Google Calendar: Settings, your calendar, "Secret address in iCal format". Anyone with that link can read the calendar, so it stays on this PC.'
            : activity.calendar.checkedAt === null
              ? 'Reading the calendar.'
              : activity.calendar.next
                ? `Next: ${activity.calendar.next.title} at ${new Date(activity.calendar.next.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Re-read every 10 minutes.`
                : 'Nothing in the next 24 hours. Re-read every 10 minutes.'}
        </p>
      </Connector>

      <Connector title="Reminder" summary={summary.reminder} on={reminder.enabled} onToggle={(enabled) => updateConnectors({ reminder: { ...reminder, enabled } })}>
        <p>A word passes over the matrix every so often, for the things a screen full of work makes you forget.</p>
        <form
          className="row end"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (word.trim()) updateConnectors({ reminder: { ...reminder, text: word.trim().toUpperCase().slice(0, 24) } });
          }}
        >
          <label className="field grow">
            <span className="label">Say</span>
            <input value={word} onChange={(ev) => setWord(ev.target.value)} placeholder="STRETCH, WATER, LOOK AWAY" maxLength={24} />
          </label>
          <label className="field">
            <span className="label">Every</span>
            <select value={reminder.every} onChange={(ev) => updateConnectors({ reminder: { ...reminder, every: Number(ev.target.value) } })}>
              {[20, 30, 45, 60, 90, 120].map((n) => (
                <option key={n} value={n}>
                  {n} min
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={!word.trim() || word.trim().toUpperCase() === reminder.text}>
            Save
          </button>
        </form>
        <p className="hint">
          {reminder.enabled
            ? `${reminder.text} every ${reminder.every} minutes, counted from when it was switched on or changed.`
            : 'Switched off. For a one-off, use the countdown in Widgets, Timer.'}
        </p>
      </Connector>

      <Connector
        title="Game HUD"
        summary={summary.game}
        on={game.enabled}
        onToggle={(enabled) => updateConnectors({ game: { enabled, token: game.token || crypto.randomUUID().replace(/-/g, '') } })}
      >
        <p>Counter-Strike 2 can report your health and ammo as you play. The ring shows health, the bar shows what is left in the clip.</p>
        {game.enabled && (
          <>
            <p>
              Save this as <span className="mono">gamestate_integration_matrixbridge.cfg</span> in the game's <span className="mono">game/csgo/cfg</span>{' '}
              folder, then restart the game:
            </p>
            <pre>{`"MatrixMixer"
{
  "uri" "http://127.0.0.1:${port}/game"
  "timeout" "1.0"
  "throttle" "0.2"
  "auth" { "token" "${game.token}" }
  "data" { "player_state" "1" "player_weapons" "1" }
}`}</pre>
          </>
        )}
        <p className="hint">
          {!game.enabled
            ? 'Switched off.'
            : activity.gameAt
              ? `Last update from the game at ${time(activity.gameAt)}.`
              : 'Nothing from the game yet. Not tried against the real game: tell us how it goes.'}
        </p>
      </Connector>

      <Connector title="Your scripts" summary="Light the matrix from any command: a build, a download, a test run">
        <p>Anything that can run a command can light the matrix when it finishes: a build, a download, a test run.</p>
        <pre>{`npm test && matrix notify "TESTS PASSED" || matrix notify "TESTS FAILED"`}</pre>
        <p>For long jobs, fill the ring as you go. Reaching 100 says DONE and hands the matrix back.</p>
        <pre>{`matrix progress 42 BUILD
matrix progress done`}</pre>
        <div className="row">
          <button
            className="ghost"
            onClick={() => {
              let value = 0;
              const step = () => {
                setProgress(value, 'SAMPLE');
                if (value < 100) setTimeout(step, 300);
                value += 10;
              };
              step();
            }}
            disabled={activity.progress !== null}
          >
            Show a sample ring
          </button>
          {activity.progress && <span className="muted">{Math.round(activity.progress.value)}%</span>}
        </div>
        <p className="hint">
          Unlike "matrix send", a notice passes once and then gives the matrix back to whatever was showing. The
          "matrix" command is set up on the Developer page: switch it on under Settings, Desktop.
        </p>
      </Connector>

      <section className="card conn-recent">
        <h2>Recent</h2>
        {live.recent.length === 0 ? (
          <p className="muted">Nothing yet this session.</p>
        ) : (
          <ul className="list">
            {live.recent.map((n) => (
              <li key={`${n.at}-${n.text}`}>
                <span>
                  <span className="mono">{n.text}</span>
                </span>
                <span className="hint">
                  {n.from} · {time(n.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Picked.Provider>
  );
}
