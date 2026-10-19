// The workshop floor: the Foreman pane with no job open, Play on. The Foreman says what to do next
// (longest wait first), the cards waiting for you come before the floor, and every open job has a
// card with its trail. Invented jobs only.
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Job, PlayMode } from '../api/types';
import { ForemanPane } from '../panes/Foreman/ForemanPane';
import { createStore, WorkshopContext } from '../state/store';
import { job, LEVELS, permission, snapshot } from '../state/test-fixtures';
import { askOf, closedText, floorJobs, floorSpeech, waited } from './floorModel';

const NOW = new Date(2026, 9, 16, 15, 0);
const at = (h: number, m: number, sec = 0) => new Date(2026, 9, 16, h, m, sec).toISOString();

const JOBS: Job[] = [
  job('newer', 'needs-you', { title: 'Widget export', stage: 'review', waitingFor: 'answers', waitingSince: at(14, 13), level: 2 }),
  job('older', 'needs-you', { title: 'Customer notes', stage: 'implement', waitingFor: 'approval', waitingSince: at(10, 0), level: 1 }),
  job('busy', 'running', { title: 'Bulk archive', stage: 'implement', level: 3 }),
  job('rest', 'idle', { title: 'Dark mode', stage: 'plan', level: 1 }),
  job('fin', 'done', { title: 'Footer typo', stage: 'pr1', level: 0, closed: { as: 'done', at: at(9, 0) } }),
];

