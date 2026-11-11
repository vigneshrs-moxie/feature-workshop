// Sending your answer to a permission or question card (POST /api/permissions/:id). Once the
// dashboard takes it, the card leaves the page at once (the dashboard's permission-gone event
// follows; applying both is harmless).
import { useRef, useState } from 'react';
import type { Permission } from '../../api/types';
import { useWorkshop } from '../../state/store';

export interface AnswerBody {
  /** allow-job: always allow steps like this for the rest of this job (only where the card offers it). */
  decision: 'allow' | 'allow-run' | 'allow-job' | 'deny';
  note?: string;
  answers?: Record<string, string>;
}

export function useAnswer(p: Permission) {
  const { api, store } = useWorkshop();
  // The answer on its way (its button spins; every button is off and none sends twice).
  const [pending, setPending] = useState<AnswerBody['decision'] | null>(null);
  const out = useRef(false);
  const [error, setError] = useState<string | null>(null);
  async function send(body: AnswerBody) {
    if (out.current) return;
    out.current = true;
    setPending(body.decision);
    setError(null);
    let r: { queued?: unknown } | null = null;
    try {
      r = await api.post<{ queued?: unknown }>(`/api/permissions/${encodeURIComponent(p.id)}`, body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      out.current = false;
      setPending(null);
      return;
    }
    out.current = false;
    // On the hosted site the answer waits for the laptop: the card stays, saying so (its next fetch).
    if (r && typeof r === 'object' && r.queued) { setPending(null); return; }
    store.dispatch({ type: 'permission-answered', id: p.id });
  }
  return { busy: pending !== null, pending, error, send };
}
