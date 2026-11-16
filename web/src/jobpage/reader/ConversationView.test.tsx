// The conversation in the reader (job page rebuild, Task 13; design brief "The conversation, made
// readable"): one line per item, grouped by step and day, folded; the last exchange open with a line
// where the new ones start; fast on a long job; nothing he reads moves. Built against the made-up long
// job (52 items) and its 200-item twin.
//
// jsdom lays nothing out, so the tests that say "nothing moves" give the conversation a small layout of
// its own (fakeLayout): each line 28 px, each group head 30, each open body 300, stacked in the order
// they are in the page, under a 600 px scroll area that keeps its scrollTop. That is enough to see a
// line move when something above it grows, and to see the page scroll when it should not.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { installKeyListener, resetChord } from '../../app/keyRegistry';
import { UiProvider } from '../../app/ui';
import { createStore, WorkshopContext } from '../../state/store';
import { longJob } from '../fixtures/longJob';
import { longJob200 } from '../fixtures/longJob200';
import { createJobStore, type JobStore } from '../jobStore';
import { JobPage2 } from '../JobPage2';
import { seenKey } from '../left/JobRows';
import { sameGroupProps } from './ConversationView';
import { forgetRecentPages } from '../recent';
import { CONVERSATION } from '../targets';
import type { JobBody, JobPagePayload, ThreadLine } from '../types';

type Fixture = typeof longJob;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const CSS = readFileSync(path.join(process.cwd(), 'src/jobpage/jobpage.css'), 'utf8');
/** The declarations of the first rule whose selector is exactly `sel`. */
const rule = (sel: string) => {
  const at = CSS.indexOf(`${sel} {`);
  return at < 0 ? '' : CSS.slice(at + sel.length + 2, CSS.indexOf('}', at));
};

const SLUG = longJob.payload.slug;
const LAST_YOU = 'you:ff6dfb006203';
const LAST_REPLY = 'reply:bb51ba3f5815';
const OLD_REPLY = 'reply:8a74f36ecec2';
const REVIEW_REPLY = 'reply:0f7efd5437f7';
const LAST_AT = longJob.payload.thread.at(-1)!.at;

interface Opened {
  store: JobStore;
  item: ReturnType<typeof vi.fn>;
  release(id: string): void;
  /** The next payload the server answers with (a job-page event asks for it). */
  push(next: JobPagePayload): Promise<void>;
  payload: JobPagePayload;
}

function bodyFrom(job: Fixture, id: string): JobBody | undefined {
  const b = job.bodies[id];
  return b ? { ...b, version: String(b.meta.hash ?? b.id) } : undefined;
}

/** The page with a store holding the payload; bodies answer at once unless held. */
function open({ job = longJob, patch, hold = [], reader = CONVERSATION as typeof CONVERSATION | null }: { job?: Fixture; patch?: (p: JobPagePayload) => void; hold?: string[]; reader?: typeof CONVERSATION | null } = {}): Opened {
  const p = clone(job.payload) as unknown as JobPagePayload;
  patch?.(p);
  window.history.replaceState(null, '', `/#/job/${p.slug}`);
  const waiting = new Map<string, () => void>();
  let served: JobPagePayload = p;
  const item = vi.fn(async (_slug: string, id: string) => {
    if (hold.includes(id)) await new Promise<void>((r) => { waiting.set(id, r); });
    const b = bodyFrom(job, id);
    if (!b) throw new Error('Starbase answered 404.');
    return b;
  });
  const page = vi.fn(async (_slug: string, v: number | null) => (v === served.v ? { same: true as const, v } : served));
  const store = createJobStore(p.slug, { api: { page, item }, events: () => () => {}, viewer: () => null, initial: p });
  if (reader) store.setReader(reader);
  const api = { get: vi.fn(), post: vi.fn(), hosted: () => false } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ api, store: createStore() }}><UiProvider><JobPage2 slug={p.slug} job={null} store={store} /></UiProvider></WorkshopContext.Provider>);
  return {
    store, item, payload: p,
    release: (id) => waiting.get(id)?.(),
    async push(next) {
      served = next;
      await act(async () => { store.onEvent({ type: 'job-page', job: next.slug, data: { slug: next.slug, v: next.v } } as never); await new Promise((r) => setTimeout(r, 0)); });
    },
  };
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const reader = () => document.querySelector<HTMLElement>('.jp2-reader')!;
/** The conversation's view: in its own column on a laptop (the glance layout), in the reader under 1100 px. */
const CONVO_VIEW = '.jp2-convo [data-view="conversation"], .jp2-reader [data-view="conversation"]';
const column = () => document.querySelector<HTMLElement>('section.jp2-convo[aria-label="Conversation"]')!;
const convo = () => document.querySelector<HTMLElement>(CONVO_VIEW)!;
const items = () => [...convo().querySelectorAll<HTMLElement>('.jp2-cv-item')];
const itemOf = (id: string) => items().find((x) => x.dataset.id === id)!;
const lineOf = (id: string) => itemOf(id).querySelector<HTMLButtonElement>('.jp2-cv-line')!;
const openIds = () => items().filter((x) => x.querySelector('.jp2-cv-line')!.getAttribute('aria-expanded') === 'true').map((x) => x.dataset.id);
const heads = () => [...convo().querySelectorAll<HTMLElement>('.jp2-cv-gt')].map((h) => h.textContent);
const weekday = (at: string) => new Date(at).toLocaleDateString(undefined, { weekday: 'long' });
const mainLines = <L extends { kind: string }>(p: { thread: L[] }): L[] => p.thread.filter((l) => l.kind !== 'small');