function floor(mode: PlayMode, jobs: Job[] = JOBS) {
  const store = createStore();
  const snap = snapshot({ jobs, meta: { token: 't', levels: LEVELS, settings: { policy: 'hands-off', play: { mode, questDone: 'first-pr', sounds: false } } } });
  snap.permissions = [permission('p1', 'newer')];
  store.dispatch({ type: 'snapshot', snapshot: snap });
  return render(<WorkshopContext.Provider value={{ store, api: { get: vi.fn(), post: vi.fn() } as unknown as ApiClient }}><ForemanPane slug={null} /></WorkshopContext.Provider>);
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

describe('the workshop floor', () => {
  it('the Foreman says how many jobs need you and names them, longest wait first, with what each needs', () => {
    floor('subtle');
    const foreman = screen.getByRole('region', { name: 'The Foreman' });
    expect(within(foreman).getByRole('img', { name: 'Foreman, waiting' })).toHaveAttribute('width', '96');
    expect(foreman).toHaveTextContent('2 jobs need you. Longest wait first:');
    const asks = within(foreman).getAllByRole('link');
    expect(asks.map((a) => a.textContent)).toEqual([
      '▶Customer notesgive the go-ahead on Build · waiting 5h',
      '▶Widget exportanswer a question · waiting 47m',
    ]);
    expect(asks[0]).toHaveAttribute('href', '#/job/older');
  });

  it('puts the cards waiting for your answer before the floor', () => {
    const { container } = floor('subtle');
    const inbox = screen.getByRole('region', { name: 'Waiting for your answer' });
    const onFloor = screen.getByRole('region', { name: 'On the floor' });
    expect(inbox.compareDocumentPosition(onFloor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(inbox).getByRole('region', { name: 'Waiting in Widget export' })).toBeInTheDocument();
    expect(container.querySelector('.floor-grid .perm-card')).toBeNull();
  });

  it('a card per open job (done ones left out and counted), each with its trail and a link to open it', () => {
    floor('full');
    const onFloor = screen.getByRole('region', { name: 'On the floor' });
    expect(onFloor).toHaveTextContent('1 finished job is in the list on the left.');
    const titles = within(onFloor).getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(titles).toEqual(['Customer notes', 'Widget export', 'Bulk archive', 'Dark mode']);
    const busy = within(onFloor).getByRole('link', { name: 'Bulk archive' }).closest('li')!;
    expect(busy).toHaveAttribute('data-group', 'running');
    expect(busy.querySelector('.job-trail')).toHaveClass('is-card');
    expect(within(busy).getByRole('img', { name: 'Builder, working' })).toHaveAttribute('width', '48');
    expect(busy).toHaveTextContent('Now: Builder is building.');
    expect(busy).toHaveTextContent('Working');
  });

  it('nothing needs you: the Foreman names the crew at work; an empty workshop offers a new job', () => {
    floor('subtle', [JOBS[2], JOBS[4]]);
    expect(screen.getByRole('region', { name: 'The Foreman' })).toHaveTextContent('Nothing needs you. The crew are at work on 1 job.');
    expect(screen.getByRole('img', { name: 'Foreman, thinking' })).toBeInTheDocument();
  });

  it('an empty workshop: a quiet Foreman and a New job button', () => {
    floor('subtle', []);
    expect(screen.getByRole('region', { name: 'The Foreman' })).toHaveTextContent('The workshop is quiet. Start a new job when you’re ready.');
    expect(screen.getByRole('button', { name: 'New job' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'On the floor' })).toBeNull();
  });

  it('Off: the pane exactly as before', () => {
    const { container } = floor('off');
    expect(container.querySelector('.workshop-floor, .crew')).toBeNull();
    expect(screen.getByText('Pick a job on the left to see its conversation.')).toBeInTheDocument();
  });
});

describe('floorModel', () => {
  it('orders the open jobs: needs you (longest wait first), running, paused, idle', () => {
    const paused = job('zz', 'paused', { limitPaused: at(15, 42) });
    expect(floorJobs([...JOBS, paused]).map((j) => j.slug)).toEqual(['older', 'newer', 'busy', 'zz', 'rest']);
  });

  it('says how long in words that read: “47m”, “since yesterday”', () => {
    expect(waited(job('a', 'needs-you', { waitingSince: at(14, 13) }), NOW)).toBe('47m');
    expect(waited(job('a', 'needs-you', { waitingSince: new Date(2026, 9, 15, 9, 0).toISOString() }), NOW)).toBe('since yesterday');
    expect(waited(job('a', 'needs-you', { waitingSince: at(14, 59, 50) }), NOW)).toBe('');
  });

  it('counts finished and dropped jobs apart', () => {
    const dropped = job('d', 'done', { closed: { as: 'dropped', at: at(9, 0) } });
    expect(closedText([JOBS[4]])).toBe('1 finished job is');
    expect(closedText([JOBS[4], dropped])).toBe('1 finished and 1 dropped jobs are');
    expect(closedText([JOBS[0]])).toBe('');
  });

  it('the Foreman’s other moods: asleep in a usage pause, idle when nothing runs', () => {
    expect(floorSpeech([job('p', 'paused', { limitPaused: at(15, 42) })], null, NOW)).toMatchObject({ mood: 'asleep', say: 'Nothing needs you. The crew are asleep until Claude’s usage limit resets (1 job).' });
    expect(floorSpeech([job('i', 'idle')], null, NOW)).toMatchObject({ mood: 'idle', say: 'Nothing needs you and nothing is running. Open a job to carry on, or start a new one.' });
  });

  it('names at most four asks and counts the rest', () => {
    const many = Array.from({ length: 6 }, (_, i) => job(`j${i}`, 'needs-you', { waitingSince: at(9, i) }));
    const s = floorSpeech(many, null, NOW);
    expect(s.asks.map((a) => a.slug)).toEqual(['j0', 'j1', 'j2', 'j3']);
    expect(s.more).toBe(2);
  });

  it('says what each kind of ask needs', () => {
    expect(askOf(job('a', 'needs-you', { permissions: 2 }), NOW)).toBe('allow or deny 2 permissions');
    expect(askOf(job('a', 'needs-you', { permissions: 1 }), NOW)).toBe('allow or deny a step');
    expect(askOf(job('a', 'needs-you', {}), NOW)).toBe('reply to the Foreman');
  });
});
