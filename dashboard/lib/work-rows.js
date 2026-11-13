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
// with), one line: the first line that states the task, past the opening a conductor's dispatch prompt
// carries (the stage, the job, the folders, the files to read: firstInstruction). Without the log (not
// found, or on the website), or when the prompt says nothing past its opening, the one-line task the
// Foreman gave it (the activity's description). Never a list of its tool calls.
//
// How it ended comes from the job's corrected activity (runner jobDetail: a 'running' row with no live
// process behind it is already 'stopped' by lib/working.js rowWorking), so a row is Running only by
// that rule; a log never makes a row Running. A stopped row Failed when its log ends on an API error
// (Claude Code writes those as an assistant line with isApiErrorMessage; a half-written last line is
// skipped, so an earlier error the worker was retrying can still show), or when the reply it was part
// of ended with an error. That reply is the job's last one started (audit `send`, with its runId) at or
// before the row's last line, and its end is the `run-ended` with the same runId (the whole audit, read
// at the rebuild: runLines). A reply with no end (a crash) or none at all (a terminal) says nothing.
//
// Speed (plan "Speed rules" 6): the page's payload never reads a log. The work route reads each crew
// log only when Details asks, at most READS_AT_ONCE at a time, and only the start (the task: 64 KB,
// widened to 256 KB when the first prompt is longer) and the end (how it failed: 64 KB) of it. Each
// log's answer is kept by its size and modified time: an unchanged log is never read twice, and a log
// that grew has only its end read again (the start of a log does not change).

import fsp from 'node:fs/promises';
import { STOPS, crewRef, findCrewLog, roleWord, stageOfCrew, stopOf } from './stage-view.js';
import { modelLabel } from './cost.js';
import { scrub } from './orbit.js';

/** At most this many characters of a task or a failure's line. */
export const TASK_MAX = 160;
/** How much of a log's start is read for its first instruction (first, then at most), and of its end for how it ended. */
const HEAD_FIRST = 64 * 1024;
const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 64 * 1024;
/** How many crew logs the work route reads at once. */
export const READS_AT_ONCE = 8;
/** How many of a job's replies Details keeps (start and end), newest. */
const RUNS_KEPT = 500;
/** A crew member whose log was not found is looked for again after this long. */
const MISS_MS = 30_000;

const NO_CREW = 'No crew has worked on this job yet.';
const NOT_READY = 'The work on this job isn’t known yet. Try again in a moment.';
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

