// What changed since vN (Task 18; design brief R5): a document's text now against its newest older
// version (the job's versions/ folder, lib/doc-versions.js; the item route serves it), line by line,
// worked out on the page: no new server work. Whether a document shows its changes is kept per open
// job (like Changes' pick, reader/branch.ts), so coming back to it shows the same.

import { useSyncExternalStore } from 'react';
import type { JobStore } from '../jobStore';
import type { JobPagePayload } from '../types';

export interface DiffLine { kind: 'same' | 'add' | 'del'; text: string }

/** Past this many changes the middle is shown as removed then added (a rewrite, read as one). */
const MAX_EDITS = 1000;

/**
 * The lines of `before` and `after`, each marked same, added or removed (Myers' diff on lines, after
 * the lines both start and end with are set aside).
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const head: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ kind: 'same', text }));
  return [...head, ...middle(a.slice(start, endA), b.slice(start, endB)), ...tail];
}

function middle(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const del = (text: string): DiffLine => ({ kind: 'del', text });
  const add = (text: string): DiffLine => ({ kind: 'add', text });
  if (!n || !m) return [...a.map(del), ...b.map(add)];
  const max = Math.min(n + m, MAX_EDITS);
  const off = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    const next = v;
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && next[off + k - 1] < next[off + k + 1]) ? next[off + k + 1] : next[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      next[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
    v = next;
  }
  if (found < 0) return [...a.map(del), ...b.map(add)];
  // Walk back from the end through the kept rows of V.
  const out: DiffLine[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const pv = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && pv[off + k - 1] < pv[off + k + 1]) ? k + 1 : k - 1;
    const px = pv[off + prevK];
    const py = px - prevK;
    while (x > px && y > py) { out.push({ kind: 'same', text: a[x - 1] }); x--; y--; }
    if (x === px) out.push(add(b[py])); else out.push(del(a[px]));
    x = px;
    y = py;
  }
  while (x > 0 && y > 0) { out.push({ kind: 'same', text: a[x - 1] }); x--; y--; }
  return out.reverse();
}

/** A document's newest older version, when the reader shows the document as it is now (not an older one). */
export function newestOlder(p: JobPagePayload | null, id: string): { n: string; id: string } | null {
  for (const s of p?.steps ?? []) {
    for (const o of [...s.outputs, ...(s.more ?? [])]) if (o.kind === 'doc' && o.id === id) return o.versions?.[0] ?? null;
  }
  return null;
}

// ---------- Which documents show their changes (per open job) ----------

interface Held { on: ReadonlySet<string>; listeners: Set<() => void>; subscribe(l: () => void): () => void }
const held = new WeakMap<JobStore, Held>();

function heldOf(store: JobStore): Held {
  let h = held.get(store);
  if (!h) {
    const listeners = new Set<() => void>();
    h = { on: new Set(), listeners, subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; } };
    held.set(store, h);
  }
  return h;
}

/** Show (or stop showing) what changed in a document. */
export function setShowChanges(store: JobStore, id: string, on: boolean) {
  const h = heldOf(store);
  if (h.on.has(id) === on) return;
  const next = new Set(h.on);
  if (on) next.add(id); else next.delete(id);
  h.on = next;
  for (const l of [...h.listeners]) l();
}

/** Whether a document shows what changed. */
export function useShowChanges(store: JobStore, id: string): boolean {
  const h = heldOf(store);
  return useSyncExternalStore(h.subscribe, () => h.on.has(id), () => h.on.has(id));
}
