// A job's "Your decisions" log: every choice you made on it, newest first, read from its audit
// lines. Approvals, changes asked for and stops sent from a gate; permissions allowed or refused;
// level and option changes; the job's own permission setting; closing and reopening; nudges taken
// or dismissed. Plain messages, steers and anything the workshop did by itself are left out.
// Pure: no files, no clock. (decisions.md, below, is the one part that reads and writes files:
// writeDecisionsFile.)

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PRODUCT } from './state.js';

const firstLine = (text, max = 160) => {
  const line = String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

const SEND = {
  approve: (e) => ({ kind: 'approve', text: Number.isInteger(e.gateBrief) ? `Approved brief ${e.gateBrief}` : 'Approved' }),
  changes: (e) => ({ kind: 'changes', text: `Sent back${Number.isInteger(e.gateBrief) ? ` brief ${e.gateBrief}` : ''} for changes`, note: firstLine(e.text) }),
  stop: () => ({ kind: 'stop', text: 'Stopped the job' }),
};

/** One entry for an audit line that records a decision of yours, else null. */
export function decisionOf(e) {
  if (!e || typeof e !== 'object') return null;
  const at = e.at ?? null;
  let d = null;
  if (e.action === 'send' && SEND[e.kind]) d = SEND[e.kind](e);
  else if (e.action === 'permission') d = { kind: e.decision === 'deny' ? 'deny' : 'allow', text: `${e.decision === 'deny' ? 'Said no to' : 'Allowed'}: ${e.headline ?? e.tool ?? 'a step'}`, note: e.note ? firstLine(e.note) : undefined };
  else if (e.action === 'options') {
    const level = e.options?.level;
    d = Number.isInteger(level) && level !== e.was ? { kind: 'level', text: `Level ${Number.isInteger(e.was) ? `L${e.was} → ` : ''}L${level}${e.via === 'gate' ? ' (from a gate)' : ''}${e.overrode === 'auto' ? ' (you changed the automatic pick)' : ''}` } : { kind: 'options', text: 'Changed the job’s options' };
  } else if (e.action === 'auto-level') d = { kind: 'level', text: `Level ${Number.isInteger(e.was) ? `L${e.was} → ` : ''}L${e.level} (automatic${e.how === 'diff' ? ', after a build' : ''})` };
  else if (e.action === 'job-policy') d = { kind: 'policy', text: e.policy ? `Permissions set to ${e.policy}` : 'Permissions back to your global setting' };
  else if (e.action === 'close') d = { kind: 'close', text: e.as === 'dropped' ? 'Dropped the job' : 'Marked the job done', note: e.note ? firstLine(e.note) : undefined };
  else if (e.action === 'reopen') d = { kind: 'reopen', text: 'Reopened the job' };
  else if (e.action === 'nudge') d = { kind: 'nudge', text: `Said yes: ${firstLine(e.text, 100)}` };
  else if (e.action === 'nudge-dismissed') d = { kind: 'nudge', text: 'Dismissed a suggestion' };
  if (!d) return null;
  if (!d.note) delete d.note;
  return { at, ...d };
}

/** The log, newest first. */
export function decisionLog(audit = []) {
  return audit.map(decisionOf).filter(Boolean).sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
}

// ---------- decisions.md: the job's decision file (plan §8) ----------
// One plain file in the job folder, for engineers and agents: a table of the decisions made on the
// job (id, question, options, choice, who, when, why), the Foreman's own rows, and a "Not doing"
// list. The rows made from the audit are written again after every gate; the Foreman's rows and
// the "Not doing" list are kept as they are.

/**
 * What every decision id starts with: the job's ticket key ("ORBIT-479") when it has one, from
 * status.json's ticket.key, else from a slug that starts "orbit-<n>-"; otherwise the slug.
 */
export function decisionPrefix({ slug = '', ticketKey = null } = {}) {
  const key = String(ticketKey ?? '').trim();
  if (/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(key)) return key.toUpperCase();
  const m = /^orbit-(\d+)(?:-|$)/i.exec(String(slug));
  if (m) return `ORBIT-${Number(m[1])}`;
  return String(slug || 'job');
}

/** The k-th decision's id (k from 1, in audit order): "ORBIT-479.D3". */
export const decisionId = (prefix, k) => `${prefix}.D${k}`;

const GATE_KINDS = ['approve', 'changes', 'stop'];
const GATE_CHOICE = { approve: 'approve', changes: 'send back', stop: 'stop' };
const PERMISSION_CHOICE = { allow: 'allow', 'allow-run': 'allow for this reply', deny: 'say no' };
// The fixed sentences a gate reply's own words follow (lib/compose.js composeReply).
const GATE_ANCHOR = { approve: /^I approve\./, changes: /^Please make changes before moving on/, stop: /^Stop here\./ };
const HEAD_LINE = /^(My answers to |\d+\.\s.*\s→\s|Decided on my behalf|Not confirmed yet|Option change for the next step:|At these versions:)/;

const oneLine = (s, max = 200) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The note typed on the gate card, read back out of the reply it was composed into ('' when none). */
export function gateNote(kind, text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim());
  const at = lines.findIndex((l) => GATE_ANCHOR[kind]?.test(l));
  // A reply you edited before sending: its first line of your own words.
  if (at < 0) return oneLine(lines.find((l) => l && !HEAD_LINE.test(l)) ?? '');
  const own = lines.slice(at + 1).filter((l) => l && !/^At these versions:/.test(l) && l !== '(describe the changes)');
  return oneLine(own.join(' '));
}

