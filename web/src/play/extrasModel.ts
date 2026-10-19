// The Full-mode extras (Play layer step 6), worked out from what the page already has: the quest
// track (the job's level as difficulty and the stages it runs as a path), the boss fight (an L3
// review's findings as hit points, from the play ledger) and stamina (Claude's usage limit, from the
// snapshot's usage). Pure: no React, no fetching, nothing from a model. The components are in
// FullExtras.tsx and draw nothing unless Play mode is Full.
import type { Job, LevelInfo, LevelNumber, ReviewBoss, Usage } from '../api/types';
import { clockTime } from '../lib/time';
import { isLevel, levelLabel } from '../lib/levels';
import { stageLabel } from '../panes/Jobs/stages';
import { STAGE_CHARACTER } from './crew';

// ---------- Quest track ----------

/** The stages a quest runs through, in order, to its goal: the first PR (a quest is done then). */
export const QUEST_STAGES: readonly string[] = ['spec', 'refine', 'investigate', 'spec-update', 'plan', 'implement', 'test', 'review', 'pr1'];
// Stages after the first PR: the quest is done by then.
const AFTER_GOAL = new Set(['pr2', 'staging-qa', 'pr3']);
/** Each level's skipped stages when meta.levels doesn't say (dashboard/lib/options.js LEVELS). */
const DEFAULT_SKIP: Record<LevelNumber, string[]> = {
  0: ['spec', 'refine', 'investigate', 'spec-update', 'plan', 'test', 'review'],
  1: ['spec', 'refine', 'investigate', 'spec-update'],
  2: ['refine'],
  3: [],
};

/** L0 ★ … L3 ★★★★. */
export const difficultyStars = (level: LevelNumber) => '★'.repeat(level + 1);

export type StopState = 'done' | 'current' | 'next';
export interface QuestStop { id: string; label: string; state: StopState }

export interface QuestTrack {
  level: LevelNumber;
  stars: string;
  /** "Difficulty: L2 Standard". */
  difficulty: string;
  /** The stages this level runs, skipped ones left out ("Spec update" only while it is the stage). */
  stops: QuestStop[];
  /** Who stands on the current stop (the stage's character); the Foreman at the goal once done. */
  who: string | null;
  /** The quest is done (by the Settings → Play rule): every stop passed. */
  finished: boolean;
}

/**
 * The job's quest track, or null when it has no level yet. done: whether the play ledger counts the
 * quest done (Settings → Play: its first PR created, or you marked it done); without the ledger, a
 * job past the first PR or marked done is taken as done.
 */
export function questTrack(job: Job, levels?: LevelInfo[] | null, done?: boolean): QuestTrack | null {
  if (!isLevel(job.level)) return null;
  const level = job.level;
  const skip = new Set(levels?.find((l) => l.level === level)?.skip ?? DEFAULT_SKIP[level]);
  const stage = typeof job.stage === 'string' ? job.stage : null;
  const pastGoal = stage !== null && AFTER_GOAL.has(stage);
  const finished = done ?? (job.group === 'done' || pastGoal);
  // The current stage always shows, even one this level would skip (the job's own options can differ).
  const ids = QUEST_STAGES.filter((s) => s === stage || (!skip.has(s) && s !== 'spec-update'));
  // Past the first PR but not done yet ("I mark the job done"): standing at the goal.
  const at = finished ? ids.length : pastGoal ? ids.length - 1 : stage ? ids.indexOf(stage) : -1;
  const stops = ids.map((id, i): QuestStop => ({
    id, label: stageLabel(id), state: finished || (at >= 0 && i < at) ? 'done' : i === at ? 'current' : 'next',
  }));
  const who = finished ? 'conductor' : at >= 0 && stage ? STAGE_CHARACTER[stage] ?? 'conductor' : null;
  return { level, stars: difficultyStars(level), difficulty: `Difficulty: ${levelLabel(level, levels)}`, stops, who, finished };
}

// ---------- Boss fight ----------

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "1 blocker, 1 major" (none left out); '' when there are none. */
export function findingsText(r: Pick<ReviewBoss, 'blockers' | 'majors' | 'minors'>): string {
  return [[r.blockers, 'blocker'], [r.majors, 'major'], [r.minors, 'minor']]
    .filter(([n]) => (n as number) > 0)
    .map(([n, w]) => plural(n as number, w as string))
    .join(', ');
}

