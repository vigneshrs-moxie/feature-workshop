// The page payloads of the jobs opened lately, kept in memory (the newest 8), so opening one again
// paints it complete in the first frame (the open step's outputs too) and the first fetch only asks
// whether it changed (?v=). Jobs fetches a job's payload ahead when the pointer or the focus reaches
// its row (prefetchPage: one page request, no bodies, no viewer id, so it does not mark the job open).
// On a cold first open with neither, the open step's outputs appear when the payload lands: the
// accepted case (Task 7 fix round 1).

import type { ApiClient } from '../api/client';
import { isSame, jobApi } from './api';
import type { JobPagePayload } from './types';

export const RECENT_PAGES = 8;

const recent = new Map<string, JobPagePayload>();
const fetching = new Map<string, Promise<void>>();

/** Keep a job's newest payload (the newest kept last; the oldest goes past 8). */
export function rememberPage(payload: JobPagePayload) {
  if (recent.get(payload.slug) === payload) return;
  recent.delete(payload.slug);
  recent.set(payload.slug, payload);
  while (recent.size > RECENT_PAGES) recent.delete(recent.keys().next().value as string);
}

/** The payload kept for a job, or null. */
export function recentPage(slug: string): JobPagePayload | null {
  return recent.get(slug) ?? null;
}

/** Fetch a job's payload ahead (once at a time; nothing when one is kept). A failure is quiet. */
export function prefetchPage(client: ApiClient, slug: string): Promise<void> {
  if (recent.has(slug)) return Promise.resolve();
  const out = fetching.get(slug);
  if (out) return out;
  const p = jobApi(client).page(slug, null)
    .then((answer) => { if (!isSame(answer) && answer.slug === slug && Array.isArray(answer.steps) && !recent.has(slug)) rememberPage(answer); })
    .catch(() => { /* fetching ahead is quiet: the page asks again when it opens */ })
    .finally(() => { fetching.delete(slug); });
  fetching.set(slug, p);
  return p;
}

/** What a job row on Jobs spreads on its link: fetch the page ahead on hover and focus (only while the new page is on). */
export function prefetchProps(client: ApiClient, slug: string, on: boolean): { onPointerEnter?: () => void; onFocus?: () => void } {
  if (!on) return {};
  const go = () => { void prefetchPage(client, slug); };
  return { onPointerEnter: go, onFocus: go };
}

/** Forget every kept payload (tests). */
export function forgetRecentPages() {
  recent.clear();
  fetching.clear();
}