/** A made-up reply line (its body is a reply already in the fixture). */
const newLine = (p: JobPagePayload, id: string, at: string, headline: string): ThreadLine => ({ ...p.thread.find((l) => l.id === LAST_REPLY)!, id, at, headline });

/** The small layout described at the top of this file (for whichever conversation view is shown). Returns its scroll area. */
/** An open body's height in fakeLayout (a narrower window wraps it taller). */
let BODY_PX = 300;
/** fakeLayout's end of scroll for its view (null for any other element); null when no fake layout is on. */
let maxTop: ((el: Element) => number | null) | null = null;
{
  // Installed once: scrollTop as jsdom keeps it, held between 0 and maxTop while a fake layout is on.
  const top = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
  const clamp = (el: Element, v: number) => { const m = maxTop?.(el); return m == null ? v : Math.max(0, Math.min(v, m)); };
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) { return clamp(this, top.get!.call(this) as number); },
    set(this: Element, v: number) { top.set!.call(this, clamp(this, v)); },
  });
}
function fakeLayout(): HTMLElement {
  const scNow = () => document.querySelector<HTMLElement>(CONVO_VIEW);
  const H: [string, number][] = [['.jp2-cv-line', 28], ['.jp2-cv-gh', 30], ['.jp2-cv-new', 24], ['.jp2-cv-sm-h', 24], ['.jp2-cv-sm-line', 22], ['.jp2-cv-full', -1]];
  const LEAF = H.map(([s]) => s).join(', ');
  const height = (el: Element) => { const h = H.find(([s]) => el.matches(s))?.[1] ?? 0; return h < 0 ? BODY_PX : h; };
  const TOP = 100;
  const VIEW = 600;
  function leaves(sc: HTMLElement): Map<Element, number> {
    const out = new Map<Element, number>();
    let y = 0;
    for (const el of sc.querySelectorAll(LEAF)) {
      if (el.parentElement?.closest(LEAF)) continue;
      out.set(el, y);
      y += height(el);
    }
    return out;
  }
  const total = (sc: HTMLElement) => [...leaves(sc).keys()].reduce((n, el) => n + height(el), 0);
  if (!vi.isMockFunction(Element.prototype.getBoundingClientRect)) {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const box = (top: number, h: number) => ({ top, bottom: top + h, height: h, left: 0, right: 600, width: 600, x: 0, y: top, toJSON() { return this; } }) as DOMRect;
      const sc = scNow();
      if (!sc) return box(0, 0);
      if (this === sc) return box(TOP, VIEW);
      if (!sc.contains(this)) return box(0, 0);
      const all = leaves(sc);
      let off: number | undefined = all.get(this);
      let h = off === undefined ? 0 : height(this);
      if (off === undefined) {
        for (const [el, y] of all) {
          if (this.contains(el)) { off ??= y; h += height(el); } else if (off === undefined && (this.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) { off = y; break; }
        }
      }
      return box(TOP + (off ?? total(sc)) - sc.scrollTop, h);
    });
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) { return this === scNow() ? VIEW : 0; });
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) { const sc = scNow(); return this === sc && sc ? Math.max(VIEW, total(sc)) : 0; });
    // scrollTop as a browser keeps it: never below 0 or past the end (scrollHeight − clientHeight).
    maxTop = (el) => { const sc = scNow(); return el === sc && sc ? Math.max(0, Math.max(VIEW, total(sc)) - VIEW) : null; };
  }
  return scNow()!;
}

