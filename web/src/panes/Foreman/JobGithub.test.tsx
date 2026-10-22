// GitHub on the open job (JobGithub.tsx): Check GitHub at the PR stages, and the "merged: tell the
// Foreman?" nudge with its Yes. Invented jobs and PRs only; no model calls.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Job, Nudge } from '../../api/types';
import { createStore, WorkshopContext } from '../../state/store';
import { job } from '../../state/test-fixtures';
import { JobGithub } from './JobGithub';

const MERGED: Nudge = {
  id: 'pr1-merged', kind: 'ask', title: 'PR #1 is merged: tell the Foreman?', text: 'GitHub has PR #1 (#141) merged, but the Foreman hasn’t seen it yet.',
  link: 'https://github.com/acme/portal/pull/141', action: { send: 'PR #1 (#141) is already merged on GitHub.' }, afterLine: false,
};

function setup(j: Job) {
  const post = vi.fn(async () => ({ ok: true }));
  const api = { get: vi.fn(), post } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store: createStore(), api }}><JobGithub job={j} /></WorkshopContext.Provider>);
  return post;
}

describe('JobGithub', () => {
  it('nothing before the PR stages when no hand-off waits', () => {
    setup({ ...job('a', 'needs-you'), stage: 'review', nudges: [] });
    expect(screen.queryByRole('region', { name: 'GitHub' })).toBeNull();
  });

  it('Check GitHub reads the PRs now, read-only', async () => {
    const post = setup({ ...job('a', 'needs-you'), stage: 'pr1', nudges: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Check GitHub' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/flow/refresh', {}));
    expect(await screen.findByRole('status')).toHaveTextContent('Asked GitHub');
  });

  it('merged on GitHub: Yes tells the Foreman, and the item goes', async () => {
    const post = setup({ ...job('a', 'needs-you'), stage: 'pr1', nudges: [MERGED] });
    expect(screen.getByText('PR #1 is merged: tell the Foreman?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute('href', MERGED.link);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, tell the Foreman' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/a/nudge/pr1-merged/yes', {}));
    await waitFor(() => expect(screen.queryByText('PR #1 is merged: tell the Foreman?')).toBeNull());
  });
});
