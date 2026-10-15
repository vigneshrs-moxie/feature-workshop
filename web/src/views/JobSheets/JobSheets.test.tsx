import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { HistoryList, Job } from '../../api/types';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { CloseJobSheet } from './CloseJobSheet';
import { LAST_REPO_KEY, NewJobSheet } from './NewJobSheet';

// Invented repositories, jobs and conversations only.
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'Everyday.' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', note: 'Best judgment.' },
];
const REPOS = [
  { path: '/tmp/fw-test/sample-one', name: 'sample-one', lastUsed: null },
  { path: '/tmp/fw-test/sample-two', name: 'sample-two', lastUsed: null },
];
const HISTORY: HistoryList = {
  rows: [
    { id: '11111111-1111-4111-8111-111111111111', title: 'Sketch the export button', repo: '/tmp/fw-test/sample-three', messages: 4, lastAt: null, contextTokens: 42000 },
    { id: '22222222-2222-4222-8222-222222222222', title: 'Loose notes outside a repo', repo: null, cwd: '/tmp/fw-test/notes', messages: 2, lastAt: null },
  ],
  matched: 2, total: 2, canContinue: true,
};

function setup({ get, post = vi.fn(async () => ({ slug: 'sketch-the-export-button' })), jobs = [job('alpha', 'idle')] }: {
  get?: ReturnType<typeof vi.fn>; post?: ReturnType<typeof vi.fn>; jobs?: Job[];
} = {}) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', models: MODELS }, jobs }) });
  const getFn = get ?? vi.fn(async (path: string) => {
    if (path === '/api/repos') return { repos: REPOS };
    if (path.startsWith('/api/history')) return HISTORY;
    throw new ApiError(404, 'Not found');
  });
  const api = { get: getFn, post } as unknown as ApiClient;
  const onClose = vi.fn();
  const wrap = (ui: ReactNode) => render(<WorkshopContext.Provider value={{ store, api }}>{ui}</WorkshopContext.Provider>);
  return { store, get: getFn, post, onClose, wrap };
}

beforeEach(() => { window.location.hash = ''; });
afterEach(() => { localStorage.clear(); window.location.hash = ''; });

