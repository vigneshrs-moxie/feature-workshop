// A PR's view in the reader (Task 21, design brief R3): every comment not answered yet is a row; new ones
// are ticked, `x` ticks the one under the pointer, the bar reads `3 ticked · Fix these · What is he asking?
// · Leave`; after the Foreman a row shows `Fixed in abc1234` (that commit's diff) and its drafted reply,
// editable in place, with Copy and Open on GitHub first and Post it second; then the PR line's button is
// `Push the fixes (2 commits)`, in the view's bar and not on the line above it. Built on the made-up long
// job with made-up PR comments.
import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { installKeyListener, resetChord } from '../../app/keyRegistry';
import { UiProvider } from '../../app/ui';
import { clearAllSent } from '../../lib/sentState';
import { clearGateSent } from '../../panes/Foreman/gateSent';
import { createStore, WorkshopContext } from '../../state/store';
import { LEVELS, snapshot } from '../../state/test-fixtures';
import { longJob } from '../fixtures/longJob';
import { browserDrafts, createJobStore, type JobStore } from '../jobStore';
import { JobPage2 } from '../JobPage2';
import { forgetSentGo } from '../left/YourMove';
import { forgetRecentPages } from '../recent';
import type { GithubRead, JobBody, JobPagePayload, PrLine, PrRow, PrView } from '../types';
import { clockWords } from '../left/PrLines';
import { branchOf } from './branch';

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const GH: GithubRead = { at: '2026-11-14T14:04:00.000Z', triedAt: '2026-11-14T14:04:00.000Z', reading: false, problem: null, run: null };
const SHA = 'abc1234def5678abc1234def5678abc1234def5';

const row = (id: string, over: Partial<PrRow> = {}): PrRow => ({
  id, kind: 'line', author: 'raj', mine: false, file: 'web/src/App.tsx', line: 40, body: `Comment ${id}, in full.\nSecond line.`,
  context: ['  const a = 1;', '  let b = 2;', '  return a + b;'], contextAt: 39, link: `https://github.com/acme/portal/pull/247#discussion_r${id.slice(1)}`, at: '2026-11-14T13:00:00Z',
  replies: [], state: 'new', commit: null, why: null, reply: null, ...over,
});
const NEW_ROWS: PrRow[] = [row('c901'), row('c902', { author: 'you', mine: true, line: 41 }), row('i77', { kind: 'conversation', file: null, line: null, context: null, body: 'Why two queries?' }), row('r55', { kind: 'review', file: null, line: null, context: null, state: 'left' })];
const FIXED_ROWS: PrRow[] = [
  row('c901', { state: 'fixed', commit: 'abc1234', reply: { draft: 'Fixed in abc1234: it is a const now.', posted: null } }),
  row('c902', { state: 'left', why: 'the helper is shared', reply: { draft: 'Kept as it is: the helper is shared.', posted: null } }),
];
const NEXT_FIX = { id: 'push-fixes' as const, label: 'Push the fixes (2 commits)', go: 'Push', check: 'abcdefabcdef', says: ['Pushes 2 commits from feature/x to your fork (origin), so PR #1 (#247) has them:', 'abc1234 fix: a const', 'bbbbbbb fix: rename'], sends: 'Please push the fixes for the review comments: …' };
const line1 = (over: Partial<PrLine> = {}): PrLine => ({ n: 1, number: 247, url: 'https://github.com/acme/portal/pull/247', title: 'ORBIT-9', state: 'open', word: 'open · checks failing', at: null, next: null, why: null, comments: { fresh: 3, total: 4, fixed: 0, failing: 1, v: 'v1' }, ...over });
const LINES = (l1: PrLine): PrLine[] => [l1, { ...line1(), n: 2, number: null, url: null, state: 'not-started', word: 'not open', comments: null, why: 'after PR #1 is merged' }, { ...line1(), n: 3, number: null, url: null, state: 'not-started', word: 'not open', comments: null }];

function payload(l1: PrLine = line1(), extra: Partial<JobPagePayload> = {}): JobPagePayload {
  const p = clone(longJob.payload) as unknown as JobPagePayload;
  p.prs = LINES(l1);
  p.github = GH;
  p.hosted = false;
  return { ...p, ...extra };
}
const view = (rows: PrRow[], l1: PrLine = line1()): PrView => ({ n: 1, line: l1, github: GH, rows, checks: [{ name: 'lint', link: null, runId: '4242', head: SHA, log: 'src/a.js: x is unused\n##[error]Process completed with exit code 1.', state: 'failed' }], verdict: { by: 'Raj', state: 'changes_requested', at: '2026-11-14T13:00:00Z' }, readAt: GH.at, problem: null, number: 247 });

