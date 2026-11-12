// Auto's own database copy, and the fast copy for Try it (lib/local.js). The Postgres tools are the
// fakes in fixtures/fake-pg: no test here touches a real Postgres server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LocalRunner, AutoDbError, AUTO_TRY_IT_RUNNING, createdbArgs } from '../lib/local.js';
import { State } from '../lib/state.js';

const FAKES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-pg');
const FIXTURE_APP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'auto-db-app');
const PROFILE = {
  name: 'App', github: null,
  tryIt: { app: 'app' },
  filesToCopy: [{ from: '{app}/.env.local', to: '{app}/.env.local' }],
  database: { urlKey: 'DATABASE_URL' },
};
const HIS = ['app', 'app__original'];
// The same, with ports and an address for the fixture app's dev server.
const APP_PROFILE = { ...PROFILE, tryIt: { app: 'app', ports: { first: 47310, last: 47349 }, url: 'http://127.0.0.1:{port}' } };

// Every command Auto ran, over every test in this file (the last test reads it).
const autoLines = [];

// fixture: the job's app is fixtures/auto-db-app (it reads its .env.local, appSettings, as Next.js does).
// settings: his settings file in the main checkout. profile: the repository's profile.
// autoStepMs: the runner's time limit on each of Auto's database steps.
async function setup({ version = 170000, original = true, connections = 0, fixture = false, profile = null, settings = null, appSettings = 'DATABASE_URL=postgres://localhost/app\n', autoStepMs = undefined } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'starbase-local-db-')));
  const repo = path.join(root, 'main');
  const wt = path.join(root, 'wt');
  const scripts = { dev: 'next dev', 'db:migrate': `node ${JSON.stringify(path.join(FAKES, 'migrate'))}` };
  for (const dir of [repo, wt]) {
    await fs.mkdir(path.join(dir, 'app'), { recursive: true });
    await fs.writeFile(path.join(dir, 'app', 'package.json'), JSON.stringify({ name: 'app', scripts }));
  }
  if (fixture) {
    for (const file of await fs.readdir(FIXTURE_APP)) await fs.copyFile(path.join(FIXTURE_APP, file), path.join(wt, 'app', file));
    await fs.writeFile(path.join(wt, 'app', '.env.local'), appSettings);
  }
  await fs.writeFile(path.join(repo, 'app', '.env.local'), settings ?? 'DATABASE_URL=postgres://u:p@localhost:5432/app?schema=public\n');
  for (const m of ['0001_a', '0002_b']) await fs.mkdir(path.join(wt, 'app', 'prisma', 'migrations', m), { recursive: true });
  const stateFile = path.join(root, 'pg.json');
  const logFile = path.join(root, 'pg.log');
  const databases = { app: { ledger: ['0001_a'], connections } };
  if (original) databases.app__original = { ledger: ['0001_a'], connections: 0 };
  await fs.writeFile(stateFile, JSON.stringify({ version, databases }));
  await fs.writeFile(logFile, '');
  process.env.FAKE_PG_STATE = stateFile;
  process.env.FAKE_PG_LOG = logFile;
  for (const k of ['FAKE_PG_FAIL', 'FAKE_PG_HANG', 'FAKE_PG_SLOW']) delete process.env[k];
  profile ??= fixture ? APP_PROFILE : PROFILE;
  const registry = { profileFor: async () => ({ ok: true, profile, file: path.join(repo, 'starbase.md'), source: 'repo' }) };
  const local = new LocalRunner({ state: new State(path.join(root, 'state')), registry, pgTool: async (name) => path.join(FAKES, name), ...(autoStepMs ? { autoStepMs } : {}) });
  const f = { slug: 'x', title: 'X', worktree: wt, repoPath: repo, branch: 'feature/x' };
  const parse = (text) => text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const log = async () => parse(await fs.readFile(logFile, 'utf8'));
  const logNow = () => parse(readFileSync(logFile, 'utf8'));
  const pg = async () => JSON.parse(await fs.readFile(stateFile, 'utf8')).databases;
  const done = () => fs.rm(root, { recursive: true, force: true });
  return { root, local, f, log, logNow, pg, done };
}

// Runs autoDatabase, checks the commands it ran (from `from` on) and keeps them for the safety test.
async function runAuto(ctx, from = null, opts = undefined) {
  const start = from ?? (await ctx.log()).length;
  try { return await ctx.local.autoDatabase(ctx.f, opts); } finally { keepAuto((await ctx.log()).slice(start)); }
}

const line = (e) => [e.tool, ...e.args].join(' ');
const dbOfUrl = (url) => (url ? decodeURIComponent(new URL(url).pathname.slice(1)) : null);

let autoSaves = 0; // times Auto saved a missing original, over the file
/**
 * Review Focus 2, for each command Auto ran: his database and the original are only ever a copy's
 * source, and his only to save a missing original. Then kept for the total in the safety test.
 */
