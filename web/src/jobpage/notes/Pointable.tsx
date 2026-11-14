// Point, then say (R4, Task 17): every block in the reader can be pointed at: a plan step, a spec
// paragraph or acceptance line, a diff line, a finding, a check, a paragraph of a Foreman message, a
// decision. ReaderBody wraps every view in Pointable, so each view gets it without knowing.
//
// - Hovering a block shows a `+` in its left margin. The `+` sits over the margin (absolutely placed
//   in the reader's scroll area, never inside the block), so it never changes a line's height or moves
//   a word. A click on it, a text selection inside one block, or `n` with the pointer on a block opens
//   the note box in place under it (NoteBox.tsx) with `Change`, `Drop this` and `Explain`. On the phone,
//   with no pointer to hover, a tap on a block opens the box as a sheet.
// - `Change` and `Drop this` add a note to the message box's chips (notes/chips.ts); nothing is sent.
// - `Explain` asks at once (POST …/send, a Notes (1) block with an [explain] note; while a reply runs the
//   message waits for it, R8) and the answer opens beside the block as a margin note when the Foreman's
//   reply brings it (useExplainAnswers reads `1. done · explained · …` from the reply after it).
// - A block with a note carries a thin mark in its margin. A chip's click asks the reader for its place
//   (store seek): the view opens, the block is scrolled to and flashed; a block a newer version removed
//   is not found, and a line says so (the note stays and still goes, about the version he pointed at).
// - What he types in an open box stays while the job changes under it: the box keeps its own words and
//   its place, and a body that lands again only moves the marks.
//
// The place each note names is the Foreman's to read (dashboard/lib/notes-block.js): the document and
// its version, then the step, line or heading (`Implementation plan v2 · step 4 "Add the filter"`), a
// file and line with its commit for a diff line, the finding, the check, the decision, or the message.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ApiError } from '../../api/client';
import { useKeyScope } from '../../app/keyRegistry';
import { readHref, replaceHash } from '../../app/router';
import { Button } from '../../components/Button';
import { useWorkshop } from '../../state/store';
import { explainedAnswer } from '../../../../dashboard/lib/notes-block.js';
import type { BlockAnchor, Explained, JobPageState } from '../jobStore';
import { sendRefusal } from '../left/MessageBox';
import { setPick } from '../reader/branch';
import { titleOf } from '../reader/TitleRow';
import type { JobPagePayload, ReaderTarget, ThreadLine } from '../types';
import { useJob, useJobStore } from '../useJob';
import { addNote, composeFor, goneFrom, nextNoteN, oneLine } from './chips';
import { NoteBox, type NoteCall } from './NoteBox';

// ---------- Blocks ----------

const PROSE_BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, tr, pre, blockquote';
/** The blocks that are not text set by Prose: a diff line, a finding, a check, a decision. */
const OWN_BLOCK = '.jp2-dl:not(.is-hunk), .jp2-fd, .jp2-fd-flat, .jp2-rec-r, .jp2-dec';
/** Every block a note can be on (for finding one again by its words; diff lines go by their key). */
const CANDIDATES = ['.jp2-fd, .jp2-fd-flat, .jp2-rec-r, .jp2-dec', ...PROSE_BLOCK.split(', ').map((t) => `.jp2-prose ${t}`)].join(', ');
const SKIP = '[data-pt-skip], .jp2-cv-line, .jp2-doc-ol, .jp2-rv-top, input, textarea, select';

/** The block an element is in, or null (outside any, or in the page's own controls). */
export function blockOf(el: Element | null): HTMLElement | null {
  if (!el || el.closest(SKIP)) return null;
  const own = el.closest<HTMLElement>(OWN_BLOCK);
  if (own) return own;
  if (!el.closest('.jp2-prose')) return null;
  let b = el.closest<HTMLElement>(PROSE_BLOCK);
  if (!b || !b.closest('.jp2-prose')) return null;
  // A paragraph inside a list item is that item; a cell is its row.
  if (b.tagName === 'P' && b.parentElement?.tagName === 'LI') b = b.parentElement;
  return b;
}

