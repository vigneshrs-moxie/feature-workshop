import { describe, expect, it } from 'vitest';
import { initialState, jobsByGroup, needsYouCount, reducer, type Action, type WorkshopState } from './reducer';
import { ev, job, permission, snapshot } from './test-fixtures';

const run = (state: WorkshopState, ...actions: Action[]) => actions.reduce(reducer, state);
const hydrated = () => reducer(initialState, { type: 'snapshot', snapshot: snapshot() });

describe('reducer: snapshot', () => {
  it('hydrates everything and becomes ready', () => {
    const s = hydrated();
    expect(s.status).toBe('ready');
    expect(s.jobs.map((j) => j.slug)).toEqual(['alpha', 'beta']);
    expect(s.seq).toBe(10);
    expect(s.epoch).toBe('aaaa');
    expect(s.meta?.token).toBe('tok-1');
    expect(s.jobsStale).toBe(false);
  });

  it('never steps seq back within one dashboard run, but resets it for a new run', () => {
    const s = run(hydrated(), { type: 'event', event: ev(15, 'change') });
    expect(reducer(s, { type: 'snapshot', snapshot: snapshot({ seq: 12 }) }).seq).toBe(15);
    expect(reducer(s, { type: 'snapshot', snapshot: snapshot({ seq: 3, epoch: 'bbbb' }) }).seq).toBe(3);
  });

  it('clears the stale and resync flags, and drops runs from an earlier dashboard run', () => {
    let s = run(hydrated(), { type: 'event', event: ev(11, 'run', 'beta', { id: 'r1', slug: 'beta', status: 'running' }) });
    expect(s.jobsStale).toBe(true);
    s = reducer(s, { type: 'snapshot', snapshot: snapshot({ seq: 11 }) });
    expect(s.jobsStale).toBe(false);
    expect(s.runs.beta?.status).toBe('running');
    s = reducer(s, { type: 'snapshot', snapshot: snapshot({ seq: 1, epoch: 'cccc' }) });
    expect(s.runs).toEqual({});
  });
});

