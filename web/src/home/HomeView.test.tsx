import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { FlowView, Job, Permission, Settings } from '../api/types';
import { App } from '../app/App';
import type { EventSourceLike } from '../state/live';
import { createStore, WorkshopContext } from '../state/store';
import { ev, job, permission, snapshot } from '../state/test-fixtures';
import { writeKeysSetting } from '../app/keysSetting';
import { NotifySettings } from '../views/Settings/NotifySettings';

class FakeStream implements EventSourceLike {
  readyState = 0;
  onopen: EventSourceLike['onopen'] = null;
  onmessage: EventSourceLike['onmessage'] = null;
  onerror: EventSourceLike['onerror'] = null;
  close() { this.readyState = 2; }
}

const FLOW: FlowView = {
  fetchedAt: '2026-10-21T11:55:00Z', checkedAt: '2026-10-21T11:59:00Z', refreshing: false, nextFetchAt: '2026-10-21T12:05:00Z',
  repos: [{
    repo: '/r/moxie-portal', name: 'moxie-portal',
    org: { remote: 'moxie', slug: 'Moxie/moxie-portal' }, fork: { remote: 'origin', slug: 'me/moxie-portal' },
    main: { ref: 'moxie/main', tip: { sha: 'a', at: '2026-10-20T10:00:00Z', subject: 'Release (#139)' } },
    staging: { ref: 'moxie/staging', tip: { sha: 'b', at: '2026-10-21T10:00:00Z', subject: 'Merge x' }, vsMain: { ahead: 102, behind: 0 } },
    release: { number: 158, title: 'Release', url: 'https://github.com/Moxie/moxie-portal/pull/158', state: 'open', head: 'staging', base: 'main', review: 'review_required', checks: 'passing', mergedAt: null, updatedAt: null },
    prsKnown: true, errors: [],
    lanes: [
      { slug: 'alpha', title: 'Job alpha', branch: 'feature/alpha', worktree: '/r/orbit-alpha', position: 'fork', reached: 1, vsMain: { ahead: 10, behind: 2 }, vsStaging: null, unpushed: 1, forkBehind: 0, dirty: 3, pushed: true, orgBranch: false,
        pr1: { number: 141, title: 'Alpha', url: 'https://github.com/Moxie/moxie-portal/pull/141', state: 'open', head: 'feature/alpha', base: 'feature/alpha', review: null, checks: 'failing', mergedAt: null, updatedAt: null }, pr2: null },
      { slug: 'beta', title: 'Job beta', branch: 'feature/beta', worktree: null, position: 'staging', reached: 3, vsMain: { ahead: 4, behind: 0 }, vsStaging: null, unpushed: 0, forkBehind: 0, dirty: null, pushed: true, orgBranch: true,
        pr1: { number: 135, title: 'Beta', url: 'https://github.com/Moxie/moxie-portal/pull/135', state: 'merged', head: 'feature/beta', base: 'feature/beta', review: null, checks: 'passing', mergedAt: null, updatedAt: null },
        pr2: { number: 136, title: 'Beta', url: 'https://github.com/Moxie/moxie-portal/pull/136', state: 'merged', head: 'feature/beta', base: 'staging', review: 'approved', checks: 'passing', mergedAt: null, updatedAt: null } },
      { slug: 'gamma', title: 'Job gamma', branch: 'feature/gamma', worktree: null, position: 'main', reached: 4, vsMain: { ahead: 0, behind: 0 }, vsStaging: null, unpushed: 0, forkBehind: 0, dirty: null, pushed: true, orgBranch: true, pr1: null, pr2: null },
    ],
  }],
};

function renderApp({ jobs = [job('alpha', 'needs-you', { waitingFor: 'approval', stage: 'plan', waitingSince: '2026-10-21T09:00:00Z' }), job('beta', 'running')] as Job[], permissions = [] as Permission[], hash = '#/' } = {}) {
  window.location.hash = hash;
  const streams: FakeStream[] = [];
  const get = vi.fn(async (path: string) => {
    if (path === '/api/flow') return FLOW;
    if (path === '/api/notifications') return { method: 'terminal-notifier', history: [] };
    return { slug: 'alpha', thread: [], threadMore: false, gate: null };
  });
  const post = vi.fn(async (path: string) => (path === '/api/flow/refresh' ? { ...FLOW, refreshing: true } : { ok: true }));
  const api = { snapshot: vi.fn(async () => snapshot({ jobs, permissions })), setToken: vi.fn(), get, post } as unknown as ApiClient;
  render(<App api={api} openStream={() => { const s = new FakeStream(); streams.push(s); return s; }} />);
  return { get, post, streams };
}

