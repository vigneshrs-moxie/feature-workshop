// The job page's conversation panel (design 3.4): the whole conversation in a full-height panel,
// newest at the bottom, with Widen, the new line, and the message box at its foot. Its scroll area
// is sized by hand here (jsdom lays nothing out): 100 px for each row of the conversation.
// Invented jobs and messages only; no model calls.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { JobDetail, Permission, ThreadItem } from '../../api/types';
import { useJobConversation } from '../../panes/Foreman/ForemanPane';
import { jobBySlug } from '../../state/reducer';
import { createStore, useWorkshopState, WorkshopContext, type Store } from '../../state/store';
import { ev, job, permission, snapshot } from '../../state/test-fixtures';
import { ConversationPanel, newCount, seenKey } from './ConversationPanel';

const NOW = new Date(Date.UTC(2026, 10, 10, 12, 0));
const at = (m: number) => new Date(Date.UTC(2026, 10, 10, 9, m)).toISOString();
const reply = (n: number, m = n): ThreadItem => ({ id: `reply:${n}`, kind: 'reply', at: at(m), html: `<p>Message ${n} from the Foreman.</p>` });
const you = (n: number, m = n): ThreadItem => ({ id: `you:${n}`, kind: 'you', at: at(m), text: `Message ${n} from you.` });

// Nine messages; the detail file folds into its brief, so it is not one of them.
const THREAD: ThreadItem[] = [
  { id: 'brief:briefs/1-spec.md', kind: 'brief', at: at(1), number: 1, stage: 'spec', file: 'briefs/1-spec.md', headline: 'The spec is ready', point: null },
  { id: 'brief:briefs/1-detail.md', kind: 'brief', at: at(1), number: 1, stage: 'detail', file: 'briefs/1-detail.md', headline: null, point: null },
  you(2),
  reply(3),
  { id: 'note:4', kind: 'note', at: at(4), text: 'You paused this reply.' },
  reply(5),
  you(6),
  { id: 'decision:7', kind: 'decision', at: at(7), text: 'You allowed: Run the tests' },
  reply(8),
  reply(9),
];
const LONG: ThreadItem[] = Array.from({ length: 30 }, (_, i) => reply(i + 11, i + 11));
const OLDER: ThreadItem[] = Array.from({ length: 10 }, (_, i) => reply(i + 1, i + 1));
const MODELS = [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }];

/** What the test's server holds: the newest page, whether older pages exist, and the older page. */
const server = { thread: [] as ThreadItem[], more: false, older: [] as ThreadItem[] };

interface Props { wide?: boolean; onWide?: (on: boolean) => void; full?: boolean; slug?: string }

function Panel({ wide = false, onWide = () => {}, full, slug = 'alpha' }: Props) {
  const state = useWorkshopState();
  const j = jobBySlug(state, slug)!;
  const conversation = useJobConversation(j);
  return <ConversationPanel job={j} conversation={conversation} now={NOW} wide={wide} onWide={onWide} full={full} />;
}

function setup({ thread = THREAD, more = false, older = [] as ThreadItem[], hosted = false, permissions = [] as Permission[], ...props }: Props & { thread?: ThreadItem[]; more?: boolean; older?: ThreadItem[]; hosted?: boolean; permissions?: Permission[] } = {}) {
  server.thread = thread;
  server.more = more;
  server.older = older;
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [job('alpha', 'running'), job('beta', 'running')], permissions, meta: { token: 't', models: MODELS } }) });
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path.includes('?before=')) return { thread: server.older, threadMore: false };
    const doc = /\/doc\?file=(.+)$/.exec(path);
    if (doc) return { file: decodeURIComponent(doc[1]), name: 'Brief', html: '<p>The brief in full.</p>' };
    if (path === '/api/job/alpha' || path === '/api/job/beta') {
      return { slug: path.slice('/api/job/'.length), thread: server.thread, threadMore: server.more, run: null, drive: { mode: 'workshop', model: 'claude-opus-5-5', sessionId: 's-1' } } as JobDetail;
    }
    throw new ApiError(404, 'Not here.');
  });
  const api = { get, post: vi.fn(async () => ({ ok: true })), ...(hosted ? { hosted: () => true } : {}) } as unknown as ApiClient;
  const ui = (p: Props) => <WorkshopContext.Provider value={{ store, api }}><Panel {...p} /></WorkshopContext.Provider>;
  const utils = render(ui(props));
  /** The newest page now holds these messages too (a 'thread' event for the job refetches it). */
  async function arrive(...items: ThreadItem[]) {
    server.thread = [...server.thread, ...items];
    act(() => { store.dispatch({ type: 'event', event: ev(20 + server.thread.length, 'thread', 'alpha', {}) }); });
    await screen.findByText(textOf(items[items.length - 1]));
  }
  return { ...utils, store, get, arrive, rerenderWith: (p: Props) => utils.rerender(ui(p)) };
}

