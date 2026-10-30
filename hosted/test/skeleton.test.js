// Packet 2A step 1: the Vercel project's shape, the router, the migrations and the settings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, readConfig } from '../site/config.js';
import { openPglite } from '../site/db.js';
import { migrate, MigrationError } from '../site/migrate.js';
import { browser, makeSite, TEST_ENV } from './helpers.js';

const HOSTED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(HOSTED, '..');

test('vercel.json matches docs/hosting/vercel-setup.md: the build, the output, the one function, the rewrite and the cron job', () => {
  const v = JSON.parse(fs.readFileSync(path.join(HOSTED, 'vercel.json'), 'utf8'));
  assert.equal(v.framework, null, 'Framework preset: Other');
  assert.equal(v.buildCommand, 'npm run build');
  assert.equal(v.outputDirectory, 'public');
  assert.deepEqual(v.rewrites, [{ source: '/api/(.*)', destination: '/api/index' }]);
  assert.ok(fs.existsSync(path.join(HOSTED, 'api', 'index.js')), 'the one function');
  assert.deepEqual(Object.keys(v.functions), ['api/index.js']);
  assert.ok(v.functions['api/index.js'].maxDuration > 25, 'longer than the runner’s 25-second wait');
  assert.deepEqual(v.crons, [{ path: '/api/cron/inbox', schedule: '*/3 * * * *' }]);
  // The setup page names this folder, the redirect path and the cron job.
  const setup = fs.readFileSync(path.join(ROOT, 'docs', 'hosting', 'vercel-setup.md'), 'utf8');
  assert.match(setup, /\*\*Root Directory:\*\* `hosted`/);
  assert.match(setup, /\/api\/auth\/callback/);
  const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(root.workspaces, ['web', 'hosted']);
});

test('every dependency of the site is pinned to an exact version', () => {
  const p = JSON.parse(fs.readFileSync(path.join(HOSTED, 'package.json'), 'utf8'));
  for (const [name, v] of Object.entries({ ...p.dependencies, ...p.devDependencies })) assert.match(v, /^\d+\.\d+\.\d+$/, `${name} ${v}`);
});

test('.env.example lists every setting the setup page names, each empty', () => {
  const text = fs.readFileSync(path.join(HOSTED, '.env.example'), 'utf8');
  const names = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ALLOWED_DOMAIN', 'SESSION_SECRET', 'TOKEN_KEY', 'CRON_SECRET', 'OWNER_EMAIL', 'ORBIT_BASE_URL', 'SITE_URL', 'DATABASE_URL'];
  for (const n of names) assert.match(text, new RegExp(`^${n}=$`, 'm'), n);
  for (const line of text.split('\n')) if (/^[A-Z_]+=/.test(line)) assert.match(line, /=$/, `no value in the repo: ${line}`);
});

test('the fake Google is refused in a production build, and only there', () => {
  assert.throws(() => readConfig({ ...TEST_ENV, VERCEL: '1' }), ConfigError);
  assert.throws(() => readConfig({ ...TEST_ENV, NODE_ENV: 'production' }), /AUTH_FAKE is on in a production build/);
  assert.equal(readConfig(TEST_ENV).authFake, true);
  assert.equal(readConfig({ ...TEST_ENV, AUTH_FAKE: '' , VERCEL: '1', DATABASE_URL: 'postgres://x' }).authFake, false);
});

test('the settings: the redirect path, a preview’s address, and the names of what is missing', () => {
  const c = readConfig({ ...TEST_ENV, SITE_URL: 'https://feature-workshop.example.test/' });
  assert.equal(c.redirectUri, 'https://feature-workshop.example.test/api/auth/callback');
  assert.equal(readConfig({ VERCEL: '1', VERCEL_URL: 'feature-workshop-abc.vercel.app' }).siteUrl, 'https://feature-workshop-abc.vercel.app');
  const bare = readConfig({ VERCEL: '1' });
  assert.deepEqual(bare.missing, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ALLOWED_DOMAIN', 'SESSION_SECRET', 'OWNER_EMAIL', 'DATABASE_URL']);
  assert.deepEqual(readConfig(TEST_ENV).missing, []);
});

test('migrations: each applied once, in order, in one transaction behind the lock; a changed one is refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-migrations-'));
  fs.writeFileSync(path.join(dir, '001-first.sql'), 'CREATE TABLE a (id int);');
  fs.writeFileSync(path.join(dir, '002-second.sql'), 'CREATE TABLE b (id int); INSERT INTO b VALUES (1);');
  const db = await openPglite();
  try {
    assert.deepEqual((await migrate(db, { dir })).applied, ['001-first.sql', '002-second.sql']);
    assert.deepEqual(await migrate(db, { dir }), { applied: [], already: 2 }, 'safe to run on every build');
    // A failing migration leaves everything as it was, the ones before it in the same run too.
    fs.writeFileSync(path.join(dir, '003-third.sql'), 'CREATE TABLE c (id int);');
    fs.writeFileSync(path.join(dir, '004-broken.sql'), 'CREATE TABLE d (id nonsense_type);');
    await assert.rejects(migrate(db, { dir }));
    assert.equal((await db.query("SELECT to_regclass('c') AS t")).rows[0].t, null);
    fs.rmSync(path.join(dir, '004-broken.sql'));
    assert.deepEqual((await migrate(db, { dir })).applied, ['003-third.sql']);
    fs.writeFileSync(path.join(dir, '001-first.sql'), 'CREATE TABLE a (id bigint);');
    await assert.rejects(migrate(db, { dir }), (e) => e instanceof MigrationError && /001-first\.sql was changed after it was applied/.test(e.message));
    fs.writeFileSync(path.join(dir, '5-odd.sql'), '');
    await assert.rejects(migrate(db, { dir }), /isn’t named like the others/);
  } finally {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the real migrations apply to an empty database and again as a no-op', async () => {
  const db = await openPglite();
  try {
    await migrate(db);
    assert.deepEqual((await migrate(db)).applied, []);
  } finally { await db.close(); }
});

