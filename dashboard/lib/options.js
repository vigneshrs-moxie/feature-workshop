// A job's options: how much process it gets. Chosen when you start a job and changeable on its
// page: the level (L0 Tweak to L3 Large, or none yet so the Foreman suggests one), stages to skip,
// documents you already have, which reviewers run, testing it yourself, when Fable takes a second
// look, and the models. Kept as options.json in the job's private folder; the Foreman reads it
// before every stage (the workflow's job-options.md), so a change takes effect from the next stage.
//
// Schema 2 adds `level` and `models` and still writes every schema 1 field, `flow` included
// (derived from the level by flowFor), so a skill that only knows flows keeps working. Schema 1
// files still load: their flow maps to a level (levelFor).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const OPUS = 'claude-opus-5-5';
export const FABLE = 'claude-fable-5-1';
export const SONNET = 'claude-sonnet-5-5';
export const HAIKU = 'claude-haiku-5-5';
/** The model ids options.json may name in `models`. */
export const MODEL_IDS = [OPUS, FABLE, SONNET, HAIKU];
/** The ones the Foreman itself may run on (models.foreman). KEEP IN STEP with MODELS in server.js. */
export const FOREMAN_MODEL_IDS = [OPUS, FABLE, HAIKU];
/** Friendly names and a few words on each, for the options editor's model choices (meta.jobOptions.models). */
export const MODEL_CHOICES = [
  { id: OPUS, label: 'Opus 5.5', note: 'Strong and much cheaper than Fable: the everyday choice.' },
  { id: FABLE, label: 'Fable 5.1', note: 'Best judgment, highest cost and quickest to use up your limits.' },
  { id: SONNET, label: 'Sonnet 5.5', note: 'Cheaper; fine for small builds and running checks.' },
  { id: HAIKU, label: 'Haiku 5.5', note: 'Cheapest; for simple checks and trying things out.' },
];
export const SCHEMA_VERSION = 2;
/** Screens (wireframes) and Clarify questions on a job: Auto (the workflow decides), Always, or Off (Settings → Workflow sets the default for new jobs). */
export const WORKFLOW_CHOICES = ['auto', 'always', 'off'];
const workflowChoice = (v) => (WORKFLOW_CHOICES.includes(v) ? v : null);

// The Foreman is Opus for every flow and level. Fable takes short second looks (fable_checks);
// it is never started as the Foreman just because a job is large.
export const FLOWS = {
  quick: {
    label: 'Quick', model: OPUS,
    note: 'Like doing it yourself in Claude Code: a short plan in the first reply, then build, checks, you try it, one reviewer, PR. No spec or plan documents.',
    skip: ['spec', 'refine', 'investigate', 'spec-update'], reviewers: ['feature-reviewer'], fable: [], manualTest: true,
  },
  small: {
    label: 'Small', model: OPUS,
    note: 'Spec, investigate, plan, build, test, review, PR. The usual flow for a contained feature.',
    skip: ['refine'], reviewers: 'auto', fable: [], manualTest: false,
  },
  large: {
    label: 'Large', model: OPUS,
    note: 'Small plus a product interview (refine), with Fable second looks at the plan and the review.',
    skip: [], reviewers: 'auto', fable: ['plan', 'review'], manualTest: false,
  },
  auto: {
    label: 'Let the Foreman decide', model: OPUS,
    note: 'The Foreman sizes it after writing the spec (small or large) and says which in its brief.',
    skip: [], reviewers: 'auto', fable: [], manualTest: false,
  },
};

