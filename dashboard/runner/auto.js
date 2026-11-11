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

/** Anything the Approver wrote, on one line: nothing it writes can start a line of its own. */
const oneLine = (s) => String(s ?? '').replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
/** A refusal that is only "not now": the next pass looks again and nothing counts as a failure. */
const NOT_NOW = new Set(['stale-brief', 'stale-gate', 'busy', 'limited']);
const TIMED_OUT = /^It took longer/;

export function createAuto({ read, update, decide, askApprover, raiseLevel = async () => {}, changed = () => {}, state, notify = () => {}, now = () => new Date() }) {
  let running = null;
  let again = false;

  /** One pass at a time; a request during one runs once after it. */
  function pass() {
    if (running) { again = true; return running; }
    running = run().catch((err) => console.error('auto pass:', err)).finally(() => {
      running = null;
      if (again) { again = false; pass(); }
    });
    return running;
  }

  async function run() {
    for (const job of await read()) {
      try { await handle(job); } catch (err) { console.error(`auto (${job.slug}):`, err.message); }
    }
  }

  const audit = (job, what, fields) => state.audit({ action: 'auto', what, featureDir: job.dir, slug: job.slug, stage: job.stage ?? null, asked: '', chose: '', why: '', ...fields });

  /** Auto stops and waits for you: the record says why, one audit line, one notification. */
  async function stop(job, { rule, reason }, { leave = false } = {}) {
    const at = now().toISOString();
    let spent = 0;
    await update(job.dir, (prev) => {
      spent = prev?.spent ?? 0;
      return { ...prev, ...(leave ? { on: false } : {}), stopped: { reason, rule, at }, spent: 0 };
    });
    await audit(job, 'stop', { rule, reason, why: reason, ...(spent > 0 ? { costUsd: spent } : {}) });
    notify({ level: 'needs', title: job.title, body: `Auto stopped: ${reason}`, slug: job.slug, key: `auto-stop:${job.slug}:${at}` });
    if (leave) changed();
  }

  /** PR #1 is open: Auto is off, `ran` stays, and the person is told once. */
  async function finish(job) {
    const at = now().toISOString();
    let spent = 0;
    await update(job.dir, (prev) => {
      if (prev?.on !== true) return null;
      spent = prev.spent ?? 0;
      return { ...prev, on: false, stopped: null, spent: 0, finished: at };
    });
    await audit(job, 'finished', { why: 'PR #1 is open.', ...(spent > 0 ? { costUsd: spent } : {}) });
    notify({ level: 'done', title: 'Auto finished: PR #1 is open.', body: `${job.title}. Review it and merge it yourself when you're ready.`, slug: job.slug, key: `auto-finish:${job.slug}` });
    changed();
  }

  /** You decided something yourself after Auto stopped: it carries on from the next step. */
  async function carryOnIfYouDecided(job) {
    const stoppedAt = Date.parse(job.auto.stopped?.at ?? '');
    const lines = await state.auditFor(job.dir, 400);
    const yours = lines.some((l) => (l.action === 'send' || l.action === 'permission') && l.by !== 'auto' && Date.parse(l.at) > stoppedAt);
    if (!yours) return false;
    const at = now().toISOString();
    await update(job.dir, (prev) => (prev?.stopped ? { ...prev, stopped: null, failures: 0, problem: null, step: null, since: at } : null));
    return true;
  }

  async function handle(job) {
    if (job.restarting) return;
    if (job.prOpen) return finish(job);
    if (job.auto.stopped) { await carryOnIfYouDecided(job); return; }
    // A job at L3 (or one the Foreman suggests is L3) leaves Auto, even in the middle of a reply.
    if (!autoAllowed({ level: job.level, suggestedLevel: job.suggestedLevel }).ok) {
      return stop(job, fixedStop({ kind: 'job', level: job.level, suggestedLevel: job.suggestedLevel }), { leave: true });
    }
    if (job.running || job.locked || job.paused) return;
    // A suggested L1 or L2 above the job's level is applied before the gate is answered (never lowered).
    const suggested = job.suggestedLevel;
    if ((suggested === 1 || suggested === 2) && !(job.level >= suggested)) {
      try { await raiseLevel(job, suggested); job.level = suggested; } catch (err) { console.error(`auto level (${job.slug}):`, err.message); return; }
    }
    const gate = job.gate && !job.gate.stale && job.gate.briefNumber !== null && !job.answered.includes(job.gate.briefNumber) && job.gate.briefNumber !== job.auto.lastBrief ? job.gate : null;
    await attend(job, gate);
  }

  const stopFor = (job, rec, gate) => {
    const again = rec.step?.stage === job.stage ? rec.step.count : 0;
    return fixedStop({
      kind: 'job', level: job.level, suggestedLevel: job.suggestedLevel, triggers: job.triggers, stageState: job.stageState, statusCard: job.statusCard,
      step: gate ? { stage: job.stage, count: again + 1 } : null, failures: rec.failures ?? 0, problem: rec.problem ? String(rec.problem).replace(/\.$/, '') : null,
    });
  };

  async function attend(job, gate) {
    let rec = job.auto;
    for (let tries = 0; tries < 3; tries++) {
      const hit = stopFor(job, rec, gate);
      if (hit) return stop(job, hit);
      if (!gate) return;
      const route = fixedStop({ kind: 'gate', stage: job.stage, nextStage: gate.nextStage });
      if (route) return stop(job, route);

      const task = taskFor(job, gate);
      const roots = approverRoots({ featureDir: job.dir, worktrees: job.worktrees, specDirs: job.specDirs });
      const res = await askApprover(task, { roots, job });
      // A run that timed out reports 0: record the ceiling it was given, so the cost never under-counts.
      const cost = res?.ok === false && TIMED_OUT.test(res.problem ?? '') && !(res.costUsd > 0) ? APPROVER_BUDGET_USD : Number.isFinite(res?.costUsd) ? res.costUsd : 0;
      const checked = res?.ok ? checkAnswer(task, res.answer) : null;
      if (!checked?.ok) {
        rec = await update(job.dir, (prev) => ({ ...prev, failures: (prev?.failures ?? 0) + 1, problem: res?.ok ? checked.problem : res?.problem ?? 'It ended with an error.', spent: (prev?.spent ?? 0) + cost }));
        continue;
      }
      const answer = checked.answer;
      if (answer.decision === 'stop') {
        await update(job.dir, (prev) => ({ ...prev, spent: (prev?.spent ?? 0) + cost }));
        return stop(job, { rule: 'judgment', reason: oneLine(answer.why) });
      }
      const sent = await send(job, gate, task, answer, cost);
      if (sent === 'failed') { rec = (await currentOf(job)) ?? rec; continue; }
      return;
    }
  }

  const currentOf = async (job) => (await state.sessionFor?.(job.dir))?.auto ?? null;

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

  /** Send the approval through the same path as a click. Returns 'sent', 'not-now' or 'failed'. */
  async function send(job, gate, task, answer, cost) {
    const answers = {};
    for (const a of answer.answers) answers[a.id] = { choice: a.choice ?? undefined, other: a.other === null ? undefined : oneLine(a.other) };
    const verdicts = {};
    for (const d of gate.decided ?? []) if (!d.confirmed) verdicts[d.id ?? d.decision] = { verdict: 'confirm' };
    try {
      await decide.gate('approve', { slug: job.slug, briefNumber: gate.briefNumber, answers, verdicts, note: noteFor(task, answer) }, { by: 'auto' });
    } catch (err) {
      const code = err?.extra?.code ?? err?.code ?? null;
      if (NOT_NOW.has(code)) {
        await update(job.dir, (prev) => ({ ...prev, spent: (prev?.spent ?? 0) + cost }));
        return 'not-now';
      }
      await update(job.dir, (prev) => ({ ...prev, failures: (prev?.failures ?? 0) + 1, problem: oneLine(err?.message) || 'The reply was refused.', spent: (prev?.spent ?? 0) + cost }));
      return 'failed';
    }
    let spent = 0;
    await update(job.dir, (prev) => {
      spent = (prev?.spent ?? 0) + cost;
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
