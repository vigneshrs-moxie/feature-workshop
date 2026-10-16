// The new UI's one store, as a pure reducer: hydrated from GET /api/snapshot, then patched by the
// live events from /api/events?v=2. Side effects (fetching, the stream, reconnecting) live in
// live.ts; this file only decides what each snapshot or event does to the state.
//
// The job groups (Needs you, Running...) are worked out by the dashboard, so an event that may move
// a job between groups sets `jobsStale`, and live.ts fetches a fresh snapshot a moment later. Things
// the event says outright (a permission card arriving or going, a run's status, the usage limit)
// are applied straight away so the page reacts without waiting for that.

import type { Job, JobGroup, LiveEvent, Meta, Permission, Run, Settings, Snapshot, Steer, SteerState, Usage } from '../api/types';
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
  /** Messages you steered into a reply in progress, by steer id, with their delivery state. */
  steers: Record<string, Steer>;
  /** The newest event applied, and the dashboard run (epoch) it came from. */
  seq: number;
  epoch: string | null;
  /** Bumped when a job's conversation changes, so its thread view refetches (and only that one). */
  threadVersions: Record<string, number>;
  /** Bumped when a snapshot follows a resync or a dashboard restart: thread events may have been
   *  lost in the gap, so every open thread refetches (useJobThread adds it to its version). */
  threadEpoch: number;
  /** An event may have moved jobs between groups: fetch a fresh snapshot. */
  jobsStale: boolean;
  /** The stream couldn't catch up (dashboard restarted, or too far behind): fetch a fresh snapshot. */
  resyncNeeded: boolean;
  /** Bumped when your "Always allow" rules change (here or in another tab): Settings refetches them. */
  rulesVersion: number;
  /** Bumped by the dashboard's 'play' event (something new in the play ledger): the Crew-dex refetches. */
  playVersion: number;
  generatedAt: string | null;
}

export type Action =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'event'; event: LiveEvent }
  /** You answered a card here: drop it now, without waiting for the dashboard's permission-gone. */
  | { type: 'permission-answered'; id: string }
  /** You changed a setting here: show it now, without waiting for the dashboard's 'settings' event. */
  | { type: 'settings'; settings: Settings }
  /** You steered a message here: show it at once (the dashboard's 'steer' events follow). */
  | { type: 'steer'; steer: Steer }
  /** You changed the usage limit here (Carry on now, the automatic toggle): show it at once. */
  | { type: 'usage'; usage: Usage }
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
  steers: {},
  seq: 0,
  epoch: null,
  threadVersions: {},
  threadEpoch: 0,
  jobsStale: false,
  resyncNeeded: false,
  rulesVersion: 0,
  playVersion: 0,
  generatedAt: null,
};

// Event types that can change which group a job is in, or what its row shows. 'run' is not here:
// the driver sends one on many SDK messages while a job replies, so a run only marks jobs stale
// when it starts, ends or changes status (see the 'run' case below).
const MOVES_JOBS = new Set(['permission', 'permission-gone', 'thread', 'change', 'usage', 'gate-stale']);

const asObject = (d: unknown): Record<string, unknown> => (d && typeof d === 'object' ? (d as Record<string, unknown>) : {});

function applySnapshot(state: WorkshopState, s: Snapshot): WorkshopState {
  const sameRun = state.epoch !== null && state.epoch === s.epoch;
  // After a resync (or a dashboard restart) thread events may have been lost: refetch open threads.
  const gap = state.resyncNeeded || (state.epoch !== null && state.epoch !== s.epoch);
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
    steers: sameRun ? state.steers : {},
    threadEpoch: gap ? state.threadEpoch + 1 : state.threadEpoch,
    jobsStale: false,
    resyncNeeded: false,
    generatedAt: s.generatedAt ?? null,
  };
}

function patchJob(jobs: Job[], slug: string | null, fn: (j: Job) => Job): Job[] {
  if (!slug || !jobs.some((j) => j.slug === slug)) return jobs;
  return jobs.map((j) => (j.slug === slug ? fn(j) : j));
}

