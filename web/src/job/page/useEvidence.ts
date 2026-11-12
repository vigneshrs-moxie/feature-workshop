// A job's evidence view (GET /api/job/<slug>/evidence) for the Test step: what the recorder does now
// (its progress, line by line), the last recording and its problem. It asks every 3 s while a
// recording runs, as the evidence strip does, else every 30 s. It stops asking when the job changes
// or the component goes; an answer for another job never lands; a request that fails keeps the
// last view (nothing flashes to empty). Not known is never shown as a fact: `loaded` is false until
// the first answer (a view or a failure), and `error` is the last failure while it holds no view.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EvidenceView } from '../../api/types';
import { useWorkshop } from '../../state/store';

/** How often to ask while a recording runs, and otherwise. */
export const EVIDENCE_LIVE_MS = 3_000;
export const EVIDENCE_QUIET_MS = 30_000;

export interface EvidenceState {
  view: EvidenceView | null;
  /** An answer came for this job: a view, or a failure. */
  loaded: boolean;
  /** The last failure while there is no view; null once a view is in. */
  error: string | null;
  reload(): void;
}

type Held = { slug: string; view: EvidenceView | null; loaded: boolean; error: string | null };

export function useEvidence(slug: string): EvidenceState {
  const { api } = useWorkshop();
  const [held, setHeld] = useState<Held>({ slug, view: null, loaded: false, error: null });
  // Another job: start empty and not known, never with this one's view.
  let current = held;
  if (held.slug !== slug) {
    current = { slug, view: null, loaded: false, error: null };
    setHeld(current);
  }
  const [tries, setTries] = useState(0);

  // Each ask is numbered: an answer older than one already taken is dropped (a slow ask that lands
  // after a quicker later one never puts the older view back).
  const asked = useRef(0);
  const taken = useRef(0);
  const ask = useCallback((alive: () => boolean) => {
    const mine = ++asked.current;
    // A failure never replaces a view: with one held, the step keeps showing it.
    const failed = (why: string) => setHeld((h) => (h.slug !== slug || h.view ? h : { ...h, loaded: true, error: why }));
    return Promise.resolve(api.get<EvidenceView>(`/api/job/${encodeURIComponent(slug)}/evidence`)).then(
      (view) => {
        if (!alive() || mine < taken.current) return;
        if (!view || typeof view !== 'object') { failed('The answer had no evidence in it.'); return; }
        taken.current = mine;
        setHeld((h) => (h.slug === slug ? { slug, view, loaded: true, error: null } : h));
      },
      // The step shows its last view; the next ask tries again. With no view yet, it says why.
      (err: unknown) => { if (alive()) failed(err instanceof Error ? err.message : String(err)); },
    );
  }, [api, slug]);

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
  return { view, loaded: current.loaded, error: current.view ? null : current.error, reload };
}
