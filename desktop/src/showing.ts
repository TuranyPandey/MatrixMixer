/**
 * Turns the player's label ("text: HELLO", "widget: clock", "notice: ...")
 * into something to show people: a short kind and the detail.
 * Shared by the main window and the island, so it must not import bridge.ts.
 */
export type Showing = { kind: string; detail: string };

const WIDGET_NAMES: Record<string, string> = {
  clock: 'Clock',
  'system meter': 'System meter',
  'load graph': 'Load graph',
  visualiser: 'Visualiser',
  ticker: 'Ticker',
  weather: 'Weather',
  timer: 'Timer',
};

export function describeShowing(label: string | null): Showing | null {
  if (!label) return null;
  const at = label.indexOf(': ');
  if (at < 0) return { kind: 'Showing', detail: capitalise(label) };
  const kind = label.slice(0, at);
  const detail = label.slice(at + 2);
  if (kind === 'widget') return { kind: 'Widget', detail: WIDGET_NAMES[detail] ?? capitalise(detail) };
  return { kind: capitalise(kind), detail };
}

/** One line, for tight spaces like the island's resting pill. */
export function showingLine(label: string | null): string | null {
  const s = describeShowing(label);
  if (!s) return null;
  return s.kind === 'Widget' || s.kind === 'Text' ? s.detail : `${s.kind}: ${s.detail}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
