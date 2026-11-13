// The conversation in the reader (job page rebuild, Task 13; plan "Decisions already made" 3, design
// brief "The conversation, made readable"): a record to consult, not a feed to scroll.
//
// - One line per item: a Foreman reply's line is its first bold sentence, his message's its first
//   sentence, a brief's `Brief #15 · Review · answered: Go` (`answered by Auto: Go` when Auto said it;
//   the server writes the headline). Who wrote it is told by position and tint, not a word: his are
//   indented and tinted, the Foreman's flush left and plain (a message Auto sent for him sits on his
//   side and says `Auto`).
// - Grouped under the step it happened in, with the day (`Review · Tuesday`), in the job's order.
//   Small events (notes, his permission answers, routine steps) are not lines: each group ends with
//   `n small events` in dim text, which opens them.
// - A click on a line opens the item in place, under its line; a second click folds it. `Open all in
//   this step` opens (then folds) every item of that step.
// - On arrival the last exchange (his last message and what came after it) is open, a `New` line
//   marks where the lines newer than his last look start, and the view is scrolled to them, unless
//   it has a scroll place of its own from an earlier visit (ReaderBody keeps it).
// - A filter box narrows the lines as he types (by their headlines: most bodies are not fetched, so a
//   search in them would find only some); `Jump to latest` goes to the end.
//
// Nothing he reads moves (speed rule 3). The browser's own scroll anchoring is off for this list
// (jobpage.css), and the view keeps one anchor itself: the line under the pointer, else the one he
// last clicked, else the first line in view. After anything changes the list (a new message, an item
// opened or folded, a body that lands late, Open all), the anchor is put back where it was on screen.
// A new message adds a folded line at the end and never pulls the view down to it.
//
// Fast on a long job (speed rules 2 and 5): only lines are drawn, each a memoised row; a body is
// fetched and drawn only for an open item (useBody), so 200 items cost 200 lines and two bodies.
//
// His last look is the browser's `sb.convo.seen.<slug>` (left/JobRows.tsx seenKey, the old page's
// key): while the view can be seen (the page in front, the reader not behind the left pane) the
// newest line's time is written there, only ever forward, as the old ConversationPanel does, so the
// job row's `· N new` clears. The `New` line keeps to his look from before this view.

