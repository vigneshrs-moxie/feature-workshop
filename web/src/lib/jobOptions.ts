// The options editor's form (the job drawer's Options tab): built from a job's options.json, moved
// to another level, reset to a level's defaults, and turned back into the body POST
// /api/job/:slug/options takes. The dashboard checks and tidies whatever is sent (lib/options.js
// normalize), so these mirror its rules only as far as the page needs to show them right.
import type { JobOptionLists, JobOptions, LevelInfo, LevelNumber, Meta, ModelInfo, OptionChoice, ReviewerInfo } from '../api/types';
import { isLevel } from './levels';

export const OPUS = 'claude-opus-5-5';
export const FABLE = 'claude-fable-5-1';
export const SONNET = 'claude-sonnet-5-5';
export const HAIKU = 'claude-haiku-5-5';

/** notes.md's cap (the dashboard's NOTES_MAX) and the options' own process notes cap. */
export const NOTES_MAX = 20000;
export const PROCESS_NOTES_MAX = 1000;

// The dashboard's lists (meta.jobOptions), with these as a fallback until meta has loaded.
const SKIPPABLE: OptionChoice[] = [
  { id: 'spec', label: 'Spec' }, { id: 'refine', label: 'Refine (product interview)' }, { id: 'investigate', label: 'Investigate' },
  { id: 'spec-update', label: 'Spec update' }, { id: 'plan', label: 'Plan' }, { id: 'test', label: 'Test (the crew’s checks)' }, { id: 'review', label: 'Review' },
];
const PROVIDABLE: OptionChoice[] = [
  { id: 'spec', label: 'Spec', skips: ['spec', 'refine'] },
  { id: 'findings', label: 'Investigation findings', skips: ['investigate'] },
  { id: 'plan', label: 'Implementation plan', skips: ['plan'] },
  { id: 'test_plan', label: 'Test plan', skips: [] },
];
const FABLE_POINTS: OptionChoice[] = [
  { id: 'spec', label: 'After the spec is written' }, { id: 'plan', label: 'Before you approve the plan' },
  { id: 'review', label: 'When the review is wrapped up' }, { id: 'pr', label: 'Before PR #1 opens' },
];
const MODEL_CHOICES: ModelInfo[] = [
  { id: OPUS, label: 'Opus 5.5' }, { id: FABLE, label: 'Fable 5.1' }, { id: SONNET, label: 'Sonnet 5.5' }, { id: HAIKU, label: 'Haiku 5.5' },
];
const FOREMAN_IDS = [OPUS, FABLE, HAIKU];
const CREW_IDS = [OPUS, FABLE, SONNET, HAIKU];
const DEFAULT_MODELS = { foreman: OPUS, build: OPUS, checks: SONNET };

export type ModelRole = 'foreman' | 'build' | 'checks';
export const MODEL_ROLES: ModelRole[] = ['foreman', 'build', 'checks'];

/** The lists the editor shows, from meta.jobOptions (or the fallbacks above). */
export interface OptionLists {
  skippable: OptionChoice[];
  providable: OptionChoice[];
  reviewers: ReviewerInfo[];
  fablePoints: OptionChoice[];
  models: Record<ModelRole, ModelInfo[]>;
  notesMax: number;
}

const listOr = <T,>(v: T[] | undefined, fallback: T[]) => (Array.isArray(v) && v.length ? v : fallback);

export function optionLists(meta: Meta | null | undefined): OptionLists {
  const o: JobOptionLists = meta?.jobOptions ?? {};
  const choices = listOr(o.models?.choices, MODEL_CHOICES);
  const named = (ids: string[]) => ids.map((id) => choices.find((c) => c.id === id) ?? { id, label: id });
  const crew = named(listOr(o.models?.crew, CREW_IDS));
  return {
    skippable: listOr(o.skippable, SKIPPABLE),
    providable: listOr(o.providable, PROVIDABLE),
    reviewers: listOr(o.reviewers, []),
    fablePoints: listOr(o.fablePoints, FABLE_POINTS),
    models: { foreman: named(listOr(o.models?.foreman, FOREMAN_IDS)), build: crew, checks: crew },
    notesMax: typeof o.notesMax === 'number' && o.notesMax > 0 ? o.notesMax : NOTES_MAX,
  };
}

/** What the editor edits. reviewers: 'auto' (the Foreman picks the usual ones) or exactly these lenses. */
export interface OptionsForm {
  level: LevelNumber | null;
  /** Only for a job with no level yet: its flow (else the level decides it). */
  flow: string;
  skip: string[];
  provided: Record<string, string>;
  reviewers: 'auto' | string[];
  review_rounds: 1 | 2 | 3;
  manual_test: boolean;
  fable_checks: string[];
  models: Record<ModelRole, string>;
  notes: string;
}

const rounds = (v: unknown): 1 | 2 | 3 => (v === 2 || v === 3 ? v : 1);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Put stage ids in workflow order, once each. */
export function inOrder(skip: string[], lists: OptionLists): string[] {
  const order = lists.skippable.map((s) => s.id);
  return order.filter((id) => skip.includes(id));
}

