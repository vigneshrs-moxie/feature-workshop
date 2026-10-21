import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { FlowView, Job, Permission, Settings } from '../api/types';
import { App } from '../app/App';
import type { EventSourceLike } from '../state/live';
import { createStore, WorkshopContext } from '../state/store';
import { ev, job, permission, snapshot } from '../state/test-fixtures';
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

describe('Home: the flow map', () => {
  it('is the landing page: full width, one lane per job with where its work is, its counts and its PRs', async () => {
    const { get } = renderApp();
    const map = await screen.findByRole('list', { name: 'Jobs in moxie-portal' });
    expect(get).toHaveBeenCalledWith('/api/flow');
    expect(screen.queryByRole('navigation', { name: 'Jobs' })).toBeNull();
    const alpha = within(map).getByRole('listitem', { name: 'Job alpha: On your fork' });
    expect(within(alpha).getByRole('link', { name: 'Job alpha' })).toHaveAttribute('href', '#/job/alpha');
    expect(within(alpha).getByText('main ↑10 ↓2')).toHaveAttribute('title', expect.stringMatching(/2 commits behind it/));
    expect(within(alpha).getByText('1 not pushed')).toBeInTheDocument();
    expect(within(alpha).getByText('3 uncommitted')).toBeInTheDocument();
    const pr1 = within(alpha).getByRole('link', { name: /PR #1 #141 open · checks failing/ });
    expect(pr1).toHaveAttribute('href', 'https://github.com/Moxie/moxie-portal/pull/141');
    expect(pr1).toHaveAttribute('target', '_blank');
    expect(within(map).getByRole('listitem', { name: 'Job beta: In staging' })).toBeInTheDocument();
    expect(screen.getByText('102 commits waiting for release')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Release #158 open/ })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Jobs in staging' })).getByRole('link', { name: 'Job beta' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'The Foreman' })).toBeInTheDocument();
  });

  it('Refresh asks the dashboard to read the branches and PRs now; a flow event updates the map', async () => {
    const { post, streams } = renderApp();
    await screen.findByRole('list', { name: 'Jobs in moxie-portal' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/flow/refresh', {}));
    expect(await screen.findByText('Reading branches and PRs…')).toBeInTheDocument();
    const moved: FlowView = { ...FLOW, refreshing: false, repos: [{ ...FLOW.repos[0], lanes: [{ ...FLOW.repos[0].lanes[0], position: 'org', reached: 2 }] }] };
    act(() => { streams[0].onmessage?.(new MessageEvent('message', { data: JSON.stringify(ev(11, 'flow', null, moved)) })); });
    expect(screen.getByRole('listitem', { name: 'Job alpha: On the moxie branch' })).toBeInTheDocument();
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
    expect(within(table).getByText('In staging')).toBeInTheDocument();
  });
});

describe('Home: the Desk', () => {
  it('queues every decision; j moves on, a allows a permission once, and a hard line is never one-key approved', async () => {
    const perms: Permission[] = [
      { ...permission('p1', 'beta'), createdAt: '2026-10-21T08:00:00Z' },
      { ...permission('p2', 'beta'), createdAt: '2026-10-21T10:00:00Z', plain: { headline: 'Push the branch' }, hardLine: { line: 'git-push', reason: 'Pushing is a hard line: it asks you before it runs.' } },
    ];
    const { post } = renderApp({ hash: '#/desk', permissions: perms });
    const queue = await screen.findByRole('navigation', { name: 'Waiting for your decision' });
    expect(within(queue).getAllByRole('button').map((b) => b.querySelector('.desk-item-what')?.textContent)).toEqual(['Run a command', 'Go-ahead on Plan', 'Push the branch']);
    expect(screen.getByRole('link', { name: /Desk 3/ })).toHaveAttribute('href', '#/desk');
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
