// Levels L0 Tweak to L3 Large in the new UI: the rules' instant suggestion (the dashboard's own
// dashboard/lib/level-rules.js, bundled by Vite like compose.js, so the page and the dashboard
// never disagree), names and labels, and what moving between two levels adds or drops, worked out
// from each level's defaults in meta.levels (lib/options.js levelsForClient).
import { RISK_TRIGGERS, suggestLevel, type LevelSuggestion } from '../../../dashboard/lib/level-rules.js';
import type { Job, LevelInfo, LevelNumber, Meta } from '../api/types';

export type { LevelSuggestion };

export const LEVEL_NUMBERS: LevelNumber[] = [0, 1, 2, 3];
const NAMES = ['Tweak', 'Small', 'Standard', 'Large'];

export const isLevel = (v: unknown): v is LevelNumber => v === 0 || v === 1 || v === 2 || v === 3;

/** "L2 Standard" (from meta.levels when it has it); on a bug job (kind 'bug') L0 reads "L0 Tweak (hotfix)". */
export function levelLabel(level: LevelNumber, levels?: LevelInfo[] | null, kind?: string | null): string {
  const info = levels?.find((l) => l.level === level);
  const bug = kind === 'bug';
  return (bug ? info?.bugLabel : undefined) ?? info?.label ?? `L${level} ${bug && level === 0 ? 'Tweak (hotfix)' : NAMES[level]}`;
}

/** The rules' suggestion for a description, no model involved; null until it's a few characters long. */
export function suggestFromDescription(description: string): LevelSuggestion | null {
  const text = description.trim();
  if (text.length < 4) return null;
  return suggestLevel({ description: text });
}

const joinAnd = (parts: string[]) => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);

/**
 * Why the rules want at least their floor, in a few words, when you picked a level under it:
 * "it touches sign-in, roles or permissions". Null when the pick isn't under the floor.
 */
export function floorWhy(s: Pick<LevelSuggestion, 'floor' | 'triggers'> & { floorReasons?: string[] }, picked: LevelNumber): string | null {
  if (picked >= s.floor) return null;
  const parts = RISK_TRIGGERS.filter((t) => s.triggers.includes(t.id) && t.floor > picked).map((t) => t.label);
  if ((s.floorReasons ?? []).some((r) => r.startsWith('Mentions a new or changed table or column'))) parts.push('a new or changed table or column');
  return parts.length ? `it touches ${joinAnd(parts)}` : 'of what it touches';
}

/** The note under the picker when you pick below the rules' floor. */
export function floorNote(s: Pick<LevelSuggestion, 'floor' | 'triggers'> & { floorReasons?: string[] }, picked: LevelNumber): string | null {
  const why = floorWhy(s, picked);
  return why ? `The rules suggest at least L${s.floor} because ${why}; the Foreman will ask before building.` : null;
}

// ---------- What a level runs, and what moving between two adds or drops ----------

/**
 * Stage ids (the job options' skip list) in workflow order, in the words the page uses. The test
 * stage reads "tester" from L2 up; at L1 it is the Foreman running the quick plan's checks (see
 * stageWord).
 */
export const STAGE_WORDS: Record<string, string> = {
  clarify: 'clarify questions', spec: 'spec', refine: 'product interview', wireframe: 'screens', investigate: 'investigation', 'spec-update': 'spec update',
  plan: 'plan', test: 'tester', review: 'review',
};
// Every level runs the checks (L0 in its build, L1 as its test stage, L2 up inside the tester), so
// "checks" is never named as added or dropped; only "tester" is.
const CHECKS = 'checks';
// A bug job's own stages (the bug-fix workflow: triage, reproduce, diagnose; diagnose is never skipped).
const BUG_STAGE_WORDS: Record<string, string> = { triage: 'triage', reproduce: 'reproduction', test: 'tester', review: 'review' };
const stageWord = (stage: string, level: LevelNumber, kind: string | null = null) => (stage === 'test' && level <= 1 ? CHECKS : (kind === 'bug' ? BUG_STAGE_WORDS : STAGE_WORDS)[stage]);
/**
 * What a level with reviewers 'auto' runs at least (design doc section 3: reviewer, permissions,
 * tests, and Stickler on Haiku per the skill; +db/ui if touched).
 */
