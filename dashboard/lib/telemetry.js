// Telemetry's sums (packets T and P), worked out from the usage lines (lib/usage-log.js) as pure
// functions: the windows and the plan week, percent per dollar, the meters' split into this app's
// use and Other use, and the forecast. The ten insight graphs built on them are lib/insights.js;
// telemetry() is what GET /api/telemetry answers. "private" graphs carry your own work (your lines,
// with job names); "common" ones are about the shared account (no job names), so v2 can show those
// to the team.
//
// Plan percent: a line's share of the weekly limit is its cost times the account's percent per
// dollar, worked out from short stretches only (two readings minutes apart with this app's spend
// between them; see "Other use" below), so use of the account outside this app doesn't inflate it.
// Without meters (demo, plan usage off), or before there are enough short stretches, percents are
// null and dollars stand alone.
import { insightsFor } from './insights.js';

const H = 3600e3;
const DAY = 24 * H;
export const WINDOWS = ['5h', 'week', '30d'];
export const WINDOW_LABELS = { '5h': 'This five hours', week: 'This week', '30d': '30 days' };
/** How far back the runner reads the usage log for Telemetry, unless it says (readFrom). */
export const READ_DAYS = 31;

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));
const iso = (t) => new Date(t).toISOString();
const cost = (l) => (typeof l.costUsd === 'number' && Number.isFinite(l.costUsd) ? l.costUsd : 0);
const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 1e4) / 1e4;
export const usd = (n) => `$${(n ?? 0).toFixed(2)}`;
export const pct = (n) => `${Math.round(n)}%`;

