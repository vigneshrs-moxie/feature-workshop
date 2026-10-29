// Telemetry's insight graphs (lib/insights.js): the cleaned record's rules on small fixtures made
// here, each number worked out by hand in the comments. No dashboard, no model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capOutliers, cleanRecord, GRAPH_IDS, insightsFor, isTempPath, median, meteredWeeks, quantile } from '../lib/insights.js';

const ROOTS = ['/tmp', '/private/tmp', '/var/folders/xy/T'];
const NOW = '2026-10-29T12:00:00.000Z';
let n = 0;
/** One usage line, as lib/usage-log.js writes it, with what the test needs changed. */
const line = (over = {}) => ({
  t: '2026-10-29T10:00:00.000Z', user: 'vignesh', account: null, job: 'job-a', ticket: 'ORBIT-1', stage: 'implement', section: null,
  worker: 'foreman', model: 'claude-opus-5-5', tokens: { input: 100, output: 50, cacheRead: 1000, cacheWrite5m: 0, cacheWrite1h: 0 },
  costUsd: 1, costSource: 'estimate', meters: { fiveHour: null, week: null }, turn: `turn-${++n}`, session: 's-1', cliTotalUsd: null, ...over,
});
const clean = (lines, opts = {}) => cleanRecord(lines, { now: NOW, tempRoots: ROOTS, ...opts });

test('the temp-folder rule: under a temp folder, never a folder that only starts with the same letters', () => {
  assert.equal(isTempPath('/tmp/fw-test/job', ROOTS), true);
  assert.equal(isTempPath('/private/tmp', ROOTS), true);
  assert.equal(isTempPath('/var/folders/xy/T/fw-1/feature-work/a', ROOTS), true);
  assert.equal(isTempPath('C:\\Temp\\a', ['C:\\Temp']), true);
  assert.equal(isTempPath('/tmpfiles/a', ROOTS), false);
  assert.equal(isTempPath('/Users/you/feature-work/a', ROOTS), false);
  assert.equal(isTempPath(null, ROOTS), false);
});

test('demo lines and lines from test folders go; the rest stay, oldest first', () => {
  const r = clean([
    line({ t: '2026-10-29T11:00:00.000Z' }),
    line({ demo: true }),
    line({ featureDir: '/tmp/fw-telemetry-1/feature-work/job-a' }),
    line({ cwd: '/private/tmp/x' }),
    line({ job: 'job-in-temp' }),
    line({ t: '2026-10-29T09:00:00.000Z' }),
    line({ t: '2026-10-30T09:00:00.000Z' }), // after now: a clock that ran ahead
    line({ t: 'not a time' }),
  ], { jobs: [{ slug: 'job-in-temp', dir: '/var/folders/xy/T/fw-2/feature-work/job-in-temp' }] });
  assert.deepEqual(r.rows.map((x) => x.t), ['2026-10-29T09:00:00.000Z', '2026-10-29T11:00:00.000Z']);
  assert.deepEqual(r.dropped, { demo: 1, temp: 3, repeated: 0, unreadable: 2 });
});

test('each turn counts once: a line written twice is dropped; a turn’s crew lines all stay', () => {
  const foreman = line({ turn: 'turn-x', worker: 'foreman', costUsd: 2 });
  const builder = line({ turn: 'turn-x', worker: 'implementer', model: 'claude-sonnet-5-5', costUsd: 1 });
  const r = clean([foreman, builder, { ...foreman }, { ...builder }]);
  assert.equal(r.rows.length, 2);
  assert.equal(r.dropped.repeated, 2);
  // $2 + $1, not $6.
  assert.equal(r.rows.reduce((s, x) => s + x.usd, 0), 3);
});

test('model ids fold into families', () => {
  const r = clean([line({ model: 'claude-opus-5-5' }), line({ model: 'claude-sonnet-5-5[1m]' }), line({ model: 'claude-haiku-5-5' }), line({ model: 'claude-fable-5-1' }), line({ model: 'gpt-4' }), line({ model: null })]);
  assert.deepEqual(r.rows.map((x) => x.family), ['opus', 'sonnet', 'haiku', 'fable', 'other', 'unknown']);
});

