// A job's older document versions (lib/doc-versions.js; the job page rebuild, Task 12 fix round 1):
// kept in the job's own versions/ folder at rebuild time, copied once, listed newest first, never
// written outside the job's folder or through a symlink.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { keepVersions, versionBase, compareVersionLabels, EARLIER_MAX } from '../lib/doc-versions.js';

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
  assert.deepEqual(older.get('spec').map((v) => [v.n, v.id, v.text]), [['0.3', 'versions/spec.v0.3.md', 'spec 0.3']]);
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
  assert.deepEqual((await fs.readdir(path.join(other, 'versions')).catch(() => [])).sort(), ['outside.v1.md'], 'the path part dropped from the name');
  assert.equal(versionBase('review/db.md'), 'review__db');
  assert.equal(compareVersionLabels('0.10', '0.9'), 1);
});