afterEach(() => { cleanup(); window.location.hash = ''; localStorage.clear(); });

const LANDED = { reached: true, at: null, by: 'pr1-merged' as const, landed: 'main' as const };
const MAP_JOBS = (): Job[] => [job('alpha', 'needs-you', { waitingFor: 'approval', stage: 'plan', waitingSince: '2026-10-21T09:00:00Z' }), job('beta', 'running'), job('gamma', 'done', { finish: LANDED })];

describe('Home: the flow map as rows', () => {
  it('is the landing page: one row per job under its group, with the ship track, the words, the counts and the next hint', async () => {
    const { get } = renderApp({ jobs: MAP_JOBS() });
    const needs = await screen.findByRole('list', { name: 'Needs you jobs in moxie-portal' });
    expect(get).toHaveBeenCalledWith('/api/flow');
    expect(screen.queryByRole('navigation', { name: 'Jobs' })).toBeNull();
    // The headings, in order, with their counts; Done folded.
    const repo = screen.getByRole('region', { name: 'moxie-portal' });
    expect(within(repo).getAllByRole('heading', { level: 4 }).map((h) => h.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Needs you 1', 'Running 1', '▸ Done 1']);
    expect(screen.queryByRole('list', { name: 'Done jobs in moxie-portal' })).toBeNull();
    // Alpha's row.
    const alpha = within(needs).getAllByRole('listitem')[0];
    expect(within(alpha).getByRole('link', { name: 'Job alpha' })).toHaveAttribute('href', '#/job/alpha');
    expect(alpha.querySelector('.map-row-words')).toHaveTextContent('On your fork · PR #1 (#141) open, checks failing · main ↑10 ↓2 · 1 not pushed · 3 uncommitted');
    const pr1 = within(alpha).getByRole('link', { name: 'PR #1 (#141)' });
    expect(pr1).toHaveAttribute('href', 'https://github.com/Moxie/moxie-portal/pull/141');
    expect(pr1).toHaveAttribute('target', '_blank');
    expect(alpha.querySelector('.map-row-hint')).toHaveTextContent('Give the go-ahead on Plan');
    // The track: five stops, filled to the fork (a disc), the rest rings, the flag on the Moxie branch (the default finish line), said in words too.
    expect(within(alpha).getByText('Ship track: on your fork, stop 2 of 5. Finish line: moxie branch.')).toHaveClass('sr-only');
    const stops = [...alpha.querySelectorAll('.ship-stop')];
    expect(stops.map((s) => s.className)).toEqual(['ship-stop is-filled', 'ship-stop is-here', 'ship-stop is-empty has-flag', 'ship-stop is-empty', 'ship-stop is-empty']);
    expect(stops[2]).toHaveAttribute('title', 'Moxie branch: not yet. The finish line.');
    expect(within(alpha).getByText('main ↑10 ↓2', { exact: false })).toHaveAttribute('title', expect.stringMatching(/2 commits behind it/));
    // Beta's row, under Running.
    const beta = within(screen.getByRole('list', { name: 'Running jobs in moxie-portal' })).getAllByRole('listitem')[0];
    expect(beta.querySelector('.map-row-words')).toHaveTextContent('In staging · PR #2 (#136) merged · main ↑4 ↓0');
    expect(beta.querySelector('.map-row-hint')).toHaveTextContent('Nothing to do: the Foreman is working');
    // The repo's release train, and the jobs aboard.
    expect(repo.querySelector('.release-line')).toHaveTextContent('staging: 102 commits waiting · release #158 open · last release 2026-10-20 (#139)');
    expect(screen.getByRole('link', { name: 'release #158 open' })).toHaveAttribute('href', 'https://github.com/Moxie/moxie-portal/pull/158');
    fireEvent.click(screen.getByRole('button', { name: /1 aboard/ }));
    expect(within(screen.getByRole('list', { name: 'Jobs in staging, moxie-portal' })).getByRole('link', { name: 'Job beta' })).toBeInTheDocument();
    // The what-needs-you band stays.
    expect(screen.getByRole('region', { name: 'The Foreman' })).toBeInTheDocument();
  });

  it('Done opens on a click and stays open; the chips filter with counts; Show hides the counts', async () => {
    renderApp({ jobs: MAP_JOBS() });
    await screen.findByRole('list', { name: 'Needs you jobs in moxie-portal' });
    fireEvent.click(screen.getByRole('button', { name: /Done 1/ }));
    expect(localStorage.getItem('fw.home.map.done')).toBe('open');
    const done = screen.getByRole('list', { name: 'Done jobs in moxie-portal' });
    expect(within(done).getByRole('link', { name: 'Job gamma' })).toBeInTheDocument();
    expect(done.querySelector('.map-row-hint')).toHaveTextContent('In main');
    // Chips: one repo, so no repo chip.
    const chips = within(screen.getByRole('group', { name: 'Which jobs' })).getAllByRole('button');
    expect(chips.map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['All 3', 'Needs you 1', 'Shipping 0']);
    fireEvent.click(chips[1]);
    expect(localStorage.getItem('fw.home.map.chip')).toBe('needs-you');
    expect(screen.getByRole('link', { name: 'Job alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Job beta' })).toBeNull();
    fireEvent.click(chips[0]);
    expect(screen.getByRole('link', { name: 'Job beta' })).toBeInTheDocument();
    // Show: counts off takes the muted suffix away; branches on shows the branch.
    const show = within(screen.getByRole('group', { name: 'Show' }));
    fireEvent.click(show.getByRole('button', { name: 'counts' }));
    expect(screen.queryByText('main ↑10 ↓2', { exact: false })).toBeNull();
    fireEvent.click(show.getByRole('button', { name: 'branches' }));
    expect(screen.getByText('feature/alpha')).toBeInTheDocument();
    expect(localStorage.getItem('fw.home.map.show')).toBe('branches');
  });

  it('keys: j and k move the highlight, Enter opens the job, o its newest PR, / jumps to the chips, 2 picks Needs you', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderApp({ jobs: MAP_JOBS() });
    await screen.findByRole('list', { name: 'Needs you jobs in moxie-portal' });
    const row = (slug: string) => document.querySelector(`.map-row[data-slug="${slug}"]`)!;
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(row('alpha')).toHaveAttribute('aria-current', 'true');
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(row('beta')).toHaveAttribute('aria-current', 'true');
    expect(row('alpha')).not.toHaveAttribute('aria-current');
    fireEvent.keyDown(document.body, { key: 'j' }); // Done is folded: beta stays the last row
    expect(row('beta')).toHaveAttribute('aria-current', 'true');
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(row('alpha')).toHaveAttribute('aria-current', 'true');
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(open).toHaveBeenCalledWith('https://github.com/Moxie/moxie-portal/pull/141', '_blank', 'noreferrer');
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.getByRole('button', { name: /^All/ })).toHaveFocus();
    fireEvent.keyDown(document.body, { key: '2' });
    expect(localStorage.getItem('fw.home.map.chip')).toBe('needs-you');
    expect(document.querySelector('.map-keys')).toHaveTextContent('j Highlight the next row · k Highlight the previous row · Enter Open the highlighted job · o Open its newest PR on GitHub · / Jump to the filter chips · 1 / 2 / 3 / 4 Pick that filter chip');
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(window.location.hash).toBe('#/job/alpha');
    open.mockRestore();
  });

  it('Refresh asks the dashboard to read the branches and PRs now; a flow event updates the rows', async () => {
    const { post, streams } = renderApp();
    await screen.findByRole('list', { name: 'Needs you jobs in moxie-portal' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/flow/refresh', {}));
    expect(await screen.findByText('Reading branches and PRs…')).toBeInTheDocument();
    const moved: FlowView = { ...FLOW, refreshing: false, repos: [{ ...FLOW.repos[0], lanes: [{ ...FLOW.repos[0].lanes[0], position: 'org', reached: 2 }] }] };
    act(() => { streams[0].onmessage?.(new MessageEvent('message', { data: JSON.stringify(ev(11, 'flow', null, moved)) })); });
    expect(document.querySelector('.map-row[data-slug="alpha"] .map-row-where')).toHaveTextContent('On the moxie branch');
    expect(screen.getByText('Ship track: on the moxie branch, stop 3 of 5. Finish line: moxie branch.')).toBeInTheDocument();
  });
});

describe('Home: the Table', () => {
  it('lists the jobs; sorts, filters and searches them, and remembers the sort', async () => {
    renderApp({ hash: '#/table' });
    const table = await screen.findByRole('table');
    const titles = () => within(table).getAllByRole('rowheader').map((h) => h.textContent);
    expect(titles()).toEqual(['Job alpha', 'Job beta']);
    fireEvent.click(within(table).getByRole('button', { name: /^Job/ }));
    fireEvent.click(within(table).getByRole('button', { name: /^Job/ }));
    expect(titles()).toEqual(['Job beta', 'Job alpha']);
    expect(localStorage.getItem('fw.home.table.sort')).toBe('job:desc');
    expect(within(table).getByRole('columnheader', { name: /^Job/ })).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(screen.getByRole('button', { name: /^In review/ }));
    expect(titles()).toEqual(['Job alpha']);
    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search jobs' }), { target: { value: 'feature/beta' } });
    expect(titles()).toEqual(['Job beta']);
    expect(within(table).getByText('In staging · PR #2 (#136) merged')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Shipping/ })).toBeInTheDocument();
  });
});

