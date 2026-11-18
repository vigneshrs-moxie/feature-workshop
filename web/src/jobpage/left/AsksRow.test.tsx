// The asks row and ⌘K (Task 19, design brief R6): one click for what he types again and again, the
// exact words on show. Built on the made-up long job (its open step is Review).
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import { installKeyListener, resetChord } from '../../app/keyRegistry';
import { UiProvider, useUi } from '../../app/ui';
import { clearAllSent } from '../../lib/sentState';
import { clearGateSent } from '../../panes/Foreman/gateSent';
import { createStore, WorkshopContext } from '../../state/store';
import { LEVELS, snapshot } from '../../state/test-fixtures';
import { ASKS, FAST_SAYS, GAP, KEPT_KEY, MARK_DONE_SAYS, PULL_SAYS, askById, rowFor } from '../asks';
import { longJob } from '../fixtures/longJob';
import { browserDrafts, createJobStore, type JobStore } from '../jobStore';
import { JobPage2 } from '../JobPage2';
import { forgetRecentPages } from '../recent';
import type { JobBody, JobPagePayload, StopId } from '../types';
import { ALREADY_FAST, BACK_TO_OWN, createAskRunner, DONE_LOADING, HOLD_MS, KEPT, QUEUED } from './AsksRow';
import { forgetSentGo } from './YourMove';

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const payload = () => clone(longJob.payload) as unknown as JobPagePayload;

const media = { width: 1512, heard: new Set<() => void>() };
function windowWidth(px: number) {
  media.width = px;
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    return {
      get matches() { return (!min || media.width >= Number(min[1])) && (!max || media.width <= Number(max[1])); },
      media: q,
      addEventListener(_: string, fn: () => void) { media.heard.add(fn); },
      removeEventListener(_: string, fn: () => void) { media.heard.delete(fn); },
    };
  });
}

type Fn = ReturnType<typeof vi.fn>;
const OPTIONS = { level: 2, flow: 'small', skip: ['refine'], reviewers: 'auto', fable_checks: ['plan', 'review'], notes: 'keep these', review_rounds: 1, updated_at: '2026-11-13T10:00:00.000Z' };

/** A server that takes a message (202 waiting when queued and the Foreman works), and keeps options. */
function server({ working = false } = {}) {
  let options: Record<string, unknown> = clone(OPTIONS);
  let stamp = 0;
  const post = vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
    const b = (body ?? {}) as { queue?: boolean; text?: string; options?: Record<string, unknown> };
    if (path.endsWith('/options')) {
      stamp += 1;
      options = { ...b.options!, updated_at: `2026-11-13T10:0${stamp}:00.000Z` };
      return { ok: true, options, summary: [], updated_at: options.updated_at };
    }
    if (path.endsWith('/send')) return b.queue && working ? { ok: true, waiting: { text: b.text, at: '2026-11-13T12:00:00.000Z', why: null } } : { run: { id: 'r1' } };
    return { ok: true };
  });
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path === `/api/job/${SLUG}`) return { slug: SLUG, options };
    throw new Error('Starbase answered 404.');
  });
  return { post, get };
}

interface Opened { store: JobStore; app: ReturnType<typeof createStore>; post: Fn; get: Fn; unmount(): void; serve(p: JobPagePayload): Promise<void> }

function open({ patch = {}, srv = server(), beside = null }: { patch?: Partial<JobPagePayload>; srv?: ReturnType<typeof server>; beside?: React.ReactNode } = {}): Opened {
  let current = { ...payload(), ...patch };
  window.history.replaceState(null, '', `/#/job/${SLUG}`);
  const store = createJobStore(SLUG, {
    api: {
      page: async () => current,
      item: async (_slug, id) => { const b = longJob.bodies[id]; if (!b) throw new Error('Starbase answered 404.'); return { ...b, version: String(b.meta.hash ?? b.id) } satisfies JobBody; },
    },
    events: () => () => {}, viewer: () => null, initial: current, drafts: browserDrafts,
  });
  const app = createStore();
  app.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [], permissions: [], meta: { token: 't', levels: LEVELS } }) });
  const api = { get: srv.get, post: srv.post, hosted: () => false } as unknown as ApiClient;
  const utils = render(
    <WorkshopContext.Provider value={{ api, store: app }}>
      <UiProvider><JobPage2 slug={SLUG} job={null} store={store} />{beside}</UiProvider>
    </WorkshopContext.Provider>,
  );
  return {
    store, app, post: srv.post, get: srv.get, unmount: utils.unmount,
    serve: async (next) => { current = next; await act(async () => { await store.loadPage(); }); },
  };
}

const row = () => within(document.querySelector<HTMLElement>('.jp2-asks')!);
const rowLabels = () => [...document.querySelectorAll<HTMLButtonElement>('.jp2-asks .jp2-askb')].filter((b) => !b.hidden).map((b) => b.textContent);
const box = () => screen.getByRole('textbox', { name: 'Message to the Foreman', hidden: true }) as HTMLTextAreaElement;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const sends = (post: Fn) => post.mock.calls.filter((c) => String(c[0]).endsWith('/send'));
const optionPosts = (post: Fn) => post.mock.calls.filter((c) => String(c[0]).endsWith('/options'));
const cmdK = () => act(() => { fireEvent.keyDown(document.body, { key: 'k', metaKey: true }); });
const palette = () => screen.queryByRole('dialog', { name: 'Asks and places' });
const pickStep = (o: Opened, id: StopId) => act(() => { o.store.setStep(id); });

let offKeys: () => void = () => {};
beforeEach(() => { windowWidth(1512); localStorage.clear(); forgetRecentPages(); forgetSentGo(); offKeys = installKeyListener(); resetChord(); });
afterEach(() => { offKeys(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); clearAllSent(); clearGateSent(); window.history.replaceState(null, '', '/'); });

