// Runs a job's Foreman (conductor) session headlessly with the Claude Agent SDK.
// One "run" = one message sent to the session and everything it does until it replies.
// Every tool permission request is parked here until the person clicks Allow or Deny.

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describePermission } from './permissions.js';
import { draftRule } from './rules.js';
import { describeTool } from './session-log.js';

const ACTIVE = new Set(['starting', 'running', 'waiting_permission', 'stopping']);
// Ended states: done, stopped, error, and limited (the reply ended on a Claude usage limit).
const trimInput = (input) => {
  const s = JSON.stringify(input ?? {});
  return s.length > 20000 ? { note: 'Input too large to show in full.', preview: s.slice(0, 20000) } : input;
};

export class Busy extends Error {}

export class Driver extends EventEmitter {
  /**
   * queryFn: the SDK's query() (injectable for tests).
   * state: State instance. projectsDir: where Claude Code keeps session logs.
   */
  constructor({ queryFn, state, projectsDir, cliPath = null, policy = null }) {
    super();
    this.queryFn = queryFn;
    // policy(run, toolName, input, opts) -> { auto, reason }: routine requests are allowed without asking.
    this.policy = policy;
    this.state = state;
    this.projectsDir = projectsDir;
    this.cliPath = cliPath;
    this.runs = new Map();
  }

  activeRunFor({ featureDir, sessionId }) {
    for (const run of this.runs.values()) {
      if (!ACTIVE.has(run.status)) continue;
      if ((featureDir && run.featureDir === featureDir) || (sessionId && run.sessionId === sessionId)) return run;
    }
    return null;
  }

  list() {
    return [...this.runs.values()].map((r) => this.view(r));
  }

  pendingPermissions() {
    return [...this.runs.values()].flatMap((r) => [...r.pending.values()].map((p) => this.viewPermission(p)));
  }

  view(run) {
    return {
      id: run.id, slug: run.slug, featureDir: run.featureDir, title: run.title, kind: run.kind,
      sessionId: run.sessionId, cwd: run.cwd, model: run.model, status: run.status,
      startedAt: run.startedAt, endedAt: run.endedAt, text: run.text,
      lastText: run.lastText, lastAction: run.lastAction, resultText: run.resultText,
      costUsd: run.costUsd, apiKeySource: run.apiKeySource, error: run.error,
      newJob: run.newJob, pending: run.pending.size, denials: run.denials,
      backgroundTasks: run.backgroundTasks, sessionState: run.sessionState ?? null, autoAllowed: run.autoAllowed ?? 0,
      additionalDirectories: run.additionalDirectories, stopReason: run.stopReason ?? null,
    };
  }

  // What a page sees of a waiting request: everything but the callback and the untrimmed input.
  // `suggestions` are Claude Code's own (only ever used for this reply); `draft` is the narrowest
  // "Always allow" rule for it (lib/rules.js), or null when none can be saved.
  viewPermission(p) {
    const { resolve, originalInput, ...rest } = p;
    return rest;
  }

  /** A waiting request with its full input (for checking a rule against it), or null. */
  pendingRequest(requestId) {
    for (const run of this.runs.values()) {
      const req = run.pending.get(requestId);
      if (req) return { ...this.viewPermission(req), input: req.originalInput };
    }
    return null;
  }

  /**
   * Start a run. Throws Busy if this job or session already has one going.
   * text: the exact message to send. sessionId: resume this session (null = new session).
   */
  async start({ featureDir, slug, title, cwd, sessionId = null, model = null, text, kind = 'message', newJob = false, additionalDirectories = [] }) {
    if (this.activeRunFor({ featureDir, sessionId })) throw new Busy('This job’s Foreman is already working on a reply.');
    const run = {
      id: randomUUID(), featureDir, slug, title, cwd, sessionId, model, text, kind, newJob,
      status: 'starting', startedAt: new Date().toISOString(), endedAt: null,
      lastText: null, lastAction: null, resultText: null, costUsd: null, apiKeySource: null, error: null,
      denials: [], stderr: [], pending: new Map(), abort: new AbortController(), query: null, stopRequested: false,
      additionalDirectories, backgroundTasks: [], hasResult: false, closeInput: null, idleTimer: null,
    };
    this.runs.set(run.id, run);
    await this.state.audit({ action: 'send', featureDir, slug, sessionId, kind, text, runId: run.id, model });
    this.#launch(run).catch(() => {});
    this.emit('run', this.view(run));
    return this.view(run);
  }