/** The answers in a gate reply ("My answers to brief 3:" then "1. question → b) choice"). */
export function gateAnswers(text) {
  const out = [];
  let inside = false;
  for (const l of String(text ?? '').split('\n').map((x) => x.trim())) {
    if (/^My answers to /.test(l)) { inside = true; continue; }
    if (!inside) continue;
    const m = /^\d+\.\s+(.+?)\s+→\s+(.+)$/.exec(l);
    if (!m) break;
    out.push({ question: m[1], choice: m[2].replace(/^[a-z0-9]{1,3}\)\s+/i, '') });
  }
  return out;
}

const day = (at) => (typeof at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : '');

function briefQuestion(e, briefs) {
  const n = Number.isInteger(e.gateBrief) && e.gateBrief > 0 ? e.gateBrief : null;
  if (!n) return 'The Foreman’s latest brief: go ahead?';
  const name = briefs?.[n];
  return `Brief ${n}${name ? ` (${name})` : ''}: go ahead?`;
}

/**
 * The decisions in a job's audit lines (oldest first), as rows for decisions.md, each with its id.
 * Gate decisions (approve, send back, stop) and the answers given with them; level changes;
 * questions answered; permissions allowed or refused with a reason. Anything else is left out.
 * person: the name in the "who" column. briefs: { [number]: short name } for the gate's question.
 * after: how many decisions come before these (a stack's sections are numbered on from the
 * parent's own: the first section row after five of the parent's is D6).
 */
