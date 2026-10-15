// Shapes the dashboard sends. Only the fields the new UI reads are typed; the rest pass through.
// Sources: GET /api/snapshot and /api/events?v=2 in dashboard/server.js, lib/events.js,
// lib/snapshot.js, lib/driver.js (view, viewPermission) and lib/limits.js (view).

export type JobGroup = 'needs-you' | 'running' | 'paused' | 'idle' | 'done';
export const JOB_GROUPS: JobGroup[] = ['needs-you', 'running', 'paused', 'idle', 'done'];

export interface Job {
  slug: string;
  title: string;
  kind?: string;
  group: JobGroup;
  stage?: string;
  stageState?: string;
  needsYou?: boolean;
  working?: boolean;
  permissions?: number;
  waitingFor?: string | null;
  waitingSince?: string | null;
  headline?: string | null;
  updatedAt?: string | null;
  limitPaused?: string | null;
  project?: { name: string; path?: string };
  repo?: { name: string; branch?: string | null } | null;
  [key: string]: unknown;
}

export interface Permission {
  id: string;
  slug: string;
  runId?: string;
  featureDir?: string;
  kind?: string;
  toolName?: string;
  createdAt?: string;
  plain?: { headline: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface Run {
  id: string;
  slug: string;
  status: string;
  startedAt?: string;
  endedAt?: string | null;
  lastAction?: string | null;
  [key: string]: unknown;
}

export interface Usage {
  limited: boolean;
  blocking: boolean;
  label: string | null;
  resetsAt: string | null;
  [key: string]: unknown;
}

export interface Meta {
  token: string;
  demo?: boolean;
  [key: string]: unknown;
}

export interface Snapshot {
  v: 2;
  seq: number;
  epoch: string;
  meta: Meta;
  jobs: Job[];
  needsYou: number;
  permissions: Permission[];
  usage: Usage;
  generatedAt: string;
}

/** One event on /api/events?v=2. */
export interface LiveEvent {
  v: 2;
  type: string;
  job: string | null;
  data: unknown;
  seq: number;
}