type Fn = ReturnType<typeof vi.fn>;
interface Opened { store: JobStore; post: Fn; get: Fn; serve(p: JobPagePayload): Promise<void>; answer: { pr: PrView; commits: unknown } }
function open(p: JobPagePayload, pr: PrView, { post = vi.fn(async () => ({ ok: true, sent: true })), hosted = false }: { post?: Fn; hosted?: boolean } = {}): Opened {
  let current = p;
  window.history.replaceState(null, '', `/#/job/${SLUG}`);
  const store = createJobStore(SLUG, {
    api: {
      prRead: vi.fn(async () => ({})),
      page: async () => current,
      item: async (_slug, id) => { const b = longJob.bodies[id]; if (!b) throw new Error('Starbase answered 404.'); return { ...b, version: String(b.meta.hash ?? b.id) } satisfies JobBody; },
    },
    events: () => () => {}, viewer: () => null, initial: current, drafts: browserDrafts,
  });
  const app = createStore();
  app.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [], permissions: [], meta: { token: 't', levels: LEVELS } }) });
  const answer = { pr, commits: { commits: [{ sha: SHA, short: 'abc1234', subject: 'fix: a const', date: null, files: [{ path: 'web/src/App.tsx', added: 1, removed: 1 }] }], cut: false } as unknown };
  const get = vi.fn(async (url: string) => {
    if (url === `/api/job/${SLUG}/pr/1`) return clone(answer.pr);
    if (url === `/api/job/${SLUG}/commits`) return answer.commits;
    if (url.startsWith(`/api/job/${SLUG}/commit/`)) return { sha: SHA, truncated: false, files: [], patchFiles: [] };
    return {};
  });
  const api = { get, post, hosted: () => hosted } as unknown as ApiClient;
  render(
    <WorkshopContext.Provider value={{ api, store: app }}>
      <UiProvider><JobPage2 slug={SLUG} job={null} store={store} /></UiProvider>
    </WorkshopContext.Provider>,
  );
  return { store, post, get, answer, serve: async (next) => { current = next; await act(async () => { await store.loadPage(); }); } };
}

const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const reader = () => within(document.querySelector<HTMLElement>('.jp2-rv-body')!);
const bar = () => document.querySelector<HTMLElement>('.jp2-prc-bar')!;
const cards = () => [...document.querySelectorAll<HTMLElement>('.jp2-prc:not(.jp2-prc-check)')];
const cardOf = (who: string, i = 0) => cards().filter((c) => c.querySelector('.jp2-prc-who')?.textContent?.startsWith(who))[i];
const box = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[type="checkbox"]');
const calls = (post: Fn, end: string) => post.mock.calls.filter((c) => String(c[0]).endsWith(end));
async function openPr(o: Opened) {
  act(() => { o.store.setReader({ kind: 'pr', id: '1' }); });
  await settle();
}

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

beforeEach(() => { windowWidth(1512); localStorage.clear(); forgetRecentPages(); forgetSentGo(); installKeyListener(); resetChord(); });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); clearAllSent(); clearGateSent(); window.history.replaceState(null, '', '/'); });

