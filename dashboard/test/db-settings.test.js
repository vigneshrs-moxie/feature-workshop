// The settings reader for Auto's own database (lib/db-settings.js), on strings and on temporary
// folders: it points the settings it understands at the door and Auto's copy, and gives hints. Nothing
// here is a safety test: what keeps Auto's app off his database is lib/db-door.js (db-door.test.js,
// db-sandbox.test.js). No real settings file is read (the fixtures are strings, or files written into
// temporary folders), no Postgres is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { autoDbEnvParts, dbHint, leftover, readSettings, settingsFromTexts } from '../lib/db-settings.js';

const DB = { url: 'postgres://u:p@localhost:5432/orbit', name: 'orbit', key: 'DATABASE_URL', auto: 'orbit__auto', autoUrl: 'postgres://u:p@localhost:5432/orbit__auto' };
const DOOR = { port: 6543 };
/** An address of Auto's copy through the door: the login and what is left of the query as given. */
const viaDoor = (scheme, login = '', query = '') => `${scheme}://${login ? `${login}@` : ''}127.0.0.1:6543/orbit__auto?${query ? `${query}&` : ''}sslmode=disable`;
const AUTO = viaDoor('postgres', 'u:p');
/** The reader on files in load order ([label, text] pairs): the child's environment and the leftover hint, if any. */
function check(list, base = {}) {
  const settings = settingsFromTexts(list.map(([label, text]) => ({ label, text, name: path.basename(label.split(' ').at(-1)) })));
  const { env, set } = autoDbEnvParts(DB, settings, base, DOOR);
  return { env, set, left: leftover(settings, set, DB, base), settings };
}

test('1. an unclosed quote, then DIRECT_URL on the next line: the reader reads it and rewrites it', () => {
  const { env, left } = check([["the job's .env", 'NOTE="unclosed\nDIRECT_URL=postgres://localhost/orbit\n']]);
  assert.equal(env.DIRECT_URL, viaDoor('postgres'));
  assert.equal(left, null);
});

test('1. the hint alone, with the reader reading nothing: the same line is the hint', () => {
  const settings = settingsFromTexts([{ label: "the job's .env", text: 'NOTE="unclosed\nDIRECT_URL=postgres://localhost/orbit\n' }]);
  for (const f of settings.files) f.pairs = []; // the reader's fix taken away: it read nothing
  const { set } = autoDbEnvParts(DB, settings, {}, DOOR);
  assert.deepEqual(leftover(settings, set, DB, {}), { file: "the job's .env", key: 'DIRECT_URL' });
});

test('2. a backslash-escaped quote does not end the value: rewritten', () => {
  const { env, left } = check([["the job's .env", 'DIRECT_URL="postgres://u:p\\"q@localhost/orbit"\n']]);
  assert.equal(env.DIRECT_URL, viaDoor('postgres', 'u:p\\"q'));
  assert.equal(left, null);
});

test('3. ${UNSET:-$NAME} with NAME=orbit: no reach', () => {
  const { env, left } = check([["the job's .env", 'X=postgres://localhost/${UNSET:-$NAME}\nNAME=orbit\n']]);
  assert.equal(env.X, viaDoor('postgres'), 'the default is filled in, so X names his database and is set');
  assert.equal(env.NAME, 'orbit__auto', 'and NAME, referred to by a database-like line');
  assert.equal(left, null);
});

test('4. ${USER} with USER=orbit only in Starbase\'s own environment: X is set to Auto\'s value', () => {
  const { env, left } = check([["the job's .env", 'X=postgres://localhost/${USER}\n']], { USER: 'orbit' });
  assert.equal(env.X, viaDoor('postgres'));
  assert.equal(env.USER, 'orbit', 'USER itself is left as it is');
  assert.equal(left, null);
});

