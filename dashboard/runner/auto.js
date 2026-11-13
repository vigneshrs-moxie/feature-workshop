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

import { AUTO_CARDS_PER_REPLY, AUTO_MARK, OWN_SENDS, REFUSED_RULES, YOURS_NOW, finishBody, refuseNote, refuseReason, wroteWhileWaiting } from '../lib/auto.js';
import { AUTO_STOP_REASONS, OUTSIDE_REASONS, autoVerdict, fixedStop } from '../lib/auto-rules.js';
import { APPROVER_BUDGET_USD, approverCut, approverPaths, approverRoots, callPreview, checkAnswer } from '../lib/approver.js';
import { DECIDING_KINDS } from '../lib/gate.js';
import { ownLevelStands } from '../lib/auto-level.js';
import { prDecisions } from '../lib/auto-log.js';

/** Anything the Approver wrote, on one line: nothing it writes can start a line of its own, and no copy of the mark gets through. */
const oneLine = (s) => {
  const flat = (t) => t.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  // Taking a copy of the mark out can join the rest into a new copy (one inside another): until none is left.
  let t = flat(String(s ?? ''));
  for (let i = 0; i < 20 && t.includes(AUTO_MARK); i++) t = flat(t.split(AUTO_MARK).join(' '));
  return t.includes(AUTO_MARK) ? '' : t;
};
/**
 * The command with each of the job's own branch names (the card context's `branches`) taken out, for the plain-push test's
 * look for a gh call (n3). Fail closed: a name is taken out only where it stands whole (no branch-name character on either
 * side), only a name of letters, digits and . _ / - , and never a name whose last part is gh itself (gh, gh.exe, x/gh),
 * which could be the gh program. With no names, the command comes back as it is.
 */