test('a resumed session’s cost is taken by difference: a running total is never added again', () => {
  // Turn 1 cost $2 (total $2). The session was resumed and an older writer logged turn 2 at the whole
  // running total, $5: its own cost is $5 − $2 = $3, shared between its two lines by their costs (4:1).
  const r = clean([
    line({ t: '2026-10-29T08:00:00.000Z', session: 's-r', turn: 't1', costSource: 'cli', costUsd: 2, cliTotalUsd: 2 }),
    line({ t: '2026-10-29T09:00:00.000Z', session: 's-r', turn: 't2', worker: 'foreman', costSource: 'cli', costUsd: 4, cliTotalUsd: 5 }),
    line({ t: '2026-10-29T09:00:00.000Z', session: 's-r', turn: 't2', worker: 'implementer', costSource: 'cli', costUsd: 1, cliTotalUsd: 5 }),
    // Turn 3, already by difference ($1 of a $6 total): left alone.
    line({ t: '2026-10-29T10:00:00.000Z', session: 's-r', turn: 't3', costSource: 'cli', costUsd: 1, cliTotalUsd: 6 }),
  ]);
  assert.deepEqual(r.rows.map((x) => x.usd), [2, 2.4, 0.6, 1]);
  assert.equal(r.fixed, 1);
  assert.equal(r.rows.reduce((s, x) => s + x.usd, 0), 6, 'the session’s own total');
});

test('a week with no meter reading is marked, never guessed', () => {
  const weeks = [{ from: Date.parse('2026-10-28T23:00:00Z'), to: Date.parse('2026-11-04T23:00:00Z') }, { from: Date.parse('2026-10-21T23:00:00Z'), to: Date.parse('2026-10-28T23:00:00Z') }];
  const r = clean([
    line({ t: '2026-10-29T01:00:00.000Z', meters: { fiveHour: null, week: { percent: 4, resetsAt: '2026-11-04T23:00:00.000Z' } } }),
    line({ t: '2026-10-25T01:00:00.000Z' }),
  ]);
  assert.deepEqual(meteredWeeks(r.rows, weeks).map((w) => w.metered), [true, false]);
  assert.deepEqual(r.rows.map((x) => x.week?.percent ?? null), [null, 4], 'the 25 October line carries no reading');
});

test('outliers: capped on the graph above the fence, kept in the data', () => {
  // 10, 11, 12, 13, 14, 140: quartiles 11.25 and 13.75, spread 2.5, fence 13.75 + 7.5 = 21.25.
  const values = [10, 11, 12, 140, 13, 14];
  assert.deepEqual(capOutliers(values), { cap: 21.25, capped: [3] });
  assert.deepEqual(capOutliers([1, 2, 3, 4]), { cap: null, capped: [] }, 'too few to say');
  assert.deepEqual(capOutliers([5, 5, 5, 5, 5]), { cap: null, capped: [] });
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([]), null);
});

