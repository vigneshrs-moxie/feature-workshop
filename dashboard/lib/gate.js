// The gate: the moment the Foreman has briefed you and waits for your decision (an approval, or
// answers to its questions). Worked out here from the job's records so the job page (GateCard,
// phase 2) and the 4-hour parking timer in server.js agree on it.
//
//   gateView        what the page shows on the gate card; null when the Foreman isn't waiting
//   RaisedVersions  the spec and artifact versions each brief was raised at (staleness guard)
//   answeredBriefs  the briefs a gate reply was already sent for (audit 'send' lines with gateBrief)
//   GateParking     which gates have been waiting too long; each one is alerted once
//
// Nothing here asks a model. The only thing written is GateParking's small file of alerted gates.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { STAGES } from './stages.js';

/** A gate untouched this long is "parked": an alert, and a chip on the job's row (decision D3). */
export const GATE_PARK_MS = 4 * 60 * 60 * 1000;

// Stages that spend real usage; the gate card warns about the usage limit before one of them.
const HEAVY_STAGES = ['implement', 'test', 'review'];
const HEAVY_WORDS = /\b(build|implement\w*|fix round)\b/i;

/** Whether the Foreman is waiting for you: its record says waiting_for_you, or that it waits for an approval or answers. */
export function isGateWaiting({ stageState = null, waitingFor = null } = {}) {
  return stageState === 'waiting_for_you' || waitingFor === 'approval' || waitingFor === 'answers';
}

/**
 * The versions status.json names right now: { spec: '0.3' | null, artifacts: { name: version } }.
 * Null when the job has no status.json (no versions are known then).
 */
export function versionsFrom(status) {
  if (!status) return null;
  const artifacts = {};
  for (const a of status.artifacts ?? []) if (a?.name) artifacts[a.name] = a.version ?? null;
  return { spec: status.spec?.version ?? null, artifacts };
}

/** The stage after `stage` that this job runs (skipped stages left out); null at the end or when unknown. */
export function nextStageAfter(stage, skipped = []) {
  const ids = STAGES.map((s) => s.id).filter((id) => !skipped.includes(id));
  const i = ids.indexOf(stage);
  return i >= 0 && i < ids.length - 1 ? ids[i + 1] : null;
}

const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * One short line about Claude's usage limit, for a gate whose next step spends real usage (build,
 * test, review): when the limit is reached (jobs are paused) or close. Null otherwise.
 * usage: the limit watch's view (lib/limits.js view()). nextLabel: "Build", "Review"...
 */
export function usageLine(usage, { heavy = false, nextLabel = null, time = clock } = {}) {
  if (!heavy || !usage) return null;
  const next = nextLabel ?? 'The next stage';
  if (usage.limited) {
    const when = usage.resetsAt ? ` (${usage.resetKnown ? 'it resets' : 'trying again'} around ${time(usage.resetsAt)})` : '';
    return `Paused: Claude’s ${usage.label ?? 'usage limit'} is reached${when}. ${next} can’t start before then.`;
  }
  const w = usage.warning;
  if (w) {
    const pct = typeof w.percent === 'number' ? ` is at ${w.percent}%` : ' is close';
    return `Claude’s ${w.label ?? 'usage limit'}${pct}${w.resetsAt ? ` (resets around ${time(w.resetsAt)})` : ''}: ${next} may pause part-way.`;
  }
  return null;
}

/** Whether versions name anything at all: a spec version or an artifact with a version. */
export function hasVersions(v) {
  return Boolean(v && (v.spec != null || Object.values(v.artifacts ?? {}).some((x) => x != null)));
}

/**
 * Whether the versions a gate was raised at still hold: the spec and every artifact named then
 * have the same version now. An artifact added since doesn't count as a change to what was proposed.
 */
export function sameVersions(raised, now) {
  if (!raised || !now) return true;
  if ((raised.spec ?? null) !== (now.spec ?? null)) return false;
  return Object.entries(raised.artifacts ?? {}).every(([name, v]) => (now.artifacts ?? {})[name] === v);
}

/**
 * The spec and artifact versions each brief was raised at: what status.json named the first time
 * it named that brief with any version in it. A first sighting with no versions at all isn't kept
 * (the Foreman may write the brief before the versions), so the next one with versions counts.
 * Kept in memory only: a dashboard restart starts over from what status.json says then.
 */
export class RaisedVersions {
  constructor() { this.map = new Map(); }

  static key(dir, file) { return `${dir}\n${file}`; }

  /** Remember `versions` for this brief unless some are already remembered. */
  note(dir, file, versions) {
    if (!dir || !file || !hasVersions(versions)) return;
    const key = RaisedVersions.key(dir, file);
    if (!this.map.has(key)) this.map.set(key, structuredClone(versions));
  }

  get(dir, file) { return this.map.get(RaisedVersions.key(dir, file)) ?? null; }
}

/**
 * The gate card's content, or null when the Foreman isn't waiting for you.
 * job: { stage, stageState, waitingFor, skipped, nextProposed, questions, decided, versions,
 *        waitingSince, level, suggestedLevel, levelReason }
 * brief: { number, file, headline } of the brief the Foreman is waiting on (or null).
 * raisedVersions: the versions remembered for that brief (RaisedVersions); the ones now when none.
 * parked: whether this gate has been waiting longer than the parking time (never while a run is active).
 * runActive: whether the Foreman is working on a reply for this job right now.
 * usage: the limit watch's view.
 */
