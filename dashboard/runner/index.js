// The runner: Ground Control's machine half (plan §2, §2.1). It owns the Foreman driver, the job
// folders and their locks, git and worktrees, Try it on this computer, usage reading, the
// notifications, the flow map, the integration board and the Orbit read token. It knows nothing
// about HTTP: the site (dashboard/site/) asks it things through three doors only:
//
//   handle(command)  every change: one command from lib/protocol.js, checked by parseCommand first,
//                    then the same code the routes ran before the split. Returns the answer's data;
//                    a refusal is an HttpError (lib/http-guard.js) with the status and words the
//                    page has always had.
//   read             what the site reads in local mode: jobs, one job, its documents and thread,
//                    diffs, costs, usage, the flow map, Orbit's status. Plain functions returning
//                    data (in v2 these become mirrored records).
//   on(type, fn)     the events it sends up (lib/protocol.js EVENT_TYPES), which feed the page's
//                    event streams.
//
// `local` is what only this computer's own page uses, in local mode: the notifier's presence and
// test, a flow refresh, Play's secrets, the Orbit token and inbox, the integration board.
//
// start() opens it: the usage limit, parked gates, the watchers, and the restart replay
// (runner/replay.js): a reply paused by a clean stop carries on by itself, one cut off by a crash
// is shown paused. stop() pauses every reply in progress (sessions stay resumable), writes the
// audit line `service-stop` naming them, and removes service.json (runner/service-file.js).

import { EventEmitter } from 'node:events';
import { nodeCommand, tempDirs, terminalApps } from '../lib/platform.js';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadFeatures, loadGateStates, SessionIndex } from '../lib/features.js';
import { STAGES, AGENTS } from '../lib/stages.js';
import { PRICES, PRICES_AS_OF, whatIfConductor, costCsv, costMarkdown } from '../lib/cost.js';
import { State, WORKFLOW_CHOICES } from '../lib/state.js';
import { Driver, Busy } from '../lib/driver.js';
import { renderMarkdown, indexIds } from '../lib/markdown.js';
import * as git from '../lib/git.js';
import { recentRepos, checkRepo, reposDoor } from '../lib/repos.js';
import { HttpError } from '../lib/http-guard.js';
import { liveTerminals } from '../lib/live.js';
import { readHookSessions } from '../lib/hook-events.js';
import { classify, matchRule, POLICIES } from '../lib/policy.js';
import { RuleStore, RuleError, validateRule, describeRule } from '../lib/rules.js';
import { buildOverview, parseBrief } from '../lib/overview.js';
import { LimitWatch } from '../lib/limits.js';
import { PlanUsage } from '../lib/plan-usage.js';
import { LocalRunner } from '../lib/local.js';
import { History, historyMarkdown } from '../lib/history.js';
import { removeWorktree, checkWorktree } from '../lib/close.js';
import { FLOWS, SKIPPABLE, PROVIDABLE, REVIEWERS, FABLE_POINTS, OPUS, FOREMAN_MODEL_IDS, MODEL_IDS, MODEL_CHOICES, defaultsFor, normalize as normalizeOptions, readOptions, writeOptions, describeOptions, foremanModel, levelsForClient, optionsAtLevel, isLevel, normalizeTicket, ticketSlug, ticketBranch, startFromTicket } from '../lib/options.js';
import { groupCards, laneFor } from '../lib/snapshot.js';
import { FINISH_LINES, FINISH_LINE_INFO, finishLineReached } from '../lib/finish.js';
import { NUDGE_IDS, nudgesFor } from '../lib/nudges.js';
import { buildThread, pageThread } from '../lib/thread.js';
import { DECISIONS_FILE, decisionLog, ticketCopy, writeDecisionsFile } from '../lib/decisions.js';
import { typicalRuns } from '../lib/run-typical.js';
import { proofStamp } from '../lib/proof.js';
import { suggestLevel, changedPaths, diffSummary } from '../lib/levels.js';
import { checkDiff, chooseLevel } from '../lib/auto-level.js';
import { GATE_PARK_MS, GateParking, RaisedVersions, isGateWaiting, isParkable, gateView, answeredBriefs, isGateDecision } from '../lib/gate.js';
import { composeReply, cleanChips } from '../lib/compose.js';
import { skillChecker } from '../lib/skill-check.js';
import { DOC_MAX_BYTES, DocError, describeDoc, docVersion, jsonHtml, listJobDocs, readJobDoc, readSummary, readWalkthrough, readWireframes, servableSpec } from '../lib/docs.js';
import { PlayBook, PlayError, PAGE_SECRETS, PLAY_EVENTS, TEAPOT, hexCommit, ledgerView, parseReviewFindings, playSettings, themeUnlocked, validatePlayPatch } from '../lib/play.js';
import { parseStatusJson } from '../lib/status-json.js';
import { autoModeEnvironment, remotesOf } from '../lib/auto-env.js';
import { goAheadCovers } from '../lib/hard-lines.js';
import { FlowWatch, gatherRepo } from '../lib/flow.js';
import { noticeBody, Notifier, validateNotifyPatch } from '../lib/notify.js';
import { Integrator, IntegrateError } from '../lib/integrate.js';
import { MCP_NAME, OrbitError, OrbitInbox, canonicalKey, clearToken, jobsByTicket, removeMcpEntry, sessionEnv, normalizeOrbitUrl, orbitClient, setToken } from '../lib/orbit.js';
import { tokenStore } from '../lib/orbit-token.js';
import { UsageLog, TurnMeter, turnLines, usageDir, groundControlUser, claudeAccountId } from '../lib/usage-log.js';
import { statusTicketKey, slugTicketKey } from '../lib/orbit.js';
import { telemetry as telemetryOf } from '../lib/telemetry.js';
import { ClaudeCodeUsage, CLAUDE_CODE_NOTE, CLAUDE_CODE_WORDS, readSetting as claudeCodeSetting } from '../lib/claude-code-usage.js';
import { EVENT_TYPES, NOTES_MAX, parseCommand } from '../lib/protocol.js';
import { JobLocked, heldElsewhere } from '../lib/lock.js';
import { RESTART_TEXT, RESUME_KIND, replay, withRestartNotes } from './replay.js';
import { removeServiceFile, writeServiceFile } from './service-file.js';
import { createStacks } from './stacks.js';
import { itemSummary, lookAt, noteFeedback, readFeedback } from '../lib/pr-feedback.js';
import { ReviewRefused, createReviewRounds, gitRead } from '../lib/review-round.js';
import { createGhWrite } from '../lib/gh-write.js';

/** The Foreman models the page offers (meta.models); a reply's model must be one of them. */
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'The everyday Foreman: strong and much cheaper than Fable. Asks Fable for a second look where your job options say.' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', note: 'Best judgment, highest cost and quickest to use up your limits. Only if you want it: the Foreman is Opus at every level, and Fable already takes second looks at L3.' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', note: 'Cheapest. For trying the dashboard out, not real jobs.' },
];

/** A reply still going (the driver's states before it ends). */
export const ACTIVE_RUN = new Set(['starting', 'running', 'waiting_permission', 'stopping']);

// The notes a job's notes.md may hold (meta.jobOptions.notesMax; the site refuses more).
export { NOTES_MAX };