test('joins: send-backs and answers from the audit, route size and the finish line from the job list, PR #1 from the stages', () => {
  const lines = [
    line({ t: '2026-10-27T10:00:00.000Z', job: 'job-a', stage: 'plan', costUsd: 1 }),
    line({ t: '2026-10-27T12:00:00.000Z', job: 'job-a', stage: 'implement', costUsd: 3 }),
    line({ t: '2026-10-28T12:00:00.000Z', job: 'job-a', stage: 'pr1', costUsd: 1 }),
    line({ t: '2026-10-28T13:00:00.000Z', job: 'job-a', stage: 'pr2', costUsd: 1 }),
    line({ t: '2026-10-27T11:00:00.000Z', job: 'job-b', stage: 'spec', costUsd: 2 }),
  ];
  const audit = [
    { at: '2026-10-27T13:00:00.000Z', action: 'send', kind: 'changes', featureDir: '/Users/you/feature-work/job-a', slug: 'job-a' },
    { at: '2026-10-27T09:00:00.000Z', action: 'send', kind: 'approve', featureDir: '/Users/you/feature-work/job-b' },
    { at: '2026-10-27T09:30:00.000Z', action: 'send', kind: 'message', slug: 'job-b' },
    { at: '2026-10-27T09:40:00.000Z', action: 'send', kind: 'changes', slug: 'job-gone' },
    { at: '2026-10-27T09:50:00.000Z', action: 'send', kind: 'changes', slug: 'job-a', featureDir: '/tmp/fw/job-a' },
    { at: '2026-10-27T09:55:00.000Z', action: 'new-job', slug: 'job-a' },
  ];
  const jobs = [{ slug: 'job-a', title: 'Job A', route: 'small', finished: true, finishedAt: '2026-10-28T14:00:00.000Z', dir: '/Users/you/feature-work/job-a' }, { slug: 'job-c', title: 'No lines' }];
  const r = clean(lines, { audit, jobs });
  assert.equal(r.hasAudit, true);
  assert.equal(r.hasJobs, true);
  // The send-back at 13:00 came while job A was at Build (its last line before, 12:00).
  assert.deepEqual(r.sendBacks, [{ t: '2026-10-27T13:00:00.000Z', ms: Date.parse('2026-10-27T13:00:00Z'), slug: 'job-a', stage: 'implement' }]);
  // Answers: the approve (job B, named by its folder); a message decides nothing; a job with no lines is left out.
  assert.deepEqual(r.answers.map((a) => [a.slug, a.kind]), [['job-b', 'approve'], ['job-a', 'changes']]);
  const a = r.jobs.get('job-a');
  assert.deepEqual([a.title, a.route, a.finished, a.firstAt, a.pr1At, a.usd], ['Job A', 'small', true, '2026-10-27T10:00:00.000Z', '2026-10-28T12:00:00.000Z', 6]);
  assert.deepEqual([r.jobs.get('job-b').route, r.jobs.get('job-b').finished], [null, null], 'not on the job list: not known');
  assert.equal(r.jobs.has('job-c'), false);
  // Without the audit or the job list: the graphs that need them say so (hasAudit, hasJobs false).
  const bare = clean(lines);
  assert.deepEqual([bare.hasAudit, bare.hasJobs, bare.sendBacks.length], [false, false, 0]);
});

