// Team Telemetry's sums (packet 2E, decision G30's v2 half, with packets P's and U's rules): every
// paired laptop's usage numbers (lib/team-usage.js), combined into one picture of the shared Claude
// account's limit. Pure: the route reads the rows and hands them in.
//
// The three graphs about the shared account, the same for everyone on the site, the manager too:
//   limit   the shared gauge over this plan week, with the forecast. The plan week starts Wednesday
//           16:00 local (or at the weekly meter's own reset when a reading says it: dashboard/lib/
//           telemetry.js planWeeks). Every laptop's readings are one line, and the forecast's pace
//           is the meter's combined rise, so it uses every person's use; its words say whose use
//           drives it.
//   models  share by model family of the account's known use (everyone's jobs in the app and their
//           Claude Code use outside it), by plan week. Other use has no model, so it isn't in it.
//   people  "Who used this week's limit": each person's use in the app and in Claude Code outside
//           it, kept apart, then Other use (claude.ai, the Claude app, other people; estimated from
//           the meters) once for the account, then Not known and Still free. The parts are whole
//           percents that add up to the meter's total: P's "two numbers, one total".
// Other use is the meter's rise that everyone's known spend doesn't explain (telemetry.js
// limitSplit): never below zero, a stretch the meter can't account for is "not known", never guessed.
// Percent per dollar comes from short stretches only (telemetry.js percentPerDollar), now with every
// laptop's spend known between two readings, so it is truer than any one laptop's.
//
// The two graphs about a person's own jobs stay private to that person, as on the laptop:
//   by-day        usage by day, by job (the last 14 days)
//   ticket-stage  cost per ticket and per stage (the last 30 days)
// They carry job names and tickets, so the route serves them only to their own person.
//
// One site is one shared account: every line on it counts toward the same limit.

import { modelFamily, PRICES } from '../../dashboard/lib/cost.js';
import { slugTicketKey } from '../../dashboard/lib/orbit.js';
import { STAGES } from '../../dashboard/lib/stages.js';
import { dayKey, forecast, limitSplit, localDate, localTime, parts, percentPerDollar, planWeeks, SHORT_STRETCH, whenWords } from '../../dashboard/lib/telemetry.js';

const H = 3600e3;
const DAY = 24 * H;
const MIN = 60e3;
const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 1e4) / 1e4;
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
export const pct = (n) => `${Math.round(n)}%`;
export const usd = (n) => `$${(n ?? 0).toFixed(2)}`;
const iso = (t) => new Date(t).toISOString();
const toMs = (v) => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v));

/** Other use's name: what the meters see that nobody's app or Claude Code use on the site explains. */
export const OTHER_LABEL = 'Other use (claude.ai, the Claude app, other people)';
export const OTHER_NOTE = 'Other use is the limit’s rise that nobody’s use on this site explains: claude.ai, the Claude app, and anyone on the account who hasn’t paired a laptop here. It is one estimate for the whole account, worked out from the meters, in percent only.';
export const WEEK_NOTE = 'The week starts on Wednesday at 4 pm, when the plan’s weekly limit resets (or at the meter’s own reset time, when a reading says it).';
/** When nobody on the site has said where they are: the team's own clock (the plan week's 16:00 is theirs). */
export const TEAM_TIME_ZONE = 'America/Phoenix';
/** The plan weeks Share by model shows. */
const MODEL_WEEKS = 6;
/** Points on the gauge: at most one per this, the last in each. */
const POINT_EVERY = 10 * MIN;
const FAMILY_ORDER = ['opus', 'sonnet', 'haiku', 'fable'];
const familyName = (f) => (PRICES[f]?.label ?? (f === 'other' ? 'Other models' : 'Not known')).replace(/ [\d.]+$/, '');
const stageName = (id) => STAGES.find((s) => s.id === id)?.label ?? (id ? String(id) : 'No stage');
const graph = (g) => ({ sub: null, notes: [], table: { caption: '', head: [], rows: [] }, data: {}, ...g });

/** The time zone to show the week in: the one asked for when it is a real one, else the team's. */
export function zoneOf(asked) {
  if (typeof asked === 'string' && asked && asked.length <= 64) {
    try { new Intl.DateTimeFormat('en-GB', { timeZone: asked }); return asked; } catch { /* not a zone */ }
  }
  return TEAM_TIME_ZONE;
}

// ---------- The rows, as the laptop's sums take them ----------

