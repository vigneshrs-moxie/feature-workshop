// The steps (job page rebuild, Task 10; design brief "Left pane" 2): the job's own steps, one line
// each: a state mark, the name, and a dim word on the right. A done step's word is its result (`v3`,
// `9 commits`, `19 passed`) and never a state word; the current step's is its result too, or what it
// is doing when it has none yet (`working`, `waiting for you`); a step not reached says `not yet`, a
// skipped one `skipped` (lead's ruling, correction 3: the result, not a duration).
//
// The current step is open and lists what it made, the latest of each (the payload's outputs), each
// a row that opens in the reader. A click on a step opens it and shows its main output in the reader
// (targets.ts stepMain); the open step's heading has its duration (`12 h 35 min`, or `since …` on
// the current one).
//
// Opening a step never changes the height of anything above it: the current step stays open
// whatever he opens, and a step he opened with the pointer stays open while he opens one further
// down (it closes when he opens one above it, or the page moves the pick by key or address, where
// no pointer sits on a row to be kept still).
//
// Before the payload lands the rows come from the Jobs snapshot's row (names and states, no words
// for done or current steps, no outputs), so they paint at once and the payload fills them in place.

import { memo, useEffect, useRef, useState } from 'react';
import type { Job } from '../../api/types';
import { Icon } from '../../components/Icon';
import { STOPS } from '../../components/stops/stops';
import { spentWords, statesOf } from '../../job/page/stepWords';
import { outputTarget, readerOf, sameTarget, stepMain } from '../targets';
import type { JobState, Output, ReaderTarget, StepRow, StopId } from '../types';
import { useJob } from '../useJob';
import { sinceWords } from './YourMove';

/** The seven steps before the payload, from the snapshot row: names and states only. */
export function stepsFromRow(job: Job | null): StepRow[] {
  const states = job ? statesOf(job) : null;
  return STOPS.map((s) => {
    const st = states?.[s.id];
    const state: StepRow['state'] = st === 'done' ? 'done' : st === 'now' || st === 'waiting' ? 'current' : st === 'skipped' ? 'skipped' : 'todo';
    return { id: s.id, label: s.label, state, word: null, durationMs: null, startedAt: null, outputs: [] };
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
      if (state === null) return null;
      return state === 'needs-you' ? 'waiting for you' : state === 'paused' ? 'paused' : 'working';
  }
}

/** The open step's duration: how long it took, or since when the current one runs. */
function durationOf(step: StepRow): string | null {
  if (step.durationMs !== null) return spentWords(step.durationMs);
  const since = step.state === 'current' ? sinceWords(step.startedAt) : null;
  return since ? `since ${since}` : null;
}

const NONE_KEPT: { for: StopId | null; ids: StopId[] } = { for: null, ids: [] };

const outMeta = (o: Output) => [o.version ? `v${o.version}` : null, o.meta].filter(Boolean).join(' · ') || null;

export interface StepsProps {
  job: Job | null;
  /** The left pane's keyboard line (j k), by its place in the lines. */
  cursor: number | null;
  /** Open a step: the page sets it open and shows its main output in the reader. */
  onStep(id: StopId, from: HTMLElement): void;
  /** Open an output in the reader. */
  onOpen(t: ReaderTarget, from: HTMLElement): void;
}

export const Steps = memo(function Steps({ job, cursor, onStep, onOpen }: StepsProps) {
  const steps = useJob((s) => s.payload?.steps ?? null);
  const state = useJob((s) => s.payload?.state ?? null);
  const pick = useJob((s) => s.ui.step);
  const target = useJob(readerOf, sameTarget);
  const fromRow = useRef<{ job: Job | null; rows: StepRow[] } | null>(null);
  if (!steps && fromRow.current?.job !== job) fromRow.current = { job, rows: stepsFromRow(job) };
  const rows = steps ?? fromRow.current!.rows;
  const current = rows.find((s) => s.state === 'current')?.id ?? null;
  const at = (id: StopId | null) => rows.findIndex((s) => s.id === id);

  // Steps he opened with the pointer that stay open while he opens one further down; they count
  // only while the pick is the one his click made (a key or the address moves it: nothing kept).
  const [kept, setKept] = useState<{ for: StopId | null; ids: StopId[] }>(NONE_KEPT);
  const keptNow = kept.for === pick ? kept.ids : [];
  useEffect(() => { if (kept.for !== pick && kept.ids.length) setKept(NONE_KEPT); }, [kept, pick]);
  const open = new Set<StopId>([...keptNow, ...(pick ? [pick] : []), ...(current ? [current] : [])]);

  const click = (id: StopId, el: HTMLElement) => {
    // Those above the step he opens stay open; those below it close.
    const ids = [...keptNow, ...(pick ? [pick] : [])].filter((k, i, all) => k !== id && k !== current && all.indexOf(k) === i && at(k) < at(id));
    setKept({ for: id, ids });
    onStep(id, el);
  };

  return (
    <nav className="jp2-st" aria-label="Steps">
      {rows.map((s, i) => {
        const isOpen = open.has(s.id);
        const word = stepWord(s, steps ? state : null);
        const dur = isOpen && steps ? durationOf(s) : null;
        const main = steps ? stepMain(s) : null;
        const shown = main?.kind === 'not-yet' && sameTarget(main, target);
        return (
          <div key={s.id} className="jp2-step">
            <button
              type="button"
              className={`jp2-row jp2-st-row is-${s.state}${isOpen ? ' is-open' : ''}${shown ? ' is-sel' : ''}${cursor === i ? ' is-cursor' : ''}`}
              data-jp-line={i}
              aria-expanded={isOpen}
              onClick={(e) => click(s.id, e.currentTarget)}
            >
              <span className="jp2-st-mark" aria-hidden="true">{s.state === 'done' ? <Icon name="check" size={14} /> : s.state === 'current' ? <i className="jp2-dot" /> : s.state === 'skipped' ? <Icon name="minus" size={14} /> : <i className="jp2-ring" />}</span>
              <span className="jp2-st-name">{s.label}</span>
              {dur && <span className="jp2-st-dur">{dur}</span>}
              {word && <span className="jp2-st-word">{word}</span>}
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
              <p className="jp2-st-none">{s.state === 'skipped' ? 'Skipped for this job' : 'Nothing yet'}</p>
            ))}
          </div>
        );
      })}
    </nav>
  );
});
