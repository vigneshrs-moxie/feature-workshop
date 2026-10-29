// Reads status.json, the machine-readable summary the conductor writes after every brief
// (schema: ~/.claude/skills/feature/status-json.md). Two ways in:
//   parseStatusJson(text)  for display: lenient, as always. Unknown values become null with a
//                          warning, long text is cut, a fourth question is dropped.
//   validate(json, { ticketKey })  strict (plan D11): checks a file against status-schema.json
//                          and returns { ok, errors, warnings }. A wrong type, a value outside its
//                          list, a missing required field: errors (the driver sends them back to the
//                          Foreman's session to fix). A key the schema doesn't know, a limit the
//                          display cuts to: warnings.
// Versions: 1, and 2 = version 1 plus the ticket block { key, title, url, level }, required in 2.
// A job started from a ticket (its options.json names one: ticketKey) must write version 2 with
// that ticket's key. Version 1 files stay valid for every other job.
// A section of a stack (plan §6, lib/stack.js) names its stack (the parent job's folder name) and
// its section (its name in stack.md), both or neither, in either version. Any job's first brief may
// say the ticket looks big enough for a stack (stack_suggested: why, in one sentence).

import fs from 'node:fs';
import { STAGE_IDS } from './stages.js';

/** The JSON Schema for status.json (versions 1 and 2). */
export const STATUS_SCHEMA = JSON.parse(fs.readFileSync(new URL('./status-schema.json', import.meta.url), 'utf8'));
export const STATUS_VERSIONS = [1, 2];

export const STAGE_STATES = ['working', 'waiting_for_you', 'blocked', 'done'];
export const WAITING_FOR = ['approval', 'answers', 'permission'];
export const PR_STATES = ['not_started', 'open', 'changes_requested', 'approved', 'merged', 'closed'];

const str = (v) => (typeof v === 'string' && v.trim() ? v : null);
const arr = (v) => (Array.isArray(v) ? v : []);
// The Foreman's one-line reason for the level it suggests; longer text is cut, not refused.
export const LEVEL_REASON_MAX = 400;
// Why the first brief suggests a stack (stack_suggested), in one sentence: cut, not refused.
export const STACK_SUGGESTED_MAX = 400;
export const MAX_QUESTIONS = 3;
export const MAX_CLARIFY_QUESTIONS = 5;
// An option's consequence is one line (status-json.md says under 120 characters); longer text is cut.
export const CONSEQUENCE_MAX = 200;

// suggested_level (optional, schema 1): the level L0–L3 the Foreman proposes in its first brief.
// Missing or null is fine; anything but a whole number 0–3 becomes null with a warning.
function suggestedLevel(v, warnings) {
  if (v === null || v === undefined) return null;
  if (Number.isInteger(v) && v >= 0 && v <= 3) return v;
  warnings.push(`suggested_level: unexpected value "${String(v).slice(0, 40)}"; expected 0, 1, 2 or 3`);
  return null;
}

// predicted_paths (optional): the files the Foreman expects its change to touch, written with
// suggested_level so the level rules can run on them before anything is built. Strings only, at
// most 50, each cut to 300 characters.
function predictedPaths(v, warnings) {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) { warnings.push('predicted_paths: expected a list of file paths'); return []; }
  return v.filter((p) => typeof p === 'string' && p.trim()).slice(0, 50).map((p) => p.trim().slice(0, 300));
}

function oneOf(value, allowed, field, warnings) {
  if (value === null || value === undefined) return null;
  if (allowed.includes(value)) return value;
  warnings.push(`${field}: unexpected value "${value}"`);
  return null;
}

