// The new job page's frame (Task 7): first paint from the snapshot row, the addresses, the layout by
// width, and the page's keys. Built against the made-up long job.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Job } from '../api/types';
import { installKeyListener, resetChord } from '../app/keyRegistry';
import { useRoute } from '../app/router';
import { createStore, WorkshopContext } from '../state/store';
import { job as jobRow, snapshot } from '../state/test-fixtures';
import { HostedWorkshop } from '../views/Hosted/HostedWorkshop';
import { longJob } from './fixtures/longJob';
import { createJobStore, type JobStore } from './jobStore';
import { JobPage2 } from './JobPage2';
import { forgetRecentPages } from './recent';
import { JOB_PAGE_KEY } from './switch';
import type { JobBody, JobPagePayload } from './types';

// Every store the page makes, so a test can see it made one per job and ended it.
const made: { store: JobStore; destroy: ReturnType<typeof vi.fn> }[] = [];
vi.mock('./jobStore', async (importOriginal) => {
  const real = await importOriginal<typeof import('./jobStore')>();
  return {
    ...real,
    createJobStore: (...args: Parameters<typeof real.createJobStore>) => {
      const store = real.createJobStore(...args);
      const destroy = vi.fn(store.destroy);
      made.push({ store, destroy });
      return { ...store, destroy };
    },
  };
});

// Render counts for the header and Your move: each is wrapped in a memo boundary like its own, which
// counts every time it draws (Task 7 fix round 2: the row is frozen once the payload is in).
const drawn = vi.hoisted(() => ({ header: 0, move: 0 }));
vi.mock('./left/Header', async (importOriginal) => {
  const real = await importOriginal<typeof import('./left/Header')>();
  const { createElement, memo } = await import('react');
  return { ...real, Header: memo((p: Parameters<typeof real.Header>[0]) => { drawn.header++; return createElement(real.Header, p); }) };
});
vi.mock('./left/YourMove', async (importOriginal) => {
  const real = await importOriginal<typeof import('./left/YourMove')>();
  const { createElement, memo } = await import('react');
  return { ...real, YourMove: memo((p: Parameters<typeof real.YourMove>[0]) => { drawn.move++; return createElement(real.YourMove, p); }) };
});

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const payload = () => clone(longJob.payload) as unknown as JobPagePayload;
const BRIEF = 'brief:briefs/015-review.md';

/** The snapshot's row for the job: what the Jobs page already holds. */
const ROW: Job = jobRow(SLUG, 'needs-you', {
  title: 'Crew schedule export (from Jobs)', lane: 'needs-you', laneReason: 'Waiting for your go-ahead on PR #1',
  headline: 'Review 4 is ready. Go ahead with PR #1?', stage: 'review', stageState: 'waiting', needsYou: true, level: 3,
  repo: { name: 'fieldbook' }, cost: { totalUsd: 96.4 },
});

/** The app's client, answering the page's two reads; `hold` keeps the page's answer back. */
function client({ hold = false } = {}) {
  let release: (() => void) | null = null;
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path.includes('/page')) {
      if (hold) await new Promise<void>((r) => { release = r; });
      return payload();
    }
    const id = decodeURIComponent(/[?&]id=([^&]+)/.exec(path)?.[1] ?? '');
    const b = longJob.bodies[id];
    if (!b) throw new Error('Starbase answered 404.');
    return { ...b, version: String(b.meta.hash ?? b.id) } satisfies JobBody;
  });
  const api = { get, post: vi.fn(), hosted: () => false } as unknown as ApiClient;
  return { api, get, release: () => release?.() };
}

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
const resizeTo = (px: number) => act(() => { media.width = px; for (const fn of [...media.heard]) fn(); });

/** The page under the router, as App mounts it: the address's parts are its props. */
function Routed({ row = ROW, store }: { row?: Job | null; store?: JobStore }) {
  const route = useRoute();
  if (route.name !== 'job' && route.name !== 'stage') return <p>Not the job</p>;
  return <JobPage2 key={route.slug} slug={route.slug} job={row} step={route.name === 'stage' ? route.stop : undefined} view={route.name === 'job' ? route.view : undefined} read={route.name === 'job' ? route.read : undefined} store={store} />;
}

function open(hash: string, opts: { hold?: boolean; row?: Job | null; store?: JobStore } = {}) {
  window.history.replaceState(null, '', `/${hash}`);
  const c = client({ hold: opts.hold });
  const utils = render(<WorkshopContext.Provider value={{ api: c.api, store: createStore() }}><Routed row={opts.row === undefined ? ROW : opts.row} store={opts.store} /></WorkshopContext.Provider>);
  return { ...c, ...utils };
}

