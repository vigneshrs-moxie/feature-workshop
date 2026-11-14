// The steps on the left (job page rebuild, Task 10): one line each (a state mark, the name, the
// result word); only the current step is open with its outputs; opening another step marks it and
// shows its main output in the reader, and lists nothing, so no row ever moves (lead's ruling,
// Task 10 I1: the prototype's rule). Built against the made-up long job, and odd jobs made from it.
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
      <footer className="probe-below">The job rows</footer>
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
 * Every block on the page, in the order it is drawn (what is above, the steps, their rows, output
 * lists and lines, what is below), with the classes that size it (not the marks: is-sel,
 * is-cursor). Rows have fixed heights, so an unchanged list means no row moved (jsdom has no
 * layout; the browser check measures it in pixels). Words inside a row (a duration) do not count.
 */
const BLOCKS = 'header, nav, footer, .jp2-step, .jp2-st-row, .jp2-st-outs, .jp2-st-outs > li, .jp2-st-out, .jp2-st-none';
function shape(): string[] {
  return [...document.body.querySelectorAll(BLOCKS)].map((el) => `${el.tagName}.${[...el.classList].filter((c) => c !== 'is-sel' && c !== 'is-cursor').join('.')}`);
}

const step = (id: string, label: string, state: StepRow['state'], word: string | null = null): StepRow => ({
  id: id as StopId, label, state, word, durationMs: null, startedAt: null, outputs: [], more: [],
  main: state === 'todo' || state === 'skipped' ? { kind: 'not-yet', id } : { kind: 'doc', id: `${id}.md` },
});

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

  it('a current step with no result yet says its own state; a skipped step says skipped and is drawn as skipped', () => {
    const p = payload({ state: 'working' });
    p.steps = p.steps.map((s) => (s.id === 'review' ? { ...s, word: null } : s.id === 'investigate' ? { ...s, state: 'skipped', word: null, outputs: [], main: { kind: 'not-yet', id: 'investigate' } } : s));
    mount({ p });
    expect(wordOf('Review')).toBe('working');
    expect(wordOf('Investigate')).toBe('skipped');
    expect(row('Investigate')).toHaveClass('is-skipped');
    const bare = { ...p.steps[5], word: null };
    expect(stepWord(bare, 'needs-you')).toBe('waiting for you');
    expect(stepWord(bare, 'paused')).toBe('paused');
    expect(stepWord(bare, 'waiting-github')).toBe('waiting on GitHub');
    expect(stepWord(bare, 'done')).toBeNull();
  });

  it('only the current step is open, with its outputs, the latest of each: Findings and the combined review', () => {
    mount();
    expect(row('Review')).toHaveAttribute('aria-expanded', 'true');
    expect(outputsOf('Review')).toEqual(['Findings', 'Review (combined)']);
    expect(document.querySelectorAll('.jp2-st-outs')).toHaveLength(1);
    for (const n of ['Spec', 'Investigate', 'Plan', 'Build', 'Test', 'Ship']) expect(row(n)).not.toHaveAttribute('aria-expanded');
    expect([...document.querySelectorAll('.jp2-st-out .jp2-out-meta')].map((e) => e.textContent)).toEqual(['1 open', 'v2']);
  });

  it('a click on another step marks it and shows its main output in the reader (the payload’s main); it lists nothing', () => {
    const { store } = mount();
    const reads = (name: string) => { fireEvent.click(row(name)); return readerOf(store.getState()); };
    expect(reads('Build')).toEqual({ kind: 'changes', id: 'changes' });
    expect(row('Build')).toHaveClass('is-sel');
    expect(row('Build')).toHaveAttribute('aria-current', 'step');
    expect(row('Build').closest('.jp2-step')!.querySelector('.jp2-st-outs')).toBeNull();
    expect(reads('Plan')).toEqual({ kind: 'doc', id: 'implementation-plan.md' });
    expect(row('Build')).not.toHaveClass('is-sel');
    expect(reads('Test')).toEqual({ kind: 'checks', id: 'checks' });
    expect(reads('Spec')).toEqual({ kind: 'doc', id: 'spec' });
    // Ship not started yet: its PR lines (Phase 4 B1: the PR's action is offered on any step).
    expect(reads('Ship')).toEqual({ kind: 'ship', id: 'ship' });
    expect(row('Ship')).toHaveClass('is-sel');
    // The current step: its main output, its own output marked in its list.
    expect(reads('Review')).toEqual({ kind: 'findings', id: 'findings' });
    expect(within(row('Review').closest('.jp2-step')!).getByRole('button', { name: /^Findings/ })).toHaveClass('is-sel');
    expect(rows().filter((r) => r.classList.contains('is-sel'))).toHaveLength(0);
    // An output of the current step opens in the reader by itself.
    fireEvent.click(within(row('Review').closest('.jp2-step')!).getByRole('button', { name: /^Review \(combined\)/ }));
    expect(readerOf(store.getState())).toEqual({ kind: 'doc', id: 'review.md' });
  });

  it('a step whose document the reader shows is marked, however it got there (a reader address, Build’s plan in `more`)', () => {
    const { store } = mount();
    act(() => { store.setReader({ kind: 'doc', id: 'implementation-log.md' }); });
    expect(row('Build')).toHaveClass('is-sel');
    act(() => { store.setReader({ kind: 'conversation', id: 'conversation' }); });
    expect(rows().filter((r) => r.classList.contains('is-sel'))).toHaveLength(0);
  });

  it('the current step’s heading and a marked step’s have the duration; the current one says when it started', () => {
    mount();
    expect(row('Review').querySelector('.jp2-st-dur')?.textContent).toMatch(/^since /);
    expect(row('Test').querySelector('.jp2-st-dur')).toBeNull();
    fireEvent.click(row('Test'));
    expect(row('Test').querySelector('.jp2-st-dur')?.textContent).toBe('12 h 35 min');
    expect(row('Plan').querySelector('.jp2-st-dur')).toBeNull();
  });

  it('opening a step never moves any row: by click, and by key or address (the store’s step)', () => {
    const { store } = mount();
    const before = shape();
    for (const name of ['Ship', 'Spec', 'Plan', 'Investigate', 'Review', 'Build']) {
      fireEvent.click(row(name));
      expect(shape(), name).toEqual(before);
    }
    for (const id of ['test', 'ship', 'spec'] as StopId[]) {
      act(() => { store.setStep(id); store.setReader(null); });
      expect(shape(), id).toEqual(before);
    }
  });

  it('a current step with nothing yet says so in one dim line', () => {
    const p = payload({ state: 'working' });
    p.steps = p.steps.map((s) => (s.id === 'review' ? { ...s, outputs: [], word: null } : s));
    mount({ p });
    expect(row('Review').closest('.jp2-step')!.querySelector('.jp2-st-none')?.textContent).toBe('Nothing yet');
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
  it('a quick-route job: its skipped steps are shown as skipped, in their places; opening one says it has nothing', () => {
    const p = payload({ state: 'working' });
    p.steps = p.steps.map((s) => (['spec', 'investigate'].includes(s.id) ? { ...s, state: 'skipped', word: null, outputs: [], main: { kind: 'not-yet', id: s.id } } : s));
    const { store } = mount({ p });
    expect(rows()).toHaveLength(7);
    expect(['Spec', 'Investigate'].map(wordOf)).toEqual(['skipped', 'skipped']);
    fireEvent.click(row('Spec'));
    expect(readerOf(store.getState())).toEqual({ kind: 'not-yet', id: 'spec' });
    expect(row('Spec')).toHaveClass('is-sel');
  });

  it('a bug-fix job shows the steps it has, by the payload’s own names', () => {
    const p = payload({ kind: 'bug', state: 'working' });
    p.steps = [step('spec', 'Triage', 'done', 'v1'), step('investigate', 'Reproduce', 'done', 'repro v1'), step('plan', 'Diagnose', 'current'), step('build', 'Build', 'todo'), step('ship', 'Ship', 'todo')];
    mount({ p });
    expect(rows().map((r) => r.querySelector('.jp2-st-name')!.textContent)).toEqual(['Triage', 'Reproduce', 'Diagnose', 'Build', 'Ship']);
    expect(wordOf('Diagnose')).toBe('working');
    expect(row('Diagnose')).toHaveAttribute('aria-expanded', 'true');
  });

  it('a job waiting on GitHub: its current step without a result says so, not working', () => {
    const p = payload({ state: 'waiting-github', move: null });
    p.steps = p.steps.map((s) => (s.id === 'review' ? { ...s, state: 'done' } : s.id === 'ship' ? { ...s, state: 'current', word: null } : s));
    mount({ p });
    expect(wordOf('Ship')).toBe('waiting on GitHub');
  });

  it('a closed job: every step done, none open, no state word anywhere', () => {
    const p = payload({ state: 'done', move: null });
    p.steps = p.steps.map((s) => ({ ...s, state: 'done', word: s.word ?? null }));
    mount({ p });
    for (const r of rows()) expect(r).not.toHaveAttribute('aria-expanded');
    for (const r of rows()) expect(r.querySelector('.jp2-st-word')?.textContent ?? '').not.toMatch(STATE_WORDS);
  });
});