function keepAuto(entries) {
  for (const e of entries) {
    const where = line(e);
    if (e.tool === 'createdb') {
      const to = e.args.at(-1);
      const from = e.args[e.args.indexOf('-T') + 1];
      // The one exception: saving the original when there is none (createdb refuses an existing name).
      if (from === 'app' && to === 'app__original') { autoSaves++; continue; }
      assert.notEqual(from, 'app', `his database is copied only to save the original: ${where}`);
      assert.ok(!HIS.includes(to), where);
    }
    if (e.tool === 'dropdb') assert.ok(!HIS.includes(e.args.at(-1)), where);
    if (e.tool === 'migrate') assert.ok(!HIS.includes(dbOfUrl(e.url)), where);
    if (e.tool === 'psql') {
      assert.ok(!HIS.includes(e.args[e.args.indexOf('-d') + 1]), `Auto never connects to them: ${where}`);
      assert.ok(!/\b(alter|drop|create)\b/i.test(e.args.at(-1)), `Auto changes nothing through psql: ${where}`);
    }
  }
  autoLines.push(...entries);
}
const changes = (entries) => entries.filter((e) => e.tool !== 'psql').map(line);

test('createdbArgs uses the file copy only when asked', () => {
  assert.deepEqual(createdbArgs('a', 'b', { fileCopy: true }), ['-T', 'a', '--strategy=file_copy', 'b']);
  assert.deepEqual(createdbArgs('a', 'b', { fileCopy: false }), ['-T', 'a', 'b']);
});

test('Try it\'s switch copies with the file copy on Postgres 15 or later, and without it before', async () => {
  for (const [version, strategy] of [[170000, ['--strategy=file_copy']], [150000, ['--strategy=file_copy']], [140011, []]]) {
    const ctx = await setup({ version, original: false });
    try {
      await ctx.local.database(ctx.f, 'match');
      const made = (await ctx.log()).filter((e) => e.tool === 'createdb').map((e) => e.args);
      assert.deepEqual(made, [
        ['-T', 'app', ...strategy, 'app__original'], // the first save
        ['-T', 'app__original', ...strategy, 'app__incoming'], // swapIn
      ], `Postgres ${version}`);
      assert.equal((await ctx.log()).filter((e) => e.tool === 'psql' && e.args.includes('show server_version_num')).length, 1, 'the version is read once');
      assert.deepEqual((await ctx.pg()).app.ledger, ['0001_a', '0002_b']);
    } finally { await ctx.done(); }
  }
});

test('autoDatabase makes __auto afresh from the original and adds this branch\'s migrations with Auto\'s address', async () => {
  const ctx = await setup();
  try {
    const before = await ctx.pg();
    const r = await runAuto(ctx);
    assert.equal(r.name, 'app__auto');
    assert.equal(r.url, 'postgres://u:p@localhost:5432/app__auto?schema=public');
    assert.deepEqual(r.added, ['0002_b']);
    const entries = await ctx.log();
    assert.deepEqual(changes(entries), [
      'dropdb --if-exists --force app__auto',
      'createdb -T app__original --strategy=file_copy app__auto',
      `migrate 0002_b`,
    ]);
    assert.equal(dbOfUrl(entries.find((e) => e.tool === 'migrate').url), 'app__auto', 'DATABASE_URL names Auto\'s database');
    const after = await ctx.pg();
    assert.deepEqual(after.app__auto.ledger, ['0001_a', '0002_b']);
    assert.deepEqual(after.app, before.app, 'his database is as it was');
    assert.deepEqual(after.app__original, before.app__original, 'the saved original is as it was');
    assert.equal(ctx.local.dbBusy, false);

    // The next turn makes it afresh: the old __auto goes, and a new copy of the original comes.
    await runAuto(ctx);
    assert.deepEqual(changes(await ctx.log()).slice(3), changes(entries));
    assert.deepEqual((await ctx.pg()).app__auto.ledger, ['0001_a', '0002_b']);
  } finally { await ctx.done(); }
});

test('a copy that fails leaves the original and his database as they were, frees the switch, and the next turn builds it again', async () => {
  const ctx = await setup();
  try {
    await runAuto(ctx);
    const before = await ctx.pg();
    process.env.FAKE_PG_FAIL = 'app__auto';
    await assert.rejects(runAuto(ctx), (err) => {
      assert.ok(err instanceof AutoDbError);
      assert.equal(err.code, 'copy');
      assert.equal(err.migration, null);
      return true;
    });
    const after = await ctx.pg();
    assert.equal(after.app__auto, undefined, 'dropdb took the old copy away and createdb failed');
    assert.deepEqual(after.app, before.app);
    assert.deepEqual(after.app__original, before.app__original);
    assert.equal(ctx.local.dbBusy, false, 'the switch is free again');

    delete process.env.FAKE_PG_FAIL;
    const r = await runAuto(ctx);
    assert.deepEqual(r.added, ['0002_b']);
    assert.deepEqual((await ctx.pg()).app__auto.ledger, ['0001_a', '0002_b']);
  } finally { await ctx.done(); }
});