let offKeys: () => void = () => {};
beforeEach(() => {
  // Laptop width: two panes.
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
  // The fixture's week, seen from the Saturday after: its days read as weekday names in any time zone.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-07T12:00:00Z') });
  forgetRecentPages(); offKeys = installKeyListener(); resetChord();
});
afterEach(() => { BODY_PX = 300; maxTop = null; offKeys(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

describe('the conversation: one line per item, grouped by step and day', () => {
  it('the long job reads as about 50 lines under heads like `Review · Tuesday`, each with Open all in this step', async () => {
    open();
    await settle();
    const lines = convo().querySelectorAll('.jp2-cv-line');
    expect(lines.length).toBe(mainLines(longJob.payload).length);
    expect(lines.length).toBeGreaterThanOrEqual(40);
    expect(lines.length).toBeLessThanOrEqual(55);
    const firstReview = longJob.payload.thread.find((l) => l.step === 'review')!;
    expect(heads()).toContain(`Review · ${weekday(firstReview.at!)}`);
    expect(heads()).toContain(`Spec · ${weekday(longJob.payload.thread.find((l) => l.step === 'spec')!.at!)}`);
    for (const g of convo().querySelectorAll('.jp2-cv-group')) expect(within(g as HTMLElement).getByRole('button', { name: /^Open all in this step$/ })).toBeInTheDocument();
    // A brief's line is its headline: Brief #12 · Review · answered: Go.
    expect(lineOf('brief:briefs/012-review.md')).toHaveTextContent('Brief #12 · Review · answered: Go');
    // Small events are not lines.
    expect(items().some((x) => x.dataset.id?.startsWith('note:'))).toBe(false);
  });

  it('every past item is one line: who by position and tint, not a grey word; its time on the right', async () => {
    open();
    await settle();
    for (const l of mainLines(longJob.payload)) {
      const it = itemOf(l.id);
      expect(it.querySelectorAll('.jp2-cv-line')).toHaveLength(1);
      expect(it.querySelector('.jp2-cv-h')!.textContent).toBe(l.headline);
      expect(it.querySelector('.jp2-cv-line')!.textContent).not.toMatch(/\b(You|Foreman)\b/);
      expect(it.querySelector('time')).not.toBeNull();
      expect(it).toHaveClass(l.mine ? 'is-you' : `is-${l.kind}`);
    }
    // His are indented and tinted; the Foreman's flush left and plain.
    const you = rule('.jp2-cv-item.is-you');
    expect(you).toMatch(/margin-left:\s*56px/);
    expect(rule('.jp2-cv-item.is-you > .jp2-cv-line')).toMatch(/background:\s*var\(--bg-2\)/);
    expect(rule('.jp2-cv-item.is-reply')).toBe('');
  });

  it('a click opens an item in place (its full text under its line); a second click folds it', async () => {
    const o = open();
    await settle();
    expect(itemOf(OLD_REPLY).querySelector('.jp2-cv-full')).toBeNull();
    fireEvent.click(lineOf(OLD_REPLY));
    await settle();
    expect(lineOf(OLD_REPLY)).toHaveAttribute('aria-expanded', 'true');
    const full = itemOf(OLD_REPLY).querySelector('.jp2-cv-full')!;
    expect(full.querySelector('.jp2-prose')!.textContent!.length).toBeGreaterThan(100);
    // Still the conversation, not the message on its own (in its column; the reader does not take it).
    expect(column().querySelectorAll('[data-view]')).toHaveLength(1);
    expect(convo()).not.toBeNull();
    expect(reader().querySelector('[data-view="conversation"], [data-view="message"]')).toBeNull();
    expect(o.item).toHaveBeenCalledWith(SLUG, OLD_REPLY);
    fireEvent.click(lineOf(OLD_REPLY));
    expect(lineOf(OLD_REPLY)).toHaveAttribute('aria-expanded', 'false');
    expect(itemOf(OLD_REPLY).querySelector('.jp2-cv-full')).toBeNull();
  });

  it('small events end their group as `5 small events` in dim text, and open on a click', async () => {
    open({
      patch: (p) => {
        // Five small events after the last answer, and none elsewhere in Review (so the count holds in any time zone).
        const note = p.thread.find((l) => l.id === 'note:77b7399419d4')!;
        p.thread = p.thread.filter((l) => !(l.kind === 'small' && l.step === 'review'));
        p.thread.push(...[1, 2, 3, 4, 5].map((n) => ({ ...note, id: `note:extra${n}`, at: `2026-11-04T14:5${2 + n}:30.000Z`, headline: `Routine step ${n}` })));
      },
    });
    await settle();
    const groups = [...convo().querySelectorAll<HTMLElement>('.jp2-cv-group')];
    const last = groups[groups.length - 1];
    const toggle = within(last).getByRole('button', { name: '5 small events' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(last.querySelectorAll('.jp2-cv-sm-line')).toHaveLength(0);
    // The last thing in its group.
    expect(last.lastElementChild!.contains(toggle)).toBe(true);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect([...last.querySelectorAll('.jp2-cv-sm-line')].map((x) => x.querySelector('span')!.textContent)).toEqual(['Routine step 1', 'Routine step 2', 'Routine step 3', 'Routine step 4', 'Routine step 5']);
    fireEvent.click(toggle);
    expect(last.querySelectorAll('.jp2-cv-sm-line')).toHaveLength(0);
    // One alone says so.
    expect(within(convo()).getAllByRole('button', { name: '1 small event' }).length).toBeGreaterThan(0);
    expect(rule('.jp2-cv-sm-h')).toMatch(/color:\s*var\(--text-3\)/);
  });

  it('on arrival the last exchange is open, a line marks where the new ones start, and it is scrolled into view', async () => {
    // His last look: after his last message, before the Foreman's answer.
    localStorage.setItem(seenKey(SLUG), '2026-11-04T14:47:00.000Z');
    // A laptop: the conversation is in its own column as the page opens, with the layout in place, as
    // the browser would have it. (Under 1100 px it opens in the reader: "marking seen" below.)
    fakeLayout();
    open({ reader: null });
    await settle();
    const row = screen.getByRole('button', { name: /^Conversation · 52/ });
    expect(openIds()).toEqual([LAST_YOU, LAST_REPLY]);
    expect(itemOf(LAST_REPLY).querySelector('.jp2-cv-full .jp2-prose')).not.toBeNull();
    const marks = convo().querySelectorAll('.jp2-cv-new');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('New');
    expect(marks[0].nextElementSibling).toBe(itemOf(LAST_REPLY));
    // The answer has been in view: the row's `· 1 new` goes, the line where they started stays.
    expect(localStorage.getItem(seenKey(SLUG))).toBe(longJob.payload.thread.at(-1)!.at);
    expect(row).toHaveAccessibleName('Conversation · 52');
    expect(convo().querySelectorAll('.jp2-cv-new')).toHaveLength(1);
  });

  it('it scrolls to the last exchange on arrival (with a little of what came before above it)', async () => {
    fakeLayout();
    open({ reader: null });
    await settle();
    const sc = fakeLayout();
    const top = lineOf(LAST_YOU).getBoundingClientRect().top - sc.getBoundingClientRect().top;
    expect(sc.scrollTop).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThanOrEqual(200);
  });

  it('Open all in this step opens every item of that step, and then folds them', async () => {
    open();
    await settle();
    const review = mainLines(longJob.payload).filter((l) => l.step === 'review').map((l) => l.id);
    const group = itemOf(REVIEW_REPLY).closest<HTMLElement>('.jp2-cv-group')!;
    fireEvent.click(within(group).getByRole('button', { name: 'Open all in this step' }));
    await settle();
    expect(openIds().filter((id) => review.includes(id!))).toEqual(review);
    // Only that step.
    expect(openIds().filter((id) => !review.includes(id!))).toEqual([]);
    fireEvent.click(within(group).getByRole('button', { name: 'Fold all in this step' }));
    expect(openIds()).toEqual([]);
  });

  it('the filter box narrows the lines as he types, says how many, and Escape clears it', async () => {
    open();
    await settle();
    const box = screen.getByRole('searchbox', { name: 'Search the conversation' });
    fireEvent.change(box, { target: { value: 'week' } });
    // Headlines, and the bodies loaded so far (the open last exchange's two).
    const has = (l: { id: string; headline: string }, w: string) => l.headline.toLowerCase().includes(w) || ([LAST_YOU, LAST_REPLY].includes(l.id) && longJob.bodies[l.id].text.toLowerCase().includes(w));
    const week = mainLines(longJob.payload).filter((l) => has(l, 'week'));
    expect(week.length).toBeGreaterThan(2);
    expect(items().map((x) => x.dataset.id)).toEqual(week.map((l) => l.id));
    fireEvent.change(box, { target: { value: 'week picker' } });
    const picker = mainLines(longJob.payload).filter((l) => has(l, 'week picker'));
    expect(items().map((x) => x.dataset.id)).toEqual(picker.map((l) => l.id));
    expect(screen.getByText(`${picker.length} of ${mainLines(longJob.payload).length} lines`)).toBeInTheDocument();
    // While it filters: no small events, no New line, no group left empty.
    expect(convo().querySelectorAll('.jp2-cv-sm-h, .jp2-cv-new')).toHaveLength(0);
    for (const g of convo().querySelectorAll('.jp2-cv-group')) expect(g.querySelectorAll('.jp2-cv-item').length).toBeGreaterThan(0);
    fireEvent.change(box, { target: { value: 'nothing says this' } });
    expect(items()).toHaveLength(0);
    expect(screen.getByText('No line has those words.')).toBeInTheDocument();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveValue('');
    expect(items()).toHaveLength(mainLines(longJob.payload).length);
  });

  it('Jump to latest goes to the end', async () => {
    open();
    await settle();
    const sc = fakeLayout();
    sc.scrollTop = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }));
    expect(sc.scrollTop).toBe(sc.scrollHeight - sc.clientHeight);
  });

  it('the Conversation row and g c show it (a laptop: it is in its column already; they put the focus in its search box)', async () => {
    open({ reader: null });
    await settle();
    // In its own column from the start; never in the reader.
    expect(column().contains(convo())).toBe(true);
    expect(convo().querySelectorAll('.jp2-cv-group').length).toBeGreaterThan(3);
    expect(reader().querySelector('[data-view="conversation"]')).toBeNull();
    const box = within(column()).getByRole('searchbox', { name: 'Search the conversation' });
    fireEvent.click(screen.getByRole('button', { name: /^Conversation · 52/ }));
    expect(document.activeElement).toBe(box);
    expect(reader().querySelector('[data-view="conversation"]')).toBeNull();
    act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    fireEvent.click(screen.getByRole('button', { name: 'Ticket and goal' }));
    expect(reader().querySelector('[data-view="conversation"]')).toBeNull();
    expect(column().contains(convo())).toBe(true);
    act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    act(() => { fireEvent.keyDown(document.body, { key: 'g' }); });
    act(() => { fireEvent.keyDown(document.body, { key: 'c' }); });
    expect(document.activeElement).toBe(box);
    expect(convo().querySelectorAll('.jp2-cv-group').length).toBeGreaterThan(3);
  });
});

describe('nothing he reads moves', () => {
  it('a new message arriving while he reads adds a line; scrollTop and the line under the pointer stay put', async () => {
    const o = open();
    await settle();
    const sc = fakeLayout();
    sc.scrollTop = 420;
    fireEvent.scroll(sc);
    const under = lineOf(REVIEW_REPLY);
    fireEvent.mouseOver(under);
    const before = under.getBoundingClientRect();
    const count = items().length;
    const next = clone(o.payload);
    next.v += 1;
    next.thread.push(newLine(next, 'reply:new000000001', '2026-11-04T15:10:00.000Z', 'The file name now carries the office.'));
    next.rows.conversation.count += 1;
    await o.push(next);
    expect(items()).toHaveLength(count + 1);
    expect(items().at(-1)!.dataset.id).toBe('reply:new000000001');
    // Folded: a line, not a wall of text.
    expect(lineOf('reply:new000000001')).toHaveAttribute('aria-expanded', 'false');
    expect(sc.scrollTop).toBe(420);
    const after = lineOf(REVIEW_REPLY).getBoundingClientRect();
    expect([after.top, after.height]).toEqual([before.top, before.height]);
  });

  it('at the very end too: a new line does not pull the page down to it', async () => {
    const o = open();
    await settle();
    const sc = fakeLayout();
    sc.scrollTop = sc.scrollHeight - sc.clientHeight;
    fireEvent.scroll(sc);
    const was = sc.scrollTop;
    const next = clone(o.payload);
    next.v += 1;
    next.thread.push(newLine(next, 'reply:new000000002', '2026-11-04T15:20:00.000Z', 'Another answer.'));
    await o.push(next);
    expect(items().at(-1)!.dataset.id).toBe('reply:new000000002');
    expect(sc.scrollTop).toBe(was);
  });

  it('an item above opening (its text landing late) keeps the line he clicked where it was', async () => {
    const o = open({ hold: [OLD_REPLY] });
    await settle();
    const sc = fakeLayout();
    // He scrolls up to where both show: the older reply, and below it a review reply.
    sc.scrollTop = Math.max(0, lineOf(OLD_REPLY).getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 40);
    fireEvent.scroll(sc);
    fireEvent.click(lineOf(OLD_REPLY));
    await settle();
    expect(itemOf(OLD_REPLY).querySelector('.jp2-cv-full')).toBeNull();
    const clicked = lineOf('reply:d960b0750c96');
    fireEvent.mouseOver(clicked);
    fireEvent.click(clicked);
    await settle();
    expect(itemOf('reply:d960b0750c96').querySelector('.jp2-cv-full')).not.toBeNull();
    const before = clicked.getBoundingClientRect().top;
    const scrollWas = sc.scrollTop;
    // The older one's text lands above it.
    await act(async () => { o.release(OLD_REPLY); await new Promise((r) => setTimeout(r, 0)); });
    expect(itemOf(OLD_REPLY).querySelector('.jp2-cv-full')).not.toBeNull();
    expect(lineOf('reply:d960b0750c96').getBoundingClientRect().top).toBe(before);
    expect(sc.scrollTop).toBe(scrollWas + 300);
  });

  it('opening an item keeps its line where it was, and so does Open all in this step for its head', async () => {
    open();
    await settle();
    const sc = fakeLayout();
    sc.scrollTop = 500;
    fireEvent.scroll(sc);
    const line = lineOf(REVIEW_REPLY);
    const top = line.getBoundingClientRect().top;
    fireEvent.click(line);
    await settle();
    expect(lineOf(REVIEW_REPLY).getBoundingClientRect().top).toBe(top);
    // A step that spans two days: opening all of it opens items above the head he clicked.
    const groups = [...convo().querySelectorAll<HTMLElement>('.jp2-cv-group')].filter((g) => g.querySelector('.jp2-cv-gt')!.textContent!.startsWith('Review'));
    const head = groups.at(-1)!.querySelector<HTMLElement>('.jp2-cv-gh')!;
    const headTop = head.getBoundingClientRect().top;
    fireEvent.click(within(head).getByRole('button', { name: /all in this step$/ }));
    await settle();
    expect(head.getBoundingClientRect().top).toBe(headTop);
  });
});

describe('look fix: arrival and clearing the filter', () => {
  it('when most lines are new, it still opens at the last exchange (the New line stays where the new ones start)', async () => {
    localStorage.setItem(seenKey(SLUG), '2026-11-01T00:00:00.000Z');
    fakeLayout();
    open({ reader: null });
    await settle();
    const sc = convo();
    const mark = convo().querySelector<HTMLElement>('.jp2-cv-new')!;
    expect(mark.nextElementSibling).toBe(items()[1]);
    const top = lineOf(LAST_YOU).getBoundingClientRect().top - sc.getBoundingClientRect().top;
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThanOrEqual(200);
  });

  it('clearing the filter keeps the line he found where it was on screen', async () => {
    open();
    await settle();
    const sc = fakeLayout();
    const box = screen.getByRole('searchbox', { name: 'Search the conversation' });
    fireEvent.change(box, { target: { value: 'week picker' } });
    expect(sc.scrollTop).toBe(0);
    const found = items()[1].dataset.id!;
    fireEvent.mouseOver(lineOf(found));
    const top = lineOf(found).getBoundingClientRect().top;
    fireEvent.change(box, { target: { value: '' } });
    expect(items()).toHaveLength(mainLines(longJob.payload).length);
    expect(lineOf(found).getBoundingClientRect().top).toBe(top);
    expect(sc.scrollTop).toBeGreaterThan(0);
  });
});

describe('fast on a long job', () => {
  it('200 items: opening the conversation commits in under 100 ms (400 on CI) and draws lines, not 200 bodies', async () => {
    // Under 1100 px, where the reader opens the conversation (on a laptop it is in its own column from
    // the start: the last test in this file checks its lines and bodies there).
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    const o = open({ job: longJob200 as Fixture, reader: { kind: 'ticket', id: 'ticket' } as never });
    await settle();
    // Each open draws the view afresh (the reader keys a view by what it shows). The first open in a
    // test run also pays for compiling the code, which the app has done long before he clicks: the
    // time taken is the best of five opens, each from the ticket, so another process on the laptop
    // does not count against the page.
    const times: number[] = [];
    let asked: string[] = [];
    for (let i = 0; i < 5; i++) {
      act(() => { o.store.setReader({ kind: 'ticket', id: 'ticket' }); });
      o.item.mockClear();
      const t0 = performance.now();
      act(() => { o.store.setReader(CONVERSATION); });
      times.push(performance.now() - t0);
      if (i === 0) { asked = o.item.mock.calls.map((c) => c[1] as string); await settle(); }
    }
    console.info(`[timing] 200-item conversation commit, five opens: ${times.map((t) => t.toFixed(1)).join(', ')} ms`);
    // The node counts below are the hard check everywhere. The clock is held to 100 ms on the laptop;
    // on a CI runner (slower, shared) only to 400 ms: real timing is Task 23's check in a browser.
    expect(Math.min(...times)).toBeLessThan(process.env.CI ? 400 : 100);
    expect(convo().querySelectorAll('.jp2-cv-line')).toHaveLength(mainLines(longJob200.payload).length);
    // Only the last exchange is open (his "Not yet.", Brief #60 and the answer): three bodies asked for, never 200.
    expect(asked).toEqual(['you:c24b0cee5d62', 'brief:briefs/060-review.md', 'reply:5fbf6afee61a']);
    expect(convo().querySelectorAll('.jp2-cv-full')).toHaveLength(3);
    expect(convo().querySelectorAll('.jp2-prose')).toHaveLength(3);
  });
});

describe('marking seen', () => {
  it('under 1100 px a conversation behind the left pane is not seen; opening it over the pane is', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    localStorage.setItem(seenKey(SLUG), '2026-11-04T14:47:00.000Z');
    fakeLayout();
    open({ reader: null, patch: (p) => { p.open = CONVERSATION; } });
    await settle();
    expect(convo()).not.toBeNull();
    expect(localStorage.getItem(seenKey(SLUG))).toBe('2026-11-04T14:47:00.000Z');
    fireEvent.click(screen.getByRole('button', { name: /^Conversation · 52 · 1 new$/ }));
    await settle();
    expect(localStorage.getItem(seenKey(SLUG))).toBe(longJob.payload.thread.at(-1)!.at);
  });
});

describe('fix round 1', () => {
  it('I1: a cold open (bodies not loaded yet) still puts the last exchange 120 px from the top once they land', async () => {
    fakeLayout();
    const o = open({ reader: null, hold: [LAST_YOU, LAST_REPLY] });
    await settle();
    const sc = convo();
    const at = () => lineOf(LAST_YOU).getBoundingClientRect().top - sc.getBoundingClientRect().top;
    // The list ends just under it: the scroll stops at its end for now.
    expect(sc.scrollTop).toBe(sc.scrollHeight - sc.clientHeight);
    await act(async () => { o.release(LAST_YOU); await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { o.release(LAST_REPLY); await new Promise((r) => setTimeout(r, 0)); });
    expect(itemOf(LAST_REPLY).querySelector('.jp2-cv-full')).not.toBeNull();
    expect(at()).toBe(120);
  });

  it('I1: once he has scrolled, a body landing late does not pull him back to the last exchange', async () => {
    fakeLayout();
    const o = open({ reader: null, hold: [LAST_YOU, LAST_REPLY] });
    await settle();
    const sc = convo();
    sc.scrollTop = 200;
    fireEvent.scroll(sc);
    await act(async () => { o.release(LAST_YOU); o.release(LAST_REPLY); await new Promise((r) => setTimeout(r, 0)); });
    expect(sc.scrollTop).toBe(200);
  });

  it('I2: a message that arrives while he reads higher up stays new: the row keeps `· 1 new`, Jump to latest says so, and the New line marks it', async () => {
    fakeLayout();
    const o = open();
    await settle();
    const sc = convo();
    // On arrival the last answer is in view: seen.
    expect(localStorage.getItem(seenKey(SLUG))).toBe(LAST_AT);
    sc.scrollTop = 300;
    fireEvent.scroll(sc);
    const next = clone(o.payload);
    next.v += 1;
    next.thread.push(newLine(next, 'reply:new000000003', '2026-11-04T15:30:00.000Z', 'One more answer.'));
    next.rows.conversation.count += 1;
    await o.push(next);
    expect(localStorage.getItem(seenKey(SLUG))).toBe(LAST_AT);
    expect(screen.getByRole('button', { name: /^Conversation · 53 · 1 new$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jump to latest · 1 new' })).toBeInTheDocument();
    expect(itemOf('reply:new000000003').previousElementSibling).toHaveClass('jp2-cv-new');
    // He goes down to it: now it is seen.
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest · 1 new' }));
    expect(localStorage.getItem(seenKey(SLUG))).toBe('2026-11-04T15:30:00.000Z');
    expect(screen.getByRole('button', { name: /^Conversation · 53$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeInTheDocument();
  });

  it('I2: a view with no size (not laid out) marks nothing seen', async () => {
    localStorage.setItem(seenKey(SLUG), '2026-11-04T14:47:00.000Z');
    open();
    await settle();
    expect(localStorage.getItem(seenKey(SLUG))).toBe('2026-11-04T14:47:00.000Z');
  });

  it('the filter finds words in headlines and in the bodies already loaded, and its box says so', async () => {
    open();
    await settle();
    const box = screen.getByRole('searchbox', { name: 'Search the conversation' });
    expect(box).toHaveAttribute('placeholder', 'Find in headlines and opened messages');
    // Words only the open last answer's body has (its first sentence after the headline).
    const words = longJob.bodies[LAST_REPLY].text.split(/(?<=\.)\s+/)[1].slice(0, 30).toLowerCase();
    expect(mainLines(longJob.payload).some((l) => l.headline.toLowerCase().includes(words))).toBe(false);
    fireEvent.change(box, { target: { value: words } });
    expect(items().map((x) => x.dataset.id)).toContain(LAST_REPLY);
  });

  it('j and k move between the conversation’s lines when he is in it; Enter is left to the line (it opens or folds it)', async () => {
    open();
    await settle();
    fakeLayout();
    const lines = () => [...convo().querySelectorAll<HTMLElement>('.jp2-cv-line')];
    act(() => { lineOf(OLD_REPLY).focus(); });
    const at = lines().indexOf(lineOf(OLD_REPLY));
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'j' }); });
    expect(document.activeElement).toBe(lines()[at + 1]);
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'k' }); });
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'k' }); });
    expect(document.activeElement).toBe(lines()[at - 1]);
    // Enter is not taken by the page: the line's own click opens it.
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Enter' })).toBe(true);
    // With the focus on the left, j still moves on the left.
    act(() => { (document.activeElement as HTMLElement).blur(); });
    act(() => { fireEvent.keyDown(document.body, { key: 'j' }); });
    expect(document.activeElement?.closest('.jp2-left')).not.toBeNull();
  });

  it('a width change that rewraps the open texts keeps the line he reads in place', async () => {
    let told: (() => void) | null = null;
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { told = cb; } observe() {} disconnect() {} });
    fakeLayout();
    open();
    await settle();
    const sc = convo();
    // He has scrolled a little (the arrival's place is his own now).
    sc.scrollTop -= 10;
    act(() => { fireEvent.scroll(sc); });
    const under = lineOf(LAST_REPLY);
    fireEvent.mouseOver(under);
    const before = under.getBoundingClientRect().top;
    // Narrower: his open message above wraps taller.
    BODY_PX = 420;
    act(() => { told!(); });
    expect(lineOf(LAST_REPLY).getBoundingClientRect().top).toBe(before);
  });
});

