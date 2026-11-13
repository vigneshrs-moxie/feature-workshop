// The reader's title row (job page rebuild, Task 12; design brief "The reader"): the same thin row over
// every view. What it is; a dim line with its version, its step, who wrote it and when; `Older` when
// there are older rounds or other versions of it; previous and next.
//
// Previous and next walk:
//   - a message or a brief: the conversation, item by item (small events left out);
//   - a document only the reader reaches (a step's `more`: lens rounds, review facts, second looks):
//     that step's documents;
//   - anything else: what the steps made, in order (each step that has started: its outputs, then its
//     main output), then Ticket and goal, Conversation, Decisions, Details.
// They stop at the ends (they do not wrap round).
//
// `Older` (a short menu, the one ticked is the one shown):
//   - a brief: every brief of its step (each round of the step's ask), newest first;
//   - a document of a step that has reader-only documents: the step's documents and those, under
//     `Rounds and lenses` on Review (the combined review's lens rounds, review facts and second looks),
//     else `More from <step>`.
// A pick from either goes through the page's own pick (the address follows, under 1100 px it stays
// over the left pane).

import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { sinceWords } from '../left/YourMove';
import { CONVERSATION, DECISIONS, DETAILS, outputTarget, sameTarget, TICKET } from '../targets';
import type { JobPagePayload, Output, ReaderKind, ReaderTarget, StepRow, ThreadLine } from '../types';
import { useJob } from '../useJob';

export interface Head { title: string; meta: string | null }
export interface Place { target: ReaderTarget; label: string; meta?: string | null }
export interface OlderList { label: string; items: Place[] }

const TITLES: Partial<Record<ReaderKind, string>> = {
  conversation: 'Conversation', ticket: 'Ticket and goal', decisions: 'Decisions', details: 'Details', changes: 'Changes',
  checks: 'Checks and recording', findings: 'Findings', walkthrough: 'Walkthrough', ship: 'Ship', permission: 'Permission', 'not-yet': 'Not yet',
};

const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ') || null;
const steps = (p: JobPagePayload | null): StepRow[] => p?.steps ?? [];
const docsOf = (s: StepRow): Output[] => [...s.outputs, ...(s.more ?? [])];
const vOf = (o: Output) => (o.version ? `v${o.version}` : null);
export const placeKey = (t: ReaderTarget) => `${t.kind}:${t.id}`;

/** The reader target of a conversation line. */
export const lineTarget = (l: ThreadLine): ReaderTarget => ({ kind: l.kind === 'brief' ? 'brief' : 'message', id: l.id });

/** The step that lists this document (its outputs first, then any step's `more`), and the output. */
function docStep(p: JobPagePayload | null, id: string): { step: StepRow; out: Output; more: boolean } | null {
  for (const s of steps(p)) { const out = s.outputs.find((o) => o.kind === 'doc' && o.id === id); if (out) return { step: s, out, more: false }; }
  for (const s of steps(p)) { const out = (s.more ?? []).find((o) => o.id === id); if (out) return { step: s, out, more: true }; }
  return null;
}

/** The title row's words: what it is, and its dim line. `updatedAt`: a document body's time, once it is held. */
export function titleOf(t: ReaderTarget, p: JobPagePayload | null, updatedAt: string | null = null): Head {
  const stepLabel = (id: string | null) => (id ? steps(p).find((s) => s.id === id)?.label ?? null : null);
  if (t.kind === 'message' || t.kind === 'brief') {
    const line = p?.thread.find((l) => l.id === t.id);
    if (!line) return { title: t.kind === 'brief' ? 'Brief' : 'Message', meta: null };
    const when = sinceWords(line.at);
    if (t.kind === 'brief') return { title: line.headline, meta: when };
    const who = line.mine ? 'You' : line.kind === 'reply' ? 'Foreman' : line.kind === 'problem' ? 'A problem' : null;
    return { title: line.headline, meta: join([who, stepLabel(line.step), when]) };
  }
  if (t.kind === 'doc') {
    const found = docStep(p, t.id);
    if (found) return { title: found.out.label, meta: join([vOf(found.out), found.step.label, sinceWords(updatedAt)]) };
    return { title: t.id.split('/').pop() ?? t.id, meta: sinceWords(updatedAt) };
  }
  if (t.kind === 'pr') return { title: `PR #${t.id}`, meta: null };
  if (t.kind === 'not-yet') {
    const step = steps(p).find((x) => x.id === t.id);
    const meta = !step ? null : step.state === 'skipped' ? 'skipped for this job' : step.state === 'current' ? 'under way' : step.state === 'done' ? 'done' : 'not started';
    return { title: step?.label ?? 'Not yet', meta };
  }
  if (t.kind === 'conversation') return { title: 'Conversation', meta: p ? `${p.rows.conversation.count} items` : null };
  if (t.kind === 'decisions') return { title: 'Decisions', meta: p ? `${p.rows.decisions.count} made for you` : null };
  if (t.kind === 'ticket') return { title: 'Ticket and goal', meta: p?.key ?? null };
  if (t.kind === 'details') return { title: 'Details', meta: 'every piece of work, newest first' };
  return { title: TITLES[t.kind] ?? 'Reader', meta: null };
}