test('a migration that fails says which, with its last lines', async () => {
  const ctx = await setup();
  try {
    process.env.FAKE_PG_FAIL = '0002_b';
    await assert.rejects(runAuto(ctx), (err) => {
      assert.ok(err instanceof AutoDbError);
      assert.equal(err.code, 'migration');
      assert.equal(err.migration, '0002_b');
      const tail = err.tail.split('\n');
      assert.ok(tail.length <= 20, `at most 20 lines, got ${tail.length}`);
      assert.ok(err.tail.includes('error line 25'), 'the last line is there');
      assert.ok(!err.tail.includes('error line 5\n'), 'the early lines are not');
      return true;
    });
    assert.equal(ctx.local.dbBusy, false);
    delete process.env.FAKE_PG_FAIL;
  } finally { await ctx.done(); }
});

test('with no saved original and his app connected, Auto waits and stops nothing', async () => {
  const ctx = await setup({ original: false, connections: 1 });
  try {
    const stopped = [];
    ctx.local.stopServer = (slug) => { stopped.push(slug); return true; };
    const no = (err) => { assert.ok(err instanceof AutoDbError); assert.equal(err.code, 'no-original'); return true; };
    await assert.rejects(runAuto(ctx), no);

    // Nothing connected, but a Try it app is running: still no.
    const state = JSON.parse(await fs.readFile(process.env.FAKE_PG_STATE, 'utf8'));
    state.databases.app.connections = 0;
    await fs.writeFile(process.env.FAKE_PG_STATE, JSON.stringify(state));
    ctx.local.jobs.set('other', { server: { status: 'running', port: 3005 }, cmd: null });
    await assert.rejects(runAuto(ctx), no);

    assert.deepEqual(stopped, [], 'no Try it server was stopped');
    assert.deepEqual(changes(await ctx.log()), [], 'no createdb, no dropdb, no migration');
    assert.equal((await ctx.pg()).app__original, undefined);
    assert.equal(ctx.local.dbBusy, false);
  } finally { await ctx.done(); }
});

test('with no saved original and nothing connected, Auto saves the original first', async () => {
  const ctx = await setup({ original: false });
  try {
    const before = await ctx.pg();
    const r = await runAuto(ctx);
    assert.deepEqual(r.added, ['0002_b']);
    assert.deepEqual(changes(await ctx.log()), [
      'createdb -T app --strategy=file_copy app__original',
      'dropdb --if-exists --force app__auto',
      'createdb -T app__original --strategy=file_copy app__auto',
      'migrate 0002_b',
    ]);
    const after = await ctx.pg();
    assert.deepEqual(after.app, before.app, 'his database is as it was');
    assert.deepEqual(after.app__original.ledger, ['0001_a']);
  } finally { await ctx.done(); }
});

test('while Try it switches, Auto waits; while Auto copies, Try it\'s switch says it is busy', async () => {
  const ctx = await setup();
  try {
    const tryIt = ctx.local.database(ctx.f, 'match');
    while (!ctx.local.dbBusy) await new Promise((r) => setTimeout(r, 2));
    let autoDone = false;
    const auto = ctx.local.autoDatabase(ctx.f).finally(() => { autoDone = true; });
    // Where the log stands the moment Try it ends: read in the same tick, before Auto's next poll.
    const mark = await tryIt.then(() => ctx.logNow().length);
    assert.equal(autoDone, false, 'Auto is still waiting when Try it finishes');
    assert.ok(!(await ctx.log()).some((e) => e.args.at(-1) === 'app__auto'), 'Auto ran nothing while Try it switched');
    await auto;
    keepAuto((await ctx.log()).slice(mark));
    assert.ok((await ctx.pg()).app__auto, 'Auto made its copy after');

    // A switch that never ends: Auto gives up as busy, and changes nothing.
    ctx.local.dbBusy = true;
    const n = (await ctx.log()).length;
    await assert.rejects(ctx.local.autoDatabase(ctx.f, { waitMs: 50 }), (err) => err instanceof AutoDbError && err.code === 'busy');
    assert.equal((await ctx.log()).length, n);
    ctx.local.dbBusy = false;

    const start = (await ctx.log()).length;
    const p = runAuto(ctx, start);
    assert.equal(ctx.local.dbBusy, true, 'Auto holds the switch from the moment it is asked');
    await assert.rejects(ctx.local.database(ctx.f, 'match'), /already being switched/);
    await p;
    assert.equal(ctx.local.dbBusy, false);
  } finally { await ctx.done(); }
});

test('autoConnections counts what is connected to __auto', async () => {
  const ctx = await setup();
  try {
    await runAuto(ctx);
    const state = JSON.parse(await fs.readFile(process.env.FAKE_PG_STATE, 'utf8'));
    state.databases.app__auto.connections = 3;
    await fs.writeFile(process.env.FAKE_PG_STATE, JSON.stringify(state));
    const start = (await ctx.log()).length;
    assert.equal(await ctx.local.autoConnections(ctx.f), 3);
    keepAuto((await ctx.log()).slice(start));
  } finally { await ctx.done(); }
});

