// Stacks on the other pages:
//   - Jobs: a stack is one card with four dots for Plan, Build, Merge and Push (not the seven
//     stops); "3 parts ▾" opens its parts in a small list laid over the card (the card keeps its
//     size, so nothing in the lanes moves; Esc or a click elsewhere closes it), and the card opens
//     the Stack page. Its
//     parts' own jobs don't get cards of their own (useStackIndex says which jobs are parts). Like
//     a job's card it keeps its place while the pointer is over the board, then slides to its new
//     lane in 200 ms (data-flip-key, lib/flip.ts; still with reduced motion).
//   - A part's Job page says "Part 2 of <stack>" with a link; the stack's own job says it is one.
//   - The Foreman's suggestion: when its first brief says a ticket looks big enough for a stack
//     (status.json stack_suggested), the Job page says so in a line, with "Run as a stack instead".
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Job, StackSummary } from '../../api/types';
import { jobHref, stackHref } from '../../app/router';
import { Icon } from '../../components/Icon';
import { relativeTime } from '../../lib/time';
import { useWorkshop } from '../../state/store';
import { StepDots } from './StacksPage';
import { PART, parts, summaryChip } from './stackModel';
import { useStacksList } from './useStacks';
import './stack.css';

export interface StackIndex {
  /** The stack whose own job (the coordinator's) has this slug. */
  stackOf(slug: string): StackSummary | null;
  /** The stack and the part number when this job is a part of a stack. */
  partOf(slug: string): { stack: StackSummary; n: number } | null;
}

export function indexStacks(stacks: readonly StackSummary[]): StackIndex {
  const own = new Map(stacks.map((s) => [s.slug, s]));
  const parts = new Map<string, { stack: StackSummary; n: number }>();
  for (const s of stacks) for (const p of s.sections ?? []) parts.set(p.slug ?? `${s.slug}--${p.name}`, { stack: s, n: p.n });
  return { stackOf: (slug) => own.get(slug) ?? null, partOf: (slug) => parts.get(slug) ?? null };
}

/** Which jobs are stacks and which are parts of one (empty while the list loads, or without stacks). */
export function useStackIndex(): StackIndex {
  const { list } = useStacksList();
  return useMemo(() => indexStacks(list?.stacks ?? []), [list]);
}

/** A stack's card on Jobs, in the same dress as a job's card. */
export function StackJobCard({ job, stack, now, play }: { job: Job; stack: StackSummary; now: Date; play: 'full' | 'subtle' | 'off' }) {
  const chip = summaryChip(stack);
  const running = stack.counts.running ?? 0;
  const at = stack.phase === 'pushed' ? 'pushed' : stack.steps.find((s) => s.state === 'now')?.label ?? 'Push';
  const t = job.waitingSince ?? job.updatedAt ?? null;
  const working = chip.tone === 'working' && running > 0;
  const parts_ = useRef<HTMLDetailsElement>(null);
  const [partsOpen, setPartsOpen] = useState(false);
  // The parts list lies over the card; Esc or a click anywhere else closes it.
  useEffect(() => {
    if (!partsOpen) return;
    const close = () => { if (parts_.current) parts_.current.open = false; };
    const onDown = (e: PointerEvent) => { if (!parts_.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); };
  }, [partsOpen]);
  return (
    <li data-flip-key={job.slug} className={`job-card stack-card play-${play}`}>
      <div className="job-card-top">
        {play === 'full' && <span className={`job-light${working ? ' is-on' : ''}${working ? ' is-blink' : ''}`} aria-hidden="true" />}
        <a className="job-card-title" href={stackHref(stack.slug)} title={`Open the Stack page of ${stack.title || job.title || stack.slug}.`}>{stack.title || job.title || stack.slug}</a>
      </div>
      <StepDots steps={stack.steps} label="Stack" />
      <span className="job-readout">{['Stack', at.toLowerCase(), running ? `${running} of ${stack.parts} running` : parts(stack.parts)].join(' · ')}</span>
      <details ref={parts_} className="stack-card-parts" onToggle={(e) => setPartsOpen(e.currentTarget.open)}>
        <summary title={`Show the ${PART.many} of this stack.`}>{parts(stack.parts)}</summary>
        <ol>
          {(stack.sections ?? []).map((p) => (
            <li key={p.name}>
              <span className="part-n">{p.n}</span>
              {p.slug ? <a href={jobHref(p.slug)}>{p.name}</a> : <span>{p.name}</span>}
              <span className="muted">{p.stateWords}</span>
            </li>
          ))}
        </ol>
      </details>
      <div className="job-card-foot">
        <span className={`chip state-chip is-${chip.tone}`}><Icon name={chip.tone === 'needs-you' ? 'hand' : chip.tone === 'done' ? 'circle-check' : 'loader'} size={14} /> {chip.word}</span>
        {t && <span className="muted">{relativeTime(t, now)}</span>}
      </div>
    </li>
  );
}