export const USUAL_LENSES = ['feature-reviewer', 'feature-review-permissions', 'feature-review-tests', 'feature-review-conventions'];
/** The same on a bug job: the Examiner and Stickler, plus the risk lenses the diff touches. */
export const USUAL_BUG_LENSES = ['bug-review-fix', 'feature-review-conventions'];

/** A level's defaults for this kind of job: on a bug job, its bug skip list and reviewers (meta.levels[n].bug). */
export function levelForKind(info: LevelInfo | null | undefined, kind: string | null = null): LevelInfo | null {
  if (!info) return null;
  return kind === 'bug' && info.bug ? { ...info, skip: info.bug.skip, reviewers: info.bug.reviewers } : info;
}
const FABLE_WORDS: Record<string, string> = { spec: 'spec', plan: 'plan', review: 'review', pr: 'PR' };
// On a bug job the plan's Fable look is at the diagnosis (the /bugfix conductor); there is no spec.
const BUG_FABLE_WORDS: Record<string, string> = { ...FABLE_WORDS, plan: 'diagnosis' };

/** The reviewers' friendly names by agent id (meta.jobOptions.reviewers: "Locksmith"), else none. */
export function lensNames(meta: Meta | null | undefined): Record<string, string> {
  const list = meta?.jobOptions?.reviewers;
  return Object.fromEntries((Array.isArray(list) ? list : []).filter((r) => r && typeof r.id === 'string' && typeof r.label === 'string').map((r) => [r.id, r.label]));
}

function lensesAt(info: LevelInfo, kind: string | null = null): string[] {
  if (info.skip.includes('review')) return [];
  return info.reviewers === 'auto' ? (kind === 'bug' ? USUAL_BUG_LENSES : USUAL_LENSES) : info.reviewers;
}

/** Every stage in workflow order (dashboard/lib/stages.js), to leave out the ones a job has finished. */
const WORKFLOW = ['clarify', 'spec', 'refine', 'wireframe', 'investigate', 'spec-update', 'plan', 'implement', 'test', 'review', 'pr1', 'pr2', 'staging-qa', 'pr3'];
const BUG_WORKFLOW = ['triage', 'reproduce', 'diagnose', 'implement', 'test', 'review', 'pr1', 'pr2', 'staging-qa', 'pr3'];
// The stage each Fable point belongs to ("pr": before PR #1 opens).
const FABLE_STAGE: Record<string, string> = { spec: 'spec', plan: 'plan', review: 'review', pr: 'pr1' };
const BUG_FABLE_STAGE: Record<string, string> = { ...FABLE_STAGE, plan: 'diagnose' };

/**
 * Whether a stage is still to come for a job now at `current`: the current stage and the ones after
 * it are; the ones before it are finished. No (or an unknown) current stage: every stage is.
 */
function stillAhead(current: string | null | undefined, kind: string | null = null) {
  const order = kind === 'bug' ? BUG_WORKFLOW : WORKFLOW;
  const at = current ? order.indexOf(current) : -1;
  return (stage: string) => at < 0 || !order.includes(stage) || order.indexOf(stage) >= at;
}

/**
 * What runs at a level, as short phrases: stages (in words), you testing it, Fable points, lenses;
 * only what is still ahead (you test after the tester; the lenses at review).
 */
function parts(info: LevelInfo, ahead: (stage: string) => boolean = () => true, kind: string | null = null) {
  return {
    stages: Object.keys(kind === 'bug' ? BUG_STAGE_WORDS : STAGE_WORDS).filter((s) => !info.skip.includes(s) && ahead(s)).map((s) => stageWord(s, info.level, kind)),
    manual: Boolean(info.manualTest) && ahead('test'),
    fable: (info.fable ?? []).filter((p) => (kind !== 'bug' || p !== 'spec') && ahead((kind === 'bug' ? BUG_FABLE_STAGE : FABLE_STAGE)[p] ?? p)).map((p) => (kind === 'bug' ? BUG_FABLE_WORDS : FABLE_WORDS)[p] ?? p),
    lenses: ahead('review') ? lensesAt(info, kind) : [],
  };
}

function phrases({ stages, manual, fable, lenses }: ReturnType<typeof parts>, names: Record<string, string>): string[] {
  const out = [...stages];
  if (manual) out.push('you test');
  if (fable.length) out.push(`Fable at ${fable.join(' + ')}`);
  if (lenses.length) out.push(`${lenses.map((l) => names[l] ?? l).join(' + ')} lens${lenses.length === 1 ? '' : 'es'}`);
  return out;
}

