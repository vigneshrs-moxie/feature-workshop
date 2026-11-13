// The job page's Details (the job page rebuild, Task 5): one row per piece of work, newest first, and
// the cost by step under them. GET /api/job/:slug/work (site/routes-job-page.js) answers it.
//
//   Row   { id (the crew member's ref, lib/stage-view.js crewRef), step ('spec' | … | 'ship' | null),
//           stepLabel, who (its agent type), role ('Builder'), model (a label, or null), task (one line,
//           or null), startedAt, endedAt (null while running), durationMs (so far, while running),
//           ended ('Done' | 'Stopped' | 'Failed: <one line>' | 'Running'), state ('done' | 'stopped' |
//           'failed' | 'running'), ref (the row's id while it runs on the laptop: Open in terminal; else null) }
//   costs { steps: [{ step, label, usd }] in the job's order (then 'other'), totalUsd }
//   note  a plain sentence when there is something to say about the list (none yet; on the website), else null
//
// The task it was given is the first instruction in that crew member's log (the prompt it was started
// with), one line; without the log (not found, or on the website), the one-line task the Foreman gave
// it (the activity's description). Never a list of its tool calls.
//
// How it ended comes from the job's corrected activity (runner jobDetail: a 'running' row with no live
// process behind it is already 'stopped' by lib/working.js rowWorking), so a row is Running only by
// that rule; a log never makes a row Running. A stopped row Failed when its log ends on an API error
// (Claude Code writes those as an assistant line with isApiErrorMessage), or when the reply it was part
// of ended with an error (the job's audit: run-ended, status 'error').
//
// Speed (plan "Speed rules" 6): the page's payload never reads a log. The work route reads each crew
// log only when Details asks, and only the start (the task) and the end (how it failed) of it. Each
// log's answer is kept by its size and modified time: an unchanged log is never read twice, and a log
// that grew has only its end read again (the start of a log does not change).

import fsp from 'node:fs/promises';
import { STOPS, crewRef, findCrewLog, roleWord, stageOfCrew, stopOf } from './stage-view.js';
import { modelLabel } from './cost.js';
import { scrub } from './orbit.js';

/** At most this many characters of a task or a failure's line. */
export const TASK_MAX = 160;
/** How much of a log's start is read for its first instruction, and of its end for how it ended. */
const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 64 * 1024;
/** A crew member whose log was not found is looked for again after this long. */
const MISS_MS = 30_000;

const NO_CREW = 'No crew has worked on this job yet.';
const ON_LAPTOP = 'The full task each one was given shows on your laptop.';
const NOT_SENT = 'The work on this job shows here once your laptop sends it.';
const FAILED_WORDS = 'the reply ended with an error';

const STEP_LABEL = Object.fromEntries(STOPS.map((s) => [s.id, s.label]));
const ORDER = [...STOPS.map((s) => s.id), 'other'];
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const ms = (iso) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? t : null; };

/** A line cut to TASK_MAX characters, with … when cut (never splitting a character in two). */
function cut(s) {
  if (s.length <= TASK_MAX) return s;
  let n = TASK_MAX - 1;
  const c = s.charCodeAt(n - 1);
  if (c >= 0xd800 && c <= 0xdbff) n--;
  return `${s.slice(0, n)}…`;
}

/** One plain line from a text: its first line that says something, without markdown marks, secrets hidden. */
function oneLine(text, { tags = false } = {}) {
  if (typeof text !== 'string') return null;
  let body = scrub(text.slice(0, 16 * 1024));
  if (tags) body = body.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '\n');
  for (const raw of body.split('\n')) {
    let l = raw.trim();
    if (!l || (tags && /^<\/?[\w-]+(\s[^>]*)?>$/.test(l))) continue;
    l = l.replace(/^(#{1,6}\s+|>\s*|[-*]\s+)/, '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
    if (l) return cut(l);
  }
  return null;
}

/** The task in one line, from the text of a crew member's first instruction. */
export const firstInstruction = (text) => oneLine(text, { tags: true });

// ---------- Reading a crew member's log ----------

const textOf = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((c) => c?.type === 'text' && typeof c.text === 'string' && !c.text.startsWith('<system-reminder>')).map((c) => c.text).join('\n') : '');

/** The first instruction in a log's lines: its first prompt (not Claude Code's own lines, not a tool's result). */
function taskIn(lines) {
  for (const l of lines) {
    let d;
    try { d = JSON.parse(l); } catch { continue; }
    if (d?.type === 'queue-operation' && d.operation === 'enqueue' && typeof d.content === 'string') return firstInstruction(d.content);
    if (d?.type !== 'user' || d.isMeta || !d.message) continue;
    const c = d.message.content;
    if (Array.isArray(c) && c.some((x) => x?.type === 'tool_result')) continue;
    const task = firstInstruction(textOf(c));
    if (task) return task;
  }
  return null;
}

