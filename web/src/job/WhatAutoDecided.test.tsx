// What Auto decided: a button where Auto has run, and the panel it opens. Invented jobs only.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import type { AutoDecided } from '../api/types';
import { createStore, WorkshopContext } from '../state/store';
import { WhatAutoDecided, AUTO_EMPTY } from './WhatAutoDecided';

const DECIDED: AutoDecided = {
  on: true, stopped: null, tag: null,
  summary: ['2 steps approved for you.', '3 questions answered with the recommendation.', 'Nothing stopped it so far.'],
  entries: [
    { at: '2026-11-10T09:00:00Z', stage: 'Spec', chose: 'Approved the spec', asked: 'Approve the spec?', why: 'It matches the ticket.' },
    { at: '2026-11-10T11:00:00Z', stage: 'Plan', chose: 'Approved the plan', asked: 'Approve the plan?', why: 'Small and reversible.', risk: 'Touches one table', answers: [{ question: 'Keep the old column?', choice: 'Yes', reason: 'Recommended' }] },
  ],
};

function show(get: ReturnType<typeof vi.fn>, auto: { on: boolean; ran?: boolean } | undefined = { on: true, ran: true }) {
  const api = { get, post: vi.fn() } as unknown as ApiClient;
  return render(<WorkshopContext.Provider value={{ store: createStore(), api }}><WhatAutoDecided slug="alpha" auto={auto} /></WorkshopContext.Provider>);
}

describe('WhatAutoDecided', () => {
  it('is only there when Auto has run on the job', () => {
    show(vi.fn(), { on: false, ran: false });
    expect(screen.queryByRole('button', { name: 'What Auto decided' })).toBeNull();
  });

  it('What Auto decided shows the summary and entries newest first', async () => {
    const get = vi.fn(async () => DECIDED);
    show(get);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    expect(get).toHaveBeenCalledWith('/api/job/alpha/auto');
    const panel = screen.getByRole('dialog', { name: 'What Auto decided' });
    for (const l of DECIDED.summary) expect(within(panel).getByText(l)).toBeInTheDocument();
    const entries = within(panel).getAllByRole('listitem').filter((li) => li.classList.contains('auto-entry'));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent('Plan');
    expect(entries[0]).toHaveTextContent('Approved the plan');
    expect(entries[0]).toHaveTextContent('Approve the plan?');
    expect(entries[0]).toHaveTextContent('Small and reversible.');
    expect(entries[0]).toHaveTextContent('Touches one table');
    expect(entries[0]).toHaveTextContent('Keep the old column?');
    expect(entries[1]).toHaveTextContent('Spec');
  });

  it('says it has decided nothing yet when there are no entries', async () => {
    show(vi.fn(async () => ({ ...DECIDED, summary: ['', '', ''], entries: [] })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    expect(screen.getByText('Auto hasn\'t decided anything on this job yet.')).toBeInTheDocument();
    expect(AUTO_EMPTY).toBe('Auto hasn\'t decided anything on this job yet.');
  });

  it('a 404 or an error shows the empty line, not a crash', async () => {
    for (const err of [new ApiError(404, 'Not found'), new Error('boom')]) {
      const { unmount } = show(vi.fn(async () => { throw err; }));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
      expect(screen.getByText(AUTO_EMPTY)).toBeInTheDocument();
      unmount();
    }
  });

  it('closes with Escape', async () => {
    show(vi.fn(async () => DECIDED));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
