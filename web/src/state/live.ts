// Keeps the store in step with the dashboard:
//   1. fetch GET /api/snapshot and hydrate the store;
//   2. open /api/events?v=2&since=<seq>&epoch=<epoch> and apply every event to the store;
//   3. when an event may have moved jobs between groups, fetch a fresh snapshot a moment later
//      (several such events in a row cost one fetch);
//   4. when the dashboard says it can't catch us up ('resync': it restarted, or we were away too
//      long), fetch a fresh snapshot at once;
//   5. when the connection drops, reconnect. The browser retries by itself and the dashboard
//      replays what we missed (Last-Event-ID); if the browser gives up we reopen the stream
//      ourselves with backoff, carrying on from our seq. After any reconnect we also refetch the
//      snapshot, so anything the events don't describe is brought up to date too.

import type { ApiClient } from '../api/client';
import type { LiveEvent } from '../api/types';
import type { Store } from './store';

/** The parts of EventSource used here, so tests can pass a fake. */
export interface EventSourceLike {
  readyState: number;
  onopen: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  close(): void;
}

const CLOSED = 2;

export interface LiveSyncOptions {
  api: ApiClient;
  store: Store;
  openStream?: (url: string) => EventSourceLike;
  base?: string;
  /** Wait this long after a job-moving event before refetching the snapshot. */
  staleDelayMs?: number;
  /** Reconnect and retry delays: start at min, double each failure, at most max. */
  retryMinMs?: number;
  retryMaxMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface LiveSync {
  start(): Promise<void>;
  stop(): void;
  /** Fetch a fresh snapshot now (also what the page's Retry button does). */
  refresh(): Promise<void>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createLiveSync({
  api,
  store,
  openStream = (url) => new EventSource(url),
  base = '',
  staleDelayMs = 400,
  retryMinMs = 1000,
  retryMaxMs = 30000,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}: LiveSyncOptions): LiveSync {
  let stopped = false;
  let es: EventSourceLike | null = null;
  let streamDown = false; // the stream errored since it last opened
  let reconnectDelay = retryMinMs;
  let reconnectTimer: unknown = null;
  let staleTimer: unknown = null;
  let hydrateTimer: unknown = null;
  let hydrateDelay = retryMinMs;
  let inFlight: Promise<void> | null = null;
  let again = false;
  let waitForReady: (() => void) | null = null;

  async function hydrateOnce(): Promise<void> {
    try {
      const snapshot = await api.snapshot();
      if (stopped) return;
      store.dispatch({ type: 'snapshot', snapshot });
      hydrateDelay = retryMinMs;
    } catch (err) {
      if (stopped) return;
      store.dispatch({ type: 'error', error: `Couldn’t reach the dashboard: ${message(err)}` });
      // Try again by itself, a little later each time.
      if (hydrateTimer === null) {
        hydrateTimer = setTimer(() => { hydrateTimer = null; void refresh(); }, hydrateDelay);
        hydrateDelay = Math.min(hydrateDelay * 2, retryMaxMs);
      }
      throw err;
    }
  }

  /** One snapshot fetch at a time; asking during a fetch queues exactly one more. */
  function refresh(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (inFlight) { again = true; return inFlight.catch(() => {}); }
    inFlight = (async () => {
      try {
        do {
          again = false;
          await hydrateOnce();
        } while (again && !stopped);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight.catch(() => {});
  }

  function scheduleStaleRefresh() {
    if (staleTimer !== null || stopped) return;
    staleTimer = setTimer(() => { staleTimer = null; void refresh(); }, staleDelayMs);
  }

  function afterEvent() {
    const s = store.getState();
    if (s.resyncNeeded) {
      if (staleTimer !== null) { clearTimer(staleTimer); staleTimer = null; }
      void refresh();
    } else if (s.jobsStale) {
      scheduleStaleRefresh();
    }
  }

  function streamUrl(): string {
    const { seq, epoch } = store.getState();
    const q = new URLSearchParams({ v: '2', since: String(seq) });
    if (epoch) q.set('epoch', epoch);
    return `${base}/api/events?${q}`;
  }

  function connect() {
    if (stopped) return;
    const stream = openStream(streamUrl());
    es = stream;
    stream.onopen = () => {
      if (es !== stream) return;
      reconnectDelay = retryMinMs;
      store.dispatch({ type: 'connection', connection: 'live' });
      if (streamDown) {
        streamDown = false;
        void refresh(); // back after a drop: bring everything up to date
      }
    };
    stream.onmessage = (ev) => {
      if (es !== stream) return;
      let event: LiveEvent;
      try { event = JSON.parse(String(ev.data)); } catch { return; }
      store.dispatch({ type: 'event', event });
      afterEvent();
    };
    stream.onerror = () => {
      if (es !== stream || stopped) return;
      streamDown = true;
      store.dispatch({ type: 'connection', connection: 'reconnecting' });
      if (stream.readyState === CLOSED) {
        // The browser gave up (the dashboard was gone, or answered with an error): retry ourselves.
        stream.close();
        es = null;
        if (reconnectTimer === null) {
          reconnectTimer = setTimer(() => { reconnectTimer = null; connect(); }, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, retryMaxMs);
        }
      }
      // Otherwise the browser is already reconnecting by itself, with Last-Event-ID.
    };
  }

  async function start() {
    stopped = false;
    store.dispatch({ type: 'connection', connection: 'connecting' });
    await refresh();
    if (stopped) return;
    if (store.getState().status === 'ready') {
      connect();
    } else {
      // No snapshot yet: refresh() keeps retrying; open the stream once one arrives.
      waitForReady = store.subscribe(() => {
        if (store.getState().status !== 'ready') return;
        waitForReady?.();
        waitForReady = null;
        if (!es && !stopped) connect();
      });
    }
  }

  function stop() {
    stopped = true;
    waitForReady?.();
    waitForReady = null;
    es?.close();
    es = null;
    for (const t of [reconnectTimer, staleTimer, hydrateTimer]) if (t !== null) clearTimer(t);
    reconnectTimer = staleTimer = hydrateTimer = null;
  }

  return { start, stop, refresh };
}
