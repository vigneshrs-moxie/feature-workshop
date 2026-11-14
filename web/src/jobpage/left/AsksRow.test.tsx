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
import { ASKS, FAST_SAYS, GAP, KEPT_KEY, askById, rowFor } from '../asks';
import { longJob } from '../fixtures/longJob';
import { browserDrafts, createJobStore, type JobStore } from '../jobStore';
import { JobPage2 } from '../JobPage2';
import { forgetRecentPages } from '../recent';
import type { JobBody, JobPagePayload, StopId } from '../types';
import { ALREADY_FAST, BACK_TO_OWN, HOLD_MS } from './AsksRow';
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

interface Opened { store: JobStore; post: Fn; get: Fn; unmount(): void; serve(p: JobPagePayload): Promise<void> }

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
    store, post: srv.post, get: srv.get, unmount: utils.unmount,
    serve: async (next) => { current = next; await act(async () => { await store.loadPage(); }); },
  };
}

const row = () => within(document.querySelector<HTMLElement>('.jp2-asks')!);
const rowLabels = () => [...document.querySelectorAll<HTMLButtonElement>('.jp2-asks .jp2-ask')].filter((b) => !b.hidden).map((b) => b.textContent);
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
    expect(asks.nextElementSibling).toBe(document.querySelector('.jp2-mbw'));
    // The long job is at Review.
    expect(rowLabels()).toEqual(['Fix the open findings', 'Go faster', 'Where are we?', 'Explain this step']);
    pickStep(o, 'test');
    expect(rowLabels()).toEqual(['How do I test this by hand?', 'Start the app', 'It works', 'Run the checks again']);
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

  it('keeps one timer: a second ask sends the first one now and holds itself', async () => {
    const o = open();
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const before = vi.getTimerCount();
    fireEvent.click(row().getByRole('button', { name: 'Where are we?' }));
    fireEvent.click(row().getByRole('button', { name: 'Fix the open findings' }));
    await flush();
    expect(vi.getTimerCount() - before).toBe(1);
    expect(sends(o.post).map((c) => (c[1] as { text: string }).text)).toEqual([askById('where')!.text]);
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    await flush();
    expect(sends(o.post).map((c) => (c[1] as { text: string }).text)).toEqual([askById('where')!.text, askById('fixfind')!.text]);
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
      for (const b of document.querySelectorAll<HTMLButtonElement>('.jp2-asks .jp2-ask')) {
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
    fireEvent.click(within(palette()!).getAllByRole('option').find((x) => x.textContent === 'Go to: Conversation')!);
    expect(palette()).toBeNull();
    expect(o.store.getState().ui.reader).toEqual({ kind: 'conversation', id: 'conversation' });
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
