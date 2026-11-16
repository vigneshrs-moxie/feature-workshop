// What the reader shows (plan "Decisions already made" 2), as the left pane and the reader read it:
// his own pick (an output, a job row, a reader address); else the main output of the step he opened
// (the `main` the server sends on the step's row; a step pick clears his own pick, so the step's main
// output shows, and #/job/<slug>/stage/<stop> shows it again on a reload); else what the reader showed
// on arrival: the payload's `open` (the ask, the current step's main output, or the conversation) as
// the page opened (jobStore.ts `arrival`), so a later rebuild with another `open` never moves it.

import { arrivalOf, type JobPageState } from './jobStore';
import type { Output, ReaderKind, ReaderTarget } from './types';

export const CONVERSATION: ReaderTarget = { kind: 'conversation', id: 'conversation' };
export const TICKET: ReaderTarget = { kind: 'ticket', id: 'ticket' };
export const DECISIONS: ReaderTarget = { kind: 'decisions', id: 'decisions' };
export const DETAILS: ReaderTarget = { kind: 'details', id: 'details' };

export const OUTPUT_READER: Record<Output['kind'], ReaderKind> = {
  doc: 'doc', screens: 'screens', changes: 'changes', checks: 'checks', recording: 'checks', 'hand-test': 'checks', findings: 'findings', walkthrough: 'walkthrough', pr: 'pr',
};

export const outputTarget = (o: Output): ReaderTarget => ({ kind: OUTPUT_READER[o.kind], id: o.id });

export const sameTarget = (a: ReaderTarget | null, b: ReaderTarget | null): boolean => a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);

/** What the reader shows now (see the head of this file); null before the payload lands. */
export function readerOf(s: JobPageState): ReaderTarget | null {
  // A waiting permission's card is Your move itself, so it is never what the reader shows (an old
  // address that names one): the arrival target stands in.
  if (s.ui.reader && s.ui.reader.kind !== 'permission') return s.ui.reader;
  const step = s.ui.step ? s.payload?.steps.find((x) => x.id === s.ui.step) : undefined;
  if (step) return step.main;
  return s.arrival ?? (s.payload ? arrivalOf(s.payload) : null);
}

/**
 * What the reader shows when the conversation has its own column beside it (a laptop, the glance
 * layout): readerOf, except that the conversation (or an old permission address) gives way to the
 * picked step's main output, else the current step's, else the last step's.
 */
export function readerBesideConvo(s: JobPageState): ReaderTarget | null {
  // A decision waits and he has picked nothing: its card holds the brief, so the reader shows the
  // step's evidence (Findings at a review, the spec at a spec gate), not the brief a second time.
  if (!s.ui.reader && !s.ui.step && s.payload?.move?.kind === 'gate') {
    const now = s.payload.steps.find((x) => x.state === 'current');
    if (now && now.main.kind !== 'not-yet') return now.main;
  }
  const t = readerOf(s);
  if (!t || (t.kind !== 'conversation' && t.kind !== 'permission')) return t;
  const steps = s.payload?.steps ?? [];
  const step = steps.find((x) => x.id === s.ui.step) ?? steps.find((x) => x.state === 'current') ?? steps[steps.length - 1];
  return step ? step.main : null;
}
