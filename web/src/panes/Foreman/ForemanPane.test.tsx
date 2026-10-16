import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { Gate, Job, JobDetail, ThreadItem } from '../../api/types';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { ev, job, snapshot } from '../../state/test-fixtures';
import { ForemanPane } from './ForemanPane';

// Invented job and conversation; no real job names.
const ALPHA: Job = job('alpha', 'needs-you', { kind: 'bug', repo: { name: 'sample-repo', branch: 'fix/sample' }, cost: { totalUsd: 1.5 } });

const at = (m: number) => new Date(Date.UTC(2026, 9, 15, 12, m)).toISOString();

const THREAD: ThreadItem[] = [
  { id: 'brief:briefs/1-spec.md', kind: 'brief', at: at(1), number: 1, stage: 'spec', file: 'briefs/1-spec.md', headline: 'Spec is ready', point: null },
  { id: 'you:aaa', kind: 'you', at: at(2), text: 'Looks good <script>alert(1)</script>' },
  { id: 'auto:bbb', kind: 'auto', at: at(3), items: [{ at: at(3), headline: 'Read a file', who: 'conductor' }, { at: at(3), headline: 'Ran the tests', who: 'feature-tester' }] },
  { id: 'reply:ccc', kind: 'reply', at: at(4), html: '<p>Done with <strong>step one</strong>.</p>', rulings: ['kept the old enum order'], proof: 'npm test → 0' },
  { id: 'problem:ddd', kind: 'problem', at: at(5), text: 'The reply hit a problem.' },
  { id: 'note:eee', kind: 'note', at: at(6), text: 'You paused this reply.' },
  { id: 'decision:fff', kind: 'decision', at: at(7), text: 'You allowed: Run the tests' },
  { id: 'brief:briefs/2-plan.md', kind: 'brief', at: at(8), number: 2, stage: 'plan', file: 'briefs/2-plan.md', headline: 'Plan needs your yes', point: null },
  { id: 'brief:briefs/2-detail.md', kind: 'brief', at: at(8), number: 2, stage: 'detail', file: 'briefs/2-detail.md', headline: null, point: null },
];

const detail = (extra: Partial<JobDetail> = {}): JobDetail => ({ slug: 'alpha', title: 'Job alpha', branch: 'fix/sample', run: null, thread: THREAD, threadMore: false, ...extra });

type Routes = Record<string, unknown | (() => unknown)>;

function setup({ routes = {}, jobs = [ALPHA], slug = 'alpha', post = vi.fn() }: { routes?: Routes; jobs?: Job[]; slug?: string | null; post?: ReturnType<typeof vi.fn> } = {}) {
  const all: Routes = {
    '/api/job/alpha': detail(),
    '/api/job/alpha/doc?file=briefs%2F1-spec.md': { file: 'briefs/1-spec.md', name: 'Brief 1', html: '<p>The whole spec brief.</p>' },
    '/api/job/alpha/doc?file=briefs%2F2-plan.md': { file: 'briefs/2-plan.md', name: 'Brief 2', html: '<p>The whole plan brief.</p>' },
    '/api/job/alpha/doc?file=briefs%2F2-detail.md': { file: 'briefs/2-detail.md', name: 'Detail', html: '<p>The longer detail.</p>' },
    ...routes,
  };
  const get = vi.fn(async (path: string) => {
    const r = all[path];
    if (r === undefined) throw new ApiError(404, 'That file isn’t there (yet).');
    return typeof r === 'function' ? (r as () => unknown)() : r;
  });
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs }) });
  const api = { get, post } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><ForemanPane slug={slug} /></WorkshopContext.Provider>);
  return { ...utils, get, store, all };
}

afterEach(() => { localStorage.clear(); });

