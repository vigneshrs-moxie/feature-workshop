// Packet 2A step 2: Google sign-in (through the fake issuer), every refusal, sessions, logout and
// revocation, people and roles, and the same-origin rule for changes. Made-up people only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser, makeSite, signIn, SITE } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;

const setCookies = (res) => res.headers.getSetCookie();

test('the start: PKCE (S256), a state, a nonce, hd as a hint, and the redirect path /api/auth/callback', async () => {
  const s = await makeSite();
  try {
    const b = browser(s.fetch);
    const r = await b.get('/api/auth/start');
    const u = new URL(r.headers.get('location'));
    assert.equal(u.searchParams.get('redirect_uri'), `${SITE}/api/auth/callback`);
    assert.equal(u.searchParams.get('response_type'), 'code');
    assert.equal(u.searchParams.get('scope'), 'openid email profile');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.match(u.searchParams.get('code_challenge'), /^[\w-]{43}$/);
    assert.ok(u.searchParams.get('state').length >= 40 && u.searchParams.get('nonce').length >= 40);
    assert.equal(u.searchParams.get('hd'), 'example.test');
    const c = setCookies(r).find((x) => x.startsWith('gc_signin='));
    assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Lax/); assert.match(c, /Path=\/api\/auth/);
    // The state is kept only as its hash.
    const row = (await s.db.query('SELECT state_hash FROM sign_ins')).rows[0];
    assert.notEqual(row.state_hash, u.searchParams.get('state'));
  } finally { await s.close(); }
});

test('the first sign-in with OWNER_EMAIL becomes the owner; everyone else a member', async () => {
  const s = await makeSite();
  try {
    const mo = browser(s.fetch);
    const first = await signIn(browser(s.fetch), { email: 'mia.member@example.test', name: 'Mia Member' });
    assert.equal(first.location, '/');
    const r = await signIn(mo, { email: 'Olive.Owner@example.test', name: 'Olive Owner' });
    assert.equal(r.location, '/');
    const meta = await mo.json('/api/meta');
    assert.deepEqual(meta.body.person, { id: meta.body.person.id, name: 'Olive Owner', email: 'olive.owner@example.test', role: 'owner' });
    const roles = (await s.db.query('SELECT email, role FROM people ORDER BY email')).rows;
    assert.deepEqual(roles, [{ email: 'mia.member@example.test', role: 'member' }, { email: 'olive.owner@example.test', role: 'owner' }]);
    const cookie = mo.jar.get('gc_session');
    assert.ok(cookie, 'a session cookie');
  } finally { await s.close(); }
});

test('a session cookie is HttpOnly, Secure, SameSite=Lax, 30 days; only its hash is stored', async () => {
  const s = await makeSite();
  try {
    const b = browser(s.fetch);
    const start = await b.get('/api/auth/start');
    const g = new URL(start.headers.get('location'));
    const cont = new URL(`${SITE}/fake-google/continue`);
    for (const [k, v] of g.searchParams) cont.searchParams.set(k, v);
    cont.searchParams.set('email', 'sam.sample@example.test');
    const cb = await b.get((await b.get(cont.toString())).headers.get('location'));
    const sc = setCookies(cb).find((x) => x.startsWith('gc_session='));
    assert.match(sc, /HttpOnly/); assert.match(sc, /Secure/); assert.match(sc, /SameSite=Lax/); assert.match(sc, /Max-Age=2592000/);
    const id = decodeURIComponent(sc.split(';')[0].split('=')[1]).split('.')[0];
    const stored = (await s.db.query('SELECT id_hash FROM sessions')).rows.map((r) => r.id_hash);
    assert.equal(stored.length, 1);
    assert.ok(!stored.includes(id));
  } finally { await s.close(); }
});

