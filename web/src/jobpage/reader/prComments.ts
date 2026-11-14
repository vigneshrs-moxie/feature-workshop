// One PR's comments for the reader's PR view (job page rebuild, Task 21; design brief R3): GET
// /api/job/:slug/pr/:n, kept per open job, asked for when the view opens and again only when the PR
// line's `comments.v` moved (a new read, a mark, the Foreman's answer), never on a timer. What he did
// on the rows (ticks, edited drafts, what he posted) is kept here too, so a row drawn again keeps it.
// Nothing is asked on the website: the PR routes are the laptop's only.

import { useSyncExternalStore } from 'react';
import type { ApiClient } from '../../api/client';
import type { JobStore } from '../jobStore';
import type { PrView } from '../types';

export interface PrHeld {
  /** The last answer by PR line (1, 2, 3). */
  views: ReadonlyMap<number, PrView>;
  /** Why the last ask failed, by line, when nothing is held. */
  errors: ReadonlyMap<number, string>;
  /** His ticks: a row he ticked or unticked by hand (a new row is ticked unless he unticked it). */
  ticks: ReadonlyMap<string, boolean>;
  /** His edits of a drafted reply, by row id. */
  drafts: ReadonlyMap<string, string>;
}

interface Held {
  state: PrHeld;
  subscribe: (l: () => void) => () => void;
  listeners: Set<() => void>;
  /** The version asked for (or being asked for) by line. */
  asked: Map<number, string>;
}

const held = new WeakMap<JobStore, Held>();

function heldOf(store: JobStore): Held {
  let h = held.get(store);
  if (!h) {
    const listeners = new Set<() => void>();
    h = { state: { views: new Map(), errors: new Map(), ticks: new Map(), drafts: new Map() }, listeners, asked: new Map(), subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; } };
    held.set(store, h);
  }
  return h;
}

function set(h: Held, next: Partial<PrHeld>) {
  h.state = { ...h.state, ...next };
  for (const l of [...h.listeners]) l();
}

const words = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Ask for one PR's rows, unless the version v (the PR line's comments.v) was already asked for. */
export async function loadPr(store: JobStore, api: ApiClient, slug: string, n: number, v: string | null, { force = false } = {}): Promise<void> {
  const h = heldOf(store);
  const key = v ?? '';
  if (!force && h.asked.get(n) === key && (h.state.views.has(n) || h.state.errors.has(n))) return;
  h.asked.set(n, key);
  try {
    const r = await api.get<PrView>(`/api/job/${encodeURIComponent(slug)}/pr/${n}`);
    if (h.asked.get(n) !== key) return; // a newer ask is out
    const errors = new Map(h.state.errors);
    errors.delete(n);
    set(h, { views: new Map(h.state.views).set(n, { ...r, rows: Array.isArray(r?.rows) ? r.rows : [], checks: Array.isArray(r?.checks) ? r.checks : [] }), errors });
  } catch (err) {
    if (h.asked.get(n) !== key) return;
    h.asked.delete(n);
    set(h, { errors: new Map(h.state.errors).set(n, words(err)) });
  }
}

export function prHeld(store: JobStore): PrHeld {
  return heldOf(store).state;
}

export function setTick(store: JobStore, id: string, on: boolean) {
  const h = heldOf(store);
  set(h, { ticks: new Map(h.state.ticks).set(id, on) });
}

export function setDraft(store: JobStore, id: string, text: string) {
  const h = heldOf(store);
  set(h, { drafts: new Map(h.state.drafts).set(id, text) });
}

export function usePrHeld(store: JobStore): PrHeld {
  const h = heldOf(store);
  return useSyncExternalStore(h.subscribe, () => h.state, () => h.state);
}
