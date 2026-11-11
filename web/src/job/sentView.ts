// What a go / no go place says after his decision went (spec 1.2, deep review D I1): the job page's
// bar and the Desk's card read the same rule, so they say the same lines.
//   sending   the pressed call spins (the places draw that themselves)
//   sent      "Sent. Waiting for the Foreman to start." and a second line by what was sent
//   stuck     "Nothing has moved yet." (Try again, where the place has one)
//   answered  the brief is answered (the job's detail says so, or the server took a deciding answer
//             to this brief) or the run his reply started is at work: the sent lines, no calls
//   held      the deciding answer waits for Claude's usage limit to reset: the app's held words
import type { Job, JobDetail, Run } from '../api/types';
import { DECIDING_KINDS, openGate } from '../lib/gateCard';
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
  const thisBrief = a !== null && a.brief !== null && a.brief === brief;
  const answered = openGate(detail, false) === null || (thisBrief && DECIDING_KINDS.includes(a.kind));
  const replying = !answered && a?.kind === 'message' && a.runId !== null && isActiveRun(run) && run.id === a.runId;
  if (!answered && !replying) return null;
  return { words: SENT_WORDS, more: a && (thisBrief || replying) ? SENT_MORE[a.kind] ?? null : null };
}

/** What a place shows after a send: its own state first, then what the job says. */
export function waitingLines(job: Pick<Job, 'closed'>, detail: JobDetail | null | undefined, run: Run | null, decision: GateSent): SentLines | null {
  return stateLines(decision) ?? sentView(job, detail, run, decision);
}

export const linesText = (l: SentLines) => [l.words, l.more].filter(Boolean).join(' ');
