// While a decision waits (a laptop; 16 Nov), the reader beside the decision opens on the brief, and
// this row above it switches between what the decision is about: the brief, then what the picked step
// (else the current one) made (Findings at a review, the plan, the changes, Ship's PR lines…), then the
// spec. It stands in for the step panel there. One click, no hunting; the decision stays where it is.

import { memo } from 'react';
import { outputTarget, readerBesideConvo, sameTarget } from '../targets';
import type { JobPagePayload, ReaderTarget } from '../types';
import { useJob } from '../useJob';

interface Tab { t: ReaderTarget; label: string; meta: string | null }

/** The brief the decision comes from: the page's own `open` when it is a brief, else the newest brief. */
function briefTab(p: JobPagePayload): Tab | null {
  const line = p.open.kind === 'brief' ? p.thread.find((l) => l.id === p.open.id) : [...p.thread].reverse().find((l) => l.kind === 'brief');
  if (!line) return null;
  return { t: { kind: 'brief', id: line.id }, label: line.headline.split(' · ')[0] || 'Brief', meta: null };
}

/** The brief a waiting decision comes from (the first tab): what a second pick of another tab goes back to. */
export function briefTarget(p: JobPagePayload | null): ReaderTarget | null {
  return p ? briefTab(p)?.t ?? null : null;
}

/** The tabs: the brief, then what the picked step (else the current one) made, then the spec. */
export function tabsOf(p: JobPagePayload | null, picked: string | null = null): Tab[] {
  if (!p) return [];
  const tabs: Tab[] = [];
  const brief = briefTab(p);
  if (brief) tabs.push(brief);
  const now = p.steps.find((s) => s.id === picked) ?? p.steps.find((s) => s.state === 'current');
  // Ship's PR lines are its main view (the reader's Ship); its other outputs are tabs.
  if (now?.id === 'ship' && now.main.kind !== 'not-yet') tabs.push({ t: now.main, label: 'PR lines', meta: null });
  else if (now && now.outputs.length === 0 && now.main.kind !== 'not-yet') tabs.push({ t: now.main, label: now.label, meta: now.word });
  for (const o of now?.outputs ?? []) if (o.kind !== 'pr') tabs.push({ t: outputTarget(o), label: o.label, meta: o.meta });
  const spec = p.steps.find((s) => s.id === 'spec')?.main;
  if (spec && spec.kind !== 'not-yet' && now?.id !== 'spec' && !tabs.some((x) => sameTarget(x.t, spec))) tabs.push({ t: spec, label: 'Spec', meta: null });
  return tabs.slice(0, 6);
}

export interface DecideTabsProps {
  onOpen(t: ReaderTarget, from?: HTMLElement | null): void;
}

export const DecideTabs = memo(function DecideTabs({ onOpen }: DecideTabsProps) {
  const payload = useJob((s) => s.payload);
  const picked = useJob((s) => s.ui.step);
  const target = useJob(readerBesideConvo, sameTarget);
  const tabs = tabsOf(payload, picked);
  if (tabs.length < 2) return null;
  return (
    <div className="jp2-dtabs" role="tablist" aria-label="About this decision">
      {tabs.map((x) => {
        const on = sameTarget(x.t, target);
        return (
          <button key={`${x.t.kind}:${x.t.id}`} type="button" role="tab" aria-selected={on} data-jp-toggle="" className={`jp2-dtab${on ? ' is-on' : ''}`} onClick={(e) => onOpen(x.t, e.currentTarget)}>
            {x.label}
            {x.meta && <span className="jp2-dtab-meta">{x.meta}</span>}
          </button>
        );
      })}
    </div>
  );
});
