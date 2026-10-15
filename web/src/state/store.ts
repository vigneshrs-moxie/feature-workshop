// The store holding WorkshopState, and the React hooks that read it.
import { createContext, useContext, useSyncExternalStore } from 'react';
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