/** How a log ends, when it ends on an API error: that error's line; else null. */
function failureIn(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    let d;
    try { d = JSON.parse(lines[i]); } catch { continue; }
    if (d?.type !== 'assistant') continue;
    return d.isApiErrorMessage ? oneLine(textOf(d.message?.content)) ?? oneLine(String(d.error ?? '')) ?? FAILED_WORDS : null;
  }
  return null;
}

async function readSpan(fs, file, start, length) {
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally { await fh.close(); }
}

/** A log's whole lines in a span: a line cut at either edge of the span is left out. */
function wholeLines(text, { fromStart, toEnd }) {
  const lines = text.split('\n');
  if (!fromStart) lines.shift();
  if (!toEnd) lines.pop();
  return lines.filter((l) => l.trim());
}

/**
 * The crew logs reader: read(entry) → null (no log on this computer) | { task, failed }.
 * entry: one activity row (who, description, sessionId, agentId, startedAt). Each answer is kept by its
 * file's size and modified time, and where each crew member's log is, so a second ask of an unchanged
 * log reads no file and looks for none.
 * @param {{ projectsDir: string, findLog?: Function, fs?: typeof fsp, now?: () => number }} o
 */
export function crewLogs({ projectsDir, findLog = findCrewLog, fs = fsp, now = Date.now } = {}) {
  const where = new Map(); // entry key -> file | { missUntil }
  const kept = new Map(); // file -> { size, mtimeMs, task, failed }
  const keyOf = (e) => [e.sessionId ?? '', e.who ?? '', e.agentId ?? '', e.startedAt ?? '', e.description ?? ''].join('|');

  async function fileOf(entry) {
    const key = keyOf(entry);
    const known = where.get(key);
    if (typeof known === 'string') return known;
    if (known && known.missUntil > now()) return null;
    const file = await findLog({ projectsDir, entry }).catch(() => null);
    where.set(key, file ?? { missUntil: now() + MISS_MS });
    if (where.size > 2000) where.delete(where.keys().next().value);
    return file;
  }

  async function read(entry) {
    if (!projectsDir || !isObj(entry)) return null;
    const file = await fileOf(entry);
    if (!file) return null;
    const st = await fs.stat(file).catch(() => null);
    if (!st) { where.delete(keyOf(entry)); kept.delete(file); return null; }
    const had = kept.get(file);
    if (had && had.size === st.size && had.mtimeMs === st.mtimeMs) return { task: had.task, failed: had.failed };
    // A log that grew keeps its start: only its end is read again.
    const grew = had && had.task !== null && st.size > had.size;
    let task = grew ? had.task : null;
    if (!grew) {
      const head = await readSpan(fs, file, 0, Math.min(st.size, HEAD_BYTES));
      task = taskIn(wholeLines(head, { fromStart: true, toEnd: st.size <= HEAD_BYTES }));
    }
    const from = Math.max(0, st.size - TAIL_BYTES);
    const tail = await readSpan(fs, file, from, st.size - from);
    const failed = failureIn(wholeLines(tail, { fromStart: from === 0, toEnd: true }));
    kept.set(file, { size: st.size, mtimeMs: st.mtimeMs, task, failed });
    if (kept.size > 2000) kept.delete(kept.keys().next().value);
    return { task, failed };
  }

  return { read, stats: () => ({ files: kept.size, places: where.size }) };
}

// ---------- The rows ----------

/** The model a crew member used: its own when the activity says, else the cost row for its kind and step. */
function modelOf(entry, stage, agents) {
  if (entry.model) return modelLabel(entry.model);
  const rows = agents.filter((r) => r?.agentType === entry.who && (!stage || r.stage === stage));
  const top = [...rows].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))[0];
  return top?.model ? modelLabel(top.model) : null;
}

/** How a row ended: from its corrected state, its log's failure, or the reply it was part of. */
function endOf(entry, info, ends) {
  if (entry.state === 'running') return { state: 'running', ended: 'Running' };
  if (entry.state === 'finished' || entry.state === 'done') return { state: 'done', ended: 'Done' };
  let why = typeof info?.failed === 'string' && info.failed ? oneLine(info.failed) : null;
  if (!why) {
    const last = ms(entry.lastAt);
    const end = last === null ? null : ends.find((e) => (ms(e.at) ?? -Infinity) >= last);
    if (end?.status === 'error') why = oneLine(String(end.error ?? '')) ?? FAILED_WORDS;
  }
  return why ? { state: 'failed', ended: `Failed: ${why}` } : { state: 'stopped', ended: 'Stopped' };
}

