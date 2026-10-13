// Feature Workshop: local-only dashboard server.
// Listens on 127.0.0.1 only. Reads workflow files, session logs and git (read-only).
// The only things it changes go through a job's Foreman session, and only when you click.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadFeatures, SessionIndex } from './lib/features.js';
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
import { classify } from './lib/policy.js';
import { buildOverview, parseBrief } from './lib/overview.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 4477;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
const SHARED = { '/shared/compose.js': path.join(HERE, 'lib', 'compose.js') };
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const FEATURES_DIR = path.resolve(process.env.WORKSHOP_FEATURES_DIR || path.join(CLAUDE_DIR, 'feature-work'));
const PROJECTS_DIR = path.resolve(process.env.WORKSHOP_PROJECTS_DIR || path.join(CLAUDE_DIR, 'projects'));
const AGENTS_DIR = path.resolve(process.env.WORKSHOP_AGENTS_DIR || path.join(CLAUDE_DIR, 'agents'));
const SKILLS_DIR = path.resolve(process.env.WORKSHOP_SKILLS_DIR || path.join(CLAUDE_DIR, 'skills'));
const DEMO = Boolean(process.env.WORKSHOP_DEMO);
const TOKEN = crypto.randomBytes(24).toString('hex');

const MODELS = [
  { id: 'claude-fable-5-1', label: 'Fable 5.1', note: 'What the workflow is designed for. Best judgment, highest cost.' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'Strong and cheaper. A good Foreman for smaller jobs.' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', note: 'Cheapest. For trying the dashboard out, not real jobs.' },
];

// ---------- Engine ----------

const sessionIndex = new SessionIndex(PROJECTS_DIR);
const state = new State(process.env.WORKSHOP_STATE_DIR || (DEMO ? path.join(path.dirname(FEATURES_DIR), 'state') : undefined));
const HOOK_SCRIPT = path.join(HERE, 'hooks', 'record.mjs');
const queryFn = DEMO
  ? (await import('./demo/fake-query.js')).makeFakeQuery({ featuresDir: FEATURES_DIR })
  : (await import('@anthropic-ai/claude-agent-sdk')).query;
const driver = new Driver({ queryFn, state, projectsDir: PROJECTS_DIR, cliPath: process.env.WORKSHOP_CLAUDE_PATH || null, policy: policyFor });

const isInside = (p, dir) => {
  if (!p || !dir) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// Routine steps are handled without asking (see lib/policy.js); everything else comes to you.
async function policyFor(run, toolName, input, opts) {
  const settings = await state.getSettings();
  const f = (await features()).find((x) => x.dir === run.featureDir);
  const repo = f?.repoPath ?? run.cwd;
  const worktrees = [f?.worktree, f?.statusWorktree, repo && f ? path.join(path.dirname(repo), `orbit-${f.slug}`) : null].filter(Boolean);
  const specDirs = [repo ? path.join(repo, 'docs', 'plans') : null, f?.spec?.path && path.isAbsolute(f.spec.path) ? path.dirname(f.spec.path) : null].filter(Boolean);
  return classify(toolName, input, {
    mode: settings.policy, stage: f?.stage ?? 'spec', featureDir: run.featureDir, worktrees, repoPath: repo, specDirs,
    cwd: run.cwd, defaultToNo: Boolean(opts?.defaultToNo), extraReadable: [SKILLS_DIR, AGENTS_DIR],
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
  cached = { at: Date.now(), list };
  return list;
}
const featureBySlug = async (slug) => (await features()).find((f) => f.slug === slug) ?? null;

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
  const pausedHere = notRunning && runEnds[f.dir]?.status === 'stopped';
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
    updatedAt: f.updatedAt, sources: f.sources, permissions: pendingList.length,
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
      };
    });
}

const idHref = (f) => (id) => `#/job/${encodeURIComponent(f.slug)}/id/${encodeURIComponent(id)}`;

