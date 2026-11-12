// Auto's own database copy, and the fast copy for Try it (lib/local.js). The Postgres tools are the
// fakes in fixtures/fake-pg: no test here touches a real Postgres server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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
async function setup({ version = 170000, original = true, connections = 0, fixture = false, profile = null, settings = null, appSettings = 'DATABASE_URL=postgres://localhost/app\n' } = {}) {
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
  delete process.env.FAKE_PG_FAIL;
  profile ??= fixture ? APP_PROFILE : PROFILE;
  const registry = { profileFor: async () => ({ ok: true, profile, file: path.join(repo, 'starbase.md'), source: 'repo' }) };
  const local = new LocalRunner({ state: new State(path.join(root, 'state')), registry, pgTool: async (name) => path.join(FAKES, name) });
  const f = { slug: 'x', title: 'X', worktree: wt, repoPath: repo, branch: 'feature/x' };
  const log = async () => (await fs.readFile(logFile, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const pg = async () => JSON.parse(await fs.readFile(stateFile, 'utf8')).databases;
  const done = () => fs.rm(root, { recursive: true, force: true });
  return { root, local, f, log, pg, done };
}

// Runs autoDatabase and keeps the commands it ran (from `from` on) for the last test.
async function runAuto(ctx, from = null) {
  const start = from ?? (await ctx.log()).length;
  try { return await ctx.local.autoDatabase(ctx.f); } finally { autoLines.push(...(await ctx.log()).slice(start)); }
}

const line = (e) => [e.tool, ...e.args].join(' ');
const dbOfUrl = (url) => (url ? decodeURIComponent(new URL(url).pathname.slice(1)) : null);
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
    await tryIt;
    assert.equal(autoDone, false, 'Auto is still waiting when Try it finishes');
    const mark = (await ctx.log()).length;
    assert.ok(!(await ctx.log()).some((e) => e.args.at(-1) === 'app__auto'), 'Auto ran nothing while Try it switched');
    await auto;
    autoLines.push(...(await ctx.log()).slice(mark));
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
    autoLines.push(...(await ctx.log()).slice(start));
  } finally { await ctx.done(); }
});

// Review Focus 2. Declared last so it reads the commands from every test above.
test('no command ever targets his database or the original', () => {
  assert.ok(autoLines.length > 10, 'the tests above ran Auto');
  const saves = [];
  for (const e of autoLines) {
    const where = line(e);
    if (e.tool === 'createdb') {
      const to = e.args.at(-1);
      const from = e.args[e.args.indexOf('-T') + 1];
      // The one exception: saving the original when there is none (createdb refuses an existing name).
      if (from === 'app' && to === 'app__original') { saves.push(where); continue; }
      assert.ok(!HIS.includes(to), where);
    }
    if (e.tool === 'dropdb') assert.ok(!HIS.includes(e.args.at(-1)), where);
    if (e.tool === 'migrate') assert.ok(!HIS.includes(dbOfUrl(e.url)), where);
    if (e.tool === 'psql') {
      assert.ok(!HIS.includes(e.args[e.args.indexOf('-d') + 1]), `Auto never connects to them: ${where}`);
      assert.ok(!/\b(alter|drop|create)\b/i.test(e.args.at(-1)), `Auto changes nothing through psql: ${where}`);
    }
  }
  assert.equal(saves.length, 1, 'the original is saved only in the test that has none and nothing connected');
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
// An address on another server (port 5433 here) isn't his: it is left as it is.
function onlyAuto(settings, where) {
  for (const [k, v] of Object.entries(settings)) {
    if (/^postgres(ql)?:/.test(v) && new URL(v).port === '5433') continue;
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
    // An address on another server isn't his: it is left as it is.
    const view = await ctx.local.startServer(ctx.f, { databaseUrl: AUTO_URL });
    try {
      assert.equal(view.db, 'auto');
      const seen = JSON.parse(await appGet(ctx, '/env'));
      assert.equal(seen.DIRECT_URL, 'postgres://u:p@127.0.0.1:5432/app__auto');
      assert.equal(seen.OTHER_DB, 'postgres://u:p@localhost:5433/app');
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
