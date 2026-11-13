// The steps on the left (job page rebuild, Task 10): one line each (a state mark, the name, the
// result word), the current step open with its outputs, a click opens a step and shows its main
// output in the reader. Built against the made-up long job, and odd jobs made from it.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Job } from '../../api/types';
import { job as jobRow } from '../../state/test-fixtures';
import { longJob } from '../fixtures/longJob';
import { createJobStore, type JobStore } from '../jobStore';
import { readerOf } from '../targets';
import type { JobPagePayload, ReaderTarget, StepRow, StopId } from '../types';
import { JobStoreContext } from '../useJob';
import { Steps, stepWord } from './Steps';

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const payload = (over: Partial<JobPagePayload> = {}): JobPagePayload => ({ ...(clone(longJob.payload) as unknown as JobPagePayload), ...over });

/** The Steps as the page mounts them: a step pick opens it and clears the reader's own pick. */
function mount({ p = payload(), row = null }: { p?: JobPagePayload | null; row?: Job | null } = {}) {
  const api = { get: async () => ({}), post: async () => ({}), hosted: () => false } as unknown as ApiClient;
  const store: JobStore = createJobStore(SLUG, { api, initial: p, events: () => () => {} });
  const onStep = (id: StopId) => { store.setStep(id); store.setReader(null); };
  const onOpen = (t: ReaderTarget) => { store.setReader(t); };
  const utils = render(
    <JobStoreContext.Provider value={store}>
      <header className="probe-above">Header</header>
      <Steps job={row} cursor={null} onStep={onStep} onOpen={onOpen} />
    </JobStoreContext.Provider>,
  );
  return { store, ...utils };
}

const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.jp2-st-row')];
const row = (name: string) => {
  const r = rows().find((b) => b.querySelector('.jp2-st-name')?.textContent === name);
  if (!r) throw new Error(`No step row ${name}`);
  return r;
};
const wordOf = (name: string) => row(name).querySelector('.jp2-st-word')?.textContent ?? null;
const outputsOf = (name: string) => [...(row(name).closest('.jp2-step')!.querySelectorAll('.jp2-st-out .jp2-out-label'))].map((e) => e.textContent);
const STATE_WORDS = /working|waiting|not yet|done|skipped|now|paused/i;

/**
 * What sits above a step, in the order it is drawn: each element's tag, classes that size it, and its
 * own text. Heights here come from the number and kind of rows (fixed row heights), so an unchanged
 * list is an unchanged height (jsdom has no layout; the browser check measures it).
 */
function above(name: string): string[] {
  const at = row(name).closest('.jp2-step')!;
  const out: string[] = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el === at) break;
    if (el.contains(at)) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
    const sized = [...el.classList].filter((c) => c !== 'is-sel' && c !== 'is-cursor').join('.');
    out.push(`${el.tagName}.${sized}:${own}`);
  }
  return out;
}

