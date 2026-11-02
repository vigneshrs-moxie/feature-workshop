// Team Telemetry's wire (packet 2E): what a laptop sends up about its usage, and the site's own check
// of it before anything is stored. Numbers only: never text, prompts, file or folder names.
//
//   POST /api/runner/usage  { app: [...], claudeCode: [...], readings: [...], counting }
//
//   app         one line of the app's usage log each, as the laptop's cleaned record has it
//               (dashboard/lib/insights.js cleanRecord: demo and test-folder lines gone, a resumed
//               session's cost taken by difference):
//               { id, t, job, stage, model, tokens, usd, meters: { week, fiveHour } }
//   claudeCode  one Claude Code reply outside the app each (packet U), when it is counted there:
//               { id, t, family, tokens, usd }
//   readings    the plan meters read on the laptop now and then, with no use of their own:
//               { id, t, meters: { week, fiveHour } }
//   counting    whether the laptop counts its Claude Code use outside the app: counted, off, reading
//               (its first read of the logs is under way) or not-sent (this laptop's app doesn't send it)
//
// id: the laptop's own hash of the line (24 hex characters), so a line sent twice is kept once.
// tokens: { input, output, cacheRead, cacheWrite5m, cacheWrite1h }, whole numbers. A meter:
// { percent, resetsAt } or null. Who it was is never on the wire: the site takes the laptop's person.
//
// The check is strict, field by field: a line with a field the site doesn't expect, or a text field
// that isn't the short name it should be (a job's slug, a stage's id, a model's id or family, a
// time), is refused whole and named in the answer; the rest of the batch is kept. Nothing is ever
// trimmed or cleaned up here and kept.

import { STAGE_IDS } from '../../dashboard/lib/stages.js';

export const COUNTING = Object.freeze(['counted', 'off', 'reading', 'not-sent']);
export const FAMILIES = Object.freeze(['opus', 'sonnet', 'haiku', 'fable', 'other']);
/** The most of each kind one batch may carry (and, with the 256 KB limit on the body, the most bytes). */
export const MAX_LINES = 2000;
/** How far back a line may be (older ones are left out on the site anyway). */
export const KEEP_DAYS = 100;
const DAY = 24 * 3600e3;

const ID = /^[0-9a-f]{24}$/;
// A job's slug: letters, digits, dots, dashes and underscores; no spaces, so no sentence fits.
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
// A model's id, as Claude Code names it (claude-opus-4-1-20250805, claude-sonnet-4-5[1m]): no spaces.
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'];
const STAGES = new Set(STAGE_IDS);

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

class Refused extends Error {}
const no = (why) => { throw new Refused(why); };

function onlyKeys(o, keys, what) {
  for (const k of Object.keys(o)) if (!keys.includes(k)) no(`${what} carried a field the site doesn’t expect (${String(k).slice(0, 40)}).`);
}
function time(v, { now, what }) {
  if (typeof v !== 'string' || !ISO.test(v) || !Number.isFinite(Date.parse(v))) no(`${what} must be a time, like 2026-10-30T16:00:00.000Z.`);
  return Date.parse(v);
}
function tokens(v) {
  if (!isPlain(v)) no('A line’s tokens must be the five counts.');
  onlyKeys(v, TOKEN_KEYS, 'A line’s tokens');
  const out = {};
  for (const k of TOKEN_KEYS) {
    const n = v[k] ?? 0;
    if (!Number.isInteger(n) || n < 0 || n > 1e10) no('A line’s token counts must be whole numbers.');
    out[k] = n;
  }
  return out;
}
function usd(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100_000) no('A line’s cost must be a number of dollars.');
  return v;
}
function meter(v, what) {
  if (v === null || v === undefined) return null;
  if (!isPlain(v)) no(`${what} must be a reading of the meter, or nothing.`);
  onlyKeys(v, ['percent', 'resetsAt'], what);
  if (typeof v.percent !== 'number' || !Number.isFinite(v.percent) || v.percent < 0 || v.percent > 1000) no(`${what}’s percent must be a number.`);
  let resetsAt = null;
  if (v.resetsAt !== null && v.resetsAt !== undefined) resetsAt = new Date(time(v.resetsAt, { what: `${what}’s reset` })).toISOString();
  return { percent: v.percent, resetsAt };
}
function meters(v) {
  if (v === null || v === undefined) return { week: null, fiveHour: null };
  if (!isPlain(v)) no('A line’s meters must be the weekly and the 5-hour reading.');
  onlyKeys(v, ['week', 'fiveHour'], 'A line’s meters');
  return { week: meter(v.week, 'The weekly meter'), fiveHour: meter(v.fiveHour, 'The 5-hour meter') };
}
function within(t, now) {
  if (t > now + 3600e3) no('A line is from the future: check the laptop’s clock.');
  if (t < now - KEEP_DAYS * DAY) no(`A line is older than ${KEEP_DAYS} days, so the site doesn’t keep it.`);
}
function id(v) {
  if (typeof v !== 'string' || !ID.test(v)) no('A line needs its own id (24 hex characters).');
  return v;
}