// Read a file inside a folder, refusing anything that escapes it.
async function readInside(dir, rel) {
  const root = path.resolve(dir);
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) return null;
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
  const audit = await state.auditFor(f.dir, 400);
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

  // The conversation with the Foreman: its briefs and replies, your messages, and short notes.
  const thread = [];
  for (const b of f.briefs) {
    const st = await fsp.stat(path.join(f.dir, b.file)).catch(() => null);
    const parsed = parseBrief((await readInside(f.dir, b.file)) ?? '');
    thread.push({ kind: 'brief', at: st?.mtime.toISOString() ?? null, number: b.number, stage: b.stage, file: b.file, headline: parsed.headline, point: parsed.happened[0] ?? parsed.next ?? null });
  }
  let autoGroup = null;
  for (const e of audit) {
    if (e.action === 'auto-allowed') {
      if (!autoGroup || autoGroup.runId !== e.runId) { autoGroup = { kind: 'auto', at: e.at, runId: e.runId, items: [] }; thread.push(autoGroup); }
      autoGroup.items.push({ at: e.at, headline: e.headline, who: e.agentType ?? 'conductor', reason: e.reason });
      continue;
    }
    if (e.action === 'send') thread.push({ kind: 'you', at: e.at, text: e.text, sendKind: e.kind });
    else if (e.action === 'run-ended') {
      if (e.status === 'error') thread.push({ kind: 'problem', at: e.at, text: e.error ?? 'The reply hit a problem.' });
      else if (e.reply) thread.push({ kind: 'reply', at: e.at, html: renderMarkdown(e.reply, { idHref: idHref(f) }), stopped: e.status === 'stopped' });
      else if (e.status === 'stopped') thread.push({ kind: 'note', at: e.at, text: 'You paused this reply.' });
    } else if (e.action === 'permission') thread.push({ kind: 'decision', at: e.at, text: `${e.decision === 'deny' ? 'You said no to' : 'You allowed'}: ${e.headline ?? e.tool}${e.note ? ` (“${e.note}”)` : ''}` });
    else if (e.action === 'takeover') thread.push({ kind: 'note', at: e.at, text: 'You took this job over from the terminal.' });
  }
  thread.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  return {
    ...boardCard(f, run),
    dir: f.dir, repoPath: f.repoPath, branch: f.branch, worktree: f.worktree, baseSha: f.baseSha, prs: f.prs,
    spec: f.spec, specFile: specFile(f), currentText: f.currentText, questionsFull: f.questions, decidedOnYourBehalf: f.decidedOnYourBehalf,
    latestBrief, briefs: f.briefs, approvals: f.approvals, history: f.history, artifacts: f.artifacts, recordedArtifacts: f.recordedArtifacts,
    costDetail: { ...f.cost, whatIf: whatIfConductor(f.cost.agents) },
    activity: f.activity.map((a) => (a.state === 'running' && !stillRunning(f, a, run && ACTIVE_RUN.has(run.status) ? run : null) ? { ...a, state: 'stopped' } : a)),
    drive, run, runs: driver.list().filter((r) => r.featureDir === f.dir), overview, thread: thread.slice(-60), locate: f.locate, policy: settings.policy,
    permissionsPending: driver.pendingPermissions().filter((p) => p.featureDir === f.dir),
    lastReply, audit: audit.slice(-50), warnings: f.warnings,
    statusForCompose: { questions: f.questions, decidedOnYourBehalf: f.decidedOnYourBehalf, nextProposed: f.nextProposed, spec: f.spec, artifacts: f.recordedArtifacts, brief: f.latestBrief },
  };
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

const str = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : '');

function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 48).replace(/-$/, '') || 'job';
}

async function uniqueSlug(base) {
  const taken = new Set([...(await features()).map((f) => f.slug), ...driver.list().map((r) => r.slug)]);
  let slug = base;
  for (let i = 2; taken.has(slug) || fs.existsSync(path.join(FEATURES_DIR, slug)); i++) slug = `${base}-${i}`;
  return slug;
}

