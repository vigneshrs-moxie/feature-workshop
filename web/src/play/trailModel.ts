// The job's trail (Play, round 2), worked out from what the page already has: the stages it runs as
// a path (the quest track's, extrasModel.ts), who stands on the current stop and in what mood, and
// a "Now / Next" line in plain words saying what is happening and whose move it is. Pure: no React,
// no fetching, nothing from a model, and nothing here reads how you answered anything.
import type { FinishLine, Job, LevelInfo, Usage } from '../api/types';
import { isLevel } from '../lib/levels';
import { jobStatus } from '../panes/Jobs/jobStatus';
import { stageLabel } from '../panes/Jobs/stages';
import { crewInfo, STAGE_CHARACTER, type CrewState } from './crew';
import { usagePaused, workersNow } from './crewLines';
import { goalStop, questTrack, SHIPPING_STAGES, type QuestStop } from './extrasModel';

/** What the crew member on each stage is doing there: "Builder is building". */
const DOING: Record<string, string> = {
  clarify: 'asking a few questions',
  spec: 'writing the spec',
  refine: 'refining the spec',
  wireframe: 'drawing the screens',
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
  clarify: 'asks a few questions',
  spec: 'writes the spec',
  refine: 'refines the spec',
  wireframe: 'draws the screens',
  investigate: 'investigates the code',
  'spec-update': 'updates the spec',
  plan: 'draws up the plan',
  implement: 'builds it',
  test: 'runs the checks',
  review: 'and the reviewers look at the change',
  pr1: 'opens PR #1',
  pr2: 'opens PR #2',
  'staging-qa': 'checks staging',
  pr3: 'opens PR #3',
};

/** "the Foreman" in a sentence; everyone else by name. */
const named = (type: string) => (type === 'conductor' ? 'the Foreman' : crewInfo(type).name);
const Named = (type: string) => (type === 'conductor' ? 'The Foreman' : crewInfo(type).name);

/** "Tester runs the checks" for a stage id (", the quest’s goal" on the finish line's stop); the stage's own name for one we don't know. */
export function stagePhrase(stage: string, goal: string | null = goalStop(undefined)): string {
  const who = STAGE_CHARACTER[stage];
  const does = DOES[stage];
  return who && does ? `${Named(who)} ${does}${stage === goal ? ', the quest’s goal' : ''}` : stageLabel(stage);
}

export interface Trail {
  stops: QuestStop[];
  /** Who stands on the current stop (or at the goal once done). */
  who: string;
  mood: CrewState;
  /** The job needs you: a "!" over their head, and the line is your move. */
  ask: boolean;
  /** The quest is done: the finish line crossed. */
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
  /** The finish line (settings.workflow.finishLine): where the goal flag goes. */
  finishLine?: FinishLine | null;
  usage?: Usage | null;
  now?: Date;
  /** Where the line is read: under the job's title (its cards are below) or on a floor card. */
  where?: 'header' | 'card';
}

/** The level a job's path is drawn for: its own, else the Foreman's suggestion, else the rules'. */
function pathLevel(job: Job) {
  if (isLevel(job.level)) return job.level;
  if (isLevel(job.suggestedLevel)) return job.suggestedLevel;
  const rules = job.rulesLevel?.level;
  return isLevel(rules) ? rules : null;
}

/**
 * The job's trail. Its path skips what the job's level and its own options skip (job.skipped). A
 * job with no level, suggested or chosen, shows only the stages it has been through, the one it is
 * on and the PR stops, without difficulty stars and without naming a next stage it may never run.
 */