// ---------- The ten graphs (step 2) ----------
//
// A month of made-up work, on UTC clocks. "Now" is Thursday 29 October 12:00; the plan week runs
// from Wednesday 28 October 16:00 to Wednesday 4 November 16:00 (the meter's reset).
// Each job of vignesh's goes Spec (Opus), Plan (Opus), Build (Sonnet), Review (Opus), PR #1 (Sonnet),
// at $4, $6, $10, $8 and $2 times its scale, at 0, 2, 4 and 6 hours from its start, PR #1 at `pr1` hours:
//   job-1 ORBIT-1 small  Wed  7 Oct 10:00  scale 1    PR #1 after 24 h  finished  8 Oct 12:00   $30
//   job-2 ORBIT-2 small  Wed 14 Oct 18:00  scale 0.8  PR #1 after 24 h  finished 15 Oct 20:00   $24
//   job-3 ORBIT-3 large  Wed 21 Oct 17:00  scale 1.5  PR #1 after 72 h  finished 24 Oct 18:00   $45 + $8 rework = $53
//   job-4 ORBIT-4 small  Wed 28 Oct 17:00  scale 0.6  Plan at +2:05, Build next day 08:00, Review 10:00, PR #1 11:00 (18 h)  $18
//   job-0 (no ticket), 15 September: Build $10 (Sonnet), Review $30 (Opus): last month, not finished.
// job-3 was sent back at Build on 21 Oct 21:30; Build then spent $5 and $3 more before Review.
// This week's meter (1 % per dollar; sohum's four Plan lines ten minutes apart give the short
// stretches) also rose 30 points overnight outside the app: 56 % by 11:00, this app 26 %.
const G_NOW = '2026-10-29T12:00:00.000Z';
const RESET = '2026-11-04T16:00:00.000Z';
const at = (base, hours) => new Date(Date.parse(base) + hours * 3600e3).toISOString();
let seq = 0;
const work = (slug, ticket, t, stage, usdAmount, model, over = {}) => line({ t, job: slug, ticket, stage, costUsd: usdAmount, model, turn: `g-${++seq}`, session: `s-${slug}`, tokens: { input: 1000, output: 500, cacheRead: 3000, cacheWrite5m: 0, cacheWrite1h: 0 }, ...over });
function jobLines(slug, ticket, start, scale, pr1Hours) {
  return [
    work(slug, ticket, at(start, 0), 'spec', 4 * scale, 'claude-opus-5-5'),
    work(slug, ticket, at(start, 2), 'plan', 6 * scale, 'claude-opus-5-5'),
    work(slug, ticket, at(start, 4), 'implement', 10 * scale, 'claude-sonnet-5-5'),
    work(slug, ticket, at(start, 6), 'review', 8 * scale, 'claude-opus-5-5'),
    work(slug, ticket, at(start, pr1Hours), 'pr1', 2 * scale, 'claude-sonnet-5-5'),
  ];
}
// This week's lines, each with the meter as it read then (rounded from the true total).
const meter = (percent) => ({ fiveHour: null, week: { percent, resetsAt: RESET } });
const thisWeek = [
  work('job-4', 'ORBIT-4', '2026-10-28T17:00:00.000Z', 'spec', 2.4, 'claude-opus-5-5', { meters: meter(2), session: 'w-1', tokens: { input: 1000, output: 500, cacheRead: 600, cacheWrite5m: 0, cacheWrite1h: 0 } }),
  work('job-4', 'ORBIT-4', '2026-10-28T19:05:00.000Z', 'plan', 3.6, 'claude-opus-5-5', { meters: meter(6), session: 'w-2', tokens: { input: 1000, output: 500, cacheRead: 600, cacheWrite5m: 0, cacheWrite1h: 0 } }),
  ...[0, 10, 20, 30].map((m, i) => work('job-s', null, at('2026-10-28T20:00:00.000Z', m / 60), 'plan', 2, 'claude-opus-5-5', { user: 'sohum', meters: meter(8 + 2 * i), session: 's-sohum' })),
  work('job-4', 'ORBIT-4', '2026-10-29T08:00:00.000Z', 'implement', 6, 'claude-sonnet-5-5', { meters: meter(50), session: 'w-3', tokens: { input: 1000, output: 500, cacheRead: 600, cacheWrite5m: 0, cacheWrite1h: 0 } }),
  work('job-4', 'ORBIT-4', '2026-10-29T10:00:00.000Z', 'review', 4.8, 'claude-opus-5-5', { meters: meter(55), session: 'w-4', tokens: { input: 1000, output: 500, cacheRead: 600, cacheWrite5m: 0, cacheWrite1h: 0 } }),
  work('job-4', 'ORBIT-4', '2026-10-29T11:00:00.000Z', 'pr1', 1.2, 'claude-sonnet-5-5', { meters: meter(56), session: 'w-5', tokens: { input: 1000, output: 500, cacheRead: 600, cacheWrite5m: 0, cacheWrite1h: 0 } }),
];
const MONTH = [
  work('job-0', null, '2026-09-15T10:00:00.000Z', 'implement', 10, 'claude-sonnet-5-5'),
  work('job-0', null, '2026-09-15T12:00:00.000Z', 'review', 30, 'claude-opus-5-5'),
  ...jobLines('job-1', 'ORBIT-1', '2026-10-07T10:00:00.000Z', 1, 24),
  ...jobLines('job-2', 'ORBIT-2', '2026-10-14T18:00:00.000Z', 0.8, 24),
  ...jobLines('job-3', 'ORBIT-3', '2026-10-21T17:00:00.000Z', 1.5, 72),
  work('job-3', 'ORBIT-3', '2026-10-21T22:00:00.000Z', 'implement', 5, 'claude-sonnet-5-5'),
  work('job-3', 'ORBIT-3', '2026-10-21T22:30:00.000Z', 'implement', 3, 'claude-sonnet-5-5'),
  ...thisWeek,
];
const JOBS = [
  { slug: 'job-0', title: 'Job 0', route: 'small', finished: false, dir: '/Users/you/feature-work/job-0' },
  { slug: 'job-1', title: 'Job 1', route: 'small', finished: true, finishedAt: '2026-10-08T12:00:00.000Z' },
  { slug: 'job-2', title: 'Job 2', route: 'small', finished: true, finishedAt: '2026-10-15T20:00:00.000Z' },
  { slug: 'job-3', title: 'Job 3', route: 'large', finished: true, finishedAt: '2026-10-24T18:00:00.000Z' },
  { slug: 'job-4', title: 'Job 4', route: 'small', finished: true, finishedAt: '2026-10-29T11:30:00.000Z' },
  { slug: 'job-s', title: 'Sohum’s job', route: 'small', finished: false },
];
const AUDIT = [
  { at: '2026-10-14T18:20:00.000Z', action: 'send', kind: 'approve', slug: 'job-2' },
  { at: '2026-10-21T17:30:00.000Z', action: 'send', kind: 'approve', slug: 'job-3' },
  { at: '2026-10-21T21:30:00.000Z', action: 'send', kind: 'changes', slug: 'job-3' },
  { at: '2026-10-28T19:00:00.000Z', action: 'send', kind: 'approve', slug: 'job-4' },
  { at: '2026-10-29T07:00:00.000Z', action: 'send', kind: 'approve', slug: 'job-4' },
];
const insights = (lines = MONTH, over = {}) => insightsFor(lines, { now: G_NOW, me: 'vignesh', timeZone: 'UTC', jobs: JOBS, audit: AUDIT, tempRoots: ROOTS, ...over });
const byId = (r) => Object.fromEntries(r.graphs.map((g) => [g.id, g]));

