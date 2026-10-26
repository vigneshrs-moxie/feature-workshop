import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Job, PlayMode } from '../../api/types';
import { createStore, WorkshopContext } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { jobHue } from '../../theme/hue';
import { FOLDED_KEY, JobsPane, RAIL_KEY } from './JobsPane';

const now = new Date(2026, 9, 15, 15, 0);
const iso = (h: number, m: number) => new Date(2026, 9, 15, h, m).toISOString();

function renderPane(jobs: Job[], selected: string | null = null) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs }) });
  const value = { store, api: {} as ApiClient };
  return render(<WorkshopContext.Provider value={value}><JobsPane selected={selected} /></WorkshopContext.Provider>);
}

const JOBS = [
  job('alpha', 'needs-you', { permissions: 1, stage: 'plan', updatedAt: iso(14, 56) }),
  job('beta', 'running', { stage: 'implement', updatedAt: iso(14, 59) }),
  job('gamma', 'paused', { stage: 'test', limitPaused: iso(15, 42), updatedAt: iso(12, 0) }),
  job('delta', 'idle', { stage: 'spec' }),
  job('sigma', 'shipping', { stage: 'pr2', updatedAt: iso(9, 0), finish: { reached: true, at: null, by: 'pr1-merged', landed: null } }),
  job('omega', 'done', { stage: 'pr3', closed: { as: 'done' } }),
];