export function jobTrail(job: Job, { levels, done, finishLine, usage, now = new Date(), where = 'header' }: TrailInputs = {}): Trail | null {
  const level = pathLevel(job);
  const track = questTrack({ ...job, level: level ?? 2 }, levels, done, finishLine);
  if (!track) return null;
  const stage = typeof job.stage === 'string' ? job.stage : null;
  const at = track.stops.findIndex((s) => s.state === 'current');
  // What comes next: the stop after the current one, or after the goal once the quest is done there.
  const upcoming = at >= 0 ? track.stops[at + 1] ?? null : track.stops.find((s) => s.state === 'next') ?? null;
  const nextStage = level === null && !track.finished ? null : upcoming?.id ?? null;
  const nextPhrase = nextStage ? stagePhrase(nextStage, track.goal) : null;
  const atStage = track.who ?? (stage && STAGE_CHARACTER[stage]) ?? 'conductor';
  const status = jobStatus(job, now);
  const dropped = job.group === 'done' && (job.closed as { as?: string } | null | undefined)?.as === 'dropped';
  // No level yet: which stages are still to come isn't known, so none is drawn but the PR stops.
  const stops = level === null ? track.stops.filter((s) => s.state !== 'next' || s.id === 'pr1' || SHIPPING_STAGES.includes(s.id)) : track.stops;
  const base = { stops, finished: track.finished, stars: isLevel(job.level) ? track.stars : null, difficulty: isLevel(job.level) ? track.difficulty : null };
  // The line after "Now" or "Your move": the next stage, and past the goal, that the quest is done.
  const following = (word: 'Next' | 'Then') => {
    if (track.finished) return nextPhrase ? `${word}: ${nextPhrase}. The quest itself is already done.` : 'The quest itself is already done.';
    return nextPhrase ? `${word}: ${nextPhrase}.` : null;
  };

  if (dropped) {
    return { ...base, who: 'conductor', mood: 'idle', ask: false, lead: 'Dropped', now: 'You dropped this job. Reopen it from the job menu to carry on.', next: null };
  }
  if (job.group === 'done') {
    return { ...base, who: 'conductor', mood: 'celebrating', ask: false, lead: 'Done', now: track.finished ? 'The quest is complete. Nice work, crew.' : 'This job is finished.', next: null };
  }
  if (usagePaused(job, usage)) {
    const who = workersNow(job)[0] ?? atStage;
    const doing = stage && DOING[stage] ? ` ${DOING[stage]}` : '';
    const auto = job.limitAuto !== false && usage?.autoResume !== false;
    const held = Boolean(usage?.jobs?.find((j) => j.slug === job.slug)?.held);
    // A reply held for the reset ("Approve, start after reset") starts the next stage; otherwise they carry on where they were.
    const then = held ? `your held reply goes to the Foreman${nextPhrase ? `, and ${lower(nextPhrase)}` : ''}` : `${named(who)} carries on${doing}`;
    const next = auto ? `Then: ${then}.` : `Then: press Carry on now once it resets (automatic carry-on is off), and ${then}.`;
    return { ...base, who, mood: 'asleep', ask: false, lead: 'Paused', now: `Claude’s usage limit stopped the crew (${status.label}).`, next };
  }
  if (job.group === 'needs-you') {
    const card = where === 'card';
    const what = status.label === 'Go-ahead'
      ? `the Foreman is waiting for your go-ahead${stage ? ` on ${stageLabel(stage)}` : ''}.`
      : status.label === 'Question'
        ? `the Foreman asked you something. ${card ? 'Open the job to answer it.' : 'Answer it below.'}`
        : status.label === 'Your turn'
          ? 'the Foreman is waiting for your reply.'
          : `the Foreman wants your permission for a step. ${card ? 'Allow or deny it above, or open the job.' : 'Allow or deny it below.'}`;
    return { ...base, who: atStage, mood: 'waiting', ask: true, lead: 'Your move', now: what, next: following('Then') };
  }
  if (job.group === 'running') {
    if (job.starting) return { ...base, who: 'conductor', mood: 'thinking', ask: false, lead: 'Now', now: 'The Foreman is reading your request.', next: 'Next: it suggests a level and writes its first brief.' };
    const who = workersNow(job)[0] ?? atStage;
    const doing = stage && DOING[stage] ? DOING[stage] : 'working';
    return { ...base, who, mood: 'working', ask: false, lead: 'Now', now: `${Named(who)} is ${doing}.`, next: following('Next') };
  }
  const stopped = status.label === 'Stopped';
  return {
    ...base, who: atStage, mood: 'idle', ask: false, lead: stopped ? 'Stopped' : 'Idle',
    now: stopped ? 'You stopped the last reply. Write to the Foreman to carry on.' : 'Nothing is happening right now. Write to the Foreman to carry on.',
    next: following('Next'),
  };
}

/** "The Foreman opens PR #1" → "the Foreman opens PR #1" (mid-sentence). */
const lower = (phrase: string) => (phrase.startsWith('The ') ? `t${phrase.slice(1)}` : phrase);
