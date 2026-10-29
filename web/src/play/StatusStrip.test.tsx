// The status strip (packet M): Play full only; the lanes in words and numbers, the time here and in
// UTC, the week's usage when it is read. Invented jobs only.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '../api/client';
import { createStore, WorkshopContext } from '../state/store';
import { job, snapshot } from '../state/test-fixtures';
import { StatusStrip } from './StatusStrip';

function setup(play: 'full' | 'subtle' | 'off', planUsage?: unknown) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({
    jobs: [job('a', 'running', { lane: 'working' }), job('b', 'running', { lane: 'working' }), job('c', 'needs-you', { lane: 'needs-you' }), job('d', 'idle', { lane: 'ready' })],
    planUsage, meta: { token: 't', settings: { play: { mode: play } } },
  } as never) });
  return render(<WorkshopContext.Provider value={{ store, api: {} as ApiClient }}><StatusStrip /></WorkshopContext.Provider>);
}

afterEach(cleanup);

describe('the status strip', () => {
  it('in Play full: each lane in words with its count, the time here and in UTC', () => {
    setup('full', { enabled: true, fiveHour: null, week: { percent: 61.6, resetsAt: null }, checkedAt: null, error: null });
    const strip = screen.getByRole('status', { name: 'The board at a glance' });
    expect(strip).toHaveTextContent('Working 2');
    expect(strip).toHaveTextContent('Needs you 1');
    expect(strip).toHaveTextContent('In review 0');
    expect(strip).toHaveTextContent('Ready to merge 1');
    expect(strip).toHaveTextContent(/\d\d:\d\d local/);
    expect(strip).toHaveTextContent(/\d\d:\d\d UTC/);
    expect(strip).toHaveTextContent('Week gauge 62%');
  });

  it('not in subtle or off, and no week gauge when usage isn’t read', () => {
    setup('subtle');
    expect(screen.queryByRole('status', { name: 'The board at a glance' })).toBeNull();
    cleanup();
    setup('off');
    expect(screen.queryByRole('status', { name: 'The board at a glance' })).toBeNull();
    cleanup();
    setup('full');
    expect(screen.getByRole('status', { name: 'The board at a glance' })).not.toHaveTextContent('Week gauge');
  });
});
