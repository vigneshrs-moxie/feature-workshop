// usePlayLedger(): the play ledger (GET /api/play: crew met with their stats, quests, achievements,
// secrets found, unlocks), kept fresh: fetched again on the dashboard's 'play' event (playVersion),
// on every new snapshot (generatedAt: the jobs changed) and when Play mode changes. What was shown
// stays up while a refetch runs, so the page never blinks back to "Loading". Nothing is fetched
// while Play mode is Off.
//
// The shell fetches it once for the whole page (<PlayLedgerProvider>, play/PlayLedger.tsx), which
// also hands the unlocks to the theme picker; a view rendered on its own (a test) fetches its own.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { PlayResponse, PlayView } from '../api/types';
import { useWorkshop, useWorkshopState } from '../state/store';
import { playOf } from './settings';

export type LedgerLoad =
  | { state: 'loading' }
  | { state: 'ready'; view: PlayView }
  | { state: 'off' }
  | { state: 'error'; message: string };

export interface Ledger {
  load: LedgerLoad;
  retry: () => void;
}

const isView = (r: PlayResponse | null | undefined): r is PlayView => Boolean(r && r.mode !== 'off' && 'crew' in r);

/** The ledger as one place fetches it (enabled false: nothing is fetched, for when a provider does it). */
export function useLedgerFetch(enabled = true): Ledger {
  const { api } = useWorkshop();
  const { playVersion, generatedAt, meta } = useWorkshopState();
  const mode = playOf(meta?.settings).mode;
  // Before the first snapshot the Play mode isn't known yet: wait, so Off never fetches anything.
  const known = Boolean(meta);
  const [load, setLoad] = useState<LedgerLoad>({ state: 'loading' });
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!enabled || !known || mode === 'off') return;
    let cancelled = false;
    api.get<PlayResponse>('/api/play').then(
      (r) => { if (!cancelled) setLoad(isView(r) ? { state: 'ready', view: r } : { state: 'off' }); },
      (err) => {
        if (cancelled) return;
        // Keep a ledger already shown; only an empty page says it couldn't load.
        setLoad((prev) => (prev.state === 'ready' ? prev : { state: 'error', message: err instanceof Error ? err.message : String(err) }));
      },
    );
    return () => { cancelled = true; };
  }, [api, enabled, known, mode, playVersion, generatedAt, tries]);

  const retry = useCallback(() => setTries((n) => n + 1), []);
  return { load: mode === 'off' ? { state: 'off' } : load, retry };
}

/** The page's one ledger, from <PlayLedgerProvider>. */
export const PlayLedgerContext = createContext<Ledger | null>(null);

/** enabled false: with no provider above, fetch nothing (a caller that only needs it in Full mode). */
export function usePlayLedger(enabled = true): Ledger {
  const shared = useContext(PlayLedgerContext);
  const own = useLedgerFetch(!shared && enabled);
  return shared ?? own;
}