// Review Focus 2. Each test checks its own commands (keepAuto); this is the total over the tests above,
// so it says something only when the whole file runs.
test('no command ever targets his database or the original', () => {
  assert.ok(autoLines.length > 10, 'the tests above ran Auto');
  assert.equal(autoSaves, 1, 'the original is saved only in the test that has none and nothing connected');
});

// ---------- Task 9: the job's app and its migrate script on Auto's database ----------

const HIS_URL = 'postgres://u:p@localhost:5432/app?schema=public';
const AUTO_URL = 'postgres://u:p@localhost:5432/app__auto?schema=public';
/** Wait until the job's server answers, then GET a path of it. */
async function appGet(ctx, rel = '/') {
  for (let i = 0; i < 150; i++) {
    const s = ctx.local.jobs.get(ctx.f.slug)?.server;
    if (s?.status === 'running') return (await fetch(`${s.url}${rel}`)).text();
    if (s && !['starting', 'running'].includes(s.status)) assert.fail(`the app stopped:\n${s.output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return assert.fail(`the app never answered:\n${ctx.local.jobs.get(ctx.f.slug)?.server?.output}`);
}
const stopApp = (ctx) => ctx.local.stopServerAndWait(ctx.f.slug);
/** The database settings the fixture's migrate script and app saw: only Auto's database is named in either. */
function onlyAuto(settings, where) {
  for (const [k, v] of Object.entries(settings)) {
    if (k === 'PGDATABASE') { assert.equal(v, 'app__auto', `${where}: ${k}`); continue; }
    if (/^postgres(ql)?:/.test(v)) assert.equal(dbOfUrl(v), 'app__auto', `${where}: ${k}=${v}`);
  }
  assert.equal(dbOfUrl(settings.DATABASE_URL), 'app__auto', `${where}: DATABASE_URL`);
}
async function seenByBoth(ctx) {
  const r = await ctx.local.autoDatabase(ctx.f);
  const migrated = JSON.parse(await fs.readFile(path.join(ctx.f.worktree, 'app', 'migrate-env.json'), 'utf8'));
  onlyAuto(migrated, 'the migrate script');
  await ctx.local.startServer(ctx.f, { databaseUrl: r.url });
  try {
    onlyAuto(JSON.parse(await appGet(ctx, '/env')), 'the app');
  } finally { await stopApp(ctx); }
  assert.deepEqual((await ctx.pg()).app.ledger, ['0001_a'], 'his database is as it was');
}

test('the job\'s app uses the address Starbase gives it over the one in its settings file', async () => {
  const ctx = await setup({ fixture: true });
  try {
    const view = await ctx.local.startServer(ctx.f, { databaseUrl: 'postgres://localhost/app__auto' });
    assert.equal(view.db, 'auto');
    assert.equal(await appGet(ctx), 'postgres://localhost/app__auto');
  } finally { await stopApp(ctx); await ctx.done(); }
});

test('the migrate script uses the address Starbase gives it', async () => {
  const ctx = await setup({ fixture: true });
  try {
    const r = await ctx.local.autoDatabase(ctx.f);
    assert.deepEqual(r.added, ['0002_b']);
    assert.equal(await fs.readFile(path.join(ctx.f.worktree, 'app', 'migrated.txt'), 'utf8'), AUTO_URL);
    assert.deepEqual((await ctx.pg()).app__auto.ledger, ['0001_a', '0002_b']);
    assert.deepEqual((await ctx.pg()).app.ledger, ['0001_a']);
  } finally { await ctx.done(); }
});

test('without an address the app uses its settings file', async () => {
  const ctx = await setup({ fixture: true });
  try {
    const view = await ctx.local.startServer(ctx.f);
    assert.equal(view.db, undefined);
    assert.equal(await appGet(ctx), 'postgres://localhost/app');
  } finally { await stopApp(ctx); await ctx.done(); }
});

test('a migration that exits clean but did not land on Auto\'s copy stops the turn', async () => {
  const ctx = await setup();
  try {
    await fs.mkdir(path.join(ctx.f.worktree, 'app', 'prisma', 'migrations', '0003_c'), { recursive: true });
    process.env.FAKE_PG_SILENT = '0002_b';
    await assert.rejects(ctx.local.autoDatabase(ctx.f), (err) => {
      assert.ok(err instanceof AutoDbError);
      assert.equal(err.code, 'not-landed');
      assert.equal(err.migration, '0002_b');
      assert.equal(err.message, '0002_b did not land on Auto\'s copy of the database, so nothing more was applied.');
      return true;
    });
    assert.deepEqual((await ctx.log()).filter((e) => e.tool === 'migrate').map((e) => e.args.at(-1)), ['0002_b'], 'nothing more was applied');
    assert.equal(ctx.local.dbBusy, false);
  } finally { delete process.env.FAKE_PG_SILENT; await ctx.done(); }
});

test('only Auto\'s database reaches the migrate script and the app: a profile key that is not DATABASE_URL', async () => {
  const theirs = 'POSTGRES_URL=postgres://u:p@localhost:5432/app?schema=public\n';
  const ctx = await setup({ fixture: true, profile: { ...APP_PROFILE, database: { urlKey: 'POSTGRES_URL' } }, settings: theirs, appSettings: theirs });
  const had = process.env.DATABASE_URL;
  process.env.DATABASE_URL = HIS_URL; // in Starbase's own environment: the script reads DATABASE_URL
  try {
    await seenByBoth(ctx);
  } finally { if (had === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = had; await ctx.done(); }
});

test('only Auto\'s database reaches the migrate script and the app: a DIRECT_URL line in his settings file', async () => {
  const theirs = `DATABASE_URL=${HIS_URL}\nDIRECT_URL="postgres://u:p@127.0.0.1:5432/app"\nOTHER_DB=postgres://u:p@localhost:5433/app\n`;
  const ctx = await setup({ fixture: true, settings: theirs, appSettings: theirs });
  try {
    await seenByBoth(ctx);
    // His database's name on another server is changed too (fix round 1, C2): at worst that connection fails.
    const view = await ctx.local.startServer(ctx.f, { databaseUrl: AUTO_URL });
    try {
      assert.equal(view.db, 'auto');
      const seen = JSON.parse(await appGet(ctx, '/env'));
      assert.equal(seen.DIRECT_URL, 'postgres://u:p@127.0.0.1:5432/app__auto');
      assert.equal(seen.OTHER_DB, 'postgres://u:p@localhost:5433/app__auto');
    } finally { await stopApp(ctx); }
  } finally { await ctx.done(); }
});

test('only Auto\'s database reaches the migrate script and the app: an inherited PGDATABASE and an inherited address of his database', async () => {
  const ctx = await setup({ fixture: true });
  process.env.PGDATABASE = 'app';
  process.env.TEST_HIS_DB_URL = 'postgresql://u:p@localhost/app';
  try {
    await seenByBoth(ctx);
    await ctx.local.startServer(ctx.f, { databaseUrl: AUTO_URL });
    try {
      assert.equal(JSON.parse(await appGet(ctx, '/env')).TEST_HIS_DB_URL, undefined, 'left out');
    } finally { await stopApp(ctx); }
  } finally { delete process.env.PGDATABASE; delete process.env.TEST_HIS_DB_URL; await ctx.done(); }
});

test('a failing migration\'s words never carry the address or its password', async () => {
  const theirs = 'DATABASE_URL=postgres://u:s3cret-pw@localhost:5432/app?schema=public\n';
  const ctx = await setup({ settings: theirs });
  try {
    process.env.FAKE_PG_FAIL = '0002_b';
    await assert.rejects(ctx.local.autoDatabase(ctx.f), (err) => {
      assert.equal(err.code, 'migration');
      assert.match(err.tail, /could not apply on <database address>/, 'the fake printed its address');
      for (const text of [err.tail, err.message]) {
        assert.doesNotMatch(text, /s3cret-pw|postgres:\/\/|app__auto\?/);
      }
      return true;
    });
  } finally { delete process.env.FAKE_PG_FAIL; await ctx.done(); }
});

test('an app with no database Starbase can copy is no-database, and nothing runs', async () => {
  const ctx = await setup();
  try {
    await fs.writeFile(path.join(ctx.f.worktree, 'app', 'package.json'), JSON.stringify({ name: 'app', scripts: { dev: 'next dev' } }));
    await assert.rejects(ctx.local.autoDatabase(ctx.f), (err) => err instanceof AutoDbError && err.code === 'no-database');
    assert.deepEqual(await ctx.log(), []);
    assert.equal(ctx.local.dbBusy, false);
  } finally { await ctx.done(); }
});

test('with Auto\'s address, his Try it server already running for the job is refused and left running', async () => {
  const ctx = await setup({ fixture: true });
  try {
    await ctx.local.startServer(ctx.f);
    assert.equal(await appGet(ctx), 'postgres://localhost/app');
    await assert.rejects(ctx.local.startServer(ctx.f, { databaseUrl: AUTO_URL }), (err) => err.message === AUTO_TRY_IT_RUNNING);
    assert.equal(ctx.local.jobs.get(ctx.f.slug).server.status, 'running', 'his server is left running');
    assert.equal(await appGet(ctx), 'postgres://localhost/app');
  } finally { await stopApp(ctx); await ctx.done(); }
});

test('his database switch leaves an app on Auto\'s database running', async () => {
  const ctx = await setup({ fixture: true });
  try {
    await ctx.local.startServer(ctx.f, { databaseUrl: AUTO_URL });
    await appGet(ctx);
    await ctx.local.database(ctx.f, 'match');
    assert.equal(ctx.local.jobs.get(ctx.f.slug).server.status, 'running');
    assert.deepEqual((await ctx.pg()).app.ledger, ['0001_a', '0002_b'], 'his switch went ahead');
  } finally { await stopApp(ctx); await ctx.done(); }
});

// ---------- Task 8 fix round 1: time limits, the lock's re-check, and the review's Minors ----------

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
async function patchState(change) {
  const s = JSON.parse(await fs.readFile(process.env.FAKE_PG_STATE, 'utf8'));
  change(s);
  await fs.writeFile(process.env.FAKE_PG_STATE, JSON.stringify(s));
}
/** Whether the process is gone within 3 seconds. */
async function goneSoon(pid) {
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch { return true; }
    await sleep(30);
  }
  return false;
}
const lastPid = async (ctx, tool) => (await ctx.log()).findLast((e) => e.tool === tool).pid;

