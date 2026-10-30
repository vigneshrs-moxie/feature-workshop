// Telemetry's sums and forecast (lib/telemetry.js) against a 30-day fixture, with every expected
// number worked out by hand from the fixture's rules below (not by running the code).
//
// fixtures/telemetry/usage.jsonl: one line at 01:00, 07:00, 13:00 and 19:00 UTC every day from
// 2026-09-28 01:00 to 2026-10-28 07:00 (122 lines; "now" is 2026-10-28 12:00 UTC, so the first two
// are older than 30 days).
//   01:00  sohum    tidy-logs (no ticket)  implement  Sonnet  $1
//   07:00  vignesh  ORBIT-479 feedback-api plan       Opus    $2
//   13:00  vignesh  ORBIT-479 feedback-api review     Sonnet  $1
//   19:00  vignesh  ORBIT-512 export       implement  Opus    $1
// From 2026-10-22 14:00 (the current plan week) every cost is 1.5 times that: a busy week.
// The week resets on Thursdays at 14:00 (1, 8, 15, 22 and 29 October). Each line's weekly meter is
// 2 % per dollar recorded so far in its week (so percent per dollar is exactly 2); its 5-hour meter
// is 10 % per dollar of its own cost, resetting 4 hours after it.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dayKey, forecast, limitSplit, percentPerDollar, percentPerDollarInfo, planWeeks, planWeekStart, telemetry, weekLabel, weekOf, whenWords, windowRange } from '../lib/telemetry.js';
import { GRAPH_IDS } from '../lib/insights.js';
import { startDashboard as launchDashboard } from './helpers/dashboard.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'telemetry', 'usage.jsonl');
const lines = (await fs.readFile(FIXTURE, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
const NOW = '2026-10-28T12:00:00.000Z';
const TITLES = { 'orbit-479-feedback-api': 'Feedback API', 'orbit-512-export': 'Export', 'tidy-logs': 'Tidy logs' };
// The fixture's lines are six hours apart: far longer than the short stretches percent per dollar
// is taken from in real use (SHORT_STRETCH), so its sums here allow stretches of seven hours.
const STRETCH = 7 * 3600e3;
const OPTS = { now: NOW, me: 'vignesh', titles: TITLES, timeZone: 'UTC', shortStretch: STRETCH };
const data = (window) => Object.fromEntries(telemetry(lines, { ...OPTS, window }).graphs.map((d) => [d.id, d]));

test('the fixture is what its rules say', () => {
  assert.equal(lines.length, 122);
  assert.equal(lines.at(-1).t, '2026-10-28T07:00:00.000Z');
  assert.equal(lines.at(-1).meters.week.percent, 87);
});

test('windows: this five hours from the 5-hour reset, this week from the weekly reset, 30 days', () => {
  const meters = lines.at(-1).meters;
  // The newest 5-hour window ended at 11:00, before now: the last five hours.
  assert.deepEqual(windowRange('5h', { now: NOW, meters }), { from: Date.parse('2026-10-28T07:00:00Z'), to: Date.parse(NOW) });
  assert.deepEqual(windowRange('5h', { now: NOW, meters: { fiveHour: { percent: 3, resetsAt: '2026-10-28T14:00:00Z' } } }).from, Date.parse('2026-10-28T09:00:00Z'));
  assert.equal(windowRange('week', { now: NOW, meters }).from, Date.parse('2026-10-22T14:00:00Z'));
  // No reading: the last Wednesday 16:00 on the clock (now is Wednesday 12:00 UTC, before 16:00).
  assert.equal(windowRange('week', { now: NOW, meters: null, timeZone: 'UTC' }).from, Date.parse('2026-10-21T16:00:00Z'));
  assert.equal(windowRange('week', { now: NOW, meters: null, timeZone: 'America/Phoenix' }).from, Date.parse('2026-10-28T23:00:00Z') - 7 * 864e5);
  assert.equal(windowRange('30d', { now: NOW }).from, Date.parse('2026-09-28T12:00:00Z'));
});

// ---------- The plan week: Wednesday 16:00, local time (step 0) ----------

test('the plan week: the weekly meter’s reset when there is a reading', () => {
  const meters = { week: { percent: 40, resetsAt: '2026-11-04T23:00:00Z' } };
  const now = '2026-10-30T12:00:00Z';
  assert.equal(windowRange('week', { now, meters, timeZone: 'America/Phoenix' }).from, Date.parse('2026-10-28T23:00:00Z'));
  // A reset that doesn't hold now (an old reading) is no help: Wednesday 16:00 local instead.
  const stale = { week: { percent: 40, resetsAt: '2026-10-21T23:00:00Z' } };
  assert.equal(windowRange('week', { now, meters: stale, timeZone: 'America/Phoenix' }).from, Date.parse('2026-10-28T23:00:00Z'));
  const weeks = planWeeks({ now, meters: { week: { percent: 3, resetsAt: '2026-11-05T14:00:00Z' } }, timeZone: 'UTC', count: 2 });
  assert.deepEqual(weeks.map((w) => [new Date(w.from).toISOString(), new Date(w.to).toISOString(), w.current]), [
    ['2026-10-29T14:00:00.000Z', '2026-11-05T14:00:00.000Z', true],
    ['2026-10-22T14:00:00.000Z', '2026-10-29T14:00:00.000Z', false],
  ]);
});

test('the plan week: no reading, the last Wednesday 16:00 local (America/Phoenix), never Monday or seven days back', () => {
  const tz = 'America/Phoenix'; // UTC−7 all year: 16:00 there is 23:00 UTC
  assert.equal(planWeekStart('2026-10-28T22:59:00Z', { timeZone: tz }), Date.parse('2026-10-21T23:00:00Z'), 'a minute before 16:00 on a Wednesday: still last week');
  assert.equal(planWeekStart('2026-10-28T23:00:00Z', { timeZone: tz }), Date.parse('2026-10-28T23:00:00Z'), '16:00 on the dot: the new week');
  assert.equal(planWeekStart('2026-10-28T23:01:00Z', { timeZone: tz }), Date.parse('2026-10-28T23:00:00Z'));
  assert.equal(planWeekStart('2026-11-02T08:00:00Z', { timeZone: tz }), Date.parse('2026-10-28T23:00:00Z'), 'a Monday is not a week start');
  const weeks = planWeeks({ now: '2026-10-29T03:00:00Z', timeZone: tz, count: 3 });
  assert.deepEqual(weeks.map((w) => w.label), ['Week from Wed 28 Oct, 4 pm', 'Week from Wed 21 Oct, 4 pm', 'Week from Wed 14 Oct, 4 pm']);
  // A line a minute either side of the boundary lands in the week it belongs to.
  assert.equal(weekOf('2026-10-28T22:59:00Z', weeks).label, 'Week from Wed 21 Oct, 4 pm');
  assert.equal(weekOf('2026-10-28T23:00:00Z', weeks).label, 'Week from Wed 28 Oct, 4 pm');
  assert.equal(weekOf('2026-10-01T00:00:00Z', weeks), null, 'before the weeks asked for');
});

test('the plan week: a time zone with daylight time keeps 16:00 on the clock', () => {
  const tz = 'America/New_York'; // daylight time ends Sunday 1 November 2026
  const weeks = planWeeks({ now: '2026-11-05T12:00:00Z', timeZone: tz, count: 2 });
  assert.deepEqual(weeks.map((w) => [new Date(w.from).toISOString(), new Date(w.to).toISOString()]), [
    ['2026-11-04T21:00:00.000Z', '2026-11-11T21:00:00.000Z'], // 16:00 EST
    ['2026-10-28T20:00:00.000Z', '2026-11-04T21:00:00.000Z'], // 16:00 EDT: that week is 169 hours long
  ]);
  assert.equal(weekLabel(weeks[1].from, tz), 'Week from Wed 28 Oct, 4 pm');
  assert.equal(planWeekStart('2026-11-04T20:59:00Z', { timeZone: tz }), Date.parse('2026-10-28T20:00:00Z'), '15:59 EST: still the week before');
});

test('percent per dollar: the weekly meter’s rise over the cost recorded, per plan week', () => {
  assert.equal(percentPerDollar(lines.filter((l) => Date.parse(l.t) >= Date.parse('2026-09-28T12:00:00Z')), { shortStretch: STRETCH }), 2);
  // Each fixture line starts its own 5-hour window: no two readings share one, so nothing to go by.
  assert.equal(percentPerDollar(lines, { shortStretch: STRETCH, meter: 'fiveHour' }), null);
  assert.equal(percentPerDollar(lines.map((l) => ({ ...l, meters: { fiveHour: null, week: null } }))), null);
  // Six hours between readings is no short stretch: too far apart to say.
  assert.equal(percentPerDollar(lines), null);
});

// ---------- Other use: the meters' rise this app's lines don't explain (step 0b) ----------
//
// A made-up week on America/Phoenix time: it reset Wednesday 28 October 16:00 (23:00 UTC) and resets
// again Wednesday 4 November. The account's true rate is 2 % of the week per dollar. The app works in
// bursts, a line every five minutes at $0.40 (0.8 % of the week each), vignesh and sohum taking turns
// 2 to 1; outside the app, other use adds whole points in quiet hours. The meter reads whole percents.
const WEEK_RESET = '2026-11-04T23:00:00.000Z';
const RATE = 2;
/** Lines for bursts of work, with each line's meter rounded from the true total (app spend and other use so far). */
function weekLines({ bursts, outside = [], reset = WEEK_RESET, start = 0, meterless = () => false }) {
  const out = [];
  let truth = start;
  const events = [
    ...bursts.flatMap((b) => Array.from({ length: b.n }, (_, i) => ({ t: Date.parse(b.at) + i * 5 * 60e3, usd: 0.4, user: (out.length + i) % 3 === 2 ? 'sohum' : 'vignesh', reset: b.reset ?? reset }))),
    ...outside.map((o) => ({ t: Date.parse(o.at), points: o.points })),
  ].sort((a, b) => a.t - b.t);
  let n = 0;
  for (const e of events) {
    if (e.points) { truth += e.points; continue; }
    truth += e.usd * RATE;
    const t = new Date(e.t).toISOString();
    const week = meterless(n, t) ? null : { percent: Math.round(truth), resetsAt: e.reset };
    out.push({ t, user: e.user, job: 'orbit-1-job', ticket: 'ORBIT-1', stage: 'implement', worker: 'foreman', model: 'claude-opus-5-5', costUsd: e.usd, costSource: 'cli', turn: `turn-${n}`, meters: { fiveHour: null, week } });
    n++;
  }
  return out;
}
const near = (actual, want, within, what) => assert.ok(Math.abs(actual - want) <= within, `${what}: ${actual}, want ${want} ± ${within}`);

test('other use: a week with only this app’s use, Others about 0', () => {
  const l = weekLines({ bursts: [{ at: '2026-10-29T15:00:00Z', n: 30 }] });
  near(percentPerDollar(l), RATE, 0.15, 'percent per dollar');
  const split = limitSplit(l, { now: '2026-10-30T12:00:00Z' });
  assert.equal(split.state, 'split');
  assert.equal(split.total, 24);
  assert.equal(split.from, '2026-10-28T23:00:00.000Z');
  near(split.app, 24, 1, 'this app');
  near(split.other, 0, 1, 'other use');
  assert.deepEqual(split.people.map((p) => p.user), ['vignesh', 'sohum']);
  near(split.people[0].percent, 16, 1, 'vignesh');
  near(split.people[1].percent, 8, 1, 'sohum');
  assert.equal(split.app + split.other + split.unknown, 24, 'the parts add up to the meter');
});

test('other use: an outside rise between two quiet readings is Other use, and doesn’t inflate percent per dollar', () => {
  // 30 lines (24 %), a quiet evening with 40 points of use outside the app, then 15 lines (12 %): 76 %.
  const l = weekLines({ bursts: [{ at: '2026-10-29T15:00:00Z', n: 30 }, { at: '2026-10-30T01:00:00Z', n: 15 }], outside: [{ at: '2026-10-29T19:00:00Z', points: 25 }, { at: '2026-10-29T22:00:00Z', points: 15 }] });
  const info = percentPerDollarInfo(l);
  near(info.ratio, RATE, 0.15, 'percent per dollar from short stretches');
  assert.equal(info.stretches, 43, 'the quiet evening (seven and a half hours) is not a short stretch');
  // The old way, the whole rise over the whole spend, counts the outside use as this app's: 76 / $18 = 4.2.
  near(76 / 18, 4.2, 0.03, 'the old way');
  const now = '2026-10-30T03:00:00Z';
  const split = limitSplit(l, { now });
  assert.equal(split.total, 76);
  near(split.app, 36, 1.5, 'this app');
  near(split.other, 40, 1.5, 'other use');
  const evening = split.stretches.find((x) => x.from === '2026-10-29T17:25:00.000Z');
  assert.equal(evening.to, '2026-10-30T01:00:00.000Z');
  near(evening.other, 40, 1, 'the evening’s rise is other use');
  // The forecast's pace is the whole meter's, and its driver says who is pushing it.
  const t = telemetry(l, { now, window: 'week', timeZone: 'America/Phoenix' });
  const g = Object.fromEntries(t.graphs.map((x) => [x.id, x]));
  assert.equal(g.limit.data.forecast.driver.words, 'mostly from use outside this app');
  assert.match(t.limits.week.sentence, /^This week: 76% used\. In this app 3[56]% \(vignesh 2[34]%, sohum 1[12]%\), other use (39|40|41)% \(estimated\)\.$/);
  assert.equal(g.people.data.others.estimated, true);
  near(g.people.data.others.percent, 40, 1.5, 'the Others row');
  assert.match(g.people.headline, /; other use (39|40|41)% \(estimated\); 2[45]% is still free\.$/);
  assert.match(t.limits.note, /claude\.ai, the Claude app, or someone’s own Claude Code/);
  assert.match(t.limits.note, /another computer/);
});

test('other use: a reading gap is one stretch with readings at both ends; a meter that went down is unknown', () => {
  // The meters weren't read for the second burst's first ten lines (plan usage off): one long stretch.
  const l = weekLines({
    bursts: [{ at: '2026-10-29T15:00:00Z', n: 30 }, { at: '2026-10-30T01:00:00Z', n: 15 }], outside: [{ at: '2026-10-29T20:00:00Z', points: 40 }],
    meterless: (n) => n >= 30 && n < 40,
  });
  const split = limitSplit(l, { now: '2026-10-30T03:00:00Z' });
  assert.equal(split.total, 76);
  near(split.app, 36, 1.5, 'this app, the gap’s lines included');
  near(split.other, 40, 1.5, 'other use');
  assert.ok(split.stretches.every((x) => x.known));
  // A reading lower than the one before, with no reset between: that stretch is unknown, not guessed.
  const down = [...l, { ...l.at(-1), t: '2026-10-30T02:30:00.000Z', turn: 'late', costUsd: 0.4, meters: { fiveHour: null, week: { percent: 70, resetsAt: WEEK_RESET } } }];
  const s2 = limitSplit(down, { now: '2026-10-30T03:00:00Z' });
  assert.equal(s2.stretches.at(-1).known, false);
  assert.equal(s2.total, 70);
  assert.ok(s2.app + s2.other + s2.unknown <= 70.01);
  // No reading this week at all: it says so, and guesses nothing.
  const none = limitSplit(l.map((x) => ({ ...x, meters: { fiveHour: null, week: null } })), { now: '2026-10-30T03:00:00Z' });
  assert.equal(none.state, 'no-readings');
  assert.equal(none.other, null);
  const t = telemetry(l.map((x) => ({ ...x, meters: { fiveHour: null, week: null } })), { now: '2026-10-30T03:00:00Z', window: 'week', timeZone: 'America/Phoenix' });
  assert.equal(t.limits.week.sentence, 'Can’t see use outside this app yet: no limit readings this week.');
  assert.equal(t.graphs.find((d) => d.id === 'people').data.others, null);
});

test('other use: a meter reset in the middle starts the week again from 0', () => {
  // Last week ran to 60 %; the meter reset at 16:00 on Wednesday 28 October; this week the app used 12 %.
  const before = weekLines({ bursts: [{ at: '2026-10-28T20:00:00Z', n: 15, reset: '2026-10-28T23:00:00.000Z' }], start: 48 });
  const after = weekLines({ bursts: [{ at: '2026-10-29T01:00:00Z', n: 15 }] });
  const l = [...before, ...after.map((x) => ({ ...x, turn: `after-${x.turn}` }))];
  near(percentPerDollar(l), RATE, 0.2, 'percent per dollar, the reset stretch left out');
  const split = limitSplit(l, { now: '2026-10-29T03:00:00Z' });
  assert.equal(split.from, '2026-10-28T23:00:00.000Z');
  assert.equal(split.total, 12);
  near(split.app, 12, 1, 'this week’s app use');
  near(split.other, 0, 1, 'no other use: last week’s 60 % isn’t this week’s');
  // A reading from a window that has since reset says nothing about now.
  assert.equal(limitSplit(before, { now: '2026-10-29T03:00:00Z' }).state, 'stale');
});

// ---------- Your Claude Code use outside this app (packet U) ----------
//
// The same made-up week. Terminal use (Claude Code outside the app, read from its logs) is known
// spend at the same true rate: each terminal reply of $0.40 raises the meter 0.8 points, as an app
// line does. `outside` is what lib/claude-code-usage.js view() hands in: { t, user, usd }.
/** weekLines with terminal replies: their points go on the meter, and the replies come back as `outside`. */
function withTerminal({ bursts, terminal = [], outside = [], ...rest }) {
  const replies = terminal.flatMap((b) => Array.from({ length: b.n }, (_, i) => ({ t: new Date(Date.parse(b.at) + i * (b.every ?? 5 * 60e3)).toISOString(), user: 'vignesh', usd: 0.4 })));
  const l = weekLines({ bursts, outside: [...outside, ...replies.map((r) => ({ at: r.t, points: 0.4 * RATE }))], ...rest });
  return { l, outside: replies };
}

test('Claude Code use: a stretch with only terminal use is now yours by name, not Other use', () => {
  // The quiet evening of the test above, but this time its 40 points are vignesh's terminal use ($20: 50 replies).
  const { l, outside } = withTerminal({ bursts: [{ at: '2026-10-29T15:00:00Z', n: 30 }, { at: '2026-10-30T01:00:00Z', n: 15 }], terminal: [{ at: '2026-10-29T19:00:00Z', n: 50, every: 6 * 60e3 }] });
  const now = '2026-10-30T03:00:00Z';
  const before = limitSplit(l, { now });
  near(before.other, 40, 1.5, 'without the logs, the evening is Other use');
  const split = limitSplit(l, { now, outside });
  assert.equal(split.total, 76);
  near(split.app, 36, 1.5, 'this app, as before');
  near(split.claudeCode, 40, 1.5, 'in Claude Code: the evening');
  near(split.other, 0, 1.5, 'Other use is what’s left: nothing');
  near(split.app + split.claudeCode + split.other + split.unknown, 76, 0.02, 'the parts add up to the meter');
  const vignesh = split.people.find((p) => p.user === 'vignesh');
  near(vignesh.claudeCode, 40, 1.5, 'vignesh’s part in Claude Code');
  assert.equal(vignesh.app, vignesh.percent, 'percent stays the part in this app');
  assert.equal(vignesh.claudeCodeUsd, 20);
  assert.equal(split.people.find((p) => p.user === 'sohum').claudeCode, 0);
  const evening = split.stretches.find((x) => x.from === '2026-10-29T17:25:00.000Z');
  near(evening.claudeCode, 40, 1, 'the evening’s rise is vignesh’s terminal use');
  near(evening.other, 0, 1, 'not Other use');
  // What the page gets: the words, the note and Other use's new name.
  const t = telemetry(l, { now, window: 'week', timeZone: 'America/Phoenix', outside });
  assert.match(t.limits.week.sentence, /^This week: 76% used\. In this app 3[56]% \(vignesh 2[34]%, sohum 1[12]%\), in Claude Code (39|40|41)% \(vignesh\), other use [01]% \(claude\.ai, the Claude app, other people; estimated\)\.$/);
  assert.equal(t.limits.otherLabel, 'Other use (claude.ai, the Claude app, other people)');
  assert.match(t.limits.note, /claude\.ai, the Claude app and other people/);
  assert.match(t.limits.note, /Only this computer’s Claude Code logs are read/);
  assert.deepEqual(t.claudeCode, { usd: 20, replies: 50 });
  const g = Object.fromEntries(t.graphs.map((x) => [x.id, x]));
  // Graph 5: each person in two parts, then Other use under its new name.
  assert.match(g.people.headline, /^vignesh used (6[34]|65)% of the week \(2[34]% in this app, (39|40|41)% in Claude Code\) and sohum 1[12]% \(1[12]% in this app\); other use [01]% \(estimated\); 2[45]% is still free\.$/);
  assert.deepEqual(g.people.table.head, ['Who', 'Share of the week', 'Spend in this app', 'Spend in Claude Code']);
  assert.equal(g.people.table.rows[0][0], 'vignesh');
  assert.match(g.people.table.rows[0][1], /in this app 2[34]%, in Claude Code (39|40|41)%/);
  assert.equal(g.people.table.rows[0][3], '$20.00');
  assert.equal(g.people.data.others.label, 'Other use (claude.ai, the Claude app, other people)');
  // The forecast's driver: the last day's rise is mostly vignesh's terminal use.
  assert.equal(typeof g.limit.data.forecast.driver.claudeCode, 'number');
});

test('Claude Code use: terminal use between two readings no longer inflates percent per dollar', () => {
  // A burst where vignesh also works in a terminal: a reply every five minutes, in between the app's lines.
  const { l, outside } = withTerminal({ bursts: [{ at: '2026-10-29T15:00:00Z', n: 30 }], terminal: [{ at: '2026-10-29T15:02:00Z', n: 20 }] });
  const without = percentPerDollarInfo(l);
  // Counting only the app's spend, the terminal's 16 points look like the app's: 40 points over $12 is about 3.3.
  near(without.ratio, 40 / 12, 0.2, 'without the logs, inflated');
  const info = percentPerDollarInfo(l, { outside });
  near(info.ratio, RATE, 0.1, 'with the terminal spend counted, the true rate');
  assert.equal(info.claudeCodeUsd, 8);
  assert.ok(info.stretches >= without.stretches);
  // And so the split: this app's part is no longer overstated.
  const now = '2026-10-29T18:00:00Z';
  near(limitSplit(l, { now }).app, 40, 1.5, 'without the logs, the app takes it all');
  const split = limitSplit(l, { now, outside });
  near(split.app, 24, 1.5, 'this app');
  near(split.claudeCode, 16, 1.5, 'in Claude Code');
  near(split.other, 0, 1.5, 'nothing left');
});

test('Claude Code use: with the setting off (or not read yet), everything is exactly as without it', () => {
  // outside null is what the runner hands in then.
  for (const window of ['5h', 'week', '30d']) assert.deepEqual(telemetry(lines, { ...OPTS, window, outside: null }), telemetry(lines, { ...OPTS, window }), window);
  const l = weekLines({ bursts: [{ at: '2026-10-29T15:00:00Z', n: 30 }, { at: '2026-10-30T01:00:00Z', n: 15 }], outside: [{ at: '2026-10-29T19:00:00Z', points: 25 }] });
  const opts = { now: '2026-10-30T03:00:00Z', window: 'week', timeZone: 'America/Phoenix' };
  const off = telemetry(l, { ...opts, outside: null });
  assert.deepEqual(off, telemetry(l, opts));
  assert.equal('claudeCode' in off, false);
  assert.equal('otherLabel' in off.limits, false);
  assert.equal('claudeCode' in off.limits.week, false);
  assert.deepEqual(Object.keys(off.limits.week.people[0]).sort(), ['percent', 'usd', 'user']);
  assert.deepEqual(percentPerDollarInfo(l, { outside: null }), percentPerDollarInfo(l));
  assert.deepEqual(limitSplit(l, { now: opts.now, outside: null }), limitSplit(l, { now: opts.now }));
});

test('Claude Code use: the graphs about this app’s own jobs never include it; People and When the limit goes do', () => {
  const { l, outside } = withTerminal({ bursts: [{ at: '2026-10-29T15:00:00Z', n: 30 }], terminal: [{ at: '2026-10-29T19:00:00Z', n: 20 }] });
  const opts = { now: '2026-10-30T03:00:00Z', window: 'week', timeZone: 'America/Phoenix' };
  const off = Object.fromEntries(telemetry(l, opts).graphs.map((g) => [g.id, g]));
  const on = Object.fromEntries(telemetry(l, { ...opts, outside }).graphs.map((g) => [g.id, g]));
  for (const id of ['ticket-cost', 'stages', 'models', 'rework', 'waiting', 'pr1', 'cache']) assert.deepEqual(on[id], off[id], id);
  // When the limit goes: the terminal's 16 points sit in their own part of Thursday's squares.
  const cc = on.when.data.cells.reduce((s, c) => s + c.claudeCode, 0);
  near(cc, 16, 0.5, 'in Claude Code, in all');
  for (const c of on.when.data.cells) near(c.total, c.app + c.claudeCode + c.other, 0.001, 'each square adds up');
  assert.deepEqual(on.when.table.head, ['Day', 'In this app', 'In Claude Code', 'Other use (estimated)', 'Busiest two hours']);
  assert.equal(off.when.data.cells.some((c) => 'claudeCode' in c), false);
  // The last 30 days (no meter): dollars, each part named.
  const month = Object.fromEntries(telemetry(l, { ...opts, window: '30d', outside }).graphs.map((g) => [g.id, g]));
  assert.match(month.people.headline, /^vignesh spent \$\d+\.\d\d in this app and \$8\.00 in Claude Code, sohum \$\d+\.\d\d in this app\.$/);
});

test('forecast: the last 24 hours’ rise, worked out by hand', () => {
  // Newest: 87 % at 28 Oct 07:00. A day before: 27 Oct 07:00, at 2 × (1.5 + 4 × 7.5 + 1.5 + 3) = 72 %.
  // 15 points in 24 hours = 0.625 an hour; 13 to go = 20.8 hours = 20 h 48 min: Thursday 29 Oct 03:48,
  // before the reset at 14:00.
  const f = forecast(lines, { now: NOW, timeZone: 'UTC' });
  assert.equal(f.state, 'fills');
  assert.deepEqual(f.from, { t: '2026-10-27T07:00:00.000Z', percent: 72 });
  assert.deepEqual(f.to, { t: '2026-10-28T07:00:00.000Z', percent: 87 });
  assert.equal(f.perHour, 0.625);
  assert.equal(f.fullAt, '2026-10-29T03:48:00.000Z');
  assert.equal(f.resetsAt, '2026-10-29T14:00:00.000Z');
  assert.equal(f.sentence, 'At this pace, full on Thursday 03:48.');
});

test('forecast: resets first, flat, full, too few readings, nothing recent', () => {
  const at = (t, percent, resetsAt = '2026-10-29T14:00:00Z') => ({ t, meters: { week: { percent, resetsAt } } });
  // 40 → 46 in 24 h: 0.25 an hour; 30 hours to the reset adds 7.5: about 54 % (rounded to 54).
  const slow = forecast([at('2026-10-27T08:00:00Z', 40), at('2026-10-28T08:00:00Z', 46)], { now: NOW, timeZone: 'UTC' });
  assert.equal(slow.state, 'resets-first');
  assert.equal(slow.atReset, 53.5);
  assert.equal(slow.sentence, 'At this pace the week resets on Thursday 14:00 before it fills, at about 54%.');
  assert.equal(forecast([at('2026-10-27T08:00:00Z', 46), at('2026-10-28T08:00:00Z', 46)], { now: NOW }).state, 'flat');
  assert.equal(forecast([at('2026-10-28T08:00:00Z', 100)], { now: NOW, timeZone: 'UTC' }).sentence, 'The weekly limit is used up; it resets on Thursday 14:00.');
  assert.equal(forecast([at('2026-10-28T08:00:00Z', 46)], { now: NOW }).state, 'unknown');
  // Two readings three hours apart (one busy morning): too soon to say.
  const soon = forecast([at('2026-10-28T05:00:00Z', 2), at('2026-10-28T08:00:00Z', 8)], { now: NOW });
  assert.equal(soon.state, 'unknown');
  assert.equal(soon.sentence, 'Less than six hours of readings this week: too soon to say when it fills.');
  assert.equal(forecast([at('2026-10-26T08:00:00Z', 46)], { now: NOW }).state, 'unknown', 'the newest reading is over a day old');
  // A reading before the reset is not part of this week's pace.
  assert.equal(forecast([at('2026-10-27T13:00:00Z', 90, '2026-10-27T14:00:00Z'), at('2026-10-28T08:00:00Z', 10)], { now: NOW }).state, 'unknown');
  // The live reading counts when it is newer than the last line: 46 → 52 at 09:00 the next day.
  const live = forecast([at('2026-10-27T09:00:00Z', 46)], { now: NOW, timeZone: 'UTC', reading: { t: '2026-10-28T09:00:00Z', week: { percent: 52, resetsAt: '2026-10-29T14:00:00Z' } } });
  assert.equal(live.perHour, 0.25);
});

test('graph 1 on the fixture: the window’s readings, the weekly resets in it and the forecast', () => {
  const month = data('30d').limit;
  assert.equal(month.audience, 'common');
  assert.equal(month.data.points.length, 120);
  assert.deepEqual(month.data.resets, ['2026-10-01T14:00:00.000Z', '2026-10-08T14:00:00.000Z', '2026-10-15T14:00:00.000Z', '2026-10-22T14:00:00.000Z']);
  assert.equal(month.data.forecast.fullAt, '2026-10-29T03:48:00.000Z');
  // Every point of the rise is this app's own (2 % a dollar, nothing outside).
  assert.equal(month.headline, 'At this pace the week is full on Thursday 03:48, mostly from this app’s jobs.');
  const week = data('week').limit;
  // 22 Oct 19:00, then 23–27 Oct (4 a day), then 28 Oct 01:00 and 07:00.
  assert.equal(week.data.points.length, 23);
  assert.deepEqual(week.data.points[0], { t: '2026-10-22T19:00:00.000Z', week: 3, fiveHour: 15 });
  assert.deepEqual(week.data.resets, ['2026-10-22T14:00:00.000Z']);
  assert.deepEqual(data('5h').limit.data.points, [{ t: '2026-10-28T07:00:00.000Z', week: 87, fiveHour: 30 }]);
});

test('graph 5 on the fixture: people on the account, names only, adding up to the meter', () => {
  const p = data('week').people;
  assert.equal(p.audience, 'common');
  // vignesh $25.50 + $9 = $34.50 = 69 %; sohum 01:00 × 6 at $1.50 = $9 = 18 %; together 87 %, the meter.
  assert.deepEqual(p.data.people, [{ user: 'vignesh', usd: 34.5, percent: 69 }, { user: 'sohum', usd: 9, percent: 18 }]);
  assert.equal(p.headline, 'vignesh used 69% of the week and sohum 18%; other use 0% (estimated); 13% is still free.');
  assert.equal(data('30d').people.headline, 'vignesh spent $131.50 in this app, sohum $33.00.');
  // The whole-account graphs never name a job.
  for (const id of ['limit', 'models', 'people', 'when']) assert.ok(!JSON.stringify(data('30d')[id]).match(/orbit-|tidy-logs|Feedback API|ORBIT-/), id);
});

test('the ten graphs, in order, each with who sees it, a finding and a What to do line', () => {
  const t = telemetry(lines, { ...OPTS, window: 'week' });
  assert.deepEqual(t.graphs.map((d) => [d.id, d.audience]), GRAPH_IDS.map((id, i) => [id, [0, 3, 4, 8].includes(i) ? 'common' : 'private']));
  for (const d of t.graphs) assert.match(d.headline, /^\S.+\.$/, d.id);
  assert.equal(t.percentPerDollar, 2);
  assert.equal(t.from, '2026-10-22T14:00:00.000Z');
  assert.deepEqual(t.sources, { audit: false, jobs: false });
  assert.throws(() => telemetry(lines, { ...OPTS, window: 'year' }), RangeError);
});

test('no meters and no lines: dollars alone, and headlines that say so', () => {
  const bare = lines.map((l) => ({ ...l, meters: { fiveHour: null, week: null } }));
  const d = Object.fromEntries(telemetry(bare, { ...OPTS, window: 'week' }).graphs.map((x) => [x.id, x]));
  assert.equal(d.people.data.people[0].percent, null);
  // No reading: the week is from Wednesday 21 Oct 16:00 (UTC here), so 21 Oct 19:00 ($1) and 22 Oct
  // 01:00, 07:00 and 13:00 ($1, $2, $1) join the busy week's $34.50 and $9.
  assert.equal(d.people.headline, 'vignesh spent $38.50 in this app, sohum $10.00.');
  assert.equal(d.limit.headline, 'No reading of the weekly limit yet, so no forecast.');
  const empty = Object.fromEntries(telemetry([], { ...OPTS, window: 'week' }).graphs.map((x) => [x.id, x]));
  assert.equal(empty.people.headline, 'Nobody used the account this week, as far as this computer knows.');
  assert.equal(empty.stages.headline, 'Nothing recorded for your jobs in October yet.');
  assert.equal(empty.models.headline, 'Nothing recorded yet.');
});

test('words for times and days', () => {
  assert.equal(whenWords('2026-10-29T14:00:00Z', { now: NOW, timeZone: 'UTC' }), 'Thursday 14:00');
  assert.equal(whenWords('2026-11-05T14:00:00Z', { now: NOW, timeZone: 'UTC' }), 'Thursday 5 November 14:00');
  assert.equal(dayKey('2026-10-28T23:30:00Z', 'UTC'), '2026-10-28');
  assert.equal(dayKey('2026-10-28T23:30:00Z', 'Asia/Kolkata'), '2026-10-29');
});

// ---------- Through the dashboard (demo mode, temp folders, no Claude) ----------

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');

/** A demo dashboard on temp folders; `prepare(dirs)` runs before it starts. Returns { base, dirs, write, stop, output }. */
async function startDashboard(prepare = async () => {}) {
  const { spawn } = await import('node:child_process');
  const net = await import('node:net');
  const os = await import('node:os');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-telemetry-')));
  const dirs = Object.fromEntries(['feature-work', 'state', 'repo', 'projects', 'agents', 'skills', 'home'].map((d) => [d, path.join(root, d)]));
  for (const d of Object.values(dirs)) await fs.mkdir(d, { recursive: true });
  await prepare(dirs);
  // Its own ports for the dashboard and the screens server (helpers/dashboard.js).
  const output = [];
  const dashboard = await launchDashboard({ env: { HOME: dirs.home, WORKSHOP_DEMO: '1', WORKSHOP_FEATURES_DIR: dirs['feature-work'], WORKSHOP_PROJECTS_DIR: dirs.projects, WORKSHOP_AGENTS_DIR: dirs.agents, WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: dirs.state, GROUND_CONTROL_USER: 'vignesh', GROUND_CONTROL_DIR: '' }, output }).catch(async (err) => { await fs.rm(root, { recursive: true, force: true }); throw err; });
  const { base } = dashboard;
  const token = (await (await fetch(`${base}/api/meta`)).json()).token;
  const write = async (method, p, body = {}) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Workshop-Token': token }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const stop = async () => {
    await dashboard.stop(); // exactly the dashboard this test started, and what it started
    await fs.rm(root, { recursive: true, force: true });
  };
  return { base, dirs, write, stop, output };
}

test('GET /api/telemetry: the ten graphs for the window, from usage.jsonl in the state folder', { timeout: 60_000 }, async () => {
  // The fixture moved so that its "now" is this moment.
  const shift = Date.now() - Date.parse(NOW);
  const move = (t) => (t ? new Date(Date.parse(t) + shift).toISOString() : t);
  const moved = lines.map((l) => ({ ...l, t: move(l.t), meters: { fiveHour: { ...l.meters.fiveHour, resetsAt: move(l.meters.fiveHour.resetsAt) }, week: { ...l.meters.week, resetsAt: move(l.meters.week.resetsAt) } } }));
  const d = await startDashboard(async (dirs) => {
    await fs.writeFile(path.join(dirs.state, 'usage.jsonl'), moved.map((l) => JSON.stringify(l)).join('\n') + '\n');
  });
  try {
    const res = await fetch(`${d.base}/api/telemetry?window=week`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.window, 'week');
    assert.equal(body.me, 'vignesh');
    assert.equal(body.file, path.join(d.dirs.state, 'usage.jsonl'));
    assert.equal(body.meters.enabled, false, 'demo mode reads no plan usage');
    const people = body.graphs.find((x) => x.id === 'people');
    // The fixture's readings are six hours apart: no short stretch, so no percent per dollar, dollars alone.
    assert.deepEqual(people.data.people, [{ user: 'vignesh', usd: 34.5, percent: null }, { user: 'sohum', usd: 9, percent: null }]);
    assert.equal(body.limits.week.state, 'no-ratio');
    // The ten insight graphs, each with its id, in order, each with a finding and a What to do line.
    assert.deepEqual(body.graphs.map((g) => [g.n, g.id]), GRAPH_IDS.map((id, i) => [i + 1, id]));
    for (const g of body.graphs) assert.ok(g.headline.length > 10 && g.todo.length > 5 && Array.isArray(g.table.rows), g.id);
    assert.equal(typeof body.sources.audit, 'boolean');
    assert.equal(typeof body.sources.jobs, 'boolean');
    assert.match(body.limits.note, /outside this app/);
    const limit = body.graphs.find((x) => x.id === 'limit');
    assert.equal(limit.data.forecast.fullAt, move('2026-10-29T03:48:00.000Z'));
    assert.match(limit.headline, /^At this pace the week is full on \w+day \d\d:\d\d\.$/);
    assert.equal((await (await fetch(`${d.base}/api/telemetry`)).json()).window, 'week', 'this week unless asked');
    assert.equal((await (await fetch(`${d.base}/api/telemetry?window=30d`)).json()).graphs.find((x) => x.id === 'people').data.people[0].usd, 131.5);
    const bad = await fetch(`${d.base}/api/telemetry?window=year`);
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'The window is one of 5h, week or 30d.');
    assert.equal((await fetch(`${d.base}/api/telemetry/other`)).status, 404);
    assert.equal((await d.write('POST', '/api/telemetry', {})).status, 405);
    // The demo never reads Claude Code's logs: it says so, and nothing is counted.
    assert.deepEqual(body.claudeCode, { state: 'demo', counted: false, words: 'The demo doesn’t read Claude Code’s logs.', note: body.claudeCode.note, usd: null, replies: null, readAt: null });
    assert.match(body.claudeCode.note, /^Only this computer’s Claude Code logs are read\./);
  } finally {
    await d.stop();
  }
});

