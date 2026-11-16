// The store holding WorkshopState, and the React hooks that read it.
import { createContext, useCallback, useContext, useRef, useSyncExternalStore } from 'react';
import type { ApiClient } from '../api/client';
import { initialState, reducer, type Action, type WorkshopState } from './reducer';

export interface Store {
  getState(): WorkshopState;
  dispatch(action: Action): void;
  subscribe(listener: () => void): () => void;
}

export function createStore(init: WorkshopState = initialState): Store {
  let state = init;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = reducer(state, action);
      if (next === state) return;
      state = next;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export interface Workshop {
  store: Store;
  api: ApiClient;
}

export const WorkshopContext = createContext<Workshop | null>(null);

export function useWorkshop(): Workshop {
  const w = useContext(WorkshopContext);
  if (!w) throw new Error('useWorkshop needs a <WorkshopContext.Provider> above it.');
  return w;
}

/** The whole state; it only changes identity when something in it changed. */
export function useWorkshopState(): WorkshopState {
  const { store } = useWorkshop();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/**
 * One part of the state, picked by `select`: the component draws again only when the pick changes
 * (by `isEqual`, Object.is by default), not on every event or snapshot. Prefer it (or
 * useWorkshopPick) to useWorkshopState in anything that stays on screen.
 */
export function useWorkshopSelector<T>(select: (s: WorkshopState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const { store } = useWorkshop();
  const latest = useRef({ select, isEqual });
  latest.current = { select, isEqual };
  const memo = useRef<{ state: WorkshopState; select: (s: WorkshopState) => T; value: T } | null>(null);
  const get = useCallback(() => {
    const state = store.getState();
    const { select: sel, isEqual: eq } = latest.current;
    const m = memo.current;
    if (m && m.state === state && m.select === sel) return m.value;
    const value = sel(state);
    const kept = m && eq(m.value, value) ? m.value : value;
    memo.current = { state, select: sel, value: kept };
    return kept;
  }, [store]);
  return useSyncExternalStore(store.subscribe, get, get);
}

/** These fields of the state (each compared by identity): `const { jobs, meta } = useWorkshopPick('jobs', 'meta')`. */
export function useWorkshopPick<K extends keyof WorkshopState>(...keys: K[]): Pick<WorkshopState, K> {
  return useWorkshopSelector(
    (s) => { const out = {} as Pick<WorkshopState, K>; for (const k of keys) out[k] = s[k]; return out; },
    (a, b) => keys.every((k) => a[k] === b[k]),
  );
}
