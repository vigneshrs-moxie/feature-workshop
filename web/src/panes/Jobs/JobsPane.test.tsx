import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Job } from '../../api/types';
import { createStore, WorkshopContext } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { jobHue } from '../../theme/hue';
import { JobsPane, RAIL_KEY } from './JobsPane';

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
  job('omega', 'done', { stage: 'pr3', closed: { as: 'done' } }),
];

beforeEach(() => { vi.useFakeTimers({ now, toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

describe('Jobs pane', () => {
  it('groups jobs in order, each group with its count', () => {
    renderPane(JOBS);
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['◆ Needs you1', '◐ Running1', '‖ Paused1', '○ Idle1', '✓ Done1']);
  });

  it('shows each row’s hue dot, status glyph and label, stage chip and time', () => {
    renderPane(JOBS);
    const row = screen.getByRole('link', { name: /^Job alpha/ });
    expect(row).toHaveTextContent('Job alpha4m◆PermissionPlan');
    expect(row.querySelector('.hue-dot')).toHaveStyle({ '--job-hue': String(jobHue('alpha')) });
    expect(within(row).getByText('Plan')).toHaveAttribute('title', expect.stringMatching(/^Stage: Plan\./));
    expect(within(row).getByText('4m').closest('time')).toHaveAttribute('dateTime', iso(14, 56));
    expect(within(row).getByText('Permission').parentElement).toHaveAttribute('title', expect.stringMatching(/permission/));
    expect(screen.getByRole('link', { name: /^Job beta/ })).toHaveTextContent('Working');
    expect(screen.getByRole('link', { name: /^Job beta/ })).toHaveTextContent('Build');
  });

  it('says when a usage-paused job resumes', () => {
    renderPane(JOBS);
    expect(within(screen.getByRole('region', { name: 'Paused' })).getByText('resumes 3:42pm')).toBeInTheDocument();
  });

  it('marks the open job and leaves the stage off done jobs', () => {
    renderPane(JOBS, 'beta');
    expect(screen.getByRole('link', { name: /^Job beta/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^Job omega/ })).not.toHaveTextContent('PR #3');
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
