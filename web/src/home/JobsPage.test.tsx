// Jobs (#/): four lanes from the dashboard's lane, Resting and Done folded, the next-step bar with
// Open (o), stop dots with their own tooltip, cards that hold their lane under the pointer, Play's
// three dressings, One list, and the empty state.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Job } from '../api/types';
import { installKeyListener } from '../app/keyRegistry';
import { UiProvider } from '../app/ui';
import { createStore, WorkshopContext, type Store } from '../state/store';
import { job, snapshot } from '../state/test-fixtures';
import { JobsPage, laneOf, nextJob, stateChip } from './JobsPage';

const JOBS: Job[] = [
  job('alpha', 'needs-you', { title: 'Customer notes', stage: 'plan', lane: 'needs-you', laneReason: 'Waiting for your go-ahead on the plan', waitingFor: 'approval', waitingSince: '2026-10-21T09:00:00Z' }),
  job('older', 'needs-you', { title: 'Weekly hours email', stage: 'spec', lane: 'needs-you', laneReason: 'The Foreman asks 2 questions', waitingFor: 'answers', waitingSince: '2026-10-21T08:00:00Z' }),
  job('beta', 'running', { title: 'Technician photo', stage: 'implement', lane: 'working', laneReason: 'Building step 3', updatedAt: '2026-10-21T11:40:00Z' }),
  job('gamma', 'shipping', { title: 'Gate code', stage: 'pr1', lane: 'in-review', laneReason: 'PR #1 is open, waiting on a review' }),
  job('delta', 'shipping', { title: 'Cancellation email', stage: 'pr2', lane: 'ready', laneReason: 'Checks passed and PR #2 is approved' }),
  job('idle', 'idle', { title: 'Old idea', stage: 'spec', lane: 'resting', laneReason: 'Nothing happening; waits for your next message' }),
  job('fin', 'done', { title: 'Shipped thing', stage: 'pr3', lane: 'done', laneReason: 'In main' }),
];

function setup(jobs = JOBS, play: 'full' | 'subtle' | 'off' = 'subtle') {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, meta: { token: 't', settings: { play: { mode: play } } } as never }) });
  const api = { get: vi.fn(), post: vi.fn() } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><UiProvider><JobsPage /></UiProvider></WorkshopContext.Provider>);
  return { ...utils, store };
}

let off = () => {};
beforeEach(() => { off = installKeyListener(); window.location.hash = '#/'; });
afterEach(() => { off(); cleanup(); localStorage.clear(); window.location.hash = ''; });

describe('Jobs', () => {
  it('has four lanes, each with a word and a count; Resting and Done are folded under the board', () => {
    setup();
    for (const [name, titles] of [['Working, 1', ['Technician photo']], ['Needs you, 2', ['Weekly hours email', 'Customer notes']], ['In review, 1', ['Gate code']], ['Ready to merge, 1', ['Cancellation email']]] as const) {
      const lane = screen.getByRole('region', { name });
      expect(within(lane).getAllByRole('link').map((a) => a.textContent)).toEqual(titles);
    }
    const folds = [...document.querySelectorAll('.jobs-folded details')] as HTMLDetailsElement[];
    expect(folds.map((d) => d.querySelector('.fold-name')?.textContent)).toEqual(['Resting', 'Done']);
    expect(folds.map((d) => d.open)).toEqual([false, false]);
    expect(folds[0].querySelector('summary')).toHaveTextContent('1 idle');
  });

  it('the next-step bar names the job that waited longest for you; o opens it', () => {
    setup();
    const bar = screen.getByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('Weekly hours email needs you');
    expect(bar).toHaveTextContent('2 jobs need you. This one has waited longest.');
    expect(within(bar).getByRole('link', { name: /Open/ })).toHaveAttribute('href', '#/job/older');
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(window.location.hash).toBe('#/job/older');
  });

  it('with nothing for you the bar says so, with no button', () => {
    setup(JOBS.filter((j) => j.lane !== 'needs-you'));
    const bar = screen.getByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('Nothing needs you right now');
    expect(within(bar).queryByRole('link')).toBeNull();
  });

  it('each stop dot takes the focus and has its own tooltip in words; each card says its state in a word', () => {
    setup();
    const card = screen.getByRole('link', { name: 'Customer notes' }).closest('li')!;
    const dots = within(card).getByRole('list', { name: 'Customer notes: its stops' });
    const plan = within(dots).getAllByRole('listitem')[2].querySelector('[tabindex="0"]') as HTMLElement;
    expect(plan).toHaveAccessibleDescription('Plan · waiting for you');
    expect(within(dots).getAllByRole('tooltip').map((t) => t.textContent)).toEqual([
      'Spec · done', 'Investigate · done', 'Plan · waiting for you', 'Build · not yet', 'Test · not yet', 'Review · not yet', 'Ship · not yet',
    ]);
    expect(card).toHaveTextContent('Go-ahead');
    expect(screen.getByRole('link', { name: 'Weekly hours email' }).closest('li')).toHaveTextContent('Question');
  });

  it('a card keeps its lane while the pointer is over the board, and moves when it leaves', () => {
    const { store } = setup();
    const board = document.querySelector('.jobs-board')!;
    fireEvent.mouseEnter(board);
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: JOBS.map((j) => (j.slug === 'beta' ? { ...j, lane: 'needs-you' as const } : j)), meta: { token: 't' } }) }); });
    expect(within(screen.getByRole('region', { name: /^Working/ })).getByRole('link', { name: 'Technician photo' })).toBeInTheDocument();
    fireEvent.mouseLeave(board);
    expect(within(screen.getByRole('region', { name: /^Needs you/ })).getByRole('link', { name: 'Technician photo' })).toBeInTheDocument();
  });

  it('Play full: console cards with a readout and a blinking light; off: plain cards, the same dots and words', () => {
    setup(JOBS, 'full');
    const card = screen.getByRole('link', { name: 'Technician photo' }).closest('li')!;
    expect(card.querySelector('.job-light.is-blink')).not.toBeNull();
    expect(card.querySelector('.job-readout')).toHaveTextContent('Build');
    cleanup();
    setup(JOBS, 'off');
    const plain = screen.getByRole('link', { name: 'Technician photo' }).closest('li')!;
    expect(plain.querySelector('.job-light')).toBeNull();
    expect(plain.querySelector('.job-readout')).toBeNull();
    expect(plain).toHaveTextContent('Working');
  });

  it('One list (Settings → Look) puts every open job in one list with its lane in words', () => {
    localStorage.setItem('gc.jobs.layout', 'list');
    setup();
    expect(document.querySelector('.jobs-board')).toBeNull();
    const rows = document.querySelectorAll('.jobs-list-row');
    expect([...rows].map((r) => r.querySelector('.state-chip')?.textContent?.trim())).toEqual(['Working', 'Needs you', 'Needs you', 'In review', 'Ready to merge']);
  });

  it('with no jobs: the three picture cards and the way to the Inbox', () => {
    setup([]);
    expect(screen.getByRole('heading', { name: 'No jobs yet. Start one from a ticket.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Pick a ticket in the Inbox/ })).toHaveAttribute('href', '#/inbox');
  });

  it('lanes and picks from the model', () => {
    expect(laneOf(job('x', 'running'))).toBe('working');
    expect(laneOf(job('x', 'idle', { closed: { as: 'done', at: 'x' } as never }))).toBe('done');
    expect(nextJob(JOBS)?.slug).toBe('older');
    expect(stateChip(job('x', 'needs-you', { lane: 'needs-you', permissions: 1 })).word).toBe('Permission');
  });
});
