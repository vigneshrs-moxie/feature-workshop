// Who to draw where in the conversation (Play layer step 3), from what the page already has: the
// thread's routine-step lines ("Start a helper: feature-investigator", the worker that took a step),
// the job's card (nowDoing, its group), its reply in progress and the job's activity (the session
// logs' workers). Pure: no React, no fetching. Nothing here reads how you answered anything.
import type { Job, Run, Usage } from '../api/types';
import { crewInfo, type CrewState } from './crew';

/** The review lenses (dashboard/lib/options.js REVIEWERS), in the dashboard's order. */
export const LENS_TYPES: readonly string[] = [
  'feature-reviewer', 'feature-review-permissions', 'feature-review-tests', 'feature-review-conventions',
  'feature-review-errors', 'feature-review-db', 'feature-review-performance', 'feature-review-ui',
];

/** The worker a routine step started ("Start a helper: feature-tester", dashboard/lib/permissions.js), or null. */
export function dispatchType(headline: string | null | undefined): string | null {
  const m = /^Start a helper:\s*([\w-]+)/.exec(String(headline ?? ''));
  return m ? m[1] : null;
}

// What each worker starts doing when it is handed the work.
const STARTED: Record<string, string> = {
  conductor: 'took over',
  'feature-spec-writer': 'started writing the spec',
  'feature-investigator': 'started investigating',
  'feature-planner': 'started planning',
  'feature-implementer': 'started building',
  'feature-tester': 'started testing',
  'feature-reviewer': 'started the review',
  'feature-fable-check': 'started a second look',
};

/** "Sleuth started investigating"; a lens "started reviewing"; an unknown helper "started working". */
export function handoffLine(type: string): string {
  const verb = STARTED[type] ?? (LENS_TYPES.includes(type) ? 'started reviewing' : 'started working');
  return `${crewInfo(type).name} ${verb}`;
}

/** Names as a short list: "Fuse", "Fuse and Mason", "Fuse, Mason and 2 more". */
export function nameList(types: readonly string[], max = 3): string {
  const names = types.map((t) => crewInfo(t).name);
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${names.slice(0, max - 1).join(', ')} and ${names.length - (max - 1)} more`;
}

interface NowDoing { who?: string; name?: string; doing?: string | null; since?: string | null }

const ACTIVE = new Set(['starting', 'running', 'waiting_permission', 'stopping']);

/** The job is paused by Claude's usage limit (its group, its card, or the limit's list of jobs). */
export function usagePaused(job: Job | null | undefined, usage?: Usage | null): boolean {
  if (!job) return false;
  return job.group === 'paused' || Boolean(job.limitPaused) || Boolean(usage?.limited && usage.jobs?.some((j) => j.slug === job.slug));
}

/** The workers on the job right now (from its card's nowDoing; the Foreman left out). */
export function workersNow(job: Job | null | undefined): string[] {
  const list = Array.isArray(job?.nowDoing) ? (job.nowDoing as NowDoing[]) : [];
  return [...new Set(list.map((d) => d.who).filter((w): w is string => typeof w === 'string' && w !== 'conductor'))];
}

export interface LiveCrew {
  /** Who to draw: the workers at work, else the Foreman. */
  types: string[];
  state: CrewState;
  /** Visible words naming them ("Tester at work"), or null when it is the Foreman (the row names it). */
  text: string | null;
}

/**
 * Who the live row shows while a reply runs: the workers at work (working), else the Foreman
 * (thinking); the Foreman waiting when the job needs you (a permission or question waits); everyone
 * asleep during a usage-limit pause. Null when no reply is running and nothing is paused.
 */
export function liveCrew(job: Job | null | undefined, run: Run | null | undefined, usage?: Usage | null): LiveCrew | null {
  const active = Boolean(run && ACTIVE.has(run.status));
  if (usagePaused(job, usage)) {
    const types = workersNow(job);
    return { types: types.length ? types : ['conductor'], state: 'asleep', text: types.length ? `${nameList(types)} asleep until the limit resets` : null };
  }
  if (!active) return null;
  if (run?.status === 'waiting_permission' || (job?.permissions ?? 0) > 0) return { types: ['conductor'], state: 'waiting', text: null };
  const types = workersNow(job);
  if (types.length) return { types, state: 'working', text: `${nameList(types)} at work` };
  return { types: ['conductor'], state: 'thinking', text: null };
}

/** The Foreman's mood in the job header, from the job's state. */
export function foremanMood(job: Job | null | undefined, usage?: Usage | null): CrewState {
  if (!job) return 'idle';
  if (usagePaused(job, usage)) return 'asleep';
  if (job.group === 'needs-you') return 'waiting';
  if (job.group === 'running') return 'thinking';
  if (job.group === 'done') return job.closed?.as === 'dropped' ? 'idle' : 'celebrating';
  return 'idle';
}

interface Activity { who?: string; startedAt?: string | null }

/**
 * The review lenses that ran for a review brief: the job's workers (activity) that are lenses and
 * started before the brief was written and after the review brief before it, once each, in the
 * dashboard's order.
 */
export function reviewLineup(activity: unknown, briefAt: string | null | undefined, previousAt?: string | null): string[] {
  const list = Array.isArray(activity) ? (activity as Activity[]) : [];
  const end = briefAt ? Date.parse(briefAt) : Number.POSITIVE_INFINITY;
  const start = previousAt ? Date.parse(previousAt) : Number.NEGATIVE_INFINITY;
  const ran = new Set<string>();
  for (const a of list) {
    if (!a?.who || !LENS_TYPES.includes(a.who)) continue;
    const t = a.startedAt ? Date.parse(a.startedAt) : NaN;
    if (Number.isFinite(t) && (t > end || t <= start)) continue;
    ran.add(a.who);
  }
  return LENS_TYPES.filter((t) => ran.has(t));
}
