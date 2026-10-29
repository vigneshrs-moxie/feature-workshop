// The Stage (packet M): one of a job's seven stops, and everyone who works or worked it.
// GET /api/job/:slug/stage/:stop (site/routes-stage.js) answers stageView(), built from what the
// job page already reads (runner read.job: activity, costDetail.agents, drive, permissionsPending)
// and Try it's terminal choice (read.localView). "Open in terminal" sends try-it action 'follow'
// with the row's ref; the runner (runner/index.js) checks it with followPlan(), finds a crew
// member's log with findCrewLog(), and opens the terminal on a script from continueScript() or
// followScript(). The script that follows a log runs this file: `node stage-view.js follow <file> <role>`.
//
// The site imports this file, so it imports nothing of the machine half (no child_process, no
// lib/platform.js): only fs, path and the plain helpers below.
//
//   stageView(job, stop, { activity, agents, local, platform })  the StageView (web/src/api/types.ts)
//   crewRef(entry, index) / resolveRef(activity, ref)              a row's ref and back
//   followPlan({ ref, activity, drive, lock, platform })           what 'follow' opens, or { why }
//   findCrewLog({ projectsDir, entry })                            a crew member's transcript file
//   continueScript / followScript / readableLines / followLog      the terminal side

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentInfo, detectStage } from './stages.js';
import { modelLabel } from './cost.js';
import { describeTool } from './session-log.js';

/** This file: what the follow script runs. */
export const FOLLOW_SCRIPT = fileURLToPath(import.meta.url);

// ---------- Stops ----------

// KEEP IN STEP with web/src/components/stops/stops.ts (STOPS, STAGE_STOP, STOP_STATE_WORDS).
export const STOPS = [
  { id: 'spec', label: 'Spec' },
  { id: 'investigate', label: 'Investigate' },
  { id: 'plan', label: 'Plan' },
  { id: 'build', label: 'Build' },
  { id: 'test', label: 'Test' },
  { id: 'review', label: 'Review' },
  { id: 'ship', label: 'Ship' },
];
export const STOP_IDS = STOPS.map((s) => s.id);
export const STAGE_STOP = {
  clarify: 'spec', spec: 'spec', refine: 'spec', wireframe: 'spec',
  investigate: 'investigate', 'spec-update': 'investigate',
  plan: 'plan', implement: 'build', test: 'test', review: 'review',
  pr1: 'ship', pr2: 'ship', 'staging-qa': 'ship', pr3: 'ship',
};
export const STOP_STATE_WORDS = { done: 'Done', now: 'Working now', waiting: 'Waiting for you', next: 'Not yet', skipped: 'Skipped' };

export const isStopId = (v) => STOP_IDS.includes(v);
export const stopOf = (stage) => (stage ? STAGE_STOP[stage] ?? null : null);
export const stagesOf = (stop) => Object.keys(STAGE_STOP).filter((s) => STAGE_STOP[s] === stop);

/** Each stop's state for a job, as the Job map shows it (stops.ts stopStates). */
export function stopStates(job) {
  const at = stopOf(job.stage);
  const idx = at ? STOP_IDS.indexOf(at) : -1;
  const finished = job.lane === 'done' || Boolean(job.closed);
  const skipped = new Set(job.skipped ?? []);
  const out = {};
  STOPS.forEach((s, i) => {
    const allSkipped = stagesOf(s.id).every((st) => skipped.has(st));
    let state;
    if (finished) state = i <= idx || idx < 0 ? 'done' : 'next';
    else if (i < idx) state = 'done';
    else if (i === idx) state = job.lane === 'needs-you' || job.needsYou ? 'waiting' : job.stageState === 'done' ? 'done' : 'now';
    else state = 'next';
    if (allSkipped && state !== 'now' && state !== 'waiting') state = 'skipped';
    out[s.id] = state;
  });
  return out;
}

// ---------- Who works where ----------