test('a Postgres tool that runs past the time limit is stopped, the turn ends as copy, and the switch is free', async () => {
  const ctx = await setup({ autoStepMs: 1000 });
  try {
    for (const hang of ['dropdb:app__auto', 'createdb:app__auto', 'psql:app__auto']) {
      process.env.FAKE_PG_HANG = hang;
      await assert.rejects(runAuto(ctx), (err) => {
        assert.ok(err instanceof AutoDbError, hang);
        assert.equal(err.code, 'copy', hang);
        assert.match(err.message, /took longer than 1 second.* was stopped\./, hang);
        return true;
      });
      assert.equal(ctx.local.dbBusy, false, `${hang}: the switch is free`);
      assert.ok(await goneSoon(await lastPid(ctx, hang.split(':')[0])), `${hang}: the program is gone`);
    }
    delete process.env.FAKE_PG_HANG;
    assert.deepEqual((await runAuto(ctx)).added, ['0002_b'], 'the next turn runs');
    await ctx.local.database(ctx.f, 'match');
    assert.deepEqual((await ctx.pg()).app.ledger, ['0001_a', '0002_b'], 'his switch runs');
  } finally { delete process.env.FAKE_PG_HANG; await ctx.done(); }
});

test('a migrate script that runs past the time limit is stopped with what it started, the turn ends as migration, and the switch is free', async () => {
  const ctx = await setup({ autoStepMs: 2000 });
  try {
    process.env.FAKE_PG_HANG = 'migrate:0002_b';
    await assert.rejects(runAuto(ctx), (err) => {
      assert.ok(err instanceof AutoDbError);
      assert.equal(err.code, 'migration');
      assert.equal(err.migration, '0002_b');
      assert.equal(err.message, 'Adding 0002_b to Auto’s database took longer than 2 seconds, so it was stopped.');
      return true;
    });
    assert.equal(ctx.local.dbBusy, false);
    // The script runs under npm and a shell: the whole group is stopped, the script with it.
    assert.ok(await goneSoon(await lastPid(ctx, 'migrate')), 'the migrate script is gone');
    delete process.env.FAKE_PG_HANG;
    assert.deepEqual((await runAuto(ctx)).added, ['0002_b'], 'the next turn runs');
    await ctx.local.database(ctx.f, 'match');
    assert.deepEqual((await ctx.pg()).app.ledger, ['0001_a', '0002_b'], 'his switch runs');
  } finally { delete process.env.FAKE_PG_HANG; await ctx.done(); }
});

