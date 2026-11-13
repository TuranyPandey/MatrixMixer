import { useState } from 'react';
import { useBridge } from './bridge';
import { notify, parseRepo, updateConnectors, useConnectors } from './connectors';
import { isTauri } from './native';
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
  const { github, battery } = connectors;
  const [repo, setRepo] = useState('');
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
        <button className="ghost" onClick={() => notify('GitHub', 'MATRIXBRIDGE: OCTOCAT PUSHED TO MAIN')}>
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

      <section className="card">
        <h2>Your own scripts</h2>
        <p>Anything that can run a command can light the matrix when it finishes: a build, a download, a test run.</p>
        <pre>{`npm test && matrix notify "TESTS PASSED" || matrix notify "TESTS FAILED"`}</pre>
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
