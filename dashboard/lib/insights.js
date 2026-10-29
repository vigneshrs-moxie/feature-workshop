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
// insights.js and telemetry.js import each other: each uses the other's functions only when called.
import { modelFamily, PRICES, whatIfConductor } from './cost.js';
import os from 'node:os';
import path from 'node:path';
import { STAGE_IDS, STAGES } from './stages.js';
import {
  forecast as forecastOf, limitSplit, localDate, localTime, OTHER_NOTE, otherStretches, parts, pct, percentPerDollar, planWeeks, riseDriver,
  SHORT_STRETCH, splitWords, usd, weekOf, whenWords, windowRange,
} from './telemetry.js';

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));

/**
 * The temp folders, as lib/platform.js tempDirs() gives them (os.tmpdir(), plus /tmp and
 * /private/tmp off Windows). Written out here because platform.js also starts processes, and the
 * site's half (which serves Telemetry) imports nothing that does.
 */
export function tempDirs({ platform = process.platform, tmpdir = os.tmpdir() } = {}) {
  if (platform === 'win32') return [tmpdir];
  return [...new Set(['/tmp', '/private/tmp', tmpdir, path.posix.join('/private', tmpdir)])];
}
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

/** The cleaned rows in the usage lines' own shape, for the meter sums in telemetry.js. */
export function recordLines(rec) {
  return rec.rows.map((r) => ({ t: r.t, user: r.user, job: r.job, stage: r.stage, model: r.model, costUsd: r.usd, meters: { week: r.week, fiveHour: r.fiveHour } }));
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

// ---------- The ten graphs ----------
// Each graph is a pure function of the cleaned record and the context, and returns
//   { id, n, title, audience, state, headline, todo, sub, data, table: { caption, head, rows }, notes }
// headline: the finding, in one sentence, never more than the data holds ("Not enough … yet (3 of 5
// needed)" when it is too little); todo: what to do about it; sub: an extra line under the graph;
// table: the numbers, as words, for Table ▸; notes: what the graph capped or couldn't see.
// audience: 'private' (your own jobs, with their names: the lock) or 'common' (the whole account,
// no job names: the people icon). state: 'ok', 'not-enough', 'cannot-see' (the source isn't here),
// 'empty' (nothing recorded yet).
// Kept apart: this app's use (per person, job, stage) and Other use are never mixed in a graph about
// this app; graphs about the whole limit (1, 5, 9) count both, each part named.

const H = 3600e3;
const DAY = 24 * H;
const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 1e4) / 1e4;
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
const stageName = (id) => STAGES.find((s) => s.id === id)?.label ?? (id ? String(id) : 'No stage');
const FAMILY_ORDER = ['opus', 'sonnet', 'haiku', 'fable'];
const familyName = (f) => (PRICES[f]?.label ?? (f === 'other' ? 'Other models' : 'Not known')).replace(/ [\d.]+$/, '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const usd0 = (n) => `$${Math.round(n)}`;
const days1 = (n) => `${(Math.round(n * 10) / 10).toFixed(1)} days`;
const minutes = (m) => (m < 90 ? `${Math.round(m)} min` : `${(Math.round(m / 6) / 10).toFixed(1)} hours`);
const hours = (h) => `${Math.round(h)} ${Math.round(h) === 1 ? 'hour' : 'hours'}`;
const notEnough = (what, have, need) => `Not enough ${what} yet to say (${have} of ${need} needed).`;
const graph = (g) => ({ sub: null, notes: [], table: { caption: '', head: [], rows: [] }, data: {}, ...g });

/** The month's start (the 1st, 00:00 on the local clock), `back` months before t's. */
function monthStart(t, timeZone, back = 0) {
  const { y, mo } = localDate(t, timeZone);
  return localTime(y, mo - back, 1, 0, 0, timeZone);
}
const monthName = (t, timeZone) => parts(t, timeZone, { month: 'long' }).month;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SHORT_DAY = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
/** Monday-first weekday (0..6) and hour on the local clock. */
function clock(t, timeZone) {
  const p = parts(t, timeZone, { weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
  return { day: SHORT_DAY[p.weekday] ?? 0, hour: +p.hour };
}
const blockWords = (lo, hi) => `${String(lo * 2).padStart(2, '0')}:00 to ${String(hi * 2 + 2).padStart(2, '0')}:00`.replace('24:00', 'midnight');

// ---------- 1. Weekly limit and forecast (whole account: the meters) ----------

export function limitGraph(rec, ctx) {
  const { now, timeZone, lines, reading, limits, window, from } = ctx;
  const split = limits.week;
  const fc0 = forecastOf(lines, { now, reading, timeZone });
  const driver = fc0.from && fc0.to ? riseDriver(lines, { from: fc0.from.t, to: fc0.to.t, rise: fc0.to.percent - fc0.from.percent, ratio: ctx.ratio }) : null;
  const fc = { ...fc0, driver };
  const points = lines.filter((l) => Date.parse(l.t) >= from && Date.parse(l.t) <= now && (l.meters?.week || l.meters?.fiveHour))
    .map((l) => ({ t: l.t, week: l.meters?.week?.percent ?? null, fiveHour: l.meters?.fiveHour?.percent ?? null }));
  if (reading?.t && (reading.week || reading.fiveHour) && (!points.length || Date.parse(reading.t) > Date.parse(points.at(-1).t))) points.push({ t: reading.t, week: reading.week?.percent ?? null, fiveHour: reading.fiveHour?.percent ?? null });
  const resets = [...new Set(lines.map((l) => l.meters?.week?.resetsAt).filter(Boolean))].filter((r) => Date.parse(r) >= from && Date.parse(r) <= now).sort();
  const resetWords = fc.resetsAt ? whenWords(fc.resetsAt, { now, timeZone }) : null;
  const drive = driver ? `, ${driver.words}` : '';
  let headline;
  let todo;
  if (split.state === 'no-readings' && !points.length) {
    headline = 'No reading of the weekly limit yet, so no forecast.';
    todo = 'Press Read now. The forecast needs readings a few hours apart in the last day, which come with the Foreman’s turns.';
  } else if (fc.state === 'full') {
    headline = `The weekly limit is used up${resetWords ? `; it resets on ${resetWords}` : ''}.`;
    todo = `Nothing to do: jobs carry on${resetWords ? ` ${resetWords}` : ' after the reset'}, and go-aheads you give now go then.`;
  } else if (fc.state === 'fills') {
    const early = fc.resetsAt ? (Date.parse(fc.resetsAt) - Date.parse(fc.fullAt)) / DAY : null;
    headline = `At this pace the week is full on ${whenWords(fc.fullAt, { now, timeZone })}${early !== null && early >= 1 ? `, ${early >= 1.5 ? `${Math.round(early)} days` : 'a day'} before it resets` : ''}${drive}.`;
    todo = driver && driver.other > driver.app
      ? 'Most of the pace is use outside this app: ask who else is on the account before you start a large job, or pause one until the reset.'
      : `Pause the largest job until the reset${resetWords ? ` (${resetWords})` : ''}, or move a stage to a smaller model for the rest of the week.`;
  } else if (fc.state === 'resets-first') {
    headline = `At this pace the week ends at about ${pct(fc.atReset)}${drive}.`;
    todo = fc.atReset < 80 ? 'Nothing to change: there is room for more large jobs this week.' : 'Nothing to change, but check this again before you start a large job.';
  } else if (fc.state === 'flat') {
    headline = `The weekly use hasn’t gone up in the last day; it is at ${pct(fc.to.percent)}.`;
    todo = 'Nothing to change.';
  } else {
    headline = fc.sentence;
    todo = 'Press Read now. The forecast needs readings a few hours apart in the last day.';
  }
  const sub = split.state === 'split' || split.state === 'no-ratio' ? split.sentence : null;
  return graph({
    id: 'limit', n: 1, title: 'Weekly limit and forecast', audience: 'common', state: points.length ? 'ok' : 'empty', headline, todo, sub,
    data: { window, from: new Date(from).toISOString(), to: new Date(now).toISOString(), points, resets, forecast: fc, split, fiveHour: limits.fiveHour },
    table: {
      caption: `${headline}${resets.length ? ` The week reset at ${resets.map((r) => whenWords(r, { now, timeZone })).join(', ')}.` : ''}`,
      head: ['When', 'Weekly limit used', '5-hour limit used'],
      rows: points.map((p) => [whenWords(p.t, { timeZone }), p.week === null ? 'Not read' : pct(p.week), p.fiveHour === null ? 'Not read' : pct(p.fiveHour)]),
    },
    notes: driver ? [`In the last day the meter rose ${pct(driver.app + driver.other)}: this app about ${pct(driver.app)}, other use about ${pct(driver.other)} (estimated).`] : [],
  });
}

// ---------- 2. Cost per finished ticket, by week (yours) ----------

const NEED_TICKETS = 2;

export function ticketCostGraph(rec, ctx) {
  const { me, timeZone, now } = ctx;
  const weeks = planWeeks({ now, meters: ctx.meters, timeZone, count: 8 });
  const mineRows = rec.rows.filter((r) => !me || r.user === me);
  // A ticket is the ticket key, else its job; finished: across the finish line (the job list), else at PR #1.
  const tickets = new Map();
  for (const r of mineRows) {
    const key = r.ticket ?? (r.job ? `job:${r.job}` : null);
    if (!key) continue;
    const t = tickets.get(key) ?? { key, label: r.ticket ?? ctx.title(r.job), usd: 0, jobs: new Set() };
    t.usd += r.usd;
    if (r.job) t.jobs.add(r.job);
    tickets.set(key, t);
  }
  const finished = [];
  for (const t of tickets.values()) {
    const jobs = [...t.jobs].map((s) => rec.jobs.get(s)).filter(Boolean);
    const done = rec.hasJobs ? jobs.filter((j) => j.finished) : jobs.filter((j) => j.pr1At);
    if (!done.length || (rec.hasJobs && done.length < jobs.length)) continue;
    const at = Math.max(...done.map((j) => Date.parse(j.finishedAt ?? j.pr1At ?? j.firstAt)));
    const w = weekOf(at, weeks);
    if (w) finished.push({ ...t, at, week: w.label, weekFrom: w.from });
  }
  const what = rec.hasJobs ? 'finished tickets' : 'tickets at PR #1';
  const notes = [rec.hasJobs ? 'Finished: across the finish line set in Settings → Workflow. A ticket’s cost is all of its jobs’ use.' : 'The job list wasn’t here, so a ticket counts as finished once it reached PR #1.'];
  const cap = capOutliers(finished.map((t) => t.usd));
  if (cap.cap !== null) for (const i of cap.capped) notes.push(`${finished[i].label} cost ${usd(finished[i].usd)}: drawn at ${usd(cap.cap)} on the graph, in full in the table.`);
  const byWeek = weeks.map((w) => {
    const list = finished.filter((t) => t.weekFrom === w.from).map((t) => t.usd).sort((a, b) => a - b);
    return { label: w.label, from: new Date(w.from).toISOString(), tickets: list.length, median: list.length ? r2(quantile(list, 0.5)) : null, low: list.length ? r2(quantile(list, 0.25)) : null, high: list.length ? r2(quantile(list, 0.75)) : null };
  }).reverse();
  const table = {
    caption: `Each ${rec.hasJobs ? 'finished ticket' : 'ticket at PR #1'} in the last eight weeks, with its whole cost.`,
    head: ['Ticket', 'Week it finished', 'Cost'],
    rows: [...finished].sort((a, b) => b.at - a.at).map((t) => [t.label, t.week, usd(t.usd)]),
  };
  const base = { id: 'ticket-cost', n: 2, title: 'Cost per finished ticket, by week', audience: 'private', data: { weeks: byWeek, cap: cap.cap === null ? null : r2(cap.cap), unit: 'usd' }, table, notes };
  if (finished.length < NEED_TICKETS) {
    return graph({ ...base, state: finished.length ? 'not-enough' : 'empty', headline: notEnough(what, finished.length, NEED_TICKETS), todo: 'Nothing to do yet: this fills in as tickets finish.' });
  }
  const withData = byWeek.filter((w) => w.median !== null);
  const latest = withData.at(-1);
  const first = withData[0];
  const all = finished.map((t) => t.usd).sort((a, b) => a - b);
  let headline;
  let todo;
  if (withData.length < 2) {
    headline = `A ${rec.hasJobs ? 'finished ticket' : 'ticket at PR #1'} costs ${usd(quantile(all, 0.5))}: the middle of ${plural(all.length, 'ticket')}.`;
    todo = 'Come back after another week to see whether tickets are getting cheaper.';
  } else {
    const ago = Math.round((Date.parse(latest.from) - Date.parse(first.from)) / (7 * DAY));
    const change = latest.median - first.median;
    const same = Math.abs(change) < Math.max(0.5, first.median * 0.05);
    const span = `${ago === 1 ? 'a week' : `${ago} weeks`} ago`;
    headline = same ? `A finished ticket costs ${usd(latest.median)}, about the same as ${span}.` : `A finished ticket costs ${usd(latest.median)}, ${change < 0 ? 'down' : 'up'} from ${usd(first.median)} ${span}.`;
    todo = same ? 'Nothing to change.' : change < 0 ? 'Keep what changed: look at Where the spend goes to see which stage got cheaper.' : 'Look at Where the spend goes and Rework to see which stage grew.';
  }
  return graph({ ...base, state: 'ok', headline, todo });
}

// ---------- 3. Where the spend goes, by stage (yours) ----------

const STAGE_TODO = {
  review: 'Turn off review lenses a job doesn’t need (a job’s Notes and options), such as the database lens on a job with no migration.',
  implement: 'Approve plans with small steps: Build costs less when each step is small and its tests are named.',
  test: 'Name the tests in the plan, so Test runs what was agreed and nothing twice.',
};

export function stagesGraph(rec, ctx) {
  const { me, timeZone, now } = ctx;
  const thisFrom = monthStart(now, timeZone, 0);
  const lastFrom = monthStart(now, timeZone, 1);
  const mineRows = rec.rows.filter((r) => !me || r.user === me);
  const month = (lo, hi) => mineRows.filter((r) => r.ms >= lo && r.ms < hi);
  const cur = month(thisFrom, now + 1);
  const prev = month(lastFrom, thisFrom);
  const totalCur = sum(cur, (r) => r.usd);
  const totalPrev = sum(prev, (r) => r.usd);
  const ids = [...STAGES.map((s) => s.id), null].filter((id) => cur.some((r) => r.stage === id) || prev.some((r) => r.stage === id));
  const stages = ids.map((id) => {
    const a = sum(cur.filter((r) => r.stage === id), (r) => r.usd);
    const b = sum(prev.filter((r) => r.stage === id), (r) => r.usd);
    return { stage: id, label: stageName(id), usd: r2(a), share: totalCur > 0 ? r4(a / totalCur) : 0, lastUsd: r2(b), lastShare: totalPrev > 0 ? r4(b / totalPrev) : null };
  });
  const thisName = monthName(now, timeZone);
  const lastName = monthName(lastFrom, timeZone);
  const table = {
    caption: `Your spend by stage, ${thisName} so far against ${lastName}.`,
    head: ['Stage', thisName, lastName, 'Change'],
    rows: stages.map((s) => {
      const d = s.lastShare === null ? null : Math.round((s.share - s.lastShare) * 100);
      return [s.label, `${pct(s.share * 100)} · ${usd(s.usd)}`, s.lastShare === null ? 'Nothing recorded' : `${pct(s.lastShare * 100)} · ${usd(s.lastUsd)}`, d === null ? '—' : d === 0 ? '= 0 pts' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d)} pts`];
    }),
  };
  const base = { id: 'stages', n: 3, title: 'Where the spend goes, by stage', audience: 'private', data: { months: [thisName, lastName], stages }, table };
  if (!(totalCur > 0)) return graph({ ...base, state: 'empty', headline: `Nothing recorded for your jobs in ${thisName} yet.`, todo: 'Nothing to do yet: this fills in as your jobs run.' });
  const top = [...stages].sort((a, b) => b.share - a.share)[0];
  const d = top.lastShare === null ? null : Math.round((top.share - top.lastShare) * 100);
  const headline = d === null
    ? `${top.label} costs ${pct(top.share * 100)} of your spend this month; nothing was recorded last month to compare.`
    : d === 0 ? `${top.label} costs ${pct(top.share * 100)} of your spend, the same as last month.`
      : `${top.label} costs ${pct(top.share * 100)} of your spend, ${d > 0 ? 'up' : 'down'} from ${pct(top.lastShare * 100)} last month.`;
  const todo = STAGE_TODO[top.stage] ?? (top.stage ? `Check whether ${top.label} needs the largest model: Models shows what a switch would save.` : 'Nothing to change.');
  return graph({ ...base, state: 'ok', headline, todo });
}

// ---------- 4. Models: share and what a switch would save (whole account) ----------

const DOWN = { fable: 'opus', opus: 'sonnet', sonnet: 'haiku' };

export function modelsGraph(rec, ctx) {
  const { timeZone, now } = ctx;
  const months = [2, 1, 0].map((back) => ({ from: monthStart(now, timeZone, back), to: back === 0 ? now + 1 : monthStart(now, timeZone, back - 1), name: monthName(monthStart(now, timeZone, back), timeZone) }));
  const fams = [...new Set(rec.rows.map((r) => r.family))].sort((a, b) => (FAMILY_ORDER.indexOf(a) + 1 || 9) - (FAMILY_ORDER.indexOf(b) + 1 || 9));
  const series = fams.map((f, i) => ({ key: f, label: familyName(f), slot: (FAMILY_ORDER.indexOf(f) + 1) || Math.min(8, FAMILY_ORDER.length + 1 + i) }));
  const bars = months.map((m) => {
    const list = rec.rows.filter((r) => r.ms >= m.from && r.ms < m.to);
    const total = sum(list, (r) => r.usd);
    return { label: m.name, usd: r2(total), parts: fams.map((f) => { const u = sum(list.filter((r) => r.family === f), (r) => r.usd); return { key: f, usd: r2(u), share: total > 0 ? r4(u / total) : 0 }; }).filter((p) => p.usd > 0) };
  }).filter((b) => b.usd > 0);
  const table = {
    caption: 'Spend by model family, by month, everyone on this computer.',
    head: ['Month', ...series.map((s) => s.label), 'All'],
    rows: bars.map((b) => [b.label, ...series.map((s) => { const p = b.parts.find((x) => x.key === s.key); return p ? `${pct(p.share * 100)} (${usd(p.usd)})` : '—'; }), usd(b.usd)]),
  };
  const base = { id: 'models', n: 4, title: 'Models: share and what a switch would save', audience: 'common', data: { series, bars, saving: null }, table, notes: ['A saving is worked out from the token counts, the way the cost estimate is.'] };
  if (!bars.length) return graph({ ...base, state: 'empty', headline: 'Nothing recorded yet.', todo: 'Nothing to do yet.' });
  // The last 30 days: the costliest stage, and what it would cost on the next model down.
  const month = rec.rows.filter((r) => r.ms >= now - 30 * DAY);
  const byStage = new Map();
  for (const r of month) if (r.stage) byStage.set(r.stage, (byStage.get(r.stage) ?? 0) + r.usd);
  const topStage = [...byStage.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  let saving = null;
  if (topStage) {
    const rows = month.filter((r) => r.stage === topStage);
    const fam = [...new Set(rows.map((r) => r.family))].map((f) => [f, sum(rows.filter((r) => r.family === f), (r) => r.usd)]).sort((a, b) => b[1] - a[1])[0][0];
    const next = DOWN[fam] ?? null;
    if (next) {
      const sameFam = rows.filter((r) => r.family === fam);
      const w = whatIfConductor(sameFam.map((r) => ({ agentType: 'conductor', usd: r.usd, model: r.model, tokens: r.tokens })));
      const estNow = w?.alternatives?.[fam] ?? null;
      const estNext = w?.alternatives?.[next] ?? null;
      // The saving at the same tokens, scaled to what was really spent (the estimate's ratio).
      if (estNow > 0 && estNext !== null) {
        const actual = sum(sameFam, (r) => r.usd);
        saving = { stage: topStage, stageLabel: stageName(topStage), from: fam, fromLabel: familyName(fam), to: next, toLabel: familyName(next), usd: r2(actual - actual * (estNext / estNow)), fromModel: PRICES[fam].label, toModel: PRICES[next].label };
      }
    }
  }
  const latest = bars.at(-1);
  const lead = [...latest.parts].sort((a, b) => b.usd - a.usd)[0];
  const share = `${familyName(lead.key)} is ${pct(lead.share * 100)} of the spend`;
  const headline = saving && saving.usd >= 1
    ? `${share}; ${saving.stageLabel} on ${saving.toLabel} would save about ${usd0(saving.usd)} a month.`
    : `${share} in ${latest.label}.`;
  const todo = saving && saving.usd >= 1
    ? `Try ${saving.toLabel} for ${saving.stageLabel} on the next two small jobs, and compare how often they get sent back.`
    : 'Nothing to change.';
  return graph({ ...base, state: 'ok', headline, todo, data: { series, bars, saving },
    sub: saving && saving.usd >= 1 ? `About ${usd0(saving.usd)} less a month if ${saving.stageLabel} ran on ${saving.toModel} instead of ${saving.fromModel}, at the last 30 days’ use.` : null });
}

// ---------- 5. People on the account (whole account, names only) ----------

export function peopleGraph(rec, ctx) {
  const { window, limits, from, now } = ctx;
  const split = window === '5h' ? limits.fiveHour : limits.week;
  const meterName = window === '5h' ? 'the five hours' : 'the week';
  const inWin = rec.rows.filter((r) => r.ms >= from && r.ms <= now);
  const spend = new Map();
  for (const r of inWin) spend.set(r.user, (spend.get(r.user) ?? 0) + r.usd);
  const ratio = window === '5h' ? ctx.ratio5 : ctx.ratio;
  const metered = window !== '30d' && split.state === 'split';
  const people = [...spend.entries()].map(([user, u]) => {
    const fromSplit = metered ? split.people.find((p) => p.user === user) : null;
    return { user, usd: r2(u), percent: fromSplit ? fromSplit.percent : ratio === null ? null : r2(u * ratio) };
  }).sort((a, b) => (b.percent ?? b.usd) - (a.percent ?? a.usd) || a.user.localeCompare(b.user));
  const others = metered ? { label: 'Others', percent: split.other, estimated: true } : null;
  const free = metered ? split.free : null;
  const rows = [
    ...people.map((p) => [p.user, p.percent === null ? 'Not known' : pct(p.percent), usd(p.usd)]),
    ...(others ? [['Others (outside this app, estimated)', pct(others.percent), 'Not known: outside this app']] : []),
    ...(metered && split.unknown >= 1 ? [['Not known', pct(split.unknown), '—']] : []),
    ...(free !== null ? [['Still free', pct(free), '—']] : []),
  ];
  const notes = [
    'Others: outside this app: claude.ai, the Claude app and anyone else on the account, including this app on other computers. Estimated from the meter, in percent only.',
    ...(window === '30d' ? ['Others shows for this week and this five hours, where a meter says how much was used.'] : []),
  ];
  const base = { id: 'people', n: 5, title: 'People on the account', audience: 'common', data: { window, people, others, free, unknown: metered ? split.unknown : null, state: split.state }, table: { caption: `Who used ${meterName}${window === '30d' ? ' (the last 30 days)' : ''}.`, head: ['Who', `Share of ${window === '5h' ? 'the 5-hour limit' : 'the week'}`, 'Spend in this app'], rows }, notes };
  if (!people.length && !(others && others.percent > 0)) return graph({ ...base, state: 'empty', headline: `Nobody used the account ${window === '5h' ? 'in this five hours' : window === 'week' ? 'this week' : 'in the last 30 days'}, as far as this computer knows.`, todo: 'Nothing to do.' });
  let headline;
  if (metered) {
    const names = people.map((p) => `${p.user} ${pct(p.percent)}`);
    const said = names.length ? `${people[0].user} used ${pct(people[0].percent)} of ${meterName}${names.length > 1 ? ` and ${names.slice(1).join(', ')}` : ''}` : `Nobody here used ${meterName} in this app`;
    headline = `${said}; other use ${pct(others.percent)} (estimated); ${pct(free)} is still free.`;
  } else {
    headline = `${people.map((p, i) => (i === 0 ? `${p.user} spent ${usd(p.usd)} in this app` : `${p.user} ${usd(p.usd)}`)).join(', ')}${split.state === 'no-ratio' ? '; the split of the limit isn’t known yet' : ''}.`;
  }
  const app = metered ? split.app : null;
  const todo = metered && others.percent > app && others.percent >= 10
    ? 'Most of the limit went outside this app: ask who else uses the account before you start a large job.'
    : metered && free < 20 ? 'Little is left: check the forecast before anyone starts a large job.' : 'Nothing to change.';
  return graph({ ...base, state: 'ok', headline, todo });
}

// ---------- 6. Rework: cost after a send-back, by stage (yours) ----------

const REWORK_TODO = {
  implement: 'Name the tests in the plan, so Build knows what Test will check before it starts.',
  test: 'Name the tests in the plan, so Build knows what Test will check before it starts.',
  plan: 'Say what matters most when you approve the spec, so the plan gets it right the first time.',
  spec: 'Answer the clarifying questions in more detail before the spec is written.',
  review: 'Look at what Review asked for: the same request twice points at the plan or its checks.',
};

export function reworkGraph(rec, ctx) {
  const { me, now } = ctx;
  const since = now - 30 * DAY;
  const base = { id: 'rework', n: 6, title: 'Rework', audience: 'private' };
  if (!rec.hasAudit) return graph({ ...base, state: 'cannot-see', headline: 'Can’t see send-backs here yet.', todo: 'Nothing to do: this fills in once send-backs reach Telemetry.', notes: ['Send-backs come from the audit log, which wasn’t handed to Telemetry.'] });
  const mineJob = (slug) => { const j = rec.jobs.get(slug); return j && (!me || j.user === me); };
  const backs = rec.sendBacks.filter((b) => b.ms >= since && mineJob(b.slug));
  const byStage = new Map();
  for (const b of backs) {
    let cost = 0;
    for (const r of rec.rows) {
      if (r.job !== b.slug || r.ms <= b.ms) continue;
      if (r.stage !== b.stage) break;
      cost += r.usd;
    }
    const s = byStage.get(b.stage) ?? { stage: b.stage, label: stageName(b.stage), sendBacks: 0, usd: 0 };
    s.sendBacks++;
    s.usd += cost;
    byStage.set(b.stage, s);
  }
  const stageSpend = (id) => sum(rec.rows.filter((r) => r.ms >= since && r.stage === id && mineJob(r.job)), (r) => r.usd);
  const stages = [...byStage.values()].map((s) => ({ ...s, usd: r2(s.usd), share: stageSpend(s.stage) > 0 ? r4(s.usd / stageSpend(s.stage)) : 0 })).sort((a, b) => b.usd - a.usd);
  const table = { caption: 'Cost spent in a stage after it was sent back, the last 30 days, your jobs.', head: ['Stage', 'Send-backs', 'Cost after them', 'Share of the stage’s cost'], rows: stages.map((s) => [s.label, String(s.sendBacks), usd(s.usd), pct(s.share * 100)]) };
  if (!backs.length) return graph({ ...base, state: 'ok', headline: 'No send-backs in the last 30 days, so no rework.', todo: 'Nothing to change.', table, data: { stages } });
  const top = stages[0];
  const headline = `${top.label} rework cost ${usd(top.usd)} in the last 30 days, after ${plural(top.sendBacks, 'send-back')}${stages.length > 1 ? `; ${plural(backs.length, 'send-back')} in all` : ''}.`;
  return graph({ ...base, state: 'ok', headline, todo: REWORK_TODO[top.stage] ?? 'Look at what the send-backs asked for: the same request twice points at that stage’s brief.', table, data: { stages } });
}

// ---------- 7. Waiting on you (yours) ----------

const NEED_ANSWERS = 3;
const DAY_FROM = 8;
const DAY_TO = 20;

export function waitingGraph(rec, ctx) {
  const { me, timeZone, now } = ctx;
  const base = { id: 'waiting', n: 7, title: 'Waiting on you', audience: 'private' };
  if (!rec.hasAudit) return graph({ ...base, state: 'cannot-see', headline: 'Can’t see your answers here yet.', todo: 'Nothing to do: this fills in once your answers reach Telemetry.', notes: ['Answers come from the audit log, which wasn’t handed to Telemetry.'] });
  const weeks = planWeeks({ now, meters: ctx.meters, timeZone, count: 6 });
  const mineJob = (slug) => { const j = rec.jobs.get(slug); return j && (!me || j.user === me); };
  // Each answer's wait: from the Foreman's last turn on that job before it to the answer (at most a week).
  const waits = [];
  for (const a of rec.answers.filter((x) => mineJob(x.slug) && x.ms >= weeks.at(-1).from)) {
    let last = null;
    for (const r of rec.rows) { if (r.ms >= a.ms) break; if (r.job === a.slug) last = r.ms; }
    if (last === null || a.ms - last > 7 * DAY) continue;
    let day = 0;
    for (let t = last; t < a.ms;) {
      const step = Math.min(a.ms, Math.floor(t / H) * H + H) - t;
      const { hour } = clock(t, timeZone);
      if (hour >= DAY_FROM && hour < DAY_TO) day += step;
      t += step;
    }
    waits.push({ at: a.ms, minutes: (a.ms - last) / 60e3, dayHours: day / H, nightHours: (a.ms - last - day) / H, week: weekOf(a.ms, weeks) });
  }
  const perWeek = weeks.map((w) => {
    const list = waits.filter((x) => x.week === w);
    return { label: w.label, from: new Date(w.from).toISOString(), day: r2(sum(list, (x) => x.dayHours)), night: r2(sum(list, (x) => x.nightHours)), answers: list.length, median: list.length ? r2(median(list.map((x) => x.minutes))) : null };
  }).reverse();
  const table = { caption: 'Hours your jobs waited for your answer, by plan week (daytime is 08:00 to 20:00).', head: ['Week', 'Daytime', 'Overnight', 'Answers', 'Median time to answer'], rows: perWeek.map((w) => [w.label, hours(w.day), hours(w.night), String(w.answers), w.median === null ? '—' : minutes(w.median)]) };
  const data = { weeks: perWeek };
  if (waits.length < NEED_ANSWERS) return graph({ ...base, state: waits.length ? 'not-enough' : 'empty', headline: notEnough('answers', waits.length, NEED_ANSWERS), todo: 'Nothing to do yet.', table, data });
  const cur = perWeek.at(-1);
  const week = cur.answers ? cur : [...perWeek].reverse().find((w) => w.answers);
  const which = week === cur ? 'this week' : `in the ${week.label.toLowerCase()}`;
  const total = week.day + week.night;
  const nightShare = total > 0 ? week.night / total : 0;
  const before = waits.filter((x) => x.week && x.week.label !== week.label).map((x) => x.minutes);
  const headline = `Jobs waited ${hours(total)} on you ${which}${nightShare >= 0.4 ? `, ${nightShare >= 0.6 ? 'most' : 'half'} of it overnight` : ''}.`;
  const sub = `Median time to answer ${which}: ${minutes(week.median)}${before.length ? ` (${minutes(median(before))} in the weeks before)` : ''}.`;
  const todo = nightShare >= 0.4 ? 'Approve plans before you stop for the day, or turn on Needs you notifications for go-aheads.'
    : week.median > 60 ? 'Turn on Needs you notifications (Settings → Notifications), so go-aheads don’t wait.' : 'Nothing to change: you answer quickly.';
  return graph({ ...base, state: 'ok', headline, todo, sub, table, data });
}

// ---------- 8. Time to PR #1, by job size (yours) ----------

const NEED_PR1 = 3;
const sizeOf = (route) => (route === 'large' ? 'large' : route === 'small' || route === 'quick' ? 'small' : 'unknown');
const SIZE_WORDS = { small: 'Small', large: 'Large', unknown: 'Size not known' };

export function pr1Graph(rec, ctx) {
  const { me } = ctx;
  const jobs = [...rec.jobs.values()].filter((j) => (!me || j.user === me) && j.pr1At);
  const items = jobs.map((j) => ({ label: j.title ?? ctx.title(j.slug), size: sizeOf(j.route), days: r2((Date.parse(j.pr1At) - Date.parse(j.firstAt)) / DAY) })).sort((a, b) => a.days - b.days);
  const cap = capOutliers(items.map((x) => x.days));
  const notes = [
    'From the job’s first turn to its first turn at PR #1.',
    ...(rec.hasJobs ? [] : ['The job list wasn’t here, so job sizes aren’t known.']),
    ...cap.capped.map((i) => `${items[i].label} took ${days1(items[i].days)}: drawn at ${days1(cap.cap)} on the graph, in full in the table.`),
  ];
  const medians = Object.fromEntries(['small', 'large', 'unknown'].map((s) => { const v = items.filter((x) => x.size === s).map((x) => x.days); return [s, v.length ? r2(median(v)) : null]; }));
  const table = { caption: 'Days from start to PR #1, your jobs.', head: ['Job', 'Size', 'Days to PR #1'], rows: items.map((x) => [x.label, SIZE_WORDS[x.size], days1(x.days)]) };
  const base = { id: 'pr1', n: 8, title: 'Time to PR #1, by job size', audience: 'private', data: { items, medians, cap: cap.cap === null ? null : r2(cap.cap) }, table, notes };
  if (items.length < NEED_PR1) return graph({ ...base, state: items.length ? 'not-enough' : 'empty', headline: notEnough('jobs at PR #1', items.length, NEED_PR1), todo: 'Nothing to do yet.' });
  const { small, large } = medians;
  if (small !== null && large !== null) {
    return graph({ ...base, state: 'ok', headline: `Small jobs reach PR #1 in ${days1(small)}; large ones take ${days1(large)}.`, todo: large > 2 * small ? 'Split large tickets into a stack: each part reaches PR #1 sooner.' : 'Nothing to change.' });
  }
  return graph({ ...base, state: 'ok', headline: `Jobs reach PR #1 in ${days1(median(items.map((x) => x.days)))}: the middle of ${plural(items.length, 'job')}.`, todo: 'Nothing to change.' });
}

// ---------- 9. When the limit goes: weekday × hour (whole account, both parts) ----------

const NEED_DAYS = 7;

export function whenGraph(rec, ctx) {
  const { timeZone, now, ratio, lines } = ctx;
  const since = now - 28 * DAY;
  const unit = ratio === null ? 'usd' : 'percent';
  const cells = [];
  for (let d = 0; d < 7; d++) for (let b = 0; b < 12; b++) cells.push({ day: d, block: b, app: 0, other: 0 });
  const cell = (t) => { const c = clock(t, timeZone); return cells[c.day * 12 + Math.floor(c.hour / 2)]; };
  for (const r of rec.rows) if (r.ms >= since && r.ms <= now) cell(r.ms).app += unit === 'percent' ? r.usd * ratio : r.usd;
  // Other use, spread evenly over the time between the two readings it was seen in.
  for (const s of otherStretches(lines, { meter: 'week', ratio })) {
    const lo = Math.max(s.from, since);
    const hi = Math.min(s.to, now);
    if (hi <= lo) continue;
    const per = s.other / (s.to - s.from);
    for (let t = lo; t < hi;) { const step = Math.min(hi, Math.floor(t / H) * H + H) - t; cell(t).other += per * step; t += step; }
  }
  for (const c of cells) { c.app = r4(c.app); c.other = r4(c.other); c.total = r4(c.app + c.other); }
  const first = rec.rows.find((r) => r.ms >= since)?.ms ?? null;
  const span = first === null ? 0 : Math.floor((now - first) / DAY);
  const total = sum(cells, (c) => c.total);
  const words = (v) => (unit === 'percent' ? pct(v) : usd(v));
  const dayTotals = WEEKDAYS.map((name, d) => ({ name, app: sum(cells.filter((c) => c.day === d), (c) => c.app), other: sum(cells.filter((c) => c.day === d), (c) => c.other) }));
  const table = {
    caption: `${unit === 'percent' ? 'Percent of the weekly limit' : 'Spend in this app'} by weekday, the last four weeks${unit === 'percent' ? ', this app and other use (estimated) apart' : ''}.`,
    head: unit === 'percent' ? ['Day', 'In this app', 'Other use (estimated)', 'Busiest two hours'] : ['Day', 'In this app', 'Busiest two hours'],
    rows: dayTotals.map((d, i) => {
      const best = cells.filter((c) => c.day === i).sort((a, b) => b.total - a.total)[0];
      const busiest = best.total > 0 ? blockWords(best.block, best.block) : '—';
      return unit === 'percent' ? [d.name, pct(d.app), pct(d.other), busiest] : [d.name, usd(d.app), busiest];
    }),
  };
  const notes = unit === 'percent'
    ? ['Other use is spread evenly over the time between the two readings it was seen in, so a long quiet stretch smears it.']
    : ['Without percent per dollar, this shows this app’s spend only; other use can’t be counted in yet.'];
  const max = Math.max(0, ...cells.map((c) => c.total));
  const base = { id: 'when', n: 9, title: 'When the limit goes', audience: 'common', data: { unit, cells, max: r4(max) }, table, notes };
  if (span < NEED_DAYS) return graph({ ...base, state: total > 0 ? 'not-enough' : 'empty', headline: notEnough('days', Math.max(0, span), NEED_DAYS), todo: 'Nothing to do yet.' });
  if (!(total > 0)) return graph({ ...base, state: 'empty', headline: 'Nothing recorded in the last four weeks.', todo: 'Nothing to do.' });
  const dayMax = Math.max(...dayTotals.map((d) => d.app + d.other));
  const topDays = dayTotals.map((d, i) => ({ ...d, i, v: d.app + d.other })).filter((d) => d.v >= 0.75 * dayMax).sort((a, b) => b.v - a.v).slice(0, 2).sort((a, b) => a.i - b.i);
  const blocks = Array.from({ length: 12 }, (_, b) => sum(cells.filter((c) => c.block === b && topDays.some((d) => d.i === c.day)), (c) => c.total));
  const peak = blocks.indexOf(Math.max(...blocks));
  let lo = peak;
  let hi = peak;
  while (lo > 0 && blocks[lo - 1] >= 0.5 * blocks[peak]) lo--;
  while (hi < 11 && blocks[hi + 1] >= 0.5 * blocks[peak]) hi++;
  const otherShare = sum(cells, (c) => c.other) / total;
  const headline = `Most ${unit === 'percent' ? 'use' : 'spend'} lands ${topDays.map((d) => d.name).join(' and ')}, ${blockWords(lo, hi)}${unit === 'percent' && otherShare >= 0.5 ? ', mostly use outside this app' : ''}.`;
  const weekend = (dayTotals[5].app + dayTotals[5].other + dayTotals[6].app + dayTotals[6].other) / total;
  const todo = `Start large runs outside ${blockWords(lo, hi)}${weekend < 0.15 ? ', or at the weekend' : ''}, when the 5-hour window is quiet.`;
  return graph({ ...base, state: 'ok', headline, todo, sub: `The darkest square is ${words(max)} of the ${unit === 'percent' ? 'weekly limit' : 'spend'} in two hours.` });
}

// ---------- 10. Cache reuse (yours) ----------

export function cacheGraph(rec, ctx) {
  const { me, timeZone, now } = ctx;
  const weeks = planWeeks({ now, meters: ctx.meters, timeZone, count: 8 });
  const mineRows = rec.rows.filter((r) => !me || r.user === me);
  const share = (list) => {
    const read = sum(list, (r) => r.tokens.cacheRead);
    const all = sum(list, (r) => r.tokens.input + r.tokens.cacheRead + r.tokens.cacheWrite5m + r.tokens.cacheWrite1h);
    return all > 0 ? { share: r4(read / all), input: all } : null;
  };
  const perWeek = weeks.map((w) => ({ label: w.label, from: new Date(w.from).toISOString(), ...(share(mineRows.filter((r) => r.ms >= w.from && r.ms < w.to)) ?? { share: null, input: 0 }) })).reverse();
  const cur = weeks[0];
  const jobRows = new Map();
  for (const r of mineRows) if (r.job && r.ms >= cur.from) { if (!jobRows.has(r.job)) jobRows.set(r.job, []); jobRows.get(r.job).push(r); }
  const jobs = [...jobRows.entries()].map(([slug, list]) => ({ label: ctx.title(slug), share: share(list)?.share ?? null, restarts: Math.max(0, new Set(list.map((r) => r.session).filter(Boolean)).size - 1), usd: r2(sum(list, (r) => r.usd)) }))
    .filter((j) => j.share !== null).sort((a, b) => a.share - b.share).slice(0, 3);
  const table = { caption: 'Share of your jobs’ input read from the cache, by plan week. Higher is cheaper.', head: ['Week', 'From the cache', 'Input in all'], rows: perWeek.map((w) => [w.label, w.share === null ? 'Nothing recorded' : pct(w.share * 100), w.input ? `${Math.round(w.input / 1000).toLocaleString('en-GB')}k tokens` : '—']) };
  const base = { id: 'cache', n: 10, title: 'Cache reuse', audience: 'private', data: { weeks: perWeek, least: jobs }, table };
  const withData = perWeek.filter((w) => w.share !== null);
  if (!withData.length) return graph({ ...base, state: 'empty', headline: 'No input recorded for your jobs yet.', todo: 'Nothing to do yet.' });
  const latest = withData.at(-1);
  const prev = withData.at(-2);
  const which = latest === perWeek.at(-1) ? 'this week' : `in the ${latest.label.toLowerCase()}`;
  const headline = `${pct(latest.share * 100)} of input came from the cache ${which}${prev ? `, ${Math.round(latest.share * 100) === Math.round(prev.share * 100) ? 'the same as' : latest.share > prev.share ? `up from ${pct(prev.share * 100)}` : `down from ${pct(prev.share * 100)}`}${Math.round(latest.share * 100) === Math.round(prev.share * 100) ? ' the week before' : ' the week before'}` : ''}.`;
  const worst = jobs[0];
  const todo = worst && worst.restarts >= 3 && worst.share < 0.5 ? `Keep long jobs in one session: ${worst.label} restarted ${plural(worst.restarts, 'time')} and reused only ${pct(worst.share * 100)}.` : 'Nothing to change.';
  return graph({ ...base, state: 'ok', headline, todo });
}

// ---------- All ten ----------

export const GRAPH_IDS = ['limit', 'ticket-cost', 'stages', 'models', 'people', 'rework', 'waiting', 'pr1', 'when', 'cache'];

/**
 * The ten graphs for one window, in order. lines: the raw usage lines (the meters' readings come
 * from them); opts: { window, now, from, me, timeZone, meters, reading, ratio, ratio5, limits,
 * titles, jobs, audit }.
 */
export function insightGraphs(lines, opts) {
  const now = typeof opts.now === 'number' ? opts.now : Date.parse(opts.now);
  const rec = opts.record ?? cleanRecord(lines, { now, jobs: opts.jobs ?? null, audit: opts.audit ?? null, tempRoots: opts.tempRoots });
  const titles = opts.titles ?? {};
  const ctx = { ...opts, now, rec, lines: opts.cleanLines ?? recordLines(rec), title: (slug) => titles[slug] ?? rec.jobs.get(slug)?.title ?? slug ?? 'No job' };
  return [limitGraph, ticketCostGraph, stagesGraph, modelsGraph, peopleGraph, reworkGraph, waitingGraph, pr1Graph, whenGraph, cacheGraph].map((f) => f(rec, ctx));
}

/**
 * Everything the insight graphs need, from the raw usage lines: the cleaned record, percent per
 * dollar (short stretches), the two meters' splits into this app's people and Other use, and the
 * ten graphs. opts: { window, now, me, meters (the live reading: { fiveHour, week, checkedAt }),
 * timeZone, titles, jobs, audit, tempRoots, shortStretch }. Returns { record, ratio, ratio5, limits, graphs }.
 */
export function insightsFor(lines, { window = 'week', now = Date.now(), me = null, meters = null, timeZone, titles = {}, jobs = null, audit = null, tempRoots, shortStretch = SHORT_STRETCH } = {}) {
  const end = typeof now === 'number' ? now : Date.parse(now);
  const record = cleanRecord(lines, { now: end, jobs, audit, tempRoots });
  const clean = recordLines(record);
  const month = clean.filter((l) => Date.parse(l.t) >= end - 30 * DAY);
  const ratio = percentPerDollar(month, { shortStretch });
  const ratio5 = percentPerDollar(month, { meter: 'fiveHour', shortStretch });
  const reading = meters?.checkedAt ? { t: meters.checkedAt, week: meters.week ?? null, fiveHour: meters.fiveHour ?? null } : null;
  const week = limitSplit(clean, { meter: 'week', now: end, reading, ratio, shortStretch });
  const fiveHour = limitSplit(clean, { meter: 'fiveHour', now: end, reading, ratio: ratio5, shortStretch });
  const limits = { week: { ...week, sentence: splitWords(week, { name: 'This week' }) }, fiveHour: { ...fiveHour, sentence: splitWords(fiveHour, { name: 'This five hours' }) }, note: OTHER_NOTE };
  // The meters to go by for the plan weeks: the live reading, else the newest line's.
  const newest = [...clean].reverse().find((l) => l.meters.week)?.meters ?? null;
  const m = meters?.week ? meters : newest;
  const { from } = windowRange(window, { now: end, meters: m, timeZone });
  const graphs = insightGraphs(lines, { window, now: end, from, me, timeZone, meters: m, reading, ratio, ratio5, limits, titles, record, cleanLines: clean });
  return { record, ratio, ratio5, limits, graphs, from };
}