beforeEach(() => { vi.useFakeTimers({ now, toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

describe('Jobs pane', () => {
  it('groups jobs in order, each group with its count', () => {
    renderPane(JOBS);
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['▾◆Needs you1', '▾◐Running1', '▾‖Paused1', '▾○Idle1', '▾↗Shipping1', '▸✓Done1']);
  });

  it('a shipping row says where the work is instead of a stage chip', () => {
    renderPane(JOBS);
    const row = screen.getByRole('link', { name: /^Job sigma/ });
    expect(within(row).getByText('Shipping')).toBeInTheDocument();
    expect(within(row).getByText('On the Moxie branch')).toHaveClass('muted');
    expect(row.querySelector('.stage-chip')).toBeNull();
  });

  it('shows each row’s hue dot, status glyph and label, the stage chip only when it needs you, and the time', () => {
    renderPane(JOBS);
    const row = screen.getByRole('link', { name: /^Job alpha/ });
    expect(row).toHaveTextContent('Job alpha4m◆PermissionPlan');
    expect(row.querySelector('.hue-dot')).toHaveStyle({ '--job-hue': String(jobHue('alpha')) });
    expect(within(row).getByText('Plan')).toHaveAttribute('title', expect.stringMatching(/^Stage: Plan\./));
    expect(within(row).getByText('4m').closest('time')).toHaveAttribute('dateTime', iso(14, 56));
    expect(within(row).getByText('Permission').parentElement).toHaveAttribute('title', expect.stringMatching(/permission/));
    expect(screen.getByRole('link', { name: /^Job beta/ })).toHaveTextContent('Working');
    expect(screen.getByRole('link', { name: /^Job beta/ })).not.toHaveTextContent('Build'); // running: no stage chip
    expect(screen.getByRole('link', { name: /^Job beta/ }).querySelector('.stage-chip')).toBeNull();
  });

  it('marks a decision left 4 hours as parked, still under Needs you (row and rail)', () => {
    renderPane([job('alpha', 'needs-you', { waitingFor: 'approval', stage: 'plan', parked: true }), job('beta', 'idle', { parked: true })]);
    const row = within(screen.getByRole('region', { name: 'Needs you' })).getByRole('link', { name: /^Job alpha/ });
    expect(within(row).getByText('parked 4h')).toHaveAttribute('title', expect.stringMatching(/more than 4 hours/));
    expect(within(screen.getByRole('link', { name: /^Job beta/ })).queryByText('parked 4h'), 'only a job that needs you').toBeNull();
  });

  it('says when a usage-paused job resumes', () => {
    renderPane(JOBS);
    expect(within(screen.getByRole('region', { name: 'Paused' })).getByText('resumes 3:42pm')).toBeInTheDocument();
  });

  it('marks the open job and leaves the stage off done jobs', () => {
    renderPane(JOBS, 'beta');
    expect(screen.getByRole('link', { name: /^Job beta/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^Job omega/, hidden: true })).not.toHaveTextContent('PR #3');
  });

  it('folds a group from its heading and remembers it; Done starts folded', () => {
    const { unmount } = renderPane(JOBS, 'omega');
    const done = screen.getByRole('button', { name: /Done/ });
    expect(done).toHaveAttribute('aria-expanded', 'false');
    expect(done).toHaveTextContent('open job inside');
    expect(screen.queryByRole('link', { name: /^Job omega/ })).toBeNull();
    fireEvent.click(done);
    expect(screen.getByRole('link', { name: /^Job omega/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Running/ }));
    expect(screen.queryByRole('link', { name: /^Job beta/ })).toBeNull();
    expect(localStorage.getItem(FOLDED_KEY)).toBe('running');
    unmount();
    renderPane(JOBS);
    expect(screen.getByRole('button', { name: /Running/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Done/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses to an icon rail and remembers it', () => {
    const { unmount } = renderPane(JOBS, 'alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse the jobs list' }));
    expect(localStorage.getItem(RAIL_KEY)).toBe('on');
    const nav = screen.getByRole('navigation', { name: 'Jobs' });
    expect(nav).toHaveClass('is-rail');
    expect(within(nav).queryByText('How this works')).toBeNull();
    const alpha = screen.getByRole('link', { name: 'Job alpha · Permission · Plan · updated 4m ago' });
    expect(alpha).toHaveAttribute('aria-current', 'page');
    expect(alpha).toHaveAttribute('href', '#/job/alpha');
    expect(screen.getByRole('link', { name: /^Job gamma · resumes 3:42pm/ })).toBeInTheDocument();
    expect(screen.getByTitle('1 job needs you.')).toHaveTextContent('1');
    unmount();

    renderPane(JOBS);
    expect(screen.getByRole('navigation', { name: 'Jobs' })).toHaveClass('is-rail');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Expand the jobs list' })); });
    expect(localStorage.getItem(RAIL_KEY)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Jobs' })).toBeInTheDocument();
  });

  it('gives every control a hover hint', () => {
    renderPane(JOBS);
    for (const b of screen.getAllByRole('button')) expect(b).toHaveAttribute('title');
    for (const a of screen.getAllByRole('link')) expect(a).toHaveAttribute('title');
  });
});

describe('the crew in the Jobs list (Play)', () => {
  function withMode(mode: PlayMode) {
    const store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: JOBS, meta: { token: 't', settings: { policy: 'hands-off', play: { mode, questDone: 'first-pr', sounds: false } } } }) });
    return render(<WorkshopContext.Provider value={{ store, api: {} as ApiClient }}><JobsPane selected={null} /></WorkshopContext.Provider>);
  }

  it('each row shows its job’s crew member in the job’s mood, as decoration, with a “!” when it needs you', () => {
    withMode('subtle');
    const crewOf = (name: RegExp) => screen.getByRole('link', { name, hidden: true }).querySelector('.row-crew')!;
    expect(crewOf(/^Job alpha/)).toHaveAttribute('aria-hidden', 'true');
    expect(crewOf(/^Job alpha/).querySelector('svg.crew')).toHaveAttribute('data-crew', 'feature-planner');
    expect(crewOf(/^Job alpha/).querySelector('svg.crew')).toHaveAttribute('data-state', 'waiting');
    expect(crewOf(/^Job alpha/).querySelector('.row-crew-ask')).toHaveTextContent('!');
    expect(crewOf(/^Job beta/).querySelector('svg.crew')).toHaveAttribute('data-state', 'working');
    expect(crewOf(/^Job beta/).querySelector('.row-crew-ask')).toBeNull();
    expect(crewOf(/^Job gamma/).querySelector('svg.crew')).toHaveAttribute('data-state', 'asleep');
    expect(crewOf(/^Job omega/).querySelector('svg.crew')).toHaveAttribute('data-state', 'celebrating');
    // The row still says it all in words.
    expect(screen.getByRole('link', { name: /^Job alpha/ })).toHaveTextContent('Permission');
  });

  it('keeps them still in Full, so a long list stays calm', () => {
    const { container } = withMode('full');
    const all = [...container.querySelectorAll('.row-crew svg.crew')];
    expect(all).toHaveLength(JOBS.length);
    for (const svg of all) expect(svg).toHaveClass('is-still');
  });

  it('Off: the rows exactly as before', () => {
    const { container } = withMode('off');
    expect(container.querySelector('.row-crew, .has-crew')).toBeNull();
  });

  it('carries no alert switches: they live in Settings → Notifications, “In this browser”', () => {
    renderPane(JOBS);
    expect(document.querySelector('[data-alerts-control]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Chime/ })).toBeNull();
  });
});