export function parseStatusJson(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, warnings: [`status.json is not valid JSON: ${err.message}`] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, warnings: ['status.json is not an object'] };
  }
  const warnings = [];
  if (!STATUS_VERSIONS.includes(raw.schema_version)) warnings.push(`schema_version ${raw.schema_version ?? 'missing'}; expected 1 or 2`);
  else if (raw.schema_version === 2 && !(raw.ticket && typeof raw.ticket === 'object')) warnings.push('schema_version 2 without its ticket block');

  // At most three questions per brief; a clarify brief (the questions before the spec) may ask five.
  // Each option may carry a consequence: one line on what changes if it is picked.
  const questions = arr(raw.questions).slice(0, raw.stage === 'clarify' ? MAX_CLARIFY_QUESTIONS : MAX_QUESTIONS).map((q, i) => {
    const options = arr(q?.options)
      .map((o) => ({ id: String(o?.id ?? ''), label: str(o?.label) ?? String(o?.id ?? ''), consequence: str(o?.consequence)?.slice(0, CONSEQUENCE_MAX) ?? null }))
      .filter((o) => o.id);
    return {
      id: String(q?.id ?? i + 1),
      text: str(q?.text) ?? '',
      recommendation: q?.recommendation != null ? String(q.recommendation) : null,
      options,
    };
  });

  const prs = [1, 2, 3].map((n) => {
    const p = arr(raw.prs).find((x) => Number(x?.number) === n) || {};
    return {
      number: n,
      label: str(p.label),
      url: /^https:\/\/github\.com\//.test(p.url ?? '') ? p.url : null,
      state: oneOf(p.state ?? 'not_started', PR_STATES, `prs[${n}].state`, warnings),
    };
  });

  return {
    ok: true,
    warnings,
    slug: str(raw.slug),
    title: str(raw.title),
    route: oneOf(raw.route, ['quick', 'small', 'large'], 'route', warnings),
    kind: oneOf(raw.kind ?? null, ['feature', 'bug'], 'kind', warnings),
    stage: oneOf(raw.stage, STAGE_IDS, 'stage', warnings),
    stageState: oneOf(raw.stage_state, STAGE_STATES, 'stage_state', warnings),
    waitingFor: oneOf(raw.waiting_for, WAITING_FOR, 'waiting_for', warnings),
    waitingSince: str(raw.waiting_since),
    brief: raw.brief && typeof raw.brief === 'object'
      ? { number: Number(raw.brief.number) || null, path: str(raw.brief.path), headline: str(raw.brief.headline) }
      : null,
    questions,
    decidedOnYourBehalf: arr(raw.decided_on_your_behalf).map((d) => ({
      id: str(d?.id),
      decision: str(d?.decision) ?? '',
      reason: str(d?.reason),
      where: str(d?.where),
      confirmed: d?.confirmed === true,
    })),
    nextProposed: str(raw.next_proposed),
    spec: raw.spec && typeof raw.spec === 'object'
      ? { path: str(raw.spec.path), version: raw.spec.version != null ? String(raw.spec.version) : null, status: str(raw.spec.status) }
      : null,
    artifacts: arr(raw.artifacts).map((a) => ({
      name: str(a?.name) ?? '',
      path: str(a?.path),
      version: a?.version != null ? String(a.version) : null,
      basedOn: str(a?.based_on),
    })),
    repo: raw.repo && typeof raw.repo === 'object' ? { path: str(raw.repo.path), baseBranch: str(raw.repo.base_branch) } : null,
    branch: str(raw.branch),
    worktree: str(raw.worktree),
    baseSha: str(raw.base_sha),
    prs,
    sessionId: str(raw.session_id),
    cwd: str(raw.cwd),
    updatedAt: str(raw.updated_at),
    suggestedLevel: suggestedLevel(raw.suggested_level, warnings),
    predictedPaths: predictedPaths(raw.predicted_paths, warnings),
    levelReason: str(raw.level_reason)?.trim().slice(0, LEVEL_REASON_MAX) ?? null,
    ticket: ticketBlock(raw.ticket),
    stack: str(raw.stack),
    section: str(raw.section),
    // The first brief thinks the ticket is big enough for a stack: why, in one sentence (the Job page
    // offers "Run as a stack instead"). Longer text is cut, not refused.
    stackSuggested: str(raw.stack_suggested)?.trim().slice(0, STACK_SUGGESTED_MAX) ?? null,
  };
}

// The ticket block (schema 2): { key: ORBIT-<n>, title, url, level: L0–L3 }; null when absent or keyless.
const TICKET_KEY = /^ORBIT-[1-9]\d{0,8}$/;
function ticketBlock(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const key = typeof t.key === 'string' ? t.key.trim().toUpperCase() : '';
  if (!TICKET_KEY.test(key)) return null;
  return {
    key,
    title: str(t.title)?.slice(0, 300) ?? null,
    url: /^https:\/\//.test(t.url ?? '') ? t.url : null,
    level: ['L0', 'L1', 'L2', 'L3'].includes(t.level) ? t.level : null,
  };
}

// ---------- validate(): the strict check (plan D11) ----------