test('the ten graphs, in order, each with a finding, a What to do line, a table and who sees it', () => {
  const r = insights();
  assert.deepEqual(r.graphs.map((g) => [g.n, g.id]), GRAPH_IDS.map((id, i) => [i + 1, id]));
  assert.deepEqual(r.graphs.map((g) => g.audience), ['common', 'private', 'private', 'common', 'common', 'private', 'private', 'private', 'common', 'private']);
  for (const g of r.graphs) {
    assert.match(g.headline, /^\S.+\.$/, g.id);
    assert.match(g.todo, /^[A-Z].+\.$/, g.id);
    assert.ok(g.table.head.length >= 2 && Array.isArray(g.table.rows), g.id);
    assert.ok(!/Ground Control/.test(JSON.stringify(g)), `${g.id} names no product`);
  }
  // The whole-account graphs never name a job or a ticket.
  for (const g of r.graphs.filter((x) => x.audience === 'common')) assert.ok(!/job-\d|Job \d|ORBIT-/.test(JSON.stringify(g)), g.id);
});

test('1. weekly limit and forecast: the whole meter’s pace, and which part drives it', () => {
  const g = byId(insights()).limit;
  // 2 % at 28 Oct 17:00 to 56 % at 29 Oct 11:00: 54 points in 18 hours, 3 an hour; 44 to go is
  // 14 h 40 min: Friday 30 Oct 01:40, five and a half days before the reset. This app spent $23.60
  // in that time (23.6 points), so 30.4 came from outside.
  assert.equal(g.data.forecast.fullAt, '2026-10-30T01:40:00.000Z');
  assert.equal(g.headline, 'At this pace the week is full on Friday 01:40, 6 days before it resets, mostly from use outside this app.');
  assert.deepEqual([g.data.forecast.driver.app, g.data.forecast.driver.other], [23.6, 30.4]);
  assert.equal(g.sub, 'This week: 56% used. In this app 26% (vignesh 18%, sohum 8%), other use 30% (estimated).');
  assert.match(g.todo, /^Most of the pace is use outside this app/);
  assert.equal(g.data.points.length, 9);
});

test('2. cost per finished ticket: the median by plan week, down from the first week', () => {
  const g = byId(insights())['ticket-cost'];
  assert.deepEqual(g.data.weeks.filter((w) => w.median !== null).map((w) => [w.label, w.median]), [
    ['Week from Wed 7 Oct, 4 pm', 30], ['Week from Wed 14 Oct, 4 pm', 24], ['Week from Wed 21 Oct, 4 pm', 53], ['Week from Wed 28 Oct, 4 pm', 18],
  ]);
  assert.equal(g.headline, 'A finished ticket costs $18.00, down from $30.00 3 weeks ago.');
  assert.deepEqual(g.table.rows[0], ['ORBIT-4', 'Week from Wed 28 Oct, 4 pm', '$18.00']);
  // One finished ticket is not enough to say.
  const one = byId(insights(MONTH, { jobs: JOBS.map((j) => (j.slug === 'job-1' ? j : { ...j, finished: false })) }))['ticket-cost'];
  assert.equal(one.headline, 'Not enough finished tickets yet to say (1 of 2 needed).');
  assert.equal(one.state, 'not-enough');
});

