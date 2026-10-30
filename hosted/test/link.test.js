// Packet 2A step 4: the link between a laptop's runner (dashboard/runner/site-link.js) and the
// site: events up in batches of at most 256 KB, checked again by the site; the long-poll down;
// at-least-once delivery with no double run; the offline queue across a restart; being seen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROTOCOL_VERSION } from '../../dashboard/lib/protocol.js';
import { createSiteLink, eventQueue, QUEUE_FILE, siteTokenStore, writeSiteFile } from '../../dashboard/runner/site-link.js';
import { browser, makeSite, signIn, SITE } from './helpers.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gc-2a-link-'));

async function until(check, { ms = 8000, what = 'the condition' } = {}) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** A signed-in made-up person and a laptop paired for them: { person, token, runnerId }. */
async function paired(s, email, name = 'Test Laptop') {
  const person = browser(s.fetch);
  await signIn(person, { email });
  const post = async (p, body) => (await s.fetch(`${SITE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const st = await post('/api/pair/start', { name, os: 'macOS', deviceId: `device-${email.split('@')[0].replace(/\W/g, '')}-01` });
  assert.equal((await person.send('POST', `/api/pair/${st.code}/approve`, {})).status, 200);
  const fin = await post('/api/pair/finish', { secret: st.secret });
  return { person, token: fin.token, runnerId: fin.runner.id };
}

/** A pretend runner: its open jobs as the board's cards, the commands it was asked to run. */
function fakeRunner(cards = []) {
  const ee = new EventEmitter();
  const r = {
    cards, handled: [],
    read: { features: async () => ({ features: r.cards }) },
    async handle(cmd) { r.handled.push(cmd); return { ok: true }; },
    on(type, fn) { ee.on(type, fn); return () => ee.off(type, fn); },
    changed() { ee.emit('change'); },
  };
  return r;
}

const card = (slug, extra = {}) => ({ slug, title: `Job ${slug}`, stage: 'build', lane: 'working', laneReason: 'Working', nowDoing: [{ name: 'Builder', doing: 'Writing the tests' }], updatedAt: '2026-10-30T15:00:00.000Z', ...extra });

async function laptop(s, token, { runner = fakeRunner(), fetch = s.fetch, stateDir = tmp(), waitSeconds = 1, log = () => {} } = {}) {
  writeSiteFile(stateDir, { url: SITE, deviceId: 'device-test-0001', runnerId: 1, name: 'Test Laptop' });
  const store = await siteTokenStore({ stateDir, prefer: 'file' });
  await store.set(token);
  const link = createSiteLink({ runner, stateDir, store, fetch, waitSeconds, debounceMs: 20, watchEveryMs: 0, log, version: '0.1.0' });
  return { link: link.start(), runner, stateDir, store };
}

const storedEvents = async (s, runnerId) => (await s.db.query('SELECT type, job, data FROM events WHERE runner_id = $1 ORDER BY id', [runnerId])).rows;

test('on connect the runner says hello and sends its job list; a change sends a status event', async () => {
  const s = await makeSite();
  const { token, runnerId } = await paired(s, 'olive.owner@example.test');
  const l = await laptop(s, token, { runner: fakeRunner([card('add-export'), card('orbit-479-tidy-button', { title: 'Tidy button', lane: 'needs-you', laneReason: 'Needs you: the plan', nowDoing: [] })]) });
  try {
    const ev = await until(async () => { const e = await storedEvents(s, runnerId); return e.length >= 2 && e; }, { what: 'hello and job-list' });
    assert.deepEqual(ev.map((e) => e.type), ['hello', 'job-list']);
    assert.deepEqual(ev[0].data, { name: 'Test Laptop', os: os.platform() === 'darwin' ? 'macOS' : ev[0].data.os, version: '0.1.0', protocol: PROTOCOL_VERSION });
    assert.deepEqual(ev[1].data.jobs.map((j) => [j.slug, j.ticket, j.state, j.now]), [
      ['add-export', null, 'working', 'Builder: Writing the tests'],
      ['orbit-479-tidy-button', 'ORBIT-479', 'needs-you', 'Needs you: the plan'],
    ]);
    l.runner.cards[0] = card('add-export', { stage: 'test', nowDoing: [{ name: 'Tester', doing: 'Running the unit tests' }] });
    l.runner.changed();
    const st = await until(async () => (await storedEvents(s, runnerId)).find((e) => e.type === 'status'), { what: 'a status event' });
    assert.equal(st.job, 'add-export');
    assert.equal(st.data.now, 'Tester: Running the unit tests');
    // A job that leaves (marked done) sends a fresh list.
    l.runner.cards = [l.runner.cards[1]];
    l.runner.changed();
    await until(async () => (await storedEvents(s, runnerId)).filter((e) => e.type === 'job-list').length === 2, { what: 'a second job list' });
  } finally { l.link.stop(); await s.close(); }
});

test('the long-poll: a command queued while the runner waits arrives at once', async () => {
  const s = await makeSite();
  const { token, runnerId } = await paired(s, 'olive.owner@example.test');
  try {
    const t0 = Date.now();
    const poll = s.fetch(`${SITE}/api/runner/commands?wait=25`, { headers: { authorization: `Bearer ${token}` } });
    await new Promise((r) => setTimeout(r, 150));
    const id = await s.site.ctx.queueCommand(runnerId, { type: 'pause', runId: 'run-1' });
    const body = await (await poll).json();
    assert.deepEqual(body.commands, [{ id, command: { type: 'pause', runId: 'run-1' } }]);
    assert.ok(Date.now() - t0 < 1500, `answered in ${Date.now() - t0} ms, not after the wait`);
  } finally { await s.close(); }
});

test('the long-poll: with nothing queued the answer is empty at 25 seconds, and never waits longer', async () => {
  let fake = 0;
  const s = await makeSite({ timers: { now: () => fake, sleep: async (ms) => { fake += ms; } } });
  const { token } = await paired(s, 'olive.owner@example.test');
  try {
    const ask = async (q) => { const start = fake; const b = await (await s.fetch(`${SITE}/api/runner/commands${q}`, { headers: { authorization: `Bearer ${token}` } })).json(); return { b, waited: fake - start }; };
    assert.deepEqual(await ask('?wait=25'), { b: { commands: [] }, waited: 25000 });
    assert.deepEqual(await ask('?wait=600'), { b: { commands: [] }, waited: 25000 });
    assert.deepEqual(await ask(''), { b: { commands: [] }, waited: 25000 });
    assert.deepEqual(await ask('?wait=0'), { b: { commands: [] }, waited: 0 });
    // Only a paired runner may wait.
    assert.equal((await s.fetch(`${SITE}/api/runner/commands?wait=0`)).status, 401);
  } finally { await s.close(); }
});

test('only REMOTE_COMMANDS reach a runner: the site refuses anything else, and so does the runner', async () => {
  const s = await makeSite();
  const { token, runnerId } = await paired(s, 'olive.owner@example.test');
  try {
    await assert.rejects(s.site.ctx.queueCommand(runnerId, { type: 'steer', runId: 'r1', text: 'x' }), /can only be done on this computer/);
    await assert.rejects(s.site.ctx.queueCommand(runnerId, { type: 'shell', cmd: 'rm -rf /' }), /There is no command called “shell”/);
    await assert.rejects(s.site.ctx.queueCommand(runnerId, { type: 'pause', runId: 'r1', path: '/etc' }), /doesn’t take “path”/);
    // One written around queueCommand is never handed out.
    await s.db.query("INSERT INTO commands (id, runner_id, command, created_at) VALUES ('c_writtenaround01', $1, $2, now())", [runnerId, JSON.stringify({ type: 'shell', cmd: 'ls' })]);
    const got = await (await s.fetch(`${SITE}/api/runner/commands?wait=0`, { headers: { authorization: `Bearer ${token}` } })).json();
    assert.deepEqual(got.commands, []);
    assert.match((await s.db.query("SELECT error FROM commands WHERE id = 'c_writtenaround01'")).rows[0].error, /Not sent/);
  } finally { await s.close(); }
  // The runner checks too: a site that sent one anyway gets a refusal, and nothing runs.
  const results = [];
  let served = false;
  const pretendSite = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/api/runner/commands') {
      const commands = served ? [] : [{ id: 'c_fromabadsite01', command: { type: 'steer', runId: 'run-1', text: 'do it' } }];
      served = true;
      return Response.json({ commands });
    }
    if (u.pathname.endsWith('/result')) { results.push(JSON.parse(init.body)); return Response.json({ ok: true }); }
    return Response.json({ accepted: 0, refused: [] });
  };
  const runner = fakeRunner();
  const stateDir = tmp();
  writeSiteFile(stateDir, { url: SITE, deviceId: 'device-test-0002', name: 'L' });
  const store = await siteTokenStore({ stateDir, prefer: 'file' });
  await store.set('a-token-for-a-pretend-site-000000000');
  const link = createSiteLink({ runner, stateDir, store, fetch: pretendSite, waitSeconds: 0, watchEveryMs: 0, log: () => {} }).start();
  try {
    await until(() => results.length === 1, { what: 'the refusal' });
    assert.equal(results[0].ok, false);
    assert.match(results[0].error, /can only be done on this computer/);
    assert.deepEqual(runner.handled, []);
  } finally { link.stop(); }
});

test('at least once, never twice: a command whose answer was lost is handed out again, and answered without running again', async () => {
  const s = await makeSite();
  const { token, runnerId } = await paired(s, 'olive.owner@example.test');
  let dropAnswers = 1;
  const flaky = async (url, init) => {
    if (String(url).endsWith('/result') && dropAnswers > 0) { dropAnswers--; throw new Error('the connection dropped'); }
    return s.fetch(url, init);
  };
  const l = await laptop(s, token, { fetch: flaky });
  try {
    const id = await s.site.ctx.queueCommand(runnerId, { type: 'take-over', slug: 'add-export' });
    await until(() => l.runner.handled.length === 1, { what: 'the command to run' });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await s.db.query('SELECT done_at FROM commands WHERE id = $1', [id])).rows[0].done_at, null, 'the answer never arrived');
    s.clock.t += 31 * 1000; // past the 30-second lease: handed out again
    await until(async () => (await s.db.query('SELECT done_at FROM commands WHERE id = $1', [id])).rows[0].done_at, { what: 'the answer' });
    const row = (await s.db.query('SELECT deliveries, ok FROM commands WHERE id = $1', [id])).rows[0];
    assert.equal(row.deliveries, 2);
    assert.equal(row.ok, true);
    assert.equal(l.runner.handled.length, 1, 'run once');
    // The ids done survive a restart of the runner.
    l.link.stop();
    await s.db.query('UPDATE commands SET done_at = NULL, delivered_at = NULL WHERE id = $1', [id]);
    const again = await laptop(s, token, { runner: l.runner, stateDir: l.stateDir });
    try {
      await until(async () => (await s.db.query('SELECT done_at FROM commands WHERE id = $1', [id])).rows[0].done_at, { what: 'the answer after a restart' });
      assert.equal(l.runner.handled.length, 1, 'still run once');
    } finally { again.link.stop(); }
  } finally { l.link.stop(); await s.close(); }
});

test('offline: events wait on disk, survive a restart, and all reach the site once it is back', async () => {
  const s = await makeSite();
  const { token, runnerId } = await paired(s, 'olive.owner@example.test');
  const offline = async () => { throw new Error('no network'); };
  const runner = fakeRunner([card('add-export')]);
  const first = await laptop(s, token, { runner, fetch: offline });
  try {
    await until(() => first.link.queued() === 2, { what: 'hello and job-list to wait on disk' });
    runner.cards[0] = card('add-export', { stage: 'review' });
    runner.changed();
    await until(() => first.link.queued() === 3, { what: 'the status event to wait too' });
    assert.equal(first.link.state, 'offline');
  } finally { first.link.stop(); }
  assert.equal(fs.readFileSync(path.join(first.stateDir, QUEUE_FILE), 'utf8').trim().split('\n').length, 3, 'on disk');
  assert.equal((await storedEvents(s, runnerId)).length, 0);
  // The laptop restarts with the network back: what waited goes first, then the new hello and list.
  const second = await laptop(s, token, { runner, stateDir: first.stateDir });
  try {
    await until(async () => (await storedEvents(s, runnerId)).length === 5, { what: 'every event' });
    assert.deepEqual((await storedEvents(s, runnerId)).map((e) => e.type), ['hello', 'job-list', 'status', 'hello', 'job-list']);
    await until(() => second.link.queued() === 0, { what: 'the queue to empty' });
    assert.equal(fs.existsSync(path.join(first.stateDir, QUEUE_FILE)), false);
  } finally { second.link.stop(); await s.close(); }
});

test('a batch is at most 256 KB: a long queue goes in several', async () => {
  const s = await makeSite();
  const { token, runnerId } = await paired(s, 'olive.owner@example.test');
  const sizes = [];
  const counting = async (url, init) => { if (String(url).endsWith('/api/runner/events')) sizes.push(Buffer.byteLength(init.body)); return s.fetch(url, init); };
  const stateDir = tmp();
  const q = eventQueue(path.join(stateDir, QUEUE_FILE));
  const filler = 'x'.repeat(3000);
  for (let i = 0; i < 300; i++) await q.add({ eid: `fill-${i}`, v: PROTOCOL_VERSION, type: 'status', job: `job-${i % 7}`, data: { slug: `job-${i % 7}`, note: filler } });
  const l = await laptop(s, token, { stateDir, fetch: counting });
  try {
    await until(async () => (await s.db.query('SELECT count(*)::int AS n FROM events WHERE runner_id = $1', [runnerId])).rows[0].n === 302, { what: 'all 302 events' });
    assert.ok(sizes.length >= 4, `${sizes.length} batches`);
    assert.ok(sizes.every((b) => b <= 256 * 1024), `every batch at most 256 KB: ${Math.max(...sizes)}`);
    // The site refuses a body over 256 KB outright.
    const big = JSON.stringify({ events: [{ eid: 'big-1', v: PROTOCOL_VERSION, type: 'status', job: null, data: { note: 'x'.repeat(300 * 1024) } }] });
    assert.equal((await s.fetch(`${SITE}/api/runner/events`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: big })).status, 413);
  } finally { l.link.stop(); await s.close(); }
});

test('the scrubber on stored events: the site checks every event again, refuses what fails, and stores a repeat once', async () => {
  const s = await makeSite();
  const { token, runnerId } = await paired(s, 'olive.owner@example.test');
  try {
    const post = async (events) => (await s.fetch(`${SITE}/api/runner/events`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ events }) })).json();
    const r = await post([
      { eid: 'ok-1', v: PROTOCOL_VERSION, type: 'status', job: 'add-export', data: { slug: 'add-export', stage: 'build' } },
      { eid: 'diff-1', v: PROTOCOL_VERSION, type: 'status', job: 'add-export', data: { slug: 'add-export', diff: '+secret' } },
      { eid: 'env-1', v: PROTOCOL_VERSION, type: 'job-list', job: null, data: { jobs: [{ slug: 'a', env: { KEY: 'v' } }] } },
      { eid: 'tok-1', v: PROTOCOL_VERSION, type: 'status', job: 'add-export', data: { slug: 'add-export', now: `here: orbfb_${'z'.repeat(43)}` } },
      { eid: 'odd-1', v: PROTOCOL_VERSION, type: 'shell-output', job: null, data: { text: 'ls' } },
    ]);
    assert.equal(r.accepted, 1);
    assert.deepEqual(r.refused.map((x) => x.eid), ['diff-1', 'env-1', 'tok-1', 'odd-1']);
    assert.match(r.refused[2].error, /looks like a token/);
    const again = await post([{ eid: 'ok-1', v: PROTOCOL_VERSION, type: 'status', job: 'add-export', data: { slug: 'add-export', stage: 'build' } }]);
    assert.equal(again.accepted, 1);
    const rows = (await s.db.query('SELECT eid FROM events WHERE runner_id = $1', [runnerId])).rows;
    assert.deepEqual(rows.map((x) => x.eid), ['ok-1'], 'stored once; nothing refused is stored');
    const all = JSON.stringify((await s.db.query('SELECT data FROM events')).rows);
    assert.ok(!all.includes('orbfb_') && !all.includes('+secret'));
  } finally { await s.close(); }
});

test('the heartbeat: a laptop waiting for commands shows online; one removed is told it isn’t paired, and its link stops', async () => {
  const s = await makeSite();
  const { person, token } = await paired(s, 'olive.owner@example.test');
  const lines = [];
  const l = await laptop(s, token, { log: (x) => lines.push(x) });
  try {
    await until(() => l.link.state === 'connected', { what: 'connected' });
    const laptops = (await person.json('/api/laptops')).body.laptops;
    assert.equal(laptops[0].online, true);
    assert.equal(laptops[0].version, '0.1.0', 'from its hello');
    assert.equal((await person.send('DELETE', `/api/laptops/${laptops[0].id}`, {})).status, 200);
    await until(() => l.link.state === 'unpaired', { what: 'the link to stop' });
    assert.ok(lines.some((x) => /no longer knows this laptop\. Run ground-control login/.test(x)));
  } finally { l.link.stop(); await s.close(); }
});
