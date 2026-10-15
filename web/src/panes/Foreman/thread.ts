// Pure helpers for the Foreman pane's thread: joining pages by stable id, pairing a brief with its
// detail file, and deciding which briefs are answered. No React, no fetching (see useJobThread.ts).
import type { BriefItem, Extras, Run, ThreadItem } from '../../api/types';

/**
 * Join the older pages ("load older") with the newest page, oldest first, each id once.
 * The newest page wins for an id both have (it is the fresher copy).
 */
export function mergeThread(older: ThreadItem[], latest: ThreadItem[]): ThreadItem[] {
  const ids = new Set(latest.map((it) => it.id));
  return [...older.filter((it) => !ids.has(it.id)), ...latest];
}

/**
 * After the newest page is fetched again: keep the older pages only if they still join up with it.
 * They join when the new page still holds the item the previous newest page started with; if more
 * than a page arrived since, there would be a gap, so the older pages are dropped (load them again).
 */
export function olderStillJoins(previousLatest: ThreadItem[], nextLatest: ThreadItem[]): boolean {
  const first = previousLatest[0]?.id;
  return first === undefined || nextLatest.some((it) => it.id === first);
}

// A brief's detail fold lives in a sibling file: briefs/<n>-detail.md (or briefs/<n>-<stage>-detail.md).
const DETAIL_FILE = /^briefs\/(\d+)-(?:.+-)?detail\.md$/;

export const isDetailFile = (file: string): boolean => DETAIL_FILE.test(file);

export interface ShownBrief {
  item: BriefItem;
  /** The sibling detail file, if the job has one. */
  detailFile: string | null;
  /** You answered it (sent a message after it) or a newer brief replaced it. */
  answered: boolean;
}

export type ShownItem = { kind: 'brief-card'; id: string; brief: ShownBrief } | { kind: 'item'; id: string; item: ThreadItem };

/**
 * What the thread shows, in order. Detail files are folded into their brief (matched by number)
 * instead of showing as briefs of their own; one whose brief isn't loaded yet stays hidden until it is.
 */
export function shownItems(items: ThreadItem[]): ShownItem[] {
  const details = new Map<number, string>();
  for (const it of items) {
    if (it.kind !== 'brief') continue;
    const m = DETAIL_FILE.exec(it.file);
    if (m) details.set(Number(m[1]), it.file);
  }
  const out: ShownItem[] = [];
  items.forEach((it, i) => {
    if (it.kind !== 'brief') { out.push({ kind: 'item', id: it.id, item: it }); return; }
    if (isDetailFile(it.file)) return;
    const later = items.slice(i + 1);
    const answered = later.some((x) => x.kind === 'you' || (x.kind === 'brief' && !isDetailFile(x.file)));
    out.push({ kind: 'brief-card', id: it.id, brief: { item: it, detailFile: details.get(it.number) ?? null, answered } });
  });
  return out;
}

/** Rulings or proof lines as a list; empty when absent (then nothing is shown). */
export function extraLines(value: Extras['rulings']): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  return typeof value === 'string' && value.trim() ? [value] : [];
}

// The run statuses that mean the Foreman is replying right now (dashboard/server.js ACTIVE_RUN).
const ACTIVE = new Set(['starting', 'running', 'waiting_permission', 'stopping']);

export const isActiveRun = (run: Run | null | undefined): run is Run => Boolean(run && ACTIVE.has(run.status));

/** What the live row says the Foreman is doing, in plain words. */
export function liveLabel(run: Run): string {
  switch (run.status) {
    case 'starting': return 'Starting the Foreman…';
    case 'waiting_permission': return 'Waiting for you to allow something';
    case 'stopping': return 'Stopping…';
    default: return 'The Foreman is working';
  }
}

/** "$1.23", or "<$0.01" for a little; empty when unknown. */
export function formatCost(usd: number | null | undefined): string {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) return usd === 0 ? '$0.00' : '';
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}
