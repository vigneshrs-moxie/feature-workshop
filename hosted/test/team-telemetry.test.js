// Packet 2E step 3: the team page's sums and routes. Two made-up people's lines combined into one
// picture of the shared limit; the plan week from Wednesday 16:00 local; the forecast from everyone's
// use; Other use never below zero; the parts adding up to the total; a person's own graphs refused
// (404) for anyone else; no job names in what everyone sees.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamTelemetry, privateTelemetry, wholeParts, zoneOf } from '../lib/team-telemetry.js';
import { browser, makeSite, signIn, SITE } from './helpers.js';
import { paired } from './laptops.js';

const MIN = 60e3;
const H = 3600e3;
const RESET = '2026-11-04T23:00:00.000Z'; // Wednesday 4 November, 16:00 in Phoenix
const WEEK_START = Date.parse('2026-10-28T23:00:00Z'); // Wednesday 28 October, 16:00 in Phoenix
const PEOPLE = [{ id: 1, name: 'Raj Example' }, { id: 2, name: 'Sam Example' }];
const tz = 'America/Phoenix';

let n = 0;
const row = (person, kind, t, extra = {}) => ({
  person_id: person, kind, id: (++n).toString(16).padStart(24, '0'), t: new Date(t), job: null, stage: null, model: kind === 'claude-code' ? 'opus' : 'claude-opus-4-1',
  input: 100, output: 50, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, usd: 0, week_percent: null, week_resets_at: null, five_hour_percent: null, five_hour_resets_at: null, ...extra,
});
const reading = (person, t, week, extra = {}) => row(person, 'reading', t, { model: null, week_percent: week, week_resets_at: new Date(RESET), ...extra });
const spend = (person, t, usd, extra = {}) => row(person, 'app', t, { usd, job: 'add-export', stage: 'implement', ...extra });

/**
 * A week of two people: readings every ten minutes from Raj's laptop, Raj's spend in the first six
 * stretches and Sam's in the next six ($1 and 1% each: 1% per dollar), and before them, from the
 * week's start, 20% of which 12% is known (Raj $5 in the app and $2 in Claude Code, Sam $5).
 */
function twoPeople(t0 = WEEK_START + 30 * H) {
  const rows = [
    spend(1, WEEK_START + H, 5), row(1, 'claude-code', WEEK_START + 2 * H, { usd: 2 }), spend(2, WEEK_START + 3 * H, 5),
    reading(1, t0, 20),
  ];
  for (let k = 1; k <= 12; k++) {
    rows.push(spend(k <= 6 ? 1 : 2, t0 + k * 10 * MIN - 5 * MIN, 1));
    rows.push(reading(1, t0 + k * 10 * MIN, 20 + k));
  }
  return { rows, now: t0 + 13 * 10 * MIN };
}

test('two people’s lines combine: each is named, Other use is what nobody’s use explains, and the parts add up to the total', () => {
  const { rows, now } = twoPeople();
  const t = teamTelemetry({ rows, people: PEOPLE, now, timeZone: tz, me: 1 });
  const w = t.limits.week;
  assert.equal(w.state, 'split');
  assert.equal(t.percentPerDollar, 1);
  assert.equal(w.total, 32);
  const raj = w.people.find((p) => p.user === 'Raj Example');
  const sam = w.people.find((p) => p.user === 'Sam Example');
  assert.deepEqual([raj.app, raj.claudeCode], [11, 2]);
  assert.deepEqual([sam.app, sam.claudeCode], [11, 0]);
  assert.equal(w.other, 8);
  assert.equal(w.unknown, 0);
  assert.equal(raj.app + raj.claudeCode + sam.app + sam.claudeCode + w.other + w.unknown, w.total);
  assert.equal(w.free, 68);
  assert.match(w.sentence, /^This week: 32% used\. Raj Example 13% \(11% in the app, 2% in Claude Code\), Sam Example 11% \(11% in the app\), other use 8% \(claude\.ai, the Claude app, other people; estimated\)\. 68% is still free\.$/);
  // Who used this week's limit: the same parts, in a graph everyone sees, with Other use once.
  const people = t.graphs.find((g) => g.id === 'people');
  assert.equal(people.audience, 'common');
  assert.equal(people.data.others.percent, 8);
  assert.deepEqual(people.data.people.map((p) => [p.user, p.app, p.claudeCode]), [['Raj Example', 11, 2], ['Sam Example', 11, 0]]);
  assert.match(people.headline, /^Raj Example used 13% of this week’s limit, Sam Example 11%; other use 8% \(estimated\); 68% is still free\.$/);
  assert.ok(people.table.rows.some((r) => r[0] === 'All of the limit' && r[1] === '100%'));
  // Seen from Raj's laptop alone, Sam's 11% would have been Other use: combining is what names him.
  const alone = teamTelemetry({ rows: rows.filter((r) => r.person_id === 1), people: PEOPLE, now, timeZone: tz });
  assert.equal(alone.limits.week.other, 19);
});

