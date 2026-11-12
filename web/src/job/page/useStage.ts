// One step's view (GET /api/job/<slug>/stage/<stop>), moved here from the step page so the job page's
// open step and the step page load it alike. Back on a step seen before: its last answer at once,
// and the fresh one fills in. It asks again every 5 s while the step is working or waiting (the
// feed moves without the job changing), else every 30 s, and at once whenever the job changes
// (job.updatedAt). It stops asking when the step changes or the component goes; an answer for
// another step is never drawn into this one.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StageView, StopId } from '../../api/types';
import { lastKnown, remember } from '../../lib/lastKnown';
import { jobBySlug } from '../../state/reducer';
import { useWorkshop, useWorkshopState } from '../../state/store';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: StageView };

/** How often to ask while someone works at the step, and otherwise. */
export const STAGE_LIVE_MS = 5_000;
export const STAGE_QUIET_MS = 30_000;

const live = (view: StageView | null) => Boolean(view) && (view!.state === 'now' || view!.state === 'waiting' || view!.agents.some((a) => a.status === 'working' || a.status === 'waiting'));

export function useStage(slug: string, stop: StopId): { view: StageView | null; error: string | null; reload(): void } {
  const { api } = useWorkshop();
  const updatedAt = jobBySlug(useWorkshopState(), slug)?.updatedAt ?? null;
  const path = `/api/job/${encodeURIComponent(slug)}/stage/${stop}`;
  const first = (p: string): Load => {
    const known = lastKnown<StageView>(api, p);
    return known ? { state: 'ready', value: known } : { state: 'loading' };
  };
  const [held, setHeld] = useState<{ path: string; load: Load }>(() => ({ path, load: first(path) }));
  // Another step (or job): start from its own last answer, never this one's.
  let current = held;
  if (held.path !== path) {
    current = { path, load: first(path) };
    setHeld(current);
  }
  const [tries, setTries] = useState(0);

  // Each ask is numbered: an answer older than one already taken is dropped (a slow first ask that
  // lands after a quick second one never puts the older view back).
  const asked = useRef(0);
  const taken = useRef(0);
  const ask = useCallback((alive: () => boolean) => {
    const mine = ++asked.current;
    const newest = () => {
      if (mine < taken.current) return false;
      taken.current = mine;
      return true;
    };
    return api.get<StageView>(path).then(
      (value) => {
        if (!newest()) return;
        remember(api, path, value);
        if (alive()) setHeld((h) => (h.path === path ? { path, load: { state: 'ready', value } } : h));
      },
      (err) => {
        if (!newest()) return;
        const message = err instanceof Error ? err.message : String(err);
        // A refresh that fails keeps what the step showed.
        if (alive()) setHeld((h) => (h.path === path && h.load.state !== 'ready' ? { path, load: { state: 'error', message } } : h));
      },
    );
  }, [api, path]);

  // At once: on mount, on another step, on Try again, and whenever the job changes.
  useEffect(() => {
    let on = true;
    void ask(() => on);
    return () => { on = false; };
  }, [ask, tries, updatedAt]);

  // Then again and again: every 5 s while someone works here, else every 30 s.
  const view = current.load.state === 'ready' ? current.load.value : null;
  const every = live(view) ? STAGE_LIVE_MS : STAGE_QUIET_MS;
  useEffect(() => {
    let on = true;
    const id = setInterval(() => void ask(() => on), every);
    return () => { on = false; clearInterval(id); };
  }, [ask, every]);

  // Try again: loading again in the error's place while it asks.
  const reload = useCallback(() => {
    setHeld((h) => (h.load.state === 'error' ? { path: h.path, load: { state: 'loading' } } : h));
    setTries((n) => n + 1);
  }, []);
  return { view, error: current.load.state === 'error' ? current.load.message : null, reload };
}
