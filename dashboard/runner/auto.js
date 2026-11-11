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
/** A refusal that says the answer is for something that has moved on: it is dropped. */
const MOVED_ON = new Set(['stale-brief', 'stale-gate']);
const TIMED_OUT = /^It took longer/;
/** Only a reply that came through a gate card is the person's decision; Starbase's own sends (resume, nudge, a stack's message) are not. */
const GATE_KINDS = new Set(['approve', 'changes', 'stop', 'message']);
/** "Not now" this many times running on one gate stops Auto, like the Approver failing twice. */
const NOT_NOW_LIMIT = 3;
/** A gate Auto can't act on (stale, or no brief number) stops Auto after this long. */
const STUCK_MS = 10 * 60_000;
const isNotNow = (err) => {
  const code = err?.extra?.code ?? err?.code ?? null;
  return NOT_NOW.has(code) || err?.constructor?.name === 'Busy' || err?.name === 'Busy' || err?.name === 'JobLocked';
};

export function createAuto({ read, update, decide, askApprover, pendingCard = () => null, cardCtx = async () => null, raiseLevel = async () => {}, changed = () => {}, state, notify = () => {}, stopping = () => {}, now = () => new Date() }) {
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
      try { await attend(job, gate); } catch (err) { console.error(`auto (${job.slug}):`, err.message); }
    }
  }

  const audit = (job, what, fields) => state.audit({ action: 'auto', what, featureDir: job.dir, slug: job.slug, stage: job.stage ?? null, asked: '', chose: '', why: '', ...fields });

  /** Auto stops and waits for you: the record says why, one audit line, one notification (none if it already had). Resolves true when it wrote the stop. */
  async function stop(job, { rule, reason }, { leave = false } = {}) {
    stopping(job.slug, true);
    try { return await writeStop(job, { rule, reason }, { leave }); } finally { stopping(job.slug, false); }
  }
  async function writeStop(job, { rule, reason }, { leave }) {
    const at = now().toISOString();
    let spent = 0;
    let wrote = false;
    await update(job.dir, (prev) => {
      // Auto was switched off, or already stopped: nothing to stop (leaving for L3 replaces a stop).
      if (prev?.on !== true || (!leave && prev.stopped)) return null;
      wrote = true;
      spent = prev.spent ?? 0;
      return { ...prev, ...(leave ? { on: false } : {}), stopped: { reason, rule, at }, spent: 0 };
    });
    if (!wrote) return false;
    await audit(job, 'stop', { rule, reason, why: reason, ...(spent > 0 ? { costUsd: spent } : {}) });
    // What the person should do, for every stop: the reason ends with its own full stop.
    const said = /[.!?]$/.test(reason) ? reason : `${reason}.`;
    notify({ level: 'needs', title: job.title, body: `Auto stopped: ${said} Open the job to answer.`, slug: job.slug, key: `auto-stop:${job.slug}:${at}` });
    if (leave) changed();
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
      return { ...prev, on: false, stopped: null, spent: 0, finished: at };
    });
    if (!wrote) return;
    await audit(job, 'finished', { why: 'PR #1 is open.', ...(spent > 0 ? { costUsd: spent } : {}) });
    notify({ level: 'done', title: 'Auto finished: PR #1 is open.', body: `${job.title}. Review it and merge it yourself when you're ready.`, slug: job.slug, key: `auto-finish:${job.slug}` });
    changed();
  }

  /** You decided something yourself after Auto stopped: it carries on from the next step. */
  async function carryOnIfYouDecided(job) {
    const stoppedAt = Date.parse(job.auto.stopped?.at ?? '');
    const lines = await state.auditFor(job.dir, 400);
    // Only the person's decision on a gate (a send that carries its brief) or on a card (the status card's answer is its own line) clears a stop.
    // An answer on the status card clears a stop made by a status card, and no other.
    const statusStop = job.auto.stopped?.rule === 'status';
    const yours = lines.some((l) => l.by !== 'auto' && Date.parse(l.at) > stoppedAt
      && ((l.action === 'send' && GATE_KINDS.has(l.kind) && l.gateBrief) || l.action === 'permission' || (statusStop && l.action === 'status_invalid_answer')));
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
    // A suggested L1 or L2 above the job's level is applied before the gate is answered (never lowered).
    const suggested = job.suggestedLevel;
    if ((suggested === 1 || suggested === 2) && !(job.level >= suggested)) {
      try { await raiseLevel(job, suggested); job.level = suggested; } catch (err) { console.error(`auto level (${job.slug}):`, err.message); return null; }
    }
    const gate = job.gate && !job.gate.stale && job.gate.briefNumber !== null && !job.answered.includes(job.gate.briefNumber) && job.gate.briefNumber !== job.auto.lastBrief ? job.gate : null;
    const hit = stopFor(job, job.auto, gate);
    if (hit) { await stop(job, hit); return null; }
    // The job waits for the person by its own record (a gate card, or needsYou) and this pass found no step Auto can act on
    // (stale, no brief number, or the brief is already answered): nobody is told by the pass, so after a while Auto says so.
    if ((job.gate || job.needsYou === true) && !gate) {
      const first = stuckFirst ?? now().getTime();
      if (now().getTime() - first >= STUCK_MS) {
        await stop(job, { rule: 'blocked', reason: "the step that waits can't be approved as it stands, so it needs you." });
        return null;
      }
      stuckSince.set(job.dir, first);
    }
    if (!gate) return null;
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
   */
  async function youSpokeSince(job, askedAt, { steer = false } = {}) {
    const lines = await state.auditFor(job.dir, 400);
    return lines.some((l) => l.by !== 'auto' && (l.action === 'send' || (steer && l.action === 'steer')) && Date.parse(l.at) >= askedAt);
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
      if (hit) return stop(job, hit);
      const route = fixedStop({ kind: 'gate', stage: job.stage, nextStage: gate.nextStage });
      if (route) return stop(job, route);
      if (notNow(job)) return;

      let task;
      let answer;
      let askedAt;
      const kept = held.get(job.dir);
      // A kept answer is sent only if the person has said nothing since the Approver was asked; its cost is already counted.
      if (kept?.brief === n && (await youSpokeSince(job, kept.askedAt))) { held.delete(job.dir); refused.delete(job.dir); return; }
      if (kept?.brief === n) {
        ({ task, answer, askedAt } = kept);
      } else {
        held.delete(job.dir);
        askedAt = Date.now();
        task = taskFor(job, gate);
        const roots = approverRoots({ featureDir: job.dir, worktrees: job.worktrees, specDirs: job.specDirs });
        const res = await askApprover(task, { roots, job });
        // A run that timed out is charged the ceiling it was given, whatever partial cost it reported.
        const cost = res?.ok === false && TIMED_OUT.test(res.problem ?? '') ? APPROVER_BUDGET_USD : Number.isFinite(res?.costUsd) ? res.costUsd : 0;
        const checked = res?.ok ? checkAnswer(task, res.answer) : null;
        // Immediately before anything is written or sent: is the answer still for something that waits?
        if (!(await look(job, n))) { await settleDropped(job, cost); return; }
        // The person wrote to the job while the Approver was thinking: it never saw that. Dropped; the next pass asks again.
        if (await youSpokeSince(job, askedAt)) { await settleDropped(job, cost); return; }
        if (!checked?.ok) {
          await update(job.dir, (prev) => (prev ? { ...prev, failures: (prev.failures ?? 0) + 1, problem: res?.ok ? checked.problem : res?.problem ?? 'It ended with an error.', spent: (prev.spent ?? 0) + cost } : null));
          continue;
        }
        answer = checked.answer;
        await addSpent(job, cost);
        if (answer.decision === 'stop') return stop(job, { rule: 'judgment', reason: oneLine(answer.why) });
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
      // What the Foreman decided for the person and has not confirmed: the Approver sees each, one line, capped like the questions.
      decided: (gate.decided ?? []).filter((d) => !d.confirmed).map((d) => ({ id: oneLine(d.id ?? d.decision).slice(0, 200), decision: oneLine(d.decision).slice(0, 2000), why: oneLine(d.reason).slice(0, 2000) })),
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
      if (MOVED_ON.has(err?.extra?.code ?? err?.code ?? null)) { held.delete(job.dir); return 'dropped'; }
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
      return { ...prev, lastBrief: gate.briefNumber, failures: 0, problem: null, spent: 0, cards: 0, cardsBrief: gate.briefNumber, step: { stage: job.stage, count } };
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
    const dir = card.featureDir;
    const mine = (queues.get(dir) ?? Promise.resolve())
      .then(() => attendCard(card, leftWaiting))
      .catch((err) => { console.error(`auto card (${card.slug}):`, err.message); })
      .finally(() => { if (queues.get(dir) === mine) queues.delete(dir); });
    queues.set(dir, mine);
    return mine;
  }

  /** A card that has gone away (answered, the reply ended) is forgotten. */
  function cardGone(id) { cards.delete(id); }

  /** A stop on the card: its own notification tells the person; when none was written, the card's notification does. */
  async function stopOnCard(job, hit, leave) {
    if (!(await stop(job, hit))) leave();
  }

  async function attendCard(card, leftWaiting) {
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

    const task = { ...cardTask(job, full), facts: cardFacts(ctx, why, full, plainPush) };
    // The Approver never judges a card it cannot see whole (C4): a command or a field it would be shown cut stops instead.
    const cut = approverCut(task);
    if (cut) return stopOnCard(job, { rule: 'blocked', reason: `this ${cut} is too long for the Approver to read, so it needs you.` }, leave);
    const roots = approverRoots({ featureDir: job.dir, worktrees: job.worktrees, specDirs: job.specDirs });
    const askedAt = Date.now();
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
    // The person wrote to the job while the Approver was thinking: it never saw that. The card is left to them.
    if (await youSpokeSince(job, askedAt, { steer: true })) {
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
      // Refused (the card went away between the look and the decision): nothing was sent. The cost stays in spent.
      console.error(`auto card (${job.slug}):`, err.message);
      if (pendingCard(card.id)) leave(); // refused but still waiting: the person is told once
      return;
    }
    let spent = 0;
    await update(job.dir, (prev) => {
      if (!prev) return null;
      spent = prev.spent ?? 0;
      return { ...prev, failures: 0, problem: null, spent: 0, cards: ((prev.cardsBrief ?? 0) === lastAnswered ? prev.cards ?? 0 : 0) + 1, cardsBrief: lastAnswered };
    });
    await audit(job, task.kind === 'question' ? 'question' : 'permission', {
      asked: oneLine(task.kind === 'question' ? task.questions.map((q) => q.text).join(' / ') : card.plain?.headline ?? card.toolName),
      chose, why: oneLine(answer.why), risk: answer.risk, ...(lines ? { answers: lines } : {}), costUsd: spent,
    });
  }

  return { pass, onPermission, cardGone };
}