/** What the steps made, in order, then the job's four rows. */
function stepOrder(p: JobPagePayload | null): Place[] {
  const out: Place[] = [];
  const seen = new Set<string>();
  const add = (target: ReaderTarget, label: string) => {
    const k = placeKey(target);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ target, label });
  };
  for (const s of steps(p)) {
    if (s.state === 'todo' || s.state === 'skipped') continue;
    for (const o of s.outputs) add(outputTarget(o), o.label);
    if (s.main.kind !== 'not-yet') add(s.main, titleOf(s.main, p).title);
  }
  for (const t of [TICKET, CONVERSATION, DECISIONS, DETAILS]) add(t, titleOf(t, p).title);
  return out;
}

/** The list previous and next move in for this target (see the head of this file). */
export function orderOf(t: ReaderTarget, p: JobPagePayload | null): Place[] {
  if (t.kind === 'message' || t.kind === 'brief') return (p?.thread ?? []).filter((l) => l.kind !== 'small').map((l) => ({ target: lineTarget(l), label: l.headline }));
  if (t.kind === 'doc') {
    const found = docStep(p, t.id);
    if (found?.more) return docsOf(found.step).filter((o) => o.kind === 'doc').map((o) => ({ target: outputTarget(o), label: o.label }));
  }
  return stepOrder(p);
}

export function neighbours(t: ReaderTarget, p: JobPagePayload | null): { prev: Place | null; next: Place | null } {
  const list = orderOf(t, p);
  const at = list.findIndex((x) => sameTarget(x.target, t));
  if (at < 0) return { prev: null, next: null };
  return { prev: list[at - 1] ?? null, next: list[at + 1] ?? null };
}

/** The older rounds and other versions of this target, or null when it has none. */
export function olderOf(t: ReaderTarget, p: JobPagePayload | null): OlderList | null {
  if (t.kind === 'brief') {
    const line = p?.thread.find((l) => l.id === t.id);
    if (!line) return null;
    const same = (p?.thread ?? []).filter((l) => l.kind === 'brief' && l.step === line.step);
    if (same.length < 2) return null;
    return { label: 'Briefs for this step', items: same.reverse().map((l) => ({ target: lineTarget(l), label: l.headline, meta: sinceWords(l.at) })) };
  }
  if (t.kind === 'doc') {
    const found = docStep(p, t.id);
    const step = found && (found.more || (found.step.more ?? []).length > 0) ? found.step : null;
    if (!step) return null;
    const items = docsOf(step).filter((o) => o.kind === 'doc').map((o) => ({ target: outputTarget(o), label: o.label, meta: vOf(o) }));
    if (items.length < 2) return null;
    return { label: step.id === 'review' ? 'Rounds and lenses' : `More from ${step.label}`, items };
  }
  return null;
}

const sameHead = (a: Head, b: Head) => a.title === b.title && a.meta === b.meta;
const samePlace = (a: Place | null, b: Place | null) => a === b || (!!a && !!b && sameTarget(a.target, b.target) && a.label === b.label);
const sameNeighbours = (a: ReturnType<typeof neighbours>, b: ReturnType<typeof neighbours>) => samePlace(a.prev, b.prev) && samePlace(a.next, b.next);
const sameOlder = (a: OlderList | null, b: OlderList | null) => a === b || (!!a && !!b && a.label === b.label && a.items.length === b.items.length && a.items.every((x, i) => samePlace(x, b.items[i]) && x.meta === b.items[i].meta));

