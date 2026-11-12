// Auto mode's switch (design Part 2): a per-job switch that lets Starbase answer gates for the person
// up to PR #1. Pure: no files, no clock unless one is given.
//
// Where it lives is the safety property. The only thing that says a job is in Auto is its record in
// Starbase's own sessions.json (lib/state.js setSession), which the Foreman cannot write. options.json
// in the job's folder carries `auto: true` and `auto_since` for the skills to read, but it only
// mirrors the record (autoOption): Starbase writes those two fields, and when the record says off it
// takes them out again, whoever put them there (the runner's pass over the jobs).
//
// The record, per job folder: { on, since, by: 'you' | 'tag', tag, ran, stopped, step, failures, lastBrief }
//   on         Auto is on now
//   since      when it was last turned on (options.json's auto_since)
//   by, tag    who turned it on: you, or the Auto tag (with the tag's name)
//   ran        it has been on at some point; stays true once set (the finish line is PR #1 open)
//   stopped    { reason, rule (one of AUTO_RULES), at } while Auto has stopped and waits for you, else null
//   step       { stage, count }: how many times Auto has answered at one stage, else null
//   failures   the Approver's failed answers in a row
//   lastBrief  the last brief Auto answered, else null
//   cards      the cards (a worker's question or permission) Auto has answered since the last gate; at
//              AUTO_CARDS_PER_REPLY the next one stops it (rule loop). Absent until the first card; back to 0 when a gate is answered or you clear a stop.
// Auto's pass (runner/auto.js) also keeps, while it runs: problem (why the last Approver answer failed),
// spent (the Approver's cost not yet written to an audit line) and finished (when PR #1 was seen open).

/** The highest level Auto runs at. */
export const AUTO_MAX_LEVEL = 2;

/** Why an L3 job (or one the Foreman suggests is L3) can't run in Auto. Exact words. */
export const AUTO_L3 = 'Auto works up to L2. An L3 job needs you to approve each step.';

/** The most cards (a worker's question or permission) Auto answers between two gates of one job. */
export const AUTO_CARDS_PER_REPLY = 40;

/** The fixed stop rules: the reasons Auto stops and waits for you, decided by code. */
export const AUTO_RULES = Object.freeze(['merge', 'database', 'outside', 'push', 'level', 'loop', 'approver', 'judgment', 'blocked', 'status', 'tool']);

const isLevel = (v) => Number.isInteger(v) && v >= 0 && v <= 3;
const aboveAuto = (v) => isLevel(v) && v > AUTO_MAX_LEVEL;

/**
 * Whether a job may run in Auto: not at L3, and not while the Foreman suggests L3, with or without
 * a level set (a proposed raise to L3 is the person's to decide, never the Approver's). No level yet
 * is allowed. Returns { ok, why } with why the exact sentence when it isn't.
 */
export function autoAllowed({ level = null, suggestedLevel = null } = {}) {
  if (aboveAuto(level) || aboveAuto(suggestedLevel)) return { ok: false, why: AUTO_L3 };
  return { ok: true, why: null };
}

/**
 * The record after turning Auto on or off. On starts fresh (since now, nothing stopped, no steps
 * or failures counted); off keeps the rest of the record, so `ran` stays true.
 */
export function autoRecord(prev, { on, by = 'you', tag = null, now = new Date().toISOString() } = {}) {
  if (on) return { on: true, since: now, by: by === 'tag' ? 'tag' : 'you', tag: by === 'tag' ? tag ?? null : null, ran: true, stopped: null, step: null, failures: 0, lastBrief: null };
  const was = prev && typeof prev === 'object' ? prev : { since: null, by: 'you', tag: null, ran: false, stopped: null, step: null, failures: 0, lastBrief: null };
  return { ...was, on: false, ran: was.ran === true };
}

/**
 * What a job's options.json should say about Auto: { on, since } from its record. On only while the
 * record says a literal true, and never above L2 (normalize drops it there too).
 */
export function autoOption(record, level = null) {
  const on = record?.on === true && !aboveAuto(level);
  return { on, since: on ? record.since ?? null : null };
}

/**
 * The board card's `auto`: { on, by, ran, stopped, deciding, allowed, why } (by: who turned it on; the tag is the job page's, added with it). deciding is false until
 * Auto answers gates (a later part); allowed and why are autoAllowed's, so the switch can say why
 * it is off at L3.
 */
export function autoCardView(sessionAuto, { level = null, suggestedLevel = null } = {}) {
  const on = sessionAuto?.on === true;
  const a = autoAllowed({ level, suggestedLevel });
  return { on, by: on ? (sessionAuto.by === 'tag' ? 'tag' : 'you') : null, ran: sessionAuto?.ran === true, stopped: on ? sessionAuto.stopped ?? null : null, deciding: false, allowed: a.ok, why: a.why };
}

// What Auto writes into the replies it sends for the person. A reply that carries this mark was
// sent by Starbase's Auto, not typed by the person: Decisions and Copy decisions say "(Auto)" for
// it and leave the mark itself out of the why.

export const AUTO_MARK = "(Sent by Starbase's Auto for the person. options.json says auto: true.)";

/**
 * The text without Auto's mark at its end (however many copies, with any spaces or lines between), for every message
 * Starbase sends to the Foreman other than Auto's own reply: only Auto's reply may end with the mark.
 */
export function withoutMark(text) {
  const t = String(text ?? '');
  let end = t.trimEnd();
  if (!end.endsWith(AUTO_MARK)) return t;
  while (end.endsWith(AUTO_MARK)) end = end.slice(0, -AUTO_MARK.length).trimEnd();
  return end;
}

/**
 * Sends that are Starbase's own, not the person's words: a nudge, a resume (after a restart, or the carry-on after a usage
 * limit), a status fix, PR feedback, a review round, a stack's start and its own news (ready, merged, stuck, checks failed).
 * A stack's messages that carry the person's own note or go (stack-plan, -plan-change, -push, -push-no, -sendback) are theirs.
 */
export const OWN_SENDS = new Set(['nudge', 'resume', 'resume-after-restart', 'status-fix', 'pr-feedback', 'review-round', 'stack-section', 'stack-ready', 'stack-merged', 'stack-stuck', 'stack-checks-failed']);

/** Auto's stop when the person wrote to a job while its step waited (I5). The board's lane says it from the moment they write. */
export const YOURS_NOW = 'you wrote to this job while this step waited, so it is yours to decide.';

/**
 * Did the person write to a job while its step waited? A message of their own in the job's audit `lines` (a send not by Auto
 * whose kind is not one of Starbase's own, OWN_SENDS; or one they steered into a running reply, which only their steer command
 * writes) later than both the current brief's time (`briefAt`, its file's time) and when Auto was last switched on or carried
 * on (`since`). A time not known sets no bound. Pure: the lines are given.
 */
export function wroteWhileWaiting(lines, { briefAt = null, since = null } = {}) {
  const times = [Date.parse(briefAt ?? ''), Date.parse(since ?? '')].filter(Number.isFinite);
  const from = times.length ? Math.max(...times) : -Infinity;
  return (lines ?? []).some((l) => l.by !== 'auto' && ((l.action === 'send' && !OWN_SENDS.has(l.kind)) || l.action === 'steer') && Date.parse(l.at) > from);
}