test('the week starts Wednesday 16:00 local: a line at 15:59 is last week’s, at 16:01 this week’s; a meter’s own reset wins', () => {
  const before = spend(1, WEEK_START - MIN, 3);
  const after = spend(2, WEEK_START + MIN, 2);
  const now = WEEK_START + 30 * MIN;
  const t = teamTelemetry({ rows: [before, after], people: PEOPLE, now, timeZone: tz });
  assert.equal(t.from, '2026-10-28T23:00:00.000Z');
  assert.equal(t.weekLabel, 'Week from Wed 28 Oct, 4 pm');
  const models = t.graphs.find((g) => g.id === 'models');
  assert.deepEqual(models.data.bars.map((b) => [b.label, b.usd]), [['From Wed 21 Oct', 3], ['This week', 2]]);
  // In another time zone the same moment is another local time, so the week starts elsewhere.
  assert.equal(teamTelemetry({ rows: [], people: PEOPLE, now, timeZone: 'Europe/London' }).from, '2026-10-28T16:00:00.000Z');
  // A reading whose meter says it resets at 15:00 local next Wednesday: this week started at 15:00.
  const meter = reading(1, WEEK_START + 10 * MIN, 1, { week_resets_at: new Date('2026-11-04T22:00:00Z') });
  assert.equal(teamTelemetry({ rows: [meter], people: PEOPLE, now, timeZone: tz }).from, '2026-10-28T22:00:00.000Z');
  // No zone asked for, or a made-up one: the team's own clock.
  assert.equal(zoneOf(undefined), 'America/Phoenix');
  assert.equal(zoneOf('Mars/Olympus'), 'America/Phoenix');
  assert.equal(zoneOf('Asia/Kolkata'), 'Asia/Kolkata');
});

test('the forecast uses everyone’s use: the combined pace, and whose use drives it, by name', () => {
  // Eight hours of readings every ten minutes, rising 1% an hour; Sam spends $1 an hour (Raj nothing).
  const now = WEEK_START + 2 * 24 * H; // Friday 16:00 in Phoenix
  const rows = [];
  for (let k = 0; k <= 48; k++) {
    const t = now - 8 * H + k * 10 * MIN;
    rows.push(reading(k % 2 ? 1 : 2, t, 40 + Math.floor(k / 6)));
    if (k) rows.push(spend(2, t - 5 * MIN, 1 / 6));
  }
  const t = teamTelemetry({ rows, people: PEOPLE, now, timeZone: tz });
  const limit = t.graphs.find((g) => g.id === 'limit');
  const fc = limit.data.forecast;
  assert.equal(fc.state, 'fills');
  assert.equal(fc.perHour, 1);
  assert.equal(fc.fullAt, new Date(now + 52 * H).toISOString());
  assert.match(fc.driver.words, /^mostly from Sam Example’s use in the app$/);
  assert.match(limit.headline, /^At this pace the week is full on Sunday 20:00, 3 days before it resets, mostly from Sam Example’s use in the app\.$/);
  assert.match(limit.todo, /Sam Example’s/);
  // The same rise with nobody's spend in it: other use drives it.
  const quiet = teamTelemetry({ rows: rows.filter((r) => r.kind === 'reading'), people: PEOPLE, now, timeZone: tz });
  assert.equal(quiet.graphs[0].data.forecast.state, 'fills');
  assert.equal(quiet.graphs[0].data.forecast.driver, null); // no percent per dollar: no driver, never a guess
  assert.match(quiet.graphs[0].todo, /^The week fills before it resets: check with the others/);
});

