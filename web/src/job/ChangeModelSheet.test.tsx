import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import type { JobDetail } from '../api/types';
import { createStore, WorkshopContext, type Store } from '../state/store';
import { job, snapshot } from '../state/test-fixtures';
import { pickOption } from '../components/Select.testing';
import { ChangeModelSheet, PR_REASON } from './ChangeModelSheet';

// Invented job only.
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'Everyday.' },
  { id: 'claude-fable-5-2', label: 'Fable 5.2', note: 'Best judgment.' },
];
const DETAIL: JobDetail = { slug: 'alpha', thread: [], threadMore: false, drive: { mode: 'workshop', model: 'claude-opus-5-5', sessionId: 's1' }, prs: [{ number: 1, state: 'not_started', url: null }] };

function setup({ detail = DETAIL, post = vi.fn(async () => ({ ok: true, slug: 'alpha', archive: '/f/.restarted/alpha-2026-11-10', backupBranch: 'backup/feat/alpha-2026-11-10', worktreeAside: '/w/alpha.2026-11-10' })) }: { detail?: JobDetail; post?: ReturnType<typeof vi.fn> } = {}) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', models: MODELS }, jobs: [job('alpha', 'idle')] }) });
  const api = { get: vi.fn(async () => detail), post } as unknown as ApiClient;
  const onClose = vi.fn();
  render(<WorkshopContext.Provider value={{ store, api }}><ChangeModelSheet slug="alpha" onClose={onClose} /></WorkshopContext.Provider>);
  return { post, onClose };
}
afterEach(() => { localStorage.clear(); });

describe('Change model sheet', () => {
  it('Change model… explains the restart and needs the job’s name', async () => {
    const { post } = setup();
    expect(await screen.findByRole('dialog', { name: 'Change the Foreman model' })).toBeInTheDocument();
    for (const line of [
      'The job starts again from step one on the new model.',
      'Its spec, plan, briefs and decisions so far leave the job. They are kept in an archive folder.',
      'Its code so far leaves the job. The commits are kept on a backup branch, and the job gets a fresh branch.',
      'The time and usage already spent are not recovered.',
    ]) expect(screen.getByText(line)).toBeInTheDocument();
    // What else moves is said too: uncommitted changes, the session record, and that nothing is deleted.
    expect(screen.getByText(/Changes not yet committed stay in the old worktree folder/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is deleted and nothing is pushed/)).toBeInTheDocument();
    // Files git ignores, what is not carried over, and what happens to a waiting reply, said as the code does them.
    expect(screen.getByText('Files git ignores, such as .env and node_modules, stay in that old folder too. They are not in the job\'s new worktree.')).toBeInTheDocument();
    expect(screen.getByText(/except Auto, which starts off again\. The job's own permission setting is not kept either\./)).toBeInTheDocument();
    expect(screen.getByText('A reply waiting to be sent, or a carry-on waiting for the usage limit, is not sent. A copy goes in the archive folder.')).toBeInTheDocument();
    expect(screen.getByText(/If something goes wrong before the new job starts, everything is put back/)).toBeInTheDocument();
    // Before anything moves, Starbase asks GitHub; and a link to a past conversation is not carried over.
    expect(screen.getByText(/first checks GitHub, and won't restart a job whose branch is already there\./)).toBeInTheDocument();
    expect(screen.getByText('A link to a past conversation the job was started from is not carried over.')).toBeInTheDocument();
    // The picker starts on a model other than the current one; the button names it and waits for the name.
    const button = screen.getByRole('button', { name: 'Start the job again on Fable 5.2' });
    expect(button).toBeDisabled();
    const name = screen.getByRole('textbox', { name: /Type the job's name to confirm/ });
    fireEvent.change(name, { target: { value: 'alph' } });
    expect(button).toBeDisabled();
    fireEvent.change(name, { target: { value: 'alpha' } });
    expect(button).toBeEnabled();
    await act(async () => { fireEvent.click(button); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/restart', { model: 'claude-fable-5-2' });
    // Afterwards it says where the old work is.
    expect(await screen.findByText('/f/.restarted/alpha-2026-11-10')).toBeInTheDocument();
    expect(screen.getByText('backup/feat/alpha-2026-11-10')).toBeInTheDocument();
    expect(screen.getByText('/w/alpha.2026-11-10')).toBeInTheDocument();
  });

  // m5: the focus is inside the sheet once it has loaded, not left on the page behind.
  it('opens with the focus in the sheet: on the name box once the job is loaded', async () => {
    setup();
    const name = await screen.findByRole('textbox', { name: /Type the job's name to confirm/ });
    await waitFor(() => expect(name).toHaveFocus());
  });

  it('with an open pull request the focus is on Close', async () => {
    setup({ detail: { ...DETAIL, prs: [{ number: 1, state: 'open', url: 'https://github.com/x/y/pull/1' }] } });
    await screen.findByText(PR_REASON);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus());
  });

  it('after the restart it passes on what Starbase says it could not check', async () => {
    const post = vi.fn(async () => ({ ok: true, slug: 'alpha', archive: '/f/.restarted/alpha-2026-11-10', backupBranch: null, worktreeAside: null, notes: ['Whether the branch feature/alpha had already been pushed could not be checked (no remote could be reached).'] }));
    setup({ post });
    await screen.findByRole('dialog', { name: 'Change the Foreman model' });
    fireEvent.change(screen.getByRole('textbox', { name: /Type the job's name/ }), { target: { value: 'alpha' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Start the job again/ })); });
    expect(await screen.findByText(/could not be checked/)).toBeInTheDocument();
  });

  it('the button follows the model picked, and the current model can’t be chosen again', async () => {
    setup({ detail: { ...DETAIL, drive: { mode: 'workshop', model: 'claude-fable-5-2' } } });
    await screen.findByRole('dialog', { name: 'Change the Foreman model' });
    fireEvent.change(screen.getByRole('textbox', { name: /Type the job's name/ }), { target: { value: 'alpha' } });
    expect(screen.getByRole('button', { name: 'Start the job again on Opus 5.5' })).toBeEnabled();
    pickOption(screen.getByRole('combobox'), 'claude-fable-5-2');
    expect(screen.getByRole('button', { name: 'Start the job again on Fable 5.2' })).toBeDisabled();
  });

  it('an open pull request shows only the reason', async () => {
    setup({ detail: { ...DETAIL, prs: [{ number: 1, state: 'open', url: 'https://github.com/x/y/pull/1' }] } });
    expect(await screen.findByText(PR_REASON)).toBeInTheDocument();
    expect(PR_REASON).toBe('This job has an open pull request, so its model can\'t change: reviewed work would be thrown away. Close the pull request, or start a new job.');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/starts again from step one/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Start the job again/ })).toBeNull();
  });

  it('a reply in progress says to stop it first and the button stays off', async () => {
    setup({ detail: { ...DETAIL, run: { id: 'r1', slug: 'alpha', status: 'running' } } });
    expect(await screen.findByText('Stop the reply first.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /Type the job's name/ }), { target: { value: 'alpha' } });
    expect(screen.getByRole('button', { name: /Start the job again/ })).toBeDisabled();
  });

  it('shows the dashboard’s refusal and moves nothing on', async () => {
    const post = vi.fn(async () => { throw new ApiError(409, 'Stop the reply first.'); });
    setup({ post });
    await screen.findByRole('dialog', { name: 'Change the Foreman model' });
    fireEvent.change(screen.getByRole('textbox', { name: /Type the job's name/ }), { target: { value: 'alpha' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Start the job again/ })); });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Stop the reply first.'));
    expect(screen.queryByText(/The job started again/)).toBeNull();
  });
});
