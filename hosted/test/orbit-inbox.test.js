// Packet 2C: the Orbit inbox on the site. A pretend Orbit (test/fake-orbit.js) and made-up people
// and tokens only. Covered: the token's encryption (a round trip, a wrong key, another person's
// row), Settings → Orbit (one check call, a refused token kept nowhere, Remove), the cron job
// (refused without its secret; everyone in turn; paging; only what changed; an hour's full read;
// one person's failure kept to them; expiry and a refused token; Retry-After; the time box),
// the open Inbox's refresh at most once a minute, Start (one laptop online, offline, two laptops,
// already on it, cancel) through the real link to a pretend runner, and, at the end of each test,
// no token in any stored row, response or log line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrub } from '../../dashboard/lib/orbit.js';
import { readConfig } from '../site/config.js';
import { openPglite } from '../site/db.js';
import { migrate } from '../site/migrate.js';
import { createSite } from '../site/router.js';
import { readTokenKey, seal, unseal, TokenKeyError } from '../lib/token-store.js';
import { FULL_EVERY_MS, REFRESH_MS } from '../lib/poller.js';
import { browser, inProcessFetch, signIn, SITE, TEST_ENV } from './helpers.js';
import { card, fakeRunner, laptop, paired, until } from './laptops.js';
import { FAKE_ORBIT, fakeOrbit, testToken, ticket } from './fake-orbit.js';

// Made-up 32-byte keys, in base64 as TOKEN_KEY holds one.
const KEY_A = Buffer.alloc(32, 7).toString('base64');
const KEY_B = Buffer.alloc(32, 9).toString('base64');
const ORBIT_ENV = { TOKEN_KEY: KEY_A, ORBIT_BASE_URL: FAKE_ORBIT };
const CRON = { authorization: `Bearer ${TEST_ENV.CRON_SECRET}` };
const OLIVE = 'olive.owner@example.test';
const SAM = 'sam.sample@example.test';

/**
 * A site on a fresh database with the pretend Orbit behind its fetch. Every answer the site gives
 * and every line it logs is kept, so each test can end with noTokenAnywhere().
 */
async function makeOrbitSite({ env = {}, clock = { t: Date.parse('2026-10-30T16:00:00Z') }, db = null } = {}) {
  db ??= await openPglite();
  await migrate(db);
  const orbit = fakeOrbit();
  const config = readConfig({ ...TEST_ENV, ...ORBIT_ENV, ...env });
  const answers = [];
  const logs = [];
  let site = null;
  const inner = inProcessFetch(() => site, { fallback: orbit.fetch });
  const fetch = async (input, init) => {
    const res = await inner(input, init);
    if (String(input).startsWith(SITE)) answers.push(`${res.status} ${[...res.headers].map((h) => h.join(': ')).join('\n')}\n${await res.clone().text()}`);
    return res;
  };
  site = createSite({ db, config, fetch, now: () => clock.t });
  site.ctx.log = (line) => logs.push(line);
  const cron = async () => (await fetch(`${SITE}/api/cron/inbox`, { headers: CRON })).status;
  return {
    site, db, config, clock, fetch, orbit, answers, logs, cron,
    async close() { await site.close(); await db.close(); },
  };
}

/** Every row of every table, as text. */
async function everyRow(db) {
  const { rows: tables } = await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  const out = [];
  for (const { tablename } of tables) out.push(JSON.stringify((await db.query(`SELECT * FROM "${tablename}"`)).rows));
  return out.join('\n');
}

/** No token in a stored row, an answer or a log line: neither by its value nor by its shape. */
async function noTokenAnywhere(s, tokens) {
  const places = { rows: await everyRow(s.db), answers: s.answers.join('\n'), logs: s.logs.join('\n') };
  for (const [where, text] of Object.entries(places)) {
    assert.ok(!text.includes('orbfb_'), `no orbfb_ in the ${where}`);
    for (const t of tokens) assert.ok(!text.includes(t.slice(6)), `no piece of the token in the ${where}`);
    assert.equal(scrub(text), text, `the scrubber finds nothing in the ${where}`);
  }
}