test('the router: /api/meta says hosted; an unknown address is a 404 and a wrong method a 405, in words', async () => {
  const s = await makeSite();
  try {
    const b = browser(s.fetch);
    const meta = await b.json('/api/meta');
    assert.equal(meta.status, 200);
    assert.equal(meta.body.mode, 'hosted');
    assert.equal(meta.body.person, null);
    assert.equal(meta.body.signIn, '/api/auth/start');
    const res = await b.get('/api/meta');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const nope = await b.json('/api/nothing-here');
    assert.equal(nope.status, 404);
    assert.match(nope.body.error, /nothing at this address/);
    assert.equal((await b.send('POST', '/api/meta', {})).status, 405);
    assert.equal((await b.get('/some/page')).status, 404, 'no page is served without a static folder (Vercel’s CDN serves it)');
  } finally { await s.close(); }
});

test('a change must be JSON', async () => {
  const s = await makeSite();
  try {
    const r = await s.fetch('http://localhost:4507/api/cron/inbox', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
    assert.equal(r.status, 405);
    const r2 = await s.fetch('http://localhost:4507/api/pair/start', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
    assert.ok([404, 415].includes(r2.status));
  } finally { await s.close(); }
});

test('the cron route refuses without CRON_SECRET, and answers 204 with it', async () => {
  const s = await makeSite();
  try {
    const url = 'http://localhost:4507/api/cron/inbox';
    assert.equal((await s.fetch(url)).status, 401);
    assert.equal((await s.fetch(url, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await s.fetch(url, { headers: { authorization: `Bearer ${TEST_ENV.CRON_SECRET}` } })).status, 204);
  } finally { await s.close(); }
  const unset = await makeSite({ env: { CRON_SECRET: '' } });
  try {
    assert.equal((await unset.fetch('http://localhost:4507/api/cron/inbox', { headers: { authorization: 'Bearer ' } })).status, 401, 'no secret set: nobody may call it');
  } finally { await unset.close(); }
});

test('a site missing settings says which, and answers 503 elsewhere', async () => {
  const s = await makeSite({ env: { SESSION_SECRET: '' } });
  try {
    const b = browser(s.fetch);
    assert.deepEqual((await b.json('/api/meta')).body.missing, ['SESSION_SECRET']);
    const r = await b.json('/api/laptops');
    assert.equal(r.status, 503);
    assert.match(r.body.error, /These settings are missing in Vercel: SESSION_SECRET/);
  } finally { await s.close(); }
});

test('a deployment with no database (a preview: the database is for Production only) says so calmly', async () => {
  const s = await makeSite({ env: { AUTH_FAKE: '', VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: 'feature-workshop-abc.vercel.app', DATABASE_URL: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' } });
  try {
    const fetchAt = (p) => s.fetch(`http://localhost:4507${p}`);
    const meta = await (await fetchAt('/api/meta')).json();
    assert.equal(meta.noDatabase, true);
    assert.equal(meta.person, null);
    const r = await fetchAt('/api/jobs');
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /This deployment has no database/);
    assert.equal((await fetchAt('/api/auth/start')).status, 503, 'no sign-in is even started');
  } finally { await s.close(); }
});

test('the build’s migrate step skips a deployment with no database, and the build goes on', async () => {
  const { spawnSync } = await import('node:child_process');
  const env = { PATH: process.env.PATH, VERCEL: '1', VERCEL_ENV: 'preview' };
  const r = spawnSync(process.execPath, [path.join(HOSTED, 'scripts', 'migrate.js')], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /No database for this deployment; migrations skipped\./);
});
