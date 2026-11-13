// useJob(selector): a component redraws only when the part it reads changed (plan "Speed rules" 5).
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LiveEvent } from '../api/types';
import { longJob } from './fixtures/longJob';
import type { JobApi } from './api';
import { createJobStore, type JobPageState, type JobStore } from './jobStore';
import type { JobPagePayload } from './types';
import { JobStoreContext, useJob, useJobStore } from './useJob';

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const base = () => clone(longJob.payload) as unknown as JobPagePayload;

function setup() {
  let current = base();
  const pages: Array<number | null> = [];
  const api: JobApi = {
    page: async (_slug, v) => { pages.push(v); return v === current.v ? { same: true, v } : clone(current); },
    item: async () => { throw new Error('no bodies here'); },
  };
  let send: (e: LiveEvent) => void = () => {};
  const store = createJobStore(SLUG, { api, events: (fn) => { send = fn; return () => {}; } });
  return { store, pages, set: (p: JobPagePayload) => { current = p; }, send: (v: number) => send({ v: 2, type: 'job-page', job: SLUG, data: { slug: SLUG, v }, seq: v }) };
}

const renders: Record<string, number> = {};
function Reads<T>({ name, pick }: { name: string; pick: (s: JobPageState) => T }) {
  const value = useJob(pick);
  renders[name] = (renders[name] ?? 0) + 1;
  return <span data-testid={name}>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>;
}
const title = (s: JobPageState) => s.payload?.title ?? '';
const draft = (s: JobPageState) => s.ui.draft;
const review = (s: JobPageState) => s.payload?.steps[5] ?? null;
const spec = (s: JobPageState) => s.payload?.steps[0] ?? null;
const facts = (s: JobPageState) => s.payload?.facts ?? null;

function mount(store: JobStore) {
  for (const k of Object.keys(renders)) delete renders[k];
  return render(
    <JobStoreContext.Provider value={store}>
      <Reads name="title" pick={title} />
      <Reads name="draft" pick={draft} />
      <Reads name="review" pick={review} />
      <Reads name="spec" pick={spec} />
      <Reads name="facts" pick={facts} />
    </JobStoreContext.Provider>,
  );
}

describe('useJob', () => {
  it('two components reading different fields: a change redraws only its reader', async () => {
    const t = setup();
    await t.store.loadPage();
    mount(t.store);
    expect(screen.getByTestId('title').textContent).toBe('Crew schedule export');
    const start = { ...renders };
    act(() => { t.store.setDraft('Looks right'); });
    expect(screen.getByTestId('draft').textContent).toBe('Looks right');
    expect(renders.draft).toBe(start.draft + 1);
    expect(renders.title).toBe(start.title);
    expect(renders.review).toBe(start.review);
    act(() => { t.store.setStep('test'); });
    expect(renders.draft).toBe(start.draft + 1);
    expect(renders.title).toBe(start.title);
  });

  it('a newer v redraws only the readers of what changed', async () => {
    const t = setup();
    await t.store.loadPage();
    mount(t.store);
    const start = { ...renders };
    const next = base();
    next.v = 2;
    next.steps[5].word = '0 open';
    t.set(next);
    await act(async () => { t.send(2); await new Promise((r) => setTimeout(r, 0)); });
    expect(t.pages).toEqual([null, 1]);
    expect(screen.getByTestId('review').textContent).toContain('0 open');
    expect(renders.review).toBe(start.review + 1);
    expect(renders.spec).toBe(start.spec);
    expect(renders.facts).toBe(start.facts);
    expect(renders.title).toBe(start.title);
    expect(renders.draft).toBe(start.draft);
  });

  it('a selector that builds a new object each time redraws only when its equal check says so', async () => {
    const t = setup();
    await t.store.loadPage();
    let count = 0;
    function Counts() {
      const n = useJob((s) => ({ lines: s.payload?.thread.length ?? 0 }), (a, b) => a.lines === b.lines);
      count++;
      return <span data-testid="lines">{n.lines}</span>;
    }
    render(<JobStoreContext.Provider value={t.store}><Counts /></JobStoreContext.Provider>);
    expect(screen.getByTestId('lines').textContent).toBe('52');
    const before = count;
    act(() => { t.store.setDraft('x'); });
    expect(count).toBe(before);
  });

  it('useJobStore hands over the store for its actions, and says so plainly without one', () => {
    const t = setup();
    let got: JobStore | null = null;
    function Grab() { got = useJobStore(); return null; }
    render(<JobStoreContext.Provider value={t.store}><Grab /></JobStoreContext.Provider>);
    expect(got).toBe(t.store);
    function Bare() { useJob(title); return null; }
    expect(() => render(<Bare />)).toThrow('useJob needs a <JobStoreContext.Provider> above it.');
  });
});
