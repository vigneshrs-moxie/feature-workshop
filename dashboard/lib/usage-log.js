// Telemetry's record (plan §7a.1): one line per Foreman turn in usage.jsonl, kept forever.
//
// Where: ~/.ground-control/usage.jsonl, or the dashboard's own state folder when one is given
// (WORKSHOP_STATE_DIR, demo mode); GROUND_CONTROL_DIR overrides both. Nothing is sent anywhere.
//
// A turn is everything a job's Foreman session did between one answer and the next: the driver
// passes every assistant and result message on ('usage' event), TurnMeter adds up the token
// counts of each message once (a message comes once per content block, with the same id) and,
// when the result arrives, hands back the turn split by who did the work (the Foreman, or a crew
// member it sent work to) and by model. A turn where only the Foreman worked is one line; each
// crew member and model that worked in it adds one more, all with the same `turn` id.
//
// Cost: Claude Code's own figure is preferred (costSource 'cli'). Its total_cost_usd is a running
// total for the session, so a turn's cost is the difference from the total before it: the last
// result in the same reply, else the last line written for that session (a resumed session may or
// may not carry its earlier total; of the two readings, the one nearer the turn's token estimate is
// taken). It is shared between the turn's lines by their token estimates. Without Claude Code's
// figure, each line's cost is the estimate from lib/cost.js (costSource 'estimate').
//
// The log appends through one queue (one write at a time, in order) and starts a new file at
// 50 MB: the full file is renamed usage-<time>.jsonl and kept; reads take every file.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { estimateCost, tokensFromUsage, ZERO_TOKENS, addTokens } from './cost.js';
import { AGENTS } from './stages.js';

export const USAGE_FILE = 'usage.jsonl';
export const MAX_BYTES = 50 * 1024 * 1024;

/** The folder usage.jsonl lives in. */
export function usageDir({ env = process.env, home = os.homedir(), stateDir = null } = {}) {
  if (env.GROUND_CONTROL_DIR) return path.resolve(env.GROUND_CONTROL_DIR);
  return stateDir ? path.resolve(stateDir) : path.join(home, '.ground-control');
}

/** The Ground Control user: the person (two people share one Claude account). Local mode: the OS user name. */
export function groundControlUser({ env = process.env } = {}) {
  if (env.GROUND_CONTROL_USER) return String(env.GROUND_CONTROL_USER);
  try { return os.userInfo().username || 'unknown'; } catch { return 'unknown'; }
}

/** The Claude account id, when Claude Code's sign-in says it (~/.claude.json oauthAccount.accountUuid), else null. */
export async function claudeAccountId({ home = os.homedir() } = {}) {
  try {
    const id = JSON.parse(await fs.readFile(path.join(home, '.claude.json'), 'utf8'))?.oauthAccount?.accountUuid;
    return typeof id === 'string' && id ? id : null;
  } catch { return null; }
}

/** Who did the work: the Foreman, or the crew member's role from its agent type. */
export function workerOf(agentType) {
  if (!agentType) return 'foreman';
  const t = String(agentType).toLowerCase();
  if (t.includes('implement')) return 'implementer';
  if (t.includes('review') || t.includes('fable-check')) return 'lens';
  if (t.includes('test')) return 'tester';
  return t.replace(/^feature-/, '');
}

const meterOf = (m) => (m && typeof m.percent === 'number' ? { percent: m.percent, resetsAt: m.resetsAt ?? null } : null);
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * The turn's cost from Claude Code's running total. total: this result's total_cost_usd.
 * runPrev: the total at the last result in the same reply (certain). sessionPrev: the total on the
 * last line written for the session (a resumed session may or may not carry it). estimate: the
 * turn's cost from its tokens. Returns USD, or null without a total.
 */
export function turnCost({ total, runPrev = null, sessionPrev = null, estimate = null }) {
  if (typeof total !== 'number' || Number.isNaN(total)) return null;
  if (typeof runPrev === 'number') return Math.max(0, total - runPrev);
  if (typeof sessionPrev === 'number' && total >= sessionPrev) {
    const carried = total - sessionPrev;
    const est = estimate ?? 0;
    return Math.abs(carried - est) <= Math.abs(total - est) ? carried : total;
  }
  return total;
}

