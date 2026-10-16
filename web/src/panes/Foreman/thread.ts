// Pure helpers for the Foreman pane's thread: joining pages by stable id, pairing a brief with its
// detail file, and deciding which briefs are answered. No React, no fetching (see useJobThread.ts).
import type { BriefItem, Extras, Run, Steer, SteerState, ThreadItem, YouItem } from '../../api/types';

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
  /** A gate reply was sent for it, a newer brief replaced it, or (older briefs) you answered it in a message. */
  answered: boolean;
}

export type ShownItem = { kind: 'brief-card'; id: string; brief: ShownBrief } | { kind: 'item'; id: string; item: ThreadItem };

/** What the job's detail says about answers: the briefs a gate reply went for, and the brief the gate card is open on. */
export interface AnswerFacts {
  /** Brief numbers a gate reply was sent for (or is held for until the usage limit resets). */
  answeredBriefs?: number[] | null;
  /** The brief the Foreman waits on right now (gate.briefNumber; null when it isn't waiting). */
  openBrief?: number | null;
}

// The gate card's next-step chips each add one of these lines (dashboard/lib/compose.js chipLine).
const OPTION_LINE = /^Option change for the next step:/;

/** Whether a message is only option lines from the gate card's chips: a process choice, never an answer. */
export function isOptionOnly(text: string): boolean {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((l) => OPTION_LINE.test(l));
}

// The kinds of reply that decide a brief (the classic page's approve, changes and stop buttons).
const DECIDING = new Set(['approve', 'changes', 'stop']);

/**
 * Whether one of your later messages answers brief n. Option lines alone never do. A message
 * sent from the gate card for this brief does. For the brief the gate card is open on, only a
 * deciding reply does (a plain message, a steer or a question leaves the gate open); for older
 * briefs, from before gate cards, any message after it does, as it always did.
 */
function youAnswers(x: YouItem, n: number, openBrief: number | null): boolean {
  if (isOptionOnly(x.text)) return false;
  if (x.gateBrief === n) return true;
  if (n !== openBrief) return true;
  return DECIDING.has(x.sendKind ?? '');
}

/**
 * What the thread shows, in order. Detail files are folded into their brief (matched by number)
 * instead of showing as briefs of their own; one whose brief isn't loaded yet stays hidden until it is.
 * A brief is answered when a gate reply went for it (answeredBriefs), a newer brief exists, or a
 * later message of yours answers it (youAnswers).
 */
export function shownItems(items: ThreadItem[], facts: AnswerFacts = {}): ShownItem[] {
  const details = new Map<number, string>();
  for (const it of items) {
    if (it.kind !== 'brief') continue;
    const m = DETAIL_FILE.exec(it.file);
    if (m) details.set(Number(m[1]), it.file);
  }
  const done = new Set(facts.answeredBriefs ?? []);
  const openBrief = facts.openBrief ?? null;
  const out: ShownItem[] = [];
  items.forEach((it, i) => {
    if (it.kind !== 'brief') { out.push({ kind: 'item', id: it.id, item: it }); return; }
    if (isDetailFile(it.file)) return;
    const later = items.slice(i + 1);
    const answered = done.has(it.number)
      || later.some((x) => (x.kind === 'brief' && !isDetailFile(x.file)) || (x.kind === 'you' && youAnswers(x, it.number, openBrief)));
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

/** A steered message's delivery state in plain words, with a hint saying what it means. */
export const STEER_LABELS: Record<SteerState, { label: string; hint: string }> = {
  queued: { label: 'Queued', hint: 'The dashboard has your message and passes it to the Foreman as soon as it can take it.' },
  delivered: { label: 'Delivered', hint: 'The Foreman has your message. It reads it at its next step.' },
  'acted-on': { label: 'Acted on', hint: 'The Foreman has read your message and replied with it in mind.' },
  cancelled: { label: 'Not delivered', hint: 'The reply stopped before the Foreman read this message. Send it again if you still need it.' },
  unanswered: { label: 'Not answered', hint: 'The Foreman got this message, but the reply ended before it answered. Send it again if you still need it.' },
};

/**
 * Where a steered message is: the store's live state first, else what the job's last run says
 * (after a reload the store starts empty).
 */
export function steerStateOf(steerId: string | undefined, live: Record<string, Steer>, run: Run | null | undefined): SteerState | null {
  if (!steerId) return null;
  return live[steerId]?.state ?? run?.steers?.find((s) => s.id === steerId)?.state ?? null;
}

/** "$1.23", or "<$0.01" for a little; empty when unknown. */
export function formatCost(usd: number | null | undefined): string {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) return usd === 0 ? '$0.00' : '';
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}