// Each agent's generic role word, in the order the Stage lists them. The same words as the web's
// crew pack (web/src/play/crewPack.ts ROLE_WORDS): keep the two in step.
const ROLE_WORDS = {
  conductor: 'Foreman',
  'feature-spec-writer': 'Writer',
  'feature-wireframer': 'Designer',
  'feature-investigator': 'Investigator',
  'feature-planner': 'Planner',
  'feature-implementer': 'Builder',
  'feature-tester': 'Tester',
  'feature-reviewer': 'Reviewer',
  'feature-review-permissions': 'Access reviewer',
  'feature-review-tests': 'Test reviewer',
  'feature-review-conventions': 'Rules reviewer',
  'feature-review-errors': 'Errors reviewer',
  'feature-review-db': 'Database reviewer',
  'feature-review-performance': 'Speed reviewer',
  'feature-review-ui': 'Screens reviewer',
  'feature-fable-check': 'Second look',
};
const ROLE_ORDER = Object.keys(ROLE_WORDS);
export const roleWord = (who) => ROLE_WORDS[who] ?? 'Helper';

// Which stage a crew member works (features.js stageForAgent, which isn't exported): the spec
// writer's later runs are the spec update or the refinement; the rest from lib/stages.js. An agent
// with no stage of its own (the Fable check, an unknown helper) goes by what its task says.
export function stageOfCrew(who, description = '') {
  const d = description ?? '';
  if (who === 'feature-spec-writer') {
    if (/post-investigation|spec update|update.*findings/i.test(d)) return 'spec-update';
    if (/refine/i.test(d)) return 'refine';
    return 'spec';
  }
  return agentInfo(who).stage ?? detectStage(d) ?? null;
}

// A short, stable name for one activity entry: FNV-1a over what identifies it.
function hash8(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
const entryKey = (e) => [e.sessionId ?? '', e.who ?? '', e.agentId ?? '', e.startedAt ?? '', e.description ?? ''].join('|');

/** A crew member's ref: its index in the job's activity and a check of who it is ("c3.1a2b3c4d", at most 14 characters). */
export const crewRef = (entry, index) => `c${index}.${hash8(entryKey(entry))}`;
export const REF_PATTERN = /^(foreman|c\d{1,4}\.[0-9a-f]{8})$/;

/** The activity entry a ref names (the index first, else wherever it moved to), or null. 'foreman' is not resolved here. */
export function resolveRef(activity = [], ref) {
  const m = /^c(\d{1,4})\.([0-9a-f]{8})$/.exec(String(ref ?? ''));
  if (!m) return null;
  const at = Number(m[1]);
  const same = (e) => e && e.who !== 'conductor' && hash8(entryKey(e)) === m[2];
  if (same(activity[at])) return { entry: activity[at], index: at };
  const index = activity.findIndex(same);
  return index >= 0 ? { entry: activity[index], index } : null;
}

// ---------- Opening it in a terminal ----------

const MAC_ONLY_CONTINUE = 'Opening the Foreman in a terminal works on macOS for now.';
const MAC_ONLY_WATCH = 'Following a log in a terminal works on macOS for now.';

/** Why the Foreman's conversation can't be continued in a terminal right now, or null. */
function foremanBlocked({ drive, lock, platform }) {
  if (!drive?.sessionId) return 'The Foreman hasn’t started a conversation for this job yet.';
  if (drive.mode === 'running') return 'The Foreman is answering a message sent from here. Wait for it to finish, or pause it, then open it in a terminal.';
  if (lock) return 'Another program on this computer is working on this job right now. Close it first.';
  if (drive.terminalSession && !drive.terminalSession.ended) return 'This job’s Foreman is already open in a terminal.';
  if (!drive.cwd) return 'I don’t know which folder the Foreman’s conversation ran in.';
  if (platform !== 'darwin') return MAC_ONLY_CONTINUE;
  return null;
}
function crewBlocked(entry, { platform }) {
  if (!entry?.sessionId) return 'This crew member’s log isn’t known yet.';
  if (platform !== 'darwin') return MAC_ONLY_WATCH;
  return null;
}

/**
 * What try-it action 'follow' opens for a ref: { kind: 'continue', sessionId, cwd } for the Foreman,
 * { kind: 'watch', entry, role } for a crew member, or { why } in plain words when it can't.
 */
export function followPlan({ ref, activity = [], drive = null, lock = null, platform = process.platform }) {
  if (ref === 'foreman') {
    const why = foremanBlocked({ drive, lock, platform });
    return why ? { why } : { kind: 'continue', sessionId: drive.sessionId, cwd: drive.cwd };
  }
  if (!REF_PATTERN.test(String(ref ?? ''))) return { why: 'That isn’t one of this job’s agents.' };
  const hit = resolveRef(activity, ref);
  if (!hit) return { why: 'That crew member isn’t in this job’s activity any more. Reload the page.' };
  const why = crewBlocked(hit.entry, { platform });
  return why ? { why } : { kind: 'watch', entry: hit.entry, role: roleWord(hit.entry.who) };
}

// ---------- The Stage ----------

const STATUS_OF = { running: 'working', delegating: 'working', finished: 'done', stopped: 'stopped' };
const isLive = (status) => status === 'working' || status === 'waiting';
const label = (model) => (model ? modelLabel(model) : null);
const earliest = (list) => list.filter(Boolean).sort()[0] ?? null;

// The permission (or question) waiting on one agent: by its id when the activity names it, else by
// its kind of agent. The Foreman's own have no agent.
function pendingFor(pending, entry) {
  const asks = pending.filter((p) => !p.feedbackCard);
  if (!entry) return asks.find((p) => !p.agentID && (!p.agentType || p.agentType === 'conductor')) ?? null;
  if (entry.agentId) return asks.find((p) => p.agentID === entry.agentId) ?? null;
  return asks.find((p) => p.agentType && p.agentType === entry.who) ?? null;
}
const waitingWords = (p) => (p.kind === 'question' ? 'Waiting for your answer to a question' : `Waiting for you to allow a step${p.displayName || p.toolName ? ` (${p.displayName || p.toolName})` : ''}`);

/** The model a crew member used: its own when the activity says, else the cost row for its kind and stage. */
function crewModel(entry, stage, agents) {
  if (entry.model) return entry.model;
  const rows = (agents ?? []).filter((r) => r.agentType === entry.who && (!stage || r.stage === stage));
  return [...rows].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))[0]?.model ?? null;
}

