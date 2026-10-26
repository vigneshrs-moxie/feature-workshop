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
import { State, WORKFLOW_CHOICES } from './lib/state.js';
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
import { PlanUsage } from './lib/plan-usage.js';
import { LocalRunner } from './lib/local.js';
import { History, historyMarkdown } from './lib/history.js';
import { removeWorktree, checkWorktree } from './lib/close.js';
import { FLOWS, SKIPPABLE, PROVIDABLE, REVIEWERS, FABLE_POINTS, OPUS, FOREMAN_MODEL_IDS, MODEL_IDS, MODEL_CHOICES, defaultsFor, normalize as normalizeOptions, readOptions, writeOptions, describeOptions, foremanModel, levelsForClient, optionsAtLevel, isLevel } from './lib/options.js';
import { isWebAppPath, serveWebApp } from './lib/web-app.js';
import { EventLog, resumePoint, openStream } from './lib/events.js';
import { groupCards } from './lib/snapshot.js';
import { FINISH_LINES, FINISH_LINE_INFO, finishLineReached } from './lib/finish.js';
import { NUDGE_IDS, nudgesFor } from './lib/nudges.js';
import { buildThread, pageThread } from './lib/thread.js';
import { decisionLog } from './lib/decisions.js';
import { typicalRuns } from './lib/run-typical.js';
import { proofStamp } from './lib/proof.js';
import { suggestLevel, changedPaths } from './lib/levels.js';
import { GATE_PARK_MS, GateParking, RaisedVersions, isGateWaiting, isParkable, gateView, answeredBriefs } from './lib/gate.js';
import { composeReply, cleanChips, MAX_CHIPS } from './lib/compose.js';
import { skillChecker } from './lib/skill-check.js';
import { DOC_MAX_BYTES, DocError, describeDoc, docVersion, jsonHtml, listJobDocs, readJobDoc, readSummary, readWalkthrough, readWireframes, servableSpec } from './lib/docs.js';
import { PlayBook, PlayError, PAGE_SECRETS, PLAY_EVENTS, TEAPOT, crewHeaders, hexCommit, ledgerView, parseReviewFindings, playSettings, themeUnlocked, validatePlayPatch } from './lib/play.js';
import { parseStatusJson } from './lib/status-json.js';
import { autoModeEnvironment, remotesOf } from './lib/auto-env.js';
import { goAheadCovers } from './lib/hard-lines.js';
import { FlowWatch, gatherRepo } from './lib/flow.js';
import { noticeBody, Notifier, validateNotifyPatch } from './lib/notify.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 4477;
// The screens server: a job's wireframes.html is served from this SECOND origin (PORT + 1 unless
// WIREFRAMES_PORT says otherwise), so the page's own script can't reach this dashboard's document,
// storage or token however it was written. The web frames it from meta.wireframesOrigin.
const WIREFRAMES_PORT = Number(process.env.WIREFRAMES_PORT) || PORT + 1;
const WIREFRAMES_ORIGIN = `http://${HOST}:${WIREFRAMES_PORT}`;
// Set when the screens server couldn't listen (its port is taken): meta then names no origin, so
// the Screens tab frames nothing rather than whatever else answers on that port.
let screensDown = false;
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
  { id: 'claude-fable-5-1', label: 'Fable 5.1', note: 'Best judgment, highest cost and quickest to use up your limits. Only if you want it: the Foreman is Opus at every level, and Fable already takes second looks at L3.' },
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
const driver = new Driver({
  queryFn, state, projectsDir: PROJECTS_DIR, cliPath: process.env.WORKSHOP_CLAUDE_PATH || null,
  policy: policyFor, modeFor: (run) => state.policyFor(run.featureDir), cover: goAheadFor, settingsFor: sessionSettings,
});
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
// The plan's 5-hour and weekly usage for the top bar's meters, read once a minute (lib/plan-usage.js).
const planUsage = new PlanUsage({ enabled: !DEMO && process.env.WORKSHOP_PLAN_USAGE !== 'off' });
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

// What the policy knows about a run's job: its record, repo, worktrees and spec folders.
async function jobContext(run) {
  const f = (await features()).find((x) => x.dir === run.featureDir);
  const repo = f?.repoPath ?? run.cwd;
  const worktrees = [f?.worktree, f?.statusWorktree, repo && f ? path.join(path.dirname(repo), `orbit-${f.slug}`) : null].filter(Boolean);
  const specDirs = [repo ? path.join(repo, 'docs', 'plans') : null, f?.spec?.path && path.isAbsolute(f.spec.path) ? path.dirname(f.spec.path) : null].filter(Boolean);
  return { f, repo, worktrees, specDirs };
}

// The Foreman session's own Claude Code settings: the job's auto mode environment (lib/auto-env.js),
// so auto mode's safety model knows the job's repo, fork and org remote. Added to your settings.
// Auto mode: does your go-ahead already cover this hard line (lib/hard-lines.js goAheadCovers)?
async function goAheadFor(run, toolName, input) {
  const { f, worktrees } = await jobContext(run);
  return goAheadCovers(toolName, input, { mode: await state.policyFor(run.featureDir), stage: f?.stage ?? null, worktrees, featureDir: run.featureDir, cwd: run.cwd });
}

// Each repo's remotes, asked of git at most once a minute (they rarely change; every reply needs them).
const remotesCache = new Map();
function cachedRemotes(repo) {
  const hit = remotesCache.get(repo);
  if (hit && Date.now() - hit.at < 60_000) return hit.remotes;
  const remotes = remotesOf(repo);
  remotesCache.set(repo, { at: Date.now(), remotes });
  return remotes;
}

async function sessionSettings(run) {
  const { f, repo, worktrees } = await jobContext(run);
  const environment = autoModeEnvironment({ title: f?.title ?? run.title, slug: f?.slug ?? run.slug, repoPath: repo, worktrees, featureDir: run.featureDir }, await cachedRemotes(repo));
  return environment.length ? { autoMode: { environment } } : null;
}

