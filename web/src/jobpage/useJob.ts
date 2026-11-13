// Reading the job page's store (jobStore.ts) from a component: useJob(selector) redraws the
// component only when what the selector returns changed (Object.is, or the equal check given), so
// a change to one part of the job redraws only the parts that read it.
//
// A selector should return a part of the state as it is (s.payload?.steps, s.ui.draft) or a plain
// value; one that builds a new object each time needs an equal check.

import { createContext, useContext, useRef, useSyncExternalStore } from 'react';
import type { JobPageState, JobStore } from './jobStore';

export const JobStoreContext = createContext<JobStore | null>(null);

/** The open job's store, for its actions (loadBody, setStep, …). */
export function useJobStore(): JobStore {
  const store = useContext(JobStoreContext);
  if (!store) throw new Error('useJob needs a <JobStoreContext.Provider> above it.');
  return store;
}

export function useJob<T>(selector: (s: JobPageState) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const store = useJobStore();
  const last = useRef<{ state: JobPageState; selector: (s: JobPageState) => T; value: T } | null>(null);
  const read = () => {
    const state = store.getState();
    const was = last.current;
    if (was && was.state === state && was.selector === selector) return was.value;
    const value = selector(state);
    const kept = was && equal(was.value, value) ? was.value : value;
    last.current = { state, selector, value: kept };
    return kept;
  };
  return useSyncExternalStore(store.subscribe, read, read);
}