describe('the row', () => {
  it('sits above the message box and holds at most four asks, fitted to the open step', async () => {
    const o = open();
    await settle();
    const asks = document.querySelector('.jp2-asks')!;
    // The line above the box (what the Foreman is doing) sits between them.
    expect(asks.nextElementSibling).toHaveClass('jp2-now');
    expect(asks.nextElementSibling!.nextElementSibling).toBe(document.querySelector('.jp2-mbw'));
    // The long job is at Review.
    expect(rowLabels()).toEqual(['Fix the open findings', 'Go faster', 'Where are we?', 'Explain this step']);
    pickStep(o, 'test');
    expect(rowLabels()).toEqual(['How do I test this by hand?', 'Ask to start the app', 'It works', 'Run the checks again']);
    pickStep(o, 'plan');
    expect(rowLabels()).toEqual(['Summarise for approval', 'Drop something…', 'Go faster', 'Where are we?']);
    for (const s of ['spec', 'investigate', 'plan', 'build', 'test', 'review', 'ship'] as const) {
      pickStep(o, s);
      expect(rowLabels().length).toBeLessThanOrEqual(4);
      expect(rowLabels()).toEqual(rowFor(s).map((a) => a.label));
    }
  });

  it('shows ⌘K at its end, which opens every ask and the page’s places', async () => {
    open();
    await settle();
    fireEvent.click(row().getByRole('button', { name: /^(⌘K|Ctrl\+K)$/ }));
    expect(palette()).toBeInTheDocument();
  });

  it('on the phone scrolls sideways and has no ⌘K', async () => {
    windowWidth(390);
    open();
    await settle();
    expect(rowLabels().length).toBeGreaterThan(0);
    expect(row().queryByRole('button', { name: /^(⌘K|Ctrl\+K)$/ })).toBeNull();
    // ⌘K on the phone is the app's, not the page's.
    cmdK();
    expect(palette()).toBeNull();
  });
});

