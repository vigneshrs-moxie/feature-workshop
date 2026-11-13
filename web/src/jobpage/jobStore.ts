// One small store per open job (plan "Architecture" → Web → State): the payload, the bodies fetched
// so far, one error line, and the page's own state (open step, reader target, picks, notes, draft).
// Components read it through useJob(selector) (useSyncExternalStore), so a change redraws only the
// parts that read what changed (plan "Speed rules" 5).
//
// - The payload is fetched again only when the server says it changed: the laptop's `job-page`
//   event ({ slug, v }) with a v newer than the one held. The website sends no `job-page` event
//   (interfaces §5), so there the store asks again on `thread` and `change` for its job, with the v
//   it holds (the answer is { same: true } when nothing changed). A `resync` (events were lost, or
//   Starbase restarted and counts v from 1 again) forgets the held v and asks for the whole payload.
//   On the laptop every read names the stream (?viewer=, state/live.ts liveViewer) so the runner
//   knows the job is open; a new viewer id (the stream reconnected) asks once more to say so.
//   It listens to the stream from its first load. Nothing else makes it do work, and it starts no timer.
// - A newer payload keeps the identity of every part whose data is equal (per top-level key, per
//   step and per thread line, matched by id), so their readers do not redraw.
// - A body is fetched once; a newer payload drops a kept body whose line hash (a doc's hash) moved
//   on, and the decisions list when the decisions count changes.
// - Fetching ahead (prefetch) stops at the default view, the last exchange, the current step's
//   outputs and the newest 30 other lines; the rest load when he picks them.
// - A failed fetch keeps the last good data and sets the one error line; the next good fetch of the
//   same kind clears it (a body that lands never hides that the job itself failed to load).
// - The message box's draft is kept in this browser under the old page's key, fw.draft.<slug>
//   (panes/Foreman/Composer.tsx draftKey), when the store is given `drafts` (the page gives it
//   browserDrafts): a reload, and the old page, find the same words. Emptying it also forgets the
//   old page's note that the draft answers a brief (fw.draftGate.<slug>), as the old page does.
// - Words that went with something the website queued for the laptop (a Go's note, Send back's
//   change, a message) are followed by the decision's id (watchQueued) for as long as the page is
//   open, whatever the card does meanwhile: when it ends on the website without running (failed,
//   changed, ran out, cancelled, or put away after it showed) the words come back to the draft, after
//   anything typed since, and `gaveBack` says why. The website's payload lists every decision still
//   shown for the job (queuedDecisions), so a newer one never hides an older one still waiting.

import type { ApiClient } from '../api/client';
import { createApi } from '../api/client';
import type { LiveEvent } from '../api/types';
import { gateDraftKey } from '../lib/gateCard';
import { readStored, writeStored } from '../lib/stored';
import { isOpen, queuedOf, type QueuedView } from '../views/Hosted/QueuedDecision';
import { liveViewer, onLiveEvent } from '../state/live';
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
  /** The gate the picks are for (Your move's key for it); picks for another gate count as none. */
  picksFor: string | null;
  /** The gate's questions he answered: question id → option id (left/gateBody.ts OWN: his own words). */
  picks: Record<string, string>;
  /** His own answers, by question id. */
  own: Record<string, string>;
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
  /** Words given back to the draft from something the website queued that never ran: why, in plain words. */
  gaveBack: { n: number; line: string } | null;
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
  /** The picks are for this gate from now: another gate's picks and words are dropped. */
  forGate(key: string): void;
  /** Pick an option for a question; null takes the pick back. */
  setPick(questionId: string, optionId: string | null): void;
  /** His own answer to a question. */
  setOwn(questionId: string, words: string): void;
  setNotes(notes: PageNote[]): void;
  setDraft(draft: string): void;
  /** Follow a decision the website queued, by its id, and give `words` back to the draft if it never runs. */
  watchQueued(id: string, words: string): void;
  /** The gaveBack line has been read (he sent again, or typed it away). */
  clearGaveBack(): void;
  /** Stop listening to the stream; fetches still out are dropped when they land. */
  destroy(): void;
}

