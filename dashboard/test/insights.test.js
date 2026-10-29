// Telemetry's insight graphs (lib/insights.js): the cleaned record's rules on small fixtures made
// here, each number worked out by hand in the comments. No dashboard, no model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capOutliers, cleanRecord, isTempPath, median, meteredWeeks, quantile } from '../lib/insights.js';

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