for (const [what, args, problem] of [
  ['an account from another domain', { email: 'pat.outside@elsewhere.test' }, 'domain'],
  ['email_verified false', { email: 'una.unverified@example.test', fakeCase: 'unverified' }, 'domain'],
  ['a personal account (no hd claim)', { email: 'nora.nohd@example.test', fakeCase: 'no-hd' }, 'domain'],
  ['a bad signature', { email: 'bea.badsig@example.test', fakeCase: 'bad-signature' }, 'bad-token'],
  ['an expired token', { email: 'eve.expired@example.test', fakeCase: 'expired' }, 'expired'],
  ['a wrong nonce', { email: 'nell.nonce@example.test', fakeCase: 'wrong-nonce' }, 'bad-token'],
]) {
  test(`refused, with no session: ${what}`, async () => {
    const s = await makeSite();
    try {
      const b = browser(s.fetch);
      const r = await signIn(b, args);
      assert.equal(r.location, `/#/sign-in?problem=${problem}`);
      assert.equal(b.jar.get('gc_session'), undefined);
      assert.equal((await b.json('/api/meta')).body.person, null);
      assert.equal((await s.db.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n, 0);
      assert.equal((await s.db.query('SELECT count(*)::int AS n FROM people')).rows[0].n, 0, 'nobody is recorded');
    } finally { await s.close(); }
  });
}

test('a replayed state is refused: the same callback twice, and a callback in another browser', async () => {
  const s = await makeSite();
  try {
    const b = browser(s.fetch);
    const r = await signIn(b, { email: 'rita.replay@example.test' });
    assert.equal(r.location, '/');
    const again = await b.get(r.callback);
    assert.equal(again.headers.get('location'), '/#/sign-in?problem=state');
    // Someone else's browser, handed this browser's callback, has no matching sign-in cookie.
    const b2 = browser(s.fetch);
    const start = await b2.get('/api/auth/start');
    const g = new URL(start.headers.get('location'));
    const cont = new URL(`${SITE}/fake-google/continue`);
    for (const [k, v] of g.searchParams) cont.searchParams.set(k, v);
    cont.searchParams.set('email', 'rita.replay@example.test');
    const callback = (await b2.get(cont.toString())).headers.get('location');
    const stranger = browser(s.fetch);
    assert.equal((await stranger.get(callback)).headers.get('location'), '/#/sign-in?problem=state');
    assert.equal(stranger.jar.get('gc_session'), undefined);
  } finally { await s.close(); }
});

test('a sign-in left more than ten minutes is refused', async () => {
  const s = await makeSite();
  try {
    const b = browser(s.fetch);
    const start = await b.get('/api/auth/start');
    const g = new URL(start.headers.get('location'));
    const cont = new URL(`${SITE}/fake-google/continue`);
    for (const [k, v] of g.searchParams) cont.searchParams.set(k, v);
    cont.searchParams.set('email', 'lou.late@example.test');
    const callback = (await b.get(cont.toString())).headers.get('location');
    s.clock.t += 11 * 60 * 1000;
    assert.equal((await b.get(callback)).headers.get('location'), '/#/sign-in?problem=state');
  } finally { await s.close(); }
});

test('Google saying no (the person cancelled) lands on the sign-in page with that reason', async () => {
  const s = await makeSite();
  try {
    const r = await browser(s.fetch).get('/api/auth/callback?error=access_denied&state=x');
    assert.equal(r.headers.get('location'), '/#/sign-in?problem=cancelled');
  } finally { await s.close(); }
});

test('where a sign-in lands: this site’s own page only', async () => {
  const s = await makeSite();
  try {
    assert.equal((await signIn(browser(s.fetch), { email: 'a.one@example.test', returnTo: '/#/pair/ABCD2345' })).location, '/#/pair/ABCD2345');
    assert.equal((await signIn(browser(s.fetch), { email: 'b.two@example.test', returnTo: 'https://elsewhere.test/' })).location, '/');
    assert.equal((await signIn(browser(s.fetch), { email: 'c.three@example.test', returnTo: '//elsewhere.test' })).location, '/');
  } finally { await s.close(); }
});

test('sessions slide: used, they last 30 more days; unused for 30 days, they end', async () => {
  const s = await makeSite();
  try {
    const b = browser(s.fetch);
    await signIn(b, { email: 'sid.slide@example.test' });
    s.clock.t += 20 * DAY;
    const r = await b.get('/api/people');
    assert.equal(r.status, 200);
    assert.ok(setCookies(r).some((c) => c.startsWith('gc_session=') && /Max-Age=2592000/.test(c)), 'the cookie is renewed');
    const exp = new Date((await s.db.query('SELECT expires_at FROM sessions')).rows[0].expires_at).getTime();
    assert.equal(exp, s.clock.t + 30 * DAY);
    s.clock.t += 29 * DAY;
    assert.equal((await b.get('/api/people')).status, 200, 'still in: renewed 29 days ago');
    s.clock.t += 31 * DAY;
    const out = await b.json('/api/people');
    assert.equal(out.status, 401);
    assert.equal(out.body.signIn, true);
  } finally { await s.close(); }
});

test('a made-up or altered cookie is refused', async () => {
  const s = await makeSite();
  try {
    const b = browser(s.fetch);
    await signIn(b, { email: 'tia.tamper@example.test' });
    const [id, sig] = b.jar.get('gc_session').split('.');
    b.jar.set('gc_session', `${id}x.${sig}`);
    assert.equal((await b.get('/api/people')).status, 401);
    b.jar.set('gc_session', 'nonsense');
    assert.equal((await b.get('/api/people')).status, 401);
  } finally { await s.close(); }
});

test('logout ends this browser’s session; everywhere ends them all; a revoked session is refused', async () => {
  const s = await makeSite();
  try {
    const one = browser(s.fetch);
    const two = browser(s.fetch);
    const three = browser(s.fetch);
    for (const b of [one, two, three]) await signIn(b, { email: 'liv.logout@example.test' });
    const out = await one.send('POST', '/api/auth/logout', {});
    assert.equal(out.status, 200);
    assert.equal(one.jar.get('gc_session'), undefined, 'the cookie is cleared');
    assert.equal((await two.get('/api/people')).status, 200, 'other browsers stay in');
    await two.send('POST', '/api/auth/logout', { everywhere: true });
    assert.equal((await three.get('/api/people')).status, 401);
    const four = browser(s.fetch);
    await signIn(four, { email: 'liv.logout@example.test' });
    await s.db.query('UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL');
    assert.equal((await four.get('/api/people')).status, 401);
  } finally { await s.close(); }
});

test('a change needs the site’s own origin (Origin or Sec-Fetch-Site), and JSON', async () => {
  const s = await makeSite();
  try {
    const b = browser(s.fetch);
    await signIn(b, { email: 'olive.owner@example.test' });
    await signIn(browser(s.fetch), { email: 'mia.member@example.test' });
    const mia = (await s.db.query("SELECT id FROM people WHERE email = 'mia.member@example.test'")).rows[0].id;
    const evil = await b.send('POST', `/api/people/${mia}/role`, { role: 'manager' }, { headers: { origin: 'https://elsewhere.test' } });
    assert.equal(evil.status, 403);
    assert.match(evil.body.error, /must come from the site’s own page/);
    const noOrigin = await b.get(`/api/people/${mia}/role`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{"role":"manager"}' });
    assert.equal(noOrigin.status, 403);
    const fetchSite = await b.get(`/api/people/${mia}/role`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: '{"role":"manager"}' });
    assert.equal(fetchSite.status, 200);
    const form = await b.get(`/api/people/${mia}/role`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: SITE }, body: 'role=manager' });
    assert.equal(form.status, 415);
  } finally { await s.close(); }
});