export function decisionRows(audit = [], { prefix = 'job', person = 'You', briefs = {}, after = 0 } = {}) {
  const rows = [];
  const add = (e, r) => rows.push({ id: decisionId(prefix, after + rows.length + 1), who: person, when: day(e.at), options: '', why: '', ...r });
  for (const e of audit) {
    if (!e || typeof e !== 'object') continue;
    if (e.action === 'send' && GATE_KINDS.includes(e.kind)) {
      for (const a of gateAnswers(e.text)) add(e, { question: a.question, choice: a.choice });
      add(e, { question: briefQuestion(e, briefs), options: 'approve · send back · stop', choice: GATE_CHOICE[e.kind], why: gateNote(e.kind, e.text) });
    } else if (e.action === 'options') {
      const level = e.options?.level;
      if (!Number.isInteger(level) || level === e.was) continue;
      const why = [Number.isInteger(e.was) ? `was L${e.was}` : '', e.overrode === 'auto' ? 'over the automatic pick' : '', e.via === 'gate' ? 'from a gate' : ''].filter(Boolean).join(', ');
      add(e, { question: 'Level for this job', options: 'L0 · L1 · L2 · L3', choice: `L${level}`, why });
    } else if (e.action === 'permission') {
      const answers = e.answers && typeof e.answers === 'object' ? Object.entries(e.answers) : [];
      if (answers.length) for (const [q, label] of answers) add(e, { question: oneLine(q), choice: oneLine(label), why: oneLine(e.note) });
      else if (oneLine(e.note) && PERMISSION_CHOICE[e.decision]) add(e, { question: `Allow “${oneLine(e.headline ?? e.tool ?? 'a step', 120)}”?`, options: 'allow · allow for this reply · say no', choice: PERMISSION_CHOICE[e.decision], why: oneLine(e.note) });
    }
  }
  return rows;
}

export const DECISIONS_FILE = 'decisions.md';
const FOREMAN_MARK = /<!--\s*foreman\s*-->\s*$/i;
const NOT_DOING = /^##\s+Not doing\s*$/i;
const SECTION = /^##\s+Section:\s*(.+?)\s*$/;
const HEADER = ['| id | question | options | choice | who | when | why |', '|---|---|---|---|---|---|---|'];
const NOTE = '<!-- Written from the job’s record after every gate. Rows that end in a foreman mark, and the Not doing list, are kept as they are; the other rows are written again each time. -->';

// One table cell: on one line, pipes escaped, not too long.
const cell = (s) => oneLine(s).replace(/\|/g, '\\|');

/**
 * What a decisions.md keeps when it is written again: the Foreman's rows (lines ending in
 * <!-- foreman -->), each with the "## Section:" it sits under (null for the main table), and the
 * "## Not doing" list's lines, verbatim. A Foreman row written below "## Not doing" moves up to the
 * main table; the list itself ends at the next "## " heading.
 */
export function keptParts(text) {
  const foreman = [];
  let notDoing = null;
  let section = null;
  let inNot = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (NOT_DOING.test(line)) { inNot = true; notDoing ??= []; continue; }
    if (/^##\s/.test(line)) { inNot = false; section = SECTION.exec(line)?.[1] ?? null; continue; }
    if (inNot && !(line.startsWith('|') && FOREMAN_MARK.test(line))) { notDoing.push(line); continue; }
    if (FOREMAN_MARK.test(line)) foreman.push({ section: inNot ? null : section, line });
  }
  if (notDoing) {
    while (notDoing.length && !notDoing[0].trim()) notDoing.shift();
    while (notDoing.length && !notDoing.at(-1).trim()) notDoing.pop();
  }
  return { foreman, notDoing: notDoing ?? [] };
}

/**
 * The text of decisions.md (plan §8): a title, the table (the rows made from the audit, then the
 * Foreman's own rows), a "## Section: <name>" part for each section, and "## Not doing" at the end.
 * existing: the file as it is now; its Foreman rows and its Not doing list are kept verbatim.
 * Everything else in it is written again.
 * sections: a stack's sections in its plan's order (plan G27), [{ name, rows, notDoing }]: each
 * gets its heading with the decisions made on that section's job (rows, numbered on from the
 * parent's), then the Foreman's own rows under that heading; its Not doing lines join the one list
 * at the end. Sections the Foreman's rows name that aren't in the list follow, as before.
 */
