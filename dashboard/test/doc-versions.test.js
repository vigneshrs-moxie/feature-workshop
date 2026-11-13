// A job's older document versions (lib/doc-versions.js; the job page rebuild, Task 12 fix round 1):
// kept in the job's own versions/ folder at rebuild time, copied once, listed newest first, never
// written outside the job's folder or through a symlink.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { keepVersions, versionBase, compareVersionLabels, inVersionsFolder, EARLIER_MAX, STALE_TMP_MS } from '../lib/doc-versions.js';

async function jobDir() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'starbase-doc-versions-')));
  const dir = path.join(root, 'job');
  await fs.mkdir(dir);
  return { root, dir };
}
const plan = (version, text) => ({ file: 'implementation-plan.md', name: 'Implementation plan', version, text, type: 'md' });

test('a version is copied once; when the number moves on, the previous words are listed as older, newest first', async () => {
  const { dir } = await jobDir();
  let older = await keepVersions(dir, [plan('1', '# Plan v1\n')]);
  assert.deepEqual(older.get('implementation-plan.md'), [], 'nothing older yet');
  const copy = path.join(dir, 'versions', 'implementation-plan.v1.md');
  assert.equal(await fs.readFile(copy, 'utf8'), '# Plan v1\n');
  const first = (await fs.stat(copy)).mtimeMs;
  await new Promise((r) => setTimeout(r, 20));
  await keepVersions(dir, [plan('1', '# Plan v1\n')]);
  assert.equal((await fs.stat(copy)).mtimeMs, first, 'the same words: nothing written again');
  older = await keepVersions(dir, [plan('2', '# Plan v2\n')]);
  assert.deepEqual(older.get('implementation-plan.md').map((v) => [v.n, v.id, v.text]), [['1', 'versions/implementation-plan.v1.md', '# Plan v1\n']]);
  await keepVersions(dir, [plan('3', '# Plan v3\n')]);
  older = await keepVersions(dir, [plan('10', '# Plan v10\n')]);
  assert.deepEqual(older.get('implementation-plan.md').map((v) => v.n), ['3', '2', '1'], 'by number, 10 after 3');
  assert.equal(older.get('implementation-plan.md')[0].name, 'Implementation plan v3');
});

test('the copies survive a restart: a fresh call reads them from the folder', async () => {
  const { dir } = await jobDir();
  await keepVersions(dir, [{ file: 'spec', name: 'Product spec', version: '0.3', text: 'spec 0.3', type: 'md' }]);
  // A new process knows nothing but the folder.
  const { keepVersions: again } = await import(`../lib/doc-versions.js?restart=${Date.now()}`);
  const older = await again(dir, [{ file: 'spec', name: 'Product spec', version: '0.4', text: 'spec 0.4', type: 'md' }]);
  assert.deepEqual(older.get('spec').map((v) => [v.n, v.id, v.text]), [['0.3', 'versions/@spec.v0.3.md', 'spec 0.3']]);
});

test('rewritten under the same number: the words seen before are kept as an earlier copy of that number (at most a few)', async () => {
  const { dir } = await jobDir();
  await keepVersions(dir, [plan('2', 'first words')]);
  let older = await keepVersions(dir, [plan('2', 'second words')]);
  assert.deepEqual(older.get('implementation-plan.md').map((v) => [v.n, v.text]), [['2 (earlier 1)', 'first words']]);
  for (let i = 3; i <= EARLIER_MAX + 3; i++) older = await keepVersions(dir, [plan('2', `words ${i}`)]);
  const list = older.get('implementation-plan.md');
  assert.equal(list.length, EARLIER_MAX);
  assert.equal(list[0].text, `words ${EARLIER_MAX + 2}`, 'the newest earlier words first');
  assert.equal(await fs.readFile(path.join(dir, 'versions', 'implementation-plan.v2.md'), 'utf8'), `words ${EARLIER_MAX + 3}`);
});

test('never outside the job’s folder: a symlinked versions folder is not written through; odd names and versions are skipped', async () => {
  const { root, dir } = await jobDir();
  const elsewhere = path.join(root, 'elsewhere');
  await fs.mkdir(elsewhere);
  await fs.symlink(elsewhere, path.join(dir, 'versions'));
  const older = await keepVersions(dir, [plan('1', 'words')]);
  assert.equal(older.has('implementation-plan.md'), false);
  assert.deepEqual(await fs.readdir(elsewhere), []);
  const { dir: other } = await jobDir();
  await keepVersions(other, [
    { file: '../outside.md', version: '1', text: 'x', type: 'md' },
    { file: 'review/db.md', version: '../../1', text: 'x', type: 'md' },
    { file: 'notes.json', version: '1', text: '{}', type: 'json' },
    { file: 'findings.md', version: null, text: 'x', type: 'md' },
  ]);
  assert.deepEqual((await fs.readdir(path.join(other, 'versions')).catch(() => [])).sort(), [], 'a name with a .. part is never kept');
  assert.equal(versionBase('review/db.md'), 'review_2fdb');
  assert.equal(compareVersionLabels('0.10', '0.9'), 1);
});