test('Try it\'s own switch has no time limit', async () => {
  const ctx = await setup({ autoStepMs: 200 });
  try {
    process.env.FAKE_PG_SLOW = 'createdb:app__incoming'; // 1 s, past Auto's limit
    await ctx.local.database(ctx.f, 'match');
    assert.deepEqual((await ctx.pg()).app.ledger, ['0001_a', '0002_b']);
  } finally { delete process.env.FAKE_PG_SLOW; await ctx.done(); }
});

test('a Try it switch asked for just before Auto\'s turn is refused once Auto holds the switch, and runs nothing', async () => {
  const ctx = await setup();
  try {
    const tryIt = ctx.local.database(ctx.f, 'match'); // passes its first check, then reads the job's folders
    const auto = runAuto(ctx, 0); // in the same tick: Auto takes the switch while Try it reads
    await assert.rejects(tryIt, (err) => err.message === 'The database is already being switched. Wait for it to finish.');
    await auto;
    const tryItRan = (await ctx.log()).filter((e) => e.args.includes('app__incoming') || (e.tool === 'psql' && e.args[e.args.indexOf('-d') + 1] === 'app'));
    assert.deepEqual(tryItRan, [], 'Try it made no Postgres call');
    assert.equal(ctx.local.dbBusy, false);
    await ctx.local.database(ctx.f, 'match');
    assert.deepEqual((await ctx.pg()).app.ledger, ['0001_a', '0002_b'], 'after Auto\'s copy, his switch works');
  } finally { await ctx.done(); }
});

test('the file copy is decided for each server', async () => {
  const ctx = await setup();
  try {
    await patchState((s) => { s.versionByPort = { 5433: 140011 }; });
    const older = path.join(ctx.root, 'main-older');
    await fs.mkdir(path.join(older, 'app'), { recursive: true });
    await fs.writeFile(path.join(older, 'app', '.env.local'), 'DATABASE_URL=postgres://u:p@localhost:5433/app\n');
    await runAuto(ctx);
    const start = (await ctx.log()).length;
    await runAuto({ ...ctx, f: { ...ctx.f, slug: 'y', repoPath: older } }, start);
    assert.deepEqual((await ctx.log()).filter((e) => e.tool === 'createdb').map(line), [
      'createdb -T app__original --strategy=file_copy app__auto', // Postgres 17 on 5432
      'createdb -T app__original app__auto', // Postgres 14 on 5433
    ]);
  } finally { await ctx.done(); }
});