/** A line without its markdown marks (heading, quote, list, bold), its spaces collapsed. */
const plain = (raw) => raw.trim().replace(/^(#{1,6}\s+|>\s*|[-*•]\s+)/, '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();

/** One plain line from a text: its first line that says something, without markdown marks, secrets hidden. */
function oneLine(text) {
  if (typeof text !== 'string') return null;
  for (const raw of scrub(text.slice(0, 16 * 1024)).split('\n')) {
    const l = plain(raw);
    if (l) return cut(l);
  }
  return null;
}

// The opening a conductor's dispatch prompt carries before the task. The /feature and /bugfix skills say
// "Every dispatch prompt contains: the stage; the exact artifact paths and versions; the private folder;
// the repository path (and the worktree); the human's authorization verbatim; the human's answers; the job
// options …; and 'Return the report described in your agent definition.'", in the conductor's own words.
// So, skipped:
//   - a "Label: value" line for one of those (KEYS); for the looser labels (SHORT_KEYS) only a short one
//   - a label with no value: a markdown heading or a short line ending in ":" ("## Context", "Read first:",
//     "Inputs:"), with the list under it; a heading or "Task:" that names the task ("## Task", "Your task:")
//     makes the next line the task
//   - a role line ("You are the Builder for this job"); anything after it on the line is the task
//     ("You are the implementer for this job: build the notes table" → "Build the notes table")
//   - a short "Read / Follow / Use / Load / See … .md (first, rules, skill …)" line, "Return the report …",
//     "This is a bug job …", a path alone, a marker line
// A "Task: …" line gives its value. A long sentence is never skipped as boilerplate.
const KEYS = 'stage|level|job|slug|ticket|(?:private |job |feature )?folder|repo(?:sitory)?|worktree|(?:feature |base )?branch|base(?: commit)?|commit|range|diff(?: range)?|spec|plan|(?:implementation |test |quick )?plan|findings|diagnosis|reproduction|artifacts?|paths?|inputs?|(?:job )?options|gates? file|(?:the human\'?s )?(?:authori[sz]ation|answers?)|checklists?|layer(?: tags)?|skipped(?: stages)?|provided(?: documents)?|stand-?ins?|facts|versions?|private';
const SHORT_KEYS = 'title|kind|model|effort|scope|round|rules|worker rules|report|note|notes';
const keyLine = (keys) => new RegExp(`^(?:the )?(?:${keys})(?: (?:path|paths|file|files|folder|version|versions|name))?\\s*(?::|=|—|–| - )`, 'i');
const KEY_LINE = keyLine(KEYS);
const SHORT_KEY_LINE = keyLine(SHORT_KEYS);
const TASK_WORDS = '(?:your |the )?(?:task|goal|job to do|what to do|assignment)';
const TASK_LINE = new RegExp(`^${TASK_WORDS}\\s*(?::|—|–| - )\\s*(.+)$`, 'i');
const TASK_LABEL = new RegExp(`^${TASK_WORDS}\\s*:?$`, 'i');
const ROLE = /^you(?: are|'re|’re) (?:the|a|an) .{1,60}? (?:for|on|in|of) (?:the |this |a )?(?:job|feature|bug|stage|ticket|repo|repository|step)\b/i;
const OPENING = [
  /^(?:read|follow|use|load|see)\b.*(?:\.md\b|\bfirst\b|\bbelow\b|\brules\b|\bskill\b|\bchecklists?\b|\bagent definition\b)/i,
  /^return (?:the|your) report\b/i,
  /^this is a (?:bug|feature) job\b/i,
];
const LIST_ITEM = /^(?:[-*•]|\d+[.)])\s/;
/** A line of at most this many words can be boilerplate; a longer one is a sentence that says something. */
const SHORT_WORDS = 10;
/** A label with no value: at most this many words. */
const LABEL_WORDS = 4;
const words = (l) => l.split(' ').filter(Boolean).length;
const capital = (l) => l.charAt(0).toUpperCase() + l.slice(1);

/**
 * The task in one line, from the text of a crew member's first instruction: the first line past the
 * dispatch prompt's opening (above), without markdown, secrets hidden, cut short. Null when nothing past
 * the opening (in its first 60 lines) says what to do: the description is used then.
 */
export function firstInstruction(text) {
  if (typeof text !== 'string') return null;
  const body = scrub(text.slice(0, 16 * 1024)).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '\n');
  let underLabel = false;
  let next = false; // the line before named the task ("## Task"): this line is it
  let seen = 0;
  for (const raw of body.split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    if (++seen > 60) break;
    if (/^<\/?[\w-]+(\s[^>]*)?>$/.test(t) || /^(?:[=\-*_~<>]{3,}|#{7,})/.test(t)) continue; // a lone tag, a marker line (not a heading)
    const l = plain(t);
    if (!l) continue;
    if (next) return cut(l.replace(/:$/, ''));
    if (underLabel && LIST_ITEM.test(t)) continue;
    underLabel = false;
    const heading = /^#{1,6}\s/.test(t);
    const bare = l.replace(/\s*:$/, '');
    if (TASK_LABEL.test(l)) { next = true; continue; } // "Task:", "## Your task", "**Task**"
    const task = TASK_LINE.exec(l);
    if (task) return cut(capital(plain(task[1]))) || null;
    if ((heading || /:$/.test(l)) && words(bare) <= LABEL_WORDS) { underLabel = true; continue; } // "## Context", "Read first:"
    const role = ROLE.exec(l);
    if (role) {
      const rest = l.slice(role[0].length).replace(/^[\s:.,;—–-]+/, '');
      if (words(rest) >= 2) return cut(capital(rest));
      continue;
    }
    const short = words(l) <= SHORT_WORDS;
    if (KEY_LINE.test(l) || (short && SHORT_KEY_LINE.test(l))) continue;
    if (short && (OPENING.some((re) => re.test(l)) || /^[~/.][^\s]*$/.test(l))) continue;
    return cut(l.replace(/:$/, ''));
  }
  return null;
}

// ---------- Reading a crew member's log ----------

const textOf = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((c) => c?.type === 'text' && typeof c.text === 'string' && !c.text.startsWith('<system-reminder>')).map((c) => c.text).join('\n') : '');

/**
 * The first instruction in a crew log's lines (findCrewLog: <session>/subagents/agent-<id>.jsonl, whose
 * first prompt is the dispatch prompt): { found: a first prompt was there, task: its line or null }.
 * Claude Code's own lines (isMeta) and tools' results are not prompts.
 */
function taskIn(lines) {
  for (const l of lines) {
    let d;
    try { d = JSON.parse(l); } catch { continue; }
    if (d?.type !== 'user' || d.isMeta || !d.message) continue;
    const c = d.message.content;
    if (Array.isArray(c) && c.some((x) => x?.type === 'tool_result')) continue;
    const text = textOf(c);
    if (!text.trim()) continue;
    return { found: true, task: firstInstruction(text) };
  }
  return { found: false, task: null };
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
    // A log that grew keeps its start once its first prompt was read: only its end is read again.
    const grew = had && had.found && st.size > had.size;
    let start = grew ? { found: true, task: had.task } : null;
    for (const bytes of grew ? [] : [HEAD_FIRST, HEAD_BYTES]) {
      const head = await readSpan(fs, file, 0, Math.min(st.size, bytes));
      start = taskIn(wholeLines(head, { fromStart: true, toEnd: st.size <= bytes }));
      if (start.found || st.size <= bytes) break; // a first prompt longer than 64 KB: read up to 256 KB
    }
    const { found, task } = start;
    const from = Math.max(0, st.size - TAIL_BYTES);
    const tail = await readSpan(fs, file, from, st.size - from);
    const failed = failureIn(wholeLines(tail, { fromStart: from === 0, toEnd: true }));
    kept.set(file, { size: st.size, mtimeMs: st.mtimeMs, found, task, failed });
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
function endOf(entry, info, runs) {
  if (entry.state === 'running') return { state: 'running', ended: 'Running' };
  if (entry.state === 'finished' || entry.state === 'done') return { state: 'done', ended: 'Done' };
  let why = typeof info?.failed === 'string' && info.failed ? oneLine(info.failed) : null;
  const last = ms(entry.lastAt);
  if (!why && last !== null) {
    // Its reply: the last one started at or before its last line (runs are oldest first), ended at or after it.
    let run = null;
    for (const r of runs) { if (r.startMs <= last) run = r; else break; }
    if (run?.status === 'error' && run.endMs !== null && run.endMs >= last) why = oneLine(String(run.error ?? '')) ?? FAILED_WORDS;
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
 * facts: { activity (jobDetail's, corrected), agents (costDetail.agents), totalUsd, runs ([{ runId, startedAt, endedAt, status, error }]),
 *          hosted (no terminal), now }
 */
export function workView({ activity = [], agents = [], totalUsd = null, runs = [], hosted = false, now = Date.now() } = {}, infoOf = () => null) {
  const list = Array.isArray(activity) ? activity : [];
  const costRows = Array.isArray(agents) ? agents : [];
  const runsAt = (Array.isArray(runs) ? runs : []).filter((r) => isObj(r) && ms(r.startedAt) !== null)
    .map((r) => ({ ...r, startMs: ms(r.startedAt), endMs: ms(r.endedAt) })).sort((a, b) => a.startMs - b.startMs);
  const rows = [];
  list.forEach((entry, index) => {
    if (!isObj(entry) || entry.who === 'conductor') return; // the Foreman's own session is not a piece of work
    const info = infoOf(entry);
    const stage = stageOfCrew(entry.who, entry.description ?? '');
    const step = stopOf(stage);
    const { state, ended } = endOf(entry, info, runsAt);
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

/**
 * The job's reply starts and ends from its whole audit (runner jobDetail, whole: true), small: each reply's
 * `send` (with its runId) and its `run-ended`, the newest RUNS_KEPT replies.
 */
export function runLines(audit) {
  const lines = (Array.isArray(audit) ? audit : []).filter((e) => isObj(e) && e.runId && ((e.action === 'send') || e.action === 'run-ended'));
  return lines.slice(-RUNS_KEPT * 2).map((e) => (e.action === 'send'
    ? { action: 'send', at: e.at ?? null, runId: String(e.runId) }
    : { action: 'run-ended', at: e.at ?? null, runId: String(e.runId), status: e.status ?? null, error: e.error ?? null }));
}

/** Each reply once, oldest first: { runId, startedAt, endedAt (null: no end on record, a crash), status, error }. */
function runsFrom(lines) {
  const by = new Map();
  for (const e of Array.isArray(lines) ? lines : []) {
    if (!isObj(e) || !e.runId) continue;
    if (e.action === 'send' && !by.has(e.runId)) by.set(e.runId, { runId: e.runId, startedAt: e.at ?? null, endedAt: null, status: null, error: null });
    else if (e.action === 'run-ended' && by.has(e.runId)) Object.assign(by.get(e.runId), { endedAt: e.at ?? null, status: e.status ?? null, error: e.error ?? null });
  }
  return [...by.values()];
}

/** What Details needs from runner jobDetail (or its mirrored record): kept by the page's cache at each rebuild. */
export function workFacts(detail) {
  const d = isObj(detail) ? detail : {};
  const strip = ({ recent: _r, lastCommand: _c, doing: _d, quiet: _q, ...kept }) => kept;
  return {
    activity: (Array.isArray(d.activity) ? d.activity : []).filter(isObj).map(strip),
    agents: Array.isArray(d.costDetail?.agents) ? d.costDetail.agents : [],
    totalUsd: Number.isFinite(d.costDetail?.totalUsd) ? d.costDetail.totalUsd : null,
    // The whole audit's replies (jobDetail whole: runLines); without them, what the detail's audit holds.
    runs: runsFrom(Array.isArray(d.runLines) ? d.runLines : runLines(d.audit)),
  };
}

/** Details on the laptop: the cached facts, and each crew member's log read (logs: crewLogs()), READS_AT_ONCE at a time. */
export async function jobWork(facts, { logs = null, now = Date.now() } = {}) {
  if (!isObj(facts)) return { rows: [], costs: { steps: [], totalUsd: null }, note: NOT_READY };
  const crew = (Array.isArray(facts.activity) ? facts.activity : []).filter((e) => isObj(e) && e.who !== 'conductor');
  const infos = new Map();
  if (logs) {
    let next = 0;
    const worker = async () => {
      while (next < crew.length) {
        const e = crew[next++];
        infos.set(e, await logs.read(e).catch(() => null));
      }
    };
    await Promise.all(Array.from({ length: Math.min(READS_AT_ONCE, crew.length) }, worker));
  }
  return workView({ ...facts, hosted: false, now }, (e) => infos.get(e) ?? null);
}

/** Details on the website, from the mirrored job record: the Foreman's task lines (the logs stay on the laptop), no terminal. */
export function mirrorWork(record, { now = Date.now() } = {}) {
  if (!isObj(record) || !Array.isArray(record.activity)) return { rows: [], costs: { steps: [], totalUsd: null }, note: NOT_SENT };
  const view = workView({ ...workFacts(record), hosted: true, now });
  return { ...view, note: view.rows.length ? ON_LAPTOP : view.note };
}
