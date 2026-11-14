// A job's commits with the files each one changed (lib/git.js commitsWithFiles, Part 3 Task 4), read
// from a real temp repository made with `git init` here. Nothing else is read or changed.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { commitsWithFiles } from '../lib/git.js';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const sh = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'ignore'], env: ENV }).toString();

let root, repo, base;

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-git-commits-')));
  repo = path.join(root, 'repo');
  await fs.mkdir(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  await fs.writeFile(path.join(repo, 'app.js'), 'one\ntwo\nthree\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-q', '-m', 'base');
  base = sh(repo, 'rev-parse', 'HEAD').trim();
  sh(repo, 'switch', '-q', '-c', 'feature/x');
  // S1: a new file of two lines, and one line of app.js changed.
  await fs.mkdir(path.join(repo, 'src'));
  await fs.writeFile(path.join(repo, 'src', 'form.js'), 'a\nb\n');
  await fs.writeFile(path.join(repo, 'app.js'), 'one\nTWO\nthree\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-q', '-m', '[S1] the form');
  // S2: three lines added to the form, a binary file, a file with a space in its name.
  await fs.writeFile(path.join(repo, 'src', 'form.js'), 'a\nb\nc\nd\ne\n');
  await fs.writeFile(path.join(repo, 'logo.png'), Buffer.from([0, 1, 2, 0, 255, 0]));
  await fs.writeFile(path.join(repo, 'read me.md'), 'hello\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-q', '-m', 'S2: the list');
  // No step: one file removed.
  sh(repo, 'rm', '-q', 'read me.md');
  sh(repo, 'commit', '-q', '-m', 'Fix a typo');
});

after(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('each commit lists its files with lines added and removed, and says which are new', async () => {
  const list = await commitsWithFiles(repo, { base, head: 'feature/x' });
  assert.deepEqual(list.map((c) => [c.subject, c.step]), [['Fix a typo', null], ['S2: the list', 'S2'], ['[S1] the form', 'S1']], 'newest first, each with its step');
  const [fix, s2, s1] = list;
  // The commits() row is all there.
  for (const c of list) {
    assert.match(c.sha, /^[0-9a-f]{40}$/);
    assert.equal(c.author, 't');
    assert.ok(c.short && c.date);
  }
  const byPath = (c) => Object.fromEntries(c.files.map((f) => [f.path, f]));
  assert.deepEqual(byPath(s1), {
    'app.js': { path: 'app.js', added: 1, removed: 1, isNew: false },
    'src/form.js': { path: 'src/form.js', added: 2, removed: 0, isNew: true },
  });
  assert.deepEqual(byPath(s2), {
    'logo.png': { path: 'logo.png', added: null, removed: null, isNew: true },
    'read me.md': { path: 'read me.md', added: 1, removed: 0, isNew: true },
    'src/form.js': { path: 'src/form.js', added: 3, removed: 0, isNew: false },
  });
  assert.deepEqual(fix.files, [{ path: 'read me.md', added: 0, removed: 1, isNew: false }]);
  // The limit holds: the newest one only.
  assert.deepEqual((await commitsWithFiles(repo, { base, head: 'feature/x', limit: 1 })).map((c) => c.subject), ['Fix a typo']);
  // A folder that is gone, or a branch that isn't there: an error the caller turns into words, never a crash.
  await assert.rejects(commitsWithFiles(path.join(root, 'gone'), { base, head: 'feature/x' }));
  await assert.rejects(commitsWithFiles(repo, { base, head: 'feature/none' }));
  await assert.rejects(commitsWithFiles(repo, { base, head: '--output=x' }), /Unexpected branch or commit name/);
});

test('a repository’s own diff drivers are not run: the counts are the file’s own lines', async () => {
  const own = path.join(root, 'textconv');
  await fs.mkdir(own);
  sh(own, 'init', '-q', '-b', 'main');
  sh(own, 'commit', '-q', '--allow-empty', '-m', 'base');
  const start = sh(own, 'rev-parse', 'HEAD').trim();
  // A textconv driver that would turn any file into nine lines.
  sh(own, 'config', 'diff.nine.textconv', 'node -e "process.stdout.write(String.fromCharCode(120, 10).repeat(9))"');
  await fs.writeFile(path.join(own, '.gitattributes'), '*.txt diff=nine\n');
  await fs.writeFile(path.join(own, 'two.txt'), 'a\nb\n');
  sh(own, 'add', '.');
  sh(own, 'commit', '-q', '-m', 'two lines');
  const [c] = await commitsWithFiles(own, { base: start, head: 'main' });
  assert.deepEqual(c.files.find((f) => f.path === 'two.txt'), { path: 'two.txt', added: 2, removed: 0, isNew: true });
});

test('Task 23 fix round 2: refStamp changes when the branch moves, and is null when none of its ref files is there (a reftable repository)', async () => {
  const { commonDirOf, refStamp } = await import('../lib/git.js');
  const common = await commonDirOf(repo);
  assert.equal(common, path.join(repo, '.git'));
  const one = await refStamp(common, 'feature/x');
  assert.match(one, /\d/);
  assert.equal(await refStamp(common, 'feature/x'), one, 'unchanged while the branch stays');
  // No reflog, loose ref or packed-refs for it (as with git's reftable format): no stamp, so nothing is ever kept on it.
  assert.equal(await refStamp(common, 'feature/no-such-branch'), null);
  assert.equal(await refStamp(path.join(root, 'nowhere'), 'feature/x'), null);
});