/**
 * Adds up each run's messages into turns. onMessage returns a turn when a result arrives, else
 * null; forget(runId) returns what a reply that ended without a result (stopped, limited) used.
 * A turn: { runId, slug, featureDir, sessionId, total, runPrev, groups: [{ worker, agentType, model, tokens }] }.
 */
export class TurnMeter {
  constructor() { this.runs = new Map(); }

  #run(runId) {
    let r = this.runs.get(runId);
    if (!r) { r = { messages: new Map(), agents: new Map(), lastTotal: null }; this.runs.set(runId, r); }
    return r;
  }

  onMessage({ runId, slug = null, featureDir = null, sessionId = null, model = null, msg }) {
    if (!runId || !msg) return null;
    const r = this.#run(runId);
    if (msg.type === 'assistant' && msg.message) {
      const m = msg.message;
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b?.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task') && b.id) r.agents.set(b.id, b.input?.subagent_type ?? null);
      }
      if (m.usage && m.model !== '<synthetic>') {
        const agentType = msg.parent_tool_use_id ? (r.agents.get(msg.parent_tool_use_id) ?? 'crew') : null;
        r.messages.set(m.id ?? msg.uuid ?? `${r.messages.size}`, { model: m.model ?? model, agentType, tokens: tokensFromUsage(m.usage) });
      }
      return null;
    }
    if (msg.type !== 'result') return null;
    const total = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null;
    const turn = this.#turn(r, { runId, slug, featureDir, sessionId: msg.session_id ?? sessionId, model, total, usage: msg.usage });
    r.messages.clear();
    if (total !== null) r.lastTotal = total;
    return turn;
  }

  #turn(r, { runId, slug, featureDir, sessionId, model, total, usage }) {
    const groups = new Map();
    for (const m of r.messages.values()) {
      const key = `${m.agentType ?? ''}\u0000${m.model ?? ''}`;
      const g = groups.get(key) ?? { worker: workerOf(m.agentType), agentType: m.agentType, model: m.model ?? null, tokens: { ...ZERO_TOKENS } };
      g.tokens = addTokens(g.tokens, m.tokens);
      groups.set(key, g);
    }
    // No message carried usage (the demo's pretend Foreman, an older CLI): the result's own, as the Foreman's.
    if (!groups.size) groups.set('', { worker: 'foreman', agentType: null, model, tokens: usage ? tokensFromUsage(usage) : { ...ZERO_TOKENS } });
    return { runId, slug, featureDir, sessionId, total, runPrev: r.lastTotal, groups: [...groups.values()] };
  }

  /** Drops a run; what it used since its last result (a reply stopped mid-turn), or null. */
  forget(runId, { slug = null, featureDir = null, sessionId = null } = {}) {
    const r = this.runs.get(runId);
    this.runs.delete(runId);
    if (!r || !r.messages.size) return null;
    return this.#turn(r, { runId, slug, featureDir, sessionId, model: null, total: null, usage: null });
  }
}

/**
 * The lines for one turn, in the plan's shape. ctx: { at, user, account, ticket, stage, section,
 * meters: { fiveHour, week } (the plan meters' latest reading), sessionPrev, turnId }.
 */
export function turnLines(turn, ctx = {}) {
  const estimates = turn.groups.map((g) => estimateCost(g.model, g.tokens));
  const estTotal = estimates.reduce((s, e) => s + (e ?? 0), 0);
  const cli = turnCost({ total: turn.total, runPrev: turn.runPrev, sessionPrev: ctx.sessionPrev ?? null, estimate: estTotal });
  const meters = { fiveHour: meterOf(ctx.meters?.fiveHour), week: meterOf(ctx.meters?.week) };
  const t = ctx.at ?? new Date().toISOString();
  return turn.groups.map((g, i) => {
    // Claude Code's figure, shared by the estimates (evenly when none has a price).
    const share = estTotal > 0 ? (estimates[i] ?? 0) / estTotal : 1 / turn.groups.length;
    const costUsd = cli !== null ? round6(cli * share) : (estimates[i] === null ? null : round6(estimates[i]));
    return {
      t, user: ctx.user ?? null, account: ctx.account ?? null, job: turn.slug ?? null, ticket: ctx.ticket ?? null,
      // A crew member's own stage (a review lens is review); the Foreman's is the job's stage now.
      stage: (g.agentType && AGENTS[g.agentType]?.stage) || ctx.stage || null,
      section: ctx.section ?? null, worker: g.worker, model: g.model ?? null, tokens: g.tokens,
      costUsd, costSource: cli !== null ? 'cli' : 'estimate', meters,
      turn: ctx.turnId ?? turn.runId, session: turn.sessionId ?? null, cliTotalUsd: turn.total,
    };
  });
}