export const SKIPPABLE = [
  { id: 'spec', label: 'Spec' }, { id: 'refine', label: 'Refine (product interview)' }, { id: 'investigate', label: 'Investigate' },
  { id: 'spec-update', label: 'Spec update' }, { id: 'plan', label: 'Plan' }, { id: 'test', label: 'Test (the crew’s checks)' }, { id: 'review', label: 'Review' },
];
// Documents you can hand over instead of having the crew write them; each one skips its stage.
export const PROVIDABLE = [
  { id: 'spec', label: 'Spec', skips: ['spec', 'refine'] },
  { id: 'findings', label: 'Investigation findings', skips: ['investigate'] },
  { id: 'plan', label: 'Implementation plan', skips: ['plan'] },
  { id: 'test_plan', label: 'Test plan', skips: [] },
];
export const REVIEWERS = [
  { id: 'feature-reviewer', label: 'Head inspector', what: 'does it do what was asked, correctly', model: 'Opus' },
  { id: 'feature-review-permissions', label: 'Locksmith', what: 'who can see and do what', model: 'Opus' },
  { id: 'feature-review-tests', label: 'Gauge', what: 'test coverage', model: 'Sonnet' },
  { id: 'feature-review-conventions', label: 'Stickler', what: 'the repo’s written rules', model: 'Haiku' },
  { id: 'feature-review-errors', label: 'Fuse', what: 'errors and edge cases', model: 'Sonnet' },
  { id: 'feature-review-db', label: 'Mason', what: 'migrations and data', model: 'Sonnet' },
  { id: 'feature-review-performance', label: 'Stopwatch', what: 'speed with lots of data', model: 'Sonnet' },
  { id: 'feature-review-ui', label: 'Painter', what: 'screens, wording, accessibility', model: 'Sonnet' },
];
export const FABLE_POINTS = [
  { id: 'spec', label: 'After the spec is written' },
  { id: 'plan', label: 'Before you approve the plan' },
  { id: 'review', label: 'When the review is wrapped up' },
  { id: 'pr', label: 'Before PR #1 opens' },
];

const ids = (list) => list.map((x) => x.id);
// The Foreman runs only on the models offered for it; the build and the checks on any the crew knows.
const modelAllowed = (role, id) => (role === 'foreman' ? FOREMAN_MODEL_IDS : MODEL_IDS).includes(id);
const pick = (v, allowed) => [...new Set((Array.isArray(v) ? v : []).filter((x) => allowed.includes(x)))];

/**
 * The four levels (design doc section 3). Each one's defaults: stages skipped, reviewers, whether
 * you test it by hand, Fable second looks, and models (the Foreman is Opus at every level).
 * `flow` is what an un-updated skill reads (flowFor).
 */
export const LEVELS = [
  {
    level: 0, name: 'Tweak', flow: 'quick',
    hint: 'One build, then the checks (npm run check/build); you look at the diff. No plan to approve.',
    skip: ['spec', 'refine', 'investigate', 'spec-update', 'plan', 'test', 'review'], reviewers: [], manualTest: false, fable: [],
    models: { foreman: OPUS, build: SONNET, checks: SONNET },
  },
  {
    level: 1, name: 'Small', flow: 'quick',
    hint: 'A quick plan you approve, then build, checks, you try it, one reviewer.',
    skip: ['spec', 'refine', 'investigate', 'spec-update'], reviewers: ['feature-reviewer'], manualTest: true, fable: [],
    models: { foreman: OPUS, build: OPUS, checks: OPUS },
  },
  {
    level: 2, name: 'Standard', flow: 'small',
    hint: 'A short spec and plan you approve, build in steps, the tester, you try it, 3–4 reviewers.',
    skip: ['refine'], reviewers: 'auto', manualTest: true, fable: [],
    models: { foreman: OPUS, build: OPUS, checks: SONNET },
  },
  {
    level: 3, name: 'Large', flow: 'large',
    hint: 'Spec, product interview, investigation, a plan you approve, build in steps, the tester, you try it, every reviewer plus Fable.',
    skip: [], reviewers: ids(REVIEWERS), manualTest: true, fable: ['plan', 'review'],
    models: { foreman: OPUS, build: OPUS, checks: SONNET },
  },
];
// Models for a job with no level yet (a schema 1 "auto" job, or one the Foreman will size).
const DEFAULT_MODELS = { foreman: OPUS, build: OPUS, checks: SONNET };

export const isLevel = (v) => Number.isInteger(v) && v >= 0 && v <= 3;

/** The flow an un-updated skill reads for a level: L0 and L1 run quick, L2 small, L3 large. */
export function flowFor(level) {
  return isLevel(level) ? LEVELS[level].flow : 'auto';
}

/** The level a schema 1 flow stands for; null for auto (no level yet: the rules and the Foreman suggest one). */
export function levelFor(flow) {
  return { quick: 1, small: 2, large: 3 }[flow] ?? null;
}

/** "L2 Standard". */
export const levelLabel = (level) => (isLevel(level) ? `L${level} ${LEVELS[level].name}` : null);

