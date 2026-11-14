// @vitest-environment node
// The job page's store: one per open job, fetches only when the server says something changed,
// keeps every unchanged part's identity, fetches each body once, and keeps the last good data on a
// failed fetch. Built against the made-up long job.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { LiveEvent } from '../api/types';
import { longJob } from './fixtures/longJob';
import type { JobApi } from './api';
import { arrivalOf, createJobStore, notesKey, prefetchOrder, type DraftStorage, type PageNote } from './jobStore';
import { readerOf } from './targets';
import type { JobBody, JobPagePayload, SamePage } from './types';

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const base = () => clone(longJob.payload) as unknown as JobPagePayload;
const bodyOf = (id: string): JobBody => {
  if (id === 'decisions') return { id, kind: 'decisions', version: 'd', html: '<ul><li>Keep the commits</li></ul>', text: '- Keep the commits', meta: {} };
  if (id === 'ticket') return { id, kind: 'ticket', version: 't1', html: '<h2>The ticket</h2>', text: '## The ticket', meta: {} };
  const b = longJob.bodies[id];
  return { ...b, version: String(b.meta.hash ?? b.id) };
};

/** A fake server: answers with `current`, counts every request. */
function server(start: JobPagePayload = base()) {
  let current = start;
  let failNext: Error | null = null;
  const pages: Array<number | null> = [];
  const items: string[] = [];
  const viewers: Array<string | null | undefined> = [];
  const api: JobApi = {
    async page(slug, v, viewer): Promise<JobPagePayload | SamePage> {
      pages.push(v);
      viewers.push(viewer);
      expect(slug).toBe(SLUG);
      if (failNext) { const e = failNext; failNext = null; throw e; }
      return v === current.v ? { same: true, v } : clone(current);
    },
    async item(_slug, id, viewer) {
      items.push(id);
      viewers.push(viewer);
      if (failNext) { const e = failNext; failNext = null; throw e; }
      // A line's body is versioned by its current hash, as the server does.
      const line = current.thread.find((l) => l.id === id);
      return line ? { ...bodyOf(id), version: line.hash } : bodyOf(id);
    },
  };
  return {
    api, pages, items, viewers,
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

  it('after a Starbase restart (resync) it forgets its v: the full payload replaces it even with a lower v', async () => {
    const s = server({ ...base(), v: 57 });
    const live = stream();
    const store = createJobStore(SLUG, { api: s.api, events: live.events });
    await store.loadPage();
    const before = store.getState().payload!;
    // The restarted server counts from 1 again.
    s.set({ ...base(), v: 1, title: 'Crew schedule export, after the restart' });
    live.send('job-page', SLUG, { slug: SLUG, v: 1 });
    await settle();
    expect(s.pages).toEqual([null]);
    live.send('resync', null, { epoch: 'new' });
    await settle();
    expect(s.pages).toEqual([null, null]);
    const after = store.getState().payload!;
    expect(after.v).toBe(1);
    expect(after.title).toBe('Crew schedule export, after the restart');
    expect(after.steps).toBe(before.steps);
    // The next change is fetched as usual, with the new v.
    s.set({ ...base(), v: 2, title: 'Crew schedule export, after the restart' });
    live.send('job-page', SLUG, { slug: SLUG, v: 2 });
    await settle();
    expect(s.pages).toEqual([null, null, 1]);
    expect(store.getState().payload?.v).toBe(2);
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
    await store.loadPage(); // it listens from its first load (Task 7 fix round 1)
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
  it('orders bodies: the reader’s view, the last exchange, the current step’s outputs, then the newest 30 other lines', () => {
    const p = base();
    const order = prefetchOrder(p);
    const lines = p.thread.map((l) => l.id);
    // The reader's view, then the last exchange: from his last message to the end, newest first.
    expect(order.slice(0, 3)).toEqual(['brief:briefs/015-review.md', 'reply:bb51ba3f5815', 'you:ff6dfb006203']);
    // Then the current step's (Review's) documents, in the step's order.
    const review = p.steps.find((s) => s.state === 'current')!.outputs.filter((o) => o.kind === 'doc').map((o) => o.id);
    expect(order.slice(3, 3 + review.length)).toEqual(review);
    // Then the newest 30 other lines, newest first; nothing else (other steps' documents and the
    // decisions list load when he picks them).
    const rest = order.slice(3 + review.length);
    expect(rest[0]).toBe('note:77b7399419d4');
    const shown = new Set(order.slice(0, 3));
    expect(rest).toEqual([...lines].reverse().filter((id) => !shown.has(id)).slice(0, 30));
    expect(order).toHaveLength(3 + review.length + 30);
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
    expect(ui0).toEqual({ step: null, reader: null, picksFor: null, picks: {}, own: {}, notes: [], draft: '' });

    store.setStep('test');
    store.setReader({ kind: 'doc', id: 'test-report.md' });
    store.setPick('1', 'a');
    store.setPick('2', 'b');
    store.setPick('2', null);
    store.setNotes([{ n: 1, kind: 'change', target: { kind: 'doc', id: 'spec' }, place: 'Spec v1 · paragraph 2', chip: 'Spec paragraph 2', quote: 'the week picker', note: 'Say which week.' }]);
    store.setDraft('Looks right');
    const ui = store.getState().ui;
    expect(ui).toEqual({
      step: 'test', reader: { kind: 'doc', id: 'test-report.md' }, picksFor: null, picks: { 1: 'a' }, own: {},
      notes: [{ n: 1, kind: 'change', target: { kind: 'doc', id: 'spec' }, place: 'Spec v1 · paragraph 2', chip: 'Spec paragraph 2', quote: 'the week picker', note: 'Say which week.' }], draft: 'Looks right',
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

describe('job store: fix round 1', () => {
  it('the decisions body is dropped when the decisions count changes, and kept while it does not', async () => {
    const s = server();
    const live = stream();
    const store = createJobStore(SLUG, { api: s.api, events: live.events });
    await store.loadPage();
    await store.loadBody('decisions');
    s.set({ ...base(), v: 2, title: 'Renamed' });
    live.send('job-page', SLUG, { slug: SLUG, v: 2 });
    await settle();
    expect(store.getState().bodies.decisions).toBeDefined();
    const next = base();
    next.v = 3;
    next.rows.decisions.count = 14;
    s.set(next);
    live.send('job-page', SLUG, { slug: SLUG, v: 3 });
    await settle();
    expect(store.getState().bodies.decisions).toBeUndefined();
    await store.loadBody('decisions');
    expect(s.items).toEqual(['decisions', 'decisions']);
  });

  it('every page and item request names the stream it came from (the viewer id, read when it is sent)', async () => {
    const s = server();
    let viewer: string | null = null;
    const store = createJobStore(SLUG, { api: s.api, events: stream().events, viewer: () => viewer });
    await store.loadPage();
    viewer = 'a1b2c3d4e5f60718';
    await store.loadPage();
    await store.loadBody('spec');
    expect(s.viewers).toEqual([undefined, 'a1b2c3d4e5f60718', 'a1b2c3d4e5f60718']);
  });

  it('a new viewer id (the stream reconnected) refetches the page once; the same id again does nothing', async () => {
    const s = server();
    const live = stream();
    let viewer: string | null = 'a1b2c3d4e5f60718';
    const store = createJobStore(SLUG, { api: s.api, events: live.events, viewer: () => viewer });
    live.send('viewer', null, { id: viewer });
    await settle();
    expect(s.pages).toEqual([]); // nothing held yet: the first load names it
    await store.loadPage();
    live.send('viewer', null, { id: viewer });
    await settle();
    expect(s.pages).toEqual([null]);
    viewer = '0f1e2d3c4b5a6978';
    live.send('viewer', null, { id: viewer });
    await settle();
    live.send('viewer', null, { id: viewer });
    await settle();
    expect(s.pages).toEqual([null, 1]);
    expect(s.viewers).toEqual(['a1b2c3d4e5f60718', '0f1e2d3c4b5a6978']);
  });

  it('on the website no viewer id is sent and viewer events do nothing', async () => {
    const paths: string[] = [];
    const site = {
      hosted: () => true,
      get: async (path: string) => {
        paths.push(path);
        if (path.includes('/item?')) return bodyOf('spec');
        return path.includes('?v=1') ? { same: true, v: 1 } : { ...base(), hosted: true };
      },
    } as unknown as ApiClient;
    const live = stream();
    const store = createJobStore(SLUG, { api: site, events: live.events, viewer: () => 'a1b2c3d4e5f60718' });
    await store.loadPage();
    await store.loadPage();
    live.send('viewer', null, { id: '0f1e2d3c4b5a6978' });
    await settle();
    await store.loadBody('spec');
    expect(paths).toEqual([`/api/job/${SLUG}/page`, `/api/job/${SLUG}/page?v=1`, `/api/job/${SLUG}/item?id=spec`]);
  });

  it('a body that lands keeps a page error on the line; only a page that loads clears it', async () => {
    const s = server();
    const store = createJobStore(SLUG, { api: s.api, events: stream().events });
    await store.loadPage();
    s.fail(new Error('Starbase answered 500.'));
    await store.loadPage();
    await store.loadBody('spec');
    expect(store.getState().error).toBe('Couldn’t load this job: Starbase answered 500.');
    await store.loadPage();
    expect(store.getState().error).toBeNull();
  });

  it('a body already out of date when it lands is asked for again once, and the fresh one handed over', async () => {
    let current = base();
    const ID = 'reply:bb51ba3f5815';
    const asked: string[] = [];
    let release: (() => void) | null = null;
    const api: JobApi = {
      page: async (_slug, v) => (v === current.v ? { same: true, v } : clone(current)),
      item: async (_slug, id) => {
        asked.push(id);
        // The body as it is when asked for; the first answer is held back until released.
        const version = current.thread.find((l) => l.id === id)!.hash;
        if (asked.length === 1) await new Promise<void>((r) => { release = r; });
        return { ...bodyOf(id), version };
      },
    };
    const store = createJobStore(SLUG, { api, events: stream().events });
    await store.loadPage();
    const first = store.loadBody(ID);
    await settle();
    // While the body is out, a newer payload moves its hash on.
    const oldHash = current.thread.find((l) => l.id === ID)!.hash;
    const next = base();
    next.v = 2;
    next.thread.find((l) => l.id === ID)!.hash = 'bbbbbbbbbbbb';
    current = next;
    await store.loadPage();
    release!();
    const body = await first;
    expect(asked).toEqual([ID, ID]);
    expect(oldHash).not.toBe('bbbbbbbbbbbb');
    expect(body?.version).toBe('bbbbbbbbbbbb');
    expect(store.getState().bodies[ID]?.version).toBe('bbbbbbbbbbbb');
  });
});

describe('job store: carried into Task 7', () => {
  it('Mi1: a job-page event that lands while the fetch after a resync is out is not dropped by v; it asks once more', async () => {
    let current: JobPagePayload = { ...base(), v: 57 };
    const asked: Array<number | null> = [];
    let release: (() => void) | null = null;
    let hold = false;
    const api: JobApi = {
      page: async (_slug, v) => {
        asked.push(v);
        // What the server holds when asked; the answer waits while `hold` is on.
        const answer = v === current.v ? { same: true as const, v } : clone(current);
        if (hold) { hold = false; await new Promise<void>((r) => { release = r; }); }
        return answer;
      },
      item: async (_slug, id) => bodyOf(id),
    };
    const live = stream();
    const store = createJobStore(SLUG, { api, events: live.events });
    await store.loadPage();
    // Starbase restarts and counts from 1; the resync's fetch is held on the way back.
    current = { ...base(), v: 1 };
    hold = true;
    live.send('resync', null, { epoch: 'new' });
    await settle();
    expect(asked).toEqual([null, null]);
    // While it is out the job moves on to v 2 and says so. The store still holds v 57.
    current = { ...base(), v: 2, title: 'Crew schedule export, moved on' };
    live.send('job-page', SLUG, { slug: SLUG, v: 2 });
    release!();
    await settle();
    await settle();
    expect(asked).toEqual([null, null, 1]);
    expect(store.getState().payload?.v).toBe(2);
    expect(store.getState().payload?.title).toBe('Crew schedule export, moved on');
  });
});

describe('job store: Task 7 fix round 1', () => {
  it('a payload it is given paints at once; the first load asks with its v and a "same" answer changes nothing', async () => {
    const s = server();
    const given = base();
    const store = createJobStore(SLUG, { api: s.api, events: stream().events, initial: given });
    expect(store.getState().payload).toBe(given);
    let told = 0;
    store.subscribe(() => { told++; });
    await store.loadPage();
    expect(s.pages).toEqual([1]);
    expect(store.getState().payload).toBe(given);
    expect(told).toBe(0);
  });

  it('listens to the stream only from its first load, so a store that is never loaded holds nothing open', async () => {
    const live = stream();
    const s = server();
    const store = createJobStore(SLUG, { api: s.api, events: live.events });
    expect(live.count()).toBe(0);
    await store.loadPage();
    expect(live.count()).toBe(1);
    await store.loadPage();
    expect(live.count()).toBe(1);
    store.destroy();
    expect(live.count()).toBe(0);
    await store.loadPage();
    expect(live.count()).toBe(0);
  });
});

describe('job store: Task 9, the gate’s picks', () => {
  it('picks and own words belong to one gate: a pick for another gate starts from nothing, and nothing else changes', async () => {
    const s = server();
    const store = createJobStore(SLUG, { api: s.api, events: stream().events });
    await store.loadPage();
    store.setDraft('Mind the totals');
    store.forGate('gate:15');
    store.setPick('1', 'b');
    store.setOwn('2', 'Squash the fixups');
    expect(store.getState().ui).toMatchObject({ picksFor: 'gate:15', picks: { 1: 'b' }, own: { 2: 'Squash the fixups' }, draft: 'Mind the totals' });
    let told = 0;
    store.subscribe(() => { told++; });
    // The same gate again, or the same words: no one is told.
    store.forGate('gate:15');
    store.setOwn('2', 'Squash the fixups');
    expect(told).toBe(0);
    // A new brief: its picks start from the recommended ones.
    store.forGate('gate:16');
    expect(store.getState().ui).toMatchObject({ picksFor: 'gate:16', picks: {}, own: {}, draft: 'Mind the totals' });
    expect(told).toBe(1);
  });
});

describe('job store: Task 11, the message box’s draft', () => {
  /** This browser's storage, faked: the keys and what each holds. */
  function drafts(start: Record<string, string> = {}) {
    const kept = new Map(Object.entries(start));
    const writes: Array<[string, string | null]> = [];
    return {
      kept, writes,
      read: (key: string) => kept.get(key) ?? null,
      write: (key: string, v: string | null) => { writes.push([key, v]); if (v === null) kept.delete(key); else kept.set(key, v); },
    };
  }

  it('starts from the old page’s draft (fw.draft.<slug>), keeps every change there, and emptying it forgets the old page’s gate memo too', () => {
    const d = drafts({ [`fw.draft.${SLUG}`]: 'Typed on the old page', [`fw.draftGate.${SLUG}`]: '{"brief":15,"kind":"changes"}' });
    const store = createJobStore(SLUG, { api: server().api, events: stream().events, drafts: d });
    expect(store.getState().ui.draft).toBe('Typed on the old page');
    store.setDraft('Typed on the old page, and here');
    expect(d.kept.get(`fw.draft.${SLUG}`)).toBe('Typed on the old page, and here');
    store.setDraft('');
    expect(d.kept.has(`fw.draft.${SLUG}`)).toBe(false);
    expect(d.kept.has(`fw.draftGate.${SLUG}`)).toBe(false);
    // A store made again (a reload) starts from what was kept.
    store.setDraft('After the reload');
    const again = createJobStore(SLUG, { api: server().api, events: stream().events, drafts: d });
    expect(again.getState().ui.draft).toBe('After the reload');
  });

  it('a payload that lands, a step pick and a reader pick leave the draft as it is, and write nothing', async () => {
    const d = drafts();
    const s = server();
    const store = createJobStore(SLUG, { api: s.api, events: stream().events, drafts: d });
    store.setDraft('Mind the totals');
    const writes = d.writes.length;
    await store.loadPage();
    const next = base();
    next.v = 2;
    next.move = { kind: 'permission', id: 'p1', card: 'permission', what: 'Run the tests', command: 'npm test', questions: null, risk: null, since: null, canAllowForRun: false, hardLine: false, defaultToNo: false, canAlwaysAllow: false };
    s.set(next);
    await store.loadPage();
    store.setStep('build');
    store.setReader({ kind: 'conversation', id: 'conversation' });
    expect(store.getState().payload?.move?.kind).toBe('permission');
    expect(store.getState().ui.draft).toBe('Mind the totals');
    expect(d.writes.length).toBe(writes);
  });

  it('without a storage (a store made outside the page) the draft lives in the store only', () => {
    const store = createJobStore(SLUG, { api: server().api, events: stream().events });
    store.setDraft('only here');
    const again = createJobStore(SLUG, { api: server().api, events: stream().events });
    expect(again.getState().ui.draft).toBe('');
  });
});

describe('job store: Task 11 fix round 2, words that went with something the website queued', () => {
  const q = (id: string, state: string, words = 'Waiting for your laptop.') => ({ id, kind: 'approve', state, words, at: '2026-11-13T12:00:00Z', expiresAt: null, waiting: false, canCancel: false, permissionId: null });
  const listed = (v: number, list: unknown[]) => { const p = base(); p.v = v; p.queuedDecisions = list; p.queuedDecision = list[0] ?? null; return p; };

  it('follows each decision by id in the list: kept while it waits (even under a newer one), forgotten when done, given back when it ends otherwise; one gone from the list is forgotten (fix round 3)', async () => {
    const s = server(listed(1, []));
    const store = createJobStore(SLUG, { api: s.api, events: stream().events });
    await store.loadPage();
    store.watchQueued('a', 'Words for a');
    store.watchQueued('b', 'Words for b');
    store.watchQueued('c', 'Words for c');
    s.set(listed(2, [q('c', 'waiting'), q('b', 'waiting'), q('a', 'waiting')]));
    await store.loadPage();
    // Only the newest is the old single field; the older ones still wait in the list.
    s.set(listed(3, [q('c', 'sent'), q('b', 'done'), q('a', 'waiting')]));
    await store.loadPage();
    expect(store.getState().ui.draft).toBe('');
    expect(store.getState().gaveBack).toBeNull();
    s.set(listed(4, [q('c', 'expired', 'It ran out before your laptop was back.'), q('a', 'waiting')]));
    await store.loadPage();
    expect(store.getState().ui.draft).toBe('Words for c');
    expect(store.getState().gaveBack?.line).toBe('Not sent: It ran out before your laptop was back. Your words are back in the box.');
    store.setDraft('Typed since');
    s.set(listed(5, []));
    await store.loadPage();
    expect(store.getState().ui.draft).toBe('Typed since');
    expect(store.getState().gaveBack?.line).toBe('Not sent: It ran out before your laptop was back. Your words are back in the box.');
    store.clearGaveBack();
    expect(store.getState().gaveBack).toBeNull();
  });
});

describe('Task 12 fix round 1: the ticket and decisions bodies follow their hashes on the payload', () => {
  it('a kept ticket body goes when the payload’s ticket hash moves on, and stays while it does not', async () => {
    const s = server({ ...base(), hashes: { ticket: 't1', decisions: 'd' } });
    const live = stream();
    const store = createJobStore(SLUG, { api: s.api, events: live.events });
    await store.loadPage();
    await store.loadBody('ticket');
    s.set({ ...base(), v: 2, title: 'Renamed', hashes: { ticket: 't1', decisions: 'd' } });
    live.send('job-page', SLUG, { slug: SLUG, v: 2 });
    await settle();
    expect(store.getState().bodies.ticket).toBeDefined();
    s.set({ ...base(), v: 3, hashes: { ticket: 't2', decisions: 'd' } });
    live.send('job-page', SLUG, { slug: SLUG, v: 3 });
    await settle();
    expect(store.getState().bodies.ticket).toBeUndefined();
  });

  it('with a decisions hash, the decisions body follows the hash, not the count', async () => {
    const s = server({ ...base(), hashes: { ticket: 't1', decisions: 'd' } });
    const live = stream();
    const store = createJobStore(SLUG, { api: s.api, events: live.events });
    await store.loadPage();
    await store.loadBody('decisions');
    const counted = base();
    counted.v = 2;
    counted.rows.decisions.count = 14;
    s.set({ ...counted, hashes: { ticket: 't1', decisions: 'd' } });
    live.send('job-page', SLUG, { slug: SLUG, v: 2 });
    await settle();
    expect(store.getState().bodies.decisions).toBeDefined();
    s.set({ ...counted, v: 3, hashes: { ticket: 't1', decisions: 'd2' } });
    live.send('job-page', SLUG, { slug: SLUG, v: 3 });
    await settle();
    expect(store.getState().bodies.decisions).toBeUndefined();
  });
});

describe('job store: Task 11 fix round 3, a decision that leaves the list', () => {
  const q = (id: string, state: string, words = 'Waiting for your laptop.') => ({ id, kind: 'approve', state, words, at: '2026-11-13T12:00:00Z', expiresAt: null, waiting: false, canCancel: false, permissionId: null });
  const listed = (v: number, list: unknown[]) => { const p = base(); p.v = v; p.queuedDecisions = list; p.queuedDecision = list[0] ?? null; return p; };

  it('seen open, then gone from the list (the site lists settled ones only for an hour, so it may have run): no words back, and it is forgotten', async () => {
    const s = server(listed(1, []));
    const store = createJobStore(SLUG, { api: s.api, events: stream().events });
    await store.loadPage();
    store.watchQueued('old', 'Already sent, maybe');
    s.set(listed(2, [q('old', 'sent')]));
    await store.loadPage();
    s.set(listed(3, []));
    await store.loadPage();
    expect(store.getState().ui.draft).toBe('');
    expect(store.getState().gaveBack).toBeNull();
    // Forgotten: the same id showing up settled later gives nothing back either.
    s.set(listed(4, [q('old', 'failed', 'Your laptop couldn’t run it.')]));
    await store.loadPage();
    expect(store.getState().ui.draft).toBe('');
    expect(store.getState().gaveBack).toBeNull();
  });

  it('not shown yet and then shown settled: the words come back after what was typed since', async () => {
    const s = server(listed(1, []));
    const store = createJobStore(SLUG, { api: s.api, events: stream().events });
    await store.loadPage();
    store.watchQueued('new', 'Words for it');
    s.set(listed(2, []));
    await store.loadPage();
    store.setDraft('Typed since');
    s.set(listed(3, [q('new', 'cancelled', 'Cancelled on the website.')]));
    await store.loadPage();
    expect(store.getState().ui.draft).toBe('Typed since\nWords for it');
    expect(store.getState().gaveBack?.line).toBe('Not sent: Cancelled on the website. Your words are back in the box.');
  });
});

describe('job store: notes survive a reload (Task 17, R4)', () => {
  const memory = (): DraftStorage & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, read: (k) => map.get(k) ?? null, write: (k, v) => { if (v === null) map.delete(k); else map.set(k, v); } };
  };
  const NOTE: PageNote = { n: 1, kind: 'drop', target: { kind: 'doc', id: 'spec' }, place: 'Spec v3 · acceptance line 6', chip: 'Spec acceptance line 6', quote: 'Export as PDF', note: '', block: { text: 'Export as PDF', version: '3', hash: 'h3' } };

  it('a new store for the same job finds the notes and the Explains the last one kept; none kept: the key goes', async () => {
    const s = server();
    const drafts = memory();
    const one = createJobStore(SLUG, { api: s.api, events: stream().events, drafts });
    one.setNotes([NOTE]);
    one.setExplains([{ n: 2, target: null, place: 'Plan v2 · step 4', quote: null, block: null, after: 'reply:x', answer: null, line: null }]);
    expect(JSON.parse(drafts.map.get(notesKey(SLUG))!)).toMatchObject({ notes: [NOTE], explains: [{ n: 2 }] });
    one.destroy();
    const two = createJobStore(SLUG, { api: s.api, events: stream().events, drafts });
    expect(two.getState().ui.notes).toEqual([NOTE]);
    expect(two.getState().explains).toMatchObject([{ n: 2, after: 'reply:x' }]);
    two.setNotes([]);
    two.setExplains([]);
    expect(drafts.map.has(notesKey(SLUG))).toBe(false);
  });

  it('kept notes that cannot be read are left out, and the page still opens', () => {
    const drafts = memory();
    drafts.write(notesKey(SLUG), '{not json');
    expect(createJobStore(SLUG, { api: server().api, events: stream().events, drafts }).getState().ui.notes).toEqual([]);
    drafts.write(notesKey(SLUG), JSON.stringify({ notes: [NOTE, { n: 'x' }, { ...NOTE, n: 9, kind: 'remove' }], explains: 'no' }));
    const store = createJobStore(SLUG, { api: server().api, events: stream().events, drafts });
    expect(store.getState().ui.notes).toEqual([NOTE]);
    expect(store.getState().explains).toEqual([]);
  });

  it('a seek counts up, so a second click on the same chip seeks again', () => {
    const store = createJobStore(SLUG, { api: server().api, events: stream().events });
    store.setSeek(3);
    const first = store.getState().seek;
    store.setSeek(3);
    expect(store.getState().seek).toEqual({ n: 3, at: first!.at + 1 });
    store.setSeek(null);
    expect(store.getState().seek).toBeNull();
  });
});

describe('final fix W1: the reader stays where it was on arrival', () => {
  it('a rebuild with another `open` does not move the reader while he has picked nothing; a pick still does', async () => {
    const first = base();
    first.open = { kind: 'changes', id: 'changes' };
    const s = server(first);
    const live = stream();
    const store = createJobStore(SLUG, { api: s.api, events: live.events });
    await store.loadPage();
    expect(readerOf(store.getState())).toEqual({ kind: 'changes', id: 'changes' });
    const next = clone(first);
    next.v = first.v + 1;
    next.open = { kind: 'checks', id: 'checks' };
    s.set(next);
    live.send('job-page', SLUG, { slug: SLUG, v: next.v });
    await settle();
    expect(store.getState().payload?.open).toEqual({ kind: 'checks', id: 'checks' });
    expect(readerOf(store.getState())).toEqual({ kind: 'changes', id: 'changes' });
    store.setReader({ kind: 'conversation', id: 'conversation' });
    expect(readerOf(store.getState())).toEqual({ kind: 'conversation', id: 'conversation' });
    store.destroy();
  });

  it('a kept payload paints its `open`, and the first answer from the server fixes the arrival; later ones never move it', async () => {
    const kept = base();
    kept.open = { kind: 'conversation', id: 'conversation' };
    const fresh = clone(kept);
    fresh.v = kept.v + 1;
    fresh.open = { kind: 'changes', id: 'changes' };
    const s = server(fresh);
    const live = stream();
    const store = createJobStore(SLUG, { api: s.api, events: live.events, initial: kept });
    expect(readerOf(store.getState())).toEqual({ kind: 'conversation', id: 'conversation' });
    await store.loadPage();
    expect(readerOf(store.getState())).toEqual({ kind: 'changes', id: 'changes' });
    const later = clone(fresh);
    later.v = fresh.v + 1;
    later.open = { kind: 'conversation', id: 'conversation' };
    s.set(later);
    live.send('job-page', SLUG, { slug: SLUG, v: later.v });
    await settle();
    expect(readerOf(store.getState())).toEqual({ kind: 'changes', id: 'changes' });
    store.destroy();
  });

  it('a permission as `open` (an older Starbase) arrives on the current step’s main output, or the conversation', () => {
    const p = base();
    p.open = { kind: 'permission', id: 'p1' };
    const current = p.steps.find((x) => x.state === 'current');
    const want = current && current.main.kind !== 'not-yet' ? current.main : { kind: 'conversation', id: 'conversation' };
    expect(arrivalOf(p)).toEqual(want);
    for (const st of p.steps) if (st.state === 'current') st.main = { kind: 'not-yet', id: st.id };
    expect(arrivalOf(p)).toEqual({ kind: 'conversation', id: 'conversation' });
  });
});
