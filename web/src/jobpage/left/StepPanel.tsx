// The step panel (the glance layout of 16 Nov; docs/superpowers/specs/2026-11-16-job-page-glance-layout-design.md):
// on a laptop, beside the reader, what the picked step did at a glance: its name and result, how long
// it took (or since when it runs), and every thing it made as a row that opens in the reader. The Ship
// step lists its PR lines. The step is his pick, else the one whose thing the reader shows, else the
// job's current step. Before the payload lands it is empty (the steps row above already paints).

import { memo } from 'react';
import { outputTarget, readerBesideConvo, sameTarget } from '../targets';
import type { ReaderTarget, StepRow } from '../types';
import { useJob } from '../useJob';
import { durationOf, outMeta, owns, ShipOutputs, stepWord } from './Steps';

export interface StepPanelProps {
  onOpen(t: ReaderTarget, from: HTMLElement): void;
}

export const StepPanel = memo(function StepPanel({ onOpen }: StepPanelProps) {
  const steps = useJob((s) => s.payload?.steps ?? null);
  const state = useJob((s) => s.payload?.state ?? null);
  const pick = useJob((s) => s.ui.step);
  const target = useJob(readerBesideConvo, sameTarget);
  if (!steps) return <aside className="jp2-sp" aria-label="This step" />;
  const step = steps.find((s) => s.id === pick) ?? steps.find((s) => owns(s, target)) ?? steps.find((s) => s.state === 'current') ?? steps[0];
  const word = stepWord(step, state);
  const dur = durationOf(step);
  return (
    <aside className="jp2-sp" aria-label="This step">
      <p className="jp2-sp-head">
        <span className="jp2-sp-name">{step.label}</span>
        {word && <span className="jp2-sp-word">{word}</span>}
      </p>
      {dur && <p className="jp2-sp-dur">{dur}</p>}
      <p className="jp2-sp-h">What it made</p>
      {step.id === 'ship' ? <ShipOutputs step={step} target={target} onOpen={onOpen} /> : <Outputs list={step.outputs} target={target} onOpen={onOpen} empty={emptyWords(step)} />}
      {(step.more?.length ?? 0) > 0 && (
        // Earlier rounds and each reviewer's own file: folded, so the glance stays on what it made.
        <details className="jp2-sp-more">
          <summary className="jp2-sp-h">{`Also ${step.more!.length}`}</summary>
          <Outputs list={step.more ?? []} target={target} onOpen={onOpen} empty="" />
        </details>
      )}
    </aside>
  );
});

function emptyWords(step: StepRow): string {
  if (step.state === 'todo') return 'Not started yet.';
  if (step.state === 'skipped') return 'This job skips this step.';
  if (step.state === 'current') return 'Nothing yet.';
  return 'Nothing written.';
}

function Outputs({ list, target, onOpen, empty }: { list: StepRow['outputs']; target: ReaderTarget | null; onOpen: StepPanelProps['onOpen']; empty: string }) {
  if (list.length === 0) return empty ? <p className="jp2-sp-none">{empty}</p> : null;
  return (
    <ul className="jp2-st-outs jp2-sp-outs">
      {list.map((o) => {
        const t = outputTarget(o);
        const meta = outMeta(o);
        return (
          <li key={`${o.kind}:${o.id}`}>
            <button type="button" className={`jp2-row jp2-st-out${sameTarget(t, target) ? ' is-sel' : ''}`} aria-pressed={sameTarget(t, target)} data-jp-toggle="" onClick={(e) => onOpen(t, e.currentTarget)}>
              <span className="jp2-out-label">{o.label}</span>
              {meta && <span className="jp2-out-meta">{meta}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
