// What a go / no go place says after his decision went (spec 1.2, deep review D I1): the job page's
// bar and the Desk's card read the same rule, so they say the same lines.
//   sending   the pressed call spins (the places draw that themselves)
//   sent      "Sent. Waiting for the Foreman to start." and a second line by what was sent (sentLine:
//             the answers and the next step for a Go, the step a send back stays at)
//   stuck     "Nothing has moved yet." (Try again, where the place has one)
//   answered  the brief is answered (the job's detail says so, or the server took a deciding answer
//             to this brief) or the run his reply started is at work: the sent lines, no calls
//   held      the deciding answer waits for Claude's usage limit to reset: the app's held words
//   stalled   answered, no run at work, and 30 s gone since the later of the server taking it and the
//             last run ending: "Nothing has moved yet.", with Try again when there is a decision to
//             send again, else a line saying to write to the Foreman
import { useEffect, useRef, useState } from 'react';
import type { Gate, Job, JobDetail, Run } from '../api/types';
import { STOPS, stopOf } from '../components/stops/stops';
import type { GateKind } from '../lib/compose';
import { STUCK_AFTER_MS } from '../lib/sentState';
import { DECIDING_KINDS, gateKey, openGate } from '../lib/gateCard';
import type { AcceptedDecision, GateSent } from '../panes/Foreman/gateSent';
import { isActiveRun } from '../panes/Foreman/thread';

export const SENT_WORDS = 'Sent. Waiting for the Foreman to start.';
export const STUCK_WORDS = 'Nothing has moved yet.';
/** The words the gate card already uses for a reply held until the limit resets (GateCard.tsx). */
export const HELD_WORDS = 'Held until Claude’s usage limit resets.';
/** Counts in words up to nine; 10 and on in figures. */
const COUNTS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const countWords = (n: number) => (n < COUNTS.length ? COUNTS[n] : String(n));

/**
 * What the second line names. answers: how many of the card's questions went with a Go; next: the
 * step the gate said comes next; step: the step a send back stays at; auto: Auto is on for the job.
 * Null answers or next: not known (the page was reloaded, so nothing was kept): left out.
 */
export interface SentFacts { answers?: number | null; next?: string | null; step?: string | null; auto?: boolean }

/** The second line under the sent line, by what was sent. */
export function sentLine(kind: 'approve' | 'changes' | 'message', { answers = null, next = null, step = null, auto = false }: SentFacts = {}): string {
  if (kind === 'message') return 'Your reply reached the Foreman. Nothing is approved, so the card stays open.';
  if (kind === 'changes') return `Sent back: the Foreman stays at ${step || 'this step'} and revises. Nothing is approved.`;
  const n = answers ?? 0;
  const label = next?.trim().replace(/[.\s]+$/, '') || null;
  const went = n > 0 ? `Your go and your ${countWords(n)} ${n === 1 ? 'answer' : 'answers'} reached the Foreman.` : 'Your go reached the Foreman.';
  const then = label ? ` ${label} starts next.` : '';
  const carries = auto ? ` Auto carries on from ${label ?? 'the next step'}.` : '';
  return `${went}${then}${carries}`;
}

/** What the sent lines read from the job: whether it is closed, its step, and whether Auto is on. */
type SentJob = Pick<Job, 'closed' | 'stage' | 'auto'>;

/** The second line for a kind (a stop has none), with what was kept of the send when anything was. */
function moreFor(kind: GateKind, kept: Pick<AcceptedDecision, 'answers' | 'next'> | null, job: SentJob): string | null {
  if (kind === 'stop') return null;
  const step = STOPS.find((s) => s.id === stopOf(job.stage))?.label ?? null;
  return sentLine(kind, { answers: kept?.answers ?? null, next: kept?.next ?? null, step, auto: job.auto?.on === true });
}

/**
 * The step that comes next, by its own name (lib/stops: "Build", "Review"): the gate's next stage,
 * else the Foreman's words when they are a step's name. Null when it names no step ("Run the tests").
 */
export function nextStepOf(gate: Pick<Gate, 'nextStage' | 'nextProposed'>): string | null {
  const stop = stopOf(gate.nextStage);
  if (stop) return STOPS.find((s) => s.id === stop)?.label ?? null;
  const words = gate.nextProposed?.trim().replace(/[.\s]+$/, '').toLowerCase();
  return STOPS.find((s) => s.label.toLowerCase() === words)?.label ?? null;
}

