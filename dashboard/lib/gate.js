// The gate: the moment the Foreman has briefed you and waits for your decision (an approval, or
// answers to its questions). Worked out here from the job's records so the job page (GateCard,
// phase 2) and the 4-hour parking timer in server.js agree on it.
//
//   gateView        what the page shows on the gate card; null when the Foreman isn't waiting
//   answeredBriefs  the briefs a gate reply was already sent for (audit 'send' lines with gateBrief)
//   GateParking     which gates have been waiting too long; each (job, brief) is reported once
//
// Nothing here writes anything or asks a model.

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

/**
 * The gate card's content, or null when the Foreman isn't waiting for you.
 * job: { stage, stageState, waitingFor, skipped, nextProposed, questions, decided, versions,
 *        waitingSince, level, suggestedLevel, levelReason }
 * brief: { number, file, headline } of the brief the Foreman is waiting on (or null).
 * parked: whether this gate has been waiting longer than the parking time.
 * usage: the limit watch's view.
 */
export function gateView(job, { brief = null, parked = false, usage = null, time } = {}) {
  if (!job || !isGateWaiting(job)) return null;
  const nextStage = nextStageAfter(job.stage, job.skipped ?? []);
  const heavy = HEAVY_STAGES.includes(nextStage) || HEAVY_WORDS.test(job.nextProposed ?? '');
  const nextLabel = STAGES.find((s) => s.id === nextStage)?.label ?? null;
  return {
    briefNumber: brief?.number ?? null,
    briefFile: brief?.file ?? null,
    headline: brief?.headline ?? null,
    stage: job.stage ?? null,
    nextStage,
    nextProposed: job.nextProposed ?? null,
    questions: (job.questions ?? []).slice(0, 3),
    decided: job.decided ?? [],
    versions: job.versions ?? null,
    waitingSince: job.waitingSince ?? null,
    parked: Boolean(parked),
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
 * Remembers which gates were reported as parked, in memory only: a dashboard restart forgets them,
 * so a gate still waiting is reported (once) again after a restart. thresholdMs and now are
 * injectable for tests.
 */
export class GateParking {
  constructor({ thresholdMs = GATE_PARK_MS, now = () => Date.now() } = {}) {
    this.thresholdMs = thresholdMs;
    this.now = now;
    this.alerted = new Set();
  }

  static key(slug, briefNumber) { return `${slug}#${briefNumber ?? '-'}`; }

  isParked(slug, briefNumber) { return this.alerted.has(GateParking.key(slug, briefNumber)); }

  /** gates: [{ slug, briefNumber, waitingSince }] waiting now. The ones past the threshold and not reported yet. */
  due(gates = []) {
    const at = this.now();
    return gates.filter((g) => {
      if (!g?.slug || this.isParked(g.slug, g.briefNumber)) return false;
      const since = Date.parse(g.waitingSince ?? '');
      return Number.isFinite(since) && at - since >= this.thresholdMs;
    });
  }

  /** Record a gate as reported, so it isn't reported again. */
  mark({ slug, briefNumber }) { this.alerted.add(GateParking.key(slug, briefNumber)); }
}
