// The Decisions tab: the job's log in words, newest first, and an empty state.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { createStore, WorkshopContext } from '../../state/store';
import { DecisionsTab } from './DecisionsTab';

afterEach(cleanup);

function setup(decisions: unknown[]) {
  const get = vi.fn(async () => ({ decisions }));
  const api = { get, post: vi.fn() } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store: createStore(), api }}><DecisionsTab slug="alpha" active /></WorkshopContext.Provider>);
  return get;
}

describe('DecisionsTab', () => {
  it('lists each decision with its note', async () => {
    const get = setup([{ at: '2026-10-26T10:05:00Z', kind: 'changes', text: 'Sent back brief 3 for changes', note: 'Keep the old column.' }, { at: '2026-10-26T10:00:00Z', kind: 'approve', text: 'Approved brief 2' }]);
    expect(await screen.findByText('Sent back brief 3 for changes')).toBeInTheDocument();
    expect(screen.getByText('“Keep the old column.”')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.dataset.kind)).toEqual(['changes', 'approve']);
    expect(get).toHaveBeenCalledWith('/api/job/alpha/decisions');
  });
  it('says when there are none', async () => {
    setup([]);
    expect(await screen.findByText(/No decisions yet/)).toBeInTheDocument();
  });
});
