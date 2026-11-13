// Auto's own database copy, and the fast copy for Try it (lib/local.js). The Postgres tools are the
// fakes in fixtures/fake-pg: no test here touches a real Postgres server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sandboxProfile } from '../lib/db-door.js';
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
// autoStepMs: the runner's time limit on each of Auto's database steps. sandboxWorks: the runner's
// answer to "can this computer fence a program off from his database" (the real self-test by default).
async function setup({ version = 170000, original = true, connections = 0, fixture = false, profile = null, settings = null, appSettings = 'DATABASE_URL=postgres://localhost/app\n', autoStepMs = undefined, sandboxWorks = undefined } = {}) {
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
  const local = new LocalRunner({ state: new State(path.join(root, 'state')), registry, pgTool: async (name) => path.join(FAKES, name), ...(autoStepMs ? { autoStepMs } : {}), ...(sandboxWorks ? { sandboxWorks } : {}) });
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
/**
 * Auto's address as the app and the migrate script get it since fix round 4: through the door
 * (127.0.0.1 and the port Starbase gave them as PGPORT), never his server's own. seen: their
 * database settings (GET /env, migrate-env.json).
 */
const viaDoor = (seen, { scheme = 'postgres', login = 'u:p', query = 'schema=public' } = {}) => `${scheme}://${login ? `${login}@` : ''}127.0.0.1:${seen.PGPORT}/app__auto?${query ? `${query}&` : ''}sslmode=disable`;
const migrateEnv = async (ctx) => JSON.parse(await fs.readFile(path.join(ctx.f.worktree, 'app', 'migrate-env.json'), 'utf8'));
const appEnv = async (ctx) => JSON.parse(await appGet(ctx, '/env'));
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
    assert.equal(await appGet(ctx), viaDoor(await appEnv(ctx), { login: '', query: '' }));
  } finally { await stopApp(ctx); await ctx.done(); }
});

