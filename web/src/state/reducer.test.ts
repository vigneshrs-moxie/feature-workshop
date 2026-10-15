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

  it('a run marks jobs stale only when it starts, ends or changes status', () => {
    const r = (seq: number, status: string, extra: Record<string, unknown> = {}) =>
      ({ type: 'event', event: ev(seq, 'run', 'beta', { id: 'r1', slug: 'beta', status, ...extra }) }) as Action;
    let s = run(hydrated(), r(11, 'running'));
    expect(s.jobsStale).toBe(true); // a new run
    s = reducer(s, { type: 'snapshot', snapshot: snapshot({ seq: 11 }) });
    s = run(s, r(12, 'running', { lastAction: 'Reading a file' }), r(13, 'running', { lastText: 'Working on it.' }));
    expect(s.jobsStale).toBe(false); // progress only: no snapshot refetch
    expect(s.runs.beta.lastText).toBe('Working on it.');
    s = reducer(s, r(14, 'done'));
    expect(s.jobsStale).toBe(true); // it ended
    s = run(reducer(s, { type: 'snapshot', snapshot: snapshot({ seq: 14 }) }), { type: 'event', event: ev(15, 'run', 'beta', { id: 'r2', slug: 'beta', status: 'done' }) });
    expect(s.jobsStale).toBe(true); // another run, even with the same status
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

  it('refetches every thread after a resync or a dashboard restart, but not on an ordinary snapshot', () => {
    let s = hydrated();
    expect(s.threadEpoch).toBe(0);
    s = reducer(s, { type: 'snapshot', snapshot: snapshot({ seq: 12 }) });
    expect(s.threadEpoch).toBe(0); // same run, no gap
    s = run(s, { type: 'event', event: ev(2, 'resync', null, { reason: 'restarted', epoch: 'bbbb' }) }, { type: 'snapshot', snapshot: snapshot({ seq: 2, epoch: 'bbbb' }) });
    expect(s.threadEpoch).toBe(1);
    s = reducer(s, { type: 'snapshot', snapshot: snapshot({ seq: 1, epoch: 'cccc' }) });
    expect(s.threadEpoch).toBe(2); // a restart seen only through the snapshot
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

describe('reducer: cards and rules', () => {
  it('drops a card you answered here at once, and the later permission-gone is harmless', () => {
    let s = run(hydrated(), { type: 'event', event: ev(11, 'permission', 'alpha', permission('p1', 'alpha')) });
    s = reducer(s, { type: 'permission-answered', id: 'p1' });
    expect(s.permissions).toEqual([]);
    expect(s.jobs.find((j) => j.slug === 'alpha')?.permissions).toBe(0);
    expect(s.jobsStale).toBe(true);
    const after = reducer(s, { type: 'event', event: ev(12, 'permission-gone', 'alpha', { id: 'p1', slug: 'alpha' }) });
    expect(after.jobs.find((j) => j.slug === 'alpha')?.permissions).toBe(0);
    expect(reducer(after, { type: 'permission-answered', id: 'p1' })).toBe(after);
  });

  it('a rules event bumps rulesVersion so Settings refetches', () => {
    const s = reducer(hydrated(), { type: 'event', event: ev(11, 'rules', null, { count: 2 }) });
    expect(s.rulesVersion).toBe(1);
    expect(s.seq).toBe(11);
  });

  it('a settings event (or your own change) replaces meta.settings', () => {
    const s = reducer(hydrated(), { type: 'event', event: ev(11, 'settings', null, { policy: 'auto', jobPolicy: { '/f/alpha': 'ask-all' } }) });
    expect(s.meta?.settings?.policy).toBe('auto');
    expect(s.meta?.token).toBe('tok-1');
    expect(reducer(s, { type: 'event', event: ev(12, 'settings', null, { nonsense: true }) }).meta?.settings?.policy).toBe('auto');
    expect(reducer(s, { type: 'settings', settings: { policy: 'ask-all' } }).meta?.settings?.policy).toBe('ask-all');
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

describe('reducer: steer', () => {
  const st = (state: 'queued' | 'delivered' | 'acted-on' | 'cancelled') => ({ id: 'st-1', runId: 'r1', slug: 'alpha', text: 'Use the small table.', state });
  it('tracks a steered message’s state from steer events, run events and your own POST, only ever forward', () => {
    let s = run(hydrated(), { type: 'steer', steer: st('queued') });
    expect(s.steers['st-1'].state).toBe('queued');
    s = run(s, { type: 'event', event: ev(11, 'steer', 'alpha', st('delivered')) });
    expect(s.steers['st-1'].state).toBe('delivered');
    s = run(s, { type: 'steer', steer: st('queued') });
    expect(s.steers['st-1'].state).toBe('delivered');
    s = run(s, { type: 'event', event: ev(12, 'run', 'alpha', { id: 'r1', slug: 'alpha', status: 'running', steers: [st('acted-on')] }) });
    expect(s.steers['st-1'].state).toBe('acted-on');
  });
  it('forgets steered messages after a dashboard restart', () => {
    const s = run(hydrated(), { type: 'steer', steer: st('queued') }, { type: 'snapshot', snapshot: snapshot({ epoch: 'bbbb' }) });
    expect(s.steers).toEqual({});
  });
});
