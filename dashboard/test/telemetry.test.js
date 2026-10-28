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
import { dayKey, forecast, percentPerDollar, telemetry, whenWords, windowRange } from '../lib/telemetry.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'telemetry', 'usage.jsonl');
const lines = (await fs.readFile(FIXTURE, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
const NOW = '2026-10-28T12:00:00.000Z';
const TITLES = { 'orbit-479-feedback-api': 'Feedback API', 'orbit-512-export': 'Export', 'tidy-logs': 'Tidy logs' };
const OPTS = { now: NOW, me: 'vignesh', titles: TITLES, timeZone: 'UTC' };
const data = (window) => Object.fromEntries(telemetry(lines, { ...OPTS, window }).datasets.map((d) => [d.id, d]));

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
  assert.equal(windowRange('week', { now: NOW, meters: null }).from, Date.parse('2026-10-21T12:00:00Z'));
  assert.equal(windowRange('30d', { now: NOW }).from, Date.parse('2026-09-28T12:00:00Z'));
});

test('percent per dollar: the weekly meter’s rise over the cost recorded, per plan week', () => {
  assert.equal(percentPerDollar(lines.filter((l) => Date.parse(l.t) >= Date.parse('2026-09-28T12:00:00Z'))), 2);
  assert.equal(percentPerDollar(lines.map((l) => ({ ...l, meters: { fiveHour: null, week: null } }))), null);
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
  assert.equal(forecast([at('2026-10-26T08:00:00Z', 46)], { now: NOW }).state, 'unknown', 'the newest reading is over a day old');
  // A reading before the reset is not part of this week's pace.
  assert.equal(forecast([at('2026-10-27T13:00:00Z', 90, '2026-10-27T14:00:00Z'), at('2026-10-28T08:00:00Z', 10)], { now: NOW }).state, 'unknown');
  // The live reading counts when it is newer than the last line: 46 → 52 at 09:00 the next day.
  const live = forecast([at('2026-10-27T09:00:00Z', 46)], { now: NOW, timeZone: 'UTC', reading: { t: '2026-10-28T09:00:00Z', week: { percent: 52, resetsAt: '2026-10-29T14:00:00Z' } } });
  assert.equal(live.perHour, 0.25);
});

test('gauge: the window’s readings, the weekly resets in it and the forecast', () => {
  const month = data('30d').gauge;
  assert.equal(month.audience, 'common');
  assert.equal(month.points.length, 120);
  assert.deepEqual(month.resets, ['2026-10-01T14:00:00.000Z', '2026-10-08T14:00:00.000Z', '2026-10-15T14:00:00.000Z', '2026-10-22T14:00:00.000Z']);
  assert.equal(month.sentence, 'At this pace, full on Thursday 03:48.');
  const week = data('week').gauge;
  // 22 Oct 19:00, then 23–27 Oct (4 a day), then 28 Oct 01:00 and 07:00.
  assert.equal(week.points.length, 23);
  assert.deepEqual(week.points[0], { t: '2026-10-22T19:00:00.000Z', week: 3, fiveHour: 15 });
  assert.deepEqual(week.resets, ['2026-10-22T14:00:00.000Z']);
  assert.deepEqual(data('5h').gauge.points, [{ t: '2026-10-28T07:00:00.000Z', week: 87, fiveHour: 30 }]);
});