test('Other use is never below zero, even when known use explains more than the meter rose', () => {
  const t0 = WEEK_START + H;
  const rows = [
    spend(1, WEEK_START + 30 * MIN, 10), reading(1, t0, 5), // $10 at 1%/$ would be 10%, but the meter says 5%
    spend(2, t0 + 5 * MIN, 1), reading(2, t0 + 10 * MIN, 6),
    spend(1, t0 + 15 * MIN, 1), reading(1, t0 + 20 * MIN, 7),
    spend(2, t0 + 25 * MIN, 1), reading(2, t0 + 30 * MIN, 8),
  ];
  const t = teamTelemetry({ rows, people: PEOPLE, now: t0 + 31 * MIN, timeZone: tz });
  const w = t.limits.week;
  assert.equal(w.state, 'split');
  assert.ok(w.other >= 0, `other use was ${w.other}`);
  assert.ok(w.unknown >= 0);
  for (const s of w.stretches) if (s.known) assert.ok(s.other >= 0);
  assert.equal(sumParts(w), w.total);
  assert.equal(w.total, 8);
  // Whole parts always add up, and never go below zero.
  assert.deepEqual(wholeParts([3.4, 3.3, 3.3], 10), [4, 3, 3]);
  assert.deepEqual(wholeParts([-2, 5, 0], 5), [0, 5, 0]);
  assert.deepEqual(wholeParts([0, 0], 0), [0, 0]);
});
const sumParts = (w) => w.people.reduce((s, p) => s + p.app + p.claudeCode, 0) + w.other + w.unknown;

test('a person’s own graphs: usage by day by job and cost per ticket and stage, with their job names', () => {
  const now = WEEK_START + 2 * 24 * H;
  const rows = [
    spend(1, now - 2 * H, 4, { job: 'orbit-479-tidy-button', stage: 'implement' }),
    spend(1, now - 3 * H, 1, { job: 'orbit-479-tidy-button', stage: 'review' }),
    spend(1, now - 26 * H, 2, { job: 'add-export', stage: 'plan' }),
  ];
  const p = privateTelemetry({ rows, jobs: [{ slug: 'add-export', title: 'Add export', ticket_key: 'SALES-12' }, { slug: 'orbit-479-tidy-button', title: 'Tidy button', ticket_key: null }], now, timeZone: tz, ratio: 1 });
  const [byDay, ticket] = p.graphs;
  assert.equal(byDay.id, 'by-day');
  assert.equal(byDay.audience, 'private');
  assert.equal(byDay.data.days.length, 14);
  assert.deepEqual(byDay.data.jobs.map((j) => j.label), ['Tidy button', 'Add export']);
  assert.match(byDay.headline, /^Your busiest day was Fri 30 Oct: \$5\.00 \(5% of a week\), most of it on Tidy button\.$/);
  assert.equal(ticket.id, 'ticket-stage');
  assert.deepEqual(ticket.data.tickets.map((t) => t.label), ['ORBIT-479 Tidy button', 'SALES-12 Add export']);
  assert.deepEqual(ticket.data.stages.map((s) => [s.label, s.usd]), [['Build', 4], ['Plan', 2], ['Review', 1]]);
  assert.match(ticket.headline, /^ORBIT-479 Tidy button cost the most in 30 days: \$5\.00 \(5% of a week\); Build took 57% of your spend\.$/);
});

// ---------- The routes ----------