const saveToken = (b, token, days = 30) => b.send('POST', '/api/orbit/token', { token, expiresInDays: days });

/** Captures console output while fn runs (the router's own console.error, for one). */
async function withConsole(fn) {
  const lines = [];
  const was = { log: console.log, error: console.error, warn: console.warn };
  for (const k of Object.keys(was)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try { await fn(); } finally { Object.assign(console, was); }
  return lines;
}

// ---------- The token store ----------

test('the token is sealed with AES-256-GCM: a round trip, a fresh IV each time, a key id that isn’t the key', () => {
  const key = readTokenKey(KEY_A);
  const token = testToken('roundtrip');
  const a = seal(token, key, 1);
  const b = seal(token, key, 1);
  assert.notEqual(a, b, 'a fresh IV each time');
  assert.match(a, /^v1\.k[0-9a-f]{12}\.[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.ok(!a.includes(token) && !a.includes('orbfb_'));
  assert.ok(!a.includes(KEY_A) && !key.id.includes(KEY_A.slice(0, 8)));
  assert.equal(unseal(a, key, 1), token);
  assert.equal(readTokenKey(KEY_A).id, key.id, 'the same key, the same id');
  assert.notEqual(readTokenKey(KEY_B).id, key.id);
});

test('a wrong key, another person’s row or a changed byte doesn’t open; a bad TOKEN_KEY says what is wrong without its value', () => {
  const key = readTokenKey(KEY_A);
  const sealed = seal(testToken('wrongkey'), key, 1);
  assert.throws(() => unseal(sealed, readTokenKey(KEY_B), 1), TokenKeyError);
  // The same key id but different bytes (a key replaced under the same name) is refused too.
  assert.throws(() => unseal(sealed, { id: key.id, key: Buffer.alloc(32, 9) }, 1), /can’t be read with the site’s key/);
  assert.throws(() => unseal(sealed, key, 2), TokenKeyError, 'sealed for person 1, not person 2');
  const parts = sealed.split('.');
  parts[3] = Buffer.from(Buffer.from(parts[3], 'base64url').map((x, i) => (i === 0 ? x ^ 1 : x))).toString('base64url');
  assert.throws(() => unseal(parts.join('.'), key, 1), TokenKeyError);
  assert.throws(() => readTokenKey(''), /TOKEN_KEY isn’t set/);
  const short = Buffer.alloc(16, 1).toString('base64');
  assert.throws(() => readTokenKey(short), (err) => /isn’t 32 bytes/.test(err.message) && !err.message.includes(short));
  assert.throws(() => readTokenKey('not base64 at all!'), /isn’t 32 bytes/);
});

// ---------- Settings → Orbit ----------

test('Settings → Orbit: one call checks the token, it is kept sealed, the answer says only “saved” and until when; Remove forgets it', async () => {
  const s = await makeOrbitSite();
  const olive = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  const token = testToken('olive');
  s.orbit.person(token, { assigned: [ticket(12)] });
  try {
    const empty = (await olive.json('/api/orbit/status')).body;
    assert.equal(empty.tokenPresent, false);
    assert.deepEqual(empty.setup, []);

    // Wrong shape: refused here, Orbit never asked.
    const bad = await saveToken(olive, 'orbfb_short');
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /wrong length/);
    assert.equal(s.orbit.requests.length, 0);
    // Orbit refuses it: nothing kept.
    const refused = await saveToken(olive, testToken('revoked'));
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /Orbit didn’t take that token/);
    assert.equal((await s.db.query('SELECT count(*)::int AS n FROM orbit_tokens')).rows[0].n, 0);

    s.orbit.requests.length = 0;
    const saved = await saveToken(olive, token, 30);
    assert.equal(saved.status, 200);
    assert.equal(s.orbit.requests.length, 1, 'checked with one call');
    assert.equal(s.orbit.requests[0].path, '/api/feedback/v1/tickets');
    assert.equal(s.orbit.requests[0].query.page, '1');
    assert.equal(saved.body.tokenPresent, true);
    assert.equal(saved.body.store, 'site');
    assert.equal(saved.body.expiresAt, '2026-11-29T16:00:00.000Z');
    assert.equal(saved.body.expired, false);
    assert.ok(!('token' in saved.body) && !('sealed' in saved.body));
    const row = (await s.db.query('SELECT * FROM orbit_tokens')).rows[0];
    assert.match(row.sealed, /^v1\./);
    assert.equal(row.key_id, readTokenKey(KEY_A).id);

    // A change must come from the site's own page.
    const cross = await olive.send('POST', '/api/orbit/token', { token }, { headers: { origin: 'https://elsewhere.example' } });
    assert.equal(cross.status, 403);
    // Signed out: nothing.
    assert.equal((await browser(s.fetch).json('/api/orbit/status')).status, 401);

    const gone = await olive.send('DELETE', '/api/orbit/token', {});
    assert.equal(gone.status, 200);
    assert.equal(gone.body.tokenPresent, false);
    assert.equal((await s.db.query('SELECT count(*)::int AS n FROM orbit_tokens')).rows[0].n, 0);
    await noTokenAnywhere(s, [token, testToken('revoked')]);
  } finally { await s.close(); }
});

test('without TOKEN_KEY or ORBIT_BASE_URL, Settings → Orbit names what is missing and keeps nothing', async () => {
  const s = await makeOrbitSite({ env: { TOKEN_KEY: '', ORBIT_BASE_URL: '' } });
  const olive = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  try {
    assert.deepEqual((await olive.json('/api/orbit/status')).body.setup, ['TOKEN_KEY', 'ORBIT_BASE_URL']);
    const r = await saveToken(olive, testToken('nokey'));
    assert.equal(r.status, 503);
    assert.match(r.body.error, /TOKEN_KEY isn’t set in Vercel/);
    assert.equal(await s.cron(), 204, 'the cron job answers, and reads nothing');
    assert.equal(s.orbit.requests.length, 0);
    assert.match(s.logs.join('\n'), /not read: TOKEN_KEY isn’t set/);
  } finally { await s.close(); }
});

// ---------- The poller ----------

test('the cron job: refused without CRON_SECRET; with it, everyone’s inbox in turn, every page, assigned and watched', async () => {
  const s = await makeOrbitSite();
  const olive = browser(s.fetch);
  const sam = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  await signIn(sam, { email: SAM });
  const tOlive = testToken('olive');
  const tSam = testToken('sam');
  // 120 assigned: three pages of 50. Two watched, one of them also assigned.
  s.orbit.person(tOlive, { assigned: Array.from({ length: 120 }, (_, i) => ticket(1000 + i)), watching: [ticket(1000), ticket(77, { subject: 'Watched only' })] });
  s.orbit.person(tSam, { assigned: [ticket(5, { severity: 'critical' })] });
  try {
    await saveToken(olive, tOlive);
    await saveToken(sam, tSam);
    s.orbit.requests.length = 0;
    assert.equal((await s.fetch(`${SITE}/api/cron/inbox`)).status, 401);
    assert.equal((await s.fetch(`${SITE}/api/cron/inbox`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    assert.equal(s.orbit.requests.length, 0, 'nothing read without the secret');

    assert.equal(await s.cron(), 204);
    const pages = s.orbit.by(tOlive).filter((r) => r.query.assignee === 'me').map((r) => r.query.page);
    assert.deepEqual(pages, ['1', '2', '3']);
    assert.ok(s.orbit.by(tOlive).every((r) => !r.query.datefield), 'the first read is a full one');
    const inbox = (await olive.json('/api/orbit/inbox')).body;
    assert.equal(inbox.items.length, 121);
    assert.deepEqual(inbox.items.find((i) => i.key === 'ORBIT-1000').why, ['assigned', 'watching']);
    assert.deepEqual(inbox.items.find((i) => i.key === 'ORBIT-77').why, ['watching']);
    const one = inbox.items.find((i) => i.key === 'ORBIT-1000');
    assert.equal(one.title, 'Sample ticket 1000');
    assert.equal(one.url, `${FAKE_ORBIT}/admin/feedback/ORBIT-1000`);
    assert.equal(one.description, 'What ticket 1000 is about, in a sentence.');
    assert.equal(one.assignee.you, true);
    assert.equal(inbox.lastPoll, '2026-10-30T16:00:00.000Z');
    // Each sees only their own.
    const samInbox = (await sam.json('/api/orbit/inbox')).body;
    assert.deepEqual(samInbox.items.map((i) => i.key), ['ORBIT-5']);
    assert.match(s.logs.at(-1), /^inbox: read 2, failed 0, skipped 0, left for the next run 0/);
    await noTokenAnywhere(s, [tOlive, tSam]);
  } finally { await s.close(); }
});

test('between full reads only what changed is fetched (datefield=updated&from=<day>, then to the minute); a full read each hour drops what left', async () => {
  const s = await makeOrbitSite();
  const olive = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  const token = testToken('olive');
  const who = s.orbit.person(token, { assigned: [ticket(1), ticket(2)] });
  try {
    await saveToken(olive, token);
    await s.cron();
    // Three minutes on: ticket 2 changes, ticket 3 comes; ticket 1 was resolved (it leaves the list).
    s.clock.t += 3 * 60_000;
    who.assigned = [ticket(2, { subject: 'Renamed', activityAt: new Date(s.clock.t - 30_000).toISOString() }), ticket(3, { activityAt: new Date(s.clock.t - 60_000).toISOString() }),
      ticket(4, { activityAt: '2026-10-30T15:59:30.000Z' })]; // changed yesterday's day but before the last read's minute: left out
    s.orbit.requests.length = 0;
    await s.cron();
    const asked = s.orbit.by(token);
    assert.ok(asked.length >= 2);
    for (const r of asked) {
      assert.equal(r.query.datefield, 'updated');
      assert.equal(r.query.from, '2026-10-29', 'the day before the last read');
    }
    let keys = (await olive.json('/api/orbit/inbox')).body.items.map((i) => [i.key, i.title]);
    assert.deepEqual(keys, [['ORBIT-1', 'Sample ticket 1'], ['ORBIT-2', 'Renamed'], ['ORBIT-3', 'Sample ticket 3']], 'only what changed since the last read, to the minute; ticket 1 stays until the full read');
    // An hour after the last full read: everything again, and ticket 1 is gone.
    s.clock.t += FULL_EVERY_MS;
    s.orbit.requests.length = 0;
    await s.cron();
    assert.ok(s.orbit.by(token).every((r) => !r.query.datefield));
    keys = (await olive.json('/api/orbit/inbox')).body.items.map((i) => i.key);
    assert.deepEqual(keys, ['ORBIT-2', 'ORBIT-3', 'ORBIT-4']);
    await noTokenAnywhere(s, [token]);
  } finally { await s.close(); }
});

test('one person’s failure stays theirs: an error, a refused token (the banner, and no more tries), Retry-After; the others are read', async () => {
  const s = await makeOrbitSite();
  const people = [['olive', OLIVE], ['sam', SAM], ['pat', 'pat.person@example.test'], ['lee', 'lee.lane@example.test']];
  const b = {};
  for (const [name, email] of people) {
    b[name] = browser(s.fetch);
    await signIn(b[name], { email });
    s.orbit.person(testToken(name), { assigned: [ticket(name.length * 100)] });
    assert.equal((await saveToken(b[name], testToken(name))).status, 200);
  }
  try {
    s.orbit.fail(testToken('sam'), { status: 500 });
    s.orbit.fail(testToken('pat'), { status: 401 });
    s.orbit.fail(testToken('lee'), { status: 429, headers: { 'retry-after': '600' } });
    await s.cron();
    assert.equal((await b.olive.json('/api/orbit/inbox')).body.items.length, 1, 'Olive is read');
    const sam = (await b.sam.json('/api/orbit/inbox')).body;
    assert.equal(sam.expired, false);
    assert.match(sam.lastError, /Orbit answered 500/);
    const pat = (await b.pat.json('/api/orbit/inbox')).body;
    assert.equal(pat.expired, true, 'the banner');
    assert.equal(pat.refused, true);
    assert.equal(pat.lastError, null, 'said once, by the banner');
    const lee = (await b.lee.json('/api/orbit/inbox')).body;
    assert.equal(lee.waitingMs, 600_000);
    assert.match(s.logs.at(-1), /read 1, failed 3/);

    // The next run: Pat (refused) and Lee (waiting) aren't asked; Sam is again, and is fine now.
    s.orbit.fail(testToken('sam'), null);
    s.clock.t += 3 * 60_000;
    s.orbit.requests.length = 0;
    await s.cron();
    assert.equal(s.orbit.by(testToken('pat')).length, 0);
    assert.equal(s.orbit.by(testToken('lee')).length, 0);
    assert.equal((await b.sam.json('/api/orbit/inbox')).body.lastError, null);
    // A new token for Pat: read again.
    s.orbit.fail(testToken('pat'), null);
    await saveToken(b.pat, testToken('pat'));
    assert.equal((await b.pat.json('/api/orbit/inbox')).body.expired, false);
    await noTokenAnywhere(s, people.map(([n]) => testToken(n)));
  } finally { await s.close(); }
});

test('expiry: past the date the person gave, the token isn’t used and the Inbox says so', async () => {
  const s = await makeOrbitSite();
  const olive = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  const token = testToken('olive');
  s.orbit.person(token, { assigned: [ticket(9)] });
  try {
    await saveToken(olive, token, 7);
    await s.cron();
    s.clock.t += 8 * 86_400_000;
    s.orbit.requests.length = 0;
    await s.cron();
    const r = (await olive.json('/api/orbit/inbox?refresh=1')).body;
    assert.equal(s.orbit.requests.length, 0, 'an expired token isn’t sent');
    assert.equal(r.expired, true);
    assert.equal(r.refused, false);
    assert.deepEqual(r.items.map((i) => i.key), ['ORBIT-9'], 'the list as it was stays');
  } finally { await s.close(); }
});

test('a token the site’s key can’t open any more (TOKEN_KEY changed) shows the banner, and the others still read', async () => {
  const db = await openPglite();
  const first = await makeOrbitSite({ db });
  const olive = browser(first.fetch);
  await signIn(olive, { email: OLIVE });
  first.orbit.person(testToken('olive'), {});
  await saveToken(olive, testToken('olive'));
  await first.site.close();
  const s = await makeOrbitSite({ db, env: { TOKEN_KEY: KEY_B } });
  try {
    const again = browser(s.fetch);
    await signIn(again, { email: OLIVE });
    s.orbit.person(testToken('olive'), {});
    await s.cron();
    assert.equal(s.orbit.requests.length, 0);
    const st = (await again.json('/api/orbit/status')).body;
    assert.equal(st.expired, true);
    assert.equal(st.refused, true);
  } finally { await s.close(); }
});

test('the time box: a slow Orbit is cut off at the run’s deadline, and whoever is left goes first next time', async () => {
  const s = await makeOrbitSite();
  const names = ['olive', 'sam', 'pat'];
  const b = {};
  for (const [i, name] of names.entries()) {
    b[name] = browser(s.fetch);
    await signIn(b[name], { email: `${name}.person${i}@example.test` });
    s.orbit.person(testToken(name), { assigned: [ticket(i + 1)] });
    await saveToken(b[name], testToken(name));
  }
  try {
    s.orbit.fail(testToken('olive'), { slowMs: 60_000 });
    const began = Date.now();
    const out = await s.site.ctx.orbitInbox.poller.runCron({ budgetMs: 5_400 });
    assert.ok(Date.now() - began < 7_000, 'inside the box');
    assert.equal(out.failed, 1);
    assert.equal(out.left, 2, 'nobody else started with too little time left');
    assert.match((await b.olive.json('/api/orbit/status')).body.lastError, /slow to answer/);
    // The next run: the two left are first in turn.
    s.orbit.fail(testToken('olive'), null);
    s.clock.t += 3 * 60_000;
    s.orbit.requests.length = 0;
    await s.cron();
    assert.deepEqual([...new Set(s.orbit.requests.map((r) => r.token))].slice(0, 2).sort(), [testToken('pat'), testToken('sam')].sort());
  } finally { await s.close(); }
});

test('the open Inbox asks for a refresh: read from Orbit at most once a minute, and the cron job doesn’t read it again straight after', async () => {
  const s = await makeOrbitSite();
  const olive = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  const token = testToken('olive');
  const who = s.orbit.person(token, { assigned: [ticket(1)] });
  try {
    await saveToken(olive, token);
    s.orbit.requests.length = 0;
    assert.equal((await olive.json('/api/orbit/inbox?refresh=1')).body.items.length, 1);
    const once = s.orbit.requests.length;
    assert.ok(once >= 2, 'assigned and watched');
    who.assigned = [ticket(1), ticket(2, { activityAt: new Date(s.clock.t).toISOString() })];
    s.clock.t += 30_000;
    assert.equal((await olive.json('/api/orbit/inbox?refresh=1')).body.items.length, 1, 'half a minute on: the stored list');
    await s.cron();
    assert.equal(s.orbit.requests.length, once, 'nor the cron job');
    s.clock.t += REFRESH_MS;
    assert.equal((await olive.json('/api/orbit/inbox?refresh=1')).body.items.length, 2, 'a minute on: read again');
    // A plain GET never asks Orbit.
    s.orbit.requests.length = 0;
    s.clock.t += REFRESH_MS;
    await olive.json('/api/orbit/inbox');
    assert.equal(s.orbit.requests.length, 0);
    await noTokenAnywhere(s, [token]);
  } finally { await s.close(); }
});

test('two cron runs at the same moment read each inbox once (Vercel may deliver one run twice)', async () => {
  const s = await makeOrbitSite();
  const olive = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  const token = testToken('olive');
  s.orbit.person(token, { assigned: [ticket(1)] });
  try {
    await saveToken(olive, token);
    s.orbit.requests.length = 0;
    await Promise.all([s.cron(), s.cron()]);
    assert.equal(s.orbit.by(token).filter((r) => r.query.assignee === 'me').length, 1);
  } finally { await s.close(); }
});

// ---------- Start ----------

test('Start: one laptop online queues a start command that reaches it; the job on the mirror then says “you’re already on this”', async () => {
  const s = await makeOrbitSite();
  const olive = await paired(s, OLIVE, 'Olive’s Mac');
  const token = testToken('olive');
  s.orbit.person(token, { assigned: [ticket(12, { subject: 'Tidy the export button', type: 'bug' }), ticket(13)] });
  const runner = fakeRunner([]);
  const lap = await laptop(s, olive.token, { runner });
  try {
    await saveToken(olive.person, token);
    await s.cron();
    await until(async () => (await olive.person.json('/api/laptops')).body.laptops[0]?.online, { what: 'the laptop to call in' });
    // Not in my inbox: refused.
    assert.equal((await olive.person.send('POST', '/api/orbit/start', { key: 'ORBIT-999' })).status, 404);
    const r = await olive.person.send('POST', '/api/orbit/start', { key: 'orbit-12' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(['sending', 'started'].includes(r.body.start.state));
    assert.equal(r.body.start.laptop.name, 'Olive’s Mac');
    await until(() => runner.handled.length === 1, { what: 'the laptop to get the start command' });
    assert.deepEqual(runner.handled[0], { type: 'start', description: 'ORBIT-12: Tidy the export button', ticket: { key: 'ORBIT-12', title: 'Tidy the export button', url: `${FAKE_ORBIT}/admin/feedback/ORBIT-12` }, kind: 'bug' });
    await until(async () => (await olive.person.json('/api/orbit/inbox')).body.items.find((i) => i.key === 'ORBIT-12').start?.state === 'started', { what: 'the start to be answered' });
    // The job reaches the mirror: the row says you're on it, and Start is refused.
    runner.cards = [card('orbit-12-tidy-the-export-button', { title: 'ORBIT-12: Tidy the export button' })];
    runner.changed();
    await until(async () => (await olive.person.json('/api/orbit/inbox')).body.items.find((i) => i.key === 'ORBIT-12').job, { what: 'the job on the mirror' });
    const item = (await olive.person.json('/api/orbit/inbox')).body.items.find((i) => i.key === 'ORBIT-12');
    assert.equal(item.job.slug, 'orbit-12-tidy-the-export-button');
    assert.equal(item.start, null);
    const again = await olive.person.send('POST', '/api/orbit/start', { key: 'ORBIT-12' });
    assert.equal(again.status, 409);
    assert.match(again.body.error, /You’re already on this/);
    await noTokenAnywhere(s, [token]);
  } finally { lap.link.stop(); await s.close(); }
});

test('Start with the laptop off: “starts when your laptop is back”, can be cancelled, and a second one waits its turn', async () => {
  const s = await makeOrbitSite();
  const olive = await paired(s, OLIVE, 'Olive’s Mac');
  const token = testToken('olive');
  s.orbit.person(token, { assigned: [ticket(12), ticket(13)] });
  try {
    await saveToken(olive.person, token);
    await s.cron();
    s.clock.t += 2 * 60_000; // the laptop hasn't called in for two minutes: offline
    const r = await olive.person.send('POST', '/api/orbit/start', { key: 'ORBIT-12' });
    assert.equal(r.status, 200);
    assert.equal(r.body.start.state, 'waiting');
    assert.equal(r.body.start.laptop.online, false);
    const dup = await olive.person.send('POST', '/api/orbit/start', { key: 'ORBIT-12' });
    assert.equal(dup.status, 409);
    assert.match(dup.body.error, /already on its way to Olive’s Mac/);
    // Cancel while it waits: gone, and the laptop never gets it.
    const cancelled = await olive.person.send('DELETE', `/api/orbit/start/${r.body.start.id}`, {});
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.items.find((i) => i.key === 'ORBIT-12').start, null);
    assert.equal((await s.db.query('SELECT count(*)::int AS n FROM commands')).rows[0].n, 0);
    // Queued again; the laptop comes back and takes it: now it can't be cancelled.
    const back = await olive.person.send('POST', '/api/orbit/start', { key: 'ORBIT-12' });
    const got = await (await s.fetch(`${SITE}/api/runner/commands?wait=0`, { headers: { authorization: `Bearer ${olive.token}` } })).json();
    assert.equal(got.commands.length, 1);
    assert.equal(got.commands[0].command.type, 'start');
    assert.ok(!JSON.stringify(got.commands).includes('orbfb_'), 'the token never goes to a runner');
    assert.equal((await olive.person.send('DELETE', `/api/orbit/start/${back.body.start.id}`, {})).status, 409);
    // The laptop couldn't: the card says why, and Start can be pressed again.
    const id = got.commands[0].id;
    await s.fetch(`${SITE}/api/runner/commands/${id}/result`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${olive.token}` }, body: JSON.stringify({ ok: false, error: 'This laptop doesn’t know which repository a ticket’s job goes in.' }) });
    const failed = (await olive.person.json('/api/orbit/inbox')).body.items.find((i) => i.key === 'ORBIT-12').start;
    assert.equal(failed.state, 'failed');
    assert.match(failed.error, /which repository/);
    assert.equal((await olive.person.send('POST', '/api/orbit/start', { key: 'ORBIT-12' })).status, 200);
    await noTokenAnywhere(s, [token]);
  } finally { await s.close(); }
});

test('Start with two laptops asks which; with none, says to pair one; another person’s laptop or Start is a 404', async () => {
  const s = await makeOrbitSite();
  const olive = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  const token = testToken('olive');
  s.orbit.person(token, { assigned: [ticket(12)] });
  try {
    await saveToken(olive, token);
    await s.cron();
    const none = await olive.send('POST', '/api/orbit/start', { key: 'ORBIT-12' });
    assert.equal(none.status, 409);
    assert.equal(none.body.code, 'no-laptop');
    const mac = await paired(s, OLIVE, 'Olive’s Mac', { person: olive });
    const spare = await paired(s, OLIVE, 'Olive’s spare laptop', { person: olive });
    const which = await olive.send('POST', '/api/orbit/start', { key: 'ORBIT-12' });
    assert.equal(which.status, 409);
    assert.equal(which.body.code, 'choose-laptop');
    assert.deepEqual(which.body.laptops.map((l) => l.name).sort(), ['Olive’s Mac', 'Olive’s spare laptop']);
    const sam = await paired(s, SAM, 'Sam’s laptop');
    assert.equal((await olive.send('POST', '/api/orbit/start', { key: 'ORBIT-12', laptopId: sam.runnerId })).status, 404);
    const r = await olive.send('POST', '/api/orbit/start', { key: 'ORBIT-12', laptopId: spare.runnerId });
    assert.equal(r.status, 200);
    assert.equal(r.body.start.laptop.name, 'Olive’s spare laptop');
    const cmds = (await s.db.query('SELECT runner_id FROM commands')).rows.map((x) => Number(x.runner_id));
    assert.deepEqual(cmds, [spare.runnerId]);
    assert.notEqual(spare.runnerId, mac.runnerId);
    // Sam can't cancel Olive's Start, nor see her inbox.
    assert.equal((await sam.person.send('DELETE', `/api/orbit/start/${r.body.start.id}`, {})).status, 404);
    assert.deepEqual((await sam.person.json('/api/orbit/inbox')).body.items, []);
    await noTokenAnywhere(s, [token]);
  } finally { await s.close(); }
});

test('a route that fails unexpectedly logs nothing of the token (the router’s own console.error)', async () => {
  const s = await makeOrbitSite();
  const olive = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  const token = testToken('olive');
  s.orbit.person(token, { assigned: [ticket(1)] });
  try {
    await saveToken(olive, token);
    // Break the inbox table under the poller: the cron run fails for Olive with a database error.
    const lines = await withConsole(async () => {
      await s.db.exec('ALTER TABLE orbit_inbox RENAME TO orbit_inbox_away');
      await s.cron();
      await olive.json('/api/orbit/inbox?refresh=1');
      await s.db.exec('ALTER TABLE orbit_inbox_away RENAME TO orbit_inbox');
    });
    const all = [...lines, ...s.logs].join('\n');
    assert.ok(all.length > 0, 'something was logged');
    assert.ok(!all.includes('orbfb_'));
    assert.equal(scrub(all), all);
    await noTokenAnywhere(s, [token]);
  } finally { await s.close(); }
});