const FORMATS = new Map(); // one Intl formatter per zone and options: making them is the slow part
/** The clock's parts at t in the time zone (Intl's formatToParts, en-GB), as { type: value }. */
export function parts(t, timeZone, opts) {
  const key = `${timeZone ?? ''}|${JSON.stringify(opts)}`;
  let f = FORMATS.get(key);
  if (!f) { f = new Intl.DateTimeFormat('en-GB', { timeZone, ...opts }); FORMATS.set(key, f); }
  return Object.fromEntries(f.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
}
/** "Thursday 03:48", with the date when it is a week or more away. */
export function whenWords(t, { now, timeZone } = {}) {
  const p = parts(t, timeZone, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const far = now !== undefined && ms(t) - ms(now) >= 6 * DAY;
  return `${p.weekday}${far ? ` ${p.day} ${p.month}` : ''} ${p.hour}:${p.minute}`;
}
/** The calendar day (YYYY-MM-DD) in the time zone. */
export function dayKey(t, timeZone) {
  const p = parts(t, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

// ---------- The plan week: Wednesday 16:00, local time ----------
// The Claude plan's weekly limit resets every Wednesday at 16:00 on this computer's clock (Vignesh,
// 2026-10-29; his Mac is on America/Phoenix). "This week" starts at the weekly meter's own reset
// when there is a reading, else at the last Wednesday 16:00 local; the weeks before step back seven
// days each from there (on the local clock, so a daylight-time change keeps 16:00). Never Monday,
// never a rolling seven days.
export const WEEK_START = Object.freeze({ weekday: 3, hour: 16 }); // Wednesday, 16:00

/** How far the local clock is ahead of UTC at t, in ms. */
function zoneOffset(t, timeZone) {
  const p = parts(t, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}
/** The moment the local clock shows this date and time (month from 0; days may run over). */
export function localTime(y, mo, d, h, mi, timeZone) {
  const wall = Date.UTC(y, mo, d, h, mi);
  const first = wall - zoneOffset(wall, timeZone);
  return wall - zoneOffset(first, timeZone);
}
export const localDate = (t, timeZone) => {
  const p = parts(t, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return { y: +p.year, mo: +p.month - 1, d: +p.day };
};

/** The last Wednesday 16:00 local at or before t. */
export function planWeekStart(t, { timeZone } = {}) {
  const at = ms(t);
  const { y, mo, d } = localDate(at, timeZone);
  const back = (new Date(Date.UTC(y, mo, d)).getUTCDay() - WEEK_START.weekday + 7) % 7;
  const start = localTime(y, mo, d - back, WEEK_START.hour, 0, timeZone);
  return start <= at ? start : localTime(y, mo, d - back - 7, WEEK_START.hour, 0, timeZone);
}

/** The same local time, n days on (n may be negative). */
function daysOn(t, n, timeZone) {
  const { y, mo, d } = localDate(t, timeZone);
  const p = parts(t, timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return localTime(y, mo, d + n, +p.hour, +p.minute, timeZone);
}

/** The weekly meter's reset, when it says when this week (the one holding `end`) ends; else null. */
function meterWeekEnd(meters, end) {
  const r = meters?.week?.resetsAt ? Date.parse(meters.week.resetsAt) : NaN;
  return Number.isFinite(r) && r > end && r - 7 * DAY <= end ? r : null;
}

/**
 * The plan weeks from `from` to `now`, the newest first: { from, to, label, current }. The current
 * week comes from the weekly meter's reset when there is a reading, else from Wednesday 16:00 local;
 * the ones before step back seven days each (seven days of the meter's rhythm, or seven local days).
 */
export function planWeeks({ now, from = null, meters = null, timeZone, count = null } = {}) {
  const end = ms(now);
  const reset = meterWeekEnd(meters, end);
  const back = (t) => (reset !== null ? t - 7 * DAY : daysOn(t, -7, timeZone));
  let lo = reset !== null ? reset - 7 * DAY : planWeekStart(end, { timeZone });
  let hi = reset !== null ? reset : daysOn(lo, 7, timeZone);
  const weeks = [];
  for (;;) {
    weeks.push({ from: lo, to: hi, label: weekLabel(lo, timeZone), current: weeks.length === 0 });
    if (count !== null && weeks.length >= count) break;
    if (count === null && (from === null || lo <= ms(from))) break;
    hi = lo;
    lo = back(lo);
  }
  return weeks;
}

/** "Week from Wed 28 Oct, 4 pm". */
export function weekLabel(t, timeZone) {
  const p = parts(t, timeZone, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const h = +p.hour;
  const time = `${h % 12 || 12}${p.minute === '00' ? '' : `:${p.minute}`} ${h < 12 ? 'am' : 'pm'}`;
  return `Week from ${p.weekday} ${p.day} ${p.month.replace(/^Sept$/, 'Sep')}, ${time}`;
}

/** The plan week holding t, from a list planWeeks gave (the newest first); null when before them all. */
export function weekOf(t, weeks) {
  const at = ms(t);
  return weeks.find((w) => at >= w.from && at < w.to) ?? (weeks[0] && at >= weeks[0].to ? weeks[0] : null);
}

/**
 * The window's start and end. 5h: the five-hour limit's current window (from its reset time), else
 * the last five hours. week: the plan week (planWeeks: the weekly meter's reset, else Wednesday
 * 16:00 local). 30d: the last 30 days.
 */
export function windowRange(window, { now, meters = null, timeZone } = {}) {
  const end = ms(now);
  if (window === '5h') {
    const r = meters?.fiveHour?.resetsAt ? Date.parse(meters.fiveHour.resetsAt) : NaN;
    return { from: Number.isFinite(r) && r > end && r - 5 * H <= end ? r - 5 * H : end - 5 * H, to: end };
  }
  if (window === 'week') return { from: planWeeks({ now: end, meters, timeZone, count: 1 })[0].from, to: end };
  return { from: end - 30 * DAY, to: end };
}

// ---------- Other use: the meters' rise this app's own lines don't explain ----------
// The usage log only sees this app's turns on this computer; the plan meters see everything on the
// Claude account: claude.ai, the Claude app, someone's own Claude Code, and (until the team site
// gathers every laptop's log, v2) this app on another computer. So:
//   - percent per dollar comes only from short stretches: two readings close together (SHORT_STRETCH)
//     in the same meter window, with this app's spend between them, so outside use in long quiet
//     gaps can't inflate it;
//   - for each stretch between two readings, this app's share is its spend there times percent per
//     dollar, and the rest of the rise is Other use. Added up over the window (the window starts at
//     0 at its reset), never below zero. A stretch whose meter went down without a reset, or before a
//     first reading whose window isn't known, is unknown and stays out: never guessed.
// Other use is a percent of the limit only (its dollars aren't known), and always "estimated".
//
// Your Claude Code use outside this app (packet U, lib/claude-code-usage.js): when it is counted,
// `outside` is its replies ({ t, user, usd }), read from this computer's Claude Code logs. It is
// known spend like this app's lines: it counts in the short stretches' spend (so more stretches
// qualify, and terminal use between two readings no longer inflates percent per dollar), each
// person's part of the meter is split into `app` and `claudeCode`, and Other use is what is left:
// claude.ai, the Claude app and other people. `outside` null (the setting off, or not read yet):
// every sum is exactly as without it.
export const SHORT_STRETCH = 20 * 60e3;
/** What Other use means, said under the "Who used this week's limit" line. */
export const OTHER_NOTE = 'Other use is use of this Claude account outside this app: claude.ai, the Claude app, or someone’s own Claude Code. This app can’t see who, so it is one estimate: the limit’s rise that this app’s own work doesn’t explain. It includes anyone using this app on another computer: they show by name once the team site exists.';
export const OTHERS_ROW = 'Outside this app: claude.ai, the Claude app and anyone else on the account, including this app on other computers. Estimated from the meter.';
/** Other use's name once your Claude Code use is counted by name. */
export const OTHER_LABEL = 'Other use (claude.ai, the Claude app, other people)';
/** What Other use means then, said under the "Who used this week's limit" line. */
export const OTHER_NOTE_CLAUDE_CODE = 'Other use is the limit’s rise that this app’s jobs and your Claude Code use on this computer don’t explain: claude.ai, the Claude app and other people. It is one estimate. Only this computer’s Claude Code logs are read, so a teammate’s Claude Code on their own computer is in it too, until they run this app.';
export const SPANS = { week: 7 * DAY, fiveHour: 5 * H };
// Enough to go by: at least this many short stretches and this many points of rise among them (the
// meters read whole percents, so one stretch alone says little).
const MIN_STRETCHES = 3;
const MIN_RISE = 3;

/** One meter's readings from the lines (plus the live reading), one per moment, the oldest first. */
export function readingsOf(lines, meter = 'week', { reading = null } = {}) {
  const at = new Map();
  const add = (t, m) => {
    if (!m || typeof m.percent !== 'number' || !Number.isFinite(t)) return;
    const r = m.resetsAt ? Date.parse(m.resetsAt) : NaN;
    at.set(t, { t, percent: m.percent, resetsAt: Number.isFinite(r) ? r : null });
  };
  for (const l of lines) add(ms(l.t), l.meters?.[meter]);
  if (reading?.t) add(ms(reading.t), reading[meter]);
  return [...at.values()].sort((x, y) => x.t - y.t);
}

/** The spend of the lines in (lo, hi], from a sorted list's running totals. */
function spender(lines) {
  const ts = lines.map((l) => ms(l.t));
  const sum = [0];
  for (const l of lines) sum.push(sum.at(-1) + cost(l));
  const upTo = (t) => { let lo = 0; let hi = ts.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (ts[mid] <= t) lo = mid + 1; else hi = mid; } return lo; };
  return (lo, hi) => sum[upTo(hi)] - sum[upTo(lo)];
}
const byTime = (lines) => [...lines].filter((l) => Number.isFinite(ms(l.t))).sort((a, b) => ms(a.t) - ms(b.t));
/** Your Claude Code replies as spend lines ({ t, user, costUsd }), the oldest first; null when not counted. */
export function outsideLines(outside) {
  if (!Array.isArray(outside)) return null;
  return byTime(outside.map((r) => ({ t: r.t, user: r.user ?? 'unknown', costUsd: typeof r.costUsd === 'number' ? r.costUsd : r.usd })));
}

/**
 * Percent of the limit per dollar of this app's spend, from short stretches only:
 * { ratio, stretches, rise, usd }, ratio null when there is too little to go by.
 */
export function percentPerDollarInfo(lines, { meter = 'week', shortStretch = SHORT_STRETCH, outside = null } = {}) {
  const sorted = byTime(lines);
  const cc = outsideLines(outside);
  const spend = spender(cc ? byTime([...sorted, ...cc]) : sorted);
  const ccSpend = cc ? spender(cc) : null;
  const pts = readingsOf(sorted, meter);
  let rise = 0;
  let usd = 0;
  let ccUsd = 0;
  let stretches = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (b.t - a.t > shortStretch || a.resetsAt !== b.resetsAt || b.percent < a.percent) continue;
    const spent = spend(a.t, b.t);
    if (!(spent > 0)) continue;
    rise += b.percent - a.percent;
    usd += spent;
    if (ccSpend) ccUsd += ccSpend(a.t, b.t);
    stretches++;
  }
  const ratio = stretches >= MIN_STRETCHES && rise >= MIN_RISE && usd > 0 ? rise / usd : null;
  return { ratio, stretches, rise, usd: r2(usd), ...(cc ? { claudeCodeUsd: r2(ccUsd) } : {}) };
}

/** Percent of the weekly limit (or the 5-hour one) per dollar, from short stretches; null when too little to go by. */
export function percentPerDollar(lines, opts = {}) {
  return percentPerDollarInfo(lines, opts).ratio;
}

/**
 * Who used one meter's current window: this app's people (their spend there times percent per
 * dollar) and Other use (the rest of the rise, estimated), adding up to the meter. meter: 'week' or
 * 'fiveHour'. reading: the live reading ({ t, week, fiveHour }). Returns
 * { meter, state, from, to, total, free, app, people: [{ user, usd, percent }], other, unknown,
 *   stretches: [{ from, to, rise, app, other, known }] }
 * state: 'split' (both parts known), 'no-ratio' (readings, but percent per dollar isn't known yet:
 * only the total), 'no-readings' (no reading in the window), 'stale' (the newest reading is from an
 * earlier window).
 */
export function limitSplit(lines, { meter = 'week', now, reading = null, ratio = undefined, shortStretch = SHORT_STRETCH, outside = null } = {}) {
  const end = ms(now);
  const sorted = byTime(lines).filter((l) => ms(l.t) <= end);
  const cc = outsideLines(outside)?.filter((l) => ms(l.t) <= end) ?? null;
  const pts = readingsOf(sorted, meter, { reading }).filter((p) => p.t <= end);
  const rate = ratio === undefined ? percentPerDollar(sorted, { meter, shortStretch, outside: cc }) : ratio;
  const span = SPANS[meter];
  const last = pts.at(-1) ?? null;
  const base = { meter, from: null, to: null, total: null, free: null, app: null, people: [], other: null, unknown: null, stretches: [], ratio: rate === null ? null : r4(rate) };
  if (!last) return { ...base, state: 'no-readings' };
  const known = last.resetsAt !== null && last.resetsAt > end && last.resetsAt - span <= end;
  // The newest reading's window has ended (a reset since): what it said is over.
  if (last.resetsAt !== null && last.resetsAt <= end) return { ...base, state: 'stale' };
  const from = known ? last.resetsAt - span : null;
  const inWin = pts.filter((p) => p.resetsAt === last.resetsAt && (from === null || p.t >= from));
  const total = last.percent;
  const free = Math.max(0, 100 - total);
  const out = { ...base, from: from === null ? null : iso(from), to: iso(last.t), total, free };
  if (rate === null) return { ...out, state: 'no-ratio' };
  const spend = spender(sorted);
  const ccSpend = cc ? spender(cc) : () => 0;
  const ccPart = (x) => (cc ? { claudeCode: r2(x) } : {});
  // The window starts at 0 at its reset; without a known reset the part before the first reading is unknown.
  const chain = from === null ? inWin : [{ t: from, percent: 0 }, ...inWin.filter((p) => p.t > from)];
  const stretches = [];
  if (from === null && chain[0]) stretches.push({ from: null, to: iso(chain[0].t), rise: chain[0].percent, app: null, ...(cc ? { claudeCode: null } : {}), other: null, known: false });
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1];
    const b = chain[i];
    const rise = b.percent - a.percent;
    const app = spend(a.t, b.t) * rate;
    const ccHere = ccSpend(a.t, b.t) * rate;
    stretches.push(rise < 0
      ? { from: iso(a.t), to: iso(b.t), rise, app: r2(app), ...ccPart(ccHere), other: null, known: false }
      : { from: iso(a.t), to: iso(b.t), rise, app: r2(app), ...ccPart(ccHere), other: r2(rise - app - ccHere), known: true });
  }
  // The people: their spend in the window, up to the newest reading (later lines aren't on the meter
  // yet), in this app and (when counted) in Claude Code outside it.
  const lo = from ?? (chain[0]?.t ?? last.t);
  const inside = (l) => ms(l.t) > lo && ms(l.t) <= last.t;
  const users = new Map();
  const add = (user, k, u) => { const p = users.get(user) ?? { app: 0, cc: 0 }; p[k] += u; users.set(user, p); };
  for (const l of sorted.filter(inside)) add(l.user ?? 'unknown', 'app', cost(l));
  for (const l of (cc ?? []).filter(inside)) add(l.user ?? 'unknown', 'cc', cost(l));
  let people = [...users.entries()].map(([user, u]) => ({ user, usd: r2(u.app), percent: u.app * rate, cc: u.cc * rate, ccUsd: u.cc }))
    .sort((x, y) => (y.percent + y.cc) - (x.percent + x.cc) || x.user.localeCompare(y.user));
  let app = people.reduce((s, p) => s + p.percent, 0);
  let mineCc = people.reduce((s, p) => s + p.cc, 0);
  // The estimate can come out a little over the meter (whole percents): never more than the meter shows.
  if (app + mineCc > total && app + mineCc > 0) {
    const k = total / (app + mineCc);
    people = people.map((p) => ({ ...p, percent: p.percent * k, cc: p.cc * k }));
    app *= k;
    mineCc *= k;
  }
  const other = Math.min(Math.max(0, stretches.filter((x) => x.known).reduce((s, x) => s + x.other, 0)), total - app - mineCc);
  const unknown = Math.max(0, total - app - mineCc - other);
  return {
    ...out, state: 'split', app: r2(app), ...ccPart(mineCc), other: r2(other), unknown: r2(unknown),
    // percent: the person's part in this app (as before); with Claude Code counted, also app (the
    // same) and claudeCode (their part outside this app), with its spend.
    people: people.map(({ cc: c, ccUsd, ...p }) => ({ ...p, percent: r2(p.percent), ...(cc ? { app: r2(p.percent), claudeCode: r2(c), claudeCodeUsd: r2(ccUsd) } : {}) })),
    stretches: stretches.map((x) => (x.known ? { ...x, other: r2(Math.max(0, x.other)) } : x)),
  };
}

/**
 * Every known stretch between two readings of one meter, across all its windows, with the part of
 * its rise this app's spend doesn't explain: [{ from, to, other }] in ms (other > 0 only). A
 * window's first reading counts from the window's start, at 0. For spreading Other use over the
 * hours it happened in ("When the limit goes"); empty without percent per dollar.
 */
export function otherStretches(lines, { meter = 'week', ratio = null, reading = null, outside = null } = {}) {
  if (ratio === null || ratio === undefined) return [];
  const sorted = byTime(lines);
  const cc = outsideLines(outside);
  const spend = spender(cc ? byTime([...sorted, ...cc]) : sorted);
  const pts = readingsOf(sorted, meter, { reading });
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (b.resetsAt === null) continue;
    const start = a && a.resetsAt === b.resetsAt ? a.t : b.resetsAt - SPANS[meter];
    const base = a && a.resetsAt === b.resetsAt ? a.percent : 0;
    if (start >= b.t || b.percent < base) continue;
    const other = b.percent - base - spend(start, b.t) * ratio;
    if (other > 0) out.push({ from: start, to: b.t, other: r4(other) });
  }
  return out;
}

/** "This week: 63% used. In this app 22% (vignesh), other use 41% (estimated)." */
export function splitWords(split, { name = 'This week' } = {}) {
  if (split.state === 'no-readings' || split.state === 'stale') return `Can’t see use outside this app yet: no limit readings ${name === 'This week' ? 'this week' : 'in this five hours'}.`;
  const head = `${name}: ${pct(split.total)} used.`;
  if (split.state === 'no-ratio') return `${head} Can’t split it between this app and other use yet: that needs a few readings close together while the app is working.`;
  const notKnown = split.unknown >= 1 ? `, not known ${pct(split.unknown)}` : '';
  if (typeof split.claudeCode === 'number') {
    // Your Claude Code use counted: each part with the people in it.
    const names = (key) => {
      const list = split.people.filter((p) => p[key] >= 0.5);
      return list.length ? ` (${list.map((p) => (list.length > 1 ? `${p.user} ${pct(p[key])}` : p.user)).join(', ')})` : '';
    };
    return `${head} In this app ${pct(split.app)}${names('app')}, in Claude Code ${pct(split.claudeCode)}${names('claudeCode')}, other use ${pct(split.other)} (claude.ai, the Claude app, other people; estimated)${notKnown}.`;
  }
  const who = split.people.length ? ` (${split.people.map((p) => (split.people.length > 1 ? `${p.user} ${pct(p.percent)}` : p.user)).join(', ')})` : '';
  return `${head} In this app ${pct(split.app)}${who}, other use ${pct(split.other)} (estimated)${notKnown}.`;
}

/**
 * Which part drives a rise between two moments: { app, other, words } (percent points), with
 * claudeCode (your Claude Code use outside this app) when it is counted; null without percent per dollar.
 */
export function riseDriver(lines, { from, to, rise, ratio, outside = null }) {
  if (ratio === null || ratio === undefined || !(rise > 0)) return null;
  const app = Math.min(rise, spender(byTime(lines))(ms(from), ms(to)) * ratio);
  const cc = outsideLines(outside);
  if (!cc) {
    const other = rise - app;
    return { app: r2(app), other: r2(other), words: other > app ? 'mostly from use outside this app' : 'mostly from this app’s jobs' };
  }
  const mine = Math.min(rise - app, spender(cc)(ms(from), ms(to)) * ratio);
  const other = rise - app - mine;
  const words = other > app && other > mine ? 'mostly from use outside this app' : mine > app ? 'mostly from your Claude Code use outside this app' : 'mostly from this app’s jobs';
  return { app: r2(app), claudeCode: r2(mine), other: r2(other), words };
}

const MIN_PACE_SPAN = 6 * H;

/**
 * When the weekly limit fills at the last 24 hours' pace: the first reading at or after a day
 * before the newest, in the same plan week, to the newest. reading: the meters' live reading
 * ({ t, week }), used when newer than the last line.
 */
export function forecast(lines, { now, reading = null, timeZone } = {}) {
  const pts = lines.filter((l) => typeof l.meters?.week?.percent === 'number').map((l) => ({ t: ms(l.t), percent: l.meters.week.percent, resetsAt: l.meters.week.resetsAt }));
  if (reading?.week && typeof reading.week.percent === 'number' && reading.t && (!pts.length || ms(reading.t) > pts.at(-1).t)) pts.push({ t: ms(reading.t), percent: reading.week.percent, resetsAt: reading.week.resetsAt });
  const end = ms(now);
  const last = pts.at(-1);
  const base = { from: null, to: null, perHour: null, fullAt: null, resetsAt: null, atReset: null };
  if (!last || end - last.t > DAY) return { ...base, state: 'unknown', sentence: 'No reading of the weekly limit in the last day, so no forecast yet.' };
  const resetsAt = last.resetsAt && Date.parse(last.resetsAt) > end ? Date.parse(last.resetsAt) : null;
  const to = { t: iso(last.t), percent: last.percent };
  const resetWords = resetsAt ? whenWords(resetsAt, { now, timeZone }) : null;
  if (last.percent >= 100) return { ...base, to, resetsAt: resetsAt && iso(resetsAt), state: 'full', sentence: `The weekly limit is used up${resetWords ? `; it resets on ${resetWords}` : ''}.` };
  const first = pts.find((p) => p.t >= last.t - DAY && p.resetsAt === last.resetsAt);
  if (!first || first.t === last.t) return { ...base, to, resetsAt: resetsAt && iso(resetsAt), state: 'unknown', sentence: 'Only one reading in the last day: not enough to say when the week fills.' };
  // A few hours of one busy morning say little about a week: six hours of readings at the least.
  if (last.t - first.t < MIN_PACE_SPAN) return { ...base, to, resetsAt: resetsAt && iso(resetsAt), state: 'unknown', sentence: 'Less than six hours of readings this week: too soon to say when it fills.' };
  const perHour = (last.percent - first.percent) / ((last.t - first.t) / H);
  const from = { t: iso(first.t), percent: first.percent };
  if (perHour <= 0) return { ...base, from, to, perHour: 0, resetsAt: resetsAt && iso(resetsAt), state: 'flat', sentence: `The weekly use hasn’t gone up in the last day; it is at ${pct(last.percent)}.` };
  const fullAt = last.t + ((100 - last.percent) / perHour) * H;
  if (resetsAt && fullAt >= resetsAt) {
    const atReset = last.percent + perHour * ((resetsAt - last.t) / H);
    return { ...base, from, to, perHour: r4(perHour), resetsAt: iso(resetsAt), atReset: r2(atReset), state: 'resets-first', sentence: `At this pace the week resets on ${resetWords} before it fills, at about ${pct(atReset)}.` };
  }
  return { ...base, from, to, perHour: r4(perHour), fullAt: iso(fullAt), resetsAt: resetsAt && iso(resetsAt), state: 'fills', sentence: `At this pace, full on ${whenWords(fullAt, { now, timeZone })}.` };
}

/**
 * Everything the Telemetry page draws for one window. lines: the last 30 days' (or more) usage
 * lines. me: this computer's user (the private graphs keep only their lines; all when null).
 * meters: the plan meters' live reading ({ fiveHour, week, checkedAt }), else the newest line's.
 * titles: job slug → title. jobs: the job list ([{ slug, title, route, finished, finishedAt, dir }])
 * and audit: the audit lines, when the runner hands them in (graphs 2, 6, 7 and 8 use them).
 * readFrom: where the lines read start (the runner's last 31 days when omitted; null: all there is),
 * so a graph never shows a week or month that wasn't read as one with nothing in it. tempRoots: the
 * temp folders whose jobs are test runs (lib/insights.js tempDirs() when omitted; [] when this
 * dashboard's own job folder is a temp one, as in a test or a demo, so its jobs count).
 * timeZone: for days, times and the plan week (the computer's own when omitted). outside: your Claude
 * Code replies outside this app (lib/claude-code-usage.js view(): [{ t, user, usd, … }]), or null
 * when they aren't counted (the setting off, or not read yet): then the answer is exactly as without.
 */
export function telemetry(allLines, { window = 'week', now = new Date(), me = null, meters = null, titles = {}, timeZone, shortStretch = SHORT_STRETCH, jobs = null, audit = null, readFrom = undefined, tempRoots = undefined, outside = null } = {}) {
  if (!WINDOWS.includes(window)) throw new RangeError('The window is one of 5h, week or 30d.');
  const end = ms(now);
  // Where the lines read start: the runner reads the last 31 days unless it says otherwise.
  const from = readFrom === undefined ? end - READ_DAYS * DAY : readFrom;
  const ins = insightsFor(allLines, { window, now: end, me, meters, timeZone, titles, jobs, audit, shortStretch, readFrom: from, tempRoots, outside });
  const cc = ins.outside ? ins.outside.filter((r) => r.ms >= ins.from && r.ms <= end) : null;
  return {
    window, windowLabel: WINDOW_LABELS[window], from: iso(ins.from), to: iso(end), me,
    percentPerDollar: ins.ratio === null ? null : r4(ins.ratio),
    lines: ins.record.rows.filter((r) => r.ms >= ins.from).length,
    limits: ins.limits,
    graphs: ins.graphs,
    // Which sources the graphs had: the audit log (send-backs, answers) and the job list (route size, the finish line).
    sources: { audit: Array.isArray(audit), jobs: Array.isArray(jobs) },
    // Your Claude Code use outside this app in the window, when it is counted: spend and replies.
    ...(cc ? { claudeCode: { usd: r2(cc.reduce((s, r) => s + r.usd, 0)), replies: cc.length } } : {}),
  };
}