test('Settings → Workflow → Count my Claude Code use outside the app: on by default, saved through POST /api/settings { workflow }, kept in the state folder', { timeout: 60_000 }, async () => {
  const d = await startDashboard();
  try {
    const meta = async () => (await (await fetch(`${d.base}/api/meta`)).json()).settings.workflow;
    assert.equal((await meta()).countClaudeCode, true, 'on unless turned off');
    for (const bad of ['no', 0, null]) {
      const r = await d.write('POST', '/api/settings', { workflow: { countClaudeCode: bad } });
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.equal(r.body.error, 'Count my Claude Code use outside the app: on or off.');
    }
    const off = await d.write('POST', '/api/settings', { workflow: { countClaudeCode: false } });
    assert.equal(off.status, 200);
    assert.equal(off.body.workflow.countClaudeCode, false);
    assert.equal(off.body.workflow.finishLine, 'pr1-merged', 'the other workflow settings stay');
    assert.equal((await meta()).countClaudeCode, false);
    assert.equal(JSON.parse(await fs.readFile(path.join(d.dirs.state, 'claude-code-usage.json'), 'utf8')).count, false);
    const settings = JSON.parse(await fs.readFile(path.join(d.dirs.state, 'settings.json'), 'utf8').catch(() => '{}'));
    assert.equal(settings.workflow?.countClaudeCode, undefined, 'not written into settings.json');
    assert.equal((await d.write('POST', '/api/settings', { workflow: { countClaudeCode: true } })).body.workflow.countClaudeCode, true);
    assert.equal((await meta()).countClaudeCode, true);
  } finally {
    await d.stop();
  }
});