test('use by day, by job: your own jobs only, each day stacked, in percent of the week', () => {
  const d = data('week')['by-day-job'];
  assert.equal(d.audience, 'private');
  assert.equal(d.unit, 'percent');
  assert.ok(!d.jobs.some((j) => j.slug === 'tidy-logs'), 'sohum’s job is not on your graph');
  // 30 days, yours: Feedback API 66 + 32.5 = $98.50, Export $33: Feedback API takes colour 1.
  assert.deepEqual(d.jobs.map((j) => [j.slug, j.slot]), [['orbit-479-feedback-api', 1], ['orbit-512-export', 2]]);
  assert.deepEqual(d.days.map((x) => x.day), ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
  // 22 Oct: only Export at 19:00 ($1.50). 23–27 Oct: Feedback API $3 + $1.50, Export $1.50. 28 Oct: Feedback API $3.
  assert.deepEqual(d.days[0].parts, [{ key: 'orbit-512-export', usd: 1.5, percent: 3 }]);
  assert.deepEqual(d.days[1].parts, [{ key: 'orbit-479-feedback-api', usd: 4.5, percent: 9 }, { key: 'orbit-512-export', usd: 1.5, percent: 3 }]);
  assert.equal(d.days[1].label, 'Fri 23 Oct');
  assert.deepEqual(d.days[6].parts, [{ key: 'orbit-479-feedback-api', usd: 3, percent: 6 }]);
  // The week: Feedback API 5 × 4.5 + 3 = $25.50 = 51 %; Export 1.5 + 5 × 1.5 = $9 = 18 %.
  assert.deepEqual(d.jobs.map((j) => [j.usd, j.percent]), [[25.5, 51], [9, 18]]);
  assert.equal(d.sentence, 'Feedback API used the most this week: 51% of the week ($25.50).');
  const month = data('30d')['by-day-job'];
  assert.equal(month.days.length, 31, '28 Sep to 28 Oct');
  assert.deepEqual(month.days[0].parts, [{ key: 'orbit-479-feedback-api', usd: 1, percent: 2 }, { key: 'orbit-512-export', usd: 1, percent: 2 }], '28 Sep: 13:00 and 19:00 only');
});

test('cost per ticket and per stage: the last 30 days, yours, in dollars and percent of a week', () => {
  for (const w of ['5h', 'week', '30d']) {
    const c = data(w).cost;
    assert.equal(c.audience, 'private');
    // Feedback API: 07:00 × 30 = 24 × $2 + 6 × $3 = $66, 13:00 × 30 = 25 × $1 + 5 × $1.50 = $32.50. Export: 24 + 6 × 1.5 = $33.
    assert.deepEqual(c.tickets.map((t) => [t.label, t.usd, t.percent]), [['ORBIT-479', 98.5, 197], ['ORBIT-512', 33, 66]]);
    assert.deepEqual(c.stages.map((s) => [s.label, s.usd, s.percent]), [['Plan', 66, 132], ['Build', 33, 66], ['Review', 32.5, 65]]);
    assert.equal(c.sentence, 'ORBIT-479 cost the most in the last 30 days: $98.50 (197% of a week); the costliest stage was Plan at $66.00 (132%).');
  }
  // Without a ticket, the job's name says what it is.
  const theirs = telemetry(lines, { ...OPTS, me: 'sohum', window: 'week' }).datasets.find((d) => d.id === 'cost');
  assert.deepEqual(theirs.tickets.map((t) => [t.label, t.usd]), [['Tidy logs (no ticket)', 33]]);
});

test('share by model: one bar per plan week, everyone’s use, by cost', () => {
  const week = data('week')['by-model'];
  assert.equal(week.audience, 'common');
  assert.equal(week.weeks.length, 1);
  // Opus: 07:00 × 6 at $3 + 19:00 × 6 at $1.50 = $27; Sonnet: 13:00 × 5 + 01:00 × 6, at $1.50 = $16.50.
  assert.deepEqual(week.weeks[0].parts.map((p) => [p.key, p.usd]), [['opus', 27], ['sonnet', 16.5]]);
  assert.equal(week.weeks[0].parts[0].share, 0.6207);
  assert.deepEqual(week.models.map((m) => [m.label, m.slot]), [['Opus 5.5', 1], ['Sonnet 5.5', 2]]);
  assert.equal(week.sentence, 'Opus 5.5 did 62% of the work by cost this week.');
  const month = data('30d')['by-model'];
  assert.deepEqual(month.weeks.map((w) => w.label), ['22 Oct to 28 Oct', '15 Oct to 22 Oct', '8 Oct to 15 Oct', '1 Oct to 8 Oct', '28 Sept to 1 Oct']);
  // A whole week before the busy one: Opus $3 a day, Sonnet $2 a day, 7 days.
  assert.deepEqual(month.weeks[1].parts.map((p) => [p.key, p.usd, p.share]), [['opus', 21, 0.6], ['sonnet', 14, 0.4]]);
  // 28 Sep 12:00 to 1 Oct 14:00: Opus 07:00 × 3 + 19:00 × 3 = $9; Sonnet 01:00 × 3 + 13:00 × 4 = $7.
  assert.deepEqual(month.weeks[4].parts.map((p) => [p.key, p.usd]), [['opus', 9], ['sonnet', 7]]);
});

test('people on the account: one bar per person, names only', () => {
  const p = data('week').people;
  assert.equal(p.audience, 'common');
  // vignesh $25.50 + $9 = $34.50 = 69 %; sohum 01:00 × 6 at $1.50 = $9 = 18 %; together 87 %, the meter.
  assert.deepEqual(p.people, [{ user: 'vignesh', usd: 34.5, percent: 69 }, { user: 'sohum', usd: 9, percent: 18 }]);
  assert.equal(p.sentence, 'vignesh used the most this week: 69% of the week ($34.50); sohum 18% ($9.00).');
  assert.deepEqual(data('30d').people.people.map((x) => [x.user, x.usd]), [['vignesh', 131.5], ['sohum', 33]]);
  assert.equal(data('5h').people.sentence, 'Only vignesh used the account in this five hours: 6% of the week ($3.00).');
  // The common graphs never name a job.
  for (const id of ['gauge', 'by-model', 'people']) assert.ok(!JSON.stringify(data('30d')[id]).match(/orbit-|tidy-logs|Feedback API|ORBIT-/), id);
});

test('the five datasets, in order, each with its audience and one sentence', () => {
  const t = telemetry(lines, { ...OPTS, window: 'week' });
  assert.deepEqual(t.datasets.map((d) => [d.id, d.audience]), [['gauge', 'common'], ['by-day-job', 'private'], ['cost', 'private'], ['by-model', 'common'], ['people', 'common']]);
  for (const d of t.datasets) assert.match(d.sentence, /^[A-Z$a-z].+\.$/, d.id);
  assert.equal(t.percentPerDollar, 2);
  assert.equal(t.from, '2026-10-22T14:00:00.000Z');
  assert.throws(() => telemetry(lines, { ...OPTS, window: 'year' }), RangeError);
});

test('no meters and no lines: dollars alone, and sentences that say so', () => {
  const bare = lines.map((l) => ({ ...l, meters: { fiveHour: null, week: null } }));
  const d = Object.fromEntries(telemetry(bare, { ...OPTS, window: 'week' }).datasets.map((x) => [x.id, x]));
  assert.equal(d['by-day-job'].unit, 'usd');
  assert.equal(d.people.people[0].percent, null);
  assert.match(d.people.sentence, /^vignesh used the most this week: \$/);
  assert.equal(d.gauge.forecast.state, 'unknown');
  const empty = Object.fromEntries(telemetry([], { ...OPTS, window: 'week' }).datasets.map((x) => [x.id, x]));
  assert.equal(empty['by-day-job'].sentence, 'None of your jobs used Claude this week.');
  assert.equal(empty.cost.sentence, 'Nothing recorded for your jobs in the last 30 days.');
  assert.equal(empty['by-model'].sentence, 'Nothing recorded this week.');
  assert.equal(empty.people.sentence, 'Nobody used the account this week, as far as this computer knows.');
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
  // A port with the next one free too (the screens server takes port + 1), away from the ones
  // the system hands out one after another.
  const free = (p) => new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
  });
  let port = 0;
  for (let i = 0; i < 50 && !port; i++) {
    const p = 20000 + Math.floor(Math.random() * 20000);
    if ((await free(p)) && (await free(p + 1))) port = p;
  }
  assert.ok(port, 'a free port');
  const output = [];
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(port), HOME: dirs.home, WORKSHOP_DEMO: '1', WORKSHOP_FEATURES_DIR: dirs['feature-work'], WORKSHOP_PROJECTS_DIR: dirs.projects, WORKSHOP_AGENTS_DIR: dirs.agents, WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: dirs.state, GROUND_CONTROL_USER: 'vignesh', GROUND_CONTROL_DIR: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The dashboard didn't start:\n${output.join('')}`)), 15000);
    child.stdout.on('data', (d) => { output.push(String(d)); if (output.join('').includes('Feature Workshop running')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', (d) => output.push(String(d)));
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`The dashboard exited (${code}):\n${output.join('')}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const token = (await (await fetch(`${base}/api/meta`)).json()).token;
  const write = async (method, p, body = {}) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Workshop-Token': token }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const stop = async () => {
    if (child.exitCode === null) {
      const gone = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM'); // exactly the dashboard this test started
      await gone;
    }
    await fs.rm(root, { recursive: true, force: true });
  };
  return { base, dirs, write, stop, output };
}

test('GET /api/telemetry: the five datasets for the window, from usage.jsonl in the state folder', async () => {
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
    assert.deepEqual(body.datasets.map((x) => [x.id, x.audience]), [['gauge', 'common'], ['by-day-job', 'private'], ['cost', 'private'], ['by-model', 'common'], ['people', 'common']]);
    const people = body.datasets.find((x) => x.id === 'people');
    assert.deepEqual(people.people, [{ user: 'vignesh', usd: 34.5, percent: 69 }, { user: 'sohum', usd: 9, percent: 18 }]);
    const gauge = body.datasets.find((x) => x.id === 'gauge');
    assert.equal(gauge.forecast.fullAt, move('2026-10-29T03:48:00.000Z'));
    assert.match(gauge.sentence, /^At this pace, full on \w+day \d\d:\d\d\.$/);
    for (const x of body.datasets) assert.ok(x.sentence.length > 10, x.id);
    assert.equal((await (await fetch(`${d.base}/api/telemetry`)).json()).window, 'week', 'this week unless asked');
    assert.equal((await (await fetch(`${d.base}/api/telemetry?window=30d`)).json()).datasets.find((x) => x.id === 'people').people[0].usd, 131.5);
    const bad = await fetch(`${d.base}/api/telemetry?window=year`);
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'The window is one of 5h, week or 30d.');
    assert.equal((await fetch(`${d.base}/api/telemetry/other`)).status, 404);
    assert.equal((await d.write('POST', '/api/telemetry', {})).status, 405);
  } finally {
    await d.stop();
  }
});
