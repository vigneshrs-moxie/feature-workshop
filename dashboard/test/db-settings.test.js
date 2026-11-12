// The settings check for Auto's own database (lib/db-settings.js), on strings and on temporary
// folders: the reader decides which keys Starbase sets, the judge reads raw lines and never trusts it.
// No real settings file is read (the fixtures are strings, or files named dot-env…), no Postgres is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { autoDbEnvParts, dbHint, leftover, readSettings, settingsFromTexts } from '../lib/db-settings.js';

const DB = { url: 'postgres://u:p@localhost:5432/orbit', name: 'orbit', key: 'DATABASE_URL', auto: 'orbit__auto', autoUrl: 'postgres://u:p@localhost:5432/orbit__auto' };
const AUTO = DB.autoUrl;
/** The check on files in load order ([label, text] pairs): the child's environment and the leftover, if any. */
function check(list, base = {}) {
  const settings = settingsFromTexts(list.map(([label, text]) => ({ label, text, name: path.basename(label.split(' ').at(-1)) })));
  const { env, set } = autoDbEnvParts(DB, settings, base);
  return { env, set, left: leftover(settings, set, DB, base), settings };
}

test('1. an unclosed quote, then DIRECT_URL on the next line: the reader reads it and rewrites it', () => {
  const { env, left } = check([["the job's .env", 'NOTE="unclosed\nDIRECT_URL=postgres://localhost/orbit\n']]);
  assert.equal(env.DIRECT_URL, 'postgres://localhost/orbit__auto');
  assert.equal(left, null);
});

test('1. the judge alone, with the reader reading nothing: the same line is refused', () => {
  const settings = settingsFromTexts([{ label: "the job's .env", text: 'NOTE="unclosed\nDIRECT_URL=postgres://localhost/orbit\n' }]);
  for (const f of settings.files) f.pairs = []; // the reader's fix taken away: it read nothing
  const { set } = autoDbEnvParts(DB, settings, {});
  assert.deepEqual(leftover(settings, set, DB, {}), { file: "the job's .env", key: 'DIRECT_URL' });
});

test('2. a backslash-escaped quote does not end the value: rewritten', () => {
  const { env, left } = check([["the job's .env", 'DIRECT_URL="postgres://u:p\\"q@localhost/orbit"\n']]);
  assert.equal(env.DIRECT_URL, 'postgres://u:p\\"q@localhost/orbit__auto');
  assert.equal(left, null);
});

test('3. ${UNSET:-$NAME} with NAME=orbit: no reach', () => {
  const { env, left } = check([["the job's .env", 'X=postgres://localhost/${UNSET:-$NAME}\nNAME=orbit\n']]);
  assert.equal(env.X, 'postgres://localhost/orbit__auto', 'the default is filled in, so X names his database and is set');
  assert.equal(env.NAME, 'orbit__auto', 'and NAME, referred to by a database-like line');
  assert.equal(left, null);
});

