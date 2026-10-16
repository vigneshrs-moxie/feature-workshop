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

/** "L2 Standard" (from meta.levels when it has it). */
export function levelLabel(level: LevelNumber, levels?: LevelInfo[] | null): string {
  return levels?.find((l) => l.level === level)?.label ?? `L${level} ${NAMES[level]}`;
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
  spec: 'spec', refine: 'product interview', investigate: 'investigation', 'spec-update': 'spec update',
  plan: 'plan', test: 'tester', review: 'review',
};
// Every level runs the checks (L0 in its build, L1 as its test stage, L2 up inside the tester), so
// "checks" is never named as added or dropped; only "tester" is.
const CHECKS = 'checks';
const stageWord = (stage: string, level: LevelNumber) => (stage === 'test' && level <= 1 ? CHECKS : STAGE_WORDS[stage]);
/**
 * What a level with reviewers 'auto' runs at least (design doc section 3: reviewer, permissions,
 * tests, and Stickler on Haiku per the skill; +db/ui if touched).
 */
export const USUAL_LENSES = ['feature-reviewer', 'feature-review-permissions', 'feature-review-tests', 'feature-review-conventions'];
const FABLE_WORDS: Record<string, string> = { spec: 'spec', plan: 'plan', review: 'review', pr: 'PR' };

/** The reviewers' friendly names by agent id (meta.jobOptions.reviewers: "Locksmith"), else none. */
export function lensNames(meta: Meta | null | undefined): Record<string, string> {
  const list = meta?.jobOptions?.reviewers;
  return Object.fromEntries((Array.isArray(list) ? list : []).filter((r) => r && typeof r.id === 'string' && typeof r.label === 'string').map((r) => [r.id, r.label]));
}

function lensesAt(info: LevelInfo): string[] {
  if (info.skip.includes('review')) return [];
  return info.reviewers === 'auto' ? USUAL_LENSES : info.reviewers;
}

/** What runs at a level, as short phrases: stages (in words), you testing it, Fable points, lenses. */
function parts(info: LevelInfo) {
  return {
    stages: Object.keys(STAGE_WORDS).filter((s) => !info.skip.includes(s)).map((s) => stageWord(s, info.level)),
    manual: Boolean(info.manualTest),
    fable: info.fable ?? [],
    lenses: lensesAt(info),
  };
}

function phrases({ stages, manual, fable, lenses }: ReturnType<typeof parts>, names: Record<string, string>): string[] {
  const out = [...stages];
  if (manual) out.push('you test');
  if (fable.length) out.push(`Fable at ${fable.map((p) => FABLE_WORDS[p] ?? p).join(' + ')}`);
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
 */
export function levelChange(from: LevelNumber | null, to: LevelNumber, levels: LevelInfo[] | null | undefined, names: Record<string, string> = {}): LevelChange {
  const toInfo = levels?.find((l) => l.level === to);
  const fromInfo = from === null ? null : levels?.find((l) => l.level === from);
  if (!toInfo) return { from, to, added: [], dropped: [], text: levelLabel(to, levels) };
  if (from === null || !fromInfo) {
    const added = phrases(parts(toInfo), names);
    return { from, to, added, dropped: [], text: `${toInfo.label} runs: ${added.join(', ') || 'one build and the checks'}` };
  }
  const noChecks = (p: ReturnType<typeof parts>) => ({ ...p, stages: p.stages.filter((s) => s !== CHECKS) });
  const a = noChecks(parts(fromInfo));
  const b = noChecks(parts(toInfo));
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