/** The defaults for a flow, as a full options object (its level mapped by levelFor). */
export function defaultsFor(flow = 'auto') {
  const f = FLOWS[flow] ?? FLOWS.auto;
  const level = levelFor(flow);
  return {
    schema_version: SCHEMA_VERSION, level, flow: FLOWS[flow] ? flow : 'auto', skip: [...f.skip], provided: {}, reviewers: Array.isArray(f.reviewers) ? [...f.reviewers] : f.reviewers,
    review_rounds: 1, manual_test: f.manualTest, fable_checks: [...f.fable], models: { ...(level === null ? DEFAULT_MODELS : LEVELS[level].models) }, notes: '',
    wireframes: 'auto', clarify: 'auto',
  };
}

/** The defaults for a level, as a full options object. */
export function defaultsForLevel(level) {
  if (!isLevel(level)) return defaultsFor('auto');
  const l = LEVELS[level];
  return {
    schema_version: SCHEMA_VERSION, level, flow: l.flow, skip: [...l.skip], provided: {}, reviewers: Array.isArray(l.reviewers) ? [...l.reviewers] : l.reviewers,
    review_rounds: 1, manual_test: l.manualTest, fable_checks: [...l.fable], models: { ...l.models }, notes: '',
    wireframes: 'auto', clarify: 'auto',
  };
}

// A level from the page: a whole number 0–3, or nothing (undefined, null or '').
function levelInput(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'string' && /^\d$/.test(v.trim()) ? Number(v) : v;
  if (!isLevel(n)) throw new Error('Level: pick L0, L1, L2 or L3.');
  return n;
}

/**
 * Check and tidy options from the page. Throws an Error with a plain message when something is off.
 * exists(p): whether a provided document is there (injectable for tests).
 * previous: the job's options before this change. A page that only knows flows (the classic one)
 * sends no level; when its flow is the one the previous level already ran, that level is kept, so
 * saving an L0 job from there doesn't quietly turn it into L1. It sends no models either; while
 * the level stays the same, the job's own models are kept (not reset to the level's defaults).
 * models.foreman must be one of FOREMAN_MODEL_IDS; the build and checks any of MODEL_IDS.
 * A provided document the job already had (previous.provided) was checked when it was given, so
 * it is kept even if it has moved since (as optionsAtLevel does); only new paths must exist.
 *
 * The level wins over the flow: `flow` is always flowFor(level). Without a level, a schema 1 flow
 * maps to one (quick → L1, small → L2, large → L3; auto → none) and keeps that flow's defaults.
 * workflow: the Settings → Workflow defaults for a new job ({ wireframes, clarify }, lib/state.js
 * workflowSettings); a job keeps its own choice (input, else previous) over them, and Auto failing all.
 */
export function normalize(input = {}, { exists = (p) => fs.existsSync(p), previous = null, workflow = null } = {}) {
  let level = levelInput(input.level);
  if (level === null && input.level === undefined && isLevel(previous?.level) && flowFor(previous.level) === input.flow) level = previous.level;
  const out = level !== null ? defaultsForLevel(level) : defaultsFor(input.flow);
  if (Array.isArray(input.skip)) out.skip = pick(input.skip, ids(SKIPPABLE));
  out.provided = {};
  const known = new Set(Object.values(previous?.provided && typeof previous.provided === 'object' ? previous.provided : {}));
  for (const doc of PROVIDABLE) {
    const p = typeof input.provided?.[doc.id] === 'string' ? input.provided[doc.id].trim() : '';
    if (!p) continue;
    if (!path.isAbsolute(p) || p.length > 1000) throw new Error(`${doc.label}: give the full path to the file (starting with /).`);
    if (!known.has(p) && !exists(p)) throw new Error(`${doc.label}: there’s no file at ${p}.`);
    out.provided[doc.id] = p;
    for (const s of doc.skips) if (!out.skip.includes(s)) out.skip.push(s);
  }
  if (input.reviewers === 'auto') out.reviewers = 'auto';
  else if (Array.isArray(input.reviewers)) out.reviewers = pick(input.reviewers, ids(REVIEWERS));
  if (Array.isArray(out.reviewers) && !out.reviewers.length && !out.skip.includes('review')) out.skip.push('review');
  if ([1, 2, 3].includes(Number(input.review_rounds))) out.review_rounds = Number(input.review_rounds);
  if (typeof input.manual_test === 'boolean') out.manual_test = input.manual_test;
  if (Array.isArray(input.fable_checks)) out.fable_checks = pick(input.fable_checks, ids(FABLE_POINTS));
  if (input.models && typeof input.models === 'object') {
    for (const role of ['foreman', 'build', 'checks']) {
      const id = input.models[role];
      if (id === undefined || id === null || id === '') continue;
      if (!modelAllowed(role, id)) throw new Error(`Models: “${String(id).slice(0, 60)}” isn’t a model the crew can use for ${role === 'checks' ? 'the checks' : role === 'build' ? 'the build' : 'the Foreman'}.`);
      out.models[role] = id;
    }
  } else if (previous && out.level === (isLevel(previous.level) ? previous.level : null) && previous.models && typeof previous.models === 'object') {
    // A page that doesn't edit models (the classic one) sent none and the level is unchanged:
    // keep the job's own models rather than resetting them to the level's defaults.
    for (const role of ['foreman', 'build', 'checks']) if (modelAllowed(role, previous.models[role])) out.models[role] = previous.models[role];
  }
  out.notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, 1000) : '';
  // Screens (wireframes) and Clarify questions: the job's own choice, else what it had, else the
  // default for new jobs (Settings → Workflow), else Auto.
  for (const k of ['wireframes', 'clarify']) out[k] = workflowChoice(input[k]) ?? workflowChoice(previous?.[k]) ?? workflowChoice(workflow?.[k]) ?? 'auto';
  out.skip = ids(SKIPPABLE).filter((s) => out.skip.includes(s)); // workflow order
  return out;
}

