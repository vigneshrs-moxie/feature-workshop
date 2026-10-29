// Sending your answer to a permission or question card (POST /api/permissions/:id). Once the
// dashboard takes it, the card leaves the page at once (the dashboard's permission-gone event
// follows; applying both is harmless).
import { useState } from 'react';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(body: AnswerBody) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/permissions/${encodeURIComponent(p.id)}`, body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      return;
    }
    store.dispatch({ type: 'permission-answered', id: p.id });
  }
  return { busy, error, send };
}
