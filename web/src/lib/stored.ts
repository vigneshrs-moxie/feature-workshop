// Small settings remembered in this browser (localStorage), shared by every component that reads
// the same key: a change made in one place shows up everywhere at once. If storage is turned off
// the setting still works for this visit; it just isn't remembered.
import { useCallback, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
const memory = new Map<string, string | null>();

export function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return memory.get(key) ?? null; }
}

export function writeStored(key: string, value: string | null) {
  memory.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage off: kept in memory for this visit */ }
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = () => listener(); // another tab changed it
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

/** A remembered string setting, and a setter. `null` means never set. */
export function useStored(key: string): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(subscribe, () => readStored(key), () => null);
  const set = useCallback((v: string | null) => writeStored(key, v), [key]);
  return [value, set];
}