export function gateView(job, { brief = null, raisedVersions = null, parked = false, runActive = false, usage = null, time } = {}) {
  if (!job || !isGateWaiting(job)) return null;
  const nextStage = nextStageAfter(job.stage, job.skipped ?? []);
  const heavy = HEAVY_STAGES.includes(nextStage) || HEAVY_WORDS.test(job.nextProposed ?? '');
  const nextLabel = STAGES.find((s) => s.id === nextStage)?.label ?? null;
  const versions = job.versions ?? null;
  const raised = raisedVersions ?? versions;
  return {
    briefNumber: brief?.number ?? null,
    briefFile: brief?.file ?? null,
    headline: brief?.headline ?? null,
    stage: job.stage ?? null,
    nextStage,
    nextProposed: job.nextProposed ?? null,
    questions: (job.questions ?? []).slice(0, 3),
    decided: job.decided ?? [],
    versions,
    raisedVersions: raised,
    // The spec or plan moved since this gate was raised: the card greys out.
    stale: Boolean(raised && versions && !sameVersions(raised, versions)),
    waitingSince: job.waitingSince ?? null,
    runActive: Boolean(runActive),
    parked: Boolean(parked) && !runActive,
    level: job.level ?? null,
    suggestedLevel: job.suggestedLevel ?? null,
    levelReason: job.levelReason ?? null,
    usage: usageLine(usage, { heavy, nextLabel, ...(time ? { time } : {}) }),
  };
}

/**
 * The brief numbers a gate reply was sent for, oldest first. A reply sent from a gate card carries
 * `gateBrief` (its brief's number) on its audit 'send' line; other sends don't count.
 */
export function answeredBriefs(audit = []) {
  const out = new Set();
  for (const e of audit) if (e?.action === 'send' && Number.isInteger(e.gateBrief) && e.gateBrief > 0) out.add(e.gateBrief);
  return [...out].sort((a, b) => a - b);
}

/**
 * Whether a waiting job's gate can be parked: the Foreman waits for a decision, not only for a
 * permission click (those have their own prompt).
 */
export function isParkable(job) {
  return isGateWaiting(job) && job.waitingFor !== 'permission';
}

/**
 * Gate parking. A gate is parked by time: waiting at least thresholdMs since waitingSince, not
 * answered from a gate card, and no reply running for the job. Each parked gate is alerted once;
 * the alerted ones (keyed slug#brief#waitingSince) are kept in `file` (a small JSON file in the
 * dashboard's state folder) so a restart doesn't alert old gates again. Briefs answered from a gate
 * card are remembered here (noteAnswered) so the audit file isn't read on every check.
 * thresholdMs, now and file are injectable for tests.
 *
 * A gate: { slug, briefNumber, waitingSince, runActive }.
 */
export class GateParking {
  constructor({ thresholdMs = GATE_PARK_MS, now = () => Date.now(), file = null } = {}) {
    this.thresholdMs = thresholdMs;
    this.now = now;
    this.file = file;
    this.alerted = new Set();
    this.answered = new Set();
  }

  static key({ slug, briefNumber, waitingSince }) { return `${slug}#${briefNumber ?? '-'}#${waitingSince ?? '-'}`; }

  /** A gate reply was sent for this job's brief (an audit 'send' line with gateBrief). */
  noteAnswered(slug, briefNumber) {
    if (slug && Number.isInteger(briefNumber) && briefNumber > 0) this.answered.add(`${slug}#${briefNumber}`);
  }

  isAnswered(slug, briefNumber) { return this.answered.has(`${slug}#${briefNumber}`); }

  /** Parked now: long enough untouched, not answered, nothing running. */
  isParked(g) {
    if (!g?.slug || g.runActive || this.isAnswered(g.slug, g.briefNumber)) return false;
    const since = Date.parse(g.waitingSince ?? '');
    return Number.isFinite(since) && this.now() - since >= this.thresholdMs;
  }

  /** Of the gates waiting now, the parked ones not alerted yet. */
  due(gates = []) {
    return gates.filter((g) => this.isParked(g) && !this.alerted.has(GateParking.key(g)));
  }

  /** Record a gate as alerted, so it isn't alerted again. */
  mark(g) { this.alerted.add(GateParking.key(g)); }

  /** Forget alerted gates that are no longer waiting (gates: all waiting now). Whether anything was dropped. */
  trim(gates = []) {
    const waiting = new Set(gates.map((g) => GateParking.key(g)));
    let dropped = false;
    for (const k of this.alerted) if (!waiting.has(k)) { this.alerted.delete(k); dropped = true; }
    return dropped;
  }

  /** Read the alerted gates from `file` (missing or unreadable: none). */
  async load() {
    if (!this.file) return;
    try {
      const raw = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      for (const k of Array.isArray(raw?.alerted) ? raw.alerted : []) if (typeof k === 'string') this.alerted.add(k);
    } catch { /* none yet */ }
  }

  /** Write the alerted gates to `file`, atomically (a temp file renamed over it). */
  async save() {
    if (!this.file) return;
    await fsp.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify({ alerted: [...this.alerted].sort() }, null, 2)}\n`, { mode: 0o600 });
    await fsp.rename(tmp, this.file);
  }
}
