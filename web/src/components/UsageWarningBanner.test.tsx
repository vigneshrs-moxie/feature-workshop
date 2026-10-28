// The usage warning banner (UsageWarningBanner.tsx): the dashboard's 80 %, 90 % and full warnings in
// words, dismissed one at a time, and the next threshold shows again. Invented numbers; no network.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { PlanUsage } from '../api/types';
import { createStore, WorkshopContext } from '../state/store';
import { DISMISSED_KEY, type UsageWarning, UsageWarningBanner } from './UsageWarningBanner';

afterEach(cleanup);
beforeEach(() => { try { localStorage.removeItem(DISMISSED_KEY); } catch { /* storage off */ } });

const RESET = '2026-10-29T13:00:00.000Z';
const warn = (threshold: 80 | 90 | 100, percent: number, meter: UsageWarning['meter'] = 'week'): UsageWarning => ({
  id: `${meter}:${threshold}:${RESET}`, meter, threshold, percent, resetsAt: RESET,
  text: threshold === 100 ? 'Weekly Claude usage is full (100 %). It resets Thursday 14:00.' : `${meter === 'week' ? 'Weekly' : 'Five-hour'} Claude usage is at ${percent} %. It resets Thursday 14:00.`,
});
const usage = (warnings: UsageWarning[], extra: Partial<PlanUsage> = {}) => ({
  enabled: true, fiveHour: { percent: 10, resetsAt: RESET }, week: { percent: 82, resetsAt: RESET }, checkedAt: new Date().toISOString(), error: null, warnings, ...extra,
}) as PlanUsage;

function setup(planUsage: PlanUsage | null) {
  const store = createStore();
  if (planUsage) store.dispatch({ type: 'plan-usage', planUsage });
  const api = { get: vi.fn(), post: vi.fn() } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><UsageWarningBanner /></WorkshopContext.Provider>);
  return { ...utils, store };
}

describe('UsageWarningBanner', () => {
  it('shows nothing under 80 %, with usage off, or before the first read', () => {
    expect(setup(null).container).toBeEmptyDOMElement();
    cleanup();
    expect(setup(usage([])).container).toBeEmptyDOMElement();
    cleanup();
    expect(setup(usage([warn(80, 82)], { enabled: false })).container).toBeEmptyDOMElement();
  });

  it('says the warning in words, not by colour alone', () => {
    setup(usage([warn(80, 82)]));
    const banner = screen.getByRole('status', { name: 'Usage warning' });
    expect(banner).toHaveTextContent('Usage warning: Weekly Claude usage is at 82 %. It resets Thursday 14:00.');
    expect(banner).toHaveAttribute('data-threshold', '80');
  });

  it('full says so', () => {
    setup(usage([warn(100, 100)]));
    expect(screen.getByRole('status', { name: 'Usage warning' })).toHaveTextContent('Usage full: Weekly Claude usage is full (100 %).');
  });

  it('dismisses one warning at a time, and the next threshold shows again', () => {
    const { store } = setup(usage([warn(80, 82), warn(90, 91, 'fiveHour')]));
    expect(screen.getAllByRole('status', { name: 'Usage warning' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]);
    const left = screen.getAllByRole('status', { name: 'Usage warning' });
    expect(left).toHaveLength(1);
    expect(left[0]).toHaveTextContent('Five-hour Claude usage is at 91 %.');
    // The same weekly warning on the next read stays hidden; 90 % is a new one and shows.
    act(() => { store.dispatch({ type: 'plan-usage', planUsage: usage([warn(80, 85)]) }); });
    expect(screen.queryByRole('status', { name: 'Usage warning' })).toBeNull();
    act(() => { store.dispatch({ type: 'plan-usage', planUsage: usage([warn(90, 90)]) }); });
    expect(screen.getByRole('status', { name: 'Usage warning' })).toHaveTextContent('Weekly Claude usage is at 90 %.');
  });
});
