// One small store per open job (plan "Architecture" → Web → State): the payload, the bodies fetched
// so far, one error line, and the page's own state (open step, reader target, picks, notes, draft).
// Components read it through useJob(selector) (useSyncExternalStore), so a change redraws only the
// parts that read what changed (plan "Speed rules" 5).
//
// - The payload is fetched again only when the server says it changed: the laptop's `job-page`
//   event ({ slug, v }) with a v newer than the one held. The website sends no `job-page` event
//   (interfaces §5), so there the store asks again on `thread` and `change` for its job, with the v
//   it holds (the answer is { same: true } when nothing changed). A `resync` (events were lost)
//   asks too. Nothing else makes it do work, and it starts no timer.
// - A newer payload keeps the identity of every part whose data is equal (per top-level key, per
//   step and per thread line, matched by id), so their readers do not redraw.
// - A body is fetched once; a newer payload drops a kept body whose line hash moved on.
// - A failed fetch keeps the last good data and sets the one error line; the next good one clears it.

import type { ApiClient } from '../api/client';
import { createApi } from '../api/client';
import type { LiveEvent } from '../api/types';
import { onLiveEvent } from '../state/live';
import { isSame, jobApi, type JobApi } from './api';
import type { JobBody, JobPagePayload, ReaderTarget, StopId } from './types';

/** A note pinned to something on the page (R4, Task 17 adds what it does). */
export interface PageNote {
  n: number;
  target: ReaderTarget | null;
  /** The words pointed at, when a part of a text was picked. */
  quote: string | null;
  note: string;
}

/** The page's own state: what he opened, picked and typed. */
export interface JobUi {
  /** The step shown open; null: the payload's current step. */
  step: StopId | null;
  /** What the reader shows; null: the payload's `open`. */
  reader: ReaderTarget | null;
  /** The gate's questions he answered: question id → option id. */
  picks: Record<string, string>;
  notes: PageNote[];
  /** The message box's words. */
  draft: string;
}

export interface JobPageState {
  slug: string;
  payload: JobPagePayload | null;
  /** Bodies fetched so far, by id. */
  bodies: Record<string, JobBody>;
  /** The one error line (the last fetch that failed), or null. */
  error: string | null;
  ui: JobUi;
}

export interface JobStore {
  getState(): JobPageState;
  subscribe(listener: () => void): () => void;
  /** Fetch the payload (with the v held). Asks made while one is out cost one more fetch. */
  loadPage(): Promise<void>;
  /** One body: from what is held, else fetched once. null when the fetch failed (the error line says why). */
  loadBody(id: string): Promise<JobBody | null>;
  /** Fetch the bodies not held yet, one at a time, in prefetchOrder; stops quietly at the first failure. */
  prefetch(): Promise<void>;
  /** One event from the app's stream (the store taps it itself; exposed for the page and tests). */
  onEvent(e: LiveEvent): void;
  setStep(step: StopId | null): void;
  setReader(target: ReaderTarget | null): void;
  /** Pick an option for a question; null takes the pick back. */
  setPick(questionId: string, optionId: string | null): void;
  setNotes(notes: PageNote[]): void;
  setDraft(draft: string): void;
  /** Stop listening to the stream; fetches still out are dropped when they land. */
  destroy(): void;
}

export interface JobStoreOptions {
  /** The app's client (the laptop's or the website's); a plain laptop client when left out. */
  api?: ApiClient | JobApi;
  /** The app's one event stream; state/live.ts onLiveEvent when left out. */
  events?: (listener: (e: LiveEvent) => void) => () => void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const PAGE_ERROR = 'Couldn’t load this job: ';
const BODY_ERROR = 'Couldn’t load that part of the job: ';

// ---------- Keeping what did not change ----------

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const idOf = (x: unknown): string | null => (isObject(x) && typeof x.id === 'string' ? x.id : null);

/**
 * `next`, with every part that equals the same part of `prev` replaced by prev's (so it keeps its
 * identity). Arrays whose items all have an id match by id (a line added in the middle keeps the
 * others), else by place. Returns prev itself when all of it is equal.
 */
export function keepSame<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev;
  if (Array.isArray(prev) && Array.isArray(next)) {
    const byId = next.length > 0 && next.every((x) => idOf(x) !== null) && prev.every((x) => idOf(x) !== null);
    const old = byId ? new Map(prev.map((x) => [idOf(x), x])) : null;
    let same = prev.length === next.length;
    const out = next.map((x, i) => {
      const before = old ? old.get(idOf(x)) : prev[i];
      const kept = before === undefined ? x : keepSame(before, x);
      if (kept !== prev[i]) same = false;
      return kept;
    });
    return (same ? prev : out) as T;
  }
  if (isObject(prev) && isObject(next)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(prev).length;
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const kept = k in prev ? keepSame(prev[k], next[k]) : next[k];
      if (kept !== prev[k] || !(k in prev)) same = false;
      out[k] = kept;
    }
    return (same ? prev : out) as T;
  }
  return next;
}