describe('Home: the Table’s keys', () => {
  it('↓ and ↑ move between the jobs while the focus is in the table; the footer says so', async () => {
    renderApp({ hash: '#/table' });
    await screen.findByRole('table');
    const links = screen.getAllByRole('link', { name: /^Job (alpha|beta)$/ });
    expect(links.length).toBe(2);
    links[0].focus();
    fireEvent.keyDown(links[0], { key: 'ArrowDown' });
    expect(links[1]).toHaveFocus();
    fireEvent.keyDown(links[1], { key: 'ArrowUp' });
    expect(links[0]).toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'ArrowDown' }); // outside the table: nothing
    expect(links[0]).toHaveFocus();
    expect(document.querySelector('.table-keys')).toHaveTextContent('↓ The next job · ↑ The previous job · Enter Open the job');
  });
});

describe('Home: the Desk', () => {
  // These are the Three columns layout (Settings → Look → Desk layout); One at a time is in DeskPage.test.tsx.
  beforeEach(() => { localStorage.setItem('gc.desk.layout', 'columns'); });
  afterEach(() => { localStorage.removeItem('gc.desk.layout'); });
  it('queues every decision; j moves on, a allows a permission once, and a hard line is never one-key approved', async () => {
    const perms: Permission[] = [
      { ...permission('p1', 'beta'), createdAt: '2026-10-21T08:00:00Z' },
      { ...permission('p2', 'beta'), createdAt: '2026-10-21T10:00:00Z', plain: { headline: 'Push the branch' }, hardLine: { line: 'git-push', reason: 'Pushing is a hard line: it asks you before it runs.' } },
    ];
    const { post } = renderApp({ hash: '#/desk', permissions: perms });
    const queue = await screen.findByRole('navigation', { name: 'Waiting for your decision' });
    expect(within(queue).getAllByRole('button').map((b) => b.querySelector('.desk-item-what')?.textContent)).toEqual(['Run a command', 'Go-ahead on Plan', 'Push the branch']);
    // The count is in the top bar.
    expect(screen.getByRole('link', { name: 'Desk, 3 waiting for you' })).toHaveAttribute('href', '#/desk');
    fireEvent.keyDown(document.body, { key: 'a' });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/permissions/p1', expect.objectContaining({ decision: 'allow' })));
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(within(queue).getByRole('button', { current: true })).toHaveTextContent('Push the branch');
    expect(window.location.hash).toBe('#/desk'); // j moves in the queue, not to the next job
    expect(screen.getByText(/no one-key approve/)).toBeInTheDocument();
    post.mockClear();
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(post).not.toHaveBeenCalledWith('/api/permissions/p2', expect.anything());
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(window.location.hash).toBe('#/job/beta');
  });

  it('never sends the Foreman’s questions with one key, even with every answer recommended', async () => {
    const { post } = renderApp({ hash: '#/desk', jobs: [job('alpha', 'needs-you', { waitingFor: 'answers', waitingSince: '2026-10-21T09:00:00Z' })] });
    await screen.findByRole('navigation', { name: 'Waiting for your decision' });
    expect(screen.getByRole('button', { current: true })).toHaveTextContent('Answer the Foreman’s questions');
    fireEvent.keyDown(document.body, { key: 'a' });
    await new Promise((r) => setTimeout(r, 50));
    expect(post.mock.calls.filter(([p]) => String(p).includes('/gate'))).toEqual([]);
  });

  it('arrows move the queue only from inside it, a held key never repeats; keys off leaves the arrows and takes the hints', async () => {
    const perms: Permission[] = [
      { ...permission('p1', 'beta'), createdAt: '2026-10-21T08:00:00Z' },
      { ...permission('p2', 'beta'), createdAt: '2026-10-21T09:00:00Z', plain: { headline: 'Read a file' } },
      { ...permission('p3', 'beta'), createdAt: '2026-10-21T10:00:00Z', plain: { headline: 'Write a file' } },
    ];
    const { post } = renderApp({ hash: '#/desk', permissions: perms, jobs: [job('beta', 'running')] });
    const queue = await screen.findByRole('navigation', { name: 'Waiting for your decision' });
    const current = () => within(queue).getByRole('button', { current: true });
    const items = within(queue).getAllByRole('button');
    expect(current()).toHaveTextContent('Run a command');
    fireEvent.keyDown(document.body, { key: 'ArrowDown' }); // outside the queue: scrolls, nothing more
    expect(current()).toHaveTextContent('Run a command');
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(current()).toHaveTextContent('Read a file');
    fireEvent.keyDown(document.body, { key: 'j', repeat: true });
    expect(current()).toHaveTextContent('Read a file');
    expect(queue.querySelector('.desk-keys')).toHaveTextContent('j Next decision · k Previous decision · a Approve, or Allow once · d Deny a permission · o Open the job');
    expect(screen.getByRole('button', { name: 'Allow once' }).querySelector('kbd')).toHaveTextContent('a');
    expect(screen.getByRole('button', { name: 'Deny…' }).querySelector('kbd')).toHaveTextContent('d');
    expect(screen.getByRole('link', { name: 'Open the job' }).querySelector('kbd')).toHaveTextContent('o');

    act(() => writeKeysSetting({ enabled: false }));
    fireEvent.keyDown(document.body, { key: 'a' });
    await new Promise((r) => setTimeout(r, 20));
    expect(post).not.toHaveBeenCalledWith(expect.stringMatching(/permissions/), expect.anything());
    fireEvent.keyDown(items[1], { key: 'ArrowUp' });
    expect(current()).toHaveTextContent('Run a command');
    expect(queue.querySelector('.desk-keys')).toBeNull();
    expect(screen.getByRole('button', { name: 'Allow once' }).querySelector('kbd')).toBeNull();
  });

  it('says so when the desk is clear', async () => {
    renderApp({ hash: '#/desk', jobs: [job('beta', 'running')] });
    expect(await screen.findByRole('heading', { name: 'Desk clear' })).toBeInTheDocument();
  });
});

