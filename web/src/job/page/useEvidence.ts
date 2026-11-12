// A job's evidence view (GET /api/job/<slug>/evidence) for the Test step: what the recorder does now
// (its progress, line by line), the last recording and its problem. It asks every 3 s while a
// recording runs, as the evidence strip does, else every 30 s. It stops asking when the job changes
// or the component goes; an answer for another job never lands; a request that fails keeps the
// last view (nothing flashes to empty).
import { useCallback, useEffect, useState } from 'react';
import type { EvidenceView } from '../../api/types';
import { useWorkshop } from '../../state/store';

/** How often to ask while a recording runs, and otherwise. */
export const EVIDENCE_LIVE_MS = 3_000;
export const EVIDENCE_QUIET_MS = 30_000;

export function useEvidence(slug: string): { view: EvidenceView | null; reload(): void } {
  const { api } = useWorkshop();
  const [held, setHeld] = useState<{ slug: string; view: EvidenceView | null }>({ slug, view: null });
  // Another job: start empty, never with this one's view.
  let current = held;
  if (held.slug !== slug) {
    current = { slug, view: null };
    setHeld(current);
  }
  const [tries, setTries] = useState(0);

  const ask = useCallback((alive: () => boolean) => Promise.resolve(api.get<EvidenceView>(`/api/job/${encodeURIComponent(slug)}/evidence`)).then(
    (view) => {
      if (!alive() || !view || typeof view !== 'object') return;
      setHeld((h) => (h.slug === slug ? { slug, view } : h));
    },
    // The step shows its last view; the next ask tries again.
    () => {},
  ), [api, slug]);

  // At once: on mount, on another job, and on reload.
  useEffect(() => {
    let on = true;
    void ask(() => on);
    return () => { on = false; };
  }, [ask, tries]);

  // Then again and again: every 3 s while it records, else every 30 s.
  const view = current.view;
  const every = view?.recording ? EVIDENCE_LIVE_MS : EVIDENCE_QUIET_MS;
  useEffect(() => {
    let on = true;
    const id = setInterval(() => void ask(() => on), every);
    return () => { on = false; clearInterval(id); };
  }, [ask, every]);

  const reload = useCallback(() => setTries((n) => n + 1), []);
  return { view, reload };
}