// Error lists are cut here: the Foreman is told the first ones, and the audit line stays small.
export const MAX_ERRORS = 30;

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const typeFits = (v, t) => t === typeOf(v) || (t === 'number' && typeof v === 'number' && Number.isFinite(v));
const TYPE_WORDS = { string: 'text', integer: 'a whole number', number: 'a number', boolean: 'true or false', object: 'an object', array: 'a list', null: 'null' };
const orList = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`);
const shown = (v) => { const s = typeof v === 'string' ? `"${v}"` : JSON.stringify(v); return s.length > 60 ? `${s.slice(0, 57)}…` : s; };
const got = (v) => (v === null ? 'null' : `${TYPE_WORDS[typeOf(v)] ?? typeof v} ${shown(v)}`);
const at = (where, key) => (where ? `${where}.${key}` : key);

/**
 * One value against one schema node. Supported keywords (all status-schema.json uses): type, enum,
 * const, minimum, maximum, pattern (its description names the form), required, properties, items,
 * allOf, if/then. Unknown keys are
 * warned about on the main pass only (not inside allOf or if/then, which name a few properties).
 */
function check(value, schema, where, out, main = true) {
  const label = where || 'status.json';
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => typeFits(value, t))) { out.errors.push(`${label}: expected ${orList(types.map((t) => TYPE_WORDS[t] ?? t))}, got ${got(value)}`); return; }
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) { out.errors.push(`${label}: expected ${shown(schema.const)}, got ${got(value)}`); return; }
  if (schema.enum && !schema.enum.includes(value)) {
    const named = schema.enum.filter((x) => x !== null).map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
    out.errors.push(`${label}: ${shown(value)} is not one of ${named.join(', ')}${schema.enum.includes(null) ? ' (or null)' : ''}`);
    return;
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) out.errors.push(`${label}: ${value} is below ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) out.errors.push(`${label}: ${value} is above ${schema.maximum}`);
  }
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) out.errors.push(`${label}: ${shown(value)} is not ${schema.description ?? 'in the expected form'}`);
  if (typeOf(value) === 'object') {
    for (const k of schema.required ?? []) if (!Object.hasOwn(value, k)) out.errors.push(`${at(where, k)}: missing (it is required)`);
    if (schema.properties) {
      for (const [k, v] of Object.entries(value)) {
        if (schema.properties[k]) check(v, schema.properties[k], at(where, k), out, main);
        else if (main) out.warnings.push(`${at(where, k)}: not in the schema, so the dashboard ignores it`);
      }
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((x, i) => check(x, schema.items, `${label}[${i}]`, out, main));
  for (const s of schema.allOf ?? []) check(value, s, where, out, false);
  if (schema.if) {
    const probe = { errors: [], warnings: [] };
    check(value, schema.if, where, probe, false);
    if (!probe.errors.length && schema.then) check(value, schema.then, where, out, false);
  }
}

/**
 * Check a status.json (its text, or the parsed object) against the schema. ticketKey: the ORBIT-<n>
 * the job was started from (its options.json), or null; such a job must write version 2 with that
 * key in its ticket block. Returns { ok, errors: [plain lines], warnings: [plain lines] }.
 */
export function validate(json, { ticketKey = null } = {}) {
  let raw = json;
  if (typeof json === 'string') {
    try { raw = JSON.parse(json); } catch (err) { return { ok: false, errors: [`status.json is not valid JSON: ${err.message}`], warnings: [] }; }
  }
  const out = { errors: [], warnings: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: [`status.json: expected an object, got ${got(raw ?? null)}`], warnings: [] };
  check(raw, STATUS_SCHEMA, '', out);

  // What the schema can't say: the job's own ticket, and the limits the display cuts to.
  const key = typeof ticketKey === 'string' && TICKET_KEY.test(ticketKey.trim().toUpperCase()) ? ticketKey.trim().toUpperCase() : null;
  if (key && raw.schema_version === 1) out.errors.push(`schema_version: this job was started from ${key}, so write schema_version 2 with the ticket block { key, title, url, level }`);
  if (key && raw.ticket && typeof raw.ticket === 'object' && typeof raw.ticket.key === 'string' && raw.ticket.key !== key) out.errors.push(`ticket.key: ${shown(raw.ticket.key)}, but this job is on ${key}`);
  if (raw.schema_version === 1 && raw.ticket != null) out.warnings.push('ticket: read only in schema_version 2');
  const questions = Array.isArray(raw.questions) ? raw.questions.length : 0;
  const most = raw.stage === 'clarify' ? MAX_CLARIFY_QUESTIONS : MAX_QUESTIONS;
  if (questions > most) out.warnings.push(`questions: ${questions}; only the first ${most} are shown`);
  if (typeof raw.level_reason === 'string' && raw.level_reason.length > LEVEL_REASON_MAX) out.warnings.push(`level_reason: longer than ${LEVEL_REASON_MAX} characters; it is cut`);
  (Array.isArray(raw.prs) ? raw.prs : []).forEach((p, i) => {
    if (typeof p?.url === 'string' && !/^https:\/\/github\.com\//.test(p.url)) out.warnings.push(`prs[${i}].url: only https://github.com/ links are shown`);
  });

  const errors = out.errors.length > MAX_ERRORS ? [...out.errors.slice(0, MAX_ERRORS), `…and ${out.errors.length - MAX_ERRORS} more`] : out.errors;
  return { ok: errors.length === 0, errors, warnings: out.warnings.slice(0, MAX_ERRORS) };
}

/** The lenient reader under the name the plan uses. */
export const parse = parseStatusJson;
