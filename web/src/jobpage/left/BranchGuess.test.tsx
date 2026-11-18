// "This is the job's branch" on the job page (left/BranchGuess.tsx).
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { createStore, WorkshopContext } from '../../state/store';
import { longJob } from '../fixtures/longJob';
import { createJobStore } from '../jobStore';
import type { JobPagePayload } from '../types';
import { JobStoreContext } from '../useJob';
import { BranchGuess, CONFIRM_LABEL } from './BranchGuess';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function mount(guess: { branch: string; repoPath: string | null } | null, post = vi.fn(async (): Promise<unknown> => ({ ok: true }))) {
  const p = clone(longJob.payload) as unknown as JobPagePayload;
  p.local = { dir: '/f', worktree: null, policyOverride: null, started: true, guess };
  const page = vi.fn(async () => ({ same: true as const, v: p.v }));
  const store = createJobStore(p.slug, { api: { page, item: vi.fn() } as never, events: () => () => {}, viewer: () => null, initial: p });
  const api = { get: vi.fn(), post } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ api, store: createStore() }}><JobStoreContext.Provider value={store}><BranchGuess /></JobStoreContext.Provider></WorkshopContext.Provider>);
  return { post, page, slug: p.slug };
}

describe('BranchGuess', () => {
  it('names the guessed branch and its repository; the button confirms both and reads the job again', async () => {
    const m = mount({ branch: 'create-thing', repoPath: '/repos/widgets' });
    expect(screen.getByRole('group', { name: 'The job’s branch' })).toHaveTextContent('Branch (a guess): create-thing in widgets');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: CONFIRM_LABEL })); });
    expect(m.post).toHaveBeenCalledWith(`/api/job/${encodeURIComponent(m.slug)}/repo`, { repoPath: '/repos/widgets', branch: 'create-thing' });
    expect(m.page).toHaveBeenCalled();
  });

  it('a refusal says why in place', async () => {
    mount({ branch: 'x', repoPath: '/r' }, vi.fn(async () => { throw new Error('Starbase answered 409.'); }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: CONFIRM_LABEL })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved: Starbase answered 409.');
  });

  it('a known branch shows nothing', () => {
    const { container } = render(<div />);
    mount(null);
    expect(screen.queryByRole('group', { name: 'The job’s branch' })).toBeNull();
    expect(container).toBeTruthy();
  });
});
