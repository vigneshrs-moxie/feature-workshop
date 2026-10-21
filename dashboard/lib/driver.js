// Runs a job's Foreman (conductor) session headlessly with the Claude Agent SDK.
// One "run" = one message sent to the session and everything it does until it replies.
// Every tool permission request is parked here until the person clicks Allow or Deny.
//
// Permission settings (the job's own, else the global one; see modeFor):
//   'ask-all' and 'hands-off' run the session in Claude Code's 'default' mode: every request that
//     needs permission reaches canUseTool, and the policy decides which are routine.
//   'auto' runs it in Claude Code's auto mode: its safety model allows or blocks each action by
//     itself, and only those it can't decide reach canUseTool (then the policy is consulted as
//     usual). What it blocks is recorded as 'auto-blocked' and shown as a dim line in the thread.
//     When the account can't use auto mode, Claude Code starts in 'default' instead; the init
//     message says so and the driver reports it ('auto-mode' event).
// In every setting a PreToolUse hook (lib/hard-lines.js) forces a card for the hard lines and
// refuses org and force pushes; the same check runs again here before the policy is asked. In
// auto mode a hard line your go-ahead already covers (cover: a push once you approved the PR stage,
// an rm -rf inside the job's folders) is allowed without a card and logged like a routine step.
// settingsFor(run) adds Claude Code settings for the session: the job's auto mode environment
// (lib/auto-env.js), so the safety model knows the job's repo, fork and org remote.
//
// Steer (a message you send while the Foreman is still replying): the session's input is a queue.
// The first message starts the reply; anything you steer joins the queue and is handed to Claude
// Code's live input as soon as it asks for more (the SDK reads its input all through the reply),
// and Claude Code reads it at its next turn. Each steered message goes through these states,
// reported as 'steer' events:
//   queued     the dashboard accepted it
//   delivered  handed to Claude Code's input
//   acted-on   the Foreman wrote its first message answering it: Claude Code stamps reply messages
//              with the uuids of the messages they answer (user_message_uuids); with a Claude Code
//              too old to stamp, the first message the Foreman writes after it was delivered
//   cancelled  never read: the reply stopped or ended first
//   unanswered handed over, but the reply ended (an error, or a Stop Claude Code gave no receipt
//              for) before the Foreman answered it
// The input still closes when the reply finishes (or you click Stop).

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describePermission } from './permissions.js';
import { draftRule } from './rules.js';
import { describeTool } from './session-log.js';
import { hardLine, hardLineHook, orgPushCheck } from './hard-lines.js';

/** The SDK permission mode for a permission setting. */
export const sdkModeFor = (mode) => (mode === 'auto' ? 'auto' : 'default');

const ACTIVE = new Set(['starting', 'running', 'waiting_permission', 'stopping']);
// Ended states: done, stopped, error, and limited (the reply ended on a Claude usage limit).
const trimInput = (input) => {
  const s = JSON.stringify(input ?? {});
  return s.length > 20000 ? { note: 'Input too large to show in full.', preview: s.slice(0, 20000) } : input;
};

export class Busy extends Error {}

/** What a page sees of a steered message. */
const viewSteer = (s) => ({ id: s.id, runId: s.runId, slug: s.slug, text: s.text, state: s.state, queuedAt: s.queuedAt, deliveredAt: s.deliveredAt, actedAt: s.actedAt });

