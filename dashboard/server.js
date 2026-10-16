// Feature Workshop: local-only dashboard server.
// Listens on 127.0.0.1 only. Reads workflow files, session logs and git (read-only).
// What it changes goes through a job's Foreman session, and only when you click. The one exception
// is "Try it on your computer" (lib/local.js): on your click it runs the job's app, your commands
// and database switches in the job's own worktree.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadFeatures, loadGateStates, SessionIndex } from './lib/features.js';
import { STAGES, AGENTS } from './lib/stages.js';
import { PRICES, PRICES_AS_OF, whatIfConductor, costCsv, costMarkdown } from './lib/cost.js';
import { State } from './lib/state.js';
import { Driver, Busy } from './lib/driver.js';
import { renderMarkdown, indexIds } from './lib/markdown.js';
import * as git from './lib/git.js';
import { recentRepos, checkRepo } from './lib/repos.js';
import { HttpError, checkWrite, hostAllowed } from './lib/http-guard.js';
import { liveTerminals } from './lib/live.js';
import { readHookSessions } from './lib/hook-events.js';
import { classify, matchRule, POLICIES } from './lib/policy.js';
import { RuleStore, RuleError, validateRule, describeRule } from './lib/rules.js';
import { buildOverview, parseBrief } from './lib/overview.js';
import { LimitWatch } from './lib/limits.js';
import { LocalRunner } from './lib/local.js';
import { History, historyMarkdown } from './lib/history.js';
import { removeWorktree, checkWorktree } from './lib/close.js';
import { FLOWS, SKIPPABLE, PROVIDABLE, REVIEWERS, FABLE_POINTS, OPUS, FOREMAN_MODEL_IDS, MODEL_IDS, MODEL_CHOICES, defaultsFor, normalize as normalizeOptions, readOptions, writeOptions, describeOptions, foremanModel, levelsForClient, optionsAtLevel, isLevel } from './lib/options.js';
import { isWebAppPath, serveWebApp } from './lib/web-app.js';
import { EventLog, resumePoint, openStream } from './lib/events.js';
import { groupCards } from './lib/snapshot.js';
import { buildThread, pageThread } from './lib/thread.js';
import { suggestLevel, changedPaths } from './lib/levels.js';
import { GATE_PARK_MS, GateParking, RaisedVersions, isGateWaiting, isParkable, gateView, answeredBriefs } from './lib/gate.js';
import { composeReply, cleanChips, MAX_CHIPS } from './lib/compose.js';
import { skillChecker } from './lib/skill-check.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 4477;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
// The new UI, built from web/ (npm run web:build), served at /next.
const WEB_DIST = path.join(HERE, '..', 'web', 'dist');
const SHARED = { '/shared/compose.js': path.join(HERE, 'lib', 'compose.js') };
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const FEATURES_DIR = path.resolve(process.env.WORKSHOP_FEATURES_DIR || path.join(CLAUDE_DIR, 'feature-work'));
const PROJECTS_DIR = path.resolve(process.env.WORKSHOP_PROJECTS_DIR || path.join(CLAUDE_DIR, 'projects'));
const AGENTS_DIR = path.resolve(process.env.WORKSHOP_AGENTS_DIR || path.join(CLAUDE_DIR, 'agents'));
const SKILLS_DIR = path.resolve(process.env.WORKSHOP_SKILLS_DIR || path.join(CLAUDE_DIR, 'skills'));
const DEMO = Boolean(process.env.WORKSHOP_DEMO);
// Whether the installed /feature skill knows levels (read only; Settings warns when it doesn't).
const skill = skillChecker(SKILLS_DIR);
const TOKEN = crypto.randomBytes(24).toString('hex');

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'The everyday Foreman: strong and much cheaper than Fable. Asks Fable for a second look where your job options say.' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', note: 'Best judgment, highest cost and quickest to use up your limits. For large or risky jobs.' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', note: 'Cheapest. For trying the dashboard out, not real jobs.' },
];

// ---------- Engine ----------

const sessionIndex = new SessionIndex(PROJECTS_DIR);
const state = new State(process.env.WORKSHOP_STATE_DIR || (DEMO ? path.join(path.dirname(FEATURES_DIR), 'state') : undefined));
// Your "Always allow" rules (rules.json next to the dashboard's other state; see lib/rules.js).
const rules = new RuleStore(state.dir);
const HOOK_SCRIPT = path.join(HERE, 'hooks', 'record.mjs');
const queryFn = DEMO
  ? (await import('./demo/fake-query.js')).makeFakeQuery({ featuresDir: FEATURES_DIR })
  : (await import('@anthropic-ai/claude-agent-sdk')).query;
const driver = new Driver({ queryFn, state, projectsDir: PROJECTS_DIR, cliPath: process.env.WORKSHOP_CLAUDE_PATH || null, policy: policyFor, modeFor: (run) => state.policyFor(run.featureDir) });
// Whether auto mode works for this account, as the last reply that asked for it found out.
driver.on('auto-mode', ({ available, reason = null }) => {
  (async () => {
    const was = (await state.getSettings()).autoMode;
    if (was?.available === available && (was?.reason ?? null) === reason) return;
    await state.setSettings({ autoMode: { available, reason: available ? null : reason, checkedAt: new Date().toISOString() } });
    settingsChanged();
  })().catch((err) => console.error(err));
});
// Claude usage limits: pause everything when one is reached, carry on when it resets.
// A paused job is carried on only if it's still driven from here by the same Foreman session.
const limits = new LimitWatch({
  driver, state,
  canResume: async (job) => {
    const f = await featureBySlug(job.slug);
    if (!f || f.closed || closing.has(f.dir)) return false; // marked done meanwhile
    const drive = f ? await driveState(f) : null;
    // A reply held for a job with no Foreman session yet starts one, as long as none has started since.
    if (job.send && !job.sessionId) return Boolean(drive && ['none', 'terminal-open'].includes(drive.mode));
    return Boolean(drive && drive.mode === 'workshop' && drive.sessionId === job.sessionId);
  },
});
driver.on('usage-limit', (e) => { limits.onLimit(e).catch((err) => console.error(err)); });
driver.on('usage-status', (info) => limits.onStatus(info));
// Trying a job's work on this computer (its own port, dev server, commands, terminal, database).
const local = new LocalRunner({ state, demo: DEMO });
// Jobs being marked done right now (sends and automatic carry-ons wait).
const closing = new Set();
// Past Claude Code conversations, to start a job from one.
const history = new History(PROJECTS_DIR);
async function historyContext() {
  const linked = new Map();
  for (const f of await features()) {
    for (const id of f.sessionIds ?? []) linked.set(id, f.slug);
    if (f.options?.from_session?.id) for (const id of f.options.from_session.chain ?? [f.options.from_session.id]) linked.set(id, f.slug);
  }
  const ownSessions = new Set([...Object.values(await state.allSessions()).map((x) => x.sessionId), ...driver.list().map((r) => r.sessionId)].filter(Boolean));
  return { linked, ownSessions };
}