test('the file copy needs createdb 15 or later too', async () => {
  const ctx = await setup();
  try {
    await patchState((s) => { s.clientVersion = '14.9'; });
    await runAuto(ctx);
    await ctx.local.database(ctx.f, 'match');
    const made = (await ctx.log()).filter((e) => e.tool === 'createdb').map(line);
    assert.deepEqual(made, ['createdb -T app__original app__auto', 'createdb -T app__original app__incoming']);
  } finally { await ctx.done(); }
});

test('when the server\'s version can\'t be read, Try it switches with the default copy and Auto stops as copy', async () => {
  const ctx = await setup({ version: 'fail' });
  try {
    await ctx.local.database(ctx.f, 'match');
    assert.deepEqual((await ctx.log()).filter((e) => e.tool === 'createdb').map(line), ['createdb -T app__original app__incoming']);
    assert.deepEqual((await ctx.pg()).app.ledger, ['0001_a', '0002_b']);
    await assert.rejects(runAuto(ctx), (err) => err instanceof AutoDbError && err.code === 'copy');
  } finally { await ctx.done(); }
});

test('an original with no applied_migrations table is no-database, and no migration runs', async () => {
  const ctx = await setup();
  try {
    await patchState((s) => { s.databases.app__original.ledger = null; });
    await assert.rejects(runAuto(ctx), (err) => {
      assert.ok(err instanceof AutoDbError);
      assert.equal(err.code, 'no-database');
      assert.equal(err.message, 'The saved original of app has no applied_migrations table, so Starbase can’t tell which changes Auto’s copy needs.');
      return true;
    });
    assert.ok(!(await ctx.log()).some((e) => e.tool === 'migrate'));
    assert.equal(ctx.local.dbBusy, false);
  } finally { await ctx.done(); }
});

test('autoConnections in demo mode runs nothing', async () => {
  const ctx = await setup();
  try {
    const demo = new LocalRunner({ state: new State(path.join(ctx.root, 'demo-state')), demo: true, pgTool: async (name) => path.join(FAKES, name) });
    await assert.rejects(demo.autoConnections(ctx.f), /Demo mode/);
    assert.deepEqual(await ctx.log(), []);
  } finally { await ctx.done(); }
});

test('Try it\'s panel hears when Auto takes the switch and when it frees it', async () => {
  const ctx = await setup();
  try {
    const seen = [];
    ctx.local.on('changed', (e) => { if (e.slug === ctx.f.slug) seen.push(ctx.local.dbBusy); });
    await runAuto(ctx);
    assert.equal(seen[0], true, 'when Auto takes it');
    assert.equal(seen.at(-1), false, 'when Auto frees it');
  } finally { await ctx.done(); }
});

// ---------- Task 9 fix round 1 ----------

const ENV_FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'auto-db-env');
/** Copies fixtures/auto-db-env's dot-env… files into the test's checkouts as .env… (main/ is his, wt/ the job's). */
async function placeEnvFiles(ctx) {
  for (const [from, to] of [['main', ctx.f.repoPath], ['wt', ctx.f.worktree]]) {
    for (const sub of ['', 'app']) {
      const dir = path.join(ENV_FIXTURES, from, sub);
      for (const name of await fs.readdir(dir).catch(() => [])) {
        if (name.startsWith('dot-env')) await fs.copyFile(path.join(dir, name), path.join(to, sub, name.replace(/^dot-env/, '.env')));
      }
    }
  }
}
// What each odd form in the fixture files becomes in the child's environment: his database's name, Auto's instead.
const REWRITTEN = {
  SHADOW_DATABASE_URL: 'postgres://u:p@0.0.0.0:5432/app__auto', // main checkout's app/.env.development, another host
  POSTGRES_DB: 'app__auto', // a bare name
  DIRECT_URL: 'postgresql:///app__auto?host=/tmp', // a socket
  REPLICA_URL: 'postgres://u:p@db.example.test:6543/other?dbname=app__auto', // ?dbname= wins over the path
  CONNINFO: 'host=localhost port=5432 dbname=app__auto user=u', // a conninfo
  JDBC_URL: 'jdbc:postgresql://localhost:5432/app__auto', // the worktree root's .env.development
  OTHER_DB_URL: 'postgres://u:p@localhost:5432/app2', // another database: left as it is
};