function costsOf(agents, totalUsd) {
  const by = new Map();
  for (const r of agents) {
    const usd = Number(r?.usd);
    if (!Number.isFinite(usd) || usd <= 0) continue;
    const step = stopOf(r.stage) ?? 'other';
    by.set(step, (by.get(step) ?? 0) + usd);
  }
  const steps = ORDER.filter((s) => by.has(s)).map((s) => ({ step: s, label: STEP_LABEL[s] ?? 'Other', usd: Math.round(by.get(s) * 1e6) / 1e6 }));
  const sum = Math.round(steps.reduce((a, s) => a + s.usd, 0) * 1e6) / 1e6;
  return { steps, totalUsd: Number.isFinite(totalUsd) ? totalUsd : steps.length ? sum : null };
}

/**
 * Details from the job's facts. Pure. infoOf(entry) → null | { task, failed } (a log's answer).
 * facts: { activity (jobDetail's, corrected), agents (costDetail.agents), totalUsd, ends ([{ at, status, error }]),
 *          hosted (no terminal), now }
 */
export function workView({ activity = [], agents = [], totalUsd = null, ends = [], hosted = false, now = Date.now() } = {}, infoOf = () => null) {
  const list = Array.isArray(activity) ? activity : [];
  const costRows = Array.isArray(agents) ? agents : [];
  const endsAt = (Array.isArray(ends) ? ends : []).filter((e) => isObj(e) && ms(e.at) !== null).sort((a, b) => ms(a.at) - ms(b.at));
  const rows = [];
  list.forEach((entry, index) => {
    if (!isObj(entry) || entry.who === 'conductor') return; // the Foreman's own session is not a piece of work
    const info = infoOf(entry);
    const stage = stageOfCrew(entry.who, entry.description ?? '');
    const step = stopOf(stage);
    const { state, ended } = endOf(entry, info, endsAt);
    const started = ms(entry.startedAt);
    const endedAt = state === 'running' ? null : entry.lastAt ?? null;
    const until = state === 'running' ? now : ms(entry.lastAt);
    const id = crewRef(entry, index);
    rows.push({
      id, step, stepLabel: step ? STEP_LABEL[step] : null, who: entry.who ?? 'unknown', role: roleWord(entry.who), model: modelOf(entry, stage, costRows),
      task: (typeof info?.task === 'string' && info.task) || oneLine(entry.description ?? '') || null,
      startedAt: entry.startedAt ?? null, endedAt, durationMs: started !== null && until !== null ? Math.max(0, until - started) : null,
      ended, state, ref: state === 'running' && !hosted ? id : null,
    });
  });
  const at = (r) => ms(r.startedAt) ?? ms(r.endedAt) ?? 0;
  rows.sort((a, b) => at(b) - at(a));
  return { rows, costs: costsOf(costRows, totalUsd), note: rows.length ? null : NO_CREW };
}

/** What Details needs from runner jobDetail (or its mirrored record): kept by the page's cache at each rebuild. */
export function workFacts(detail) {
  const d = isObj(detail) ? detail : {};
  const strip = ({ recent: _r, lastCommand: _c, doing: _d, quiet: _q, ...kept }) => kept;
  return {
    activity: (Array.isArray(d.activity) ? d.activity : []).filter(isObj).map(strip),
    agents: Array.isArray(d.costDetail?.agents) ? d.costDetail.agents : [],
    totalUsd: Number.isFinite(d.costDetail?.totalUsd) ? d.costDetail.totalUsd : null,
    ends: (Array.isArray(d.audit) ? d.audit : []).filter((e) => e?.action === 'run-ended').map((e) => ({ at: e.at ?? null, status: e.status ?? null, error: e.error ?? null })),
  };
}

/** Details on the laptop: the cached facts, and each crew member's log read (logs: crewLogs()) in one go. */
export async function jobWork(facts, { logs = null, now = Date.now() } = {}) {
  const f = isObj(facts) ? facts : {};
  const crew = (Array.isArray(f.activity) ? f.activity : []).filter((e) => isObj(e) && e.who !== 'conductor');
  const infos = new Map();
  if (logs) await Promise.all(crew.map(async (e) => { infos.set(e, await logs.read(e).catch(() => null)); }));
  return workView({ ...f, hosted: false, now }, (e) => infos.get(e) ?? null);
}

/** Details on the website, from the mirrored job record: the Foreman's task lines (the logs stay on the laptop), no terminal. */
export function mirrorWork(record, { now = Date.now() } = {}) {
  if (!isObj(record) || !Array.isArray(record.activity)) return { rows: [], costs: { steps: [], totalUsd: null }, note: NOT_SENT };
  const view = workView({ ...workFacts(record), hosted: true, now });
  return { ...view, note: view.rows.length ? ON_LAPTOP : view.note };
}