test('5. NAME=orbit in .env.local, NAME=prod in .env.production, ${NAME} in .env: no reach', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'starbase-db-settings-'));
  try {
    await fs.writeFile(path.join(dir, '.env.local'), 'NAME=orbit\n');
    await fs.writeFile(path.join(dir, '.env.production'), 'NAME=prod\n');
    await fs.writeFile(path.join(dir, '.env'), 'X=postgres://localhost/${NAME}\n');
    const settings = await readSettings({ job: dir });
    assert.deepEqual(settings.files.map((f) => f.name), ['.env.local', '.env', '.env.production'], 'the order an app loads them');
    const { env, set } = autoDbEnvParts(DB, settings, {}, DOOR);
    assert.equal(env.NAME, 'orbit__auto', 'NAME, referred to by a database-like line, is Auto\'s');
    assert.equal(env.X, viaDoor('postgres'), 'and X, filled in with the first file\'s NAME');
    assert.equal(leftover(settings, set, DB, {}), null);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('6. a raw line the reader can\'t make sense of, database-like and holding the name: the hint names it as line <n>', () => {
  const { left, settings } = check([["the job's .env", 'OK=1\nDATABASE URL = postgres://localhost/orbit\n']]);
  assert.deepEqual(left, { file: "the job's .env", key: 'line 2' });
  assert.deepEqual(dbHint(settings, {}), { file: "the job's .env", key: 'line 2' }, 'and it is a hint');
});

test('6b. an unclosed quote hides nothing from the hint', () => {
  const settings = settingsFromTexts([{ label: "the job's .env", text: 'NOTE="unclosed\nDB_HOST=localhost\n' }]);
  assert.deepEqual(dbHint(settings, {}), { file: "the job's .env", key: 'DB_HOST' });
});

/**
 * readSettings on a folder that holds a FIFO. Were the reader ever stuck opening it (a regression),
 * a writer lets it go after 2 seconds, so the test fails by what it asserts and the suite ends,
 * where a stuck reader would keep the test's process alive for ever (m-f).
 */
async function readBesideFifo(fifo, opts) {
  const { openSync, closeSync, constants } = await import('node:fs');
  const letGo = setTimeout(() => {
    try { closeSync(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK)); } catch { /* nobody is reading it: as it should be */ }
  }, 2000);
  try { return await readSettings(opts); } finally { clearTimeout(letGo); }
}

