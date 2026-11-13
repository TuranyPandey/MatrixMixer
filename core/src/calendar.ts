/**
 * Just enough iCalendar to answer "what starts soon?" from the private .ics
 * link that Google Calendar, Outlook and iCloud all offer.
 *
 * Covered: single events, all-day events, and DAILY / WEEKLY / MONTHLY / YEARLY
 * repeats with INTERVAL, BYDAY (weekly), UNTIL, COUNT and EXDATE.
 * Not covered: "second Tuesday" style rules (those events are skipped), and one
 * moved instance of a repeating event is also still announced at its old time.
 */

export type CalendarEvent = { title: string; start: number; allDay: boolean };

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };
type Stamp = { wall: Wall; zone: string; allDay: boolean };

const DAY = 86_400_000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function unescapeText(text: string): string {
  return text.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

/** `zone` comes back as "utc", "local" or a zone name such as Asia/Kolkata. */
function parseStamp(params: string, value: string): Stamp | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const wall = { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0) };
  const tzid = /TZID=([^;:]+)/i.exec(params)?.[1]?.replace(/^"|"$/g, '');
  return { wall, zone: m[7] ? 'utc' : (tzid ?? 'local'), allDay: m[4] === undefined };
}

/** The UTC instant at which clocks in `zone` read `wall`. */
function toInstant(wall: Wall, zone: string): number {
  const asUtc = Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s);
  if (zone === 'utc') return asUtc;
  if (zone !== 'local') {
    try {
      const format = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
      const readIn = (instant: number) => {
        const p: Record<string, number> = {};
        for (const part of format.formatToParts(new Date(instant))) if (part.type !== 'literal') p[part.type] = +part.value;
        return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
      };
      // Two rounds settle it even across a daylight-saving change.
      let guess = asUtc - (readIn(asUtc) - asUtc);
      guess = asUtc - (readIn(guess) - guess);
      return guess;
    } catch {
      /* a zone name this machine does not know (Outlook's "India Standard Time"): treat as local time */
    }
  }
  return new Date(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s).getTime();
}

type Rule = { freq: string; interval: number; byDay: string[] | null; until: number | null; count: number | null };

function parseRule(value: string, zone: string): Rule | null {
  const parts = new Map(value.split(';').map((kv) => kv.split('=') as [string, string]));
  const freq = parts.get('FREQ') ?? '';
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const byDay = parts.get('BYDAY')?.split(',') ?? null;
  // "2TU", "-1FR" and friends, or lists by month day and the like: not understood, so do not guess.
  if (byDay && (freq !== 'WEEKLY' || byDay.some((d) => !WEEKDAYS.includes(d)))) return null;
  if (['BYMONTHDAY', 'BYSETPOS', 'BYMONTH', 'BYYEARDAY', 'BYWEEKNO'].some((key) => parts.has(key))) return null;
  const untilStamp = parts.has('UNTIL') ? parseStamp('', parts.get('UNTIL')!) : null;
  const until = untilStamp
    ? toInstant(untilStamp.allDay ? { ...untilStamp.wall, h: 23, mi: 59, s: 59 } : untilStamp.wall, untilStamp.zone === 'utc' ? 'utc' : zone)
    : null;
  const count = parts.has('COUNT') ? Math.max(1, parseInt(parts.get('COUNT')!, 10) || 1) : null;
  return { freq, interval: Math.max(1, parseInt(parts.get('INTERVAL') ?? '1', 10) || 1), byDay, until, count };
}

/** Whole-day number of a calendar date, for counting days between dates. */
const dayNumber = (y: number, mo: number, d: number) => Math.round(Date.UTC(y, mo - 1, d) / DAY);