const isInside = (p, dir) => {
  if (!p || !dir) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// Routine steps are handled without asking (see lib/policy.js); everything else comes to you.
async function policyFor(run, toolName, input, opts) {
  const mode = await state.policyFor(run.featureDir);
  const f = (await features()).find((x) => x.dir === run.featureDir);
  const repo = f?.repoPath ?? run.cwd;
  const worktrees = [f?.worktree, f?.statusWorktree, repo && f ? path.join(path.dirname(repo), `orbit-${f.slug}`) : null].filter(Boolean);
  const specDirs = [repo ? path.join(repo, 'docs', 'plans') : null, f?.spec?.path && path.isAbsolute(f.spec.path) ? path.dirname(f.spec.path) : null].filter(Boolean);
  return classify(toolName, input, {
    mode, stage: f?.stage ?? 'spec', featureDir: run.featureDir, worktrees, repoPath: repo, specDirs,
    cwd: run.cwd, defaultToNo: Boolean(opts?.defaultToNo), rules: await rules.list(),
  });
}

// Read access the Foreman gets without asking: its own instructions and the jobs' private folders.
// Anything that changes files or runs commands still asks you.
async function readDirs() {
  const out = [];
  for (const d of [SKILLS_DIR, AGENTS_DIR, FEATURES_DIR]) {
    try { if ((await fsp.stat(d)).isDirectory()) out.push(d); } catch { /* missing */ }
  }
  return out;
}

async function crewModels() {
  const out = {};
  for (const type of Object.keys(AGENTS)) {
    if (type === 'conductor') continue;
    try {
      const text = await fsp.readFile(path.join(AGENTS_DIR, `${type}.md`), 'utf8');
      const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
      const field = (k) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(front)?.[1].trim().replace(/^["']|["']$/g, '') ?? null;
      out[type] = { model: field('model'), effort: field('effort') };
    } catch {
      out[type] = { model: null, effort: null };
    }
  }
  return out;
}

let knownRepos = { at: 0, list: [] };
async function repoList() {
  if (Date.now() - knownRepos.at > 60000) {
    const extra = (process.env.WORKSHOP_EXTRA_REPOS ?? '').split(path.delimiter).filter(Boolean);
    knownRepos = { at: Date.now(), list: (await recentRepos(sessionIndex, extra)).map((r) => r.path) };
  }
  return knownRepos.list;
}

let cached = null;
async function features() {
  if (cached && Date.now() - cached.at < 1500) return cached.list;
  runEnds = await state.lastRunEnds();
  const saved = await state.allSessions();
  const overrides = Object.fromEntries(Object.entries(saved).filter(([, v]) => v.repoPath || v.branch).map(([k, v]) => [k, { repoPath: v.repoPath, branch: v.branch }]));
  const list = await loadFeatures({ featuresDir: FEATURES_DIR, sessionIndex, overrides, knownRepos: await repoList() });
  // Jobs you marked done or dropped (kept in the dashboard's own state; the job's records are untouched).
  for (const f of list) f.closed = saved[f.dir]?.closed ?? null;
  for (const f of list) noteRaisedVersions(f);
  cached = { at: Date.now(), list };
  return list;
}
const featureBySlug = async (slug) => (await features()).find((f) => f.slug === slug) ?? null;

// The spec and artifact versions each brief was raised at (lib/gate.js RaisedVersions), noted
// whenever the jobs are read. The gate card compares them with the versions now (gate.stale).
const raisedVersions = new RaisedVersions();
const noteRaisedVersions = (f) => raisedVersions.note(f.dir, f.statusBriefFile, f.versions);

// A marked done or dropped job that hasn't changed since: off the board, no gate.
const closedOff = (f) => Boolean(f.closed && !(f.updatedAt && f.updatedAt > f.closed.at));

// Gates left waiting too long (lib/gate.js): parked by time (still under Needs you, with a
// "parked" chip), and alerted once each with a 'gate-stale' event. WORKSHOP_GATE_PARK_MS shortens
// the 4 hours for tests and the demo. The alerted gates are kept in gate-parking.json in the
// dashboard's state folder, so a restart doesn't alert them again.
const PARK_MS = Number(process.env.WORKSHOP_GATE_PARK_MS) > 0 ? Number(process.env.WORKSHOP_GATE_PARK_MS) : GATE_PARK_MS;
// How often the timer looks: every 5 minutes (a quarter of the time when it is shortened, at least
// 200 ms). The demo looks every 30 seconds, so its gate seeded 5 hours ago is alerted soon after start.
const PARK_CHECK_MS = Math.min(DEMO ? 30_000 : 5 * 60_000, Math.max(200, Math.floor(PARK_MS / 4)));
const parking = new GateParking({ thresholdMs: PARK_MS, file: path.join(state.dir, 'gate-parking.json') });
const gateOf = (f, runActive) => ({ slug: f.slug, briefNumber: f.currentBrief?.number ?? null, briefAt: f.currentBrief?.at ?? null, waitingSince: f.gateWaitingSince, runActive: Boolean(runActive) });
const gateParked = (f, runActive) => isParkable(f) && !closedOff(f) && parking.isParked(gateOf(f, runActive));
// Briefs answered from a gate card: read from the audit once at start, then kept up as replies are
// sent (or held until the usage limit resets: you've decided, so the gate isn't parked, unless
// that held reply is dropped). The same rule as answeredBriefs.
const noteAnswered = (e) => { if (e?.featureDir) parking.noteAudit(e.slug ?? path.basename(e.featureDir), e); };
state.on('audit', noteAnswered);

// The jobs for the timer: the cached full list when it is fresh, else a light read of each job
// folder (status.json, brief files; no session logs, no git), so the timer stays cheap.
async function gateJobs() {
  if (cached && Date.now() - cached.at < Math.min(PARK_CHECK_MS, 60_000)) return cached.list;
  const saved = await state.allSessions();
  const list = await loadGateStates({ featuresDir: FEATURES_DIR });
  for (const f of list) { f.closed = saved[f.dir]?.closed ?? null; noteRaisedVersions(f); }
  return list;
}
async function checkParkedGates() {
  const waiting = (await gateJobs()).filter((f) => isParkable(f) && !closedOff(f));
  const gates = waiting.map((f) => gateOf(f, driver.activeRunFor({ featureDir: f.dir })));
  let changed = parking.trim(gates);
  for (const g of parking.due(gates)) {
    parking.mark(g);
    changed = true;
    events.emit('gate-stale', g.slug, { job: g.slug, briefNumber: g.briefNumber, waitingSince: g.waitingSince });
  }
  if (changed) {
    await parking.save();
    cached = null;
    broadcast('change', { at: Date.now() });
  }
}
// The timer never keeps the process alive.
async function startGateParking() {
  await parking.load();
  for (const e of await state.auditAll()) noteAnswered(e);
  let checking = false;
  setInterval(() => {
    if (checking) return;
    checking = true;
    checkParkedGates().catch((err) => console.error(err)).finally(() => { checking = false; });
  }, PARK_CHECK_MS).unref();
}

// The paths changed on a job's branch (for the rules' level), only for the job page. Cached per
// job by worktree, base and status.json's updated_at, and at most a minute old, so git runs at most
// about once a minute per open job, never for the snapshot.
const DIFF_TTL_MS = 60_000;
const diffCache = new Map();
async function changedPathsFor(f) {
  const base = f.baseSha ?? f.baseBranch;
  if (!f.worktree || !base) return null;
  const key = `${f.worktree}\n${base}\n${f.updatedAt ?? ''}`;
  const hit = diffCache.get(f.dir);
  if (hit && hit.key === key && Date.now() - hit.at < DIFF_TTL_MS) return hit.paths;
  const paths = await changedPaths(f.worktree, base);
  diffCache.set(f.dir, { key, at: Date.now(), paths });
  return paths;
}

// Claude Code terminals open in this job's repository or worktree right now.
async function terminalsFor(f) {
  const open = DEMO ? [] : await liveTerminals();
  return open.filter((t) => t.cwd && ((f.repoPath && isInside(t.cwd, f.repoPath)) || (f.worktree && isInside(t.cwd, f.worktree))));
}

// Terminal sessions seen through the optional live link that worked on this job.
async function hookSessionsFor(f) {
  const { enabled, sessions } = await readHookSessions(state.dir);
  return { enabled, sessions: sessions.filter((s) => s.mentions.includes(f.slug)) };
}

// Who may reply to this job's Foreman right now.
async function driveState(f) {
  const run = driver.activeRunFor({ featureDir: f.dir });
  const saved = await state.sessionFor(f.dir);
  const cs = f.conductorSession;
  const sessionId = cs?.sessionId ?? saved?.sessionId ?? null;
  const terminals = await terminalsFor(f);
  const hook = await hookSessionsFor(f);
  const liveHook = hook.sessions.filter((s) => !s.ended).sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))[0] ?? null;
  const base = { sessionId, cwd: cs?.cwd ?? saved?.cwd ?? f.repoPath ?? null, model: cs?.model ?? saved?.model ?? null, terminals, liveLink: hook.enabled, terminalSession: liveHook };
  if (run) return { ...base, mode: 'running', runId: run.id };
  if (liveHook && (!saved?.takenOverAt || String(liveHook.lastAt) > saved.takenOverAt)) return { ...base, mode: 'terminal', lastTerminalAt: liveHook.lastAt, sessionId: liveHook.sessionId };
  if (!sessionId) return { ...base, mode: terminals.length ? 'terminal-open' : 'none' };
  const takenOverAt = saved?.sessionId === sessionId ? saved.takenOverAt ?? null : null;
  const lastTerminalAt = cs?.lastTerminalAt ?? null;
  if (lastTerminalAt && (!takenOverAt || lastTerminalAt > takenOverAt)) return { ...base, mode: 'terminal', lastTerminalAt };
  return { ...base, mode: 'workshop', takenOverAt };
}

// ---------- Views ----------

const ACTIVE_RUN = new Set(['starting', 'running', 'waiting_permission', 'stopping']);

function runFor(f) {
  return driver.list().filter((r) => r.featureDir === f.dir).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
}

// When a reply sent from the dashboard ends, the process that ran it (and any workers inside it)
// has ended too. Agents whose logs stopped before that moment are not working, even if their log
// stops mid-task (for example after a pause). Anything with newer activity still counts.
function stillRunning(f, a, active) {
  if (a.state !== 'running') return false;
  if (active) return true;
  const ended = runEnds[f.dir];
  return !ended || !a.lastAt || a.lastAt > ended.at;
}
let runEnds = {};

function boardCard(f, run) {
  const ids = STAGES.map((s) => s.id).filter((id) => !f.skipped.includes(id));
  const at = ids.indexOf(f.stage);
  const active = run && ACTIVE_RUN.has(run.status) ? run : null;
  const pendingList = driver.pendingPermissions().filter((p) => p.featureDir === f.dir);
  const running = f.activity.filter((a) => stillRunning(f, a, active));
  // The record says "working" but nobody is: say so honestly instead of showing a busy crew.
  const notRunning = !active && !running.length && f.stageState === 'working';
  const limitPaused = !active && limits.pausedJob(f.dir) ? limits.view().resetsAt : null;
  const pausedHere = Boolean(limitPaused) || (notRunning && runEnds[f.dir]?.status === 'stopped');
  const nowDoing = running.map((a) => ({
    who: a.who, name: a.name, doing: a.doing, quietMs: a.quiet?.quietMs ?? null,
    since: a.who === 'conductor' ? a.since : a.startedAt ?? a.since, lastAt: a.lastAt,
  }));
  if (active && !nowDoing.length) {
    nowDoing.push({ who: 'conductor', name: 'Foreman', doing: active.lastAction ?? 'Reading your message', since: active.startedAt });
  }
  return {
    slug: f.slug, title: f.title, kind: f.kind, kindGuessed: f.kindGuessed, project: f.project, route: f.route, skipped: f.skipped,
    stage: f.stage, stageState: active ? 'working' : pausedHere ? 'paused' : notRunning ? 'idle' : f.stageState, paused: pausedHere, waitingFor: pendingList.length ? 'permission' : f.waitingFor,
    waitingSince: pendingList.length ? pendingList[0].createdAt : f.waitingSince,
    needsYou: pendingList.length > 0 || (!active && f.needsYou), working: Boolean(active) || running.length > 0, quiet: f.quiet && running.length > 0,
    nowDoing, firstQuestion: f.questions[0]?.text ?? null, questions: f.questions.length,
    unconfirmed: f.decidedOnYourBehalf.filter((d) => !d.confirmed).length,
    headline: f.latestBrief?.headline ?? (f.sources.statusJson ? null : f.currentText) ?? null, nextProposed: f.nextProposed,
    repo: f.repoPath ? { name: path.basename(f.repoPath), branch: f.branch } : null,
    cost: { totalUsd: Math.max(f.cost.totalUsd, active?.costUsd ?? 0), source: f.cost.source },
    progress: { done: f.stageState === 'done' ? ids.length : Math.max(0, at), total: ids.length },
    updatedAt: f.updatedAt, sources: f.sources, permissions: pendingList.length, limitPaused, limitAuto: limits.autoResume,
    // Levels: chosen (options.json), the Foreman's suggestion (status.json), the rules' (description only here).
    level: f.level, suggestedLevel: f.suggestedLevel, levelReason: f.levelReason, rulesLevel: f.rulesLevel,
    // A gate left waiting past the parking time: still Needs you, with a "parked" chip.
    parked: gateParked(f, active),
    // Marked done or dropped: off the board, unless something is going on or the job changed since.
    ...(f.closed && !active && !running.length && !(f.updatedAt && f.updatedAt > f.closed.at)
      ? { closed: f.closed, needsYou: false, working: false, quiet: false, waitingFor: null, parked: false, stageState: f.closed.as === 'done' ? 'done' : 'idle' }
      : f.closed ? { closedEarlier: f.closed } : {}),
  };
}

// Jobs started from the dashboard whose folder the Foreman hasn't created yet.
function startingCards(list) {
  return driver.list()
    .filter((r) => r.newJob && ACTIVE_RUN.has(r.status) && !list.some((f) => f.dir === r.featureDir))
    .map((r) => {
      const pending = driver.pendingPermissions().filter((p) => p.runId === r.id);
      return {
        slug: r.slug, title: r.title, kind: r.kind === 'bug' ? 'bug' : 'feature', kindGuessed: false,
        project: { name: path.basename(r.cwd ?? ''), path: r.cwd }, route: null, skipped: [], stage: 'spec',
        stageState: 'working', waitingFor: pending.length ? 'permission' : null, waitingSince: pending[0]?.createdAt ?? null,
        needsYou: pending.length > 0, working: true, quiet: false,
        nowDoing: [{ who: 'conductor', name: 'Foreman', doing: r.lastAction ?? 'Reading your request', since: r.startedAt }],
        firstQuestion: null, questions: 0, unconfirmed: 0, headline: null, nextProposed: null,
        cost: { totalUsd: r.costUsd ?? 0, source: 'claude-code' }, progress: { done: 0, total: 11 }, updatedAt: r.startedAt,
        sources: { workflowStatus: false, statusJson: false }, permissions: pending.length, starting: true,
        level: null, suggestedLevel: null, levelReason: null, rulesLevel: null, parked: false,
      };
    });
}

const idHref = (f) => (id) => `#/job/${encodeURIComponent(f.slug)}/id/${encodeURIComponent(id)}`;

// Read a file inside a folder, refusing anything that escapes it. noLink: refuse the file itself
// being a symlink (it could point anywhere), or anything but a plain file.
async function readInside(dir, rel, { noLink = false } = {}) {
  const root = path.resolve(dir);
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) return null;
  if (noLink) {
    const st = await fsp.lstat(file).catch(() => null);
    if (!st?.isFile()) return null;
  }
  try { return await fsp.readFile(file, 'utf8'); } catch { return null; }
}

