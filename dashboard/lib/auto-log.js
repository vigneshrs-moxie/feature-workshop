// The Auto log: every decision Auto made on a job, with its reason and its cost, read from the
// job's audit lines. autoLog makes the view (three summary lines, then the decisions newest first),
// autoLogMarkdown writes it as text, writeAutoLog saves it as auto-log.md in the job's folder.
// Pure but for writeAutoLog. Times are the laptop's local time.

import path from 'node:path';
import { writeFileAtomic } from './atomic-write.js';
import { STAGES } from './stages.js';
import { stopOf } from './stage-view.js';

export const AUTO_LOG_FILE = 'auto-log.md';

/**
 * The most the website keeps of a job's Auto list (hosted/lib/records.js cleans with these same
 * numbers): entries newest first, characters per string, answers per entry, summary lines.
 */
export const AUTO_LOG_LIMITS = Object.freeze({ entries: 200, text: 1000, answers: 20, line: 400, summary: 3, at: 40, stage: 100, stopped: 300, tag: 100 });

const DECISIONS = new Set(['gate', 'question', 'permission', 'refuse']);
// What each kind of Auto line is, on the list: a go-ahead, an answer, a permission allowed (or refused), a call Auto
// refused on its card (a fixed rule, not the Approver), a stop.
const KIND = { gate: 'approve', question: 'answer', permission: 'allow', refuse: 'refuse', stop: 'stop' };
const CAP = 300;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const isAuto = (l) => l && typeof l === 'object' && l.action === 'auto';
const text = (s) => (typeof s === 'string' ? s : s == null ? '' : String(s));
// Words from the Approver or a ticket: on one line, capped.
const oneLine = (s, max = CAP) => {
  const t = text(s).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// The same for the Markdown: agent text cannot start inline markup (a tag, a link, code).
const md = (s, max = CAP) => oneLine(s, max).replace(/[<[`]/g, '\\$&');

/** "11 Nov 08:05" in the laptop's local time; '' when the time is missing or not a time. */
export function autoTime(at) {
  const d = new Date(at ?? NaN);
  if (!Number.isFinite(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The Approver's cost in dollars: the sum of costUsd on the Auto lines. */
export function autoCost(lines = []) {
  let sum = 0;
  for (const l of lines) if (isAuto(l) && Number.isFinite(l.costUsd) && l.costUsd > 0) sum += l.costUsd;
  return sum;
}

// A time as a number for sorting; an unreadable one counts as 0 (oldest); ties go by the file's order, later lines first.
const timeOf = (at) => { const t = Date.parse(at); return Number.isFinite(t) ? t : 0; };
const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label ?? text(id);
const reasonOf = (s) => (s && typeof s === 'object' ? text(s.reason) : text(s));

// Where Auto stands, from the lines alone: 'on' | 'off' | 'finished' | { stopped: reason }.
function stateFrom(lines) {
  let state = 'off';
  for (const l of lines) {
    if (isAuto(l)) {
      if (l.what === 'on') state = 'on';
      else if (l.what === 'off') state = 'off';
      else if (l.what === 'finished') state = 'finished';
      else if (l.what === 'stop') state = { stopped: reasonOf(l.reason ?? l.why) };
    } else if (l && typeof l === 'object' && (l.action === 'send' || l.action === 'permission') && l.by !== 'auto' && typeof state === 'object') {
      state = 'on'; // the person carried on after a stop
    }
  }
  return state;
}

function lastRun(lines) {
  let last = null;
  for (const l of lines) if (isAuto(l) && ['on', 'off', 'stop', 'finished'].includes(l.what)) last = l.what;
  return last;
}

function lineTwo(lines, record) {
  const finished = 'Auto finished: PR #1 is open.';
  const stopped = (reason) => `Auto stopped: ${oneLine(reason) || 'it needs you'}`;
  if (record && typeof record === 'object') {
    if (record.on === true) return record.stopped ? stopped(reasonOf(record.stopped)) : 'Auto is on.';
    return lastRun(lines) === 'finished' ? finished : 'Auto is off.';
  }
  const s = stateFrom(lines);
  if (s === 'on') return 'Auto is on.';
  if (s === 'finished') return finished;
  if (typeof s === 'object') return stopped(s.stopped);
  return 'Auto is off.';
}

/**
 * The view of a job's Auto decisions. lines: the job's audit lines, oldest first. record: the job's
 * Auto record from sessions.json ({ on, stopped, ... }) when there is one. The view carries title
 * and now (as `written`) for the Markdown.
 */
export function autoLog(lines = [], { title = '', now = null, record = null, stops = false } = {}) {
  const all = (Array.isArray(lines) ? lines : []).filter((l) => l && typeof l === 'object');
  // stops: Auto's stop lines join the entries too (the list's kind 'stop', the reason as what it chose); they are not decisions.
  const listed = all.filter((l) => isAuto(l) && (DECISIONS.has(l.what) || (stops && l.what === 'stop')));
  const entries = listed.map((l, i) => {
    const stop = l.what === 'stop';
    const e = { at: text(l.at), stage: stageLabel(l.stage), chose: stop ? reasonOf(l.reason ?? l.why) : text(l.chose), asked: text(l.asked), why: text(l.why) };
    if (text(l.risk)) e.risk = text(l.risk);
    if (Array.isArray(l.answers) && l.answers.length) e.answers = l.answers.map((a) => ({ question: text(a?.question), choice: text(a?.choice), reason: text(a?.reason) }));
    // A risky call (Auto queue, Task 6): Auto asked the Approver once more, and `first` is what it said first.
    if (l.risky === true) { e.risky = true; e.first = text(l.first); }
    e.kind = KIND[l.what];
    e.stop = typeof l.stage === 'string' ? stopOf(l.stage) : null;
    return { e, i };
  }).sort((a, b) => timeOf(b.e.at) - timeOf(a.e.at) || b.i - a.i).map((x) => x.e);
  const decisions = entries.filter((e) => e.kind !== 'stop');
  const n = decisions.length;
  const last = decisions[0];
  const summary = [
    `Auto made ${n} decision${n === 1 ? '' : 's'} on this job. The Approver cost $${autoCost(all).toFixed(2)}.`,
    lineTwo(all, record),
    last ? `Last decision: ${[autoTime(last.at), last.stage].filter(Boolean).join(', ')}: ${oneLine(last.chose)}.` : 'No decisions yet.',
  ];
  return { title: text(title), written: now ?? null, summary, entries };
}

/**
 * What a job's Auto list is, as the site and the laptop's own page get it: { on, stopped, tag, summary, entries, startedAt, ticket }.
 * Each entry has its kind ('approve', 'answer', 'allow', 'refuse', 'stop') and its step (null: not known); Auto's stops are entries
 * too, and the first summary line counts the decisions only. startedAt: when a tag started Auto on the job (its first
 * Auto 'on' line by a tag), else null. ticket: the job's ticket key, as the caller gives it, else null.
 * Null for a job with no Auto line (Auto has not run on it).
 */
export function autoLogRecord(lines = [], { title = '', record = null, ticket = null } = {}) {
  if (!(Array.isArray(lines) ? lines : []).some(isAuto)) return null;
  const { summary, entries } = autoLog(lines, { title, record, stops: true });
  const stopped = record?.stopped && typeof record.stopped === 'object' ? text(record.stopped.reason) : text(record?.stopped);
  const byTag = lines.find((l) => isAuto(l) && l.what === 'on' && l.by === 'tag');
  return { on: record?.on === true, stopped: stopped || null, tag: record?.tag ? text(record.tag) : null, summary, entries, startedAt: byTag && text(byTag.at) ? text(byTag.at) : null, ticket: ticket ? text(ticket) : null };
}

/** An Auto record cut to AUTO_LOG_LIMITS: the newest entries, every string shortened. A record within the limits comes back equal. */
export function capAutoLog(v) {
  const L = AUTO_LOG_LIMITS;
  if (!v || typeof v !== 'object' || !Array.isArray(v.entries) || !Array.isArray(v.summary)) return v;
  const cut = (x, n) => (typeof x === 'string' && x.length > n ? x.slice(0, n) : x);
  const entries = v.entries.slice(0, L.entries).map((e) => {
    const o = { ...e, at: cut(e.at, L.at), stage: cut(e.stage, L.stage), chose: cut(e.chose, L.text), asked: cut(e.asked, L.text), why: cut(e.why, L.text) };
    if (typeof e.risk === 'string') o.risk = cut(e.risk, L.text);
    if (Array.isArray(e.answers)) o.answers = e.answers.slice(0, L.answers).map((a) => ({ ...a, question: cut(a?.question, L.text), choice: cut(a?.choice, L.text), reason: cut(a?.reason, L.text) }));
    return o;
  });
  const facts = { ...('startedAt' in v ? { startedAt: cut(v.startedAt, L.at) } : {}), ...('ticket' in v ? { ticket: cut(v.ticket, L.tag) } : {}) };
  return { ...v, stopped: cut(v.stopped, L.stopped), tag: cut(v.tag, L.tag), summary: v.summary.slice(0, L.summary).map((x) => cut(x, L.line)), entries, ...facts };
}

/** The view as Markdown: every string from the Approver or a ticket on one line, at most 300 characters. */
export function autoLogMarkdown(view) {
  const out = [`# Auto log${md(view?.title, 120) ? `: ${md(view.title, 120)}` : ''}`, ''];
  for (const s of view?.summary ?? []) out.push(md(s), '');
  if (view?.written && autoTime(view.written)) out.push(`Written ${autoTime(view.written)}.`, '');
  for (const e of view?.entries ?? []) {
    out.push(`## ${[autoTime(e.at), md(e.stage, 60), md(e.chose)].filter(Boolean).join(' · ')}`, '');
    if (md(e.asked)) out.push(`Asked: ${md(e.asked)}`);
    for (const a of e.answers ?? []) out.push(`- ${md(a.question)} → ${md(a.choice)}. Why: ${md(a.reason)}`);
    if (md(e.why)) out.push(`Why: ${md(e.why)}`);
    if (md(e.risk)) out.push(`Risk: ${md(e.risk)}`);
    out.push('');
  }
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

/**
 * Save <jobDir>/auto-log.md from the job's audit lines. With no Auto line there is nothing to say
 * and nothing is written. Returns the file's path, or null when none was written.
 */
export async function writeAutoLog(jobDir, lines = [], opts = {}) {
  if (!(Array.isArray(lines) ? lines : []).some(isAuto)) return null;
  const file = path.join(jobDir, AUTO_LOG_FILE);
  await writeFileAtomic(file, autoLogMarkdown(autoLog(lines, opts)));
  return file;
}
