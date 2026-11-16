// usePlayLedger(): the play ledger (GET /api/play: crew met with their stats, quests, achievements,
// secrets found, unlocks), kept fresh: fetched again on the dashboard's 'play' event (playVersion),
// on a new snapshot that changed the jobs or the settings (both kept identical when a snapshot
// says the same: state/reducer.ts) and when Play mode changes. What was shown
// stays up while a refetch runs, so the page never blinks back to "Loading". Nothing is fetched
// while Play mode is Off.
//
// The shell fetches it once for the whole page (<PlayLedgerProvider>, play/PlayLedger.tsx), which
// also hands the unlocks to the theme picker; a view rendered on its own (a test) fetches its own.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PlayResponse, PlayView } from '../api/types';
import { useWorkshop, useWorkshopSelector } from '../state/store';
import { playOf } from './settings';
import { share } from '../lib/share';

export type LedgerLoad =
  | { state: 'loading' }
  | { state: 'ready'; view: PlayView }
  | { state: 'off' }
  | { state: 'error'; message: string };

export interface Ledger {
  load: LedgerLoad;
  retry: () => void;
}

const OFF: LedgerLoad = { state: 'off' };
const isView = (r: PlayResponse | null | undefined): r is PlayView => Boolean(r && r.mode !== 'off' && 'crew' in r);

/** The ledger as one place fetches it (enabled false: nothing is fetched, for when a provider does it). */
export function useLedgerFetch(enabled = true): Ledger {
  const { api, store } = useWorkshop();
  const mode = useWorkshopSelector((s) => playOf(s.meta?.settings).mode);
  // Before the first snapshot the Play mode isn't known yet: wait, so Off never fetches anything.
  const known = useWorkshopSelector((s) => Boolean(s.meta));
  const [load, setLoad] = useState<LedgerLoad>({ state: 'loading' });
  const [tries, setTries] = useState(0);
  // Each ask is numbered: only the newest one's answer is taken.
  const asked = useRef(0);
  const fetchNow = useCallback(() => {
    const mine = ++asked.current;
    api.get<PlayResponse>('/api/play').then(
      // The same ledger as before stays the same object, so nothing that shows it draws again.
      (r) => { if (mine === asked.current) setLoad((prev) => share(prev, isView(r) ? { state: 'ready', view: r } : { state: 'off' })); },
      (err) => {
        if (mine !== asked.current) return;
        // Keep a ledger already shown; only an empty page says it couldn't load.
        setLoad((prev) => (prev.state === 'ready' ? prev : { state: 'error', message: err instanceof Error ? err.message : String(err) }));
      },
    );
  }, [api]);

  useEffect(() => {
    if (!enabled || !known || mode === 'off') return undefined;
    fetchNow();
    // A 'play' event, or a snapshot with other jobs or settings, asks again: watched outside React,
    // so nothing draws until the answer differs.
    let { playVersion, jobs, meta } = store.getState();
    const off = store.subscribe(() => {
      const s = store.getState();
      if (s.playVersion === playVersion && s.jobs === jobs && s.meta === meta) return;
      ({ playVersion, jobs, meta } = s);
      fetchNow();
    });
    return () => { off(); asked.current += 1; };
  }, [store, fetchNow, enabled, known, mode, tries]);

  const retry = useCallback(() => setTries((n) => n + 1), []);
  const off = mode === 'off';
  return useMemo(() => ({ load: off ? OFF : load, retry }), [off, load, retry]);
}

/** The page's one ledger, from <PlayLedgerProvider>. */
export const PlayLedgerContext = createContext<Ledger | null>(null);

/** enabled false: with no provider above, fetch nothing (a caller that only needs it in Full mode). */
export function usePlayLedger(enabled = true): Ledger {
  const shared = useContext(PlayLedgerContext);
  const own = useLedgerFetch(!shared && enabled);
  return shared ?? own;
}
