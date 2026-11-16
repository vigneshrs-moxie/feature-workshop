// Structural sharing for data read again from the server (a snapshot, a list fetched every few
// seconds): every part of the new answer that is the same as before is the old object, so React
// sees "nothing changed" by identity and a part that shows it does not draw again. Lists of things
// with a slug or an id keep each thing by that key, so a job that moved place but did not change is
// still the same object. JSON-shaped data only (plain objects, arrays, strings, numbers, booleans, null).

import { useRef } from 'react';

type Keyed = { slug?: unknown; id?: unknown };
const keyOf = (v: unknown): string | null => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const k = (v as Keyed).slug ?? (v as Keyed).id;
  return typeof k === 'string' || typeof k === 'number' ? String(k) : null;
};
const isPlain = (v: unknown): v is Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** `next`, with every part equal to the same part of `prev` replaced by `prev`'s (prev itself when all of it is equal). */
export function share<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return prev as T;
  if (Array.isArray(prev) && Array.isArray(next)) return shareList(prev, next) as T;
  if (isPlain(prev) && isPlain(next)) return shareObject(prev, next) as T;
  return next;
}

function shareList(prev: unknown[], next: unknown[]): unknown[] {
  // By key when every old item has one (unique), else by place.
  let byKey: Map<string, unknown> | null = new Map();
  for (const p of prev) {
    const k = keyOf(p);
    if (k === null || byKey.has(k)) { byKey = null; break; }
    byKey.set(k, p);
  }
  let same = prev.length === next.length;
  const out = next.map((n, i) => {
    const k = byKey ? keyOf(n) : null;
    const before = byKey ? (k !== null ? byKey.get(k) : undefined) : prev[i];
    const v = before === undefined ? n : share(before, n);
    if (v !== prev[i]) same = false;
    return v;
  });
  return same ? prev : out;
}

function shareObject(prev: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(next);
  let same = keys.length === Object.keys(prev).length;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = k in prev ? share(prev[k], next[k]) : next[k];
    if (v !== prev[k] || !(k in prev)) same = false;
    out[k] = v;
  }
  return same ? prev : out;
}

/** `next`, kept identical to what this component had last time wherever it is the same (share above). */
export function useKept<T>(next: T): T {
  const kept = useRef(next);
  kept.current = share(kept.current, next);
  return kept.current;
}