const NOW = Date.parse('2026-10-30T16:00:00Z');
const hex = (k) => k.toString(16).padStart(24, '0');
async function postUsage(s, token, body) {
  const r = await s.fetch(`${SITE}/api/runner/usage`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  assert.equal(r.status, 200);
  return r.json();
}
const line = (k, minsAgo, extra = {}) => ({ id: hex(k), t: new Date(NOW - minsAgo * MIN).toISOString(), job: 'add-export', stage: 'implement', model: 'claude-opus-4-1', tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, usd: 1, meters: { week: { percent: 20 + k, resetsAt: RESET }, fiveHour: null }, ...extra });

test('the team page is the same for everyone on the site and names no job; a person’s own graphs are theirs alone (404 for anyone else)', async () => {
  const s = await makeSite({ clock: { t: NOW } });
  try {
    const raj = await paired(s, 'raj.manager@example.test', 'Raj’s Mac');
    const sam = await paired(s, 'sam.member@example.test', 'Sam’s laptop');
    const owner = browser(s.fetch);
    await signIn(owner, { email: 'olive.owner@example.test' });
    const ids = Object.fromEntries((await s.db.query('SELECT id, email FROM people')).rows.map((r) => [r.email.split('.')[0], Number(r.id)]));
    // Raj is the manager.
    assert.equal((await owner.send('POST', `/api/people/${ids.raj}/role`, { role: 'manager' })).status, 200);
    await postUsage(s, raj.token, { app: [1, 2, 3, 4].map((k) => line(k, 60 - k * 10, { job: 'orbit-479-tidy-button' })), counting: 'off' });
    await postUsage(s, sam.token, { app: [5, 6].map((k) => line(k, 30 - k, { job: 'route-sharing', stage: 'test' })), counting: 'not-sent' });
    await s.db.query("INSERT INTO jobs (runner_id, person_id, slug, title, ticket_key, mirrored_at) VALUES ($1, $2, 'orbit-479-tidy-button', 'Tidy button', 'ORBIT-479', now())", [raj.runnerId, ids.raj]);

    const seen = {};
    for (const [who, b] of [['raj', raj.person], ['sam', sam.person], ['owner', owner]]) {
      const r = await b.json('/api/telemetry/team?tz=America%2FPhoenix');
      assert.equal(r.status, 200);
      seen[who] = r.body;
    }
    const same = (b) => JSON.stringify({ ...b, me: null, people: b.people.map((p) => ({ ...p, you: null })) });
    assert.equal(same(seen.raj), same(seen.sam));
    assert.equal(same(seen.raj), same(seen.owner));
    assert.deepEqual(seen.raj.graphs.map((g) => [g.id, g.audience]), [['limit', 'common'], ['people', 'common'], ['models', 'common']]);
    const text = JSON.stringify(seen.raj);
    for (const name of ['tidy-button', 'Tidy button', 'route-sharing', 'ORBIT-479']) assert.ok(!text.includes(name), `the team page named ${name}`);
    // What each laptop said about Claude Code use outside the app, in words.
    const notes = seen.raj.graphs.find((g) => g.id === 'people').notes.join(' ');
    assert.match(notes, /raj\.manager’s Claude Code use outside the app isn’t counted \(it is turned off on their laptop\)/);
    assert.match(notes, /sam\.member’s laptop doesn’t send its Claude Code use outside the app yet/);

    // Raj's own graphs: his, with his job's name. Anyone else asking for them: 404, as if nothing were there.
    const mine = await raj.person.json(`/api/telemetry/people/${ids.raj}?tz=America%2FPhoenix`);
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.graphs.map((g) => [g.id, g.audience]), [['by-day', 'private'], ['ticket-stage', 'private']]);
    assert.ok(JSON.stringify(mine.body).includes('Tidy button'));
    assert.ok(!JSON.stringify(mine.body).includes('route-sharing'));
    for (const [who, b] of [['sam', sam.person], ['the owner', owner]]) {
      const theirs = await b.json(`/api/telemetry/people/${ids.raj}`);
      assert.equal(theirs.status, 404, `${who} saw Raj’s own graphs`);
      assert.equal(theirs.body.error, 'There is nothing at this address.');
      assert.ok(!JSON.stringify(theirs.body).includes('Tidy'));
    }
    assert.equal((await raj.person.json('/api/telemetry/people/999999')).status, 404);
    // Signed out: nothing.
    assert.equal((await browser(s.fetch).json('/api/telemetry/team')).status, 401);
    assert.equal((await browser(s.fetch).json(`/api/telemetry/people/${ids.raj}`)).status, 401);
  } finally { await s.close(); }
});