// The spec lives in the repository; its path comes from the job's own records.
function specFile(f) {
  const p = f.spec?.path;
  if (!p) return null;
  if (path.isAbsolute(p)) return p;
  return f.repoPath ? path.resolve(f.repoPath, p) : null;
}

async function jobDocs(f) {
  const docs = [];
  const spec = specFile(f);
  if (spec) { try { docs.push({ name: 'Product spec', file: 'spec', text: await fsp.readFile(spec, 'utf8'), isSpec: true }); } catch { /* not readable */ } }
  for (const a of f.artifacts) {
    const text = await readInside(f.dir, a.file);
    if (text !== null) docs.push({ name: a.name, file: a.file, text });
  }
  return docs;
}

// One page of the conversation with the Foreman (see lib/thread.js): the newest items, or the ones
// just before the item `before`. Only the replies on this page are rendered. Null: `before` unknown.
async function threadPage(f, audit, { before = null } = {}) {
  const briefs = [];
  for (const b of f.briefs) {
    const st = await fsp.stat(path.join(f.dir, b.file)).catch(() => null);
    const parsed = parseBrief((await readInside(f.dir, b.file)) ?? '');
    // Versions only on the brief status.json names (as first seen); older briefs have none.
    const versions = b.file === f.statusBriefFile ? raisedVersions.get(f.dir, b.file) ?? f.versions : null;
    briefs.push({ number: b.number, stage: b.stage, file: b.file, at: st?.mtime.toISOString() ?? null, headline: parsed.headline, point: parsed.happened[0] ?? parsed.next ?? null, versions });
  }
  const page = pageThread(buildThread({ briefs, audit, autoResume: limits.autoResume }), { before });
  if (!page) return null;
  const items = page.items.map(({ reply, ...it }) => (it.kind === 'reply' ? { ...it, html: renderMarkdown(reply, { idHref: idHref(f) }) } : it));
  return { items, more: page.more };
}

async function jobDetail(f) {
  const run = runFor(f);
  const latestPath = f.latestBrief?.path ?? f.briefs.at(-1)?.file ?? null;
  let latestBrief = null;
  if (latestPath) {
    const text = await readInside(f.dir, latestPath);
    const st = await fsp.stat(path.join(f.dir, latestPath)).catch(() => null);
    if (text !== null) latestBrief = { number: f.latestBrief?.number ?? f.briefs.at(-1)?.number ?? null, path: latestPath, html: renderMarkdown(text, { idHref: idHref(f) }), text, at: st?.mtime.toISOString() ?? null };
  }
  // The Foreman's last answer to something sent from here, shown when it's newer than the brief.
  // All of the job's audit lines are read, so thread ids don't depend on how far back we looked.
  const audit = await state.auditFor(f.dir, Infinity);
  const lastEnd = [...audit].reverse().find((e) => e.action === 'run-ended' && e.reply);
  const lastReply = lastEnd ? { at: lastEnd.at, status: lastEnd.status, html: renderMarkdown(lastEnd.reply, { idHref: idHref(f) }) } : null;
  const drive = await driveState(f);
  const settings = await state.getSettings();

  // Things worth knowing before you act, found by the dashboard itself.
  const headsUp = [];
  if (!f.repoPath) headsUp.push({ kind: 'repo', text: 'I couldn’t tell which repository this job is in. Pick it below so the Foreman knows where to work.' });
  if (f.locate?.checkoutBranch && f.branch && f.locate.checkoutBranch === f.branch && ['plan', 'implement'].includes(f.stage)) {
    headsUp.push({ kind: 'branch', text: `${f.branch} is checked out in your main folder. The Foreman builds in its own worktree, which needs that branch free: run “git switch main” in your main folder before building starts.` });
  }
  if (drive.mode === 'terminal-open') headsUp.push({ kind: 'terminal', text: `Claude Code is open in this repository in ${drive.terminals.length} terminal${drive.terminals.length === 1 ? '' : 's'}. If one of them is this job’s Foreman, keep talking to it there, or close it (type /exit) before continuing here.` });
  if (drive.terminalSession?.waitingForPermission) headsUp.push({ kind: 'permission', text: `This job’s Foreman in your terminal is waiting for a permission click: ${drive.terminalSession.waitingMessage}` });

  const latestBriefText = latestBrief?.text ?? null;
  const overview = buildOverview({
    status: f.statusSummary ? { summary: f.statusSummary, nextProposed: f.nextProposed, updatedAt: f.updatedAt } : null,
    briefText: latestBriefText, briefAt: latestBrief?.at, recordText: latestBriefText ? null : f.recordText, recordAt: f.recordAt,
    questions: f.questions, decided: f.decidedOnYourBehalf, headsUp,
  });

  // The rules' level with the branch's changed paths added, once there's a worktree and a base
  // (git runs here only, cached: see changedPathsFor). Without them, the description alone.
  // (null: git couldn't tell, so the description alone; [] is "nothing changed yet".)
  const paths = await changedPathsFor(f);
  const rulesLevel = paths ? { ...suggestLevel({ description: f.description, paths }), fromDiff: true, changedFiles: paths.length } : f.rulesLevel;

  // The gate card: what the Foreman waits for you to decide (null when it isn't waiting).
  let gate = null;
  if (isGateWaiting(f) && !closedOff(f)) {
    const cb = f.currentBrief;
    let headline = cb?.headline ?? null;
    if (!headline && cb?.file) headline = parseBrief(cb.file === latestBrief?.path ? latestBrief.text : (await readInside(f.dir, cb.file)) ?? '').headline ?? null;
    const runActive = Boolean(run && ACTIVE_RUN.has(run.status));
    gate = gateView(
      { ...f, decided: f.decidedOnYourBehalf, waitingSince: f.gateWaitingSince },
      {
        brief: cb ? { ...cb, headline } : null, raisedVersions: f.statusBriefFile ? raisedVersions.get(f.dir, f.statusBriefFile) : null,
        parked: gateParked(f, runActive), runActive, usage: limits.view(),
      },
    );
  }

  const page = await threadPage(f, audit);
  return {
    ...boardCard(f, run),
    rulesLevel, gate,
    // Briefs already decided: a deciding gate reply (audit 'send' lines with gateBrief), or a
    // decision from the classic page sent after the current brief was written.
    answeredBriefs: answeredBriefs(audit, f.currentBrief),
    dir: f.dir, repoPath: f.repoPath, branch: f.branch, worktree: f.worktree, baseSha: f.baseSha, prs: f.prs,
    options: f.options, optionsSummary: f.options ? describeOptions(f.options) : null,
    spec: f.spec, specFile: specFile(f), currentText: f.currentText, questionsFull: f.questions, decidedOnYourBehalf: f.decidedOnYourBehalf,
    latestBrief, briefs: f.briefs, approvals: f.approvals, history: f.history, artifacts: f.artifacts, recordedArtifacts: f.recordedArtifacts,
    costDetail: { ...f.cost, whatIf: whatIfConductor(f.cost.agents) },
    activity: f.activity.map((a) => (a.state === 'running' && !stillRunning(f, a, run && ACTIVE_RUN.has(run.status) ? run : null) ? { ...a, state: 'stopped' } : a)),
    drive, run, runs: driver.list().filter((r) => r.featureDir === f.dir), overview, thread: page.items, threadMore: page.more, locate: f.locate,
    // policy: the setting in force for this job; policyOverride: the job's own (null: it follows yours).
    policy: settings.jobPolicy?.[f.dir] || settings.policy, policyOverride: settings.jobPolicy?.[f.dir] ?? null, globalPolicy: settings.policy, autoMode: settings.autoMode,
    permissionsPending: driver.pendingPermissions().filter((p) => p.featureDir === f.dir),
    lastReply, audit: audit.slice(-50), warnings: f.warnings,
    statusForCompose: statusForCompose(f),
    // A gate reply waiting for the usage limit to reset ({ kind, gateBrief, at }), or null.
    heldReply: limits.heldFor(f.dir),
  };
}

// What composeReply needs from the job's records (the page composes with the same).
function statusForCompose(f) {
  return { questions: f.questions, decidedOnYourBehalf: f.decidedOnYourBehalf, nextProposed: f.nextProposed, spec: f.spec, artifacts: f.recordedArtifacts, brief: f.latestBrief };
}

// ---------- HTTP ----------

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, ...extra });
  res.end(body);
}
const sendJson = (res, status, data) => send(res, status, JSON.stringify(data), TYPES['.json']);

async function serveStatic(urlPath, res) {
  if (SHARED[urlPath]) return send(res, 200, await fsp.readFile(SHARED[urlPath]), TYPES['.js']);
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  try {
    send(res, 200, await fsp.readFile(file), TYPES[path.extname(file)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found');
  }
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 256 * 1024) throw new HttpError(413, 'Too much data.');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'That wasn’t valid JSON.'); }
}

