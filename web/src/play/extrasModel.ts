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
  /** Past the first PR (or the job is done): every stop passed. */
  finished: boolean;
}

/** The job's quest track, or null when it has no level yet. */
export function questTrack(job: Job, levels?: LevelInfo[] | null): QuestTrack | null {
  if (!isLevel(job.level)) return null;
  const level = job.level;
  const skip = new Set(levels?.find((l) => l.level === level)?.skip ?? DEFAULT_SKIP[level]);
  const stage = typeof job.stage === 'string' ? job.stage : null;
  const finished = job.group === 'done' || (stage !== null && AFTER_GOAL.has(stage));
  // The current stage always shows, even one this level would skip (the job's own options can differ).
  const ids = QUEST_STAGES.filter((s) => s === stage || (!skip.has(s) && s !== 'spec-update'));
  const at = finished ? ids.length : stage ? ids.indexOf(stage) : -1;
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
  /** How full the health bar is, 0–1. */
  share: number;
  defeated: boolean;
  /** "Boss: 7 of 12 hit points left · 1 blocker, 1 major", or "Boss defeated". */
  text: string;
}

/** The boss fight for a job's latest review round, or null when there is none. */
export function bossView(r: ReviewBoss | null | undefined): BossView | null {
  if (!r) return null;
  const left = Math.max(0, r.hp);
  const start = Math.max(left, r.startHp);
  if (left === 0) return { start, left: 0, share: 0, defeated: true, text: 'Boss defeated' };
  return { start, left, share: left / start, defeated: false, text: `Boss: ${left} of ${start} hit points left · ${findingsText(r)}` };
}

// ---------- Stamina ----------

export type StaminaState = 'fresh' | 'warning' | 'resting';

export interface Stamina {
  state: StaminaState;
  /** "Fresh", "Warning", "Resting until 3:42pm". */
  label: string;
  /** How full the bar is drawn: a picture of the state, never a measured amount. */
  fill: number;
  hint: string;
}

/** Claude's usage limit as stamina: resting while it is reached, a warning when close, else fresh. */
export function staminaOf(usage: Usage | null | undefined, now: Date = new Date()): Stamina {
  if (usage?.limited) {
    const at = clockTime(usage.resetsAt, now);
    return {
      state: 'resting', label: at && !usage.passed ? `Resting until ${at}` : 'Resting', fill: 0,
      hint: 'Claude’s usage limit is reached: jobs are paused and the crew are asleep. They carry on when it resets (see the banner).',
    };
  }
  if (usage?.warning) {
    const at = clockTime(usage.warning.resetsAt, now);
    return {
      state: 'warning', label: 'Warning', fill: 0.35,
      hint: `Close to Claude’s ${usage.warning.label}${at ? `, which resets at about ${at}` : ''}. If it runs out, running jobs pause and carry on after it resets.`,
    };
  }
  return { state: 'fresh', label: 'Fresh', fill: 1, hint: 'Claude’s usage limit isn’t close: the crew can work.' };
}

/** "back at 3:42pm (in 23m)" for a usage pause; '' when the reset time isn't known. */
export function backAt(usage: Usage | null | undefined, now: Date = new Date()): string {
  if (!usage?.resetsAt) return '';
  const at = clockTime(usage.resetsAt, now);
  if (!at) return '';
  const mins = Math.round((Date.parse(usage.resetsAt) - now.getTime()) / 60000);
  if (mins <= 0) return `back at ${at}`;
  const left = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`;
  return `back at ${at} (in ${left})`;
}
