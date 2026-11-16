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
// `What changed since v2` (Task 18, R5): on a document shown as it is now that has an older version;
// pressed, the reader marks the lines added and removed since that version (DocView).
//
// `Older` (a short menu in groups, the one ticked is the one shown):
//   - a document with older versions (the job's versions/ folder, lib/doc-versions.js): `Older
//     versions`, the one now first, then its older ones newest first;
//   - a document of a step that has reader-only documents: the step's documents and those, under
//     `Rounds and lenses` on Review (the combined review's lens rounds, review facts and second looks),
//     else `More from <step>`;
//   - a brief: `Earlier briefs of this step` (each earlier round of the step's ask), newest first.
// An older version's previous and next walk its document's versions.
// A pick from either goes through the page's own pick (the address follows, under 1100 px it stays
// over the left pane).

import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { sinceWords } from '../left/YourMove';
import { CONVERSATION, DECISIONS, DETAILS, OUTPUT_READER, outputTarget, sameTarget, TICKET } from '../targets';
import type { JobPagePayload, Output, ReaderKind, ReaderTarget, StepRow, ThreadLine } from '../types';
import { useJob, useJobStore } from '../useJob';
import { newestOlder, setShowChanges, useShowChanges } from './docDiff';

export interface Head { title: string; meta: string | null }
export interface Place { target: ReaderTarget; label: string; meta?: string | null }
export interface OlderGroup { label: string; items: Place[] }
/** What `Older` lists, in groups (older versions; rounds and lenses; earlier briefs). */
export type OlderList = OlderGroup[];

const TITLES: Partial<Record<ReaderKind, string>> = {
  conversation: 'Conversation', ticket: 'Ticket and goal', decisions: 'Decisions', details: 'Details', changes: 'Changes',
  checks: 'Checks and recording', findings: 'Findings', walkthrough: 'Walkthrough', screens: 'Screens', ship: 'Ship', permission: 'Permission', 'not-yet': 'Not yet',
  picture: 'Pasted picture',
};

const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ') || null;
const steps = (p: JobPagePayload | null): StepRow[] => p?.steps ?? [];
const docsOf = (s: StepRow): Output[] => [...s.outputs, ...(s.more ?? [])];
const vOf = (o: Output) => (o.version ? `v${o.version}` : null);
export const placeKey = (t: ReaderTarget) => `${t.kind}:${t.id}`;

/** The reader target of a conversation line. */
export const lineTarget = (l: ThreadLine): ReaderTarget => ({ kind: l.kind === 'brief' ? 'brief' : 'message', id: l.id });

interface Found { step: StepRow; out: Output; more: boolean; version: { n: string; id: string } | null }
/** The step that lists this document (its outputs first, then any step's `more`), and the output; for
 *  an older version (versions/…), the document it is a version of. */
function docStep(p: JobPagePayload | null, id: string): Found | null {
  for (const s of steps(p)) { const out = s.outputs.find((o) => o.kind === 'doc' && o.id === id); if (out) return { step: s, out, more: false, version: null }; }
  for (const s of steps(p)) { const out = (s.more ?? []).find((o) => o.id === id); if (out) return { step: s, out, more: true, version: null }; }
  for (const s of steps(p)) {
    for (const o of docsOf(s)) {
      const version = (o.versions ?? []).find((v) => v.id === id);
      if (version) return { step: s, out: o, more: !s.outputs.includes(o), version };
    }
  }
  return null;
}