export interface BossView {
  /** Hit points it started with (the heaviest round seen). */
  start: number;
  /** Hit points left (the latest round). */
  left: number;
  /** How full the health bar is, 0–1 (empty once defeated). */
  share: number;
  defeated: boolean;
  /** "Boss: 7 of 12 hit points left · 1 blocker, 1 major", or "Boss defeated · 2 minors left for you". */
  text: string;
}

/**
 * The boss fight for a job's latest review round, or null when there is none to show: no review,
 * or no round ever raised a blocker or a major (a clean review, or minors only, has no boss). It
 * is defeated once the blockers and majors are fixed; minors left over go to you.
 */
export function bossView(r: ReviewBoss | null | undefined): BossView | null {
  if (!r) return null;
  const left = Math.max(0, r.hp);
  const start = Math.max(left, r.startHp);
  if (r.blockers + r.majors > 0) {
    return { start, left, share: start ? left / start : 0, defeated: false, text: `Boss: ${left} of ${start} hit points left · ${findingsText(r)}` };
  }
  if (!(r.hadBoss ?? r.defeatedAt != null)) return null;
  const rest = r.minors > 0 ? ` · ${plural(r.minors, 'minor')} left for you` : '';
  return { start, left, share: 0, defeated: true, text: `Boss defeated${rest}` };
}

// ---------- Stamina ----------

export type StaminaState = 'fresh' | 'warning' | 'resting';

export interface Stamina {
  state: StaminaState;
  /** "Fresh", "Warning", "Resting until 3:42pm". */
  label: string;
  /** How full the bar is drawn: what is left of the limit when Claude said how much is used, else a picture of the state. */
  fill: number;
  hint: string;
}

/** Claude's usage limit as stamina: resting while it is reached, a warning when close, else fresh. */
export function staminaOf(usage: Usage | null | undefined, now: Date = new Date()): Stamina {
  if (usage?.limited) {
    const at = clockTime(usage.resetsAt, now);
    // The same promise as the usage banner: a time only when the jobs carry on by themselves then.
    const when = !usage.autoResume
      ? 'Automatic carry-on is off, so they wait for Carry on now (see the banner).'
      : usage.resetKnown
        ? 'They carry on by themselves when it resets (see the banner).'
        : `Claude didn’t say when it resets, so the dashboard tries again${at ? ` at about ${at}` : ''}.`;
    return {
      state: 'resting', label: at && usage.autoResume && usage.resetKnown && !usage.passed ? `Resting until ${at}` : 'Resting', fill: 0,
      hint: `Claude’s usage limit is reached: jobs are paused and the crew are asleep. ${when}`,
    };
  }
  if (usage?.warning) {
    const at = clockTime(usage.warning.resetsAt, now);
    const pct = usage.warning.percent;
    return {
      state: 'warning', label: 'Warning', fill: typeof pct === 'number' ? Math.min(1, Math.max(0, 1 - pct / 100)) : 0.35,
      hint: `Close to Claude’s ${usage.warning.label}${at ? `, which resets at about ${at}` : ''}. If it runs out, running jobs pause and carry on after it resets.`,
    };
  }
  return { state: 'fresh', label: 'Fresh', fill: 1, hint: 'Claude’s usage limit isn’t close: the crew can work.' };
}

/**
 * When the crew wake from a usage pause, saying what the usage banner says: "back at 3:42pm (in 23m)"
 * when they carry on by themselves at a reset Claude named, "the dashboard tries again at about
 * 3:42pm" when Claude didn't name one, "waiting for Carry on now" with automatic carry-on off; ''
 * when there is no time to tell.
 */
export function backAt(usage: Usage | null | undefined, now: Date = new Date()): string {
  if (!usage) return '';
  if (!usage.autoResume) return 'waiting for Carry on now (automatic carry-on is off)';
  if (!usage.resetsAt) return '';
  const at = clockTime(usage.resetsAt, now);
  if (!at) return '';
  if (!usage.resetKnown) return `the dashboard tries again at about ${at}`;
  const mins = Math.round((Date.parse(usage.resetsAt) - now.getTime()) / 60000);
  if (mins <= 0) return `back at ${at}`;
  const left = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`;
  return `back at ${at} (in ${left})`;
}
