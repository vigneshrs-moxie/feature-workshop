// The line above the message box (talk any time): is it working, on what, for how long; and when no
// reply runs, the job's state in the payload's words. The time ticks only while a reply runs in view.
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { longJob } from '../fixtures/longJob';
import { createJobStore } from '../jobStore';
import type { JobPagePayload } from '../types';
import { JobStoreContext } from '../useJob';
import { elapsedWords, NowLine } from './NowLine';
import { sinceWords } from './YourMove';

const SLUG = longJob.payload.slug;
const payload = () => JSON.parse(JSON.stringify(longJob.payload)) as JobPagePayload;
const START = '2026-11-04T15:00:00.000Z';
const run = (status: string, lastAction: string | null = null) => ({ id: 'run-now', status, startedAt: START, lastAction });

function show(patch: Partial<JobPagePayload> | null): { app: Store } {
  const p = patch ? { ...payload(), ...patch } : null;
  const store = createJobStore(SLUG, { api: { page: vi.fn(), item: vi.fn() } as never, events: () => () => {}, viewer: () => null, initial: p as JobPagePayload });
  const app = createStore();
  const api = { get: vi.fn(), post: vi.fn(), hosted: () => false } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ api, store: app }}><JobStoreContext.Provider value={store}><NowLine /></JobStoreContext.Provider></WorkshopContext.Provider>);
  return { app };
}
const line = () => document.querySelector<HTMLElement>('.jp2-now')!;
const visibility = (v: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
};

afterEach(() => { vi.useRealTimers(); visibility('visible'); });

describe('the time a reply has run', () => {
  it('is short: seconds, minutes and seconds, hours and minutes', () => {
    expect(elapsedWords(12_000)).toBe('12s');
    expect(elapsedWords((4 * 60 + 12) * 1000)).toBe('4m 12s');
    expect(elapsedWords((63 * 60 + 5) * 1000)).toBe('1h 03m');
  });
});

describe('a reply running', () => {
  it('says Working, the time since it started (ticking each second) and what the Foreman is doing, with Stop', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(Date.parse(START) + (4 * 60 + 12) * 1000));
    show({ run: run('running', 'Running npm test') });
    expect(line()).toHaveTextContent('Working · 4m 12s · Running npm test');
    expect(line().querySelector('.jp2-now-act')).toHaveAttribute('title', 'Running npm test');
    expect(line().querySelector('.jp2-now-time')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(line()).toHaveTextContent('4m 15s');
  });

  it('reads the live run first: its last action replaces the payload’s', () => {
    const { app } = show({ run: run('running', 'Reading files') });
    act(() => { app.dispatch({ type: 'event', event: { v: 2, type: 'run', job: SLUG, seq: 999999, data: { id: 'run-now', slug: SLUG, status: 'running', startedAt: START, lastAction: 'Editing MessageBox.tsx' } } } as never); });
    expect(line()).toHaveTextContent('Editing MessageBox.tsx');
  });

  it('says Waiting for your permission', () => {
    show({ run: run('waiting_permission') });
    expect(line()).toHaveTextContent('Waiting for your permission');
  });

  it('says Stopping… while the reply stops', () => {
    show({ run: run('stopping') });
    expect(line()).toHaveTextContent('Stopping…');
  });

  it('runs no timer while the tab is hidden, and ticks again when it is back', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(Date.parse(START) + 12_000));
    visibility('hidden');
    show({ run: run('running') });
    expect(vi.getTimerCount()).toBe(0);
    visibility('visible');
    expect(vi.getTimerCount()).toBe(1);
    visibility('hidden');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('no reply running', () => {
  it('says the job’s state in the payload’s words, and runs no timer', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    show({ run: null, move: null, state: 'paused', stateLine: 'Paused by you' });
    expect(line()).toHaveTextContent(/^Paused · Paused by you$/);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('at a go-ahead it says since when it waits for him', () => {
    const p = payload();
    show({ run: null, state: 'needs-you' });
    const since = (p.move as { since: string | null }).since;
    expect(line()).toHaveTextContent(since ? `Waiting for you · since ${sinceWords(since)}` : /^Needs you/);
  });

  it('is empty, but there, before the payload arrives', () => {
    show(null);
    expect(line()).toBeInTheDocument();
    expect(line()).toHaveTextContent(/^$/);
  });
});
