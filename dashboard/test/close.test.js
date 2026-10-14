import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { checkWorktree, removeWorktree } from '../lib/close.js';

test('closing a job: its worktree goes only when nothing would be lost, and the branch stays', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-close-')));
  const repo = path.join(root, 'acme');
  const remote = path.join(root, 'remote.git');
  const wt = path.join(root, 'orbit-x');
  const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' }).toString().trim();
  await fs.mkdir(repo);
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.email', 't@example.invalid'); git(repo, 'config', 'user.name', 'T');
  await fs.writeFile(path.join(repo, 'a'), 'a'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'a');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/x', wt);
  git(wt, 'config', 'user.email', 't@example.invalid'); git(wt, 'config', 'user.name', 'T');

  assert.match((await checkWorktree(repo, repo)).reason, /main checkout|main folder/, 'never the main folder');
  await fs.writeFile(path.join(wt, 'b'), 'b');
  assert.match((await checkWorktree(wt, repo)).reason, /aren’t committed/);
  git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'b');
  assert.match((await checkWorktree(wt, repo)).reason, /isn’t on GitHub/, 'unpushed commits block it');
  git(wt, 'push', '-q', 'origin', 'feature/x');
  const r = await removeWorktree(wt, repo);
  assert.equal(r.ok, true, r.reason);
  assert.equal(await fs.stat(wt).then(() => true, () => false), false, 'the worktree folder is gone');
  assert.equal(git(repo, 'branch', '--list', 'feature/x').replace('*', '').trim(), 'feature/x', 'the branch is kept');
  await fs.rm(root, { recursive: true, force: true });
});