export function render({ prefix = 'job', title = null, rows = [], existing = '', sections = [] } = {}) {
  const { foreman, notDoing } = keptParts(existing);
  const head = title && oneLine(title) !== prefix ? `# ${prefix} · ${oneLine(title, 120)}` : `# ${prefix}`;
  const out = [head, '', NOTE, '', ...HEADER];
  const line = (r) => `| ${[r.id, r.question, r.options, r.choice, r.who, r.when, r.why].map(cell).join(' | ')} |`;
  for (const r of rows) out.push(line(r));
  out.push(...foreman.filter((f) => f.section === null).map((f) => f.line));
  const named = sections.map((x) => x.name);
  const order = [...named, ...new Set(foreman.map((f) => f.section).filter((x) => x !== null && !named.includes(x)))];
  for (const name of order) {
    const sec = sections.find((x) => x.name === name);
    const own = foreman.filter((f) => f.section === name).map((f) => f.line);
    out.push('', `## Section: ${name}`);
    if (sec?.rows?.length || own.length) out.push(...(sec?.rows ?? []).map(line), ...own);
    else out.push('No decisions yet.');
  }
  const not = [...notDoing];
  for (const sec of sections) for (const l of sec.notDoing ?? []) if (l.trim() && !not.includes(l)) not.push(l);
  out.push('', '## Not doing', ...not, '');
  return out.join('\n');
}