test('7. links: to a regular file (read), dangling (ignored), to a folder (ignored), a FIFO named .env.x (unreadable, never opened)', { timeout: 10_000, skip: process.platform === 'win32' && 'links need admin rights on Windows, and it has no FIFOs' }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'starbase-db-settings-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'starbase-db-settings-out-'));
  try {
    await fs.writeFile(path.join(outside, 'shared.env'), 'DIRECT_URL=postgres://localhost/orbit\n');
    await fs.symlink(path.join(outside, 'shared.env'), path.join(dir, '.env'));
    await fs.symlink(path.join(outside, 'gone'), path.join(dir, '.env.local'));
    await fs.mkdir(path.join(outside, 'folder'));
    await fs.symlink(path.join(outside, 'folder'), path.join(dir, '.env.d'));
    let settings = await readSettings({ job: dir, home: path.dirname(outside) });
    assert.deepEqual(settings.unreadable, []);
    assert.equal(settings.files.length, 1, 'the link to a file only');
    assert.equal(settings.files[0].label, `~/${path.basename(outside)}/shared.env`, 'named where it really is');
    assert.equal(autoDbEnvParts(DB, settings, {}, DOOR).env.DIRECT_URL, viaDoor('postgres'));
    assert.equal(spawnSync('mkfifo', [path.join(dir, '.env.x')]).status, 0, 'mkfifo');
    settings = await readBesideFifo(path.join(dir, '.env.x'), { job: dir, home: path.dirname(outside) });
    assert.deepEqual(settings.unreadable, ["the job's .env.x"], 'never opened (opening a FIFO would wait for ever)');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('10. the child\'s environment: libpq\'s own settings name the door and Auto\'s copy; no PGSERVICE, PGSERVICEFILE or PGHOSTADDR at all; PGSYSCONFDIR an empty folder', async () => {
  const { env } = check([["the job's .env", 'PGSERVICE=his\n']], { PGSERVICE: 'his', PGSERVICEFILE: '/his/services', PGHOSTADDR: '10.0.0.5', PGHOST: 'localhost', PGPORT: '5432', PGDATABASE: 'orbit', PGSSLMODE: 'require', PGUSER: 'me' });
  for (const k of ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR']) assert.equal(k in env, false, k);
  assert.deepEqual([env.PGHOST, env.PGPORT, env.PGDATABASE, env.PGSSLMODE, env.PGUSER], ['127.0.0.1', '6543', 'orbit__auto', 'disable', 'me']);
  assert.ok(path.isAbsolute(env.PGSYSCONFDIR));
  assert.deepEqual(await fs.readdir(env.PGSYSCONFDIR), []);
});

test('11. POSTGRES_USER=orbit in a file is neither rewritten nor refused; POSTGRES_DB=orbit is rewritten; PGUSER and PGPASSWORD from Starbase stay', () => {
  const { env, left } = check([["the job's .env", 'POSTGRES_USER=orbit\nPOSTGRES_PASSWORD=orbit\nPOSTGRES_DB=orbit\n']], { PGUSER: 'orbit', PGPASSWORD: 'orbit' });
  assert.equal(env.POSTGRES_USER, undefined, 'not set by Starbase');
  assert.equal(env.POSTGRES_DB, 'orbit__auto');
  assert.equal(env.PGUSER, 'orbit');
  assert.equal(env.PGPASSWORD, 'orbit');
  assert.equal(left, null);
});

test('12. the typical Next.js + Prisma app: no refusal, and DIRECT_URL carries .env\'s login, never the sample\'s', () => {
  const { env, left } = check([
    // The sample first on purpose: a sample is used only when no other file has the key, whatever the order.
    ["the job's .env.example", 'DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/orbit"\nDIRECT_URL="postgresql://USER:PASSWORD@localhost:5432/orbit"\n'],
    ["the job's .env.local", 'DATABASE_URL="postgresql://dev:devpw@localhost:5432/orbit?schema=public"\n# DATABASE_URL=postgresql://prod:x@prod.example.com/orbit\n'],
    ["the job's .env", 'DATABASE_URL="postgresql://dev:devpw@localhost:5432/orbit?schema=public"\nDIRECT_URL="postgresql://dev:devpw@localhost:5432/orbit?schema=public"\nSHADOW_DATABASE_URL="postgresql://dev:devpw@localhost:5432/orbit_shadow"\nNEXTAUTH_URL=http://localhost:3000\nREDIS_URL=redis://localhost:6379\n'],
  ]);
  assert.equal(left, null);
  assert.equal(env.DIRECT_URL, viaDoor('postgresql', 'dev:devpw', 'schema=public'));
  assert.equal(env.DATABASE_URL, AUTO);
  assert.equal(env.SHADOW_DATABASE_URL, undefined);
});

test('13. the hint: the name inside another name, in a comment or in a setting that is no database\'s is none; the name as a whole word is', () => {
  // A hint may name a line that is not the one (here the name is only the login): it says "may", and gates nothing.
  assert.deepEqual(check([["the job's .env", 'SHADOW_DATABASE_URL=postgres://orbit:pw@localhost/orbit_shadow\n']]).left, { file: "the job's .env", key: 'SHADOW_DATABASE_URL' });
  assert.equal(check([["the job's .env", 'SHADOW_DATABASE_URL=postgres://me:pw@localhost/orbit_shadow\n']]).left, null);
  assert.equal(check([["the job's .env", 'PG_POOL=10 # for orbit\n']]).left, null, 'a comment after an unquoted value');
  assert.equal(check([["the job's .env", 'X_URL=postgres://db.example.com/orbit-test\n']]).left, null);
  assert.equal(check([["the job's .env", 'NEXTAUTH_URL=http://orbit.localhost:3000\n']]).left, null, 'not a database setting');
  assert.equal(check([["the job's .env", '# DIRECT_URL=postgres://localhost/orbit\n']]).left, null, 'a commented-out address');
});

test('16. X_PATH=socket:/tmp?db=orbit in a settings file: the hint names it (the PATH exception is for Starbase\'s own environment only)', () => {
  assert.deepEqual(check([["the job's .env", 'X_PATH=socket:/tmp?db=orbit\n']]).left, { file: "the job's .env", key: 'X_PATH' });
  const settings = settingsFromTexts([]);
  assert.equal(dbHint(settings, { PATH: '/opt/homebrew/opt/postgresql@17/bin:/usr/bin' }), null, 'his PATH is no hint');
  assert.deepEqual(dbHint(settings, { PATH: 'postgres://localhost/orbit' }), { file: null, key: 'PATH' }, 'unless it isn\'t a list of folders');
});

test('a database-like line that holds the name once its variables are filled in is the hint', () => {
  assert.deepEqual(check([["the job's .env", 'X=postgres://localhost/${HIS}\nHIS=orbit_${SUFFIX}\nSUFFIX=1\n']]).left, null, 'orbit_1 is not his');
  assert.deepEqual(check([["the job's .env", 'X=${A}\nA=socket:/tmp?db=$B\nB=orbit\n']]).left?.key, 'A');
});

test('m3: a folder that can\'t be listed is unreadable; a root that does not exist is not', { skip: process.platform === 'win32' && 'Windows has no POSIX modes' }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'starbase-db-settings-'));
  try {
    await fs.mkdir(path.join(dir, 'locked'));
    await fs.chmod(path.join(dir, 'locked'), 0o000);
    assert.deepEqual((await readSettings({ job: dir })).unreadable, ["the job's locked"]);
    assert.deepEqual(await readSettings({ job: path.join(dir, 'nowhere') }), { files: [], unreadable: [] });
  } finally { await fs.chmod(path.join(dir, 'locked'), 0o700); await fs.rm(dir, { recursive: true, force: true }); }
});

