// @vitest-environment node
// The job page's store: one per open job, fetches only when the server says something changed,
// keeps every unchanged part's identity, fetches each body once, and keeps the last good data on a
// failed fetch. Built against the made-up long job.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveEvent } from '../api/types';
import { longJob } from './fixtures/longJob';
import type { JobApi } from './api';
import { createJobStore, prefetchOrder } from './jobStore';
import type { JobBody, JobPagePayload, SamePage } from './types';

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const base = () => clone(longJob.payload) as unknown as JobPagePayload;
const bodyOf = (id: string): JobBody => {
  const b = longJob.bodies[id];
  return { ...b, version: String(b.meta.hash ?? b.id) };
};

/** A fake server: answers with `current`, counts every request. */
function server(start: JobPagePayload = base()) {
  let current = start;
  let failNext: Error | null = null;
  const pages: Array<number | null> = [];
  const items: string[] = [];
  const api: JobApi = {
    async page(slug, v): Promise<JobPagePayload | SamePage> {
      pages.push(v);
      expect(slug).toBe(SLUG);
      if (failNext) { const e = failNext; failNext = null; throw e; }
      return v === current.v ? { same: true, v } : clone(current);
    },
    async item(_slug, id) {
      items.push(id);
      if (failNext) { const e = failNext; failNext = null; throw e; }
      return bodyOf(id);
    },
  };
  return {
    api, pages, items,
    set(next: JobPagePayload) { current = next; },
    fail(e: Error) { failNext = e; },
  };
}

