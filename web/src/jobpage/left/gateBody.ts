// What Your move sends to the gate route (POST /api/job/:slug/gate) for his picks, written fresh for
// the new page and checked byte for byte against today's card (lib/gateCard.ts gateRequest, as
// panes/Foreman/GateCard.tsx post() calls it) in gateBody.test.ts. The key order is today's:
//   { kind, briefNumber, answers, verdicts, chips: [], [confirmNoTerminal], [note], [startAfterReset] }
// - answers: each question's pick ({ choice }), or his own words ({ other }, trimmed) for `Your own
//   answer` or a question with no options; a question with nothing is left out.
// - verdicts: Go confirms every open decision ({ verdict: 'confirm' }, keyed id ?? decision, as the
//   payload's openDecisions are); Send back and a message confirm nothing (the page has no override).
// - chips: always [] (the page has no "Adjust the next step").
// - note: with Go, the message box's words as they are, only when there are some; with Send back
//   and a message, always (the server refuses an empty change).

import type { ComposeAnswers, ComposeVerdicts } from '../../lib/compose';
import type { GateRequest } from '../../api/types';
import type { GateMove, GateQuestion } from '../types';

/** The pick that means `Your own answer`: the words are in `own`. */
export const OWN = '__own';

/** What he picked on a gate: by question id an option id or OWN (none: the recommended option), and his own words. */
export interface GatePicks {
  picks: Record<string, string>;
  own: Record<string, string>;
}

export interface GateExtra {
  /** He confirmed none of the open terminals is this job's Foreman. */
  confirmNoTerminal?: boolean;
  /** The message box's words. */
  note?: string;
  /** Go after the usage limit resets. */
  startAfterReset?: boolean;
}

const recommended = (q: GateQuestion) => q.options.find((o) => o.recommended)?.id ?? null;

/** The question's pick now: his, else the recommended option (null: none). */
export function pickOf(q: GateQuestion, p: GatePicks): string | null {
  const his = p.picks[q.id];
  return his ?? recommended(q);
}

/** The question's answer as the body carries it, or null when it has none. */
function answerOf(q: GateQuestion, p: GatePicks): { choice: string } | { other: string } | null {
  const pick = pickOf(q, p);
  const words = (p.own[q.id] ?? '').trim();
  if (pick === OWN || q.options.length === 0) return words ? { other: words } : null;
  if (pick && q.options.some((o) => o.id === pick)) return { choice: pick };
  return null;
}

/** How many questions are answered other than with the recommended option (Go's `n changed`). */
export function changedCount(move: GateMove, p: GatePicks): number {
  return move.questions.filter((q) => {
    const a = answerOf(q, p);
    return a !== null && !('choice' in a && a.choice === recommended(q));
  }).length;
}

/** The first question (1-based) with no answer, or null when every one has one. */
export function unanswered(move: GateMove, p: GatePicks): number | null {
  const i = move.questions.findIndex((q) => answerOf(q, p) === null);
  return i < 0 ? null : i + 1;
}

/** The body of POST /api/job/:slug/gate for Go ('approve'), Send back ('changes') or a message from the card. */
export function gateBody(kind: 'approve' | 'changes' | 'message', move: GateMove, p: GatePicks, extra: GateExtra = {}): GateRequest {
  const answers: ComposeAnswers = {};
  for (const q of move.questions) {
    const a = answerOf(q, p);
    if (a) answers[q.id] = a;
  }
  const verdicts: ComposeVerdicts = {};
  if (kind === 'approve') for (const key of move.openDecisions) verdicts[key] = { verdict: 'confirm' };
  const note = kind === 'approve'
    ? (extra.note && extra.note.trim() ? { note: extra.note } : {})
    : { note: extra.note ?? '' };
  return {
    kind,
    briefNumber: move.brief,
    answers,
    verdicts,
    chips: [],
    ...(extra.confirmNoTerminal ? { confirmNoTerminal: true } : {}),
    ...note,
    ...(kind === 'approve' && extra.startAfterReset ? { startAfterReset: true } : {}),
  };
}