/**
 * A job's options moved to another level (the level chip in the header, the LevelCard, the gate
 * card's level chip): the new level's stages, reviewers and Fable points, keeping the documents
 * provided, the notes and the fix rounds. Manual test and each model are kept only when they are
 * the job's own choice, i.e. they differ from the OLD level's default; otherwise they follow the new
 * level (so L0→L1 brings L1's Opus build and your own testing, L1→L0 brings L0's Sonnet build).
 * Throws an Error with a plain message when something is off (as normalize does).
 * Documents provided earlier were checked then; only new paths must exist.
 */
export function optionsAtLevel(current, level, { exists = (p) => fs.existsSync(p) } = {}) {
  const before = current ?? defaultsFor('auto');
  const old = isLevel(before.level) ? defaultsForLevel(before.level) : defaultsFor(before.flow);
  const models = Object.fromEntries(['foreman', 'build', 'checks']
    .map((r) => [r, before.models?.[r]])
    .filter(([r, id]) => modelAllowed(r, id) && id !== old.models[r]));
  const ownTest = typeof before.manual_test === 'boolean' && before.manual_test !== old.manual_test;
  return normalize({
    level, provided: before.provided, notes: before.notes, review_rounds: before.review_rounds, models,
    ...(ownTest ? { manual_test: before.manual_test } : {}),
  }, { previous: before, exists });
}

/**
 * Which model the Foreman starts on: the one asked for (if it's one of `allowed`, the models
 * offered for the Foreman), else the job's models.foreman if that is one of them too, else Opus.
 * Never Fable just because the job is large or L3.
 */
export function foremanModel(requested, options, allowed = FOREMAN_MODEL_IDS) {
  if (allowed.includes(requested)) return requested;
  const fromOptions = options?.models?.foreman;
  return allowed.includes(fromOptions) ? fromOptions : OPUS;
}

/** A job's options.json, schema 1 or 2, filled out with the defaults for its level (or flow); null when there's none. */
export async function readOptions(dir) {
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(dir, 'options.json'), 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    const level = isLevel(raw.level) ? raw.level : levelFor(raw.flow);
    const base = isLevel(raw.level) ? defaultsForLevel(raw.level) : defaultsFor(raw.flow);
    return { ...base, ...raw, level, models: { ...base.models, ...(raw.models && typeof raw.models === 'object' ? raw.models : {}) } };
  } catch { return null; }
}

/**
 * Written as schema 2, with every schema 1 field still in it.
 * about: { title, repo, kind } of the job, kept so the page can show it before the Foreman writes its
 * record, and from_session ({ id, chain, mode, branch, cwd }) when the job started from a past conversation.
 * Returns the updated_at it wrote.
 */