/** On a job's page: "Part 2 of <stack>" for a part, "A stack of 3 parts" for the stack's own job. */
export function PartOfStack({ slug, index }: { slug: string; index: StackIndex }) {
  const part = index.partOf(slug);
  if (part) {
    return (
      <a className="chip part-of-stack" href={stackHref(part.stack.slug)} title={`This job is ${PART.one} ${part.n} of a stack. Open the stack’s page.`}>
        <Icon name="layers" size={14} /> {PART.one.charAt(0).toUpperCase()}{PART.one.slice(1)} {part.n} of {part.stack.ticketKey ? `stack ${part.stack.ticketKey}` : part.stack.title || part.stack.slug} ›
      </a>
    );
  }
  const own = index.stackOf(slug);
  if (own) {
    return (
      <a className="chip part-of-stack" href={stackHref(own.slug)} title="This job runs as a stack: open its Stack page to see the parts.">
        <Icon name="layers" size={14} /> A stack of {parts(own.parts)} ›
      </a>
    );
  }
  return null;
}

/** The words sent to the Foreman by "Run as a stack instead". */
export const RUN_AS_STACK_TEXT = 'Run this as a stack instead: you are its coordinator. Write stack.md (the parts, the files each one owns, what each waits for, and the order they merge in) and stop for my approval on the Stack page.';

/** The Foreman thinks the ticket is big enough for a stack: say so, with one button. */
export function StackSuggestion({ job, index }: { job: Job; index: StackIndex }) {
  const { api } = useWorkshop();
  const [sent, setSent] = useState<'no' | 'sending' | 'yes'>('no');
  const [problem, setProblem] = useState<string | null>(null);
  const why = typeof job.stackSuggested === 'string' && job.stackSuggested.trim() ? job.stackSuggested.trim() : null;
  if (!why || index.stackOf(job.slug) || index.partOf(job.slug)) return null;
  async function run() {
    setSent('sending');
    setProblem(null);
    try {
      await api.post(`/api/job/${encodeURIComponent(job.slug)}/send`, { kind: 'message', text: RUN_AS_STACK_TEXT });
      setSent('yes');
    } catch (err) {
      setSent('no');
      setProblem(err instanceof Error ? err.message : String(err));
    }
  }
  return (
    <section className="stack-suggest" aria-label="The Foreman suggests a stack">
      <Icon name="layers" size={18} />
      <p>
        <b>The Foreman thinks this ticket is big enough for a stack.</b> {why}{' '}
        <span className="muted">A stack splits the work into parts that are built side by side, then joined in order.</span>
      </p>
      {sent === 'yes'
        ? <span className="muted" role="status">Sent. The Foreman writes the stack’s plan next.</span>
        : <button type="button" className="btn" disabled={sent === 'sending'} onClick={() => void run()} title="Tell the Foreman to split the work into parts that are built side by side, then joined in order.">Run as a stack instead</button>}
      {problem && <p className="field-problem" role="alert">{problem}</p>}
    </section>
  );
}