function crewRow(entry, index, { stage, agents, pending, platform }) {
  const ask = entry.state === 'running' ? pendingFor(pending, entry) : null;
  const status = ask ? 'waiting' : STATUS_OF[entry.state] ?? 'stopped';
  const why = crewBlocked(entry, { platform });
  return {
    who: entry.who ?? 'unknown',
    role: roleWord(entry.who),
    model: label(crewModel(entry, stage, agents)),
    doing: ask ? waitingWords(ask) : entry.doing ?? entry.description ?? null,
    since: entry.startedAt ?? entry.since ?? null,
    lastAt: entry.lastAt ?? null,
    status,
    terminal: { kind: 'watch', ready: !why, why },
    ref: crewRef(entry, index),
  };
}

function foremanRow(job, state, { activity, agents, pending, platform, stop }) {
  const drive = job.drive ?? null;
  const conductors = activity.filter((a) => a.who === 'conductor');
  const own = conductors.find((a) => drive?.sessionId && a.sessionId === drive.sessionId)
    ?? [...conductors].sort((a, b) => String(b.lastAt ?? '').localeCompare(String(a.lastAt ?? '')))[0] ?? null;
  const why = foremanBlocked({ drive, lock: job.lock, platform });
  const terminal = { kind: 'continue', ready: !why, why };
  // The model it used here: the conductor's cost row at this stop, else its session's.
  const stages = stagesOf(stop);
  const costRow = [...(agents ?? [])].filter((r) => r.agentType === 'conductor' && stages.includes(r.stage)).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))[0];
  const row = (fields) => ({ who: 'conductor', role: roleWord('conductor'), ...fields, terminal, ref: 'foreman' });
  if (state === 'done' || state === 'skipped' || state === 'next') {
    return row({ model: label(costRow?.model ?? null), doing: null, since: null, lastAt: null, status: 'done' });
  }
  const model = label(drive?.model ?? own?.model ?? costRow?.model ?? null);
  const now = (job.nowDoing ?? []).find((d) => d.who === 'conductor') ?? null;
  const ask = pendingFor(pending, null);
  const working = Boolean(now) || (own && ['running', 'delegating'].includes(own.state));
  let status;
  let doing;
  if (ask || drive?.terminalSession?.waitingForPermission) {
    status = 'waiting';
    doing = ask ? waitingWords(ask) : 'Waiting for you to allow a step in your terminal';
  } else if (working) {
    status = 'working';
    doing = now?.doing ?? own?.doing ?? null;
  } else if (state === 'waiting') {
    status = 'waiting';
    doing = job.waitingFor === 'permission' ? 'Waiting for a crew member’s step to be allowed' : 'Waiting for your decision';
  } else {
    status = 'stopped';
    doing = job.paused ? 'Paused' : 'Not working right now';
  }
  return row({ model, doing, since: now?.since ?? own?.since ?? null, lastAt: now?.lastAt ?? own?.lastAt ?? null, status });
}

