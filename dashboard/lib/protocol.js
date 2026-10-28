// The one protocol between Ground Control's two halves (plan §2, §2.4): the runner (the machine
// half: Foremen, job folders, locks, git, Try it, usage, the Orbit token) and the site (the web
// half: pages, routes, the event streams). In local mode both run in one process; in hosted mode
// (v2) the site runs elsewhere and only this protocol crosses the network.
//
//   REMOTE_COMMANDS  everything a site may ever ask of a runner, with each one's fields
//   LOCAL_COMMANDS   what only the page on this computer may ask
//   parseCommand     checks one command against those lists: an unknown type, a local command from
//                    the site, a field the command doesn't take or a field of the wrong type is
//                    refused, in plain words
//   EVENT_TYPES      what a runner sends up
//   makeEvent        one event for the wire: known types only, every string scrubbed of tokens
//                    (lib/orbit.js scrubDeep), and never a diff, a patch, an environment, a token or
//                    source code (the "never carries" column of §2.4). A fetch-diff answer goes
//                    straight back to whoever asked and is never an event.
//
// Both lists are closed and frozen: adding a command is a change to this file and its test.

import { scrubDeep } from './orbit.js';

/** Bumped whenever a command, a field or an event changes shape. */
export const PROTOCOL_VERSION = 1;

/** The most a job's notes.md may hold (characters): the notes command's text, and meta.jobOptions.notesMax. */
export const NOTES_MAX = 20000;

// ---------- Field checks ----------

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isText = (max) => (v) => typeof v === 'string' && v.length <= max;

/** Each check: { ok(value), says } where `says` names what the value must be, for the refusal. */
const FIELD = {
  // A job's name as the routes take it: its folder's name, never a path.
  slug: { ok: (v) => typeof v === 'string' && v.length > 0 && v.length <= 300 && !/[/\\\0]/.test(v) && v !== '.' && v !== '..', says: 'a job name' },
  // A reply, a steered message or an edited reply: at most 20,000 characters.
  text: { ok: isText(20000), says: 'text of at most 20,000 characters' },
  // A note on a decision, a permission or a closed job.
  note: { ok: isText(4000), says: 'text of at most 4,000 characters' },
  // The brief a decision answers, or none.
  brief: { ok: (v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 99999), says: 'a brief number' },
  // A permission request's id, or a reply's (run) id.
  id: { ok: (v) => typeof v === 'string' && /^[\w-]{1,128}$/.test(v), says: 'an id' },
  bool: { ok: (v) => typeof v === 'boolean', says: 'true or false' },
  // Answers and verdicts by id (the gate card's; checked in full by the site before they are sent).
  record: { ok: (v) => v === null || isPlain(v), says: 'a set of answers by id' },
  list: { ok: (v) => Array.isArray(v), says: 'a list' },
  // A commit's id for the live diff.
  commit: { ok: (v) => typeof v === 'string' && /^[0-9a-fA-F]{4,40}$/.test(v), says: 'a commit id' },
  // A value the runner checks by its own rules (a job's options, a ticket, a setting): any JSON.
  json: { ok: (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v) || Array.isArray(v) || isPlain(v), says: 'a JSON value' },
};
const str = (max) => ({ ok: (v) => v === null || isText(max)(v), says: `text of at most ${max.toLocaleString('en')} characters` });
const oneOf = (...values) => ({ ok: (v) => values.includes(v), says: values.map((x) => `“${x}”`).join(' or ') });
const required = (check) => ({ ...check, required: true });

// The gate card's decision: the brief it answers, your answers, verdicts, next-step chips and note.
const GATE = {
  slug: required(FIELD.slug), briefNumber: FIELD.brief, note: FIELD.note, answers: FIELD.record, verdicts: FIELD.record,
  chips: FIELD.list, startAfterReset: FIELD.bool, model: str(100), despiteLimit: FIELD.bool, confirmNoTerminal: FIELD.bool,
};

const freeze = (lists) => Object.freeze(Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, Object.freeze(v)])));

/** Everything a site may ask of a runner (plan §2.4 "Site → runner"), and nothing else. */
export const REMOTE_COMMANDS = freeze({
  // A new job: what it is, where, and how it runs.
  start: {
    description: required(str(600)), repoPath: str(1000), options: FIELD.json, model: FIELD.json, kind: oneOf('feature', 'bug'),
    ticket: FIELD.json, fromSession: FIELD.json, despiteLimit: FIELD.bool,
  },
  // A message to the job's Foreman: from the message box (text), or the gate card's own message.
  reply: { ...GATE, via: oneOf('box', 'card'), text: FIELD.text, kind: str(20), gateBrief: FIELD.brief },
  // The gate card's three decisions. Only an approval may carry a reply you edited.
  approve: { ...GATE, text: FIELD.text },
  'send-back': GATE,
  stop: GATE,
  // A permission card: allow (once, or for the rest of this reply) or deny.
  allow: { requestId: required(FIELD.id), note: FIELD.note, answers: FIELD.record, scope: oneOf('once', 'run') },
  deny: { requestId: required(FIELD.id), note: FIELD.note, answers: FIELD.record },
  // Stop a reply in progress (it can be resumed).
  pause: { runId: required(FIELD.id) },
  // Drive a job from here that was last driven from a terminal.
  'take-over': { slug: required(FIELD.slug) },
  // The live diff of one commit (answered to the asker only, never an event).
  'fetch-diff': { slug: required(FIELD.slug), commit: required(FIELD.commit) },
});

