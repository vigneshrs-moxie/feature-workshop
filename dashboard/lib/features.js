// Builds the dashboard's view of every feature from disk. Read-only.

import fs from 'node:fs/promises';
import path from 'node:path';
import { parseWorkflowStatus } from './workflow-status.js';
import { parseStatusJson } from './status-json.js';
import { parseSessionLog, usageByModel, activityState, spendSince } from './session-log.js';
import { agentInfo, skippedStages } from './stages.js';
import { estimateCost, calibrationFactors } from './cost.js';

const ARTIFACT_FILES = [
  ['Workflow status', 'workflow-status.md'],
  ['Findings', 'findings.md'],
  ['Implementation plan', 'implementation-plan.md'],
  ['Test plan', 'test-plan.md'],
  ['Implementation log', 'implementation-log.md'],
  ['Test report', 'test-report.md'],
  ['Review (combined)', 'review.md'],
];

async function readText(file) {
  try { return await fs.readFile(file, 'utf8'); } catch { return null; }
}
async function statOrNull(file) {
  try { return await fs.stat(file); } catch { return null; }
}
async function listDir(dir) {
  try { return await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
}

// ---------- Session logs ----------

// Which stage a worker's cost belongs to.
function stageForAgent(agentType, description = '') {
  if (agentType === 'feature-spec-writer') {
    if (/post-investigation|spec update|update.*findings/i.test(description)) return 'spec-update';
    if (/refine/i.test(description)) return 'refine';
    return 'spec';
  }
  return agentInfo(agentType).stage ?? 'other';
}

const isWorkflowSession = (parsed, text) =>
  parsed.dispatches.some((d) => d.agentType?.startsWith('feature-')) ||
  /^\/feature(\s|$)/.test(parsed.firstPrompt?.trim() ?? '') ||
  text.includes('"skill":"feature');

// Caches parsed logs by file path + size + mtime, so refreshes only re-read changed files.
export class SessionIndex {
  constructor(projectsDir) {
    this.projectsDir = projectsDir;
    this.cache = new Map();
  }

  async #load(file) {
    const st = await statOrNull(file);
    if (!st) return null;
    const key = `${st.size}:${st.mtimeMs}`;
    const hit = this.cache.get(file);
    if (hit && hit.key === key) return hit.value;
    const text = await readText(file);
    if (text === null) return null;
    const parsed = parseSessionLog(text);
    const isWorkflow = isWorkflowSession(parsed, text);
    // Keep the raw text only for workflow sessions (needed to match feature folders); others can be large.
    const value = { file, parsed, text: isWorkflow ? text : '', isWorkflow, mtimeMs: st.mtimeMs };
    this.cache.set(file, { key, value });
    return value;
  }

  async #subagents(sessionFile) {
    const dir = path.join(sessionFile.replace(/\.jsonl$/, ''), 'subagents');
    const out = [];
    for (const ent of await listDir(dir)) {
      if (!ent.isFile() || !ent.name.endsWith('.jsonl')) continue;
      const file = path.join(dir, ent.name);
      const log = await this.#load(file);
      if (!log) continue;
      let meta = {};
      try { meta = JSON.parse((await readText(file.replace(/\.jsonl$/, '.meta.json'))) ?? '{}'); } catch { /* no meta */ }
      out.push({ ...log, meta });
    }
    return out;
  }

  // All top-level session logs (not subagent logs).
  async allSessions() {
    const sessions = [];
    for (const proj of await listDir(this.projectsDir)) {
      if (!proj.isDirectory()) continue;
      const projDir = path.join(this.projectsDir, proj.name);
      for (const ent of await listDir(projDir)) {
        if (!ent.isFile() || !ent.name.endsWith('.jsonl')) continue;
        const log = await this.#load(path.join(projDir, ent.name));
        if (log) sessions.push(log);
      }
    }
    return sessions;
  }

  // Spend and tokens across every session on this machine (features or not), from each time in `since`.
  async spendSince(since) {
    const out = Object.fromEntries(Object.keys(since).map((k) => [k, { usd: 0, tokens: 0 }]));
    for (const log of await this.allSessions()) {
      const logs = [log.parsed, ...(await this.#subagents(log.file)).map((s) => s.parsed)];
      for (const parsed of logs) {
        for (const [k, ms] of Object.entries(since)) {
          const s = spendSince(parsed, ms);
          out[k].usd += s.usd;
          out[k].tokens += s.tokens;
        }
      }
    }
    return out;
  }

  // Assign each workflow session to the one feature folder it mentions most.
  async sessionsByFeature(featureDirs, explicitIds = {}) {
    const result = Object.fromEntries(featureDirs.map((d) => [d, []]));
    for (const log of await this.allSessions()) {
      const explicit = Object.entries(explicitIds).find(([, id]) => id && id === log.parsed.sessionId);
      let owner = explicit?.[0] ?? null;
      if (!owner && log.isWorkflow) {
        let best = 0;
        for (const dir of featureDirs) {
          const n = log.text.split(dir).length - 1;
          if (n > best) { best = n; owner = dir; }
        }
      }
      if (owner) result[owner].push({ ...log, subagents: await this.#subagents(log.file) });
    }
    return result;
  }
}

// ---------- Cost and activity per feature ----------

export function summariseSessions(sessions, now = Date.now()) {
  const agents = []; // { agentType, name, model, stage, usd, tokens, state, lastAction, startedAt, lastAt }
  const perModel = {};
  let cliTotal = 0;
  let usedCli = true;

  for (const s of sessions) {
    const entries = [];
    // The conductor's own messages are attributed to the stage of the latest dispatch before them.
    const dispatches = [...s.parsed.dispatches].sort((a, b) => (a.at || '').localeCompare(b.at || ''));
    for (const msg of s.parsed.messages.values()) {
      const prior = dispatches.filter((d) => d.at && msg.at && d.at <= msg.at).pop();
      const stage = prior ? stageForAgent(prior.agentType, prior.description) : 'spec';
      entries.push({ agentType: 'conductor', model: msg.model, stage, usd: estimateCost(msg.model, msg.tokens) ?? 0, tokens: msg.tokens });
    }
    for (const sub of s.subagents) {
      const type = sub.meta.agentType ?? 'unknown';
      for (const [model, u] of Object.entries(usageByModel(sub.parsed))) {
        entries.push({
          agentType: type, model, stage: stageForAgent(type, sub.meta.description), usd: u.estimateUsd, tokens: u.tokens,
        });
      }
    }

    // Prefer Claude Code's own figure, unless it is older than the log (live session).
    const estByModel = {};
    for (const e of entries) estByModel[e.model] = (estByModel[e.model] || 0) + e.usd;
    const estTotal = Object.values(estByModel).reduce((a, b) => a + b, 0);
    const cli = s.parsed.cliCost;
    const cliFresh = cli && estTotal <= cli.totalUsd * 1.05;
    const factors = cliFresh ? calibrationFactors(estByModel, cli.byModel) : {};
    if (cliFresh) cliTotal += cli.totalUsd; else usedCli = false;

    for (const e of entries) {
      const usd = e.usd * (factors[e.model] ?? 1);
      perModel[e.model] = (perModel[e.model] || 0) + usd;
      let row = agents.find((a) => a.agentType === e.agentType && a.stage === e.stage && a.model === e.model);
      if (!row) {
        row = { agentType: e.agentType, name: agentInfo(e.agentType).name, model: e.model, stage: e.stage, usd: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } };
        agents.push(row);
      }
      row.usd += usd;
      for (const k of Object.keys(row.tokens)) row.tokens[k] += e.tokens[k];
    }
  }

  // Live activity: the conductor and any worker still running.
  const activity = [];
  for (const s of sessions) {
    const conductorState = activityState(s.parsed, now);
    activity.push({
      who: 'conductor', name: agentInfo('conductor').name, sessionId: s.parsed.sessionId,
      state: conductorState, doing: s.parsed.lastAction?.text ?? null,
      since: s.parsed.lastAction?.at ?? s.parsed.lastAt, lastAt: s.parsed.lastAt,
    });
    for (const sub of s.subagents) {
      activity.push({
        who: sub.meta.agentType ?? 'unknown', name: agentInfo(sub.meta.agentType).name, description: sub.meta.description ?? null,
        sessionId: s.parsed.sessionId, state: activityState(sub.parsed, now),
        doing: sub.parsed.lastAction?.text ?? null, startedAt: sub.parsed.firstAt, lastAt: sub.parsed.lastAt,
      });
    }
  }

  const totalUsd = Object.values(perModel).reduce((a, b) => a + b, 0);
  return {
    totalUsd,
    source: sessions.length === 0 ? 'none' : usedCli ? 'claude-code' : 'estimate',
    cliTotalUsd: usedCli ? cliTotal : null,
    perModel,
    agents: agents.sort((a, b) => b.usd - a.usd),
    activity,
  };
}

// ---------- Features ----------

// The project is the repository's folder name. Worktrees (orbit-<slug>) count as their main repo
// when the main checkout's path is known; otherwise the folder name is used as is.
export function projectFor(repoPath) {
  if (!repoPath) return { name: 'Unknown project', path: null };
  const clean = repoPath.replace(/\/+$/, '');
  return { name: path.basename(clean) || clean, path: clean };
}

// Feature or bug: status.json's `kind` when present, else a guess from the branch or slug.
export function kindFor(kind, branch, slug) {
  if (kind) return kind;
  return /^(fix|bug|hotfix)[/-]/i.test(branch || '') || /^(fix|bug)-/i.test(slug || '') ? 'bug' : 'feature';
}

async function readFeatureFolder(dir) {
  const slug = path.basename(dir);
  const wsFile = path.join(dir, 'workflow-status.md');
  const [wsText, sjText, wsStat] = await Promise.all([
    readText(wsFile), readText(path.join(dir, 'status.json')), statOrNull(wsFile),
  ]);
  const ws = wsText ? parseWorkflowStatus(wsText) : null;
  const sj = sjText ? parseStatusJson(sjText) : null;
  const status = sj?.ok ? sj : null;

  const briefs = (await listDir(path.join(dir, 'briefs')))
    .filter((e) => e.isFile() && /^\d+-.+\.md$/.test(e.name))
    .map((e) => {
      const [, n, stage] = /^(\d+)-(.+)\.md$/.exec(e.name);
      return { number: Number(n), stage, file: `briefs/${e.name}` };
    })
    .sort((a, b) => a.number - b.number);

  const artifacts = [];
  for (const [name, file] of ARTIFACT_FILES) {
    const st = await statOrNull(path.join(dir, file));
    if (st) artifacts.push({ name, file, modifiedAt: st.mtime.toISOString() });
  }
  for (const e of await listDir(path.join(dir, 'review'))) {
    if (e.isFile() && e.name.endsWith('.md')) {
      const st = await statOrNull(path.join(dir, 'review', e.name));
      artifacts.push({ name: `Review: ${e.name.replace(/\.md$/, '')}`, file: `review/${e.name}`, modifiedAt: st?.mtime.toISOString() ?? null });
    }
  }

  const stageState = status?.stageState ?? ws?.stageState ?? null;
  const waitingSince = status?.waitingSince
    ?? (stageState === 'waiting_for_you' && wsStat ? wsStat.mtime.toISOString() : null);
  const route = status?.route ?? ws?.route ?? null;

  return {
    slug,
    dir,
    title: status?.title ?? ws?.title ?? slug,
    route,
    kind: kindFor(status?.kind, status?.branch ?? ws?.repository?.branch, slug),
    kindGuessed: !status?.kind,
    skipped: skippedStages(route),
    stage: status?.stage ?? ws?.stage ?? null,
    stageState,
    waitingFor: status?.waitingFor ?? null,
    waitingSince,
    needsYou: stageState === 'waiting_for_you' || Boolean(status?.waitingFor),
    currentText: ws?.currentRaw ?? null,
    nextProposed: status?.nextProposed ?? ws?.nextProposed ?? null,
    spec: status?.spec ?? ws?.spec ?? null,
    branch: status?.branch ?? ws?.repository?.branch ?? null,
    worktree: status?.worktree ?? ws?.worktree ?? null,
    baseSha: status?.baseSha ?? null,
    repoPath: status?.repo?.path ?? ws?.repository?.path ?? null,
    prs: status?.prs ?? null,
    questions: status?.questions ?? [],
    decidedOnYourBehalf: status?.decidedOnYourBehalf ?? [],
    latestBrief: status?.brief ?? (briefs.length ? { number: briefs.at(-1).number, path: briefs.at(-1).file, headline: null } : null),
    briefs,
    approvals: ws?.approvals ?? [],
    history: ws?.history ?? [],
    artifacts,
    recordedArtifacts: status?.artifacts?.length ? status.artifacts : ws?.artifacts ?? [],
    sessionId: status?.sessionId ?? null,
    updatedAt: status?.updatedAt ?? wsStat?.mtime.toISOString() ?? null,
    sources: { workflowStatus: Boolean(ws?.ok), statusJson: Boolean(status) },
    warnings: [...(ws?.warnings ?? []), ...(sj?.warnings ?? [])],
  };
}

export async function loadFeatures({ featuresDir, sessionIndex, now = Date.now() }) {
  const dirs = (await listDir(featuresDir)).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => path.join(featuresDir, e.name));
  const features = await Promise.all(dirs.map(readFeatureFolder));
  const explicit = Object.fromEntries(features.map((f) => [f.dir, f.sessionId]));
  const sessions = sessionIndex ? await sessionIndex.sessionsByFeature(dirs, explicit) : {};
  for (const f of features) {
    const s = sessions[f.dir] ?? [];
    f.sessionIds = s.map((x) => x.parsed.sessionId);
    f.cost = summariseSessions(s, now);
    f.activity = f.cost.activity;
    delete f.cost.activity;
    f.working = f.activity.some((a) => a.state === 'running');
    f.stalled = f.activity.some((a) => a.state === 'stalled');
    f.project = projectFor(f.repoPath ?? s[0]?.parsed.cwd ?? null);
  }
  // Features waiting on you first (longest wait first), then working, then the rest by last update.
  const rank = (f) => (f.needsYou ? 0 : f.stalled ? 1 : f.working || f.stageState === 'working' ? 2 : 3);
  features.sort((a, b) => rank(a) - rank(b)
    || (a.needsYou ? (a.waitingSince || '').localeCompare(b.waitingSince || '') : 0)
    || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return features;
}
