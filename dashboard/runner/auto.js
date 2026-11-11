// Auto's pass (design Part 2): for each job whose record says Auto is on, answer the gate that waits,
// the way a click would (the same gateDecision path), or stop and tell the person why. The runner
// wires it (createRunner) and calls pass() from the change timer and when a reply ends, next to
// checkWaiting; this file asks nothing of the world but what it is given:
//
//   read()              the Auto jobs now (runner `autoJobs`): one object per job, see `handle`
//   update(dir, fn)     change the job's record under the Auto lock: fn(prev) returns the next record
//                       (or null for no change); resolves the record as saved. Keeps options.json in line.
//   decide.gate(kind, body, { by })   gateDecision
//   decide.permission(id, { decision, note, answers }, { by })   driver.decide: a card, answered for the person
//   pendingCard(id)     the card as it waits now, with its full input, or null once it is gone
//   cardCtx(card)       what fixedStop needs to know about the card's reply (the runner's autoCtxFor), or null
//   askApprover(task, { roots, job }) lib/approver.js askApprover with the runner's query and options
//   raiseLevel(job, level)            apply the Foreman's suggested level (setLevelAutomatically)
//   changed()           a record changed in a way other parts show (permission modes, the page)
//   freed()             a job stopped or finished: its Auto start place is free now (the runner's runAutoStart)
//   state               audit() and auditFor()
//   notify(n)           one notification { level, title, body, slug, key }
//   stopping(slug, on)  Auto is about to write (on) or has finished writing (off) a stop and its notice: the job is not told "waiting" meanwhile
//   now()               a Date, for tests
//
// Everything Auto writes is an audit line { action: 'auto', what, stage, asked, chose, why, ... } and
// nothing reaches the Foreman but through decide.gate with by: 'auto'.

import { autoAllowed, AUTO_CARDS_PER_REPLY, AUTO_MARK } from '../lib/auto.js';
import { AUTO_STOP_REASONS, autoVerdict, fixedStop } from '../lib/auto-rules.js';
import { APPROVER_BUDGET_USD, approverCut, approverPaths, approverRoots, checkAnswer } from '../lib/approver.js';
import { DECIDING_KINDS } from '../lib/gate.js';

/** Anything the Approver wrote, on one line: nothing it writes can start a line of its own, and no copy of the mark gets through. */
const oneLine = (s) => {
  const flat = (t) => t.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  // Taking a copy of the mark out can join the rest into a new copy (one inside another): until none is left.
  let t = flat(String(s ?? ''));
  for (let i = 0; i < 20 && t.includes(AUTO_MARK); i++) t = flat(t.split(AUTO_MARK).join(' '));
  return t.includes(AUTO_MARK) ? '' : t;
};
/** A refusal that is only "not now": the answer waits and the next pass sends it, with no failure counted. */
const NOT_NOW = new Set(['busy', 'limited', 'job-locked']);
/**
 * A refusal that says the answer is for something that has moved on: it is dropped. 'auto-gone': at the moment of sending,
 * Auto was off or stopped, or the job was being closed or restarted (the runner's last check, under the job's Auto lock).
 */
const MOVED_ON = new Set(['stale-brief', 'stale-gate', 'auto-gone']);
const codeOf = (err) => err?.extra?.code ?? err?.code ?? null;
const TIMED_OUT = /^It took longer/;
/**
 * Only a reply that decides a gate (approve, changes, stop: lib/gate.js) is the person's decision. A message, even one
 * from the gate card's own box, approves nothing; nor do Starbase's own sends (resume, nudge, a stack's message).
 */
const DECIDES = new Set(DECIDING_KINDS);
/**
 * Sends that are Starbase's own, not the person's words: a nudge, a resume (after a restart, or the carry-on after a usage
 * limit), a status fix, PR feedback, a review round, a stack's start and its own news (ready, merged, stuck, checks failed).
 * A stack's messages that carry the person's own note or go (stack-plan, -plan-change, -push, -push-no, -sendback) are theirs.
 */
const OWN_SENDS = new Set(['nudge', 'resume', 'resume-after-restart', 'status-fix', 'pr-feedback', 'review-round', 'stack-section', 'stack-ready', 'stack-merged', 'stack-stuck', 'stack-checks-failed']);
/** Auto's stop when the person wrote to a job while its step waited (I5). */
const YOURS_NOW = 'you wrote to this job while this step waited, so it is yours to decide.';
/** An Approver answer that would act (go, allow) but calls its own risk high is a stop, not an action. */
const HIGH_RISK = 'the Approver called this high risk, so it needs you.';
const tooRisky = (answer) => answer?.risk === 'high' && (answer.decision === 'go' || answer.decision === 'allow');
/** Auto's stop for a job nothing moves (I3): after ten minutes, or at once for a reply cut off by a crash or restart. */
const IDLE = 'nothing is running on this job and no step waits, so it needs you.';
const CUT_OFF = 'Starbase stopped while this job was working, so it needs you: press Resume.';
/** "Not now" this many times running on one gate stops Auto, like the Approver failing twice. */
const NOT_NOW_LIMIT = 3;
/** A gate Auto can't act on (stale, or no brief number) stops Auto after this long. */
const STUCK_MS = 10 * 60_000;
const isNotNow = (err) => {
  const code = err?.extra?.code ?? err?.code ?? null;
  return NOT_NOW.has(code) || err?.constructor?.name === 'Busy' || err?.name === 'Busy' || err?.name === 'JobLocked';
};

