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
//
// Job lock (lib/lock.js, plan D12): a reply takes the job's lock.json as it starts and gives it back
// when it ends (done, stopped, error or limited), so a terminal /feature session and the dashboard
// never drive one job at once. A lock another running process holds refuses the start (JobLocked,
// a 409 with code 'job-locked' that the page shows as the lock card). No job folder: nothing to lock.
//
// status.json check (plan D11, lib/status-json.js validate): while a reply runs, the driver watches
// the job folder's status.json and checks every write the Foreman makes (and once more as the reply
// ends). A write that fails is an audit line 'status_invalid' with the errors, and the same session
// gets one message: "status.json is invalid: <errors>. Rewrite the whole file …". The message joins
// the reply's live input like a steered one (not shown as yours); when the reply has already ended,
// it resumes the session with it (kind 'status-fix'). Each invalid write in a row counts one try;
// after STATUS_RETRIES messages, the next invalid write parks a Needs you card instead ("The Foreman
// cannot write a valid status.json", with the errors): Ask it to try again (three more tries) or
// Leave it (nothing more is sent until a valid write). A valid write resets the count and takes
// the card away. A job started from a ticket (options.json names one) must write version 2 with
// that key. A file nobody wrote during the reply is never checked.
//
// PR feedback (packet N, lib/pr-feedback.js): the runner parks one Needs you card per failed check
// or review comment on a job's pull request (parkFeedbackCard), a question card kept apart from any
// reply like the status.json card: "A check failed on PR #1: lint. … Send it to the Foreman?",
// answered "Send it to the Foreman" or "Leave it". Send resumes the job's own session (the runner's
// feedbackSession says which) with feedbackMessage(), kind 'pr-feedback'. While the Foreman is
// working the message waits and goes when the reply ends (after a pause or a usage limit the card
// comes back instead). When another process holds the job's lock, nothing is sent: the card stays,
// says so, and the answer is refused with JobLocked. Each outcome is a 'pr-feedback' event
// ({ outcome: 'sent' | 'queued' | 'left' | 'waiting', featureDir, slug, item, … }); the runner
// writes the audit lines and pr-feedback.json.

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describePermission } from './permissions.js';
import { draftRule } from './rules.js';
import { describeTool } from './session-log.js';
import { hardLine, hardLineHook, orgPushCheck } from './hard-lines.js';
import * as jobLock from './lock.js';
import { validate as validateStatus } from './status-json.js';
import { readOptions } from './options.js';
import { HttpError } from './http-guard.js';
import { scrubDeep } from './orbit.js';
import { FEEDBACK_LEAVE, FEEDBACK_SEND, cardWords, feedbackMessage } from './pr-feedback.js';

/** How many corrective messages one run of invalid status.json writes gets before the card. */
export const STATUS_RETRIES = 3;
/** The card's two answers (the question card also offers "Something else": your own words). */
export const STATUS_TRY_AGAIN = 'Ask it to try again';
export const STATUS_LEAVE = 'Leave it';
export const STATUS_CARD_HEADLINE = 'The Foreman cannot write a valid status.json';
// At most this many errors go into one message or card; the audit line has them all (up to validate's cut).
const STATUS_ERRORS_SHOWN = 10;

/** The message the Foreman gets for an invalid status.json. */
export function statusFixMessage(errors) {
  const list = (errors ?? []).slice(0, STATUS_ERRORS_SHOWN);
  const more = (errors?.length ?? 0) - list.length;
  return `status.json is invalid: ${list.join('; ')}${more > 0 ? `; and ${more} more` : ''}. Rewrite the whole file to match ~/.claude/skills/feature/status-json.md and write it again.`;
}

/** Calls onChange whenever the folder's status.json may have been written. Returns a function that stops watching. */
export function watchStatusFile(dir, onChange) {
  const w = fsSync.watch(dir, { persistent: false }, (_type, name) => { if (!name || String(name) === 'status.json') onChange(); });
  w.on('error', () => {});
  return () => w.close();
}

