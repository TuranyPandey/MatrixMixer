import { useEffect, useState } from 'react';
import { setProgress, useActivity } from './activities';
import { useBridge } from './bridge';
import { notify, parseRepo, updateConnectors, useConnectors } from './connectors';
import { apiInfo, isTauri } from './native';
import { PageTitle } from './panels';

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function Connector(props: { title: string; on: boolean; onToggle: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{props.title}</h2>
        <label className="switch-label">
          <span className={props.on ? 'ok' : 'muted'}>{props.on ? 'On' : 'Off'}</span>
          <input
            type="checkbox"
            className="switch"
            checked={props.on}
            aria-label={`${props.title} connector`}
            onChange={(ev) => props.onToggle(ev.target.checked)}
          />
        </label>
      </div>
      {props.children}
    </section>
  );
}

export function ConnectorsPanel(_: { go: (tab: string) => void }) {
  const { connectors } = useBridge().settings;
  const live = useConnectors();
  const { github, battery, onair, music, calendar, game } = connectors;
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

  return (
    <>
      <PageTitle title="Connectors" lede="Things that reach the matrix on their own, then hand it back." />

      <Connector title="GitHub" on={github.enabled} onToggle={(enabled) => setGithub({ enabled })}>
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

      <Connector title="PC battery" on={battery.enabled} onToggle={(enabled) => setBattery({ enabled })}>
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

      <Connector title="On air" on={onair.enabled} onToggle={(enabled) => setOnair({ enabled })}>
        <p>The whole ring lights and breathes while an app is using your microphone or camera, so people behind you can tell you are in a call.</p>
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
              : `Right now: microphone ${activity.onAir.mic ? 'in use' : 'free'}, camera ${activity.onAir.camera ? 'in use' : 'free'}. Checked every 3 seconds.`}
        </p>
      </Connector>

      <Connector title="Now playing" on={music.enabled} onToggle={(enabled) => updateConnectors({ music: { enabled } })}>
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

      <Connector title="Calendar" on={calendar.enabled} onToggle={(enabled) => setCalendar({ enabled })}>
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

      <Connector
        title="Game HUD"
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

      <section className="card">
        <h2>Your own scripts</h2>
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
          Unlike "matrix send", a notice passes once and then gives the matrix back to whatever was showing. Install the
          command from the Developer tab.
        </p>
      </section>

      <section className="card">
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
    </>
  );
}