const key = (personId) => `p${personId}`;
// A meter's reset, to the minute: two laptops reading the same meter may differ by a moment.
const resetOf = (v) => (v ? iso(Math.round(toMs(v) / MIN) * MIN) : null);
const meterOf = (percent, resets) => (percent === null || percent === undefined ? null : { percent: Number(percent), resetsAt: resetOf(resets) });

/**
 * The stored rows (usage_lines) as the laptop's usage lines: { lines (app and readings, the oldest
 * first), outside (Claude Code replies outside the app) }. user: the person's key (p<id>).
 */
export function linesOf(rows) {
  const lines = [];
  const outside = [];
  for (const r of rows) {
    const t = toMs(r.t);
    if (!Number.isFinite(t)) continue;
    const base = { t: iso(t), ms: t, user: key(r.person_id), personId: Number(r.person_id) };
    const tokens = { input: Number(r.input) || 0, output: Number(r.output) || 0, cacheRead: Number(r.cache_read) || 0, cacheWrite5m: Number(r.cache_write_5m) || 0, cacheWrite1h: Number(r.cache_write_1h) || 0 };
    if (r.kind === 'claude-code') { outside.push({ ...base, usd: Number(r.usd) || 0, costUsd: Number(r.usd) || 0, family: r.model ?? 'other', tokens }); continue; }
    lines.push({
      ...base, kind: r.kind, job: r.job ?? null, stage: r.stage ?? null, model: r.model ?? null, tokens,
      costUsd: r.kind === 'reading' ? 0 : Number(r.usd) || 0,
      meters: { week: meterOf(r.week_percent, r.week_resets_at), fiveHour: meterOf(r.five_hour_percent, r.five_hour_resets_at) },
    });
  }
  const byTime = (a, b) => a.ms - b.ms;
  return { lines: lines.sort(byTime), outside: outside.sort(byTime) };
}

/**
 * Whole percents that add up to `total`: the largest remainders get the leftover points. values: the
 * parts (any order), each ≥ 0; their sum is about total.
 */
export function wholeParts(values, total) {
  const want = Math.max(0, Math.round(total));
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const have = sum(clean, (v) => v);
  const scaled = have > 0 ? clean.map((v) => (v * want) / have) : clean.map(() => 0);
  const out = scaled.map(Math.floor);
  let left = want - sum(out, (v) => v);
  const order = scaled.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out;
}

// ---------- Who used the limit ----------

/**
 * One meter's window split among the people and Other use, with names, in whole percents that add
 * up to the meter: LimitSplit (web/src/api/types.ts) with each person's app and claudeCode parts.
 * names: person key → name.
 */
export function teamSplit(lines, { meter = 'week', now, ratio, outside, names }) {
  const s = limitSplit(lines, { meter, now, ratio, outside, shortStretch: SHORT_STRETCH });
  const people = s.people.filter((p) => (p.app ?? p.percent) + (p.claudeCode ?? 0) > 0 || p.usd > 0 || (p.claudeCodeUsd ?? 0) > 0);
  if (s.state !== 'split') {
    return { ...s, people: people.map((p) => ({ ...p, key: p.user, user: names.get(p.user) ?? 'Someone' })) };
  }
  // Whole percents: each person's two parts, Other use and Not known add up to the meter's total.
  const raw = [...people.flatMap((p) => [p.app ?? p.percent, p.claudeCode ?? 0]), s.other, s.unknown];
  const whole = wholeParts(raw, s.total);
  const named = people.map((p, i) => {
    const app = whole[i * 2];
    const cc = whole[i * 2 + 1];
    return { key: p.user, user: names.get(p.user) ?? 'Someone', usd: p.usd, percent: app, app, claudeCode: cc, claudeCodeUsd: p.claudeCodeUsd ?? 0 };
  }).sort((a, b) => (b.app + b.claudeCode) - (a.app + a.claudeCode) || b.usd + b.claudeCodeUsd - a.usd - a.claudeCodeUsd || a.user.localeCompare(b.user));
  const other = whole[people.length * 2];
  const unknown = whole[people.length * 2 + 1];
  return {
    ...s, people: named, app: sum(named, (p) => p.app), claudeCode: sum(named, (p) => p.claudeCode), other, unknown,
    free: Math.max(0, 100 - Math.round(s.total)), total: Math.round(s.total),
  };
}

/** "Raj 27% (22% in the app, 5% in Claude Code)". */
const personWords = (p) => {
  const bits = [p.app >= 1 ? `${pct(p.app)} in the app` : null, p.claudeCode >= 1 ? `${pct(p.claudeCode)} in Claude Code` : null].filter(Boolean);
  return `${p.user} ${pct(p.app + p.claudeCode)}${bits.length ? ` (${bits.join(', ')})` : ''}`;
};