const byRole = (a, b) => {
  const ra = ROLE_ORDER.indexOf(a.who);
  const rb = ROLE_ORDER.indexOf(b.who);
  return (ra < 0 ? ROLE_ORDER.length : ra) - (rb < 0 ? ROLE_ORDER.length : rb) || String(a.since ?? '').localeCompare(String(b.since ?? ''));
};

/**
 * One stop of a job, as the Stage page shows it (StageView in web/src/api/types.ts).
 * job: what read.job answers (stage, stageState, needsYou, lane, skipped, closed, paused, waitingFor,
 * waitingSince, nowDoing, drive, lock, history, permissionsPending, activity, costDetail.agents).
 * activity / agents: the job's activity and cost rows (default: the job's own). local: read.localView
 * (terminalApp, terminalApps). platform: process.platform (only macOS opens terminals for now).
 * Pure: reads nothing.
 */
export function stageView(job, stop, { activity = job.activity ?? [], agents = job.costDetail?.agents ?? [], local = null, platform = process.platform } = {}) {
  if (!isStopId(stop)) throw new Error(`Unknown stop: ${stop}`);
  const state = stopStates(job)[stop];
  const current = stopOf(job.stage) === stop;
  const pending = job.permissionsPending ?? [];
  const skipped = new Set(job.skipped ?? []);
  const all = stagesOf(stop);
  const stages = all.every((s) => skipped.has(s)) ? all : all.filter((s) => !skipped.has(s));

  // The crew who work this stop: by the stage their task belongs to; one with none of its own,
  // still running, works where the job is.
  const crew = [];
  activity.forEach((entry, index) => {
    if (!entry || entry.who === 'conductor') return;
    const stage = stageOfCrew(entry.who, entry.description);
    const where = stopOf(stage) ?? (current && entry.state !== 'finished' && entry.state !== 'stopped' ? stop : null);
    if (where !== stop) return;
    crew.push(crewRow(entry, index, { stage, agents, pending, platform }));
  });

  // The Foreman: on the stop it is at (working, waiting or stopped there), and among the finished
  // on the stops it has been through. Nobody yet on a stop still to come.
  const foreman = state === 'next' ? null : state === 'skipped' && !crew.length ? null : foremanRow(job, current && (state === 'now' || state === 'waiting') ? state : 'done', { activity, agents, pending, platform, stop });
  const foremanHere = foreman && current && (state === 'now' || state === 'waiting');

  const agentsHere = [...(foremanHere ? [foreman] : []), ...crew.filter((r) => isLive(r.status)).sort(byRole)];
  const finished = [...(foreman && !foremanHere ? [foreman] : []), ...crew.filter((r) => !isLive(r.status)).sort(byRole)];

  // When the job reached this stop: its first crew member's start, else the record's stage history,
  // else (where it is now) since when it waits.
  const historyAt = (job.history ?? []).filter((h) => h?.date && stopOf(STAGE_STOP[h.stage] ? h.stage : detectStage(h.stage)) === stop).map((h) => h.date);
  const since = earliest(crew.map((r) => r.since)) ?? earliest(historyAt) ?? (current && state === 'waiting' ? job.waitingSince ?? null : null);

  const apps = Array.isArray(local?.terminalApps) ? local.terminalApps : [];
  return {
    slug: job.slug,
    stop,
    label: STOPS.find((s) => s.id === stop).label,
    state,
    stateWords: STOP_STATE_WORDS[state],
    since,
    stages,
    agents: agentsHere,
    finished,
    terminalApp: local?.terminalApp ?? apps[0] ?? null,
    terminalApps: apps,
  };
}

