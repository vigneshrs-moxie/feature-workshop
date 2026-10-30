// The Stack pages' data: GET /api/stacks (every stack in a line each) and GET /api/stacks/:slug (one
// stack), read again every few seconds while a page shows them and whenever the jobs change (a
// part's job moving on is what moves a stack on). The actions post and show the answer at once.
// Stacks run only on the dashboard on your own computer: elsewhere the list says so instead.
// A page opened before starts from its last known answer (lib/lastKnown.ts), at once; the fresh
// one fills in quietly (packet R, principle 5).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { lastKnown, remember } from '../../lib/lastKnown';
import { DEFAULT_SECTIONS_AT_ONCE, type PartPageData, type StackView, type StacksList } from '../../api/types';
import { useWorkshop, useWorkshopState } from '../../state/store';

/** How often an open page looks again, in ms. */
export const STACK_POLL_MS = 4000;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Look again every few seconds, and when the jobs change, while mounted. */
function useLookAgain(look: () => void) {
  const { jobs } = useWorkshopState();
  const latest = useRef(look);
  latest.current = look;
  useEffect(() => { latest.current(); }, [jobs]);
  useEffect(() => {
    const t = setInterval(() => latest.current(), STACK_POLL_MS);
    return () => clearInterval(t);
  }, []);
}

export interface StacksState {
  list: StacksList | null;
  /** The dashboard says stacks don't run here (it isn't on your own computer). */
  unavailable: string | null;
  error: string | null;
  refresh(): void;
}

/** Every stack (null until the first answer; an older dashboard without stacks gives null for good). */
export function useStacksList(): StacksState {
  const { api } = useWorkshop();
  const [list, setList] = useState<StacksList | null>(() => lastKnown<StacksList>(api, '/api/stacks') ?? null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const refresh = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    // (Promise.resolve: a test's bare api.get mock answers nothing, which counts as no stacks.)
    Promise.resolve().then(() => api.get<StacksList>('/api/stacks')).then(
      (l) => { setList(remember(api, '/api/stacks', l && Array.isArray(l.stacks) ? l : { stacks: [], globalCap: DEFAULT_SECTIONS_AT_ONCE, globalRunning: 0 })); setError(null); setUnavailable(null); },
      (err) => {
        if (err instanceof ApiError && err.status === 404) setUnavailable(err.message);
        else setError(message(err));
      },
    ).finally(() => { busy.current = false; });
  }, [api]);
  useLookAgain(refresh);
  return { list, unavailable, error, refresh };
}

export interface StackState {
  view: StackView | null;
  /** No stack by that name (404). */
  missing: string | null;
  error: string | null;
  /** An action is on its way. */
  sending: boolean;
  /** What the last action said when it was refused. */
  problem: string | null;
  clearProblem(): void;
  refresh(): void;
  /** POST /api/stacks/:slug/<action>; the answer (a view, or { view }) shows at once. */
  act(action: 'approve-plan' | 'settings' | 'merge' | 'send-back' | 'push', body?: Record<string, unknown>): Promise<boolean>;
}

export function useStackView(slug: string): StackState {
  const { api } = useWorkshop();
  const path = `/api/stacks/${encodeURIComponent(slug)}`;
  const [got, setGot] = useState<{ path: string; view: StackView | null }>(() => ({ path, view: lastKnown<StackView>(api, path) ?? null }));
  const view = got.path === path ? got.view : lastKnown<StackView>(api, path) ?? null;
  const setView = useCallback((v: StackView) => setGot({ path, view: remember(api, path, v) }), [api, path]);
  const [missing, setMissing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);
  const refresh = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    Promise.resolve().then(() => api.get<StackView>(path)).then(
      (v) => { setView(v); setMissing(null); setError(null); },
      (err) => {
        if (err instanceof ApiError && err.status === 404) setMissing(err.message);
        else setError(message(err));
      },
    ).finally(() => { busy.current = false; });
  }, [api, path, setView]);
  useLookAgain(refresh);
  const act: StackState['act'] = useCallback(async (action, body = {}) => {
    setSending(true);
    setProblem(null);
    try {
      const r = await api.post<StackView | { view?: StackView }>(`${path}/${action}`, body);
      const next = r && 'view' in r && r.view ? r.view : r && 'parts' in r ? (r as StackView) : null;
      if (next) setView(next);
      return true;
    } catch (err) {
      setProblem(message(err));
      return false;
    } finally {
      setSending(false);
    }
  }, [api, path, setView]);
  return { view, missing, error, sending, problem, clearProblem: () => setProblem(null), refresh, act };
}

export interface PartState {
  page: PartPageData | null;
  missing: string | null;
  error: string | null;
  sending: boolean;
  problem: string | null;
  clearProblem(): void;
  refresh(): void;
  /** POST /api/stacks/:slug/<action> for this part (merge, send-back); the page looks again after. */
  act(action: 'merge' | 'send-back', body?: Record<string, unknown>): Promise<boolean>;
  /** One changed file's diff (GET …/part/:n/diff?file=). */
  diff(file: string): Promise<{ file?: string; diff?: string; cut?: boolean; error?: string }>;
}

/** A part's own page (GET /api/stacks/:slug/part/:n), looked at again like the stack's. */
export function useStackPart(slug: string, n: number): PartState {
  const { api } = useWorkshop();
  const base = `/api/stacks/${encodeURIComponent(slug)}`;
  const path = `${base}/part/${n}`;
  const [got, setGot] = useState<{ path: string; page: PartPageData | null }>(() => ({ path, page: lastKnown<PartPageData>(api, path) ?? null }));
  const page = got.path === path ? got.page : lastKnown<PartPageData>(api, path) ?? null;
  const [missing, setMissing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);
  const refresh = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    Promise.resolve().then(() => api.get<PartPageData>(path)).then(
      (p) => { setGot({ path, page: remember(api, path, p) }); setMissing(null); setError(null); },
      (err) => {
        if (err instanceof ApiError && err.status === 404) setMissing(err.message);
        else setError(message(err));
      },
    ).finally(() => { busy.current = false; });
  }, [api, path]);
  useLookAgain(refresh);
  const act: PartState['act'] = useCallback(async (action, body = {}) => {
    setSending(true);
    setProblem(null);
    try { await api.post(`${base}/${action}`, body); refresh(); return true; } catch (err) { setProblem(message(err)); return false; } finally { setSending(false); }
  }, [api, base, refresh]);
  const diff = useCallback(async (file: string) => {
    try { return await api.get<{ file?: string; diff?: string; cut?: boolean; error?: string }>(`${path}/diff?file=${encodeURIComponent(file)}`); } catch (err) { return { error: message(err) }; }
  }, [api, path]);
  return { page, missing, error, sending, problem, clearProblem: () => setProblem(null), refresh, act, diff };
}