describe('Foreman pane', () => {
  it('shows the LevelCard in the conversation when the Foreman suggests another level', async () => {
    setup({ jobs: [{ ...ALPHA, level: 2, suggestedLevel: 3, levelReason: 'Touches office visibility.' }] });
    const conversation = screen.getByRole('region', { name: 'Conversation' });
    const c = await within(conversation).findByRole('region', { name: 'The Foreman suggests L3 Large' });
    expect(c).toHaveTextContent('L3 · Touches office visibility.');
    expect(screen.getByRole('button', { name: 'L2 Standard' })).toBeInTheDocument();
  });

  it('shows the job header: title, kind, repo, branch, cost and status', async () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Job alpha' })).toBeInTheDocument();
    expect(screen.getByText('Bug fix')).toBeInTheDocument();
    expect(screen.getByText('sample-repo')).toBeInTheDocument();
    expect(screen.getByText('fix/sample')).toBeInTheDocument();
    expect(screen.getByText('$1.50')).toHaveAttribute('title', 'What this job has cost so far.');
    expect(screen.getByText('Needs you')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No level yet' })).toHaveAttribute('aria-haspopup', 'dialog');
    await screen.findByText('Spec is ready');
  });

  it('has a job menu with Mark done, Notes and options, and the classic link (no classic Options link)', async () => {
    setup();
    const button = screen.getByRole('button', { name: /Job menu/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(screen.getByRole('link', { name: 'Open in classic view' })).toHaveAttribute('href', '/#/job/alpha');
    expect(screen.queryByRole('link', { name: /Options \(classic view\)/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Notes and options…' })).toHaveAttribute('title', expect.stringContaining('notes.md'));
    expect(screen.getByRole('button', { name: 'Mark done or dropped…' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull(); // only for a job marked done
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('link', { name: 'Open in classic view' })).toBeNull();
    await screen.findByText('Spec is ready');
  });

  it('shows each kind of thread item in order, with your text as plain text', async () => {
    setup();
    const thread = await screen.findByRole('region', { name: 'Conversation' });
    await within(thread).findByText('Spec is ready');
    expect(within(thread).getByText('Looks good <script>alert(1)</script>')).toBeInTheDocument();
    expect(thread.querySelector('script')).toBeNull();
    expect(within(thread).getByText(/2 routine steps done automatically/)).toBeInTheDocument();
    expect(within(thread).getByText('step one').tagName).toBe('STRONG'); // the dashboard's sanitised reply HTML
    expect(within(thread).getByRole('article', { name: 'Problem' })).toHaveTextContent('The reply hit a problem.');
    expect(within(thread).getByText(/You paused this reply/)).toBeInTheDocument();
    expect(within(thread).getByText(/You allowed: Run the tests/)).toBeInTheDocument();
    const order = [...thread.querySelectorAll('.thread-item')].map((el) => el.classList[1]);
    expect(order).toEqual(['brief-card', 'you', 'auto-fold', 'reply', 'problem', 'note', 'decision', 'brief-card']);
  });

  it('shows rulings and proof only where present', async () => {
    setup();
    const reply = await screen.findByRole('article', { name: 'Foreman' });
    expect(within(reply).getByText('Rulings')).toBeInTheDocument();
    expect(within(reply).getByText('kept the old enum order')).toBeInTheDocument();
    expect(within(reply).getByText('npm test → 0')).toBeInTheDocument();
    expect(screen.getAllByText('Rulings')).toHaveLength(1);
    expect(screen.queryByText('Proof', { selector: '.brief-card dt' })).toBeNull();
  });

  it('opens the brief waiting for you in full, with its detail folded; answered briefs show their headline', async () => {
    const { get } = setup();
    const waiting = await screen.findByRole('article', { name: 'Brief #2 · Plan' });
    expect(await within(waiting).findByText('The whole plan brief.')).toBeInTheDocument();
    expect(within(waiting).getByRole('button', { name: /Brief #2/ })).toHaveAttribute('aria-expanded', 'true');

    // The detail file is read only when you open its fold, and isn't shown as a brief of its own.
    expect(screen.queryByRole('article', { name: /Detail/ })).toBeNull();
    expect(get).not.toHaveBeenCalledWith('/api/job/alpha/doc?file=briefs%2F2-detail.md');
    const fold = within(waiting).getByText('More detail').closest('details')!;
    act(() => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
    expect(await within(waiting).findByText('The longer detail.')).toBeInTheDocument();

    const answered = screen.getByRole('article', { name: 'Brief #1 · Spec' });
    expect(within(answered).getByText('Spec is ready')).toBeInTheDocument();
    expect(within(answered).getByText('Answered')).toBeInTheDocument();
    expect(within(answered).queryByText('More detail')).toBeNull();
    expect(get).not.toHaveBeenCalledWith('/api/job/alpha/doc?file=briefs%2F1-spec.md');
    fireEvent.click(within(answered).getByRole('button', { name: /Brief #1/ }));
    expect(await within(answered).findByText('The whole spec brief.')).toBeInTheDocument();
  });

  it('folds a brief to its headline once you answer it, refetching only this job', async () => {
    const { get, store, all } = setup();
    const waiting = await screen.findByRole('article', { name: 'Brief #2 · Plan' });
    await within(waiting).findByText('The whole plan brief.');
    all['/api/job/alpha'] = detail({ thread: [...THREAD, { id: 'you:ggg', kind: 'you', at: at(9), text: 'Yes, go ahead' }] });
    const calls = get.mock.calls.length;
    act(() => { store.dispatch({ type: 'event', event: ev(11, 'thread', 'beta') }); });
    expect(get.mock.calls.length).toBe(calls); // another job's thread: no fetch
    act(() => { store.dispatch({ type: 'event', event: ev(12, 'thread', 'alpha') }); });
    expect(await screen.findByText('Yes, go ahead')).toBeInTheDocument();
    const now = screen.getByRole('article', { name: 'Brief #2 · Plan' });
    expect(within(now).getByRole('button', { name: /Brief #2/ })).toHaveAttribute('aria-expanded', 'false');
    expect(within(now).getByText('Plan needs your yes')).toBeInTheDocument();
  });

  it('pins the gate card above the composer; the brief stays open for a plain message and folds once a gate reply answers it', async () => {
    const gate: Gate = {
      briefNumber: 2, briefFile: 'briefs/2-plan.md', headline: 'Plan needs your yes', stage: 'plan', nextStage: 'implement', nextProposed: 'Build step 1',
      questions: [], decided: [], versions: null, raisedVersions: null, stale: false, waitingSince: at(8), runActive: false, parked: false,
      level: null, suggestedLevel: null, levelReason: null, usage: null,
    };
    const asked = { id: 'you:qqq', kind: 'you' as const, at: at(9), text: 'Is the CSV in scope?', sendKind: 'message' };
    const post = vi.fn(async () => { throw new ApiError(409, 'The Foreman has moved on to brief 3 since this card was shown. Nothing was sent; decide on the new brief.', { code: 'stale-brief', briefNumber: 3 }); });
    const { get, all } = setup({ post, routes: { '/api/job/alpha': detail({ gate, answeredBriefs: [], thread: [...THREAD, asked] }) } });
    const card = await screen.findByRole('region', { name: 'Plan needs your yes' });
    // After the conversation, before the composer.
    const conversation = screen.getByRole('region', { name: 'Conversation' });
    const composer = screen.getByRole('region', { name: 'Message the Foreman' });
    expect(conversation.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A plain question leaves the brief the card is open on unanswered.
    const brief = screen.getByRole('article', { name: 'Brief #2 · Plan' });
    await within(brief).findByText('The whole plan brief.');
    expect(within(brief).queryByText('Answered')).toBeNull();

    // A refused approval (the Foreman moved on) fetches the job again and says so.
    const before = get.mock.calls.filter(([p]) => p === '/api/job/alpha').length;
    all['/api/job/alpha'] = detail({ gate, answeredBriefs: [2], thread: [...THREAD, asked] });
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Approve and start Build' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('moved on to brief 3');
    await waitFor(() => expect(get.mock.calls.filter(([p]) => p === '/api/job/alpha').length).toBe(before + 1));
    // Now answered from a gate card: the card goes and the brief folds, without fetching it again.
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Plan needs your yes' })).toBeNull());
    expect(within(brief).getByText('Answered')).toBeInTheDocument();
    expect(within(brief).getByRole('button', { name: /Brief #2/ })).toHaveAttribute('aria-expanded', 'false');
    expect(get.mock.calls.filter(([p]) => p === '/api/job/alpha/doc?file=briefs%2F2-plan.md')).toHaveLength(1);
  });

  it('refetches the open thread after a resync, catching up thread events lost in the gap', async () => {
    const { store, all } = setup();
    await screen.findByText('Spec is ready');
    all['/api/job/alpha'] = detail({ thread: [...THREAD, { id: 'you:hhh', kind: 'you', at: at(9), text: 'Sent while you were away' }] });
    act(() => { store.dispatch({ type: 'event', event: ev(2, 'resync', null, { reason: 'restarted', epoch: 'bbbb' }) }); });
    expect(screen.queryByText('Sent while you were away')).toBeNull(); // waits for the fresh snapshot
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [ALPHA], seq: 2, epoch: 'bbbb' }) }); });
    expect(await screen.findByText('Sent while you were away')).toBeInTheDocument();
  });

  it('shows the live row while the Foreman replies', async () => {
    const { store } = setup();
    await screen.findByText('Spec is ready');
    expect(screen.queryByRole('region', { name: 'Foreman, replying now' })).toBeNull();
    act(() => { store.dispatch({ type: 'event', event: ev(11, 'run', 'alpha', { id: 'r1', slug: 'alpha', status: 'running', lastAction: 'Reading the plan', lastText: 'Starting on step two.' }) }); });
    const live = screen.getByRole('region', { name: 'Foreman, replying now' });
    expect(within(live).getByRole('status')).toHaveTextContent('The Foreman is working');
    expect(within(live).getByText('Reading the plan')).toBeInTheDocument();
    expect(within(live).getByText('Starting on step two.')).toBeInTheDocument();
    act(() => { store.dispatch({ type: 'event', event: ev(12, 'run', 'alpha', { id: 'r1', slug: 'alpha', status: 'done', lastText: 'Starting on step two.' }) }); });
    expect(screen.queryByRole('region', { name: 'Foreman, replying now' })).toBeNull();
  });

  it('loads older items before the first one shown', async () => {
    const newest: ThreadItem[] = [{ id: 'you:n1', kind: 'you', at: at(20), text: 'Newest message' }];
    const { get } = setup({
      routes: {
        '/api/job/alpha': detail({ thread: newest, threadMore: true }),
        '/api/job/alpha?before=you%3An1': { slug: 'alpha', thread: [{ id: 'you:o1', kind: 'you', at: at(10), text: 'Older message' }], threadMore: false },
      },
    });
    await screen.findByText('Newest message');
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    expect(await screen.findByText('Older message')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/job/alpha?before=you%3An1');
    const texts = [...document.querySelectorAll('.you-text')].map((el) => el.textContent);
    expect(texts).toEqual(['Older message', 'Newest message']);
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
  });

  it('says so when older items are gone', async () => {
    setup({ routes: { '/api/job/alpha': detail({ thread: [{ id: 'you:n1', kind: 'you', at: at(20), text: 'Newest message' }], threadMore: true }) } });
    await screen.findByText('Newest message');
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That file isn’t there (yet).'));
    expect(screen.getByText('Newest message')).toBeInTheDocument();
  });

  it('asks you to pick a job, or says the job is unknown', () => {
    setup({ slug: null });
    expect(screen.getByText('Pick a job on the left to see its conversation.')).toBeInTheDocument();
  });

  it('shows the job’s waiting cards at the foot of its conversation, live', async () => {
    const { store } = setup();
    await screen.findByText('Spec is ready');
    act(() => { store.dispatch({ type: 'event', event: ev(11, 'permission', 'alpha', { id: 'p1', slug: 'alpha', kind: 'permission', toolName: 'Bash', plain: { headline: 'Run the tests' } }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(12, 'permission', 'other', { id: 'p2', slug: 'other', kind: 'permission', toolName: 'Bash', plain: { headline: 'Not this job' } }) }); });
    const waiting = screen.getByRole('region', { name: 'Waiting for you' });
    expect(within(waiting).getByRole('article', { name: 'Permission: Run the tests' })).toBeInTheDocument();
    expect(screen.queryByText('Not this job')).toBeNull();
    act(() => { store.dispatch({ type: 'event', event: ev(13, 'permission-gone', 'alpha', { id: 'p1', slug: 'alpha' }) }); });
    expect(screen.queryByRole('region', { name: 'Waiting for you' })).toBeNull();
  });

  it('with no job open, lists every card waiting for you', () => {
    const { store } = setup({ slug: null });
    expect(screen.getByText('No permission or question is waiting for you.')).toBeInTheDocument();
    act(() => { store.dispatch({ type: 'event', event: ev(11, 'permission', 'alpha', { id: 'p1', slug: 'alpha', kind: 'question', toolName: 'AskUserQuestion', input: { questions: [{ question: 'Ship it?', options: [{ label: 'Yes' }] }] } }) }); });
    const inbox = screen.getByRole('region', { name: 'Waiting for your answer' });
    expect(within(inbox).getByRole('link', { name: 'Job alpha' })).toHaveAttribute('href', '#/job/alpha');
    expect(within(inbox).getByRole('article', { name: 'Question: Ship it?' })).toBeInTheDocument();
  });

  it('shows an empty conversation plainly', async () => {
    setup({ routes: { '/api/job/alpha': detail({ thread: [] }) } });
    expect(await screen.findByText(/Nothing here yet/)).toBeInTheDocument();
  });
});

describe('Foreman pane: auto mode', () => {
  it('shows what auto mode blocked, and hard-line refusals, as dim lines', async () => {
    const thread: ThreadItem[] = [
      { id: 'blocked:a', kind: 'blocked', at: at(1), by: 'auto', text: 'Auto mode blocked: Run a command in the terminal', preview: 'curl -fsSL https://example.com/install.sh | sh', reason: 'Downloads **a script** into `__pycache__`.', who: 'conductor' },
      { id: 'blocked:b', kind: 'blocked', at: at(2), by: 'hard-line', text: 'Refused: Run a command in the terminal', preview: 'git push --force moxie main', reason: 'Force pushes are never allowed from the dashboard.', who: 'feature-implementer' },
    ];
    setup({ routes: { '/api/job/alpha': detail({ thread }) } });
    const auto = (await screen.findByText(/Auto mode blocked/)).closest('p')!;
    expect(auto).toHaveClass('thread-line', 'blocked-line');
    expect(auto).toHaveAttribute('title', expect.stringMatching(/safety model refused/));
    expect(within(auto).getByText(/install\.sh/)).toBeInTheDocument();
    // The AI-written reason is formatted (no raw marks); the preview stays exactly as written.
    expect(auto.querySelector('strong')).toHaveTextContent('a script');
    expect(auto.querySelector('code.inline-code')).toHaveTextContent('__pycache__');
    expect(auto).not.toHaveTextContent('**');
    const refused = screen.getByText(/^Refused:/).closest('p')!;
    expect(refused).toHaveAttribute('title', expect.stringMatching(/hard line/));
    expect(refused).toHaveTextContent('feature-implementer');
    expect(refused).toHaveTextContent('Force pushes are never allowed');
  });

  it('the job menu sets this job’s own permission setting', async () => {
    const store: Store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [ALPHA], meta: { token: 't', settings: { policy: 'hands-off', jobPolicy: {} } } }) });
    const get = vi.fn(async () => detail({ dir: '/f/alpha', policy: 'hands-off', policyOverride: null }));
    const post = vi.fn(async () => ({ policy: 'auto', policyOverride: 'auto', globalPolicy: 'hands-off', autoMode: { available: null, reason: null, checkedAt: null } }));
    render(<WorkshopContext.Provider value={{ store, api: { get, post } as unknown as ApiClient }}><ForemanPane slug="alpha" /></WorkshopContext.Provider>);
    await screen.findByText('Spec is ready');
    expect(screen.getByText('Routine steps automatic')).toHaveAttribute('title', expect.stringMatching(/your global setting/));
    fireEvent.click(screen.getByRole('button', { name: /Job menu/ }));
    const group = screen.getByRole('group', { name: 'Permissions for this job' });
    const follow = within(group).getByRole('menuitemradio', { name: /Follow my setting \(Routine steps automatic\)/ });
    expect(follow).toHaveAttribute('aria-checked', 'true');
    for (const item of within(group).getAllByRole('menuitemradio')) expect(item).toHaveAttribute('title');
    fireEvent.click(within(group).getByRole('menuitemradio', { name: 'Auto mode' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/policy', { policy: 'auto' }));
    await waitFor(() => expect(screen.getByText('Auto mode · this job')).toBeInTheDocument());
    expect(store.getState().meta?.settings?.jobPolicy).toEqual({ '/f/alpha': 'auto' });
  });

  it('the job menu shows auto mode disabled when the account can’t use it', async () => {
    const store: Store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [ALPHA], meta: { token: 't', settings: { policy: 'hands-off', autoMode: { available: false, reason: 'Not on this plan.', checkedAt: null } } } }) });
    render(<WorkshopContext.Provider value={{ store, api: { get: vi.fn(async () => detail()) } as unknown as ApiClient }}><ForemanPane slug="alpha" /></WorkshopContext.Provider>);
    await screen.findByText('Spec is ready');
    fireEvent.click(screen.getByRole('button', { name: /Job menu/ }));
    const auto = screen.getByRole('menuitemradio', { name: 'Auto mode' });
    expect(auto).toBeDisabled();
    expect(auto).toHaveAttribute('title', 'Not available: Not on this plan.');
  });
});
