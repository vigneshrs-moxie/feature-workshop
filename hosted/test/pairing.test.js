// Packet 2A step 3: pairing a laptop with a one-time code, from `ground-control login` to the
// runner token in the laptop's store; expiry and reuse; rotation; Settings → Laptops and Remove;
// `ground-control logout`. The CLI runs in this process against the in-process site.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../../bin/ground-control.js';
import { readSiteFile, SITE_TOKEN_NAMES } from '../../dashboard/runner/site-link.js';
import { CODE_LETTERS } from '../site/routes-pair.js';
import { browser, makeSite, signIn, SITE } from './helpers.js';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

const codeFrom = (text) => /same code: ([A-Z0-9]{8})/.exec(text)?.[1];
const tokenIn = (stateDir) => fs.readFileSync(path.join(stateDir, SITE_TOKEN_NAMES.file), 'utf8').trim();
const asRunner = (s, token, p = '/api/runner/logout') => s.fetch(`${SITE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{}' });

test('login → the link and the code → Pair this laptop → the token in the laptop’s store, and only its hash on the site', async () => {
  const s = await makeSite();
  try {
    const olive = browser(s.fetch);
    await signIn(olive, { email: 'olive.owner@example.test', name: 'Olive Owner' });
    let code = null;
    // The approval happens at the CLI's first pause, reading its lines as they come.
    const out = [];
    const stateDir2 = tmp('gc-2a-state-');
    const exit = await main(['login', '--site', SITE, '--name', 'Olive’s laptop'], {
      env: { WORKSHOP_ORBIT_STORE: 'file' }, home: tmp('gc-2a-home-'), stateDir: stateDir2, running: () => null, interactive: false,
      out: (l) => out.push(l), err: (l) => out.push(l), fetch: s.fetch,
      sleep: async (ms) => {
        s.clock.t += ms;
        if (code) return;
        code = codeFrom(out.join('\n'));
        assert.ok(code, 'the code is printed');
        assert.equal(code.length, 8);
        assert.ok([...code].every((c) => CODE_LETTERS.includes(c)), 'no look-alike letters');
        assert.ok(out.some((l) => l.trim() === `${SITE}/#/pair/${code}`), 'the link is printed');
        const look = await olive.json(`/api/pair/${code.toLowerCase()}`);
        assert.deepEqual(look.body, { code, name: 'Olive’s laptop', os: 'macOS', state: 'waiting', expiresAt: look.body.expiresAt });
        assert.equal((await olive.send('POST', `/api/pair/${code}/approve`, {})).status, 200);
      },
    });
    assert.equal(exit, 0, out.join('\n'));
    assert.match(out.join('\n'), /Paired: this laptop is “Olive’s laptop” on the site, for olive\.owner@example\.test\./);
    const token = tokenIn(stateDir2);
    assert.match(token, /^[\w-]{43}$/, '32 random bytes');
    assert.equal((fs.statSync(path.join(stateDir2, SITE_TOKEN_NAMES.file)).mode & 0o777), 0o600);
    const site = readSiteFile(stateDir2);
    assert.equal(site.url, SITE);
    assert.equal(site.name, 'Olive’s laptop');
    assert.ok(!JSON.stringify(site).includes(token), 'site.json holds no token');
    // The site has its hash only.
    const rows = (await s.db.query('SELECT token_hash FROM runners')).rows;
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].token_hash, token);
    assert.ok(!JSON.stringify((await s.db.query('SELECT * FROM pairings')).rows).includes(token));
    // Settings → Laptops lists it, online (it just called in).
    const laptops = (await olive.json('/api/laptops')).body.laptops;
    assert.equal(laptops.length, 1);
    assert.equal(laptops[0].name, 'Olive’s laptop');
    assert.equal(laptops[0].os, 'macOS');
  } finally { await s.close(); }
});

