// The job's branch for the reader (job page rebuild, Task 14): its commits (GET /api/job/:slug/commits,
// newest first, each with its files) and each commit's diff (GET /api/job/:slug/commit/:sha), read
// through today's routes and kept per open job, so a view that comes back paints from what it holds.
//
// - The commit list is asked for when a view that shows it opens (shown at once from what is held,
//   then read again, since the branch moves while the job builds).
// - A commit's diff never changes: it is asked for once and kept for as long as the page is open.
// - Neither is asked for on the website: commits stay on the laptop (plan decision 8).
// Components read it through useBranch, which redraws only when something here changed.

import { useSyncExternalStore } from 'react';
import type { ApiClient } from '../../api/client';
import type { JobStore } from '../jobStore';

export interface BranchFile { path: string; added: number | null; removed: number | null; isNew?: boolean }
export interface BranchCommit { sha: string; short: string; subject: string; date: string | null; files: BranchFile[] }
export interface CommitDiff { sha: string; patchFiles: { path: string; lines: string[] }[]; files: BranchFile[]; truncated: boolean }

export interface Branch {
  /** The commits, newest first; null until the first answer. */
  commits: BranchCommit[] | null;
  /** The server's sentence when there are none (no branch yet), else null. */
  note: string | null;
  /** Why the list could not be read (the last ask failed and nothing is held), else null. */
  error: string | null;
  diffs: ReadonlyMap<string, CommitDiff>;
  diffErrors: ReadonlyMap<string, string>;
  /** What Changes had picked (commit, file), so coming back shows it again. */
  pick: { sha: string | null; path: string | null };
}

interface Held {
  state: Branch;
  listAsk: Promise<void> | null;
  diffAsks: Map<string, Promise<CommitDiff | null>>;
  listeners: Set<() => void>;
}

const held = new WeakMap<JobStore, Held>();

function heldOf(store: JobStore): Held {
  let h = held.get(store);
  if (!h) {
    h = { state: { commits: null, note: null, error: null, diffs: new Map(), diffErrors: new Map(), pick: { sha: null, path: null } }, listAsk: null, diffAsks: new Map(), listeners: new Set() };
    held.set(store, h);
  }
  return h;
}

function set(h: Held, next: Partial<Branch>) {
  h.state = { ...h.state, ...next };
  for (const l of [...h.listeners]) l();
}

const words = (err: unknown) => (err instanceof Error ? err.message : String(err));
const text = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function filesOf(v: unknown): BranchFile[] {
  return (Array.isArray(v) ? v : []).filter((f) => f && typeof f.path === 'string')
    .map((f) => ({ path: f.path as string, added: num(f.added), removed: num(f.removed), isNew: f.isNew === true }));
}

function commitsOf(v: unknown): BranchCommit[] {
  return (Array.isArray(v) ? v : []).filter((c) => c && typeof c.sha === 'string' && c.sha)
    .map((c) => ({ sha: c.sha as string, short: text(c.short) || String(c.sha).slice(0, 8), subject: text(c.subject), date: text(c.date) || null, files: filesOf(c.files) }));
}

const path = (slug: string) => `/api/job/${encodeURIComponent(slug)}`;

/** The branch as held now (for tests and plain reads). */
export function branchOf(store: JobStore): Branch {
  return heldOf(store).state;
}

/** Read the commit list (again). Asks made while one is out share it. */
export function loadCommits(store: JobStore, api: ApiClient, slug: string): Promise<void> {
  const h = heldOf(store);
  if (h.listAsk) return h.listAsk;
  h.listAsk = (async () => {
    try {
      const r = await api.get<{ commits?: unknown; note?: unknown }>(`${path(slug)}/commits`);
      set(h, { commits: commitsOf(r?.commits), note: text(r?.note) || null, error: null });
    } catch (err) {
      // What is held stays; the error shows only when nothing is.
      set(h, { error: words(err) });
    } finally {
      h.listAsk = null;
    }
  })();
  return h.listAsk;
}

/** One commit's diff: held → at once; else asked for once. null when it could not be read (diffErrors says why). */
export function loadDiff(store: JobStore, api: ApiClient, slug: string, sha: string): Promise<CommitDiff | null> {
  const h = heldOf(store);
  const have = h.state.diffs.get(sha);
  if (have) return Promise.resolve(have);
  const out = h.diffAsks.get(sha);
  if (out) return out;
  const ask = (async () => {
    try {
      const r = await api.get<{ sha?: unknown; patchFiles?: unknown; files?: unknown; truncated?: unknown }>(`${path(slug)}/commit/${encodeURIComponent(sha)}`);
      const patchFiles = (Array.isArray(r?.patchFiles) ? r.patchFiles : []).filter((f) => f && typeof f.path === 'string')
        .map((f) => ({ path: f.path as string, lines: (Array.isArray(f.lines) ? f.lines : []).map((l: unknown) => (typeof l === 'string' ? l : '')) }));
      const diff: CommitDiff = { sha, patchFiles, files: filesOf(r?.files), truncated: r?.truncated === true };
      const errors = new Map(h.state.diffErrors);
      errors.delete(sha);
      set(h, { diffs: new Map(h.state.diffs).set(sha, diff), diffErrors: errors });
      return diff;
    } catch (err) {
      set(h, { diffErrors: new Map(h.state.diffErrors).set(sha, words(err)) });
      return null;
    } finally {
      h.diffAsks.delete(sha);
    }
  })();
  h.diffAsks.set(sha, ask);
  return ask;
}

/** Remember what Changes shows (it is drawn fresh each time it opens). */
export function setPick(store: JobStore, pick: Branch['pick']) {
  const h = heldOf(store);
  if (h.state.pick.sha === pick.sha && h.state.pick.path === pick.path) return;
  set(h, { pick });
}

export function useBranch(store: JobStore): Branch {
  const h = heldOf(store);
  return useSyncExternalStore(
    (l) => { h.listeners.add(l); return () => { h.listeners.delete(l); }; },
    () => h.state,
    () => h.state,
  );
}
