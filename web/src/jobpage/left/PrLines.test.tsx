// The PR lines (Task 20, design brief R2): PR #1, #2 and #3 each one line with its state from GitHub
// and ONE button; the first click opens the line in place with what will go, the second is his yes.
// GitHub is read as the page opens (when the last read is old) and on Pull now, never on a timer.
// Built on the made-up long job, with made-up PR lines.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import { installKeyListener, resetChord } from '../../app/keyRegistry';
import { UiProvider } from '../../app/ui';
import { clearAllSent } from '../../lib/sentState';
import { clearGateSent } from '../../panes/Foreman/gateSent';
import { createStore, WorkshopContext } from '../../state/store';
import { LEVELS, snapshot } from '../../state/test-fixtures';
import { longJob } from '../fixtures/longJob';
import { browserDrafts, createJobStore, type JobStore } from '../jobStore';
import { JobPage2 } from '../JobPage2';
import { forgetRecentPages } from '../recent';
import type { GithubRead, JobBody, JobPagePayload, PrLine, StopId } from '../types';
import { forgetSentGo } from './YourMove';
import { clockWords, READ_NOTE } from './PrLines';

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const READ_AT = '2026-11-14T14:04:00.000Z';
const MERGED_AT = '2026-11-14T14:02:00.000Z';
const GH: GithubRead = { at: READ_AT, triedAt: READ_AT, reading: false, problem: null, run: null };
const NEXT1 = {
  id: 'push-open' as const, label: 'Push and open PR #1', go: 'Push and open', check: '0123456789ab',
  says: ['Pushes 2 commits from feature/x to your fork (origin):', 'bbbbbbb Show the list', 'aaaaaaa Add the table', 'Opens PR #1: you:feature/x → feature/x on acme/portal', 'Title: ORBIT-9: Damage list'],
  sends: 'Please push feature/x to origin as it is now (2 commits, ending at bbbbbbb), then open PR #1 from you:feature/x into feature/x on acme/portal, titled "ORBIT-9: Damage list". Nothing else goes to GitHub.',
};
const line = (n: 1 | 2 | 3, over: Partial<PrLine> = {}): PrLine => ({ n, number: null, url: null, title: null, state: 'not-started', word: 'not open', at: null, next: null, why: null, comments: null, ...over });
const LINES: PrLine[] = [line(1, { next: NEXT1 }), line(2, { why: 'after PR #1 is merged' }), line(3, { why: 'after PR #2 is merged' })];

const media = { width: 1512 };
function windowWidth(px: number) {
  media.width = px;
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    return {
      get matches() { return (!min || media.width >= Number(min[1])) && (!max || media.width <= Number(max[1])); },
      media: q, addEventListener() {}, removeEventListener() {},
    };
  });
}

type Fn = ReturnType<typeof vi.fn>;
/** The page's payload with these PR lines, and Ship as the open step when asked. */
function payload({ prs = LINES, github = GH, ship = false, hosted = false }: { prs?: PrLine[]; github?: GithubRead | null; ship?: boolean; hosted?: boolean } = {}): JobPagePayload {
  const p = clone(longJob.payload) as unknown as JobPagePayload;
  p.prs = clone(prs);
  p.github = github;
  p.hosted = hosted;
  if (ship) p.steps = p.steps.map((s) => (s.id === 'review' ? { ...s, state: 'done' } : s.id === 'ship' ? { ...s, state: 'current', main: { kind: 'ship', id: 'ship' } } : s));
  // Ship open: the review's gate is behind it and nothing waits, so on a laptop the step panel (where the
  // PR lines are) stands beside the reader; while a decision waits it gives way to the tabs over the reader.
  if (ship) p.move = null;
  return p;
}

