// Fetches the open job's conversation: GET /api/job/:slug for the newest page (again whenever a
// 'thread' event for this job bumps its version in the store, so other jobs never refetch, and
// after a resync, when the store's threadEpoch moves on), and
// GET /api/job/:slug?before=<id> for "Load older". Pages are joined by the items' stable ids.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import type { JobDetail, ThreadItem, ThreadPage } from '../../api/types';
import { useWorkshop } from '../../state/store';
import { mergeThread, olderStillJoins } from './thread';

export interface JobThread {
  detail: JobDetail | null;
  items: ThreadItem[];
  /** Older items exist on the dashboard. */
  more: boolean;
  loading: boolean;
  loadingOlder: boolean;
  error: string | null;
  loadOlder(): void;
}

interface Pages {
  slug: string;
  detail: JobDetail | null;
  latest: ThreadItem[];
  older: ThreadItem[];
  more: boolean;
  error: string | null;
}

const empty = (slug: string): Pages => ({ slug, detail: null, latest: [], older: [], more: false, error: null });
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const jobPath = (slug: string) => `/api/job/${encodeURIComponent(slug)}`;

export function useJobThread(slug: string, version: number): JobThread {
  const { api } = useWorkshop();
  const [pages, setPages] = useState<Pages>(() => empty(slug));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const current = pages.slug === slug ? pages : empty(slug);
  const ref = useRef(current);
  ref.current = current;

  useEffect(() => {
    let cancelled = false;
    api.get<JobDetail>(jobPath(slug)).then(
      (detail) => {
        if (cancelled) return;
        const latest = Array.isArray(detail.thread) ? detail.thread : [];
        setPages((prev) => {
          const keep = prev.slug === slug && prev.older.length > 0 && olderStillJoins(prev.latest, latest);
          return {
            slug, detail, latest,
            older: keep ? prev.older : [],
            more: keep ? prev.more : Boolean(detail.threadMore),
            error: null,
          };
        });
      },
      (err) => {
        if (cancelled) return;
        setPages((prev) => ({ ...(prev.slug === slug ? prev : empty(slug)), error: `Couldn’t load this conversation: ${message(err)}` }));
      },
    );
    return () => { cancelled = true; };
  }, [api, slug, version]);

  const loadOlder = useCallback(() => {
    const p = ref.current;
    const first = mergeThread(p.older, p.latest)[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    api.get<ThreadPage>(`${jobPath(slug)}?before=${encodeURIComponent(first.id)}`).then(
      (page) => {
        setPages((prev) => (prev.slug !== slug ? prev : {
          ...prev,
          older: mergeThread(page.thread ?? [], prev.older),
          more: Boolean(page.threadMore),
          error: null,
        }));
      },
      (err) => {
        const why = err instanceof ApiError && err.status === 404 ? err.message : `Couldn’t load older messages: ${message(err)}`;
        setPages((prev) => (prev.slug !== slug ? prev : { ...prev, error: why }));
      },
    ).finally(() => setLoadingOlder(false));
  }, [api, slug, loadingOlder]);

  return {
    detail: current.detail,
    items: mergeThread(current.older, current.latest),
    more: current.more,
    loading: current.detail === null && current.error === null,
    loadingOlder,
    error: current.error,
    loadOlder,
  };
}