describe('the steps', () => {
  it('seven rows, one line each: a state mark, the name and the result word; only a step that is not done carries a state word', () => {
    mount();
    expect(rows().map((r) => r.querySelector('.jp2-st-name')!.textContent)).toEqual(['Spec', 'Investigate', 'Plan', 'Build', 'Test', 'Review', 'Ship']);
    for (const r of rows()) expect(r.querySelector('.jp2-st-mark')).not.toBeNull();
    // Done steps: their result, never a state word.
    expect(['Spec', 'Investigate', 'Plan', 'Build', 'Test'].map(wordOf)).toEqual(['v0.4', 'findings v1', 'v2', '9 commits', '14 passed']);
    for (const n of ['Spec', 'Investigate', 'Plan', 'Build', 'Test']) expect(wordOf(n)).not.toMatch(STATE_WORDS);
    // The current step: its result. A step not reached yet: its state word.
    expect(wordOf('Review')).toBe('1 open');
    expect(wordOf('Ship')).toBe('not yet');
  });

  it('a current step with no result yet says its state; a skipped step says skipped and is drawn as skipped', () => {
    const p = payload({ state: 'working' });
    p.steps = p.steps.map((s) => (s.id === 'review' ? { ...s, word: null } : s.id === 'investigate' ? { ...s, state: 'skipped', word: null, outputs: [] } : s));
    mount({ p });
    expect(wordOf('Review')).toBe('working');
    expect(wordOf('Investigate')).toBe('skipped');
    expect(row('Investigate')).toHaveClass('is-skipped');
    expect(stepWord({ ...p.steps[5], word: null }, 'needs-you')).toBe('waiting for you');
    expect(stepWord({ ...p.steps[5], word: null }, 'paused')).toBe('paused');
  });

  it('the current step is open with its outputs, the latest of each only: Findings and the combined review', () => {
    mount();
    expect(row('Review')).toHaveAttribute('aria-expanded', 'true');
    expect(outputsOf('Review')).toEqual(['Findings', 'Review (combined)']);
    for (const n of ['Spec', 'Investigate', 'Plan', 'Build', 'Test', 'Ship']) expect(row(n)).toHaveAttribute('aria-expanded', 'false');
    // Each output once, with its result or version.
    const metas = [...document.querySelectorAll('.jp2-st-out .jp2-out-meta')].map((e) => e.textContent);
    expect(metas).toEqual(['1 open', 'v2']);
  });

  it('a click opens the step and shows its main output in the reader', () => {
    const { store } = mount();
    const reads = (name: string) => { fireEvent.click(row(name)); return readerOf(store.getState()); };
    expect(reads('Build')).toEqual({ kind: 'changes', id: 'changes' });
    expect(row('Build')).toHaveAttribute('aria-expanded', 'true');
    expect(outputsOf('Build')).toEqual(['Changes', 'Implementation plan', 'Implementation log']);
    expect(reads('Plan')).toEqual({ kind: 'doc', id: 'implementation-plan.md' });
    expect(reads('Test')).toEqual({ kind: 'checks', id: 'checks' });
    expect(reads('Review')).toEqual({ kind: 'findings', id: 'findings' });
    expect(reads('Ship')).toEqual({ kind: 'ship', id: 'ship' });
    expect(reads('Spec')).toEqual({ kind: 'doc', id: 'spec' });
    // The output it shows is marked in the list.
    expect(within(row('Spec').closest('.jp2-step')!).getByRole('button', { name: /^Product spec/ })).toHaveClass('is-sel');
    // An output opens in the reader by itself.
    fireEvent.click(within(row('Spec').closest('.jp2-step')!).getByRole('button', { name: /^Screens/ }));
    expect(readerOf(store.getState())).toEqual({ kind: 'doc', id: 'screens' });
  });

  it('the open step’s heading has its duration; the current one says when it started', () => {
    mount();
    fireEvent.click(row('Test'));
    expect(row('Test').querySelector('.jp2-st-dur')?.textContent).toBe('12 h 35 min');
    // Not on a closed step.
    expect(row('Plan').querySelector('.jp2-st-dur')).toBeNull();
    expect(row('Review').querySelector('.jp2-st-dur')?.textContent).toMatch(/^since /);
  });

  it('opening a step never changes the height of anything above it', () => {
    mount();
    // Below the current step: the current step stays open.
    let before = above('Ship');
    fireEvent.click(row('Ship'));
    expect(row('Ship')).toHaveAttribute('aria-expanded', 'true');
    expect(above('Ship')).toEqual(before);
    // Above the current one.
    before = above('Spec');
    fireEvent.click(row('Spec'));
    expect(above('Spec')).toEqual(before);
    // Then one further down: the step opened above it stays open, so nothing above moves.
    before = above('Plan');
    fireEvent.click(row('Plan'));
    expect(row('Plan')).toHaveAttribute('aria-expanded', 'true');
    expect(above('Plan')).toEqual(before);
    // Opening one above closes those below it, never those above.
    fireEvent.click(row('Investigate'));
    expect(row('Spec')).toHaveAttribute('aria-expanded', 'true');
    expect(row('Plan')).toHaveAttribute('aria-expanded', 'false');
    expect(row('Review')).toHaveAttribute('aria-expanded', 'true');
  });

  it('a step picked by key or address moves the one open pick (no pointer under it to keep still)', () => {
    const { store } = mount();
    fireEvent.click(row('Spec'));
    fireEvent.click(row('Plan'));
    expect(row('Spec')).toHaveAttribute('aria-expanded', 'true');
    // The page's [ ] keys and the address set the step in the store.
    act(() => { store.setStep('build'); });
    expect(row('Build')).toHaveAttribute('aria-expanded', 'true');
    expect(row('Spec')).toHaveAttribute('aria-expanded', 'false');
    expect(row('Plan')).toHaveAttribute('aria-expanded', 'false');
  });

  it('an open step with nothing yet says so in one dim line, and the reader shows that it has nothing yet', () => {
    const empty = payload();
    empty.steps = empty.steps.map((s) => (s.id === 'investigate' ? { ...s, state: 'todo', word: null, outputs: [] } : s));
    const { store } = mount({ p: empty });
    fireEvent.click(row('Investigate'));
    expect(row('Investigate').closest('.jp2-step')!.querySelector('.jp2-st-none')?.textContent).toBe('Nothing yet');
    expect(readerOf(store.getState())).toEqual({ kind: 'not-yet', id: 'investigate' });
    expect(row('Investigate')).toHaveClass('is-sel');
  });

  it('before the payload: the seven steps from the snapshot row, the current one open with no outputs and no word', () => {
    mount({ p: null, row: jobRow(SLUG, 'needs-you', { lane: 'needs-you', stage: 'review', stageState: 'waiting', needsYou: true }) });
    expect(within(screen.getByRole('navigation', { name: 'Steps' })).getAllByRole('button')).toHaveLength(7);
    expect(row('Review')).toHaveAttribute('aria-expanded', 'true');
    expect(wordOf('Review')).toBeNull();
    expect(wordOf('Spec')).toBeNull();
    expect(wordOf('Ship')).toBe('not yet');
  });
});