export interface JobStoreOptions {
  /** The app's client (the laptop's or the website's); a plain laptop client when left out. */
  api?: ApiClient | JobApi;
  /** The app's one event stream; state/live.ts onLiveEvent when left out. */
  events?: (listener: (e: LiveEvent) => void) => () => void;
  /** The stream's viewer id, read when each request is sent; state/live.ts liveViewer when left out. */
  viewer?: () => string | null;
  /** A payload already held (a job opened lately, or fetched ahead from Jobs): painted at once, then
   *  checked by the first load with its v. */
  initial?: JobPagePayload | null;
  /** Where the draft is kept between visits (browserDrafts on the page); kept in the store only when left out. */
  drafts?: DraftStorage | null;
}

/** A place that keeps short strings by key (this browser's storage on the page). */
export interface DraftStorage {
  read(key: string): string | null;
  write(key: string, value: string | null): void;
}

/** This browser's storage, shared with every other place that reads the same key (lib/stored.ts). */
export const browserDrafts: DraftStorage = { read: readStored, write: writeStored };

/** The old page's key for a job's unsent draft (panes/Foreman/Composer.tsx draftKey). */
export const draftKey = (slug: string) => `fw.draft.${slug}`;

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

/**
 * The kept bodies still current for this payload: a thread item's body by its line's hash, a doc's
 * by its hash when it has one; the decisions list (no hash in the payload) goes when the decisions
 * count moved since `prev`.
 */
function currentBodies(bodies: Record<string, JobBody>, payload: JobPagePayload, prev: JobPagePayload | null = null): Record<string, JobBody> {
  const hashes = new Map<string, string>(payload.thread.map((l) => [l.id, l.hash]));
  for (const s of payload.steps) for (const o of [...s.outputs, ...(s.more ?? [])]) if (o.kind === 'doc' && typeof o.hash === 'string') hashes.set(o.id, o.hash);
  const decisionsMoved = prev !== null && prev.rows.decisions.count !== payload.rows.decisions.count;
  let out = bodies;
  for (const [id, b] of Object.entries(bodies)) {
    const hash = hashes.get(id);
    const stale = id === DECISIONS ? decisionsMoved : hash !== undefined && b.version !== undefined && b.version !== hash;
    if (!stale) continue;
    if (out === bodies) out = { ...bodies };
    delete out[id];
  }
  return out;
}

// ---------- Fetching ahead ----------

/** How many other lines fetching ahead takes, newest first; older ones load when picked. */
export const PREFETCH_LINES = 30;
const BODY_KINDS = new Set(['message', 'brief', 'doc', 'decisions']);

/**
 * The bodies to fetch ahead, in the plan's order (Architecture → Web → Bodies): the reader's view on
 * arrival, the last exchange of the conversation (from his last message to the end, newest first),
 * the current step's documents, then the newest 30 other lines, newest first. Each id once. Other
 * steps' documents, older lines and the decisions list load when he picks them.
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
  let others = 0;
  for (let i = from - 1; i >= 0 && others < PREFETCH_LINES; i--) {
    if (seen.has(thread[i].id)) continue;
    add(thread[i].id);
    others++;
  }
  return out;
}

// ---------- Decisions the website queued ----------

/** The website's decision with this id, from the payload's list (or its one newest decision, from an older site). */
export function queuedById(payload: JobPagePayload | null | undefined, id: string | null | undefined): QueuedView | null {
  if (!payload || !id) return null;
  for (const d of payload.queuedDecisions ?? []) { const q = queuedOf(d); if (q && q.id === id) return q; }
  const one = queuedOf(payload.queuedDecision);
  return one && one.id === id ? one : null;
}

/** Still waiting on the website or on its way (a plain boolean: isOpen's guard narrows too far). */
const stillOpen = (q: QueuedView): boolean => isOpen(q);