/** Does the rule put an occurrence on day `n`, for an event first held on `first`? */
function fallsOn(rule: Rule, first: Wall, n: number): boolean {
  const n0 = dayNumber(first.y, first.mo, first.d);
  if (n < n0) return false;
  const date = new Date(n * DAY);
  switch (rule.freq) {
    case 'DAILY':
      return (n - n0) % rule.interval === 0;
    case 'WEEKLY': {
      const days = rule.byDay ?? [WEEKDAYS[new Date(n0 * DAY).getUTCDay()]!];
      if (!days.includes(WEEKDAYS[date.getUTCDay()]!)) return false;
      // Weeks are counted from their Sunday.
      const week = (day: number) => Math.floor((day - new Date(day * DAY).getUTCDay()) / 7);
      return (week(n) - week(n0)) % rule.interval === 0;
    }
    case 'MONTHLY': {
      if (date.getUTCDate() !== first.d) return false;
      const months = (date.getUTCFullYear() - first.y) * 12 + (date.getUTCMonth() + 1 - first.mo);
      return months % rule.interval === 0;
    }
    default:
      return date.getUTCDate() === first.d && date.getUTCMonth() + 1 === first.mo && (date.getUTCFullYear() - first.y) % rule.interval === 0;
  }
}

type Draft = { title: string; start: Stamp | null; rule: string | null; excluded: Array<[string, string]>; cancelled: boolean; moved: boolean };

/** Every start of one event that lands between `from` and `to`. */
function startsOf(event: Draft, from: number, to: number): number[] {
  const start = event.start;
  if (!start || event.cancelled) return [];
  const inWindow = (instant: number) => instant >= from && instant <= to;
  // A moved instance carries the series' rule in some exports; it is a one-off.
  if (!event.rule || event.moved) return [toInstant(start.wall, start.zone)].filter(inWindow);
  const rule = parseRule(event.rule, start.zone);
  if (!rule) return [];

  const skip = new Set(
    event.excluded.map(([params, value]) => {
      const stamp = parseStamp(params, value);
      return stamp ? toInstant(stamp.wall, stamp.zone) : NaN;
    }),
  );
  const first = dayNumber(start.wall.y, start.wall.mo, start.wall.d);
  const lastDay = Math.floor(to / DAY) + 1;
  const starts: number[] = [];
  // COUNT means walking from the first occurrence; otherwise start just before the window.
  let n = rule.count !== null ? first : Math.max(first, Math.floor(from / DAY) - 1);
  let held = 0;
  for (let guard = 0; n <= lastDay && guard < 6000; n++, guard++) {
    if (!fallsOn(rule, start.wall, n)) continue;
    if (rule.count !== null && ++held > rule.count) break;
    const day = new Date(n * DAY);
    const instant = toInstant({ ...start.wall, y: day.getUTCFullYear(), mo: day.getUTCMonth() + 1, d: day.getUTCDate() }, start.zone);
    if (rule.until !== null && instant > rule.until) break;
    if (!skip.has(instant) && inWindow(instant)) starts.push(instant);
  }
  return starts;
}

/** Events from an .ics file that start between `from` and `to` (milliseconds), earliest first. */
export function upcomingEvents(ics: string, from: number, to: number): CalendarEvent[] {
  const lines = ics.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const found: CalendarEvent[] = [];
  let event: Draft | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      event = { title: '', start: null, rule: null, excluded: [], cancelled: false, moved: false };
      continue;
    }
    if (!event) continue;
    if (line === 'END:VEVENT') {
      const done = event;
      for (const start of startsOf(done, from, to)) found.push({ title: done.title || 'Event', start, allDay: done.start!.allDay });
      event = null;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [name, ...params] = line.slice(0, colon).split(';');
    const value = line.slice(colon + 1);
    switch (name!.toUpperCase()) {
      case 'SUMMARY':
        event.title = unescapeText(value);
        break;
      case 'DTSTART':
        event.start = parseStamp(params.join(';'), value);
        break;
      case 'RRULE':
        event.rule = value;
        break;
      case 'EXDATE':
        for (const one of value.split(',')) event.excluded.push([params.join(';'), one]);
        break;
      case 'RECURRENCE-ID':
        event.moved = true;
        break;
      case 'STATUS':
        event.cancelled = value.trim().toUpperCase() === 'CANCELLED';
        break;
    }
  }
  return found.sort((a, b) => a.start - b.start);
}
