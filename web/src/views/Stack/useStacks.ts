// The Stack pages' data: GET /api/stacks (every stack in a line each) and GET /api/stacks/:slug (one
// stack), read again every few seconds while a page shows them and whenever the jobs change (a
// part's job moving on is what moves a stack on). The actions post and show the answer at once.
// Stacks run only on the dashboard on your own computer: elsewhere the list says so instead.
// A page opened before starts from its last known answer (lib/lastKnown.ts), at once; the fresh
// one fills in quietly (packet R, principle 5).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type ApiClient } from '../../api/client';
import { lastKnown, remember } from '../../lib/lastKnown';
import { share } from '../../lib/share';
import { DEFAULT_SECTIONS_AT_ONCE, type PartPageData, type StackView, type StacksList } from '../../api/types';
import { useWorkshop } from '../../state/store';

/** How often an open page looks again, in ms. */
export const STACK_POLL_MS = 4000;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Look again every few seconds, and when the jobs change, while mounted. */
function useLookAgain(look: () => void) {
  const { store } = useWorkshop();
  const latest = useRef(look);
  latest.current = look;
  // The jobs are watched outside React: a change looks again without drawing the page.
  useEffect(() => {
    latest.current();
    let jobs = store.getState().jobs;
    return store.subscribe(() => {
      const now = store.getState().jobs;
      if (now === jobs) return;
      jobs = now;
      latest.current();
    });
  }, [store]);
  useEffect(() => {
    const t = setInterval(() => latest.current(), STACK_POLL_MS);
    return () => clearInterval(t);
  }, []);
}

/**
 * One ask for the list under way per client: every part of a page that looks while it is out (a job
 * page has several) shares its answer, so the page asks once, not once each. The next look after
 * it is answered asks again. `fresh` (a refresh after an action) never joins an ask sent before:
 * it starts its own and takes the ask's place, so later looks share the newer one.
 */
const listAsks = new WeakMap<object, Promise<StacksList>>();
function askForList(api: ApiClient, fresh = false): Promise<StacksList> {
  const out = listAsks.get(api);
  if (out && !fresh) return out;
  // (Promise.resolve: a test's bare api.get mock answers nothing, which counts as no stacks.)
  const ask = Promise.resolve().then(() => api.get<StacksList>('/api/stacks'));
  listAsks.set(api, ask);
  const done = () => { if (listAsks.get(api) === ask) listAsks.delete(api); };
  ask.then(done, done);
  return ask;
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
  // Each look is numbered: an answer older than one already taken is dropped (an ask sent before an
  // action that lands after the fresh one never puts the old list back).
  const asked = useRef(0);
  const taken = useRef(0);
  const out = useRef(0);
  const look = useCallback((fresh: boolean) => {
    // A plain look while one is out waits for it; a fresh one (after an action) always asks.
    if (out.current > 0 && !fresh) return;
    out.current += 1;
    const mine = ++asked.current;
    askForList(api, fresh).then(
      (l) => {
        if (mine < taken.current) return;
        taken.current = mine;
        // The same list as before stays the same object, so the pages showing it draw nothing again.
        setList((prev) => remember(api, '/api/stacks', share(prev, l && Array.isArray(l.stacks) ? l : { stacks: [], globalCap: DEFAULT_SECTIONS_AT_ONCE, globalRunning: 0 }))); setError(null); setUnavailable(null);
      },
      (err) => {
        if (mine < taken.current) return;
        if (err instanceof ApiError && err.status === 404) setUnavailable(err.message);
        else setError(message(err));
      },
    ).finally(() => { out.current -= 1; });
  }, [api]);
  // The polls and a jobs change share an ask; refresh (after an action, Try again) asks afresh.
  const poll = useCallback(() => look(false), [look]);
  const refresh = useCallback(() => look(true), [look]);
  useLookAgain(poll);
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
  const setView = useCallback((v: StackView) => setGot((prev) => {
    const view = remember(api, path, share(prev.path === path ? prev.view : null, v));
    return prev.path === path && prev.view === view ? prev : { path, view };
  }), [api, path]);
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
  // One request at a time: a busy button keeps its focus, so Enter in a form could ask again.
  const out = useRef(false);
  const act: StackState['act'] = useCallback(async (action, body = {}) => {
    if (out.current) return false;
    out.current = true;
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
      out.current = false;
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
  const out = useRef(false);
  const act: PartState['act'] = useCallback(async (action, body = {}) => {
    if (out.current) return false;
    out.current = true;
    setSending(true);
    setProblem(null);
    try { await api.post(`${base}/${action}`, body); refresh(); return true; } catch (err) { setProblem(message(err)); return false; } finally { out.current = false; setSending(false); }
  }, [api, base, refresh]);
  const diff = useCallback(async (file: string) => {
    try { return await api.get<{ file?: string; diff?: string; cut?: boolean; error?: string }>(`${path}/diff?file=${encodeURIComponent(file)}`); } catch (err) { return { error: message(err) }; }
  }, [api, path]);
  return { page, missing, error, sending, problem, clearProblem: () => setProblem(null), refresh, act, diff };
}