/**
 * After a reload nothing sent from the page is kept: the thread still says how the last answer to
 * this brief went, and who sent it (`auto`: Auto did, so it is never said to be his).
 */
function decidedInThread(detail: JobDetail | null | undefined, brief: number | null): { kind: GateKind; auto: boolean } | null {
  if (brief === null) return null;
  const items = detail?.thread ?? [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'you' && it.gateBrief === brief && DECIDING_KINDS.includes(it.sendKind as GateKind)) return { kind: it.sendKind as GateKind, auto: it.by === 'auto' };
  }
  return null;
}

/** The kind of his answer to the open gate, from this page, else from the thread (null: not known, or Auto answered it). */
export function answeredKind(detail: JobDetail | null | undefined, decision: Pick<GateSent, 'accepted'>): GateKind | null {
  const gate = detail?.gate ?? null;
  if (!gate) return null;
  const a = decision.accepted;
  if (a && a.gate === gateKey(gate)) return a.kind;
  const t = decidedInThread(detail, gate.briefNumber ?? null);
  return t && !t.auto ? t.kind : null;
}

/** Auto answered the open gate, and nothing from this page did. */
export function autoAnswered(detail: JobDetail | null | undefined, decision: Pick<GateSent, 'accepted'>): boolean {
  const gate = detail?.gate ?? null;
  if (!gate) return false;
  const a = decision.accepted;
  if (a && a.gate === gateKey(gate)) return false;
  return decidedInThread(detail, gate.briefNumber ?? null)?.auto === true;
}

/** The lines a place shows instead of its ask and its calls. */
export interface SentLines { words: string; more: string | null }

/** From the send's own state: sent (until the job moves) or stuck. */
export function stateLines(decision: Pick<GateSent, 'state' | 'kind' | 'accepted'>, job: SentJob): SentLines | null {
  if (decision.state === 'sent') return { words: SENT_WORDS, more: decision.kind ? moreFor(decision.kind, decision.accepted, job) : null };
  if (decision.state === 'stuck') return { words: STUCK_WORDS, more: null };
  return null;
}

/**
 * From the job: the brief is answered or held, or the run his reply started works. The server
 * answers `sent` with a started run, so the send's own state clears at once; this keeps the lines.
 */
export function sentView(job: SentJob, detail: JobDetail | null | undefined, run: Run | null, decision: Pick<GateSent, 'accepted'>): SentLines | null {
  const gate = detail?.gate ?? null;
  if (!gate || job.closed) return null;
  const brief = gate.briefNumber ?? null;
  const held = detail?.heldReply ?? null;
  if (held && (held.gateBrief ?? null) === brief && DECIDING_KINDS.includes(held.kind)) return { words: HELD_WORDS, more: null };
  const a = decision.accepted;
  // The answer was for this go / no go: the same brief number, or the same words when it has none (N1).
  const thisGate = a !== null && a.gate === gateKey(gate);
  const answered = openGate(detail, false) === null || (thisGate && DECIDING_KINDS.includes(a.kind));
  const replying = !answered && a?.kind === 'message' && a.runId !== null && isActiveRun(run) && run.id === a.runId;
  if (!answered && !replying) return null;
  // This page's own answer names what it kept; after a reload the thread still gives its kind.
  const kept = a && (thisGate || replying) ? a : null;
  const kind = kept?.kind ?? answeredKind(detail, decision);
  return { words: SENT_WORDS, more: kind ? moreFor(kind, kept, job) : null };
}

/** A stalled answered brief with no decision on this page to send again (M2: the box is not always below). */
export const WRITE_TO_MOVE = 'Write to the Foreman to move it on.';
/** The Desk has no message box: its card says to open the job (M1), "Open the job" being a link. */
export const DESK_WRITE_TO_MOVE = 'Open the job and write to the Foreman to move it on.';

/**
 * The lines, whether Try again may send the same decision once more, and whether the second line is
 * the one saying to write to the Foreman (each place words that its own way).
 */
export interface SentShown extends SentLines { canRetry: boolean; write?: boolean }