function limitMessage() {
  const v = limits.view();
  const when = v.resetsAt ? new Date(v.resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  return `Claude’s ${v.label ?? 'usage limit'} is reached${when ? ` (${v.resetKnown ? 'it resets' : 'trying again'} around ${when})` : ''}. Paused jobs carry on by themselves then. If you know it’s lifted (for example you turned on extra usage), use “Carry on now” at the top of the page.`;
}

const str = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : '');

// ---------- Sending to a job's Foreman (…/send and …/gate) ----------

/**
 * The checks before anything goes to a job's Foreman, then what starting the reply needs: the
 * model, where it runs, which session, and the exact text (a job with no Foreman session yet gets
 * one that picks it up from its files). Each refusal is a 409 the page explains.
 * holding: the reply waits for the usage limit to reset (…/gate startAfterReset), so the limit
 * doesn't refuse it.
 */
function sendPlan(f, drive, body, text, { holding = false } = {}) {
  if (drive.mode === 'running') throw new HttpError(409, 'The Foreman is still working on your last message. Wait for it, or pause it first.');
  if (closing.has(f.dir)) throw new HttpError(409, 'This job is being marked done right now. Wait a moment.');
  if (!holding && limits.isLimited() && body.despiteLimit !== true) throw new HttpError(409, limitMessage(), { code: 'limited' });
  if (drive.mode === 'terminal') throw new HttpError(409, 'This job’s Foreman was last used in your terminal.', { code: 'terminal', lastTerminalAt: drive.lastTerminalAt });
  if (drive.mode === 'terminal-open' && body.confirmNoTerminal !== true) throw new HttpError(409, 'Claude Code is open in this repository in a terminal. Make sure none of those windows is this job’s Foreman, then confirm.', { code: 'terminal-open', terminals: drive.terminals.length });
  const model = MODELS.some((x) => x.id === body.model) ? body.model : drive.model ?? OPUS;
  const cwd = drive.cwd ?? f.repoPath;
  if (!cwd) throw new HttpError(400, 'I don’t know which repository this job belongs to.');
  const fresh = drive.mode === 'none' || drive.mode === 'terminal-open';
  return {
    featureDir: f.dir, slug: f.slug, title: f.title, cwd, model,
    sessionId: fresh ? null : drive.sessionId,
    text: fresh ? `/feature ${f.slug} Private folder: ${f.dir}\n\n${text}` : text,
  };
}

/** Start the reply sendPlan prepared. gateBrief: the brief a gate card's reply answers (audited). */
async function startSend(f, out, { kind, gateBrief = null }) {
  const run = await driver.start({ ...out, kind, gateBrief, additionalDirectories: await readDirs() });
  await limits.forget(f.dir); // you've picked it up yourself
  await reopenIfClosed(f);
  cached = null;
  return run;
}

async function reopenIfClosed(f) {
  if (!f.closed) return;
  await state.setSession(f.dir, { closed: null });
  await state.audit({ action: 'reopen', featureDir: f.dir, slug: f.slug, how: 'message' });
}

// The gate card's body, checked: kind, the brief it answers, at most 3 answers, 20 verdicts,
// MAX_CHIPS chips and a 4,000-character note. Anything off is a 400, and nothing is sent.
const GATE_KINDS = ['approve', 'changes', 'message', 'stop'];
const GATE_NOTE_MAX = 4000;
function byId(v, max, what, each) {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, `${what}: expected them by id.`);
  const entries = Object.entries(v);
  if (entries.length > max) throw new HttpError(400, `${what}: at most ${max}.`);
  return Object.fromEntries(entries.map(([k, x]) => {
    if (k.length > 100 || !x || typeof x !== 'object' || Array.isArray(x)) throw new HttpError(400, `${what}: one of them isn’t readable.`);
    return [k, each(x)];
  }));
}
// A brief number from the page (1–99,999), or null when none is given.
function readBriefNumber(v) {
  if (v === undefined || v === null) return null;
  if (!Number.isInteger(v) || v < 1 || v > 99999) throw new HttpError(400, 'That isn’t a brief number.');
  return v;
}
function readGateBody(body) {
  const kind = GATE_KINDS.includes(body.kind) ? body.kind : null;
  if (!kind) throw new HttpError(400, 'Unknown decision: approve, changes, message or stop.');
  const briefNumber = readBriefNumber(body.briefNumber);
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') throw new HttpError(400, 'The note must be text.');
  const note = body.note ?? '';
  if (note.length > GATE_NOTE_MAX) throw new HttpError(400, `The note is too long (at most ${GATE_NOTE_MAX.toLocaleString('en')} characters).`);
  if (kind === 'changes' && !note.trim()) throw new HttpError(400, 'Say what to change.');
  const answers = byId(body.answers, 3, 'Answers', (a) => ({ ...(str(a.choice, 100) ? { choice: str(a.choice, 100) } : {}), ...(str(a.other, 1000) ? { other: str(a.other, 1000) } : {}) }));
  const verdicts = byId(body.verdicts, 20, 'Verdicts', (v) => {
    if (!['confirm', 'change'].includes(v.verdict)) throw new HttpError(400, 'Verdicts: confirm or change.');
    return { verdict: v.verdict, ...(str(v.note, 1000) ? { note: str(v.note, 1000) } : {}) };
  });
  if (body.chips !== undefined && body.chips !== null && !Array.isArray(body.chips)) throw new HttpError(400, 'Chips: expected a list.');
  const chips = body.chips ?? [];
  if (chips.length > MAX_CHIPS) throw new HttpError(400, `Chips: at most ${MAX_CHIPS}.`);
  // Chips change how the next stage runs; a stop has no next stage.
  if (kind === 'stop' && chips.length) throw new HttpError(400, 'A stop can’t carry option changes.');
  // "Edit, then approve": the reply as you edited it, sent instead of the composed one (the chips
  // still change the options). Approvals only; the same 20,000 characters as /send.
  if (body.text !== undefined && body.text !== null && typeof body.text !== 'string') throw new HttpError(400, 'The edited reply must be text.');
  tooLong(body.text, 'The edited reply');
  const edited = str(body.text ?? '').trim() || null;
  if (edited && kind !== 'approve') throw new HttpError(400, 'Only an approval can carry an edited reply.');
  return { kind, briefNumber, note, answers, verdicts, chips, edited, startAfterReset: body.startAfterReset === true };
}

// A reply (…/send text, …/gate edited text) longer than this is refused, not cut short.
const TEXT_MAX = 20000;
function tooLong(v, what) {
  if (typeof v === 'string' && v.length > TEXT_MAX) throw new HttpError(400, `${what} is too long (at most ${TEXT_MAX.toLocaleString('en')} characters).`);
}

// A gate reply for a brief the Foreman has moved on from: 409 stale-brief, nothing is sent.
function staleBriefCheck(f, briefNumber) {
  const now = f.currentBrief?.number;
  if (briefNumber && now && now !== briefNumber) {
    throw new HttpError(409, `The Foreman has moved on to brief ${now} since this card was shown. Nothing was sent; decide on the new brief.`, { code: 'stale-brief', briefNumber: now });
  }
}

// The gate as the job page shows it (gateView), enough to tell whether it is stale; null when the Foreman isn't waiting.
function gateNow(f) {
  if (!isGateWaiting(f) || closedOff(f)) return null;
  return gateView({ ...f, decided: f.decidedOnYourBehalf, waitingSince: f.gateWaitingSince }, { raisedVersions: f.statusBriefFile ? raisedVersions.get(f.dir, f.statusBriefFile) : null });
}

// The status fields composeReply reads, without the ones the job's records leave empty (null).
const present = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

const OPTION_KEYS = ['schema_version', 'level', 'flow', 'skip', 'provided', 'reviewers', 'review_rounds', 'manual_test', 'fable_checks', 'models', 'notes'];
/**
 * The job's options after the gate card's chips (the workflow's job-options.md, "Option lines from
 * the gate card"): skip adds the stage to `skip`, ask Fable adds the point to `fable_checks`, a
 * level change is optionsAtLevel (the new level's skip, reviewers and Fable defaults; the job's own
 * provided documents, notes and fix rounds; manual test and models only where they were the job's
 * own choice), then the other chips apply on top. Lighter, heavier and "I'll do it" are for the
 * next step only: their line in the reply is the instruction, options.json doesn't change. Null: no change.
 */
function chipOptions(current, chips) {
  const patching = chips.filter((c) => ['skip', 'fable', 'level'].includes(c.kind));
  if (!patching.length) return null;
  const before = current ?? defaultsFor('auto');
  let o = Object.fromEntries(OPTION_KEYS.filter((k) => k in before).map((k) => [k, structuredClone(before[k])]));
  const lv = patching.find((c) => c.kind === 'level');
  if (lv) o = levelOptions(before, lv.level);
  for (const c of patching) {
    if (c.kind === 'skip' && !o.skip.includes(c.stage)) o.skip = SKIPPABLE.map((s) => s.id).filter((s) => s === c.stage || o.skip.includes(s));
    if (c.kind === 'fable' && !o.fable_checks.includes(c.point)) o.fable_checks = FABLE_POINTS.map((p) => p.id).filter((p) => p === c.point || o.fable_checks.includes(p));
  }
  return o;
}

// optionsAtLevel, with its refusals as a 400.
function levelOptions(current, level) {
  try { return optionsAtLevel(current, level); } catch (err) { throw new HttpError(400, err.message); }
}

async function saveChipOptions(f, options) {
  if (!options) return;
  await writeOptions(f.dir, options, { title: f.options?.title ?? f.title, repo: f.options?.repo, kind: f.options?.kind, from_session: f.options?.from_session });
  await state.audit({ action: 'options', featureDir: f.dir, slug: f.slug, options, via: 'gate', was: f.options?.level ?? null });
  cached = null;
}

// ---------- A job's notes (notes.md in its private folder) ----------

const NOTES_MAX = 20000;
const notesFile = (f) => path.join(f.dir, 'notes.md');

// No notes yet: empty. A notes.md that is a symlink (or not a plain file) isn't followed: 404.
async function readNotes(f) {
  const st = await fsp.lstat(notesFile(f)).catch(() => null);
  if (st && !st.isFile()) throw new HttpError(404, 'This job’s notes.md isn’t a plain file, so it isn’t shown.');
  const text = st ? await readInside(f.dir, 'notes.md', { noLink: true }) : null;
  return { text: text ?? '', updatedAt: text === null ? null : st.mtime.toISOString() };
}