test('3. where the spend goes: this month against last, the biggest stage first', () => {
  const g = byId(insights()).stages;
  // October, yours: Spec 15.6, Plan 23.4, Build 39 + 8 rework = 47, Review 31.2, PR #1 7.8: $125.
  // Build 47 / 125 = 38 %; in September Build was 10 of 40 = 25 %.
  assert.equal(g.headline, 'Build costs 38% of your spend, up from 25% last month.');
  assert.match(g.todo, /^Approve plans with small steps/);
  assert.deepEqual(g.table.head, ['Stage', 'October', 'September', 'Change']);
  assert.deepEqual(g.table.rows.find((r) => r[0] === 'Build'), ['Build', '38% · $47.00', '25% · $10.00', '▲ 13 pts']);
  assert.deepEqual(g.table.rows.find((r) => r[0] === 'Spec'), ['Spec', '12% · $15.60', '0% · $0.00', '▲ 12 pts']);
});

test('4. models: the share by family, and what the costliest stage would cost on the next model down', () => {
  const g = byId(insights()).models;
  // October, everyone: Opus = 15.6 + 23.4 + 31.2 + sohum’s 8 = 78.2 of 133: 59 %. The last 30 days'
  // costliest stage is Build ($47, Sonnet); Haiku’s prices are 5 % of Sonnet’s: about $45 less.
  assert.equal(g.headline, 'Opus is 59% of the spend; Build on Haiku would save about $45 a month.');
  assert.equal(g.data.saving.usd, 44.65);
  assert.equal(g.sub, 'About $45 less a month if Build ran on Haiku 5.5 instead of Sonnet 5.5, at the last 30 days’ use.');
  assert.deepEqual(g.data.bars.map((b) => b.label), ['September', 'October']);
});

test('5. people on the account: each person and Other use, adding up to the meter', () => {
  const g = byId(insights()).people;
  assert.equal(g.headline, 'vignesh used 18% of the week and sohum 8%; other use 30% (estimated); 44% is still free.');
  assert.deepEqual(g.table.rows, [
    ['vignesh', '18%', '$18.00'], ['sohum', '8%', '$8.00'], ['Others (outside this app, estimated)', '30%', 'Not known: outside this app'], ['Still free', '44%', '—'],
  ]);
  assert.match(g.todo, /^Most of the limit went outside this app/);
  // No readings: dollars only, and it says the split isn't known.
  const bare = byId(insights(MONTH.map((l) => ({ ...l, meters: { fiveHour: null, week: null } })))).people;
  assert.equal(bare.headline, 'vignesh spent $18.00 in this app, sohum $8.00.');
  assert.equal(bare.data.others, null);
});

test('6. rework: the cost after a send-back, in the stage it was sent back to', () => {
  const g = byId(insights()).rework;
  assert.equal(g.headline, 'Build rework cost $8.00 in the last 30 days, after 1 send-back.');
  assert.match(g.todo, /^Name the tests in the plan/);
  // Build's own cost in the 30 days is $47: rework is 17 % of it.
  assert.deepEqual(g.table.rows, [['Build', '1', '$8.00', '17%']]);
  assert.equal(byId(insights(MONTH, { audit: null })).rework.headline, 'Can’t see send-backs here yet.');
  assert.equal(byId(insights(MONTH, { audit: [] })).rework.headline, 'No send-backs in the last 30 days, so no rework.');
});

test('7. waiting on you: hours your jobs sat waiting this week, daytime and overnight, and the median answer', () => {
  const g = byId(insights()).waiting;
  // This week: 17:00 → 19:00 (2 h, daytime) and 19:05 → 07:00 (55 min daytime, 11 h overnight): 13.9 hours.
  assert.equal(g.headline, 'Jobs waited 14 hours on you this week, most of it overnight.');
  // Median of 120 and 715 minutes is 417.5: 7.0 hours. The weeks before: 20 and 30 minutes for the
  // approvals and 30 for the send-back (an answer too): 30 min.
  assert.equal(g.sub, 'Median time to answer this week: 7.0 hours (30 min in the weeks before).');
  assert.match(g.todo, /^Approve plans before you stop for the day/);
  assert.equal(byId(insights(MONTH, { audit: AUDIT.slice(0, 2) })).waiting.headline, 'Not enough answers yet to say (2 of 3 needed).');
  assert.equal(byId(insights(MONTH, { audit: null })).waiting.state, 'cannot-see');
});

