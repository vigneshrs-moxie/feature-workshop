// The workshop floor (Play, round 2): what the Foreman says when no job is open, and the order of
// the jobs on the floor. The classic page's "10 jobs need you. Longest wait first:" brought back.
// Pure: no React, no fetching, nothing from a model.
import type { Job, Usage } from '../api/types';
import { relativeTime } from '../lib/time';
import { jobStatus } from '../panes/Jobs/jobStatus';
import { stageLabel } from '../panes/Jobs/stages';
import type { CrewState } from './crew';
import { usagePaused } from './crewLines';

/** How many asks the Foreman names; the rest are counted. */
export const FLOOR_ASKS = 4;

const GROUP_ORDER: Record<string, number> = { 'needs-you': 0, running: 1, paused: 2, idle: 3, shipping: 4, done: 5 };
const time = (iso: unknown) => (typeof iso === 'string' && Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : Number.POSITIVE_INFINITY);
/** When a job started waiting for you (its gate's time, else its last change). */
const waitingFrom = (job: Job) => (job.waitingSince ? time(job.waitingSince) : time(job.updatedAt));

/** How long a job has waited, for after "waiting": "47m", "5h", "since yesterday", "since Oct 12"; '' when unknown or just now. */
export function waited(job: Job, now: Date): string {
  const ago = relativeTime(job.waitingSince ?? job.updatedAt ?? null, now);
  if (!ago || ago === 'just now') return '';
  return /^\d+[mhd]$/.test(ago) ? ago : `since ${ago}`;
}

/** The closed jobs, said in words for the floor: "1 finished job is", "2 finished and 1 dropped job are". */
export function closedText(jobs: readonly Job[]): string {
  const closed = jobs.filter((j) => j.group === 'done');
  const dropped = closed.filter((j) => (j.closed as { as?: string } | null | undefined)?.as === 'dropped').length;
  const finished = closed.length - dropped;
  if (!closed.length) return '';
  const parts = [finished && `${finished} finished`, dropped && `${dropped} dropped`].filter(Boolean).join(' and ');
  return `${parts} job${closed.length === 1 ? ' is' : 's are'}`;
}

/** What a job needs from you, in a few words: "give the go-ahead on Plan". */
export function askOf(job: Job, now: Date = new Date()): string {
  const label = jobStatus(job, now).label;
  const stage = job.stage ? stageLabel(job.stage) : '';
  if (label === 'Go-ahead') return stage ? `give the go-ahead on ${stage}` : 'give the go-ahead';
  if (label === 'Question') return 'answer a question';
  if (label === 'Your turn') return 'reply to the Foreman';
  return label === 'Permission' ? 'allow or deny a step' : `allow or deny ${label}`;
}

export interface FloorAsk { slug: string; title: string; what: string; waited: string }

export interface FloorSpeech {
  mood: CrewState;
  /** What the Foreman says, one sentence. */
  say: string;
  /** The jobs that need you, longest wait first, at most FLOOR_ASKS. */
  asks: FloorAsk[];
  /** How many more need you beyond those. */
  more: number;
}

/** The open jobs on the floor (done ones left out): needs you (longest wait first), running, paused, idle. */
export function floorJobs(jobs: readonly Job[]): Job[] {
  return jobs
    .filter((j) => j.group !== 'done')
    .map((j, i) => ({ j, i }))
    .sort((a, b) => (GROUP_ORDER[a.j.group] ?? 9) - (GROUP_ORDER[b.j.group] ?? 9)
      || (a.j.group === 'needs-you' ? waitingFrom(a.j) - waitingFrom(b.j) : 0)
      || a.i - b.i)
    .map(({ j }) => j);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the Foreman says on the floor, and its mood. */
export function floorSpeech(jobs: readonly Job[], usage?: Usage | null, now: Date = new Date()): FloorSpeech {
  const open = floorJobs(jobs);
  const needs = open.filter((j) => j.group === 'needs-you');
  if (needs.length) {
    const asks = needs.slice(0, FLOOR_ASKS).map((j) => ({ slug: j.slug, title: j.title || j.slug, what: askOf(j, now), waited: waited(j, now) }));
    const say = needs.length === 1 ? '1 job needs you:' : `${needs.length} jobs need you. Longest wait first:`;
    return { mood: 'waiting', say, asks, more: needs.length - asks.length };
  }
  const running = open.filter((j) => j.group === 'running');
  if (running.length) return { mood: 'thinking', say: `Nothing needs you. The crew are at work on ${plural(running.length, 'job', 'jobs')}.`, asks: [], more: 0 };
  const paused = open.filter((j) => usagePaused(j, usage));
  if (paused.length) return { mood: 'asleep', say: `Nothing needs you. The crew are asleep until Claude’s usage limit resets (${plural(paused.length, 'job', 'jobs')}).`, asks: [], more: 0 };
  if (open.length) return { mood: 'idle', say: `Nothing needs you and nothing is running. Open a job to carry on, or start a new one.`, asks: [], more: 0 };
  return { mood: 'idle', say: 'The workshop is quiet. Start a new job when you’re ready.', asks: [], more: 0 };
}
