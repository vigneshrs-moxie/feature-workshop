// The phone's step screen (plan Task 15; design brief "Phone": "Step screen: what that step produced,
// one row each"). At #/job/<slug>/stage/<stop> on the phone: a back row naming the job (`‹ ORBIT-905`),
// the step's name, where it stands (`Done · 1 h 10 min`, `Needs you · since Fri 3:29 PM`, `Not yet`),
// then each thing it made, the latest of each, one row each with its version and a ›; a row opens
// that thing on the reader screen. The rows are the laptop's (the payload's outputs, as Steps lists
// the current step's), for every step. Before the payload: the name and the state from the snapshot.
// It takes the focus when it opens; Escape is its Back.

import { memo, useEffect, useMemo, useRef } from 'react';
import type { Job } from '../../api/types';
import { Button } from '../../components/Button';
import { STOPS } from '../../components/stops/stops';
import { slugKey, STATE_WORDS } from '../left/Header';
import { durationOf, outMeta, stepsFromRow } from '../left/Steps';
import { outputTarget } from '../targets';
import type { JobState, ReaderTarget, StepRow, StopId } from '../types';
import { useJob } from '../useJob';
import { PhoneChevron } from './PhoneJob2';

/** Where a step stands, in one word, with how long it took (or since when the current one runs). */
export function stepStanding(step: StepRow, state: JobState | null): string {
  const word = step.state === 'done' ? 'Done'
    : step.state === 'skipped' ? 'Skipped'
      : step.state === 'todo' ? 'Not yet'
        : state ? STATE_WORDS[state] : 'Now';
  const dur = step.state === 'done' || step.state === 'current' ? durationOf(step) : null;
  return dur ? `${word} · ${dur}` : word;
}

export interface PhoneStepProps {
  id: StopId;
  /** The Jobs snapshot's row (the first paint). */
  job: Job | null;
  onBack(): void;
  /** Open a thing on the reader screen. */
  onOpen(t: ReaderTarget, from: HTMLElement): void;
}

export const PhoneStep = memo(function PhoneStep({ id, job, onBack, onOpen }: PhoneStepProps) {
  const steps = useJob((s) => s.payload?.steps ?? null);
  const state = useJob((s) => s.payload?.state ?? null);
  const key = useJob((s) => s.payload?.key) ?? (job ? slugKey(job.slug) : null);
  const fromRow = useMemo(() => stepsFromRow(job), [job]);
  const step = (steps ?? fromRow).find((s) => s.id === id) ?? null;
  const label = step?.label ?? STOPS.find((s) => s.id === id)?.label ?? id;
  const here = useRef<HTMLElement>(null);
  useEffect(() => { here.current?.focus(); }, [id]);

  return (
    <section
      ref={here}
      className="jp2-ps"
      aria-label="Step"
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onBack(); } }}
    >
      <div className="jp2-pback">
        <Button kind="quiet" icon="chevron-left" onClick={onBack} aria-label={`Back to the job: ${key ?? 'the job'}`} title="Back to the job.">{key ?? 'Job'}</Button>
      </div>
      <div className="jp2-ps-scroll">
        <div className="jp2-ps-head">
          <h2 className="jp2-ps-title">{label}</h2>
          {step && <p className="jp2-ps-state">{stepStanding(step, steps ? state : null)}</p>}
        </div>
        {steps && step && (step.outputs.length > 0 ? (
          <ul className="jp2-ps-outs">
            {step.outputs.map((o) => {
              const t = outputTarget(o);
              const meta = outMeta(o);
              return (
                <li key={`${o.kind}:${o.id}`}>
                  <button type="button" className="jp2-row jp2-ps-out" onClick={(e) => onOpen(t, e.currentTarget)}>
                    <span className="jp2-out-label">{o.label}</span>
                    {meta && <span className="jp2-out-meta">{meta}</span>}
                    <PhoneChevron />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="jp2-ps-none">Nothing yet</p>
        ))}
      </div>
    </section>
  );
});