describe('Task 23 fix round 2: a new line draws its own group only (speed rule 5)', () => {
  const line = (id: string): ThreadLine => ({ id, kind: 'reply', at: '2026-11-04T10:00:00Z', step: null, headline: id, mine: false, hash: id });
  const a = line('a');
  const b = line('b');
  const fns = { onToggle: () => {}, onAll: () => {}, onSmall: () => {}, onOpen: () => {} };
  // (ids: the step's lines, which are no prop of a group: a new line elsewhere in its step does not draw it.)
  const props = (lines: ThreadLine[], _ids: string[], newId: string | null = null) => ({
    group: { key: 'g:a', step: null, label: 'Start', day: 'Tuesday', lines, small: [] },
    open: EMPTY_OPEN, allOpen: false, newId, smallOpen: false, showSmall: true, ...fns,
  });
  const EMPTY_OPEN: ReadonlySet<string> = new Set();

  it('a group made again from a newer payload with the same lines (new arrays) does not draw again', () => {
    expect(sameGroupProps(props([a, b], ['a', 'b']), props([a, b], ['a', 'b']))).toBe(true);
  });

  it('a new line in another group of the same step does not draw this one', () => {
    expect(sameGroupProps(props([a], ['a']), props([a], ['a', 'b']))).toBe(true);
  });

  it('a group whose lines changed, or that gains the New mark, draws again', () => {
    expect(sameGroupProps(props([a], ['a']), props([a, b], ['a', 'b']))).toBe(false);
    expect(sameGroupProps(props([a, b], ['a', 'b']), props([a, b], ['a', 'b'], 'b'))).toBe(false);
  });
});

describe('the glance layout: the conversation in its own column (a laptop)', () => {
  it('200 items in the column: lines, not 200 bodies; only the last exchange asks for its texts', async () => {
    const o = open({ job: longJob200 as Fixture, reader: null });
    await settle();
    expect(column().contains(convo())).toBe(true);
    expect(convo().querySelectorAll('.jp2-cv-line')).toHaveLength(mainLines(longJob200.payload).length);
    const asked = o.item.mock.calls.map((c) => c[1] as string);
    for (const id of ['you:c24b0cee5d62', 'brief:briefs/060-review.md', 'reply:5fbf6afee61a']) expect(asked).toContain(id);
    expect(convo().querySelectorAll('.jp2-cv-full')).toHaveLength(3);
  });
});