/** Replace notes.md, atomically (a new temp file renamed over it), only inside the job's own folder. */
async function writeNotes(f, text) {
  if (!isInside(f.dir, FEATURES_DIR) || path.resolve(f.dir) === FEATURES_DIR) throw new HttpError(400, 'This job’s folder isn’t where the workshop keeps jobs.');
  const tmp = path.join(f.dir, `.notes.md.${crypto.randomBytes(6).toString('hex')}.tmp`);
  await fsp.writeFile(tmp, text, { flag: 'wx', mode: 0o600 });
  try { await fsp.rename(tmp, notesFile(f)); } catch (err) { await fsp.rm(tmp, { force: true }); throw err; }
}

function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 48).replace(/-$/, '') || 'job';
}

async function uniqueSlug(base) {
  const taken = new Set([...(await features()).map((f) => f.slug), ...driver.list().map((r) => r.slug)]);
  let slug = base;
  for (let i = 2; taken.has(slug) || fs.existsSync(path.join(FEATURES_DIR, slug)); i++) slug = `${base}-${i}`;
  return slug;
}

async function meta() {
  return {
    token: TOKEN, stages: STAGES, agents: AGENTS, prices: { asOf: PRICES_AS_OF, models: PRICES },
    featuresDir: FEATURES_DIR, crewModels: await crewModels(), demo: DEMO, models: MODELS, readDirs: await readDirs(),
    settings: await state.getSettings(), liveLink: { enabled: (await readHookSessions(state.dir)).enabled, script: HOOK_SCRIPT },
    jobOptions: { flows: Object.entries(FLOWS).map(([id, f]) => ({ id, label: f.label, note: f.note, model: f.model, defaults: defaultsFor(id) })), skippable: SKIPPABLE, providable: PROVIDABLE, reviewers: REVIEWERS, fablePoints: FABLE_POINTS,
      // The options editor's model choices: the Foreman's (FOREMAN_MODEL_IDS) and the crew's (MODEL_IDS), with names.
      models: { foreman: FOREMAN_MODEL_IDS, crew: MODEL_IDS, choices: MODEL_CHOICES }, notesMax: NOTES_MAX },
    // L0–L3 with their one-line "what runs" hints, for the level picker.
    levels: levelsForClient(),
    // The installed skill's job-options.md: has it the Levels table? (lib/skill-check.js)
    skill: await skill.check(),
  };
}

// Every job's card, most urgent first (jobs being started from here come first).
async function boardCards(list) {
  const cards = [...startingCards(list), ...list.map((f) => boardCard(f, runFor(f)))];
  const rank = (c) => (c.needsYou ? 0 : c.working || c.stageState === 'working' ? 1 : c.stageState === 'done' ? 3 : 2);
  cards.sort((a, b) => rank(a) - rank(b) || (a.needsYou ? String(a.waitingSince ?? '').localeCompare(String(b.waitingSince ?? '')) : 0));
  return cards;
}

const GET = {
  '/api/meta': meta,
  // Everything the new UI needs to draw itself, in one call. `seq` is the newest live event at the
  // moment the snapshot started: open /api/events?v=2&since=<seq>&epoch=<epoch> to carry on from
  // it. Events that also made it into the snapshot may arrive again; applying them twice is harmless.
  '/api/snapshot': async () => {
    const seq = events.seq;
    const list = await features();
    const jobs = groupCards(await boardCards(list));
    return {
      v: 2, seq, epoch: events.epoch, meta: await meta(), jobs,
      needsYou: jobs.filter((j) => j.group === 'needs-you').length,
      permissions: driver.pendingPermissions(), usage: limits.view(), generatedAt: new Date().toISOString(),
    };
  },
  '/api/features': async () => {
    const list = await features();
    const cards = await boardCards(list);
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const spend = await sessionIndex.spendSince({ today: startOfToday.getTime(), week: startOfToday.getTime() - 6 * 86400000 });
    const shown = new Set(cards.filter((c) => !c.closed).map((c) => c.slug));
    const agents = list.filter((f) => shown.has(f.slug)).flatMap((f) => f.activity.filter((a) => stillRunning(f, a, driver.activeRunFor({ featureDir: f.dir }))));
    const totalUsd = list.reduce((a, f) => a + f.cost.totalUsd, 0);
    const open = cards.filter((c) => !c.closed);
    const stats = {
      today: spend.today, week: spend.week, featuresUsd: totalUsd,
      needsYou: open.filter((c) => c.needsYou).length,
      workingAgents: agents.filter((a) => a.state === 'running').length + cards.filter((c) => c.starting).length,
      workingFeatures: cards.filter((c) => c.working).length,
      quiet: list.filter((f) => f.quiet).length,
      inProgress: open.filter((c) => c.stageState !== 'done').length,
      done: cards.filter((c) => c.stageState === 'done' || c.closed?.as === 'done').length,
      dropped: cards.filter((c) => c.closed?.as === 'dropped').length,
      projects: new Set(cards.map((c) => c.project.name)).size,
    };
    return { features: cards, needsYou: stats.needsYou, totalUsd, stats, permissions: driver.pendingPermissions(), usage: limits.view(), generatedAt: new Date().toISOString() };
  },
  '/api/runs': async () => ({ runs: driver.list(), permissions: driver.pendingPermissions() }),
  // Your "Always allow" rules. active: false while your (global) setting is "ask about everything"
  // (then they wait). It describes your setting only: jobOverrides counts the jobs whose own
  // setting makes the rules apply differently there (on for them, or off for them).
  '/api/rules': async () => {
    const s = await state.getSettings();
    const active = s.policy !== 'ask-all';
    const jobOverrides = Object.values(s.jobPolicy ?? {}).filter((p) => (p !== 'ask-all') !== active).length;
    return { rules: await rules.list(), active, jobOverrides, unreadable: rules.broken ? rules.file : null };
  },

  '/api/repos': async () => ({ repos: await recentRepos(sessionIndex, [...(process.env.WORKSHOP_EXTRA_REPOS ?? '').split(path.delimiter).filter(Boolean), ...(await features()).map((f) => f.repoPath)]) }),
  '/api/costs': async () => {
    const list = await features();
    return {
      jobs: list.map((f) => ({ slug: f.slug, title: f.title, project: f.project, stage: f.stage, stageState: f.stageState, cost: f.cost, whatIf: whatIfConductor(f.cost.agents) })),
      pricesAsOf: PRICES_AS_OF,
    };
  },
};

async function routeGet(urlPath, url, req, res) {
  if (GET[urlPath]) return sendJson(res, 200, await GET[urlPath]());
  const day = new Date().toISOString().slice(0, 10);
  if (urlPath === '/api/costs/export.csv') return send(res, 200, costCsv(await features()), TYPES['.csv'], { 'Content-Disposition': `attachment; filename="feature-costs-${day}.csv"` });
  if (urlPath === '/api/costs/export.md') return send(res, 200, costMarkdown(await features()), TYPES['.md'], { 'Content-Disposition': `attachment; filename="feature-costs-${day}.md"` });
  if (urlPath === '/api/history') {
    // Filtered here, before the list is cut, so searching reaches every conversation.
    const { rows, missing } = await history.list(await historyContext());
    const p = url.searchParams;
    const q = (p.get('q') ?? '').trim().toLowerCase().slice(0, 200);
    const repo = p.get('repo') ?? '';
    const show = { linked: p.get('linked') === '1', dashboard: p.get('dashboard') === '1', test: p.get('test') === '1' };
    const matches = rows.filter((r) => (!r.job || show.linked) && (r.kind !== 'dashboard' || show.dashboard) && (r.kind !== 'test' || show.test)
      && (!repo || r.repo === repo) && (!q || `${r.title} ${r.firstPrompt ?? ''}`.toLowerCase().includes(q)));
    const LIMIT = 200;
    return sendJson(res, 200, {
      rows: matches.slice(0, LIMIT), matched: matches.length, total: rows.length, limit: LIMIT,
      repos: [...new Set(rows.map((r) => r.repo).filter(Boolean))].sort(),
      missing: missing.slice(0, 100), canContinue: !DEMO && PROJECTS_DIR === path.join(CLAUDE_DIR, 'projects'),
    });
  }
  const hm = /^\/api\/history\/([0-9a-f-]{36})$/.exec(urlPath);
  if (hm) {
    const d = await history.detail(hm[1], await historyContext());
    if (!d) throw new HttpError(404, 'That conversation isn’t there any more, or has nothing in it.');
    const cut = (t, n) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : t);
    const prompts = d.prompts.length > 15 ? [...d.prompts.slice(0, 12), { gap: d.prompts.length - 15 }, ...d.prompts.slice(-3)] : d.prompts;
    return sendJson(res, 200, { ...d, prompts: prompts.map((p) => (p.gap ? p : { at: p.at, text: cut(p.text, 600) })), filesEdited: d.filesEdited.slice(0, 50), moreFiles: Math.max(0, d.filesEdited.length - 50), lastAnswer: cut(d.lastAnswer, 1500) });
  }
  let m = /^\/api\/job\/([^/]+)(\/.*)?$/.exec(urlPath);
  if (m) {
    const f = await featureBySlug(m[1]);
    if (!f) throw new HttpError(404, 'No job by that name.');
    const sub = m[2] ?? '';
    if (!sub && url.searchParams.has('before')) {
      // "Load older": only the thread items before the given one.
      const page = await threadPage(f, await state.auditFor(f.dir, Infinity), { before: str(url.searchParams.get('before'), 300) });
      if (!page) throw new HttpError(404, 'That part of the conversation isn’t there any more. Reload the job.');
      return sendJson(res, 200, { slug: f.slug, thread: page.items, threadMore: page.more });
    }
    if (!sub) return sendJson(res, 200, await jobDetail(f));
    if (sub === '/notes') return sendJson(res, 200, await readNotes(f));
    if (sub === '/doc') {
      const file = url.searchParams.get('file') ?? '';
      let text = null;
      let name = file;
      if (file === 'spec') {
        const p = specFile(f);
        name = 'Product spec';
        try { text = p ? await fsp.readFile(p, 'utf8') : null; } catch { text = null; }
      } else if (/\.(md|json)$/.test(file)) {
        text = await readInside(f.dir, file, { noLink: true }); // a symlinked file isn't followed: 404
        const brief = /^briefs\/(\d+)-(.+)\.md$/.exec(file);
        name = f.artifacts.find((a) => a.file === file)?.name ?? (brief ? `Brief #${Number(brief[1])} · ${brief[2].replace(/-/g, ' ')}` : file);
      }
      if (text === null) throw new HttpError(404, 'That file isn’t there (yet).');
      const html = file.endsWith('.json') ? `<pre>${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>` : renderMarkdown(text, { idHref: idHref(f) });
      return sendJson(res, 200, { file, name, html, vscode: file === 'spec' ? specFile(f) : path.join(f.dir, file) });
    }
    if ((m = /^\/ids\/([^/]+)$/.exec(sub))) {
      const id = decodeURIComponent(m[1]);
      const index = indexIds(await jobDocs(f));
      return sendJson(res, 200, index[id] ?? { id, definition: null, mentions: [] });
    }
    if (sub === '/local') return sendJson(res, 200, await local.view(f, { fresh: url.searchParams.get('fresh') === '1' }));
    const codeDir = f.worktree && fs.existsSync(f.worktree) ? f.worktree : f.repoPath;
    if (sub === '/commits') {
      if (!codeDir || !f.branch || !(await git.isGitRepo(codeDir))) return sendJson(res, 200, { dir: codeDir, commits: [], note: 'No feature branch yet. Commits show up here once building starts.' });
      try {
        return sendJson(res, 200, { dir: codeDir, base: f.baseSha ?? null, head: f.branch, commits: await git.commits(codeDir, { base: f.baseSha ?? null, head: f.branch }) });
      } catch (err) {
        return sendJson(res, 200, { dir: codeDir, commits: [], note: `Couldn’t read the branch: ${String(err.message).split('\n')[0]}` });
      }
    }
    if ((m = /^\/commit\/([0-9a-fA-F]{4,40})$/.exec(sub))) {
      if (!codeDir) throw new HttpError(404, 'No repository for this job.');
      return sendJson(res, 200, { dir: codeDir, ...(await git.show(codeDir, m[1])) });
    }
  }
  if (urlPath.startsWith('/api/')) throw new HttpError(404, 'Not found');
  if (isWebAppPath(urlPath)) return serveWebApp(urlPath, res, { distDir: WEB_DIST, send });
  return serveStatic(urlPath, res);
}