/** The split in one sentence. */
export function teamSplitWords(split, { name = 'This week' } = {}) {
  const span = name === 'This week' ? 'this week' : 'in this five hours';
  if (split.state === 'no-readings' || split.state === 'stale') return `No reading of the limit ${span} yet: one comes with each turn of anyone’s jobs, and every few minutes from a laptop that is on.`;
  const head = `${name}: ${pct(split.total)} used.`;
  if (split.state === 'no-ratio') return `${head} Who used it can’t be split yet: that needs a few readings close together while someone’s jobs are working.`;
  const who = split.people.filter((p) => p.app + p.claudeCode >= 1).map(personWords);
  const notKnown = split.unknown >= 1 ? `, not known ${pct(split.unknown)}` : '';
  return `${head} ${who.length ? `${who.join(', ')}, ` : 'Nobody on this site, '}other use ${pct(split.other)} (claude.ai, the Claude app, other people; estimated)${notKnown}. ${pct(split.free)} is still free.`;
}

/** Who drives a rise between two moments, by name: { app, claudeCode, other, people: [{ user, part }], words }. */
export function namedDriver(lines, outside, { from, to, rise, ratio, names }) {
  if (ratio === null || ratio === undefined || !(rise > 0)) return null;
  const lo = toMs(from);
  const hi = toMs(to);
  const per = new Map();
  const add = (l, k) => { const p = per.get(l.user) ?? { app: 0, cc: 0 }; p[k] += (l.costUsd ?? l.usd ?? 0) * ratio; per.set(l.user, p); };
  for (const l of lines) if (l.ms > lo && l.ms <= hi && l.kind !== 'reading') add(l, 'app');
  for (const l of outside) if (l.ms > lo && l.ms <= hi) add(l, 'cc');
  let app = sum([...per.values()], (p) => p.app);
  let cc = sum([...per.values()], (p) => p.cc);
  const k = app + cc > rise ? rise / (app + cc) : 1;
  app *= k;
  cc *= k;
  const people = [...per.entries()].map(([u, p]) => ({ user: names.get(u) ?? 'Someone', part: r2((p.app + p.cc) * k), app: r2(p.app * k), claudeCode: r2(p.cc * k) }))
    .filter((p) => p.part > 0).sort((a, b) => b.part - a.part);
  const other = Math.max(0, rise - app - cc);
  const top = people[0];
  const words = !top || other >= top.part ? 'mostly from other use (claude.ai, the Claude app, other people)' : `mostly from ${top.user}’s use${top.claudeCode > top.app ? ' in Claude Code outside the app' : ' in the app'}`;
  return { app: r2(app), claudeCode: r2(cc), other: r2(other), people, words };
}

/** The gauge's points: every reading in [from, to], at most one per POINT_EVERY (the last in each). */
function gaugePoints(lines, from, to) {
  const out = new Map();
  for (const l of lines) {
    if (l.ms < from || l.ms > to || (!l.meters.week && !l.meters.fiveHour)) continue;
    const slot = Math.floor(l.ms / POINT_EVERY);
    const was = out.get(slot);
    out.set(slot, { t: l.t, week: l.meters.week?.percent ?? was?.week ?? null, fiveHour: l.meters.fiveHour?.percent ?? was?.fiveHour ?? null });
  }
  return [...out.values()];
}