describe('the PR view (Task 21)', () => {
  it('every comment not answered yet is a row: who, the file and line, the comment in full, its three code lines and a state', async () => {
    const o = open(payload(), view(NEW_ROWS));
    await openPr(o);
    expect(o.get).toHaveBeenCalledWith(`/api/job/${SLUG}/pr/1`);
    expect(cards()).toHaveLength(4);
    const c = cardOf('raj');
    expect(c.querySelector('.jp2-prc-w')!.textContent).toBe('web/src/App.tsx:40');
    expect(c.querySelector('.jp2-prc-b')!.textContent).toBe('Comment c901, in full.\nSecond line.');
    expect(c.querySelector('.jp2-prc-code')!.textContent).toBe('  39    const a = 1;\n  40    let b = 2;\n  41    return a + b;');
    expect(c.querySelector('.jp2-prc-st')!.textContent).toBe('New');
    expect(cardOf('you').querySelector('.jp2-prc-who')!.textContent).toBe('you (you)');
    expect(cards().map((x) => x.querySelector('.jp2-prc-st')!.textContent)).toEqual(['New', 'New', 'New', 'Left']);
    expect(document.querySelector('.jp2-prv-verdict')!.textContent).toBe(`Raj asked for changes · ${clockWords('2026-11-14T13:00:00Z')}`);
  });

  it('new comments are ticked; the bar reads `3 ticked · Fix these · What is he asking? · Leave`; x ticks the one under the pointer', async () => {
    const o = open(payload(), view(NEW_ROWS));
    await openPr(o);
    expect(cards().map((c) => box(c)?.checked)).toEqual([true, true, true, false]);
    expect([...bar().querySelectorAll('.jp2-prc-n, button')].map((x) => x.textContent)).toEqual(['3 ticked', 'Fix these', 'What is he asking?', 'Leave']);
    fireEvent.mouseEnter(cardOf('you'));
    fireEvent.keyDown(document, { key: 'x' });
    await settle();
    expect(box(cardOf('you'))!.checked).toBe(false);
    expect(bar().querySelector('.jp2-prc-n')!.textContent).toBe('2 ticked');
    fireEvent.keyDown(document, { key: 'x' });
    await settle();
    expect(box(cardOf('you'))!.checked).toBe(true);
  });

  it('Fix these sends the ticked comments at once and they turn to Fixing; Leave marks them Left; What is he asking? asks', async () => {
    const o = open(payload(), view(NEW_ROWS));
    await openPr(o);
    fireEvent.click(cardOf('raj').querySelector('input')!); // untick one
    o.answer.pr = view(NEW_ROWS.map((r) => (['c902', 'i77'].includes(r.id) ? { ...r, state: 'fixing' as const } : r)));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Fix these' }));
    expect(cardOf('you').querySelector('.jp2-prc-st')!.textContent).toBe('Fixing');
    await settle();
    expect(calls(o.post, '/pr/1/fix').map((c) => c[1])).toEqual([{ ids: ['c902', 'i77'] }]);
    expect(cardOf('you').querySelector('.jp2-prc-st')!.textContent).toBe('Fixing');
    expect(box(cardOf('you'))).toBeNull();
    expect(bar().querySelector('.jp2-prc-n')!.textContent).toBe('Nothing ticked');
    fireEvent.click(cardOf('raj').querySelector('input')!);
    await settle();
    fireEvent.click(within(bar()).getByRole('button', { name: 'What is he asking?' }));
    await settle();
    expect(calls(o.post, '/pr/1/ask').map((c) => c[1])).toEqual([{ ids: ['c901'] }]);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Leave' }));
    await settle();
    expect(calls(o.post, '/pr/1/leave').map((c) => c[1])).toEqual([{ ids: ['c901'] }]);
  });

  it('after the Foreman: `Fixed in abc1234` opens that commit’s diff; the drafted reply is editable; Copy and Open on GitHub first, Post it second, then Posted', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const o = open(payload(line1({ comments: { fresh: 0, total: 2, fixed: 1, failing: 0, v: 'v2' } })), view(FIXED_ROWS));
    await openPr(o);
    const c = cardOf('raj');
    const fixed = within(c).getByRole('button', { name: 'Fixed in abc1234' });
    const ta = c.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(ta.value).toBe('Fixed in abc1234: it is a const now.');
    fireEvent.change(ta, { target: { value: 'Fixed in abc1234: a const now, thanks.' } });
    const acts = [...c.querySelectorAll('.jp2-prc-ra > *')].map((x) => x.textContent);
    expect(acts).toEqual(['Copy', 'Open on GitHub', 'Post it']);
    expect(within(c).getByRole('button', { name: 'Copy' }).className).toMatch(/primary/);
    expect(within(c).getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute('href', FIXED_ROWS[0].link);
    fireEvent.click(within(c).getByRole('button', { name: 'Copy' }));
    await settle();
    expect(writeText).toHaveBeenCalledWith('Fixed in abc1234: a const now, thanks.');
    expect(o.post).not.toHaveBeenCalled();
    // Post it: his edited words, through the server (lib/gh-write.js on his click), then Posted.
    o.answer.pr = view([{ ...FIXED_ROWS[0], reply: { draft: 'Fixed in abc1234: a const now, thanks.', posted: 'Fixed in abc1234: a const now, thanks.' } }, FIXED_ROWS[1]]);
    fireEvent.click(within(cardOf('raj')).getByRole('button', { name: 'Post it' }));
    await settle();
    expect(calls(o.post, '/pr/1/reply').map((x) => x[1])).toEqual([{ id: 'c901', body: 'Fixed in abc1234: a const now, thanks.' }]);
    expect(within(cardOf('raj')).getByText('Posted')).toBeInTheDocument();
    expect(cardOf('raj', 1).querySelector('.jp2-prc-why')!.textContent).toBe('Left: the helper is shared');
    // Fixed in abc1234 opens Changes at that commit and the comment's file.
    fireEvent.click(fixed.isConnected ? fixed : within(cardOf('raj')).getByRole('button', { name: 'Fixed in abc1234' }));
    await settle();
    expect(o.store.getState().ui.reader).toEqual({ kind: 'changes', id: 'changes' });
    expect(branchOf(o.store).pick).toEqual({ sha: SHA, path: 'web/src/App.tsx' });
  });

  it('a fix commit the branch does not have says so', async () => {
    const o = open(payload(), view([row('c901', { state: 'fixed', commit: 'fedcba9', reply: { draft: 'Done.', posted: null } })]));
    await openPr(o);
    expect(cardOf('raj').querySelector('.jp2-prc-st')!.textContent).toBe('Fixed in fedcba9 · not on this branch');
  });

  it('then the PR line’s button is `Push the fixes (2 commits)`: in the view’s bar, not on the line above it', async () => {
    const l1 = line1({ next: NEXT_FIX, comments: { fresh: 0, total: 2, fixed: 1, failing: 0, v: 'v3' } });
    const o = open(payload(l1), view(FIXED_ROWS, l1));
    await openPr(o);
    expect(reader().getAllByRole('button', { name: 'Push the fixes (2 commits)' })).toHaveLength(1);
    expect(within(bar()).getByRole('button', { name: 'Push the fixes (2 commits)' })).toBeInTheDocument();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Push the fixes (2 commits)' }));
    expect(within(bar()).getByText('abc1234 fix: a const')).toBeInTheDocument();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Push' }));
    await settle();
    expect(calls(o.post, '/pr/1/go').map((c) => c[1])).toEqual([{ id: 'push-fixes', check: 'abcdefabcdef' }]);
  });

  it('a failed check: its failing lines under Show the failure, and Fix it', async () => {
    const o = open(payload(), view(NEW_ROWS));
    await openPr(o);
    const check = document.querySelector<HTMLElement>('.jp2-prc-check')!;
    expect(check.querySelector('.jp2-prc-who')!.textContent).toBe('Check failed: lint');
    fireEvent.click(within(check).getByRole('button', { name: 'Show the failure' }));
    expect(check.querySelector('.jp2-prc-code')!.textContent).toContain('x is unused');
    fireEvent.click(within(check).getByRole('button', { name: 'Fix it' }));
    expect(within(check).getByText('Fixing')).toBeInTheDocument();
    await settle();
    expect(calls(o.post, '/pr/1/fix-check').map((c) => c[1])).toEqual([{ name: 'lint' }]);
  });

  it('asks for the rows again only when the line’s comments move', async () => {
    const o = open(payload(), view(NEW_ROWS));
    await openPr(o);
    const asks = () => o.get.mock.calls.filter((c) => c[0] === `/api/job/${SLUG}/pr/1`).length;
    expect(asks()).toBe(1);
    await o.serve(payload(line1({ word: 'open · checks passed' })));
    await settle();
    expect(asks()).toBe(1);
    await o.serve(payload(line1({ comments: { fresh: 4, total: 5, fixed: 0, failing: 1, v: 'v9' } })));
    await settle();
    expect(asks()).toBe(2);
  });

  it('Your move says `PR #1 · 3 new comments` and opens the PR view', async () => {
    const o = open(payload(line1(), { prMove: { n: 1, fresh: 3, since: '2026-11-14T13:00:00Z' }, move: null }), view(NEW_ROWS));
    await settle();
    const link = within(document.querySelector<HTMLElement>('.jp2-ym')!).getByRole('button', { name: 'PR #1 · 3 new comments' });
    fireEvent.click(link);
    await settle();
    expect(o.store.getState().ui.reader).toEqual({ kind: 'pr', id: '1' });
  });
});