const words = (el: Element | null | undefined) => oneLine(el?.textContent);
const cutWords = (s: string, most: number) => (s.length > most ? `${s.slice(0, most - 1).trimEnd()}…` : s);
const firstWords = (s: string, n: number) => { const w = s.split(' '); return w.length > n ? `${w.slice(0, n).join(' ')}…` : s; };
const STEP = /^(?:step|task|phase|part)\s*(\d+[a-z]?)\b[\s:.)–—-]*(.*)$/i;
/** A plan's own step ids (`S1: …`, `T4. …`) and requirement ids (`FR-003 …`, `AC-12: …`). */
const STEP_ID = /^([ST]\d+[a-z]?)\s*[:.)–—-]\s*(.*)$/;
const REQ_ID = /^([A-Z]{1,4}-\d+)\b\s*[:.)–—-]?\s*(.*)$/;

/** A heading that names a step or an item by its id: how a place says it (`step 4 "…"`, `step S1 "…"`, `AC-12 "…"`). */
function namedHeading(ht: string): { where: string; short: string } | null {
  const quoted = (t: string) => (t ? ` "${t}"` : '');
  let m = STEP.exec(ht);
  if (m) return { where: `step ${m[1]}${quoted(m[2])}`, short: `step ${m[1]}` };
  m = STEP_ID.exec(ht);
  if (m) return { where: `step ${m[1]}${quoted(m[2])}`, short: `step ${m[1]}` };
  m = REQ_ID.exec(ht);
  if (m) return { where: `${m[1]}${quoted(m[2])}`, short: m[1] };
  return null;
}
const isHeading = (el: Element) => /^H[1-6]$/.test(el.tagName);

/** A document's own title: a heading that opens its text and names no step (`Implementation plan v2: …`). */
const isTitle = (h: Element, root: Element) => h === root.firstElementChild && !namedHeading(words(h));

/** The nearest heading at or before a block inside its text (the document's own title is not one). */
function headingOf(b: HTMLElement, root: Element): HTMLElement | null {
  if (isHeading(b)) return b;
  let last: HTMLElement | null = null;
  for (const h of root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
    if (h.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) { if (!isTitle(h, root)) last = h; }
    else break;
  }
  return last;
}