/** The page's own words for a job paused by the usage limit or by a restart (the snapshot's lane reason). */
export const PAUSED_WORDS = 'Paused';
export const LIMIT_PAUSED = 'Paused until Claude’s usage limit resets. It carries on by itself.';
export const RESTART_PAUSED = 'Paused by a restart. Press Resume to carry on.';

/** Why the job waits on something other than him (the limit, a restart), in the page's words; null when it does not. */
export function pausedLines(job: Pick<Job, 'limitPaused' | 'laneReason' | 'group'> & { restartPaused?: unknown; paused?: unknown }): SentLines | null {
  const reason = typeof job.laneReason === 'string' && job.laneReason.startsWith('Paused') ? job.laneReason : null;
  if (job.limitPaused) return { words: PAUSED_WORDS, more: reason ?? LIMIT_PAUSED };
  if (job.restartPaused) return { words: PAUSED_WORDS, more: reason ?? RESTART_PAUSED };
  if (job.paused === true || job.group === 'paused') return reason ? { words: PAUSED_WORDS, more: reason } : null;
  return null;
}

/**
 * sentView, and once the answered brief has stalled (no run at work, 30 s after the later of the
 * server taking the decision and the last run ending; at once when neither time is known):
 * "Nothing has moved yet.". One timer of its own, to the moment it stalls.
 */
export function useSentView(job: Job, detail: JobDetail | null | undefined, run: Run | null, decision: Pick<GateSent, 'accepted'>, reload?: () => void): SentShown | null {
  const view = sentView(job, detail, run, decision);
  const a = decision.accepted;
  const gate = detail?.gate ?? null;
  const mine = a !== null && gate !== null && a.gate === gateKey(gate);
  const endedAt = run?.endedAt;
  const working = isActiveRun(run);
  const resting = view !== null && view.words === SENT_WORDS && !working;
  const ended = !working && typeof endedAt === 'string' ? Date.parse(endedAt) : NaN;
  const due = resting ? Math.max(mine ? a.at : 0, Number.isFinite(ended) ? ended : 0) + STUCK_AFTER_MS : null;
  const [, tick] = useState(0);
  useEffect(() => {
    if (due === null) return;
    const left = due - Date.now();
    if (left <= 0) return;
    const t = setTimeout(() => tick((n) => n + 1), left);
    return () => clearTimeout(t);
  }, [due]);
  // N2: the job is fetched again when the run ends, and once more before the stalled line shows; the
  // line shows only once that fetch is in and still says the same (a brief raised meanwhile wins).
  const wasWorking = useRef(working);
  const answeredNow = view !== null;
  useEffect(() => {
    if (wasWorking.current && !working && answeredNow) reload?.();
    wasWorking.current = working;
  }, [working, answeredNow, reload]);
  const passed = due !== null && Date.now() >= due;
  const [check, setCheck] = useState<{ due: number; detail: unknown } | null>(null);
  useEffect(() => {
    if (!passed || due === null || !reload || check?.due === due) return;
    setCheck({ due, detail });
    reload();
  }, [passed, due, reload, check, detail]);
  const checked = !reload || (check !== null && check.due === due && check.detail !== detail);
  if (!view) return null;
  // Paused by the usage limit or a restart: that is why nothing moves, said as the page says it.
  const paused = resting ? pausedLines(job) : null;
  if (paused) return { ...paused, canRetry: false };
  // M7: Try again sends a decision only (approve, changes, stop), never a Reply's words.
  const retry = mine && a !== null && DECIDING_KINDS.includes(a.kind);
  if (passed && checked) return retry ? { words: STUCK_WORDS, more: null, canRetry: true } : { words: STUCK_WORDS, more: WRITE_TO_MOVE, canRetry: false, write: true };
  return { ...view, canRetry: false };
}

/** What a place shows after a send: its own state first, then what the job says. */
export function useWaitingLines(job: Job, detail: JobDetail | null | undefined, run: Run | null, decision: GateSent, reload?: () => void): SentShown | null {
  const shown = useSentView(job, detail, run, decision, reload);
  const own = stateLines(decision, job);
  return own ? { ...own, canRetry: false } : shown;
}

export const linesText = (l: SentLines) => [l.words, l.more].filter(Boolean).join(' ');
