// The flow map's data: fetched once Home is shown (GET /api/flow), then kept up by the dashboard's
// 'flow' events. refresh() asks for a fetch and PR read now (POST /api/flow/refresh).
import { useCallback, useEffect, useState } from 'react';
import type { FlowView } from '../api/types';
import { useWorkshop, useWorkshopState } from '../state/store';

export function useFlow(): { flow: FlowView | null; refresh(): Promise<void>; problem: string | null } {
  const { api, store } = useWorkshop();
  const { flow } = useWorkshopState();
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
  const refresh = useCallback(async () => {
    setProblem(null);
    try { store.dispatch({ type: 'flow', flow: await api.post<FlowView>('/api/flow/refresh', {}) }); } catch (err) { setProblem(err instanceof Error ? err.message : String(err)); }
  }, [api, store]);
  return { flow, refresh, problem };
}