// A card is gone (answered here or elsewhere, cancelled, or the reply ended): drop it once.
function dropPermission(state: WorkshopState, id: string, slug: string | null): WorkshopState {
  const card = state.permissions.find((x) => x.id === id);
  if (!card) return state;
  return {
    ...state,
    permissions: state.permissions.filter((x) => x.id !== id),
    jobs: patchJob(state.jobs, slug ?? card.slug ?? null, (j) => ({ ...j, permissions: Math.max(0, (j.permissions ?? 1) - 1) })),
  };
}

// Steer states only move forward; a late copy (the POST's answer after the events) never undoes one.
const STEER_RANK: Record<SteerState, number> = { queued: 0, delivered: 1, 'acted-on': 2, cancelled: 2, unanswered: 2 };

function withSteers(steers: Record<string, Steer>, list: Steer[]): Record<string, Steer> {
  let out = steers;
  for (const s of list) {
    if (!s || typeof s.id !== 'string' || !(s.state in STEER_RANK)) continue;
    const had = out[s.id];
    if (had && STEER_RANK[had.state] >= STEER_RANK[s.state]) continue;
    if (out === steers) out = { ...steers };
    out[s.id] = s;
  }
  return out;
}

function withSettings(state: WorkshopState, settings: Settings): WorkshopState {
  if (!state.meta) return state; // the snapshot that follows carries them
  return { ...state, meta: { ...state.meta, settings } };
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
    case 'permission-gone':
      return dropPermission(next, typeof d.id === 'string' ? d.id : '', e.job ?? (typeof d.slug === 'string' ? d.slug : null));
    case 'rules':
      next.rulesVersion = state.rulesVersion + 1;
      return next;
    case 'play':
      next.playVersion = state.playVersion + 1;
      return next;
    case 'settings':
      // Your permission settings (global, per job, auto mode's availability), sent whole.
      return typeof d.policy === 'string' ? withSettings(next, d as unknown as Settings) : next;
    case 'run': {
      const run = d as unknown as Run;
      const slug = e.job ?? run.slug;
      if (!slug) return next;
      const prev = state.runs[slug];
      if (!prev || prev.id !== run.id || prev.status !== run.status) next.jobsStale = true;
      next.runs = { ...state.runs, [slug]: run };
      if (Array.isArray(run.steers)) next.steers = withSteers(state.steers, run.steers);
      return next;
    }
    case 'steer': {
      next.steers = withSteers(state.steers, [d as unknown as Steer]);
      return next;
    }
    case 'usage':
      next.usage = d as unknown as Usage;
      return next;
    case 'thread':
      if (e.job) next.threadVersions = { ...state.threadVersions, [e.job]: (state.threadVersions[e.job] ?? 0) + 1 };
      return next;
    case 'gate-stale':
      // A gate left waiting past the parking time (4 hours): the row says parked at once (it stays
      // under Needs you), and the job's page refetches so its gate card says so too.
      if (e.job) {
        next.threadVersions = { ...state.threadVersions, [e.job]: (state.threadVersions[e.job] ?? 0) + 1 };
        next.jobs = patchJob(state.jobs, e.job, (j) => ({ ...j, parked: true }));
      }
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
    case 'permission-answered': {
      // The job may now leave Needs you: the next snapshot (soon, as the dashboard also sends events) says so.
      const next = dropPermission(state, action.id, null);
      return next === state ? state : { ...next, jobsStale: true };
    }
    case 'settings':
      return withSettings(state, action.settings);
    case 'steer': {
      const steers = withSteers(state.steers, [action.steer]);
      return steers === state.steers ? state : { ...state, steers };
    }
    case 'usage':
      // Paused jobs may start again: the next snapshot regroups them.
      return action.usage && typeof action.usage === 'object' ? { ...state, usage: action.usage, jobsStale: true } : state;
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