import { createContext, memo, useCallback, useContext, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { readStored, writeStored } from '../../lib/stored';
import { seenKey } from '../left/JobRows';
import type { ReaderTarget, StepRow, StopId, ThreadLine } from '../types';
import { useJob, useJobStore } from '../useJob';
import { prepareMessage, Prose } from './Prose';
import { hasPlace, NotLoaded, ReaderBody, useBody } from './ReaderBody';

const PLACE = 'conversation:conversation';
/** How much of what came before stays above the last exchange when the view scrolls to it on arrival. */
const CONTEXT_PX = 120;
const EMPTY: ReadonlySet<string> = new Set();

export interface ConversationViewProps {
  searchRef: RefObject<HTMLInputElement | null>;
  onOpen(t: ReaderTarget, from?: HTMLElement | null): void;
}

// ---------- Groups ----------

export interface Group {
  /** Stable while lines are added after it: `g:` and its first line's id. */
  key: string;
  step: StopId | null;
  /** The step's name and the day: `Review`, `Tuesday`. */
  label: string;
  day: string;
  lines: ThreadLine[];
  small: ThreadLine[];
}

const isMain = (l: ThreadLine) => l.kind !== 'small';
const dayKey = (at: string | null) => {
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** The day in words, seen from `now`: Today, Yesterday, a weekday this past week, else the weekday and date. */
export function dayWords(at: string | null, now: Date = new Date()): string {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return fmt('weekday', { weekday: 'long' }).format(d);
  return fmt('date', { weekday: 'long', day: 'numeric', month: 'short' }).format(d);
}

// One formatter each, made once: a new one per line costs more than drawing the line.
const formats = new Map<string, Intl.DateTimeFormat>();
function fmt(name: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = formats.get(name);
  if (!f) { f = new Intl.DateTimeFormat(undefined, options); formats.set(name, f); }
  return f;
}

const timeWords = (at: string | null) => {
  if (!at) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : fmt('time', { hour: 'numeric', minute: '2-digit' }).format(d);
};

/**
 * The lines in groups: a new group starts where the step or the day of a line changes. Small events
 * join the group of the line before them (the first group when they come first), so every group has
 * at least one line.
 */
export function groupLines(thread: readonly ThreadLine[], labelOf: (step: StopId | null) => string, now: Date = new Date()): Group[] {
  const out: Group[] = [];
  const early: ThreadLine[] = [];
  let cur: Group | null = null;
  let curDay: string | null = null;
  for (const l of thread) {
    if (!isMain(l)) {
      if (cur) cur.small.push(l);
      else early.push(l);
      continue;
    }
    const d: string | null = dayKey(l.at) ?? curDay;
    if (!cur || cur.step !== l.step || d !== curDay) {
      cur = { key: `g:${l.id}`, step: l.step, label: labelOf(l.step), day: dayWords(l.at, now), lines: [], small: [] };
      curDay = d;
      out.push(cur);
    }
    cur.lines.push(l);
  }
  if (out.length && early.length) out[0].small.unshift(...early);
  return out;
}

/** The last exchange: from his last message (or Auto's for him) to the end; else the last line. */
export function lastExchange(thread: readonly ThreadLine[]): string[] {
  let from = -1;
  for (let i = thread.length - 1; i >= 0; i--) if (thread[i].kind === 'you') { from = i; break; }
  if (from < 0) {
    for (let i = thread.length - 1; i >= 0; i--) if (isMain(thread[i])) return [thread[i].id];
    return [];
  }
  return thread.slice(from).filter(isMain).map((l) => l.id);
}

/** The first line newer than his last look that is not his (left/JobRows.tsx freshCount's rule), or null. */
export function firstNew(thread: readonly ThreadLine[], lastLook: string | null): string | null {
  const seen = lastLook ? Date.parse(lastLook) : NaN;
  if (!Number.isFinite(seen)) return null;
  for (const l of thread) {
    if (!isMain(l) || l.mine || !l.at) continue;
    const t = Date.parse(l.at);
    if (Number.isFinite(t) && t > seen) return l.id;
  }
  return null;
}

/** The newest line's time (any kind), or null. */
function newestAt(thread: readonly ThreadLine[] | null | undefined): string | null {
  let best: string | null = null;
  let bestT = -Infinity;
  for (const l of thread ?? []) {
    const t = l.at ? Date.parse(l.at) : NaN;
    if (Number.isFinite(t) && t > bestT) { bestT = t; best = l.at; }
  }
  return best;
}

// ---------- Keeping the anchor ----------

/** Puts the anchor back where it was on screen; an open item calls it when its body lands. */
const KeepContext = createContext<() => void>(() => {});

interface Anchor { key: string; top: number }

/** The view's anchor keeper, made once per view (its functions keep their identity). */
function useAnchor(root: RefObject<HTMLDivElement | null>) {
  const [keeper] = useState(() => anchorKeeper(root));
  return keeper;
}

function anchorKeeper(root: RefObject<HTMLDivElement | null>) {
  const anchor: { current: Anchor | null } = { current: null };
  const hover: { current: string | null } = { current: null };
  /** The scrollTop this view last set itself: its scroll event is not his scroll. */
  const own: { current: number | null } = { current: null };
  const scroller = () => root.current?.closest<HTMLElement>('.jp2-rv-body') ?? null;
  const keyed = () => [...(root.current?.querySelectorAll<HTMLElement>('[data-cv-key]') ?? [])];
  const find = (key: string) => keyed().find((el) => el.dataset.cvKey === key) ?? null;

  /** The first keyed row whose bottom is below the top of the view (they are in order: a binary search). */
  const firstInView = (): HTMLElement | null => {
    const sc = scroller();
    const all = keyed();
    if (!sc || !all.length) return null;
    const top = sc.getBoundingClientRect().top;
    let lo = 0;
    let hi = all.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (all[mid].getBoundingClientRect().bottom > top) hi = mid;
      else lo = mid + 1;
    }
    return all[lo];
  };

  /** Hold this row (else the one under the pointer, else the first in view) where it is now. */
  const remember = (key?: string | null) => {
    const el = (key ? find(key) : null) ?? (hover.current ? find(hover.current) : null) ?? firstInView();
    anchor.current = el?.dataset.cvKey ? { key: el.dataset.cvKey, top: el.getBoundingClientRect().top } : null;
  };

  /** The view scrolled by this view's own hand: remember it, so its scroll event is not taken for his. */
  const scrollTo = (sc: HTMLElement, top: number) => {
    sc.scrollTop = Math.max(0, top);
    own.current = sc.scrollTop;
  };

  const restore = () => {
    const a = anchor.current;
    const sc = scroller();
    if (!a || !sc) return;
    const el = find(a.key);
    if (!el) { anchor.current = null; return; }
    const by = el.getBoundingClientRect().top - a.top;
    if (Math.abs(by) >= 1) scrollTo(sc, sc.scrollTop + by);
    a.top = el.getBoundingClientRect().top;
  };

  const onScroll = () => {
    const sc = scroller();
    if (sc && own.current !== null && Math.abs(sc.scrollTop - own.current) < 1) { own.current = null; return; }
    own.current = null;
    remember();
  };

  const onPointer = (e: ReactMouseEvent<HTMLElement>) => {
    const at = e.target instanceof Element ? e.target : null;
    const item = at?.closest<HTMLElement>('.jp2-cv-item');
    const el = item ? item.querySelector<HTMLElement>('[data-cv-key]') : at?.closest<HTMLElement>('[data-cv-key]');
    const key = el?.dataset.cvKey ?? null;
    if (key === hover.current) return;
    hover.current = key;
    if (key) remember(key);
  };
  const onLeave = () => { hover.current = null; };

  return { remember, restore, scrollTo, scroller, onScroll, onPointer, onLeave, hover };
}

// ---------- The view ----------

export function ConversationView({ searchRef, onOpen }: ConversationViewProps) {
  const store = useJobStore();
  const slug = useJob((s) => s.slug);
  const thread = useJob((s) => s.payload?.thread ?? null);
  const steps = useJob((s) => s.payload?.steps ?? null);
  const newest = useJob((s) => newestAt(s.payload?.thread));
  const root = useRef<HTMLDivElement>(null);
  const a = useAnchor(root);

  // His last look from before this view: the New line stays put while he reads.
  const [lastLook] = useState(() => readStored(seenKey(slug)));
  const [open, setOpen] = useState<ReadonlySet<string> | null>(() => (thread ? new Set(lastExchange(thread)) : null));
  if (open === null && thread) setOpen(new Set(lastExchange(thread)));
  const opened = open ?? EMPTY;
  const [smallOpen, setSmallOpen] = useState<ReadonlySet<string>>(EMPTY);
  const [words, setWords] = useState('');
  const q = useDeferredValue(words).trim().toLowerCase();

  const labelOf = useMemo(() => {
    const names = new Map<string, string>((steps ?? []).map((s: StepRow) => [s.id, s.label]));
    return (step: StopId | null) => (step ? names.get(step) ?? step : 'Start');
  }, [steps]);
  const groups = useMemo(() => groupLines(thread ?? [], labelOf), [thread, labelOf]);
  const total = useMemo(() => (thread ?? []).filter(isMain).length, [thread]);
  const newId = useMemo(() => firstNew(thread ?? [], lastLook), [thread, lastLook]);

  // The filter: the groups with only the lines whose headline has the words.
  const shown = useMemo(() => {
    if (!q) return groups;
    const has = (l: ThreadLine) => l.headline.toLowerCase().includes(q);
    return groups.map((g) => ({ ...g, lines: g.lines.filter(has) })).filter((g) => g.lines.length > 0);
  }, [groups, q]);
  const count = useMemo(() => shown.reduce((n, g) => n + g.lines.length, 0), [shown]);
  /** Each step's lines as shown: what Open all in this step opens. */
  const byStep = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of shown) { const k = g.step ?? ''; m.set(k, [...(m.get(k) ?? []), ...g.lines.map((l) => l.id)]); }
    return m;
  }, [shown]);

  const toggle = useCallback((id: string) => {
    a.remember(`l:${id}`);
    setOpen((was) => {
      const next = new Set(was ?? EMPTY);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const toggleAll = useCallback((groupKey: string, ids: string[], close: boolean) => {
    a.remember(groupKey);
    setOpen((was) => {
      const next = new Set(was ?? EMPTY);
      for (const id of ids) { if (close) next.delete(id); else next.add(id); }
      return next;
    });
  }, []);
  const toggleSmall = useCallback((groupKey: string) => {
    a.remember(`s:${groupKey}`);
    setSmallOpen((was) => {
      const next = new Set(was);
      if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
      return next;
    });
  }, []);

  // On arrival: to the New line or the last exchange, with a little before it; afterwards, after every
  // change, the anchor goes back where it was.
  const arrived = useRef(false);
  useLayoutEffect(() => {
    const sc = a.scroller();
    if (!sc || !thread) return;
    if (!arrived.current) {
      arrived.current = true;
      if (!hasPlace(store, PLACE)) {
        const to = root.current?.querySelector<HTMLElement>('.jp2-cv-new, .jp2-cv-line[aria-expanded="true"]');
        if (to) a.scrollTo(sc, to.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - CONTEXT_PX);
      }
      a.remember();
      return;
    }
    a.restore();
  });

  // A new filter starts at the top of what it found (a re-run of the effect with the same words does nothing).
  const filtered = useRef(q);
  useLayoutEffect(() => {
    if (filtered.current === q) return;
    filtered.current = q;
    const sc = a.scroller();
    if (sc) a.scrollTo(sc, 0);
    a.remember();
  }, [q]);

  // His scrolls (not this view's own) choose a new anchor.
  useEffect(() => {
    const sc = a.scroller();
    if (!sc) return undefined;
    sc.addEventListener('scroll', a.onScroll, { passive: true });
    return () => sc.removeEventListener('scroll', a.onScroll);
  }, []);

  // Seen: while the view can be seen, the newest line's time is his last look (only ever forward).
  useEffect(() => {
    const key = seenKey(slug);
    const look = () => {
      const el = root.current;
      if (!newest || !el || document.visibilityState === 'hidden' || el.closest('[inert]')) return;
      if (!(Date.parse(readStored(key) ?? '') >= Date.parse(newest))) writeStored(key, newest);
    };
    look();
    const pane = root.current?.closest('.jp2-reader');
    const watch = pane && typeof MutationObserver !== 'undefined' ? new MutationObserver(look) : null;
    if (pane) watch?.observe(pane, { attributes: true, attributeFilter: ['inert'] });
    document.addEventListener('visibilitychange', look);
    return () => { watch?.disconnect(); document.removeEventListener('visibilitychange', look); };
  }, [slug, newest]);

  function jumpToLatest() {
    const sc = a.scroller();
    if (!sc) return;
    a.scrollTo(sc, sc.scrollHeight - sc.clientHeight);
    a.hover.current = null;
    a.remember();
  }

  const filtering = q !== '';
  return (
    <>
      <div className="jp2-cv-tools">
        <label className="jp2-cv-sbox">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            className="jp2-cv-search"
            type="search"
            aria-label="Search the conversation"
            placeholder="Search the conversation"
            value={words}
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && words) { e.stopPropagation(); setWords(''); } }}
          />
        </label>
        {filtering && <span className="jp2-dim jp2-cv-count" role="status">{`${count} of ${total} lines`}</span>}
        <Button kind="quiet" size="sm" className="jp2-cv-latest" onClick={jumpToLatest} title="Go to the end of the conversation.">Jump to latest</Button>
      </div>
      <ReaderBody view="conversation" place={PLACE} className="jp2-cv-body">
        <KeepContext.Provider value={a.restore}>
          <div ref={root} className="jp2-cv" onMouseOver={a.onPointer} onMouseLeave={a.onLeave}>
            {shown.map((g) => {
              const ids = byStep.get(g.step ?? '') ?? [];
              return (
                <GroupView
                  key={g.key}
                  group={g}
                  open={opened}
                  allOpen={ids.length > 0 && ids.every((id) => opened.has(id))}
                  stepIds={ids}
                  newId={filtering ? null : newId}
                  smallOpen={!filtering && smallOpen.has(g.key)}
                  showSmall={!filtering}
                  onToggle={toggle}
                  onAll={toggleAll}
                  onSmall={toggleSmall}
                  onOpen={onOpen}
                />
              );
            })}
            {thread && filtering && count === 0 && <p className="jp2-cv-none">No line has those words.</p>}
            {thread && !filtering && total === 0 && <p className="jp2-cv-none">Nothing has been said in this job yet.</p>}
          </div>
        </KeepContext.Provider>
      </ReaderBody>
    </>
  );
}