test('every settings file of both checkouts is read: each way of naming his database reaches the migrate script and the app as Auto\'s, and PGSERVICE is dropped', async () => {
  const ctx = await setup({ fixture: true });
  process.env.PGSERVICE = 'his';
  process.env.PGSERVICEFILE = '/nowhere/pg_service.conf';
  try {
    await placeEnvFiles(ctx);
    const r = await ctx.local.autoDatabase(ctx.f);
    const migrated = JSON.parse(await fs.readFile(path.join(ctx.f.worktree, 'app', 'migrate-env.json'), 'utf8'));
    await ctx.local.startServer(ctx.f, { databaseUrl: r.url });
    let app;
    try { app = JSON.parse(await appGet(ctx, '/env')); } finally { await stopApp(ctx); }
    for (const [where, seen] of [['the migrate script', migrated], ['the app', app]]) {
      for (const [k, v] of Object.entries(REWRITTEN)) assert.equal(seen[k], v, `${where}: ${k}`);
      assert.equal(seen.PGSERVICE, undefined, `${where}: PGSERVICE`);
      assert.equal(seen.PGSERVICEFILE, undefined, `${where}: PGSERVICEFILE`);
      assert.equal(seen.PGDATABASE, 'app__auto', where);
    }
    assert.deepEqual((await ctx.pg()).app.ledger, ['0001_a'], 'his database is as it was');
  } finally { delete process.env.PGSERVICE; delete process.env.PGSERVICEFILE; await ctx.done(); }
});

test('namesADatabase: an address in any settings file, or the database key set, says the app has a database; none says it has none', async () => {
  const ctx = await setup({ fixture: true, appSettings: 'NEXT_PUBLIC_X=1\n', settings: 'OTHER=1\n' });
  try {
    assert.equal(await ctx.local.namesADatabase(ctx.f), false, 'no address anywhere');
    await fs.writeFile(path.join(ctx.f.worktree, 'app', '.env'), 'SOMETHING="host=/tmp dbname=app"\n');
    assert.equal(await ctx.local.namesADatabase(ctx.f), true, 'a conninfo in the job\'s .env');
    await fs.writeFile(path.join(ctx.f.worktree, 'app', '.env'), 'DATABASE_URL=anything\n');
    assert.equal(await ctx.local.namesADatabase(ctx.f), true, 'the key set');
  } finally { await ctx.done(); }
});

test('his Try it Start while the app runs on Auto\'s database is refused with the line, and the app is left as it was', async () => {
  const { AUTO_RECORDING_APP } = await import('../lib/local.js');
  assert.equal(AUTO_RECORDING_APP, 'Auto is recording this job on its own copy of the database. Start Try it when the recording ends.');
  const ctx = await setup({ fixture: true });
  try {
    await ctx.local.startServer(ctx.f, { databaseUrl: AUTO_URL });
    assert.equal(await appGet(ctx), AUTO_URL);
    await assert.rejects(ctx.local.startServer(ctx.f), (err) => err.message === AUTO_RECORDING_APP);
    assert.equal(ctx.local.jobs.get(ctx.f.slug).server.db, 'auto');
    assert.equal(ctx.local.jobs.get(ctx.f.slug).server.status, 'running');
  } finally { await stopApp(ctx); await ctx.done(); }
});

test('startServer starts an app only on Auto\'s own copy: any other address is refused and nothing starts', async () => {
  const ctx = await setup({ fixture: true });
  try {
    for (const url of ['postgres://u:p@localhost:5432/app', 'postgres://u:p@localhost:5433/app__auto', 'postgres://u:p@elsewhere.test:5432/app__auto', 'not an address']) {
      await assert.rejects(ctx.local.startServer(ctx.f, { databaseUrl: url }), /isn’t the address of Auto’s copy/, url);
    }
    assert.equal(ctx.local.jobs.get(ctx.f.slug)?.server ?? null, null);
  } finally { await ctx.done(); }
});

test('two starts at once for one job start one app', async () => {
  const ctx = await setup({ fixture: true });
  try {
    const [a, b] = await Promise.allSettled([ctx.local.startServer(ctx.f, { databaseUrl: AUTO_URL }), ctx.local.startServer(ctx.f)]);
    assert.equal(a.status, 'fulfilled');
    assert.equal(b.status, 'rejected', 'his start finds the app on Auto\'s database and is refused');
    assert.equal(await appGet(ctx), AUTO_URL, 'the one app is the first start\'s');
  } finally { await stopApp(ctx); await ctx.done(); }
});

test('a short password printed by a tool is blanked however it is printed', async () => {
  const { blankAddresses } = await import('../lib/local.js');
  const out = blankAddresses('PGPASSWORD=ab ok; password: "c d"; password=zz; postgres:\\/\\/u:pw@h\\/app; nothing else');
  assert.doesNotMatch(out, /=ab|c d|=zz|u:pw/);
  assert.match(out, /nothing else/);
});

test('hisBackends reads the backends on his database through the admin database only', async () => {
  const ctx = await setup({ connections: 2 });
  try {
    assert.deepEqual(await ctx.local.hisBackends(ctx.f), ['app-1', 'app-2']);
    const reads = (await ctx.log()).filter((e) => e.tool === 'psql');
    assert.ok(reads.length > 0 && reads.every((e) => e.args[e.args.indexOf('-d') + 1] === 'postgres'));
  } finally { await ctx.done(); }
});