/** A document's versions, the one shown now first, then its older ones (newest first). */
const versionsOf = (o: Output): Place[] => [
  { target: outputTarget(o), label: o.version ? `v${o.version}` : 'Now', meta: 'now' },
  ...(o.versions ?? []).map((v) => ({ target: { kind: 'doc' as const, id: v.id }, label: `v${v.n}`, meta: null })),
];

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
    if (found?.version) return { title: found.out.label, meta: join([`v${found.version.n}`, 'an older version', found.step.label, sinceWords(updatedAt)]) };
    if (found) return { title: found.out.label, meta: join([vOf(found.out), found.step.label, sinceWords(updatedAt)]) };
    return { title: t.id.split('/').pop() ?? t.id, meta: sinceWords(updatedAt) };
  }
  if (t.kind === 'pr') return { title: `PR #${t.id}`, meta: null };
  if (t.kind === 'picture') return { title: `Pasted picture ${t.id.replace(/^p/, '')}`, meta: 'click it to drop a pin with a note' };
  if (t.kind === 'not-yet') {
    const step = steps(p).find((x) => x.id === t.id);
    const meta = !step ? null : step.state === 'skipped' ? 'skipped for this job' : step.state === 'current' ? 'under way' : step.state === 'done' ? 'done' : 'not started';
    return { title: step?.label ?? 'Not yet', meta };
  }
  if (t.kind === 'conversation') return { title: 'Conversation', meta: p ? `${p.rows.conversation.count} items` : null };
  if (t.kind === 'decisions') return { title: 'Decisions', meta: p ? `${p.rows.decisions.count} made for you` : null };
  if (t.kind === 'ticket') return { title: 'Ticket and goal', meta: p?.key ?? null };
  if (t.kind === 'details') return { title: 'Details', meta: 'every piece of work, newest first' };
  if (t.kind === 'changes' || t.kind === 'checks' || t.kind === 'findings') {
    // What the step made, named as the left pane names it (Checks, Recording, Your hand test).
    for (const s of steps(p)) {
      const out = s.outputs.find((o) => o.id === t.id && OUTPUT_READER[o.kind] === t.kind);
      if (out) return { title: out.label, meta: out.meta };
    }
  }
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
    // An older version walks its document's versions (previous: newer, next: older).
    if (found?.version) return versionsOf(found.out);
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

/** The older versions, rounds and earlier briefs of this target, or null when it has none. */
export function olderOf(t: ReaderTarget, p: JobPagePayload | null): OlderList | null {
  if (t.kind === 'brief') {
    const thread = p?.thread ?? [];
    const at = thread.findIndex((l) => l.id === t.id);
    if (at < 0) return null;
    // Only the earlier briefs of its step (each earlier round of the step's ask), newest first.
    const earlier = thread.slice(0, at).filter((l) => l.kind === 'brief' && l.step === thread[at].step).reverse();
    return earlier.length ? [{ label: 'Earlier briefs of this step', items: earlier.map((l) => ({ target: lineTarget(l), label: l.headline, meta: sinceWords(l.at) })) }] : null;
  }
  if (t.kind === 'doc') {
    const found = docStep(p, t.id);
    if (!found) return null;
    const groups: OlderGroup[] = [];
    if ((found.out.versions ?? []).length) groups.push({ label: 'Older versions', items: versionsOf(found.out) });
    const step = found.more || (found.step.more ?? []).length > 0 ? found.step : null;
    const items = step ? docsOf(step).filter((o) => o.kind === 'doc').map((o) => ({ target: outputTarget(o), label: o.label, meta: vOf(o) })) : [];
    if (step && items.length >= 2) groups.push({ label: step.id === 'review' ? 'Rounds and lenses' : `More from ${step.label}`, items });
    return groups.length ? groups : null;
  }
  return null;
}

const sameHead = (a: Head, b: Head) => a.title === b.title && a.meta === b.meta;
const samePlace = (a: Place | null, b: Place | null) => a === b || (!!a && !!b && sameTarget(a.target, b.target) && a.label === b.label);
const sameNeighbours = (a: ReturnType<typeof neighbours>, b: ReturnType<typeof neighbours>) => samePlace(a.prev, b.prev) && samePlace(a.next, b.next);
const sameGroup = (a: OlderGroup, b: OlderGroup) => a.label === b.label && a.items.length === b.items.length && a.items.every((x, i) => samePlace(x, b.items[i]) && x.meta === b.items[i].meta);
const sameOlder = (a: OlderList | null, b: OlderList | null) => a === b || (!!a && !!b && a.length === b.length && a.every((g, i) => sameGroup(g, b[i])));

export interface TitleRowProps {
  /** What the reader shows; null before the payload names it. */
  target: ReaderTarget | null;
  /** The words before there is a target (the job's title from the Jobs row). */
  fallback: string;
  onOpen(t: ReaderTarget, from?: HTMLElement | null): void;
}