/** Pairs a made-up laptop for a signed-in browser; resolves { exit, out, stateDir, code }. */
async function pair(s, person, { name = 'Test Laptop', stateDir = tmp('gc-2a-state-'), approve = true } = {}) {
  const out = [];
  let code = null;
  const exit = await main(['login', '--site', SITE, '--name', name], {
    env: { WORKSHOP_ORBIT_STORE: 'file' }, home: tmp('gc-2a-home-'), stateDir, running: () => null, interactive: false,
    out: (l) => out.push(l), err: (l) => out.push(l), fetch: s.fetch,
    sleep: async (ms) => {
      s.clock.t += ms;
      if (code) return;
      code = codeFrom(out.join('\n'));
      if (typeof approve === 'function') await approve(code);
      else if (approve) assert.equal((await person.send('POST', `/api/pair/${code}/approve`, {})).status, 200);
    },
  });
  return { exit, out, text: out.join('\n'), stateDir, code };
}

test('a code works for ten minutes: after that the site refuses it and login says so', async () => {
  const s = await makeSite();
  try {
    const olive = browser(s.fetch);
    await signIn(olive, { email: 'olive.owner@example.test' });
    const late = await pair(s, olive, {
      approve: async (code) => {
        s.clock.t += 11 * 60 * 1000;
        const r = await olive.send('POST', `/api/pair/${code}/approve`, {});
        assert.equal(r.status, 410);
        assert.match(r.body.error, /run out/);
        assert.equal((await olive.json(`/api/pair/${code}`)).body.state, 'expired');
      },
    });
    assert.equal(late.exit, 1);
    assert.match(late.text, /the code has run out\. Run ground-control login again/);
    assert.equal((await s.db.query('SELECT count(*)::int AS n FROM runners')).rows[0].n, 0);
  } finally { await s.close(); }
});

test('a code works once: approving or collecting it again is refused, and so is a second person', async () => {
  const s = await makeSite();
  try {
    const olive = browser(s.fetch);
    const mia = browser(s.fetch);
    await signIn(olive, { email: 'olive.owner@example.test' });
    await signIn(mia, { email: 'mia.member@example.test' });
    // A second person can't take a laptop someone else already said yes to.
    let secret = null;
    const start = await s.fetch(`${SITE}/api/pair/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Shared', os: 'Linux', deviceId: 'device-aaaa-1111' }) });
    const st = await start.json();
    secret = st.secret;
    assert.equal((await olive.send('POST', `/api/pair/${st.code}/approve`, {})).status, 200);
    assert.equal((await mia.send('POST', `/api/pair/${st.code}/approve`, {})).status, 409);
    const finish = (b) => s.fetch(`${SITE}/api/pair/finish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const first = await finish({ secret });
    assert.equal(first.status, 200);
    const again = await finish({ secret });
    assert.equal(again.status, 410);
    assert.match((await again.json()).error, /used already/);
    assert.equal((await olive.send('POST', `/api/pair/${st.code}/approve`, {})).status, 410);
    assert.equal((await finish({ secret: 'not-a-secret-anyone-has-0000000000000' })).status, 404);
    // A code that isn't one: 404, in words.
    const none = await olive.json('/api/pair/ZZZZ2222');
    assert.equal(none.status, 404);
    assert.match(none.body.error, /no pairing with that code/);
    // Without a session nobody sees or approves a pairing.
    assert.equal((await browser(s.fetch).json(`/api/pair/${st.code}`)).status, 401);
  } finally { await s.close(); }
});

test('a login on a laptop already paired rotates its token: the same laptop, the old token refused', async () => {
  const s = await makeSite();
  try {
    const olive = browser(s.fetch);
    await signIn(olive, { email: 'olive.owner@example.test' });
    const one = await pair(s, olive, { name: 'Laptop A' });
    assert.equal(one.exit, 0, one.text);
    const oldToken = tokenIn(one.stateDir);
    const two = await pair(s, olive, { name: 'Laptop A', stateDir: one.stateDir });
    assert.equal(two.exit, 0, two.text);
    assert.match(two.text, /Paired again: .* Its old token no longer works\./);
    const newToken = tokenIn(one.stateDir);
    assert.notEqual(newToken, oldToken);
    assert.equal((await olive.json('/api/laptops')).body.laptops.length, 1, 'still one laptop');
    assert.equal((await asRunner(s, oldToken)).status, 401);
    assert.equal((await asRunner(s, newToken)).status, 200);
  } finally { await s.close(); }
});

test('Settings → Laptops: only your own; online means seen in the last 60 seconds; Remove revokes the token', async () => {
  const s = await makeSite();
  try {
    const olive = browser(s.fetch);
    const mia = browser(s.fetch);
    await signIn(olive, { email: 'olive.owner@example.test' });
    await signIn(mia, { email: 'mia.member@example.test' });
    const a = await pair(s, olive, { name: 'Olive A' });
    const b = await pair(s, mia, { name: 'Mia B' });
    assert.equal(a.exit + b.exit, 0);
    const oliveList = (await olive.json('/api/laptops')).body.laptops;
    assert.deepEqual(oliveList.map((l) => l.name), ['Olive A']);
    assert.deepEqual((await mia.json('/api/laptops')).body.laptops.map((l) => l.name), ['Mia B']);
    // A call from the laptop marks it seen; a minute later it is offline.
    await s.db.query('UPDATE runners SET last_seen_at = $1', [new Date(s.clock.t).toISOString()]);
    assert.equal((await olive.json('/api/laptops')).body.laptops[0].online, true);
    s.clock.t += 61 * 1000;
    const later = (await olive.json('/api/laptops')).body.laptops[0];
    assert.equal(later.online, false);
    assert.ok(later.lastSeenAt);
    // Mia can't remove Olive's laptop: 404, as if it weren't there.
    assert.equal((await mia.send('DELETE', `/api/laptops/${oliveList[0].id}`, {})).status, 404);
    const removed = await olive.send('DELETE', `/api/laptops/${oliveList[0].id}`, {});
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.laptops, []);
    const r = await asRunner(s, tokenIn(a.stateDir));
    assert.equal(r.status, 401);
    assert.match((await r.json()).error, /isn’t paired with the site any more/);
  } finally { await s.close(); }
});