async function routePost(urlPath, req, res) {
  checkWrite(req.headers, { port: PORT, token: TOKEN });
  const body = await readBody(req);
  let m;
  if ((m = /^\/api\/job\/([^/]+)\/send$/.exec(urlPath))) {
    const f = await featureBySlug(m[1]);
    if (!f) throw new HttpError(404, 'No job by that name.');
    tooLong(body.text, 'The message');
    const text = str(body.text).trim();
    if (!text) throw new HttpError(400, 'The message is empty.');
    // gateBrief: a gate reply composed while a reply was in progress (…/gate gave the text back) and
    // sent now; it still answers that brief, so it must still be the current one (as …/gate checks).
    const gateBrief = readBriefNumber(body.gateBrief);
    const kind = str(body.kind, 20) || 'message';
    if (gateBrief && kind !== 'stop') staleBriefCheck(f, gateBrief);
    const drive = await driveState(f);
    const out = sendPlan(f, drive, body, text);
    const run = await startSend(f, out, { kind, gateBrief });
    return sendJson(res, 200, { run });
  }
  if ((m = /^\/api\/job\/([^/]+)\/gate$/.exec(urlPath))) {
    // A decision from the gate card: answers, verdicts, next-step chips and a note, composed into
    // the reply here (composeReply, as the page previews it; or the text you edited, for "Edit, then
    // approve"). Chips that change an option patch
    // options.json first. With a reply in progress nothing is sent: the text comes back for the
    // composer to hold. With the usage limit reached, startAfterReset holds it until the reset.
    const f = await featureBySlug(m[1]);
    if (!f) throw new HttpError(404, 'No job by that name.');
    const g = readGateBody(body);
    // Answers, verdicts and chips for an older brief mustn't land on the new brief's questions; only
    // a stop goes through whichever brief is current.
    if (g.kind !== 'stop' && g.briefNumber) staleBriefCheck(f, g.briefNumber);
    // An approval of a spec or plan that changed since the card was raised approves something you
    // haven't seen: refused, as the card greys out (gate.stale).
    if (g.kind === 'approve' && gateNow(f)?.stale) {
      throw new HttpError(409, 'The spec or plan changed since this card was shown. Nothing was sent; read the new version, then decide.', { code: 'stale-gate' });
    }
    // A level chip names the level the job is at now (the server's word, not the page's).
    const level = Number.isInteger(f.options?.level) ? f.options.level : null;
    if (level === null && g.chips.some((c) => c?.kind === 'level')) throw new HttpError(400, 'Pick a level for this job first.');
    const chips = cleanChips(g.chips.map((c) => (c?.kind === 'level' ? { ...c, was: level } : c)));
    // A message needs something of yours in it (the reply would otherwise only list open decisions).
    if (g.kind === 'message' && !g.note.trim() && !chips.length && !Object.keys(g.answers).length && !Object.keys(g.verdicts).length) throw new HttpError(400, 'The message is empty.');
    const options = chipOptions(f.options, chips);
    const text = g.edited ?? composeReply({ kind: g.kind, status: present(statusForCompose(f)), answers: g.answers, verdicts: g.verdicts, note: g.note, chips });
    if (!text) throw new HttpError(400, 'The message is empty.');
    const reply = { ok: true, text, chipsDropped: g.chips.length - chips.length, ...(options ? { options, summary: describeOptions(options) } : {}) };
    const drive = await driveState(f);
    if (drive.mode === 'running') {
      await saveChipOptions(f, options);
      return sendJson(res, 200, { ...reply, sent: false, queued: false, message: `The Foreman is still working on a reply, so nothing was sent${options ? '. The option changes are saved and apply from its next stage' : ''}. Send this text once the reply is done.` });
    }
    const hold = g.startAfterReset && body.despiteLimit !== true && limits.isLimited();
    const out = sendPlan(f, drive, body, text, { holding: hold });
    await saveChipOptions(f, options);
    if (hold) {
      const held = await limits.hold({ featureDir: f.dir, slug: f.slug, title: f.title, cwd: out.cwd, sessionId: out.sessionId, model: out.model, additionalDirectories: await readDirs() }, { text: out.text, kind: g.kind, gateBrief: g.briefNumber });
      await state.audit({ action: 'send-held', featureDir: f.dir, slug: f.slug, kind: g.kind, text, autoResume: held.autoResume, resetsAt: held.resetsAt, ...(g.briefNumber ? { gateBrief: g.briefNumber } : {}) });
      await reopenIfClosed(f);
      cached = null;
      const when = new Date(held.resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return sendJson(res, 200, { ...reply, sent: false, held: true, resetsAt: held.resetsAt, message: held.autoResume ? `Held: it goes to the Foreman when Claude’s usage limit resets (around ${when}).` : `Held: it goes to the Foreman when you press “Carry on now” after Claude’s usage limit resets (around ${when}).` });
    }
    const run = await startSend(f, out, { kind: g.kind, gateBrief: g.briefNumber });
    return sendJson(res, 200, { ...reply, sent: true, run });
  }
  if ((m = /^\/api\/job\/([^/]+)\/takeover$/.exec(urlPath))) {
    const f = await featureBySlug(m[1]);
    if (!f) throw new HttpError(404, 'No job by that name.');
    const drive = await driveState(f);
    if (!drive.sessionId) throw new HttpError(400, 'There’s no Foreman session to take over yet.');
    await state.setSession(f.dir, { sessionId: drive.sessionId, cwd: drive.cwd, model: drive.model, takenOverAt: new Date().toISOString() });
    await state.audit({ action: 'takeover', featureDir: f.dir, slug: f.slug, sessionId: drive.sessionId });
    return sendJson(res, 200, { ok: true });
  }
  if ((m = /^\/api\/job\/([^/]+)\/repo$/.exec(urlPath))) {
    const f = await featureBySlug(m[1]);
    if (!f) throw new HttpError(404, 'No job by that name.');
    const repo = await checkRepo(str(body.repoPath, 1000));
    if (!repo.ok) throw new HttpError(400, repo.reason);
    const branch = str(body.branch, 200).trim() || null;
    if (branch && !/^(?!-)[\w./-]{1,200}$/.test(branch)) throw new HttpError(400, 'That doesn’t look like a branch name.');
    await state.setSession(f.dir, { repoPath: repo.path, branch });
    await state.audit({ action: 'repo-set', featureDir: f.dir, slug: f.slug, repo: repo.path, branch });
    cached = null;
    return sendJson(res, 200, { ok: true, repoPath: repo.path });
  }
  if (urlPath === '/api/settings') {
    // recheckAuto: forget that auto mode wasn't available, so the next reply that asks for it tries again.
    if (body.recheckAuto === true) {
      await state.setSettings({ autoMode: { available: null, reason: null, checkedAt: null } });
      settingsChanged();
      if (body.policy === undefined) return sendJson(res, 200, await state.getSettings());
    }
    const policy = POLICIES.includes(body.policy) ? body.policy : null;
    if (!policy) throw new HttpError(400, 'Unknown setting.');
    await state.setSettings({ policy });
    await state.audit({ action: 'settings', policy });
    await driver.applyModes(); // replies in progress switch now
    settingsChanged();
    return sendJson(res, 200, await state.getSettings());
  }
  if ((m = /^\/api\/job\/([^/]+)\/policy$/.exec(urlPath))) {
    // One job's own permission setting; null clears it (the job follows your global setting again).
    const f = await featureBySlug(m[1]);
    if (!f) throw new HttpError(404, 'No job by that name.');
    if (body.policy !== null && !POLICIES.includes(body.policy)) throw new HttpError(400, 'Unknown setting.');
    await state.setJobPolicy(f.dir, body.policy);
    await state.audit({ action: 'job-policy', featureDir: f.dir, slug: f.slug, policy: body.policy });
    await driver.applyModes();
    settingsChanged();
    const s = await state.getSettings();
    return sendJson(res, 200, { policy: s.jobPolicy?.[f.dir] || s.policy, policyOverride: s.jobPolicy?.[f.dir] ?? null, globalPolicy: s.policy, autoMode: s.autoMode });
  }
  if ((m = /^\/api\/job\/([^/]+)\/(close|reopen)$/.exec(urlPath))) {
    const f = await featureBySlug(m[1]);
    if (!f) throw new HttpError(404, 'No job by that name.');
    if (m[2] === 'reopen') {
      await state.setSession(f.dir, { closed: null });
      await state.audit({ action: 'reopen', featureDir: f.dir, slug: f.slug, how: 'button' });
      cached = null;
      return sendJson(res, 200, { ok: true });
    }
    if (driver.activeRunFor({ featureDir: f.dir })) throw new HttpError(409, 'The Foreman is working on a reply. Pause it first, then mark the job.');
    if (closing.has(f.dir)) throw new HttpError(409, 'This job is already being marked. Wait a moment.');
    const as = body.as === 'dropped' ? 'dropped' : 'done';
    const note = str(body.note, 300).trim() || null;
    let worktree = null;
    closing.add(f.dir);
    try {
      await limits.forget(f.dir); // no automatic carry-on for it from now on
      // Optional: remove the job's worktree, only when nothing would be lost (see lib/close.js).
      if (body.removeWorktree === true) {
        if (!f.worktree) throw new HttpError(400, 'This job has no worktree to remove.');
        // Nothing may still be working in it: a command from the job page, a crew member, a terminal.
        if (local.busy(f.slug)) throw new HttpError(409, 'Not marked yet: a command from the job page is still running in its worktree. Stop it first.');
        const run = runFor(f);
        if (f.activity.some((a) => stillRunning(f, a, run && ACTIVE_RUN.has(run.status) ? run : null))) throw new HttpError(409, 'Not marked yet: a crew member is still working on this job.');
        if ((await terminalsFor(f)).some((t) => isInside(t.cwd, f.worktree))) throw new HttpError(409, 'Not marked yet: Claude Code is open in its worktree in a terminal. Close it (/exit) first.');
        // Check before touching anything, so a refusal leaves your app running.
        const check = await checkWorktree(f.worktree, f.repoPath);
        if (!check.ok) throw new HttpError(409, `Not marked yet: the worktree can’t be removed safely. ${check.reason}`);
        await local.stopServerAndWait(f.slug); // its app, if started from the job page
        worktree = await removeWorktree(f.worktree, f.repoPath, { fetch: false });
        if (!worktree.ok) throw new HttpError(409, worktree.partial ? `Not marked yet. ${worktree.reason}` : `Not marked yet: the worktree can’t be removed safely. ${worktree.reason}`);
      }
      if (driver.activeRunFor({ featureDir: f.dir })) throw new HttpError(409, 'The Foreman started a reply meanwhile. Not marked; try again once it’s done.');
    } finally {
      closing.delete(f.dir);
    }
    const closed = { as, note, at: new Date().toISOString(), worktreeRemoved: worktree?.ok ? f.worktree : null };
    await state.setSession(f.dir, { closed });
    await state.audit({ action: 'close', featureDir: f.dir, slug: f.slug, as, note: note ?? undefined, worktreeRemoved: closed.worktreeRemoved ?? undefined });
    cached = null;
    return sendJson(res, 200, { ok: true, closed });
  }
  if ((m = /^\/api\/job\/([^/]+)\/options$/.exec(urlPath))) {
    const f = await featureBySlug(m[1]);
    if (!f) throw new HttpError(404, 'No job by that name.');
    // The new UI's options editor sends the updated_at it loaded (null: the job had none), so a
    // change made elsewhere since (a gate chip, the level chip, the classic page) isn't overwritten.
    // The classic page sends none and saves as before.
    if (Object.hasOwn(body, 'updated_at')) {
      const now = (await readOptions(f.dir))?.updated_at ?? null;
      if (now !== (body.updated_at ?? null)) throw new HttpError(409, 'These options changed elsewhere since you opened them.', { code: 'options-changed' });
    }
    let options;
    if (body.options === undefined && body.level !== undefined) {
      // A level on its own (the header's level chip, the LevelCard): merged here with the job's
      // options now, the same way as the gate card's level chip (optionsAtLevel).
      if (!isLevel(body.level)) throw new HttpError(400, 'Level: pick L0, L1, L2 or L3.');
      options = levelOptions(f.options, body.level);
    } else {
      try { options = normalizeOptions(body.options ?? {}, { previous: f.options }); } catch (err) { throw new HttpError(400, err.message); }
    }
    const updatedAt = await writeOptions(f.dir, options, { title: f.options?.title, repo: f.options?.repo, kind: f.options?.kind, from_session: f.options?.from_session });
    // was: the level before, so the conversation can say "Level changed from L2 Standard to L3 Large".
    await state.audit({ action: 'options', featureDir: f.dir, slug: f.slug, options, was: f.options?.level ?? null });
    cached = null;
    return sendJson(res, 200, { ok: true, options, summary: describeOptions(options), updated_at: updatedAt });
  }
  if ((m = /^\/api\/job\/([^/]+)\/local$/.exec(urlPath))) {
    const f = await featureBySlug(m[1]);
    if (!f) throw new HttpError(404, 'No job by that name.');
    const action = str(body.action, 20);
    const audit = (extra = {}) => state.audit({ action: 'local', featureDir: f.dir, slug: f.slug, what: action, ...extra });
    try {
      if (action === 'env') { const r = await local.setupEnv(f); await audit({ changed: r.changed }); return sendJson(res, 200, r); }
      if (action === 'start') { const r = await local.startServer(f); await audit({ port: r.port }); return sendJson(res, 200, r); }
      if (action === 'stop') return sendJson(res, 200, { ok: local.stopServer(f.slug) });
      if (action === 'run') {
        const preset = str(body.preset, 40) || null;
        const command = str(body.command, 4000);
        const where = body.where === 'root' ? 'root' : 'app';
        const prepared = await local.prepareCommand(f, { command, preset, where });
        await audit({ command: preset ? undefined : command, preset: preset ?? undefined, where });
        local.startPrepared(f.slug, prepared); // output streams to the page
        return sendJson(res, 200, { ok: true });
      }
      if (action === 'stop-cmd') return sendJson(res, 200, { ok: local.stopCommand(f.slug) });
      if (action === 'open') {
        const what = ['terminal', 'finder', 'vscode'].includes(body.what) ? body.what : 'terminal';
        const terminalApp = (await state.getSettings()).local?.terminalApp ?? 'iTerm';
        return sendJson(res, 200, await local.open(f, what, terminalApp));
      }
      if (action === 'terminal-app') {
        const name = ['iTerm', 'Terminal'].includes(body.name) ? body.name : null;
        if (!name) throw new HttpError(400, 'Choose iTerm or Terminal.');
        await local.setTerminalApp(name);
        return sendJson(res, 200, { ok: true });
      }
      if (action === 'db') {
        const what = str(body.db, 20);
        await audit({ db: what });
        await local.database(f, what);
        return sendJson(res, 200, { ok: true });
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, err.message);
    }
    throw new HttpError(400, 'Unknown action.');
  }
  if (urlPath === '/api/usage/resume') {
    if (!limits.isLimited()) throw new HttpError(409, 'Nothing is paused for the usage limit.');
    return sendJson(res, 200, await limits.resume('you'));
  }
  if (urlPath === '/api/usage/auto') {
    await limits.setAutoResume(body.on === true);
    await state.audit({ action: 'settings', autoResume: body.on === true });
    return sendJson(res, 200, limits.view());
  }
  if ((m = /^\/api\/runs\/([\w-]+)\/stop$/.exec(urlPath))) {
    if (!(await driver.stop(m[1]))) throw new HttpError(404, 'That reply already finished.');
    return sendJson(res, 200, { ok: true });
  }
  if ((m = /^\/api\/runs\/([\w-]+)\/steer$/.exec(urlPath))) {
    // Steer: add a message to a reply in progress (see lib/driver.js). Its states arrive as 'steer' events.
    const text = str(body.text).trim();
    if (!text) throw new HttpError(400, 'The message is empty.');
    const steer = await driver.steer(m[1], text);
    if (!steer) throw new HttpError(404, 'That reply already finished. Send your message as a new one.', { code: 'finished' });
    return sendJson(res, 200, { steer });
  }
  if ((m = /^\/api\/permissions\/([\w-]+)$/.exec(urlPath))) {
    const decision = ['allow', 'allow-run', 'deny'].includes(body.decision) ? body.decision : null;
    if (!decision) throw new HttpError(400, 'Choose allow or deny.');
    const answers = body.answers && typeof body.answers === 'object' ? Object.fromEntries(Object.entries(body.answers).map(([k, v]) => [str(k, 500), str(v, 2000)])) : null;
    if (!(await driver.decide(m[1], { decision, note: str(body.note, 2000), answers }))) throw new HttpError(404, 'That request was already answered or has expired.');
    return sendJson(res, 200, { ok: true });
  }
  if (urlPath === '/api/rules') {
    // "Always allow…": save a rule you confirmed, and (with permissionId) allow the request it was
    // drafted from. The rule must cover that request; nothing broader than its kind is accepted.
    let v;
    try { v = validateRule(body.rule); } catch (err) { if (err instanceof RuleError) throw new HttpError(400, err.message); throw err; }
    const permissionId = str(body.permissionId, 100) || null;
    const req = permissionId ? driver.pendingRequest(permissionId) : null;
    if (permissionId) {
      if (!req) throw new HttpError(404, 'That request was already answered or has expired. Nothing was saved.');
      if (req.kind !== 'permission') throw new HttpError(400, 'Questions can’t be always allowed.');
      if (req.defaultToNo) throw new HttpError(400, 'Claude Code flagged this step as risky, so it can’t be always allowed. Use Allow once instead.');
      if (req.hardLine) throw new HttpError(400, 'This step is a hard line: it asks you every time, whatever your rules say. Use Allow once instead.');
      if (!matchRule(v, req.toolName, req.input)) throw new HttpError(400, `That rule (${describeRule(v)}) wouldn’t cover this request, so it wasn’t saved. Change it so it does, or use Allow once.`);
    }
    let saved;
    try { saved = await rules.add(v, { from: req ? { slug: req.slug, title: req.title ?? null, headline: req.plain?.headline ?? null } : null }); } catch (err) { if (err instanceof RuleError) throw new HttpError(400, err.message); throw err; }
    const { rule, added } = saved;
    if (added) await state.audit({ action: 'rule-added', rule: rule.id, tool: rule.tool, kind: rule.kind, value: rule.value, label: rule.label, featureDir: req?.featureDir, slug: req?.slug });
    const allowed = req ? await driver.decide(permissionId, { decision: 'allow', rule: rule.id }) : false;
    // Other requests waiting right now that the rule covers are allowed too, as later ones will be:
    // each by its own job's setting (a job set to "ask about everything" keeps asking).
    // active: whether the rule is used for the job it was drafted from (else your setting).
    const active = (await state.policyFor(req?.featureDir ?? null)) !== 'ask-all';
    let alsoAllowed = 0;
    for (const p of driver.pendingPermissions()) {
      if (p.kind !== 'permission' || p.defaultToNo || p.hardLine) continue;
      if ((await state.policyFor(p.featureDir)) === 'ask-all') continue;
      const full = driver.pendingRequest(p.id);
      if (full && matchRule(rule, full.toolName, full.input) && (await driver.decide(p.id, { decision: 'allow', rule: rule.id }))) alsoAllowed++;
    }
    return sendJson(res, 200, { rule, added, allowed, alsoAllowed, active });
  }
  if (urlPath === '/api/jobs') {
    const description =str(body.description, 600).replace(/\s+/g, ' ').trim();
    if (description.length < 4) throw new HttpError(400, 'Describe the job in a few words.');
    if (limits.isLimited() && body.despiteLimit !== true) throw new HttpError(409, limitMessage(), { code: 'limited' });
    const repo = await checkRepo(str(body.repoPath, 1000));
    if (!repo.ok) throw new HttpError(400, repo.reason);
    let options;
    try { options = normalizeOptions(body.options ?? {}); } catch (err) { throw new HttpError(400, err.message); }
    // The one you picked, else the job's models.foreman, else Opus: never Fable because the job is L3.
    const model = foremanModel(body.model, options, MODELS.map((x) => x.id));
    const kind = body.kind === 'bug' ? 'bug' : 'feature';
    // Starting from a past conversation: a fresh Foreman reads an extract of it (history.md), or
    // a copy of the conversation itself becomes the Foreman (the original is never changed).
    let from = null;
    let sessionId = null;
    let cwd = repo.path;
    if (body.fromSession?.id) {
      const id = str(body.fromSession.id, 40);
      const mode = body.fromSession.mode === 'continue' ? 'continue' : 'summary';
      const d = /^[0-9a-f-]{36}$/.test(id) ? await history.detail(id, await historyContext()) : null;
      if (!d) throw new HttpError(400, 'That conversation isn’t there any more, or has nothing in it.');
      from = { id: d.id, chain: d.chain, mode, branch: d.branch ?? null, cwd: d.cwd ?? null, title: d.title };
      if (mode === 'continue') {
        if (DEMO || PROJECTS_DIR !== path.join(CLAUDE_DIR, 'projects')) throw new HttpError(400, 'Continuing a conversation only works with your real Claude Code history. Use “Fresh Foreman with a summary” instead.');
        if (!d.cwd || !fs.existsSync(d.cwd)) throw new HttpError(400, `The folder that conversation ran in (${d.cwd ?? 'unknown'}) isn’t there any more, so it can’t be continued. Use “Fresh Foreman with a summary” instead.`);
        // The continued conversation runs where it ran before, so that must be inside the job's repository.
        if (!isInside(d.cwd, repo.path)) throw new HttpError(400, `That conversation ran in ${d.cwd}, which isn’t inside ${repo.path}. Pick that repository, or use “Fresh Foreman with a summary”.`);
        const { forkSession } = await import('@anthropic-ai/claude-agent-sdk');
        sessionId = (await forkSession(d.id, { dir: d.cwd, title: `${d.title} (Feature Workshop)` })).sessionId;
        cwd = d.cwd;
        from.forkedTo = sessionId;
      }
      from.detail = d;
    }
    const slug = await uniqueSlug(slugify(description));
    const featureDir = path.join(FEATURES_DIR, slug);
    // The job's options go in its private folder (read before every stage) and in the first message.
    const { detail: fromDetail, ...fromRecord } = from ?? {};
    const optionsOut = from ? { ...options, from_session: fromRecord } : options;
    await writeOptions(featureDir, options, { title: description, repo: repo.path, kind, from_session: from ? fromRecord : undefined });
    if (fromDetail) await fsp.writeFile(path.join(featureDir, 'history.md'), historyMarkdown(fromDetail), { mode: 0o600 });
    // The /feature command must come first in the message, or it doesn't run.
    const tail = from?.mode === 'continue'
      ? '\n\nThis conversation is now a Feature Workshop job: carry it on through the feature workflow from here. Everything said earlier in it is background, not approval.'
      : '';
    const text = `/feature ${description}${kind === 'bug' ? ' (This is a bug fix.)' : ''} Private folder: ${featureDir}\n\nJob options (also in options.json in that folder; read it before every stage):\n${describeOptions(optionsOut).map((l) => `- ${l}`).join('\n')}${tail}`;
    const run = await driver.start({ featureDir, slug, title: description, cwd, sessionId, model, text, kind, newJob: true, additionalDirectories: await readDirs() });
    await state.audit({ action: 'new-job', featureDir, slug, repo: repo.path, model, description, options, fromSession: from ? { id: from.id, mode: from.mode, forkedTo: from.forkedTo } : undefined });
    cached = null;
    return sendJson(res, 200, { run, slug });
  }
  throw new HttpError(404, 'Not found');
}

async function routePut(urlPath, req, res) {
  checkWrite(req.headers, { port: PORT, token: TOKEN });
  const body = await readBody(req);
  const m = /^\/api\/job\/([^/]+)\/notes$/.exec(urlPath);
  if (m) {
    // The job's notes (notes.md), saved whole from the job drawer. Audited by size only.
    const f = await featureBySlug(m[1]);
    if (!f) throw new HttpError(404, 'No job by that name.');
    if (typeof body.text !== 'string') throw new HttpError(400, 'The notes must be text.');
    if (body.text.length > NOTES_MAX) throw new HttpError(413, `The notes are too long (at most ${NOTES_MAX.toLocaleString('en')} characters).`);
    await writeNotes(f, body.text);
    await state.audit({ action: 'notes', featureDir: f.dir, slug: f.slug, size: body.text.length });
    return sendJson(res, 200, { ok: true, ...(await readNotes(f)) });
  }
  throw new HttpError(404, 'Not found');
}

async function routeDelete(urlPath, req, res) {
  checkWrite(req.headers, { port: PORT, token: TOKEN });
  await readBody(req);
  const m = /^\/api\/rules\/([\w-]{1,100})$/.exec(urlPath);
  if (m) {
    const rule = await rules.remove(m[1]);
    if (!rule) throw new HttpError(404, 'That rule was already removed.');
    await state.audit({ action: 'rule-removed', rule: rule.id, tool: rule.tool, kind: rule.kind, value: rule.value, label: rule.label });
    return sendJson(res, 200, { ok: true, rule });
  }
  throw new HttpError(404, 'Not found');
}

// ---------- Live updates (server-sent events) ----------

const clients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  for (const res of clients) res.write(payload);
}
let changeTimer = null;
function notifyChange() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => { cached = null; broadcast('change', { at: Date.now() }); events.emit('change', null, { at: Date.now() }); }, 700);
}
driver.on('run', (run) => { cached = null; broadcast('run', run); events.emit('run', run.slug, run); });
driver.on('permission', (p) => { broadcast('permission', p); events.emit('permission', p.slug, p); });
driver.on('permission-gone', (p) => { broadcast('permission-gone', p); events.emit('permission-gone', p.slug ?? null, p); });
// Where a steered message is (queued, delivered, acted-on, cancelled): the new UI only.
driver.on('steer', (s) => { events.emit('steer', s.slug ?? null, s); });
limits.on('change', () => { cached = null; broadcast('change', { at: Date.now() }); events.emit('usage', null, limits.view()); });
local.on('output', (e) => { broadcast('local', e); events.emit('local', e.slug ?? null, e, { replay: false }); }); // live only: see EventLog.emit
local.on('changed', (e) => { broadcast('local-state', e); events.emit('local-state', e.slug ?? null, e); });

