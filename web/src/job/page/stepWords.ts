// The words for a step on the job page (design 3.2): its state (Done, Working now, Waiting for you,
// Not yet, Skipped; Approved after your Go; In review with a pull request open) and its time (how
// long it took, "so far" on the current one, "for" how long it has waited for you). A time that
// can't be read, or would come out negative, says nothing rather than something wrong.
import type { Job, StepTime, StopId } from '../../api/types';
import type { GateKind } from '../../lib/compose';
import { laneOf } from '../../home/JobsPage';
import { stopOf, stopStates, type StopState } from '../../components/stops/stops';

export type StepCls = 'is-done' | 'is-now' | 'is-wait' | 'is-stop' | '';

/** "under a minute", "32 min", "1 h 10 min", "2 d 3 h". */
export function spentWords(ms: number): string {
  const min = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 60_000) : 0;
  if (min < 1) return 'under a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  return h % 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${Math.floor(h / 24)} d`;
}

/** Each step's state, with the job's lane filled in for a Starbase from before lanes. */
export const statesOf = (job: Job): Record<StopId, StopState> => stopStates({ ...job, lane: laneOf(job) });

/**
 * The pull request open on the job, by its number (PR #2 before PR #1, as the lane names it), or
 * null: none open, or the job waits for you about it (changes asked for).
 */
export function openPr(job: Job): number | null {
  const lane = laneOf(job);
  if (lane !== 'in-review' && lane !== 'ready') return null;
  const n = /PR #(\d+)/.exec(typeof job.laneReason === 'string' ? job.laneReason : '')?.[1];
  return n ? Number(n) : null;
}

const STATE: Record<StopState, { cls: StepCls; words: string }> = {
  done: { cls: 'is-done', words: 'Done' },
  now: { cls: 'is-now', words: 'Working now' },
  waiting: { cls: 'is-wait', words: 'Waiting for you' },
  next: { cls: '', words: 'Not yet' },
  skipped: { cls: 'is-stop', words: 'Skipped' },
};

/**
 * A step's state in words. The job's own step reads Approved once you said Go (`sent`, the bar's
 * sent line: it clears when the job moves); after Reply or Send back it keeps its own words. Ship
 * reads In review while a pull request is open.
 */
export function stepState(job: Job, stop: StopId, sent: { kind: GateKind | null } | null): { cls: StepCls; words: string } {
  const state = statesOf(job)[stop];
  if (sent?.kind === 'approve' && stopOf(job.stage) === stop) return { cls: 'is-done', words: 'Approved' };
  if (stop === 'ship' && state !== 'waiting' && state !== 'next' && openPr(job) !== null) return { cls: 'is-now', words: 'In review' };
  return STATE[state];
}

const at = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

/**
 * How long a step took, or has run, in words; null when there is nothing true to say (not reached,
 * skipped, no usable time). `time` is the step's span by its briefs; `since` (StageView.since) is
 * its start when the span has none. Waiting for you: for how long, from the job's waitingSince.
 * Ship with a pull request open: "PR #1 open".
 */
export function stepTimeWords(job: Job, stop: StopId, time: StepTime | null | undefined, now: Date, since?: string | null): string | null {
  const state = statesOf(job)[stop];
  if (state === 'next' || state === 'skipped') return null;
  const pr = stop === 'ship' && state !== 'waiting' ? openPr(job) : null;
  if (pr !== null) return `PR #${pr} open`;
  const nowMs = now.getTime();
  if (state === 'waiting') {
    const waited = nowMs - at(job.waitingSince);
    if (Number.isFinite(waited) && waited >= 0) return `for ${spentWords(waited)}`;
  }
  const start = at(time?.startedAt ?? since);
  const end = at(time?.endedAt);
  if (Number.isFinite(end)) return Number.isFinite(start) && end >= start ? spentWords(end - start) : null;
  if ((state === 'now' || state === 'waiting') && Number.isFinite(start) && nowMs >= start) return `${spentWords(nowMs - start)} so far`;
  return null;
}
