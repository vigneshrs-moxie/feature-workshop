// Auto's pass (design Part 2): for each job whose record says Auto is on, answer the gate that waits,
// the way a click would (the same gateDecision path), or stop and tell the person why. The runner
// wires it (createRunner) and calls pass() from the change timer and when a reply ends, next to
// checkWaiting; this file asks nothing of the world but what it is given:
//
//   read()              the Auto jobs now (runner `autoJobs`): one object per job, see `handle`
//   update(dir, fn)     change the job's record under the Auto lock: fn(prev) returns the next record
//                       (or null for no change); resolves the record as saved. Keeps options.json in line.
//   decide.gate(kind, body, { by })   gateDecision; decide.permission is for the permission cards (a later task)
//   askApprover(task, { roots, job }) lib/approver.js askApprover with the runner's query and options
//   raiseLevel(job, level)            apply the Foreman's suggested level (setLevelAutomatically)
//   changed()           a record changed in a way other parts show (permission modes, the page)
//   state               audit() and auditFor()
//   notify(n)           one notification { level, title, body, slug, key }
//   now()               a Date, for tests
//
// Everything Auto writes is an audit line { action: 'auto', what, stage, asked, chose, why, ... } and
// nothing reaches the Foreman but through decide.gate with by: 'auto'.

import { autoAllowed, AUTO_MARK } from '../lib/auto.js';
import { fixedStop } from '../lib/auto-rules.js';
import { APPROVER_BUDGET_USD, approverPaths, approverRoots, checkAnswer } from '../lib/approver.js';

/** Anything the Approver wrote, on one line: nothing it writes can start a line of its own, and no copy of the mark gets through. */
const oneLine = (s) => {
  const flat = (t) => t.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return flat(flat(String(s ?? '')).split(AUTO_MARK).join(' '));
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
const isNotNow = (err) => {
  const code = err?.extra?.code ?? err?.code ?? null;
  return NOT_NOW.has(code) || err?.constructor?.name === 'Busy' || err?.name === 'Busy' || err?.name === 'JobLocked';
};

export function createAuto({ read, update, decide, askApprover, raiseLevel = async () => {}, changed = () => {}, state, notify = () => {}, now = () => new Date() }) {
  let running = null;
  let again = false;
  // An answer the Approver gave that could not be sent "not now" is kept for that job and brief and sent
  // on a later pass without asking (and paying) again; and how many "not now" in a row one gate has had.
  const held = new Map(); // dir -> { brief, task, answer }
  const refused = new Map(); // dir -> { brief, count }

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

  /** Auto stops and waits for you: the record says why, one audit line, one notification (none if it already had). */
  async function stop(job, { rule, reason }, { leave = false } = {}) {
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
    if (!wrote) return;
    await audit(job, 'stop', { rule, reason, why: reason, ...(spent > 0 ? { costUsd: spent } : {}) });
    notify({ level: 'needs', title: job.title, body: `Auto stopped: ${reason}`, slug: job.slug, key: `auto-stop:${job.slug}:${at}` });
    if (leave) changed();
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
    // Only the person's decision on a gate (a send that carries its brief) or on a card clears a stop.
    const yours = lines.some((l) => l.by !== 'auto' && Date.parse(l.at) > stoppedAt
      && ((l.action === 'send' && GATE_KINDS.has(l.kind) && l.gateBrief) || l.action === 'permission'));
    if (!yours) return false;
    const at = now().toISOString();
    await update(job.dir, (prev) => (prev?.stopped ? { ...prev, stopped: null, failures: 0, problem: null, step: null, since: at } : null));
    return true;
  }

  /** Everything about one job that needs no Approver. Returns the gate to ask about, or null. */
  async function triage(job) {
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
      const kept = held.get(job.dir);
      if (kept?.brief === n) {
        ({ task, answer } = kept);
      } else {
        held.delete(job.dir);
        task = taskFor(job, gate);
        const roots = approverRoots({ featureDir: job.dir, worktrees: job.worktrees, specDirs: job.specDirs });
        const res = await askApprover(task, { roots, job });
        // A run that timed out is charged the ceiling it was given, whatever partial cost it reported.
        const cost = res?.ok === false && TIMED_OUT.test(res.problem ?? '') ? APPROVER_BUDGET_USD : Number.isFinite(res?.costUsd) ? res.costUsd : 0;
        const checked = res?.ok ? checkAnswer(task, res.answer) : null;
        // Immediately before anything is written or sent: is the answer still for something that waits?
        if (!(await look(job, n))) { await addSpent(job, cost); return; }
        if (!checked?.ok) {
          await update(job.dir, (prev) => ({ ...prev, failures: (prev?.failures ?? 0) + 1, problem: res?.ok ? checked.problem : res?.problem ?? 'It ended with an error.', spent: (prev?.spent ?? 0) + cost }));
          continue;
        }
        answer = checked.answer;
        await addSpent(job, cost);
        if (answer.decision === 'stop') return stop(job, { rule: 'judgment', reason: oneLine(answer.why) });
      }
      const sent = await send(job, gate, task, answer);
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
  async function send(job, gate, task, answer) {
    const n = gate.briefNumber;
    const answers = {};
    for (const a of answer.answers) answers[a.id] = { choice: a.choice ?? undefined, other: a.other === null ? undefined : oneLine(a.other) };
    const verdicts = {};
    for (const d of gate.decided ?? []) if (!d.confirmed) verdicts[d.id ?? d.decision] = { verdict: 'confirm' };
    try {
      await decide.gate('approve', { slug: job.slug, briefNumber: n, answers, verdicts, note: noteFor(task, answer) }, { by: 'auto' });
    } catch (err) {
      if (MOVED_ON.has(err?.extra?.code ?? err?.code ?? null)) { held.delete(job.dir); return 'dropped'; }
      if (isNotNow(err)) {
        // Kept for a later pass (no second ask, no second charge); three in a row stop Auto.
        held.set(job.dir, { brief: n, task, answer });
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
      await update(job.dir, (prev) => ({ ...prev, failures: (prev?.failures ?? 0) + 1, problem: oneLine(err?.message) || 'The reply was refused.' }));
      return 'failed';
    }
    held.delete(job.dir); refused.delete(job.dir);
    let spent = 0;
    await update(job.dir, (prev) => {
      spent = prev?.spent ?? 0;
      const count = prev?.step?.stage === job.stage ? prev.step.count + 1 : 1;
      return { ...prev, lastBrief: gate.briefNumber, failures: 0, problem: null, spent: 0, step: { stage: job.stage, count } };
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

  return { pass };
}
