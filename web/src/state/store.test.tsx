import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ApiClient } from '../api/client';
import { createStore, useWorkshopPick, useWorkshopSelector, WorkshopContext } from './store';
import { ev, job, snapshot } from './test-fixtures';

function setup(children: React.ReactNode) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot() });
  const r = render(<WorkshopContext.Provider value={{ store, api: {} as ApiClient }}>{children}</WorkshopContext.Provider>);
  return { store, ...r };
}

describe('store: parts read only what they show (speed)', () => {
  it('a part reading the jobs does not draw again for an event or a snapshot that leaves them the same', () => {
    let draws = 0;
    function Count() { draws++; const { jobs } = useWorkshopPick('jobs'); return <span>{jobs.length}</span>; }
    const { store, container } = setup(<Count />);
    expect(container.textContent).toBe('2');
    const before = draws;
    act(() => { store.dispatch({ type: 'event', event: ev(11, 'change') }); });
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ seq: 12, generatedAt: '2026-10-15T12:00:09.000Z' }) }); });
    act(() => { store.dispatch({ type: 'connection', connection: 'reconnecting' }); });
    expect(draws).toBe(before);
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ seq: 13, jobs: [job('alpha', 'idle')] }) }); });
    expect(draws).toBe(before + 1);
    expect(container.textContent).toBe('1');
  });

  it('a selector draws again only when what it picks changes, and follows a new selector at once', () => {
    let draws = 0;
    function Title({ slug }: { slug: string }) {
      draws++;
      const title = useWorkshopSelector((s) => s.jobs.find((j) => j.slug === slug)?.title ?? '');
      return <span>{title}</span>;
    }
    const { store, container, rerender } = setup(<Title slug="alpha" />);
    expect(container.textContent).toBe('Job alpha');
    const before = draws;
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ seq: 11, jobs: [job('alpha', 'idle'), job('beta', 'running', { updatedAt: 'x' })] }) }); });
    expect(draws).toBe(before);
    rerender(<WorkshopContext.Provider value={{ store, api: {} as ApiClient }}><Title slug="beta" /></WorkshopContext.Provider>);
    expect(container.textContent).toBe('Job beta');
  });
});
