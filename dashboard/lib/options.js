// A job's options: how much process it gets. Chosen when you start a job and changeable on its
// page: the flow (quick, small, large, or let the Foreman decide), stages to skip, documents you
// already have, which reviewers run, testing it yourself, and when Fable takes a second look.
// Kept as options.json in the job's private folder; the Foreman reads it before every stage
// (the workflow's job-options.md), so a change takes effect from the next stage.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const OPUS = 'claude-opus-5-5';
export const FABLE = 'claude-fable-5-1';

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
    label: 'Large', model: FABLE,
    note: 'Small plus a product interview (refine), with Fable as the Foreman for the whole job.',
    skip: [], reviewers: 'auto', fable: [], manualTest: false, // the Foreman is already Fable
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
const pick = (v, allowed) => [...new Set((Array.isArray(v) ? v : []).filter((x) => allowed.includes(x)))];

/** The defaults for a flow, as a full options object. */
export function defaultsFor(flow = 'auto') {
  const f = FLOWS[flow] ?? FLOWS.auto;
  return { schema_version: 1, flow: FLOWS[flow] ? flow : 'auto', skip: [...f.skip], provided: {}, reviewers: f.reviewers, review_rounds: 1, manual_test: f.manualTest, fable_checks: [...f.fable], notes: '' };
}

/**
 * Check and tidy options from the page. Throws an Error with a plain message when something is off.
 * exists(p): whether a provided document is there (injectable for tests).
 */
export function normalize(input = {}, { exists = (p) => fs.existsSync(p) } = {}) {
  const out = defaultsFor(input.flow);
  if (Array.isArray(input.skip)) out.skip = pick(input.skip, ids(SKIPPABLE));
  out.provided = {};
  for (const doc of PROVIDABLE) {
    const p = typeof input.provided?.[doc.id] === 'string' ? input.provided[doc.id].trim() : '';
    if (!p) continue;
    if (!path.isAbsolute(p) || p.length > 1000) throw new Error(`${doc.label}: give the full path to the file (starting with /).`);
    if (!exists(p)) throw new Error(`${doc.label}: there’s no file at ${p}.`);
    out.provided[doc.id] = p;
    for (const s of doc.skips) if (!out.skip.includes(s)) out.skip.push(s);
  }
  if (input.reviewers === 'auto') out.reviewers = 'auto';
  else if (Array.isArray(input.reviewers)) out.reviewers = pick(input.reviewers, ids(REVIEWERS));
  if (Array.isArray(out.reviewers) && !out.reviewers.length && !out.skip.includes('review')) out.skip.push('review');
  if ([1, 2].includes(Number(input.review_rounds))) out.review_rounds = Number(input.review_rounds);
  if (typeof input.manual_test === 'boolean') out.manual_test = input.manual_test;
  if (Array.isArray(input.fable_checks)) out.fable_checks = pick(input.fable_checks, ids(FABLE_POINTS));
  out.notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, 1000) : '';
  out.skip = ids(SKIPPABLE).filter((s) => out.skip.includes(s)); // workflow order
  return out;
}

export async function readOptions(dir) {
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(dir, 'options.json'), 'utf8'));
    return raw && typeof raw === 'object' ? { ...defaultsFor(raw.flow), ...raw } : null;
  } catch { return null; }
}

/**
 * about: { title, repo, kind } of the job, kept so the page can show it before the Foreman writes its
 * record, and from_session ({ id, chain, mode, branch, cwd }) when the job started from a past conversation.
 */
export async function writeOptions(dir, options, about = {}) {
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'options.json');
  const tmp = `${file}.${process.pid}.tmp`;
  const keep = Object.fromEntries(Object.entries(about).filter(([k, v]) => (['title', 'repo', 'kind'].includes(k) && typeof v === 'string' && v) || (k === 'from_session' && v && typeof v === 'object')));
  await fsp.writeFile(tmp, `${JSON.stringify({ ...options, ...keep, updated_at: new Date().toISOString() }, null, 2)}\n`);
  await fsp.rename(tmp, file);
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
  const lines = [`Flow: ${FLOWS[o.flow]?.label ?? o.flow}.`];
  if (o.skip.length) lines.push(`Skip: ${o.skip.map((s) => name(SKIPPABLE, s)).join(', ')}.`);
  for (const [k, p] of Object.entries(o.provided ?? {})) lines.push(`${name(PROVIDABLE, k)} provided: ${p}`);
  lines.push(`Reviewers: ${o.skip.includes('review') ? 'none' : o.reviewers === 'auto' ? 'the usual ones for this kind of change' : o.reviewers.map((r) => name(REVIEWERS, r)).join(', ')}${o.skip.includes('review') ? '' : `, at most ${o.review_rounds} fix round${o.review_rounds === 1 ? '' : 's'}`}.`);
  if (o.manual_test) lines.push('The human tests it by hand on their computer before review.');
  lines.push(`Fable checks: ${o.fable_checks.length ? o.fable_checks.map((x) => name(FABLE_POINTS, x)).join(', ') : 'none'}.`);
  if (o.notes) lines.push(`Notes: ${o.notes}`);
  if (o.from_session) lines.push(o.from_session.mode === 'continue'
    ? `Started by continuing an earlier conversation (session ${o.from_session.id}): the earlier messages are background, not approvals.`
    : `Started from an earlier conversation (session ${o.from_session.id}): read history.md in the private folder first; it is background, not an approval.`);
  return lines;
}