// ---------- Live updates for the new UI (/api/events?v=2, see lib/events.js) ----------

const events = new EventLog();
// A job's conversation changed: one 'thread' event per job, a moment after the last change, so
// the page refetches only that job. Sources: the dashboard's audit log, and files in the job's folder.
const threadTimers = new Map();
function threadChanged(slug, why) {
  if (!slug) return;
  clearTimeout(threadTimers.get(slug));
  threadTimers.set(slug, setTimeout(() => { threadTimers.delete(slug); events.emit('thread', slug, { why }); }, 300));
}
// The rule list changed: open Settings views refetch it.
rules.on('change', (list) => { events.emit('rules', null, { count: list.length }); });
// Your permission settings changed (global, a job's own, or whether auto mode is available).
function settingsChanged() {
  state.getSettings().then((s) => events.emit('settings', null, s)).catch(() => {});
}
state.on('audit', (e) => { if (e.featureDir) threadChanged(e.slug ?? path.basename(e.featureDir), e.action); });
function featureFileChanged(_type, filename) {
  // fs.watch names the file relative to the jobs folder: its first part is the job's folder name.
  const slug = filename ? String(filename).split(path.sep)[0] : null;
  if (slug && !slug.startsWith('.')) threadChanged(slug, 'files');
}

function watch(dir, onFile = null) {
  try {
    fs.watch(dir, { recursive: true }, (type, filename) => { notifyChange(); onFile?.(type, filename); }).on('error', () => {});
  } catch {
    console.warn(`Not watching ${dir} (missing or not supported); the page still refreshes every 30 seconds.`);
  }
}