/** Words added back to a draft: in an empty box as they are, else after what is there on a new line. */
export function withWordsBack(draft: string, words: string): string {
  if (!draft.trim()) return words;
  if (draft.includes(words)) return draft;
  return `${draft.replace(/\s+$/, '')}\n${words}`;
}

// ---------- The store ----------

const DECISIONS = 'decisions';
const EMPTY_UI: JobUi = { step: null, reader: null, picksFor: null, picks: {}, own: {}, notes: [], draft: '' };
const sameTarget = (a: ReaderTarget | null, b: ReaderTarget | null) => a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);

export function createJobStore(slug: string, { api = createApi(), events = onLiveEvent, viewer = liveViewer, initial = null, drafts = null }: JobStoreOptions = {}): JobStore {
  const reads: JobApi = 'page' in api ? api : jobApi(api);
  const client = 'page' in api ? null : api;
  const keptDraft = drafts?.read(draftKey(slug)) ?? '';
  let state: JobPageState = { slug, payload: initial && initial.slug === slug ? initial : null, bodies: {}, error: null, ui: keptDraft ? { ...EMPTY_UI, draft: keptDraft } : EMPTY_UI, gaveBack: null };
  /** Decisions the website queued with his words, by id: the words, and whether the payload has shown it. */
  const watched = new Map<string, { words: string; seen: boolean }>();
  let gaveBackN = 0;
  const listeners = new Set<() => void>();
  const bodyFetches = new Map<string, Promise<JobBody>>();
  let pageFetch: Promise<void> | null = null;
  let again = false;
  let prefetching: Promise<void> | null = null;
  let destroyed = false;
  /** Ask for the whole payload next (after a resync: the held v may mean nothing to the server now). */
  let forget = false;
  /** A fetch that forgot the held v is out: until it lands, the held v says nothing about an event's v. */
  let forgetting = false;
  /** The viewer id the last page request named. */
  let named: string | null = null;
  /** Which fetch set the error line, so only a good fetch of that kind clears it. */
  let errorFrom: 'page' | 'body' | null = null;

  function set(next: JobPageState) {
    if (next === state) return;
    const payloadMoved = next.payload !== state.payload;
    state = payloadMoved && watched.size ? settleQueued(next) : next;
    for (const l of [...listeners]) l();
  }

  /** The watched decisions as this state shows them: words back for each that ended without running. */
  function settleQueued(next: JobPageState): JobPageState {
    let out = next;
    for (const [id, w] of [...watched]) {
      const q = queuedById(next.payload, id);
      if (q && stillOpen(q)) { w.seen = true; continue; }
      if (q && q.state === 'done') { watched.delete(id); continue; }
      if (!q && !w.seen) continue; // not shown yet
      watched.delete(id);
      const draft = withWordsBack(out.ui.draft, w.words);
      if (draft !== out.ui.draft) writeDraft(draft);
      const why = q ? q.words.replace(/\s*$/, '') : 'the website put it away before your laptop ran it.';
      out = { ...out, ui: { ...out.ui, draft }, gaveBack: { n: ++gaveBackN, line: `Not sent: ${/[.!?]$/.test(why) ? why : `${why}.`} Your words are back in the box.` } };
    }
    return out;
  }

  /** Keep the draft in this browser (the old page's key). */
  function writeDraft(draft: string) {
    if (!drafts) return;
    drafts.write(draftKey(slug), draft === '' ? null : draft);
    if (draft === '' && drafts.read(gateDraftKey(slug)) !== null) drafts.write(gateDraftKey(slug), null);
  }
  const setUi = (patch: Partial<JobUi>) => {
    const ui = { ...state.ui, ...patch };
    set({ ...state, ui });
  };
  const fail = (from: 'page' | 'body', line: string) => { errorFrom = from; set({ ...state, error: line }); };
  /** The error line without what a good fetch of this kind answered; a page that loads clears either. */
  const cleared = (from: 'page' | 'body') => (state.error !== null && (from === 'page' || errorFrom === 'body') ? null : state.error);

  function hosted(): boolean {
    return Boolean(state.payload?.hosted || client?.hosted?.());
  }
  /** The viewer id to name, on the laptop only. */
  const viewerNow = () => (hosted() ? null : viewer());

  async function fetchPageOnce() {
    const held = forget ? null : state.payload;
    forgetting = forget;
    forget = false;
    const id = viewerNow();
    let answer;
    try {
      answer = await (id ? reads.page(slug, held ? held.v : null, id) : reads.page(slug, held ? held.v : null));
    } catch (err) {
      if (!destroyed) fail('page', PAGE_ERROR + message(err));
      return;
    } finally {
      forgetting = false;
    }
    if (destroyed) return;
    named = id;
    if (isSame(answer) || answer.slug !== slug) {
      if (state.error !== null) set({ ...state, error: cleared('page') });
      return;
    }
    // Fetches run one at a time, so an answer is never older than what is held; after a restart its
    // v can be lower, and it is still the truth.
    const now = state.payload;
    const payload = now ? keepSame(now, answer) : answer;
    set({ ...state, payload, bodies: currentBodies(state.bodies, payload, now), error: cleared('page') });
  }

  function loadPage(): Promise<void> {
    if (destroyed) return Promise.resolve();
    // It listens from its first load, so a store made and dropped (a render React threw away) holds nothing open.
    unsubscribe ??= events(onEvent);
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
    const who = viewerNow();
    const p = (who ? reads.item(slug, id, who) : reads.item(slug, id)).then((body) => {
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
      await fetchBody(id);
      // Out of date when it landed (a newer payload moved its hash on): ask once more.
      if (!state.bodies[id] && !destroyed) await fetchBody(id);
      if (state.error !== null && !destroyed) set({ ...state, error: cleared('body') });
      return state.bodies[id] ?? null;
    } catch (err) {
      if (!destroyed) fail('body', BODY_ERROR + message(err));
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

  function onEvent(e: LiveEvent) {
    if (destroyed || !e || typeof e.type !== 'string') return;
    if (e.type === 'resync') { forget = true; void loadPage(); return; }
    const d = isObject(e.data) ? e.data : {};
    if (e.type === 'viewer') {
      // The stream reconnected: tell the runner this new stream watches the job (one page ask).
      if (state.payload && !hosted() && typeof d.id === 'string' && d.id !== named) void loadPage();
      return;
    }
    if (e.type === 'job-page') {
      if ((e.job ?? d.slug) !== slug) return;
      const v = typeof d.v === 'number' ? d.v : null;
      // While the held v is being forgotten (after a resync) it says nothing: ask again after.
      if (v !== null && state.payload && v <= state.payload.v && !forget && !forgetting) return;
      void loadPage();
      return;
    }
    if ((e.type === 'thread' || e.type === 'change') && hosted() && (e.job === slug || e.job === null)) void loadPage();
  }

  let unsubscribe: (() => void) | null = null;

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
    forGate(key) { if (state.ui.picksFor !== key) setUi({ picksFor: key, picks: {}, own: {} }); },
    setOwn(questionId, words) { if (state.ui.own[questionId] !== words) setUi({ own: { ...state.ui.own, [questionId]: words } }); },
    setNotes(notes) { if (state.ui.notes !== notes) setUi({ notes }); },
    setDraft(draft) {
      if (state.ui.draft === draft) return;
      writeDraft(draft);
      setUi({ draft });
    },
    watchQueued(id, words) {
      if (!words.trim()) return;
      watched.set(id, { words, seen: false });
      const now = settleQueued(state);
      if (now !== state) set(now);
    },
    clearGaveBack() { if (state.gaveBack) set({ ...state, gaveBack: null }); },
    destroy() {
      destroyed = true;
      unsubscribe?.();
      unsubscribe = null;
      listeners.clear();
    },
  };
}