const shortWeek = (t, timeZone) => {
  const p = parts(t, timeZone, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${p.weekday} ${p.day} ${p.month.replace(/^Sept$/, 'Sep')}`;
};

// ---------- The three common graphs ----------

function limitGraph(ctx) {
  const { lines, outside, now, timeZone, week, split, fiveHour, ratio, names } = ctx;
  const points = gaugePoints(lines, week.from, now);
  const fc0 = forecast(lines, { now, timeZone });
  const driver = fc0.from && fc0.to ? namedDriver(lines, outside, { from: fc0.from.t, to: fc0.to.t, rise: fc0.to.percent - fc0.from.percent, ratio, names }) : null;
  const fc = { ...fc0, driver };
  const resets = [...new Set(lines.map((l) => l.meters.week?.resetsAt).filter(Boolean))].filter((r) => Date.parse(r) >= week.from && Date.parse(r) <= now).sort();
  const resetWords = fc.resetsAt ? whenWords(fc.resetsAt, { now, timeZone }) : null;
  const drive = driver ? `, ${driver.words}` : '';
  const top = driver?.people[0] ?? null;
  const otherDrives = driver && (!top || driver.other >= top.part);
  let headline;
  let todo;
  if (!points.length) {
    headline = 'No reading of the weekly limit this week yet, so no forecast.';
    todo = 'Readings come with each turn of anyone’s jobs, and every few minutes from a laptop that is on.';
  } else if (fc.state === 'full') {
    headline = `The weekly limit is used up${resetWords ? `; it resets on ${resetWords}` : ''}.`;
    todo = `Nothing to do: jobs carry on${resetWords ? ` ${resetWords}` : ' after the reset'}.`;
  } else if (fc.state === 'fills') {
    const early = fc.resetsAt ? (Date.parse(fc.resetsAt) - Date.parse(fc.fullAt)) / DAY : null;
    headline = `At this pace the week is full on ${whenWords(fc.fullAt, { now, timeZone })}${early !== null && early >= 1 ? `, ${early >= 1.5 ? `${Math.round(early)} days` : 'a day'} before it resets` : ''}${drive}.`;
    todo = !driver
      ? 'The week fills before it resets: check with the others on the account before anyone starts a large job.'
      : otherDrives
      ? 'Most of the pace is other use: ask who else is on the account before anyone starts a large job.'
      : `Most of the pace is ${top.user}’s: pausing their largest job until the reset${resetWords ? ` (${resetWords})` : ''} leaves room for everyone.`;
  } else if (fc.state === 'resets-first') {
    headline = `At this pace the week ends at about ${pct(fc.atReset)}${drive}.`;
    todo = fc.atReset < 80 ? 'Nothing to change: there is room for more large jobs this week.' : 'Nothing to change, but check this again before anyone starts a large job.';
  } else if (fc.state === 'flat') {
    headline = `The weekly use hasn’t gone up in the last day; it is at ${pct(fc.to.percent)}.`;
    todo = 'Nothing to change.';
  } else {
    headline = fc.sentence;
    todo = 'The forecast needs readings a few hours apart in the last day: they come while anyone’s jobs are working.';
  }
  const notes = [WEEK_NOTE];
  if (driver) {
    const named = driver.people.filter((p) => p.part >= 0.5).map((p) => `${p.user} about ${pct(p.part)}`);
    notes.push(`In the last day the meter rose ${pct(driver.app + driver.claudeCode + driver.other)}: ${named.length ? `${named.join(', ')}, ` : ''}other use about ${pct(driver.other)} (estimated).`);
  }
  return graph({
    id: 'limit', n: 1, title: 'The shared limit this week, with the forecast', audience: 'common', state: points.length ? 'ok' : 'empty', headline, todo,
    sub: split.state === 'split' || split.state === 'no-ratio' ? split.sentence : null,
    data: { window: 'week', from: iso(week.from), to: iso(now), points, resets, forecast: fc, split, fiveHour },
    table: {
      caption: `${headline} ${week.label}.`,
      head: ['When', 'Weekly limit used', '5-hour limit used'],
      rows: points.map((p) => [whenWords(p.t, { timeZone }), p.week === null ? 'Not read' : pct(p.week), p.fiveHour === null ? 'Not read' : pct(p.fiveHour)]),
    },
    notes,
  });
}

function modelsGraph(ctx) {
  const { lines, outside, weeks, timeZone } = ctx;
  const known = [
    ...lines.filter((l) => l.kind === 'app').map((l) => ({ ms: l.ms, family: modelFamily(l.model) ?? (l.model ? 'other' : 'other'), usd: l.costUsd })),
    ...outside.map((l) => ({ ms: l.ms, family: FAMILY_ORDER.includes(l.family) ? l.family : 'other', usd: l.usd })),
  ];
  const fams = [...new Set(known.map((r) => r.family))].sort((a, b) => (FAMILY_ORDER.indexOf(a) + 1 || 9) - (FAMILY_ORDER.indexOf(b) + 1 || 9));
  const series = fams.map((f, i) => ({ key: f, label: familyName(f), slot: (FAMILY_ORDER.indexOf(f) + 1) || Math.min(8, FAMILY_ORDER.length + 1 + i) }));
  const bars = [...weeks].reverse().map((w) => {
    const list = known.filter((r) => r.ms >= w.from && r.ms < w.to);
    const total = sum(list, (r) => r.usd);
    return {
      label: w.current ? 'This week' : `From ${shortWeek(w.from, timeZone)}`, usd: r2(total),
      parts: fams.map((f) => { const u = sum(list.filter((r) => r.family === f), (r) => r.usd); return { key: f, usd: r2(u), share: total > 0 ? r4(u / total) : 0 }; }).filter((p) => p.usd > 0),
    };
  }).filter((b) => b.usd > 0);
  const table = {
    caption: 'Known spend by model family, by plan week: everyone’s jobs in the app and their Claude Code use outside it.',
    head: ['Week', ...series.map((s) => s.label), 'All'],
    rows: bars.map((b) => [b.label, ...series.map((s) => { const p = b.parts.find((x) => x.key === s.key); return p ? `${pct(p.share * 100)} (${usd(p.usd)})` : '—'; }), usd(b.usd)]),
  };
  const notes = ['Known use only: everyone’s jobs in the app and their Claude Code use outside it. Other use (claude.ai, the Claude app) has no model to show.', WEEK_NOTE];
  const base = { id: 'models', n: 3, title: 'Share by model', audience: 'common', data: { series, bars, saving: null }, table, notes };
  if (!bars.length) return graph({ ...base, state: 'empty', headline: 'No use recorded on this site yet.', todo: 'Nothing to do yet.' });
  const latest = bars.at(-1);
  const sorted = [...latest.parts].sort((a, b) => b.usd - a.usd);
  const lead = sorted[0];
  const next = sorted[1];
  const which = latest.label === 'This week' ? 'this week’s' : `the week ${latest.label.toLowerCase()}’s`;
  const headline = `${familyName(lead.key)} is ${pct(lead.share * 100)} of ${which} known use${next ? `, ${familyName(next.key)} ${pct(next.share * 100)}` : ''}.`;
  const todo = lead.key === 'opus' && lead.share >= 0.8
    ? 'Nearly all of it is on Opus: trying Sonnet for one stage on the next small jobs would show whether it holds up.'
    : 'Nothing to change.';
  return graph({ ...base, state: 'ok', headline, todo });
}

function peopleGraph(ctx) {
  const { split, counting } = ctx;
  const metered = split.state === 'split';
  const others = metered ? { label: OTHER_LABEL, percent: split.other, estimated: true } : null;
  const people = split.people.map((p) => ({ user: p.user, usd: r2(p.usd), percent: metered ? p.app : null, app: metered ? p.app : null, claudeCode: metered ? p.claudeCode : null, claudeCodeUsd: r2(p.claudeCodeUsd ?? 0) }));
  const share = (p) => (p.app === null ? 'Not known' : pct(p.app + p.claudeCode));
  const rows = [
    ...people.map((p) => [p.user, share(p), p.app === null ? 'Not known' : pct(p.app), p.claudeCode === null ? 'Not known' : pct(p.claudeCode), usd(p.usd), usd(p.claudeCodeUsd)]),
    ...(others ? [[`${OTHER_LABEL}, estimated`, pct(others.percent), '—', '—', 'Not known', 'Not known']] : []),
    ...(metered && split.unknown >= 1 ? [['Not known', pct(split.unknown), '—', '—', '—', '—']] : []),
    ...(metered ? [['Still free', pct(split.free), '—', '—', '—', '—'], ['All of the limit', '100%', '—', '—', '—', '—']] : []),
  ];
  const notes = [
    OTHER_NOTE,
    ...(metered ? [`The parts add up to the week’s total: ${pct(split.total)} used and ${pct(split.free)} still free.`] : []),
    ...counting,
  ];
  const base = {
    id: 'people', n: 2, title: 'Who used this week’s limit', audience: 'common',
    data: { window: 'week', people, others, free: metered ? split.free : null, unknown: metered ? split.unknown : null, state: split.state },
    table: { caption: 'Who used this week’s limit: each person in the app and in Claude Code outside it, then other use, once for the account.', head: ['Who', 'Share of the week', 'In the app', 'In Claude Code', 'Spend in the app', 'Spend in Claude Code'], rows },
    notes,
  };
  if (!people.length && !(others && others.percent > 0)) return graph({ ...base, state: 'empty', headline: 'Nobody has used the account this week, as far as the site knows.', todo: 'Nothing to do.' });
  let headline;
  if (metered) {
    const who = people.filter((p) => p.app + p.claudeCode >= 1);
    const said = who.length ? who.map((p, i) => (i === 0 ? `${p.user} used ${pct(p.app + p.claudeCode)} of this week’s limit` : `${p.user} ${pct(p.app + p.claudeCode)}`)).join(', ') : 'Nobody on this site used this week’s limit';
    headline = `${said}; other use ${pct(others.percent)} (estimated); ${pct(split.free)} is still free.`;
  } else if (split.state === 'no-ratio') {
    const spent = (p) => [p.usd > 0 ? `${usd(p.usd)} in the app` : null, p.claudeCodeUsd > 0 ? `${usd(p.claudeCodeUsd)} in Claude Code` : null].filter(Boolean).join(' and ') || usd(0);
    headline = `${people.map((p, i) => `${p.user}${i === 0 ? ' spent' : ''} ${spent(p)}`).join(', ')}; the split of the limit isn’t known yet.`;
  } else {
    headline = split.sentence;
  }
  const named = metered ? split.app + split.claudeCode : null;
  const todo = metered && others.percent > named && others.percent >= 10
    ? 'Most of the limit went to other use: ask who else uses the account before anyone starts a large job.'
    : metered && split.free < 20 ? 'Little is left: check the forecast before anyone starts a large job.' : 'Nothing to change.';
  return graph({ ...base, state: 'ok', headline, todo });
}

/** What each person's laptops say about their Claude Code use outside the app, when it isn't counted. */
export function countingNotes(sources, names) {
  const per = new Map();
  for (const s of sources) {
    const k = key(s.person_id);
    const was = per.get(k);
    // Counted on any laptop wins; then reading, off, not sent.
    const rank = { counted: 3, reading: 2, off: 1, 'not-sent': 0 };
    if (!was || rank[s.claude_code] > rank[was]) per.set(k, s.claude_code);
  }
  const out = [];
  for (const [k, state] of per) {
    const name = names.get(k) ?? 'Someone';
    if (state === 'off') out.push(`${name}’s Claude Code use outside the app isn’t counted (it is turned off on their laptop), so it is in Other use.`);
    else if (state === 'reading') out.push(`${name}’s laptop is still reading its Claude Code logs; until it is done, that use is in Other use.`);
    else if (state === 'not-sent') out.push(`${name}’s laptop doesn’t send its Claude Code use outside the app yet, so it is in Other use.`);
  }
  return out.sort();
}

/**
 * The team page: { from, to, timeZone, weekLabel, ratio, limits, graphs, meters, people, lines }.
 * rows: usage_lines; people: [{ id, name }]; sources: usage_sources rows; me: the viewer's id.
 */
export function teamTelemetry({ rows, people, sources = [], now = Date.now(), timeZone = TEAM_TIME_ZONE, me = null }) {
  const end = toMs(now);
  const names = new Map(people.map((p) => [key(p.id), p.name]));
  const { lines: all, outside: allOut } = linesOf(rows);
  const lines = all.filter((l) => l.ms <= end);
  const outside = allOut.filter((l) => l.ms <= end);
  const month = lines.filter((l) => l.ms >= end - 30 * DAY);
  const ccMonth = outside.filter((l) => l.ms >= end - 30 * DAY);
  const ratio = percentPerDollar(month, { outside: ccMonth });
  const ratio5 = percentPerDollar(month, { meter: 'fiveHour', outside: ccMonth });
  const newest = [...lines].reverse().find((l) => l.meters.week) ?? null;
  const newestFive = [...lines].reverse().find((l) => l.meters.fiveHour) ?? null;
  const weeks = planWeeks({ now: end, meters: newest ? { week: newest.meters.week } : null, timeZone, count: MODEL_WEEKS });
  const week = weeks[0];
  const splitWeek = teamSplit(lines, { meter: 'week', now: end, ratio, outside, names });
  const splitFive = teamSplit(lines, { meter: 'fiveHour', now: end, ratio: ratio5, outside, names });
  const limits = {
    week: { ...splitWeek, sentence: teamSplitWords(splitWeek, { name: 'This week' }) },
    fiveHour: { ...splitFive, sentence: teamSplitWords(splitFive, { name: 'This five hours' }) },
    note: OTHER_NOTE, otherLabel: OTHER_LABEL,
  };
  const counting = countingNotes(sources, names);
  const ctx = { lines, outside, now: end, timeZone, week, weeks, split: limits.week, fiveHour: limits.fiveHour, ratio, names, counting };
  const graphs = [limitGraph(ctx), peopleGraph(ctx), modelsGraph(ctx)];
  const meter = (l, m, span) => (l ? { percent: l.meters[m].percent, resetsAt: l.meters[m].resetsAt, at: l.t, current: l.meters[m].resetsAt ? Date.parse(l.meters[m].resetsAt) > end && Date.parse(l.meters[m].resetsAt) - span <= end : end - l.ms < span } : null);
  return {
    from: iso(week.from), to: iso(end), timeZone, weekLabel: week.label, me,
    percentPerDollar: ratio === null ? null : r4(ratio),
    limits, graphs,
    meters: { week: meter(newest, 'week', 7 * DAY), fiveHour: meter(newestFive, 'fiveHour', 5 * H) },
    people: people.map((p) => ({ id: p.id, name: p.name, you: p.id === me })),
    lines: lines.filter((l) => l.kind === 'app' && l.ms >= week.from).length + outside.filter((l) => l.ms >= week.from).length,
    newest: lines.length || outside.length ? iso(Math.max(lines.at(-1)?.ms ?? 0, outside.at(-1)?.ms ?? 0)) : null,
  };
}

/** The account's percent per dollar over the last 30 days, from every laptop's lines (short stretches only); null when too little. */
export function accountRatio(rows, { now = Date.now() } = {}) {
  const end = toMs(now);
  const { lines, outside } = linesOf(rows);
  const recent = (l) => l.ms >= end - 30 * DAY && l.ms <= end;
  return percentPerDollar(lines.filter(recent), { outside: outside.filter(recent) });
}

// ---------- The two private graphs: a person's own jobs ----------

const BY_DAY_DAYS = 14;
const MAX_JOBS = 6;

function byDayGraph({ rows, now, timeZone, title, ratio }) {
  const end = toMs(now);
  const { y, mo, d } = localDate(end, timeZone);
  const days = [];
  for (let i = BY_DAY_DAYS - 1; i >= 0; i--) {
    const from = localTime(y, mo, d - i, 0, 0, timeZone);
    const to = localTime(y, mo, d - i + 1, 0, 0, timeZone);
    const p = parts(from, timeZone, { weekday: 'short', day: 'numeric', month: 'short' });
    days.push({ key: dayKey(from, timeZone), label: `${p.weekday} ${p.day} ${p.month}`, from, to });
  }
  const inSpan = rows.filter((r) => r.ms >= days[0].from && r.ms < end + 1);
  const byJob = new Map();
  for (const r of inSpan) byJob.set(r.job ?? '', (byJob.get(r.job ?? '') ?? 0) + r.costUsd);
  const ranked = [...byJob.entries()].filter(([j]) => j).sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, MAX_JOBS).map(([j]) => j);
  const keyOf = (job) => (job && top.includes(job) ? job : job ? '~more' : '~none');
  const jobs = [
    ...top.map((j, i) => ({ key: j, label: title(j), slot: i + 1 })),
    ...(ranked.length > MAX_JOBS ? [{ key: '~more', label: 'Other jobs', slot: 7 }] : []),
    ...(byJob.has('') ? [{ key: '~none', label: 'No job', slot: 8 }] : []),
  ];
  const out = days.map((day) => {
    const list = inSpan.filter((r) => r.ms >= day.from && r.ms < day.to);
    const total = sum(list, (r) => r.costUsd);
    const partsOf = jobs.map((j) => ({ key: j.key, usd: r2(sum(list.filter((r) => keyOf(r.job) === j.key), (r) => r.costUsd)) })).filter((p) => p.usd > 0);
    return { key: day.key, label: day.label, usd: r2(total), percent: ratio === null ? null : r2(total * ratio), parts: partsOf };
  });
  const total = sum(out, (x) => x.usd);
  const table = {
    caption: 'Your jobs’ spend by day, the last 14 days.',
    head: ['Day', ...jobs.map((j) => j.label), 'All'],
    rows: out.map((x) => [x.label, ...jobs.map((j) => { const p = x.parts.find((q) => q.key === j.key); return p ? usd(p.usd) : '—'; }), `${usd(x.usd)}${x.percent === null ? '' : ` (${pct(x.percent)} of a week)`}`]),
  };
  const base = { id: 'by-day', n: 4, title: 'Usage by day, by job', audience: 'private', data: { days: out, jobs, ratio: ratio === null ? null : r4(ratio) }, table };
  if (!(total > 0)) return graph({ ...base, state: 'empty', headline: 'Nothing recorded for your jobs in the last two weeks.', todo: 'Nothing to do yet.' });
  const busiest = [...out].sort((a, b) => b.usd - a.usd)[0];
  const lead = [...busiest.parts].sort((a, b) => b.usd - a.usd)[0];
  const leadJob = jobs.find((j) => j.key === lead.key);
  const headline = `Your busiest day was ${busiest.label}: ${usd(busiest.usd)}${busiest.percent === null ? '' : ` (${pct(busiest.percent)} of a week)`}${leadJob && lead.usd >= busiest.usd * 0.5 ? `, most of it on ${leadJob.label}` : ''}.`;
  const big = ranked[0] && ranked[0][1] >= total * 0.6 && ranked[0][1] >= 20 ? title(ranked[0][0]) : null;
  const todo = big ? `${big} took most of your spend in two weeks: open it and check it isn’t going round in circles.` : 'Nothing to change.';
  return graph({ ...base, state: 'ok', headline, todo });
}

function ticketStageGraph({ rows, now, title, ticketOf, ratio }) {
  const end = toMs(now);
  const month = rows.filter((r) => r.ms >= end - 30 * DAY);
  const total = sum(month, (r) => r.costUsd);
  const perTicket = new Map();
  for (const r of month) {
    const k = r.job ? (ticketOf(r.job) ?? `job:${r.job}`) : '~none';
    const was = perTicket.get(k) ?? { usd: 0, jobs: new Set() };
    was.usd += r.costUsd;
    if (r.job) was.jobs.add(r.job);
    perTicket.set(k, was);
  }
  const tickets = [...perTicket.entries()].map(([k, v]) => {
    const job = [...v.jobs][0] ?? null;
    const label = k === '~none' ? 'No job' : k.startsWith('job:') ? `${title(job)} (no ticket)` : `${k} ${job ? title(job) : ''}`.trim();
    return { key: k, label, usd: r2(v.usd), percent: ratio === null ? null : r2(v.usd * ratio) };
  }).sort((a, b) => b.usd - a.usd).slice(0, 8);
  const perStage = new Map();
  for (const r of month) perStage.set(r.stage ?? '', (perStage.get(r.stage ?? '') ?? 0) + r.costUsd);
  const stages = [...perStage.entries()].map(([s, u]) => ({ stage: s || null, label: stageName(s || null), usd: r2(u), share: total > 0 ? r4(u / total) : 0, percent: ratio === null ? null : r2(u * ratio) }))
    .sort((a, b) => b.usd - a.usd);
  const of = (x) => `${usd(x.usd)}${x.percent === null ? '' : ` (${pct(x.percent)} of a week)`}`;
  const table = {
    caption: 'What your tickets and stages cost, the last 30 days.',
    head: ['Ticket or stage', 'Spend', 'Share of your spend'],
    rows: [...tickets.map((t) => [t.label, of(t), total > 0 ? pct((t.usd / total) * 100) : '—']), ...stages.map((s) => [`Stage: ${s.label}`, of(s), pct(s.share * 100)])],
  };
  const base = { id: 'ticket-stage', n: 5, title: 'Cost per ticket and per stage', audience: 'private', data: { tickets, stages, ratio: ratio === null ? null : r4(ratio) }, table };
  if (!(total > 0)) return graph({ ...base, state: 'empty', headline: 'Nothing recorded for your jobs in the last 30 days.', todo: 'Nothing to do yet.' });
  const t0 = tickets[0];
  const s0 = stages[0];
  const headline = `${t0.label} cost the most in 30 days: ${of(t0)}; ${s0.label} took ${pct(s0.share * 100)} of your spend.`;
  const todo = s0.stage === 'review' && s0.share >= 0.4 ? 'Review takes the most: fewer review lenses on small jobs would save the most.' : 'Nothing to change.';
  return graph({ ...base, state: 'ok', headline, todo });
}

/**
 * A person's own two graphs: { graphs: [by-day, ticket-stage] }. rows: that person's usage_lines
 * (app only are used); jobs: [{ slug, title, ticket_key }] from their mirrored jobs; ratio: the
 * account's percent per dollar (teamTelemetry's), or null.
 */
export function privateTelemetry({ rows, jobs = [], now = Date.now(), timeZone = TEAM_TIME_ZONE, ratio = null }) {
  const end = toMs(now);
  const { lines } = linesOf(rows);
  const mine = lines.filter((l) => l.kind === 'app' && l.ms <= end);
  const titles = new Map(jobs.map((j) => [j.slug, j.title || j.slug]));
  const tickets = new Map(jobs.filter((j) => j.ticket_key).map((j) => [j.slug, j.ticket_key]));
  const title = (slug) => titles.get(slug) ?? slug ?? 'No job';
  const ticketOf = (slug) => tickets.get(slug) ?? slugTicketKey(slug);
  return {
    graphs: [byDayGraph({ rows: mine, now: end, timeZone, title, ratio }), ticketStageGraph({ rows: mine, now: end, title, ticketOf, ratio })],
    lines: mine.filter((l) => l.ms >= end - 30 * DAY).length,
  };
}
