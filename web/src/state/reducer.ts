// The new UI's one store, as a pure reducer: hydrated from GET /api/snapshot, then patched by the
// live events from /api/events?v=2. Side effects (fetching, the stream, reconnecting) live in
// live.ts; this file only decides what each snapshot or event does to the state.
//
// The job groups (Needs you, Running...) are worked out by the dashboard, so an event that may move
// a job between groups sets `jobsStale`, and live.ts fetches a fresh snapshot a moment later. Things
// the event says outright (a permission card arriving or going, a run's status, the usage limit)
// are applied straight away so the page reacts without waiting for that.

import type { Job, JobGroup, LiveEvent, Meta, Permission, Run, Snapshot, Usage } from '../api/types';
import { JOB_GROUPS } from '../api/types';

export type Connection = 'connecting' | 'live' | 'reconnecting';

export interface WorkshopState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  connection: Connection;
  meta: Meta | null;
  jobs: Job[];
  permissions: Permission[];
  usage: Usage | null;
  /** The latest run reported for each job, by slug (from 'run' events). */
  runs: Record<string, Run>;
  /** The newest event applied, and the dashboard run (epoch) it came from. */
  seq: number;
  epoch: string | null;
  /** Bumped when a job's conversation changes, so its thread view refetches (and only that one). */
  threadVersions: Record<string, number>;
  /** An event may have moved jobs between groups: fetch a fresh snapshot. */
  jobsStale: boolean;
  /** The stream couldn't catch up (dashboard restarted, or too far behind): fetch a fresh snapshot. */
  resyncNeeded: boolean;
  generatedAt: string | null;
}

export type Action =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'event'; event: LiveEvent }
  | { type: 'connection'; connection: Connection }
  | { type: 'error'; error: string };

export const initialState: WorkshopState = {
  status: 'loading',
  error: null,
  connection: 'connecting',
  meta: null,
  jobs: [],
  permissions: [],
  usage: null,
  runs: {},
  seq: 0,
  epoch: null,
  threadVersions: {},
  jobsStale: false,
  resyncNeeded: false,
  generatedAt: null,
};

// Event types that can change which group a job is in, or what its row shows.
const MOVES_JOBS = new Set(['run', 'permission', 'permission-gone', 'thread', 'change', 'usage']);

const asObject = (d: unknown): Record<string, unknown> => (d && typeof d === 'object' ? (d as Record<string, unknown>) : {});

function applySnapshot(state: WorkshopState, s: Snapshot): WorkshopState {
  const sameRun = state.epoch !== null && state.epoch === s.epoch;
  return {
    ...state,
    status: 'ready',
    error: null,
    meta: s.meta ?? state.meta,
    jobs: Array.isArray(s.jobs) ? s.jobs : [],
    permissions: Array.isArray(s.permissions) ? s.permissions : [],
    usage: s.usage ?? null,
    // Events newer than the snapshot may already have been applied; never step back within one run.
    seq: sameRun ? Math.max(state.seq, s.seq) : s.seq,
    epoch: s.epoch,
    runs: sameRun ? state.runs : {},
    jobsStale: false,
    resyncNeeded: false,
    generatedAt: s.generatedAt ?? null,
  };
}

function patchJob(jobs: Job[], slug: string | null, fn: (j: Job) => Job): Job[] {
  if (!slug || !jobs.some((j) => j.slug === slug)) return jobs;
  return jobs.map((j) => (j.slug === slug ? fn(j) : j));
}

function applyEvent(state: WorkshopState, e: LiveEvent): WorkshopState {
  if (!e || e.v !== 2 || typeof e.type !== 'string') return state;
  if (e.type === 'resync') {
    // Carry on from the dashboard's current point; the snapshot fetched next fills in the rest.
    const d = asObject(e.data);
    return { ...state, resyncNeeded: true, seq: Number.isInteger(e.seq) ? e.seq : state.seq, epoch: typeof d.epoch === 'string' ? d.epoch : state.epoch };
  }
  if (!Number.isInteger(e.seq) || e.seq <= state.seq) return state; // already applied (a replay overlap)
  const next: WorkshopState = { ...state, seq: e.seq, jobsStale: state.jobsStale || MOVES_JOBS.has(e.type) };
  const d = asObject(e.data);
  switch (e.type) {
    case 'permission': {
      const p = d as unknown as Permission;
      if (typeof p.id !== 'string') return next;
      const slug = e.job ?? p.slug ?? null;
      const known = state.permissions.some((x) => x.id === p.id);
      next.permissions = known ? state.permissions.map((x) => (x.id === p.id ? p : x)) : [...state.permissions, p];
      if (!known) {
        next.jobs = patchJob(state.jobs, slug, (j) => ({
          ...j,
          permissions: (j.permissions ?? 0) + 1,
          needsYou: true,
          group: j.group === 'done' ? j.group : ('needs-you' as JobGroup),
        }));
      }
      return next;
    }
    case 'permission-gone': {
      const id = d.id;
      if (!state.permissions.some((x) => x.id === id)) return next;
      next.permissions = state.permissions.filter((x) => x.id !== id);
      const slug = e.job ?? (typeof d.slug === 'string' ? d.slug : null);
      next.jobs = patchJob(state.jobs, slug, (j) => ({ ...j, permissions: Math.max(0, (j.permissions ?? 1) - 1) }));
      return next;
    }
    case 'run': {
      const run = d as unknown as Run;
      const slug = e.job ?? run.slug;
      if (slug) next.runs = { ...state.runs, [slug]: run };
      return next;
    }
    case 'usage':
      next.usage = d as unknown as Usage;
      return next;
    case 'thread':
      if (e.job) next.threadVersions = { ...state.threadVersions, [e.job]: (state.threadVersions[e.job] ?? 0) + 1 };
      return next;
    default:
      // 'change', 'local', 'local-state' and types this page doesn't know yet: only the seq moves.
      return next;
  }
}

export function reducer(state: WorkshopState, action: Action): WorkshopState {
  switch (action.type) {
    case 'snapshot':
      return applySnapshot(state, action.snapshot);
    case 'event':
      return applyEvent(state, action.event);
    case 'connection':
      return state.connection === action.connection ? state : { ...state, connection: action.connection };
    case 'error':
      // Keep showing what we have if we have it; only an empty page shows the error in place.
      return { ...state, error: action.error, status: state.status === 'ready' ? 'ready' : 'error' };
    default:
      return state;
  }
}

// ---------- Selectors ----------

export function jobsByGroup(state: WorkshopState): Record<JobGroup, Job[]> {
  const out = Object.fromEntries(JOB_GROUPS.map((g) => [g, [] as Job[]])) as Record<JobGroup, Job[]>;
  for (const j of state.jobs) (out[j.group] ?? out.idle).push(j);
  return out;
}

export function needsYouCount(state: WorkshopState): number {
  return state.jobs.filter((j) => j.group === 'needs-you').length;
}

export function jobBySlug(state: WorkshopState, slug: string | null | undefined): Job | null {
  return slug ? state.jobs.find((j) => j.slug === slug) ?? null : null;
}
