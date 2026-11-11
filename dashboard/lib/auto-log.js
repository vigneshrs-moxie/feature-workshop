// The Auto log: every decision Auto made on a job, with its reason and its cost, read from the
// job's audit lines. autoLog makes the view (three summary lines, then the decisions newest first),
// autoLogMarkdown writes it as text, writeAutoLog saves it as auto-log.md in the job's folder.
// Pure but for writeAutoLog. Times are the laptop's local time.

import path from 'node:path';
import { writeFileAtomic } from './atomic-write.js';
import { STAGES } from './stages.js';

export const AUTO_LOG_FILE = 'auto-log.md';

const DECISIONS = new Set(['gate', 'question', 'permission']);
const CAP = 300;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const isAuto = (l) => l && typeof l === 'object' && l.action === 'auto';
const text = (s) => (typeof s === 'string' ? s : s == null ? '' : String(s));
// Words from the Approver or a ticket: on one line, capped.
const oneLine = (s, max = CAP) => {
  const t = text(s).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

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
export function autoLog(lines = [], { title = '', now = null, record = null } = {}) {
  const all = (Array.isArray(lines) ? lines : []).filter((l) => l && typeof l === 'object');
  const decided = all.filter((l) => isAuto(l) && DECISIONS.has(l.what));
  const entries = decided.map((l, i) => {
    const e = { at: text(l.at), stage: stageLabel(l.stage), chose: text(l.chose), asked: text(l.asked), why: text(l.why) };
    if (text(l.risk)) e.risk = text(l.risk);
    if (Array.isArray(l.answers) && l.answers.length) e.answers = l.answers.map((a) => ({ question: text(a?.question), choice: text(a?.choice), reason: text(a?.reason) }));
    return { e, i };
  }).sort((a, b) => text(b.e.at).localeCompare(text(a.e.at)) || b.i - a.i).map((x) => x.e);
  const n = entries.length;
  const last = entries[0];
  const summary = [
    `Auto made ${n} decision${n === 1 ? '' : 's'} on this job. The Approver cost $${autoCost(all).toFixed(2)}.`,
    lineTwo(all, record),
    last ? `Last decision: ${autoTime(last.at)}, ${last.stage}: ${oneLine(last.chose)}.` : 'No decisions yet.',
  ];
  return { title: text(title), written: now ?? null, summary, entries };
}

/** The view as Markdown: every string from the Approver or a ticket on one line, at most 300 characters. */
export function autoLogMarkdown(view) {
  const out = [`# Auto log${oneLine(view?.title, 120) ? `: ${oneLine(view.title, 120)}` : ''}`, ''];
  for (const s of view?.summary ?? []) out.push(oneLine(s), '');
  if (view?.written && autoTime(view.written)) out.push(`Written ${autoTime(view.written)}.`, '');
  for (const e of view?.entries ?? []) {
    out.push(`## ${[autoTime(e.at), oneLine(e.stage, 60), oneLine(e.chose)].filter(Boolean).join(' · ')}`, '');
    if (oneLine(e.asked)) out.push(`Asked: ${oneLine(e.asked)}`);
    for (const a of e.answers ?? []) out.push(`- ${oneLine(a.question)} → ${oneLine(a.choice)}. Why: ${oneLine(a.reason)}`);
    if (oneLine(e.why)) out.push(`Why: ${oneLine(e.why)}`);
    if (oneLine(e.risk)) out.push(`Risk: ${oneLine(e.risk)}`);
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
