// Packet 2C: the Orbit inbox on the site. A pretend Orbit (test/fake-orbit.js) and made-up people
// and tokens only. Covered: the token's encryption (a round trip, a wrong key, another person's
// row), Settings → Orbit (one check call, a refused token kept nowhere, Remove), the cron job
// (refused without its secret; everyone in turn; paging; every read whole;
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
import { REFRESH_MS } from '../lib/poller.js';
import { browser, inProcessFetch, signIn, SITE, TEST_ENV } from './helpers.js';
import { card, fakeRunner, laptop, paired, until } from './laptops.js';
import { mirrorLaptop, mirrorRunner } from './mirror-laptop.js';
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

test('the cron job: refused without CRON_SECRET; with it, everyone’s inbox in turn, every page, assigned only', async () => {
  const s = await makeOrbitSite();
  const olive = browser(s.fetch);
  const sam = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  await signIn(sam, { email: SAM });
  const tOlive = testToken('olive');
  const tSam = testToken('sam');
  // 120 assigned: three pages of 50.
  s.orbit.person(tOlive, { assigned: Array.from({ length: 120 }, (_, i) => ticket(1000 + i)) });
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
    assert.equal(inbox.items.length, 120);
    assert.deepEqual(inbox.items.find((i) => i.key === 'ORBIT-1000').why, ['assigned']);
    assert.ok(s.orbit.by(tOlive).every((r) => r.query.watched === undefined), 'watched tickets are never asked for');
    assert.deepEqual(inbox.filter, { audience: 'tech', ignored: [], applied: true });
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

test('stored watched-only rows are not shown', async () => {
  const s = await makeOrbitSite();
  const olive = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  const token = testToken('olive');
  s.orbit.person(token, { assigned: [ticket(1)] });
  try {
    await saveToken(olive, token);
    await s.cron();
    const person = (await s.db.query('SELECT person_id FROM orbit_tokens')).rows[0].person_id;
    // A row an older read left behind: a ticket the person only watched.
    const old = { key: 'ORBIT-77', number: 77, title: 'Watched only', why: ['watching'], changedAt: null };
    await s.db.query("INSERT INTO orbit_inbox (person_id, number, ticket_key, item, changed_at, stored_at) VALUES ($1, 77, 'ORBIT-77', $2, NULL, '2026-10-30T16:00:00Z')", [person, JSON.stringify(old)]);
    const keys = (await olive.json('/api/orbit/inbox')).body.items.map((i) => i.key);
    assert.deepEqual(keys, ['ORBIT-1']);
  } finally { await s.close(); }
});

const flagOf = async (s) => (await s.db.query('SELECT assignee_ignored FROM orbit_tokens')).rows[0].assignee_ignored;

test('a token Orbit will not filter for shows no tickets', async () => {
  const s = await makeOrbitSite();
  const olive = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  const token = testToken('olive');
  s.orbit.person(token, { assigned: [ticket(1), ticket(2)], ignored: ['assignee'] });
  try {
    await saveToken(olive, token);
    assert.equal(await flagOf(s), false, 'a new token starts clean');
    await s.cron();
    assert.equal(await flagOf(s), true);
    const inbox = (await olive.json('/api/orbit/inbox')).body;
    assert.equal(inbox.filter.applied, false);
    assert.deepEqual(inbox.filter.ignored, ['assignee']);
    assert.deepEqual(inbox.items, []);
    assert.equal((await s.db.query('SELECT count(*)::int AS n FROM orbit_inbox')).rows[0].n, 0, 'everyone’s tickets are not kept');
    await noTokenAnywhere(s, [token]);
  } finally { await s.close(); }
});

test('the next clean read clears it', async () => {
  const s = await makeOrbitSite();
  const olive = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  const token = testToken('olive');
  const who = s.orbit.person(token, { assigned: [ticket(1), ticket(2)], ignored: ['assignee'] });
  try {
    await saveToken(olive, token);
    await s.cron();
    assert.equal(await flagOf(s), true);
    who.ignored = [];
    s.clock.t += 3 * 60_000;
    s.orbit.requests.length = 0;
    await s.cron();
    assert.ok(s.orbit.by(token).every((r) => !r.query.datefield), 'a full read, not only changes');
    assert.equal(await flagOf(s), false);
    const inbox = (await olive.json('/api/orbit/inbox')).body;
    assert.equal(inbox.filter.applied, true);
    assert.deepEqual(inbox.items.map((i) => i.key), ['ORBIT-1', 'ORBIT-2']);
    await noTokenAnywhere(s, [token]);
  } finally { await s.close(); }
});

test('every read is whole: a re-rank shows at the next read, and a ticket that left is dropped', async () => {
  const s = await makeOrbitSite();
  const olive = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  const token = testToken('olive');
  const who = s.orbit.person(token, { assigned: [ticket(1, { severity: 'high', queuePosition: 1, workOrder: 1 }), ticket(2, { severity: 'high', queuePosition: 2, workOrder: 2 })] });
  try {
    await saveToken(olive, token);
    await s.cron();
    let items = (await olive.json('/api/orbit/inbox')).body.items;
    assert.deepEqual(items.map((i) => [i.key, i.queuePosition]), [['ORBIT-1', 1], ['ORBIT-2', 2]]);
    // Three minutes on: the two swap places with no new activity time, ticket 1 is resolved (leaves), ticket 3 comes.
    s.clock.t += 3 * 60_000;
    const quiet = '2026-10-20T10:00:00.000Z';
    who.assigned = [ticket(2, { severity: 'high', queuePosition: 1, workOrder: 1, activityAt: quiet }), ticket(3, { severity: 'high', queuePosition: 2, workOrder: 2 })];
    s.orbit.requests.length = 0;
    await s.cron();
    const asked = s.orbit.by(token);
    assert.ok(asked.length >= 1);
    for (const r of asked) assert.ok(!r.query.datefield && !r.query.from, 'a whole read');
    items = (await olive.json('/api/orbit/inbox')).body.items;
    assert.deepEqual(items.map((i) => [i.key, i.queuePosition]), [['ORBIT-2', 1], ['ORBIT-3', 2]], 'the new number shows, and ticket 1 is gone');
    // And again, with no hour in between: still a whole read.
    s.clock.t += 3 * 60_000;
    s.orbit.requests.length = 0;
    await s.cron();
    assert.ok(s.orbit.by(token).every((r) => !r.query.datefield && !r.query.from));
    await noTokenAnywhere(s, [token]);
  } finally { await s.close(); }
});

test('the stored item keeps queuePosition, workOrder and size', async () => {
  const s = await makeOrbitSite();
  const olive = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  const token = testToken('olive');
  s.orbit.person(token, { assigned: [ticket(1, { queuePosition: 3, workOrder: 1, storyPoints: 5 }), ticket(2, { queuePosition: null, workOrder: null, storyPoints: null }), ticket(3)] });
  try {
    await saveToken(olive, token);
    await s.cron();
    const by = Object.fromEntries((await olive.json('/api/orbit/inbox')).body.items.map((i) => [i.key, i]));
    assert.deepEqual([by['ORBIT-1'].queuePosition, by['ORBIT-1'].workOrder, by['ORBIT-1'].size, by['ORBIT-1'].queueKnown], [3, 1, 5, true]);
    assert.deepEqual([by['ORBIT-2'].queuePosition, by['ORBIT-2'].workOrder, by['ORBIT-2'].size, by['ORBIT-2'].queueKnown], [null, null, null, true]);
    assert.deepEqual([by['ORBIT-3'].queuePosition, by['ORBIT-3'].queueKnown], [null, false]);
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
    assert.ok(once >= 1);
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
test('the stored item keeps the ticket’s tag names, archived included', async () => {
  const s = await makeOrbitSite();
  const olive = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  const token = testToken('olive');
  s.orbit.person(token, { assigned: [ticket(1, { tags: [{ id: 't1', name: 'auto', color: 'blue', archived: false }, { id: 't2', name: 'Old', color: 'grey', archived: true }] }), ticket(2, { tags: [] }), ticket(3)] });
  try {
    await saveToken(olive, token);
    await s.cron();
    const by = Object.fromEntries((await olive.json('/api/orbit/inbox')).body.items.map((i) => [i.key, i]));
    assert.deepEqual(by['ORBIT-1'].tags, ['auto', 'Old']);
    assert.deepEqual(by['ORBIT-2'].tags, []);
    assert.deepEqual(by['ORBIT-3'].tags, []);
    await noTokenAnywhere(s, [token]);
  } finally { await s.close(); }
});

// ---------- Auto start (the setting only: the laptop's own starter is what starts a job) ----------

test('Auto start from the site: the setting is queued as the auto-start command, checked, and nothing is started', async () => {
  const s = await makeOrbitSite();
  const olive = await paired(s, OLIVE, 'Olive’s Mac');
  const runner = fakeRunner([]);
  const lap = await laptop(s, olive.token, { runner });
  try {
    await until(async () => (await olive.person.json('/api/laptops')).body.laptops[0]?.online, { what: 'the laptop to call in' });
    for (const bad of [{ on: 'yes', tag: 'auto' }, { on: true, tag: 7 }, { on: true, tag: 'x'.repeat(61) }, { tag: 'auto' }, { on: true }]) {
      assert.equal((await olive.person.send('POST', '/api/orbit/auto-start', bad)).status, 400, JSON.stringify(bad));
    }
    const r = await olive.person.send('POST', '/api/orbit/auto-start', { on: true, tag: ' auto ' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // Answered as the site's other laptop commands are: queued for the laptop, never a bare ok that reads as done.
    assert.equal(r.body.queued, true);
    assert.equal(r.body.sent, false);
    assert.equal(r.body.laptop.online, true);
    await until(() => runner.handled.length === 1, { what: 'the laptop to get the command' });
    assert.deepEqual(runner.handled[0], { type: 'auto-start', on: true, tag: ' auto ' });
    assert.ok(runner.handled.every((c) => c.type !== 'start'), 'the site never starts a job');
  } finally { lap.link.stop(); await s.close(); }
});

test('Auto start from the site with the laptop not connected: queued, and the answer says the laptop is not there', async () => {
  const s = await makeOrbitSite();
  const olive = await paired(s, OLIVE, 'Olive’s Mac');
  try {
    const r = await olive.person.send('POST', '/api/orbit/auto-start', { on: true, tag: 'auto' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.queued, true);
    assert.equal(r.body.sent, false);
    assert.equal(r.body.laptop.online, false);
    assert.equal(r.body.laptop.name, 'Olive’s Mac');
  } finally { await s.close(); }
});

test('Auto start from the site with no laptop paired says so', async () => {
  const s = await makeOrbitSite();
  const olive = browser(s.fetch);
  await signIn(olive, { email: OLIVE });
  try {
    const r = await olive.send('POST', '/api/orbit/auto-start', { on: true, tag: 'auto' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'no-laptop');
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

const SENT_REPOS = { defaultPath: '/Users/olive/Projects/orbit', repos: [{ name: 'orbit', path: '/Users/olive/Projects/orbit', ok: true }, { name: 'starbase', path: '/Users/olive/Projects/starbase', ok: true }] };

test('the inbox answer lists each laptop’s repositories, names only', async () => {
  const s = await makeOrbitSite();
  const olive = await paired(s, OLIVE, 'Olive’s Mac');
  const token = testToken('olive');
  s.orbit.person(token, { assigned: [ticket(12)] });
  const runner = fakeRunner([]);
  runner.startRepos = SENT_REPOS;
  const lap = await laptop(s, olive.token, { runner });
  try {
    await saveToken(olive.person, token);
    await s.cron();
    await until(async () => (await olive.person.json('/api/orbit/inbox')).body.laptops?.[0]?.repos?.length === 2, { what: 'the laptop’s repositories' });
    const { laptops } = (await olive.person.json('/api/orbit/inbox')).body;
    assert.equal(laptops.length, 1);
    assert.equal(laptops[0].name, 'Olive’s Mac');
    assert.deepEqual(laptops[0].repos, [{ name: 'orbit', default: true }, { name: 'starbase', default: false }]);
    assert.ok(!JSON.stringify(laptops).includes('/Users'), 'no path on the site');
  } finally { lap.link.stop(); await s.close(); }
});

test('the start route stores the choices: a queued start at level 1 on Fable reaches the laptop with them', async () => {
  const s = await makeOrbitSite();
  const olive = await paired(s, OLIVE, 'Olive’s Mac');
  const token = testToken('olive');
  s.orbit.person(token, { assigned: [ticket(12, { subject: 'Tidy the export button', type: 'bug' })] });
  const runner = fakeRunner([]);
  const lap = await laptop(s, olive.token, { runner });
  try {
    await saveToken(olive.person, token);
    await s.cron();
    await until(async () => (await olive.person.json('/api/laptops')).body.laptops[0]?.online, { what: 'the laptop to call in' });
    const bad = await olive.person.send('POST', '/api/orbit/start', { key: 'ORBIT-12', model: 'claude-made-up' });
    assert.equal(bad.status, 400);
    const r = await olive.person.send('POST', '/api/orbit/start', {
      key: 'ORBIT-12', description: 'ORBIT-12: Tidy the export button, only the label', kind: 'feature', repo: 'starbase', model: 'claude-fable-5-2', options: { level: 1, auto: true, evidence: 'always' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await until(() => runner.handled.length === 1, { what: 'the laptop to get the start command' });
    const got = runner.handled[0];
    assert.equal(got.options.level, 1);
    assert.equal(got.model, 'claude-fable-5-2');
    assert.deepEqual(got, {
      type: 'start', description: 'ORBIT-12: Tidy the export button, only the label', kind: 'feature', repo: 'starbase', model: 'claude-fable-5-2', options: { level: 1 },
      ticket: { key: 'ORBIT-12', title: 'Tidy the export button', url: `${FAKE_ORBIT}/admin/feedback/ORBIT-12` },
    });
  } finally { lap.link.stop(); await s.close(); }
});

test('Start is refused, as for a missing row, for a stored ticket that was not assigned', async () => {
  const s = await makeOrbitSite();
  const olive = await paired(s, OLIVE, 'Olive’s Mac');
  const token = testToken('olive');
  s.orbit.person(token, { assigned: [ticket(12)] });
  try {
    await saveToken(olive.person, token);
    await s.cron();
    const person = (await s.db.query('SELECT person_id FROM orbit_tokens')).rows[0].person_id;
    const old = { key: 'ORBIT-77', number: 77, title: 'Watched only', why: ['watching'], changedAt: null };
    await s.db.query("INSERT INTO orbit_inbox (person_id, number, ticket_key, item, changed_at, stored_at) VALUES ($1, 77, 'ORBIT-77', $2, NULL, '2026-10-30T16:00:00Z')", [person, JSON.stringify(old)]);
    const missing = await olive.person.send('POST', '/api/orbit/start', { key: 'ORBIT-999' });
    const watched = await olive.person.send('POST', '/api/orbit/start', { key: 'ORBIT-77' });
    assert.equal(watched.status, 404);
    assert.equal(watched.body.error, missing.body.error.replace('ORBIT-999', 'ORBIT-77'));
    assert.equal((await s.db.query('SELECT count(*)::int AS n FROM commands')).rows[0].n, 0, 'nothing was queued');
  } finally { await s.close(); }
});

test('Start is refused, as for a missing row, while Orbit ignores the assignee filter', async () => {
  const s = await makeOrbitSite();
  const olive = await paired(s, OLIVE, 'Olive’s Mac');
  const token = testToken('olive');
  s.orbit.person(token, { assigned: [ticket(12)] });
  try {
    await saveToken(olive.person, token);
    await s.cron();
    const missing = await olive.person.send('POST', '/api/orbit/start', { key: 'ORBIT-999' });
    await s.db.query('UPDATE orbit_tokens SET assignee_ignored = true');
    const ignored = await olive.person.send('POST', '/api/orbit/start', { key: 'ORBIT-12' });
    assert.equal(ignored.status, 404);
    assert.equal(ignored.body.error, missing.body.error.replace('ORBIT-999', 'ORBIT-12'));
    assert.equal((await s.db.query('SELECT count(*)::int AS n FROM commands')).rows[0].n, 0, 'nothing was queued');
  } finally { await s.close(); }
});

// ---- The laptop's suggested tickets (record kind inbox-suggest), shown beside the site's own rows ----

const unranked = (n, extra = {}) => ticket(n, { queuePosition: null, ...extra });
const suggestion = (picks, extra = {}) => ({ at: '2026-10-30T15:30:00.000Z', picks, forList: ['ORBIT-12@a', 'ORBIT-13@b'], ...extra });
const suggestRunner = (value) => { const r = mirrorRunner(); r.read.inboxSuggest = () => value; return r; };

/** Olive with a ticket list, a laptop that offers `value` as its suggestion, and the site having read both. */
async function suggestSetUp(value, assigned = [unranked(12), unranked(13), unranked(14)]) {
  const s = await makeOrbitSite();
  const olive = await paired(s, OLIVE, 'Olive’s Mac');
  const token = testToken('olive');
  s.orbit.person(token, { assigned });
  const runner = suggestRunner(value);
  const lap = await mirrorLaptop(s, olive.token, { runner });
  await saveToken(olive.person, token);
  await s.cron();
  return { s, olive, token, runner, lap };
}
const answer = async (olive) => (await olive.person.json('/api/orbit/inbox')).body;

test('the website’s inbox shows the laptop’s suggestion for tickets in its own list', async () => {
  const value = suggestion([{ key: 'ORBIT-13', reason: 'Small and quick.' }, { key: 'ORBIT-12', reason: 'Blocks Sam.' }]);
  const { s, olive, lap } = await suggestSetUp(value);
  try {
    await until(async () => (await answer(olive)).suggest, { what: 'the suggestion on the site' });
    assert.deepEqual((await answer(olive)).suggest, { state: 'ready', ...value, receivedAt: new Date(s.clock.t).toISOString() });
  } finally { lap.link.stop(); await s.close(); }
});

test('a pick the website’s list doesn’t have, or has started, or Orbit has ranked, is dropped', async () => {
  const value = suggestion([{ key: 'ORBIT-99', reason: 'Not in the list.' }, { key: 'ORBIT-14', reason: 'Ranked in Orbit.' }, { key: 'ORBIT-12', reason: 'Free until started.' }]);
  const { s, olive, lap } = await suggestSetUp(value, [unranked(12), unranked(13), unranked(14, { queuePosition: 2 })]);
  try {
    await until(async () => (await answer(olive)).suggest, { what: 'the suggestion on the site' });
    assert.deepEqual((await answer(olive)).suggest.picks, [{ key: 'ORBIT-12', reason: 'Free until started.' }]);
    assert.equal((await olive.person.send('POST', '/api/orbit/start', { key: 'ORBIT-12' })).status, 200);
    assert.deepEqual((await answer(olive)).suggest.picks, []);
  } finally { lap.link.stop(); await s.close(); }
});

test('with two laptops the suggestion the website received last wins, whatever the laptops’ own clocks say', async () => {
  const wrongClock = suggestion([{ key: 'ORBIT-12', reason: 'Clock ahead.' }], { at: '2026-10-30T16:04:00.000Z' });
  const received = suggestion([{ key: 'ORBIT-13', reason: 'Received last.' }], { at: '2026-10-30T10:00:00.000Z' });
  const { s, olive, lap } = await suggestSetUp(wrongClock);
  await until(async () => (await s.db.query("SELECT 1 FROM records WHERE kind = 'inbox-suggest'")).rows.length === 1, { what: 'the first suggestion' });
  s.clock.t += 60_000;
  const second = await paired(s, OLIVE, 'Olive’s Studio', { person: olive.person });
  const lap2 = await mirrorLaptop(s, second.token, { runner: suggestRunner(received) });
  try {
    await until(async () => (await s.db.query("SELECT 1 FROM records WHERE kind = 'inbox-suggest'")).rows.length === 2, { what: 'both laptops’ suggestions' });
    const { suggest } = await answer(olive);
    assert.deepEqual(suggest.picks, received.picks);
    assert.equal(suggest.receivedAt, new Date(s.clock.t).toISOString());
  } finally { lap2.link.stop(); lap.link.stop(); await s.close(); }
});

test('a record dated in the future is not stored, so a wrong laptop clock cannot pin a suggestion', async () => {
  const { s, olive, lap } = await suggestSetUp(suggestion([{ key: 'ORBIT-12', reason: 'x' }], { at: '2099-01-01T00:00:00.000Z' }));
  try {
    await new Promise((r) => setTimeout(r, 150));
    assert.equal((await s.db.query("SELECT 1 FROM records WHERE kind = 'inbox-suggest'")).rows.length, 0);
    assert.equal((await answer(olive)).suggest, null);
  } finally { lap.link.stop(); await s.close(); }
});

test('a bad record from a laptop removes that laptop’s earlier good one', async () => {
  const { s, olive, runner, lap } = await suggestSetUp(suggestion([{ key: 'ORBIT-12', reason: 'Good.' }]));
  try {
    await until(async () => (await answer(olive)).suggest, { what: 'the good suggestion' });
    runner.read.inboxSuggest = () => suggestion(Array(4).fill({ key: 'ORBIT-12', reason: 'x' }));
    runner.changed();
    await until(async () => (await answer(olive)).suggest === null, { what: 'the suggestion gone' });
  } finally { lap.link.stop(); await s.close(); }
});

test('the website drops a laptop’s record that is not the right shape, and cuts what is too long', async () => {
  const long = 'x'.repeat(2000);
  const bad = [
    { at: 'not a date', picks: [{ key: 'ORBIT-12', reason: 'x' }], forList: [] },
    { at: '2026-10-30T15:30:00.000Z', picks: 'ORBIT-12', forList: [] },
    { at: '2026-10-30T15:30:00.000Z', picks: [{ key: '<script>', reason: 'x' }], forList: [] },
    { at: '2026-10-30T15:30:00.000Z', picks: [{ key: 'ORBIT-12', reason: 7 }], forList: [] },
    { at: '2026-10-30T15:30:00.000Z', picks: [{ key: 'ORBIT-12', reason: 'x' }], forList: [1] },
    { at: '2026-10-30T15:30:00.000Z', picks: Array(4).fill({ key: 'ORBIT-12', reason: 'x' }), forList: [] },
    // key in lower case: refused, not rewritten
    { at: '2026-10-30T15:30:00.000Z', picks: [{ key: 'orbit-12', reason: 'x' }], forList: [] },
    // key with a leading zero: refused, not rewritten
    { at: '2026-10-30T15:30:00.000Z', picks: [{ key: 'ORBIT-012', reason: 'x' }], forList: [] },
    // a number as the key: refused
    { at: '2026-10-30T15:30:00.000Z', picks: [{ key: 12, reason: 'x' }], forList: [] },
    // an object as the reason: refused
    { at: '2026-10-30T15:30:00.000Z', picks: [{ key: 'ORBIT-12', reason: { text: 'x' } }], forList: [] },
    // a __proto__ key in the record (as JSON text): the record is still refused here because picks is wrong, and nothing leaks into Object.prototype
    JSON.parse('{"__proto__": {"polluted": true}, "at": "2026-10-30T15:30:00.000Z", "picks": "no", "forList": []}'),
    // a string, an array and null: not records, so the laptop's old suggestion goes and none shows
    'ORBIT-12',
    [suggestion([])],
    null,
  ];
  const { s, olive, runner, lap } = await suggestSetUp(bad[0]);
  try {
    for (const b of bad) {
      runner.read.inboxSuggest = () => b;
      runner.changed();
      await new Promise((r) => setTimeout(r, 150));
      assert.equal((await answer(olive)).suggest, null, JSON.stringify(b).slice(0, 80));
    }
    assert.equal({}.polluted, undefined);
    runner.read.inboxSuggest = () => suggestion([{ key: 'ORBIT-12', reason: long }], { forList: Array(500).fill('ORBIT-12@a') });
    runner.changed();
    await until(async () => (await answer(olive)).suggest, { what: 'a long record' });
    const { suggest } = await answer(olive);
    assert.ok(suggest.picks[0].reason.length <= 300);
    assert.ok(suggest.forList.length <= 100);
  } finally { lap.link.stop(); await s.close(); }
});

test('an inbox with no suggestion answers suggest: null', async () => {
  const { s, olive, lap } = await suggestSetUp(null);
  try {
    await new Promise((r) => setTimeout(r, 150));
    assert.equal((await answer(olive)).suggest, null);
  } finally { lap.link.stop(); await s.close(); }
});

test('a suggestion that names a ticket twice keeps it once', async () => {
  const { cleanSuggestion } = await import('../lib/records.js');
  const at = '2026-11-10T09:00:00.000Z';
  const clean = cleanSuggestion({
    at, forList: [],
    picks: [{ key: 'ORBIT-12', reason: 'First.' }, { key: 'ORBIT-12', reason: 'Again.' }, { key: 'ORBIT-13', reason: 'Other.' }],
  }, Date.parse(at));
  assert.deepEqual(clean.picks, [{ key: 'ORBIT-12', reason: 'First.' }, { key: 'ORBIT-13', reason: 'Other.' }]);
});