describe('NewJobSheet', () => {
  it('starts a job with the description, repository, kind and model you picked, then opens it', async () => {
    localStorage.setItem(LAST_REPO_KEY, '/tmp/fw-test/sample-two');
    const { post, onClose, wrap } = setup();
    wrap(<NewJobSheet onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Start a new job' });
    const repo = within(dialog).getByRole('combobox', { name: 'Repository' });
    await waitFor(() => expect(repo).toHaveValue('/tmp/fw-test/sample-two')); // the one you used last
    expect(within(dialog).getByRole('textbox', { name: /What should the crew build/ })).toHaveFocus();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /What should the crew build/ }), { target: { value: '  Add a sample export button  ' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Bug fix' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: /Fable 5.1/ }));
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Start job' })); });
    expect(post).toHaveBeenCalledWith('/api/jobs', {
      description: 'Add a sample export button', kind: 'bug', repoPath: '/tmp/fw-test/sample-two', model: 'claude-fable-5-1', options: {}, fromSession: undefined,
    });
    expect(onClose).toHaveBeenCalled();
    expect(window.location.hash).toBe('#/job/sketch-the-export-button');
    expect(localStorage.getItem(LAST_REPO_KEY)).toBe('/tmp/fw-test/sample-two');
  });

  it('takes any folder path, and shows the dashboard’s answer when it refuses', async () => {
    const post = vi.fn(async () => { throw new ApiError(400, 'That folder isn’t a git repository.'); });
    const { onClose, wrap } = setup({ post });
    wrap(<NewJobSheet onClose={onClose} />);
    const repo = screen.getByRole('combobox', { name: 'Repository' });
    await waitFor(() => expect(repo).toHaveValue('/tmp/fw-test/sample-one'));
    fireEvent.change(repo, { target: { value: '__other' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Folder path' }), { target: { value: '/tmp/fw-test/not-a-repo' } });
    fireEvent.change(screen.getByRole('textbox', { name: /What should the crew build/ }), { target: { value: 'Something small' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start job' })); });
    expect(post).toHaveBeenCalledWith('/api/jobs', expect.objectContaining({ repoPath: '/tmp/fw-test/not-a-repo', model: 'claude-opus-5-5', kind: 'feature' }));
    expect(screen.getByRole('alert')).toHaveTextContent('That folder isn’t a git repository.');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start job' })).toBeEnabled();
  });

  it('asks for a description before sending anything', async () => {
    const { post, onClose, wrap } = setup();
    wrap(<NewJobSheet onClose={onClose} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start job' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Describe the job in a few words.');
    expect(post).not.toHaveBeenCalled();
  });

  it('starts from a past conversation found by search: a summary by default, or continued', async () => {
    const { get, post, onClose, wrap } = setup();
    wrap(<NewJobSheet onClose={onClose} />);
    fireEvent.click(screen.getByText('Start from a past conversation (optional)'));
    await screen.findByRole('list', { name: 'Past conversations' });
    expect(get).toHaveBeenCalledWith('/api/history?q=');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'export' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/history?q=export'));
    fireEvent.click(await screen.findByRole('button', { name: 'Use “Sketch the export button”' }));
    // Its title becomes the description and its repository is picked (added to the list).
    expect(screen.getByRole('textbox', { name: /What should the crew build/ })).toHaveValue('Sketch the export button');
    expect(screen.getByRole('combobox', { name: 'Repository' })).toHaveValue('/tmp/fw-test/sample-three');
    expect(screen.getByRole('radio', { name: /Fresh Foreman with a summary/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Continue that conversation/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start job' })); });
    expect(post).toHaveBeenCalledWith('/api/jobs', expect.objectContaining({
      repoPath: '/tmp/fw-test/sample-three',
      fromSession: { id: '11111111-1111-4111-8111-111111111111', mode: 'continue' },
    }));
  });

  it('can’t continue a conversation that ran outside a repository', async () => {
    const { onClose, wrap } = setup();
    wrap(<NewJobSheet onClose={onClose} />);
    fireEvent.click(screen.getByText('Start from a past conversation (optional)'));
    fireEvent.click(await screen.findByRole('button', { name: 'Use “Loose notes outside a repo”' }));
    expect(screen.getByRole('radio', { name: /Continue that conversation/ })).toBeDisabled();
    expect(screen.getByText(/isn’t a git repository/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Repository' })).toHaveValue('__other');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByRole('radio', { name: /Continue that conversation/ })).toBeNull();
  });

  it('closes on Esc', () => {
    const { onClose, wrap } = setup();
    wrap(<NewJobSheet onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('CloseJobSheet', () => {
  it('marks the job dropped with your note, removing its worktree when you tick it', async () => {
    const post = vi.fn(async () => ({ ok: true, closed: { as: 'dropped', at: '2026-10-15T12:00:00.000Z' } }));
    const { onClose, wrap } = setup({ post });
    wrap(<CloseJobSheet slug="alpha" worktree="/tmp/fw-test/worktrees/alpha" onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Mark “Job alpha” as done' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Done/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Dropped/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /Note/ }), { target: { value: ' Replaced by another job ' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Also remove its worktree/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark it' })); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/close', { as: 'dropped', note: 'Replaced by another job', removeWorktree: true });
    expect(onClose).toHaveBeenCalled();
  });

  it('offers no worktree removal for a job without one, and keeps the sheet open on a refusal', async () => {
    const post = vi.fn(async () => { throw new ApiError(409, 'The Foreman is working on a reply. Pause it first, then mark the job.'); });
    const { onClose, wrap } = setup({ post });
    wrap(<CloseJobSheet slug="alpha" worktree={null} onClose={onClose} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark it' })); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/close', { as: 'done', note: '', removeWorktree: false });
    expect(screen.getByRole('alert')).toHaveTextContent('The Foreman is working on a reply');
    expect(onClose).not.toHaveBeenCalled();
  });
});