describe('reducer: events', () => {
  it('ignores events it has already applied (replay overlap)', () => {
    const s = hydrated();
    expect(reducer(s, { type: 'event', event: ev(10, 'usage', null, { limited: true }) })).toBe(s);
    expect(reducer(s, { type: 'event', event: ev(9, 'thread', 'alpha') })).toBe(s);
  });

  it('ignores malformed events', () => {
    const s = hydrated();
    expect(reducer(s, { type: 'event', event: { v: 1, type: 'change', job: null, data: {}, seq: 20 } as never })).toBe(s);
    expect(reducer(s, { type: 'event', event: { v: 2, type: 'change', job: null, data: {}, seq: Number.NaN } })).toBe(s);
  });

  it('adds a permission card once and moves its job to Needs you at once', () => {
    const p = permission('p1', 'alpha');
    let s = run(hydrated(), { type: 'event', event: ev(11, 'permission', 'alpha', p) });
    expect(s.permissions).toEqual([p]);
    expect(s.jobs.find((j) => j.slug === 'alpha')).toMatchObject({ group: 'needs-you', permissions: 1, needsYou: true });
    expect(needsYouCount(s)).toBe(1);
    expect(s.jobsStale).toBe(true);
    // The same card again (a duplicate after a reconnect) doesn't double count.
    s = reducer(s, { type: 'event', event: ev(12, 'permission', 'alpha', p) });
    expect(s.permissions).toHaveLength(1);
    expect(s.jobs.find((j) => j.slug === 'alpha')?.permissions).toBe(1);
  });

  it('does not pull a done job into Needs you', () => {
    const s0 = reducer(initialState, { type: 'snapshot', snapshot: snapshot({ jobs: [job('gamma', 'done')] }) });
    const s = reducer(s0, { type: 'event', event: ev(11, 'permission', 'gamma', permission('p9', 'gamma')) });
    expect(s.jobs[0].group).toBe('done');
  });

  it('removes a card that went away', () => {
    let s = run(hydrated(), { type: 'event', event: ev(11, 'permission', 'alpha', permission('p1', 'alpha')) });
    s = reducer(s, { type: 'event', event: ev(12, 'permission-gone', 'alpha', { id: 'p1', slug: 'alpha', reason: 'answered' }) });
    expect(s.permissions).toEqual([]);
    expect(s.jobs.find((j) => j.slug === 'alpha')?.permissions).toBe(0);
    expect(s.seq).toBe(12);
  });

  it('a card unknown to this page going away only moves seq on', () => {
    const s = reducer(hydrated(), { type: 'event', event: ev(11, 'permission-gone', 'alpha', { id: 'nope' }) });
    expect(s.permissions).toEqual([]);
    expect(s.seq).toBe(11);
  });

  it('keeps the latest run per job', () => {
    const s = run(
      hydrated(),
      { type: 'event', event: ev(11, 'run', 'beta', { id: 'r1', slug: 'beta', status: 'running' }) },
      { type: 'event', event: ev(12, 'run', 'beta', { id: 'r1', slug: 'beta', status: 'done' }) },
    );
    expect(s.runs.beta.status).toBe('done');
  });

  it('replaces usage', () => {
    const s = reducer(hydrated(), { type: 'event', event: ev(11, 'usage', null, { limited: true, blocking: true, label: '5-hour limit', resetsAt: null }) });
    expect(s.usage?.limited).toBe(true);
  });

  it('bumps the thread version of only the job that changed', () => {
    const s = run(hydrated(), { type: 'event', event: ev(11, 'thread', 'alpha') }, { type: 'event', event: ev(12, 'thread', 'alpha') });
    expect(s.threadVersions).toEqual({ alpha: 2 });
  });

  it('live-only and unknown events move seq without marking jobs stale', () => {
    const s = run(hydrated(), { type: 'event', event: ev(11, 'local', 'alpha', { chunk: 'x' }) }, { type: 'event', event: ev(12, 'something-new') });
    expect(s.seq).toBe(12);
    expect(s.jobsStale).toBe(false);
  });

  it('resync: asks for a snapshot and carries on from the new run and seq', () => {
    const before = run(hydrated(), { type: 'event', event: ev(40, 'change') });
    const s = reducer(before, { type: 'event', event: ev(2, 'resync', null, { reason: 'restarted', epoch: 'bbbb' }) });
    expect(s.resyncNeeded).toBe(true);
    expect(s.epoch).toBe('bbbb');
    expect(s.seq).toBe(2);
    // Events of the new run after the resync point are applied, not mistaken for old ones.
    const after = reducer(s, { type: 'event', event: ev(3, 'usage', null, { limited: false }) });
    expect(after.seq).toBe(3);
    const fresh = reducer(after, { type: 'snapshot', snapshot: snapshot({ seq: 2, epoch: 'bbbb' }) });
    expect(fresh.resyncNeeded).toBe(false);
    expect(fresh.seq).toBe(3);
  });
});

describe('reducer: connection and errors', () => {
  it('records the connection state, returning the same state when unchanged', () => {
    const s = reducer(initialState, { type: 'connection', connection: 'live' });
    expect(s.connection).toBe('live');
    expect(reducer(s, { type: 'connection', connection: 'live' })).toBe(s);
  });

  it('an error before any snapshot shows in place; after one, the page keeps its data', () => {
    expect(reducer(initialState, { type: 'error', error: 'down' }).status).toBe('error');
    const s = reducer(hydrated(), { type: 'error', error: 'down' });
    expect(s.status).toBe('ready');
    expect(s.error).toBe('down');
    expect(reducer(s, { type: 'snapshot', snapshot: snapshot() }).error).toBeNull();
  });
});

describe('selectors', () => {
  it('groups jobs in Jobs-pane order', () => {
    const s = reducer(initialState, { type: 'snapshot', snapshot: snapshot({ jobs: [job('a', 'done'), job('b', 'needs-you'), job('c', 'idle')] }) });
    const g = jobsByGroup(s);
    expect(g['needs-you'].map((j) => j.slug)).toEqual(['b']);
    expect(g.done.map((j) => j.slug)).toEqual(['a']);
    expect(g.running).toEqual([]);
  });
});