interface GroupViewProps {
  group: Group;
  open: ReadonlySet<string>;
  allOpen: boolean;
  stepIds: string[];
  newId: string | null;
  smallOpen: boolean;
  showSmall: boolean;
  onToggle(id: string): void;
  onAll(groupKey: string, ids: string[], close: boolean): void;
  onSmall(groupKey: string): void;
  onOpen(t: ReaderTarget, from?: HTMLElement | null): void;
}

const GroupView = memo(function GroupView({ group: g, open, allOpen, stepIds, newId, smallOpen, showSmall, onToggle, onAll, onSmall, onOpen }: GroupViewProps) {
  const n = g.small.length;
  return (
    <section className="jp2-cv-group">
      <div className="jp2-cv-gh" data-cv-key={g.key}>
        <h3 className="jp2-cv-gt"><b>{g.label}</b>{g.day ? ` · ${g.day}` : ''}</h3>
        <button type="button" className="link-button jp2-cv-openall" onClick={() => onAll(g.key, stepIds, allOpen)}>
          {allOpen ? 'Fold all in this step' : 'Open all in this step'}
        </button>
      </div>
      <ul className="jp2-cv-lines">
        {g.lines.map((l) => (
          <WithMark key={l.id} mark={l.id === newId}>
            <Item line={l} open={open.has(l.id)} onToggle={onToggle} onOpen={onOpen} />
          </WithMark>
        ))}
      </ul>
      {showSmall && n > 0 && (
        <div className="jp2-cv-small">
          <button type="button" className="jp2-cv-sm-h" data-cv-key={`s:${g.key}`} aria-expanded={smallOpen} onClick={() => onSmall(g.key)}>
            {n === 1 ? '1 small event' : `${n} small events`}
          </button>
          {smallOpen && (
            <ul className="jp2-cv-sm">
              {g.small.map((l) => (
                <li key={l.id} className="jp2-cv-sm-line"><span>{l.headline}</span>{l.at && <time dateTime={l.at}>{timeWords(l.at)}</time>}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
});

/** A line, with the New line before it when it is the first new one. */
function WithMark({ mark, children }: { mark: boolean; children: ReactNode }) {
  return (
    <>
      {mark && <li className="jp2-cv-new" role="separator" aria-label="New since your last look">New</li>}
      {children}
    </>
  );
}

interface ItemProps {
  line: ThreadLine;
  open: boolean;
  onToggle(id: string): void;
  onOpen(t: ReaderTarget, from?: HTMLElement | null): void;
}

const BRIEF_NO = /^(Brief #\d+)(.*)$/;

const Item = memo(function Item({ line: l, open, onToggle, onOpen }: ItemProps) {
  const who = l.kind === 'you' ? 'is-you' : `is-${l.kind}`;
  const brief = l.kind === 'brief' ? BRIEF_NO.exec(l.headline) : null;
  return (
    <li className={`jp2-cv-item ${who}${l.by === 'auto' ? ' is-auto' : ''}`} data-id={l.id}>
      <button type="button" className="jp2-cv-line" data-cv-key={`l:${l.id}`} aria-expanded={open} onClick={() => onToggle(l.id)}>
        {l.kind === 'you' && l.by === 'auto' && <span className="jp2-cv-auto">Auto</span>}
        <span className="jp2-cv-h">{brief ? <><b>{brief[1]}</b>{brief[2]}</> : l.headline}</span>
        {l.at && <time dateTime={l.at}>{timeWords(l.at)}</time>}
      </button>
      {open && <ItemBody line={l} onOpen={onOpen} />}
    </li>
  );
});

/** An open item's full text, under its line; nothing (no reserved height) until it lands. */
function ItemBody({ line, onOpen }: { line: ThreadLine; onOpen: ItemProps['onOpen'] }) {
  const { body, error } = useBody(line.id);
  const keep = useContext(KeepContext);
  // It grew (its text landed): whatever he reads stays where it is.
  useLayoutEffect(() => { keep(); }, [keep, body, error]);
  if (!body) return error ? <div className="jp2-cv-full"><NotLoaded error={error} /></div> : null;
  const detail = typeof body.meta.detail === 'string' ? body.meta.detail : null;
  return (
    <div className="jp2-cv-full">
      <Prose prepared={prepareMessage(body, line.headline)} onOpen={onOpen} />
      {detail && (
        <p className="jp2-rv-after">
          <button type="button" className="link-button" onClick={(e) => onOpen({ kind: 'brief', id: detail }, e.currentTarget)}>Read the detail of this brief</button>
        </p>
      )}
    </div>
  );
}