describe('Settings → Notifications', () => {
  it('shows how they reach macOS, saves each level and sends a test', async () => {
    const store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', settings: { policy: 'hands-off', notify: { enabled: true, levels: { needs: 'sound', problem: 'sound', done: 'silent' }, quiet: { on: false, from: '22:00', to: '07:00' }, skipWhenWatching: true } } as unknown as Settings } as never }) });
    const get = vi.fn(async () => ({ method: 'osascript', history: [{ at: '2026-10-21T10:00:00Z', level: 'needs', title: 'Job alpha', body: 'Go-ahead', slug: 'alpha', sent: false, why: 'Quiet hours.' }] }));
    const post = vi.fn(async (path: string, body: { notify?: unknown }) => (path === '/api/notifications/test' ? { sent: true } : { policy: 'hands-off', notify: { ...(body.notify as object) } }));
    render(<WorkshopContext.Provider value={{ store, api: { get, post } as unknown as ApiClient }}><NotifySettings /></WorkshopContext.Provider>);
    expect(await screen.findByText(/macOS’s built-in notifier: clicking one can’t open the job/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Done: how it reaches you' })).getByRole('radio', { name: 'Off' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/settings', { notify: { levels: { needs: 'sound', problem: 'sound', done: 'off' } } }));
    fireEvent.click(screen.getByRole('button', { name: 'Send a test' }));
    expect(await screen.findByText(/Sent: look at the top right/)).toBeInTheDocument();
    expect(screen.getByText(/not sent: Quiet hours\./)).toBeInTheDocument();
  });
});