interface Opened { store: JobStore; post: Fn; get: Fn; prRead: Fn; serve(p: JobPagePayload): Promise<void> }
function open(p: JobPagePayload, { post = vi.fn(async () => ({ ok: true, sent: true })), hosted = false }: { post?: Fn; hosted?: boolean } = {}): Opened {
  let current = p;
  window.history.replaceState(null, '', `/#/job/${SLUG}`);
  const prRead = vi.fn(async () => ({}));
  const store = createJobStore(SLUG, {
    api: {
      prRead,
      page: async () => current,
      item: async (_slug, id) => { const b = longJob.bodies[id]; if (!b) throw new Error('Starbase answered 404.'); return { ...b, version: String(b.meta.hash ?? b.id) } satisfies JobBody; },
    },
    events: () => () => {}, viewer: () => null, initial: current, drafts: browserDrafts,
  });
  const app = createStore();
  app.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [], permissions: [], meta: { token: 't', levels: LEVELS } }) });
  const get = vi.fn(async () => ({}));
  const api = { get, post, hosted: () => hosted } as unknown as ApiClient;
  render(
    <WorkshopContext.Provider value={{ api, store: app }}>
      <UiProvider><JobPage2 slug={SLUG} job={null} store={store} /></UiProvider>
    </WorkshopContext.Provider>,
  );
  return { store, post, get, prRead, serve: async (next) => { current = next; await act(async () => { await store.loadPage(); }); } };
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
/** Where the Ship step's PR lines are: on a laptop the step panel beside the reader (the glance layout);
 *  under 1100 px under the Ship step's row on the left (the last test in this file). */
const shipLines = () => within(document.querySelector<HTMLElement>('.jp2-sp')!);
const readerPane = () => within(document.querySelector<HTMLElement>('.jp2-rv-body')!);
const goes = (post: Fn) => post.mock.calls.filter((c) => /\/pr\/\d\/go$/.test(String(c[0])));

beforeEach(() => { windowWidth(1512); localStorage.clear(); forgetRecentPages(); forgetSentGo(); installKeyListener(); resetChord(); });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); clearAllSent(); clearGateSent(); window.history.replaceState(null, '', '/'); });