test('4. ${USER} with USER=orbit only in Starbase\'s own environment: X is set to Auto\'s value', () => {
  const { env, left } = check([["the job's .env", 'X=postgres://localhost/${USER}\n']], { USER: 'orbit' });
  assert.equal(env.X, 'postgres://localhost/orbit__auto');
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
    const { env, set } = autoDbEnvParts(DB, settings, {});
    assert.equal(env.NAME, 'orbit__auto', 'NAME, referred to by a database-like line, is Auto\'s');
    assert.equal(leftover(settings, set, DB, {}), null);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('6. a raw line the reader can\'t make sense of, database-like and holding the name: refused as line <n>', () => {
  const { left, settings } = check([["the job's .env", 'OK=1\nDATABASE URL = postgres://localhost/orbit\n']]);
  assert.deepEqual(left, { file: "the job's .env", key: 'line 2' });
  assert.deepEqual(dbHint(settings, {}), { file: "the job's .env", key: 'line 2' }, 'and it is a hint');
});

test('6b. an unclosed quote hides nothing from the hint', () => {
  const settings = settingsFromTexts([{ label: "the job's .env", text: 'NOTE="unclosed\nDB_HOST=localhost\n' }]);
  assert.deepEqual(dbHint(settings, {}), { file: "the job's .env", key: 'DB_HOST' });
});

test('7. links: to a regular file (read), dangling (ignored), to a folder (ignored), a FIFO named .env.x (unreadable, never opened)', { timeout: 10_000 }, async () => {
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
    assert.equal(autoDbEnvParts(DB, settings, {}).env.DIRECT_URL, 'postgres://localhost/orbit__auto');
    assert.equal(spawnSync('mkfifo', [path.join(dir, '.env.x')]).status, 0, 'mkfifo');
    settings = await readSettings({ job: dir, home: path.dirname(outside) });
    assert.deepEqual(settings.unreadable, ["the job's .env.x"], 'never opened (opening a FIFO would wait for ever)');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('10. the child\'s environment: no PGSERVICE at all, PGSERVICEFILE=/dev/null, PGSYSCONFDIR an empty folder', async () => {
  const { env } = check([["the job's .env", 'PGSERVICE=his\n']], { PGSERVICE: 'his' });
  assert.equal('PGSERVICE' in env, false);
  assert.equal(env.PGSERVICEFILE, '/dev/null');
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
  assert.equal(env.DIRECT_URL, 'postgresql://dev:devpw@localhost:5432/orbit__auto?schema=public');
  assert.equal(env.DATABASE_URL, AUTO);
  assert.equal(env.SHADOW_DATABASE_URL, undefined);
});

test('13. the name as a URL\'s user on another database, or inside another name: no refusal', () => {
  assert.equal(check([["the job's .env", 'SHADOW_DATABASE_URL=postgres://orbit:pw@localhost/orbit_shadow\n']]).left, null);
  assert.equal(check([["the job's .env", 'X_URL=postgres://db.example.com/orbit-test\n']]).left, null);
  assert.equal(check([["the job's .env", 'NEXTAUTH_URL=http://orbit.localhost:3000\n']]).left, null, 'not a database setting');
  assert.equal(check([["the job's .env", '# DIRECT_URL=postgres://localhost/orbit\n']]).left, null, 'a commented-out address');
});

test('16. X_PATH=socket:/tmp?db=orbit in a settings file: refused (the PATH exception is for Starbase\'s own environment only)', () => {
  assert.deepEqual(check([["the job's .env", 'X_PATH=socket:/tmp?db=orbit\n']]).left, { file: "the job's .env", key: 'X_PATH' });
  const settings = settingsFromTexts([]);
  assert.equal(dbHint(settings, { PATH: '/opt/homebrew/opt/postgresql@17/bin:/usr/bin' }), null, 'his PATH is no hint');
  assert.deepEqual(dbHint(settings, { PATH: 'postgres://localhost/orbit' }), { file: null, key: 'PATH' }, 'unless it isn\'t a list of folders');
});

test('a database-like line referring to a variable Starbase does not set, whose value holds the name, is refused', () => {
  assert.deepEqual(check([["the job's .env", 'X=postgres://localhost/${HIS}\nHIS=orbit_${SUFFIX}\nSUFFIX=1\n']]).left, null, 'orbit_1 is not his');
  assert.deepEqual(check([["the job's .env", 'X=${A}\nA=socket:/tmp?db=$B\nB=orbit\n']]).left?.key, 'A');
});

test('m3: a folder that can\'t be listed is unreadable; a root that does not exist is not', async () => {
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
    assert.deepEqual(settings.files.map((f) => f.label), ["the job's mod/.env"]);
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
    assert.deepEqual(settings.files.map((f) => f.label), ["the job's .env", "your main folder's .env", '~/shared/local.env']);
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});