describe('odd jobs (plan, review focus 6)', () => {
  const step = (id: string, label: string, state: StepRow['state'], word: string | null = null): StepRow => ({ id: id as StopId, label, state, word, durationMs: null, startedAt: null, outputs: [] });

  it('a quick-route job: its skipped steps are shown as skipped, in their places', () => {
    const p = payload({ state: 'working' });
    p.steps = p.steps.map((s) => (['spec', 'investigate'].includes(s.id) ? { ...s, state: 'skipped', word: null, outputs: [] } : s));
    mount({ p });
    expect(rows()).toHaveLength(7);
    expect(['Spec', 'Investigate'].map(wordOf)).toEqual(['skipped', 'skipped']);
    fireEvent.click(row('Spec'));
    expect(row('Spec').closest('.jp2-step')!.querySelector('.jp2-st-none')?.textContent).toBe('Skipped for this job');
  });

  it('a bug-fix job shows the steps it has, by the payload’s own names', () => {
    const p = payload({ kind: 'bug', state: 'working' });
    p.steps = [step('spec', 'Triage', 'done', 'v1'), step('investigate', 'Reproduce', 'done', 'repro v1'), step('plan', 'Diagnose', 'current'), step('build', 'Build', 'todo'), step('ship', 'Ship', 'todo')];
    mount({ p });
    expect(rows().map((r) => r.querySelector('.jp2-st-name')!.textContent)).toEqual(['Triage', 'Reproduce', 'Diagnose', 'Build', 'Ship']);
    expect(wordOf('Diagnose')).toBe('working');
    expect(row('Diagnose')).toHaveAttribute('aria-expanded', 'true');
  });

  it('a closed job: every step done, none open, no state word anywhere', () => {
    const p = payload({ state: 'done', move: null });
    p.steps = p.steps.map((s) => ({ ...s, state: 'done', word: s.word ?? null }));
    mount({ p });
    for (const r of rows()) expect(r).toHaveAttribute('aria-expanded', 'false');
    for (const r of rows()) expect(r.querySelector('.jp2-st-word')?.textContent ?? '').not.toMatch(STATE_WORDS);
  });
});