/** One app line, checked: the stored shape, or throws Refused. */
function appLine(raw, now) {
  if (!isPlain(raw)) no('A line must be a set of named fields.');
  onlyKeys(raw, ['id', 't', 'job', 'stage', 'model', 'tokens', 'usd', 'meters'], 'A line');
  const t = time(raw.t, { what: 'A line’s time' });
  within(t, now);
  const job = raw.job ?? null;
  if (job !== null && (typeof job !== 'string' || !SLUG.test(job))) no('A line’s job must be a job’s short name (its slug).');
  const stage = raw.stage ?? null;
  if (stage !== null && !STAGES.has(stage)) no('A line’s stage must be one of the stages’ names.');
  const model = raw.model ?? null;
  if (model !== null && (typeof model !== 'string' || !MODEL.test(model))) no('A line’s model must be a model’s name.');
  return { kind: 'app', id: id(raw.id), t, job, stage, model, tokens: tokens(raw.tokens ?? {}), usd: usd(raw.usd), meters: meters(raw.meters) };
}

/** One Claude Code reply outside the app, checked. */
function claudeCodeLine(raw, now) {
  if (!isPlain(raw)) no('A reply must be a set of named fields.');
  onlyKeys(raw, ['id', 't', 'family', 'tokens', 'usd'], 'A Claude Code reply');
  const t = time(raw.t, { what: 'A reply’s time' });
  within(t, now);
  if (!FAMILIES.includes(raw.family)) no('A reply’s model must be one of the model families.');
  return { kind: 'claude-code', id: id(raw.id), t, job: null, stage: null, model: raw.family, tokens: tokens(raw.tokens ?? {}), usd: usd(raw.usd), meters: { week: null, fiveHour: null } };
}

/** One reading of the meters, checked. */
function readingLine(raw, now) {
  if (!isPlain(raw)) no('A reading must be a set of named fields.');
  onlyKeys(raw, ['id', 't', 'meters'], 'A reading');
  const t = time(raw.t, { what: 'A reading’s time' });
  within(t, now);
  const m = meters(raw.meters);
  if (!m.week && !m.fiveHour) no('A reading must have at least one meter.');
  return { kind: 'reading', id: id(raw.id), t, job: null, stage: null, model: null, tokens: tokens({}), usd: 0, meters: m };
}

/**
 * The site's check of one batch. Returns { lines: [stored shape…], counting, refused: [{ kind, id,
 * error }] }, or throws a BatchError (the batch itself isn't one) in plain words.
 */
export class BatchError extends Error {}
export function checkUsageBatch(body, { now = Date.now() } = {}) {
  if (!isPlain(body)) throw new BatchError('Send { app, claudeCode, readings, counting }.');
  for (const k of Object.keys(body)) if (!['app', 'claudeCode', 'readings', 'counting'].includes(k)) throw new BatchError(`The batch carried a field the site doesn’t expect (${String(k).slice(0, 40)}).`);
  const counting = body.counting ?? 'not-sent';
  if (!COUNTING.includes(counting)) throw new BatchError('Say whether Claude Code use outside the app is counted: counted, off, reading or not-sent.');
  const lines = [];
  const refused = [];
  const kinds = [['app', body.app, appLine], ['claude-code', body.claudeCode, claudeCodeLine], ['reading', body.readings, readingLine]];
  for (const [kind, list, check] of kinds) {
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) throw new BatchError('Each kind of line must come as a list.');
    if (list.length > MAX_LINES) throw new BatchError(`At most ${MAX_LINES} lines of each kind in one batch.`);
    for (const raw of list) {
      try { lines.push(check(raw, now)); } catch (err) {
        if (!(err instanceof Refused)) throw err;
        refused.push({ kind, id: typeof raw?.id === 'string' && ID.test(raw.id) ? raw.id : null, error: err.message });
      }
    }
  }
  return { lines, counting, refused };
}