export function createAuto({ read, update, decide, askApprover, pendingCard = () => null, cardCtx = async () => null, raiseLevel = async () => {}, changed = () => {}, freed = () => {}, state, notify = () => {}, stopping = () => {}, now = () => new Date() }) {
  let running = null;
  let again = false;
  // An answer the Approver gave that could not be sent "not now" is kept for that job and brief and sent
  // on a later pass without asking (and paying) again; and how many "not now" in a row one gate has had.
  const held = new Map(); // dir -> { brief, task, answer }
  const refused = new Map(); // dir -> { brief, count }
  const stuckSince = new Map(); // dir -> when a gate Auto can't act on was first seen (ms)
  // The cards Auto has taken up (id -> true) until each is gone, and the order a job's cards are handled in.
  const cards = new Map();
  const queues = new Map(); // dir -> the promise of the last card queued

  /** One pass at a time; a request during one runs once after it. */
  function pass() {
    if (running) { again = true; return running; }
    running = run().catch((err) => console.error('auto pass:', err)).finally(() => {
      running = null;
      if (again) { again = false; pass(); }
    });
    return running;
  }

  // The checks that need no Approver (level, fixed stops, finished) run for every job first; only then
  // is the Approver asked, job by job, so a slow answer for one job never delays another job's stop.
  async function run() {
    const waiting = [];
    for (const job of await read()) {
      try { const gate = await triage(job); if (gate) waiting.push([job, gate]); } catch (err) { console.error(`auto (${job.slug}):`, err.message); }
    }
    for (const [job, gate] of waiting) {
      try { await attend(job, gate); } catch (err) {
        console.error(`auto (${job.slug}):`, err.message);
        // A throw while handling a gate counts as a failure, like the Approver failing: two running stop Auto.
        try { await failedOnGate(job, err); } catch (again) { console.error(`auto (${job.slug}):`, again.message); }
      }
    }
  }

  async function failedOnGate(job, err) {
    let count = 0;
    const problem = oneLine(err?.message).replace(/\.$/, '') || 'something went wrong while handling the step';
    await update(job.dir, (prev) => {
      if (prev?.on !== true || prev.stopped) return null;
      count = (prev.failures ?? 0) + 1;
      return { ...prev, failures: count, problem };
    });
    const hit = count ? fixedStop({ kind: 'job', failures: count, problem }) : null;
    if (hit) await stop(job, hit);
  }

  const audit = (job, what, fields) => state.audit({ action: 'auto', what, featureDir: job.dir, slug: job.slug, stage: job.stage ?? null, asked: '', chose: '', why: '', ...fields });

  /**
   * Auto stops and waits for you: the record says why, one audit line, one notification (none if it already had). Resolves true when it wrote the stop.
   * why: the Approver's own words when the reason is Starbase's (they go on the line; the reason is what the person is told).
   */
  async function stop(job, { rule, reason }, { leave = false, why = null, card = false } = {}) {
    stopping(job.slug, true);
    try { return await writeStop(job, { rule, reason }, { leave, why, card }); } finally { stopping(job.slug, false); }
  }
  // card: the stop was written on a card (stopOnCard); only then does the person's answer to a card clear it (N1).
  async function writeStop(job, { rule, reason }, { leave, why, card }) {
    const at = now().toISOString();
    let spent = 0;
    let wrote = false;
    await update(job.dir, (prev) => {
      // Auto was switched off, or already stopped: nothing to stop (leaving for L3 replaces a stop).
      if (prev?.on !== true || (!leave && prev.stopped)) return null;
      wrote = true;
      spent = prev.spent ?? 0;
      return { ...prev, ...(leave ? { on: false } : {}), stopped: { reason, rule, at, ...(card ? { card: true } : {}) } };
    });
    if (!wrote) return false;
    try {
      await audit(job, 'stop', { rule, reason, why: why || reason, ...(spent > 0 ? { costUsd: spent } : {}) });
      await paidOff(job, spent);
    } finally {
      // Once the record says stopped, the person is told, even when the line could not be written.
      // What the person should do, for every stop: the reason ends with its own full stop.
      const said = /[.!?]$/.test(reason) ? reason : `${reason}.`;
      notify({ level: 'needs', title: job.title, body: `Auto stopped: ${said} Open the job to answer.`, slug: job.slug, key: `auto-stop:${job.slug}:${at}` });
      if (leave) changed();
      freed(); // a stopped job frees its Auto start place: it can be filled now
    }
    return true;
  }

  /** PR #1 is open: Auto is off, `ran` stays, and the person is told once (not at all if Auto was already off). */
  async function finish(job) {
    const at = now().toISOString();
    let spent = 0;
    let wrote = false;
    await update(job.dir, (prev) => {
      if (prev?.on !== true) return null;
      wrote = true;
      spent = prev.spent ?? 0;
      return { ...prev, on: false, stopped: null, finished: at };
    });
    if (!wrote) return;
    await audit(job, 'finished', { why: 'PR #1 is open.', ...(spent > 0 ? { costUsd: spent } : {}) });
    await paidOff(job, spent);
    notify({ level: 'done', title: 'Auto finished: PR #1 is open.', body: `${job.title}. Review it and merge it yourself when you're ready.`, slug: job.slug, key: `auto-finish:${job.slug}` });
    changed();
    freed();
  }

  /** You decided something yourself after Auto stopped: it carries on from the next step. */
  async function carryOnIfYouDecided(job) {
    const stoppedAt = Date.parse(job.auto.stopped?.at ?? '');
    // All of the job's lines since the stop: a long reply after the person's decision must not push it out of view.
    const lines = await state.auditFor(job.dir, Infinity);
    // Only the person's decision clears a stop: a deciding gate reply (a send that carries its brief) clears any stop; their
    // answer to a card clears only a stop that was written on a card (N1: a yes or no to a tool call decides no step);
    // an answer on the status card clears a stop made by a status card, and no other.
    const statusStop = job.auto.stopped?.rule === 'status';
    const cardStop = job.auto.stopped?.card === true;
    // The cut-off stop asks for Resume: the person's Resume (a `resumed` line not via Starbase's own carry-on) clears it (N5).
    const cutOffStop = job.auto.stopped?.reason === CUT_OFF;
    const yours = lines.some((l) => l.by !== 'auto' && Date.parse(l.at) > stoppedAt
      && ((l.action === 'send' && DECIDES.has(l.kind) && l.gateBrief) || (cardStop && l.action === 'permission') || (statusStop && l.action === 'status_invalid_answer')
        || (cutOffStop && l.action === 'resumed' && l.via !== 'auto')));
    if (!yours) return false;
    const at = now().toISOString();
    await update(job.dir, (prev) => (prev?.stopped ? { ...prev, stopped: null, failures: 0, problem: null, step: null, cards: 0, since: at } : null));
    return true;
  }

  /** Everything about one job that needs no Approver. Returns the gate to ask about, or null. */
  async function triage(job) {
    // The ten minutes of a step Auto can't act on count only passes that found it so one after another: any pass that
    // returns before the check below (a reply running, a lock, a pause, a stop, a restart) forgets the time.
    const stuckFirst = stuckSince.get(job.dir);
    stuckSince.delete(job.dir);
    if (job.restarting) return null;
    if (job.prOpen) { await finish(job); return null; }
    // A job at L3 (or one the Foreman suggests is L3) leaves Auto, stopped or not, even in the middle of a reply.
    if (!autoAllowed({ level: job.level, suggestedLevel: job.suggestedLevel }).ok) {
      await stop(job, fixedStop({ kind: 'job', level: job.level, suggestedLevel: job.suggestedLevel }), { leave: true });
      return null;
    }
    if (job.auto.stopped) { await carryOnIfYouDecided(job); return null; }
    if (job.running || job.locked || job.paused) return null;
    // A reply cut off by a Starbase crash or restart waits for Resume, which only the person presses: no ten minutes for that.
    if (job.cutOff) { await stop(job, { rule: 'blocked', reason: CUT_OFF }); return null; }
    // A suggested L1 or L2 above the job's level is applied before the gate is answered (never lowered).
    const suggested = job.suggestedLevel;
    if ((suggested === 1 || suggested === 2) && !(job.level >= suggested)) {
      try { await raiseLevel(job, suggested); job.level = suggested; } catch (err) { console.error(`auto level (${job.slug}):`, err.message); return null; }
    }
    const gate = job.gate && !job.gate.stale && job.gate.briefNumber !== null && !job.answered.includes(job.gate.briefNumber) && job.gate.briefNumber !== job.auto.lastBrief ? job.gate : null;
    const hit = stopFor(job, job.auto, gate);
    if (hit) { await stop(job, hit); return null; }
    // This pass found no step Auto can act on, and nothing is running, locked or paused: the job waits for the person by its
    // own record (a gate card that is stale, has no brief number or was answered; or needsYou), or nothing moves it at all
    // (a reply that ended with the job still working). Nobody is told by the pass, so after a while Auto says so.
    if (!gate) {
      const first = stuckFirst ?? now().getTime();
      if (now().getTime() - first >= STUCK_MS) {
        const waits = Boolean(job.gate) || job.needsYou === true;
        await stop(job, { rule: 'blocked', reason: waits ? "the step that waits can't be approved as it stands, so it needs you." : IDLE });
        return null;
      }
      stuckSince.set(job.dir, first);
      return null;
    }
    const route = fixedStop({ kind: 'gate', stage: job.stage, nextStage: gate.nextStage });
    if (route) { await stop(job, route); return null; }
    return gate;
  }

  const stopFor = (job, rec, gate) => {
    const again = rec.step?.stage === job.stage ? rec.step.count : 0;
    return fixedStop({
      kind: 'job', level: job.level, suggestedLevel: job.suggestedLevel, triggers: job.triggers, stageState: job.stageState, statusCard: job.statusCard,
      step: gate ? { stage: job.stage, count: again + 1 } : null, failures: rec.failures ?? 0, problem: rec.problem ? String(rec.problem).replace(/\.$/, '') : null,
    });
  };

  /**
   * The job read again, for the answer the Approver gave about brief `n`: null when it no longer
   * stands (Auto is off, the record is stopped, no gate waits, the brief moved on or was answered).
   */
  async function look(job, n) {
    const [fresh] = await read(job.dir);
    if (!fresh || fresh.auto?.on !== true || fresh.auto.stopped || fresh.restarting) return null;
    const g = fresh.gate;
    if (!g || g.stale || g.briefNumber !== n) return null;
    if (fresh.answered.includes(n) || fresh.auto.lastBrief === n) return null;
    return fresh;
  }
  const notNow = (j) => Boolean(j.running || j.locked || j.paused);
  /**
   * Did the person say something to this job after the Approver was asked (a message of their own: a send that
   * is not Auto's, or, for a card, a message steered into the reply)? The Approver never saw it, so its answer is dropped.
   * All of the job's lines are read: the Foreman's reply to that message can write many while the Approver thinks.
   */
  async function youSpokeSince(job, askedAt, { steer = false } = {}) {
    const lines = await state.auditFor(job.dir, Infinity);
    return lines.some((l) => l.by !== 'auto' && (l.action === 'send' || (steer && l.action === 'steer')) && Date.parse(l.at) >= askedAt);
  }
  /**
   * Did the person send a message of their own (not Auto's, not one of Starbase's own sends; or steer one in) to this job after its
   * current brief was raised (the brief file's time) and after Auto was last switched on or carried on (`since`)?
   * All of the job's lines are read: the Foreman's reply to that message can write many.
   */
  async function youWroteWhileWaiting(job) {
    const times = [Date.parse(job.briefAt ?? ''), Date.parse(job.auto?.since ?? '')].filter(Number.isFinite);
    const from = times.length ? Math.max(...times) : -Infinity;
    const lines = await state.auditFor(job.dir, Infinity);
    // A message they steered into a running reply counts as one they sent (only their steer command writes that line).
    return lines.some((l) => l.by !== 'auto' && ((l.action === 'send' && !OWN_SENDS.has(l.kind)) || l.action === 'steer') && Date.parse(l.at) > from);
  }
  /**
   * An answer that was dropped cost money. While Auto is still on (stopped, or the card or gate has gone)
   * it goes to spent, for the next line. With Auto off nothing will ever write spent, so the money gets
   * its own line at once.
   */
  async function settleDropped(job, cost) {
    if (!(cost > 0)) return;
    const [now] = await read(job.dir);
    if (now?.auto?.on === true) { await addSpent(job, cost); return; }
    await audit(job, 'cost', { why: 'The Approver answered after Auto was switched off.', costUsd: cost });
  }
  /** Auto went off before its answer could go: money left on the record (added after its off line was written) gets a line of its own. */
  async function settleIfOff(job) {
    let owed = 0;
    await update(job.dir, (prev) => {
      if (prev && prev.on !== true && prev.spent > 0) owed = prev.spent;
      return null;
    });
    if (!(owed > 0)) return;
    await audit(job, 'cost', { why: 'The Approver answered after Auto was switched off.', costUsd: owed });
    await paidOff(job, owed);
  }
  /**
   * The money `amount` is on a line now: it comes off spent (never below 0). Called only once that line is written, so a
   * failed write leaves the money in spent for the next line; anything added meanwhile stays.
   */
  const paidOff = (job, amount) => (amount > 0
    ? update(job.dir, (prev) => (prev ? { ...prev, spent: Math.max(0, Math.round(((prev.spent ?? 0) - amount) * 1e9) / 1e9) } : null))
    : null);
  const addSpent = (job, cost) => (cost > 0 ? update(job.dir, (prev) => (prev ? { ...prev, spent: (prev.spent ?? 0) + cost } : null)) : null);

  async function attend(first, firstGate) {
    const n = firstGate.briefNumber;
    for (let tries = 0; tries < 3; tries++) {
      // Everything is read again at each turn: the Approver can take minutes.
      const job = await look(first, n);
      if (!job) return;
      const gate = job.gate;
      const rec = job.auto;
      const hit = stopFor(job, rec, gate);
      // At L3 the job leaves Auto here, as triage would: one stop line and one notice, not a stop now and a leave next pass.
      if (hit) return stop(job, hit, { leave: !autoAllowed({ level: job.level, suggestedLevel: job.suggestedLevel }).ok });
      const route = fixedStop({ kind: 'gate', stage: job.stage, nextStage: gate.nextStage });
      if (route) return stop(job, route);
      if (notNow(job)) return;
      // The person wrote to this job while this step waited: the step is theirs. Auto neither asks nor sends a kept answer
      // (whose cost, already in spent, goes on the stop line). A brief the Foreman raised after their message is Auto's.
      if (await youWroteWhileWaiting(job)) {
        held.delete(job.dir); refused.delete(job.dir);
        return stop(job, { rule: 'blocked', reason: YOURS_NOW });
      }

      let task;
      let answer;
      let askedAt;
      const kept = held.get(job.dir);
      // A kept answer is sent only if the person has said nothing since the Approver was asked (for one, before switching
      // Auto off and on again); otherwise it is dropped and the next pass asks afresh. Its cost is already counted.
      if (kept?.brief === n && (await youSpokeSince(job, kept.askedAt))) { held.delete(job.dir); refused.delete(job.dir); return; }
      if (kept?.brief === n) {
        ({ task, answer, askedAt } = kept);
      } else {
        held.delete(job.dir);
        askedAt = Date.now();
        task = taskFor(job, gate);
        // The Approver never judges a step it cannot see whole (C4, N14): a question or a decision it would be shown cut stops instead.
        const cut = approverCut(task);
        if (cut) return stop(job, { rule: 'blocked', reason: `this ${cut} is too long for the Approver to read, so it needs you.` });
        const roots = approverRoots({ featureDir: job.dir, worktrees: job.worktrees, specDirs: job.specDirs });
        const res = await askApprover(task, { roots, job });
        // A run that timed out is charged the ceiling it was given, whatever partial cost it reported.
        const cost = res?.ok === false && TIMED_OUT.test(res.problem ?? '') ? APPROVER_BUDGET_USD : Number.isFinite(res?.costUsd) ? res.costUsd : 0;
        const checked = res?.ok ? checkAnswer(task, res.answer) : null;
        // Immediately before anything is written or sent: is the answer still for something that waits?
        if (!(await look(job, n))) { await settleDropped(job, cost); return; }
        // The person wrote to the job while the Approver was thinking: it never saw that. Dropped (its cost in spent); once the
        // Foreman's reply to them ends, the next pass leaves the step to them unless that reply raised a new brief.
        if (await youSpokeSince(job, askedAt)) { await settleDropped(job, cost); return; }
        if (!checked?.ok) {
          await update(job.dir, (prev) => (prev ? { ...prev, failures: (prev.failures ?? 0) + 1, problem: res?.ok ? checked.problem : res?.problem ?? 'It ended with an error.', spent: (prev.spent ?? 0) + cost } : null));
          continue;
        }
        answer = checked.answer;
        await addSpent(job, cost);
        if (answer.decision === 'stop') return stop(job, { rule: 'judgment', reason: oneLine(answer.why) });
        // A go the Approver itself calls high risk is not acted on: the person decides (its own reason goes on the line).
        if (tooRisky(answer)) return stop(job, { rule: 'judgment', reason: HIGH_RISK }, { why: oneLine(answer.why) });
      }
      const sent = await send(job, gate, task, answer, askedAt);
      if (sent === 'failed') continue;
      return;
    }
  }

  function taskFor(job, gate) {
    const roots = approverRoots({ featureDir: job.dir, worktrees: job.worktrees, specDirs: job.specDirs });
    return {
      kind: 'gate',
      job: { title: job.title, slug: job.slug, level: job.level, ticketKey: job.ticketKey },
      stage: job.stage,
      brief: { number: gate.briefNumber, path: job.briefPath },
      paths: approverPaths({ featureDir: job.dir, artifacts: job.artifacts, roots }),
      questions: (gate.questions ?? []).map((q) => ({ id: q.id, text: q.text, recommendation: q.recommendation ?? null, options: (q.options ?? []).map((o) => ({ id: o.id, label: o.label })) })),
      // What the Foreman decided for the person and has not confirmed: the Approver sees each on one line, never sliced here:
      // one longer than the Approver is shown stops Auto (approverCut, N14) instead of being confirmed half read.
      decided: (gate.decided ?? []).filter((d) => !d.confirmed).map((d) => ({ id: oneLine(d.id ?? ''), decision: oneLine(d.decision), why: oneLine(d.reason) })),
      request: null,
    };
  }

  /** The reply for one go: labelled lines, each of the Approver's strings on one line, the mark last. */
  function noteFor(task, answer) {
    const lines = [`Why: ${oneLine(answer.why)}`];
    task.questions.forEach((q, i) => {
      const a = answer.answers.find((x) => x.id === String(q.id));
      if (a && oneLine(a.reason)) lines.push(`Reason for question ${i + 1}: ${oneLine(a.reason)}`);
    });
    lines.push(AUTO_MARK);
    return lines.join('\n');
  }

  /** Send the approval through the same path as a click. Returns 'sent', 'not-now', 'dropped' or 'failed'. */
  async function send(job, gate, task, answer, askedAt) {
    const n = gate.briefNumber;
    const answers = {};
    for (const a of answer.answers) answers[a.id] = { choice: a.choice ?? undefined, other: a.other === null ? undefined : oneLine(a.other) };
    const verdicts = {};
    // Confirmed only on a go (a stop never gets here), and only the ones the Approver was shown.
    if (answer.decision === 'go') for (const d of gate.decided ?? []) if (!d.confirmed) verdicts[d.id ?? d.decision] = { verdict: 'confirm' };
    try {
      await decide.gate('approve', { slug: job.slug, briefNumber: n, answers, verdicts, note: noteFor(task, answer) }, { by: 'auto' });
    } catch (err) {
      if (MOVED_ON.has(codeOf(err))) { held.delete(job.dir); await settleIfOff(job); return 'dropped'; }
      if (isNotNow(err)) {
        // Kept for a later pass (no second ask, no second charge); three in a row stop Auto.
        held.set(job.dir, { brief: n, task, answer, askedAt });
        const count = (refused.get(job.dir)?.brief === n ? refused.get(job.dir).count : 0) + 1;
        refused.set(job.dir, { brief: n, count });
        if (count >= NOT_NOW_LIMIT) {
          held.delete(job.dir); refused.delete(job.dir);
          const problem = oneLine(err?.message).replace(/\.$/, '') || 'the reply could not be sent';
          await stop(job, fixedStop({ kind: 'job', failures: 2, problem }));
        }
        return 'not-now';
      }
      held.delete(job.dir);
      await update(job.dir, (prev) => (prev ? { ...prev, failures: (prev.failures ?? 0) + 1, problem: oneLine(err?.message) || 'The reply was refused.' } : null));
      return 'failed';
    }
    held.delete(job.dir); refused.delete(job.dir);
    let spent = 0;
    await update(job.dir, (prev) => {
      if (!prev) return null;
      spent = prev.spent ?? 0;
      const count = prev.step?.stage === job.stage ? prev.step.count + 1 : 1;
      return { ...prev, lastBrief: gate.briefNumber, failures: 0, problem: null, cards: 0, cardsBrief: gate.briefNumber, step: { stage: job.stage, count } };
    });
    const labelOf = (q, id) => (q?.options ?? []).find((o) => String(o.id) === String(id))?.label ?? id;
    await audit(job, 'gate', {
      briefNumber: gate.briefNumber,
      asked: oneLine(gate.headline) || `Brief ${gate.briefNumber}`,
      chose: 'Approved',
      why: oneLine(answer.why),
      risk: answer.risk,
      answers: answer.answers.map((a) => {
        const q = task.questions.find((x) => String(x.id) === a.id);
        return { question: oneLine(q?.text ?? a.id), choice: oneLine(a.choice !== null ? labelOf(q, a.choice) : a.other), reason: oneLine(a.reason) };
      }),
      costUsd: spent,
    });
    await paidOff(job, spent);
    return 'sent';
  }


  // ---------- Cards: a worker's question or permission in the middle of a reply ----------

  /** The Approver's words as the worker is told them when Auto says no: one line, no copy of the mark. */
  const NO = (why) => `Auto said no: ${oneLine(why)}`;

  /**
   * A card has been raised (the driver's 'permission'). For a job with Auto on and not stopped, Auto
   * answers it, or stops and leaves it to the person; for anything else it does nothing. leftWaiting(card)
   * is called, at most once, whenever the card is left for the person and Auto's own stop notification
   * has not already told them (the runner's "Permission: ..." notification). Cards of one job are handled
   * one at a time, in the order they came; a card is taken up once. Resolves when this card is done with.
   */
  function onPermission(card, { leftWaiting = () => {} } = {}) {
    if (!card?.id || cards.has(card.id)) return Promise.resolve();
    cards.set(card.id, true);
    // From when Auto took the card up: words the person writes while it waits make it theirs (N3).
    const takenAt = Date.now();
    const dir = card.featureDir;
    let told = false;
    const tell = () => { if (!told) { told = true; leftWaiting(card); } };
    const mine = (queues.get(dir) ?? Promise.resolve())
      .then(() => attendCard(card, tell, takenAt))
      .catch((err) => {
        console.error(`auto card (${card.slug}):`, err.message);
        // Something failed while Auto had the card: it is the person's now, and they are told (once).
        if (pendingCard(card.id)) tell();
      })
      .then(() => {
        // Done with, and it still waits: Auto has left it to the person (a stop, a failure, a card it never answers).
        if (cards.has(card.id) && pendingCard(card.id)) cards.set(card.id, 'left');
      })
      .finally(() => { if (queues.get(dir) === mine) queues.delete(dir); });
    queues.set(dir, mine);
    return mine;
  }

  /** A card that has gone away (answered, the reply ended) is forgotten. */
  function cardGone(id) { cards.delete(id); }
  /** Whether Auto has left this card to the person: it took it up, is done with it, and did not answer it. */
  function leftCard(id) { return cards.get(id) === 'left'; }
  /** Whether Auto is handling this card now: taken up, and not done with. Any other card that waits is the person's. */
  function handlingCard(id) { return cards.get(id) === true; }

  /** A stop on the card: its own notification tells the person; when none was written, the card's notification does. */
  async function stopOnCard(job, hit, leave, opts = {}) {
    if (!(await stop(job, hit, { ...opts, card: true }))) leave();
  }

  async function attendCard(card, leftWaiting, takenAt = Date.now()) {
    let left = false;
    const leave = () => { if (!left) { left = true; leftWaiting(card); } };
    const waits = () => pendingCard(card.id);
    if (!waits()) { cards.delete(card.id); return; } // gone while it queued: answered, or the reply ended
    const [job] = await read(card.featureDir);
    if (!job || job.auto?.on !== true || job.auto.stopped || job.restarting || !autoAllowed({ level: job.level, suggestedLevel: job.suggestedLevel }).ok) return leave();
    // Never answered: a card about Starbase's own checks, PR feedback, a review round. A status card also stops Auto.
    if (card.feedbackCard || card.roundCard) return leave();
    if (card.statusCard) return stopOnCard(job, fixedStop({ kind: 'job', statusCard: true }), leave);
    const full = waits();
    if (!full) { cards.delete(card.id); return; }
    // The fixed stop list decides first; so does a hard line (the hook refused a deny one before any card existed).
    let hit;
    let ctx = null;
    let why = null; // why Starbase asked (autoVerdict), for the Approver's facts (I10)
    try {
      ctx = await cardCtx(card);
      if (!ctx) throw new Error('no folders for this card');
      const asked = { kind: 'card', toolName: full.toolName, input: full.input, hardLine: full.hardLine ? { decision: 'ask', ...full.hardLine } : null, blockedPath: full.blockedPath ?? null };
      hit = fixedStop(asked, ctx);
      if (!hit) why = autoVerdict(asked, ctx)?.why ?? null;
    } catch { hit = { rule: 'tool', reason: AUTO_STOP_REASONS.tool }; }
    // A push is the one hard line the Approver may judge: the fixed stops already refuse any push but the job's own branch to its fork.
    // Only the plain push: a command that also holds a gh call (an early pull request would end Auto with unreviewed work) is not it.
    const plainPush = full.hardLine?.line === 'git-push' && !/\bgh\b/.test(String(full.input?.command ?? ''));
    if (!hit && full.hardLine && !plainPush) hit = { rule: 'blocked', reason: oneLine(full.hardLine.reason) || 'this is a hard line, and hard lines need you.' };
    if (hit) return stopOnCard(job, hit, leave);
    // The count belongs to one reply: it starts from 0 when the last answered brief is not the one it was kept with.
    const lastAnswered = Math.max(0, ...(job.answered ?? []));
    if (((job.auto.cardsBrief ?? 0) === lastAnswered ? job.auto.cards ?? 0 : 0) >= AUTO_CARDS_PER_REPLY) {
      return stopOnCard(job, { rule: 'loop', reason: `Auto has answered ${AUTO_CARDS_PER_REPLY} cards in one reply, so it needs you.` }, leave);
    }

    // The person wrote to the job (a message, or one steered into the reply) since Auto took the card up, while it
    // queued behind another: it is theirs, and the Approver is not asked.
    if (await youSpokeSince(job, takenAt, { steer: true })) { leave(); return; }
    const task = { ...cardTask(job, full), facts: cardFacts(ctx, why, full, plainPush) };
    // The Approver never judges a card it cannot see whole (C4): a command or a field it would be shown cut stops instead.
    const cut = approverCut(task);
    if (cut) return stopOnCard(job, { rule: 'blocked', reason: `this ${cut} is too long for the Approver to read, so it needs you.` }, leave);
    const roots = approverRoots({ featureDir: job.dir, worktrees: job.worktrees, specDirs: job.specDirs });
    const res = await askApprover(task, { roots, job });
    const cost = res?.ok === false && TIMED_OUT.test(res.problem ?? '') ? APPROVER_BUDGET_USD : Number.isFinite(res?.costUsd) ? res.costUsd : 0;
    const checked = res?.ok ? checkAnswer(task, res.answer) : null;
    // The Approver can take minutes: is the card still waiting, and is Auto still on and not stopped?
    const [fresh] = await read(job.dir);
    if (!waits() || !fresh || fresh.auto?.on !== true || fresh.auto.stopped || fresh.restarting) {
      await settleDropped(job, cost);
      if (waits()) leave(); // the card still waits for the person: told once
      return;
    }
    // The person wrote to the job since Auto took the card up (while it waited, or while the Approver thought): the
    // Approver never saw that. The card is left to them.
    if (await youSpokeSince(job, takenAt, { steer: true })) {
      await settleDropped(job, cost);
      leave();
      return;
    }
    if (!checked?.ok) {
      let count = 0;
      const problem = res?.ok ? checked.problem : res?.problem ?? 'It ended with an error.';
      await update(job.dir, (prev) => { if (!prev) return null; count = (prev.failures ?? 0) + 1; return { ...prev, failures: count, problem, spent: (prev.spent ?? 0) + cost }; });
      // The same sentence as for a gate (stopFor): the problem without its closing full stop.
      const hitAgain = fixedStop({ kind: 'job', failures: count, problem: String(problem).replace(/\.$/, '') });
      return hitAgain ? stopOnCard(job, hitAgain, leave) : leave();
    }
    const answer = checked.answer;
    await addSpent(job, cost);
    if (answer.decision === 'stop') return stopOnCard(job, { rule: 'judgment', reason: oneLine(answer.why) }, leave);
    // An allow (or a question's go) the Approver itself calls high risk is not acted on: the card is left to the person.
    if (tooRisky(answer)) return stopOnCard(job, { rule: 'judgment', reason: HIGH_RISK }, leave, { why: oneLine(answer.why) });
    await answerCard(job, full, task, answer, { leave, lastAnswered });
  }

  /**
   * Starbase's own facts for the Approver (I10): the job's folders, where the call runs, the job's branch and fork remote,
   * and why Starbase asked; for a plain push or the org-branch step, a sentence saying what it is and what was checked.
   */
  function cardFacts(ctx, why, full, plainPush) {
    if (!ctx) return null;
    const name = ctx.forkRemote || 'origin';
    let url = null;
    try { url = typeof ctx.remoteUrl === 'function' ? ctx.remoteUrl(name) : null; } catch { url = null; }
    const orgStep = typeof why === 'string' && why.startsWith('the workflow\'s org branch step');
    const note = plainPush
      ? `This is a push of the job's own branch to its fork: Starbase checked that the remote is the fork ${name}, not the org repository, and that the branch is the job's own.`
      : orgStep ? `This is the workflow's org branch step: it creates the job's branch on ${ctx.orgRepo}, the job's org repository; Starbase checked the repository, that the branch is the job's own, and that the commit is on ${ctx.orgRemote ?? 'the org remote'}/main.` : null;
    return {
      folders: [...(ctx.worktrees ?? []), ctx.featureDir, ...(ctx.specDirs ?? [])].filter(Boolean), cwd: ctx.cwd ?? null,
      branches: ctx.branches ?? [], fork: { name, url }, why: why ?? (plainPush ? 'a push is a hard line, so it is asked about before it runs' : null), note,
    };
  }

  /** What the Approver is asked about a card: the questions, or the request in words. */
  function cardTask(job, card) {
    const roots = approverRoots({ featureDir: job.dir, worktrees: job.worktrees, specDirs: job.specDirs });
    const base = {
      job: { title: job.title, slug: job.slug, level: job.level, ticketKey: job.ticketKey },
      stage: job.stage,
      brief: null,
      paths: approverPaths({ featureDir: job.dir, artifacts: job.artifacts, roots }),
    };
    if (card.kind === 'question') {
      const asked = Array.isArray(card.input?.questions) ? card.input.questions : [];
      return {
        ...base, kind: 'question', request: null, labels: asked.map((q) => (q?.options ?? []).map((o) => String(o?.label ?? ''))),
        questions: asked.map((q, i) => {
          const options = (q?.options ?? []).map((o, k) => ({ id: String(k), label: String(o?.label ?? '') }));
          const rec = options.find((o) => /\(recommended\)/i.test(o.label));
          return { id: String(i), text: String(q?.question ?? ''), recommendation: rec?.id ?? null, options };
        }),
      };
    }
    // A command is given whole, from the card's own input, not the card's trimmed preview (C4); another tool's preview says when it was cut.
    const command = card.toolName === 'Bash' && typeof card.input?.command === 'string' ? card.input.command : null;
    return {
      ...base, kind: 'permission', questions: [],
      request: { tool: card.toolName, headline: card.plain?.headline ?? card.toolName, preview: command ?? card.plain?.preview ?? card.plain?.detail ?? '', cut: command === null && card.plain?.previewCut != null },
    };
  }

  /** Send the decision the way a click does, by 'auto': once, or no. Writes the Auto line and counts the card. */
  async function answerCard(job, card, task, answer, { leave, lastAnswered }) {
    let decision;
    let note = '';
    let answers = null;
    let chose;
    let lines = null;
    if (task.kind === 'question') {
      decision = 'allow';
      answers = {};
      lines = [];
      task.questions.forEach((q, i) => {
        const a = answer.answers.find((x) => x.id === q.id);
        const label = a.choice !== null ? task.labels[i][Number(a.choice)] ?? a.choice : oneLine(a.other);
        answers[q.text] = label;
        lines.push({ question: oneLine(q.text), choice: oneLine(label), reason: oneLine(a.reason) });
      });
      chose = lines.map((l) => l.choice).join('; ');
    } else if (answer.decision === 'allow') {
      decision = 'allow';
      chose = 'Allowed';
    } else {
      decision = 'deny';
      note = NO(answer.why);
      chose = 'Said no';
    }
    try {
      await decide.permission(card.id, { decision, note, answers }, { by: 'auto' });
    } catch (err) {
      // Refused (the card went away between the look and the decision, or Auto went off or stopped): nothing was sent.
      // The cost stays in spent, or, with Auto off, goes on a line of its own.
      if (codeOf(err) !== 'auto-gone') console.error(`auto card (${job.slug}):`, err.message);
      await settleIfOff(job);
      if (pendingCard(card.id)) leave(); // refused but still waiting: the person is told once
      return;
    }
    let spent = 0;
    await update(job.dir, (prev) => {
      if (!prev) return null;
      spent = prev.spent ?? 0;
      return { ...prev, failures: 0, problem: null, cards: ((prev.cardsBrief ?? 0) === lastAnswered ? prev.cards ?? 0 : 0) + 1, cardsBrief: lastAnswered };
    });
    await audit(job, task.kind === 'question' ? 'question' : 'permission', {
      asked: oneLine(task.kind === 'question' ? task.questions.map((q) => q.text).join(' / ') : card.plain?.headline ?? card.toolName),
      chose, why: oneLine(answer.why), risk: answer.risk, ...(lines ? { answers: lines } : {}), costUsd: spent,
    });
    await paidOff(job, spent);
  }

  return { pass, onPermission, cardGone, leftCard, handlingCard };
}