const GET = {
  '/api/meta': async () => ({
    token: TOKEN, stages: STAGES, agents: AGENTS, prices: { asOf: PRICES_AS_OF, models: PRICES },
    featuresDir: FEATURES_DIR, crewModels: await crewModels(), demo: DEMO, models: MODELS, readDirs: await readDirs(),
    settings: await state.getSettings(), liveLink: { enabled: (await readHookSessions(state.dir)).enabled, script: HOOK_SCRIPT },
  }),
  '/api/features': async () => {
    const list = await features();
    const cards = [...startingCards(list), ...list.map((f) => boardCard(f, runFor(f)))];
    const rank = (c) => (c.needsYou ? 0 : c.working || c.stageState === 'working' ? 1 : c.stageState === 'done' ? 3 : 2);
    cards.sort((a, b) => rank(a) - rank(b) || (a.needsYou ? String(a.waitingSince ?? '').localeCompare(String(b.waitingSince ?? '')) : 0));
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const spend = await sessionIndex.spendSince({ today: startOfToday.getTime(), week: startOfToday.getTime() - 6 * 86400000 });
    const agents = list.flatMap((f) => f.activity.filter((a) => stillRunning(f, a, driver.activeRunFor({ featureDir: f.dir }))));
    const totalUsd = list.reduce((a, f) => a + f.cost.totalUsd, 0);
    const stats = {
      today: spend.today, week: spend.week, featuresUsd: totalUsd,
      needsYou: cards.filter((c) => c.needsYou).length,
      workingAgents: agents.filter((a) => a.state === 'running').length + cards.filter((c) => c.starting).length,
      workingFeatures: cards.filter((c) => c.working).length,
      quiet: list.filter((f) => f.quiet).length,
      inProgress: cards.filter((c) => c.stageState !== 'done').length,
      done: cards.filter((c) => c.stageState === 'done').length,
      projects: new Set(cards.map((c) => c.project.name)).size,
    };
    return { features: cards, needsYou: stats.needsYou, totalUsd, stats, permissions: driver.pendingPermissions(), generatedAt: new Date().toISOString() };
  },
  '/api/runs': async () => ({ runs: driver.list(), permissions: driver.pendingPermissions() }),
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
  let m = /^\/api\/job\/([^/]+)(\/.*)?$/.exec(urlPath);
  if (m) {
    const f = await featureBySlug(m[1]);
    if (!f) throw new HttpError(404, 'No job by that name.');
    const sub = m[2] ?? '';
    if (!sub) return sendJson(res, 200, await jobDetail(f));
    if (sub === '/doc') {
      const file = url.searchParams.get('file') ?? '';
      let text = null;
      let name = file;
      if (file === 'spec') {
        const p = specFile(f);
        name = 'Product spec';
        try { text = p ? await fsp.readFile(p, 'utf8') : null; } catch { text = null; }
      } else if (/\.(md|json)$/.test(file)) {
        text = await readInside(f.dir, file);
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
  return serveStatic(urlPath, res);
}

async function routePost(urlPath, req, res) {
  checkWrite(req.headers, { port: PORT, token: TOKEN });
  const body = await readBody(req);
  let m;
  if ((m = /^\/api\/job\/([^/]+)\/send$/.exec(urlPath))) {
    const f = await featureBySlug(m[1]);
    if (!f) throw new HttpError(404, 'No job by that name.');
    const text = str(body.text).trim();
    if (!text) throw new HttpError(400, 'The message is empty.');
    const drive = await driveState(f);
    if (drive.mode === 'running') throw new HttpError(409, 'The Foreman is still working on your last message. Wait for it, or pause it first.');
    if (drive.mode === 'terminal') throw new HttpError(409, 'This job’s Foreman was last used in your terminal.', { code: 'terminal', lastTerminalAt: drive.lastTerminalAt });
    if (drive.mode === 'terminal-open' && body.confirmNoTerminal !== true) throw new HttpError(409, 'Claude Code is open in this repository in a terminal. Make sure none of those windows is this job’s Foreman, then confirm.', { code: 'terminal-open', terminals: drive.terminals.length });
    const model = MODELS.some((x) => x.id === body.model) ? body.model : drive.model ?? 'claude-fable-5-1';
    const cwd = drive.cwd ?? f.repoPath;
    if (!cwd) throw new HttpError(400, 'I don’t know which repository this job belongs to.');
    let sendText = text;
    let sessionId = drive.sessionId;
    if (drive.mode === 'none' || drive.mode === 'terminal-open') {
      // No Foreman session yet: start one that picks this job up from its files.
      sendText = `/feature ${f.slug} Private folder: ${f.dir}\n\n${text}`;
      sessionId = null;
    }
    const run = await driver.start({ featureDir: f.dir, slug: f.slug, title: f.title, cwd, sessionId, model, text: sendText, kind: str(body.kind, 20) || 'message', additionalDirectories: await readDirs() });
    cached = null;
    return sendJson(res, 200, { run });
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
    const policy = ['hands-off', 'ask-all'].includes(body.policy) ? body.policy : null;
    if (!policy) throw new HttpError(400, 'Unknown setting.');
    await state.setSettings({ policy });
    await state.audit({ action: 'settings', policy });
    return sendJson(res, 200, await state.getSettings());
  }
  if ((m = /^\/api\/runs\/([\w-]+)\/stop$/.exec(urlPath))) {
    if (!(await driver.stop(m[1]))) throw new HttpError(404, 'That reply already finished.');
    return sendJson(res, 200, { ok: true });
  }
  if ((m = /^\/api\/permissions\/([\w-]+)$/.exec(urlPath))) {
    const decision = ['allow', 'allow-run', 'deny'].includes(body.decision) ? body.decision : null;
    if (!decision) throw new HttpError(400, 'Choose allow or deny.');
    const answers = body.answers && typeof body.answers === 'object' ? Object.fromEntries(Object.entries(body.answers).map(([k, v]) => [str(k, 500), str(v, 2000)])) : null;
    if (!(await driver.decide(m[1], { decision, note: str(body.note, 2000), answers }))) throw new HttpError(404, 'That request was already answered or has expired.');
    return sendJson(res, 200, { ok: true });
  }
  if (urlPath === '/api/jobs') {
    const description = str(body.description, 600).replace(/\s+/g, ' ').trim();
    if (description.length < 4) throw new HttpError(400, 'Describe the job in a few words.');
    const repo = await checkRepo(str(body.repoPath, 1000));
    if (!repo.ok) throw new HttpError(400, repo.reason);
    const model = MODELS.some((x) => x.id === body.model) ? body.model : 'claude-fable-5-1';
    const kind = body.kind === 'bug' ? 'bug' : 'feature';
    const slug = await uniqueSlug(slugify(description));
    const featureDir = path.join(FEATURES_DIR, slug);
    const text = `/feature ${description}${kind === 'bug' ? ' (This is a bug fix.)' : ''} Private folder: ${featureDir}`;
    const run = await driver.start({ featureDir, slug, title: description, cwd: repo.path, model, text, kind, newJob: true, additionalDirectories: await readDirs() });
    await state.audit({ action: 'new-job', featureDir, slug, repo: repo.path, model, description });
    cached = null;
    return sendJson(res, 200, { run, slug });
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
  changeTimer = setTimeout(() => { cached = null; broadcast('change', { at: Date.now() }); }, 700);
}
driver.on('run', (run) => { cached = null; broadcast('run', run); });
driver.on('permission', (p) => broadcast('permission', p));
driver.on('permission-gone', (p) => broadcast('permission-gone', p));

function watch(dir) {
  try {
    fs.watch(dir, { recursive: true }, notifyChange).on('error', () => {});
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
    if (req.method === 'GET' && urlPath === '/api/events') return openEvents(req, res);
    if (req.method === 'GET') return await routeGet(urlPath, url, req, res);
    if (req.method === 'POST') return await routePost(urlPath, req, res);
    return send(res, 405, 'Method not allowed');
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message, ...err.extra });
    if (err instanceof Busy) return sendJson(res, 409, { error: err.message });
    console.error(err);
    return sendJson(res, 500, { error: 'Something went wrong. The details are in the terminal running the dashboard.' });
  }
});

watch(FEATURES_DIR);
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
    setTimeout(() => process.exit(0), 400);
  });
}