const textOf = (it: ThreadItem) => (it.kind === 'reply' ? it.html.replace(/<[^>]+>/g, '') : 'text' in it ? it.text : '');
const panel = () => document.querySelector<HTMLElement>('.sb-convo')!;
const list = () => document.querySelector<HTMLElement>('.sb-convo-list')!;
const head = () => panel().querySelector<HTMLElement>('.sb-convo-head')!;
const box = () => screen.getByRole('textbox', { name: /Foreman/ });

/**
 * The scroll area's sizes, by hand: 100 px for each row of the conversation (the thread's children)
 * and a window of `client` px; scrollTop is clamped as a browser clamps it. A row coming or going
 * resizes what the panel watches, as a browser's ResizeObserver says, and `resizeWindow` changes the
 * window (the message box at the foot grew or shrank). Undone by the returned function.
 */
let client = 500;
const observers = new Set<{ cb: () => void; els: Element[] }>();
function fakeScroll(start = 500) {
  client = start;
  const tops = new WeakMap<Element, number>();
  const isList = (el: Element) => el.classList.contains('sb-convo-list');
  const height = (el: Element) => 100 * (el.querySelector('.thread')?.children.length ?? 0);
  const base = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get(this: HTMLElement) { return isList(this) ? height(this) : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return isList(this) ? client : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) { return isList(this) ? tops.get(this) ?? 0 : base.get!.call(this); },
    set(this: HTMLElement, v: number) { if (isList(this)) tops.set(this, Math.max(0, Math.min(height(this) - client, v))); else base.set!.call(this, v); },
  });
  vi.stubGlobal('ResizeObserver', class {
    watch: MutationObserver;
    seen: { cb: () => void; els: Element[] };
    constructor(cb: () => void) { this.watch = new MutationObserver(() => cb()); this.seen = { cb, els: [] }; observers.add(this.seen); }
    observe(el: Element) { this.seen.els.push(el); this.watch.observe(el, { childList: true, subtree: true }); }
    disconnect() { this.watch.disconnect(); observers.delete(this.seen); }
  });
  return () => {
    for (const p of ['scrollHeight', 'clientHeight', 'scrollTop']) Reflect.deleteProperty(HTMLElement.prototype, p);
    vi.unstubAllGlobals();
    observers.clear();
  };
}
/** The list's window is now `h` px high: what watches the list hears it, as from a ResizeObserver. */
function resizeWindow(h: number) {
  client = h;
  act(() => { for (const o of [...observers]) if (o.els.includes(list())) o.cb(); });
}
/** The conversation is in and its loading line has gone. */
async function loaded(text: string) {
  await screen.findByText(text);
  await waitFor(() => expect(document.querySelector('.thread .pending')).toBeNull());
}
const end = () => list().scrollHeight - list().clientHeight;
const scrollTo = (y: number) => act(() => { list().scrollTop = y; fireEvent.scroll(list()); });
/** Where a message's row sits in the scroll area's window (its top, in px from the window's top). */
function placeOf(text: string): number {
  const row = screen.getByText(text).closest('.thread > *')!;
  return 100 * [...row.parentElement!.children].indexOf(row) - list().scrollTop;
}

let undo = () => {};
afterEach(() => { cleanup(); undo(); undo = () => {}; localStorage.clear(); });