export class Driver extends EventEmitter {
  /**
   * queryFn: the SDK's query() (injectable for tests).
   * state: State instance. projectsDir: where Claude Code keeps session logs.
   */
  constructor({ queryFn, state, projectsDir, cliPath = null, policy = null, modeFor = null, cover = null, settingsFor = null }) {
    super();
    this.queryFn = queryFn;
    // policy(run, toolName, input, opts) -> { auto, reason }: routine requests are allowed without asking.
    this.policy = policy;
    // modeFor(run) -> 'hands-off' | 'ask-all' | 'auto': the permission setting for the run's job.
    this.modeFor = modeFor;
    // cover(run, toolName, input) -> { reason } | null: an 'ask' hard line your go-ahead covers (auto mode).
    this.cover = cover;
    // settingsFor(run) -> Claude Code settings for the session (the SDK's `settings`), or null.
    this.settingsFor = settingsFor;
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
      // mode: the permission setting in force; permissionMode: the mode Claude Code reports.
      mode: run.mode ?? 'hands-off', permissionMode: run.permissionMode ?? null,
      autoUnavailable: run.autoUnavailable ?? null, autoBlocked: run.autoBlocked ?? 0,
      // Messages you steered into this reply, with where each one is (queued, delivered, acted-on, cancelled, unanswered).
      steers: (run.steers ?? []).map(viewSteer),
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
   * gateBrief: the brief a gate card's reply answers (its number), kept on the audit 'send' line.
   */
  async start({ featureDir, slug, title, cwd, sessionId = null, model = null, text, kind = 'message', newJob = false, additionalDirectories = [], gateBrief = null }) {
    // Asked before the busy check, so nothing is awaited between that check and the run being listed.
    let mode = null;
    if (this.modeFor) { try { mode = await this.modeFor({ featureDir, slug }); } catch { mode = null; } }
    if (this.activeRunFor({ featureDir, sessionId })) throw new Busy('This job’s Foreman is already working on a reply.');
    const run = {
      id: randomUUID(), featureDir, slug, title, cwd, sessionId, model, text, kind, newJob,
      status: 'starting', startedAt: new Date().toISOString(), endedAt: null,
      lastText: null, lastAction: null, resultText: null, costUsd: null, apiKeySource: null, error: null,
      denials: [], stderr: [], pending: new Map(), abort: new AbortController(), query: null, stopRequested: false,
      additionalDirectories, backgroundTasks: [], hasResult: false, closeInput: null, idleTimer: null,
      mode: 'hands-off', permissionMode: null, autoUnavailable: null, autoBlocked: 0,
      // Tool calls seen in the session (id -> { name, input }) and the denials already accounted for,
      // so a block is recorded once and denials you or a hard line made aren't put on auto mode.
      toolUses: new Map(), blockedIds: new Set(), deniedIds: new Set(),
      // Where this reply's pushes really go (a remote with another name can be the org repo).
      orgPushCheck: orgPushCheck(),
      // Steer: every message steered into this reply, and those not yet handed to Claude Code.
      steers: [], inbox: [], inputClosed: false, wake: null,
    };
    if (mode) run.mode = mode;
    this.runs.set(run.id, run);
    await this.state.audit({ action: 'send', featureDir, slug, sessionId, kind, text, runId: run.id, model, ...(Number.isInteger(gateBrief) && gateBrief > 0 ? { gateBrief } : {}) });
    this.#launch(run).catch(() => {});
    this.emit('run', this.view(run));
    return this.view(run);
  }

  async #launch(run) {
    // The input stays open until the reply is complete, so Stop can interrupt and Steer can add to it.
    const closeInput = () => {
      if (run.inputClosed) return;
      run.inputClosed = true;
      this.#cancelQueued(run, run.inbox.splice(0));
      run.wake?.();
    };
    run.closeInput = closeInput;
    const message = run.text;
    const deliver = (s) => this.#delivered(run, s);
    async function* input() {
      // A uuid on the first message too, so the replies' stamps show whether Claude Code stamps at all.
      yield { type: 'user', message: { role: 'user', content: message }, parent_tool_use_id: null, uuid: randomUUID() };
      for (;;) {
        while (!run.inputClosed && run.inbox.length === 0) await new Promise((r) => { run.wake = r; });
        run.wake = null;
        if (run.inputClosed) return;
        const s = run.inbox.shift();
        deliver(s); // Claude Code asked for the next message (the SDK reads its input all through the reply)
        // The uuid lets Stop cancel it in Claude Code's queue if it hasn't been read yet.
        yield { type: 'user', message: { role: 'user', content: s.text }, parent_tool_use_id: null, uuid: s.id };
      }
    }
    run.requestedMode = sdkModeFor(run.mode);
    const options = {
      cwd: run.cwd,
      // 'default' (every risky action reaches canUseTool) or, when you chose it, 'auto' (Claude
      // Code's safety model). Never acceptEdits, dontAsk or bypassPermissions.
      permissionMode: run.requestedMode,
      canUseTool: (toolName, input, opts) => this.#ask(run, toolName, input, opts),
      // The hard lines, in every mode, before Claude Code's own permission check (lib/hard-lines.js).
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [hardLineHook((verdict, input) => this.#onHardLine(run, verdict, input), { check: run.orgPushCheck, cwd: run.cwd, cover: this.cover ? (tool, input) => this.cover(run, tool, input) : null })] }] },
      abortController: run.abort,
      stderr: (data) => { run.stderr.push(String(data)); if (run.stderr.length > 60) run.stderr.shift(); },
      additionalDirectories: run.additionalDirectories,
    };
    if (this.settingsFor) {
      try { const settings = await this.settingsFor(run); if (settings) options.settings = settings; } catch { /* the session starts without them */ }
    }
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
      // Handed over but never answered: the reply is over, so it won't be now.
      for (const s of run.steers) if (s.state === 'delivered') this.#steerState(run, s, 'unanswered');
      this.#dropPending(run, { behavior: 'deny', message: 'The reply ended before this was decided.' }, 'run-ended');
      run.endedAt = new Date().toISOString();
      const reply = (run.lastText ?? run.resultText ?? '').slice(0, 8000) || undefined;
      await this.state.audit({ action: 'run-ended', featureDir: run.featureDir, slug: run.slug, sessionId: run.sessionId, runId: run.id, status: run.status, costUsd: run.costUsd, error: run.error, reply, stopReason: run.stopReason ?? undefined });
      this.emit('run', this.view(run));
    }
  }

  async #onMessage(run, msg) {
    if (msg.type === 'assistant') {
      // Remember tool calls (crew members' too), so a blocked one can be named by its id.
      for (const b of msg.message?.content ?? []) {
        if (b?.type !== 'tool_use' || !b.id) continue;
        run.toolUses.set(b.id, { name: b.name, input: b.input });
        if (run.toolUses.size > 300) run.toolUses.delete(run.toolUses.keys().next().value);
      }
    }
    if (msg.type === 'system' && msg.subtype === 'init') {
      run.sessionId = msg.session_id ?? run.sessionId;
      run.model = msg.model ?? run.model;
      run.apiKeySource = msg.apiKeySource ?? null;
      await this.state.setSession(run.featureDir, { sessionId: run.sessionId, cwd: run.cwd, model: run.model, lastRunAt: run.startedAt, ...(run.newJob ? { startedFromWorkshop: true, title: run.title } : {}) });
      await this.#modeReported(run, msg.permissionMode);
      this.emit('run', this.view(run));
    } else if (msg.type === 'system' && msg.subtype === 'status' && msg.permissionMode) {
      await this.#modeReported(run, msg.permissionMode);
      this.emit('run', this.view(run));
    } else if (msg.type === 'system' && msg.subtype === 'permission_denied') {
      // Refused without a card. Only auto mode's safety model counts here: deny rules from your own
      // settings and the like are Claude Code's business, and hard-line refusals are recorded by the hook.
      const byClassifier = msg.decision_reason_type === 'classifier' || (!msg.decision_reason_type && run.permissionMode === 'auto');
      if (byClassifier) await this.#recordBlocked(run, msg.tool_use_id, { tool: msg.tool_name, reason: msg.decision_reason ?? null, agentID: msg.agent_id });
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
      // A steered message is acted on when a reply message names it among those it answers. Once
      // Claude Code has stamped any message, only stamps count (unstamped frames of a turn are
      // normal); a Claude Code that never stamps: the first message after delivery.
      const stamped = Array.isArray(msg.user_message_uuids) ? msg.user_message_uuids : msg.user_message_uuid ? [msg.user_message_uuid] : null;
      if (stamped) run.stamps = true;
      for (const s of run.steers) {
        if (s.state === 'delivered' && (stamped ? stamped.includes(s.id) : !run.stamps)) this.#steerState(run, s, 'acted-on');
      }
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
      // The authoritative list of refusals: any made in auto mode that nobody else accounts for
      // (not you, not a hard line, not already reported) was the safety model's.
      if (run.permissionMode === 'auto') {
        for (const d of msg.permission_denials ?? []) {
          if (!d?.tool_use_id || run.deniedIds.has(d.tool_use_id)) continue;
          await this.#recordBlocked(run, d.tool_use_id, { tool: d.tool_name, input: d.tool_input, reason: null });
        }
      }
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

  // Claude Code said which permission mode it is in (init, or a status message after a switch).
  // Asked for auto mode and got something else: auto mode isn't available to this account (the
  // SDK falls back to 'default'), so the policy alone decides, as with "routine steps automatic".
  async #modeReported(run, mode) {
    if (!mode) return;
    run.permissionMode = mode;
    if (run.requestedMode !== 'auto') return;
    if (mode === 'auto') {
      run.autoUnavailable = false;
      this.emit('auto-mode', { available: true });
    } else if (!run.autoUnavailable) {
      run.autoUnavailable = true;
      const reason = 'Claude Code started in its normal mode instead of auto mode, so auto mode isn’t available for this account (or this Claude Code version).';
      this.emit('auto-mode', { available: false, reason });
      await this.state.audit({ action: 'auto-unavailable', featureDir: run.featureDir, slug: run.slug, sessionId: run.sessionId, runId: run.id, got: mode });
    }
  }

  // One action auto mode's safety model refused, recorded once (audit 'auto-blocked').
  async #recordBlocked(run, toolUseId, { tool, input = null, reason = null, agentID = null }) {
    if (toolUseId) {
      if (run.blockedIds.has(toolUseId) || run.deniedIds.has(toolUseId)) return;
      run.blockedIds.add(toolUseId);
    }
    const seen = toolUseId ? run.toolUses.get(toolUseId) : null;
    const name = tool ?? seen?.name ?? 'a tool';
    const plain = describePermission(name, input ?? seen?.input ?? {}, { cwd: run.cwd });
    run.autoBlocked = (run.autoBlocked ?? 0) + 1;
    await this.state.audit({
      action: 'auto-blocked', featureDir: run.featureDir, slug: run.slug, sessionId: run.sessionId, runId: run.id, tool: name,
      agentType: await this.#agentType(run, agentID), headline: plain.headline, preview: (plain.preview ?? '').slice(0, 300) || undefined,
      reason: reason ? String(reason).replace(/\u001b\[[0-9;]*m/g, '').slice(0, 500) : undefined, // may carry terminal colours
    });
    this.emit('run', this.view(run));
  }

  // The hard-line hook met one (lib/hard-lines.js). Refusals are recorded here, since Claude Code
  // never asks about them; 'ask' ones become an ordinary card through canUseTool.
  async #onHardLine(run, verdict, input) {
    if (verdict.decision !== 'deny') return;
    await this.#recordRefusal(run, input?.tool_name ?? 'Bash', input?.tool_input ?? {}, verdict, input?.tool_use_id, input?.agent_id);
  }

