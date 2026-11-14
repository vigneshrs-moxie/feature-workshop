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
// - On arrival the last exchange (his last message and what came after it) is open and put 120 px
//   from the top of the view, unless the view has a scroll place of its own from an earlier visit
//   (ReaderBody keeps it). Its bodies are often not loaded yet, so the list can end too soon for that
//   scroll: the place is aimed again as each body lands, until he scrolls, clicks or presses a key.
//   A `New` line marks where the lines newer than his last look start.
// - A filter box narrows the lines as he types: by headline, and by the text of any body already
//   loaded (the box says so); `Jump to latest` goes to the end and says how many below are new.
// - j and k move between the lines when the conversation is what he is in (stepLine, used by
//   JobPage2's keys); Enter on a line opens or folds it (it is a button).
//
// Nothing he reads moves (speed rule 3). The browser's own scroll anchoring is off for this list
// (jobpage.css), and the view keeps one anchor itself: the line under the pointer (while it is in
// view), else the one he last clicked, else the first line in view. After anything changes the list
// (a new message, an item opened or folded, a body that lands late, Open all, a width change), the
// anchor is put back where it was on screen. A new message adds a folded line at the end and never
// pulls the view down to it.
//
// Fast on a long job (speed rules 2 and 5): only lines are drawn, each a memoised row; a body is
// fetched and drawn only for an open item (useBody), so 200 items cost 200 lines and a few bodies.
//
// His last look is the browser's `sb.convo.seen.<slug>` (left/JobRows.tsx seenKey, the old page's
// key): while the view can be seen (the page in front, the reader not behind the left pane) it moves
// on, only ever forward, to the newest line that has been in view, so the job row's `· N new` counts
// only what he has not had on screen (a message that arrives while he reads higher up stays new).
// The `New` line keeps to his look from before this view.
//
// `Keep as an ask` (R6): on a laptop, hovering (or tabbing to) a message he sent shows it over the
// line's time; it keeps the message's words in this browser (asks.ts, sb.asks.kept) and ⌘K lists them
// under Yours.

import { createContext, Fragment, memo, useCallback, useContext, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { readStored, useStored, writeStored } from '../../lib/stored';
import { keepAsk, keptWords, splitAsks } from '../asks';
import { freshCount, seenKey } from '../left/JobRows';
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
  /** On arrival the anchor's top is where it should be (120 px down), not where the short list let it
   *  go: it is aimed again as bodies land, until he scrolls, clicks or presses a key. */
  let held = false;
  /** Told after every scroll (his or the view's own): the seen marking reads what is in view then. */
  const afterScroll: { current: () => void } = { current: () => {} };
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

  /** Whether a row is (partly) inside the view; a view with no size (not laid out, hidden) shows nothing. */
  const inView = (el: HTMLElement): boolean => {
    const sc = scroller();
    if (!sc) return false;
    const v = sc.getBoundingClientRect();
    if (v.height <= 0) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > v.top && r.top < v.bottom;
  };

  /** The newest time (`data-at`) of the rows in view: lines, and a group's small events by their toggle. */
  const newestInView = (): string | null => {
    const sc = scroller();
    const start = firstInView();
    if (!sc || !start || !inView(start)) return null;
    const bottom = sc.getBoundingClientRect().bottom;
    let best: string | null = null;
    let bestT = -Infinity;
    for (let el: Element | null = start, all = keyed(), i = all.indexOf(start); el && i < all.length; el = all[++i] ?? null) {
      const row = el as HTMLElement;
      if (row.getBoundingClientRect().top >= bottom) break;
      const at = row.dataset.at;
      const t = at ? Date.parse(at) : NaN;
      if (at && Number.isFinite(t) && t > bestT) { bestT = t; best = at; }
    }
    return best;
  };

  /** Hold this row (else the one under the pointer while it is in view, else the first in view) where it is now. */
  const remember = (key?: string | null) => {
    held = false;
    const hovered = hover.current ? find(hover.current) : null;
    const el = (key ? find(key) : null) ?? (hovered && inView(hovered) ? hovered : null) ?? firstInView();
    anchor.current = el?.dataset.cvKey ? { key: el.dataset.cvKey, top: el.getBoundingClientRect().top } : null;
  };

  /** Arrival: this row belongs `top` px from the top of the page, even before the list is long enough. */
  const aim = (key: string, top: number) => {
    anchor.current = { key, top };
    held = true;
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
    // Held (arrival): keep the top it should have, so the next body that lands moves it there.
    if (!held) a.top = el.getBoundingClientRect().top;
  };

  const onScroll = () => {
    const sc = scroller();
    if (sc && own.current !== null && Math.abs(sc.scrollTop - own.current) < 1) { own.current = null; afterScroll.current(); return; }
    own.current = null;
    remember();
    afterScroll.current();
  };

  const onPointer = (e: ReactMouseEvent<HTMLElement>) => {
    const at = e.target instanceof Element ? e.target : null;
    const item = at?.closest<HTMLElement>('.jp2-cv-item');
    const el = item ? item.querySelector<HTMLElement>('[data-cv-key]') : at?.closest<HTMLElement>('[data-cv-key]');
    const key = el?.dataset.cvKey ?? null;
    if (key === hover.current) return;
    hover.current = key;
    // While the arrival is held, a pointer resting on the page (or a line moving under it) does not take over.
    if (key && !held) remember(key);
  };
  const onLeave = () => { hover.current = null; };

  return { remember, aim, restore, scrollTo, scroller, onScroll, onPointer, onLeave, hover, newestInView, afterScroll };
}