/** One parsed line, or null for a line that isn't one. */
export function parseLine(text) {
  if (!text.trim()) return null;
  try {
    const d = JSON.parse(text);
    return d && typeof d === 'object' && typeof d.t === 'string' && !Number.isNaN(Date.parse(d.t)) ? d : null;
  } catch { return null; }
}

export class UsageLog {
  constructor({ dir, maxBytes = MAX_BYTES, now = () => new Date() }) {
    this.dir = dir;
    this.file = path.join(dir, USAGE_FILE);
    this.maxBytes = maxBytes;
    this.now = now;
    this.queue = Promise.resolve();
    this.size = null; // the current file's size, once read
    this.sessions = null; // session id → the last cliTotalUsd in the files, read once
    this.recent = new Map(); // the same, for lines written since this dashboard started (these win)
  }

  /** Appends lines (one write, in order after every earlier append). Resolves when written. */
  append(lines) {
    const list = (Array.isArray(lines) ? lines : [lines]).filter(Boolean);
    const job = this.queue.then(() => this.#write(list));
    this.queue = job.catch(() => {});
    return job;
  }

  /** Waits for every queued write. */
  flush() { return this.queue; }

  async #write(list) {
    if (!list.length) return;
    const text = list.map((l) => JSON.stringify(l)).join('\n') + '\n';
    const bytes = Buffer.byteLength(text);
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    if (this.size === null) this.size = await fs.stat(this.file).then((s) => s.size, () => 0);
    if (this.size > 0 && this.size + bytes > this.maxBytes) {
      await fs.rename(this.file, await this.#rotatedName());
      this.size = 0;
    }
    await fs.appendFile(this.file, text, { mode: 0o600 });
    this.size += bytes;
    for (const l of list) if (l.session && typeof l.cliTotalUsd === 'number') this.recent.set(l.session, l.cliTotalUsd);
  }

  async #rotatedName() {
    const stamp = this.now().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    for (let n = 0; ; n++) {
      const name = path.join(this.dir, `usage-${stamp}${n ? `-${n}` : ''}.jsonl`);
      try { await fs.access(name); } catch { return name; }
    }
  }

  /** Every log file, the oldest first (rotated ones, then usage.jsonl). */
  async files() {
    const names = await fs.readdir(this.dir).catch(() => []);
    const rotated = names.filter((n) => /^usage-.+\.jsonl$/.test(n)).sort();
    return [...rotated, ...(names.includes(USAGE_FILE) ? [USAGE_FILE] : [])].map((n) => path.join(this.dir, n));
  }

  /** Every line at or after `since` (a Date or ms; all when omitted), the oldest first. Waits for queued writes. */
  async read({ since = null } = {}) {
    await this.flush();
    const from = since === null ? -Infinity : +since;
    const out = [];
    for (const file of await this.files()) {
      // A rotated file last written before `since` holds nothing newer.
      if (from > -Infinity && path.basename(file) !== USAGE_FILE) {
        const st = await fs.stat(file).catch(() => null);
        if (!st || st.mtimeMs < from) continue;
      }
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      for (const raw of text.split('\n')) {
        const l = parseLine(raw);
        if (l && Date.parse(l.t) >= from) out.push(l);
      }
    }
    return out.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  }

  /** Claude Code's running total on the last line written for this session, or null. */
  async sessionTotal(sessionId) {
    if (!sessionId) return null;
    this.loading ??= this.read().then((lines) => {
      const map = new Map();
      for (const l of lines) if (l.session && typeof l.cliTotalUsd === 'number') map.set(l.session, l.cliTotalUsd);
      this.sessions = map;
    });
    await this.loading;
    await this.flush();
    return this.recent.get(sessionId) ?? this.sessions.get(sessionId) ?? null;
  }
}
