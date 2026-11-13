// The steps (job page rebuild, Task 10; design brief "Left pane" 2): the job's own steps, one line
// each: a state mark, the name, and a dim word on the right. A done step's word is its result (`v3`,
// `9 commits`, `19 passed`) and never a state word; the current step's is its result too, or what it
// is doing when it has none yet (`working`, `waiting for you`); a step not reached says `not yet`, a
// skipped one `skipped` (lead's ruling, correction 3: the result, not a duration).
//
// Only the current step is open and lists what it made, the latest of each (the payload's outputs),
// each a row that opens in the reader. A click on another step (or Enter on its line, `[` `]`, or
// its address) lists nothing: it marks the step and shows its main output in the reader (the
// payload's `main`; `not-yet` for a step not started). Its other outputs are reached from the
// reader. So opening a step never moves any row (prototype rev 3: "left-pane rows never move";
// lead's ruling, Task 10 I1). The current step's heading and a marked step's have its duration
// (`12 h 35 min`, or `since …` on the current one).
//
// Before the payload lands the rows come from the Jobs snapshot's row (names and states, no words
// for done or current steps, no outputs), so they paint at once and the payload fills them in place.
//
// On the phone's job screen (`phone`, Task 15) every step is one line ending in a › that opens the
// step's own screen (phone/PhoneStep.tsx): no outputs under the current step, no duration.

import { memo, useRef } from 'react';
import type { Job } from '../../api/types';
import { Icon } from '../../components/Icon';
import { STOPS } from '../../components/stops/stops';
import { spentWords, statesOf } from '../../job/page/stepWords';
import { outputTarget, readerOf, sameTarget } from '../targets';
import type { JobState, Output, ReaderTarget, StepRow, StopId } from '../types';
import { useJob } from '../useJob';
import { sinceWords } from './YourMove';
import { PhoneChevron } from '../phone/PhoneJob2';

/** The seven steps before the payload, from the snapshot row: names and states only. */
export function stepsFromRow(job: Job | null): StepRow[] {
  const states = job ? statesOf(job) : null;
  return STOPS.map((s) => {
    const st = states?.[s.id];
    const state: StepRow['state'] = st === 'done' ? 'done' : st === 'now' || st === 'waiting' ? 'current' : st === 'skipped' ? 'skipped' : 'todo';
    return { id: s.id, label: s.label, state, word: null, durationMs: null, startedAt: null, outputs: [], main: { kind: 'not-yet', id: s.id }, more: [] };
  });
}

/**
 * The dim word on a step's line. Only a step that is not done carries a state word; null before
 * the payload says what a done or current step made.
 */
export function stepWord(step: StepRow, state: JobState | null): string | null {
  switch (step.state) {
    case 'done': return step.word;
    case 'todo': return 'not yet';
    case 'skipped': return 'skipped';
    default:
      if (step.word) return step.word;
      if (state === null || state === 'done') return null;
      return state === 'needs-you' ? 'waiting for you' : state === 'paused' ? 'paused' : state === 'waiting-github' ? 'waiting on GitHub' : 'working';
  }
}

/** A step's duration: how long it took, or since when the current one runs. */
export function durationOf(step: StepRow): string | null {
  if (step.durationMs !== null) return spentWords(step.durationMs);
  const since = step.state === 'current' ? sinceWords(step.startedAt) : null;
  return since ? `since ${since}` : null;
}

export const outMeta = (o: Output) => [o.version ? `v${o.version}` : null, o.meta].filter(Boolean).join(' · ') || null;

export interface StepsProps {
  job: Job | null;
  /** The left pane's keyboard line (j k), by its place in the lines. */
  cursor: number | null;
  /** Open a step: the page picks it and shows its main output in the reader. */
  onStep(id: StopId, from: HTMLElement): void;
  /** Open an output in the reader. */
  onOpen(t: ReaderTarget, from: HTMLElement): void;
  /** The phone's job screen: each step one line that opens its own screen (phone/PhoneStep), so no
   *  outputs under the current one and no duration on its line. */
  phone?: boolean;
}

/** Whether the reader's target is something of this step: its main output, a listed output, one in `more`, or an older version of one. */
const owns = (s: StepRow, t: ReaderTarget | null) => !!t && (sameTarget(s.main, t) || [...s.outputs, ...(s.more ?? [])].some((o) => sameTarget(outputTarget(o), t) || (t.kind === 'doc' && (o.versions ?? []).some((v) => v.id === t.id))));

export const Steps = memo(function Steps({ job, cursor, onStep, onOpen, phone = false }: StepsProps) {
  const steps = useJob((s) => s.payload?.steps ?? null);
  const state = useJob((s) => s.payload?.state ?? null);
  const pick = useJob((s) => s.ui.step);
  const target = useJob(readerOf, sameTarget);
  const fromRow = useRef<{ job: Job | null; rows: StepRow[] } | null>(null);
  if (!steps && fromRow.current?.job !== job) fromRow.current = { job, rows: stepsFromRow(job) };
  const rows = steps ?? fromRow.current!.rows;
  const current = rows.find((s) => s.state === 'current')?.id ?? null;
  // The step whose things the reader shows: his pick first, else the first that owns them.
  const owner = steps ? (rows.find((s) => s.id === pick && owns(s, target)) ?? rows.find((s) => owns(s, target)) ?? null) : null;
  const marked = owner && owner.id !== current ? owner.id : null;
  const here = marked ?? current;

  return (
    <nav className="jp2-st" aria-label="Steps">
      {rows.map((s, i) => {
        const isOpen = !phone && s.id === current;
        const word = stepWord(s, steps ? state : null);
        const dur = steps && !phone && (isOpen || s.id === marked) ? durationOf(s) : null;
        return (
          <div key={s.id} className="jp2-step">
            <button
              type="button"
              className={`jp2-row jp2-st-row is-${s.state}${isOpen ? ' is-open' : ''}${s.id === marked ? ' is-sel' : ''}${cursor === i ? ' is-cursor' : ''}`}
              data-jp-line={i}
              aria-expanded={isOpen || undefined}
              aria-current={s.id === here ? 'step' : undefined}
              onClick={(e) => onStep(s.id, e.currentTarget)}
            >
              <span className="jp2-st-mark" aria-hidden="true">{s.state === 'done' ? <Icon name="check" size={14} /> : s.state === 'current' ? <i className="jp2-dot" /> : s.state === 'skipped' ? <Icon name="minus" size={14} /> : <i className="jp2-ring" />}</span>
              <span className="jp2-st-name">{s.label}</span>
              {dur && <span className="jp2-st-dur">{dur}</span>}
              {word && <span className="jp2-st-word">{word}</span>}
              <PhoneChevron />
            </button>
            {isOpen && steps && (s.outputs.length > 0 ? (
              <ul className="jp2-st-outs">
                {s.outputs.map((o) => {
                  const t = outputTarget(o);
                  const meta = outMeta(o);
                  return (
                    <li key={`${o.kind}:${o.id}`}>
                      <button type="button" className={`jp2-row jp2-st-out${sameTarget(t, target) ? ' is-sel' : ''}`} onClick={(e) => onOpen(t, e.currentTarget)}>
                        <span className="jp2-out-label">{o.label}</span>
                        {meta && <span className="jp2-out-meta">{meta}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="jp2-st-none">Nothing yet</p>
            ))}
          </div>
        );
      })}
    </nav>
  );
});
