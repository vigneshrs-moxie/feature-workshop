// How the Stack pages dress a part's lane (packet V): its word, icon and tone, and the pattern its
// segment wears on a progress bar, so status is never colour alone (a word on every chip, a word on
// hover over every segment, a pattern per lane). Plus the small words every card uses: counts,
// money, how long a stack has run.
import type { IconName } from '../../components/Icon';
import type { ChipTone } from '../../components/Chip';
import type { PartLane, StackSummary, StackView } from '../../api/types';

export interface LaneLook {
  /** The column's heading and the chip's word. */
  word: string;
  /** The short word under a bar ("3 at work"). */
  short: string;
  icon: IconName;
  chip: ChipTone;
  /** The tone class for marks (dots, segments, edges): stack-tone-<tone>. */
  tone: 'ok' | 'info' | 'review' | 'warn' | 'error' | 'quiet';
  /** The segment's pattern: solid, stripes, dots, hollow, dashed, hatch. */
  pattern: 'solid' | 'stripes' | 'hollow' | 'dashed' | 'hatch' | 'dots';
}

export const LANE_LOOK: Record<PartLane, LaneLook> = {
  'needs-you': { word: 'Needs you', short: 'need you', icon: 'hand', chip: 'needs-you', tone: 'warn', pattern: 'solid' },
  stuck: { word: 'Stuck', short: 'stuck', icon: 'warn', chip: 'error', tone: 'error', pattern: 'hatch' },
  waiting: { word: 'Waiting on another part', short: 'waiting', icon: 'clock', chip: 'neutral', tone: 'quiet', pattern: 'dashed' },
  queued: { word: 'Ready to start', short: 'ready to start', icon: 'circle-dashed', chip: 'neutral', tone: 'quiet', pattern: 'hollow' },
  working: { word: 'At work', short: 'at work', icon: 'loader', chip: 'info', tone: 'info', pattern: 'solid' },
  checks: { word: 'Checks running', short: 'in checks', icon: 'flask', chip: 'review', tone: 'review', pattern: 'stripes' },
  ready: { word: 'Ready to merge', short: 'ready to merge', icon: 'circle-check', chip: 'ok', tone: 'ok', pattern: 'hollow' },
  merging: { word: 'Being merged', short: 'being merged', icon: 'merge', chip: 'ok', tone: 'ok', pattern: 'stripes' },
  merged: { word: 'Merged', short: 'merged', icon: 'check', chip: 'ok', tone: 'ok', pattern: 'solid' },
};

/** The board's columns, left to right: needs you first, then a part's life in order. */
export const BOARD_COLUMNS: { id: string; lanes: PartLane[]; word: string; icon: IconName; empty: string }[] = [
  { id: 'needs-you', lanes: ['stuck', 'needs-you'], word: 'Needs you', icon: 'hand', empty: 'Nothing needs you' },
  { id: 'waiting', lanes: ['waiting'], word: 'Waiting on a part', icon: 'clock', empty: 'None waiting' },
  { id: 'queued', lanes: ['queued'], word: 'Ready to start', icon: 'circle-dashed', empty: 'None waiting to start' },
  { id: 'working', lanes: ['working'], word: 'At work', icon: 'loader', empty: 'Nobody at work' },
  { id: 'checks', lanes: ['checks'], word: 'Checks', icon: 'flask', empty: 'No checks running' },
  { id: 'ready', lanes: ['merging', 'ready'], word: 'Ready to merge', icon: 'merge', empty: 'None ready yet' },
  { id: 'merged', lanes: ['merged'], word: 'Merged', icon: 'check', empty: 'None merged yet' },
];

/** The lanes counted in words, the order the eye wants: merged, at work, needs you, then the rest. */
export function countWords(c: Partial<Record<PartLane, number>>, total: number): string {
  const merged = c.merged ?? 0;
  const bits = [`${merged} of ${total} merged`];
  const atWork = (c.working ?? 0) + (c.checks ?? 0) + (c.merging ?? 0);
  if (atWork) bits.push(`${atWork} at work`);
  const needs = (c['needs-you'] ?? 0) + (c.stuck ?? 0);
  if (needs) bits.push(`${needs} ${needs === 1 ? 'needs' : 'need'} you`);
  if (c.ready) bits.push(`${c.ready} ready to merge`);
  return bits.join(' · ');
}

/** "$38.20", "$0.40", "–" for nothing yet. */
export function money(usd: number | null | undefined): string {
  if (!usd) return '$0';
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`;
}

/** How long since: "4 days", "6 hours", "12 minutes". */
export function runningFor(iso: string | null | undefined, now: Date): string | null {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return null;
  const m = Math.max(0, now.getTime() - t) / 60000;
  if (m < 60) return `${Math.max(1, Math.round(m))} ${Math.round(m) === 1 ? 'minute' : 'minutes'}`;
  const h = m / 60;
  if (h < 36) return `${Math.round(h)} ${Math.round(h) === 1 ? 'hour' : 'hours'}`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

/** A short duration: "3d 4h", "5h 10m", "12m". */
export function shortSpan(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60 ? `${m % 60}m` : ''}`.trim();
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24 ? `${h % 24}h` : ''}`.trim();
}

/** A stack's state in a word, for its chip: what it needs, never a colour alone. */
export function standingChip(s: Pick<StackSummary, 'standing' | 'phase' | 'approved'> & { ask?: StackSummary['ask'] }): { word: string; icon: IconName; tone: ChipTone } {
  if (s.standing === 'done' || s.phase === 'pushed') return { word: 'Done', icon: 'circle-check', tone: 'ok' };
  if (s.standing === 'needs-you') return { word: 'Needs you', icon: 'hand', tone: 'needs-you' };
  if (s.approved === false) return { word: 'Planning', icon: 'clipboard', tone: 'neutral' };
  return { word: s.phase === 'push' ? 'Pushing' : 'Building', icon: 'loader', tone: 'info' };
}

/** The tone of a stack's edge and light: what a glance should catch. */
export const standingTone = (s: { standing?: StackSummary['standing'] }) => (s.standing === 'needs-you' ? 'warn' : s.standing === 'done' ? 'ok' : 'info');

/** A view's parts as segments (older dashboards: none). */
export const segmentsOf = (v: Pick<StackView, 'parts'>) => v.parts.filter((p) => p.lane).map((p) => ({ n: p.n, name: p.name, title: p.title ?? p.name, lane: p.lane!, laneWords: p.laneWords ?? '', slug: p.slug }));