/** The kept bodies still current for this payload: a thread item's body by its line's hash, a doc's by its hash when it has one. */
function currentBodies(bodies: Record<string, JobBody>, payload: JobPagePayload): Record<string, JobBody> {
  const hashes = new Map<string, string>(payload.thread.map((l) => [l.id, l.hash]));
  for (const s of payload.steps) for (const o of s.outputs) if (o.kind === 'doc' && typeof o.hash === 'string') hashes.set(o.id, o.hash);
  let out = bodies;
  for (const [id, b] of Object.entries(bodies)) {
    const hash = hashes.get(id);
    if (hash === undefined || b.version === undefined || b.version === hash) continue;
    if (out === bodies) out = { ...bodies };
    delete out[id];
  }
  return out;
}

// ---------- Fetching ahead ----------

const BODY_KINDS = new Set(['message', 'brief', 'doc', 'decisions']);

/**
 * The bodies to fetch ahead, in the plan's order (Architecture → Web → Bodies): the reader's view on
 * arrival, the last exchange of the conversation (from his last message to the end, newest first),
 * the current step's documents, then the rest newest first (the other lines from the newest back,
 * then the other steps' documents from the latest step back, then the decisions list). Each id once.
 */
export function prefetchOrder(payload: JobPagePayload): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  const thread = payload.thread;
  if (BODY_KINDS.has(payload.open.kind)) add(payload.open.id);
  let last = -1;
  for (let i = thread.length - 1; i >= 0; i--) if (thread[i].kind === 'you') { last = i; break; }
  const from = last >= 0 ? last : Math.max(0, thread.length - 1);
  for (let i = thread.length - 1; i >= from; i--) add(thread[i].id);
  const docs = (s: JobPagePayload['steps'][number]) => s.outputs.filter((o) => o.kind === 'doc').map((o) => o.id);
  const current = payload.steps.find((s) => s.state === 'current');
  if (current) docs(current).forEach(add);
  for (let i = from - 1; i >= 0; i--) add(thread[i].id);
  for (let i = payload.steps.length - 1; i >= 0; i--) if (payload.steps[i] !== current) docs(payload.steps[i]).forEach(add);
  if (payload.rows.decisions.count > 0) add('decisions');
  return out;
}

// ---------- The store ----------

const EMPTY_UI: JobUi = { step: null, reader: null, picks: {}, notes: [], draft: '' };
const sameTarget = (a: ReaderTarget | null, b: ReaderTarget | null) => a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);