test('people and roles: the owner makes someone a manager or a member; nobody else can, and the owner stays', async () => {
  const s = await makeSite();
  try {
    const owner = browser(s.fetch);
    const raj = browser(s.fetch);
    const vic = browser(s.fetch);
    await signIn(owner, { email: 'olive.owner@example.test', name: 'Olive Owner' });
    await signIn(raj, { email: 'max.manager@example.test', name: 'Max Manager' });
    await signIn(vic, { email: 'mia.member@example.test', name: 'Mia Member' });
    const list = (await owner.json('/api/people')).body.people;
    assert.deepEqual(list.map((p) => [p.name, p.role, p.you]), [['Olive Owner', 'owner', true], ['Max Manager', 'member', false], ['Mia Member', 'member', false]]);
    const max = list.find((p) => p.name === 'Max Manager').id;
    const made = await owner.send('POST', `/api/people/${max}/role`, { role: 'manager' });
    assert.equal(made.status, 200);
    assert.equal(made.body.people.find((p) => p.id === max).role, 'manager');
    // A member (or a manager) can't change roles.
    assert.equal((await vic.send('POST', `/api/people/${max}/role`, { role: 'member' })).status, 403);
    assert.equal((await raj.send('POST', `/api/people/${max}/role`, { role: 'member' })).status, 403);
    // Nobody becomes owner here; the owner's own role stays; an unknown person is a 404.
    assert.equal((await owner.send('POST', `/api/people/${max}/role`, { role: 'owner' })).status, 400);
    const me = list.find((p) => p.you).id;
    assert.equal((await owner.send('POST', `/api/people/${me}/role`, { role: 'member' })).status, 400);
    assert.equal((await owner.send('POST', '/api/people/999999/role', { role: 'member' })).status, 404);
    // Everyone signed in can see the list; nobody signed out can.
    assert.equal((await vic.json('/api/people')).status, 200);
    assert.equal((await browser(s.fetch).json('/api/people')).status, 401);
  } finally { await s.close(); }
});

test('without AUTH_FAKE there is no fake Google, and a test never reaches the real one', async () => {
  const s = await makeSite({ env: { AUTH_FAKE: '', GOOGLE_CLIENT_ID: 'a-client', GOOGLE_CLIENT_SECRET: 'a-secret' } });
  try {
    const b = browser(s.fetch);
    assert.equal((await b.get('/fake-google/.well-known/openid-configuration')).status, 404);
    const r = await b.get('/api/auth/start');
    // Google's discovery address is outside the in-process fetch, which refuses it: no network.
    assert.equal(r.headers.get('location'), '/#/sign-in?problem=google');
  } finally { await s.close(); }
});