/** The ticket a job was started from (options.json `ticket.key`), else null. */
async function ticketKeyOf(featureDir) {
  const o = await readOptions(featureDir);
  return typeof o?.ticket?.key === 'string' ? o.ticket.key : null;
}

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
  constructor({ queryFn, state, projectsDir, cliPath = null, policy = null, modeFor = null, cover = null, settingsFor = null, envFor = null, locks = jobLock, statusWatch = watchStatusFile, statusRetries = STATUS_RETRIES, ticketKeyFor = ticketKeyOf, feedbackSession = null }) {
    super();
    // PR feedback cards (see the top): id -> card, and the messages waiting for a reply to end, by job folder.
    // feedbackSession(featureDir) -> { sessionId, slug, title, cwd, model, additionalDirectories }
    // to resume, or { refused: 'plain words' }; null: the job's saved session (state.sessionFor).
    this.feedbackCards = new Map();
    this.feedbackQueue = new Map();
    this.feedbackSession = feedbackSession;
    // The status.json check (see the top): statusWatch(dir, onChange) -> stop(), injectable for
    // tests (null: no check); ticketKeyFor(featureDir) -> the job's ORBIT-<n> or null.
    this.statusWatch = statusWatch;
    this.statusRetries = statusRetries;
    this.ticketKeyFor = ticketKeyFor;
    // Per job folder: { seen, tries, errors, cardId, silenced, session }. The cards waiting: id -> card.
    this.statusChecks = new Map();
    this.statusCards = new Map();
    // locks: lib/lock.js (acquire, release, branchOf), injectable for tests.
    this.locks = locks;
    this.queryFn = queryFn;
    // policy(run, toolName, input, opts) -> { auto, reason }: routine requests are allowed without asking.
    this.policy = policy;
    // modeFor(run) -> 'hands-off' | 'ask-all' | 'auto': the permission setting for the run's job.
    this.modeFor = modeFor;
    // cover(run, toolName, input) -> { reason } | null: an 'ask' hard line your go-ahead covers (auto mode).
    this.cover = cover;
    // settingsFor(run) -> Claude Code settings for the session (the SDK's `settings`), or null.
    this.settingsFor = settingsFor;
    // The session's environment: envFor(run) -> the whole env for query() (null: Claude Code's default).
    this.envFor = envFor;
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
    return [
      ...[...this.runs.values()].flatMap((r) => [...r.pending.values()].map((p) => this.viewPermission(p))),
      ...[...this.statusCards.values()].map((c) => this.viewPermission(c)),
      ...[...this.feedbackCards.values()].map((c) => this.viewPermission(c)),
    ];
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
    const card = this.statusCards.get(requestId) ?? this.feedbackCards.get(requestId);
    if (card) return { ...this.viewPermission(card), input: card.input };
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
    // The job lock, taken synchronously right after the busy check (a disk error doesn't stop the reply).
    let lock = null;
    if (this.locks && featureDir) {
      let got = null;
      try { got = this.locks.acquire(featureDir, { owner: 'runner', branch: this.locks.branchOf?.(cwd) ?? null }); } catch { got = null; }
      if (got?.held) throw new jobLock.JobLocked(got.by);
      lock = got?.lock ?? null;
    }
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
      lock,
    };
    if (mode) run.mode = mode;
    this.runs.set(run.id, run);
    try {
      await this.state.audit({ action: 'send', featureDir, slug, sessionId, kind, text, runId: run.id, model, ...(Number.isInteger(gateBrief) && gateBrief > 0 ? { gateBrief } : {}) });
    } catch (err) {
      this.#releaseLock(run);
      throw err;
    }
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
    if (run.sessionId) options.resume = run.sessionId;
    if (run.model) options.model = run.model;
    if (this.cliPath) options.pathToClaudeCodeExecutable = this.cliPath;

    try {
      await this.#watchStatus(run);
      if (this.settingsFor) {
        try { const settings = await this.settingsFor(run); if (settings) options.settings = settings; } catch { /* the session starts without them */ }
        // Stopped while the settings were read: there is no session to interrupt, so don't start one.
        if (run.stopRequested) throw new Error('Stopped before it started.');
      }
      // The session's environment (the runner adds the Orbit token as ORBIT_FEEDBACK_TOKEN, so the
      // MCP entry's ${ORBIT_FEEDBACK_TOKEN} has a value; the token is never an argument or in the prompt).
      if (this.envFor) {
        try { const env = await this.envFor(run); if (env) options.env = env; } catch { /* the session starts with the default environment */ }
      }
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
      // The last write of the reply is checked too (a message for it is sent once the reply has ended).
      try { await this.#endStatusWatch(run); } catch { /* never stops the reply from ending */ }
      run.endedAt = new Date().toISOString();
      this.#releaseLock(run);
      const reply = (run.lastText ?? run.resultText ?? '').slice(0, 8000) || undefined;
      await this.state.audit({ action: 'run-ended', featureDir: run.featureDir, slug: run.slug, sessionId: run.sessionId, runId: run.id, status: run.status, costUsd: run.costUsd, error: run.error, reply, stopReason: run.stopReason ?? undefined });
      this.emit('run', this.view(run));
      // A corrective message the reply ended before reading: the same session, resumed with it.
      // Not after Stop, an error or a usage limit: the errors stay in the audit log.
      const followUp = run.statusFollowUp;
      run.statusFollowUp = null;
      if (followUp && run.status === 'done') this.#sendStatusFix(run.featureDir, followUp).catch(() => {});
      // PR feedback you sent while this reply ran goes now.
      this.#flushFeedback(run).catch(() => {});
    }
  }

  // ---------- The status.json check (see the top of the file) ----------

  #statusRecord(featureDir) {
    let rec = this.statusChecks.get(featureDir);
    if (!rec) { rec = { seen: undefined, tries: 0, errors: [], cardId: null, silenced: false, session: null }; this.statusChecks.set(featureDir, rec); }
    return rec;
  }

  // The file as it is now, named by its modification time and content: one write fires the watcher
  // several times but is checked once, and the same text written again counts as a new write.
  async #statusNow(featureDir) {
    const file = path.join(featureDir, 'status.json');
    try {
      const stat = await fs.stat(file);
      const text = await fs.readFile(file, 'utf8');
      return { text, seen: `${stat.mtimeMs}:${text}` };
    } catch { return null; }
  }

  async #watchStatus(run) {
    if (!run.featureDir || !this.statusWatch) return;
    const rec = this.#statusRecord(run.featureDir);
    rec.session = { slug: run.slug, title: run.title, cwd: run.cwd, model: run.model, additionalDirectories: run.additionalDirectories, sessionId: run.sessionId };
    // What is there before the reply starts was not written by it: never checked.
    rec.seen = (await this.#statusNow(run.featureDir))?.seen ?? null;
    const fire = () => {
      clearTimeout(run.statusTimer);
      run.statusTimer = setTimeout(() => { run.statusTimer = null; this.#queueStatusCheck(run); }, this.statusDebounceMs ?? 200);
    };
    try { run.unwatchStatus = this.statusWatch(run.featureDir, fire); } catch { run.unwatchStatus = null; }
  }

  // Checks run one at a time per reply, in the order the writes came.
  #queueStatusCheck(run) {
    run.statusCheck = (run.statusCheck ?? Promise.resolve()).then(() => this.#checkStatus(run)).catch(() => {});
    return run.statusCheck;
  }

  async #endStatusWatch(run) {
    if (!this.statusWatch || !run.featureDir) return;
    try { run.unwatchStatus?.(); } catch { /* already closed */ }
    run.unwatchStatus = null;
    clearTimeout(run.statusTimer);
    run.statusTimer = null;
    await this.#queueStatusCheck(run);
  }

  async #checkStatus(run) {
    const now = await this.#statusNow(run.featureDir);
    const rec = this.#statusRecord(run.featureDir);
    if (!now || now.seen === rec.seen) return;
    rec.seen = now.seen;
    if (run.sessionId) rec.session = { ...rec.session, sessionId: run.sessionId, model: run.model ?? rec.session?.model ?? null };
    let ticketKey = null;
    try { ticketKey = await this.ticketKeyFor(run.featureDir); } catch { ticketKey = null; }
    const v = validateStatus(now.text, { ticketKey });
    const where = { featureDir: run.featureDir, slug: run.slug, sessionId: run.sessionId, runId: run.id };
    if (v.ok) {
      const card = rec.cardId ? this.statusCards.get(rec.cardId) : null;
      if (rec.tries || card || rec.silenced) await this.state.audit({ action: 'status_valid', ...where, after: rec.tries });
      rec.tries = 0;
      rec.errors = [];
      rec.silenced = false;
      if (card) this.#dropStatusCard(card, 'resolved');
      return;
    }
    rec.errors = v.errors;
    // You said to leave it, or the card is already waiting: recorded, nothing sent.
    if (rec.silenced || (rec.cardId && this.statusCards.has(rec.cardId))) {
      await this.state.audit({ action: 'status_invalid', ...where, errors: v.errors, attempt: rec.tries, sent: false, reason: rec.silenced ? 'left' : 'card-waiting' });
      return;
    }
    rec.tries += 1;
    if (rec.tries <= this.statusRetries) {
      await this.state.audit({ action: 'status_invalid', ...where, errors: v.errors, attempt: rec.tries, of: this.statusRetries, sent: true });
      this.#queueStatusFix(run, statusFixMessage(v.errors));
    } else {
      await this.state.audit({ action: 'status_invalid', ...where, errors: v.errors, attempt: rec.tries, of: this.statusRetries, sent: false, card: true });
      this.#parkStatusCard(run, rec, v.errors);
    }
  }

  // Into this reply's live input when it is still reading; else sent once it has ended.
  #queueStatusFix(run, text) {
    if (ACTIVE.has(run.status) && !run.inputClosed && !run.stopRequested) {
      run.inbox.push({ id: randomUUID(), text, auto: true });
      run.wake?.();
    } else {
      run.statusFollowUp = text;
    }
  }

  // A corrective message for a job with no reply reading its input: the reply in progress, if one
  // is still reading; else its session, resumed (the last reply's session, model and folders).
  async #sendStatusFix(featureDir, text) {
    const active = this.activeRunFor({ featureDir });
    if (active && !active.inputClosed && !active.stopRequested) { this.#queueStatusFix(active, text); return; }
    if (active) { active.statusFollowUp = text; return; }
    const s = this.#statusRecord(featureDir).session;
    if (!s?.sessionId) return;
    try {
      await this.start({ featureDir, slug: s.slug, title: s.title, cwd: s.cwd, sessionId: s.sessionId, model: s.model, text, kind: 'status-fix', additionalDirectories: s.additionalDirectories ?? [] });
    } catch (err) {
      await this.state.audit({ action: 'status_fix_not_sent', featureDir, slug: s.slug, sessionId: s.sessionId, reason: String(err?.message ?? err).slice(0, 300) });
    }
  }

  // The Needs you card: a question card (the page shows it like the Foreman's own questions), kept
  // outside the reply, so it stays after the reply ends.
  #parkStatusCard(run, rec, errors) {
    const list = errors.slice(0, STATUS_ERRORS_SHOWN);
    const more = errors.length - list.length;
    const question = `${STATUS_CARD_HEADLINE}. It was told what is wrong ${this.statusRetries} times and it is still wrong: ${list.join('; ')}${more > 0 ? `; and ${more} more` : ''}. Meanwhile the job page shows what it can read. What now?`;
    const input = { questions: [{
      question, header: 'status.json', multiSelect: false,
      options: [
        { label: STATUS_TRY_AGAIN, description: `Sends the errors to the Foreman once more, with ${this.statusRetries} more tries.` },
        { label: STATUS_LEAVE, description: 'Nothing more is sent about it. A valid status.json later clears this.' },
      ],
    }] };
    const card = {
      id: randomUUID(), runId: run.id, slug: run.slug, featureDir: run.featureDir, title: run.title,
      toolName: 'AskUserQuestion', kind: 'question', input, statusCard: true, errors: [...errors],
      prompt: null, displayName: null, description: null, decisionReason: null, blockedPath: null,
      agentID: null, agentType: null, defaultToNo: false, hardLine: null, fromAutoMode: false,
      canAllowForRun: false, suggestions: [], draft: null,
      plain: { headline: STATUS_CARD_HEADLINE, detail: null, preview: errors.join('\n'), risk: 'low' },
      createdAt: new Date().toISOString(),
    };
    rec.cardId = card.id;
    this.statusCards.set(card.id, card);
    this.emit('permission', this.viewPermission(card));
    this.emit('run', this.view(run));
  }

  #dropStatusCard(card, reason) {
    this.statusCards.delete(card.id);
    const rec = this.statusChecks.get(card.featureDir);
    if (rec?.cardId === card.id) rec.cardId = null;
    this.emit('permission-gone', { id: card.id, slug: card.slug, reason });
  }

  // Your answer on the card. Try again (or your own words): the count starts over and the errors
  // go to the Foreman. Leave it, or Don't answer: nothing more is sent until a valid write.
  async #answerStatusCard(card, { decision, note, answers }) {
    this.#dropStatusCard(card, 'answered');
    const rec = this.#statusRecord(card.featureDir);
    const answer = decision === 'deny' ? null : String(Object.values(answers ?? {})[0] ?? '').trim() || null;
    await this.state.audit({ action: 'status_invalid_answer', featureDir: card.featureDir, slug: card.slug, decision, answer: answer ?? undefined, note: note || undefined });
    if (!answer || answer === STATUS_LEAVE) { rec.silenced = true; return; }
    rec.tries = 0;
    rec.silenced = false;
    const fix = statusFixMessage(rec.errors.length ? rec.errors : card.errors);
    await this.#sendStatusFix(card.featureDir, answer === STATUS_TRY_AGAIN ? fix : `${answer}\n\n${fix}`);
  }

  // ---------- PR feedback cards (see the top of the file) ----------

  /** The waiting feedback card for this job and item key, or null. */
  feedbackCardFor(featureDir, key) {
    for (const c of this.feedbackCards.values()) if (c.featureDir === featureDir && c.item.key === key) return c;
    return null;
  }

  /**
   * Park one Needs you card for a failed check or a review comment (lib/pr-feedback.js findNew).
   * job: { featureDir, slug, title }. item: findNew's item, with the check's `log` read. One card
   * per job and item: parking it again returns the card already there. Returns what a page sees.
   */
  parkFeedbackCard(job, item, { notSent = null } = {}) {
    const had = this.feedbackCardFor(job.featureDir, item.key);
    if (had) return this.viewPermission(had);
    const clean = scrubDeep(item);
    const words = cardWords(clean);
    const card = {
      id: randomUUID(), runId: null, slug: job.slug, featureDir: job.featureDir, title: job.title ?? null,
      toolName: 'AskUserQuestion', kind: 'question', input: null, feedbackCard: true, item: clean, notSent: null,
      prompt: null, displayName: null, description: null, decisionReason: null, blockedPath: null,
      agentID: null, agentType: null, defaultToNo: false, hardLine: null, fromAutoMode: false,
      canAllowForRun: false, suggestions: [], draft: null,
      plain: { headline: words.headline, detail: null, preview: clean.kind === 'check' ? (clean.log ?? '') : (clean.body ?? ''), risk: 'low' },
      createdAt: new Date().toISOString(),
    };
    this.#feedbackWords(card, notSent);
    this.feedbackCards.set(card.id, card);
    this.emit('permission', this.viewPermission(card));
    return this.viewPermission(card);
  }

  // The card's question, with why it wasn't sent yet when it came back (the lock, a pause).
  #feedbackWords(card, notSent) {
    const words = cardWords(card.item);
    card.notSent = notSent ?? null;
    const what = card.item.kind === 'check' ? 'the failure' : 'the comment';
    card.input = { questions: [{
      question: `${words.headline} ${words.quote}${notSent ? ` Not sent yet: ${notSent}` : ''} Send it to the Foreman?`,
      header: card.item.pr?.label ?? 'Pull request', multiSelect: false,
      options: [
        { label: FEEDBACK_SEND, description: `Carries on this job’s Foreman session with ${what} quoted. It works on this branch and doesn’t push or write to GitHub.` },
        { label: FEEDBACK_LEAVE, description: `Nothing is sent, and you won’t be asked about this ${card.item.kind === 'check' ? 'failure on this commit' : 'comment'} again.` },
      ],
    }] };
  }

  /** Take a feedback card away without an answer (reason: 'resolved', 'closed', …). */
  dropFeedbackCard(id, reason = 'resolved') {
    const card = this.feedbackCards.get(id);
    if (!card) return false;
    this.feedbackCards.delete(id);
    this.emit('permission-gone', { id, slug: card.slug, reason });
    return true;
  }

  // Your answer. Leave it, or Don't answer: nothing is sent. Send (or your own words, put first):
  // the message goes to the job's session now, or once the reply in progress ends.
  async #answerFeedbackCard(card, { decision, note, answers }) {
    const answer = decision === 'deny' ? null : String(Object.values(answers ?? {})[0] ?? '').trim() || null;
    const where = { featureDir: card.featureDir, slug: card.slug, item: card.item };
    if (!answer || answer === FEEDBACK_LEAVE) {
      this.dropFeedbackCard(card.id, 'answered');
      this.emit('pr-feedback', { outcome: 'left', ...where, note: note || null });
      return;
    }
    const text = feedbackMessage(card.item, { extra: answer === FEEDBACK_SEND ? null : answer });
    // Two answers at once (two tabs): only the first is acted on.
    if (card.answering) throw new HttpError(409, 'This card is being answered already.');
    card.answering = true;
    try { await this.#sendFeedback(card, text, { asked: true }); } finally { card.answering = false; }
  }

  // asked: you pressed Send just now (a refusal is thrown back to the page, and the card stays);
  // otherwise it is a message that waited for a reply to end (a refusal parks the card again).
  async #sendFeedback(card, text, { asked = false } = {}) {
    const where = { featureDir: card.featureDir, slug: card.slug, item: card.item };
    const queue = () => {
      const list = this.feedbackQueue.get(card.featureDir) ?? [];
      const again = list.some((q) => q.card.item.key === card.item.key);
      if (!again) list.push({ card, text });
      this.feedbackQueue.set(card.featureDir, list);
      this.dropFeedbackCard(card.id, 'answered');
      if (!card.queued) { card.queued = true; this.emit('pr-feedback', { outcome: 'queued', ...where }); }
    };
    const refuse = (words, err = null) => {
      if (this.feedbackCards.has(card.id)) {
        this.#feedbackWords(card, words);
        this.emit('permission', this.viewPermission(card));
      } else {
        card.queued = false;
        this.parkFeedbackCard({ featureDir: card.featureDir, slug: card.slug, title: card.title }, card.item, { notSent: words });
        this.emit('pr-feedback', { outcome: 'waiting', ...where, reason: words });
      }
      if (asked) throw err ?? new HttpError(409, `${words} Nothing was sent; the card stays.`, { code: 'pr-feedback-not-sent' });
    };
    if (this.activeRunFor({ featureDir: card.featureDir })) { queue(); return; }
    let s = null;
    try {
      s = this.feedbackSession ? await this.feedbackSession(card.featureDir) : await this.state.sessionFor?.(card.featureDir);
    } catch { s = null; }
    if (s?.refused) { refuse(s.refused); return; }
    if (!s?.sessionId) { refuse('This job has no Foreman session here to carry on. Send the Foreman a message first.'); return; }
    let run;
    try {
      run = await this.start({
        featureDir: card.featureDir, slug: s.slug ?? card.slug, title: s.title ?? card.title, cwd: s.cwd, sessionId: s.sessionId,
        model: s.model ?? null, text, kind: 'pr-feedback', additionalDirectories: s.additionalDirectories ?? [],
      });
    } catch (err) {
      if (err instanceof Busy) { queue(); return; }
      if (err instanceof jobLock.JobLocked) { refuse(`${jobLock.describeLock(err.lock)} Send it again once it is free there.`, err); return; }
      refuse(`It couldn’t be sent: ${String(err?.message ?? err).split('\n')[0].slice(0, 200)}`, err instanceof HttpError ? err : null);
      return;
    }
    this.dropFeedbackCard(card.id, 'answered');
    this.emit('pr-feedback', { outcome: 'sent', ...where, runId: run.id, sessionId: s.sessionId });
  }

  // A reply ended: the feedback that waited for it goes now, one message at a time (the next waits
  // for the reply the first starts). After a pause, an error or a usage limit the cards come back.
  async #flushFeedback(run) {
    const list = this.feedbackQueue.get(run.featureDir);
    if (!list?.length) return;
    this.feedbackQueue.delete(run.featureDir);
    const carryOn = run.status === 'done';
    for (const { card, text } of list) {
      if (carryOn) await this.#sendFeedback(card, text);
      else {
        card.queued = false;
        const why = run.status === 'limited' || run.stopReason === 'usage-limit' ? 'Claude’s usage limit paused the Foreman’s reply first.' : run.status === 'error' ? 'the Foreman’s reply ended with a problem first.' : 'the Foreman’s reply was paused first.';
        this.parkFeedbackCard({ featureDir: card.featureDir, slug: card.slug, title: card.title }, card.item, { notSent: why.charAt(0).toUpperCase() + why.slice(1) });
        this.emit('pr-feedback', { outcome: 'waiting', featureDir: card.featureDir, slug: card.slug, item: card.item, reason: why });
      }
    }
  }

  // Give the job's lock back (only ever our own: lib/lock.js checks the pid).
  #releaseLock(run) {
    if (!run.lock || !this.locks) return;
    try { this.locks.release(run.featureDir, { pid: run.lock.pid }); } catch { /* a dead pid's lock is taken over anyway */ }
    run.lock = null;
  }

  async #onMessage(run, msg) {
    // Telemetry (lib/usage-log.js): every message that carries usage or the turn's cost.
    if (msg.type === 'assistant' || msg.type === 'result') this.emit('usage', { runId: run.id, slug: run.slug, featureDir: run.featureDir, sessionId: run.sessionId, model: run.model, msg });
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

  // Allowed without a card (a routine step, a saved rule, or a hard line your go-ahead covers), and logged.
  async #autoAllow(run, toolName, input, opts, verdict) {
    const plain = describePermission(toolName, input, { cwd: run.cwd });
    run.autoAllowed = (run.autoAllowed ?? 0) + 1;
    await this.state.audit({ action: 'auto-allowed', featureDir: run.featureDir, slug: run.slug, sessionId: run.sessionId, runId: run.id, tool: toolName, agentType: await this.#agentType(run, opts.agentID), headline: plain.headline, preview: (plain.preview ?? '').slice(0, 300) || undefined, reason: verdict.reason, rule: verdict.rule ?? undefined });
    this.emit('run', this.view(run));
    return { behavior: 'allow', updatedInput: input };
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
    // Auto mode: a hard line your own go-ahead already covers (lib/hard-lines.js goAheadCovers).
    // Never a saved rule or the routine list: those don't apply to hard lines.
    if (hard && this.cover) {
      let covered = null;
      try { covered = await this.cover(run, toolName, input); } catch { covered = null; }
      if (covered) return this.#autoAllow(run, toolName, input, opts, { reason: covered.reason });
    }
    if (this.policy && toolName !== 'AskUserQuestion' && !hard) {
      let verdict = null;
      try { verdict = await this.policy(run, toolName, input, opts); } catch { verdict = null; }
      if (verdict?.auto) return this.#autoAllow(run, toolName, input, opts, verdict);
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
    const card = this.statusCards.get(requestId);
    if (card) { await this.#answerStatusCard(card, { decision, note, answers }); return true; }
    const feedback = this.feedbackCards.get(requestId);
    if (feedback) { await this.#answerFeedbackCard(feedback, { decision, note, answers }); return true; }
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
  // A status.json correction (auto) is not a steered message: no steer states, not shown as yours.
  #delivered(run, s) {
    run.hasResult = false;
    run.awaitingIdle = false;
    clearTimeout(run.idleTimer);
    if (s.auto) return;
    this.#steerState(run, s, 'delivered');
  }

  // A status.json correction never read goes out after the reply instead (unless it was stopped).
  #cancelQueued(run, list) {
    for (const s of list) {
      if (s.auto) run.statusFollowUp = s.text;
      else if (s.state === 'queued' || s.state === 'delivered') this.#steerState(run, s, 'cancelled');
    }
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