export const TitleRow = memo(function TitleRow({ target, fallback, onOpen }: TitleRowProps) {
  // Each part reads only what it shows: a new conversation line elsewhere redraws none of it.
  // The conversation's count is its own part (ConversationItems): a new line draws that, not this row.
  const convo = target?.kind === 'conversation';
  const head = useJob((s) => (target ? titleOf(target, s.payload, target.kind === 'doc' ? updatedOf(s.bodies[target.id]?.meta) : null) : null), (a, b) => a === b || (!!a && !!b && (convo ? a.title === b.title && !a.meta === !b.meta : sameHead(a, b))));
  const near = useJob((s) => (target ? neighbours(target, s.payload) : { prev: null, next: null }), sameNeighbours);
  const older = useJob((s) => (target ? olderOf(target, s.payload) : null), sameOlder);
  return (
    <div className="jp2-rv-top">
      <div className="jp2-rv-tt">
        <h2 className="jp2-rv-title">{head?.title ?? fallback}</h2>
        {convo ? <ConversationItems /> : head?.meta && <span className="jp2-rv-meta">{head.meta}</span>}
      </div>
      {target?.kind === 'doc' && <SinceToggle id={target.id} />}
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

/** The conversation's `n items` in the title row: drawn by itself when a line arrives. */
const ConversationItems = memo(function ConversationItems() {
  const n = useJob((s) => s.payload?.rows.conversation.count ?? null);
  return n === null ? null : <span className="jp2-rv-meta">{n} items</span>;
});

/** `What changed since v2` (R5, Task 18): on a document shown as it is now that has an older version; pressed, the reader marks the lines added and removed since. */
function SinceToggle({ id }: { id: string }) {
  const store = useJobStore();
  const older = useJob((s) => newestOlder(s.payload, id), (a, b) => a === b || (!!a && !!b && a.n === b.n && a.id === b.id));
  const on = useShowChanges(store, id);
  if (!older) return null;
  return (
    <Button kind="quiet" size="sm" className="jp2-rv-since" aria-pressed={on} title={on ? 'Show the document as it is now.' : `Mark the lines added and removed since v${older.n}.`} onClick={() => setShowChanges(store, id, !on)}>
      What changed since v{older.n}
    </Button>
  );
}

const updatedOf = (meta: Record<string, unknown> | undefined): string | null => (typeof meta?.updatedAt === 'string' ? meta.updatedAt : null);

/** A pick from Older just opened another target: the Older drawn for it takes the focus (its button is a new one). */
let olderPicked = false;

/** `Older`: a short menu under the button. ↓ ↑ move, Esc closes and gives the focus back, a click outside or Tab closes it. */
function Older({ list, current, onOpen }: { list: OlderList; current: ReaderTarget; onOpen: TitleRowProps['onOpen'] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = () => [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
  useEffect(() => {
    if (!olderPicked) return;
    olderPicked = false;
    button.current?.focus();
  }, []);
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
      <Button ref={button} kind="quiet" size="sm" aria-haspopup="menu" aria-expanded={open} title={`${list.map((g) => g.label).join(', ')}: open one`} onClick={() => setOpen((o) => !o)}>
        Older<Icon name="chevron-down" size={14} />
      </Button>
      {open && (
        <div className="menu jp2-rv-older-menu" role="menu" aria-label="Older" data-keys-wait="">
          {list.map((g, gi) => (
            <div key={g.label} role="group" aria-label={g.label}>
              {gi > 0 && <div className="menu-sep" role="separator" />}
              <div className="menu-heading" aria-hidden="true">{g.label}</div>
              {g.items.map((it) => {
                const on = sameTarget(it.target, current);
                return (
                  <button key={placeKey(it.target)} type="button" role="menuitemradio" aria-checked={on} className="menu-item" onClick={(e) => { setOpen(false); button.current?.focus(); if (!on) { olderPicked = true; onOpen(it.target, e.currentTarget); setTimeout(() => { olderPicked = false; }, 0); } }}>
                    {on ? <Icon name="check" size={16} /> : <span className="menu-icon-gap" aria-hidden="true" />}
                    <span className="menu-label">{it.label}</span>
                    {it.meta && <span className="jp2-rv-older-meta">{it.meta}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