describe('the Ship step’s PR lines', () => {
  it('lists PR #1, #2 and #3, one line each, with at most one button; the first click shows what will go and sends nothing', async () => {
    const o = open(payload({ ship: true }));
    await settle();
    const lines = [...document.querySelectorAll('.jp2-sp .jp2-prl-line')];
    expect(lines.map((l) => l.querySelector('.jp2-prl-n')?.textContent)).toEqual(['PR #1', 'PR #2', 'PR #3']);
    expect(lines[0].textContent).toContain('not open');
    expect(lines[1].textContent).toContain('after PR #1 is merged');
    expect(lines.map((l) => l.querySelectorAll('button').length)).toEqual([1, 0, 0]);
    fireEvent.click(shipLines().getByRole('button', { name: 'Push and open PR #1' }));
    for (const s of NEXT1.says) expect(shipLines().getByText(s)).toBeInTheDocument();
    expect(shipLines().getByRole('button', { name: 'Push and open' })).toBeInTheDocument();
    expect(shipLines().queryByRole('button', { name: 'Push and open PR #1' })).toBeNull();
    expect(goes(o.post)).toHaveLength(0);
    fireEvent.click(shipLines().getByRole('button', { name: 'Cancel' }));
    expect(shipLines().queryByText('bbbbbbb Show the list')).toBeNull();
    expect(shipLines().getByRole('button', { name: 'Push and open PR #1' })).toBeInTheDocument();
  });

  it('the second click is his yes: it sends the action and its check, and the line says it went', async () => {
    const o = open(payload({ ship: true }));
    await settle();
    fireEvent.click(shipLines().getByRole('button', { name: 'Push and open PR #1' }));
    await act(async () => { fireEvent.click(shipLines().getByRole('button', { name: 'Push and open' })); });
    expect(goes(o.post)).toEqual([[`/api/job/${SLUG}/pr/1/go`, { id: 'push-open', check: '0123456789ab' }]]);
    expect(shipLines().getByText('Sent · the Foreman pushes to your fork and opens PR #1')).toBeInTheDocument();
    expect(shipLines().queryByRole('button', { name: /Push and open/ })).toBeNull();
    // The server's line then says it was sent: the words stay, no button comes back.
    await o.serve(payload({ ship: true, prs: [line(1, { why: 'Sent to the Foreman' }), LINES[1], LINES[2]] }));
    expect(shipLines().queryByRole('button', { name: /Push and open/ })).toBeNull();
  });

  it('a refusal says why in place and gives the button back; nothing is lost', async () => {
    const post = vi.fn(async (path: string) => {
      if (path.endsWith('/go')) throw new ApiError(409, 'That PR moved on since you looked: read its line again. Nothing was sent.', { code: 'pr-moved' });
      return {};
    });
    open(payload({ ship: true }), { post });
    await settle();
    fireEvent.click(shipLines().getByRole('button', { name: 'Push and open PR #1' }));
    await act(async () => { fireEvent.click(shipLines().getByRole('button', { name: 'Push and open' })); });
    expect(shipLines().getByRole('alert')).toHaveTextContent('That PR moved on since you looked: read its line again. Nothing was sent.');
    expect(shipLines().getByRole('button', { name: 'Push and open PR #1' })).toBeInTheDocument();
  });

  it('Claude Code open in a terminal: Send anyway goes once he says none of them is the Foreman', async () => {
    let first = true;
    const post = vi.fn(async (path: string) => {
      if (path.endsWith('/go') && first) { first = false; throw new ApiError(409, 'Claude Code is open in this repository in a terminal. Make sure none of those windows is this job’s Foreman, then confirm.', { code: 'terminal-open' }); }
      return { ok: true, sent: true };
    });
    open(payload({ ship: true }), { post });
    await settle();
    fireEvent.click(shipLines().getByRole('button', { name: 'Push and open PR #1' }));
    await act(async () => { fireEvent.click(shipLines().getByRole('button', { name: 'Push and open' })); });
    await act(async () => { fireEvent.click(shipLines().getByRole('button', { name: 'None of them is the Foreman: send' })); });
    expect(goes(post).at(-1)).toEqual([`/api/job/${SLUG}/pr/1/go`, { id: 'push-open', check: '0123456789ab', confirmNoTerminal: true }]);
    expect(shipLines().getByText('Sent · the Foreman pushes to your fork and opens PR #1')).toBeInTheDocument();
  });

  it('a line with no button says why; a merged PR says when; the read line says when GitHub was read, and Pull now reads it again', async () => {
    const o = open(payload({ ship: true, prs: [line(1, { state: 'merged', word: 'merged', at: MERGED_AT, number: 247, url: 'https://github.com/acme/portal/pull/247' }), line(2, { state: 'open', word: 'open · checks passed', number: 248, url: 'https://github.com/acme/portal/pull/248', why: 'Sent to the Foreman' }), LINES[2]] }));
    await settle();
    const lines = [...document.querySelectorAll('.jp2-sp .jp2-prl-line')];
    expect(lines[0].textContent).toContain(`merged ${clockWords(MERGED_AT)}`);
    expect(lines[1].textContent).toContain('Sent to the Foreman');
    expect(within(lines[0] as HTMLElement).getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute('href', 'https://github.com/acme/portal/pull/247');
    expect(shipLines().getByText(`read from GitHub ${clockWords(READ_AT)}`)).toBeInTheDocument();
    await act(async () => { fireEvent.click(shipLines().getByRole('button', { name: 'Pull now' })); });
    expect(o.post.mock.calls.filter((c) => String(c[0]).endsWith('/pull'))).toEqual([[`/api/job/${SLUG}/pr/1/pull`, {}]]);
    expect(shipLines().getByText('Reading GitHub…')).toBeInTheDocument();
  });

  it('GitHub not answering: the lines say what is known, the problem in words, and no button', async () => {
    open(payload({ ship: true, prs: [line(1, { why: 'No button while GitHub isn’t answering' }), LINES[1], LINES[2]], github: { ...GH, problem: 'GitHub didn’t answer. gh isn’t signed in: run gh auth login', run: 'gh auth login' } }));
    await settle();
    expect(shipLines().getByRole('alert')).toHaveTextContent('GitHub didn’t answer. gh isn’t signed in: run gh auth login');
    expect(shipLines().getByText('No button while GitHub isn’t answering', { exact: false })).toBeInTheDocument();
    expect(document.querySelectorAll('.jp2-sp .jp2-prl-line button')).toHaveLength(0);
  });

  it('the website: the lines without buttons, no read line and no Pull now', async () => {
    open(payload({ ship: true, prs: [line(1), LINES[1], LINES[2]], github: null, hosted: true }), { hosted: true });
    await settle();
    expect(document.querySelectorAll('.jp2-sp .jp2-prl-line')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Pull now' })).toBeNull();
  });
});

describe('reading GitHub', () => {
  it('the page’s opening asks for a read once (the server reads only when the last read is old), not again as the page changes', async () => {
    const o = open(payload());
    await settle();
    expect(o.prRead.mock.calls).toEqual([[SLUG]]);
    await o.serve(payload({ prs: [line(1, { why: 'Sent to the Foreman' }), LINES[1], LINES[2]] }));
    expect(o.prRead).toHaveBeenCalledTimes(1);
    expect(o.get.mock.calls.filter((c) => String(c[0]).includes('/pr/'))).toHaveLength(0);
  });

  it('on the website nothing is asked', async () => {
    const o = open(payload({ github: null, hosted: true }), { hosted: true });
    await settle();
    expect(o.prRead).not.toHaveBeenCalled();
  });

  it('the store’s read is GET …/pr/1?read=old through the app’s client', async () => {
    const get = vi.fn(async () => ({}));
    const { jobApi } = await import('../api');
    await jobApi({ get, post: vi.fn() } as unknown as ApiClient).prRead!(SLUG);
    expect(get).toHaveBeenCalledWith(`/api/job/${SLUG}/pr/1?read=old`);
  });
});

describe('the reader’s Ship and the asks row', () => {
  it('the asks row leads with the PR’s next action while Ship is not the open step; its click opens Ship with the line open, and sends nothing', async () => {
    const o = open(payload());
    await settle();
    const first = document.querySelector<HTMLButtonElement>('.jp2-asks .jp2-askb');
    expect(first?.textContent).toBe('Push and open PR #1');
    fireEvent.click(first!);
    await settle();
    expect(readerPane().getByText('bbbbbbb Show the list')).toBeInTheDocument();
    expect(readerPane().getByRole('button', { name: 'Push and open' })).toBeInTheDocument();
    expect(readerPane().getByText(READ_NOTE)).toBeInTheDocument();
    expect(goes(o.post)).toHaveLength(0);
    // Ship opened: the row no longer carries it (plan "Open with the owner").
    act(() => { o.store.setStep('ship' as StopId); });
    expect([...document.querySelectorAll('.jp2-asks .jp2-askb')].map((b) => b.textContent)).not.toContain('Push and open PR #1');
  });

  it('a PR’s own reader view is its line', async () => {
    const o = open(payload());
    await settle();
    act(() => { o.store.setReader({ kind: 'pr', id: '1' }); });
    expect(readerPane().getByRole('button', { name: 'Push and open PR #1' })).toBeInTheDocument();
    expect(readerPane().queryByText('PR #2')).toBeNull();
  });
});

describe('fix round 1', () => {
  it('opening the line never puts the focus on the yes (a held Enter can’t confirm); it goes to what will go', async () => {
    open(payload({ ship: true }));
    await settle();
    const label = shipLines().getByRole('button', { name: 'Push and open PR #1' });
    label.focus();
    fireEvent.click(label);
    const yes = shipLines().getByRole('button', { name: 'Push and open' });
    expect(document.activeElement).not.toBe(yes);
    expect(document.activeElement).toBe(shipLines().getByRole('group', { name: 'What Push and open PR #1 will do' }));
  });
});

describe('Task 21: Pull now’s answer', () => {
  it('a read within the last minute says `read just now`; an older one its time', async () => {
    const { readWords } = await import('./PrLines');
    const now = Date.parse('2026-11-14T14:05:00.000Z');
    expect(readWords('2026-11-14T14:04:30.000Z', now)).toBe('read just now');
    expect(readWords('2026-11-14T14:02:00.000Z', now)).toBe(`read from GitHub ${clockWords('2026-11-14T14:02:00.000Z')}`);
  });
});

describe('the glance layout: where the PR lines show', () => {
  it('on a laptop in the step panel beside the reader, not under the Ship cell; under 1100 px under the Ship step’s row, with no step panel', async () => {
    open(payload({ ship: true }));
    await settle();
    expect(document.querySelectorAll('.jp2-sp .jp2-prl-line')).toHaveLength(3);
    expect(document.querySelectorAll('.jp2-st .jp2-prl-line')).toHaveLength(0);
    expect(shipLines().getByRole('button', { name: 'Push and open PR #1' })).toBeInTheDocument();
  });

  it('under 1100 px the Ship step’s row lists them, and opening one there shows what will go', async () => {
    windowWidth(900);
    open(payload({ ship: true }));
    await settle();
    expect(document.querySelector('.jp2-sp')).toBeNull();
    const left = within(document.querySelector<HTMLElement>('.jp2-st')!);
    expect([...document.querySelectorAll('.jp2-st .jp2-prl-line')].map((l) => l.querySelector('.jp2-prl-n')?.textContent)).toEqual(['PR #1', 'PR #2', 'PR #3']);
    fireEvent.click(left.getByRole('button', { name: 'Push and open PR #1' }));
    for (const s of NEXT1.says) expect(left.getByText(s)).toBeInTheDocument();
  });
});

describe('the deciding arrangement: the PR lines while a decision waits at Ship', () => {
  it('on a laptop no step panel; one PR lines tab over the reader opens them there, with their button', async () => {
    const p = payload({ ship: true });
    p.move = { ...payload().move!, stage: 'ship' } as JobPagePayload['move'];
    open(p);
    await settle();
    expect(document.querySelector('.jp2-sp')).toBeNull();
    const tabs = within(screen.getByRole('tablist', { name: 'About this decision' }));
    expect(tabs.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Brief #15', 'PR lines', 'Spec']);
    fireEvent.click(tabs.getByRole('tab', { name: 'PR lines' }));
    await settle();
    expect(tabs.getByRole('tab', { name: 'PR lines' })).toHaveAttribute('aria-selected', 'true');
    expect([...document.querySelectorAll('.jp2-rv-body .jp2-prl-line')].map((l) => l.querySelector('.jp2-prl-n')?.textContent)).toEqual(['PR #1', 'PR #2', 'PR #3']);
    expect(readerPane().getByRole('button', { name: 'Push and open PR #1' })).toBeInTheDocument();
  });
});

describe('missing moves: what will go folds on Escape (16 Nov)', () => {
  it('Escape cancels it, and Cancel or Escape give the focus back to the line’s button; nothing is sent', async () => {
    const o = open(payload({ ship: true }));
    await settle();
    fireEvent.click(shipLines().getByRole('button', { name: 'Push and open PR #1' }));
    const panel = shipLines().getByRole('group', { name: /^What .* will do$/ });
    act(() => { fireEvent.keyDown(panel, { key: 'Escape' }); });
    expect(shipLines().queryByRole('group', { name: /^What .* will do$/ })).toBeNull();
    expect(document.activeElement).toBe(shipLines().getByRole('button', { name: 'Push and open PR #1' }));
    fireEvent.click(shipLines().getByRole('button', { name: 'Push and open PR #1' }));
    fireEvent.click(shipLines().getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(shipLines().getByRole('button', { name: 'Push and open PR #1' }));
    expect(goes(o.post)).toHaveLength(0);
  });
});
