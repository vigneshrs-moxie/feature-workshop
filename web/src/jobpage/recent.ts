// The page payloads of the jobs opened lately, kept in memory (the newest 8), so opening one again
// paints it complete in the first frame (the open step's outputs too) and the first fetch only asks
// whether it changed (?v=). Jobs fetches a job's payload ahead when the pointer rests on its row for
// 150 ms, or the focus reaches it (prefetchPage: one page request, no bodies, no viewer id, so it does
// not mark the job open). Pages fetched ahead are kept apart (their own newest 8), so they never push
// out a job he opened. A resync (events lost, or Starbase restarted and counts versions from 1 again)
// forgets them all, so a kept page can never pass for current by an equal v.
// On a cold first open with neither, the open step's outputs appear when the payload lands: the
// accepted case (Task 7 fix round 1).

import type { ApiClient } from '../api/client';
import { onLiveEvent } from '../state/live';
import { isSame, jobApi } from './api';
import type { JobPagePayload } from './types';

export const RECENT_PAGES = 8;
/** How long the pointer rests on a row before its page is fetched ahead. */
export const HOVER_MS = 150;

const opened = new Map<string, JobPagePayload>();
const ahead = new Map<string, JobPagePayload>();
const fetching = new Map<string, Promise<void>>();
const resting = new Map<string, ReturnType<typeof setTimeout>>();
let untap: (() => void) | null = null;

/** Listen for a resync once something is kept. */
function tap() {
  untap ??= onLiveEvent((e) => { if (e?.type === 'resync') forgetRecentPages(); });
}

function keep(map: Map<string, JobPagePayload>, payload: JobPagePayload) {
  map.delete(payload.slug);
  map.set(payload.slug, payload);
  while (map.size > RECENT_PAGES) map.delete(map.keys().next().value as string);
}

/** Keep the payload of a job he opened (the newest kept last; the oldest goes past 8). */
export function rememberPage(payload: JobPagePayload) {
  if (opened.get(payload.slug) === payload) return;
  ahead.delete(payload.slug);
  keep(opened, payload);
  tap();
}

/** The payload kept for a job (opened, else fetched ahead), or null. */
export function recentPage(slug: string): JobPagePayload | null {
  return opened.get(slug) ?? ahead.get(slug) ?? null;
}

/** Fetch a job's payload ahead (once at a time; nothing when one is kept). A failure is quiet. */
export function prefetchPage(client: ApiClient, slug: string): Promise<void> {
  if (recentPage(slug)) return Promise.resolve();
  const out = fetching.get(slug);
  if (out) return out;
  tap();
  const p = jobApi(client).page(slug, null)
    .then((answer) => {
      if (fetching.get(slug) !== p) return; // forgotten meanwhile (a resync)
      if (!isSame(answer) && answer.slug === slug && Array.isArray(answer.steps) && !recentPage(slug)) keep(ahead, answer);
    })
    .catch(() => { /* fetching ahead is quiet: the page asks again when it opens */ })
    .finally(() => { if (fetching.get(slug) === p) fetching.delete(slug); });
  fetching.set(slug, p);
  return p;
}

type AheadProps = { onPointerEnter?: () => void; onPointerLeave?: () => void; onFocus?: () => void };

/** What a job row on Jobs spreads on its link (only while the new page is on): the pointer resting 150 ms, or the focus, fetches its page ahead. */
export function prefetchProps(client: ApiClient, slug: string, on: boolean): AheadProps {
  if (!on) return {};
  const stop = () => { const t = resting.get(slug); if (t !== undefined) { clearTimeout(t); resting.delete(slug); } };
  return {
    onPointerEnter: () => {
      stop();
      resting.set(slug, setTimeout(() => { resting.delete(slug); void prefetchPage(client, slug); }, HOVER_MS));
    },
    onPointerLeave: stop,
    onFocus: () => { stop(); void prefetchPage(client, slug); },
  };
}

/** Forget every kept payload (a resync; tests). */
export function forgetRecentPages() {
  opened.clear();
  ahead.clear();
  fetching.clear();
  for (const t of resting.values()) clearTimeout(t);
  resting.clear();
}