test('15. a nested worktree\'s .env is not read; a submodule\'s is; .claude and .worktrees are skipped', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'starbase-db-settings-'));
  try {
    for (const d of ['wt', 'mod', '.claude/worktrees/x', '.worktrees/y']) await fs.mkdir(path.join(dir, d), { recursive: true });
    await fs.writeFile(path.join(dir, 'wt', '.git'), 'gitdir: /repo/.git/worktrees/wt\n');
    await fs.writeFile(path.join(dir, 'mod', '.git'), 'gitdir: ../.git/modules/mod\n');
    for (const d of ['wt', 'mod', '.claude/worktrees/x', '.worktrees/y']) await fs.writeFile(path.join(dir, d, '.env'), 'DIRECT_URL=postgres://localhost/orbit\n');
    const settings = await readSettings({ job: dir });
    assert.deepEqual(settings.files.map((f) => f.label), [`the job's ${path.join('mod', '.env')}`]);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('S9: a file is named by where it is: the job\'s, your main folder\'s, or ~/…', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'starbase-db-settings-home-'));
  try {
    for (const d of ['job', 'main', 'shared']) await fs.mkdir(path.join(home, d));
    await fs.writeFile(path.join(home, 'job', '.env'), 'A=1\n');
    await fs.writeFile(path.join(home, 'main', '.env'), 'B=1\n');
    await fs.writeFile(path.join(home, 'shared', 'local.env'), 'C=1\n');
    const settings = await readSettings({ job: path.join(home, 'job'), main: path.join(home, 'main'), extra: [path.join(home, 'shared', 'local.env')], home });
    assert.deepEqual(settings.files.map((f) => f.label), ["the job's .env", "your main folder's .env", `~/${path.join('shared', 'local.env')}`]);
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});

// ---------- Task 9 fix round 4: the reader points at the door; it gates nothing and never stalls ----------