describe('the PR view, fix round 1', () => {
  it('I2: Fix these and Post it hold Fixing and Posted until the server’s rows show them (no flicker back to New, no second Post it)', async () => {
    const o = open(payload(), view(NEW_ROWS));
    await openPr(o);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Fix these' }));
    await settle();
    // The server still answers the old rows (its rebuild comes a moment later).
    expect(cards().slice(0, 3).map((c) => c.querySelector('.jp2-prc-st')!.textContent)).toEqual(['Fixing', 'Fixing', 'Fixing']);
    expect(bar().querySelector('.jp2-prc-n')!.textContent).toBe('Nothing ticked');
    // Post it: Posted at once, and no button to post it again.
    const o2 = open(payload(line1({ comments: { fresh: 0, total: 2, fixed: 1, failing: 0, v: 'v2' } })), view(FIXED_ROWS));
    await openPr(o2);
    const c = [...document.querySelectorAll<HTMLElement>('.jp2-prc:not(.jp2-prc-check)')].filter((x) => within(x).queryByRole('button', { name: 'Post it' }))[0];
    fireEvent.click(within(c).getByRole('button', { name: 'Post it' }));
    await settle();
    expect(within(c).getByText('Posted')).toBeInTheDocument();
    expect(within(c).queryByRole('button', { name: 'Post it' })).toBeNull();
    expect(calls(o2.post, '/pr/1/reply')).toHaveLength(1);
  });

  it('I1: a row in a review round: its draft is editable, it has no Post it, and his edit goes with Push the fixes', async () => {
    const NEXT_ROUND = { ...NEXT_FIX, go: 'Send back', round: true, says: ['Sends back round 2 on PR #1 (#247), 3 steps:', 'Push 2 commits to your fork', 'Reply on GitHub to each of raj’s 1 comment', '  Reply to raj on web/src/App.tsx:40', 'Mark the 1 fixed comment resolved'] };
    const l1 = line1({ next: NEXT_ROUND, comments: { fresh: 0, total: 1, fixed: 1, failing: 0, v: 'v4' } });
    const o = open(payload(l1), view([{ ...FIXED_ROWS[0], round: true }], l1));
    await openPr(o);
    const c = cardOf('raj');
    expect(within(c).queryByRole('button', { name: 'Post it' })).toBeNull();
    expect(within(c).queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(c.querySelector('.jp2-prc-rl')!.textContent).toMatch(/posted with Push the fixes/);
    fireEvent.change(c.querySelector('textarea')!, { target: { value: 'Renamed, thanks.' } });
    fireEvent.click(within(bar()).getByRole('button', { name: 'Push the fixes (2 commits)' }));
    expect(within(bar()).getByText('Reply to raj on web/src/App.tsx:40')).toHaveClass('is-sub'); // kept under its step (Phase 4 M4)
    fireEvent.click(within(bar()).getByRole('button', { name: 'Send back' }));
    await settle();
    expect(calls(o.post, '/pr/1/go').map((x) => x[1])).toEqual([{ id: 'push-fixes', check: 'abcdefabcdef', replies: { c901: 'Renamed, thanks.' } }]);
  });

  it('M3: no Post it while GitHub isn’t answering', async () => {
    const down = { ...view(FIXED_ROWS), github: { ...GH, problem: 'GitHub isn’t answering.' } };
    const o = open(payload(line1({ comments: { fresh: 0, total: 2, fixed: 1, failing: 0, v: 'v2' } })), down);
    await openPr(o);
    expect(within(cardOf('raj')).queryByRole('button', { name: 'Post it' })).toBeNull();
    expect(within(cardOf('raj')).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });
});

describe('Phase 4 fixes', () => {
  it('B3: a fix committed after the branch list was read is looked for again, and opens its diff, while the page stays open', async () => {
    const NEW_SHA = 'f00dbee1234567890f00dbee1234567890f00db';
    const o = open(payload(line1({ comments: { fresh: 0, total: 1, fixed: 1, failing: 0, v: 'v2' } })), view([row('c901', { state: 'fixed', commit: 'f00dbee', reply: { draft: 'Done.', posted: null } })]));
    // The list held is the one from before the Foreman's commit; the next read has it.
    let reads = 0;
    const older = o.answer.commits;
    o.get.mockImplementation(async (url: string) => {
      if (url === `/api/job/${SLUG}/pr/1`) return clone(o.answer.pr);
      if (url === `/api/job/${SLUG}/commits`) { reads++; return reads === 1 ? older : { commits: [{ sha: NEW_SHA, short: 'f00dbee', subject: 'fix: c901', date: null, files: [] }, ...(older as { commits: unknown[] }).commits], cut: false }; }
      return { sha: NEW_SHA, truncated: false, files: [], patchFiles: [] };
    });
    await openPr(o);
    await settle();
    expect(reads).toBe(2);
    const b = within(cardOf('raj')).getByRole('button', { name: 'Fixed in f00dbee' });
    fireEvent.click(b);
    await settle();
    expect(branchOf(o.store).pick).toEqual({ sha: NEW_SHA, path: 'web/src/App.tsx' });
  });

  it('M1, M4: the read line’s problem ends its sentence before `Last read`; round reply lines stay under their step', async () => {
    const down = { ...GH, problem: 'GitHub didn’t answer. gh isn’t signed in: run gh auth login' };
    const o = open(payload(line1(), { github: down }), view(NEW_ROWS));
    await openPr(o);
    expect(document.querySelector('.jp2-prl-gh')!.textContent).toBe(`GitHub didn’t answer. gh isn’t signed in: run gh auth login. Last read ${clockWords(GH.at)}.`);
  });

  it('round rows: the label follows the round; an edit is kept in the round on blur', async () => {
    const { roundWords } = await import('./PrView');
    expect(roundWords('stopped')).toBe('Send back stopped before posting it: it goes when the round is sent back again.');
    expect(roundWords('after-pr1')).toBe('It is posted once the follow-up PR #1 is merged.');
    expect(roundWords('fixing')).toBe('It is posted with Push the fixes (the review round’s Send back).');
    const o = open(payload(line1({ comments: { fresh: 0, total: 1, fixed: 1, failing: 0, v: 'v5' } })), view([{ ...FIXED_ROWS[0], round: true, roundState: 'after-pr1' }]));
    await openPr(o);
    const c = cardOf('raj');
    expect(c.querySelector('.jp2-prc-rl')!.textContent).toMatch(/posted once the follow-up PR #1 is merged/);
    const ta = c.querySelector('textarea')!;
    fireEvent.change(ta, { target: { value: 'Renamed, thanks.' } });
    fireEvent.blur(ta);
    await settle();
    expect(calls(o.post, '/pr/1/draft').map((x) => x[1])).toEqual([{ id: 'c901', body: 'Renamed, thanks.' }]);
  });

  it('B1: picking Ship before it starts shows the PR lines and their action', async () => {
    const p = payload(line1({ next: NEXT_FIX }));
    p.steps = p.steps.map((s) => (s.id === 'ship' ? { ...s, state: 'todo', main: { kind: 'ship', id: 'ship' } } : s));
    const o = open(p, view(NEW_ROWS));
    await settle();
    const ship = [...document.querySelectorAll<HTMLButtonElement>('.jp2-st-row')].find((b) => b.querySelector('.jp2-st-name')?.textContent === 'Ship')!;
    fireEvent.click(ship);
    await settle();
    expect(o.store.getState().ui.step).toBe('ship');
    expect(reader().getByRole('button', { name: 'Push the fixes (2 commits)' })).toBeInTheDocument();
    expect(reader().queryByText(/Nothing yet/)).toBeNull();
  });
});

describe('final W9: a re-read that fails leaves the sha unknown', () => {
  it('a failed re-read does not mark the sha checked; the next good one does', async () => {
    const { knownNotOnBranch, loadCommits, recheck } = await import('./branch');
    const store = createJobStore(SLUG, { api: { page: () => new Promise(() => {}), item: async () => { throw new Error('no'); } }, events: () => () => {}, viewer: () => null });
    const list = { commits: [{ sha: 'aaaa1111bbbb2222', short: 'aaaa111', subject: 'feat: one', date: null, files: [] }], cut: false };
    let fail = false;
    const get = vi.fn(async () => { if (fail) throw new Error('Starbase isn’t answering.'); return list; });
    const api = { get, post: vi.fn(), hosted: () => false } as unknown as ApiClient;
    await loadCommits(store, api, SLUG);
    fail = true;
    await recheck(store, api, SLUG, 'f00dbee');
    expect(branchOf(store).checked.has('f00dbee')).toBe(false);
    expect(knownNotOnBranch(branchOf(store), 'f00dbee')).toBe(false);
    fail = false;
    await recheck(store, api, SLUG, 'f00dbee');
    expect(get).toHaveBeenCalledTimes(3);
    expect(branchOf(store).checked.has('f00dbee')).toBe(true);
    expect(knownNotOnBranch(branchOf(store), 'f00dbee')).toBe(true);
  });
});
