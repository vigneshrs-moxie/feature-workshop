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

// Task 23 fix round (speed rule 5): what draws. Frame calls usePhoneMoves once per draw; every Button
// draw is noted by its label (the reader's previous and next, the message box's Send).
const draws = vi.hoisted(() => ({ frame: 0, notes: 0, buttons: [] as string[] }));
// The message box's note chips call useExplainAnswers once per draw.
vi.mock('./notes/Pointable', async (importOriginal) => {
  const real = await importOriginal<typeof import('./notes/Pointable')>();
  return { ...real, useExplainAnswers: () => { draws.notes++; return real.useExplainAnswers(); } };
});
vi.mock('./phone/PhoneJob2', async (importOriginal) => {
  const real = await importOriginal<typeof import('./phone/PhoneJob2')>();
  return { ...real, usePhoneMoves: (...args: Parameters<typeof real.usePhoneMoves>) => { draws.frame++; return real.usePhoneMoves(...args); } };
});
vi.mock('../components/Button', async (importOriginal) => {
  const real = await importOriginal<typeof import('../components/Button')>();
  const { createElement, forwardRef } = await import('react');
  const Button = forwardRef((p: Record<string, unknown>, ref) => {
    draws.buttons.push(String(p['aria-label'] ?? (typeof p.children === 'string' ? p.children : '') ?? ''));
    return createElement(real.Button as never, { ...p, ref });
  });
  return { ...real, Button };
});
/** The next page read's answer, when a test sets one. */
const nextPage = vi.hoisted(() => ({ make: null as null | (() => unknown) }));

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
      return nextPage.make ? nextPage.make() : payload();
    }
    if (path.endsWith('/commits')) return { commits: [{ sha: 'abc1234def', short: 'abc1234d', subject: 'feat: the export', date: null, files: [] }] };
    if (path.includes('/commit/')) return { sha: 'abc1234def', patchFiles: [], files: [], truncated: false };
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
/** The glance layout (a laptop): the step panel beside the reader, and the conversation's own column. */
const stepPanel = () => screen.getByRole('complementary', { name: 'This step' });
const convoColumn = () => screen.getByRole('region', { name: 'Conversation' });
const convoSearch = () => within(convoColumn()).getByRole('searchbox', { name: 'Search the conversation' });