export async function writeOptions(dir, options, about = {}) {
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'options.json');
  const tmp = `${file}.${process.pid}.tmp`;
  const keep = Object.fromEntries(Object.entries(about).filter(([k, v]) => (['title', 'repo', 'kind'].includes(k) && typeof v === 'string' && v) || (k === 'from_session' && v && typeof v === 'object')));
  const updatedAt = new Date().toISOString();
  await fsp.writeFile(tmp, `${JSON.stringify({ ...options, schema_version: SCHEMA_VERSION, ...keep, updated_at: updatedAt }, null, 2)}\n`);
  await fsp.rename(tmp, file);
  return updatedAt;
}

/** Stages not run for this job: by its route and by your options. */
export function skippedFor(route, options) {
  const out = new Set(route === 'small' ? ['refine'] : route === 'quick' ? FLOWS.quick.skip : []);
  for (const s of options?.skip ?? []) out.add(s);
  return [...out];
}

/** The options in a few plain lines, for the Foreman's first message and for the page. */
export function describeOptions(o) {
  const name = (list, id) => list.find((x) => x.id === id)?.label ?? id;
  const lines = [isLevel(o.level) ? `Level: ${levelLabel(o.level)} (${o.flow ?? flowFor(o.level)} flow).` : `Flow: ${FLOWS[o.flow]?.label ?? o.flow}.`];
  if (o.skip.length) lines.push(`Skip: ${o.skip.map((s) => name(SKIPPABLE, s)).join(', ')}.`);
  for (const [k, p] of Object.entries(o.provided ?? {})) lines.push(`${name(PROVIDABLE, k)} provided: ${p}`);
  lines.push(`Reviewers: ${o.skip.includes('review') ? 'none' : o.reviewers === 'auto' ? 'the usual ones for this kind of change' : o.reviewers.map((r) => name(REVIEWERS, r)).join(', ')}${o.skip.includes('review') ? '' : `, at most ${o.review_rounds} fix round${o.review_rounds === 1 ? '' : 's'}`}.`);
  if (o.manual_test) lines.push('The human tests it by hand on their computer before review.');
  lines.push(`Fable checks: ${o.fable_checks.length ? o.fable_checks.map((x) => name(FABLE_POINTS, x)).join(', ') : 'none'}.`);
  if (o.wireframes && o.wireframes !== 'auto') lines.push(`Screens (wireframes): ${o.wireframes === 'always' ? 'always, before the plan' : 'off'}.`);
  if (o.clarify && o.clarify !== 'auto') lines.push(`Clarify questions before the spec: ${o.clarify === 'always' ? 'always' : 'off'}.`);
  if (o.notes) lines.push(`Notes: ${o.notes}`);
  if (o.from_session) lines.push(o.from_session.mode === 'continue'
    ? `Started by continuing an earlier conversation (session ${o.from_session.id}): the earlier messages are background, not approvals.`
    : `Started from an earlier conversation (session ${o.from_session.id}): read history.md in the private folder first; it is background, not an approval.`);
  return lines;
}

/**
 * The levels as the page needs them (meta.levels): kept small. skip and reviewers are the level's
 * defaults, so the page can say what moving between levels adds ("L1→L2 adds: …"); so are
 * manualTest (you try it yourself) and fable (Fable second-look points).
 */
export function levelsForClient() {
  return LEVELS.map((l) => ({
    level: l.level, label: levelLabel(l.level), name: l.name, hint: l.hint, flow: l.flow, models: { ...l.models },
    skip: [...l.skip], reviewers: Array.isArray(l.reviewers) ? [...l.reviewers] : l.reviewers,
    manualTest: l.manualTest, fable: [...l.fable],
  }));
}

/**
 * The line an options change opens with in the job's conversation when it changed the level:
 * "Level changed from L2 Standard to L3 Large." (or "from none yet"). Null when the level stayed
 * the same, or the earlier level isn't known (`was` undefined: an audit line from before this).
 */
export function levelChangeLine(was, now) {
  if (was === undefined) return null;
  const before = isLevel(was) ? was : null;
  const after = isLevel(now) ? now : null;
  if (before === after) return null;
  return `Level changed from ${before === null ? 'none yet' : levelLabel(before)} to ${after === null ? 'none (the Foreman suggests one)' : levelLabel(after)}.`;
}