// ---------- Finding a crew member's log ----------

const SAFE_ID = /^[\w-]{1,200}$/;

async function firstTimestamp(file) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    for (const line of buf.subarray(0, bytesRead).toString('utf8').split('\n')) {
      try { const d = JSON.parse(line); if (d.timestamp) return d.timestamp; } catch { /* a cut-off line */ }
    }
  } catch { /* unreadable */ } finally { await fh?.close(); }
  return null;
}

/**
 * The transcript file of one crew member (an activity entry: who, description, sessionId, startedAt,
 * and agentId when known), among Claude Code's logs (<projectsDir>/<project>/<sessionId>/subagents/
 * agent-<id>.jsonl beside its .meta.json). Null when it isn't found.
 */
export async function findCrewLog({ projectsDir, entry }) {
  if (!projectsDir || !entry?.sessionId || !SAFE_ID.test(entry.sessionId)) return null;
  let projects = [];
  try { projects = await fsp.readdir(projectsDir, { withFileTypes: true }); } catch { return null; }
  for (const proj of projects) {
    if (!proj.isDirectory()) continue;
    const dir = path.join(projectsDir, proj.name, entry.sessionId, 'subagents');
    let names;
    try { names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.jsonl')); } catch { continue; }
    if (entry.agentId && SAFE_ID.test(entry.agentId) && names.includes(`agent-${entry.agentId}.jsonl`)) return path.join(dir, `agent-${entry.agentId}.jsonl`);
    const matches = [];
    for (const name of names) {
      const file = path.join(dir, name);
      let meta = {};
      try { meta = JSON.parse(await fsp.readFile(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { /* no meta */ }
      if ((meta.agentType ?? 'unknown') !== (entry.who ?? 'unknown')) continue;
      if ((meta.description ?? null) !== (entry.description ?? null)) continue;
      const at = await firstTimestamp(file);
      if (entry.startedAt && at === entry.startedAt) return file;
      matches.push({ file, at });
    }
    if (matches.length === 1) return matches[0].file;
    if (matches.length) {
      const t = Date.parse(entry.startedAt ?? '') || 0;
      return matches.sort((a, b) => Math.abs((Date.parse(a.at ?? '') || 0) - t) - Math.abs((Date.parse(b.at ?? '') || 0) - t))[0].file;
    }
  }
  return null;
}

// ---------- The terminal scripts ----------

/** One argument for /bin/sh, quoted. */
export const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The script that continues the Foreman's conversation in its own folder. */
export function continueScript({ claude = 'claude', cwd, sessionId }) {
  if (!SAFE_ID.test(sessionId ?? '')) throw new Error('That conversation can’t be opened.');
  return [
    '#!/bin/sh',
    `cd ${shellQuote(cwd)} || { echo 'The Foreman’s folder isn’t there any more.'; printf 'Press Return to close this window.'; read _; exit 1; }`,
    `echo 'Continuing the Foreman’s conversation for this job. Type /exit when you are done.'`,
    `exec ${shellQuote(claude)} --resume ${shellQuote(sessionId)}`,
    '',
  ].join('\n');
}

/** The script that follows a crew member's log, read-only, and leaves the window open after. */
export function followScript({ node = process.execPath, file, role }) {
  return [
    '#!/bin/sh',
    'clear',
    `${shellQuote(node)} ${shellQuote(FOLLOW_SCRIPT)} follow ${shellQuote(file)} ${shellQuote(role)}`,
    'echo',
    `printf 'Press Return to close this window.'`,
    'read _',
    '',
  ].join('\n');
}

// ---------- Following a log (the terminal side) ----------

const clock = (at) => {
  const d = at ? new Date(at) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toTimeString().slice(0, 5) : '     ';
};
const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n') : '');
const cut = (s, n) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * The readable lines for one line of a transcript (JSONL), and whether the agent has now finished.
 * track: { pending: boolean, prompted: boolean }, carried from line to line.
 */
export function readableLines(line, role, track = { pending: false, prompted: false }) {
  let d;
  try { d = JSON.parse(line); } catch { return { lines: [], finished: false }; }
  const at = clock(d.timestamp);
  const lines = [];
  let finished = false;
  if (d.type === 'user' && d.message) {
    const c = d.message.content;
    if (Array.isArray(c) && c.some((x) => x?.type === 'tool_result')) {
      track.pending = false;
      for (const r of c.filter((x) => x?.type === 'tool_result' && x.is_error)) lines.push(`${at}   That step didn’t work: ${cut(textOf(r.content) || 'no details', 200)}`);
    } else if (!track.prompted && textOf(c).trim()) {
      track.prompted = true;
      lines.push(`${at}  Its task: ${cut(textOf(c), 600)}`);
    }
  } else if (d.type === 'assistant' && d.message) {
    const m = d.message;
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (c?.type === 'text' && c.text?.trim()) lines.push(`${at}  ${role}: ${c.text.trim()}`);
      else if (c?.type === 'tool_use') {
        track.pending = true;
        lines.push(`${at}  → ${describeTool(c.name, c.input ?? {})}`);
      }
    }
    if (m.stop_reason === 'end_turn' && !track.pending) finished = true;
  }
  return { lines, finished };
}

/**
 * Print a crew member's log as readable lines, then keep printing what it adds, until it finishes
 * (or the file goes away). Resolves when it stops. out: where lines go (console.log).
 */
export function followLog(file, role, { out = (s) => console.log(s), pollMs = 1000 } = {}) {
  return new Promise((resolve) => {
    const track = { pending: false, prompted: false };
    let offset = 0;
    let rest = '';
    let finished = false;
    let timer = null;
    out(`Following the ${role}’s log, read-only. Nothing you type here reaches it. Press Control-C to stop following.\n`);
    let over = false;
    const done = (why) => { over = true; clearInterval(timer); out(`\n${why}`); resolve(); };
    const step = () => {
      let st;
      try { st = fs.statSync(file); } catch { return done('The log isn’t there any more.'); }
      if (st.size < offset) { offset = 0; rest = ''; }
      if (st.size > offset) {
        const fd = fs.openSync(file, 'r');
        try {
          const buf = Buffer.alloc(st.size - offset);
          fs.readSync(fd, buf, 0, buf.length, offset);
          offset = st.size;
          const parts = (rest + buf.toString('utf8')).split('\n');
          rest = parts.pop();
          for (const line of parts) {
            if (!line.trim()) continue;
            const r = readableLines(line, role, track);
            for (const l of r.lines) out(l);
            finished = r.finished;
          }
        } finally { fs.closeSync(fd); }
      }
      if (finished) done(`The ${role} has finished. Nothing more will appear here.`);
    };
    step();
    if (!over) timer = setInterval(step, pollMs);
  });
}

// `node stage-view.js follow <file> <role>`: what the follow script runs in the terminal.
if (process.argv[1] && path.resolve(process.argv[1]) === FOLLOW_SCRIPT && process.argv[2] === 'follow') {
  await followLog(process.argv[3], process.argv[4] || 'crew member');
}
