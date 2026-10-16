// usePlayLedger(): the play ledger (GET /api/play: crew met with their stats, quests, achievements,
// secrets found), kept fresh: fetched again on the dashboard's 'play' event (playVersion), on every
// new snapshot (generatedAt: the jobs changed) and when Play mode changes. What was shown stays up
// while a refetch runs, so the page never blinks back to "Loading". Nothing is fetched while Play
// mode is Off.
import { useEffect, useState } from 'react';
import type { PlayResponse, PlayView } from '../api/types';
import { useWorkshop, useWorkshopState } from '../state/store';
import { playOf } from './settings';

export type LedgerLoad =
  | { state: 'loading' }
  | { state: 'ready'; view: PlayView }
  | { state: 'off' }
  | { state: 'error'; message: string };

const isView = (r: PlayResponse | null | undefined): r is PlayView => Boolean(r && r.mode !== 'off' && 'crew' in r);

export function usePlayLedger(): { load: LedgerLoad; retry: () => void } {
  const { api } = useWorkshop();
  const { playVersion, generatedAt, meta } = useWorkshopState();
  const mode = playOf(meta?.settings).mode;
  const [load, setLoad] = useState<LedgerLoad>({ state: 'loading' });
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (mode === 'off') return;
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
  }, [api, mode, playVersion, generatedAt, tries]);

  return { load: mode === 'off' ? { state: 'off' } : load, retry: () => setTries((n) => n + 1) };
}
