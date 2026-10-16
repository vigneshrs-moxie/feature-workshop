import { describe, expect, it, vi } from 'vitest';
import type { Job } from '../api/types';
import { createStore } from '../state/store';
import { job, snapshot } from '../state/test-fixtures';
import { commandsFor, filterCommands, jobsInOrder, type CommandHandlers } from './commands';
import type { CurrentJob } from './ui';

// Invented jobs only.
const classic = { home: () => '/#/', job: (s: string) => `/#/job/${s}`, costs: () => '/#/costs', history: () => '/#/history' };

function handlers(): CommandHandlers {
  return {
    openJob: vi.fn(), newJob: vi.fn(), stop: vi.fn(), focusComposer: vi.fn(), markDone: vi.fn(), reopen: vi.fn(),
    setPolicy: vi.fn(), jobDrawer: vi.fn(), settings: vi.fn(), classic: vi.fn(), showKeys: vi.fn(),
  };
}

function stateWith(jobs: Job[], settings?: Record<string, unknown>) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, meta: { token: 't', settings: settings as never } }) });
  return store.getState();
}

const ids = (list: { id: string }[]) => list.map((c) => c.id);

describe('commandsFor', () => {
  it('with no job open: new job, every job, settings, classic links and the keys list', () => {
    const state = stateWith([job('alpha', 'idle'), job('beta', 'needs-you')]);
    const list = commandsFor({ state, slug: null, current: null, onSettings: false, classic }, handlers());
    expect(ids(list)).toEqual(['new-job', 'open:beta', 'open:alpha', 'settings', 'classic-home', 'classic-costs', 'classic-history', 'keys']);
    expect(list.find((c) => c.id === 'new-job')?.keys).toBe('c');
  });

  it('offers Stop and Steer while the open job replies, and no Mark done', () => {
    const state = stateWith([job('alpha', 'running')]);
    const current: CurrentJob = { slug: 'alpha', run: { id: 'run-7', slug: 'alpha', status: 'running' }, dir: '/jobs/alpha' };
    const h = handlers();
    const list = commandsFor({ state, slug: 'alpha', current, onSettings: false, classic }, h);
    expect(ids(list)).toContain('stop');
    expect(ids(list)).toContain('steer');
    expect(ids(list)).not.toContain('mark-done');
    expect(ids(list)).not.toContain('open:alpha'); // already open
    list.find((c) => c.id === 'stop')!.run();
    expect(h.stop).toHaveBeenCalledWith('run-7');
  });

  it('offers no Stop once the reply is stopping', () => {
    const state = stateWith([job('alpha', 'running')]);
    const current: CurrentJob = { slug: 'alpha', run: { id: 'run-7', slug: 'alpha', status: 'stopping' } };
    expect(ids(commandsFor({ state, slug: 'alpha', current, onSettings: false, classic }, handlers()))).not.toContain('stop');
  });

  it('offers Mark done for an idle job and Reopen for one marked done', () => {
    const idle = commandsFor({ state: stateWith([job('alpha', 'idle')]), slug: 'alpha', current: { slug: 'alpha', run: null }, onSettings: false, classic }, handlers());
    expect(ids(idle)).toEqual(expect.arrayContaining(['write', 'mark-done', 'job-drawer', 'classic-job']));
    expect(ids(idle)).not.toContain('reopen');

    const h = handlers();
    const done = commandsFor({ state: stateWith([job('alpha', 'done', { closed: { as: 'done' } })]), slug: 'alpha', current: null, onSettings: false, classic }, h);
    expect(ids(done)).toContain('reopen');
    expect(ids(done)).not.toContain('mark-done');
    done.find((c) => c.id === 'reopen')!.run();
    expect(h.reopen).toHaveBeenCalledWith('alpha');
  });

  it('offers “Job notes and options” for the open job, opening its drawer; the classic Options entry is gone', () => {
    const h = handlers();
    const list = commandsFor({ state: stateWith([job('alpha', 'idle')]), slug: 'alpha', current: { slug: 'alpha', run: null }, onSettings: false, classic }, h);
    const entry = list.find((c) => c.id === 'job-drawer')!;
    expect(entry.label).toBe('Job notes and options');
    expect(entry.hint).toMatch(/notes\.md/);
    entry.run();
    expect(h.jobDrawer).toHaveBeenCalledWith('alpha');
    expect(h.classic).not.toHaveBeenCalled();
    expect(list.some((c) => /Options \(classic view\)/.test(c.label))).toBe(false);
    expect(ids(filterCommands(list, 'notes'))).toEqual(['job-drawer']);
    expect(ids(filterCommands(list, 'reviewers'))).toEqual(['job-drawer']);
    // No job open: no drawer to offer.
    expect(ids(commandsFor({ state: stateWith([job('alpha', 'idle')]), slug: null, current: null, onSettings: false, classic }, h))).not.toContain('job-drawer');
  });

  it('offers the job’s permission settings other than the one in force, and not auto mode when it isn’t available', () => {
    const settings = { policy: 'hands-off', jobPolicy: { '/jobs/alpha': 'ask-all' }, autoMode: { available: false, reason: 'Not on this plan.', checkedAt: null } };
    const state = stateWith([job('alpha', 'idle')], settings);
    const h = handlers();
    const list = commandsFor({ state, slug: 'alpha', current: { slug: 'alpha', run: null, dir: '/jobs/alpha' }, onSettings: false, classic }, h);
    const policy = list.filter((c) => c.id.startsWith('policy-'));
    expect(ids(policy)).toEqual(['policy-follow', 'policy-hands-off']);
    policy[0].run();
    expect(h.setPolicy).toHaveBeenCalledWith('alpha', null);
  });

  it('leaves Settings out while you’re on it', () => {
    const list = commandsFor({ state: stateWith([]), slug: null, current: null, onSettings: true, classic }, handlers());
    expect(ids(list)).not.toContain('settings');
  });
});

describe('filterCommands', () => {
  it('keeps the commands whose label or keywords hold every word', () => {
    const list = commandsFor({ state: stateWith([job('alpha', 'idle')]), slug: 'alpha', current: { slug: 'alpha', run: null }, onSettings: false, classic }, handlers());
    expect(ids(filterCommands(list, 'mark'))).toEqual(['mark-done']);
    expect(ids(filterCommands(list, 'classic costs'))).toEqual(['classic-job', 'classic-costs']);
    expect(ids(filterCommands(list, 'costs GO TO'))).toEqual(['classic-costs']); // the section counts too
    expect(ids(filterCommands(list, 'archive'))).toEqual(['mark-done']); // a keyword
    expect(filterCommands(list, '  ')).toHaveLength(list.length);
    expect(filterCommands(list, 'zzz')).toEqual([]);
  });
});

describe('jobsInOrder', () => {
  it('follows the Jobs pane: Needs you first, Done last', () => {
    const state = stateWith([job('d', 'done'), job('i', 'idle'), job('n', 'needs-you'), job('r', 'running')]);
    expect(jobsInOrder(state).map((j) => j.slug)).toEqual(['n', 'r', 'i', 'd']);
  });
});