// Routine steps are handled without asking (see lib/policy.js); everything else comes to you.
async function policyFor(run, toolName, input, opts) {
  const mode = await state.policyFor(run.featureDir);
  const { f, repo, worktrees, specDirs } = await jobContext(run);
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
// Each job's stage at the last read, for a notification's text (lib/notify.js noticeBody).
const knownStage = new Map();
async function features() {
  if (cached && Date.now() - cached.at < 1500) return cached.list;
  runEnds = await state.lastRunEnds();
  const saved = await state.allSessions();
  const overrides = Object.fromEntries(Object.entries(saved).filter(([, v]) => v.repoPath || v.branch).map(([k, v]) => [k, { repoPath: v.repoPath, branch: v.branch }]));
  const list = await loadFeatures({ featuresDir: FEATURES_DIR, sessionIndex, overrides, knownRepos: await repoList() });
  // Jobs you marked done or dropped (kept in the dashboard's own state; the job's records are untouched).
  for (const f of list) f.closed = saved[f.dir]?.closed ?? null;
  // Hand-off nudges you dismissed on this job, and the ones whose sentence already went to its
  // Foreman (lib/nudges.js), kept in the same record.
  for (const f of list) f.dismissedNudges = Array.isArray(saved[f.dir]?.dismissedNudges) ? saved[f.dir].dismissedNudges : [];
  for (const f of list) f.sentNudges = Array.isArray(saved[f.dir]?.sentNudges) ? saved[f.dir].sentNudges : [];
  for (const f of list) noteRaisedVersions(f);
  cached = { at: Date.now(), list };
  for (const f of list) knownStage.set(f.slug, f.stage ?? null);
  return list;
}
const featureBySlug = async (slug) => (await features()).find((f) => f.slug === slug) ?? null;
// For the background watchers (the flow map, notifications) that all wake on the same change: one
// load shared between them instead of one each.
let sharedLoad = null;
const featuresShared = () => (sharedLoad ??= features().finally(() => { sharedLoad = null; }));

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

// ---------- Play (lib/play.js): crew met, quests done, achievements, secrets ----------
// Built from local data only, kept in play.json next to the dashboard's other state, refreshed a
// moment after an audit line or a job file changes (each audit line folded in as it is written,
// one job re-read when its files change). A new achievement, or a quest done, is a 'play' event
// ({ achievement } or { quest }). Never a model call.
// Play mode Off means nothing: no refresh, no events, GET /api/play says only { mode: 'off' }.
// The play settings live here in memory, read once at start and changed by POST /api/settings.
let playNow = (await state.getSettings()).play;
const playOn = () => playNow.mode !== 'off';
// The finish line (Settings → Workflow, lib/finish.js): what counts as done, for every card's
// `finish`, the Jobs list's groups, the play ledger's quests and the Done notification. Read once at
// start (the old play.questDone is moved by state.js), changed by POST /api/settings { workflow }.
let finishLineNow = (await state.getSettings()).workflow.finishLine;

// review.md per job, read again only when its size or time changed.
const reviewCache = new Map();
async function reviewOf(dir) {
  const file = path.join(dir, 'review.md');
  try {
    const st = await fsp.stat(file);
    if (!st.isFile() || st.size > DOC_MAX_BYTES) return null;
    const hit = reviewCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.value;
    const counts = parseReviewFindings(await fsp.readFile(file, 'utf8'));
    const value = counts ? { at: st.mtime.toISOString(), counts } : null;
    reviewCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, value });
    return value;
  } catch {
    reviewCache.delete(file);
    return null;
  }
}
// The Hex Sommelier commit on a job's branch (hexCommit). Looked for only on a full job read (at most
// every JOBS_EVERY_MS), one job at a time, and not at all once the secret is found; a branch's
// commits are read again only when its head moved. Only the job's own commits count (base..branch,
// never the history it started from): with no base known, it isn't looked at.
const hexCache = new Map(); // codeDir|branch|base -> { head, value }
const hexKnown = new Map(); // job folder -> what the last full read found (the quick reads reuse it)
async function hexCommitOf(f) {
  const base = f.baseSha ?? f.baseBranch;
  const codeDir = f.worktree && fs.existsSync(f.worktree) ? f.worktree : f.repoPath;
  if (!codeDir || !f.branch || !base) return null;
  const key = `${codeDir}|${f.branch}|${base}`;
  const head = await git.headOf(codeDir, f.branch);
  if (!head) return null;
  const hit = hexCache.get(key);
  if (hit && hit.head === head) return hit.value;
  let value = null;
  try { value = hexCommit(await git.commits(codeDir, { base, head: f.branch, limit: 500 })); } catch { value = null; }
  hexCache.set(key, { head, value });
  return value;
}
async function lookForHex(list) {
  if (playbook.ledger?.secrets?.['hex-sommelier']) return;
  for (const f of list) hexKnown.set(f.dir, await hexCommitOf(f).catch(() => null));
}
const playJobOf = async (f) => ({
  slug: f.slug, dir: f.dir, kind: f.kind, level: f.level, prs: f.prs, updatedAt: f.updatedAt,
  // When the Foreman's first session began (Speedrun), and the PRs its logs say were created, with when.
  startedAt: f.firstSessionAt ?? null, prLinks: f.prLinks ?? [],
  workers: (f.activity ?? []).filter((a) => a.who !== 'conductor').map((a) => ({ agentType: a.who, startedAt: a.startedAt ?? null, lastAt: a.lastAt ?? null })),
  review: await reviewOf(f.dir),
  hexCommit: hexKnown.get(f.dir) ?? null,
});
// Every job: the cached list when it is fresh (fresh: true asks for that only), else a full read.
async function playJobs({ fresh }) {
  const list = fresh ? (cached && Date.now() - cached.at < 1500 ? cached.list : null) : await features();
  if (list && !fresh) await lookForHex(list);
  return list ? Promise.all(list.map(playJobOf)) : null;
}
// One job whose files changed: its status.json and review.md again, the rest as last read.
async function playJobFiles(folder, known) {
  const dir = known?.dir ?? path.join(FEATURES_DIR, folder);
  let status = null;
  try { const sj = parseStatusJson(await fsp.readFile(path.join(dir, 'status.json'), 'utf8')); status = sj?.ok ? sj : null; } catch { status = null; }
  if (!known && !status) return null; // not a job (yet): the next full read finds it
  const base = known ?? { slug: folder, dir, kind: status?.kind ?? null, level: null, startedAt: null, prLinks: [], workers: [] };
  return { ...base, ...(status ? { prs: status.prs ?? null, updatedAt: status.updatedAt ?? base.updatedAt ?? null } : {}), review: await reviewOf(dir) };
}
const playbook = new PlayBook({
  dir: state.dir,
  isOn: playOn,
  sources: {
    readAudit: () => state.auditAll(),
    auditStat: async () => { try { const st = await fsp.stat(state.auditFile); return { size: st.size, ino: st.ino }; } catch { return null; } },
    jobs: playJobs,
    job: playJobFiles,
    settings: () => playNow,
    workflow: () => ({ finishLine: finishLineNow }),
    flow: () => [...flowLanes.values()],
  },
  onUnlock: (achievement) => { if (playOn()) events.emit('play', null, { achievement }); },
  // A quest done: the page celebrates it (a toast), from the ledger alone.
  onQuest: (quest) => { if (playOn()) events.emit('play', quest.slug ?? null, { quest }); },
  // An L3 review's boss defeated (Full mode celebrates it), once per job.
  onBoss: (boss) => { if (playOn()) events.emit('play', boss.slug ?? null, { boss }); },
  // A job's review round changed: nothing to celebrate, but a page showing its boss fetches again.
  onReview: (review) => { if (playOn()) events.emit('play', review.slug ?? null, { review }); },
});
state.on('audit', (e) => { playbook.noteAudit(e); playbook.schedule(); });
/** An easter egg found (Play on): one audit line the first time, so a rebuilt ledger finds it again. True when it was new. */
async function recordSecret(id) {
  if (!playOn()) return false;
  if ((await playbook.current())?.secrets?.[id]) return false;
  await state.audit({ action: 'play-secret', id });
  await playbook.refresh();
  return true;
}

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
    const f = waiting.find((x) => x.slug === g.slug);
    tell({ level: 'needs', title: f?.title ?? g.slug, body: noticeBody({ stage: f?.stage, waitingSince: g.waitingSince, headline: f?.headline, title: f?.title, what: 'Your decision has waited 4 hours.' }), slug: g.slug, key: `parked:${g.slug}` });
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
// Each job's flow lane (lib/flow.js laneOf) by slug, from the last map refresh: where its PRs are.
let flowLanes = new Map();

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
  // Marked done or dropped, and nothing has happened since: off the board.
  const off = Boolean(f.closed) && !active && !running.length && !(f.updatedAt && f.updatedAt > f.closed.at);
  // The finish line (lib/finish.js): crossed or not, by what, and where the work has landed.
  const lane = flowLanes.get(f.slug) ?? null;
  const finish = finishLineReached({ prs: f.prs, closed: off ? f.closed : null }, lane, finishLineNow);
  return {
    slug: f.slug, title: f.title, kind: f.kind, kindGuessed: f.kindGuessed, project: f.project, route: f.route, skipped: f.skipped,
    stage: f.stage, stageState: active ? 'working' : pausedHere ? 'paused' : notRunning ? 'idle' : f.stageState, paused: pausedHere, waitingFor: pendingList.length ? 'permission' : f.waitingFor,
    waitingSince: pendingList.length ? pendingList[0].createdAt : f.waitingSince,
    needsYou: pendingList.length > 0 || (!active && f.needsYou), working: Boolean(active) || running.length > 0, quiet: f.quiet && running.length > 0,
    nowDoing, firstQuestion: f.questions[0]?.text ?? null, questions: f.questions.length,
    unconfirmed: f.decidedOnYourBehalf.filter((d) => !d.confirmed).length,
    headline: f.latestBrief?.headline ?? (f.sources.statusJson ? null : f.currentText) ?? null, nextProposed: f.nextProposed,
    // The screens the wireframer drew (the Preview pane's Screens tab), with their version; null when none.
    wireframes: f.wireframes ?? null,
    // The review walkthrough built for its branch (lib/docs.js walkthroughInfo): the Preview pane's Walkthrough tab.
    walkthrough: f.walkthrough ?? null,
    repo: f.repoPath ? { name: path.basename(f.repoPath), branch: f.branch } : null,
    cost: { totalUsd: Math.max(f.cost.totalUsd, active?.costUsd ?? 0), source: f.cost.source },
    progress: { done: f.stageState === 'done' ? ids.length : Math.max(0, at), total: ids.length },
    updatedAt: f.updatedAt, sources: f.sources, permissions: pendingList.length, limitPaused, limitAuto: limits.autoResume,
    // Levels: chosen (options.json), the Foreman's suggestion (status.json), the rules' (description only here).
    level: f.level, suggestedLevel: f.suggestedLevel, levelReason: f.levelReason, rulesLevel: f.rulesLevel,
    // A gate left waiting past the parking time: still Needs you, with a "parked" chip.
    parked: gateParked(f, active),
    finish,
    // The PR hand-offs waiting on someone (lib/nudges.js): the Desk's nudge items.
    nudges: nudgesFor({ stage: f.stage, prs: f.prs, closed: off ? f.closed : null, finish }, lane, { dismissed: f.dismissedNudges, sent: f.sentNudges }),
    // Marked done or dropped: off the board, unless something is going on or the job changed since.
    ...(off
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

// The spec when the dashboard may show it: a .md inside the job's repository or its own folder
// (status.json, which names it, is written by the AI; lib/docs.js servableSpec). Else null.
const shownSpec = (f) => servableSpec(specFile(f), [f.repoPath, f.dir]);

async function jobDocs(f) {
  const docs = [];
  const spec = await shownSpec(f);
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
    // The proof stamp: the commit the test report checked, and whether the branch moved on since.
    const reportText = await readInside(f.dir, 'test-report.md');
    if (reportText) {
      const where = f.worktree ?? f.repoPath;
      const head = where && f.branch ? await git.headOf(where, f.branch) : null;
      const reportAt = await fsp.stat(path.join(f.dir, 'test-report.md')).then((st) => st.mtime.toISOString(), () => null);
      gate = { ...gate, proof: proofStamp({ reportText, reportAt, head }) };
    }
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
  // frame-src: the one frame this page opens is the screens server (the wireframes page, below).
  'Content-Security-Policy': `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src ${WIREFRAMES_ORIGIN}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
// The wireframes page's own policy (the screens server's GET /job/:slug/wireframes): what
// feature-wireframe's template loads and nothing more. KEEP IN STEP with the skill's template.html
// and build.py. frame-ancestors names this dashboard by both names hostAllowed accepts; it is the
// one frame header (X-Frame-Options would say SAMEORIGIN, which the second origin is not).
const WIREFRAMES_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "img-src data:",
  "font-src data: https://fonts.gstatic.com",
  `frame-ancestors http://127.0.0.1:${PORT} http://localhost:${PORT}`,
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
// The screens server's headers: no token, no Play, no opener or resource policy (the page is a
// cross-origin frame by design); just the policy above and the plain safety headers.
const WIREFRAMES_HEADERS = { 'Content-Security-Policy': WIREFRAMES_CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
// Play mode's easter-egg headers (the crew's names, the Clacks Overhead); none while it is Off.
const CREW_HEADERS = crewHeaders(Object.values(AGENTS).map((a) => a.name));
const playHeaders = () => (playOn() ? CREW_HEADERS : {});
function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...playHeaders(), 'Content-Type': type, ...extra });
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
// The most text POST /api/job/:slug/render previews at once (characters).
const RENDER_MAX = 100000;
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
    // How notifications reach macOS here (null: they can't, or the demo, which sends only the test).
    notifyMethod: DEMO ? null : await notifier.method(),
    // Where a job's screens page is served from (its own origin): the Screens tab frames <origin>/job/<slug>/wireframes.
    // null when that server couldn't listen (screensDown): the tab then shows nothing and says so.
    wireframesOrigin: screensDown ? null : WIREFRAMES_ORIGIN,
    settings: await state.getSettings(), liveLink: { enabled: (await readHookSessions(state.dir)).enabled, script: HOOK_SCRIPT },
    // The finish line's choices (lib/finish.js), with their words, for Settings → Workflow.
    finishLines: FINISH_LINES.map((id) => ({ id, ...FINISH_LINE_INFO[id] })),
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
  // Notifications outside the browser: how they reach macOS here, and the last 50.
  '/api/notifications': async () => ({ method: await notifier.method(), blocked: notifier.blocked, history: await notifier.list() }),
  // The flow map (Home): each repo's jobs on their way to staging and main (lib/flow.js).
  '/api/flow': async () => flow.view(),
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
      permissions: driver.pendingPermissions(), usage: limits.view(), planUsage: planUsage.view(), runTypical, generatedAt: new Date().toISOString(),
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
  // The play ledger (lib/play.js ledgerView): crew met, quests done, achievements, secrets found.
  // Play mode Off: only that, nothing read or built.
  '/api/play': async () => (playOn() ? ledgerView(await playbook.current(), playNow) : { mode: 'off' }),
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
  if (urlPath === '/api/teapot' && playOn()) {
    // A real 418. Found from this browser or a terminal (never from another site's page), it is a
    // secret; come from the X-Crew-Note header (?from=headers), so is that one.
    const site = req.headers['sec-fetch-site'];
    if (!site || site === 'same-origin' || site === 'none') {
      await recordSecret('teapot');
      if (url.searchParams.get('from') === 'headers') await recordSecret('headers');
    }
    return sendJson(res, 418, TEAPOT);
  }
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
    // The Decisions tab: every choice you made on this job, newest first (lib/decisions.js).
    if (sub === '/decisions') return sendJson(res, 200, { decisions: decisionLog(await state.auditFor(f.dir, Infinity)) });
    if (sub === '/docs') {
      // The Docs tab's list: every document of the job, grouped, with versions and times (lib/docs.js).
      const specPath = await shownSpec(f);
      return sendJson(res, 200, { docs: await listJobDocs(f.dir, { spec: specPath ? { path: specPath, version: f.spec?.version ?? null } : null, recorded: f.recordedArtifacts }) });
    }
    if (sub === '/wireframes') {
      // The screens page is never served from this origin: an HTML file a model wrote would share
      // the dashboard's document, storage and token. The screens server (below) serves it instead.
      throw new HttpError(410, `The screens page is served from its own address: ${WIREFRAMES_ORIGIN}/job/<slug>/wireframes (meta.wireframesOrigin).`);
    }
    if (sub === '/doc') {
      // One document, rendered (sanitised, lib/markdown.js) and as its source text. Inside the job
      // folder only: no way out, no symlinks, .md and .json only, at most DOC_MAX_BYTES (lib/docs.js).
      // The spec ('spec') only when it is a .md inside the job's repository or folder (shownSpec).
      const file = url.searchParams.get('file') ?? '';
      let doc;
      let name;
      let specPath = null;
      if (file === 'spec') {
        const p = (specPath = await shownSpec(f));
        name = 'Product spec';
        const st = p ? await fsp.stat(p).catch(() => null) : null;
        if (!st?.isFile()) throw new HttpError(404, 'That file isn’t there (yet).');
        if (st.size > DOC_MAX_BYTES) throw new HttpError(413, `The spec is too big to show here (at most ${Math.round(DOC_MAX_BYTES / 1024)} KB). Open it in your editor instead.`);
        const text = await fsp.readFile(p, 'utf8').catch(() => null);
        if (text === null) throw new HttpError(404, 'That file isn’t there (yet).');
        doc = { text, updatedAt: st.mtime.toISOString(), size: st.size };
      } else {
        try { doc = await readJobDoc(f.dir, file); } catch (err) { throw err instanceof DocError ? new HttpError(err.status, err.message) : err; }
        name = f.artifacts.find((a) => a.file === file)?.name ?? describeDoc(file).name;
      }
      const type = /\.json$/i.test(file) ? 'json' : 'md';
      const html = type === 'json' ? jsonHtml(doc.text) : renderMarkdown(doc.text, { idHref: idHref(f) });
      // Its Key points, when the Foreman wrote them (summaries/, lib/docs.js readSummary): null when none.
      const summary = await readSummary(f.dir, file, file === 'spec' ? f.spec?.version ?? null : docVersion(f.dir, file, f.recordedArtifacts)).catch(() => null);
      return sendJson(res, 200, { file, name, type, html, text: doc.text, updatedAt: doc.updatedAt, size: doc.size, vscode: file === 'spec' ? specPath : path.join(f.dir, file), summary });
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
  if (urlPath === '/api/presence') {
    // The page is visible: notifications that it shows anyway don't pop on macOS meanwhile.
    if (body.visible === true) notifier.seen();
    else if (body.visible === false) notifier.unseen();
    return sendJson(res, 200, { ok: true });
  }
  if (urlPath === '/api/notifications/test') {
    const entry = await notifier.notify({ level: 'needs', title: 'A test from Feature Workshop', body: 'Notifications reach you here. Clicking one opens the dashboard.', test: true });
    events.emit('notification', null, entry);
    return sendJson(res, 200, entry);
  }
  if (urlPath === '/api/flow/refresh') {
    // Fetch both remotes and read the PRs now (read-only), instead of waiting for the next 10-minute refresh.
    flow.refresh({ network: true }).catch((err) => console.error('flow:', err));
    return sendJson(res, 202, flow.view());
  }
  if ((m = /^\/api\/job\/([^/]+)\/render$/.exec(urlPath))) {
    // Markdown you are writing (the drawer's notes Preview), rendered by the same sanitising renderer
    // as every document. Nothing is saved or sent anywhere; a POST only so the text isn't in a URL.
    const f = await featureBySlug(m[1]);
    if (!f) throw new HttpError(404, 'No job by that name.');
    if (typeof body.text !== 'string') throw new HttpError(400, 'The text to preview must be text.');
    if (body.text.length > RENDER_MAX) throw new HttpError(413, `Too long to preview (at most ${RENDER_MAX.toLocaleString('en')} characters).`);
    return sendJson(res, 200, { html: renderMarkdown(body.text, { idHref: idHref(f) }) });
  }
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
  if ((m = /^\/api\/job\/([^/]+)\/nudge\/([\w-]+)\/(dismiss|yes)$/.exec(urlPath))) {
    // A hand-off nudge on the Desk (lib/nudges.js). dismiss: remembered for this job, so it isn't
    // shown again. yes: the nudge's one sentence goes to the job's Foreman exactly as a message from
    // the box does (sendPlan, startSend), audited as a 'send' of kind 'nudge' plus a 'nudge' line.
    // The id is remembered as sent (sentNudges, in the same record) once the message has started:
    // the nudge's source is the PR state, which changes only once the Foreman has done the work, so
    // without that it would come straight back and a second yes would send the sentence again. Not
    // before: a start that fails (Busy: a reply began in between; a spawn failure) would otherwise
    // leave the nudge marked sent, with nothing sent and no audit. A reply that ends in error never
    // delivered it either, so the id is dropped again then (nudgeRuns, below the 'run' listener).
    const f = await featureBySlug(m[1]);
    if (!f) throw new HttpError(404, 'No job by that name.');
    const id = m[2];
    if (!NUDGE_IDS.includes(id)) throw new HttpError(404, 'No nudge by that name.');
    const saved = await state.sessionFor(f.dir);
    const listOf = (key) => (Array.isArray(saved?.[key]) ? saved[key] : []);
    if (m[3] === 'dismiss') {
      const dismissed = [...new Set([...listOf('dismissedNudges'), id])];
      await state.setSession(f.dir, { dismissedNudges: dismissed });
      await state.audit({ action: 'nudge-dismissed', featureDir: f.dir, slug: f.slug, nudge: id });
      cached = null;
      return sendJson(res, 200, { ok: true, dismissed });
    }
    if (listOf('sentNudges').includes(id)) throw new HttpError(409, 'That was already sent to the Foreman. Nothing was sent again.', { code: 'nudge-sent' });
    const nudge = nudgesFor({ stage: f.stage, prs: f.prs, closed: f.closed }, flowLanes.get(f.slug) ?? null, { finishLine: finishLineNow }).find((n) => n.id === id);
    if (!nudge) throw new HttpError(409, 'That nudge no longer applies: the PRs have moved on. Nothing was sent.', { code: 'stale-nudge' });
    if (!nudge.action) throw new HttpError(400, 'That nudge is a link to GitHub; there is nothing to send.');
    const drive = await driveState(f);
    const out = sendPlan(f, drive, body, nudge.action.send);
    const run = await startSend(f, out, { kind: 'nudge' });
    const tracked = { featureDir: f.dir, nudge: id, failed: false };
    nudgeRuns.set(run.id, tracked);
    await state.setSession(f.dir, { sentNudges: [...new Set([...listOf('sentNudges'), id])] });
    cached = null;
    if (tracked.failed) await unsendNudge(f.dir, id); // the reply already ended in error (a spawn failure): not sent after all
    await state.audit({ action: 'nudge', featureDir: f.dir, slug: f.slug, nudge: id, text: nudge.action.send, runId: run.id });
    return sendJson(res, 200, { ok: true, sent: true, text: nudge.action.send, run });
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
    // notify: notifications outside the browser (lib/notify.js validateNotifyPatch).
    if (body.notify !== undefined) {
      let next;
      try { next = validateNotifyPatch(body.notify, (await state.getSettings()).notify); } catch (err) { throw new HttpError(400, err.message); }
      await state.setSettings({ notify: next });
      settingsChanged();
      return sendJson(res, 200, await state.getSettings());
    }
    // workflow: the finish line (lib/finish.js): what counts as done, everywhere; and the screens
    // (wireframes) and clarify defaults a new job's options.json starts with (lib/state.js).
    if (body.workflow !== undefined) {
      const w = body.workflow;
      if (!w || typeof w !== 'object' || Array.isArray(w)) throw new HttpError(400, 'The workflow settings must be an object.');
      const keys = Object.keys(w);
      for (const k of keys) if (!['finishLine', 'wireframes', 'clarify'].includes(k)) throw new HttpError(400, `Unknown workflow setting: ${String(k).slice(0, 40)}.`);
      if (!keys.length) throw new HttpError(400, 'Send a workflow setting to change: finishLine, wireframes or clarify.');
      if (w.finishLine !== undefined && !FINISH_LINES.includes(w.finishLine)) throw new HttpError(400, 'The finish line is PR #1 open, PR #1 merged, in staging, in main, or when you mark it done.');
      for (const k of ['wireframes', 'clarify']) if (w[k] !== undefined && !WORKFLOW_CHOICES.includes(w[k])) throw new HttpError(400, `${k === 'wireframes' ? 'Screens' : 'Clarify questions'} for new jobs: Auto, Always or Off.`);
      const was = (await state.getSettings()).workflow;
      const next = { ...was, ...w };
      await state.setSettings({ workflow: next });
      finishLineNow = next.finishLine;
      if (next.finishLine !== was.finishLine) {
        // Every card's group may move: the pages fetch again. The ledger counts quests by the new
        // line, muted (what it finds was earned before). The Done notices start over: the next look
        // seeds what is already past the new line (never told again), and a job told Done at the
        // old line but short of the new one is told again when it gets there.
        cached = null;
        broadcast('change', { at: Date.now() });
        events.emit('change', null, { at: Date.now() });
        playbook.schedule(0, { muted: true });
        finishBefore.clear();
        finishTold.clear();
      }
      await state.audit({ action: 'settings', workflow: w });
      settingsChanged();
      return sendJson(res, 200, await state.getSettings());
    }
    // play: Play mode and sounds (lib/play.js validatePlayPatch).
    if (body.play !== undefined) {
      let patch;
      try { patch = validatePlayPatch(body.play); } catch (err) { if (err instanceof PlayError) throw new HttpError(400, err.message); throw err; }
      const was = (await state.getSettings()).play;
      const next = playSettings({ ...was, ...patch });
      await state.setSettings({ play: next });
      playNow = next;
      // Off: stop and forget. Back on: one refresh to catch up, with no unlock events (like a
      // rebuild: it only finds what was earned meanwhile).
      if (next.mode === 'off') playbook.forget();
      else if (was.mode === 'off') playbook.refresh({ muted: true }).catch((err) => console.error('play ledger:', err));
      await state.audit({ action: 'settings', play: patch });
      settingsChanged();
      if (body.policy === undefined && body.recheckAuto !== true) return sendJson(res, 200, await state.getSettings());
    }
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
  // The top bar's usage meters: read the plan's usage now instead of at the next minute.
  if (urlPath === '/api/usage/check') return sendJson(res, 200, await planUsage.check());
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
  if (urlPath === '/api/play/secret' || urlPath === '/api/play/event') {
    // An easter egg found, or something the page saw you do (a theme tried), from fixed lists only.
    // Recorded once, as an audit line, so the ledger can always be rebuilt. Nothing while Play is Off.
    // The teapot, the headers and the Hex Sommelier are the dashboard's to find, never the page's.
    const secret = urlPath === '/api/play/secret';
    const id = typeof body.id === 'string' ? body.id : '';
    const kind = secret ? null : typeof body.kind === 'string' ? body.kind : '';
    if (secret && !PAGE_SECRETS.includes(id)) throw new HttpError(400, 'Unknown secret.');
    if (!secret && !(Object.hasOwn(PLAY_EVENTS, kind) && PLAY_EVENTS[kind].includes(id))) throw new HttpError(400, 'Unknown play event.');
    if (!playOn()) return sendJson(res, 200, { recorded: false, reason: 'Play mode is off.' });
    const ledger = await playbook.current();
    // A hidden theme (CRT Terminal, Gold) counts only once the ledger has unlocked it.
    if (!secret && kind === 'theme' && !themeUnlocked(ledger, id)) throw new HttpError(409, 'That theme is still locked.');
    const already = secret ? Boolean(ledger?.secrets?.[id]) : Boolean(ledger?.themes?.[id]);
    if (!already) {
      await state.audit(secret ? { action: 'play-secret', id } : { action: 'play-event', kind, id });
      await playbook.refresh();
    }
    const view = ledgerView(playbook.ledger, playNow);
    return sendJson(res, 200, { recorded: !already, secrets: view.secrets, themesTried: view.themesTried });
  }
  if (urlPath === '/api/jobs') {
    const description =str(body.description, 600).replace(/\s+/g, ' ').trim();
    if (description.length < 4) throw new HttpError(400, 'Describe the job in a few words.');
    if (limits.isLimited() && body.despiteLimit !== true) throw new HttpError(409, limitMessage(), { code: 'limited' });
    const repo = await checkRepo(str(body.repoPath, 1000));
    if (!repo.ok) throw new HttpError(400, repo.reason);
    let options;
    // A new job starts with Settings → Workflow's screens and clarify defaults, unless you chose here.
    try { options = normalizeOptions(body.options ?? {}, { workflow: (await state.getSettings()).workflow }); } catch (err) { throw new HttpError(400, err.message); }
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
  changeTimer = setTimeout(() => { cached = null; broadcast('change', { at: Date.now() }); events.emit('change', null, { at: Date.now() }); flowJobsChanged(); checkWaiting().catch(() => {}); }, 700);
}
driver.on('run', (run) => { cached = null; broadcast('run', run); events.emit('run', run.slug, run); });
// Nudges on their way to the Foreman (run id -> the job's folder and the nudge id; the nudge route).
// A nudge reply that ends in error never delivered its sentence, so the id leaves sentNudges and
// the nudge comes back on the Desk.
const nudgeRuns = new Map();
async function unsendNudge(featureDir, id) {
  const saved = await state.sessionFor(featureDir);
  const sent = Array.isArray(saved?.sentNudges) ? saved.sentNudges : [];
  if (!sent.includes(id)) return;
  await state.setSession(featureDir, { sentNudges: sent.filter((x) => x !== id) });
  cached = null;
  broadcast('change', { at: Date.now() }); events.emit('change', null, { at: Date.now() });
}
driver.on('run', (run) => {
  const tracked = run.kind === 'nudge' ? nudgeRuns.get(run.id) : null;
  if (!tracked || ACTIVE_RUN.has(run.status)) return;
  nudgeRuns.delete(run.id);
  if (run.status !== 'error') return;
  tracked.failed = true;
  unsendNudge(tracked.featureDir, tracked.nudge).catch((err) => console.error('nudge:', err));
});

// ---------- The flow map (Home): where each job's work is on its way to main (lib/flow.js) ----------

// Open jobs, and jobs closed in the last 30 days (their work may still be on its way to main).
const FLOW_CLOSED_DAYS = 30;
const flow = new FlowWatch({
  jobsFor: async () => (await featuresShared())
    .filter((f) => !f.closed || Date.now() - Date.parse(f.closed.at ?? 0) < FLOW_CLOSED_DAYS * 86400000)
    .map((f) => ({ slug: f.slug, title: f.title, branch: f.branch, worktree: f.worktree, repoPath: f.repoPath, stage: f.stage ?? null, closed: f.closed ?? null })),
  gather: DEMO ? (await import('./demo/fake-flow.js')).fakeFlow : gatherRepo,
});
// Live only (not kept for replay): a page that reconnects fetches the map again. The lanes are kept
// for each card's `finish`; when one moved, the cards' groups may have, so the pages fetch again.
flow.on('flow', (view) => {
  const lanes = new Map(view.repos.flatMap((r) => r.lanes.map((l) => [l.slug, l])));
  // Moved: a lane's place or one of its PRs' state or review (a merge on an org branch that
  // already existed doesn't move the lane, but it changes the job's nudges).
  const mark = (l) => l && JSON.stringify([l.position, l.pr1?.state, l.pr2?.state, l.pr2?.review]);
  const moved = [...lanes].some(([slug, l]) => mark(flowLanes.get(slug)) !== mark(l)) || [...flowLanes.keys()].some((slug) => !lanes.has(slug));
  flowLanes = lanes;
  if (moved) { cached = null; broadcast('change', { at: Date.now() }); events.emit('change', null, { at: Date.now() }); }
  events.emit('flow', null, view, { replay: false });
  if (!view.refreshing) flowNotices(view).catch((err) => console.error('flow notices:', err));
});
flow.on('problem', (err) => console.error('flow:', err));

// ---------- Notifications outside the browser (lib/notify.js) ----------

const notifier = new Notifier({ dir: state.dir, settings: async () => (await state.getSettings()).notify, baseUrl: `http://${HOST}:${PORT}`, demo: DEMO });
const stageOfSlug = (slug) => knownStage.get(slug) ?? null;
async function tell(n) {
  try { events.emit('notification', n.slug ?? null, await notifier.notify(n)); } catch (err) { console.error('notify:', err); }
}
// A job that has just started waiting for you (a go-ahead, a question, a reply). Permissions are
// told as they arrive (below). What was already waiting when the dashboard started never tells.
let waitingBefore = null;
let checking = null;
let checkAgain = false;
// One check at a time; a request during one runs once after it (so a job is never told twice).
function checkWaiting() {
  if (checking) { checkAgain = true; return checking; }
  checking = checkWaitingNow().catch(() => {}).finally(() => {
    checking = null;
    if (checkAgain) { checkAgain = false; checkWaiting(); }
  });
  return checking;
}
async function checkWaitingNow() {
  const cards = await boardCards(await featuresShared());
  const now = new Map(cards.filter((c) => c.needsYou && c.waitingFor !== 'permission').map((c) => [c.slug, c]));
  if (waitingBefore) {
    for (const [slug, c] of now) {
      if (waitingBefore.has(slug)) continue;
      const what = c.waitingFor === 'answers' ? 'The Foreman asked you something.' : c.waitingFor === 'approval' ? 'The Foreman is waiting for your go-ahead.' : 'The Foreman is waiting for your reply.';
      tell({ level: 'needs', title: c.title, body: noticeBody({ stage: c.stage, waitingSince: c.waitingSince, headline: c.headline, title: c.title, what }), slug, key: `wait:${slug}` });
    }
  }
  waitingBefore = new Set(now.keys());
}
// The finish line (lib/finish.js) and the flow map. "Done" is told once, when a job crosses the
// line you set, whatever crossed it (a PR merged, Mark done); reaching staging or main after that
// is a quiet "Landed" (no sound, only while Done isn't off); never twice for one job and one place.
// Only from a repo whose PRs were read without errors: after a refresh that couldn't read them
// (offline at start-up, gh not signed in), every job would seem to move at once. What was already
// past the line when the dashboard started is never told (finishTold is seeded at the first look).
const finishBefore = new Map(); // slug → { reached, landed } at the last look
const finishTold = new Map(); // slug → Set of 'done' | 'staging' | 'main'
const toldOf = (slug) => { if (!finishTold.has(slug)) finishTold.set(slug, new Set()); return finishTold.get(slug); };
function doneWords(finish, repoName) {
  if (finish.by === 'marked') return 'Marked done.';
  if (finish.by === 'pr1-open') return 'PR #1 is open: the finish line you set.';
  if (finish.by === 'pr1-merged') return `PR #1 merged: it’s on ${repoName ? `${repoName}’s` : 'the'} Moxie branch, the finish line you set.`;
  if (finish.by === 'staging') return `In staging${repoName ? ` (${repoName})` : ''}: the finish line you set.`;
  return `Released: it’s in ${repoName ? `${repoName}’s` : ''} main, the finish line you set.`;
}
// One look at a job: tells what is new since the last look. first: the first look seeds, tells nothing.
function noteFinish({ slug, title, finish, repoName }) {
  const was = finishBefore.get(slug);
  finishBefore.set(slug, { reached: finish.reached, landed: finish.landed });
  const told = toldOf(slug);
  if (was === undefined) {
    if (finish.reached) told.add('done');
    if (finish.landed) { told.add('staging'); if (finish.landed === 'main') told.add('main'); }
    return;
  }
  if (finish.reached && !was.reached && !told.has('done')) {
    told.add('done');
    // The crossing itself was a landing too: one notification, not two.
    if (finish.landed && finish.by === finish.landed) told.add(finish.landed);
    tell({ level: 'done', title, body: doneWords(finish, repoName), slug, key: `finish:${slug}` });
  }
  if (!finish.reached || !finish.landed) return;
  for (const place of finish.landed === 'main' ? ['staging', 'main'] : ['staging']) {
    if (told.has(place)) continue;
    told.add(place);
    if (place !== finish.landed) continue; // staging passed on the way to main: say main only
    const body = place === 'main' ? `Landed in main${repoName ? ` (${repoName})` : ''}: released.` : `Landed in staging${repoName ? ` (${repoName})` : ''}, waiting for the release.`;
    tell({ level: 'done', title, body, slug, key: `landed:${slug}:${place}`, quiet: true });
  }
}
async function flowNotices(view) {
  const jobs = new Map((await featuresShared()).map((f) => [f.slug, f]));
  for (const r of view.repos) {
    if (!r.prsKnown || r.errors?.length) continue;
    for (const l of r.lanes) {
      const f = jobs.get(l.slug);
      const finish = finishLineReached({ prs: f?.prs ?? null, closed: f?.closed ?? null }, l, finishLineNow);
      noteFinish({ slug: l.slug, title: l.title ?? f?.title ?? l.slug, finish, repoName: r.name });
    }
  }
}
driver.on('permission', (p) => tell({ level: 'needs', title: p.title ?? p.slug, body: noticeBody({ stage: stageOfSlug(p.slug), what: p.kind === 'question' ? 'A question for you.' : `Permission: ${String(p.plain?.headline ?? p.toolName).slice(0, 100)}` }), slug: p.slug, key: `perm:${p.id}` }));
const toldErrors = new Set();
const endedRuns = new Set();
driver.on('run', (run) => {
  // A reply ended: the job may now wait for your go-ahead (its card shows only once nothing runs).
  if (!ACTIVE_RUN.has(run.status) && !endedRuns.has(run.id)) { endedRuns.add(run.id); setTimeout(() => checkWaiting(), 1000); }
  if (run.status !== 'error' || toldErrors.has(run.id)) return;
  toldErrors.add(run.id);
  tell({ level: 'problem', title: run.title ?? run.slug, body: noticeBody({ stage: stageOfSlug(run.slug), what: 'The reply ended with an error. Open the job to see it.' }), slug: run.slug, key: `error:${run.id}` });
});
driver.on('usage-limit', ({ run }) => tell({ level: 'problem', title: 'Usage limit reached', body: `Work is paused until Claude’s limit resets${run?.title ? ` (${run.title})` : ''}.`, slug: run?.slug ?? null, key: 'usage-limit' }));
// Marked done: the finish line crossed by hand (unless this job was already told).
state.on('audit', (e) => {
  if (e.action !== 'close' || e.as !== 'done' || !e.slug) return;
  featureBySlug(e.slug).then((f) => {
    const finish = finishLineReached({ prs: f?.prs ?? null, closed: { as: 'done', at: e.at } }, flowLanes.get(e.slug) ?? null, finishLineNow);
    const was = finishBefore.get(e.slug);
    if (was === undefined) finishBefore.set(e.slug, { reached: false, landed: finish.landed }); // never seen: still news
    noteFinish({ slug: e.slug, title: f?.title ?? e.slug, finish, repoName: f?.repoPath ? path.basename(f.repoPath) : null });
  }).catch(() => {});
});
// Jobs changed: recount locally (no network), at most every 15 seconds.
let flowLocalAt = 0;
function flowJobsChanged() {
  if (Date.now() - flowLocalAt < 15000) return;
  flowLocalAt = Date.now();
  flow.refresh({ network: false }).catch(() => {});
}
driver.on('permission', (p) => { broadcast('permission', p); events.emit('permission', p.slug, p); });
driver.on('permission-gone', (p) => { broadcast('permission-gone', p); events.emit('permission-gone', p.slug ?? null, p); });
// Where a steered message is (queued, delivered, acted-on, cancelled): the new UI only.
driver.on('steer', (s) => { events.emit('steer', s.slug ?? null, s); });
// How long a Foreman reply usually takes (lib/run-typical.js), for the running rows' "usually 2m".
// Read from the audit at start and again after each reply ends.
let runTypical = { all: null, byKind: {} };
async function refreshRunTypical() {
  const next = typicalRuns(await state.auditAll());
  if (JSON.stringify(next) === JSON.stringify(runTypical)) return;
  runTypical = next;
  events.emit('run-typical', null, runTypical);
}
const countedRuns = new Set();
driver.on('run', (run) => {
  if (!run.endedAt || countedRuns.has(run.id)) return;
  countedRuns.add(run.id);
  refreshRunTypical().catch(() => {});
});
planUsage.on('change', (view) => { events.emit('plan-usage', null, view); });
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
  if (slug && !slug.startsWith('.')) { threadChanged(slug, 'files'); playbook.noteJob(slug); playbook.schedule(); }
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

// The screens server (WIREFRAMES_ORIGIN): one route, GET /job/:slug/wireframes, the job's
// wireframes.html from its folder (lib/docs.js readWireframes: the one HTML file ever served from
// there, never a symlink, nothing too big) under the page's own policy. The page may run its own
// inline script and styles, show data: images and load the fonts and the two pinned libraries its
// template names, and nothing else: no fetches, no other frames, no forms. Only this dashboard may
// frame it. Being another origin, its script can't read the dashboard's document, storage or token,
// and nothing here hands out the token or anything else: every other path is 404.
const WIREFRAMES_ROUTE = /^\/job\/([^/]+)\/(wireframes|walkthrough)$/;
const sendScreens = (res, status, body, type = 'text/plain; charset=utf-8') => { res.writeHead(status, { ...WIREFRAMES_HEADERS, 'Content-Type': type }); res.end(body); };
const screensServer = http.createServer(async (req, res) => {
  if (!hostAllowed(req.headers.host)) return sendScreens(res, 421, 'Misdirected request');
  let urlPath;
  let download = false;
  try {
    const u = new URL(req.url, 'http://localhost');
    urlPath = decodeURIComponent(u.pathname);
    download = u.searchParams.get('download') === '1';
  } catch { return sendScreens(res, 400, 'Bad request'); }
  const m = req.method === 'GET' ? WIREFRAMES_ROUTE.exec(urlPath) : null;
  if (!m) return sendScreens(res, 404, 'Not found');
  try {
    const f = await featureBySlug(m[1]);
    if (!f) throw new HttpError(404, 'No job by that name.');
    let page;
    try { page = m[2] === 'walkthrough' ? await readWalkthrough(f, { forDownload: download }) : await readWireframes(f.dir); } catch (err) { throw err instanceof DocError ? new HttpError(err.status, err.message) : err; }
    // ?download=1 on the walkthrough: the file as it was built, saved rather than shown, to send to a teammate.
    if (download && page.fileName) {
      res.writeHead(200, { ...WIREFRAMES_HEADERS, 'Content-Type': TYPES['.html'], 'Content-Disposition': `attachment; filename="${page.fileName}"` });
      return res.end(page.html);
    }
    return sendScreens(res, 200, page.html, TYPES['.html']);
  } catch (err) {
    if (err instanceof HttpError) return sendScreens(res, err.status, JSON.stringify({ error: err.message }), TYPES['.json']);
    console.error(err);
    return sendScreens(res, 500, JSON.stringify({ error: 'Something went wrong. The details are in the terminal running the dashboard.' }), TYPES['.json']);
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
  // The play ledger: read play.json, or rebuild it from the audit log when it is missing. Not while Play is Off.
  if (playOn()) playbook.refresh().catch((err) => console.error('play ledger:', err));
  // The flow map: fetch and read PRs now, then every 10 minutes; recount locally every minute.
  flow.start();
  // The top bar's usage meters: read now, then every minute.
  planUsage.start();
  refreshRunTypical().catch(() => {});
  // What waits for you now: later changes are told as notifications, these never are.
  checkWaiting().catch(() => {});
});
// The screens server starts with the dashboard (its own origin; see WIREFRAMES_PORT). When it can't
// listen (the port is taken), the dashboard runs without it: meta.wireframesOrigin is null, and the
// 'change' event makes open pages fetch a fresh snapshot (with that meta) so their Screens tab stops
// framing the port.
screensServer.on('error', (err) => {
  screensDown = true;
  console.error(`screens server: couldn’t listen at ${WIREFRAMES_ORIGIN} (${err.code ?? err.message}); the Screens tab is off. Set WIREFRAMES_PORT to a free port and restart.`);
  cached = null;
  notifyChange();
});
screensServer.listen(WIREFRAMES_PORT, HOST, () => {
  console.log(`  screens:  ${WIREFRAMES_ORIGIN} (a job’s wireframes page, framed by the dashboard)`);
});

// Stopping the dashboard pauses any reply in progress; sessions stay resumable.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const r of driver.list()) if (ACTIVE_RUN.has(r.status)) driver.stop(r.id);
    local.stopAll(); // dev servers and commands started from the page stop with it
    screensServer.close(); // the screens server stops with the dashboard
    setTimeout(() => process.exit(0), 400);
  });
}
