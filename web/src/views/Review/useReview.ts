// Review rounds (packet Q): one job's review state (GET /api/review/:slug) and every job's
// (GET /api/review), shared by everything on the page that shows them (the Ship stop's bar and
// panel, the Desk card, the Jobs cards), fetched once and again a moment after any live event (the
// dashboard sends a 'pr' event when a round moves). Every action answers with the job's view, which
// is shown at once. The GitHub line comes from the flow view (home/useFlow.ts), kept up by 'flow'
// events; Check now is POST /api/flow/refresh.
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { ApiClient } from '../../api/client';
import type { Permission, ReviewList, ReviewResponse, ReviewView } from '../../api/types';
import { useWorkshop, useWorkshopState } from '../../state/store';

interface Entry<T> {
  value: T | null;
  error: string | null;
  loaded: boolean;
  inflight: Promise<void> | null;
  again: boolean;
  listeners: Set<() => void>;
  snap: { value: T | null; error: string | null; loaded: boolean };
}

const caches = new WeakMap<ApiClient, Map<string, Entry<unknown>>>();

function entryFor<T>(api: ApiClient, key: string): Entry<T> {
  let byKey = caches.get(api);
  if (!byKey) { byKey = new Map(); caches.set(api, byKey); }
  let e = byKey.get(key) as Entry<T> | undefined;
  if (!e) {
    e = { value: null, error: null, loaded: false, inflight: null, again: false, listeners: new Set(), snap: { value: null, error: null, loaded: false } };
    byKey.set(key, e as Entry<unknown>);
  }
  return e;
}

function publish<T>(e: Entry<T>, patch: Partial<Pick<Entry<T>, 'value' | 'error' | 'loaded'>>) {
  Object.assign(e, patch);
  e.snap = { value: e.value, error: e.error, loaded: e.loaded };
  for (const l of [...e.listeners]) l();
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A job's view as the page uses it: null when there is nothing to show (or an answer from an older dashboard). */
export function viewOf(r: unknown): ReviewView | null {
  const v = r as Partial<ReviewView> | null | undefined;
  if (!v || typeof v !== 'object' || typeof v.state !== 'string' || !v.bar || !v.pr) return null;
  return v as ReviewView;
}

/** Fetch now; asking while a fetch runs queues exactly one more. */
function load<T>(e: Entry<T>, get: () => Promise<T>): Promise<void> {
  if (e.inflight) { e.again = true; return e.inflight; }
  e.inflight = (async () => {
    try {
      do {
        e.again = false;
        try { publish(e, { value: await get(), error: null, loaded: true }); } catch (err) { publish(e, { error: message(err), loaded: true }); }
      } while (e.again);
    } finally { e.inflight = null; }
  })();
  return e.inflight;
}

/** Fetch once on mount, then again a moment after each live event (several in a row cost one fetch). */
function useShared<T>(key: string, path: string, map: (r: unknown) => T, enabled: boolean) {
  const { api } = useWorkshop();
  const { seq } = useWorkshopState();
  const e = entryFor<T>(api, key);
  const subscribe = useCallback((fn: () => void) => { e.listeners.add(fn); return () => { e.listeners.delete(fn); }; }, [e]);
  const snap = useSyncExternalStore(subscribe, () => e.snap, () => e.snap);
  const reload = useCallback(() => load(e, async () => map(await api.get<unknown>(path))), [api, e, path, map]);
  useEffect(() => { if (enabled) void reload(); }, [enabled, reload]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!enabled) return;
    const t = setTimeout(() => void reload(), 400);
    return () => clearTimeout(t);
  }, [seq, enabled, reload]);
  return { ...snap, reload, entry: e, api };
}

const asList = (r: unknown): ReviewList | null => {
  const l = r as Partial<ReviewList> | null;
  return l && Array.isArray(l.jobs) ? { ...l, jobs: l.jobs.map(viewOf).filter((v): v is ReviewView => v !== null) } as ReviewList : null;
};

/** Every job's review state, the settings and each repository's route (Jobs, Settings → Workflow). */
export function useReviewList(enabled = true) {
  const s = useShared<ReviewList | null>('list', '/api/review', asList, enabled);
  return { list: s.value, error: s.error, loaded: s.loaded, reload: s.reload };
}

/** A failed action, in words, kept with the job's view until the next action. */
const problems = new WeakMap<object, string | null>();

/**
 * One job's review state. act(action, body) posts /api/review/:slug/<action> and shows the view it
 * answers with; a refusal comes back in words (problem) and the view is fetched again.
 */
export function useReview(slug: string, enabled = true) {
  const s = useShared<ReviewView | null>(`job:${slug}`, `/api/review/${encodeURIComponent(slug)}`, viewOf, enabled);
  const { entry, api, reload } = s;
  const act = useCallback(async (action: string, body: Record<string, unknown> = {}): Promise<boolean> => {
    problems.set(entry, null);
    try {
      const r = await api.post<ReviewResponse>(`/api/review/${encodeURIComponent(slug)}/${action}`, body);
      publish(entry, { value: viewOf(r), error: null, loaded: true });
      return true;
    } catch (err) {
      problems.set(entry, message(err));
      publish(entry, {});
      void reload();
      return false;
    }
  }, [api, entry, slug, reload]);
  return { view: s.value, error: s.error, loaded: s.loaded, reload, act, problem: problems.get(entry) ?? null };
}

/**
 * The hand-off nudges a review round takes over (dashboard/lib/nudges.js): while a job has a round
 * or its PR's review state, "Ask Raj for a review?", "Raj asked for changes" and "Merge PR #2?"
 * are the round's own steps, so they don't show twice.
 */
export const ROUND_NUDGES: ReadonlySet<string> = new Set(['pr1-merge', 'pr2-review', 'pr2-changes', 'pr2-merge']);

/** A Needs you card that is a review round's (lib/driver.js parkRoundCard). */
export const isRoundCard = (p: Permission | null | undefined): boolean => Boolean(p && (p as { roundCard?: unknown }).roundCard === true);
