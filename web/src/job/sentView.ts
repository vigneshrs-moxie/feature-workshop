// What a go / no go place says after his decision went (spec 1.2, deep review D I1): the job page's
// bar and the Desk's card read the same rule, so they say the same lines.
//   sending   the pressed call spins (the places draw that themselves)
//   sent      "Sent. Waiting for the Foreman to start." and a second line by what was sent
//   stuck     "Nothing has moved yet." (Try again, where the place has one)
//   answered  the brief is answered (the job's detail says so, or the server took a deciding answer
//             to this brief) or the run his reply started is at work: the sent lines, no calls
//   held      the deciding answer waits for Claude's usage limit to reset: the app's held words
//   stalled   answered, no run at work, and 30 s gone since the later of the server taking it and the
//             last run ending: "Nothing has moved yet.", with Try again when there is a decision to
//             send again, else a line saying to write to the Foreman
import { useEffect, useState } from 'react';
import type { Job, JobDetail, Run } from '../api/types';
import { STUCK_AFTER_MS } from '../lib/sentState';
import { DECIDING_KINDS, gateKey, openGate } from '../lib/gateCard';
import type { GateSent } from '../panes/Foreman/gateSent';
import { isActiveRun } from '../panes/Foreman/thread';

export const SENT_WORDS = 'Sent. Waiting for the Foreman to start.';
export const STUCK_WORDS = 'Nothing has moved yet.';
/** The words the gate card already uses for a reply held until the limit resets (GateCard.tsx). */
export const HELD_WORDS = 'Held until Claude’s usage limit resets.';
/** The second line under the sent line, by what was sent (an approval has none). */
export const SENT_MORE: Partial<Record<string, string>> = {
  message: 'Your reply is with the Foreman. Nothing is approved.',
  changes: 'The Foreman will rework this step with your note.',
};

/** The lines a place shows instead of its ask and its calls. */
export interface SentLines { words: string; more: string | null }

/** From the send's own state: sent (until the job moves) or stuck. */
export function stateLines(decision: Pick<GateSent, 'state' | 'kind'>): SentLines | null {
  if (decision.state === 'sent') return { words: SENT_WORDS, more: decision.kind ? SENT_MORE[decision.kind] ?? null : null };
  if (decision.state === 'stuck') return { words: STUCK_WORDS, more: null };
  return null;
}

/**
 * From the job: the brief is answered or held, or the run his reply started works. The server
 * answers `sent` with a started run, so the send's own state clears at once; this keeps the lines.
 */
export function sentView(job: Pick<Job, 'closed'>, detail: JobDetail | null | undefined, run: Run | null, decision: Pick<GateSent, 'accepted'>): SentLines | null {
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
  return { words: SENT_WORDS, more: a && (thisGate || replying) ? SENT_MORE[a.kind] ?? null : null };
}

/** A stalled answered brief with no decision on this page to send again. */
export const WRITE_TO_MOVE = 'Write to the Foreman below to move it on.';

/** The lines, and whether Try again may send the same decision once more. */
export interface SentShown extends SentLines { canRetry: boolean }

/**
 * sentView, and once the answered brief has stalled (no run at work, 30 s after the later of the
 * server taking the decision and the last run ending; at once when neither time is known):
 * "Nothing has moved yet.". One timer of its own, to the moment it stalls.
 */
export function useSentView(job: Pick<Job, 'closed'>, detail: JobDetail | null | undefined, run: Run | null, decision: Pick<GateSent, 'accepted'>): SentShown | null {
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
  if (!view) return null;
  if (due !== null && Date.now() >= due) return { words: STUCK_WORDS, more: mine ? null : WRITE_TO_MOVE, canRetry: mine };
  return { ...view, canRetry: false };
}

/** What a place shows after a send: its own state first, then what the job says. */
export function useWaitingLines(job: Pick<Job, 'closed'>, detail: JobDetail | null | undefined, run: Run | null, decision: GateSent): SentShown | null {
  const shown = useSentView(job, detail, run, decision);
  const own = stateLines(decision);
  return own ? { ...own, canRetry: false } : shown;
}

export const linesText = (l: SentLines) => [l.words, l.more].filter(Boolean).join(' ');
