// Try it's app for a job: its address once it runs (GET /api/job/:slug/local, `server.status` running
// and `url`), read when asked for and again on each `local-state` event for the job. Laptop only: off
// (null, nothing asked) when `on` is false. Shared by the hand test's `Open it` and the header's `Open app`.

import { useEffect, useState } from 'react';
import type { LiveEvent } from '../api/types';
import { onLiveEvent } from '../state/live';
import { useWorkshop } from '../state/store';

export type LiveEvents = (fn: (e: LiveEvent) => void) => () => void;

export function useAppUrl(slug: string, on: boolean, events: LiveEvents = onLiveEvent): string | null {
  const { api } = useWorkshop();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!on) { setUrl(null); return undefined; }
    let off = false;
    const read = () => {
      // A client that answers oddly (or throws) leaves the address as it was.
      let ask: Promise<{ server?: { status?: string } | null; url?: string | null }>;
      try {
        ask = Promise.resolve(api.get<{ server?: { status?: string } | null; url?: string | null }>(`/api/job/${encodeURIComponent(slug)}/local`));
      } catch {
        return;
      }
      ask.then(
        (v) => { if (!off) setUrl(v?.server?.status === 'running' && typeof v.url === 'string' && v.url ? v.url : null); },
        () => { /* the address stays as it was */ },
      );
    };
    read();
    const stop = events((e) => { if (e?.type === 'local-state' && e.job === slug) read(); });
    return () => { off = true; stop(); };
  }, [api, slug, on, events]);
  return on ? url : null;
}