test('every turn of a sample job gives one usage line in the state folder (demo dashboard, no model)', { timeout: 60_000 }, async () => {
  const slug = 'orbit-479-sample';
  const d = await startDashboard(async (dirs) => {
    const dir = path.join(dirs['feature-work'], slug);
    await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({
      schema_version: 1, slug, title: 'Sample job', route: 'quick', stage: 'plan', stage_state: 'running', waiting_for: null,
      brief: null, questions: [], repo: { path: dirs.repo }, updated_at: new Date().toISOString(),
    }, null, 2));
    await fs.writeFile(path.join(dir, 'options.json'), JSON.stringify({
      schema_version: 2, level: 1, flow: 'quick', skip: [], provided: {}, reviewers: ['feature-reviewer'], review_rounds: 1, manual_test: false, fable_checks: [],
      models: { foreman: 'claude-opus-5-5', build: 'claude-opus-5-5', checks: 'claude-opus-5-5' }, title: 'Sample job', repo: dirs.repo, kind: 'feature',
    }, null, 2));
  });
  const file = path.join(d.dirs.state, 'usage.jsonl');
  const read = async () => (await fs.readFile(file, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const get = async (p) => (await fetch(d.base + p)).json();
  const waitFor = async (fn, what, ms = 15000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.\n${d.output.join('')}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  // One turn: send, allow whatever the pretend Foreman asks, and wait for the reply to end.
  const turn = async (text) => {
    const sent = await d.write('POST', `/api/job/${slug}/send`, { text, despiteLimit: true });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    await waitFor(async () => {
      const job = await get(`/api/job/${slug}`);
      for (const p of (await get('/api/snapshot')).permissions.filter((x) => x.slug === slug)) await d.write('POST', `/api/permissions/${p.id}`, { decision: 'allow' });
      return job.drive?.mode !== 'running' && job.run && !['starting', 'running', 'waiting_permission'].includes(job.run.status);
    }, 'the reply to end');
  };
  try {
    assert.deepEqual(await read(), [], 'no line before any turn');
    await turn('Carry on.');
    const first = await waitFor(async () => { const l = await read(); return l.length ? l : null; }, 'the first line');
    assert.equal(first.length, 1, 'one line for the turn');
    await turn('One more step.');
    const both = await waitFor(async () => { const l = await read(); return l.length >= 2 ? l : null; }, 'the second line');
    assert.equal(both.length, 2, 'one line per turn');
    for (const l of both) {
      assert.equal(l.user, 'vignesh');
      assert.equal(l.account, null, 'demo mode: no Claude account');
      assert.equal(l.job, slug);
      assert.equal(l.ticket, 'ORBIT-479');
      assert.equal(l.worker, 'foreman');
      assert.equal(typeof l.stage, 'string');
      assert.ok(l.model, 'the Foreman model');
      assert.deepEqual(Object.keys(l.tokens).sort(), ['cacheRead', 'cacheWrite1h', 'cacheWrite5m', 'input', 'output']);
      assert.equal(typeof l.costUsd, 'number');
      assert.ok(['cli', 'estimate'].includes(l.costSource));
      assert.ok('fiveHour' in l.meters && 'week' in l.meters);
      assert.ok(!Number.isNaN(Date.parse(l.t)));
    }
    assert.notEqual(both[0].turn, both[1].turn, 'two turns');
    assert.equal(both[0].costSource, 'cli');
    assert.equal(both[0].costUsd, 0.42, 'the pretend session’s own figure');
    // And the page's route reads them back.
    const people = (await get('/api/telemetry?window=week')).graphs.find((x) => x.id === 'people');
    assert.equal(people.data.people[0].user, 'vignesh');
  } finally {
    await d.stop();
  }
});