  async #launch(run) {
    let closeInput;
    const finished = new Promise((r) => { closeInput = r; });
    run.closeInput = closeInput;
    const message = run.text;
    async function* input() {
      yield { type: 'user', message: { role: 'user', content: message }, parent_tool_use_id: null };
      await finished; // keep the input open until the reply is complete, so Stop can interrupt
    }
    const options = {
      cwd: run.cwd,
      permissionMode: 'default', // every risky action asks; never the auto-approving modes
      canUseTool: (toolName, input, opts) => this.#ask(run, toolName, input, opts),
      abortController: run.abort,
      stderr: (data) => { run.stderr.push(String(data)); if (run.stderr.length > 60) run.stderr.shift(); },
      additionalDirectories: run.additionalDirectories,
    };
    if (run.sessionId) options.resume = run.sessionId;
    if (run.model) options.model = run.model;
    if (this.cliPath) options.pathToClaudeCodeExecutable = this.cliPath;

    try {
      const q = this.queryFn({ prompt: input(), options });
      run.query = q;
      run.status = 'running';
      this.emit('run', this.view(run));
      // The reply is over only when the session goes idle: after its result AND after every
      // background worker it started has finished. No time limit: long runs are normal.
      for await (const msg of q) await this.#onMessage(run, msg);
      if (ACTIVE.has(run.status) || run.stopRequested) run.status = run.stopRequested ? 'stopped' : run.status === 'error' ? 'error' : 'done';
    } catch (err) {
      run.status = run.stopRequested ? 'stopped' : 'error';
      if (!run.stopRequested) run.error = `${err?.message ?? err}${run.stderr.length ? `\n${run.stderr.slice(-8).join('').trim()}` : ''}`;
    } finally {
      clearTimeout(run.idleTimer);
      closeInput();
      this.#dropPending(run, { behavior: 'deny', message: 'The reply ended before this was decided.' }, 'run-ended');
      run.endedAt = new Date().toISOString();
      const reply = (run.lastText ?? run.resultText ?? '').slice(0, 8000) || undefined;
      await this.state.audit({ action: 'run-ended', featureDir: run.featureDir, slug: run.slug, sessionId: run.sessionId, runId: run.id, status: run.status, costUsd: run.costUsd, error: run.error, reply, stopReason: run.stopReason ?? undefined });
      this.emit('run', this.view(run));
    }
  }

  async #onMessage(run, msg) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      run.sessionId = msg.session_id ?? run.sessionId;
      run.model = msg.model ?? run.model;
      run.apiKeySource = msg.apiKeySource ?? null;
      await this.state.setSession(run.featureDir, { sessionId: run.sessionId, cwd: run.cwd, model: run.model, lastRunAt: run.startedAt, ...(run.newJob ? { startedFromWorkshop: true, title: run.title } : {}) });
      this.emit('run', this.view(run));
    } else if (msg.type === 'rate_limit_event') {
      // Claude's plan usage: 'rejected' means the limit is reached; 'allowed_warning' means close to it.
      const info = msg.rate_limit_info ?? null;
      run.rateLimit = info;
      const covered = info?.overageStatus === 'allowed' || info?.overageStatus === 'allowed_warning';
      if (info?.status === 'rejected' && !covered) this.#limitHit(run, info);
      else this.emit('usage-status', info);
    } else if (msg.type === 'assistant' && !msg.parent_tool_use_id) {
      // The CLI turns a usage-limit refusal into a message of its own, marked as a rate_limit error.
      if (msg.error === 'rate_limit') this.#limitHit(run, run.rateLimit?.status === 'rejected' ? run.rateLimit : null);
      // A new turn (for example after a background worker finished): not idle any more.
      run.awaitingIdle = false;
      clearTimeout(run.idleTimer);
      const blocks = msg.message?.content ?? [];
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (text) run.lastText = text;
      const tool = blocks.filter((b) => b.type === 'tool_use').pop();
      if (tool) run.lastAction = describeTool(tool.name, tool.input);
      this.emit('run', this.view(run));
    } else if (msg.type === 'result') {
      run.hasResult = true;
      run.costUsd = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : run.costUsd;
      if (typeof msg.result === 'string' && msg.result.trim()) run.resultText = msg.result;
      run.denials = (msg.permission_denials ?? []).map((d) => ({ tool: d.tool_name, input: trimInput(d.tool_input) }));
      if (msg.is_error && !run.stopRequested) {
        run.status = run.limitHit || msg.api_error_status === 429 ? 'limited' : 'error';
        run.error = run.resultText || msg.subtype;
        if (run.status === 'limited') this.#limitHit(run, run.rateLimit?.status === 'rejected' ? run.rateLimit : null);
      }
      run.awaitingIdle = true;
      this.#armIdle(run);
      this.emit('run', this.view(run));
    } else if (msg.type === 'system' && msg.subtype === 'background_tasks_changed') {
      run.backgroundTasks = (msg.tasks ?? []).filter((x) => !x.ambient).map((x) => ({ id: x.task_id, type: x.task_type, agentType: x.subagent_type ?? null, description: x.description }));
      if (run.awaitingIdle) this.#armIdle(run);
      this.emit('run', this.view(run));
    } else if (msg.type === 'system' && msg.subtype === 'session_state_changed') {
      run.sessionState = msg.state;
      if (msg.state === 'idle' && (run.hasResult || run.stopRequested)) {
        clearTimeout(run.idleTimer);
        run.closeInput?.();
      }
      this.emit('run', this.view(run));
    }
  }

  // The CLI doesn't always announce "idle", so a reply also ends a few seconds after its result
  // when no worker is still running in the background and nothing waits for a click.
  // There is no time limit while anything is still going on.
  #armIdle(run) {
    clearTimeout(run.idleTimer);
    run.idleTimer = setTimeout(() => {
      if (run.awaitingIdle && !run.backgroundTasks.length && !run.pending.size) run.closeInput?.();
    }, this.idleGraceMs ?? 5000);
  }

  // Reported once per run; the listener (LimitWatch) pauses the other runs and plans the carry-on.
  #limitHit(run, info) {
    if (run.limitHit) return;
    run.limitHit = true;
    this.emit('usage-limit', { run: this.view(run), info });
  }

  async #agentType(run, agentID) {
    if (!agentID || !run.sessionId) return null;
    try {
      for (const dir of await fs.readdir(this.projectsDir)) {
        const meta = path.join(this.projectsDir, dir, run.sessionId, 'subagents', `agent-${agentID}.meta.json`);
        try { return JSON.parse(await fs.readFile(meta, 'utf8')).agentType ?? null; } catch { /* not here */ }
      }
    } catch { /* no projects dir */ }
    return null;
  }

  async #ask(run, toolName, input, opts = {}) {
    if (this.policy && toolName !== 'AskUserQuestion') {
      let verdict = null;
      try { verdict = await this.policy(run, toolName, input, opts); } catch { verdict = null; }
      if (verdict?.auto) {
        const plain = describePermission(toolName, input, { cwd: run.cwd });
        run.autoAllowed = (run.autoAllowed ?? 0) + 1;
        await this.state.audit({ action: 'auto-allowed', featureDir: run.featureDir, slug: run.slug, sessionId: run.sessionId, runId: run.id, tool: toolName, agentType: await this.#agentType(run, opts.agentID), headline: plain.headline, preview: (plain.preview ?? '').slice(0, 300) || undefined, reason: verdict.reason, rule: verdict.rule ?? undefined });
        this.emit('run', this.view(run));
        return { behavior: 'allow', updatedInput: input };
      }
    }
    const req = {
      id: randomUUID(), runId: run.id, slug: run.slug, featureDir: run.featureDir, title: run.title,
      toolName, input: trimInput(input), kind: toolName === 'AskUserQuestion' ? 'question' : 'permission',
      prompt: opts.title ?? null, displayName: opts.displayName ?? null, description: opts.description ?? null,
      decisionReason: opts.decisionReason ?? null, blockedPath: opts.blockedPath ?? null,
      agentID: opts.agentID ?? null, agentType: await this.#agentType(run, opts.agentID),
      defaultToNo: Boolean(opts.defaultToNo),
      // "Allow for this reply" is offered only when Claude Code suggests a rule, and is kept in memory
      // for this run only (destination 'session'); nothing is written to settings files.
      canAllowForRun: !opts.suppressAlwaysAllowRule && Array.isArray(opts.suggestions) && opts.suggestions.length > 0,
      suggestions: (opts.suggestions ?? []).map((s) => ({ ...s, destination: 'session' })),
      // "Always allow…": saved rules never apply to questions or to steps Claude Code flagged as risky.
      draft: toolName === 'AskUserQuestion' || opts.defaultToNo ? null : draftRule(toolName, input, opts.suggestions ?? []),
      plain: describePermission(toolName, input, { cwd: run.cwd, blockedPath: opts.blockedPath, defaultToNo: opts.defaultToNo }),
      createdAt: new Date().toISOString(),
      originalInput: input,
    };
    return new Promise((resolve) => {
      req.resolve = (result) => { run.pending.delete(req.id); if (run.status === 'waiting_permission' && run.pending.size === 0) run.status = 'running'; if (run.awaitingIdle) this.#armIdle(run); resolve(result); this.emit('run', this.view(run)); };
      run.pending.set(req.id, req);
      run.status = 'waiting_permission';
      opts.signal?.addEventListener?.('abort', () => {
        if (!run.pending.has(req.id)) return; // already answered; its card is gone already
        req.resolve({ behavior: 'deny', message: 'Cancelled.' });
        this.emit('permission-gone', { id: req.id, slug: run.slug, reason: 'cancelled' });
      });
      this.emit('permission', this.viewPermission(req));
      this.emit('run', this.view(run));
    });
  }

  /**
   * decision: 'allow' | 'allow-run' | 'deny'. answers: for questions, { [questionText]: label }.
   * rule: the id of the "Always allow" rule this allow came with (recorded in the audit log).
   */
  async decide(requestId, { decision, note = '', answers = null, rule = null }) {
    for (const run of this.runs.values()) {
      const req = run.pending.get(requestId);
      if (!req) continue;
      let result;
      if (decision === 'deny') {
        result = { behavior: 'deny', message: note.trim() ? `The person said no, with this note: ${note.trim()}` : 'The person said no to this from Feature Workshop.' };
      } else {
        const updatedInput = req.kind === 'question' ? { ...req.originalInput, answers: answers ?? {} } : req.originalInput;
        result = { behavior: 'allow', updatedInput };
        if (decision === 'allow-run' && req.canAllowForRun) result.updatedPermissions = req.suggestions;
      }
      await this.state.audit({ action: 'permission', featureDir: req.featureDir, slug: req.slug, sessionId: run.sessionId, runId: run.id, tool: req.toolName, agentType: req.agentType, headline: req.plain.headline, decision, note: note || undefined, answers: answers ?? undefined, rule: rule ?? undefined });
      req.resolve(result);
      this.emit('permission-gone', { id: requestId, slug: req.slug, reason: 'answered' });
      return true;
    }
    return false;
  }

  // Say no to everything still waiting on this run, and tell open pages each card is gone.
  // reason: 'stopped' | 'usage-limit' | 'run-ended'.
  #dropPending(run, result, reason) {
    for (const p of [...run.pending.values()]) {
      p.resolve(result);
      this.emit('permission-gone', { id: p.id, slug: run.slug, reason });
    }
    run.pending.clear();
  }

  /** reason: null (you clicked Stop) or 'usage-limit' (paused until the limit resets). */
  async stop(runId, { reason = null } = {}) {
    const run = this.runs.get(runId);
    if (!run || !ACTIVE.has(run.status)) return false;
    run.stopRequested = true;
    run.stopReason = reason;
    run.status = 'stopping';
    this.emit('run', this.view(run));
    await this.state.audit({ action: 'stop-now', featureDir: run.featureDir, slug: run.slug, sessionId: run.sessionId, runId, reason: reason ?? undefined });
    const why = reason === 'usage-limit' ? 'Paused: the Claude usage limit was reached. The job carries on after it resets.' : 'The person stopped this reply.';
    this.#dropPending(run, { behavior: 'deny', message: why, interrupt: true }, reason === 'usage-limit' ? 'usage-limit' : 'stopped');
    try {
      await run.query?.interrupt?.();
    } catch {
      run.abort.abort();
    }
    // If the interrupt doesn't end it promptly, cut it off.
    setTimeout(() => { if (ACTIVE.has(run.status)) run.abort.abort(); }, 15000).unref?.();
    return true;
  }
}
