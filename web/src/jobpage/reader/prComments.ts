// One PR's comments for the reader's PR view (job page rebuild, Task 21; design brief R3): GET
// /api/job/:slug/pr/:n, kept per open job, asked for when the view opens and again only when the PR
// line's `comments.v` moved (a new read, a mark, the Foreman's answer), never on a timer. What he did
// on the rows (ticks, edited drafts, what he posted) is kept here too, so a row drawn again keeps it.
// Nothing is asked on the website: the PR routes are the laptop's only.

import { useSyncExternalStore } from 'react';
import type { ApiClient } from '../../api/client';
import type { JobStore } from '../jobStore';
import type { PrRow, PrView } from '../types';

export interface PrHeld {
  /** The last answer by PR line (1, 2, 3). */
  views: ReadonlyMap<number, PrView>;
  /** Why the last ask failed, by line, when nothing is held. */
  errors: ReadonlyMap<number, string>;
  /** His ticks: a row he ticked or unticked by hand (a new row is ticked unless he unticked it). */
  ticks: ReadonlyMap<string, boolean>;
  /** His edits of a drafted reply, by row id. */
  drafts: ReadonlyMap<string, string>;
  /**
   * What he just did on a row (Fix these, Leave, Post it), shown until the server's rows show it too: the rows
   * come from the page's next rebuild, a moment after the click, so the row never flickers back to New.
   */
  pending: ReadonlyMap<string, Pending>;
}
export type Pending = { state: 'fixing' | 'left' } | { state: 'posted'; text: string };

/** Whether the server's row shows what he did (then the pending mark goes). */
const caughtUp = (p: Pending, row: PrRow | undefined) => (p.state === 'posted' ? Boolean(row?.reply?.posted) : Boolean(row && row.state !== 'new'));

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
    h = { state: { views: new Map(), errors: new Map(), ticks: new Map(), drafts: new Map(), pending: new Map() }, listeners, asked: new Map(), subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; } };
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
    const rows = Array.isArray(r?.rows) ? r.rows : [];
    const pending = new Map(h.state.pending);
    for (const [id, p] of h.state.pending) { const row = rows.find((x) => x.id === id); if (row && caughtUp(p, row)) pending.delete(id); }
    set(h, { views: new Map(h.state.views).set(n, { ...r, rows, checks: Array.isArray(r?.checks) ? r.checks : [] }), errors, pending });
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

export function setPending(store: JobStore, id: string, p: Pending | null) {
  const h = heldOf(store);
  const pending = new Map(h.state.pending);
  if (p) pending.set(id, p); else pending.delete(id);
  set(h, { pending });
}

/** His edits of a review round's drafted replies, by comment id: they go with Push the fixes (the round's Send back). */
export function roundDrafts(store: JobStore): Record<string, string> {
  const s = heldOf(store).state;
  const out: Record<string, string> = {};
  for (const v of s.views.values()) for (const r of v.rows) {
    const d = s.drafts.get(r.id);
    if (r.round && d !== undefined && d.trim() && d !== r.reply?.draft) out[r.id] = d;
  }
  return out;
}

export function usePrHeld(store: JobStore): PrHeld {
  const h = heldOf(store);
  return useSyncExternalStore(h.subscribe, () => h.state, () => h.state);
}