test('the migrate script uses the address Starbase gives it', async () => {
  const ctx = await setup({ fixture: true });
  try {
    const r = await ctx.local.autoDatabase(ctx.f);
    assert.deepEqual(r.added, ['0002_b']);
    assert.equal(await fs.readFile(path.join(ctx.f.worktree, 'app', 'migrated.txt'), 'utf8'), viaDoor(await migrateEnv(ctx)));
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
    // His database's name on another server names the door too (fix round 4): it is Auto's copy or nothing.
    const view = await ctx.local.startServer(ctx.f, { databaseUrl: AUTO_URL });
    try {
      assert.equal(view.db, 'auto');
      const seen = await appEnv(ctx);
      assert.equal(seen.DIRECT_URL, viaDoor(seen, { query: '' }));
      assert.equal(seen.OTHER_DB, viaDoor(seen, { query: '' }));
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
      // Fix round 3 (S3.6): one that can be pointed at Auto's copy is, rather than left out.
      const seen = await appEnv(ctx);
      assert.equal(seen.TEST_HIS_DB_URL, viaDoor(seen, { scheme: 'postgresql', query: '' }), 'rewritten');
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
/**
 * Copies fixtures/auto-db-env/<from>'s dot-env… files (every folder down) into a checkout as .env…; a
 * name ending in .crlf is written with \r\n line ends (git keeps the fixtures LF).
 */
async function copyEnvTree(from, to) {
  for (const e of await fs.readdir(from, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) { await fs.mkdir(path.join(to, e.name), { recursive: true }); await copyEnvTree(path.join(from, e.name), path.join(to, e.name)); continue; }
    if (!e.name.startsWith('dot-env')) continue;
    const crlf = e.name.endsWith('.crlf');
    const name = e.name.replace(/\.crlf$/, '').replace(/^dot-env/, '.env');
    const text = await fs.readFile(path.join(from, e.name), 'utf8');
    await fs.writeFile(path.join(to, name), crlf ? text.replace(/\n/g, '\r\n') : text);
  }
}
async function placeEnvFiles(ctx) {
  await copyEnvTree(path.join(ENV_FIXTURES, 'main'), ctx.f.repoPath);
  await copyEnvTree(path.join(ENV_FIXTURES, 'wt'), ctx.f.worktree);
}
// What each form in the fixture files becomes in the child's environment: the door and Auto's copy
// (fix round 4), with the value's own scheme and login. <door> stands for the port each child got as PGPORT.
const DOOR = '127.0.0.1:<door>/app__auto?sslmode=disable';
const REWRITTEN = {
  SHADOW_DATABASE_URL: `postgres://u:p@${DOOR}`, // main checkout's app/.env.development
  POSTGRES_DB: 'app__auto', // a bare name
  DIRECT_URL: `postgresql://${DOOR}`, // a socket (?host=/tmp): the door instead
  REPLICA_URL: `postgres://u:p@${DOOR}`, // ?dbname= naming his, on another host: the door, with its own login
  CONNINFO: 'user=u host=127.0.0.1 port=<door> dbname=app__auto sslmode=disable', // a conninfo
  JDBC_URL: `jdbc:postgresql://${DOOR}`, // the worktree root's .env.development
  OTHER_DB_URL: 'postgres://u:p@localhost:5432/app2', // another database: left as it is
};

test('his Try it Start while the app runs on Auto\'s database is refused with the line, and the app is left as it was', async () => {
  const { AUTO_RECORDING_APP } = await import('../lib/local.js');
  assert.equal(AUTO_RECORDING_APP, 'Auto is recording this job on its own copy of the database. Start Try it when the recording ends.');
  const ctx = await setup({ fixture: true });
  try {
    await ctx.local.startServer(ctx.f, { databaseUrl: AUTO_URL });
    assert.equal(await appGet(ctx), viaDoor(await appEnv(ctx)));
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
    assert.equal(await appGet(ctx), viaDoor(await appEnv(ctx)), 'the one app is the first start\'s');
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

// ---------- Task 9 fix round 2: fail closed ----------

// The fixture files' forms (fixtures/auto-db-env), each as the migrate script and the app see it: Auto's.
const ROUND2 = {
  BACKTICK_URL: `postgres://u:p@${DOOR}`, // C2 #2, backtick quotes
  PSYCOPG_URL: `postgresql+psycopg2://u:p@${DOOR}`, // #4
  POSTGIS_URL: `postgis://u:p@${DOOR}`, // #4
  PGSQL_URL: `pgsql://${DOOR}`, // #4
  PG_NAME: 'app__auto', // #11, a bare name under a key that looks like a database's
  POSTGRES_NAME: 'app__auto', // #11
  // #12, ${PG_NAME}: filled in with the file's own PG_NAME it names his database, so it is set too (fix round 4).
  EXPANDED_URL: `postgres://u@${DOOR}`,
  PRISMA_DIRECT_URL: `postgres://u:p@${DOOR}`, // #13, app/prisma/.env
  COLON_URL: `postgres://u:p@${DOOR}`, // #16, KEY: value
  REMOTE_URL: `postgres://x:y@${DOOR}`, // his name on a remote host: the door, never the remote one
  PGSERVICE: undefined, // #19, in a .env file: never passed on (fix round 3, S7)
  PGSERVICEFILE: undefined, // removed (fix round 4)
  ...REWRITTEN,
};
let seenOnce = null;
/** One Auto turn and one app start over all the fixture files (the .env.test file has \r\n line ends: C2 #15). */
function seenRound2() {
  seenOnce ??= (async () => {
    const ctx = await setup({ fixture: true });
    try {
      await placeEnvFiles(ctx);
      const r = await ctx.local.autoDatabase(ctx.f);
      const migrated = JSON.parse(await fs.readFile(path.join(ctx.f.worktree, 'app', 'migrate-env.json'), 'utf8'));
      await ctx.local.startServer(ctx.f, { databaseUrl: r.url });
      let app;
      try { app = JSON.parse(await appGet(ctx, '/env')); } finally { await stopApp(ctx); }
      return { migrated, app, his: (await ctx.pg()).app.ledger };
    } finally { await ctx.done(); }
  })();
  return seenOnce;
}
for (const [key, want] of Object.entries(ROUND2)) {
  test(`every settings file is read the way dotenv reads it: ${key} reaches the migrate script and the app as ${want === undefined ? 'nothing Starbase set' : want}`, async () => {
    const seen = await seenRound2();
    const through = (child) => want?.replace('<door>', child.PGPORT); // each child's own door
    assert.match(String(seen.migrated.PGPORT), /^\d+$/);
    assert.match(String(seen.app.PGPORT), /^\d+$/);
    assert.equal(seen.migrated[key], through(seen.migrated), `the migrate script: ${key}`);
    assert.equal(seen.app[key], through(seen.app), `the app: ${key}`);
    assert.deepEqual(seen.his, ['0001_a'], 'his database is as it was');
  });
}

/** An Auto turn with one more fixture file placed in the worktree's app folder as .env. */
async function turnWith(fixture, opts = {}) {
  const ctx = await setup({ fixture: true, ...opts });
  await fs.copyFile(path.join(ENV_FIXTURES, fixture), path.join(ctx.f.worktree, 'app', '.env'));
  return ctx;
}
// Fix round 4: these refused the turn until the guarantee moved to the sandbox and the door (the
// fixtures' folder is still named refuse/). Now the copy is made and the app starts: a setting the
// reader misses can only make the app fail to connect.
for (const [fixture, key, left, row] of [
  ['refuse/jdbc-short.dot-env', 'LEGACY_JDBC', 'jdbc:postgresql:app', '#5 jdbc:postgresql:<name>'],
  ['refuse/socket.dot-env', 'PG_SOCKET', 'socket:/tmp?db=app', '#7 socket:/tmp?db=<name>'],
  ['refuse/space-form.dot-env', 'PG_CONN', '/tmp app', '#7 "/tmp <name>"'],
  ['refuse/loose-line.dot-env', null, null, 'a line that is no KEY=value'],
  // NI1: a role named like its database, in an address that is not the profile's key.
  ['ok/docker.dot-env', 'POSTGRES_DB', 'app__auto', 'the Docker-style login named like the database'],
]) {
  test(`17. a setting the reader can't point at Auto's copy no longer stops the recording: ${row}`, async () => {
    const ctx = await turnWith(fixture);
    try {
      assert.deepEqual((await ctx.local.autoDatabase(ctx.f)).added, ['0002_b'], 'the copy is made and the migration added');
      const view = await ctx.local.startServer(ctx.f, { databaseUrl: AUTO_URL });
      try {
        assert.equal(view.db, 'auto');
        const seen = await appEnv(ctx);
        assert.equal(await appGet(ctx), viaDoor(seen), 'the app runs on Auto\'s copy, through the door');
        if (key) assert.equal(seen[key], left, `${key} is as the reader leaves it`);
        if (fixture === 'ok/docker.dot-env') assert.equal(seen.DIRECT_URL, viaDoor(seen, { scheme: 'postgresql', login: 'app:app', query: '' }), 'the role keeps its name, the database is Auto\'s');
      } finally { await stopApp(ctx); }
      assert.deepEqual((await ctx.pg()).app.ledger, ['0001_a'], 'his database is as it was');
    } finally { await ctx.done(); }
  });
}

for (const [fixture, what] of [['ok/commented.dot-env', 'a commented-out address'], ['ok/nextauth.dot-env', 'NEXTAUTH_URL=http://app.localhost:3000']]) {
  test(`${what} does not refuse`, async () => {
    const ctx = await turnWith(fixture);
    try {
      assert.deepEqual((await ctx.local.autoDatabase(ctx.f)).added, ['0002_b']);
    } finally { await ctx.done(); }
  });
}

test('a settings file Starbase can\'t read refuses the turn', async () => {
  const ctx = await turnWith('ok/nextauth.dot-env');
  const file = path.join(ctx.f.worktree, 'app', '.env');
  try {
    await fs.chmod(file, 0o000);
    await assert.rejects(ctx.local.autoDatabase(ctx.f), (err) => err.code === 'no-database' && err.message === 'Auto could not read the job\'s app/.env, so it made no recording.');
    assert.deepEqual(changes(await ctx.log()), []);
  } finally { await fs.chmod(file, 0o600); await ctx.done(); }
});

test('C2 #11, the decision: an app set up by parts (DB_HOST, DB_NAME) with no database key in the profile takes Auto\'s path and says where it saw a database', async () => {
  const noKey = { ...APP_PROFILE, database: undefined };
  const ctx = await turnWith('parts/dot-env', { profile: noKey, settings: 'OTHER=1\n', appSettings: 'X=1\n' });
  try {
    assert.equal(await ctx.local.namesADatabase(ctx.f, {}), true);
    await assert.rejects(ctx.local.autoDatabase(ctx.f, { env: {} }), (err) => err.code === 'no-database'
      && err.message === 'This job’s app looks like it uses a database (the job\'s app/.env, DB_HOST), but Starbase does not know which one, so Auto made no recording.');
    assert.deepEqual(await ctx.log(), [], 'nothing ran');
  } finally { await ctx.done(); }
});

test('namesADatabase: the profile\'s key, a database-like line in any file (a CRLF one too), or Starbase\'s own environment; none of them, none', async () => {
  const noKey = { ...APP_PROFILE, database: undefined };
  const ctx = await setup({ fixture: true, profile: noKey, settings: 'OTHER=1\n', appSettings: 'NEXT_PUBLIC_X=1\n' });
  try {
    assert.equal(await ctx.local.namesADatabase(ctx.f, {}), false, 'nothing anywhere');
    assert.equal(await ctx.local.namesADatabase(ctx.f, { PGHOST: 'localhost' }), true, 'Starbase\'s own environment');
    assert.equal(await ctx.local.namesADatabase(ctx.f, { PATH: '/opt/homebrew/opt/postgresql@17/bin' }), false, 'a search path is no database setting');
    await fs.mkdir(path.join(ctx.f.worktree, 'packages', 'db'), { recursive: true });
    await fs.writeFile(path.join(ctx.f.worktree, 'packages', 'db', '.env'), 'X=1\r\nDATABASE_URL=anything\r\n');
    assert.equal(await ctx.local.namesADatabase(ctx.f, {}), true, 'a CRLF file further down');
  } finally { await ctx.done(); }
  const keyed = await setup({ fixture: true, settings: 'OTHER=1\n', appSettings: 'NEXT_PUBLIC_X=1\n' });
  try {
    assert.equal(await keyed.local.namesADatabase(keyed.f, {}), true, 'the profile names a key');
  } finally { await keyed.done(); }
});

test('R6: hisSessions reads pg_stat_database through the admin database, and says null where the server keeps no such count', async () => {
  const ctx = await setup();
  try {
    assert.equal(await ctx.local.hisSessions(ctx.f), 0);
    process.env.FAKE_PG_NO_SESSIONS = '1';
    assert.equal(await ctx.local.hisSessions(ctx.f), null);
    assert.ok((await ctx.log()).filter((e) => e.tool === 'psql').every((e) => e.args[e.args.indexOf('-d') + 1] === 'postgres'));
  } finally { delete process.env.FAKE_PG_NO_SESSIONS; await ctx.done(); }
});

test('NB5: stopAll ends Auto\'s database steps still running', async () => {
  const ctx = await setup({ autoStepMs: 6000 }); // without stopAll the step would live until its own limit
  try {
    process.env.FAKE_PG_HANG = 'createdb:app__auto';
    const turn = ctx.local.autoDatabase(ctx.f).catch((err) => err);
    let pid = null;
    for (let i = 0; i < 100 && !pid; i++) { await sleep(50); pid = (await ctx.log()).findLast((e) => e.tool === 'createdb')?.pid ?? null; }
    assert.ok(pid, 'createdb started');
    ctx.local.stopAll();
    assert.ok(await goneSoon(pid), 'createdb was ended');
    await turn;
  } finally { delete process.env.FAKE_PG_HANG; await ctx.done(); }
});

// ---------- Task 9 fix round 3: the judge reads raw lines ----------

test('8. filesToCopy from app/local.env: its keys are set, and its lines are judged', async () => {
  const profile = { ...APP_PROFILE, filesToCopy: [{ from: '{app}/local.env', to: '{app}/local.env' }] };
  const ctx = await setup({ fixture: true, profile });
  try {
    await fs.writeFile(path.join(ctx.f.repoPath, 'app', 'local.env'), `DATABASE_URL=${HIS_URL}\nPRISMA_DIRECT=postgres://u:p@localhost:5432/app\n`);
    const r = await ctx.local.autoDatabase(ctx.f);
    assert.deepEqual(r.added, ['0002_b']);
    await ctx.local.startServer(ctx.f, { databaseUrl: r.url });
    try { const seen = await appEnv(ctx); assert.equal(seen.PRISMA_DIRECT, viaDoor(seen, { query: '' })); } finally { await stopApp(ctx); }
    // A line of it the reader can't point at Auto's copy no longer refuses the turn (fix round 4): it is a hint only.
    await fs.writeFile(path.join(ctx.f.repoPath, 'app', 'local.env'), `DATABASE_URL=${HIS_URL}\nPG_SOCKET=socket:/tmp?db=app\n`);
    assert.deepEqual((await ctx.local.autoDatabase(ctx.f)).added, ['0002_b']);
  } finally { await ctx.done(); }
});

test('9. the hold: Try it\'s panel answers at once from the last facts; past 2 minutes it still holds; the 10-minute cap lets go', { timeout: 20_000 }, async (t) => {
  const ctx = await setup();
  try {
    const before = await ctx.local.dbView(ctx.f, { fresh: true });
    assert.equal(before.available, true);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const release = await ctx.local.holdHisReads(ctx.f);
    const reads = async () => (await ctx.log()).filter((e) => e.tool === 'psql' && e.args.includes('app')).length;
    const n = await reads();
    t.mock.timers.tick(180_000);
    const view = await ctx.local.dbView(ctx.f, { fresh: true });
    assert.deepEqual(view, before, 'the last facts, in today\'s shape');
    assert.equal(await reads(), n, 'his database was not read');
    t.mock.timers.tick(600_000);
    await ctx.local.dbView(ctx.f, { fresh: true });
    assert.ok(await reads() > n, 'after the cap it reads again');
    release();
    t.mock.timers.reset();
  } finally { await ctx.done(); }
});

test('9. the hold with nothing read yet: Try it\'s panel answers as a failed read does, without waiting', { timeout: 20_000 }, async () => {
  const ctx = await setup();
  try {
    const release = await ctx.local.holdHisReads(ctx.f);
    const view = await ctx.local.dbView(ctx.f, { fresh: true });
    assert.equal(view.available, false);
    assert.match(view.reason, /^Couldn’t read the local database: /);
    release();
    assert.equal((await ctx.local.dbView(ctx.f, { fresh: true })).available, true, 'released, it reads again');
  } finally { await ctx.done(); }
});

test('11. PGUSER and PGPASSWORD named like his database reach the migrate step unchanged', async () => {
  const ctx = await setup({ fixture: true, settings: 'DATABASE_URL=postgres://localhost:5432/app\n' });
  Object.assign(process.env, { PGUSER: 'app', PGPASSWORD: 'app' });
  try {
    await ctx.local.autoDatabase(ctx.f);
    const migrated = JSON.parse(await fs.readFile(path.join(ctx.f.worktree, 'app', 'migrate-env.json'), 'utf8'));
    assert.equal(migrated.PGUSER, 'app');
    assert.equal(migrated.PGPASSWORD, 'app');
    assert.equal(migrated.PGDATABASE, 'app__auto');
  } finally { delete process.env.PGUSER; delete process.env.PGPASSWORD; await ctx.done(); }
});

test('14. his database named postgres: refused up front with its line, nothing copied', async () => {
  const ctx = await setup({ settings: 'DATABASE_URL=postgres://u:p@localhost:5432/postgres\n' });
  try {
    await assert.rejects(ctx.local.autoDatabase(ctx.f), (err) => err.code === 'no-database'
      && err.message === 'Your database is named postgres, which Starbase\'s own reads use, so Auto made no recording.');
    assert.deepEqual(changes(await ctx.log()), []);
  } finally { await ctx.done(); }
});

// ---------- Task 9 fix round 4: Auto's app and migrate scripts behind the sandbox and the door ----------
// No Postgres anywhere: his server is a plain listener that counts what connects to it. Wherever a
// fixture sends a real startup message, his settings name that listener's port, never 5432.

const mac = process.platform === 'darwin';
const NO_FENCE = 'Auto could not fence its app off from your database on this computer, so it made no recording.';
const DOOR_WORDS = /SFATAL\0VFATAL\0C3D000\0MStarbase: Auto's app may only use its own copy of the database, app__auto\.\0/;

/** A plain listener standing for his Postgres server: { port, url (his address), seen: { connections, bytes }, close() }. */
async function plainServer() {
  const seen = { connections: 0, bytes: 0 };
  const sockets = new Set();
  const server = net.createServer((s) => {
    seen.connections++;
    sockets.add(s);
    s.on('data', (d) => { seen.bytes += d.length; });
    s.on('error', () => {});
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const { port } = server.address();
  const close = () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r); });
  return { port, url: `postgres://u:p@127.0.0.1:${port}/app?schema=public`, seen, close };
}
/** What a plain connection to a port of this computer meets: 'connected', or the error's code. */
const dial = (port) => new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port });
  s.on('connect', () => { s.destroy(); resolve('connected'); });
  s.on('error', (err) => resolve(err.code));
});
/** The stand-in app's package.json with one script changed. */
async function setScript(ctx, name, command) {
  const file = path.join(ctx.f.worktree, 'app', 'package.json');
  const pkg = JSON.parse(await fs.readFile(file, 'utf8'));
  pkg.scripts[name] = command;
  await fs.writeFile(file, JSON.stringify(pkg));
}
const serverOf = (ctx) => ctx.local.jobs.get(ctx.f.slug).server;

test('14. Auto\'s app starts through sandbox-exec with settings that name the door; his own Try it app starts as before', { skip: !mac }, async () => {
  const his = await plainServer();
  const ctx = await setup({ fixture: true, settings: `DATABASE_URL=${his.url}\n` });
  try {
    const view = await ctx.local.startServer(ctx.f, { databaseUrl: his.url.replace('/app?', '/app__auto?') });
    assert.equal(view.db, 'auto');
    const auto = serverOf(ctx).child;
    assert.equal(auto.spawnfile, '/usr/bin/sandbox-exec');
    assert.deepEqual(auto.spawnargs.slice(0, 3), ['/usr/bin/sandbox-exec', '-p', sandboxProfile({ port: his.port })], 'the app profile, for his server\'s port');
    const seen = await appEnv(ctx);
    const door = Number(seen.PGPORT);
    assert.ok(Number.isInteger(door) && door !== his.port && door !== 5432, `the door's own port: ${seen.PGPORT}`);
    assert.deepEqual([seen.PGHOST, seen.PGDATABASE, seen.PGSSLMODE], ['127.0.0.1', 'app__auto', 'disable']);
    assert.equal(seen.DATABASE_URL, `postgres://u:p@127.0.0.1:${door}/app__auto?schema=public&sslmode=disable`);
    assert.equal(await appGet(ctx), seen.DATABASE_URL, 'the address the app uses');
    assert.equal(await dial(door), 'connected', 'the door is open while the app runs');
    await stopApp(ctx);

    // His own Try it: the same shell and command with nothing in front, and no door.
    const own = await ctx.local.startServer(ctx.f);
    assert.equal(own.db, undefined);
    const tryIt = serverOf(ctx).child;
    assert.notEqual(tryIt.spawnfile, '/usr/bin/sandbox-exec');
    assert.equal(tryIt.spawnfile, auto.spawnargs[3]);
    assert.deepEqual(tryIt.spawnargs, auto.spawnargs.slice(3));
    assert.equal(await appGet(ctx), 'postgres://localhost/app', 'its settings file\'s address, as before');
    const plain = await appEnv(ctx);
    assert.deepEqual([plain.PGPORT, plain.PGSSLMODE, plain.PGDATABASE], [process.env.PGPORT, process.env.PGSSLMODE, process.env.PGDATABASE], 'Starbase set none of them');
    assert.equal(his.seen.connections, 0, 'nothing reached his server');
  } finally { await stopApp(ctx); await ctx.done(); await his.close(); }
});

test('15. each migrate script runs through sandbox-exec with the migrate profile; Starbase\'s own psql, createdb and dropdb do not', { skip: !mac }, async () => {
  const his = await plainServer();
  const ctx = await setup({ settings: `DATABASE_URL=${his.url}\n` });
  await fs.mkdir(path.join(ctx.f.worktree, 'app', 'prisma', 'migrations', '0003_c'), { recursive: true });
  // Each fake tool says what a connection to his server's port meets from where it runs; migrate also tries an address outside the laptop.
  Object.assign(process.env, { FAKE_PG_REACH: `127.0.0.1:${his.port}`, FAKE_PG_REACH_OUT: '192.0.2.1:443' });
  try {
    assert.deepEqual((await runAuto(ctx)).added, ['0002_b', '0003_c']);
    const entries = await ctx.log();
    const by = (tool) => entries.filter((e) => e.tool === tool);
    assert.equal(by('migrate').length, 2, 'each script');
    for (const e of by('migrate')) {
      assert.equal(e.reach, 'EPERM', `${line(e)}: his server's port is refused where the script runs`);
      assert.equal(e.out, 'EPERM', `${line(e)}: and so is an address outside the laptop (the migrate profile)`);
      assert.equal(new URL(e.url).hostname, '127.0.0.1');
      assert.ok(![String(his.port), '5432', ''].includes(new URL(e.url).port), `its address names the door: ${line(e)}`);
    }
    for (const tool of ['psql', 'createdb', 'dropdb']) {
      assert.ok(by(tool).length > 0, tool);
      for (const e of by(tool)) assert.equal(e.reach, 'connected', `${line(e)}: Starbase's own tools go straight to the server`);
    }
    assert.equal(his.seen.connections, by('psql').length + by('createdb').length + by('dropdb').length, 'only Starbase\'s own tools reached his server');
    assert.equal(his.seen.bytes, 0);
  } finally { delete process.env.FAKE_PG_REACH; delete process.env.FAKE_PG_REACH_OUT; await ctx.done(); await his.close(); }
});

test('16. no sandbox on this computer: nothing is copied, started or run, with the sentence', async () => {
  const ctx = await setup({ fixture: true, sandboxWorks: async () => false });
  try {
    await assert.rejects(ctx.local.autoDatabase(ctx.f), (err) => err instanceof AutoDbError && err.code === 'no-database' && err.message === NO_FENCE);
    assert.deepEqual(await ctx.log(), [], 'no Postgres tool ran, not even a read');
    assert.equal((await ctx.pg()).app__auto, undefined, 'nothing copied');
    assert.equal(ctx.local.dbBusy, false);
    await assert.rejects(ctx.local.startServer(ctx.f, { databaseUrl: AUTO_URL }), (err) => err.message === NO_FENCE);
    assert.equal(ctx.local.jobs.get(ctx.f.slug)?.server ?? null, null, 'no app started');
    // His own Try it needs no fence.
    await ctx.local.startServer(ctx.f);
    try { assert.equal(await appGet(ctx), 'postgres://localhost/app'); } finally { await stopApp(ctx); }
  } finally { await ctx.done(); }
});

test('18. two of the review\'s reaches end at the fence', { skip: !mac }, async () => {
  const his = await plainServer();
  // NC1: a slash after the name. NC2: a quoted value over two lines. The reader points neither at Auto's copy;
  // a driver reads his database's name out of both.
  const reaches = `DIRECT_URL=postgres://u:pw@127.0.0.1:${his.port}/app/\nREPLICA_URL="postgres://127.0.0.1:${his.port}/\napp"\n`;
  const ctx = await setup({ fixture: true, settings: `DATABASE_URL=${his.url}\n`, appSettings: `DATABASE_URL=${his.url}\n${reaches}` });
  try {
    const r = await ctx.local.autoDatabase(ctx.f);
    await ctx.local.startServer(ctx.f, { databaseUrl: r.url });
    try {
      assert.equal((await appEnv(ctx)).DIRECT_URL, `postgres://u:pw@127.0.0.1:${his.port}/app/`, 'NC1 reaches the app as its file has it');
      const reach = JSON.parse(await appGet(ctx, '/reach'));
      for (const key of ['DIRECT_URL', 'REPLICA_URL']) {
        assert.equal(reach[key]?.database, 'app', `${key}: a driver reads his database's name out of it`);
        assert.deepEqual(reach[key].direct, { connected: false, code: 'EPERM' }, `${key}: his server's port is refused`);
        assert.equal(reach[key].door.connected, true, `${key}: the door answers`);
        assert.match(reach[key].door.answer, DOOR_WORDS, `${key}: with its refusal`);
      }
      assert.deepEqual(ctx.local.autoRefusal(ctx.f.slug), { asked: 'app', hint: { file: 'the job\'s app/.env.local', key: 'DIRECT_URL' } });
    } finally { await stopApp(ctx); }
    assert.equal(his.seen.connections, 0, 'nothing reached his server');
  } finally { await ctx.done(); await his.close(); }
});

test('19. the door is closed when the app stops and when the migrate loop ends, also when a script fails', { skip: !mac }, async () => {
  const his = await plainServer();
  const theirs = `DATABASE_URL=${his.url}\n`;
  const ctx = await setup({ fixture: true, settings: theirs, appSettings: theirs });
  try {
    // The migrate loop.
    const r = await ctx.local.autoDatabase(ctx.f);
    assert.deepEqual(r.added, ['0002_b']);
    assert.equal(await dial(Number((await migrateEnv(ctx)).PGPORT)), 'ECONNREFUSED', 'after the migrate loop');
    // The app, stopped.
    await ctx.local.startServer(ctx.f, { databaseUrl: r.url });
    const door = Number((await appEnv(ctx)).PGPORT);
    assert.equal(await dial(door), 'connected', 'open while the app runs');
    await stopApp(ctx);
    assert.equal(await dial(door), 'ECONNREFUSED', 'after the app stopped');
    // The app, ending by itself.
    await setScript(ctx, 'dev', 'node -e "setTimeout(() => process.exit(3), 1500)"');
    await ctx.local.startServer(ctx.f, { databaseUrl: r.url });
    const second = serverOf(ctx).door.port;
    assert.equal(await dial(second), 'connected', 'open while the second app runs');
    for (let i = 0; i < 100 && serverOf(ctx).status !== 'exited'; i++) await sleep(100);
    assert.equal(serverOf(ctx).status, 'exited');
    assert.equal(await dial(second), 'ECONNREFUSED', 'after the app ended by itself');
    // A script that fails (it asks the door for his database, and is refused).
    await setScript(ctx, 'db:migrate', 'node migrate.mjs --ask-his');
    await assert.rejects(ctx.local.autoDatabase(ctx.f), (err) => err.code === 'migration');
    const failed = Number((await migrateEnv(ctx)).PGPORT);
    assert.ok(failed !== door && failed !== second, 'a door of its own');
    assert.equal(await dial(failed), 'ECONNREFUSED', 'after a script that failed');
    assert.equal(his.seen.connections, 0, 'nothing reached his server');
  } finally { await stopApp(ctx); await ctx.done(); await his.close(); }
});

test('20. a migrate script the door refused fails with the name it asked for; one that fails by itself keeps its exit code', { skip: !mac }, async () => {
  const his = await plainServer();
  const theirs = `DATABASE_URL=${his.url}\n`;
  const ctx = await setup({ fixture: true, settings: theirs, appSettings: theirs });
  try {
    await setScript(ctx, 'db:migrate', 'node migrate.mjs --ask-his');
    await assert.rejects(ctx.local.autoDatabase(ctx.f), (err) => {
      assert.ok(err instanceof AutoDbError);
      assert.deepEqual([err.code, err.migration], ['migration', '0002_b']);
      assert.equal(err.message, 'Adding 0002_b to Auto’s database failed: the script asked for the database app, and Starbase refused it.');
      assert.match(err.tail, /Starbase: Auto's app may only use its own copy of the database, app__auto\./, 'the tail stays: the script printed the door\'s answer');
      return true;
    });
    assert.deepEqual((await ctx.pg()).app.ledger, ['0001_a'], 'his database is as it was');
    assert.equal(his.seen.connections, 0, 'nothing reached his server');
    // No refusal: the exit-code sentence, as before.
    await setScript(ctx, 'db:migrate', `node ${JSON.stringify(path.join(FAKES, 'migrate'))}`);
    process.env.FAKE_PG_FAIL = '0002_b';
    await assert.rejects(ctx.local.autoDatabase(ctx.f), (err) => err.code === 'migration' && err.message === 'Adding 0002_b to Auto’s database failed (exit 1).');
  } finally { delete process.env.FAKE_PG_FAIL; await ctx.done(); await his.close(); }
});

test('20. an app the door refused: the job\'s refusal names what it asked for, and the setting that may name it', { skip: !mac }, async () => {
  const his = await plainServer();
  const theirs = `DATABASE_URL=${his.url}\n`;
  const ctx = await setup({ fixture: true, settings: theirs, appSettings: `${theirs}LEGACY_JDBC=jdbc:postgresql:app\n` });
  try {
    await setScript(ctx, 'dev', 'node dev.mjs --ask-his');
    const r = await ctx.local.autoDatabase(ctx.f);
    await ctx.local.startServer(ctx.f, { databaseUrl: r.url });
    assert.equal(ctx.local.autoRefusal(ctx.f.slug), null, 'nothing refused yet');
    await appGet(ctx); // its first GET asks the door for the database its own file names
    assert.deepEqual(ctx.local.autoRefusal(ctx.f.slug), { asked: 'app', hint: { file: 'the job\'s app/.env.local', key: 'LEGACY_JDBC' } });
    await stopApp(ctx);
    assert.deepEqual(ctx.local.autoRefusal(ctx.f.slug)?.asked, 'app', 'still there for the record once the app has stopped');
    assert.equal(his.seen.connections, 0, 'nothing reached his server');
    // No setting holds the name: no hint. His own Try it app: no door, so no refusal.
    await fs.writeFile(path.join(ctx.f.worktree, 'app', '.env.local'), theirs);
    await ctx.local.startServer(ctx.f, { databaseUrl: r.url });
    await appGet(ctx);
    assert.deepEqual(ctx.local.autoRefusal(ctx.f.slug), { asked: 'app', hint: null });
    await stopApp(ctx);
    await setScript(ctx, 'dev', 'node dev.mjs');
    await ctx.local.startServer(ctx.f);
    await appGet(ctx);
    assert.equal(ctx.local.autoRefusal(ctx.f.slug), null);
  } finally { await stopApp(ctx); await ctx.done(); await his.close(); }
});

test('D6. the hold with nothing read yet says so in the lead\'s words, and the release is heard', async () => {
  const ctx = await setup();
  try {
    const release = await ctx.local.holdHisReads(ctx.f);
    const view = await ctx.local.dbView(ctx.f);
    assert.equal(view.reason, 'Couldn’t read the local database: Auto is recording, so Starbase is not reading your database right now. This fills in when the recording ends.');
    const heard = [];
    ctx.local.on('changed', (e) => heard.push(e.slug));
    release();
    assert.deepEqual(heard, [ctx.f.slug], 'the page hears that the hold ended');
    assert.equal((await ctx.local.dbView(ctx.f)).available, true, 'and the next look reads again: the answer kept from the hold is gone (m-d)');
  } finally { await ctx.done(); }
});