test('8. time to PR #1: small against large', () => {
  const g = byId(insights()).pr1;
  // Small: 1, 1 and 0.75 days (median 1); large: 3 days.
  assert.equal(g.headline, 'Small jobs reach PR #1 in 1.0 days; large ones take 3.0 days.');
  assert.match(g.todo, /^Split large tickets into a stack/);
  const noList = byId(insights(MONTH, { jobs: null })).pr1;
  assert.equal(noList.headline, 'Jobs reach PR #1 in 1.0 days: the middle of 4 jobs.');
  assert.ok(noList.notes.includes('The job list wasn’t here, so job sizes aren’t known.'));
  assert.equal(byId(insights(MONTH.filter((l) => !['job-1', 'job-2', 'job-3'].includes(l.job)))).pr1.headline, 'Not enough jobs at PR #1 yet to say (1 of 3 needed).');
});

test('9. when the limit goes: weekday by two hours, this app and other use both counted', () => {
  const g = byId(insights()).when;
  assert.equal(g.data.unit, 'percent');
  assert.equal(g.data.cells.length, 84);
  // Other use: 30 points between the 20:30 and 08:00 readings, spread over those 11.5 hours, plus
  // the meter's rounding in the other stretches (whole percents): 0.4 and 0.2 more.
  const other = g.data.cells.reduce((s, c) => s + c.other, 0);
  assert.ok(Math.abs(other - 30.6) < 0.01, `other use ${other}`);
  const night = g.data.cells.filter((c) => c.day === 3 && c.block < 4).reduce((s, c) => s + c.other, 0);
  assert.ok(Math.abs(night - 30 * 8 / 11.5) < 0.01, `Thursday 00:00 to 08:00: ${night}`);
  assert.equal(g.headline, 'Most use lands Wednesday, 20:00 to midnight.');
  assert.deepEqual(g.table.head, ['Day', 'In this app', 'Other use (estimated)', 'Busiest two hours']);
  assert.equal(byId(insights(thisWeek)).when.headline, 'Not enough days yet to say (0 of 7 needed).');
});

test('10. cache reuse: the share of input read from the cache, and the jobs that reused least', () => {
  const g = byId(insights()).cache;
  // This week, yours: job-4 read 600 of every 1,600 tokens (38 %); the week before, 3,000 of 4,000 (75 %).
  assert.equal(g.headline, '38% of input came from the cache this week, down from 75% the week before.');
  // job-4 ran in five sessions: restarted 4 times.
  assert.equal(g.todo, 'Keep long jobs in one session: Job 4 restarted 4 times and reused only 38%.');
});

test('too little data: each graph says so instead of guessing', () => {
  const r = insights([line({ t: '2026-10-29T10:00:00.000Z', job: 'job-x' })], { jobs: null, audit: null });
  const g = byId(r);
  assert.equal(g.limit.headline, 'No reading of the weekly limit yet, so no forecast.');
  assert.equal(g['ticket-cost'].headline, 'Not enough tickets at PR #1 yet to say (0 of 2 needed).');
  assert.equal(g.pr1.headline, 'Not enough jobs at PR #1 yet to say (0 of 3 needed).');
  assert.equal(g.when.headline, 'Not enough days yet to say (0 of 7 needed).');
  assert.equal(g.rework.headline, 'Can’t see send-backs here yet.');
  assert.equal(g.waiting.headline, 'Can’t see your answers here yet.');
  assert.equal(r.limits.week.sentence, 'Can’t see use outside this app yet: no limit readings this week.');
});

test('the temp folders are lib/platform.js’s, written out so the site half starts no process', async () => {
  const { tempDirs: platformDirs } = await import('../lib/platform.js');
  const { tempDirs } = await import('../lib/insights.js');
  for (const o of [{ platform: 'darwin', tmpdir: '/var/folders/ab/T' }, { platform: 'linux', tmpdir: '/tmp' }, { platform: 'win32', tmpdir: 'C:\\Temp' }]) assert.deepEqual(tempDirs(o), platformDirs(o));
});
