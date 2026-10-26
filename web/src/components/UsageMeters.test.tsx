// The top bar's usage meters (UsageMeters.tsx): the 5-hour and weekly limits in words, the warning
// at 80%, a failed read, and reading again on click. Invented numbers; no network.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { PlanUsage } from '../api/types';
import { createStore, WorkshopContext } from '../state/store';
import { resetsIn, UsageMeters } from './UsageMeters';

afterEach(cleanup);

const soon = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();
const USAGE: PlanUsage = { enabled: true, fiveHour: { percent: 4, resetsAt: soon(134) }, week: { percent: 57, resetsAt: soon(3000) }, checkedAt: new Date().toISOString(), error: null };

function setup(planUsage: PlanUsage | null, answer: PlanUsage = USAGE) {
  const store = createStore();
  if (planUsage) store.dispatch({ type: 'plan-usage', planUsage });
  const post = vi.fn(async () => answer);
  const api = { get: vi.fn(), post } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store, api }}><UsageMeters /></WorkshopContext.Provider>);
  return { post, store };
}

describe('UsageMeters', () => {
  it('nothing until the dashboard reads usage, or when it is off', () => {
    setup(null);
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    setup({ ...USAGE, enabled: false });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('both meters, each with its percent and reset in words', () => {
    setup(USAGE);
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('5h');
    expect(button).toHaveTextContent('4%');
    expect(button).toHaveTextContent('in 2h 14m');
    expect(button).toHaveTextContent('Week');
    expect(button).toHaveTextContent('57%');
    expect(button).toHaveTextContent('5-hour limit: 4% used');
  });

  it('80% or more warns with a sign, not only a colour', () => {
    setup({ ...USAGE, week: { percent: 86, resetsAt: soon(60) } });
    const week = document.querySelector('[data-meter="Week"]')!;
    expect(week).toHaveClass('is-warn');
    expect(week).toHaveTextContent('⚠ 86%');
  });

  it('a failed read with nothing yet says so; click reads again', async () => {
    const { post, store } = setup({ ...USAGE, fiveHour: null, week: null, error: 'Claude answered 500.' });
    expect(screen.getByRole('button')).toHaveTextContent('Usage unavailable');
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/usage/check', {}));
    await waitFor(() => expect(store.getState().planUsage?.week?.percent).toBe(57));
  });

  it('resetsIn', () => {
    const now = new Date('2026-10-26T12:00:00Z');
    expect(resetsIn('2026-10-26T12:09:10Z', now)).toBe('in 10m');
    expect(resetsIn('2026-10-26T14:00:00Z', now)).toBe('in 2h');
    expect(resetsIn('2026-10-26T11:00:00Z', now)).toBe('now');
    expect(resetsIn(null, now)).toBe('');
  });
});