export interface TitleRowProps {
  /** What the reader shows; null before the payload names it. */
  target: ReaderTarget | null;
  /** The words before there is a target (the job's title from the Jobs row). */
  fallback: string;
  onOpen(t: ReaderTarget, from?: HTMLElement | null): void;
}

export const TitleRow = memo(function TitleRow({ target, fallback, onOpen }: TitleRowProps) {
  // Each part reads only what it shows: a new conversation line elsewhere redraws none of it.
  const head = useJob((s) => (target ? titleOf(target, s.payload, target.kind === 'doc' ? updatedOf(s.bodies[target.id]?.meta) : null) : null), (a, b) => a === b || (!!a && !!b && sameHead(a, b)));
  const near = useJob((s) => (target ? neighbours(target, s.payload) : { prev: null, next: null }), sameNeighbours);
  const older = useJob((s) => (target ? olderOf(target, s.payload) : null), sameOlder);
  return (
    <div className="jp2-rv-top">
      <div className="jp2-rv-tt">
        <h2 className="jp2-rv-title">{head?.title ?? fallback}</h2>
        {head?.meta && <span className="jp2-rv-meta">{head.meta}</span>}
      </div>
      {target && older && <Older key={placeKey(target)} list={older} current={target} onOpen={onOpen} />}
      {target && (
        <div className="jp2-rv-nav">
          <Button kind="quiet" size="sm" iconOnly icon="chevron-left" aria-label={near.prev ? `Previous: ${near.prev.label}` : 'Previous'} title={near.prev ? `Previous: ${near.prev.label}` : 'This is the first one.'} disabled={!near.prev} onClick={(e) => { if (near.prev) onOpen(near.prev.target, e.currentTarget); }} />
          <Button kind="quiet" size="sm" iconOnly icon="chevron-right" aria-label={near.next ? `Next: ${near.next.label}` : 'Next'} title={near.next ? `Next: ${near.next.label}` : 'This is the last one.'} disabled={!near.next} onClick={(e) => { if (near.next) onOpen(near.next.target, e.currentTarget); }} />
        </div>
      )}
    </div>
  );
});

const updatedOf = (meta: Record<string, unknown> | undefined): string | null => (typeof meta?.updatedAt === 'string' ? meta.updatedAt : null);

/** `Older`: a short menu under the button. ↓ ↑ move, Esc closes and gives the focus back, a click outside or Tab closes it. */
function Older({ list, current, onOpen }: { list: OlderList; current: ReaderTarget; onOpen: TitleRowProps['onOpen'] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = () => [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
  useEffect(() => {
    if (!open) return undefined;
    (items().find((i) => i.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus();
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  function onKeyDown(e: KeyboardEvent) {
    if (!open) return;
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); button.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); all[(at + 1) % all.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); all[(at - 1 + all.length) % all.length]?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  }
  return (
    <div ref={box} className="menu-box jp2-rv-older" onKeyDown={onKeyDown}>
      <Button ref={button} kind="quiet" size="sm" aria-haspopup="menu" aria-expanded={open} title={`${list.label}: open another`} onClick={() => setOpen((o) => !o)}>
        Older<Icon name="chevron-down" size={14} />
      </Button>
      {open && (
        <div className="menu jp2-rv-older-menu" role="menu" aria-label={list.label} data-keys-wait="">
          <div className="menu-heading" aria-hidden="true">{list.label}</div>
          {list.items.map((it) => {
            const on = sameTarget(it.target, current);
            return (
              <button key={placeKey(it.target)} type="button" role="menuitemradio" aria-checked={on} className="menu-item" onClick={(e) => { setOpen(false); if (!on) onOpen(it.target, e.currentTarget); }}>
                {on ? <Icon name="check" size={16} /> : <span className="menu-icon-gap" aria-hidden="true" />}
                <span className="menu-label">{it.label}</span>
                {it.meta && <span className="jp2-rv-older-meta">{it.meta}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