test('logout: the site forgets the token, then the laptop does; a second logout has nothing to do', async () => {
  const s = await makeSite();
  try {
    const olive = browser(s.fetch);
    await signIn(olive, { email: 'olive.owner@example.test' });
    const a = await pair(s, olive, { name: 'Olive A' });
    const token = tokenIn(a.stateDir);
    const out = [];
    const opts = { env: { WORKSHOP_ORBIT_STORE: 'file' }, home: tmp('gc-2a-home-'), stateDir: a.stateDir, running: () => null, out: (l) => out.push(l), err: (l) => out.push(l), fetch: s.fetch };
    assert.equal(await main(['logout'], opts), 0);
    assert.match(out.join('\n'), /Unpaired: http:\/\/localhost:4507 has forgotten this laptop/);
    assert.equal((await asRunner(s, token)).status, 401);
    assert.equal(fs.existsSync(path.join(a.stateDir, SITE_TOKEN_NAMES.file)), false);
    assert.equal(readSiteFile(a.stateDir), null);
    assert.deepEqual((await olive.json('/api/laptops')).body.laptops, []);
    out.length = 0;
    assert.equal(await main(['logout'], opts), 0);
    assert.match(out.join('\n'), /isn’t paired with a site/);
  } finally { await s.close(); }
});

test('a pairing asks for the laptop’s name, OS and device id, and is told plainly when one is wrong', async () => {
  const s = await makeSite();
  try {
    const post = async (body) => { const r = await s.fetch(`${SITE}/api/pair/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
    assert.equal((await post({ os: 'macOS', deviceId: 'device-aaaa-1111' })).status, 400);
    assert.equal((await post({ name: 'x', os: 'macOS', deviceId: 'no' })).status, 400);
    const ok = await post({ name: 'x', os: 'macOS', deviceId: 'device-aaaa-1111' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.link, `${SITE}/#/pair/${ok.body.code}`);
    assert.equal(ok.body.pollEvery, 2);
    assert.ok(ok.body.secret.length >= 40);
  } finally { await s.close(); }
});