const minus = <T,>(a: T[], b: T[]) => a.filter((x) => !b.includes(x));

export interface LevelChange {
  from: LevelNumber | null;
  to: LevelNumber;
  /** Short phrases: "spec", "you test", "Fable at plan + review", "Locksmith + Gauge lenses". */
  added: string[];
  dropped: string[];
  /** "L1→L2 adds: spec, investigation, spec update, Locksmith + Gauge lenses". */
  text: string;
}

/**
 * What moving a job from one level to another adds and drops, by the levels' defaults (stages
 * skipped, you testing it, Fable points, reviewers; 'auto' reviewers count as USUAL_LENSES).
 * from null (no level yet): what the new level runs. Lenses by their friendly names when given.
 * stage: the job's current stage, for a job under way; stages before it are finished, so what they
 * would add or drop is left out (at a plan gate, L2→L3 doesn't name the product interview). Leave
 * it out for a job not started yet (the New job sheet). kind: the job's; a bug job's levels use
 * its bug skip list and reviewers, and its own stages (triage, reproduction).
 */
export function levelChange(from: LevelNumber | null, to: LevelNumber, levels: LevelInfo[] | null | undefined, names: Record<string, string> = {}, stage: string | null = null, kind: string | null = null): LevelChange {
  const toInfo = levelForKind(levels?.find((l) => l.level === to), kind);
  const fromInfo = from === null ? null : levelForKind(levels?.find((l) => l.level === from), kind);
  const ahead = stillAhead(stage, kind);
  if (!toInfo) return { from, to, added: [], dropped: [], text: levelLabel(to, levels, kind) };
  if (from === null || !fromInfo) {
    const added = phrases(parts(toInfo, ahead, kind), names);
    return { from, to, added, dropped: [], text: `${levelLabel(to, levels, kind)} runs: ${added.join(', ') || 'one build and the checks'}` };
  }
  const noChecks = (p: ReturnType<typeof parts>) => ({ ...p, stages: p.stages.filter((s) => s !== CHECKS) });
  const a = noChecks(parts(fromInfo, ahead, kind));
  const b = noChecks(parts(toInfo, ahead, kind));
  const added = phrases({ stages: minus(b.stages, a.stages), manual: b.manual && !a.manual, fable: minus(b.fable, a.fable), lenses: minus(b.lenses, a.lenses) }, names);
  const dropped = phrases({ stages: minus(a.stages, b.stages), manual: a.manual && !b.manual, fable: minus(a.fable, b.fable), lenses: minus(a.lenses, b.lenses) }, names);
  const head = `L${from}→L${to}`;
  const bits = [added.length ? `adds: ${added.join(', ')}` : null, dropped.length ? `drops: ${dropped.join(', ')}` : null].filter(Boolean);
  return { from, to, added, dropped, text: bits.length ? `${head} ${bits.join('; ')}` : `${head}: the same stages and reviewers` };
}

// ---------- The LevelCard: when it shows, and remembering "Keep" ----------

export interface LevelCardView {
  show: boolean;
  /** The level it offers (the Foreman's, else the rules'); null: nothing to offer. */
  target: LevelNumber | null;
  /** Names this situation (chosen level and offer), for remembering "Keep" per job. */
  signature: string;
}

type LevelFacts = Pick<Job, 'level' | 'suggestedLevel' | 'rulesLevel' | 'closed'>;

/**
 * Shown when the Foreman's suggestion differs from the job's chosen level, or the job has no
 * level yet (then it offers the Foreman's suggestion, else the rules'), unless you chose to keep
 * yours for this same suggestion (dismissed: the signature remembered for the job). Never on a
 * job marked done or dropped.
 */
export function levelCardView(job: LevelFacts, dismissed: string | null): LevelCardView {
  const chosen = isLevel(job.level) ? job.level : null;
  const foreman = isLevel(job.suggestedLevel) ? job.suggestedLevel : null;
  const rules = isLevel(job.rulesLevel?.level) ? job.rulesLevel.level : null;
  const target = chosen === null ? foreman ?? rules : foreman !== null && foreman !== chosen ? foreman : null;
  const signature = `${chosen ?? 'none'}>${target ?? 'none'}`;
  return { show: !job.closed && target !== null && dismissed !== signature, target, signature };
}

/** Where "Keep" is remembered for a job (localStorage, via lib/stored.ts). */
export const levelCardKey = (slug: string) => `fw.levelCard.${slug}`;