const str = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * Builds the machine half. config (dashboard/server.js reads it from the environment):
 *   host, port, token          where the page is served and its write token (for service.json and
 *                              the notifications' links)
 *   dashboardDir               the dashboard folder (the Foreman's hook script, the integration
 *                              board's default repository)
 *   claudeDir, featuresDir, projectsDir, agentsDir, skillsDir, stateDir
 *   demo                       the pretend Foreman (demo/fake-query.js) and fake flow; nothing real runs
 *   claudePath                 the Claude Code executable (null: the SDK's own)
 *   claudeSettingsFile         where the Foreman's Orbit MCP entry is written; legacySettingsFile:
 *                              where it used to be (an entry left there moves on the next token save)
 *   gateParkMs, planUsage, orbitStore, integrateDir, integrateRoot
 *   env                        read at call time (WORKSHOP_EXTRA_REPOS, GROUND_CONTROL_ORBIT_URL)
 *   queryFn                    the SDK's query() (null: the SDK's, or the fake one in demo mode)
 */
export async function createRunner(config) {
  const {
    host: HOST, port: PORT, token: TOKEN = null, dashboardDir: HERE, claudeDir: CLAUDE_DIR,
    featuresDir: FEATURES_DIR, projectsDir: PROJECTS_DIR, agentsDir: AGENTS_DIR, skillsDir: SKILLS_DIR,
    stateDir, demo: DEMO = false, claudePath = null, claudeSettingsFile: CLAUDE_SETTINGS_FILE, legacySettingsFile = null,
    gateParkMs = null, planUsage: planUsageOn = true, orbitStore: orbitStorePrefer = 'auto',
    integrateDir: INTEGRATE_DIR, integrateRoot, env = process.env,
  } = config;
  // Whether the installed /feature skill knows levels (read only; Settings warns when it doesn't).
  const skill = skillChecker(SKILLS_DIR);

  // ---------- What the runner sends up ----------
  // Two page streams take these (dashboard/site/index.js): the new UI's (?v=2, every event below
  // with its job) and the classic page's (/api/events, `broadcast`). Nothing here leaves this
  // computer in local mode, so events reach the page as they are; lib/protocol.js makeEvent is
  // what a v2 runner sends over the network.
  const out = new EventEmitter();
  out.setMaxListeners(0);
  const events = {
    emit(type, job = null, data = {}, opts = {}) {
      if (!EVENT_TYPES.includes(type)) throw new Error(`Not an event the runner sends: ${type}`);
      out.emit('event', type, job ?? null, data ?? {}, opts);
    },
  };
  const broadcast = (event, data) => out.emit('legacy', event, data);

  // ---------- Engine ----------

  const sessionIndex = new SessionIndex(PROJECTS_DIR);
  const state = new State(stateDir);
  // Your "Always allow" rules (rules.json next to the dashboard's other state; see lib/rules.js).
  const rules = new RuleStore(state.dir);
  const HOOK_SCRIPT = path.join(HERE, 'hooks', 'record.mjs');
  const queryFn = config.queryFn ?? (DEMO
    ? (await import('../demo/fake-query.js')).makeFakeQuery({ featuresDir: FEATURES_DIR })
    : (await import('@anthropic-ai/claude-agent-sdk')).query);
  const driver = new Driver({
    queryFn, state, projectsDir: PROJECTS_DIR, cliPath: claudePath,
    policy: policyFor, modeFor: (run) => state.policyFor(run.featureDir), cover: goAheadFor, settingsFor: sessionSettings,
    // The Orbit token as ORBIT_FEEDBACK_TOKEN, so the Foreman's MCP entry has it (never an argument).
    envFor: async () => ({ ...process.env, ...(orbitStoreReady ? await sessionEnv(orbitStoreReady) : {}) }),
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
  const planUsage = new PlanUsage({ enabled: planUsageOn });
  // Trying a job's work on this computer (its own port, dev server, commands, terminal, database).
  const local = new LocalRunner({ state, demo: DEMO });
  // The Orbit token's store, once it is open (below); the driver reads it for each session's env.
  let orbitStoreReady = null;
  // Jobs being marked done right now (sends and automatic carry-ons wait).
  const closing = new Set();
  // Jobs whose reply the last stop cut off (runner/replay.js), by job folder: { how: 'clean' (it
  // carries on by itself) or 'crash' (it waits for Resume), at, runId, sessionId, cwd, model, slug }.
  // Gone once anything is sent to the job, or it is marked done.
  const restartPaused = new Map();
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
    // Where the job's worktree goes, from its repository's profile (lib/repos.js worktreeFor).
    const worktrees = [f?.worktree, f?.statusWorktree, repo && f && local.registry ? await local.registry.worktreeFor(repo, f.slug) : null].filter(Boolean);
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
      const extra = (env.WORKSHOP_EXTRA_REPOS ?? '').split(path.delimiter).filter(Boolean);
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
  const PARK_MS = Number(gateParkMs) > 0 ? Number(gateParkMs) : GATE_PARK_MS;
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

  // decisions.md (lib/decisions.js): the job's decision file, written again from its audit lines
  // after every gate (and when it is read, GET /api/jobs/:slug/decisions.md).
  const writeDecisions = async (f) => writeDecisionsFile(f.dir, { audit: await state.auditFor(f.dir, Infinity), slug: f.slug, title: f.title });
  state.on('audit', (e) => {
    if (!isGateDecision(e) || !e.slug) return;
    featureBySlug(e.slug).then((f) => (f ? writeDecisions(f) : null)).catch((err) => console.warn(`decisions.md for ${e.slug} not written: ${err.message}`));
  });

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

  // The job's lock when another live process holds it: { owner, pid, branch, acquiredAt }, else null.
  function lockView(dir) {
    let lock = null;
    try { lock = heldElsewhere(dir); } catch { lock = null; }
    return lock ? { owner: lock.owner, pid: lock.pid, branch: lock.branch, acquiredAt: lock.acquiredAt } : null;
  }

  // A job's review round state (set once review rounds exist, below): its nudges leave out what the round covers.
  let roundStateOf = () => null;
  function boardCard(f, run) {
    const ids = STAGES.map((s) => s.id).filter((id) => !f.skipped.includes(id));
    const at = ids.indexOf(f.stage);
    const active = run && ACTIVE_RUN.has(run.status) ? run : null;
    const pendingList = driver.pendingPermissions().filter((p) => p.featureDir === f.dir);
    const running = f.activity.filter((a) => stillRunning(f, a, active));
    // The record says "working" but nobody is: say so honestly instead of showing a busy crew.
    const notRunning = !active && !running.length && f.stageState === 'working';
    const limitPaused = !active && limits.pausedJob(f.dir) ? limits.view().resetsAt : null;
    const restart = !active ? restartPaused.get(f.dir) ?? null : null;
    const pausedHere = Boolean(limitPaused) || Boolean(restart) || (notRunning && runEnds[f.dir]?.status === 'stopped');
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
      // Another process working on this job (lib/lock.js heldElsewhere: a terminal, another copy of
      // Ground Control), or null.
      lock: lockView(f.dir),
      // Paused by a restart (runner/replay.js): 'clean' carries on by itself, 'crash' waits for Resume.
      ...(restart ? { restartPaused: { how: restart.how, at: restart.at } } : {}),
      // Levels: chosen (options.json), the Foreman's suggestion (status.json), the rules' (description only here).
      level: f.level, suggestedLevel: f.suggestedLevel, levelReason: f.levelReason, rulesLevel: f.rulesLevel,
      // A stack suggested in the first brief (packet K2): the Job page offers "Run as a stack instead".
      stackSuggested: f.stackSuggested ?? null,
      // A gate left waiting past the parking time: still Needs you, with a "parked" chip.
      parked: gateParked(f, active),
      finish,
      // The PR hand-offs waiting on someone (lib/nudges.js): the Desk's nudge items.
      nudges: nudgesFor({ stage: f.stage, prs: f.prs, closed: off ? f.closed : null, finish }, lane, { dismissed: f.dismissedNudges, sent: f.sentNudges, inRound: roundStateOf(f.slug) !== null }),
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
          level: null, suggestedLevel: null, levelReason: null, rulesLevel: null, parked: false, lock: null,
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
    // Ground Control's own stops and starts name no job folder: read beside the job's lines (lib/thread.js).
    const service = (await state.auditAll()).filter((e) => e.action === 'service-stop' || e.action === 'service-start');
    const page = pageThread(withRestartNotes(buildThread({ briefs, audit, autoResume: limits.autoResume, service, featureDir: f.dir }), audit), { before });
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


  function limitMessage() {
    const v = limits.view();
    const when = v.resetsAt ? new Date(v.resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
    return `Claude’s ${v.label ?? 'usage limit'} is reached${when ? ` (${v.resetKnown ? 'it resets' : 'trying again'} around ${when})` : ''}. Paused jobs carry on by themselves then. If you know it’s lifted (for example you turned on extra usage), use “Carry on now” at the top of the page.`;
  }



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

  async function meta({ token = TOKEN, wireframesOrigin = null } = {}) {
    return {
      token, stages: STAGES, agents: AGENTS, prices: { asOf: PRICES_AS_OF, models: PRICES },
      featuresDir: FEATURES_DIR, crewModels: await crewModels(), demo: DEMO, models: MODELS, readDirs: await readDirs(),
      // How notifications reach macOS here (null: they can't, or the demo, which sends only the test).
      notifyMethod: DEMO ? null : await notifier.method(),
      // Where a job's screens page is served from (its own origin): the Screens tab frames <origin>/job/<slug>/wireframes.
      // null when that server couldn't listen (screensDown): the tab then shows nothing and says so.
      wireframesOrigin,
      settings: await state.getSettings(), liveLink: { enabled: (await readHookSessions(state.dir)).enabled, script: HOOK_SCRIPT, command: nodeCommand(HOOK_SCRIPT) },
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
    // Each card's lane on Jobs and the reason in words (lib/snapshot.js laneFor, packet M).
    const pending = driver.pendingPermissions();
    return cards.map((c) => ({ ...c, ...laneFor(c, { lane: flowLanes.get(c.slug) ?? null, pending: pending.filter((p) => p.slug === c.slug) }) }));
  }


  let changeTimer = null;
  function notifyChange() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { cached = null; broadcast('change', { at: Date.now() }); events.emit('change', null, { at: Date.now() }); flowJobsChanged(); checkWaiting().catch(() => {}); checkLevels(); }, 700);
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
    gather: DEMO ? (await import('../demo/fake-flow.js')).fakeFlow : gatherRepo,
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

  // ---------- PR feedback (lib/pr-feedback.js): failed checks and review comments back to the Foreman ----------
  // After each network refresh of the flow map (no polling of its own), each open job's open PRs are
  // read with the read-only gh helpers (lib/git.js prChecks, prComments, failedLog); each failed
  // check or comment not seen before parks one Needs you card (lib/driver.js parkFeedbackCard), and
  // a card a restart left waiting comes back. The first look at a PR seeds: the comments already on
  // it are marked seen without a card (audit line pr-feedback-seeded, with the count). Your answer
  // goes through the allow and deny commands; the driver resumes the job's session (feedbackSession
  // below) and reports each outcome, which is written here: the audit lines pr-feedback-found, -sent, -left, -queued and -not-sent, and the
  // item's state in the job's pr-feedback.json. Nothing is ever written to GitHub.
  // WORKSHOP_GH names the gh executable (tests use a fake one); the demo reads no GitHub without it.
  const feedbackGh = env.WORKSHOP_GH ? git.ghRunner(env.WORKSHOP_GH) : DEMO ? null : git.ghRunner();
  let feedbackFetchedAt = null;
  let feedbackPass = Promise.resolve();
  let feedbackLogin; // the GitHub login gh is signed in as, asked once
  driver.feedbackSession = async (dir) => {
    const f = (await features()).find((x) => x.dir === dir);
    if (!f) return { refused: 'This job’s folder is gone.' };
    if (f.closed || closing.has(dir)) return { refused: 'This job is marked done.' };
    if (limits.isLimited()) return { refused: limitMessage() };
    const drive = await driveState(f);
    if (drive.mode === 'terminal') return { refused: 'This job’s Foreman was last used in your terminal. Take the job over here first, or pass it on from the terminal.' };
    if (!drive.sessionId || drive.mode === 'none' || drive.mode === 'terminal-open') return { refused: 'This job has no Foreman session here to carry on yet. Send the Foreman a message first.' };
    return { sessionId: drive.sessionId, slug: f.slug, title: f.title, cwd: drive.cwd ?? f.repoPath, model: drive.model ?? OPUS, additionalDirectories: await readDirs() };
  };
  const feedbackQueued = (dir, key) => (driver.feedbackQueue.get(dir) ?? []).some((q) => q.card.item.key === key);
  async function feedbackForPr(f, job, pr, repo, me) {
    const record = await readFeedback(f.dir);
    const where = { featureDir: f.dir, slug: f.slug, title: f.title };
    for (const [key, rec] of Object.entries(record.items)) {
      if (!['waiting', 'queued'].includes(rec?.state) || rec.item?.pr?.number !== pr.number) continue;
      if (!driver.feedbackCardFor(f.dir, key) && !feedbackQueued(f.dir, key)) driver.parkFeedbackCard(where, rec.item);
    }
    let checks = null;
    let comments = null; // null: unread (a first look then waits for one that reads them)
    try { checks = await git.prChecks(repo, pr.number, { gh: feedbackGh }); } catch (err) { console.error(`pr feedback (${f.slug}, checks):`, err.message); }
    try { comments = await git.prComments(repo, pr.number, { gh: feedbackGh }); } catch (err) { console.error(`pr feedback (${f.slug}, comments):`, err.message); }
    // The first look at a PR seeds: the comments already on it get no card (lib/pr-feedback.js lookAt).
    const { items, seeded } = await lookAt({ featureDir: f.dir, job, pr: { ...pr, headSha: checks?.head ?? null }, checks: checks?.checks ?? [], comments, me });
    if (seeded !== null) await state.audit({ action: 'pr-feedback-seeded', featureDir: f.dir, slug: f.slug, pr: pr.number, prLabel: pr.label, count: seeded });
    for (const item of items) {
      if (item.kind === 'check') {
        item.log = null;
        if (item.runId) { try { item.log = await git.failedLog(repo, item.runId, { gh: feedbackGh }); } catch (err) { console.error(`pr feedback (${f.slug}, log):`, err.message); } }
      }
      await noteFeedback(f.dir, item.key, { state: 'waiting', item });
      await state.audit({ action: 'pr-feedback-found', featureDir: f.dir, slug: f.slug, ...itemSummary(item) });
      driver.parkFeedbackCard(where, item);
    }
  }
  async function prFeedbackFor(view) {
    const jobs = await featuresShared();
    // A job marked done takes its cards with it.
    for (const c of [...driver.feedbackCards.values()]) if (jobs.find((j) => j.dir === c.featureDir)?.closed) driver.dropFeedbackCard(c.id, 'closed');
    for (const r of view.repos) {
      const repo = r.org?.slug ?? r.fork?.slug ?? null;
      if (!r.prsKnown || !repo) continue;
      if (feedbackLogin === undefined) feedbackLogin = await git.ghLogin({ gh: feedbackGh });
      const me = [r.fork?.slug?.split('/')[0], feedbackLogin].filter(Boolean);
      const twoStep = Boolean(r.org && r.fork);
      for (const l of r.lanes) {
        const f = jobs.find((j) => j.slug === l.slug);
        if (!f || f.closed) continue;
        const job = { slug: f.slug, branch: l.branch ?? f.branch ?? null, closed: f.closed ?? null };
        for (const [which, p] of [['pr1', l.pr1], ['pr2', l.pr2]]) {
          if (!p || !['open', 'draft'].includes(p.state)) continue;
          const label = twoStep ? (which === 'pr1' ? 'PR #1' : 'PR #2') : `PR #${p.number}`;
          try { await feedbackForPr(f, job, { number: p.number, label, head: p.head, url: p.url ?? null }, repo, me); } catch (err) { console.error(`pr feedback (${f.slug}):`, err.message); }
        }
      }
    }
  }
  flow.on('flow', (view) => {
    if (!feedbackGh || view.refreshing || !view.fetchedAt || view.fetchedAt === feedbackFetchedAt) return;
    feedbackFetchedAt = view.fetchedAt;
    feedbackPass = feedbackPass.then(() => prFeedbackFor(view)).catch((err) => console.error('pr feedback:', err.message));
  });
  driver.on('pr-feedback', (e) => {
    (async () => {
      await noteFeedback(e.featureDir, e.item.key, { state: e.outcome });
      const line = { featureDir: e.featureDir, slug: e.slug, ...itemSummary(e.item) };
      if (e.outcome === 'sent') await state.audit({ action: 'pr-feedback-sent', ...line, runId: e.runId, sessionId: e.sessionId });
      else if (e.outcome === 'left') await state.audit({ action: 'pr-feedback-left', ...line, note: e.note ?? undefined });
      else if (e.outcome === 'queued') await state.audit({ action: 'pr-feedback-queued', ...line });
      else if (e.outcome === 'waiting') await state.audit({ action: 'pr-feedback-not-sent', ...line, reason: e.reason ?? undefined });
      cached = null;
    })().catch((err) => console.error('pr feedback:', err.message));
  });

  // ---------- Review rounds (packet Q, lib/review-round.js; every GitHub write in lib/gh-write.js) ----------
  // One reviewer's "Request changes" (or two comments or more close together) is one round, with
  // the failed checks on the same commit: one card (lib/driver.js parkRoundCard), Fix with the
  // Foreman on one yes (the job's session, kind 'review-round'), Send back on one go, then the PR's
  // own states up to the merge. It reads GitHub after each network refresh of the flow map, before
  // N's look at the same PRs (prependListener), so a round's items are marked in pr-feedback.json
  // before N would card them one by one. The panel's routes: site/routes-review.js.
  // The writer (lib/gh-write.js): the same gh, every call with your yes; the demo and tests push
  // only to local folders, and the demo writes nothing without WORKSHOP_GH's fake.
  const ghWrites = feedbackGh ? createGhWrite({ gh: env.WORKSHOP_GH ? git.ghRunner(env.WORKSHOP_GH, { timeout: 60000 }) : git.ghRunner('gh', { timeout: 60000 }), audit: (line) => state.audit(line), lockFor: (dir) => heldElsewhere(dir), localOnly: DEMO }) : null;
  let roundsFetchedAt = null;
  const reviewRounds = createReviewRounds({
    gh: feedbackGh, driver, write: ghWrites,
    jobs: async () => (await featuresShared()).map((f) => ({ dir: f.dir, slug: f.slug, title: f.title, branch: f.branch ?? null, worktree: f.worktree ?? null, repoPath: f.repoPath ?? null, closed: f.closed ?? null, ticket: slugTicketKey(f.slug) ?? null })),
    profileFor: async (repo) => { const hit = await local.registry?.profileFor(repo).catch(() => null); return hit?.ok ? hit.profile : null; },
    // Settings → Workflow's "Who reviews and merges each pull request": every registered repository's route.
    routes: async () => {
      const out = [];
      for (const r of (await local.registry?.listRepos().catch(() => [])) ?? []) {
        if (!r.ok) continue;
        const hit = await local.registry.profileFor(r.path).catch(() => null);
        if (hit?.ok) out.push({ name: hit.profile.name ?? r.name, prRoute: hit.profile.prRoute ?? null });
      }
      return out;
    },
    audit: (line) => state.audit(line),
    emit: (slug, view) => events.emit('pr', slug, view, { replay: false }),
    changed: () => { cached = null; notifyChange(); },
    lockFor: (dir) => heldElsewhere(dir),
    readStatus: async (dir) => { try { const sj = parseStatusJson(await fsp.readFile(path.join(dir, 'status.json'), 'utf8')); return sj?.ok ? sj : null; } catch { return null; } },
    login: () => git.ghLogin({ gh: feedbackGh }),
    git: gitRead,
    failedLog: (repo, runId) => git.failedLog(repo, runId, { gh: feedbackGh }),
    settings: async () => (await state.getSettings()).review ?? {},
    saveSettings: async (review) => { await state.setSettings({ review }); githubEveryMs = (review.githubEveryMin ?? 1) * 60000; flow.reschedule(); settingsChanged(); },
    refresh: () => flow.refresh({ network: true }),
    problem: (err) => console.error('review rounds:', err.message),
  });
  driver.roundAnswer = (a) => reviewRounds.answerCard(a);
  roundStateOf = (slug) => reviewRounds.stateOf(slug);
  // While a job waits on a reviewer, its checks or the follow-up PR #1, GitHub is read every minute
  // (Settings → Workflow: 1, 5, 10 or 30) instead of every ten (lib/flow.js everyMs).
  let githubEveryMs = 60000;
  state.getSettings().then((s) => { githubEveryMs = (s.review?.githubEveryMin ?? 1) * 60000; }).catch(() => {});
  flow.isWaiting = () => reviewRounds.isWaiting();
  flow.waitingEveryMs = () => githubEveryMs;
  flow.prependListener('flow', (view) => {
    if (!feedbackGh || view.refreshing || !view.fetchedAt || view.fetchedAt === roundsFetchedAt) return;
    roundsFetchedAt = view.fetchedAt;
    feedbackPass = feedbackPass.then(() => reviewRounds.pass(view)).then(() => flow.reschedule()).catch((err) => console.error('review rounds:', err.message));
  });
  // The Foreman's progress (status.json) and its replies starting and ending move the panel.
  driver.on('run', (run) => { if (run.kind === 'review-round' || reviewRounds.facts.has(run.slug)) reviewRounds.refreshJob(run.slug).catch(() => {}); });
  const roundsTimer = setInterval(() => {
    if (!reviewRounds.isFixing()) return;
    for (const slug of reviewRounds.facts.keys()) reviewRounds.refreshJob(slug).catch(() => {});
  }, 5000);
  roundsTimer.unref?.();
  driver.on('review-round-message', (e) => {
    const line = { featureDir: e.featureDir, slug: e.slug, key: e.key ?? undefined };
    if (e.outcome === 'sent') state.audit({ action: 'review-round-message', ...line, outcome: 'sent', runId: e.runId, sessionId: e.sessionId }).catch(() => {});
    else if (e.outcome === 'not-sent') state.audit({ action: 'review-round-message', ...line, outcome: 'not-sent', reason: e.reason ?? undefined }).catch(() => {});
    reviewRounds.refreshJob(e.slug).catch(() => {});
  });

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
  // "Choose the level for me" (Settings → Workflow; lib/auto-level.js). Off: nothing here runs.
  // On, for each open job: with no level yet and the Foreman's first suggestion in, pick the level
  // (or, when the rules say to ask you, say why once in the conversation and leave the level card);
  // with a level, check the branch's real diff after each change and raise the level when a rule or
  // the L0 limits say so. Never lowers a level. Each automatic change is an 'auto-level' audit line
  // (shown in the conversation and the Decisions tab). One pass at a time, like checkWaiting.
  let levelling = null;
  let levelAgain = false;
  const levelDiffSeen = new Map(); // job folder → the worktree, base and head last checked
  function checkLevels() {
    if (levelling) { levelAgain = true; return levelling; }
    levelling = checkLevelsNow().catch(() => {}).finally(() => {
      levelling = null;
      if (levelAgain) { levelAgain = false; checkLevels(); }
    });
    return levelling;
  }
  async function setLevelAutomatically(f, level, record) {
    const options = levelOptions(f.options, level);
    await writeOptions(f.dir, options, { title: f.options?.title, repo: f.options?.repo, kind: f.options?.kind, from_session: f.options?.from_session });
    await state.audit({ action: 'auto-level', featureDir: f.dir, slug: f.slug, level, was: f.level ?? null, ...record });
    cached = null;
  }
  async function checkLevelsNow() {
    if (!(await state.getSettings()).workflow.autoLevel) return;
    for (const f of await featuresShared()) {
      if (closedOff(f)) continue;
      if (f.level === null || f.level === undefined) {
        if (f.suggestedLevel === null || f.suggestedLevel === undefined) continue;
        const c = chooseLevel({ description: f.description, predictedPaths: f.predictedPaths, foreman: f.suggestedLevel });
        if (!c.ask) { await setLevelAutomatically(f, c.level, { how: 'chose', note: c.note, rules: c.rules, foreman: c.foreman }); continue; }
        // Asks you: said once per suggestion, then the level card waits for you.
        const said = (await state.auditFor(f.dir, 400)).some((e) => e.action === 'auto-level-ask' && e.foreman === f.suggestedLevel);
        if (!said) await state.audit({ action: 'auto-level-ask', featureDir: f.dir, slug: f.slug, foreman: f.suggestedLevel, rules: c.rules, reason: c.ask });
        continue;
      }
      const base = f.baseSha ?? f.baseBranch;
      if (!f.worktree || !base) continue;
      const head = await git.headOf(f.worktree, 'HEAD');
      const key = `${f.worktree}\n${base}\n${head}`;
      if (!head || levelDiffSeen.get(f.dir) === key) continue;
      levelDiffSeen.set(f.dir, key);
      // You changed an automatic level yourself: your choice stands; no more automatic raises here.
      if ((await state.auditFor(f.dir, 400)).some((e) => e.action === 'options' && e.overrode === 'auto')) continue;
      const diff = await diffSummary(f.worktree, base);
      // The files only: the description was weighed when the level was chosen.
      const r = checkDiff({ level: f.level, diff });
      if (r.raiseTo !== null) await setLevelAutomatically(f, r.raiseTo, { how: 'diff', reasons: r.reasons, head });
    }
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
    checkLevels();
  });
  planUsage.on('change', (view) => { events.emit('plan-usage', null, view); });
  limits.on('change', () => { cached = null; broadcast('change', { at: Date.now() }); events.emit('usage', null, limits.view()); });
  local.on('output', (e) => { broadcast('local', e); events.emit('local', e.slug ?? null, e, { replay: false }); }); // live only: see EventLog.emit
  local.on('changed', (e) => { broadcast('local-state', e); events.emit('local-state', e.slug ?? null, e); });


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


  // ---------- The integration board (packet Z): /api/integrate/* (lib/integrate.js) ----------
  // The packet worktrees of the repository this dashboard runs from, and "Merge next" into its main
  // checkout (INTEGRATE_ROOT overrides which repository). Its settings live in
  // ~/.ground-control/integrate.json (GROUND_CONTROL_DIR overrides the folder). Never pushes.
  //   GET  /api/integrate              the packets, the order, packets at once, the last result
  //   GET  /api/integrate/stream       the running step's output, live (server-sent events)
  //   POST /api/integrate/order        { order: ['Z', 'C', …] }  save the order
  //   POST /api/integrate/slots        { slots: 3 }              save "packets at once"
  //   POST /api/integrate/merge-next   start Merge next (202; the result comes on the stream)
  //   POST /api/integrate/run-tests    { id }  run both test suites in that packet's worktree (202)
  const integrator = new Integrator({
    root: integrateRoot,
    configDir: INTEGRATE_DIR,
    stateDirs: [...new Set([INTEGRATE_DIR, path.join(os.homedir(), '.feature-workshop'), state.dir])],
    // This dashboard's own runs count too: a job it is driving on that checkout.
    extraRunning: async (root) => {
      const r = driver.list().find((x) => ACTIVE_RUN.has(x.status) && x.cwd && !path.relative(root, x.cwd).startsWith('..') && !path.isAbsolute(path.relative(root, x.cwd)));
      return r ? { slug: r.slug ?? r.title ?? 'a job', dir: r.featureDir ?? null } : null;
    },
  });


  // ---------- Orbit: the Inbox (lib/orbit.js, lib/orbit-token.js) ----------
  // Portal Feedback tickets read with your own read-only token (ORBIT-479): every call to Orbit is a
  // GET. The token lives in the OS credential store (in demo mode, or with WORKSHOP_ORBIT_STORE=file,
  // in a 600 file in the state folder) and never in an answer, a record or the audit. The routes are
  // the site's (site/routes-orbit.js).
  const orbitStore = await tokenStore({ stateDir: state.dir, prefer: orbitStorePrefer });
  orbitStoreReady = orbitStore;
  let orbitUrl = null;
  const orbit = orbitClient({ baseUrl: () => orbitUrl, getToken: () => orbitStore.get() });
  const orbitInbox = new OrbitInbox({ client: orbit, orbitUrl: () => orbitUrl });

  // An Orbit refusal (lib/orbit.js OrbitError) as the answer the page has always had.
  const ORBIT_STATUS = { token: 400, settings: 400, 'not-found': 404, auth: 401, scope: 403, rate: 429 };
  const orbitHttpError = (err) => (err instanceof OrbitError ? new HttpError(ORBIT_STATUS[err.kind] ?? 502, err.message, { kind: err.kind, retryAfterMs: err.retryAfterMs ?? undefined }) : err);

  async function orbitSettings() {
    const o = (await state.getSettings()).orbit;
    return o && typeof o === 'object' ? o : {};
  }

  async function orbitStatus() {
    const o = await orbitSettings();
    const token = Boolean(await orbitStore.get().catch(() => null));
    const v = orbitInbox.view();
    const expired = Boolean(o.expiresAt && Date.parse(o.expiresAt) <= Date.now());
    return {
      tokenPresent: token, store: token ? orbitStore.kind : null, url: orbitUrl, savedAt: o.savedAt ?? null, expiresAt: o.expiresAt ?? null, expired,
      lastPoll: v.checkedAt, lastTryAt: v.lastTryAt, lastError: v.error, errorKind: v.errorKind, everyMs: v.everyMs, watchers: v.watchers, waitingMs: v.waitingMs,
      mcp: { name: MCP_NAME, file: CLAUDE_SETTINGS_FILE },
    };
  }

  /** Inbox rows with "you are already on this": the open job on the same ticket, if any. */
  async function withJobs(items) {
    const onTicket = await jobsByTicket(await features());
    return items.map((i) => ({ ...i, job: onTicket.get(i.key) ?? null }));
  }


  /** Reads the saved address and starts the poller when there is a token. At start and after a save. */
  async function startOrbit() {
    const o = await orbitSettings();
    orbitUrl = o.url ? (() => { try { return normalizeOrbitUrl(o.url); } catch { return null; } })() : null;
    if (!orbitUrl && env.GROUND_CONTROL_ORBIT_URL) { try { orbitUrl = normalizeOrbitUrl(env.GROUND_CONTROL_ORBIT_URL); } catch { /* ignored: Settings says what is missing */ } }
    if (orbitUrl && await orbitStore.get().catch(() => null)) orbitInbox.start(); else orbitInbox.stop();
  }


  // ---------- Telemetry (packet T): usage.jsonl and /api/telemetry (lib/usage-log.js, lib/telemetry.js) ----------
  // One line per Foreman turn in usage.jsonl: who (the Ground Control user), the Claude account, job,
  // ticket, stage, section, worker, model, tokens, cost and both plan meters. It lives in
  // ~/.ground-control, or in the state folder when one is set (WORKSHOP_STATE_DIR, demo mode);
  // GROUND_CONTROL_DIR overrides both. Nothing is sent anywhere.
  const usageLog = new UsageLog({ dir: usageDir({ stateDir: env.WORKSHOP_STATE_DIR || DEMO ? state.dir : null }) });
  const turnMeter = new TurnMeter();
  const usageUser = groundControlUser();
  const usageAccount = DEMO ? Promise.resolve(null) : claudeAccountId();
  const RUN_ENDED = new Set(['done', 'stopped', 'error', 'limited']);
  // One turn at a time, in order, so each one's cost is worked out after the one before is written.
  let usageChain = Promise.resolve();
  function logTurn(turn) {
    if (!turn) return;
    usageChain = usageChain.then(async () => {
      const f = turn.slug ? await featureBySlug(turn.slug).catch(() => null) : null;
      const dir = f?.dir ?? turn.featureDir ?? null;
      const status = dir ? await fsp.readFile(path.join(dir, 'status.json'), 'utf8').then(JSON.parse).catch(() => null) : null;
      const lines = turnLines(turn, {
        at: new Date().toISOString(), user: usageUser, account: await usageAccount,
        ticket: (dir ? await statusTicketKey(dir) : null) ?? slugTicketKey(turn.slug),
        stage: f?.stage ?? status?.stage ?? stageOfSlug(turn.slug),
        section: typeof status?.section === 'string' ? status.section : null,
        meters: planUsage.view(),
        sessionPrev: turn.runPrev === null ? await usageLog.sessionTotal(turn.sessionId) : null,
      });
      await usageLog.append(lines);
    }).catch((err) => console.error('usage log:', err.message));
  }
  driver.on('usage', (e) => logTurn(turnMeter.onMessage(e)));
  // Your Claude Code use outside this app (packet U, lib/claude-code-usage.js): this computer's
  // Claude Code logs, read for usage numbers only, in the background, cached in the state folder.
  // Never in the demo. The first read starts a little after the dashboard does (when the setting
  // is on), so Telemetry rarely has to say it is still reading.
  const claudeCodeUsage = DEMO ? null : new ClaudeCodeUsage({ projectsDir: PROJECTS_DIR, stateDir: state.dir, user: usageUser });
  if (claudeCodeUsage) setTimeout(() => { claudeCodeSetting(state.dir).then((s) => { if (s.count) claudeCodeUsage.poke(); }, () => {}); }, 20_000).unref();
  // A reply stopped before its result: what it used so far is a turn too (an estimate).
  driver.on('run', (run) => { if (RUN_ENDED.has(run.status)) logTurn(turnMeter.forget(run.id, run)); });


  // ---------- Commands (lib/protocol.js): every change the site asks for ----------
  // Each handler is the code its route ran before the split, with the command in place of the
  // request body. The site has already checked the request's shape (and, for the gate card, read
  // it with readGateBody), so a refusal here is about the job: the same status and words as before.

  const jobOf = async (slug) => {
    const f = await featureBySlug(slug);
    if (!f) throw new HttpError(404, 'No job by that name.');
    return f;
  };

  /** The gate card's decision (approve, send-back, stop, or its own message): POST /api/job/:slug/gate. */
  async function gateDecision(kind, body) {
    // A decision from the gate card: answers, verdicts, next-step chips and a note, composed into
    // the reply here (composeReply, as the page previews it; or the text you edited, for "Edit, then
    // approve"). Chips that change an option patch
    // options.json first. With a reply in progress nothing is sent: the text comes back for the
    // composer to hold. With the usage limit reached, startAfterReset holds it until the reset.
    const f = await jobOf(body.slug);
    const g = { kind, briefNumber: body.briefNumber ?? null, note: body.note ?? '', answers: body.answers ?? {}, verdicts: body.verdicts ?? {}, chips: body.chips ?? [], edited: body.text ?? null, startAfterReset: body.startAfterReset === true };
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
      return { ...reply, sent: false, queued: false, message: `The Foreman is still working on a reply, so nothing was sent${options ? '. The option changes are saved and apply from its next stage' : ''}. Send this text once the reply is done.` };
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
      return { ...reply, sent: false, held: true, resetsAt: held.resetsAt, message: held.autoResume ? `Held: it goes to the Foreman when Claude’s usage limit resets (around ${when}).` : `Held: it goes to the Foreman when you press “Carry on now” after Claude’s usage limit resets (around ${when}).` };
    }
    const run = await startSend(f, out, { kind: g.kind, gateBrief: g.briefNumber });
    return { ...reply, sent: true, run };
  }

  const HANDLERS = {
    // POST /api/jobs: a new job.
    async start(body) {
      const description = str(body.description, 600).replace(/\s+/g, ' ').trim();
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
      // Started from an Orbit ticket (the Inbox's Start, or a key typed in New job): the job, its folder
      // (orbit-<n>-<short-title>) and its branch share the ticket's key (lib/options.js, plan D1).
      let ticket = null;
      try { ticket = normalizeTicket(body.ticket); } catch (err) { throw new HttpError(400, err.message); }
      // Starting from a past conversation: a fresh Foreman reads an extract of it (history.md), or
      // a copy of the conversation itself becomes the Foreman (the original is never changed).
      let from = null;
      let sessionId = null;
      let cwd = repo.path;
      if (body.fromSession) {
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
      // The repository's profile names a ticket's folder and branch (lib/profile.js); none: the general case.
      const hit = ticket ? await local.registry.profileFor(repo.path).catch(() => null) : null;
      const profile = hit?.ok ? hit.profile : null;
      const slug = await uniqueSlug(ticket ? ticketSlug(ticket, profile) : slugify(description));
      const featureDir = path.join(FEATURES_DIR, slug);
      // The job's options go in its private folder (read before every stage) and in the first message.
      const { detail: fromDetail, ...fromRecord } = from ?? {};
      const optionsOut = from ? { ...options, from_session: fromRecord } : options;
      await writeOptions(featureDir, options, { title: description, repo: repo.path, kind, from_session: from ? fromRecord : undefined, ticket: ticket ?? undefined, branch: ticket ? ticketBranch(kind, slug, { profile, ticket }) : undefined });
      // A ticket's job starts with a status.json of schema version 2 holding the ticket block.
      const fromTicket = ticket ? await startFromTicket(featureDir, { ticket, slug, title: description, kind, level: options.level, repo: repo.path, profile }) : null;
      if (fromDetail) await fsp.writeFile(path.join(featureDir, 'history.md'), historyMarkdown(fromDetail), { mode: 0o600 });
      // The /feature command must come first in the message, or it doesn't run.
      const tail = from?.mode === 'continue'
        ? '\n\nThis conversation is now a Feature Workshop job: carry it on through the feature workflow from here. Everything said earlier in it is background, not approval.'
        : '';
      const text = `/feature ${description}${kind === 'bug' ? ' (This is a bug fix.)' : ''} Private folder: ${featureDir}\n\nJob options (also in options.json in that folder; read it before every stage):\n${describeOptions(optionsOut).map((l) => `- ${l}`).join('\n')}${fromTicket ? `\n\n${fromTicket.brief}` : ''}${tail}`;
      const run = await driver.start({ featureDir, slug, title: description, cwd, sessionId, model, text, kind, newJob: true, additionalDirectories: await readDirs() });
      await state.audit({ action: 'new-job', featureDir, slug, repo: repo.path, model, description, options, fromSession: from ? { id: from.id, mode: from.mode, forkedTo: from.forkedTo } : undefined, ticket: ticket?.key });
      cached = null;
      return { run, slug };
    },

    // POST /api/job/:slug/send (via 'box'), or the gate card's own message (via 'card').
    async reply(body) {
      if (body.via === 'card') return gateDecision('message', body);
      const f = await jobOf(body.slug);
      const text = body.text ?? '';
      if (!text) throw new HttpError(400, 'The message is empty.');
      // gateBrief: a gate reply composed while a reply was in progress (…/gate gave the text back) and
      // sent now; it still answers that brief, so it must still be the current one (as …/gate checks).
      const gateBrief = body.gateBrief ?? null;
      const kind = body.kind || 'message';
      if (gateBrief && kind !== 'stop') staleBriefCheck(f, gateBrief);
      const drive = await driveState(f);
      const out = sendPlan(f, drive, body, text);
      const run = await startSend(f, out, { kind, gateBrief });
      return { run };
    },
    approve: (body) => gateDecision('approve', body),
    'send-back': (body) => gateDecision('changes', body),
    stop: (body) => gateDecision('stop', body),

    // POST /api/permissions/:id
    async allow(body) {
      const decision = body.scope === 'run' ? 'allow-run' : 'allow';
      if (!(await driver.decide(body.requestId, { decision, note: body.note ?? '', answers: body.answers ?? null }))) throw new HttpError(404, 'That request was already answered or has expired.');
      return { ok: true };
    },
    async deny(body) {
      if (!(await driver.decide(body.requestId, { decision: 'deny', note: body.note ?? '', answers: body.answers ?? null }))) throw new HttpError(404, 'That request was already answered or has expired.');
      return { ok: true };
    },

    // POST /api/runs/:id/stop
    async pause(body) {
      if (!(await driver.stop(body.runId))) throw new HttpError(404, 'That reply already finished.');
      return { ok: true };
    },

    // POST /api/job/:slug/takeover
    async 'take-over'(body) {
      const f = await jobOf(body.slug);
      const drive = await driveState(f);
      if (!drive.sessionId) throw new HttpError(400, 'There’s no Foreman session to take over yet.');
      await state.setSession(f.dir, { sessionId: drive.sessionId, cwd: drive.cwd, model: drive.model, takenOverAt: new Date().toISOString() });
      await state.audit({ action: 'takeover', featureDir: f.dir, slug: f.slug, sessionId: drive.sessionId });
      return { ok: true };
    },

    // GET /api/job/:slug/commit/:sha: one commit's diff, for the live view. Answered to the asker only.
    async 'fetch-diff'(body) {
      const f = await jobOf(body.slug);
      const codeDir = f.worktree && fs.existsSync(f.worktree) ? f.worktree : f.repoPath;
      if (!codeDir) throw new HttpError(404, 'No repository for this job.');
      return { dir: codeDir, ...(await git.show(codeDir, body.commit)) };
    },

    // POST /api/runs/:id/steer: add a message to a reply in progress (see lib/driver.js). Its states arrive as 'steer' events.
    async steer(body) {
      const steer = await driver.steer(body.runId, body.text);
      if (!steer) throw new HttpError(404, 'That reply already finished. Send your message as a new one.', { code: 'finished' });
      return { steer };
    },

    // POST /api/job/:slug/close
    async close(body) {
      const f = await jobOf(body.slug);
      if (driver.activeRunFor({ featureDir: f.dir })) throw new HttpError(409, 'The Foreman is working on a reply. Pause it first, then mark the job.');
      if (closing.has(f.dir)) throw new HttpError(409, 'This job is already being marked. Wait a moment.');
      const as = body.as === 'dropped' ? 'dropped' : 'done';
      const note = body.note || null;
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
          const check = await checkWorktree(f.worktree, f.repoPath, { jobDir: f.dir });
          if (!check.ok) throw new HttpError(409, `Not marked yet: the worktree can’t be removed safely. ${check.reason}`);
          await local.stopServerAndWait(f.slug); // its app, if started from the job page
          worktree = await removeWorktree(f.worktree, f.repoPath, { fetch: false, jobDir: f.dir });
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
      return { ok: true, closed };
    },
    // POST /api/job/:slug/reopen
    async reopen(body) {
      const f = await jobOf(body.slug);
      await state.setSession(f.dir, { closed: null });
      await state.audit({ action: 'reopen', featureDir: f.dir, slug: f.slug, how: 'button' });
      cached = null;
      return { ok: true };
    },

    // POST /api/job/:slug/options
    async options(body) {
      const f = await jobOf(body.slug);
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
      // overrode: 'auto' when the level you set replaces one chosen automatically (lib/auto-level.js),
      // the record of overrides; the automatic raises stop for this job.
      const lastLevel = (await state.auditFor(f.dir, 400)).filter((e) => e.action === 'auto-level' || (e.action === 'options' && Number.isInteger(e.options?.level))).at(-1);
      const overrode = lastLevel?.action === 'auto-level' && options.level !== lastLevel.level ? 'auto' : undefined;
      await state.audit({ action: 'options', featureDir: f.dir, slug: f.slug, options, was: f.options?.level ?? null, overrode });
      cached = null;
      return { ok: true, options, summary: describeOptions(options), updated_at: updatedAt };
    },

    // POST /api/job/:slug/policy: one job's own permission setting; null clears it (the job follows your global setting again).
    async policy(body) {
      const f = await jobOf(body.slug);
      if (body.policy !== null && !POLICIES.includes(body.policy)) throw new HttpError(400, 'Unknown setting.');
      await state.setJobPolicy(f.dir, body.policy);
      await state.audit({ action: 'job-policy', featureDir: f.dir, slug: f.slug, policy: body.policy });
      await driver.applyModes();
      settingsChanged();
      const s = await state.getSettings();
      return { policy: s.jobPolicy?.[f.dir] || s.policy, policyOverride: s.jobPolicy?.[f.dir] ?? null, globalPolicy: s.policy, autoMode: s.autoMode };
    },

    // PUT /api/job/:slug/notes: the job's notes (notes.md), saved whole from the job drawer. Audited by size only.
    async notes(body) {
      const f = await jobOf(body.slug);
      await writeNotes(f, body.text);
      await state.audit({ action: 'notes', featureDir: f.dir, slug: f.slug, size: body.text.length });
      return { ok: true, ...(await readNotes(f)) };
    },

    // POST /api/job/:slug/local: "Try it on your computer".
    async 'try-it'(body) {
      const f = await jobOf(body.slug);
      const action = body.action;
      const audit = (extra = {}) => state.audit({ action: 'local', featureDir: f.dir, slug: f.slug, what: action, ...extra });
      try {
        if (action === 'env') { const r = await local.setupEnv(f); await audit({ changed: r.changed }); return r; }
        if (action === 'start') { const r = await local.startServer(f); await audit({ port: r.port }); return r; }
        if (action === 'stop') return { ok: local.stopServer(f.slug) };
        if (action === 'run') {
          const preset = body.preset || null;
          const command = body.command ?? '';
          const where = body.where === 'root' ? 'root' : 'app';
          const prepared = await local.prepareCommand(f, { command, preset, where });
          await audit({ command: preset ? undefined : command, preset: preset ?? undefined, where });
          local.startPrepared(f.slug, prepared); // output streams to the page
          return { ok: true };
        }
        if (action === 'stop-cmd') return { ok: local.stopCommand(f.slug) };
        if (action === 'open') {
          const what = ['terminal', 'finder', 'vscode'].includes(body.what) ? body.what : 'terminal';
          const terminalApp = (await state.getSettings()).local?.terminalApp ?? terminalApps()[0];
          return await local.open(f, what, terminalApp);
        }
        if (action === 'follow') {
          // The Stage's "Open in terminal" (lib/stage-view.js): 'foreman' continues the job's own
          // Claude Code conversation in its folder; a crew member's ref follows its log, read-only. On
          // macOS a small script is opened in the chosen terminal app; in the demo nothing is opened.
          const sv = await import('../lib/stage-view.js');
          const ref = typeof body.what === 'string' ? body.what : '';
          const plan = sv.followPlan({ ref, activity: f.activity, drive: await driveState(f), lock: lockView(f.dir), platform: DEMO ? 'darwin' : process.platform });
          if (plan.why) throw new HttpError(400, plan.why);
          const file = plan.kind === 'watch' && !DEMO ? await sv.findCrewLog({ projectsDir: PROJECTS_DIR, entry: plan.entry }) : null;
          if (plan.kind === 'watch' && !DEMO && !file) throw new HttpError(400, `I couldn’t find the ${plan.role}’s log on this computer.`);
          await audit({ follow: plan.kind, ref });
          if (DEMO) return { ok: true, demo: true, kind: plan.kind };
          const chosen = (await state.getSettings()).local?.terminalApp;
          const app = terminalApps().includes(chosen) ? chosen : terminalApps()[0];
          const dir = path.join(os.tmpdir(), 'ground-control-terminal');
          await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
          // Scripts from earlier days are of no more use.
          for (const name of await fsp.readdir(dir).catch(() => [])) {
            const old = path.join(dir, name);
            const st = await fsp.stat(old).catch(() => null);
            if (st && Date.now() - st.mtimeMs > 86_400_000) await fsp.rm(old, { force: true }).catch(() => {});
          }
          const script = path.join(dir, `${f.slug}-${ref.replace(/\W/g, '-')}-${Date.now()}.command`);
          await fsp.writeFile(script, plan.kind === 'continue'
            ? sv.continueScript({ claude: claudePath ?? 'claude', cwd: plan.cwd, sessionId: plan.sessionId })
            : sv.followScript({ file, role: plan.role }), { mode: 0o700 });
          const { openIn } = await import('../lib/platform.js');
          const r = await openIn('terminal', script, { terminalApp: app });
          if (!r.ok) throw new HttpError(400, `Couldn’t open ${app}: ${r.message}`);
          return { ok: true, kind: plan.kind, terminalApp: app };
        }
        if (action === 'terminal-app') {
          const name = terminalApps().includes(body.name) ? body.name : null;
          if (!name) throw new HttpError(400, 'Choose iTerm or Terminal.');
          await local.setTerminalApp(name);
          return { ok: true };
        }
        if (action === 'db') {
          const what = body.db ?? '';
          await audit({ db: what });
          await local.database(f, what);
          return { ok: true };
        }
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(400, err.message);
      }
      throw new HttpError(400, 'Unknown action.');
    },

    // POST /api/settings (and POST /api/usage/auto, autoResume).
    async settings(body) {
      if (body.autoResume !== undefined) {
        await limits.setAutoResume(body.autoResume === true);
        await state.audit({ action: 'settings', autoResume: body.autoResume === true });
        return limits.view();
      }
      // notify: notifications outside the browser (lib/notify.js validateNotifyPatch).
      if (body.notify !== undefined) {
        let next;
        try { next = validateNotifyPatch(body.notify, (await state.getSettings()).notify); } catch (err) { throw new HttpError(400, err.message); }
        await state.setSettings({ notify: next });
        settingsChanged();
        return state.getSettings();
      }
      // workflow: the finish line (lib/finish.js): what counts as done, everywhere; and the screens
      // (wireframes) and clarify defaults a new job's options.json starts with (lib/state.js).
      if (body.workflow !== undefined) {
        const w = body.workflow;
        if (!w || typeof w !== 'object' || Array.isArray(w)) throw new HttpError(400, 'The workflow settings must be an object.');
        const keys = Object.keys(w);
        for (const k of keys) if (!['finishLine', 'wireframes', 'clarify', 'autoLevel'].includes(k)) throw new HttpError(400, `Unknown workflow setting: ${String(k).slice(0, 40)}.`);
        if (!keys.length) throw new HttpError(400, 'Send a workflow setting to change: finishLine, wireframes, clarify or autoLevel.');
        if (w.autoLevel !== undefined && typeof w.autoLevel !== 'boolean') throw new HttpError(400, 'Choose the level for me: on or off.');
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
        if (next.autoLevel && !was.autoLevel) checkLevels();
        return state.getSettings();
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
        if (body.policy === undefined && body.recheckAuto !== true) return state.getSettings();
      }
      // recheckAuto: forget that auto mode wasn't available, so the next reply that asks for it tries again.
      if (body.recheckAuto === true) {
        await state.setSettings({ autoMode: { available: null, reason: null, checkedAt: null } });
        settingsChanged();
        if (body.policy === undefined) return state.getSettings();
      }
      const policy = POLICIES.includes(body.policy) ? body.policy : null;
      if (!policy) throw new HttpError(400, 'Unknown setting.');
      await state.setSettings({ policy });
      await state.audit({ action: 'settings', policy });
      await driver.applyModes(); // replies in progress switch now
      settingsChanged();
      return state.getSettings();
    },

    // POST /api/rules (add) and DELETE /api/rules/:id (remove).
    async rules(body) {
      if (body.action === 'remove') {
        const rule = await rules.remove(body.id);
        if (!rule) throw new HttpError(404, 'That rule was already removed.');
        await state.audit({ action: 'rule-removed', rule: rule.id, tool: rule.tool, kind: rule.kind, value: rule.value, label: rule.label });
        return { ok: true, rule };
      }
      // "Always allow…": save a rule you confirmed, and (with permissionId) allow the request it was
      // drafted from. The rule must cover that request; nothing broader than its kind is accepted.
      let v;
      try { v = validateRule(body.rule); } catch (err) { if (err instanceof RuleError) throw new HttpError(400, err.message); throw err; }
      const permissionId = body.permissionId || null;
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
      return { rule, added, allowed, alsoAllowed, active };
    },

    // POST /api/job/:slug/nudge/:id/(dismiss|yes)
    async nudge(body) {
      // A hand-off nudge on the Desk (lib/nudges.js). dismiss: remembered for this job, so it isn't
      // shown again. yes: the nudge's one sentence goes to the job's Foreman exactly as a message from
      // the box does (sendPlan, startSend), audited as a 'send' of kind 'nudge' plus a 'nudge' line.
      // The id is remembered as sent (sentNudges, in the same record) once the message has started:
      // the nudge's source is the PR state, which changes only once the Foreman has done the work, so
      // without that it would come straight back and a second yes would send the sentence again. Not
      // before: a start that fails (Busy: a reply began in between; a spawn failure) would otherwise
      // leave the nudge marked sent, with nothing sent and no audit. A reply that ends in error never
      // delivered it either, so the id is dropped again then (nudgeRuns, below the 'run' listener).
      const f = await jobOf(body.slug);
      const id = body.nudge;
      if (!NUDGE_IDS.includes(id)) throw new HttpError(404, 'No nudge by that name.');
      const saved = await state.sessionFor(f.dir);
      const listOf = (key) => (Array.isArray(saved?.[key]) ? saved[key] : []);
      if (body.answer === 'dismiss') {
        const dismissed = [...new Set([...listOf('dismissedNudges'), id])];
        await state.setSession(f.dir, { dismissedNudges: dismissed });
        await state.audit({ action: 'nudge-dismissed', featureDir: f.dir, slug: f.slug, nudge: id });
        cached = null;
        return { ok: true, dismissed };
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
      return { ok: true, sent: true, text: nudge.action.send, run };
    },

    // POST /api/job/:slug/repo
    async repo(body) {
      const f = await jobOf(body.slug);
      const repo = await checkRepo(body.repoPath ?? '');
      if (!repo.ok) throw new HttpError(400, repo.reason);
      const branch = body.branch || null;
      if (branch && !/^(?!-)[\w./-]{1,200}$/.test(branch)) throw new HttpError(400, 'That doesn’t look like a branch name.');
      await state.setSession(f.dir, { repoPath: repo.path, branch });
      await state.audit({ action: 'repo-set', featureDir: f.dir, slug: f.slug, repo: repo.path, branch });
      cached = null;
      return { ok: true, repoPath: repo.path };
    },

    // POST /api/job/:slug/resume, and `ground-control resume <job>` (via 'cli'): carry on a reply a
    // restart paused (a crash's waits for this), or one you paused with Stop. The same session,
    // audited as a 'send' of kind 'resume-after-restart' plus a 'resumed' line saying who asked.
    async resume(body) {
      const f = await jobOf(body.slug);
      const p = restartPaused.get(f.dir) ?? null;
      const drive = await driveState(f);
      if (drive.mode === 'running') throw new HttpError(409, 'The Foreman is already working on this job.');
      const stoppedHere = drive.mode === 'workshop' && runEnds[f.dir]?.status === 'stopped';
      if (!p && !stoppedHere) throw new HttpError(409, 'This job isn’t paused, so there is nothing to resume. Send the Foreman a message instead.', { code: 'not-paused' });
      const out = sendPlan(f, drive, { model: p?.model ?? null }, RESTART_TEXT);
      if (p?.sessionId) Object.assign(out, { sessionId: p.sessionId, text: RESTART_TEXT, cwd: p.cwd ?? out.cwd });
      if (!out.sessionId) throw new HttpError(409, 'This job has no Foreman session to carry on. Send the Foreman a message instead.', { code: 'no-session' });
      if (!p) out.text = 'Carry on from where you were.';
      const run = await startSend(f, out, { kind: RESUME_KIND });
      restartPaused.delete(f.dir);
      await state.audit({ action: 'resumed', featureDir: f.dir, slug: f.slug, runId: run.id, sessionId: out.sessionId, via: body.via ?? 'page' });
      return { ok: true, run };
    },

    // POST /api/usage/resume: "Carry on now".
    async 'usage-resume'() {
      if (!limits.isLimited()) throw new HttpError(409, 'Nothing is paused for the usage limit.');
      return limits.resume('you');
    },
  };

  /**
   * Run one command. from: 'local' for this computer's own page (both lists), 'site' for anything
   * that may have come over the network (lib/protocol.js REMOTE_COMMANDS only). A command that
   * doesn't pass parseCommand is a 400 and nothing runs.
   */
  async function handle(raw, { from = 'site' } = {}) {
    const parsed = parseCommand(raw, { from });
    if (!parsed.ok) throw new HttpError(400, parsed.error, { code: 'bad-command' });
    try {
      return await HANDLERS[parsed.command.type](parsed.command);
    } catch (err) {
      // The driver's "already working on a reply" (lib/driver.js Busy): a 409, as before.
      if (err instanceof Busy) throw new HttpError(409, err.message);
      throw err;
    }
  }

  // ---------- Reads: what the site shows ----------

  const read = {
    meta,
    /** Everything the new UI needs to draw itself (GET /api/snapshot), apart from the event log's seq and epoch. */
    async snapshot(pageMeta) {
      const list = await features();
      const jobs = groupCards(await boardCards(list));
      return {
        meta: await meta(pageMeta), jobs,
        needsYou: jobs.filter((j) => j.group === 'needs-you').length,
        permissions: driver.pendingPermissions(), usage: limits.view(), planUsage: planUsage.view(), runTypical, generatedAt: new Date().toISOString(),
      };
    },
    // Notifications outside the browser: how they reach macOS here, and the last 50.
    notifications: async () => ({ method: await notifier.method(), blocked: notifier.blocked, history: await notifier.list() }),
    // The flow map (Home): each repo's jobs on their way to staging and main (lib/flow.js).
    flow: async () => flow.view(),
    async features() {
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
    runs: async () => ({ runs: driver.list(), permissions: driver.pendingPermissions() }),
    // The play ledger (lib/play.js ledgerView): crew met, quests done, achievements, secrets found.
    // Play mode Off: only that, nothing read or built.
    play: async () => (playOn() ? ledgerView(await playbook.current(), playNow) : { mode: 'off' }),
    playOn: () => playOn(),
    // Your "Always allow" rules. active: false while your (global) setting is "ask about everything"
    // (then they wait). It describes your setting only: jobOverrides counts the jobs whose own
    // setting makes the rules apply differently there (on for them, or off for them).
    async rules() {
      const s = await state.getSettings();
      const active = s.policy !== 'ask-all';
      const jobOverrides = Object.values(s.jobPolicy ?? {}).filter((p) => (p !== 'ask-all') !== active).length;
      return { rules: await rules.list(), active, jobOverrides, unreadable: rules.broken ? rules.file : null };
    },
    repos: async () => ({ repos: await recentRepos(sessionIndex, [...(env.WORKSHOP_EXTRA_REPOS ?? '').split(path.delimiter).filter(Boolean), ...(await features()).map((f) => f.repoPath)]) }),
    async costs() {
      const list = await features();
      return {
        jobs: list.map((f) => ({ slug: f.slug, title: f.title, project: f.project, stage: f.stage, stageState: f.stageState, cost: f.cost, whatIf: whatIfConductor(f.cost.agents) })),
        pricesAsOf: PRICES_AS_OF,
      };
    },
    costsCsv: async () => costCsv(await features()),
    costsMarkdown: async () => costMarkdown(await features()),
    /** Past Claude Code conversations (GET /api/history). p: the query's q, repo, linked, dashboard and test. */
    async history(p) {
      // Filtered here, before the list is cut, so searching reaches every conversation.
      const { rows, missing } = await history.list(await historyContext());
      const q = (p.q ?? '').trim().toLowerCase().slice(0, 200);
      const repo = p.repo ?? '';
      const show = { linked: p.linked === '1', dashboard: p.dashboard === '1', test: p.test === '1' };
      const matches = rows.filter((r) => (!r.job || show.linked) && (r.kind !== 'dashboard' || show.dashboard) && (r.kind !== 'test' || show.test)
        && (!repo || r.repo === repo) && (!q || `${r.title} ${r.firstPrompt ?? ''}`.toLowerCase().includes(q)));
      const LIMIT = 200;
      return {
        rows: matches.slice(0, LIMIT), matched: matches.length, total: rows.length, limit: LIMIT,
        repos: [...new Set(rows.map((r) => r.repo).filter(Boolean))].sort(),
        missing: missing.slice(0, 100), canContinue: !DEMO && PROJECTS_DIR === path.join(CLAUDE_DIR, 'projects'),
      };
    },
    async historyDetail(id) {
      const d = await history.detail(id, await historyContext());
      if (!d) throw new HttpError(404, 'That conversation isn’t there any more, or has nothing in it.');
      const cut = (t, n) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : t);
      const prompts = d.prompts.length > 15 ? [...d.prompts.slice(0, 12), { gap: d.prompts.length - 15 }, ...d.prompts.slice(-3)] : d.prompts;
      return { ...d, prompts: prompts.map((p) => (p.gap ? p : { at: p.at, text: cut(p.text, 600) })), filesEdited: d.filesEdited.slice(0, 50), moreFiles: Math.max(0, d.filesEdited.length - 50), lastAnswer: cut(d.lastAnswer, 1500) };
    },
    /** The job's decisions.md (lib/decisions.js), written again first so it has every decision so far. */
    async decisionsFile(slug) {
      const f = await jobOf(slug);
      const d = await writeDecisions(f);
      if (!d) throw new HttpError(404, 'This job’s folder isn’t there any more, so it has no decision file.');
      return { file: DECISIONS_FILE, path: d.file, text: d.text, copy: ticketCopy(d.text) };
    },
    hasJob: async (slug) => Boolean(await featureBySlug(slug)),
    /** The job a name means: its slug, or a ticket key (ORBIT-479) an open job is for. Null: none. */
    async jobForName(name) {
      if (await featureBySlug(name)) return name;
      const key = canonicalKey(name);
      return key ? (await jobsByTicket(await features())).get(key)?.slug ?? null : null;
    },
    job: async (slug) => jobDetail(await jobOf(slug)),
    /** "Load older": only the thread items before the given one. */
    async threadBefore(slug, before) {
      const f = await jobOf(slug);
      const page = await threadPage(f, await state.auditFor(f.dir, Infinity), { before });
      if (!page) throw new HttpError(404, 'That part of the conversation isn’t there any more. Reload the job.');
      return { slug: f.slug, thread: page.items, threadMore: page.more };
    },
    notes: async (slug) => readNotes(await jobOf(slug)),
    // The Decisions tab: every choice you made on this job, newest first (lib/decisions.js).
    async decisions(slug) {
      const f = await jobOf(slug);
      return { decisions: decisionLog(await state.auditFor(f.dir, Infinity)) };
    },
    async docs(slug) {
      // The Docs tab's list: every document of the job, grouped, with versions and times (lib/docs.js).
      const f = await jobOf(slug);
      const specPath = await shownSpec(f);
      return { docs: await listJobDocs(f.dir, { spec: specPath ? { path: specPath, version: f.spec?.version ?? null } : null, recorded: f.recordedArtifacts }) };
    },
    async doc(slug, file) {
      // One document, rendered (sanitised, lib/markdown.js) and as its source text. Inside the job
      // folder only: no way out, no symlinks, .md and .json only, at most DOC_MAX_BYTES (lib/docs.js).
      // The spec ('spec') only when it is a .md inside the job's repository or folder (shownSpec).
      const f = await jobOf(slug);
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
      return { file, name, type, html, text: doc.text, updatedAt: doc.updatedAt, size: doc.size, vscode: file === 'spec' ? specPath : path.join(f.dir, file), summary };
    },
    async ids(slug, id) {
      const index = indexIds(await jobDocs(await jobOf(slug)));
      return index[id] ?? { id, definition: null, mentions: [] };
    },
    localView: async (slug, { fresh = false } = {}) => local.view(await jobOf(slug), { fresh }),
    async commits(slug) {
      const f = await jobOf(slug);
      const codeDir = f.worktree && fs.existsSync(f.worktree) ? f.worktree : f.repoPath;
      if (!codeDir || !f.branch || !(await git.isGitRepo(codeDir))) return { dir: codeDir, commits: [], note: 'No feature branch yet. Commits show up here once building starts.' };
      try {
        return { dir: codeDir, base: f.baseSha ?? null, head: f.branch, commits: await git.commits(codeDir, { base: f.baseSha ?? null, head: f.branch }) };
      } catch (err) {
        return { dir: codeDir, commits: [], note: `Couldn’t read the branch: ${String(err.message).split('\n')[0]}` };
      }
    },
    /** Markdown you are writing (the drawer's notes Preview), rendered by the same sanitising renderer as every document. */
    render: async (slug, text) => ({ html: renderMarkdown(text, { idHref: idHref(await jobOf(slug)) }) }),
    /** A job's screens or walkthrough page, for the screens server (lib/docs.js readWireframes, readWalkthrough). */
    async screen(slug, which, { forDownload = false } = {}) {
      const f = await jobOf(slug);
      try { return which === 'walkthrough' ? await readWalkthrough(f, { forDownload }) : await readWireframes(f.dir); } catch (err) { throw err instanceof DocError ? new HttpError(err.status, err.message) : err; }
    },
    orbitStatus,
    /**
     * Telemetry's ten insight graphs (lib/telemetry.js, lib/insights.js) for one window, plus the plan
     * meters now. 100 days of the usage log (this month against last, eight plan weeks), the job list
     * (route size, the finish line) and the audit lines (send-backs, answers) go in; readFrom says where
     * the lines read start, so a week that wasn't read is never shown as an empty one.
     */
    async telemetry({ window }) {
      const now = new Date();
      const readFrom = now.getTime() - 100 * 24 * 3600e3;
      const lines = await usageLog.read({ since: readFrom });
      const list = await features();
      const titles = Object.fromEntries(list.map((f) => [f.slug, f.title ?? f.slug]));
      const cards = await boardCards(list);
      const dirOf = new Map(list.map((f) => [f.slug, f.dir]));
      const done = (c) => Boolean(c.finish?.reached) || c.closed?.as === 'done' || c.closedEarlier?.as === 'done';
      const jobs = cards.filter((c) => !c.starting).map((c) => ({
        slug: c.slug, title: c.title ?? c.slug, route: c.route ?? null, finished: done(c),
        finishedAt: c.finish?.at ?? (c.closed ?? c.closedEarlier)?.at ?? null, dir: dirOf.get(c.slug) ?? null,
      }));
      // A dashboard whose own job folder is a temp one (a test, a demo) keeps its jobs: nothing to drop.
      const tempRoots = tempDirs().some((t) => FEATURES_DIR === t || FEATURES_DIR.startsWith(`${t}${path.sep}`)) ? [] : undefined;
      const meters = planUsage.view();
      // Your Claude Code use outside this app, when counted and read: never this app's own job
      // sessions (by session id: usage.jsonl's and the jobs' own; and by the jobs' worktrees).
      const counting = claudeCodeUsage ? (await claudeCodeSetting(state.dir)).count : false;
      let cc = null;
      if (counting) {
        claudeCodeUsage.poke(); // reads what is new in the background; never waits
        const sessions = new Set([
          ...lines.map((l) => l.session), ...list.flatMap((f) => f.sessionIds ?? []),
          ...Object.values(await state.allSessions()).map((x) => x?.sessionId), ...driver.list().map((r) => r.sessionId),
        ].filter(Boolean));
        const dirs = list.flatMap((f) => [f.worktree, f.statusWorktree]).filter(Boolean);
        cc = claudeCodeUsage.view({ exclude: { sessions, dirs }, since: readFrom, until: now.getTime() });
      }
      const outside = cc?.state === 'ready' ? cc.replies : null;
      const body = telemetryOf(lines, { window, now, me: usageUser, meters, titles, jobs, audit: await state.auditAll(), readFrom, tempRoots, outside });
      const ccState = DEMO ? 'demo' : !counting ? 'off' : cc.state;
      const claudeCode = {
        state: ccState, counted: outside !== null, words: CLAUDE_CODE_WORDS[ccState], note: CLAUDE_CODE_NOTE,
        usd: body.claudeCode?.usd ?? null, replies: body.claudeCode?.replies ?? null, readAt: cc?.readAt ?? null,
      };
      return { ...body, claudeCode, meters, file: usageLog.file };
    },
  };

  // ---------- Local mode only: what this computer's own page uses beyond jobs ----------

  const local_ = {
    /** The page is visible: notifications that it shows anyway don't pop on macOS meanwhile. */
    presence(visible) {
      if (visible === true) notifier.seen();
      else if (visible === false) notifier.unseen();
    },
    async testNotification() {
      const entry = await notifier.notify({ level: 'needs', title: 'A test from Feature Workshop', body: 'Notifications reach you here. Clicking one opens the dashboard.', test: true });
      events.emit('notification', null, entry);
      return entry;
    },
    /** Fetch both remotes and read the PRs now (read-only), instead of waiting for the next 10-minute refresh. */
    refreshFlow() {
      flow.refresh({ network: true }).catch((err) => console.error('flow:', err));
      return flow.view();
    },
    /** The top bar's usage meters: read the plan's usage now instead of at the next minute. */
    checkPlanUsage: () => planUsage.check(),
    /** Settings → Repos (site/routes-repos.js): the registry's list, add, remove and check. On a first start the list is seeded from the recent repositories. */
    repos: reposDoor(local.registry, { recent: () => repoList() }),
    evidence: (await import('./evidence.js')).evidenceRunner({ jobs: features, local, state, events, on, demo: DEMO, env }), // evidence at the test stage: runner/evidence.js, site/routes-evidence.js
    recordSecret,
    /**
     * An easter egg found, or something the page saw you do (a theme tried), from fixed lists only.
     * Recorded once, as an audit line, so the ledger can always be rebuilt. Nothing while Play is Off.
     * The teapot, the headers and the Hex Sommelier are the dashboard's to find, never the page's.
     */
    async playEvent({ secret, id, kind }) {
      if (secret && !PAGE_SECRETS.includes(id)) throw new HttpError(400, 'Unknown secret.');
      if (!secret && !(Object.hasOwn(PLAY_EVENTS, kind) && PLAY_EVENTS[kind].includes(id))) throw new HttpError(400, 'Unknown play event.');
      if (!playOn()) return { recorded: false, reason: 'Play mode is off.' };
      const ledger = await playbook.current();
      // A hidden theme (CRT Terminal, Gold) counts only once the ledger has unlocked it.
      if (!secret && kind === 'theme' && !themeUnlocked(ledger, id)) throw new HttpError(409, 'That theme is still locked.');
      const already = secret ? Boolean(ledger?.secrets?.[id]) : Boolean(ledger?.themes?.[id]);
      if (!already) {
        await state.audit(secret ? { action: 'play-secret', id } : { action: 'play-event', kind, id });
        await playbook.refresh();
      }
      const view = ledgerView(playbook.ledger, playNow);
      return { recorded: !already, secrets: view.secrets, themesTried: view.themesTried };
    },
    teapot: TEAPOT,
    orbit: {
      status: orbitStatus, inbox: orbitInbox, client: orbit, url: () => orbitUrl, withJobs, httpError: orbitHttpError,
      /** Save a pasted token (and wire up the Foreman's MCP entry). Throws OrbitError in plain words. */
      async saveToken(body) {
        const was = await orbitSettings();
        const days = [7, 30, 90].includes(body.expiresInDays) ? body.expiresInDays : null;
        const typedUrl = typeof body.url === 'string' && body.url.trim() ? body.url : (was.url ?? env.GROUND_CONTROL_ORBIT_URL);
        let saved;
        try { saved = await setToken(body.token, { store: orbitStore, claudeSettingsFile: CLAUDE_SETTINGS_FILE, orbitUrl: typedUrl }); } catch (err) { throw orbitHttpError(err); }
        const now = new Date();
        await state.setSettings({ orbit: { url: normalizeOrbitUrl(typedUrl), savedAt: now.toISOString(), expiresAt: days ? new Date(now.getTime() + days * 86_400_000).toISOString() : null } });
        await state.audit({ action: 'orbit-token', what: 'saved', store: saved.store, mcp: MCP_NAME });
        // An entry left in the file it used to be written to (Claude Code doesn't read it there): moved.
        if (legacySettingsFile && path.resolve(legacySettingsFile) !== path.resolve(CLAUDE_SETTINGS_FILE)) {
          if (await removeMcpEntry(legacySettingsFile).catch(() => false)) await state.audit({ action: 'orbit-mcp-moved', from: legacySettingsFile, to: CLAUDE_SETTINGS_FILE, mcp: MCP_NAME });
        }
        orbitInbox.reset();
        await startOrbit();
        await orbitInbox.refresh({ full: true }); // says at once whether Orbit takes the token
        return orbitStatus();
      },
      /** Forget the token: out of the store, and the MCP entry out of Claude Code's settings. */
      async clearToken() {
        await clearToken({ store: orbitStore, claudeSettingsFile: CLAUDE_SETTINGS_FILE });
        if (legacySettingsFile && path.resolve(legacySettingsFile) !== path.resolve(CLAUDE_SETTINGS_FILE)) await removeMcpEntry(legacySettingsFile).catch(() => false);
        const was = await orbitSettings();
        await state.setSettings({ orbit: { url: was.url ?? null, savedAt: null, expiresAt: null } });
        await state.audit({ action: 'orbit-token', what: 'cleared' });
        orbitInbox.reset();
        await startOrbit();
        return orbitStatus();
      },
    },
    integrator,
    /** Review rounds (packet Q): the panel's routes (site/routes-review.js). */
    review: {
      list: () => reviewRounds.list(), view: (slug) => reviewRounds.view(slug), act: (slug, action, body) => reviewRounds.act(slug, action, body),
      setSettings: (body) => reviewRounds.setSettings(body),
      github: () => flow.view().github ?? null,
      httpError: (err) => (err instanceof ReviewRefused ? new HttpError(err.status, err.message, err.code ? { code: err.code } : undefined) : err),
    },
    stacks: createStacks({ driver, state, featuresDir: FEATURES_DIR, registry: local.registry, integrator, readDirs, models: MODELS.map((m) => m.id), onChange: () => { cached = null; notifyChange(); }, onSettings: settingsChanged }), // Stacks (packet K): runner/stacks.js
    /** An integration board refusal (lib/integrate.js IntegrateError) as the answer the page has always had. */
    integrateHttpError: (err) => (err instanceof IntegrateError ? new HttpError(err.status, err.message) : err),
    /** Something outside the runner changed what the page shows (the screens server went down): every page fetches again. */
    changed() { cached = null; notifyChange(); },
  };

  // ---------- After a restart (runner/replay.js) ----------

  // Sending anything to the job, or marking it done, ends its restart pause.
  state.on('audit', (e) => {
    if (!e.featureDir || !restartPaused.has(e.featureDir)) return;
    if (e.action === 'send' || e.action === 'close') { restartPaused.delete(e.featureDir); cached = null; }
  });

  // Replies a clean stop paused carry on by themselves: tried now and every few seconds while one
  // waits, once the job's lock is free (another process may hold it: a terminal, another copy of
  // Ground Control) and no usage limit holds.
  let resumeTimer = null;
  let resuming = false;
  const RESUME_EVERY_MS = 3000;
  async function carryOnAfterRestart() {
    if (resuming) return;
    resuming = true;
    try {
      for (const [dir, p] of [...restartPaused]) {
        if (p.how !== 'clean' || limits.isLimited() || closing.has(dir)) continue;
        let held = null;
        try { held = heldElsewhere(dir); } catch { held = null; }
        if (held) continue;
        const f = (await features()).find((x) => x.dir === dir);
        if (!f || f.closed) { restartPaused.delete(dir); continue; }
        const drive = await driveState(f);
        // Picked up in a terminal meanwhile: that session is the terminal's now.
        if (drive.mode === 'terminal') { restartPaused.delete(dir); cached = null; continue; }
        if (drive.mode === 'running') continue;
        const cwd = p.cwd ?? drive.cwd ?? f.repoPath;
        if (!cwd) { restartPaused.delete(dir); continue; }
        try {
          const run = await driver.start({
            featureDir: dir, slug: f.slug, title: f.title, cwd, sessionId: p.sessionId, model: p.model ?? drive.model ?? OPUS,
            text: RESTART_TEXT, kind: RESUME_KIND, additionalDirectories: await readDirs(),
          });
          restartPaused.delete(dir);
          await state.audit({ action: 'resumed', featureDir: dir, slug: f.slug, runId: run.id, sessionId: p.sessionId, via: 'auto' });
        } catch (err) {
          // Taken meanwhile: tried again later. Anything else: left for you (the job shows paused).
          if (!(err instanceof JobLocked) && !(err instanceof Busy)) {
            console.error(`resume after restart (${f.slug}):`, err.message);
            restartPaused.set(dir, { ...p, how: 'crash' });
          }
        }
        cached = null;
      }
    } finally {
      resuming = false;
    }
    if (![...restartPaused.values()].some((p) => p.how === 'clean') && resumeTimer) { clearInterval(resumeTimer); resumeTimer = null; }
  }
  function startCarryingOn() {
    if (resumeTimer || ![...restartPaused.values()].some((p) => p.how === 'clean')) return;
    resumeTimer = setInterval(() => { carryOnAfterRestart().catch((err) => console.error(err)); }, RESUME_EVERY_MS);
    resumeTimer.unref?.();
    carryOnAfterRestart().catch((err) => console.error(err));
  }

  /** The replay (runner/replay.js): rebuilds each open job's restart pause and status-check count. */
  async function replayRestart() {
    const jobs = await replay({ state, featuresDir: FEATURES_DIR });
    for (const [dir, j] of jobs) {
      if (j.cutOff) restartPaused.set(dir, { how: j.cutOff, at: j.cutOffAt ?? new Date().toISOString(), runId: j.runId, sessionId: j.sessionId, cwd: j.cwd, model: j.model, slug: j.slug });
      if (j.statusTries || j.statusErrors.length) {
        driver.statusChecks.set(dir, { seen: undefined, tries: j.statusTries, errors: j.statusErrors, cardId: null, silenced: false, session: j.sessionId ? { sessionId: j.sessionId, model: j.model } : null });
      }
    }
    return jobs;
  }

  // ---------- Start and stop ----------

  let started = false;
  /**
   * Opens the runner. listen: opens the site's port (the host's server.listen, which prints the
   * console lines); the background work that used to start once the port was open starts after it.
   */
  async function start({ listen = async () => {} } = {}) {
    if (started) return;
    started = true;
    await limits.load();
    await startGateParking();
    await skill.check(); // read once at start; /api/meta re-reads only when the file changes
    // Before the routes open: what the last stop (or crash) left (runner/replay.js).
    await replayRestart();
    watch(FEATURES_DIR, featureFileChanged);
    watch(PROJECTS_DIR);
    await listen();
    // How `ground-control resume` finds this service (runner/service-file.js): pid, port, token.
    if (TOKEN && PORT) { try { writeServiceFile(state.dir, { pid: process.pid, host: HOST, port: PORT, token: TOKEN }); } catch (err) { console.error('service.json:', err.message); } }
    // The play ledger: read play.json, or rebuild it from the audit log when it is missing. Not while Play is Off.
    if (playOn()) playbook.refresh().catch((err) => console.error('play ledger:', err));
    // The flow map: fetch and read PRs now, then every 10 minutes; recount locally every minute.
    flow.start();
    // The top bar's usage meters: read now, then every minute.
    planUsage.start();
    // The Orbit inbox: polled once there is a token (every 15 minutes; every 3 while one is open).
    startOrbit().catch((err) => console.error('orbit:', err.message));
    refreshRunTypical().catch(() => {});
    // What waits for you now: later changes are told as notifications, these never are.
    checkWaiting().catch(() => {});
    // Replies the last clean stop paused carry on.
    startCarryingOn();
  }

  /**
   * Stopping pauses any reply in progress; sessions stay resumable. Dev servers and commands
   * started from the page stop too. One audit line `service-stop` names the replies paused (and
   * those still waiting to carry on from the last restart), so the next start resumes them.
   */
  let stopping = null;
  function stop() {
    stopping ??= (async () => {
      if (resumeTimer) { clearInterval(resumeTimer); resumeTimer = null; }
      const active = driver.list().filter((r) => ACTIVE_RUN.has(r.status));
      const paused = active.map((r) => ({ runId: r.id, slug: r.slug, featureDir: r.featureDir, sessionId: r.sessionId, model: r.model, cwd: r.cwd, kind: r.kind }));
      for (const [dir, p] of restartPaused) {
        if (p.how === 'clean' && !paused.some((x) => x.featureDir === dir)) paused.push({ runId: p.runId, slug: p.slug, featureDir: dir, sessionId: p.sessionId, model: p.model, cwd: p.cwd, kind: RESUME_KIND });
      }
      try { await state.audit({ action: 'service-stop', pid: process.pid, paused }); } catch (err) { console.error('service-stop:', err.message); }
      for (const r of active) driver.stop(r.id);
      local.stopAll(); // dev servers and commands started from the page stop with it
      removeServiceFile(state.dir);
    })();
    return stopping;
  }

  /**
   * The events the runner sends up. type: one of lib/protocol.js EVENT_TYPES (fn(job, data, opts)),
   * '*' for all of them (fn(type, job, data, opts)), or 'legacy' for the classic page's stream
   * (fn(event, data)). Returns a function that stops listening.
   */
  function on(type, fn) {
    if (type === 'legacy') { out.on('legacy', fn); return () => out.off('legacy', fn); }
    if (type !== '*' && !EVENT_TYPES.includes(type)) throw new Error(`Not an event the runner sends: ${type}`);
    const listener = type === '*' ? fn : (t, job, data, opts) => { if (t === type) fn(job, data, opts); };
    out.on('event', listener);
    return () => out.off('event', listener);
  }

  return { handle, read, local: local_, on, start, stop };


}
