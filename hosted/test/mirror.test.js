// Packet 2A step 5: the first mirror. Two made-up people, two laptops: each sees only their own
// jobs; a guessed id from another person is a 404; one person's two laptops are grouped; a job
// list replaces what was there; a removed laptop takes its jobs with it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSite } from './helpers.js';
import { card, fakeRunner, laptop, paired, until } from './laptops.js';

const titles = (body) => body.laptops.map((l) => [l.name, l.jobs.map((j) => j.title)]);

test('two people, two laptops: each sees only their own jobs, and a guessed job id is a 404', async () => {
  const s = await makeSite();
  const olive = await paired(s, 'olive.owner@example.test', 'Olive’s Mac');
  const sam = await paired(s, 'sam.sample@example.test', 'Sam’s Windows laptop');
  const a = await laptop(s, olive.token, { runner: fakeRunner([card('add-export', { title: 'Add export' }), card('orbit-479-tidy-button', { title: 'Tidy button', lane: 'needs-you', laneReason: 'Needs you: the plan', nowDoing: [] })]) });
  const b = await laptop(s, sam.token, { runner: fakeRunner([card('route-sharing', { title: 'Route sharing', stage: 'test' })]) });
  try {
    await until(async () => (await s.db.query('SELECT count(*)::int AS n FROM jobs')).rows[0].n === 3, { what: 'three jobs mirrored' });
    const mine = (await olive.person.json('/api/jobs')).body;
    assert.deepEqual(titles(mine), [['Olive’s Mac', ['Add export', 'Tidy button']]]);
    const tidy = mine.laptops[0].jobs.find((j) => j.slug === 'orbit-479-tidy-button');
    assert.deepEqual({ ...tidy, id: 0, laptopId: 0 }, { id: 0, laptopId: 0, slug: 'orbit-479-tidy-button', title: 'Tidy button', ticket: 'ORBIT-479', stage: 'build', state: 'needs-you', stateWords: 'Needs you: the plan', now: 'Needs you: the plan', updatedAt: '2026-10-30T15:00:00.000Z' });
    assert.equal(mine.laptops[0].online, true);
    const theirs = (await sam.person.json('/api/jobs')).body;
    assert.deepEqual(titles(theirs), [['Sam’s Windows laptop', ['Route sharing']]]);
    // Olive's own job by id: yes. Sam's, guessed: a 404 as if it weren't there; so is a made-up id.
    assert.equal((await olive.person.json(`/api/jobs/${tidy.id}`)).body.job.title, 'Tidy button');
    const samsId = theirs.laptops[0].jobs[0].id;
    const guess = await olive.person.json(`/api/jobs/${samsId}`);
    assert.equal(guess.status, 404);
    assert.match(guess.body.error, /no job like that among yours/);
    assert.equal((await olive.person.json('/api/jobs/999999')).status, 404);
    // Roles change nothing: the owner sees only her own too (checked above); signed out, nothing.
    assert.equal((await (await import('./helpers.js')).browser(s.fetch).json('/api/jobs')).status, 401);
  } finally { a.link.stop(); b.link.stop(); await s.close(); }
});

test('one person’s two laptops are grouped; a job list replaces the rows; a status updates one; Remove takes the jobs away', async () => {
  const s = await makeSite();
  const one = await paired(s, 'olive.owner@example.test', 'Olive’s Mac');
  const two = await paired(s, 'olive.owner@example.test', 'Olive’s spare laptop', { person: one.person });
  const runnerA = fakeRunner([card('add-export', { title: 'Add export' })]);
  const a = await laptop(s, one.token, { runner: runnerA });
  const b = await laptop(s, two.token, { runner: fakeRunner([card('nightly-export', { title: 'Nightly export' })]) });
  try {
    await until(async () => (await s.db.query('SELECT count(*)::int AS n FROM jobs')).rows[0].n === 2, { what: 'both laptops’ jobs' });
    const both = (await one.person.json('/api/jobs')).body;
    assert.deepEqual(titles(both).sort(), [['Olive’s Mac', ['Add export']], ['Olive’s spare laptop', ['Nightly export']]]);
    // A status: one row changes.
    runnerA.cards[0] = card('add-export', { title: 'Add export', stage: 'review', lane: 'in-review', laneReason: 'In review', nowDoing: [] });
    runnerA.changed();
    await until(async () => (await s.db.query("SELECT stage FROM jobs WHERE slug = 'add-export'")).rows[0]?.stage === 'review', { what: 'the status' });
    // A new list: a job that left is gone, a new one is there.
    runnerA.cards = [card('price-rounding', { title: 'Price rounding' })];
    runnerA.changed();
    await until(async () => (await s.db.query("SELECT count(*)::int AS n FROM jobs WHERE slug = 'add-export'")).rows[0].n === 0, { what: 'the old job to go' });
    assert.deepEqual(titles((await one.person.json('/api/jobs')).body).find((x) => x[0] === 'Olive’s Mac'), ['Olive’s Mac', ['Price rounding']]);
    // Remove a laptop: its jobs leave the site.
    const spare = both.laptops.find((l) => l.name === 'Olive’s spare laptop');
    assert.equal((await one.person.send('DELETE', `/api/laptops/${spare.id}`, {})).status, 200);
    assert.deepEqual(titles((await one.person.json('/api/jobs')).body), [['Olive’s Mac', ['Price rounding']]]);
    assert.equal((await s.db.query("SELECT count(*)::int AS n FROM jobs WHERE slug = 'nightly-export'")).rows[0].n, 0);
  } finally { a.link.stop(); b.link.stop(); await s.close(); }
});

test('an offline laptop’s jobs stay listed, and the laptop says it is offline', async () => {
  const s = await makeSite();
  const one = await paired(s, 'olive.owner@example.test', 'Olive’s Mac');
  const a = await laptop(s, one.token, { runner: fakeRunner([card('add-export', { title: 'Add export' })]) });
  await until(async () => (await s.db.query('SELECT count(*)::int AS n FROM jobs')).rows[0].n === 1, { what: 'the job' });
  a.link.stop();
  try {
    s.clock.t += 2 * 60 * 1000;
    const l = (await one.person.json('/api/jobs')).body.laptops[0];
    assert.equal(l.online, false);
    assert.deepEqual(l.jobs.map((j) => j.title), ['Add export']);
  } finally { await s.close(); }
});