  async #recordRefusal(run, toolName, input, verdict, toolUseId, agentID) {
    if (toolUseId) {
      if (run.deniedIds.has(toolUseId)) return;
      run.deniedIds.add(toolUseId);
    }
    const plain = describePermission(toolName, input, { cwd: run.cwd });
    await this.state.audit({
      action: 'hard-line-refused', featureDir: run.featureDir, slug: run.slug, sessionId: run.sessionId, runId: run.id, tool: toolName,
      agentType: await this.#agentType(run, agentID), headline: plain.headline, preview: (plain.preview ?? '').slice(0, 300) || undefined,
      line: verdict.line, reason: verdict.reason,
    });
    this.emit('run', this.view(run));
  }

  /**
   * The permission setting changed (yours or a job's): re-read it for every reply in progress and
   * switch Claude Code's mode live where that changes ('default' <-> 'auto').
   */
  async applyModes() {
    if (!this.modeFor) return;
    for (const run of this.runs.values()) {
      if (!ACTIVE.has(run.status)) continue;
      let mode;
      try { mode = await this.modeFor(run); } catch { continue; }
      if (!mode || mode === run.mode) continue;
      const want = sdkModeFor(mode);
      const had = run.requestedMode;
      run.mode = mode;
      run.requestedMode = want;
      if (want !== had && run.query?.setPermissionMode) {
        try {
          await run.query.setPermissionMode(want);
          run.permissionMode = want; // a later status message corrects this if Claude Code fell back
        } catch (err) {
          run.requestedMode = had;
          if (want === 'auto') {
            run.autoUnavailable = true;
            this.emit('auto-mode', { available: false, reason: `Claude Code wouldn’t switch to auto mode: ${String(err?.message ?? err).split('\n')[0]}` });
          }
        }
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
    const result = await this.#askInner(run, toolName, input, opts);
    if (result?.behavior === 'deny' && opts.toolUseID) run.deniedIds.add(opts.toolUseID);
    return result;
  }

  async #askInner(run, toolName, input, opts) {
    // Hard lines first (the hook already did this; checked again in case it didn't run): a refusal
    // never asks, and an "ask" one is never settled by the routine list or a saved rule.
    let hard = toolName === 'AskUserQuestion' ? null : hardLine(toolName, input);
    if (hard) { try { hard = await run.orgPushCheck(hard, run.cwd); } catch { /* a failed lookup still asks */ } }
    if (hard?.decision === 'deny') {
      await this.#recordRefusal(run, toolName, input, hard, opts.toolUseID, opts.agentID);
      return { behavior: 'deny', message: hard.reason };
    }
    if (this.policy && toolName !== 'AskUserQuestion' && !hard) {
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
      decisionReason: opts.decisionReason ?? hard?.reason ?? null, blockedPath: opts.blockedPath ?? null,
      agentID: opts.agentID ?? null, agentType: await this.#agentType(run, opts.agentID),
      defaultToNo: Boolean(opts.defaultToNo),
      // A hard line (lib/hard-lines.js): it asks every time, so nothing is offered that would stop it asking.
      hardLine: hard ? { line: hard.line, reason: hard.reason } : null,
      // Auto mode's safety model couldn't decide this one, so it came to you.
      fromAutoMode: run.permissionMode === 'auto' && !hard && toolName !== 'AskUserQuestion',
      // "Allow for this reply" is offered only when Claude Code suggests a rule, and is kept in memory
      // for this run only (destination 'session'); nothing is written to settings files.
      canAllowForRun: !hard && !opts.suppressAlwaysAllowRule && Array.isArray(opts.suggestions) && opts.suggestions.length > 0,
      suggestions: (opts.suggestions ?? []).map((s) => ({ ...s, destination: 'session' })),
      // "Always allow…": saved rules never apply to questions, hard lines or steps Claude Code flagged as risky.
      draft: toolName === 'AskUserQuestion' || opts.defaultToNo || hard ? null : draftRule(toolName, input, opts.suggestions ?? []),
      plain: describePermission(toolName, input, { cwd: run.cwd, featureDir: run.featureDir, blockedPath: opts.blockedPath, defaultToNo: opts.defaultToNo, renderPreview: true }),
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

  /**
   * Steer: add a message to a reply in progress. Returns the steered message (state 'queued'), or
   * null when there is no such reply in progress. Throws Busy while the reply is stopping.
   */
  async steer(runId, text) {
    const run = this.runs.get(runId);
    if (!run || !ACTIVE.has(run.status) || run.inputClosed) return null;
    if (run.stopRequested) throw new Busy('This reply is stopping. Send your message once it has stopped.');
    const s = { id: randomUUID(), runId: run.id, slug: run.slug, text, state: 'queued', queuedAt: new Date().toISOString(), deliveredAt: null, actedAt: null };
    run.steers.push(s);
    if (run.steers.length > 50) run.steers.shift();
    run.inbox.push(s);
    this.emit('steer', viewSteer(s));
    // Hand it over first: waiting on the disk write would delay it, and the reply could go idle
    // (and cancel it) meanwhile.
    run.wake?.();
    // Shown in the job's conversation like any message you sent (lib/thread.js).
    await this.state.audit({ action: 'steer', featureDir: run.featureDir, slug: run.slug, sessionId: run.sessionId, runId: run.id, steerId: s.id, text });
    return viewSteer(s);
  }

  #steerState(run, s, state) {
    s.state = state;
    if (state === 'delivered') s.deliveredAt = new Date().toISOString();
    if (state === 'acted-on') s.actedAt = new Date().toISOString();
    this.emit('steer', viewSteer(s));
  }

  // Handed to Claude Code: the reply now goes on until the Foreman has answered it too, even if
  // its result for the earlier message already came in.
  #delivered(run, s) {
    run.hasResult = false;
    run.awaitingIdle = false;
    clearTimeout(run.idleTimer);
    this.#steerState(run, s, 'delivered');
  }

  #cancelQueued(run, list) {
    for (const s of list) if (s.state === 'queued' || s.state === 'delivered') this.#steerState(run, s, 'cancelled');
  }

  /** reason: null (you clicked Stop) or 'usage-limit' (paused until the limit resets). */
  async stop(runId, { reason = null } = {}) {
    const run = this.runs.get(runId);
    if (!run || !ACTIVE.has(run.status)) return false;
    run.stopRequested = true;
    run.stopReason = reason;
    run.status = 'stopping';
    // Steered messages not yet handed over never will be.
    this.#cancelQueued(run, run.inbox.splice(0));
    this.emit('run', this.view(run));
    await this.state.audit({ action: 'stop-now', featureDir: run.featureDir, slug: run.slug, sessionId: run.sessionId, runId, reason: reason ?? undefined });
    const why = reason === 'usage-limit' ? 'Paused: the Claude usage limit was reached. The job carries on after it resets.' : 'The person stopped this reply.';
    this.#dropPending(run, { behavior: 'deny', message: why, interrupt: true }, reason === 'usage-limit' ? 'usage-limit' : 'stopped');
    try {
      // cancelQueued: steered messages Claude Code holds but hasn't read yet are dropped too, so
      // they can't start a new turn after the stop (older Claude Code versions ignore it).
      const receipt = await run.query?.interrupt?.({ cancelQueued: true });
      const cancelled = new Set(Array.isArray(receipt?.cancelled) ? receipt.cancelled : []);
      this.#cancelQueued(run, run.steers.filter((s) => cancelled.has(s.id)));
    } catch {
      run.abort.abort();
    }
    // If the interrupt doesn't end it promptly, cut it off.
    setTimeout(() => { if (ACTIVE.has(run.status)) run.abort.abort(); }, 15000).unref?.();
    return true;
  }
}