function openEvents(req, res) {
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}

const server = http.createServer(async (req, res) => {
  if (!hostAllowed(req.headers.host)) return send(res, 421, 'Misdirected request');
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, 'Bad request'); }
  let urlPath;
  try { urlPath = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Bad request'); }
  try {
    if (req.method === 'GET' && urlPath === '/api/events' && url.searchParams.get('v') === '2') {
      return openStream(req, res, { log: events, headers: SECURITY_HEADERS, resume: resumePoint(req.headers, url.searchParams) });
    }
    if (req.method === 'GET' && urlPath === '/api/events') return openEvents(req, res);
    if (req.method === 'GET') return await routeGet(urlPath, url, req, res);
    if (req.method === 'POST') return await routePost(urlPath, req, res);
    if (req.method === 'PUT') return await routePut(urlPath, req, res);
    if (req.method === 'DELETE') return await routeDelete(urlPath, req, res);
    return send(res, 405, 'Method not allowed');
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message, ...err.extra });
    if (err instanceof Busy) return sendJson(res, 409, { error: err.message });
    console.error(err);
    return sendJson(res, 500, { error: 'Something went wrong. The details are in the terminal running the dashboard.' });
  }
});

await limits.load();
await startGateParking();
await skill.check(); // read once at start; /api/meta re-reads only when the file changes
watch(FEATURES_DIR, featureFileChanged);
watch(PROJECTS_DIR);
server.listen(PORT, HOST, () => {
  console.log(`Feature Workshop running at http://${HOST}:${PORT}  (Ctrl+C to stop)`);
  console.log(`  jobs:     ${FEATURES_DIR}`);
  console.log(`  sessions: ${PROJECTS_DIR}`);
  if (DEMO) console.log('  demo mode: a pretend Foreman answers; nothing real runs.');
});

// Stopping the dashboard pauses any reply in progress; sessions stay resumable.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const r of driver.list()) if (ACTIVE_RUN.has(r.status)) driver.stop(r.id);
    local.stopAll(); // dev servers and commands started from the page stop with it
    setTimeout(() => process.exit(0), 400);
  });
}
