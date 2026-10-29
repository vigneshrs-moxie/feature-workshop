// Telemetry's insight graphs (packet P): the cleaned record every graph reads, then the ten graphs.
//
// ---------- The cleaned record ----------
// One pass over the usage lines (lib/usage-log.js) gives every graph the same tidy rows:
//   - demo lines (`demo: true`) and lines from test folders go: the same temp-folder rule as
//     lib/history.js (os.tmpdir(), /tmp and /private/tmp), applied to any folder a line names
//     (`featureDir`, `dir`, `cwd`) and to the jobs the job list says live in one;
//   - each line counts once: a turn's lines share a `turn` id, one per worker and model, so a line
//     written twice (the same turn, worker, model and stage) is dropped, and sums never add a turn's
//     cost twice;
//   - model ids fold into families (lib/cost.js modelFamily: opus, sonnet, haiku, fable);
//   - a resumed session's cost is taken by difference, as usage-log does: an older line whose cost
//     is the session's whole running total (Claude Code's total_cost_usd carried over a resume) is cut
//     to the rise since the session's turn before. A running total is never added again;
//   - a week with no meter reading is marked as such (meteredWeeks), never guessed;
//   - outliers stay in the rows and tables, but a graph caps them (capOutliers) and says so;
//   - the audit log (send-backs, answers to the Foreman) and the job list (route size, the finish
//     line, PR #1) join in by job, for the graphs on rework, waiting on you and time to PR #1.
// Pure: nothing here reads a file. The runner hands in the lines, the audit lines and the jobs.
import { modelFamily } from './cost.js';
import { tempDirs } from './platform.js';
import { STAGE_IDS } from './stages.js';

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));
const r6 = (n) => Math.round(n * 1e6) / 1e6;

/** Whether a folder is under a temp folder (the test-folder rule of lib/history.js). */
export function isTempPath(p, roots = tempDirs()) {
  if (typeof p !== 'string' || !p) return false;
  return roots.some((t) => p === t || p.startsWith(`${t}/`) || p.startsWith(`${t}\\`));
}

// The stages from PR #1 on: a job seen at any of them has reached PR #1.
const PR_STAGES = new Set(STAGE_IDS.slice(STAGE_IDS.indexOf('pr1')));
// A gate decision that answers the Foreman (lib/gate.js DECIDING_KINDS), and a plain answer.
const ANSWERS = new Set(['approve', 'changes', 'stop', 'answer', 'answers']);

const slugOfAudit = (e) => e.slug ?? (typeof e.featureDir === 'string' ? e.featureDir.split(/[\\/]/).filter(Boolean).at(-1) : null) ?? null;
const lineKey = (l) => (l.turn ? `${l.turn}|${l.worker ?? ''}|${l.model ?? ''}|${l.stage ?? ''}` : `${l.t}|${l.worker ?? ''}|${l.model ?? ''}|${l.session ?? ''}|${l.job ?? ''}`);
const tokensOf = (t) => ({ input: +t?.input || 0, output: +t?.output || 0, cacheRead: +t?.cacheRead || 0, cacheWrite5m: +t?.cacheWrite5m || 0, cacheWrite1h: +t?.cacheWrite1h || 0 });
const meterOf = (m) => (m && typeof m.percent === 'number' ? { percent: m.percent, resetsAt: m.resetsAt ?? null } : null);

/**
 * The cleaned record. lines: usage lines (any order). opts:
 *   now        lines after it are dropped (a clock that ran ahead)
 *   tempRoots  the temp folders (tempDirs() when omitted)
 *   jobs       [{ slug, title, route, finished, finishedAt, dir }] from the job list, or null
 *   audit      the audit lines, or null when they weren't handed in
 * Returns { rows, dropped: { demo, temp, repeated, unreadable }, fixed, sendBacks, answers, jobs, hasAudit, hasJobs }.
 */
