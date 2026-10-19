// The job's trail (Play, round 2), worked out from what the page already has: the stages it runs as
// a path (the quest track's, extrasModel.ts), who stands on the current stop and in what mood, and
// a "Now / Next" line in plain words saying what is happening and whose move it is. Pure: no React,
// no fetching, nothing from a model, and nothing here reads how you answered anything.
import type { Job, LevelInfo, Usage } from '../api/types';
import { isLevel } from '../lib/levels';
import { jobStatus } from '../panes/Jobs/jobStatus';
import { stageLabel } from '../panes/Jobs/stages';
import { crewInfo, STAGE_CHARACTER, type CrewState } from './crew';
import { usagePaused, workersNow } from './crewLines';
import { questTrack, type QuestStop } from './extrasModel';

/** What the crew member on each stage is doing there: "Builder is building". */
const DOING: Record<string, string> = {
  spec: 'writing the spec',
  refine: 'refining the spec',
  investigate: 'investigating the code',
  'spec-update': 'updating the spec',
  plan: 'drawing up the plan',
  implement: 'building',
  test: 'running the checks',
  review: 'reviewing the change',
  pr1: 'opening PR #1',
  pr2: 'opening PR #2',
  'staging-qa': 'checking staging',
  pr3: 'opening PR #3',
};

/** What happens at a stage, said of whoever stands there: "Tester runs the checks". */
const DOES: Record<string, string> = {
  spec: 'writes the spec',
  refine: 'refines the spec',
  investigate: 'investigates the code',
  'spec-update': 'updates the spec',
  plan: 'draws up the plan',
  implement: 'builds it',
  test: 'runs the checks',
  review: 'and the reviewers look at the change',
  pr1: 'opens PR #1, the quest’s goal',
  pr2: 'opens PR #2',
  'staging-qa': 'checks staging',
  pr3: 'opens PR #3',
};

/** "the Foreman" in a sentence; everyone else by name. */
const named = (type: string) => (type === 'conductor' ? 'the Foreman' : crewInfo(type).name);
const Named = (type: string) => (type === 'conductor' ? 'The Foreman' : crewInfo(type).name);

/** "Tester runs the checks" for a stage id; the stage's own name for one we don't know. */
export function stagePhrase(stage: string): string {
  const who = STAGE_CHARACTER[stage];
  const does = DOES[stage];
  return who && does ? `${Named(who)} ${does}` : stageLabel(stage);
}

export interface Trail {
  stops: QuestStop[];
  /** Who stands on the current stop (or at the goal once done). */
  who: string;
  mood: CrewState;
  /** The job needs you: a "!" over their head, and the line is your move. */
  ask: boolean;
  /** The quest is done (by the Settings → Play rule). */
  finished: boolean;
  /** Difficulty stars and words, when the job has a level. */
  stars: string | null;
  difficulty: string | null;
  /** The lead word of the line ("Your move", "Now", "Paused", "Idle", "Done") and the rest of it. */
  lead: string;
  now: string;
  /** What comes after, or null at the end. */
  next: string | null;
}

export interface TrailInputs {
  levels?: LevelInfo[] | null;
  /** Whether the play ledger counts the quest done (as for the quest track); unknown without it. */
  done?: boolean;
  usage?: Usage | null;
  now?: Date;
}

/** The job's trail. A job with no level yet walks the Standard (L2) stages, without difficulty stars. */
export function jobTrail(job: Job, { levels, done, usage, now = new Date() }: TrailInputs = {}): Trail | null {
  const leveled = isLevel(job.level);
  const track = questTrack(leveled ? job : { ...job, level: 2 }, levels, done);
  if (!track) return null;
  const stage = typeof job.stage === 'string' ? job.stage : null;
  const at = track.stops.findIndex((s) => s.state === 'current');
  const upcoming = at >= 0 ? track.stops[at + 1] ?? null : track.stops.find((s) => s.state === 'next') ?? null;
  const nextPhrase = upcoming ? stagePhrase(upcoming.id) : null;
  const atStage = (stage && STAGE_CHARACTER[stage]) || 'conductor';
  const status = jobStatus(job, now);
  const dropped = job.group === 'done' && (job.closed as { as?: string } | null | undefined)?.as === 'dropped';
  const base = { stops: track.stops, finished: track.finished, stars: leveled ? track.stars : null, difficulty: leveled ? track.difficulty : null };

  if (dropped) {
    return { ...base, who: 'conductor', mood: 'idle', ask: false, lead: 'Dropped', now: 'You dropped this job. Reopen it from the job menu to carry on.', next: null };
  }
  if (track.finished || job.group === 'done') {
    return { ...base, who: 'conductor', mood: 'celebrating', ask: false, lead: 'Done', now: 'The quest is complete. Nice work, crew.', next: null };
  }
  if (usagePaused(job, usage)) {
    const who = workersNow(job)[0] ?? atStage;
    const doing = stage && DOING[stage] ? ` ${DOING[stage]}` : '';
    return { ...base, who, mood: 'asleep', ask: false, lead: 'Paused', now: `Claude’s usage limit stopped the crew (${status.label}).`, next: `Then: ${named(who)} carries on${doing}.` };
  }
  if (job.group === 'needs-you') {
    const then = nextPhrase ? `Then: ${nextPhrase}.` : null;
    const what = status.label === 'Go-ahead'
      ? `the Foreman is waiting for your go-ahead${stage ? ` on ${stageLabel(stage)}` : ''}.`
      : status.label === 'Question'
        ? 'the Foreman asked you something. Answer it below.'
        : status.label === 'Your turn'
          ? 'the Foreman is waiting for your reply.'
          : 'the Foreman wants your permission for a step. Allow or deny it below.';
    return { ...base, who: atStage, mood: 'waiting', ask: true, lead: 'Your move', now: what, next: then };
  }
  if (job.group === 'running') {
    if (job.starting) return { ...base, who: 'conductor', mood: 'thinking', ask: false, lead: 'Now', now: 'The Foreman is reading your request.', next: nextPhrase ? `Next: ${nextPhrase}.` : null };
    const who = workersNow(job)[0] ?? atStage;
    const doing = stage && DOING[stage] ? DOING[stage] : 'working';
    return { ...base, who, mood: 'working', ask: false, lead: 'Now', now: `${Named(who)} is ${doing}.`, next: nextPhrase ? `Next: ${nextPhrase}.` : null };
  }
  const stopped = status.label === 'Stopped';
  return {
    ...base, who: atStage, mood: 'idle', ask: false, lead: stopped ? 'Stopped' : 'Idle',
    now: stopped ? 'You stopped the last reply. Write to the Foreman to carry on.' : 'Nothing is happening right now. Write to the Foreman to carry on.',
    next: nextPhrase ? `Next: ${nextPhrase}.` : null,
  };
}
