// "Branch (a guess)": shown only when the job answer says the branch is a guess; its button confirms the shown
// repository and branch as your choice (POST /api/job/:slug/repo) and the page reads the job again.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { JobDetail } from '../api/types';
import { createStore, WorkshopContext } from '../state/store';
import { BranchGuess, CONFIRM_LABEL } from './BranchGuess';

afterEach(() => { cleanup(); });

const detail = (locate: JobDetail['locate']): JobDetail => ({ slug: 'orbit-463-x', thread: [], threadMore: false, repoPath: '/Users/me/Projects/moxie-portal', branch: locate?.branch ?? null, locate });

function setup(d: JobDetail | null, { hosted = false, post = vi.fn(async () => ({ ok: true })) } = {}) {
  const api = { get: vi.fn(), post, hosted: () => hosted } as unknown as ApiClient;
  const onConfirmed = vi.fn();
  render(<WorkshopContext.Provider value={{ store: createStore(), api }}><BranchGuess slug="orbit-463-x" detail={d} onConfirmed={onConfirmed} /></WorkshopContext.Provider>);
  return { post, onConfirmed };
}

describe('BranchGuess', () => {
  it('shows the guessed branch and the button only on a guess', () => {
    setup(detail({ branch: 'feature/orbit-470-talent-hide-before-hire', branchGuessed: true, branchSource: 'workflow-status.md' }));
    expect(screen.getByText('Branch (a guess):')).toBeInTheDocument();
    expect(screen.getByText('feature/orbit-470-talent-hide-before-hire')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: CONFIRM_LABEL })).toBeInTheDocument();
  });
  it('shows nothing when the branch is recorded, or there is none, or the answer has not come', () => {
    for (const d of [detail({ branch: 'feature/orbit-463-x', branchGuessed: false, branchSource: 'status.json' }), detail({ branch: null, branchGuessed: false }), detail(null), null]) {
      const { unmount } = render(<WorkshopContext.Provider value={{ store: createStore(), api: { post: vi.fn() } as unknown as ApiClient }}><BranchGuess slug="s" detail={d} /></WorkshopContext.Provider>);
      expect(screen.queryByText('Branch (a guess):')).toBeNull();
      expect(screen.queryByRole('button', { name: CONFIRM_LABEL })).toBeNull();
      unmount();
    }
  });
  it('pressing it posts the shown repository and branch as your choice, then the page reads the job again', async () => {
    const { post, onConfirmed } = setup(detail({ branch: 'feature/orbit-463-score-count', branchGuessed: true }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: CONFIRM_LABEL })); });
    expect(post).toHaveBeenCalledWith('/api/job/orbit-463-x/repo', { repoPath: '/Users/me/Projects/moxie-portal', branch: 'feature/orbit-463-score-count' });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });
  it('says so when the laptop refused it', async () => {
    const { onConfirmed } = setup(detail({ branch: 'feature/x', branchGuessed: true }), { post: vi.fn(async () => { throw new Error('That doesn’t look like a branch name.'); }) });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: CONFIRM_LABEL })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved: That doesn’t look like a branch name.');
    expect(onConfirmed).not.toHaveBeenCalled();
  });
  it('on the website: the words, without the button (choosing a repository is the laptop page’s)', () => {
    setup(detail({ branch: 'feature/x', branchGuessed: true }), { hosted: true });
    expect(screen.getByText('Branch (a guess):')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: CONFIRM_LABEL })).toBeNull();
  });
});