describe('ConversationPanel', () => {
  it('the whole conversation shows, with no Earlier fold, and its head counts the messages', async () => {
    setup();
    await screen.findByText('Message 9 from the Foreman.');
    expect(head()).toHaveTextContent('Conversation · 9 messages');
    expect(within(head()).getByRole('button', { name: 'Widen' })).toBeInTheDocument();
    expect(panel()).toHaveTextContent('The whole conversation, newest at the bottom');
    for (const it of THREAD.filter((x) => x.kind !== 'brief')) expect(screen.getByText(textOf(it))).toBeInTheDocument();
    expect(screen.getByText('The spec is ready')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Earlier/ })).toBeNull();
    // The message box at its foot, with the Foreman's model under it.
    expect(within(panel()).getByRole('region', { name: 'Message the Foreman' })).toHaveTextContent('Foreman model: Opus 5.5');
    expect(panel()).toHaveClass('sb-convo');
  });

  it('a waiting permission card is not drawn in the conversation', async () => {
    setup({ permissions: [permission('p-1', 'alpha')] });
    await screen.findByText('Message 9 from the Foreman.');
    expect(within(panel()).queryByText('Run a command')).toBeNull();
    expect(within(panel()).queryByRole('button', { name: /Allow/ })).toBeNull();
  });

  it('it opens at the newest message', async () => {
    undo = fakeScroll();
    setup({ thread: LONG });
    await loaded('Message 40 from the Foreman.');
    expect(end()).toBeGreaterThan(0);
    expect(list().scrollTop).toBe(end());
  });

  it('a new message keeps you at the end, but not while you read higher up', async () => {
    undo = fakeScroll();
    const { arrive } = setup({ thread: LONG });
    await loaded('Message 40 from the Foreman.');
    await arrive(reply(41));
    expect(list().scrollTop, 'at the end, it follows').toBe(end());
    // 90 px above the end still counts as at the end.
    scrollTo(end() - 90);
    await arrive(reply(42));
    expect(list().scrollTop, 'within 96 px of the end, it follows').toBe(end());
    // Reading higher up (more than 96 px above the end): a new message does not pull you down.
    scrollTo(end() - 100);
    const reading = list().scrollTop;
    await arrive(reply(43), you(44));
    expect(list().scrollTop, 'more than 96 px above the end, it stays').toBe(reading);
    expect(list().scrollTop).toBeLessThan(end() - 96);
  });

  it('Load older keeps the message you were reading where it was', async () => {
    undo = fakeScroll();
    setup({ thread: LONG, more: true, older: OLDER });
    await loaded('Message 40 from the Foreman.');
    scrollTo(150);
    const before = placeOf('Message 13 from the Foreman.');
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    await screen.findByText('Message 1 from the Foreman.');
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
    expect(placeOf('Message 13 from the Foreman.')).toBe(before);
    expect(list().scrollTop).toBeGreaterThan(150);
  });

  // Fix round 1: within 96 px of the end but not at it (the conversation nearly fits), Load older
  // still keeps your place; nothing snaps the list to its end afterwards.
  it('Load older keeps your place when the conversation nearly fits', async () => {
    undo = fakeScroll(520);
    setup({ thread: LONG.slice(0, 5), more: true, older: OLDER });
    await loaded('Message 15 from the Foreman.');
    expect(list().scrollTop, 'it opens at its end').toBe(end());
    scrollTo(0); // 80 px above the end: still "at the end" for new messages
    const before = placeOf('Message 11 from the Foreman.');
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    await screen.findByText('Message 1 from the Foreman.');
    await act(async () => {}); // what watches the list has heard the new rows
    expect(placeOf('Message 11 from the Foreman.')).toBe(before);
    expect(list().scrollTop).toBeLessThan(end());
  });

  // Fix round 1: the message box growing shrinks the list's window; at its end, the list stays there.
  it('the message box growing keeps the list at its end, but not while you read higher up', async () => {
    undo = fakeScroll();
    setup({ thread: LONG });
    await loaded('Message 40 from the Foreman.');
    expect(list().scrollTop).toBe(end());
    resizeWindow(400); // the box grew by five lines
    expect(list().scrollTop, 'still at the end').toBe(end());
    scrollTo(end() - 300);
    const reading = list().scrollTop;
    resizeWindow(500); // the box shrank back after Send
    expect(list().scrollTop, 'reading higher up: left where it is').toBe(reading);
  });

  it('Widen asks for the full page and its word becomes Back to the job', async () => {
    const onWide = vi.fn();
    const { rerenderWith, arrive } = setup({ onWide });
    await screen.findByText('Message 9 from the Foreman.');
    // Review Focus 2: what you were typing stays through Widen, Back and a new message.
    fireEvent.change(box(), { target: { value: 'Half a thought about the dialog' } });
    const typing = box();
    fireEvent.click(screen.getByRole('button', { name: 'Widen' }));
    expect(onWide).toHaveBeenLastCalledWith(true);
    rerenderWith({ onWide, wide: true });
    expect(panel()).toHaveClass('is-wide');
    expect(screen.queryByRole('button', { name: 'Widen' })).toBeNull();
    await arrive(reply(10));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the job' }));
    expect(onWide).toHaveBeenLastCalledWith(false);
    rerenderWith({ onWide, wide: false });
    expect(screen.getByRole('button', { name: 'Widen' })).toBeInTheDocument();
    expect(box()).toBe(typing);
    expect(box()).toHaveValue('Half a thought about the dialog');
  });

  it('newCount counts only messages after your last look, never your own', () => {
    // After 9:05: you(6), the decision you made (7), reply 8 and reply 9.
    expect(newCount(THREAD, at(5))).toBe(2);
    expect(newCount(THREAD, at(0))).toBe(6); // brief 1, replies 3, 5, 8, 9 and the note; not the detail file
    expect(newCount(THREAD, at(9))).toBe(0);
    expect(newCount([...THREAD, you(10), { id: 'note:11', kind: 'note', at: at(11), text: 'You updated this job’s notes (notes.md).', notes: true }], at(9))).toBe(0);
    expect(newCount(THREAD, null), 'never looked: nothing to count from').toBe(0);
    expect(newCount([{ ...reply(12), at: null }], at(1)), 'a message with no time is not new').toBe(0);
  });

  it('looking at the conversation clears the count', async () => {
    undo = fakeScroll(); // shown: the list has a size
    localStorage.setItem(seenKey('alpha'), at(5));
    const { arrive } = setup();
    await screen.findByText('Message 9 from the Foreman.');
    await waitFor(() => expect(localStorage.getItem(seenKey('alpha'))).toBe(at(9)));
    expect(newCount(THREAD, localStorage.getItem(seenKey('alpha')))).toBe(0);
    // While it is on screen, a new message is seen too.
    await arrive(reply(10));
    await waitFor(() => expect(localStorage.getItem(seenKey('alpha'))).toBe(at(10)));
  });

  it('the full form draws the new line above the first new message', async () => {
    undo = fakeScroll();
    localStorage.setItem(seenKey('alpha'), at(5));
    setup({ full: true });
    await screen.findByText('Message 9 from the Foreman.');
    expect(head()).toHaveTextContent('Conversation');
    expect(head()).toHaveTextContent('9 messages · 2 new');
    expect(within(head()).queryByRole('button')).toBeNull();
    const line = within(panel()).getByText('2 new');
    // Above reply 8, the first new message that is not yours (your own 6 and your decision 7 are not new).
    const next = line.closest('.thread > *')!.nextElementSibling!;
    expect(next).toHaveTextContent('Message 8 from the Foreman.');
    expect(screen.getAllByText(/^\d+ new$/)).toHaveLength(1);
    // Your look is kept for this view: the line stays while you read.
    await waitFor(() => expect(localStorage.getItem(seenKey('alpha'))).toBe(at(9)));
    expect(within(panel()).getByText('2 new')).toBeInTheDocument();
  });

  // Fix round 1: messages are seen only while you can see them.
  it('nothing is seen while the page is in the background or the panel is not shown', async () => {
    let state: DocumentVisibilityState = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    const scroll = fakeScroll(0); // not shown yet: the list has no size
    undo = () => { scroll(); Reflect.deleteProperty(document, 'visibilityState'); };
    localStorage.setItem(seenKey('alpha'), at(5));
    const { arrive } = setup();
    await loaded('Message 9 from the Foreman.');
    await act(async () => {});
    expect(localStorage.getItem(seenKey('alpha')), 'not shown, page hidden').toBe(at(5));
    state = 'visible';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(localStorage.getItem(seenKey('alpha')), 'page in front, panel still not shown').toBe(at(5));
    resizeWindow(500); // the panel is shown
    expect(localStorage.getItem(seenKey('alpha'))).toBe(at(9));
    // The page goes to the background: a new message waits to be seen until it comes back.
    state = 'hidden';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await arrive(reply(10));
    await act(async () => {});
    expect(localStorage.getItem(seenKey('alpha'))).toBe(at(9));
    state = 'visible';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(localStorage.getItem(seenKey('alpha'))).toBe(at(10));
  });

  // Fix round 1: another job in the same panel starts afresh: its own last look and new count.
  it('another job starts afresh: its own new count and its own scroll place', async () => {
    undo = fakeScroll();
    localStorage.setItem(seenKey('alpha'), at(5));
    localStorage.setItem(seenKey('beta'), at(8));
    const { rerenderWith } = setup({ full: true });
    await loaded('Message 9 from the Foreman.');
    expect(head()).toHaveTextContent('9 messages · 2 new');
    const alphaList = list();
    rerenderWith({ full: true, slug: 'beta' });
    await waitFor(() => expect(head()).toHaveTextContent('9 messages · 1 new'));
    expect(list(), 'a list of its own').not.toBe(alphaList);
    expect(within(panel()).getByText('1 new')).toBeInTheDocument();
  });

  it('on the website a reply the laptop keeps reads as its note', async () => {
    const kept = 'Your reply to brief 2 waits for Claude’s usage limit to reset; it goes to the Foreman then.';
    setup({ hosted: true, thread: [...THREAD, { id: 'note:held', kind: 'note', at: at(10), text: kept }] });
    const note = await screen.findByText(kept);
    expect(note).toHaveTextContent(kept);
    expect(within(panel()).queryByRole('alert')).toBeNull();
    expect(head()).toHaveTextContent('Conversation · 10 messages');
    expect(box()).toBeInTheDocument();
  });
});