const page = () => screen.getByRole('main', { name: 'Job' });
const readerTitle = () => within(screen.getByRole('region', { name: 'Reader', hidden: true })).getByRole('heading', { level: 2, hidden: true }).textContent;
const stepRow = (name: string) => {
  const row = [...document.querySelectorAll<HTMLButtonElement>('.jp2-st-row')].find((b) => b.querySelector('.jp2-st-name')?.textContent === name);
  if (!row) throw new Error(`No step row ${name}`);
  return row;
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const key = (k: string, target: Element = document.body) => act(() => { fireEvent.keyDown(target, { key: k }); });

let offKeys: () => void = () => {};
beforeEach(() => { windowWidth(1512); made.length = 0; forgetRecentPages(); offKeys = installKeyListener(); resetChord(); });
afterEach(() => { offKeys(); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

describe('first paint and the payload', () => {
  it('paints the header, Your move and the seven steps from the snapshot row before the payload lands', async () => {
    const { release } = open(`#/job/${SLUG}`, { hold: true });
    expect(page()).toHaveClass('jp2');
    expect(screen.getByRole('heading', { level: 1, name: 'Crew schedule export (from Jobs)' })).toBeInTheDocument();
    expect(within(page()).getByText('Needs you', { selector: '.jp2-state' })).toBeInTheDocument();
    expect(screen.getByText('Review 4 is ready. Go ahead with PR #1?')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Steps' })).getAllByRole('button')).toHaveLength(7);
    expect(stepRow('Review')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('L3 · fieldbook · $96.40')).toBeInTheDocument();
    // The ticket key from the slug, as the server reads it, so the title does not move when the payload lands.
    expect(within(page()).getByText('ORBIT-905')).toBeInTheDocument();
    // The payload fills the same places in.
    release();
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Crew schedule export' })).toBeInTheDocument();
    expect(stepRow('Plan')).toHaveTextContent('v2');
    expect(screen.getByRole('button', { name: 'Conversation · 52' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decisions · 13 made for you' })).toBeInTheDocument();
    expect(readerTitle()).toBe('Brief #15 · Review · waiting');
  });

  it('makes one store per job with the app’s client, keeps it across widths, and ends it when the page goes', async () => {
    const { get, unmount } = open(`#/job/${SLUG}`);
    await settle();
    expect(made).toHaveLength(1);
    expect(get).toHaveBeenCalledWith(`/api/job/${SLUG}/page`);
    resizeTo(900);
    resizeTo(390);
    expect(made).toHaveLength(1);
    expect(made[0].destroy).not.toHaveBeenCalled();
    unmount();
    expect(made[0].destroy).toHaveBeenCalledTimes(1);
  });
});

describe('addresses', () => {
  it('the old addresses open the right step or view', async () => {
    open(`#/job/${SLUG}/stage/plan`);
    await settle();
    expect(stepRow('Plan')).toHaveAttribute('aria-expanded', 'true');
    expect(stepRow('Review')).toHaveAttribute('aria-expanded', 'false');
    act(() => { window.location.hash = `#/job/${SLUG}/conversation`; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(readerTitle()).toBe('Conversation');
    act(() => { window.location.hash = `#/job/${SLUG}/overview`; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(readerTitle()).toBe('Ticket and goal');
    act(() => { window.location.hash = `#/job/${SLUG}/id/FR-001`; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(page()).toHaveClass('jp2');
  });

  it('a reader address opens that thing, and a reload of it opens it again', async () => {
    const hash = `#/job/${SLUG}/read/brief/${encodeURIComponent('brief:briefs/014-review.md')}`;
    const { unmount } = open(hash);
    await settle();
    expect(readerTitle()).toBe(payload().thread.find((l) => l.id === 'brief:briefs/014-review.md')!.headline);
    unmount();
    open(window.location.hash);
    await settle();
    expect(readerTitle()).toBe(payload().thread.find((l) => l.id === 'brief:briefs/014-review.md')!.headline);
  });

  it('a pick rewrites the address in place, with no new history entry', async () => {
    open(`#/job/${SLUG}`);
    await settle();
    const entries = window.history.length;
    fireEvent.click(screen.getByRole('button', { name: 'Conversation · 52' }));
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/conversation/conversation`);
    expect(readerTitle()).toBe('Conversation');
    fireEvent.click(stepRow('Plan'));
    expect(window.location.hash).toBe(`#/job/${SLUG}/stage/plan`);
    expect(stepRow('Plan')).toHaveAttribute('aria-expanded', 'true');
    // The reader keeps what it showed: the step pick only opened the step.
    expect(readerTitle()).toBe('Conversation');
    // An output of the open step opens in the reader.
    fireEvent.click(screen.getByRole('button', { name: /^Implementation plan/ }));
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/doc/implementation-plan.md`);
    expect(readerTitle()).toBe('Implementation plan');
    expect(window.history.length).toBe(entries);
  });
});

describe('layout by width', () => {
  it('1100 px and wider: two panes, the reader beside the left pane, no back row', async () => {
    windowWidth(1100);
    open(`#/job/${SLUG}`);
    await settle();
    expect(page()).toHaveAttribute('data-layout', 'wide');
    expect(screen.getByRole('region', { name: 'Reader' })).not.toHaveAttribute('aria-hidden');
    expect(screen.queryByRole('button', { name: 'Back to the job' })).toBeNull();
  });

  it('between 760 and 1100 px the reader covers the left pane with a back row, and the focus moves to it', async () => {
    windowWidth(1099);
    open(`#/job/${SLUG}`);
    await settle();
    expect(page()).toHaveAttribute('data-layout', 'mid');
    const reader = document.querySelector<HTMLElement>('.jp2-reader')!;
    expect(reader).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('region', { name: 'Reader' })).toBeNull();
    const row = screen.getByRole('button', { name: 'Ticket and goal' });
    row.focus();
    fireEvent.click(row);
    expect(page()).toHaveAttribute('data-covered');
    expect(screen.getByRole('region', { name: 'Reader' })).toBe(reader);
    expect(document.activeElement).toBe(reader);
    expect(readerTitle()).toBe('Ticket and goal');
    // The back row closes it and gives the focus back to the row that opened it.
    fireEvent.click(within(reader).getByRole('button', { name: 'Back to the job' }));
    expect(page()).not.toHaveAttribute('data-covered');
    expect(document.activeElement).toBe(row);
    resizeTo(761);
    expect(page()).toHaveAttribute('data-layout', 'mid');
  });

  it('760 px and under: the phone layout', async () => {
    windowWidth(760);
    open(`#/job/${SLUG}`);
    await settle();
    expect(page()).toHaveAttribute('data-layout', 'phone');
    expect(screen.getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '#/');
    resizeTo(360);
    expect(page()).toHaveAttribute('data-layout', 'phone');
  });

  it('crossing a width keeps the draft, the picks and the reader target, in the same elements', async () => {
    const store = createJobStore(SLUG, { api: client().api, events: () => () => {} });
    open(`#/job/${SLUG}`, { store });
    await settle();
    const box = screen.getByRole('textbox', { name: 'Message to the Foreman' });
    fireEvent.change(box, { target: { value: 'Keep the week picker as it is.' } });
    act(() => { store.setPick('q1', 'a'); });
    fireEvent.click(screen.getByRole('button', { name: 'Decisions · 13 made for you' }));
    const main = page();
    for (const w of [900, 390, 1512, 1100, 760]) {
      resizeTo(w);
      expect(page()).toBe(main);
      expect(screen.getByRole('textbox', { name: 'Message to the Foreman', hidden: true })).toBe(box);
      expect(box).toHaveValue('Keep the week picker as it is.');
      expect(store.getState().ui.picks).toEqual({ q1: 'a' });
      expect(readerTitle()).toBe('Decisions');
    }
    store.destroy();
  });
});

describe('keys', () => {
  it('[ and ] open the step before and after, and rewrite the address', async () => {
    open(`#/job/${SLUG}`);
    await settle();
    key('[');
    expect(stepRow('Test')).toHaveAttribute('aria-expanded', 'true');
    expect(window.location.hash).toBe(`#/job/${SLUG}/stage/test`);
    key(']');
    key(']');
    expect(stepRow('Ship')).toHaveAttribute('aria-expanded', 'true');
    key(']');
    expect(stepRow('Ship')).toHaveAttribute('aria-expanded', 'true');
  });

  it('j and k move between the lines on the left; Enter opens the line', async () => {
    open(`#/job/${SLUG}`);
    await settle();
    key('j');
    expect(stepRow('Spec')).toHaveClass('is-cursor');
    key('j');
    key('k');
    expect(stepRow('Spec')).toHaveClass('is-cursor');
    for (let i = 0; i < 8; i++) key('j');
    // Seven steps, then Ticket and goal, Conversation…
    expect(screen.getByRole('button', { name: 'Conversation · 52' })).toHaveClass('is-cursor');
    key('Enter');
    expect(readerTitle()).toBe('Conversation');
    key('k');
    key('k');
    key('Enter');
    expect(stepRow('Ship')).toHaveAttribute('aria-expanded', 'true');
  });

  it('/ opens the conversation with the focus in its search box; g c and g t open the conversation and the ticket', async () => {
    open(`#/job/${SLUG}`);
    await settle();
    key('g');
    key('t');
    expect(readerTitle()).toBe('Ticket and goal');
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/ticket/ticket`);
    key('g');
    key('c');
    expect(readerTitle()).toBe('Conversation');
    act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    key('/');
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search the conversation' }));
  });

  it('c and i put the cursor in the message box; n does nothing yet', async () => {
    open(`#/job/${SLUG}`);
    await settle();
    key('c');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message to the Foreman' }));
    act(() => { (document.activeElement as HTMLElement).blur(); });
    key('i');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message to the Foreman' }));
    act(() => { (document.activeElement as HTMLElement).blur(); });
    const before = window.location.hash;
    key('n');
    expect(window.location.hash).toBe(before);
  });

  it('no page key fires while he types in a field', async () => {
    open(`#/job/${SLUG}`);
    await settle();
    const box = screen.getByRole('textbox', { name: 'Message to the Foreman' });
    box.focus();
    const before = window.location.hash;
    for (const k of ['[', ']', 'j', 'k', '/', 'c', 'i', 'n', 'Enter']) key(k, box);
    key('g', box);
    key('t', box);
    expect(window.location.hash).toBe(before);
    expect(document.activeElement).toBe(box);
    expect(document.querySelector('.is-cursor')).toBeNull();
    expect(readerTitle()).toBe('Brief #15 · Review · waiting');
    // Nor in the conversation's search box.
    fireEvent.click(screen.getByRole('button', { name: 'Conversation · 52' }));
    const search = screen.getByRole('searchbox', { name: 'Search the conversation' });
    search.focus();
    key('g', search);
    key('t', search);
    key(']', search);
    expect(readerTitle()).toBe('Conversation');
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/conversation/conversation`);
  });
});

describe('the website', () => {
  it('mounts the new page when the switch is on, and the old one when it is off', async () => {
    const store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [ROW], meta: { token: null, settings: { play: { mode: 'off' } } } as never }) });
    const c = client();
    const api = { ...c.api, hosted: () => true } as unknown as ApiClient;
    localStorage.setItem(JOB_PAGE_KEY, 'new');
    const { unmount } = render(<HostedWorkshop api={api} store={store} route={{ name: 'job', slug: SLUG, read: { kind: 'brief', id: BRIEF } }} />);
    expect(await screen.findByRole('main', { name: 'Job' })).toHaveClass('jp2');
    expect(await screen.findByRole('heading', { level: 1, name: 'Crew schedule export' })).toBeInTheDocument();
    expect(readerTitle()).toBe('Brief #15 · Review · waiting');
    unmount();
    localStorage.removeItem(JOB_PAGE_KEY);
    render(<HostedWorkshop api={api} store={store} route={{ name: 'job', slug: SLUG }} />);
    expect(await screen.findByRole('main', { name: 'Job' })).not.toHaveClass('jp2');
  });
});

describe('the snapshot row is for the first paint only', () => {
  it('a newer row shows before the payload lands, and redraws nothing after', async () => {
    window.history.replaceState(null, '', `/#/job/${SLUG}`);
    const c = client({ hold: true });
    const workshop = { api: c.api, store: createStore() };
    const tree = (row: Job) => <WorkshopContext.Provider value={workshop}><Routed row={row} /></WorkshopContext.Provider>;
    const { rerender } = render(tree(ROW));
    // Before the payload a newer row draws both again: the counts do count.
    const before = { ...drawn };
    rerender(tree({ ...ROW, title: 'Renamed on Jobs', headline: 'Renamed ask' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Renamed on Jobs' })).toBeInTheDocument();
    expect(drawn.header).toBeGreaterThan(before.header);
    expect(drawn.move).toBeGreaterThan(before.move);
    c.release();
    await settle();
    const steps = screen.getByRole('navigation', { name: 'Steps' });
    // After it, a newer row draws neither.
    const after = { ...drawn };
    rerender(tree({ ...ROW, title: 'Renamed again', headline: 'Another ask', stage: 'ship', cost: { totalUsd: 12 } }));
    expect(drawn).toEqual(after);
    expect(screen.getByRole('heading', { level: 1, name: 'Crew schedule export' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Steps' })).toBe(steps);
    expect(stepRow('Review')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('Task 7 fix round 1', () => {
  const leftPane = () => document.querySelector('.jp2-left')!.innerHTML;

  it('a reopen paints the open step’s outputs in the first frame, and nothing moves when the payload lands', async () => {
    const first = open(`#/job/${SLUG}`);
    await settle();
    first.unmount();
    const again = open(`#/job/${SLUG}`, { hold: true });
    // Before any answer: the payload kept from the last open, outputs and all.
    expect(screen.getByRole('button', { name: /^Findings/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conversation · 52' })).toBeInTheDocument();
    const painted = leftPane();
    again.release();
    await settle();
    expect(again.get).toHaveBeenCalledWith(`/api/job/${SLUG}/page?v=1`);
    expect(leftPane()).toBe(painted);
  });

  it('a cold first open: Your move’s label and ask come from the row as the payload will say them, so the card does not change', async () => {
    const p = payload();
    const move = p.move as { ask: string; since: string };
    const row = { ...ROW, headline: move.ask, waitingSince: move.since, waitingFor: 'approval' };
    const { release } = open(`#/job/${SLUG}`, { hold: true, row });
    const card = () => document.querySelector('.jp2-ym')!.innerHTML;
    const painted = card();
    expect(painted).toContain('Needs you · since');
    release();
    await settle();
    expect(card()).toBe(painted);
  });

  it('j and k move the focus with the cursor: after a click, j j Enter opens the line the cursor is on', async () => {
    open(`#/job/${SLUG}`);
    await settle();
    fireEvent.click(stepRow('Plan'));
    stepRow('Plan').focus();
    key('j', document.activeElement!);
    key('j', document.activeElement!);
    expect(document.activeElement).toBe(stepRow('Test'));
    expect(stepRow('Test')).toHaveClass('is-cursor');
    key('Enter', document.activeElement!);
    expect(stepRow('Test')).toHaveAttribute('aria-expanded', 'true');
    expect(window.location.hash).toBe(`#/job/${SLUG}/stage/test`);
    // Enter on another control is still that control's.
    const send = screen.getByRole('button', { name: 'More for this job' });
    send.focus();
    key('Enter', send);
    expect(window.location.hash).toBe(`#/job/${SLUG}/stage/test`);
  });

  it('under 1100 px: [ ] take the reader off the left pane; Escape closes it; Back never returns to the reader itself; a narrowing window moves the focus into an open reader', async () => {
    windowWidth(1512);
    open(`#/job/${SLUG}`);
    await settle();
    const row = screen.getByRole('button', { name: 'Ticket and goal' });
    row.focus();
    fireEvent.click(row);
    resizeTo(900);
    const reader = document.querySelector<HTMLElement>('.jp2-reader')!;
    expect(document.activeElement).toBe(reader);
    // g c inside the reader, then Back: the focus goes to the row that opened it first.
    key('g', reader);
    key('c', reader);
    expect(readerTitle()).toBe('Conversation');
    fireEvent.click(within(reader).getByRole('button', { name: 'Back to the job' }));
    expect(document.activeElement).toBe(row);
    // Escape closes the cover.
    fireEvent.click(row);
    expect(page()).toHaveAttribute('data-covered');
    key('Escape', reader);
    expect(page()).not.toHaveAttribute('data-covered');
    // ] while covered: the step moves and the left pane shows it.
    fireEvent.click(row);
    act(() => { reader.focus(); });
    key(']', reader);
    expect(page()).not.toHaveAttribute('data-covered');
    expect(stepRow('Ship')).toHaveAttribute('aria-expanded', 'true');
  });

  it('on the website the old page offers Try the new job page, and the new page’s ⋯ brings the old one back', async () => {
    const store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [ROW], meta: { token: null, settings: { play: { mode: 'off' } } } as never }) });
    const api = { ...client().api, hosted: () => true } as unknown as ApiClient;
    render(<HostedWorkshop api={api} store={store} route={{ name: 'job', slug: SLUG }} />);
    expect(await screen.findByRole('main', { name: 'Job' })).not.toHaveClass('jp2');
    fireEvent.click(screen.getByRole('button', { name: 'Try the new job page' }));
    expect(localStorage.getItem(JOB_PAGE_KEY)).toBe('new');
    expect(await screen.findByRole('main', { name: 'Job' })).toHaveClass('jp2');
    fireEvent.click(screen.getByRole('button', { name: 'More for this job' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Back to the old job page' }));
    expect(await screen.findByRole('main', { name: 'Job' })).not.toHaveClass('jp2');
  });
});