test('D3. what the reader sets names the door and Auto\'s copy: the same scheme and login, the query kept but for where, which and how encrypted', () => {
  const text = [
    'A_URL=postgresql://dev:pw@db.internal:6432/orbit?schema=public&sslmode=require&host=/tmp&connect_timeout=5&sslrootcert=/x.pem&port=1&dbname=orbit&service=s&passfile=/p&hostaddr=10.0.0.1&SSLCERT=c#frag',
    'B_URL=jdbc:postgresql://localhost:5432/orbit',
    'C_URL=postgresql+psycopg2://u@localhost/orbit',
    'D_URL=postgresql:///other?dbname=orbit&application_name=web',
    'E_CONNINFO="host=localhost port=5432 dbname=orbit user=u sslmode=require application_name=\'my app\' hostaddr=127.0.0.1"',
    'DB_NAME=orbit',
    'OTHER_URL=postgres://u:p@localhost:5432/elsewhere',
    'REMOTE_URL=postgres://ro:secret@prod.example.com/orbit',
  ].join('\n');
  const { env, set } = check([["the job's .env", text]], { HIS_URL: 'postgres://me@localhost/orbit?sslmode=prefer', DB_HOST: 'localhost', PATH: '/opt/homebrew/opt/postgresql@17/bin:/usr/bin', APP_NAME: 'orbit' });
  assert.equal(env.A_URL, viaDoor('postgresql', 'dev:pw', 'schema=public&connect_timeout=5'));
  assert.equal(env.B_URL, 'jdbc:postgresql://127.0.0.1:6543/orbit__auto?sslmode=disable');
  assert.equal(env.C_URL, viaDoor('postgresql+psycopg2', 'u'));
  assert.equal(env.D_URL, viaDoor('postgresql', '', 'application_name=web'));
  assert.equal(env.E_CONNINFO, "user=u application_name='my app' host=127.0.0.1 port=6543 dbname=orbit__auto sslmode=disable");
  assert.equal(env.DB_NAME, 'orbit__auto');
  assert.equal(env.REMOTE_URL, viaDoor('postgres', 'ro:secret'), 'his name on another host: the door too, with its own login');
  assert.equal(env.OTHER_URL, undefined, 'another database is left to the file');
  assert.equal(set.has('OTHER_URL'), false);
  // Starbase's own environment: what names his database is rewritten, the rest stays as it is.
  assert.equal(env.HIS_URL, viaDoor('postgres', 'me'));
  assert.deepEqual([env.DB_HOST, env.PATH, env.APP_NAME], ['localhost', '/opt/homebrew/opt/postgresql@17/bin:/usr/bin', 'orbit']);
  // The keys it always sets.
  assert.equal(env.DATABASE_URL, AUTO);
  assert.deepEqual([env.PGHOST, env.PGPORT, env.PGDATABASE, env.PGSSLMODE], ['127.0.0.1', '6543', 'orbit__auto', 'disable']);
  // The profile's own key, and the query of his address kept.
  const keyed = { ...DB, key: 'POSTGRES_PRISMA_URL', autoUrl: 'postgres://u:p@localhost:5432/orbit__auto?schema=public&sslmode=require' };
  const own = autoDbEnvParts(keyed, settingsFromTexts([]), {}, DOOR).env;
  assert.equal(own.POSTGRES_PRISMA_URL, viaDoor('postgres', 'u:p', 'schema=public'));
  assert.equal(own.DATABASE_URL, own.POSTGRES_PRISMA_URL);
  // No door, no environment: a caller can't get direct addresses by leaving it out.
  for (const door of [undefined, null, {}, { port: '6543' }, { port: 0 }, { port: 70000 }]) assert.throws(() => autoDbEnvParts(DB, settingsFromTexts([]), {}, door), TypeError);
});

test('17. a setting the reader can\'t point at Auto\'s copy no longer stops the recording: it is only the hint, and the Docker-style login named like the database is none', () => {
  // NI1: a role named like its database, used in an address that is not one of the keys Starbase always sets.
  const docker = 'POSTGRES_USER=orbit\nPOSTGRES_PASSWORD=orbit\nPOSTGRES_DB=orbit\nDIRECT_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}\n';
  const d = check([["the job's .env", docker]]);
  assert.equal(d.env.DIRECT_URL, viaDoor('postgresql', 'orbit:orbit'));
  assert.equal(d.env.POSTGRES_DB, 'orbit__auto');
  assert.equal(d.env.POSTGRES_USER, undefined);
  assert.equal(d.left, null, 'nothing left over');
  // The forms the reader does not know: the environment still comes back, with a hint beside it.
  for (const [line, key] of [
    ['LEGACY_JDBC=jdbc:postgresql:orbit', 'LEGACY_JDBC'], ['PG_SOCKET=socket:/tmp?db=orbit', 'PG_SOCKET'], ['PG_CONN="/tmp orbit"', 'PG_CONN'],
    ['DIRECT_URL=postgres://u:pw@localhost:5432/orbit/', 'DIRECT_URL'], // NC1
    ['DIRECT_URL="postgres://localhost/\norbit"', null], // NC2: neither line is a hint (the second is no database setting by itself)
    ['MIGRATE_DSN="host=localhost dbname=orb\\it"', null], // NC4: no hint either; the fence does not need one
  ]) {
    const r = check([["the job's .env", `${line}\n`]]);
    assert.equal(r.env.DATABASE_URL, AUTO, line);
    assert.deepEqual(r.left, key ? { file: "the job's .env", key } : null, line);
    assert.equal(r.set.has(String(key)), false, line);
  }
});

