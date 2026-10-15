// Times as the Jobs pane shows them: "just now", "4m", "3h", "yesterday", "Oct 9" for how long
// ago something happened, and "3:42pm" (or "Fri 3:42pm" when it isn't today) for a clock time.
// Every function takes `now` so tests don't depend on the real clock.
import { useEffect, useState } from 'react';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Short "how long ago": just now, 4m, 3h, yesterday, 3d, Oct 9. Empty when unknown. */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  const d = parse(iso);
  if (!d) return '';
  const ago = now.getTime() - d.getTime();
  if (ago < MIN) return 'just now'; // includes small clock skew into the future
  if (ago < HOUR) return `${Math.floor(ago / MIN)}m`;
  if (ago < DAY && sameDay(d, now)) return `${Math.floor(ago / HOUR)}h`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'yesterday';
  if (ago < 7 * DAY) return `${Math.max(2, Math.round(ago / DAY))}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The full date and time, for a hover hint. */
export function fullTime(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

/** "3:42pm" today, "Fri 3:42pm" on another day. Empty when unknown. */
export function clockTime(iso: string | null | undefined, now: Date = new Date()): string {
  const d = parse(iso);
  if (!d) return '';
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([AP])M$/i, (_m, ap: string) => `${ap.toLowerCase()}m`);
  return sameDay(d, now) ? t : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${t}`;
}

/** The current time, refreshed every `everyMs` so relative times stay true without a reload. */
export function useNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