/** The stages the provided documents skip (they're skipped whatever you tick). */
export function providedSkips(provided: Record<string, string>, lists: OptionLists): string[] {
  return lists.providable.filter((d) => provided[d.id]).flatMap((d) => d.skips ?? []);
}

/** The form for a job's options as saved (or the defaults for its level when it has no options.json yet). */
export function formFrom(options: JobOptions | null | undefined, jobLevel: LevelNumber | null | undefined, levels: LevelInfo[] | null | undefined, lists: OptionLists): OptionsForm {
  const level = isLevel(options?.level) ? options.level : options ? null : isLevel(jobLevel) ? jobLevel : null;
  const base = levelDefaults(level, levels, lists, { provided: {}, notes: '', review_rounds: 1 });
  if (!options) return base;
  const provided = Object.fromEntries(Object.entries(options.provided ?? {}).filter(([, p]) => typeof p === 'string' && p));
  return {
    level,
    flow: typeof options.flow === 'string' ? options.flow : base.flow,
    skip: inOrder(Array.isArray(options.skip) ? strings(options.skip) : base.skip, lists),
    provided,
    reviewers: options.reviewers === 'auto' ? 'auto' : Array.isArray(options.reviewers) ? strings(options.reviewers) : base.reviewers,
    review_rounds: rounds(options.review_rounds),
    manual_test: typeof options.manual_test === 'boolean' ? options.manual_test : base.manual_test,
    fable_checks: Array.isArray(options.fable_checks) ? strings(options.fable_checks) : base.fable_checks,
    models: Object.fromEntries(MODEL_ROLES.map((r) => [r, typeof options.models?.[r] === 'string' && options.models[r] ? options.models[r] : base.models[r]])) as Record<ModelRole, string>,
    notes: typeof options.notes === 'string' ? options.notes : '',
  };
}

/** What carries over when the level changes: always these, and your own testing and models from `from`. */
export type LevelKeep = Pick<OptionsForm, 'provided' | 'notes' | 'review_rounds'> & { from?: Pick<OptionsForm, 'level' | 'manual_test' | 'models'> };

/**
 * A level's own defaults (meta.levels: stages skipped, reviewers, you testing it, Fable points,
 * models), keeping what isn't the level's: the documents provided (and the stages they skip), the
 * process notes and the fix rounds given in `keep`. No level: the dashboard's defaults for a job
 * the Foreman will size (nothing skipped, the usual reviewers).
 * keep.from (moving from another level): you testing it and each model are kept only when they are
 * your own choice, i.e. differ from the OLD level's default; otherwise they follow the new level.
 * The same rule as the dashboard's optionsAtLevel (the header's level chip and the gate card's L↑/L↓),
 * so all three behave the same. Without it (Reset to level defaults) everything is the level's.
 */
export function levelDefaults(level: LevelNumber | null, levels: LevelInfo[] | null | undefined, lists: OptionLists, keep: LevelKeep): OptionsForm {
  const info = level === null ? null : levels?.find((l) => l.level === level) ?? null;
  const skip = [...(info?.skip ?? []), ...providedSkips(keep.provided, lists)];
  const out: OptionsForm = {
    level,
    flow: info?.flow ?? 'auto',
    skip: inOrder(skip, lists),
    provided: { ...keep.provided },
    reviewers: info ? (info.reviewers === 'auto' ? 'auto' : [...info.reviewers]) : 'auto',
    review_rounds: keep.review_rounds,
    manual_test: Boolean(info?.manualTest),
    fable_checks: [...(info?.fable ?? [])],
    models: { ...DEFAULT_MODELS, ...(info?.models ?? {}) },
    notes: keep.notes,
  };
  if (keep.from) {
    const old = levelDefaults(keep.from.level, levels, lists, { provided: {}, notes: '', review_rounds: 1 });
    if (keep.from.manual_test !== old.manual_test) out.manual_test = keep.from.manual_test;
    for (const role of MODEL_ROLES) if (keep.from.models[role] && keep.from.models[role] !== old.models[role]) out.models[role] = keep.from.models[role];
  }
  return out;
}

/** The body for POST /api/job/:slug/options ({ options: … }). A job with no level sends its flow. */
export function bodyFrom(form: OptionsForm): JobOptions {
  return {
    level: form.level,
    ...(form.level === null ? { flow: form.flow } : {}),
    skip: [...form.skip],
    provided: { ...form.provided },
    reviewers: form.reviewers === 'auto' ? 'auto' : [...form.reviewers],
    review_rounds: form.review_rounds,
    manual_test: form.manual_test,
    fable_checks: [...form.fable_checks],
    models: { ...form.models },
    notes: form.notes.trim(),
  };
}

/** Whether two forms would save the same options. */
export const sameOptions = (a: OptionsForm, b: OptionsForm) => JSON.stringify(bodyFrom(a)) === JSON.stringify(bodyFrom(b));

/** A model's friendly name ("Opus 5.5"), else its id. */
export function modelName(id: string, lists: OptionLists): string {
  for (const role of MODEL_ROLES) {
    const m = lists.models[role].find((x) => x.id === id);
    if (m) return m.label;
  }
  return id;
}
