import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Snapshot } from '../api/types';
import { createLiveSync, type EventSourceLike } from './live';
import { createStore } from './store';
import { ev, permission, snapshot } from './test-fixtures';

class FakeStream implements EventSourceLike {
  readyState = 0;
  onopen: EventSourceLike['onopen'] = null;
  onmessage: EventSourceLike['onmessage'] = null;
  onerror: EventSourceLike['onerror'] = null;
  closed = false;
  constructor(public url: string) {}
  open() { this.readyState = 1; this.onopen?.(new Event('open')); }
  send(data: unknown) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) })); }
  sendRaw(data: string) { this.onmessage?.(new MessageEvent('message', { data })); }
  /** The connection dropped; closed: the browser gave up instead of retrying. */
  fail(closed = false) { this.readyState = closed ? 2 : 0; this.onerror?.(new Event('error')); }
  close() { this.closed = true; this.readyState = 2; }
}

function setup(snapshots: Array<Snapshot | Error>) {
  const queue = [...snapshots];
  const calls = { snapshot: 0 };
  const api = {
    snapshot: vi.fn(async () => {
      calls.snapshot++;
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      if (next instanceof Error) throw next;
      return next;
    }),
    setToken: vi.fn(),
  } as unknown as ApiClient;
  const store = createStore();
  const streams: FakeStream[] = [];
  const sync = createLiveSync({
    api, store, staleDelayMs: 400, retryMinMs: 1000, retryMaxMs: 8000,
    openStream: (url) => { const s = new FakeStream(url); streams.push(s); return s; },
  });
  return { api, store, streams, sync, calls, queue };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('live sync', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('hydrates from the snapshot, then opens the stream from its seq and epoch', async () => {
    const t = setup([snapshot({ seq: 7, epoch: 'abcd' })]);
    await t.sync.start();
    expect(t.store.getState().status).toBe('ready');
    expect(t.streams).toHaveLength(1);
    expect(t.streams[0].url).toBe('/api/events?v=2&since=7&epoch=abcd');
    expect(t.store.getState().connection).toBe('connecting');
    t.streams[0].open();
    expect(t.store.getState().connection).toBe('live');
    t.sync.stop();
  });

  it('applies events, and refetches the snapshot once after a burst of job-moving events', async () => {
    const t = setup([snapshot()]);
    await t.sync.start();
    t.streams[0].open();
    t.streams[0].send(ev(11, 'permission', 'alpha', permission('p1', 'alpha')));
    t.streams[0].send(ev(12, 'run', 'beta', { id: 'r', slug: 'beta', status: 'running' }));
    t.streams[0].send(ev(13, 'change'));
    expect(t.store.getState().permissions).toHaveLength(1);
    expect(t.calls.snapshot).toBe(1);
    await vi.advanceTimersByTimeAsync(399);
    expect(t.calls.snapshot).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.calls.snapshot).toBe(2);
    expect(t.store.getState().jobsStale).toBe(false);
    t.sync.stop();
  });

  it('ignores a message that is not JSON', async () => {
    const t = setup([snapshot()]);
    await t.sync.start();
    const before = t.store.getState();
    t.streams[0].sendRaw('not json');
    expect(t.store.getState()).toBe(before);
    t.sync.stop();
  });

  it('a resync event fetches a fresh snapshot at once', async () => {
    const t = setup([snapshot({ seq: 30, epoch: 'aaaa' }), snapshot({ seq: 2, epoch: 'bbbb', jobs: [] })]);
    await t.sync.start();
    t.streams[0].open();
    t.streams[0].send(ev(2, 'resync', null, { reason: 'restarted', epoch: 'bbbb' }));
    await flush();
    expect(t.calls.snapshot).toBe(2);
    const s = t.store.getState();
    expect(s.epoch).toBe('bbbb');
    expect(s.jobs).toEqual([]);
    expect(s.resyncNeeded).toBe(false);
    t.sync.stop();
  });

  it('when the browser retries by itself: shows reconnecting, keeps the stream, refetches once it is back', async () => {
    const t = setup([snapshot()]);
    await t.sync.start();
    t.streams[0].open();
    t.streams[0].fail(false);
    expect(t.store.getState().connection).toBe('reconnecting');
    expect(t.streams).toHaveLength(1);
    expect(t.streams[0].closed).toBe(false);
    t.streams[0].open(); // the browser reconnected (sending Last-Event-ID)
    await flush();
    expect(t.store.getState().connection).toBe('live');
    expect(t.calls.snapshot).toBe(2);
    t.sync.stop();
  });

  it('when the browser gives up: reopens the stream itself with backoff, from the latest seq', async () => {
    const t = setup([snapshot({ seq: 10, epoch: 'aaaa' })]);
    await t.sync.start();
    t.streams[0].open();
    t.streams[0].send(ev(14, 'usage', null, { limited: false }));
    t.streams[0].fail(true);
    expect(t.streams[0].closed).toBe(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(t.streams).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.streams).toHaveLength(2);
    expect(t.streams[1].url).toBe('/api/events?v=2&since=14&epoch=aaaa');
    // Fails again: the wait doubles.
    t.streams[1].fail(true);
    await vi.advanceTimersByTimeAsync(1999);
    expect(t.streams).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.streams).toHaveLength(3);
    // Back: live again, a snapshot refetch, and the wait resets.
    const fetched = t.calls.snapshot;
    t.streams[2].open();
    await flush();
    expect(t.store.getState().connection).toBe('live');
    expect(t.calls.snapshot).toBe(fetched + 1);
    t.streams[2].fail(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.streams).toHaveLength(4);
    t.sync.stop();
  });

  it('events from a stream that was replaced are ignored', async () => {
    const t = setup([snapshot()]);
    await t.sync.start();
    const old = t.streams[0];
    old.fail(true);
    await vi.advanceTimersByTimeAsync(1000);
    const seq = t.store.getState().seq;
    old.send(ev(99, 'change'));
    expect(t.store.getState().seq).toBe(seq);
    t.sync.stop();
  });

  it('when the first snapshot fails: shows the error, retries by itself, then opens the stream', async () => {
    const t = setup([new Error('connection refused'), snapshot()]);
    await t.sync.start();
    expect(t.store.getState().status).toBe('error');
    expect(t.store.getState().error).toMatch(/connection refused/);
    expect(t.streams).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.store.getState().status).toBe('ready');
    expect(t.streams).toHaveLength(1);
    t.sync.stop();
  });

  it('asking for a snapshot during a fetch queues exactly one more', async () => {
    const t = setup([snapshot()]);
    await t.sync.start();
    const a = t.sync.refresh();
    const b = t.sync.refresh();
    const c = t.sync.refresh();
    await Promise.all([a, b, c]);
    expect(t.calls.snapshot).toBe(3); // start, then one fetch plus one queued
    t.sync.stop();
  });

  it('stop closes the stream and cancels pending work', async () => {
    const t = setup([snapshot()]);
    await t.sync.start();
    t.streams[0].open();
    t.streams[0].send(ev(11, 'change'));
    t.sync.stop();
    expect(t.streams[0].closed).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.calls.snapshot).toBe(1);
  });
});
