// The flow map's data: fetched once Home is shown (GET /api/flow), then kept up by the dashboard's
// 'flow' events. refresh() asks for a fetch and PR read now (POST /api/flow/refresh); refreshing is
// true from the click until the read is done, so Refresh can't be pressed twice meanwhile.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlowView } from '../api/types';
import { useWorkshop, useWorkshopPick } from '../state/store';

export function useFlow(): { flow: FlowView | null; refresh(): Promise<void>; refreshing: boolean; problem: string | null } {
  const { api, store } = useWorkshop();
  const { flow } = useWorkshopPick('flow');
  const [problem, setProblem] = useState<string | null>(null);
  const missing = flow === null;
  useEffect(() => {
    if (!missing) return;
    let live = true;
    api.get<FlowView>('/api/flow')
      .then((f) => { if (live) store.dispatch({ type: 'flow', flow: f }); })
      .catch((err) => { if (live) setProblem(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; };
  }, [api, store, missing]);
  const [asking, setAsking] = useState(false);
  const out = useRef(false);
  const refresh = useCallback(async () => {
    if (out.current) return;
    out.current = true;
    setAsking(true);
    setProblem(null);
    try { store.dispatch({ type: 'flow', flow: await api.post<FlowView>('/api/flow/refresh', {}) }); } catch (err) { setProblem(err instanceof Error ? err.message : String(err)); } finally { out.current = false; setAsking(false); }
  }, [api, store]);
  return { flow, refresh, refreshing: asking || Boolean(flow?.refreshing), problem };
}