let offKeys: () => void = () => {};
beforeEach(() => { windowWidth(1512); made.length = 0; nextPage.make = null; forgetRecentPages(); offKeys = installKeyListener(); resetChord(); });
afterEach(() => { offKeys(); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

describe('first paint and the payload', () => {
  it('paints the header, Your move and the seven steps from the snapshot row before the payload lands', async () => {
    const { release } = open(`#/job/${SLUG}`, { hold: true });
    expect(page()).toHaveClass('jp2');
    expect(screen.getByRole('heading', { level: 1, name: 'Crew schedule export (from Jobs)' })).toBeInTheDocument();
    expect(within(page()).getByText('Needs you', { selector: '.jp2-state' })).toBeInTheDocument();
    expect(screen.getByText('Review 4 is ready. Go ahead with PR #1?')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Steps' })).getAllByRole('button')).toHaveLength(7);
    // A laptop: the steps are a row of cells, the current one marked; nothing listed under it.
    expect(stepRow('Review')).toHaveClass('is-current');
    expect(stepRow('Review')).not.toHaveAttribute('aria-expanded');
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
    // The step panel lists what the current step made.
    expect(within(stepPanel()).getByRole('button', { name: /^Review \(combined\)/ })).toBeInTheDocument();
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
    expect(stepRow('Plan')).toHaveAttribute('aria-current', 'step');
    // A laptop: no step is open in the row (the step panel lists the named step's outputs); the named
    // step is marked and the reader shows its main output.
    expect(stepRow('Review')).not.toHaveAttribute('aria-expanded');
    expect(stepRow('Build')).not.toHaveAttribute('aria-expanded');
    expect(within(stepPanel()).getByText('Plan', { selector: '.jp2-sp-name' })).toBeInTheDocument();
    expect(readerTitle()).toBe('Implementation plan');
    // The conversation's address: it is in its own column, so the reader keeps the step's main output.
    act(() => { window.location.hash = `#/job/${SLUG}/conversation`; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(within(convoColumn()).getAllByRole('button', { name: /^Open all in this step$/ }).length).toBeGreaterThan(0);
    expect(readerTitle()).not.toBe('Conversation');
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
    // (A laptop: the Conversation row goes to the conversation's column, not the reader; the ticket
    // is a pick the reader takes.)
    fireEvent.click(screen.getByRole('button', { name: 'Ticket and goal' }));
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/ticket/ticket`);
    expect(readerTitle()).toBe('Ticket and goal');
    fireEvent.click(stepRow('Plan'));
    expect(window.location.hash).toBe(`#/job/${SLUG}/stage/plan`);
    expect(stepRow('Plan')).toHaveAttribute('aria-current', 'step');
    // The step pick shows the step's main output in the reader (Task 10).
    expect(readerTitle()).toBe('Implementation plan');
    // An output of the picked step (listed in the step panel) opens in the reader.
    fireEvent.click(stepRow('Review'));
    fireEvent.click(within(stepPanel()).getByRole('button', { name: /^Review \(combined\)/ }));
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/doc/review.md`);
    expect(readerTitle()).toBe('Review (combined)');
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
    // The box is the same element while the width stays on one side of 1100 px; crossing it, the box
    // moves between the left pane and the conversation's column (the glance layout), and the draft goes with it.
    let was = box;
    let wide = true;
    for (const w of [900, 390, 1512, 1100, 760]) {
      resizeTo(w);
      expect(page()).toBe(main);
      const now = screen.getByRole('textbox', { name: 'Message to the Foreman', hidden: true });
      if ((w >= 1100) === wide) expect(now).toBe(was);
      else expect(now.closest(w >= 1100 ? '.jp2-convo' : '.jp2-left')).not.toBeNull();
      wide = w >= 1100;
      was = now;
      expect(now).toHaveValue('Keep the week picker as it is.');
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
    expect(stepRow('Test')).toHaveAttribute('aria-current', 'step');
    expect(window.location.hash).toBe(`#/job/${SLUG}/stage/test`);
    key(']');
    key(']');
    expect(stepRow('Ship')).toHaveAttribute('aria-current', 'step');
    key(']');
    expect(stepRow('Ship')).toHaveAttribute('aria-current', 'step');
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
    // A laptop: the conversation is in its own column; Enter on its row puts the focus in its search box.
    expect(document.activeElement).toBe(convoSearch());
    expect(readerTitle()).toBe('Brief #15 · Review · waiting');
    act(() => { (document.activeElement as HTMLElement).blur(); });
    key('k');
    key('k');
    key('Enter');
    expect(stepRow('Ship')).toHaveAttribute('aria-current', 'step');
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
    // A laptop: g c goes to the conversation's column (its search box); the reader keeps the ticket.
    expect(document.activeElement).toBe(convoSearch());
    expect(readerTitle()).toBe('Ticket and goal');
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/ticket/ticket`);
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
    // Nor in the conversation's search box (a laptop: the Conversation row puts the focus there).
    fireEvent.click(screen.getByRole('button', { name: 'Conversation · 52' }));
    const search = screen.getByRole('searchbox', { name: 'Search the conversation' });
    expect(document.activeElement).toBe(search);
    key('g', search);
    key('t', search);
    key(']', search);
    expect(readerTitle()).toBe('Brief #15 · Review · waiting');
    expect(window.location.hash).toBe(before);
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
    expect(stepRow('Review')).toHaveClass('is-current');
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
    // The label and the ask (what the row has) do not change; the options and Go (Task 9) fill in under them.
    const card = () => [...document.querySelectorAll('.jp2-ym .jp2-card-label, .jp2-ym .jp2-card-ask')].map((e) => e.outerHTML).join('');
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
    expect(stepRow('Test')).toHaveAttribute('aria-current', 'step');
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
    expect(stepRow('Ship')).toHaveAttribute('aria-current', 'step');
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

describe('Task 10: the steps and the job rows on the page', () => {
  it('a step click shows its main output in the reader, over the left pane under 1100 px; [ ] move the step and show its output without covering', async () => {
    windowWidth(900);
    open(`#/job/${SLUG}`);
    await settle();
    fireEvent.click(stepRow('Build'));
    expect(readerTitle()).toBe('Changes');
    expect(page()).toHaveAttribute('data-covered');
    expect(document.activeElement).toBe(document.querySelector('.jp2-reader'));
    fireEvent.click(within(document.querySelector<HTMLElement>('.jp2-reader')!).getByRole('button', { name: 'Back to the job' }));
    key(']');
    // The reader is behind the left pane now (no region to a screen reader): its title, read directly.
    expect(document.querySelector('.jp2-rv-title')!.textContent).toBe('Checks');
    expect(page()).not.toHaveAttribute('data-covered');
    expect(window.location.hash).toBe(`#/job/${SLUG}/stage/test`);
  });

  it('a reload of a step’s address shows that step’s main output again', async () => {
    const { unmount } = open(`#/job/${SLUG}/stage/review`);
    await settle();
    expect(readerTitle()).toBe('Findings');
    unmount();
    open(`#/job/${SLUG}/stage/build`);
    await settle();
    expect(readerTitle()).toBe('Changes');
  });

  it('Conversation says what is new since his last look', async () => {
    localStorage.setItem(`sb.convo.seen.${SLUG}`, '2026-11-04T14:30:00.000Z');
    open(`#/job/${SLUG}`);
    await settle();
    expect(screen.getByRole('button', { name: 'Conversation · 52 · 1 new' })).toBeInTheDocument();
  });
});

describe('Task 10 fix round 1: the prototype’s step rule on the page', () => {
  // The left pane's blocks (on a laptop the steps row and the job's rows; the step panel beside the
  // reader is not one of them: it lists the picked step's outputs, so it changes with the pick).
  const blocks = () => [...document.querySelectorAll('.jp2-left .jp2-ym, .jp2-step, .jp2-st-row, .jp2-st-outs, .jp2-st-out, .jp2-st-none, .jp2-jr')].filter((e) => !e.closest('.jp2-sp')).map((e) => e.className.replace(/ is-(sel|cursor)/g, '')).join('|');

  it('a click, ] , Enter on a line and the address all mark the step, show its main output, and move no row', async () => {
    open(`#/job/${SLUG}`);
    await settle();
    const before = blocks();
    fireEvent.click(stepRow('Plan'));
    expect(readerTitle()).toBe('Implementation plan');
    expect(blocks()).toBe(before);
    key(']');
    expect(stepRow('Build')).toHaveAttribute('aria-current', 'step');
    expect(readerTitle()).toBe('Changes');
    expect(blocks()).toBe(before);
    stepRow('Test').focus();
    key('Enter', stepRow('Test'));
    expect(readerTitle()).toBe('Checks');
    expect(blocks()).toBe(before);
    act(() => { window.location.hash = `#/job/${SLUG}/stage/spec`; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(stepRow('Spec')).toHaveClass('is-sel');
    expect(readerTitle()).toBe('Product spec');
    expect(blocks()).toBe(before);
  });

  it('Ship, not started yet, opens its PR lines in the reader, not “Nothing yet” (Phase 4 B1)', async () => {
    open(`#/job/${SLUG}`);
    await settle();
    fireEvent.click(stepRow('Ship'));
    expect(readerTitle()).toBe('Ship');
    expect(document.querySelector('.jp2-notyet')).toBeNull();
    expect(document.querySelector('.jp2-rv-body .jp2-prl')).not.toBeNull();
  });
});

describe('Task 23 fix round: only the part that changed draws (speed rule 5)', () => {
  it('a newer snapshot row for the job, once the payload is in, draws nothing of the page', async () => {
    window.history.replaceState(null, '', `/#/job/${SLUG}`);
    const c = client();
    const value = { api: c.api, store: createStore() };
    const view = (row: Job) => <WorkshopContext.Provider value={value}><Routed row={row} /></WorkshopContext.Provider>;
    const { rerender } = render(view(ROW));
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Crew schedule export' })).toBeInTheDocument();
    draws.frame = 0; drawn.header = 0; drawn.move = 0;
    // The app's snapshot came again (another job changed): the same job's row, a new object.
    rerender(view({ ...ROW, cost: { totalUsd: 96.4 } }));
    rerender(view({ ...ROW, headline: 'A newer headline' }));
    expect(draws.frame).toBe(0);
    expect([drawn.header, drawn.move]).toEqual([0, 0]);
  });

  it('before the payload, a newer row still draws the first paint', () => {
    window.history.replaceState(null, '', `/#/job/${SLUG}`);
    const c = client({ hold: true });
    const value = { api: c.api, store: createStore() };
    const view = (row: Job) => <WorkshopContext.Provider value={value}><Routed row={row} /></WorkshopContext.Provider>;
    const { rerender } = render(view(ROW));
    rerender(view({ ...ROW, title: 'Crew schedule export (renamed)' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Crew schedule export (renamed)' })).toBeInTheDocument();
  });

  it('a new line in the conversation draws its count and its line: not the frame, the header, Your move, the reader\'s title row or the message box', async () => {
    // Under 1100 px, where the reader shows the conversation (a laptop's column: the last test in this file).
    windowWidth(900);
    open(`#/job/${SLUG}/conversation`);
    await settle();
    await settle();
    expect(readerTitle()).toBe('Conversation');
    nextPage.make = () => {
      const p = payload();
      const last = p.thread[p.thread.length - 1];
      p.thread = [...p.thread, { ...last, id: 'reply:speed-check', kind: 'reply', mine: false, at: '2026-11-04T23:00:00.000Z', headline: 'One more reply', hash: 'h1' }];
      p.rows = { ...p.rows, conversation: { ...p.rows.conversation, count: p.rows.conversation.count + 1 } };
      // A reply arrives as its run ends: the payload names that finished run.
      p.run = { id: 'run-that-just-ended', status: 'done', startedAt: '2026-11-04T22:58:00.000Z', lastAction: null };
      p.v += 1;
      return p;
    };
    draws.frame = 0; draws.notes = 0; draws.buttons = []; drawn.header = 0; drawn.move = 0;
    await act(async () => { await made.at(-1)!.store.loadPage(); });
    await settle();
    expect(screen.getByRole('button', { name: 'Conversation · 53', hidden: true })).toBeInTheDocument();
    expect(document.querySelector('.jp2-rv-meta')?.textContent).toBe('53 items');
    expect(document.querySelector('[data-id="reply:speed-check"]')).not.toBeNull();
    expect(draws.frame).toBe(0);
    expect([drawn.header, drawn.move]).toEqual([0, 0]);
    expect(draws.buttons.filter((b) => /^(Previous|Next)\b/.test(b) || b === 'Send')).toEqual([]);
    expect(draws.notes).toBe(0);
    // No older line draws again: each of his lines has its Keep as an ask, which would draw with it.
    expect(draws.buttons.filter((b) => b === 'Keep as an ask')).toEqual([]);
  });
});

describe('Task 23 fix round: the commit list is fetched ahead (speed rule 2)', () => {
  it('once the page is in and the browser is idle, the Build step\'s commit list is asked for, so its first pick waits on nothing', async () => {
    const { get } = open(`#/job/${SLUG}`);
    await settle();
    await settle();
    expect(get.mock.calls.map((c) => String(c[0])).filter((p) => p.endsWith('/commits'))).toEqual([`/api/job/${SLUG}/commits`]);
    // And the newest commit's diff, the first thing Changes shows.
    await settle();
    expect(get.mock.calls.map((c) => String(c[0])).filter((p) => p.includes('/commit/'))).toEqual([`/api/job/${SLUG}/commit/abc1234def`]);
  });

  it('a job whose steps show no Changes yet asks for none', async () => {
    nextPage.make = () => {
      const p = payload();
      for (const st of p.steps) st.outputs = st.outputs.filter((o) => o.kind !== 'changes');
      return p;
    };
    const { get } = open(`#/job/${SLUG}`);
    await settle();
    await settle();
    expect(get.mock.calls.map((c) => String(c[0])).filter((p) => p.endsWith('/commits'))).toEqual([]);
  });
});

describe('final fix W3: a job that fails to load says why', () => {
  it('a 404 says there is no such job, with Try again; a 500 says what Starbase said; Try again that works fills the page', async () => {
    const { ApiError } = await import('../api/client');
    nextPage.make = () => { throw new ApiError(404, 'No job by that name.'); };
    open(`#/job/${SLUG}`, { row: null });
    await settle();
    const alert = within(page()).getByRole('alert');
    expect(alert).toHaveTextContent('Starbase has no job by this name. It may have been removed, or the address has a typo.');
    nextPage.make = () => { throw new ApiError(500, 'The job folder could not be read'); };
    await act(async () => { fireEvent.click(within(alert).getByRole('button', { name: 'Try again' })); });
    await settle();
    expect(within(page()).getByRole('alert')).toHaveTextContent('Starbase couldn’t load this job: The job folder could not be read.');
    nextPage.make = () => { throw new TypeError('Failed to fetch'); };
    await act(async () => { fireEvent.click(within(page()).getByRole('button', { name: 'Try again' })); });
    await settle();
    expect(within(page()).getByRole('alert')).toHaveTextContent('Starbase isn’t answering. Check that it is running, then try again.');
    nextPage.make = null;
    await act(async () => { fireEvent.click(within(page()).getByRole('button', { name: 'Try again' })); });
    await settle();
    expect(page().querySelector('.jp2-pageproblem')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Crew schedule export' })).toBeInTheDocument();
  });
});