describe('an ask with nothing to fill in', () => {
  it('says Sent · Undo at once, holds the words four seconds, then sends its exact text', async () => {
    const o = open();
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const before = vi.getTimerCount();
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    const msg = document.querySelector<HTMLElement>('.jp2-asks-msg')!;
    expect(msg).toHaveTextContent(/^Sent·Undo$/);
    expect(within(msg).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    // One timer, and nothing sent yet.
    expect(vi.getTimerCount() - before).toBe(1);
    act(() => { vi.advanceTimersByTime(HOLD_MS - 1); });
    expect(sends(o.post)).toHaveLength(0);
    expect(document.querySelector('.jp2-asks-msg')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    await flush();
    expect(sends(o.post)).toHaveLength(1);
    expect(sends(o.post)[0][1]).toEqual({ kind: 'message', text: askById('where')!.text, queue: true });
    expect(document.querySelector('.jp2-asks-msg')).toBeNull();
    expect(vi.getTimerCount() - before).toBe(0);
  });

  it('Undo within the four seconds cancels it before it leaves', async () => {
    const o = open();
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const before = vi.getTimerCount();
    fireEvent.click(row().getByRole('button', { name: 'Explain this step' }));
    act(() => { vi.advanceTimersByTime(3000); });
    fireEvent.click(row().getByRole('button', { name: 'Undo' }));
    expect(document.querySelector('.jp2-asks-msg')).toBeNull();
    expect(vi.getTimerCount() - before).toBe(0);
    act(() => { vi.advanceTimersByTime(10_000); });
    await flush();
    expect(sends(o.post)).toHaveLength(0);
  });

  it('a second ask within the four seconds is held with the first on the one timer: Sent 2 · Undo, then both go as one message', async () => {
    const o = open();
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const before = vi.getTimerCount();
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.click(row().getByRole('button', { name: 'Fix the open findings' }));
    await flush();
    expect(sends(o.post)).toHaveLength(0);
    expect(vi.getTimerCount() - before).toBe(1);
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent(/^Sent 2·Undo$/);
    // The newest ask has its own four seconds.
    act(() => { vi.advanceTimersByTime(HOLD_MS - 1); });
    expect(sends(o.post)).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(1); });
    await flush();
    expect(sends(o.post).map((c) => (c[1] as { text: string }).text)).toEqual([`2 asks: Where are we?; Fix the open findings\n\n${askById('where')!.text}\n\n${askById('fixfind')!.text}`]);
    expect(vi.getTimerCount() - before).toBe(0);
  });

  it('Undo on Sent 2 takes back both', async () => {
    const o = open();
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    fireEvent.click(row().getByRole('button', { name: 'Explain this step' }));
    fireEvent.click(row().getByRole('button', { name: 'Undo' }));
    act(() => { vi.advanceTimersByTime(10_000); });
    await flush();
    expect(sends(o.post)).toHaveLength(0);
    expect(document.querySelector('.jp2-asks-msg')).toBeNull();
  });

  it('while the Foreman works it waits for the reply like a typed message (the box shows it with Cancel)', async () => {
    const o = open({ srv: server({ working: true }), patch: { run: { id: 'run-now', status: 'running', startedAt: '2026-11-13T11:59:00.000Z', lastAction: null } } });
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    await flush();
    vi.useRealTimers();
    expect(sends(o.post)[0][1]).toMatchObject({ queue: true, text: askById('where')!.text });
    const next = payload();
    next.v += 1;
    next.run = { id: 'run-now', status: 'running', startedAt: '2026-11-13T11:59:00.000Z', lastAction: null };
    next.waiting = { text: askById('where')!.text, at: '2026-11-13T12:00:00.000Z', why: null };
    await o.serve(next);
    const wait = document.querySelector<HTMLElement>('.jp2-mb-wait')!;
    expect(wait).toHaveTextContent(askById('where')!.text);
    expect(within(wait).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('on the website goes as a plain message (the laptop keeps what waits)', async () => {
    const o = open({ patch: { hosted: true } });
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    await flush();
    expect(sends(o.post)[0][1]).toEqual({ kind: 'message', text: askById('where')!.text });
  });

  it('refused: its words go to the box and the row says why', async () => {
    const srv = server();
    srv.post.mockImplementation(async () => { throw new ApiError(409, 'Usage limit reached', { code: 'limited' }); });
    open({ srv });
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    await flush();
    expect(row().getByRole('alert')).toHaveTextContent('Not sent: Claude’s usage limit is reached.');
    expect(box()).toHaveValue(askById('where')!.text);
  });

  it('leaving the page within the four seconds sends it now', async () => {
    const o = open();
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    o.unmount();
    await flush();
    expect(sends(o.post)).toHaveLength(1);
  });
});

describe('an ask that needs a word', () => {
  it('puts its text in the box with the cursor in the gap, and sends nothing', async () => {
    const o = open();
    await settle();
    pickStep(o, 'plan');
    fireEvent.click(row().getByRole('button', { name: 'Drop something…' }));
    const el = box();
    expect(el).toHaveValue('Drop  from scope. Update the spec, plan and tests to match.');
    expect(document.activeElement).toBe(el);
    expect(el.selectionStart).toBe('Drop '.length);
    expect(el.selectionEnd).toBe('Drop '.length);
    expect(sends(o.post)).toHaveLength(0);
    expect(document.querySelector('.jp2-asks-msg')).toBeNull();
  });
});

describe('no hidden prompts', () => {
  it('hovering an ask in the row shows the exact text it sends, for every ask in every step’s row', async () => {
    const o = open();
    await settle();
    const seen = new Set<string>();
    for (const s of ['spec', 'investigate', 'plan', 'build', 'test', 'review', 'ship'] as const) {
      pickStep(o, s);
      for (const b of document.querySelectorAll<HTMLButtonElement>('.jp2-asks .jp2-askb')) {
        const a = ASKS.find((x) => x.label === b.textContent)!;
        fireEvent.mouseEnter(b);
        const tip = screen.getByRole('tooltip');
        expect(tip.textContent).toContain(a.text);
        expect(b).toHaveAttribute('aria-describedby', tip.id);
        fireEvent.mouseLeave(b);
        expect(screen.queryByRole('tooltip')).toBeNull();
        seen.add(a.id);
      }
    }
    // Every ask the table puts in a row was walked.
    expect([...seen].sort()).toEqual(ASKS.filter((a) => a.inRow).map((a) => a.id).sort());
  });

  it('⌘K shows every ask with its exact text, the row’s and the ⌘K-only ones alike', async () => {
    open();
    await settle();
    cmdK();
    const box = palette()!;
    for (const a of ASKS) {
      const opt = within(box).getAllByRole('option').find((x) => x.querySelector('.palette-label')?.textContent === a.label)!;
      expect(opt, a.id).toBeDefined();
      expect(opt.querySelector('.jp2-pal-says')!.textContent).toBe(a.text);
    }
  });

  it('a focused ask shows its text too (the keyboard has no hover)', async () => {
    open();
    await settle();
    act(() => { row().getByRole('button', { name: 'Go faster' }).focus(); });
    expect(screen.getByRole('tooltip').textContent).toContain(FAST_SAYS);
    expect(screen.getByRole('tooltip').textContent).toContain('Not a message.');
  });
});

describe('⌘K', () => {
  it('lists every ask and the page’s places with a search field, and Esc closes it', async () => {
    open();
    await settle();
    cmdK();
    const dlg = palette()!;
    const search = within(dlg).getByRole('combobox', { name: 'Search asks and places' });
    expect(document.activeElement).toBe(search);
    const labels = within(dlg).getAllByRole('option').map((x) => x.querySelector('.palette-label')!.textContent);
    for (const a of ASKS) expect(labels).toContain(a.label);
    for (const p of ['Go to: Plan', 'Go to: Build', 'Go to: Changes', 'Go to: Conversation', 'Go to: Ticket and goal', 'Go to: Decisions', 'Go to: Details']) expect(labels).toContain(p);
    expect(labels.at(-1)).toBe('Every Starbase action');
    const heads = [...dlg.querySelectorAll('.palette-section')].map((h) => h.textContent);
    expect(heads.slice(0, 5)).toEqual(['For this step', 'Any step', 'Yours', 'Places', 'Other steps']);
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(palette()).toBeNull();
  });

  it('narrows as he types, by label or by the words an ask sends; Enter runs the first', async () => {
    const o = open();
    await settle();
    cmdK();
    const search = within(palette()!).getByRole('combobox');
    fireEvent.change(search, { target: { value: 'scope' } });
    expect(within(palette()!).getAllByRole('option').map((x) => x.querySelector('.palette-label')!.textContent)).toEqual(['Drop something…']);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(palette()).toBeNull();
    expect(box()).toHaveValue('Drop  from scope. Update the spec, plan and tests to match.');
    expect(document.activeElement).toBe(box());
    expect(box().selectionStart).toBe(5);
    expect(sends(o.post)).toHaveLength(0);
  });

  it('a place opens in the reader, a step opens the step', async () => {
    const o = open();
    await settle();
    cmdK();
    fireEvent.click(within(palette()!).getAllByRole('option').find((x) => x.textContent === 'Go to: Decisions')!);
    expect(palette()).toBeNull();
    expect(o.store.getState().ui.reader).toEqual({ kind: 'decisions', id: 'decisions' });
    // A laptop: the conversation is in its own column; going to it puts the focus in its search box.
    cmdK();
    fireEvent.click(within(palette()!).getAllByRole('option').find((x) => x.textContent === 'Go to: Conversation')!);
    expect(palette()).toBeNull();
    expect(document.activeElement).toBe(within(document.querySelector<HTMLElement>('section.jp2-convo')!).getByRole('searchbox', { name: 'Search the conversation' }));
    expect(o.store.getState().ui.reader).toEqual({ kind: 'decisions', id: 'decisions' });
    cmdK();
    fireEvent.click(within(palette()!).getAllByRole('option').find((x) => x.textContent === 'Go to: Plan')!);
    expect(o.store.getState().ui.step).toBe('plan');
  });

  it('an ask from ⌘K is held with Sent · Undo in the row, as from the row', async () => {
    const o = open();
    await settle();
    cmdK();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(within(palette()!).getAllByRole('option').find((x) => x.querySelector('.palette-label')?.textContent === 'Stop here')!);
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent(/^Sent·Undo$/);
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    await flush();
    expect(sends(o.post)[0][1]).toMatchObject({ text: 'Stop after the current step and wait for me.' });
  });

  it('its last row opens the app’s ⌘K, and ⌘K again closes the page’s', async () => {
    let sheet: string | null = null;
    function Probe() { const ui = useUi(); sheet = ui.sheet?.kind ?? null; return null; }
    open({ beside: <Probe /> });
    await settle();
    cmdK();
    cmdK();
    expect(palette()).toBeNull();
    cmdK();
    fireEvent.click(within(palette()!).getAllByRole('option').at(-1)!);
    expect(palette()).toBeNull();
    expect(sheet).toBe('palette');
  });
});

describe('Go faster', () => {
  it('posts the job’s options with one reviewer a round and no second looks, and says what it switched', async () => {
    const o = open();
    await settle();
    fireEvent.click(row().getByRole('button', { name: 'Go faster' }));
    await flush();
    expect(sends(o.post)).toHaveLength(0);
    expect(o.get).toHaveBeenCalledWith(`/api/job/${SLUG}`);
    expect(optionPosts(o.post)).toHaveLength(1);
    expect(optionPosts(o.post)[0][1]).toEqual({ options: { ...OPTIONS, reviewers: ['feature-reviewer'], fable_checks: [] }, updated_at: OPTIONS.updated_at });
    const msg = document.querySelector<HTMLElement>('.jp2-asks-msg')!;
    expect(msg).toHaveTextContent(`${FAST_SAYS}·Undo`);
  });

  it('Undo puts back the options it replaced', async () => {
    const o = open();
    await settle();
    fireEvent.click(row().getByRole('button', { name: 'Go faster' }));
    await flush();
    fireEvent.click(row().getByRole('button', { name: 'Undo' }));
    await flush();
    expect(optionPosts(o.post)).toHaveLength(2);
    // The options as they were, against the stamp the fast save wrote.
    expect(optionPosts(o.post)[1][1]).toEqual({ options: OPTIONS, updated_at: '2026-11-13T10:01:00.000Z' });
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent(BACK_TO_OWN);
  });

  it('says so when the job is already that fast, and changes nothing', async () => {
    const srv = server();
    srv.get.mockImplementation(async () => ({ slug: SLUG, options: { ...OPTIONS, reviewers: ['feature-reviewer'], fable_checks: [] } }));
    const o = open({ srv });
    await settle();
    fireEvent.click(row().getByRole('button', { name: 'Go faster' }));
    await flush();
    expect(optionPosts(o.post)).toHaveLength(0);
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent(ALREADY_FAST);
  });

  it('its line goes after four seconds', async () => {
    open();
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Go faster' }));
    await flush();
    expect(document.querySelector('.jp2-asks-msg')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    expect(document.querySelector('.jp2-asks-msg')).toBeNull();
  });
});

describe('Keep as an ask', () => {
  it('keeps a message he sent from its line, under sb.asks.kept, and ⌘K lists it under Yours', async () => {
    const o = open();
    await settle();
    act(() => { o.store.setReader({ kind: 'conversation', id: 'conversation' }); });
    await settle();
    const mine = document.querySelector<HTMLElement>('.jp2-cv-item.is-you[data-id="you:a0d62ac173be"]')!;
    const keep = within(mine).getByRole('button', { name: 'Keep as an ask' });
    // Only his own messages have it.
    expect(document.querySelectorAll('.jp2-cv-item:not(.is-you) .jp2-cv-keep')).toHaveLength(0);
    fireEvent.click(keep);
    await flush();
    const text = longJob.bodies['you:a0d62ac173be'].text.trim();
    expect(JSON.parse(localStorage.getItem(KEPT_KEY)!)).toEqual([text]);
    expect(keep).toHaveTextContent('Kept: in ⌘K under Yours');
    cmdK();
    const dlg = palette()!;
    const yours = [...dlg.querySelectorAll('.palette-group')].find((g) => g.querySelector('.palette-section')?.textContent === 'Yours')!;
    const opt = within(yours as HTMLElement).getByRole('option');
    expect(opt.querySelector('.jp2-pal-says')!.textContent).toBe(text);
    // Run from Yours, it is held and sent like any ask.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(opt);
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    await flush();
    expect(sends(o.post)[0][1]).toMatchObject({ text });
  });

  it('says when it is kept already', async () => {
    localStorage.setItem(KEPT_KEY, JSON.stringify([longJob.bodies['you:a0d62ac173be'].text.trim()]));
    const o = open();
    await settle();
    act(() => { o.store.setReader({ kind: 'conversation', id: 'conversation' }); });
    await settle();
    const mine = document.querySelector<HTMLElement>('.jp2-cv-item.is-you[data-id="you:a0d62ac173be"]')!;
    fireEvent.click(within(mine).getByRole('button', { name: 'Keep as an ask' }));
    await flush();
    expect(within(mine).getByRole('button', { name: 'Already kept' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEPT_KEY)!)).toHaveLength(1);
  });

  it('with nothing kept, Yours says how to keep one', async () => {
    open();
    await settle();
    cmdK();
    expect(palette()).toHaveTextContent('Nothing kept yet. Keep any message of yours from its line in the conversation.');
  });
});

describe('the gap mark', () => {
  it('is in the text of every ask that needs a word, and nowhere else', () => {
    for (const a of ASKS) expect(a.text.includes(GAP)).toBe(a.needsWord);
  });
});

describe('another place working on the job', () => {
  it('turns off the asks that send; Go faster and an ask that needs a word still work', async () => {
    const o = open({ patch: { lock: { owner: 'terminal', pid: 4242, branch: null, acquiredAt: null } } });
    await settle();
    expect(row().getByRole('button', { name: 'Where are we?' })).toBeDisabled();
    expect(row().getByRole('button', { name: 'Go faster' })).toBeEnabled();
    pickStep(o, 'plan');
    expect(row().getByRole('button', { name: 'Drop something…' })).toBeEnabled();
    // From ⌘K a sending ask says why it did not go.
    cmdK();
    fireEvent.click(within(palette()!).getAllByRole('option').find((x) => x.querySelector('.palette-label')?.textContent === 'Stop here')!);
    expect(row().getByRole('alert')).toHaveTextContent('Not sent: another place is working on this job');
    expect(sends(o.post)).toHaveLength(0);
  });
});

describe('the page’s other styles', () => {
  it('draw nothing on the row’s asks (a class of the prose, .jp2-ask, once pulled them 19 px left)', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const css = readFileSync(path.join(__dirname, '..', 'jobpage.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...css.matchAll(/([^{}@]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())).filter(Boolean);
    open();
    await settle();
    const asks = [...document.querySelectorAll<HTMLElement>('.jp2-asks .jp2-askb')];
    expect(asks.length).toBeGreaterThan(0);
    const drawn = selectors.filter((sel) => { try { return asks.some((b) => b.matches(sel)); } catch { return false; } });
    expect(drawn).toEqual([]);
  });
});

// ---------- Fix round 1 (review I1–I3, ruling M1, minors) ----------

const RUNNING_RUN = { id: 'run-now', status: 'running', startedAt: '2026-11-13T11:59:00.000Z', lastAction: null };

describe('an ask clicked while Go faster runs (I1)', () => {
  it('goes before Go faster’s line shows, and that line’s Undo puts back the options, not the ask', async () => {
    const srv = server();
    let answer: (v: unknown) => void = () => {};
    const realGet = srv.get.getMockImplementation()!;
    srv.get.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const o = open({ srv });
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const before = vi.getTimerCount();
    fireEvent.click(row().getByRole('button', { name: 'Go faster' }));
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent(/^Sent·Undo$/);
    await act(async () => { answer(await realGet(`/api/job/${SLUG}`)); });
    await flush();
    // The ask went (once), and the line is Go faster's.
    expect(sends(o.post).map((c) => (c[1] as { text: string }).text)).toEqual([askById('where')!.text]);
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent(`${FAST_SAYS}·Undo`);
    expect(vi.getTimerCount() - before).toBe(1);
    fireEvent.click(row().getByRole('button', { name: 'Undo' }));
    await flush();
    expect(optionPosts(o.post)).toHaveLength(2);
    expect(optionPosts(o.post)[1][1]).toMatchObject({ options: OPTIONS });
    act(() => { vi.advanceTimersByTime(HOLD_MS * 3); });
    await flush();
    expect(sends(o.post)).toHaveLength(1);
  });
});

describe('on the phone (I2)', () => {
  it('the line shows the exact words held, and a tap on them shows them whole', async () => {
    windowWidth(390);
    const o = open();
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    const msg = document.querySelector<HTMLElement>('.jp2-asks-msg')!;
    expect(msg).toHaveTextContent(`Sent:“${askById('where')!.text}”·Undo`);
    const quote = within(msg).getByRole('button', { name: `“${askById('where')!.text}”` });
    expect(quote).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(quote);
    expect(document.querySelector('.jp2-asks-msg')).toHaveClass('is-whole');
    expect(within(document.querySelector<HTMLElement>('.jp2-asks-msg')!).getByRole('button', { name: /^“/ })).toHaveAttribute('aria-expanded', 'true');
    // Undo still works there; nothing went.
    fireEvent.click(row().getByRole('button', { name: 'Undo' }));
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    await flush();
    expect(sends(o.post)).toHaveLength(0);
  });

  it('two held asks show both', async () => {
    windowWidth(390);
    open();
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    fireEvent.click(row().getByRole('button', { name: 'Go faster' }).parentElement!.querySelectorAll<HTMLButtonElement>('.jp2-askb')[0]);
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent(/^Sent 2:“.+ · .+”·Undo$/);
  });

  it('the laptop line stays Sent · Undo (the words are on hover there)', async () => {
    open();
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    expect(document.querySelector('.jp2-asks-quote')).toBeNull();
  });
});

describe('on the website (I3)', () => {
  it('an ask queued for the laptop says so, and is watched so its words come back if it never runs', async () => {
    const srv = server();
    srv.post.mockImplementation(async (path: string) => (path.endsWith('/send') ? { ok: true, queued: { id: 'q-77', status: 'queued' } } : { ok: true }));
    const o = open({ srv, patch: { hosted: true } });
    await settle();
    const watch = vi.spyOn(o.store, 'watchQueued');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    await flush();
    expect(sends(o.post)[0][1]).toEqual({ kind: 'message', text: askById('where')!.text });
    expect(watch).toHaveBeenCalledWith('q-77', askById('where')!.text);
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent(QUEUED);
    expect(document.querySelector('.jp2-asks-msg')).not.toHaveTextContent(/^Sent/);
  });

  it('while the Foreman works an ask is like a typed message there: its words stay in the box, nothing is sent', async () => {
    const o = open({ patch: { hosted: true, run: RUNNING_RUN } });
    await settle();
    box().blur();
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    await flush();
    expect(sends(o.post)).toHaveLength(0);
    expect(box()).toHaveValue(askById('where')!.text);
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent(KEPT);
  });
});

describe('refusals that point at the box (minor)', () => {
  it('Claude Code open in a terminal: no “tick the box below”, it says to press Send in the box', async () => {
    const srv = server();
    srv.post.mockImplementation(async () => { throw new ApiError(409, 'Claude Code is open', { code: 'terminal-open' }); });
    open({ srv });
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    await flush();
    const alert = row().getByRole('alert');
    expect(alert).not.toHaveTextContent(/tick the box/i);
    expect(alert).toHaveTextContent('The ask’s words are in the box: press Send there');
    expect(box()).toHaveValue(askById('where')!.text);
  });

  it('a message already waiting: it says so in plain words', async () => {
    const srv = server();
    srv.post.mockImplementation(async () => { throw new ApiError(409, 'raw server words', { code: 'waiting', waiting: { text: 'x' } }); });
    open({ srv });
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    await flush();
    expect(row().getByRole('alert')).toHaveTextContent('Not sent: a message is already waiting for the Foreman.');
    expect(row().getByRole('alert')).not.toHaveTextContent('raw server words');
  });
});

describe('⌘K (minor)', () => {
  it('Esc closes it from anywhere in the box, not only the search field', async () => {
    open();
    await settle();
    cmdK();
    const dlg = palette()!;
    act(() => { dlg.focus(); });
    expect(document.activeElement).toBe(dlg);
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(palette()).toBeNull();
  });

  it('a long text can be read whole: the highlighted ask carries it in full', async () => {
    open();
    await settle();
    cmdK();
    const active = within(palette()!).getAllByRole('option').find((x) => x.getAttribute('aria-selected') === 'true')!;
    const label = active.querySelector('.palette-label')!.textContent;
    const a = ASKS.find((x) => x.label === label)!;
    expect(active).toHaveAttribute('title', a.text);
    expect(active).toHaveClass('is-active');
  });
});

describe('Keep as an ask, a message with notes (minor)', () => {
  it('keeps only his words, never the old notes block', async () => {
    const id = 'you:a0d62ac173be';
    const was = longJob.bodies[id].text;
    longJob.bodies[id].text = '--- Notes (1) ---\n1. [drop] Plan v2 · step 4 "Add the filter"\n   > Add the filter\n--- End of notes ---\n\nAnd keep the export as it is.';
    try {
      const o = open();
      await settle();
      act(() => { o.store.setReader({ kind: 'conversation', id: 'conversation' }); });
      await settle();
      const mine = document.querySelector<HTMLElement>(`.jp2-cv-item.is-you[data-id="${id}"]`)!;
      fireEvent.click(within(mine).getByRole('button', { name: 'Keep as an ask' }));
      await flush();
      expect(JSON.parse(localStorage.getItem(KEPT_KEY)!)).toEqual(['And keep the export as it is.']);
    } finally {
      longJob.bodies[id].text = was;
    }
  });
});

// ---------- Fix round 2 ----------

describe('fix round 2', () => {
  it('1 · the website: a queued reply arriving after Go faster’s line leaves that line and its Undo', async () => {
    const srv = server();
    const realPost = srv.post.getMockImplementation()!;
    let sent: (v: unknown) => void = () => {};
    srv.post.mockImplementation(async (path: string, body?: unknown) => (path.endsWith('/send') ? new Promise((r) => { sent = r; }) : realPost(path, body)));
    const o = open({ srv, patch: { hosted: true } });
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    fireEvent.click(row().getByRole('button', { name: 'Go faster' }));
    await flush();
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent(`${FAST_SAYS}·Undo`);
    await act(async () => { sent({ ok: true, queued: { id: 'q-1', status: 'queued' } }); });
    await flush();
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent(`${FAST_SAYS}·Undo`);
    expect(document.querySelector('.jp2-asks-msg')).not.toHaveTextContent(QUEUED);
    fireEvent.click(row().getByRole('button', { name: 'Undo' }));
    await flush();
    expect(optionPosts(o.post)).toHaveLength(2);
  });

  it('2 · the website: the app’s live run counts as working when the payload’s run has ended', async () => {
    const o = open({ patch: { hosted: true, run: { ...RUNNING_RUN, id: 'run-old', status: 'done' } } });
    await settle();
    // The stream says a new reply started (another run id) before the payload caught up.
    act(() => { o.app.dispatch({ type: 'event', event: { v: 2, type: 'run', job: SLUG, seq: 999999, data: { id: 'run-new', slug: SLUG, status: 'running' } } } as never); });
    expect(o.app.getState().runs[SLUG]?.status).toBe('running');
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    await flush();
    expect(sends(o.post)).toHaveLength(0);
    expect(box()).toHaveValue(askById('where')!.text);
  });

  it('3 · Go faster sends a held ask at once, and its Sent · Undo goes with it (no Undo that does nothing)', async () => {
    const srv = server();
    srv.get.mockImplementationOnce(() => new Promise(() => {}));
    const o = open({ srv });
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    fireEvent.click(row().getByRole('button', { name: 'Go faster' }));
    await flush();
    expect(sends(o.post)).toHaveLength(1);
    expect(row().queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('4 · a refusal said while asks are held is not wiped when they go', async () => {
    const o = open();
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Go faster' }).parentElement!.querySelector<HTMLButtonElement>('.jp2-askb')!);
    // Another place takes the job while it is held; a second ask is refused with the reason.
    const locked = payload();
    locked.v += 1;
    locked.lock = { owner: 'terminal', pid: 1, branch: null, acquiredAt: null };
    await o.serve(locked);
    cmdK();
    fireEvent.click(within(palette()!).getAllByRole('option').find((x) => x.querySelector('.palette-label')?.textContent === 'Stop here')!);
    expect(row().getByRole('alert')).toHaveTextContent('Not sent: another place is working on this job');
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    await flush();
    expect(row().getByRole('alert')).toHaveTextContent('Not sent: another place is working on this job');
  });

  it('5 · the same ask clicked twice within the hold goes once', async () => {
    const o = open();
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent(/^Sent·Undo$/);
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    await flush();
    expect(sends(o.post).map((c) => (c[1] as { text: string }).text)).toEqual([askById('where')!.text]);
  });

  it('6 · held asks go at most 8 s after the first click', async () => {
    const o = open();
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    act(() => { vi.advanceTimersByTime(3000); });
    fireEvent.click(row().getByRole('button', { name: 'Explain this step' }));
    act(() => { vi.advanceTimersByTime(3000); });
    fireEvent.click(row().getByRole('button', { name: 'Fix the open findings' }));
    // 6 s in: the newest would wait to 10 s, but the cap is 8 s from the first click.
    act(() => { vi.advanceTimersByTime(1999); });
    await flush();
    expect(sends(o.post)).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(1); });
    await flush();
    expect(sends(o.post)).toHaveLength(1);
    expect((sends(o.post)[0][1] as { text: string }).text.split('\n')[0]).toBe('3 asks: Where are we?; Explain this step; Fix the open findings');
  });

  it('6 · at most four are held: a fifth sends the four now and is held by itself', async () => {
    const o = open();
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const before = vi.getTimerCount();
    cmdK();
    const pick = (label: string) => { if (!palette()) cmdK(); fireEvent.click(within(palette()!).getAllByRole('option').find((x) => x.querySelector('.palette-label')?.textContent === label)!); };
    for (const l of ['Where are we?', 'Explain this step', 'Stop here', 'Fix the open findings']) pick(l);
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent(/^Sent 4·Undo$/);
    expect(sends(o.post)).toHaveLength(0);
    pick('Publish the walkthrough');
    await flush();
    expect(sends(o.post)).toHaveLength(1);
    expect((sends(o.post)[0][1] as { text: string }).text.startsWith('4 asks: ')).toBe(true);
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent(/^Sent·Undo$/);
    expect(vi.getTimerCount() - before).toBe(1);
  });

  it('7 · Keep as an ask on a message of joined asks keeps each one', async () => {
    const id = 'you:a0d62ac173be';
    const was = longJob.bodies[id].text;
    longJob.bodies[id].text = `2 asks: Where are we?; Stop here\n\n${askById('where')!.text}\n\n${askById('stop')!.text}`;
    try {
      const o = open();
      await settle();
      act(() => { o.store.setReader({ kind: 'conversation', id: 'conversation' }); });
      await settle();
      const mine = document.querySelector<HTMLElement>(`.jp2-cv-item.is-you[data-id="${id}"]`)!;
      fireEvent.click(within(mine).getByRole('button', { name: 'Keep as an ask' }));
      await flush();
      expect(JSON.parse(localStorage.getItem(KEPT_KEY)!)).toEqual([askById('where')!.text, askById('stop')!.text]);
      expect(within(mine).getByRole('button', { name: 'Kept 2 asks: in ⌘K under Yours' })).toBeInTheDocument();
    } finally {
      longJob.bodies[id].text = was;
    }
  });
});

describe('the Ship asks and the hand test (Task 22)', () => {
  const NEXT = { id: 'push-open', label: 'Push and open PR #1', go: 'Push and open', says: ['abc1234 Add the export'], sends: 'Push the branch to my fork and open PR #1.', check: '0123456789ab' } as const;
  const prs = (over: Partial<JobPagePayload['prs'][number]>) => { const p = payload().prs; p[0] = { ...p[0], ...over }; return p; };
  const hand = () => document.querySelector<HTMLElement>('.jp2-hand')!;
  const openHand = async (o: Opened) => { act(() => { o.store.setReader({ kind: 'checks', id: 'hand-test' }); }); await settle(); };

  it('with Ship open the row is Pull PR comments, Shorten the PR text, Mark done; the PR’s next action leads only on the other steps', async () => {
    const o = open({ patch: { prs: prs({ next: NEXT as unknown as JobPagePayload['prs'][number]['next'] }) } });
    await settle();
    pickStep(o, 'ship');
    expect(rowLabels()).toEqual(['Pull PR comments', 'Shorten the PR text', 'Mark done', 'Where are we?']);
    pickStep(o, 'build');
    expect(rowLabels()[0]).toBe('Push and open PR #1');
    expect(rowLabels()).not.toContain('Pull PR comments');
  });

  it('Shorten the PR text says Sent · Undo, then sends its exact words', async () => {
    const o = open();
    await settle();
    pickStep(o, 'ship');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(row().getByRole('button', { name: 'Shorten the PR text' }));
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent(/^Sent·Undo$/);
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    await flush();
    expect(sends(o.post)[0][1]).toEqual({ kind: 'message', text: askById('shorten')!.text, queue: true });
  });

  it('Pull PR comments reads GitHub now, as Pull now does, and opens the open PR; nothing goes to the Foreman', async () => {
    const o = open({ patch: { prs: prs({ state: 'open', word: 'open', number: 12 }) } });
    await settle();
    pickStep(o, 'ship');
    fireEvent.click(row().getByRole('button', { name: 'Pull PR comments' }));
    await flush();
    expect(o.post).toHaveBeenCalledWith(`/api/job/${SLUG}/pr/1/pull`, {});
    expect(sends(o.post)).toHaveLength(0);
    expect(o.store.getState().ui.reader).toEqual({ kind: 'pr', id: '1' });
    expect(document.querySelector('.jp2-asks-msg')).toBeNull();
  });

  it('Pull PR comments with no PR open opens the pull requests; a failed read says why', async () => {
    const srv = server();
    srv.post.mockImplementation(async (path: string) => { if (path.endsWith('/pull')) throw new ApiError(502, 'GitHub didn’t answer.', {}); return { ok: true }; });
    const o = open({ srv });
    await settle();
    pickStep(o, 'ship');
    fireEvent.click(row().getByRole('button', { name: 'Pull PR comments' }));
    await flush();
    expect(o.store.getState().ui.reader).toEqual({ kind: 'ship', id: 'ship' });
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent('Not read: GitHub didn’t answer.');
  });

  it('Mark done opens the same Mark done sheet the ⋯ menu opens; nothing is marked or sent', async () => {
    let sheet: unknown = null;
    function Probe() { const ui = useUi(); sheet = ui.sheet; return null; }
    const local = { ...payload().local!, worktree: '/demo/worktrees/crew', dir: '/demo/crew' };
    const o = open({ patch: { local }, beside: <Probe /> });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'More for this job' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Mark done or dropped' }));
    const fromMenu = sheet;
    expect(fromMenu).toMatchObject({ kind: 'close-job', slug: SLUG });
    sheet = null;
    pickStep(o, 'ship');
    fireEvent.click(row().getByRole('button', { name: 'Mark done' }));
    await flush();
    expect(sheet).toEqual(fromMenu);
    expect(o.post).not.toHaveBeenCalled();
    expect(document.querySelector('.jp2-asks-msg')).toBeNull();
  });

  it('Mark done while the Foreman replies, or on a job already marked, says why and opens nothing', async () => {
    let sheet: unknown = null;
    function Probe() { const ui = useUi(); sheet = ui.sheet; return null; }
    const a = open({ patch: { run: RUNNING_RUN } as Partial<JobPagePayload>, beside: <Probe /> });
    await settle();
    pickStep(a, 'ship');
    fireEvent.click(row().getByRole('button', { name: 'Mark done' }));
    expect(sheet).toBeNull();
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent('The Foreman is replying. Stop the reply first, then mark the job.');
    a.unmount();
    const b = open({ patch: { closed: { as: 'done', at: '2026-11-05T10:00:00.000Z' } } as Partial<JobPagePayload>, beside: <Probe /> });
    await settle();
    pickStep(b, 'ship');
    fireEvent.click(row().getByRole('button', { name: 'Mark done' }));
    expect(sheet).toBeNull();
    expect(document.querySelector('.jp2-asks-msg')).toHaveTextContent('Already marked done or dropped. Reopen it from the ⋯ menu.');
  });

  it('the website’s Ship row has no Pull PR comments or Mark done, and ⌘K neither', async () => {
    const o = open({ patch: { hosted: true } });
    await settle();
    pickStep(o, 'ship');
    expect(rowLabels()).toEqual(['Shorten the PR text', 'Where are we?', 'Explain this step', 'Go faster']);
    cmdK();
    const labels = within(palette()!).getAllByRole('option').map((x) => x.querySelector('.palette-label')?.textContent);
    expect(labels).not.toContain('Pull PR comments');
    expect(labels).not.toContain('Mark done');
    expect(labels).toContain('Fix the ticket number…');
  });

  it('hovering or focusing each Ship ask shows exactly what it does', async () => {
    const o = open();
    await settle();
    pickStep(o, 'ship');
    const tipOf = (name: string) => { fireEvent.mouseEnter(row().getByRole('button', { name })); const t = screen.getByRole('tooltip').textContent; fireEvent.mouseLeave(row().getByRole('button', { name })); return t; };
    expect(tipOf('Pull PR comments')).toBe(`Not a message. ${PULL_SAYS}`);
    expect(tipOf('Mark done')).toBe(`Not a message. ${MARK_DONE_SAYS}`);
    expect(tipOf('Shorten the PR text')).toBe(`Sends: ${askById('shorten')!.text}`);
    act(() => { row().getByRole('button', { name: 'Mark done' }).focus(); });
    expect(screen.getByRole('tooltip').textContent).toBe(`Not a message. ${MARK_DONE_SAYS}`);
  });

  it('the hand test’s It works shows its exact words on hover, Sent · Undo where he clicked, then sends them', async () => {
    const o = open();
    await settle();
    await openHand(o);
    const works = within(hand()).getByRole('button', { name: 'It works' });
    expect(works).toBeEnabled();
    fireEvent.mouseEnter(works);
    expect(within(hand()).getByRole('tooltip').textContent).toBe(`Sends: ${askById('works')!.text}`);
    expect(works).toHaveAttribute('aria-describedby', within(hand()).getByRole('tooltip').id);
    fireEvent.mouseLeave(works);
    expect(within(hand()).queryByRole('tooltip')).toBeNull();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(works);
    expect(hand().querySelector('.jp2-asks-msg')).toHaveTextContent(/^Sent·Undo$/);
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    await flush();
    expect(sends(o.post)).toHaveLength(1);
    expect(sends(o.post)[0][1]).toEqual({ kind: 'message', text: 'It works. I tested it by hand.', queue: true });
    expect(hand().querySelector('.jp2-asks-msg')).toBeNull();
  });

  it('the hand test’s Undo takes It works back before it leaves', async () => {
    const o = open();
    await settle();
    await openHand(o);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(within(hand()).getByRole('button', { name: 'It works' }));
    fireEvent.click(within(hand()).getByRole('button', { name: 'Undo' }));
    expect(hand().querySelector('.jp2-asks-msg')).toBeNull();
    act(() => { vi.advanceTimersByTime(10_000); });
    await flush();
    expect(sends(o.post)).toHaveLength(0);
  });

  it('the hand test’s Something is wrong… puts its words in the box with the cursor in the gap; nothing is sent', async () => {
    const o = open();
    await settle();
    await openHand(o);
    const wrong = within(hand()).getByRole('button', { name: 'Something is wrong…' });
    fireEvent.focus(wrong);
    expect(within(hand()).getByRole('tooltip').textContent).toBe(`Puts in the box, for your word: ${askById('wrong')!.text}`);
    fireEvent.blur(wrong);
    fireEvent.click(wrong);
    const el = box();
    const words = 'I tested it by hand and something is wrong: ';
    expect(el).toHaveValue(words);
    expect(document.activeElement).toBe(el);
    expect(el.selectionStart).toBe(words.length);
    await flush();
    expect(sends(o.post)).toHaveLength(0);
  });

  it('the hand test’s It works is off while another place works on the job; Something is wrong… still fills the box', async () => {
    const o = open({ patch: { lock: { owner: 'terminal', pid: 4242, branch: null, acquiredAt: null } } });
    await settle();
    await openHand(o);
    expect(within(hand()).getByRole('button', { name: 'It works' })).toBeDisabled();
    expect(within(hand()).getByRole('button', { name: 'Something is wrong…' })).toBeEnabled();
  });
});

describe('final W7: Mark done before the job loads, the Pull hover, and a row first drawn hidden', () => {
  it('Mark done before the payload lands says why and opens nothing', () => {
    const store = createJobStore(SLUG, { api: { page: () => new Promise(() => {}), item: async () => { throw new Error('no'); } }, events: () => () => {}, viewer: () => null });
    const opened: unknown[] = [];
    const api = { get: vi.fn(), post: vi.fn(), hosted: () => false } as unknown as ApiClient;
    const r = createAskRunner({ api, store, box: { current: null }, openSheet: (s) => opened.push(s) });
    r.run(askById('done')!);
    expect(r.getState()?.words).toBe(DONE_LOADING);
    expect(r.getState()?.problem).toBe(true);
    expect(opened).toEqual([]);
    r.destroy();
  });

  it('Pull PR comments says Fix these comes next in the PR view', () => {
    expect(PULL_SAYS).toMatch(/Fix these comes next/);
  });

  it('a row drawn while hidden measures its asks when it first shows', async () => {
    const size = { w: 0, room: 0 };
    const fits: (() => void)[] = [];
    vi.stubGlobal('ResizeObserver', class { fn: () => void; constructor(fn: () => void) { this.fn = fn; } observe(el: Element) { if (el.classList.contains('jp2-asks-fit')) fits.push(this.fn); } disconnect() {} });
    const ow = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    const cw = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return (this as HTMLElement).classList.contains('jp2-askb') ? size.w : 0; } });
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get() { return (this as Element).classList.contains('jp2-asks-fit') ? size.room : 0; } });
    try {
      const o = open();
      await settle();
      // Hidden: nothing measured, all four still drawn.
      expect(rowLabels()).toHaveLength(rowFor('review').length);
      size.w = 100;
      size.room = 250;
      expect(fits.length).toBeGreaterThan(0);
      act(() => { for (const fn of fits) fn(); });
      expect(rowLabels()).toHaveLength(2);
      o.unmount();
    } finally {
      if (ow) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', ow);
      if (cw) Object.defineProperty(Element.prototype, 'clientWidth', cw);
    }
  });
});