/** The app's one event stream, faked: the store taps it. */
function stream() {
  const listeners = new Set<(e: LiveEvent) => void>();
  let seq = 0;
  return {
    events: (fn: (e: LiveEvent) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    send(type: string, job: string | null, data: unknown = {}) {
      for (const fn of [...listeners]) fn({ v: 2, type, job, data, seq: ++seq });
    },
    count: () => listeners.size,
  };
}

const settle = () => new Promise((r) => setImmediate(r));

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('job store: the payload', () => {
  it('first load asks without a v and holds the payload', async () => {
    const s = server();
    const store = createJobStore(SLUG, { api: s.api, events: stream().events });
    expect(store.getState().payload).toBeNull();
    await store.loadPage();
    expect(s.pages).toEqual([null]);
    expect(store.getState().payload?.title).toBe('Crew schedule export');
    expect(store.getState().error).toBeNull();
  });

  it('a job-page event with the v it holds fetches nothing', async () => {
    const s = server();
    const live = stream();
    const store = createJobStore(SLUG, { api: s.api, events: live.events });
    await store.loadPage();
    live.send('job-page', SLUG, { slug: SLUG, v: 1 });
    live.send('job-page', SLUG, { slug: SLUG, v: 0 });
    await settle();
    expect(s.pages).toEqual([null]);
  });

  it('a newer v fetches once, with the v it holds, and keeps every unchanged part as it was', async () => {
    const s = server();
    const live = stream();
    const store = createJobStore(SLUG, { api: s.api, events: live.events });
    await store.loadPage();
    const before = store.getState().payload!;
    const next = base();
    next.v = 2;
    next.thread.push({ id: 'reply:new000000000', kind: 'reply', at: '2026-11-04T15:00:00.000Z', step: 'review', headline: 'A new reply.', mine: false, hash: 'aaaaaaaaaaaa' });
    next.rows.conversation.count += 1;
    next.steps[5].word = '0 open';
    s.set(next);
    let notified = 0;
    store.subscribe(() => { notified++; });
    live.send('job-page', SLUG, { slug: SLUG, v: 2 });
    await settle();
    expect(s.pages).toEqual([null, 1]);
    expect(notified).toBe(1);
    const after = store.getState().payload!;
    expect(after.v).toBe(2);
    // Unchanged top-level parts, steps and lines keep their identity.
    expect(after.facts).toBe(before.facts);
    expect(after.move).toBe(before.move);
    expect(after.prs).toBe(before.prs);
    expect(after.open).toBe(before.open);
    for (let i = 0; i < before.thread.length; i++) expect(after.thread[i]).toBe(before.thread[i]);
    for (const i of [0, 1, 2, 3, 4, 6]) expect(after.steps[i]).toBe(before.steps[i]);
    expect(after.steps[5].outputs).toBe(before.steps[5].outputs);
    // What changed is new.
    expect(after.thread).not.toBe(before.thread);
    expect(after.steps).not.toBe(before.steps);
    expect(after.steps[5]).not.toBe(before.steps[5]);
    expect(after.rows.decisions).toBe(before.rows.decisions);
    expect(after.rows.conversation).not.toBe(before.rows.conversation);
  });

  it('a newer v whose content is the same keeps every part, only v moves', async () => {
    const s = server();
    const live = stream();
    const store = createJobStore(SLUG, { api: s.api, events: live.events });
    await store.loadPage();
    const before = store.getState().payload!;
    s.set({ ...base(), v: 5 });
    live.send('job-page', SLUG, { slug: SLUG, v: 5 });
    await settle();
    const after = store.getState().payload!;
    expect(after.v).toBe(5);
    for (const k of Object.keys(before) as (keyof JobPagePayload)[]) if (k !== 'v') expect(after[k]).toBe(before[k]);
  });

  it('a "same" answer changes nothing and tells no one', async () => {
    const s = server();
    const store = createJobStore(SLUG, { api: s.api, events: stream().events });
    await store.loadPage();
    const state = store.getState();
    let notified = 0;
    store.subscribe(() => { notified++; });
    await store.loadPage();
    expect(s.pages).toEqual([null, 1]);
    expect(store.getState()).toBe(state);
    expect(notified).toBe(0);
  });

  it('an event for another job, or another type on the laptop, fetches nothing', async () => {
    const s = server();
    const live = stream();
    const store = createJobStore(SLUG, { api: s.api, events: live.events });
    await store.loadPage();
    live.send('job-page', 'another-job', { slug: 'another-job', v: 9 });
    live.send('thread', SLUG);
    live.send('change', SLUG);
    live.send('run', SLUG, { id: 'r', status: 'running' });
    await settle();
    expect(s.pages).toEqual([null]);
  });

  it('on the website it refetches on thread and change for its job, since no job-page event comes', async () => {
    const s = server({ ...base(), hosted: true });
    const live = stream();
    const store = createJobStore(SLUG, { api: s.api, events: live.events });
    await store.loadPage();
    live.send('thread', SLUG);
    await settle();
    live.send('change', SLUG);
    await settle();
    live.send('thread', 'another-job');
    await settle();
    expect(s.pages).toEqual([null, 1, 1]);
  });

  it('asks made while a fetch is out cost one more fetch, not one each', async () => {
    const s = server();
    const store = createJobStore(SLUG, { api: s.api, events: stream().events });
    await Promise.all([store.loadPage(), store.loadPage(), store.loadPage()]);
    expect(s.pages).toEqual([null, 1]);
  });

  it('an older payload arriving late never replaces a newer one', async () => {
    const s = server({ ...base(), v: 7 });
    const store = createJobStore(SLUG, { api: s.api, events: stream().events });
    await store.loadPage();
    s.set({ ...base(), v: 6, title: 'Old title' });
    await store.loadPage();
    expect(store.getState().payload?.v).toBe(7);
    expect(store.getState().payload?.title).toBe('Crew schedule export');
  });

  it('a failed fetch keeps the last good payload and sets one error line; the next good one clears it', async () => {
    const s = server();
    const live = stream();
    const store = createJobStore(SLUG, { api: s.api, events: live.events });
    await store.loadPage();
    const good = store.getState().payload;
    s.set({ ...base(), v: 2 });
    s.fail(new Error('Starbase answered 500.'));
    live.send('job-page', SLUG, { slug: SLUG, v: 2 });
    await settle();
    expect(store.getState().payload).toBe(good);
    expect(store.getState().error).toBe('Couldn’t load this job: Starbase answered 500.');
    s.fail(new Error('Starbase answered 502.'));
    await store.loadPage();
    expect(store.getState().error).toBe('Couldn’t load this job: Starbase answered 502.');
    await store.loadPage();
    expect(store.getState().error).toBeNull();
    expect(store.getState().payload?.v).toBe(2);
  });

  it('destroy stops listening to the stream', async () => {
    const live = stream();
    const store = createJobStore(SLUG, { api: server().api, events: live.events });
    expect(live.count()).toBe(1);
    store.destroy();
    expect(live.count()).toBe(0);
  });

  it('starts no timer', async () => {
    const s = server();
    const live = stream();
    const store = createJobStore(SLUG, { api: s.api, events: live.events });
    await store.loadPage();
    live.send('job-page', SLUG, { slug: SLUG, v: 3 });
    await store.loadBody('spec');
    await store.prefetch();
    store.setDraft('hello');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('job store: bodies', () => {
  it('loadBody twice makes one request, at once or later', async () => {
    const s = server();
    const store = createJobStore(SLUG, { api: s.api, events: stream().events });
    await store.loadPage();
    const [a, b] = await Promise.all([store.loadBody('reply:bb51ba3f5815'), store.loadBody('reply:bb51ba3f5815')]);
    const c = await store.loadBody('reply:bb51ba3f5815');
    expect(s.items).toEqual(['reply:bb51ba3f5815']);
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(store.getState().bodies['reply:bb51ba3f5815'].html).toContain('The file name repeats');
  });

  it('a body whose line hash changed on a newer v is fetched again', async () => {
    const s = server();
    const live = stream();
    const store = createJobStore(SLUG, { api: s.api, events: live.events });
    await store.loadPage();
    await store.loadBody('reply:bb51ba3f5815');
    await store.loadBody('spec');
    const next = base();
    next.v = 2;
    next.thread[next.thread.length - 1].hash = 'bbbbbbbbbbbb';
    s.set(next);
    live.send('job-page', SLUG, { slug: SLUG, v: 2 });
    await settle();
    expect(store.getState().bodies['reply:bb51ba3f5815']).toBeUndefined();
    expect(store.getState().bodies.spec).toBeDefined();
    await store.loadBody('reply:bb51ba3f5815');
    expect(s.items).toEqual(['reply:bb51ba3f5815', 'spec', 'reply:bb51ba3f5815']);
  });

  it('a document whose hash moved on a newer v is fetched again; one with no hash is kept', async () => {
    const start = base();
    const docOf = (p: JobPagePayload, id: string) => p.steps.flatMap((st) => st.outputs).filter((o) => o.id === id);
    for (const o of docOf(start, 'spec')) o.hash = 'spec';
    const s = server(start);
    const live = stream();
    const store = createJobStore(SLUG, { api: s.api, events: live.events });
    await store.loadPage();
    await store.loadBody('spec');
    await store.loadBody('findings.md');
    const next = clone(start);
    next.v = 2;
    for (const o of docOf(next, 'spec')) o.hash = 'cccccccccccc';
    s.set(next);
    live.send('job-page', SLUG, { slug: SLUG, v: 2 });
    await settle();
    expect(store.getState().bodies.spec).toBeUndefined();
    expect(store.getState().bodies['findings.md']).toBeDefined();
  });

  it('a failed body keeps what is held, sets the one error line, and is asked again next time', async () => {
    const s = server();
    const store = createJobStore(SLUG, { api: s.api, events: stream().events });
    await store.loadPage();
    s.fail(new Error('Starbase answered 404.'));
    await expect(store.loadBody('spec')).resolves.toBeNull();
    expect(store.getState().error).toBe('Couldn’t load that part of the job: Starbase answered 404.');
    expect(store.getState().payload?.v).toBe(1);
    await store.loadBody('spec');
    expect(s.items).toEqual(['spec', 'spec']);
    expect(store.getState().error).toBeNull();
  });
});

describe('job store: prefetch', () => {
  it('orders bodies: the reader’s view, the last exchange, the current step’s outputs, then the rest newest first', () => {
    const p = base();
    const order = prefetchOrder(p);
    const lines = p.thread.map((l) => l.id);
    // The reader's view, then the last exchange: from his last message to the end, newest first.
    expect(order.slice(0, 3)).toEqual(['brief:briefs/015-review.md', 'reply:bb51ba3f5815', 'you:ff6dfb006203']);
    // Then the current step's (Review's) documents, in the step's order.
    const review = p.steps.find((s) => s.state === 'current')!.outputs.filter((o) => o.kind === 'doc').map((o) => o.id);
    expect(order.slice(3, 3 + review.length)).toEqual(review);
    // Then the other lines, newest first, then the other steps' documents from the latest step back.
    const rest = order.slice(3 + review.length);
    expect(rest[0]).toBe('note:77b7399419d4');
    const restLines = rest.filter((id) => lines.includes(id));
    const shown = new Set(order.slice(0, 3));
    expect(restLines).toEqual([...lines].reverse().filter((id) => !shown.has(id)));
    expect(rest.slice(restLines.length)).toEqual(['test-report.md', 'implementation-plan.md', 'implementation-log.md', 'test-plan.md', 'acceptance.md', 'findings.md', 'spec', 'decisions']);
    // Each id once.
    expect(new Set(order).size).toBe(order.length);
  });

  it('a conversation view on arrival starts with the last exchange', () => {
    const p = base();
    p.open = { kind: 'conversation', id: 'conversation' };
    expect(prefetchOrder(p).slice(0, 3)).toEqual(['reply:bb51ba3f5815', 'you:ff6dfb006203', 'review.md']);
  });

  it('prefetch fetches in that order, one at a time, skipping what is held, and stops at the first failure', async () => {
    const s = server();
    const store = createJobStore(SLUG, { api: s.api, events: stream().events });
    await store.loadPage();
    await store.loadBody('reply:bb51ba3f5815');
    await store.prefetch();
    const order = prefetchOrder(store.getState().payload!);
    expect(s.items).toEqual(['reply:bb51ba3f5815', ...order.filter((id) => id !== 'reply:bb51ba3f5815')]);

    const s2 = server();
    const store2 = createJobStore(SLUG, { api: s2.api, events: stream().events });
    await store2.loadPage();
    s2.fail(new Error('Starbase answered 500.'));
    await store2.prefetch();
    expect(s2.items).toEqual([order[0]]);
    // Fetching ahead is quiet: no error line for what he did not ask for.
    expect(store2.getState().error).toBeNull();
  });

  it('prefetch before the payload does nothing', async () => {
    const s = server();
    const store = createJobStore(SLUG, { api: s.api, events: stream().events });
    await store.prefetch();
    expect(s.items).toEqual([]);
  });
});

describe('job store: the page’s own state', () => {
  it('each setter changes its field only, and the payload keeps its identity', async () => {
    const s = server();
    const store = createJobStore(SLUG, { api: s.api, events: stream().events });
    await store.loadPage();
    const payload = store.getState().payload;
    const ui0 = store.getState().ui;
    expect(ui0).toEqual({ step: null, reader: null, picks: {}, notes: [], draft: '' });

    store.setStep('test');
    store.setReader({ kind: 'doc', id: 'test-report.md' });
    store.setPick('1', 'a');
    store.setPick('2', 'b');
    store.setPick('2', null);
    store.setNotes([{ n: 1, target: { kind: 'doc', id: 'spec' }, quote: 'the week picker', note: 'Say which week.' }]);
    store.setDraft('Looks right');
    const ui = store.getState().ui;
    expect(ui).toEqual({
      step: 'test', reader: { kind: 'doc', id: 'test-report.md' }, picks: { 1: 'a' },
      notes: [{ n: 1, target: { kind: 'doc', id: 'spec' }, quote: 'the week picker', note: 'Say which week.' }], draft: 'Looks right',
    });
    expect(store.getState().payload).toBe(payload);

    // Setting what is already there tells no one.
    let notified = 0;
    store.subscribe(() => { notified++; });
    store.setStep('test');
    store.setDraft('Looks right');
    store.setPick('1', 'a');
    expect(notified).toBe(0);
    store.setDraft('Looks right, go on');
    expect(store.getState().ui.picks).toBe(ui.picks);
    expect(store.getState().ui.notes).toBe(ui.notes);
    expect(notified).toBe(1);
  });
});