export function cleanRecord(lines, { now = Date.now(), tempRoots = tempDirs(), jobs = null, audit = null } = {}) {
  const end = ms(now);
  const jobList = Array.isArray(jobs) ? jobs : [];
  const tempJobs = new Set(jobList.filter((j) => isTempPath(j.dir, tempRoots)).map((j) => j.slug));
  const dropped = { demo: 0, temp: 0, repeated: 0, unreadable: 0 };
  const seen = new Set();
  const kept = [];
  for (const l of [...lines].sort((a, b) => ms(a?.t) - ms(b?.t))) {
    if (!l || !Number.isFinite(ms(l.t)) || ms(l.t) > end) { dropped.unreadable++; continue; }
    if (l.demo === true) { dropped.demo++; continue; }
    if ([l.featureDir, l.dir, l.cwd].some((p) => isTempPath(p, tempRoots)) || (l.job && tempJobs.has(l.job))) { dropped.temp++; continue; }
    const key = lineKey(l);
    if (seen.has(key)) { dropped.repeated++; continue; }
    seen.add(key);
    kept.push(l);
  }

  // A resumed session's cost by difference: per session, turn by turn, Claude Code's running total.
  const usdOf = new Map(kept.map((l) => [l, typeof l.costUsd === 'number' && Number.isFinite(l.costUsd) ? Math.max(0, l.costUsd) : 0]));
  let fixed = 0;
  const sessions = new Map();
  for (const l of kept) {
    if (!l.session || l.costSource !== 'cli' || typeof l.cliTotalUsd !== 'number') continue;
    if (!sessions.has(l.session)) sessions.set(l.session, new Map());
    const turns = sessions.get(l.session);
    const id = l.turn ?? l.t;
    if (!turns.has(id)) turns.set(id, []);
    turns.get(id).push(l);
  }
  for (const turns of sessions.values()) {
    let before = null;
    for (const list of turns.values()) {
      const total = list[0].cliTotalUsd;
      const sum = list.reduce((s, l) => s + usdOf.get(l), 0);
      if (before !== null && before > 0 && total >= before && Math.abs(sum - total) < 1e-6) {
        const k = sum > 0 ? (total - before) / sum : 0;
        for (const l of list) usdOf.set(l, usdOf.get(l) * k);
        fixed++;
      }
      before = total;
    }
  }

  const rows = kept.map((l) => ({
    t: new Date(ms(l.t)).toISOString(), ms: ms(l.t), user: l.user ?? 'unknown', job: l.job ?? null, ticket: l.ticket ?? null,
    stage: l.stage ?? null, worker: l.worker ?? null, model: l.model ?? null, family: modelFamily(l.model) ?? (l.model ? 'other' : 'unknown'),
    usd: r6(usdOf.get(l)), tokens: tokensOf(l.tokens), turn: l.turn ?? null, session: l.session ?? null,
    week: meterOf(l.meters?.week), fiveHour: meterOf(l.meters?.fiveHour),
  }));

  // The joins: the job list (route size, the finish line), and the audit's send-backs and answers.
  const stageAt = (slug, t) => {
    let stage = null;
    for (const r of rows) { if (r.ms > t) break; if (r.job === slug && r.stage) stage = r.stage; }
    return stage;
  };
  const byJob = new Map();
  for (const r of rows) {
    if (!r.job) continue;
    const j = byJob.get(r.job) ?? { slug: r.job, title: null, route: null, finished: null, finishedAt: null, firstAt: r.t, pr1At: null, ticket: r.ticket, user: r.user, usd: 0 };
    j.usd += r.usd;
    if (!j.pr1At && r.stage && PR_STAGES.has(r.stage)) j.pr1At = r.t;
    byJob.set(r.job, j);
  }
  for (const j of jobList) {
    if (!j?.slug || tempJobs.has(j.slug)) continue;
    const have = byJob.get(j.slug);
    if (!have) continue; // a job with no usage line has nothing for these graphs
    Object.assign(have, { title: j.title ?? null, route: j.route ?? null, finished: typeof j.finished === 'boolean' ? j.finished : null, finishedAt: j.finishedAt ?? null });
    if (j.pr1At && (!have.pr1At || ms(j.pr1At) < ms(have.pr1At))) have.pr1At = j.pr1At;
  }
  const auditList = Array.isArray(audit) ? audit.filter((e) => e && Number.isFinite(ms(e.at ?? e.t)) && !isTempPath(e.featureDir, tempRoots)).sort((a, b) => ms(a.at ?? a.t) - ms(b.at ?? b.t)) : [];
  const atOf = (e) => ms(e.at ?? e.t);
  const sendBacks = auditList.filter((e) => e.action === 'send' && e.kind === 'changes').map((e) => {
    const slug = slugOfAudit(e);
    return { t: new Date(atOf(e)).toISOString(), ms: atOf(e), slug, stage: stageAt(slug, atOf(e)) ?? e.stage ?? null };
  }).filter((e) => e.slug && byJob.has(e.slug));
  const answers = auditList.filter((e) => e.action === 'send' && ANSWERS.has(e.kind)).map((e) => ({ t: new Date(atOf(e)).toISOString(), ms: atOf(e), slug: slugOfAudit(e), kind: e.kind }))
    .filter((e) => e.slug && byJob.has(e.slug));

  return { rows, dropped, fixed, sendBacks, answers, jobs: byJob, hasAudit: Array.isArray(audit), hasJobs: Array.isArray(jobs) };
}

/** Which of the plan weeks ({ from, to } in ms) have at least one meter reading among the rows. */
export function meteredWeeks(rows, weeks) {
  return weeks.map((w) => ({ ...w, metered: rows.some((r) => r.ms >= w.from && r.ms < w.to && r.week) }));
}

/**
 * An outlier cap for a graph: values above the upper fence (the third quartile plus three times
 * the spread of the middle half) are drawn at the fence and noted. Needs five values or more.
 * Returns { cap, capped: [index] } (cap null when nothing is capped).
 */
export function capOutliers(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 5) return { cap: null, capped: [] };
  const q = (p) => quantile(v, p);
  const fence = q(0.75) + 3 * (q(0.75) - q(0.25));
  const capped = values.map((x, i) => (x > fence ? i : -1)).filter((i) => i >= 0);
  return capped.length && fence > 0 ? { cap: fence, capped } : { cap: null, capped: [] };
}

/** The p-quantile (0..1) of sorted numbers, by straight-line steps between neighbours. */
export function quantile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
export const median = (values) => quantile([...values].sort((a, b) => a - b), 0.5);