// The name in the "who" column: git's user.name, else the login name. Asked once.
let personAsked = null;
export function personName() {
  personAsked ??= new Promise((resolve) => {
    const fallback = () => { try { return os.userInfo().username || 'You'; } catch { return 'You'; } };
    execFile('git', ['config', '--get', 'user.name'], { timeout: 3000 }, (err, out) => resolve((!err && String(out).trim()) || fallback()));
  });
  return personAsked;
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

// The briefs' short names by number, from their file names (briefs/003-plan.md → { 3: 'plan' }).
async function briefNames(dir) {
  const out = {};
  let names = [];
  try { names = await fs.readdir(path.join(dir, 'briefs')); } catch { return out; }
  for (const n of names.sort()) {
    const m = /^(\d+)-(.+)\.md$/.exec(n);
    if (m && !/(^|-)detail$/.test(m[2])) out[Number(m[1])] ??= m[2].replace(/[-_]+/g, ' ').trim();
  }
  return out;
}

const defaultAuditFile = () => path.join(process.env.WORKSHOP_STATE_DIR || path.join(os.homedir(), '.feature-workshop'), 'audit.jsonl');
async function auditOf(jobDir, file) {
  let text = '';
  try { text = await fs.readFile(file, 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e?.featureDir === jobDir);
}

// Writes to one job's file go one after another.
const writing = new Map();

/**
 * Write the job's decisions.md again: the rows from its audit lines, plus what the file keeps (its
 * Foreman rows and Not doing list). Only into a job folder that exists, and never through a link or
 * over anything but a plain file. Written to a temp file and renamed over, and only when the text
 * changed. Returns { file, text, changed }, or null when there is no folder to write in.
 * audit: the job's audit lines, oldest first (read from auditFile, the dashboard's audit.jsonl,
 * when not given). slug, title, ticketKey: from the folder's name and status.json when not given.
 * person: the "who" (git's user.name when not given). auditFor(dir): another way to read a job
 * folder's audit lines (the runner's own, for a stack's sections).
 * A stack's parent (its folder has stack.json) also gathers each section's decisions under its
 * "## Section: <name>" heading, numbered on in the parent's ticket (ORBIT-512.D7), with one
 * "## Not doing" at the end (plan §8, G27).
 */
export function writeDecisionsFile(jobDir, opts = {}) {
  const after = writing.get(jobDir) ?? Promise.resolve();
  const mine = after.catch(() => {}).then(() => writeNow(jobDir, opts));
  writing.set(jobDir, mine);
  mine.finally(() => { if (writing.get(jobDir) === mine) writing.delete(jobDir); }).catch(() => {});
  return mine;
}

// A stack's parent (its folder holds the runner's stack.json, lib/stack.js): each section's own
// decisions, in the plan's order, from its job folder beside the parent's (<parent>--<section>).
// auditFor(dir): that folder's audit lines; null reads them from auditFile.
async function sectionParts(jobDir, { prefix, person, after, auditFor, auditFile }) {
  const stack = await readJson(path.join(jobDir, 'stack.json'));
  if (!stack || !Array.isArray(stack.sections)) return [];
  const out = [];
  let count = after;
  for (const sec of stack.sections) {
    if (typeof sec?.name !== 'string') continue;
    const slug = typeof sec.slug === 'string' && !/[\\/]/.test(sec.slug) && !sec.slug.startsWith('.') ? sec.slug : null;
    const dir = slug ? path.join(path.dirname(jobDir), slug) : null;
    let audit = [];
    let notDoing = [];
    if (dir) {
      audit = auditFor ? await auditFor(dir) : await auditOf(dir, auditFile);
      const own = await fs.readFile(path.join(dir, DECISIONS_FILE), 'utf8').catch(() => '');
      notDoing = keptParts(own).notDoing;
    }
    const rows = decisionRows(audit ?? [], { prefix, person, briefs: dir ? await briefNames(dir) : {}, after: count });
    count += rows.length;
    out.push({ name: sec.name, rows, notDoing });
  }
  return out;
}

async function writeNow(jobDir, { audit = null, auditFile = defaultAuditFile(), auditFor = null, slug = null, title = null, ticketKey = null, person = null } = {}) {
  const dirStat = await fs.lstat(jobDir).catch(() => null);
  if (!dirStat?.isDirectory()) return null;
  const file = path.join(jobDir, DECISIONS_FILE);
  const fileStat = await fs.lstat(file).catch(() => null);
  if (fileStat && !fileStat.isFile()) return null;
  const status = await readJson(path.join(jobDir, 'status.json'));
  const prefix = decisionPrefix({ slug: slug ?? path.basename(jobDir), ticketKey: ticketKey ?? status?.ticket?.key ?? null });
  const who = person ?? (await personName());
  const rows = decisionRows(audit ?? (auditFor ? await auditFor(jobDir) : await auditOf(jobDir, auditFile)), { prefix, person: who, briefs: await briefNames(jobDir) });
  const sections = await sectionParts(jobDir, { prefix, person: who, after: rows.length, auditFor, auditFile });
  const existing = fileStat ? await fs.readFile(file, 'utf8') : '';
  const text = render({ prefix, title: title ?? status?.title ?? null, rows, existing, sections });
  if (text === existing) return { file, text, changed: false };
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.writeFile(tmp, text, { mode: 0o600 });
  await fs.rename(tmp, file);
  return { file, text, changed: true };
}

/** The most lines "Copy for the ticket" gives. */
export const TICKET_LINES = 40;

/**
 * decisions.md as plain text for a ticket ("Copy for the ticket"): the title, the table with its
 * pipes, the sections and the Not doing list, without the file's notes to agents (HTML comments,
 * the foreman marks). At most `max` lines: a longer file gives its last `max` lines, and cut says so.
 * Returns { text, lines, total, cut }.
 */
export function ticketCopy(markdown, max = TICKET_LINES) {
  const all = [];
  for (const raw of String(markdown ?? '').split(/\r?\n/)) {
    if (/^\s*<!--[\s\S]*-->\s*$/.test(raw)) continue;
    const line = raw.replace(FOREMAN_MARK, '').replace(/\s+$/, '');
    if (!line && !all.at(-1)) continue; // one blank line at a time, none first
    all.push(line);
  }
  while (all.length && !all.at(-1)) all.pop();
  const cut = all.length > max;
  const kept = cut ? all.slice(-max) : all;
  while (kept.length && !kept[0]) kept.shift();
  return { text: kept.join('\n'), lines: kept.length, total: all.length, cut };
}

// ---------- The repository copy (plan G21, G22, G27) ----------
// At the ship stage the job's decisions.md is copied into the repository's tracked docs/decisions/
// folder on the feature branch (docs/decisions/ORBIT-0479-feedback-api.md), and the folder's index,
// docs/decisions/README.md, is rebuilt beside it, so both ride PR #1. Only a job with a ticket gets
// a file there.

const KEY = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;

// Lowercase words from a title, accents dropped, anything that isn't a letter or digit a gap.
const words = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * The file a job's decisions get in the repository: "ORBIT-0479-feedback-api.md". The ticket
 * key's number zero-padded to four digits (so the files sort), then a short slug from the ticket's
 * title: lowercase, words joined by "-", at most 6 words, the ticket's number not repeated. With no
 * title, the job's slug gives the words (orbit-479-feedback-api → feedback-api). No ticket (or a
 * key that isn't one, like "job"): null, since a job without a ticket isn't written into the repo.
 */
export function repoFileName({ ticketKey = null, title = null, slug = null } = {}) {
  const m = KEY.exec(String(ticketKey ?? '').trim());
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const n = Number(m[2]);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  const p = prefix.toLowerCase();
  const isNumber = (w) => /^\d+$/.test(w) && Number(w) === n;
  const from = (text) => {
    const ws = words(text);
    const out = [];
    for (let i = 0; i < ws.length; i++) {
      if (ws[i] === p && isNumber(ws[i + 1] ?? '')) { i++; continue; } // "ORBIT-479", "orbit 479"
      if (isNumber(ws[i])) continue; // "#479"
      out.push(ws[i]);
    }
    return out;
  };
  let picked = from(title);
  if (!picked.length) picked = from(slug);
  const short = picked.slice(0, 6).join('-');
  return `${prefix}-${String(n).padStart(4, '0')}${short ? `-${short}` : ''}.md`;
}

// ---------- The index: docs/decisions/README.md ----------
// Rebuilt from the files each time one is written: a table of the ticket files (ticket, title,
// how many decisions, the newest "when"), sorted by ticket number, then the files under general/
// (decisions that span tickets) in a second table. No clock and no locale in it: the same files
// always give the same index, byte for byte, so two branches that rebuild it conflict only when
// their files really differ.

export const INDEX_FILE = 'README.md';
export const GENERAL_FOLDER = 'general';
const ROW_SPLIT = /(?<!\\)\|/;
const SEPARATOR = /^\|(\s*:?-{3,}:?\s*\|)+\s*$/;
const DATE = /\d{4}-\d{2}-\d{2}/;
const isIndexName = (name) => /^readme\.md$/i.test(name);

const cells = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(ROW_SPLIT).map((c) => c.trim());

/**
 * What the index says about one decision file. name: its path in the folder ("ORBIT-0479-x.md",
 * "general/0002-y.md"); text: its contents. The ticket comes from the name ("ORBIT-0479-…" is
 * ORBIT-479, "0001-…" is 0001), the title from the "# <ticket> · <title>" line (else the name's
 * words), the count from the decision tables' rows (every table but "## Not doing"), and the last
 * update from the newest date in a "when" column.
 * Returns { name, ticket, prefix, number, title, count, updated }.
 */
export function indexEntry(name, text) {
  const base = path.posix.basename(name).replace(/\.md$/i, '');
  let ticket = base;
  let prefix = '';
  let number = null;
  let rest = base;
  let m = /^([A-Za-z][A-Za-z0-9]*)-(\d+)(?:-(.*))?$/.exec(base);
  if (m) { prefix = m[1].toUpperCase(); number = Number(m[2]); ticket = `${prefix}-${number}`; rest = m[3] ?? ''; }
  else if ((m = /^(\d+)(?:-(.*))?$/.exec(base))) { number = Number(m[1]); ticket = m[1]; rest = m[2] ?? ''; }
  const lines = String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const head = lines.find((l) => /^#\s/.test(l))?.replace(/^#\s+/, '').trim() ?? '';
  const dot = head.indexOf(' · ');
  let title = dot >= 0 ? head.slice(dot + 3).trim() : head;
  if (!title || title.toUpperCase() === ticket.toUpperCase()) title = rest.replace(/-+/g, ' ').trim();
  let count = 0;
  let updated = '';
  let when = -1;
  let inNot = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^##\s/.test(line)) { inNot = NOT_DOING.test(line); continue; } // a stack's sections share the table's columns
    if (inNot || !line.startsWith('|') || SEPARATOR.test(line)) continue;
    if (SEPARATOR.test(lines[i + 1]?.trim() ?? '')) { when = cells(line).findIndex((c) => /^when$/i.test(c)); continue; }
    count++;
    const date = when >= 0 ? DATE.exec(cells(line)[when] ?? '')?.[0] : null;
    if (date && date > updated) updated = date;
  }
  return { name, ticket, prefix, number, title, count, updated };
}

// Ticket order: by key (ORBIT before others' keys), then number, then name; no number last.
const byTicket = (a, b) => (a.number === null) - (b.number === null) || (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0) || (a.number ?? 0) - (b.number ?? 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const link = (name) => name.split('/').map(encodeURIComponent).join('/');

function indexTable(entries, first) {
  const out = [`| ${first} | Title | Decisions | Last updated |`, '|---|---|---|---|'];
  for (const e of [...entries].sort(byTicket)) out.push(`| [${cell(e.ticket)}](${link(e.name)}) | ${cell(e.title) || '—'} | ${e.count} | ${e.updated || '—'} |`);
  return out;
}

/**
 * The index's text from the files: files [{ name, text }] in the folder itself, general
 * [{ name: 'general/…', text }] from its general/ folder.
 */
export function indexText({ files = [], general = [] } = {}) {
  const top = files.map((f) => indexEntry(f.name, f.text));
  const across = general.map((f) => indexEntry(f.name, f.text));
  const out = [
    '# Decisions',
    '',
    `One file per ticket with the decisions made while building it (id, question, options, choice, who, when, why) and what was left out on purpose, so engineers and agents can read later why the code is the way it is. Files that span tickets are under ${GENERAL_FOLDER}/. ${PRODUCT} rebuilds this table from the files: change a file, not the table.`,
    '',
  ];
  if (top.length) out.push(...indexTable(top, top.every((e) => e.prefix) ? 'Ticket' : 'Number'));
  else out.push('No decision files yet.');
  if (across.length) out.push('', '## Across tickets', '', ...indexTable(across, 'Number'));
  out.push('');
  return out.join('\n');
}

// The .md files in a folder that are plain files (no links, no index), with their text.
async function markdownFiles(dir, prefix = '') {
  let list = [];
  try { list = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const d of list) {
    if (!d.isFile() || !/\.md$/i.test(d.name) || d.name.startsWith('.') || isIndexName(d.name)) continue;
    out.push({ name: `${prefix}${d.name}`, text: await fs.readFile(path.join(dir, d.name), 'utf8') });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// Write a plain file by a temp file and a rename, only when the text changed; never through a link
// or over anything but a plain file. Returns { file, text, changed }.
async function writePlain(file, text) {
  const st = await fs.lstat(file).catch(() => null);
  if (st && !st.isFile()) throw Object.assign(new Error(`${file} isn’t a plain file, so it was left alone.`), { plain: true });
  const now = st ? await fs.readFile(file, 'utf8') : null;
  if (now === text) return { file, text, changed: false };
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.writeFile(tmp, text, { mode: 0o644 });
  await fs.rename(tmp, file);
  return { file, text, changed: true };
}

/**
 * Rebuild dir/README.md (dir is the decisions folder itself, like <repo>/docs/decisions) from every
 * dir/*.md and dir/general/*.md except README.md. Returns { file, text, changed }.
 */
export async function renderIndex(dir) {
  const text = indexText({ files: await markdownFiles(dir), general: await markdownFiles(path.join(dir, GENERAL_FOLDER), `${GENERAL_FOLDER}/`) });
  return writePlain(path.join(dir, INDEX_FILE), text);
}