/**
 * The whole of what the server runs on a job's settings, timed: readSettings, dbHint, autoDbEnvParts
 * and leftover. ms is the time by the clock or the processor time this process used, whichever is
 * less, and the best of three: the suites run side by side at a low priority, so the clock alone
 * measures how busy the laptop is. A wait (a FIFO, a lock) uses no processor time: the clock's own
 * limit catches that.
 */
async function timed(text) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'starbase-db-settings-'));
  try {
    await fs.writeFile(path.join(dir, '.env'), text);
    let best = Infinity;
    let clock = Infinity;
    let last = null;
    for (let i = 0; i < 3 && best >= 100; i++) {
      const started = performance.now();
      const cpu = process.cpuUsage();
      const settings = await readSettings({ job: dir });
      const hint = dbHint(settings, {});
      const { env, set } = autoDbEnvParts(DB, settings, {}, DOOR);
      const left = leftover(settings, set, DB, {});
      const used = process.cpuUsage(cpu);
      const wall = performance.now() - started;
      best = Math.min(best, wall, (used.user + used.system) / 1000);
      clock = Math.min(clock, wall);
      last = { settings, hint, env, set, left };
    }
    return { ms: best, clock, ...last };
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
const repeat = (n, line) => Array.from({ length: n }, (_, i) => line(i)).join('\n');
const nested = (fan) => `${['A0=xxxxxxxxxx', ...Array.from({ length: 8 }, (_, i) => `A${i + 1}=${`$A${i}`.repeat(fan)}`), 'DB_URL=postgres://localhost/$A8'].join('\n')}\n`;

for (const [what, text, also] of [
  // The review's four (task-9-rereview-3.md, section E) and a harmless big file.
  ['400 bytes of nested $A references', nested(10), (r) => { assert.ok(nested(10).length < 500); assert.equal(r.env.DB_URL, undefined, 'given up: not set'); }],
  ['15 KB with one stray quote', `NOTE="stray\n${repeat(2000, (i) => `K${i}=1`)}\nDIRECT_URL=postgres://localhost/orbit\n`, (r) => assert.equal(r.env.DIRECT_URL, viaDoor('postgres'), 'the lines after it are still read')],
  ['10 KB of spaces', `DB_X=a${' '.repeat(10_000)}b\n`, (r) => assert.deepEqual(r.hint, { file: "the job's .env", key: 'DB_X' })],
  ['20,000 lines', `${repeat(20_000, () => 'K=1')}\n`, (r) => assert.equal(r.settings.files[0].pairs.length, 20_000)],
  ['a harmless 1 MB file', `${repeat(95_000, (i) => `K${i}=1`)}\n`, (r) => { assert.equal(r.hint, null); assert.equal(r.settings.files[0].pairs.length, 20_000, 'the reader stops at its limit'); }],
  // The same shapes at their worst, and the review's other rows.
  ['1 MB of one short line', `${repeat(170_000, () => 'A_B=1')}\n`, null],
  ['1 MB of spaces in a database-like line', `DB_X=a${' '.repeat(1_000_000)}b # orbit\n`, null],
  ['1 MB after a stray quote', `NOTE="stray\n${repeat(95_000, (i) => `K${i}=1`)}\n`, null],
  ['a stray quote of each kind on every line', `${repeat(9000, (i) => `A${i}="x\nB${i}='y\nC${i}=\`z`)}\n`, null],
  ['20,000 lines that refer to each other', `${repeat(20_000, (i) => `V${i}=$V${i + 1}$V${i + 7}`)}\nDB_URL=postgres://localhost/$V0\n`, (r) => assert.equal(r.env.DB_URL, undefined)],
  ['1,000 references to a key set 20,000 times', `DB_X=${'$A'.repeat(1000)}\n${repeat(20_000, () => 'A=x')}\n`, null],
  ['1 MB of references on one line', `DB_URL=postgres://localhost/${'$A'.repeat(450_000)}\nA=orbit\n`, null],
  ['1 MB of dbname= on one line', `PG_DSN=${'dbname=orbit '.repeat(80_000)}\n`, null],
  // No line of it is a database setting, but past 20,000 likely lines the hint stops looking: the file counts as one that may name a database.
  ['1 MB of a database-like word', `${repeat(120_000, () => 'ADBX=1')}\n`, (r) => assert.deepEqual(r.hint, { file: "the job's .env", key: 'line 20001' })],
  ['20,000 lines of a database-like word', `${repeat(20_000, () => 'ADBX=1')}\n`, (r) => assert.equal(r.hint, null)],
]) {
  test(`21. D5: the server never stalls on a settings file: ${what}, under 250 ms`, { timeout: 30_000 }, async () => {
    assert.ok(text.length <= 1024 * 1024, 'a file Starbase reads');
    const r = await timed(text);
    assert.ok(r.ms < 250, `took ${Math.round(r.ms)} ms of work (${Math.round(r.clock)} ms by the clock)`);
    assert.ok(r.clock < 5000, `waited ${Math.round(r.clock)} ms`);
    assert.equal(r.env.DATABASE_URL, AUTO, 'and the environment came back');
    also?.(r);
  });
}

test('21. D5: a FIFO in the job\'s folder is not opened: it counts as unreadable, at once', { timeout: 10_000, skip: process.platform === 'win32' && 'Windows has no FIFOs' }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'starbase-db-settings-'));
  const fifo = path.join(dir, '.env');
  try {
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0, 'mkfifo');
    const started = performance.now();
    const settings = await readBesideFifo(fifo, { job: dir });
    assert.ok(performance.now() - started < 250, 'no wait');
    assert.deepEqual(settings.unreadable, ["the job's .env"]);
    assert.deepEqual(settings.files, []);
    assert.deepEqual(dbHint(settings, {}), { file: "the job's .env", unreadable: true }, 'and it still counts as maybe a database setting');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('21. D5: a FIFO named .git in a folder of the job is not opened either: the folder is read like any other, at once', { timeout: 10_000, skip: process.platform === 'win32' && 'Windows has no FIFOs' }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'starbase-db-settings-'));
  const fifo = path.join(dir, 'app', '.git');
  try {
    await fs.mkdir(path.join(dir, 'app'));
    await fs.writeFile(path.join(dir, 'app', '.env'), 'DIRECT_URL=postgres://localhost/orbit\n');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0, 'mkfifo');
    const started = performance.now();
    const settings = await readBesideFifo(fifo, { job: dir });
    assert.ok(performance.now() - started < 1500, 'no wait');
    assert.deepEqual(settings.files.map((f) => f.label), ["the job's app/.env"], 'no worktree of its own: its settings are read');
    assert.deepEqual(settings.unreadable, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('m-h: a key with DBNAME as a part is a database setting: it is the hint, and its bare name is pointed at Auto\'s copy', () => {
  const r = check([["the job's .env", 'APP_DBNAME=orbit\n']]);
  assert.deepEqual(dbHint(r.settings, {}), { file: "the job's .env", key: 'APP_DBNAME' });
  assert.equal(r.env.APP_DBNAME, 'orbit__auto');
  assert.equal(r.left, null);
});

// ---------- Task 9 fix round 5 ----------

test('m1: the empty folder for PGSYSCONFDIR is one per process, and it is gone once the process has ended', async () => {
  // A process of its own: it builds two child environments, says which folder they name, and ends.
  const script = `
    import fs from 'node:fs';
    const { autoDbEnvParts, settingsFromTexts } = await import(${JSON.stringify(new URL('../lib/db-settings.js', import.meta.url).href)});
    const folder = () => autoDbEnvParts(${JSON.stringify(DB)}, settingsFromTexts([]), {}, { port: 6543 }).env.PGSYSCONFDIR;
    const dir = folder();
    console.log(JSON.stringify({ dir, again: folder(), files: fs.readdirSync(dir) }));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const said = JSON.parse(r.stdout);
  assert.ok(said.dir.startsWith(path.join(os.tmpdir(), 'starbase-pgsysconf-')), said.dir);
  assert.equal(said.again, said.dir, 'one folder for the process');
  assert.deepEqual(said.files, [], 'there, and empty, while the process ran');
  assert.equal(await fs.stat(said.dir).then(() => true, () => false), false, 'gone once it ended');
});