/** How many of `sel` come after `from` (or the start) up to and including `b`, inside `root`. */
function countTo(b: HTMLElement, root: Element, from: HTMLElement | null, sel: string): number {
  let n = 0;
  for (const el of root.querySelectorAll<HTMLElement>(sel)) {
    if (from && !(from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (el.closest('li') && el.tagName === 'P') continue;
    n++;
    if (el === b) return n;
  }
  return n;
}

/** Where a block of text is: the step, the line, the heading, as the Foreman reads it, and its short form for the chip. */
export function whereIn(b: HTMLElement, docName = ''): { where: string; short: string } {
  const root = b.closest('.jp2-prose') ?? b.ownerDocument.body;
  const h = headingOf(b, root);
  const ht = h ? cutWords(words(h), 60) : '';
  const step = ht ? namedHeading(ht) : null;
  if (b === h) return step ?? { where: `heading "${ht}"`, short: `"${firstWords(ht, 4)}"` };
  const under = step ? step.where : ht ? `"${ht}"` : '';
  const underShort = step ? step.short : ht ? `"${firstWords(ht, 4)}"` : '';
  const join = (a: string, c: string) => (a ? `${a} · ${c}` : c);
  if (b.tagName === 'LI') {
    const list = b.parentElement;
    const n = list ? [...list.children].filter((c) => c.tagName === 'LI').indexOf(b) + 1 : 1;
    // A line with its own id (`AC-6: …`, `FR-003 …`) is named by it.
    const own = REQ_ID.exec(words(b));
    if (own) return { where: `${own[1]} "${firstWords(own[2], 8)}"`, short: own[1] };
    if (/acceptance/i.test(ht) || /acceptance/i.test(docName)) return { where: `acceptance line ${n}`, short: `acceptance line ${n}` };
    if (!step && list?.tagName === 'OL' && (!ht || /\b(steps?|tasks?)\b/i.test(ht))) {
      return { where: `step ${n} "${firstWords(words(b), 8)}"`, short: `step ${n}` };
    }
    return { where: join(under, `line ${n}`), short: join(underShort, `line ${n}`).replace(' · ', ' ') };
  }
  if (b.tagName === 'TR') {
    const n = b.parentElement ? [...b.parentElement.children].indexOf(b) + 1 : 1;
    return { where: join(under, `table row ${n}`), short: join(underShort, `row ${n}`).replace(' · ', ' ') };
  }
  if (b.tagName === 'PRE') return { where: join(under, 'code block'), short: join(underShort, 'code').replace(' · ', ' ') };
  const n = countTo(b, root, h, 'p, blockquote');
  return { where: join(under, `paragraph ${n}`), short: join(underShort, `paragraph ${n}`).replace(' · ', ' ') };
}

/** What a message line is called in a place. */
function messageName(l: ThreadLine | undefined): { name: string; short: string } {
  if (!l) return { name: 'A message', short: 'Message' };
  const h = `"${cutWords(oneLine(l.headline), 60)}"`;
  if (l.kind === 'brief') return { name: `Brief ${h}`, short: 'Brief' };
  if (l.mine || l.kind === 'you') return { name: `My message ${h}`, short: 'My message' };
  return { name: `Foreman reply ${h}`, short: 'Reply' };
}

/** What a reader view is called in a place (a document with its version). */
function sourceOf(t: ReaderTarget, p: JobPagePayload | null): { name: string; short: string } {
  if (t.kind === 'message' || t.kind === 'brief') return messageName(p?.thread.find((l) => l.id === t.id));
  const head = titleOf(t, p);
  if (t.kind === 'doc') {
    const v = /^v[\w.]+/.exec(head.meta ?? '')?.[0];
    return { name: v ? `${head.title} ${v}` : head.title, short: head.title };
  }
  return { name: head.title, short: head.title };
}

/** A pointed block, as a note names it. */
export interface Spot {
  target: ReaderTarget;
  place: string;
  chip: string;
  quote: string;
  block: BlockAnchor;
}

/** The hash of the body a target's block lives in, now (a document's, the findings', …), or null. */
function hashNow(t: ReaderTarget, s: JobPageState): string | null {
  const p = s.payload;
  if (!p) return null;
  if (t.kind === 'doc') {
    for (const st of p.steps) for (const o of [...st.outputs, ...(st.more ?? [])]) if (o.kind === 'doc' && o.id === t.id) return o.hash ?? s.bodies[t.id]?.version ?? null;
    return s.bodies[t.id]?.version ?? null;
  }
  if (t.kind === 'findings') return p.hashes?.findings ?? null;
  if (t.kind === 'decisions') return p.hashes?.decisions ?? null;
  if (t.kind === 'ticket') return p.hashes?.ticket ?? null;
  return null;
}

/** A diff line's own key (a diff line is found by it, not by its words). */
const dlKey = (sha: string, path: string, ln: string) => `dl:${sha}:${path}:${ln}`;

/** Describe a block for a note: its place, the chip's words, the words it holds, and how to find it again. */
export function describeBlock(b: HTMLElement, view: ReaderTarget, s: JobPageState): Spot {
  const text = words(b);
  const anchor = (target: ReaderTarget, key: string | null = null): BlockAnchor => {
    const doc = target.kind === 'doc' ? s.payload?.steps.flatMap((x) => [...x.outputs, ...(x.more ?? [])]).find((o) => o.kind === 'doc' && o.id === target.id) : undefined;
    return { text: text.slice(0, 300), version: doc?.version ?? null, hash: hashNow(target, s), ...(key ? { key } : {}) };
  };
  if (b.classList.contains('jp2-dl')) {
    const df = b.closest<HTMLElement>('[data-sha][data-path]');
    const sha = df?.dataset.sha ?? '';
    const short = df?.dataset.short ?? sha.slice(0, 7);
    const path = df?.dataset.path ?? '';
    const name = path.split('/').pop() ?? path;
    const ln = b.dataset.ln ?? '';
    const quote = text.replace(/^[+ -]/, '').trim();
    const removed = b.classList.contains('is-del');
    const where = ln ? `${path}:${ln}` : `${path}, a removed line`;
    const target: ReaderTarget = { kind: 'changes', id: 'changes' };
    const index = ln || `x${[...(b.parentElement?.children ?? [])].indexOf(b)}`;
    return { target, place: `${where}${removed && ln ? ' (removed)' : ''} (commit ${short})`, chip: ln ? `${name}:${ln}` : `${name} removed line`, quote, block: anchor(target, dlKey(sha, path, index)) };
  }
  if (b.classList.contains('jp2-fd') || b.classList.contains('jp2-fd-flat')) {
    const sev = words(b.querySelector('.jp2-fd-sev'));
    const w = words(b.querySelector('.jp2-fd-w'));
    const t: ReaderTarget = { kind: 'findings', id: 'findings' };
    return { target: t, place: `Findings · ${[sev, w].filter(Boolean).join(' · ')}`, chip: `Finding ${w || sev}`.trim(), quote: words(b.querySelector('.jp2-fd-t')) || text, block: anchor(t) };
  }
  if (b.classList.contains('jp2-rec-r')) {
    const id = words(b.querySelector('.jp2-rec-id'));
    const t: ReaderTarget = { kind: 'checks', id: 'recording' };
    return { target: t, place: `Recording · check ${id}`, chip: `Check ${id}`, quote: words(b.querySelector('.jp2-rec-t')) || text, block: anchor(t) };
  }
  if (b.classList.contains('jp2-dec')) {
    const what = words(b.querySelector('.jp2-dec-what'));
    const id = /^([A-Z]+-\d+)\s*·\s*/.exec(what);
    const t: ReaderTarget = { kind: 'decisions', id: 'decisions' };
    return { target: t, place: `Decisions · ${id ? id[1] : `"${firstWords(what, 6)}"`}`, chip: `Decision ${id ? id[1] : ''}`.trim(), quote: id ? what.slice(id[0].length) : what, block: anchor(t) };
  }
  // Text set by Prose: in the conversation, the message it is in; else the view's own thing.
  const item = b.closest<HTMLElement>('.jp2-cv-item[data-id]');
  const line = item ? s.payload?.thread.find((l) => l.id === item.dataset.id) : undefined;
  const target: ReaderTarget = line ? { kind: line.kind === 'brief' ? 'brief' : 'message', id: line.id } : view;
  const src = line ? messageName(line) : sourceOf(view, s.payload);
  const { where, short } = whereIn(b, src.name);
  return { target, place: `${src.name} · ${where}`, chip: `${src.short} ${short}`, quote: text, block: anchor(target) };
}

/** A note's block in a view, by its key or its words; null when it is not there (now). */
export function findBlock(root: ParentNode, note: { target: ReaderTarget | null; block?: BlockAnchor | null }): HTMLElement | null {
  const a = note.block;
  if (!a) return null;
  if (a.key?.startsWith('dl:')) {
    const [, sha, ...rest] = a.key.split(':');
    const ln = rest.pop() ?? '';
    const path = rest.join(':');
    const df = [...root.querySelectorAll<HTMLElement>('[data-sha][data-path]')].find((d) => d.dataset.sha === sha && d.dataset.path === path);
    if (!df) return null;
    if (ln.startsWith('x')) return (df.querySelectorAll<HTMLElement>('.jp2-dl')[Number(ln.slice(1))] ?? null);
    return df.querySelector<HTMLElement>(`.jp2-dl[data-ln="${CSS.escape(ln)}"]`);
  }
  const t = note.target;
  const scope = t && (t.kind === 'message' || t.kind === 'brief') ? root.querySelector(`.jp2-cv-item[data-id="${CSS.escape(t.id)}"]`) ?? root : root;
  const want = a.text;
  for (const el of scope.querySelectorAll<HTMLElement>(CANDIDATES)) {
    const b = blockOf(el);
    if (b === el && words(el).slice(0, 300) === want) return el;
  }
  return null;
}

// ---------- Where things sit ----------

interface Box { top: number; left: number; width: number; height: number }
/** A block's box in the reader's scroll area (where the `+`, the note box and the margin notes are placed). */
function boxIn(el: Element, host: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  return { top: r.top - h.top + host.scrollTop - host.clientTop, left: r.left - h.left + host.scrollLeft - host.clientLeft, width: r.width, height: r.height };
}
const NOTE_BOX_W = 380;
const MARGIN_W = 240;

/** Whether this reader is the phone's (a tap on a block opens the sheet; there is no hover). */
const onPhone = (el: Element | null) => Boolean(el?.closest('.jp2[data-layout="phone"]'));

// ---------- Explain's answers ----------

/** The run statuses that mean the Foreman is replying right now. */
const ACTIVE = new Set(['starting', 'running', 'waiting_permission', 'stopping']);

/**
 * Reads each Explain's answer from the Foreman's reply after it (once the reply has ended), and keeps
 * it with the Explain. The message box calls it, so answers are read wherever he is on the page.
 */
export function useExplainAnswers() {
  const store = useJobStore();
  const thread = useJob((s) => s.payload?.thread);
  const busy = useJob((s) => ACTIVE.has(s.payload?.run?.status ?? ''));
  const explains = useJob((s) => s.explains);
  useEffect(() => {
    const open = explains.filter((e) => e.answer === null && e.line === null);
    if (!open.length || !thread) return undefined;
    let off = false;
    void (async () => {
      for (const ex of open) {
        const at = ex.after ? thread.findIndex((l) => l.id === ex.after) : -1;
        if (ex.after && at < 0) continue;
        for (let i = at + 1; i < thread.length; i++) {
          const l = thread[i];
          if (l.kind !== 'reply') continue;
          // The reply still being written is read when it has ended.
          if (busy && i === thread.length - 1) break;
          const body = await store.loadBody(l.id);
          if (off || !body) return;
          const answer = explainedAnswer(body.text);
          store.setExplains(store.getState().explains.map((e) => (e.n === ex.n ? { ...e, answer, line: l.id } : e)));
          break;
        }
      }
    })();
    return () => { off = true; };
  }, [store, thread, busy, explains]);
}

// ---------- The component ----------

export interface PointableProps {
  /** The reader's scroll area (ReaderBody's): it hears the pointer, and the `+`, the box and the margin notes are placed in it. */
  hostRef: RefObject<HTMLDivElement | null>;
  /** The reader's thing (`<kind>:<id>`, ReaderBody's place). */
  place: string;
  /** The view's body is shown (a seek that finds nothing then says so). */
  ready: boolean;
  children?: ReactNode;
}

const targetOfPlace = (place: string): ReaderTarget => {
  const i = place.indexOf(':');
  return { kind: place.slice(0, i) as ReaderTarget['kind'], id: place.slice(i + 1) };
};
const sameT = (a: ReaderTarget | null, b: ReaderTarget | null) => !!a && !!b && a.kind === b.kind && a.id === b.id;
/** Whether a note (or Explain) belongs in this view. */
const inView = (t: ReaderTarget | null, view: ReaderTarget) => sameT(t, view) || (view.kind === 'conversation' && (t?.kind === 'message' || t?.kind === 'brief'));

interface Open { spot: Spot; at: { top: number; left: number } | null; sheet: boolean; el: HTMLElement | null }

export function Pointable({ hostRef, place, ready, children }: PointableProps) {
  const store = useJobStore();
  const { api } = useWorkshop();
  const view = useMemo(() => targetOfPlace(place), [place]);
  const [hover, setHover] = useState<{ el: HTMLElement; top: number; left: number } | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [lost, setLost] = useState<{ words: string; top: number } | null>(null);
  const [margins, setMargins] = useState<{ ex: Explained; top: number; left: number; side: boolean }[]>([]);
  const [tick, setTick] = useState(0);
  const [refused, setRefused] = useState<Record<number, string>>({});
  const notes = useJob((s) => s.ui.notes);
  const explains = useJob((s) => s.explains);
  const seek = useJob((s) => s.seek);
  const slug = useJob((s) => s.slug);

  const host = () => hostRef.current;
  // The scroll area's ref is set after this part's first layout pass (a parent's ref comes after its
  // children's effects): one more pass once it is there, so marks and margin notes show on arrival.
  const [attached, setAttached] = useState(false);
  useEffect(() => { setAttached(true); }, []);

  // The `+` goes while an inner column (the diff) scrolls, or the pointer leaves the reader; a width change places the margin notes again.
  useEffect(() => {
    const h = host();
    if (!h) return undefined;
    const away = () => setHover(null);
    const onScroll = (e: Event) => { if (e.target !== h) setHover(null); };
    h.addEventListener('mouseleave', away);
    h.addEventListener('scroll', onScroll, true);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => setTick((n) => n + 1)) : null;
    ro?.observe(h);
    return () => { h.removeEventListener('mouseleave', away); h.removeEventListener('scroll', onScroll, true); ro?.disconnect(); };
  }, []);

  const openOn = useCallback((el: HTMLElement, quote?: string) => {
    const h = host();
    const spot = describeBlock(el, view, store.getState());
    if (quote) spot.quote = oneLine(quote);
    const sheet = onPhone(el);
    let at: Open['at'] = null;
    if (h && !sheet) {
      const b = boxIn(el, h);
      at = { top: b.top + b.height + 4, left: Math.max(8, Math.min(b.left, h.clientWidth - NOTE_BOX_W - 8)) };
    }
    setOpen({ spot, at, sheet, el });
    setHover(null);
  }, [view, store]);

  // The open box's block is marked while the box is open.
  useEffect(() => {
    const el = open?.el;
    if (!el) return undefined;
    el.setAttribute('data-pt-marked', '');
    return () => el.removeAttribute('data-pt-marked');
  }, [open?.el]);

  function onMouseMove(e: MouseEvent) {
    const t = e.target as Element;
    if (t.closest?.('.jp2-pt-plus')) return;
    const b = blockOf(t);
    if (!b) return;
    if (hover?.el === b) return;
    const h = host();
    if (!h || onPhone(h)) return;
    const box = boxIn(b, h);
    setHover({ el: b, top: box.top + (b.classList.contains('jp2-dl') ? 0 : 3), left: Math.max(2, box.left - 26) });
  }

  function onMouseUp(e: MouseEvent) {
    if ((e.target as Element).closest?.(SKIP)) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const quote = oneLine(sel.toString());
    if (quote.length < 2) return;
    const from = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement ?? null;
    const b = blockOf(from);
    if (!b || !host()?.contains(b)) return;
    openOn(b, quote);
  }

  function onClick(e: MouseEvent) {
    // The phone has no hover: a tap on a block (not on a link or a control) opens the sheet.
    const t = e.target as Element;
    if (!onPhone(t) || t.closest('a, button, input, textarea, select, summary, label, video')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const b = blockOf(t);
    if (b) openOn(b);
  }

  // The pointer, heard on the reader's scroll area (no box of its own around the view).
  const heard = useRef({ onMouseMove, onMouseUp, onClick });
  heard.current = { onMouseMove, onMouseUp, onClick };
  useEffect(() => {
    const h = host();
    if (!h) return undefined;
    const move = (e: MouseEvent) => heard.current.onMouseMove(e);
    const up = (e: MouseEvent) => heard.current.onMouseUp(e);
    const click = (e: MouseEvent) => heard.current.onClick(e);
    h.addEventListener('mousemove', move);
    h.addEventListener('mouseup', up);
    h.addEventListener('click', click);
    return () => { h.removeEventListener('mousemove', move); h.removeEventListener('mouseup', up); h.removeEventListener('click', click); };
  }, []);

  useKeyScope('jobpage', {
    'jp-note': () => {
      if (!hover || !hover.el.isConnected) return false;
      openOn(hover.el);
    },
  });

  /** Ask the Foreman at once; the margin note says it is asked, then shows the answer. */
  async function explain(spot: Spot, words: string) {
    const s = store.getState();
    const after = s.payload?.thread.at(-1)?.id ?? null;
    const ex: Omit<Explained, 'n'> = { target: spot.target, place: spot.place, quote: spot.quote, block: spot.block, after, answer: null, line: null };
    const n = nextNoteN(s.ui.notes, s.explains);
    store.setExplains([...s.explains, { ...ex, n }]);
    const text = composeFor([{ n, kind: 'explain', target: spot.target, place: spot.place, chip: spot.chip, quote: spot.quote, note: words }], '');
    const path = `/api/job/${encodeURIComponent(slug)}/send`;
    try {
      try {
        await api.post(path, { kind: 'message', text });
      } catch (err) {
        // The Foreman is replying: it waits for the reply to end (R8; on this computer only).
        if (!(err instanceof ApiError && err.status === 409 && !err.body.code && /still working/i.test(err.message)) || api.hosted?.()) throw err;
        await api.post(path, { kind: 'message', text, queue: true });
      }
    } catch (err) {
      setRefused((r) => ({ ...r, [n]: sendRefusal(err).replace('Your words are back in the box; send them', 'Ask again') }));
    }
  }

  function onNote(call: NoteCall, words: string) {
    if (!open) return;
    const { spot } = open;
    setOpen(null);
    if (call === 'explain') { void explain(spot, words); return; }
    const s = store.getState();
    store.setNotes(addNote(s.ui.notes, { kind: call, target: spot.target, place: spot.place, chip: spot.chip, quote: spot.quote, note: words, block: spot.block }, s.explains));
  }

  // Marks: each block with a note in this view; Explains' margin notes, placed beside their blocks.
  useLayoutEffect(() => {
    const root = host();
    const h = root;
    if (!root || !h) return;
    for (const el of root.querySelectorAll('[data-pt-noted]')) el.removeAttribute('data-pt-noted');
    for (const n of notes) {
      if (!inView(n.target, view) || n.kind === 'pin') continue;
      findBlock(root, n)?.setAttribute('data-pt-noted', '');
    }
    const shown: typeof margins = [];
    for (const ex of explains) {
      if (!inView(ex.target, view)) continue;
      const b = findBlock(root, ex);
      if (!b) continue;
      const box = boxIn(b, h);
      const prose = b.closest('.jp2-prose');
      // Beside the text it is about (over a document's outline column if it must: the answer matters more there).
      const right = prose ? boxIn(prose, h).left + boxIn(prose, h).width : box.left + box.width;
      const side = !onPhone(h) && right + 24 + MARGIN_W <= h.clientWidth;
      shown.push(side ? { ex, top: box.top, left: right + 24, side } : { ex, top: box.top + box.height + 4, left: Math.max(8, box.left), side });
    }
    setMargins((was) => (was.length === shown.length && was.every((m, i) => m.ex === shown[i].ex && m.top === shown[i].top && m.left === shown[i].left) ? was : shown));
  }, [children, notes, explains, view, tick, ready, attached]);

  // A chip asked for its place: open → scroll to the block and flash it; not there → say so.
  useLayoutEffect(() => {
    if (!seek) return;
    const s = store.getState();
    const note = s.ui.notes.find((n) => n.n === seek.n);
    if (!note || !inView(note.target, view) || note.kind === 'pin') return;
    const root = host();
    const h = root;
    if (!root || !h) return;
    // A diff line: its commit and file first.
    const key = note.block?.key;
    if (key?.startsWith('dl:')) {
      const [, sha, ...rest] = key.split(':');
      rest.pop();
      const path = rest.join(':');
      const df = root.querySelector<HTMLElement>('[data-sha][data-path]');
      if (!df || df.dataset.sha !== sha || df.dataset.path !== path) { setPick(store, { sha, path }); return; }
    }
    const b = findBlock(root, note);
    if (b) {
      store.setSeek(null);
      setLost(null);
      b.scrollIntoView?.({ block: 'center' });
      b.removeAttribute('data-pt-flash');
      void b.offsetWidth;
      b.setAttribute('data-pt-flash', '');
      setTimeout(() => b.removeAttribute('data-pt-flash'), 900);
      return;
    }
    if (!ready) return;
    store.setSeek(null);
    const gone = s.payload ? goneFrom(note, s.payload, s.bodies) : null;
    const was = note.block?.version ? ` v${note.block.version}` : '';
    setLost({
      words: gone
        ? `${gone}: the part this note points at was taken out. The note stays, and still goes about the version you pointed at${was ? ` (${was.trim()})` : ''}.`
        : 'That part isn’t shown here now. The note stays, and still goes as you wrote it.',
      top: h.scrollTop + 8,
    });
  }, [seek, children, ready, view, store, attached]);

  const dropExplain = (n: number) => {
    store.setExplains(store.getState().explains.filter((e) => e.n !== n));
    setRefused((r) => { const x = { ...r }; delete x[n]; return x; });
  };
  const openReply = (id: string) => {
    const t: ReaderTarget = { kind: 'message', id };
    store.setReader(t);
    replaceHash(readHref(slug, t));
  };

  return (
    <>
      {children}
      {hover && hover.el.isConnected && !open && (
        <button
          type="button"
          className="jp2-pt-plus"
          data-pt-skip=""
          style={{ top: hover.top, left: hover.left }}
          aria-label="Add a note here"
          title="Add a note here (n): Change, Drop this or Explain"
          onClick={() => openOn(hover.el)}
        >
          +
        </button>
      )}
      {open && (
        <NoteBox
          key={`${open.spot.place}|${open.spot.quote}`}
          place={open.spot.place}
          quote={open.spot.quote ? (open.spot.quote.length > 140 ? `${open.spot.quote.slice(0, 139)}…` : open.spot.quote) : null}
          sheet={open.sheet}
          at={open.at}
          onNote={onNote}
          onClose={() => setOpen(null)}
        />
      )}
      {lost && (
        <p className="jp2-pt-lost" role="status" data-pt-skip="" style={{ top: lost.top }}>
          {lost.words}
          <Button kind="quiet" size="sm" icon="x" iconOnly aria-label="Close this line" title="Close this line." onClick={() => setLost(null)} />
        </p>
      )}
      {margins.map(({ ex, top, left, side }) => (
        <aside key={ex.n} className={`jp2-pt-mnote${side ? ' is-side' : ''}`} data-pt-skip="" style={{ top, left }} aria-label="The Foreman’s answer">
          <p className="jp2-pt-mnote-h">
            Explain · the Foreman
            <Button kind="quiet" size="sm" icon="x" iconOnly aria-label="Close this answer" title="Close this answer." onClick={() => dropExplain(ex.n)} />
          </p>
          {refused[ex.n] ? <p className="jp2-pt-mnote-no" role="alert">{refused[ex.n]}</p>
            : ex.answer ? <p>{ex.answer}</p>
              : ex.line ? <p>The Foreman answered in its reply. <button type="button" className="link-button" onClick={() => openReply(ex.line!)}>Read the reply</button></p>
                : <p className="jp2-dim">Asked. The answer opens here when the Foreman replies.</p>}
        </aside>
      ))}
    </>
  );
}