// ---------- The view ----------

export function ConversationView({ searchRef, onOpen }: ConversationViewProps) {
  const store = useJobStore();
  const slug = useJob((s) => s.slug);
  const thread = useJob((s) => s.payload?.thread ?? null);
  const steps = useJob((s) => s.payload?.steps ?? null);
  const root = useRef<HTMLDivElement>(null);
  const a = useAnchor(root);

  // His last look from before this view: the New line stays put while he reads. Never looked before:
  // the first look this view writes, so what arrives after it is marked.
  const [lastLook, setLastLook] = useState(() => readStored(seenKey(slug)));
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

  // The filter: the groups with only the lines whose headline, or whose body when it is loaded, has the words.
  const bodies = useJob((s) => (q ? s.bodies : null));
  const shown = useMemo(() => {
    if (!q) return groups;
    const has = (l: ThreadLine) => l.headline.toLowerCase().includes(q) || (bodies?.[l.id]?.text ?? '').toLowerCase().includes(q);
    return groups.map((g) => ({ ...g, lines: g.lines.filter(has) })).filter((g) => g.lines.length > 0);
  }, [groups, q, bodies]);
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
  // The step's lines read when he clicks (not passed down): a new line in a step draws its own group only.
  const byStepNow = useRef(byStep);
  byStepNow.current = byStep;
  const toggleAll = useCallback((groupKey: string, step: StopId | null, close: boolean) => {
    const ids = byStepNow.current.get(step ?? '') ?? [];
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

  // On arrival: to the last exchange, with a little before it; afterwards, after every
  // change, the anchor goes back where it was.
  const arrived = useRef(false);
  useLayoutEffect(() => {
    const sc = a.scroller();
    if (!sc || !thread) return;
    if (!arrived.current) {
      arrived.current = true;
      const to = hasPlace(store, PLACE) ? null : root.current?.querySelector<HTMLElement>('.jp2-cv-line[aria-expanded="true"]');
      if (to?.dataset.cvKey) {
        // Aimed, not scrolled once: the open bodies have not landed yet, so the list may end too soon
        // for the scroll; each body that lands aims it again (held until he scrolls, clicks or types).
        a.aim(to.dataset.cvKey, sc.getBoundingClientRect().top + CONTEXT_PX);
        a.restore();
      } else {
        a.remember();
      }
      return;
    }
    a.restore();
  });

  // His last look moves on to the newest line that has been in view (never to one below it he has not
  // scrolled to), after every change and every scroll, while the view can be seen.
  const [seenAt] = useStored(seenKey(slug));
  if (lastLook === null && seenAt !== null) setLastLook(seenAt);
  const markSeen = useRef(() => {});
  markSeen.current = () => {
    const el = root.current;
    if (!el || document.visibilityState === 'hidden' || el.closest('[inert]')) return;
    const at = a.newestInView();
    if (!at) return;
    const key = seenKey(slug);
    if (!(Date.parse(readStored(key) ?? '') >= Date.parse(at))) writeStored(key, at);
  };
  a.afterScroll.current = () => markSeen.current();
  useEffect(() => { markSeen.current(); });
  const unseen = useMemo(() => (thread ? freshCount(thread, seenAt) : 0), [thread, seenAt]);

  // A width change rewraps the open texts: what he reads stays where it is.
  useEffect(() => {
    const el = root.current;
    const sc = a.scroller();
    if (!el || !sc || typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(() => { a.restore(); markSeen.current(); });
    watch.observe(el);
    watch.observe(sc);
    return () => watch.disconnect();
  }, []);

  // New words start at the top of what they found; cleared, the line that was first in view keeps its
  // place among all the lines (the anchor). A re-run of the effect with the same words does nothing.
  const filtered = useRef(q);
  useLayoutEffect(() => {
    if (filtered.current === q) return;
    filtered.current = q;
    if (!q) return;
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

  // Seen, again, when the view comes into sight (the reader over the left pane, the page in front).
  useEffect(() => {
    const look = () => markSeen.current();
    const pane = root.current?.closest('.jp2-reader');
    const watch = pane && typeof MutationObserver !== 'undefined' ? new MutationObserver(look) : null;
    if (pane) watch?.observe(pane, { attributes: true, attributeFilter: ['inert'] });
    document.addEventListener('visibilitychange', look);
    return () => { watch?.disconnect(); document.removeEventListener('visibilitychange', look); };
  }, []);

  function jumpToLatest() {
    const sc = a.scroller();
    if (!sc) return;
    a.scrollTo(sc, sc.scrollHeight - sc.clientHeight);
    a.hover.current = null;
    a.remember();
    markSeen.current();
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
            placeholder="Find in headlines and opened messages"
            value={words}
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && words) { e.stopPropagation(); setWords(''); } }}
          />
        </label>
        {filtering && <span className="jp2-dim jp2-cv-count" role="status">{`${count} of ${total} lines`}</span>}
        <Button kind="quiet" size="sm" className="jp2-cv-latest" onClick={jumpToLatest} title="Go to the end of the conversation.">{unseen > 0 ? `Jump to latest · ${unseen} new` : 'Jump to latest'}</Button>
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
                  newId={!filtering && newId && g.lines.some((l) => l.id === newId) ? newId : null}
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
  newId: string | null;
  smallOpen: boolean;
  showSmall: boolean;
  onToggle(id: string): void;
  onAll(groupKey: string, step: StopId | null, close: boolean): void;
  onSmall(groupKey: string): void;
  onOpen(t: ReaderTarget, from?: HTMLElement | null): void;
}

const sameList = <T,>(a: readonly T[], b: readonly T[]) => a === b || (a.length === b.length && a.every((x, i) => x === b[i]));
/**
 * Whether a group draws the same: the groups are made again from every newer payload (new arrays of the
 * same line objects, which the store keeps by id), so a new line draws its own group only (speed rule 5).
 */
export function sameGroupProps(a: GroupViewProps, b: GroupViewProps): boolean {
  const g = a.group, h = b.group;
  return (g === h || (g.key === h.key && g.step === h.step && g.label === h.label && g.day === h.day && sameList(g.lines, h.lines) && sameList(g.small, h.small)))
    && a.open === b.open && a.allOpen === b.allOpen && a.newId === b.newId
    && a.smallOpen === b.smallOpen && a.showSmall === b.showSmall
    && a.onToggle === b.onToggle && a.onAll === b.onAll && a.onSmall === b.onSmall && a.onOpen === b.onOpen;
}

const GroupView = memo(function GroupView({ group: g, open, allOpen, newId, smallOpen, showSmall, onToggle, onAll, onSmall, onOpen }: GroupViewProps) {
  const n = g.small.length;
  return (
    <section className="jp2-cv-group">
      <div className="jp2-cv-gh" data-cv-key={g.key}>
        <h3 className="jp2-cv-gt"><b>{g.label}</b>{g.day ? ` · ${g.day}` : ''}</h3>
        <button type="button" className="link-button jp2-cv-openall" onClick={() => onAll(g.key, g.step, allOpen)}>
          {allOpen ? 'Fold all in this step' : 'Open all in this step'}
        </button>
      </div>
      <ul className="jp2-cv-lines">
        {/* The New line before the first new one; no component of its own per line, so only the memo'd items are met. */}
        {g.lines.map((l) => (
          <Fragment key={l.id}>
            {l.id === newId && <li className="jp2-cv-new" role="separator" aria-label="New since your last look">New</li>}
            <Item line={l} open={open.has(l.id)} onToggle={onToggle} onOpen={onOpen} />
          </Fragment>
        ))}
      </ul>
      {showSmall && n > 0 && (
        <div className="jp2-cv-small">
          <button type="button" className="jp2-cv-sm-h" data-cv-key={`s:${g.key}`} data-at={g.small.at(-1)?.at ?? undefined} aria-expanded={smallOpen} onClick={() => onSmall(g.key)}>
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
}, sameGroupProps);


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
      <button type="button" className="jp2-cv-line" data-cv-key={`l:${l.id}`} data-at={l.at ?? undefined} aria-expanded={open} onClick={() => onToggle(l.id)}>
        {l.kind === 'you' && l.by === 'auto' && <span className="jp2-cv-auto">Auto</span>}
        <span className="jp2-cv-h">{brief ? <><b>{brief[1]}</b>{brief[2]}</> : l.headline}</span>
        {l.at && <time dateTime={l.at}>{timeWords(l.at)}</time>}
      </button>
      {l.kind === 'you' && l.by !== 'auto' && <KeepAsk line={l} />}
      {open && <ItemBody line={l} onOpen={onOpen} />}
    </li>
  );
});

/** Keep a message he sent as an ask (R6): its full words, or its line when the body cannot be read. */
function KeepAsk({ line }: { line: ThreadLine }) {
  const store = useJobStore();
  const [kept, setKept] = useState<null | 'kept' | 'already' | 'notes' | 'several' | number>(null);
  async function keep() {
    const body = store.getState().bodies[line.id] ?? await store.loadBody(line.id).catch(() => null);
    // His own words only: a notes block quotes places in that day's documents.
    const text = body?.text ? keptWords(body.text) : line.headline;
    if (!text) { setKept('notes'); return; }
    // Several asks sent together (`2 asks: …`): each is kept as its own ask; one that will not split is refused.
    if (/^\d+ asks: /.test(text)) {
      const parts = splitAsks(text);
      if (!parts) { setKept('several'); return; }
      const added = parts.filter((p) => keepAsk(p)).length;
      setKept(added ? added : 'already');
      return;
    }
    setKept(keepAsk(text) ? 'kept' : 'already');
  }
  return (
    <Button
      kind="quiet"
      size="sm"
      className={`jp2-cv-keep${kept ? ' is-kept' : ''}`}
      onClick={() => void keep()}
      title="Keep this message as an ask: ⌘K lists it under Yours, and one click sends the same words again."
    >
      {typeof kept === 'number' ? `Kept ${kept} asks: in ⌘K under Yours` : kept === 'kept' ? 'Kept: in ⌘K under Yours' : kept === 'already' ? 'Already kept' : kept === 'notes' ? 'Only notes: nothing to keep' : kept === 'several' ? 'Several asks: keep each from ⌘K instead' : 'Keep as an ask'}
    </Button>
  );
}

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

/**
 * j and k in the conversation (JobPage2's keys): the focus moves to the next or previous line, which
 * scrolls into view only as far as it must. Works when the reader shows the conversation and the
 * focus is in the reader, or when `always` (the reader covers the left pane). From no line it starts
 * at the first line in view (or the last one, going up). False when it did not apply.
 */
export function stepLine(reader: HTMLElement | null, by: 1 | -1, always: boolean): boolean {
  const view = reader?.querySelector<HTMLElement>('[data-view="conversation"]');
  if (!reader || !view) return false;
  const focus = document.activeElement;
  if (!always && !(focus && reader.contains(focus))) return false;
  const lines = [...view.querySelectorAll<HTMLElement>('.jp2-cv-line')];
  if (!lines.length) return false;
  const on = focus instanceof Element ? focus.closest<HTMLElement>('.jp2-cv-line') : null;
  let at = on ? lines.indexOf(on) : -1;
  if (at < 0) {
    const v = view.getBoundingClientRect();
    const shown = lines.filter((l) => { const r = l.getBoundingClientRect(); return r.bottom > v.top && r.top < v.bottom; });
    const from = by > 0 ? shown[0] : shown[shown.length - 1];
    at = from ? lines.indexOf(from) - by : (by > 0 ? -1 : lines.length);
  }
  const next = lines[Math.max(0, Math.min(lines.length - 1, at + by))];
  next.focus({ preventScroll: true });
  next.scrollIntoView?.({ block: 'nearest' });
  return true;
}