const BRANCH_CHAR = 'A-Za-z0-9._/-';
const withoutOwnBranches = (command, branches) => {
  const names = (Array.isArray(branches) ? branches : [])
    .filter((b) => typeof b === 'string' && new RegExp(`^[${BRANCH_CHAR}]+$`).test(b) && !/(^|\/)gh(\.[^/]*)?$/i.test(b))
    .sort((a, b) => b.length - a.length);
  let out = command;
  for (const b of names) {
    const exact = b.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![${BRANCH_CHAR}])${exact}(?![${BRANCH_CHAR}])`, 'g'), ' ');
  }
  return out;
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
// OWN_SENDS (Starbase's own sends) and YOURS_NOW (Auto's stop when the person wrote to a job while its step waited, I5) are lib/auto.js's.
/**
 * An Approver answer that would act (go, allow) but calls its own risk high, or a stop: not acted on. Auto asks once more for the
 * safer answer (APPROVER_SAFER, Auto queue Task 6), sends that one whatever its risk, and writes it down as a risky call.
 */
const tooRisky = (answer) => answer?.risk === 'high' && (answer.decision === 'go' || answer.decision === 'allow');
const askSafer = (answer) => answer?.decision === 'stop' || tooRisky(answer);
/** What the Approver first said, for a risky call's line: `Stop: <why>`, `Go, high risk: <why>`, `Allow, high risk: <why>`. */
function firstWords(answer) {
  const why = oneLine(answer?.why);
  if (answer?.decision === 'stop') return `Stop: ${why}`;
  return `${answer?.decision === 'allow' ? 'Allow' : 'Go'}, high risk: ${why}`;
}
/** A risky call's count, one more (a record from before has none). */
const riskyPlusOne = (prev) => (Number.isInteger(prev?.risky) && prev.risky > 0 ? prev.risky : 0) + 1;
/** Auto's stop for a job nothing moves (I3): after ten minutes, or at once for a reply cut off by a crash or restart. */
const IDLE = 'nothing is running on this job and no step waits, so it needs you.';
const CUT_OFF = 'Starbase stopped while this job was working, so it needs you: press Resume.';
/**
 * Auto never leaves a card silently (Task 13, fix round 1): while Auto is on and not stopped, a card it does not answer is a
 * stop on that card, with one of these reasons, and he is told Needs you. His answer to the card clears the stop.
 */
const CARD_THREW = 'Auto hit an error while answering a card, so the card is yours.';
const CARD_YOURS = 'You wrote to this job while a card waited, so the card is yours.';
const CARD_NOT_SENT = 'Starbase could not send Auto\'s answer to a card, so the card is yours.';
const CARD_LEFT = 'Auto left a card unanswered, so the card is yours.';
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
  async function stop(job, { rule, reason }, { why = null, card = false, cardId = null } = {}) {
    stopping(job.slug, true);
    try { return await writeStop(job, { rule, reason }, { why, card, cardId }); } finally { stopping(job.slug, false); }
  }
  // card: the stop was written on a card (stopOnCard); only then does the person's answer to a card clear it (N1).
  // cardId: that card's request id; only the person's answer to that card clears the stop (F1).
  async function writeStop(job, { rule, reason }, { why, card, cardId }) {
    const at = now().toISOString();
    let spent = 0;
    let wrote = false;
    await update(job.dir, (prev) => {
      // Auto was switched off, or already stopped: nothing to stop.
      if (prev?.on !== true || prev.stopped) return null;
      wrote = true;
      spent = prev.spent ?? 0;
      return { ...prev, stopped: { reason, rule, at, ...(card ? { card: true, ...(cardId ? { cardId } : {}) } : {}) } };
    });
    if (!wrote) return false;
    try {
      await audit(job, 'stop', { rule, reason, why: why || reason, ...(spent > 0 ? { costUsd: spent } : {}) });
      await paidOff(job, spent);
    } finally {
      // Once the record says stopped, the person is told (a dead end: Needs you), even when the line could not be written.
      // The reason ends with its own full stop.
      const said = /[.!?]$/.test(reason) ? reason : `${reason}.`;
      notify({ level: 'needs', title: `Needs you: ${job.title}`, body: `Auto stopped: ${said}`, slug: job.slug, key: `auto-stop:${job.slug}:${at}` });
      freed(); // a stopped job frees its Auto start place: it can be filled now
    }
    return true;
  }

  /**
   * PR #1 is open: Auto is off, `ran` stays, and the person is told once, Ready for you to try, with the level when it is L3 and
   * the risky calls when there are any (not at all if Auto was already off).
   */
  async function finish(job) {
    const at = now().toISOString();
    let spent = 0;
    let risky = 0;
    let wrote = false;
    await update(job.dir, (prev) => {
      if (prev?.on !== true) return null;
      wrote = true;
      spent = prev.spent ?? 0;
      risky = prev.risky;
      return { ...prev, on: false, stopped: null, finished: at };
    });
    if (!wrote) return;
    await audit(job, 'finished', { why: 'PR #1 is open.', ...(spent > 0 ? { costUsd: spent } : {}) });
    await paidOff(job, spent);
    notify({ level: 'done', title: `Ready for you to try: ${job.title}`, body: finishBody({ level: job.level, risky }), slug: job.slug, key: `auto-finish:${job.slug}` });
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
    // A stop written on a card is cleared by the person's answer to that card, named by its request id (F1); a stop whose
    // card is gone is cleared by a gate decision, or by switching Auto off and on.
    const cardStop = job.auto.stopped?.card === true ? job.auto.stopped.cardId ?? null : null;
    // The cut-off stop asks for Resume: the person's Resume (a `resumed` line not via Starbase's own carry-on) clears it (N5),
    // and so does a message of their own, which ends the pause as Resume would (F2).
    const cutOffStop = job.auto.stopped?.reason === CUT_OFF;
    const yours = lines.some((l) => l.by !== 'auto' && Date.parse(l.at) > stoppedAt
      && ((l.action === 'send' && DECIDES.has(l.kind) && l.gateBrief) || (cardStop && l.action === 'permission' && l.requestId === cardStop) || (statusStop && l.action === 'status_invalid_answer')
        || (cutOffStop && l.action === 'resumed' && l.via !== 'auto')
        // A message of the person's own after the cut-off stop does what Resume would (it ends the pause, F2).
        || (cutOffStop && l.action === 'send' && !OWN_SENDS.has(l.kind))));
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
    if (job.auto.stopped) { await carryOnIfYouDecided(job); return null; }
    if (job.running || job.locked || job.paused) return null;
    // A reply cut off by a Starbase crash or restart waits for Resume, which only the person presses: no ten minutes for that.
    if (job.cutOff) { await stop(job, { rule: 'blocked', reason: CUT_OFF }); return null; }
    // A suggested L1, L2 or L3 above the job's level is applied before the gate is answered (the higher one wins, never lowered),
    // unless the job's latest level line is his own change after an automatic level: his choice stands. All of the job's lines: on a long
    // job the automatic level line would drop out of a window first (one cached parse of the file serves both, as at youWroteWhileWaiting).
    const suggested = job.suggestedLevel;
    if ((suggested === 1 || suggested === 2 || suggested === 3) && !(job.level >= suggested) && !ownLevelStands(await state.auditFor(job.dir, Infinity))) {
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
    // The person wrote to this job while this step waited: the step is theirs, and the stop is written here, in the pass's first
    // round, before any job's Approver is asked (attend checks again, for a message sent while the Approver thinks).
    if (await youWroteWhileWaiting(job)) {
      // The pass read this job a while ago: his own Go or Send back since then is a send too. Read it again, as attend does: a step
      // he has answered (or that moved on), or a reply now running, is not one he wrote to while it waited. The next pass looks again.
      const fresh = await look(job, gate.briefNumber);
      if (!fresh || notNow(fresh)) return null;
      if (await youWroteWhileWaiting(fresh)) {
        held.delete(job.dir); refused.delete(job.dir);
        await stop(fresh, { rule: 'blocked', reason: YOURS_NOW });
        return null;
      }
    }
    // The first brief suggests a stack (Auto queue, Task 12): the ticket is too big for Auto. After every fixed stop and "you
    // wrote while waiting", straight before the Approver is asked: set aside once, on brief 1 only, and never after he has acted
    // on a set-aside job (asOne).
    if (tooBigForAuto(job, gate)) { await setAside(job, gate.briefNumber); return null; }
    return gate;
  }

  /**
   * Why the Foreman thinks the ticket is big enough for a stack, when that sets this job aside at this gate: else null. Only the
   * job's first brief (a job switched to Auto at a later brief never is), before Auto has answered one, and not once asOne is set.
   */
  const tooBigForAuto = (job, gate) => {
    const why = typeof job.stackSuggested === 'string' ? job.stackSuggested.trim() : '';
    return why && gate?.briefNumber === 1 && (job.auto.lastBrief ?? null) === null && job.auto.asOne !== true ? why : null;
  };

  /**
   * Too big for Auto (Auto queue, Task 12): Auto switches itself off on the job and marks it (tooBig), under the Auto lock,
   * with one line and one notice (Task 13); the job takes no place, so the next ticket can start. No Approver, no gate answered.
   * Nothing is written or told when Auto went off, stopped or answered a brief meanwhile, or he switched it back on after a set-aside.
   * Marked as being stopped meanwhile, as a stop is, so the job is not also told "waiting" before its notice goes.
   */
  async function setAside(job, n) {
    stopping(job.slug, true);
    try { await writeAside(job, n); } finally { stopping(job.slug, false); }
  }
  async function writeAside(first, n) {
    // The pass read this job a while ago: read it again, as the other paths do. A brief he has answered or that moved on, Auto
    // switched off, the job closed or restarting, or a reply now running: nothing is written or told. The next pass looks again.
    const job = await look(first, n);
    if (!job || notNow(job)) return;
    const reason = tooBigForAuto(job, job.gate);
    if (!reason) return;
    const at = now().toISOString();
    let spent = 0;
    let wrote = false;
    await update(job.dir, (prev) => {
      if (prev?.on !== true || prev.stopped || prev.asOne === true || (prev.lastBrief ?? null) !== null) return null;
      wrote = true;
      spent = prev.spent ?? 0;
      return { ...prev, on: false, tooBig: { at, reason } };
    });
    if (!wrote) return;
    held.delete(job.dir); refused.delete(job.dir);
    try {
      await audit(job, 'set-aside', { why: reason, ...(spent > 0 ? { costUsd: spent } : {}) });
      await paidOff(job, spent);
    } finally {
      // Once the record says set aside, the person is told, the pages show it and its place is free, even when the line could not be written.
      notify({ level: 'needs', title: `Too big for Auto: ${job.title}`, body: 'The Foreman thinks this ticket is big enough for a stack.', slug: job.slug, key: `auto-too-big:${job.slug}` });
      changed();
      freed();
    }
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
   * All of the job's lines are read: the Foreman's reply to that message can write many. The rule is lib/auto.js wroteWhileWaiting.
   */
  async function youWroteWhileWaiting(job) {
    return wroteWhileWaiting(await state.auditFor(job.dir, Infinity), { briefAt: job.briefAt, since: job.auto?.since });
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
    // The Approver's first answer once it asked for a second look, and when that first ask began: it survives a failed second
    // ask, so the next try asks only the safer question again, and the dead end shows its words.
    let firstAnswer = null;
    let firstAt = null;
    for (let tries = 0; tries < 3; tries++) {
      // Everything is read again at each turn: the Approver can take minutes.
      const job = await look(first, n);
      if (!job) return;
      const gate = job.gate;
      const rec = job.auto;
      const hit = stopFor(job, rec, gate);
      if (hit) return stop(job, hit, hit.rule === 'approver' && firstAnswer ? { why: firstWords(firstAnswer) } : {});
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
        if (task.safer) { firstAnswer = task.safer; firstAt = askedAt; }
      } else {
        held.delete(job.dir);
        askedAt = firstAnswer ? firstAt : Date.now();
        task = taskFor(job, gate);
        // The Approver never judges a step it cannot see whole (C4, N14): a question or a decision it would be shown cut stops instead.
        const cut = approverCut(task);
        if (cut) return stop(job, { rule: 'blocked', reason: `this ${cut} is too long for the Approver to read, so it needs you.` });
        const roots = approverRoots({ featureDir: job.dir, worktrees: job.worktrees, specDirs: job.specDirs });
        // One ask, by the same rules for the first and the second: the answer, or 'dropped' or 'failed'.
        const ask = async (t) => {
          const res = await askApprover(t, { roots, job });
          // A run that timed out is charged the ceiling it was given, whatever partial cost it reported.
          const cost = res?.ok === false && TIMED_OUT.test(res.problem ?? '') ? APPROVER_BUDGET_USD : Number.isFinite(res?.costUsd) ? res.costUsd : 0;
          const checked = res?.ok ? checkAnswer(t, res.answer) : null;
          // Immediately before anything is written or sent: is the answer still for something that waits?
          if (!(await look(job, n))) { await settleDropped(job, cost); return 'dropped'; }
          // The person wrote to the job while the Approver was thinking: it never saw that. Dropped (its cost in spent); once the
          // Foreman's reply to them ends, the next pass leaves the step to them unless that reply raised a new brief.
          if (await youSpokeSince(job, askedAt)) { await settleDropped(job, cost); return 'dropped'; }
          if (!checked?.ok) {
            await update(job.dir, (prev) => (prev ? { ...prev, failures: (prev.failures ?? 0) + 1, problem: res?.ok ? checked.problem : res?.problem ?? 'It ended with an error.', spent: (prev.spent ?? 0) + cost } : null));
            return 'failed';
          }
          await addSpent(job, cost);
          return checked.answer;
        };
        if (!firstAnswer) {
          answer = await ask(task);
          if (answer === 'dropped') return;
          if (answer === 'failed') continue;
          // A stop, or a go the Approver itself calls high risk, is not acted on: it is asked once more, for the safer answer.
          if (askSafer(answer)) { firstAnswer = answer; firstAt = askedAt; }
        }
        // The second look (the task carries the first answer, so send writes it down as a risky call): its answer goes whatever
        // its risk. A failure is the Approver's, as for the first ask; the next try asks only this question again.
        if (firstAnswer) {
          task = { ...task, safer: firstAnswer };
          answer = await ask(task);
          if (answer === 'dropped') return;
          if (answer === 'failed') continue;
        }
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

  /**
   * The reply for one go: labelled lines, each of the Approver's strings on one line, then `decisions` (the go-ahead for
   * PR #1's Decisions Auto made block, lib/auto-log.js prDecisions, each line already one line), the mark last.
   */
  function noteFor(task, answer, { decisions = [] } = {}) {
    const lines = [`Why: ${oneLine(answer.why)}`];
    task.questions.forEach((q, i) => {
      const a = answer.answers.find((x) => x.id === String(q.id));
      if (a && oneLine(a.reason)) lines.push(`Reason for question ${i + 1}: ${oneLine(a.reason)}`);
    });
    lines.push(...decisions);
    lines.push(AUTO_MARK);
    return lines.join('\n');
  }

  /** Send the approval through the same path as a click. Returns 'sent', 'not-now', 'dropped' or 'failed'. */
  async function send(job, gate, task, answer, askedAt) {
    const n = gate.briefNumber;
    const answers = {};
    for (const a of answer.answers) answers[a.id] = { choice: a.choice ?? undefined, other: a.other === null ? undefined : oneLine(a.other) };
    const verdicts = {};
    // Confirmed only on a go (a stop never gets here), and only the ones the Approver was shown; never on a second look: its first
    // answer doubted the step, so the items stay open for the person (the reply says "Not confirmed yet").
    if (answer.decision === 'go' && !task.safer) for (const d of gate.decided ?? []) if (!d.confirmed) verdicts[d.id ?? d.decision] = { verdict: 'confirm' };
    // The second ask's answer (task.safer holds the first): a risky call, counted with the brief it answered. open: the decided
    // items it left unconfirmed, for the person.
    const open = task.safer ? (gate.decided ?? []).filter((d) => !d.confirmed).length : 0;
    const risky = task.safer ? { risky: true, first: firstWords(task.safer), ...(open ? { open } : {}) } : null;
    // The go-ahead that leads to PR #1 carries the job's risky calls (this one last) for the PR's description. Reading the
    // lines never holds the go-ahead up: if it fails, the go-ahead goes without the block.
    let decisions = [];
    if (gate.nextStage === 'pr1' || job.stage === 'pr1') {
      const extra = risky ? { stage: job.stage, asked: oneLine(gate.headline) || `Brief ${gate.briefNumber}`, why: oneLine(answer.why), ...risky } : null;
      try { decisions = prDecisions(await state.auditFor(job.dir, Infinity), { extra }); } catch { decisions = []; }
    }
    try {
      await decide.gate('approve', { slug: job.slug, briefNumber: n, answers, verdicts, note: noteFor(task, answer, { decisions }) }, { by: 'auto' });
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
      return { ...prev, lastBrief: gate.briefNumber, failures: 0, problem: null, cards: 0, cardsBrief: gate.briefNumber, step: { stage: job.stage, count }, ...(risky ? { risky: riskyPlusOne(prev) } : {}) };
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
      ...risky,
    });
    await paidOff(job, spent);
    return 'sent';
  }


  // ---------- Cards: a worker's question or permission in the middle of a reply ----------

  /** The Approver's words as the worker is told them when Auto says no: one line, no copy of the mark. */
  const NO = (why) => `Auto said no: ${oneLine(why)}`;
  /** A card the Approver called high risk on both looks (an allow): Auto denies it. The worker's note, and the line's why. */
  const BOTH_HIGH_NOTE = 'Auto denied this: it looked high risk on both looks. Find another way inside the job\'s folders, or leave it for after PR #1.';
  const BOTH_HIGH_WHY = 'High risk on both looks, so Auto denied it.';

  /**
   * A card has been raised (the driver's 'permission'; the runner sends only cards of a job whose Auto is on and not stopped).
   * Auto answers it, refuses it (refuseCard), or stops on it with a reason, and he is told Needs you (Task 13, fix round 1): while
   * Auto is on and not stopped, no card is left silently. A card left while the record is still on and not stopped, by a path
   * that wrote no stop, gets its stop here (CARD_THREW after a throw, else CARD_LEFT). Left without a stop on purpose ("quiet"):
   * the job is closing or restarting (auto-gone), and PR feedback and review round cards.
   * What a left card tells is decided once, here, from the record when Auto is done with it (follow-up K1): Auto off, gone or
   * restarting, nothing; Auto stopped by another card or a gate, leftWaiting(card), the runner's tellPermission, as on any job
   * (he answered that card, the stop clears, and this one would wait unannounced); stopped on this card, nothing more (its Needs
   * you told him); on and not stopped, a stop on it unless it is quiet. leftWaiting is called at most once.
   * Cards of one job are handled one at a time, in the order they came; a card is taken up once. Resolves when this card is done with.
   */
  function onPermission(card, { leftWaiting = () => {} } = {}) {
    if (!card?.id || cards.has(card.id)) return Promise.resolve();
    cards.set(card.id, true);
    // From when Auto took the card up: words the person writes while it waits make it theirs (N3).
    const takenAt = Date.now();
    const dir = card.featureDir;
    let told = false;
    const tell = () => { if (!told) { told = true; leftWaiting(card); } };
    let quiet = false;
    let threw = false;
    const mine = (queues.get(dir) ?? Promise.resolve())
      .then(() => attendCard(card, takenAt, () => { quiet = true; }))
      .catch((err) => {
        console.error(`auto card (${card.slug}):`, err.message);
        threw = true;
      })
      .then(async () => {
        if (!cards.has(card.id) || !pendingCard(card.id)) return;
        // Done with, and it still waits: Auto has left it to the person (a stop, Auto gone, a card it never answers).
        cards.set(card.id, 'left');
        await whenLeft(card, threw ? CARD_THREW : CARD_LEFT, { quiet, tell });
      })
      .catch((err) => console.error(`auto card (${card.slug}):`, err.message))
      .finally(() => { if (queues.get(dir) === mine) queues.delete(dir); });
    queues.set(dir, mine);
    return mine;
  }

  /** A card Auto has left, by the record now (see onPermission): told as on any job, a stop on it, or nothing. */
  async function whenLeft(card, reason, { quiet, tell }) {
    const byRecord = (job) => {
      if (!job || job.auto?.on !== true || job.restarting) return 'silent'; // off, finished, set aside, closed or restarting
      if (job.auto.stopped) return job.auto.stopped.cardId === card.id ? 'silent' : 'tell'; // stopped on another card or a gate
      return quiet ? 'silent' : 'stop';
    };
    const [job] = await read(card.featureDir);
    const what = byRecord(job);
    if (what === 'tell') tell();
    if (what !== 'stop') return;
    if (await stop(job, { rule: 'blocked', reason }, { card: true, cardId: card.id })) return;
    // No stop was written: the record went off or stopped meanwhile. Decide again.
    const [now] = await read(card.featureDir);
    if (byRecord(now) === 'tell') tell();
  }

  /** A card that has gone away (answered, the reply ended) is forgotten. */
  function cardGone(id) { cards.delete(id); }
  /** Whether Auto has left this card to the person: it took it up, is done with it, and did not answer it. */
  function leftCard(id) { return cards.get(id) === 'left'; }
  /** Whether Auto is handling this card now: taken up, and not done with. Any other card that waits is the person's. */
  function handlingCard(id) { return cards.get(id) === true; }

  /**
   * A stop on the card: its own notification tells the person. When none was written (Auto went off or stopped meanwhile),
   * leave() is called; what that card tells is decided in onPermission's last step (whenLeft).
   */
  async function stopOnCard(job, hit, leave, opts = {}) {
    if (!(await stop(job, hit, { ...opts, card: true }))) leave();
  }

  // leave(): Auto is done with the card without answering it; onPermission's last step (whenLeft) decides what it tells.
  // hush(): it is left without a stop on purpose while Auto is on and not stopped (auto-gone while closing or restarting, or a
  // PR feedback or review round card), so no stop is written for it.
  async function attendCard(card, takenAt = Date.now(), hush = () => {}) {
    const leave = () => {};
    const quietly = () => { hush(); };
    const waits = () => pendingCard(card.id);
    if (!waits()) { cards.delete(card.id); return; } // gone while it queued: answered, or the reply ended
    const [job] = await read(card.featureDir);
    // Off, gone, restarting or stopped: Auto does not take the card up. A stopped Auto's card is told as on any job (whenLeft).
    if (!job || job.auto?.on !== true || job.auto.stopped || job.restarting) return leave();
    // Never answered: a card about Starbase's own checks, PR feedback, a review round (they come after PR #1, when the finish
    // that follows tells him). A status card also stops Auto.
    if (card.feedbackCard || card.roundCard) return quietly();
    if (card.statusCard) return stopOnCard(job, fixedStop({ kind: 'job', statusCard: true }), leave, { cardId: card.id });
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
    } catch (err) {
      // Refused on the card like a tool Auto can't judge; said here, so a broken job context is not silent (m3).
      console.warn(`auto card ctx (${card.slug}):`, err?.message);
      hit = { rule: 'tool', reason: AUTO_STOP_REASONS.tool };
    }
    // The hook stopped this call, in the folder it runs in (Round 3): it stays a stop, whatever is read here.
    if (!hit && full.hookStop?.rule) hit = { rule: full.hookStop.rule, reason: full.hookStop.reason || AUTO_STOP_REASONS[full.hookStop.rule] || AUTO_STOP_REASONS.tool };
    // A push is the one hard line the Approver may judge: the fixed stops already refuse any push but the job's own branch to its fork.
    // Only the plain push: a command that also holds a gh call (an early pull request would end Auto with unreviewed work) is not it.
    // The job's own branch names are taken out first (n3), so a branch like feature/gh-pages is not read as a gh call.
    const plainPush = full.hardLine?.line === 'git-push' && !/\bgh\b/.test(withoutOwnBranches(String(full.input?.command ?? ''), ctx?.branches));
    const hardLineHit = !hit && Boolean(full.hardLine) && !plainPush;
    // A refused hard line's note and line come from REFUSE_REASONS by its id (refuseCard): no owner sentence is built for it (n1).
    if (hardLineHit) hit = { rule: 'blocked', reason: null };
    // A call Auto may never allow (a rule in REFUSED_RULES, or a hard line other than the plain push) is refused on its card,
    // and the job carries on (Auto queue, Task 5). Any other stop stays a stop.
    const refused = Boolean(hit) && (hardLineHit || REFUSED_RULES.includes(hit.rule));
    if (hit && !refused) return stopOnCard(job, hit, leave, { cardId: card.id });
    // The count belongs to one reply: it starts from 0 when the last answered brief is not the one it was kept with.
    // A refused card counts too, so the 41st card in one reply is a stop whatever it asks.
    const lastAnswered = Math.max(0, ...(job.answered ?? []));
    if (((job.auto.cardsBrief ?? 0) === lastAnswered ? job.auto.cards ?? 0 : 0) >= AUTO_CARDS_PER_REPLY) {
      return stopOnCard(job, { rule: 'loop', reason: `Auto has answered ${AUTO_CARDS_PER_REPLY} cards in one reply, so it needs you.` }, leave, { cardId: card.id });
    }
    // Before youSpokeSince on purpose: the call is one Auto may never allow, so his message does not make the card his to
    // answer here. To take such a card himself he switches Auto off (m1).
    if (refused) return refuseCard(job, full, hit, { leave, quietly, lastAnswered, hardLine: hardLineHit ? full.hardLine.line ?? '' : null });

    // The person wrote to the job (a message, or one steered into the reply) since Auto took the card up, while it
    // queued behind another: it is theirs, and the Approver is not asked. A stop on the card, and he is told.
    if (await youSpokeSince(job, takenAt, { steer: true })) return stopOnCard(job, { rule: 'blocked', reason: CARD_YOURS }, leave, { cardId: card.id });
    const task = { ...cardTask(job, full), facts: cardFacts(ctx, why, full, plainPush) };
    // The Approver never judges a card it cannot see whole (C4): a command or a field it would be shown cut stops instead.
    const cut = approverCut(task);
    if (cut) return stopOnCard(job, { rule: 'blocked', reason: `this ${cut} is too long for the Approver to read, so it needs you.` }, leave, { cardId: card.id });
    const roots = approverRoots({ featureDir: job.dir, worktrees: job.worktrees, specDirs: job.specDirs });
    // One ask, by the same rules for the first and the second: the answer, FAILED after a failure that is no dead end yet, or
    // null once the card is done with here.
    const FAILED = Symbol('failed');
    const askOne = async (t) => {
      const res = await askApprover(t, { roots, job });
      const cost = res?.ok === false && TIMED_OUT.test(res.problem ?? '') ? APPROVER_BUDGET_USD : Number.isFinite(res?.costUsd) ? res.costUsd : 0;
      const checked = res?.ok ? checkAnswer(t, res.answer) : null;
      // The Approver can take minutes: is the card still waiting, and is Auto still on and not stopped?
      const [fresh] = await read(job.dir);
      if (!waits() || !fresh || fresh.auto?.on !== true || fresh.auto.stopped || fresh.restarting) {
        await settleDropped(job, cost);
        // Auto went off, stopped or is restarting meanwhile: no stop is written for it (whenLeft: stopped, it is told; else silent).
        if (waits()) leave();
        return null;
      }
      // The person wrote to the job since Auto took the card up (while it waited, or while the Approver thought): the
      // Approver never saw that. The card is theirs: a stop on it, and he is told.
      if (await youSpokeSince(job, takenAt, { steer: true })) {
        await settleDropped(job, cost);
        await stopOnCard(job, { rule: 'blocked', reason: CARD_YOURS }, leave, { cardId: card.id });
        return null;
      }
      if (!checked?.ok) {
        let count = 0;
        const problem = res?.ok ? checked.problem : res?.problem ?? 'It ended with an error.';
        await update(job.dir, (prev) => { if (!prev) return null; count = (prev.failures ?? 0) + 1; return { ...prev, failures: count, problem, spent: (prev.spent ?? 0) + cost }; });
        // The same sentence as for a gate (stopFor): the problem without its closing full stop. On a second look the dead end
        // shows what the Approver first said, as for a gate.
        const hitAgain = fixedStop({ kind: 'job', failures: count, problem: String(problem).replace(/\.$/, '') });
        if (!hitAgain) return FAILED;
        await stopOnCard(job, hitAgain, leave, { cardId: card.id, ...(t.safer ? { why: firstWords(t.safer) } : {}) });
        return null;
      }
      await addSpent(job, cost);
      return checked.answer;
    };
    // A card has no later pass (the reply counts as running while it waits): one failure is asked again at once, with the same
    // task (a second look keeps the first answer). A second failure is the approver dead end, written by askOne.
    const ask = async (t) => {
      const first = await askOne(t);
      if (first !== FAILED) return first;
      const again = await askOne(t);
      return again === FAILED ? null : again; // still no dead end (the record could not count it): onPermission stops on the card
    };
    let asked = task;
    let answer = await ask(asked);
    if (!answer) return;
    // A stop, or an allow (or a question's go) the Approver itself calls high risk, is not acted on: it is asked once more, for
    // the safer answer, which is sent (the task carries the first answer: answerCard writes the risky call); an allow it calls
    // high risk again is sent as a deny.
    if (askSafer(answer)) {
      asked = { ...task, safer: answer };
      answer = await ask(asked);
      if (!answer) return;
    }
    await answerCard(job, full, asked, answer, { leave, quietly, lastAnswered });
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
    // A command is given whole, from the card's own input, not the card's trimmed preview (C4); so is a MultiEdit's, a
    // NotebookEdit's or an Agent's call (N15, callPreview), and the input as JSON for any tool whose preview is empty.
    // Another tool's preview says when it was cut. Whatever is longer than the Approver is shown stops Auto (approverCut).
    const command = card.toolName === 'Bash' && typeof card.input?.command === 'string' ? card.input.command : null;
    const call = command ?? callPreview(card.toolName, card.input);
    const shown = card.plain?.preview || card.plain?.detail || '';
    const whole = call ?? (shown ? null : JSON.stringify(card.input ?? {}, null, 2));
    return {
      ...base, kind: 'permission', questions: [],
      request: { tool: card.toolName, headline: card.plain?.headline ?? card.toolName, preview: whole ?? shown, cut: whole === null && card.plain?.previewCut != null },
    };
  }

  /**
   * A call Auto may never allow, refused on its card (Auto queue, Task 5): a deny with refuseNote, sent the way a click is, by
   * 'auto'; the Approver is never asked. One refuse line; the card counts toward AUTO_CARDS_PER_REPLY; failures stay as they
   * were; nobody is told. The answer is a deny on every path: a decision that fails leaves the card as answerCard does.
   */
  async function refuseCard(job, card, { rule, reason }, { leave, quietly, lastAnswered, hardLine = null }) {
    // The crew's reason, looked up (REFUSE_REASONS), never the owner's stop sentence; the refuse line's why is the same.
    let why = '';
    // For outside: which of its sentences hit (its key in OUTSIDE_REASONS), else the general row.
    const outside = rule === 'outside' ? Object.keys(OUTSIDE_REASONS).find((k) => OUTSIDE_REASONS[k] === reason) ?? null : null;
    try { why = refuseReason({ rule, outside, hardLine }); } catch { why = ''; }
    let note = '';
    try { note = refuseNote(rule, why); } catch { note = ''; } // still a deny, with the driver's own words for one of Auto's
    try {
      await decide.permission(card.id, { decision: 'deny', note }, { by: 'auto' });
    } catch (err) {
      await cardNotSent(job, card, err, { leave, quietly });
      return;
    }
    await update(job.dir, (prev) => (prev ? { ...prev, cards: ((prev.cardsBrief ?? 0) === lastAnswered ? prev.cards ?? 0 : 0) + 1, cardsBrief: lastAnswered } : null));
    const asked = oneLine(card.plain?.headline ?? card.toolName);
    await audit(job, 'refuse', { rule, asked, chose: `Refused: ${asked}`, why });
  }

  /**
   * Auto's decision on a card was refused at the driver. Auto-gone (Auto went off or stopped, or the job is closing or
   * restarting): nothing is written or told. Any other refusal while the card still waits: a stop on it, and he is told.
   */
  async function cardNotSent(job, card, err, { leave, quietly }) {
    const gone = codeOf(err) === 'auto-gone';
    if (!gone) console.error(`auto card (${job.slug}):`, err.message);
    await settleIfOff(job);
    if (!pendingCard(card.id)) return;
    // Auto-gone: no stop (quiet even while the record is on, for a job being closed or restarted); stopped, whenLeft tells it.
    if (gone) quietly();
    else await stopOnCard(job, { rule: 'blocked', reason: CARD_NOT_SENT }, leave, { cardId: card.id });
  }

  /** Send the decision the way a click does, by 'auto': once, or no. Writes the Auto line and counts the card. */
  async function answerCard(job, card, task, answer, { leave, quietly, lastAnswered }) {
    let decision;
    let note = '';
    let answers = null;
    let chose;
    let lines = null;
    let why = oneLine(answer.why);
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
    } else if (answer.decision === 'allow' && task.safer && answer.risk === 'high') {
      // High risk on both looks: the safer option on a card is a deny, and the job carries on.
      decision = 'deny';
      note = BOTH_HIGH_NOTE;
      chose = 'Said no';
      why = BOTH_HIGH_WHY;
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
      await cardNotSent(job, card, err, { leave, quietly });
      return;
    }
    // The second ask's answer (task.safer holds the first): a risky call, counted with the card.
    const risky = task.safer ? { risky: true, first: firstWords(task.safer) } : null;
    let spent = 0;
    await update(job.dir, (prev) => {
      if (!prev) return null;
      spent = prev.spent ?? 0;
      return { ...prev, failures: 0, problem: null, cards: ((prev.cardsBrief ?? 0) === lastAnswered ? prev.cards ?? 0 : 0) + 1, cardsBrief: lastAnswered, ...(risky ? { risky: riskyPlusOne(prev) } : {}) };
    });
    await audit(job, task.kind === 'question' ? 'question' : 'permission', {
      asked: oneLine(task.kind === 'question' ? task.questions.map((q) => q.text).join(' / ') : card.plain?.headline ?? card.toolName),
      chose, why, risk: answer.risk, ...(lines ? { answers: lines } : {}), costUsd: spent, ...risky,
    });
    await paidOff(job, spent);
  }

  return { pass, onPermission, cardGone, leftCard, handlingCard };
}
