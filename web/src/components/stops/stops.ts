// The seven stops every job passes (packet M): Spec, Investigate, Plan, Build, Test, Review, Ship.
// The workflow's own stages (dashboard/lib/stages.js) fold into them: Clarify, Refine and Screens
// shape the spec; Spec update is part of Investigate; the three PRs and Staging QA are Ship. A bug
// job's Triage is Spec, Reproduce is Investigate and Diagnose is Plan (the /bugfix skill's levels.md).
import type { Job, StopId } from '../../api/types';
import type { IconName } from '../Icon';

export const STOPS: readonly { id: StopId; label: string; icon: IconName }[] = [
  { id: 'spec', label: 'Spec', icon: 'file' },
  { id: 'investigate', label: 'Investigate', icon: 'search' },
  { id: 'plan', label: 'Plan', icon: 'clipboard' },
  { id: 'build', label: 'Build', icon: 'hammer' },
  { id: 'test', label: 'Test', icon: 'flask' },
  { id: 'review', label: 'Review', icon: 'eye' },
  { id: 'ship', label: 'Ship', icon: 'rocket' },
];

const STAGE_STOP: Record<string, StopId> = {
  clarify: 'spec', spec: 'spec', refine: 'spec', wireframe: 'spec', triage: 'spec',
  investigate: 'investigate', 'spec-update': 'investigate', reproduce: 'investigate',
  plan: 'plan', diagnose: 'plan', implement: 'build', test: 'test', review: 'review',
  pr1: 'ship', pr2: 'ship', 'staging-qa': 'ship', pr3: 'ship',
};
const STOP_STAGES: Record<StopId, string[]> = { spec: [], investigate: [], plan: [], build: [], test: [], review: [], ship: [] };
for (const [stage, stop] of Object.entries(STAGE_STOP)) STOP_STAGES[stop].push(stage);
// A feature job runs clarify … plan; a bug job runs triage, reproduce, diagnose (dashboard/lib/stages.js FEATURE_STAGES, BUG_STAGES).
const FEATURE_STAGES = ['clarify', 'spec', 'refine', 'wireframe', 'investigate', 'spec-update', 'plan'];
const BUG_STAGES = ['triage', 'reproduce', 'diagnose'];

export const isStopId = (v: unknown): v is StopId => typeof v === 'string' && STOPS.some((s) => s.id === v);

/** The stop a workflow stage belongs to; null for one this page doesn't know. */
export function stopOf(stage: string | null | undefined): StopId | null {
  return stage ? STAGE_STOP[stage] ?? null : null;
}

/** The workflow stages a stop is made of, for this kind of job ('bug', else a feature). */
export const stagesOf = (stop: StopId, kind: string | null | undefined = null): readonly string[] => {
  const out = kind === 'bug' ? FEATURE_STAGES : BUG_STAGES;
  return STOP_STAGES[stop].filter((s) => !out.includes(s));
};

export type StopState = 'done' | 'now' | 'waiting' | 'next' | 'skipped';

export const STOP_STATE_WORDS: Record<StopState, string> = {
  done: 'Done', now: 'Working now', waiting: 'Waiting for you', next: 'Not yet', skipped: 'Skipped',
};

/** Each stop's state for a job: done before where it is, working or waiting there, not yet after; skipped where every stage is skipped. */
export function stopStates(job: Pick<Job, 'stage' | 'stageState' | 'lane' | 'needsYou' | 'skipped' | 'closed'> & { kind?: string | null }): Record<StopId, StopState> {
  const at = stopOf(job.stage);
  const idx = at ? STOPS.findIndex((s) => s.id === at) : -1;
  const finished = job.lane === 'done' || Boolean(job.closed);
  const skipped = new Set(job.skipped ?? []);
  const out = {} as Record<StopId, StopState>;
  STOPS.forEach((s, i) => {
    const allSkipped = stagesOf(s.id, job.kind ?? null).every((st) => skipped.has(st));
    let state: StopState;
    if (finished) state = i <= idx || idx < 0 ? 'done' : 'next';
    else if (i < idx) state = 'done';
    else if (i === idx) state = job.lane === 'needs-you' || job.needsYou ? 'waiting' : job.stageState === 'done' ? 'done' : 'now';
    else state = 'next';
    if (allSkipped && state !== 'now' && state !== 'waiting') state = 'skipped';
    out[s.id] = state;
  });
  return out;
}

/** "Plan: waiting for you", for a title or a screen reader. */
export function stopSentence(job: Parameters<typeof stopStates>[0]): string {
  const states = stopStates(job);
  const at = STOPS.find((s) => states[s.id] === 'waiting' || states[s.id] === 'now');
  if (at) return `${at.label}: ${STOP_STATE_WORDS[states[at.id]].toLowerCase()}`;
  return STOPS.every((s) => states[s.id] === 'done' || states[s.id] === 'skipped') ? 'Every stop done' : 'Not started';
}
