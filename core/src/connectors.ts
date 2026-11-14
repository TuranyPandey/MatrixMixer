/**
 * Connectors: things that reach the matrix on their own (a push on GitHub, a
 * finished build, a low battery). This file holds the parts that need no
 * network or window, so they can be tested: what a notice looks like, and how
 * to tell what is new on GitHub between two polls.
 */
import { fitsWithoutScrolling, renderText, scrollFrame, scrollLength, staticTextFrame } from './font';
import { blankFrame, setPixel, type Frame } from './frame';
import { stepMs, type Source } from './player';
import { RING } from './widgets';

/**
 * A short notice: the outer ring blinks twice to catch the eye, then the text
 * passes once. Finite, so it suits `Player.notify`.
 */
export function noticeSource(text: string, speedMs: number | (() => number) = 45): Source {
  const strip = renderText(text);
  const still = fitsWithoutScrolling(strip) ? staticTextFrame(strip) : null;
  // Text that fits is held for about three seconds instead of scrolling.
  const length = still ? Math.round(3000 / stepMs(speedMs)) : scrollLength(strip);
  const ring = blankFrame();
  RING.forEach(([x, y]) => setPixel(ring, x, y, 255));
  const dark = blankFrame();
  const blink: Frame[] = [ring, ring, ring, dark, dark, ring, ring, ring, dark, dark];
  return {
    label: `notice: ${text}`,
    get intervalMs() {
      return stepMs(speedMs);
    },
    next: (tick) => {
      if (tick < blink.length) return blink[tick]!;
      const step = tick - blink.length;
      if (step >= length) return null;
      return still ?? scrollFrame(strip, step);
    },
  };
}

// ---- GitHub -----------------------------------------------------------------------

/** One entry of `GET /repos/{owner}/{repo}/activity`. */
export type GithubActivity = {
  id: number;
  ref?: string | null;
  activity_type?: string | null;
  actor?: { login?: string | null } | null;
};

/** One entry of `workflow_runs` from `GET /repos/{owner}/{repo}/actions/runs`. */
export type GithubRun = {
  id: number;
  name?: string | null;
  head_branch?: string | null;
  status?: string | null;
  conclusion?: string | null;
};

/** What has already been seen for one repository. */
export type GithubSnapshot = { activity: number[]; runs: number[] };

export type GithubWatch = { pushes: boolean; ci: boolean };

const REMEMBER = 400;

function branchOf(ref: string | null | undefined): string {
  return (ref ?? '').replace(/^refs\/(heads|tags)\//, '') || '?';
}

function activityText(item: GithubActivity): string | null {
  const who = item.actor?.login || 'SOMEONE';
  const branch = branchOf(item.ref);
  switch (item.activity_type) {
    case 'push':
      return `${who} PUSHED TO ${branch}`;
    case 'force_push':
      return `${who} FORCE-PUSHED ${branch}`;
    case 'pr_merge':
    case 'merge_queue_merge':
      return `${who} MERGED INTO ${branch}`;
    case 'branch_creation':
      return `${who} CREATED ${branch}`;
    case 'branch_deletion':
      return `${who} DELETED ${branch}`;
    default:
      return null;
  }
}

function runText(run: GithubRun): string | null {
  const name = run.name || 'CI';
  const where = run.head_branch ? ` ON ${run.head_branch}` : '';
  switch (run.conclusion) {
    case 'success':
      return `${name} PASSED${where}`;
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return `${name} FAILED${where}`;
    default:
      return null; // cancelled, skipped, neutral: nobody needs a light for those
  }
}

/**
 * Compares a fresh poll with what was seen before and words whatever is new.
 * The first poll of a repository (`before` is null) only takes stock, so
 * starting the app does not replay old history.
 */
export function githubNews(
  repo: string,
  before: GithubSnapshot | null,
  activity: GithubActivity[],
  runs: GithubRun[],
  watch: GithubWatch = { pushes: true, ci: true },
): { snapshot: GithubSnapshot; messages: string[] } {
  const finished = runs.filter((run) => run.status === 'completed');
  const merge = (old: number[], fresh: number[]) => [...new Set([...old, ...fresh])].slice(-REMEMBER);
  const snapshot: GithubSnapshot = {
    activity: merge(before?.activity ?? [], activity.map((a) => a.id)),
    runs: merge(before?.runs ?? [], finished.map((r) => r.id)),
  };
  if (!before) return { snapshot, messages: [] };

  const name = (repo.split('/').pop() ?? repo).toUpperCase();
  const seenActivity = new Set(before.activity);
  const seenRuns = new Set(before.runs);
  const texts: (string | null)[] = [];
  // GitHub lists newest first; tell the story in the order it happened.
  if (watch.pushes) for (const a of [...activity].reverse()) if (!seenActivity.has(a.id)) texts.push(activityText(a));
  if (watch.ci) for (const r of [...finished].reverse()) if (!seenRuns.has(r.id)) texts.push(runText(r));
  const messages = texts.filter((t): t is string => t !== null).map((t) => `${name}: ${t.toUpperCase()}`);
  return { snapshot, messages };
}
