// Jobs' Auto tab (design section 2): Working with its places, Needs you, Ready for you to try, the
// paused line at the top, and the empty groups, from hand-made jobs and queues. Each on the laptop
// and on the website (api.hosted).
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { AutoQueue, Job } from '../api/types';
import { UiProvider } from '../app/ui';
import { createStore, WorkshopContext, type Store } from '../state/store';
import { job, snapshot } from '../state/test-fixtures';
import { AUTO_PAUSED } from '../views/Inbox';
import { AutoJobs } from './AutoJobs';
import { AUTO_PAUSED_LINE } from './autoTab';

const QUEUE: AutoQueue = { on: true, tag: 'auto', max: 5, working: 2, unfinished: 3, ceiling: 10, paused: null, testing: 'w1', tickets: [] };

const JOBS: Job[] = [
  job('w1', 'running', { title: 'Gate code', stage: 'test', lane: 'working', laneReason: 'Recording evidence', auto: { on: true, ran: true, group: 'working' } }),
  job('w2', 'running', { title: 'Cancellation email', stage: 'review', lane: 'working', laneReason: 'Waiting for its turn to test', auto: { on: true, ran: true, group: 'working', waitingToTest: true } }),
  job('n1', 'needs-you', { title: 'Customer notes', stage: 'plan', lane: 'needs-you', laneReason: 'Auto stopped: the Foreman says it is blocked', auto: { on: true, ran: true, stopped: { reason: 'the Foreman says it is blocked' }, group: 'needs-you' } }),
  job('t1', 'idle', { title: 'Payroll export', stage: 'spec', lane: 'needs-you', auto: { on: false, ran: true, tooBig: { at: '2026-11-12T09:00:00Z', reason: 'It touches billing, payroll and the portal.' }, group: 'needs-you' } }),
  job('r1', 'shipping', { title: 'Weekly hours email', stage: 'pr1', lane: 'in-review', level: 3, auto: { on: false, ran: true, finished: '2026-11-12T10:00:00Z', risky: 2, group: 'ready' } }),
  job('r2', 'shipping', { title: 'Technician photo', stage: 'pr1', lane: 'in-review', level: 1, auto: { on: false, ran: true, finished: '2026-11-12T10:00:00Z', risky: 0, group: 'ready' } }),
  job('r3', 'shipping', { title: 'Old laptop job', stage: 'pr1', lane: 'in-review', auto: { on: false, ran: true, finished: '2026-11-12T10:00:00Z', group: 'ready' } }),
  job('mine', 'running', { title: 'Mine by hand', stage: 'implement', lane: 'working' }),
];

function setup({ jobs = JOBS, queue = QUEUE as AutoQueue | null, hosted = false } = {}) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, meta: { token: 't' } }) });
  const api = { get: vi.fn(() => new Promise(() => {})), post: vi.fn(), ...(hosted ? { hosted: () => true } : {}) } as unknown as ApiClient;
  return render(
    <WorkshopContext.Provider value={{ store, api }}>
      <UiProvider><AutoJobs jobs={jobs} queue={queue} now={new Date('2026-11-12T12:00:00Z')} play="subtle" /></UiProvider>
    </WorkshopContext.Provider>,
  );
}

const group = (name: string | RegExp) => screen.getByRole('region', { name });
const titles = (el: HTMLElement) => within(el).getAllByRole('link').map((a) => a.textContent);

afterEach(() => { cleanup(); localStorage.clear(); });

for (const hosted of [false, true]) {
  describe(`Jobs: the Auto tab${hosted ? ', on the website' : ''}`, () => {
    it('three groups with the places in the heading', () => {
      setup({ hosted });
      expect(screen.getByRole('heading', { name: 'Working · 2 of 5' })).toBeInTheDocument();
      expect(titles(group('Working · 2 of 5'))).toEqual(['Gate code', 'Cancellation email']);
      expect(titles(group('Needs you, 2'))).toEqual(['Customer notes', 'Payroll export']);
      expect(titles(group('Ready for you to try, 3'))).toEqual(['Weekly hours email', 'Technician photo', 'Old laptop job']);
      // Only the groups the server named: a job with no group is not here.
      expect(screen.queryByRole('link', { name: 'Mine by hand' })).toBeNull();
      // Needs you: a stopped job with its reason, a set-aside one marked Too big for Auto with its own.
      const stopped = within(group('Needs you, 2')).getByRole('link', { name: 'Customer notes' }).closest('li')!;
      expect(stopped).toHaveTextContent('Auto stopped: the Foreman says it is blocked');
      const big = within(group('Needs you, 2')).getByRole('link', { name: 'Payroll export' }).closest('li')!;
      expect(within(big).getByText('Too big for Auto')).toHaveAttribute('title', 'It touches billing, payroll and the portal.');
      expect(big).toHaveTextContent('It touches billing, payroll and the portal.');
      cleanup();
      // With no max known (no queue from an older laptop): the count alone.
      setup({ hosted, queue: null });
      expect(screen.getByRole('heading', { name: 'Working · 2' })).toBeInTheDocument();
    });

    it('a job waiting to test says so', () => {
      setup({ hosted });
      const card = within(group(/^Working/)).getByRole('link', { name: 'Cancellation email' }).closest('li')!;
      expect(card).toHaveTextContent('Waiting for its turn to test');
      const other = within(group(/^Working/)).getByRole('link', { name: 'Gate code' }).closest('li')!;
      expect(other).not.toHaveTextContent('Waiting for its turn to test');
    });

    it('Ready rows show the level and the risky calls', () => {
      setup({ hosted });
      const row = (name: string) => within(group(/^Ready for you to try/)).getByRole('link', { name }).closest('li')!;
      expect(row('Weekly hours email').querySelector('.sb-auto-level')).toHaveTextContent('L3');
      expect(row('Weekly hours email')).toHaveTextContent('2 risky calls');
      expect(row('Technician photo').querySelector('.sb-auto-level')).toHaveTextContent('L1');
      expect(row('Technician photo')).toHaveTextContent('No risky calls');
      // Not known (an older laptop): no level chip and no count.
      expect(row('Old laptop job').querySelector('.sb-auto-level')).toBeNull();
      expect(row('Old laptop job')).not.toHaveTextContent(/risky call/i);
    });

    it('the paused line at the top', () => {
      for (const [paused, line] of [['limit', AUTO_PAUSED_LINE], ['limit-reading', AUTO_PAUSED_LINE], ['orbit', AUTO_PAUSED.orbit], ['memory', AUTO_PAUSED.memory]] as const) {
        const { container } = setup({ hosted, queue: { ...QUEUE, paused } });
        const status = screen.getByRole('status');
        expect(status).toHaveTextContent(line);
        // At the top: before the first group.
        const tab = container.querySelector('.sb-auto-tab')!;
        expect(tab.firstElementChild).toBe(status);
        cleanup();
      }
      setup({ hosted });
      expect(screen.queryByRole('status')).toBeNull();
      expect(document.body).not.toHaveTextContent('Auto is paused');
    });

    it('empty groups say so', () => {
      setup({ hosted, jobs: [job('mine', 'running', { title: 'Mine by hand', lane: 'working' })], queue: { ...QUEUE, working: 0 } });
      expect(within(group('Working · 0 of 5')).getByText('No Auto job is working.')).toBeInTheDocument();
      expect(within(group('Needs you, 0')).getByText('Nothing here needs you.')).toBeInTheDocument();
      expect(within(group('Ready for you to try, 0')).getByText('Nothing is ready yet.')).toBeInTheDocument();
    });
  });
}