/** What only the page on this computer may ask. */
export const LOCAL_COMMANDS = freeze({
  steer: { runId: required(FIELD.id), text: required(FIELD.text) },
  resume: { slug: required(FIELD.slug), via: oneOf('page', 'cli') },
  close: { slug: required(FIELD.slug), as: oneOf('done', 'dropped'), note: str(300), removeWorktree: FIELD.bool },
  reopen: { slug: required(FIELD.slug) },
  options: { slug: required(FIELD.slug), options: FIELD.json, level: FIELD.json, updated_at: FIELD.json },
  policy: { slug: required(FIELD.slug), policy: FIELD.json },
  notes: { slug: required(FIELD.slug), text: required({ ok: isText(NOTES_MAX), says: `text of at most ${NOTES_MAX.toLocaleString('en')} characters` }) },
  // The job page's "Try it on your computer" actions.
  'try-it': {
    slug: required(FIELD.slug), action: required(str(20)), preset: str(40), command: str(4000), where: oneOf('app', 'root'),
    what: str(20), name: str(20), db: str(20),
  },
  settings: { notify: FIELD.json, workflow: FIELD.json, play: FIELD.json, recheckAuto: FIELD.bool, policy: FIELD.json, autoResume: FIELD.bool },
  rules: { action: required(oneOf('add', 'remove')), rule: FIELD.json, permissionId: str(100), id: str(100) },
  nudge: { slug: required(FIELD.slug), nudge: required(str(100)), answer: required(oneOf('dismiss', 'yes')), model: str(100), despiteLimit: FIELD.bool, confirmNoTerminal: FIELD.bool },
  repo: { slug: required(FIELD.slug), repoPath: str(1000), branch: str(200) },
  'usage-resume': {},
});

const fieldsOf = (type) => (Object.hasOwn(REMOTE_COMMANDS, type) ? REMOTE_COMMANDS[type] : Object.hasOwn(LOCAL_COMMANDS, type) ? LOCAL_COMMANDS[type] : null);

/**
 * Check one command. from: 'site' (anything that may have come over the network: only
 * REMOTE_COMMANDS) or 'local' (the page on this computer: both lists).
 * Returns { ok: true, command } (a frozen copy) or { ok: false, error } in plain words.
 */
export function parseCommand(raw, { from = 'site' } = {}) {
  if (!isPlain(raw)) return { ok: false, error: 'A command must be a set of named fields.' };
  const { type } = raw;
  if (typeof type !== 'string' || !type) return { ok: false, error: 'A command must say what it is (its type).' };
  const fields = fieldsOf(type);
  if (!fields) return { ok: false, error: `There is no command called “${type.slice(0, 40)}”.` };
  if (from !== 'local' && !Object.hasOwn(REMOTE_COMMANDS, type)) return { ok: false, error: `“${type}” can only be done on this computer, not from the site.` };
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'type') continue;
    const check = Object.hasOwn(fields, key) ? fields[key] : null;
    if (!check) return { ok: false, error: `“${type}” doesn’t take “${key.slice(0, 40)}”.` };
    if (value === undefined) continue;
    if (!check.ok(value)) return { ok: false, error: `“${key}” of “${type}” must be ${check.says}.` };
  }
  for (const [key, check] of Object.entries(fields)) {
    if (check.required && raw[key] === undefined) return { ok: false, error: `“${type}” needs “${key}”.` };
  }
  const command = { type };
  for (const key of Object.keys(fields)) if (raw[key] !== undefined) command[key] = raw[key];
  return { ok: true, command: Object.freeze(command) };
}

// ---------- Events ----------

/**
 * What a runner sends up (plan §2.4 "Runner → site"): the job record (status, briefs and other
 * Foreman documents, gate and permission cards, evidence, costs and timing, branch and PR names,
 * the lock), a heartbeat, and the run and steer states the page gets today.
 */
export const EVENT_TYPES = Object.freeze([
  // §2.4
  'status', 'brief', 'document', 'gate', 'permission', 'evidence', 'cost', 'branch', 'pr', 'lock', 'heartbeat',
  // What the page's streams carry today (/api/events and ?v=2)
  'run', 'steer', 'permission-gone', 'change', 'thread', 'flow', 'notification', 'gate-stale', 'play', 'rules',
  'settings', 'usage', 'plan-usage', 'local', 'local-state', 'run-typical',
]);

/** Keys an event never carries, at any depth (§2.4 "Never carries"). */
export const NEVER_CARRIED = Object.freeze(['diff', 'patch', 'env', 'token', 'source']);

function carriedKey(value, depth = 0) {
  if (depth > 40) return '(too deep)';
  if (Array.isArray(value)) {
    for (const v of value) { const k = carriedKey(v, depth + 1); if (k) return k; }
    return null;
  }
  if (isPlain(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (NEVER_CARRIED.includes(k)) return k;
      const inner = carriedKey(v, depth + 1);
      if (inner) return inner;
    }
  }
  return null;
}

/**
 * One event for the wire. job: the job's slug when it is about one job.
 * Returns { ok: true, event: { v, type, job, data } } or { ok: false, error } in plain words.
 */
export function makeEvent(type, data = {}, { job = null } = {}) {
  if (!EVENT_TYPES.includes(type)) return { ok: false, error: `There is no event called “${String(type).slice(0, 40)}”.` };
  const key = carriedKey(data);
  if (key) return { ok: false, error: `An event never carries “${key}”: diffs, environments, tokens and source code stay on this computer.` };
  return { ok: true, event: { v: PROTOCOL_VERSION, type, job: job ?? null, data: scrubDeep(data ?? {}) } };
}
