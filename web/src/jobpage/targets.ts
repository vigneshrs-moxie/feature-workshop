// What the reader shows (plan "Decisions already made" 2), as the left pane and the reader read it:
// his own pick (an output, a job row, a reader address); else the main output of the step he opened
// (a step pick clears his own pick, so the step's main output shows, and #/job/<slug>/stage/<stop>
// shows it again on a reload); else the payload's `open` (the ask, the current step's main output,
// or the conversation).

import type { JobPageState } from './jobStore';
import type { Output, ReaderKind, ReaderTarget, StepRow } from './types';

export const CONVERSATION: ReaderTarget = { kind: 'conversation', id: 'conversation' };
export const TICKET: ReaderTarget = { kind: 'ticket', id: 'ticket' };
export const DECISIONS: ReaderTarget = { kind: 'decisions', id: 'decisions' };
export const DETAILS: ReaderTarget = { kind: 'details', id: 'details' };

export const OUTPUT_READER: Record<Output['kind'], ReaderKind> = {
  doc: 'doc', screens: 'doc', changes: 'changes', checks: 'checks', recording: 'checks', 'hand-test': 'checks', findings: 'findings', walkthrough: 'walkthrough', pr: 'pr',
};

export const outputTarget = (o: Output): ReaderTarget => ({ kind: OUTPUT_READER[o.kind], id: o.id });

export const sameTarget = (a: ReaderTarget | null, b: ReaderTarget | null): boolean => a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);

/**
 * A step's main output: what the reader shows when he opens the step. The server's rule
 * (dashboard/lib/job-payload.js buildSteps, which the payload's `open` uses while a job works):
 * Build the changes, Test the checks, Review the findings when it has them, Ship the pull requests,
 * any other step its first document. A step with none of these: `not-yet`.
 */
export function stepMain(step: StepRow): ReaderTarget {
  const doc = step.outputs.find((o) => o.kind === 'doc');
  switch (step.id) {
    case 'build': return { kind: 'changes', id: 'changes' };
    case 'test': return { kind: 'checks', id: 'checks' };
    case 'ship': return { kind: 'ship', id: 'ship' };
    case 'review': if (step.outputs.some((o) => o.kind === 'findings')) return { kind: 'findings', id: 'findings' }; break;
    default: break;
  }
  return doc ? outputTarget(doc) : { kind: 'not-yet', id: step.id };
}

// The main output of each step, made once per step row (the store keeps a row's identity while its
// data is equal), so a reader that reads it does not redraw for a new object with the same words.
const mains = new WeakMap<StepRow, ReaderTarget>();
function mainOf(step: StepRow): ReaderTarget {
  let t = mains.get(step);
  if (!t) { t = stepMain(step); mains.set(step, t); }
  return t;
}

/** What the reader shows now (see the head of this file); null before the payload lands. */
export function readerOf(s: JobPageState): ReaderTarget | null {
  if (s.ui.reader) return s.ui.reader;
  const step = s.ui.step ? s.payload?.steps.find((x) => x.id === s.ui.step) : undefined;
  if (step) return mainOf(step);
  return s.payload?.open ?? null;
}