export function createJobStore(slug: string, { api = createApi(), events = onLiveEvent }: JobStoreOptions = {}): JobStore {
  const reads: JobApi = 'page' in api ? api : jobApi(api);
  const client = 'page' in api ? null : api;
  let state: JobPageState = { slug, payload: null, bodies: {}, error: null, ui: EMPTY_UI };
  const listeners = new Set<() => void>();
  const bodyFetches = new Map<string, Promise<JobBody>>();
  let pageFetch: Promise<void> | null = null;
  let again = false;
  let prefetching: Promise<void> | null = null;
  let destroyed = false;

  function set(next: JobPageState) {
    if (next === state) return;
    state = next;
    for (const l of [...listeners]) l();
  }
  const setUi = (patch: Partial<JobUi>) => {
    const ui = { ...state.ui, ...patch };
    set({ ...state, ui });
  };

  async function fetchPageOnce() {
    const held = state.payload;
    let answer;
    try {
      answer = await reads.page(slug, held ? held.v : null);
    } catch (err) {
      if (!destroyed) set({ ...state, error: PAGE_ERROR + message(err) });
      return;
    }
    if (destroyed) return;
    if (isSame(answer) || answer.slug !== slug) {
      if (state.error !== null) set({ ...state, error: null });
      return;
    }
    const now = state.payload;
    if (now && answer.v < now.v) return; // a late answer older than what is held
    const payload = now ? keepSame(now, answer) : answer;
    set({ ...state, payload, bodies: currentBodies(state.bodies, payload), error: null });
  }

  function loadPage(): Promise<void> {
    if (destroyed) return Promise.resolve();
    if (pageFetch) { again = true; return pageFetch; }
    pageFetch = (async () => {
      try {
        do {
          again = false;
          await fetchPageOnce();
        } while (again && !destroyed);
      } finally {
        pageFetch = null;
      }
    })();
    return pageFetch;
  }

  /** One body, fetched once at a time; throws when the fetch fails. */
  function fetchBody(id: string): Promise<JobBody> {
    const held = state.bodies[id];
    if (held) return Promise.resolve(held);
    const out = bodyFetches.get(id);
    if (out) return out;
    const p = reads.item(slug, id).then((body) => {
      if (!destroyed && !state.bodies[id]) {
        // A body that a newer payload already moved past while it was out is not kept.
        const bodies = { ...state.bodies, [id]: body };
        set({ ...state, bodies: state.payload ? currentBodies(bodies, state.payload) : bodies });
      }
      return state.bodies[id] ?? body;
    }).finally(() => { bodyFetches.delete(id); });
    bodyFetches.set(id, p);
    return p;
  }

  async function loadBody(id: string): Promise<JobBody | null> {
    try {
      const body = await fetchBody(id);
      if (state.error !== null && !destroyed) set({ ...state, error: null });
      return body;
    } catch (err) {
      if (!destroyed) set({ ...state, error: BODY_ERROR + message(err) });
      return null;
    }
  }

  function prefetch(): Promise<void> {
    if (prefetching) return prefetching;
    prefetching = (async () => {
      try {
        const payload = state.payload;
        if (!payload) return;
        for (const id of prefetchOrder(payload)) {
          if (destroyed) return;
          if (state.bodies[id]) continue;
          await fetchBody(id);
        }
      } catch {
        // Fetching ahead is quiet: a pick that needs the body asks again and shows the error then.
      } finally {
        prefetching = null;
      }
    })();
    return prefetching;
  }

  function hosted(): boolean {
    return Boolean(state.payload?.hosted || client?.hosted?.());
  }

  function onEvent(e: LiveEvent) {
    if (destroyed || !e || typeof e.type !== 'string') return;
    if (e.type === 'resync') { void loadPage(); return; }
    const d = isObject(e.data) ? e.data : {};
    if (e.type === 'job-page') {
      if ((e.job ?? d.slug) !== slug) return;
      const v = typeof d.v === 'number' ? d.v : null;
      if (v !== null && state.payload && v <= state.payload.v) return;
      void loadPage();
      return;
    }
    if ((e.type === 'thread' || e.type === 'change') && hosted() && (e.job === slug || e.job === null)) void loadPage();
  }

  const unsubscribe = events(onEvent);

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    loadPage,
    loadBody,
    prefetch,
    onEvent,
    setStep(step) { if (state.ui.step !== step) setUi({ step }); },
    setReader(reader) { if (!sameTarget(state.ui.reader, reader)) setUi({ reader }); },
    setPick(questionId, optionId) {
      const picks = state.ui.picks;
      if (optionId === null ? !(questionId in picks) : picks[questionId] === optionId) return;
      const next = { ...picks };
      if (optionId === null) delete next[questionId];
      else next[questionId] = optionId;
      setUi({ picks: next });
    },
    setNotes(notes) { if (state.ui.notes !== notes) setUi({ notes }); },
    setDraft(draft) { if (state.ui.draft !== draft) setUi({ draft }); },
    destroy() {
      destroyed = true;
      unsubscribe();
      listeners.clear();
    },
  };
}