test('fix round 2: no two documents share a copy: review/db.md and review__db.md, the repository spec and a job’s spec.md; a second rebuild writes nothing', async () => {
  const { dir } = await jobDir();
  const docs = [
    { file: 'review/db.md', name: 'Review: db', version: '1', text: 'the db lens', type: 'md' },
    { file: 'review__db.md', name: 'Review db notes', version: '1', text: 'some notes', type: 'md' },
    { file: 'spec', name: 'Product spec', version: '1', text: 'the repository spec', type: 'md' },
    { file: 'spec.md', name: 'Spec notes', version: '1', text: 'the job folder’s spec.md', type: 'md' },
  ];
  await keepVersions(dir, docs);
  const files = async () => Promise.all((await fs.readdir(path.join(dir, 'versions'))).sort().map(async (n) => [n, (await fs.readFile(path.join(dir, 'versions', n), 'utf8')), (await fs.stat(path.join(dir, 'versions', n))).mtimeMs]));
  const first = await files();
  assert.deepEqual(first.map(([n, t]) => [n, t]), [
    ['@spec.v1.md', 'the repository spec'],
    ['review_2fdb.v1.md', 'the db lens'],
    ['review_5f_5fdb.v1.md', 'some notes'],
    ['spec.v1.md', 'the job folder’s spec.md'],
  ]);
  await new Promise((r) => setTimeout(r, 20));
  const older = await keepVersions(dir, docs);
  assert.deepEqual(await files(), first, 'nothing written again, so no watch fires and no rebuild follows');
  for (const d of docs) assert.deepEqual(older.get(d.file), [], d.file);
  // The same document twice in one call is written once.
  await keepVersions(dir, [docs[0], { ...docs[0], text: 'other words' }]);
  assert.equal(await fs.readFile(path.join(dir, 'versions', 'review_2fdb.v1.md'), 'utf8'), 'the db lens');
});

test('fix round 2: a write under a job’s versions/ folder is not a change of the job; one document’s failed copy leaves the others kept and listed', async () => {
  assert.equal(inVersionsFolder(path.join('orbit-1-x', 'versions', 'spec.v1.md')), true);
  assert.equal(inVersionsFolder('orbit-1-x/versions/spec.v1.md.123.abcd1234.tmp'), true);
  assert.equal(inVersionsFolder(path.join('orbit-1-x', 'spec.md')), false);
  assert.equal(inVersionsFolder(path.join('orbit-1-x', 'versions')), false, 'the folder made is not a copy, but a write in it is');
  assert.equal(inVersionsFolder(path.join('orbit-1-x', 'review', 'versions', 'x.md')), false);
  const { dir } = await jobDir();
  await keepVersions(dir, [plan('1', 'plan 1'), { file: 'test-plan.md', version: '1', text: 'tests 1', type: 'md' }]);
  const write = async (file, text) => {
    if (file.includes('implementation-plan')) throw new Error('disk full');
    await fs.writeFile(file, text);
  };
  const older = await keepVersions(dir, [plan('2', 'plan 2'), { file: 'test-plan.md', version: '2', text: 'tests 2', type: 'md' }], { write });
  assert.equal(older.has('implementation-plan.md'), false, 'left out');
  assert.deepEqual(older.get('test-plan.md').map((v) => v.n), ['1'], 'the other is still kept and listed');
});

test('fix round 2: a save’s temporary file a crash left behind is cleared once it is a minute old', async () => {
  const { dir } = await jobDir();
  await keepVersions(dir, [plan('1', 'plan 1')]);
  const old = path.join(dir, 'versions', 'implementation-plan.v2.md.999.deadbeef.tmp');
  const fresh = path.join(dir, 'versions', 'implementation-plan.v2.md.999.feedface.tmp');
  await fs.writeFile(old, 'half');
  await fs.writeFile(fresh, 'half');
  const then = new Date(Date.now() - STALE_TMP_MS - 5000);
  await fs.utimes(old, then, then);
  await keepVersions(dir, [plan('1', 'plan 1')]);
  const left = await fs.readdir(path.join(dir, 'versions'));
  assert.equal(left.includes(path.basename(old)), false);
  assert.equal(left.includes(path.basename(fresh)), true, 'one being written now stays');
});
