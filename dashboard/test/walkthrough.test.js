// The review walkthrough on a job (lib/docs.js walkthroughPath/Info/readWalkthrough): found by the
// job's worktree and branch the way the review-walkthrough skill's build.py names it, its published
// link from the .url beside it, served with links in a new tab; never a symlink. Temp folders only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DocError, readWalkthrough, walkthroughInfo, walkthroughPath } from '../lib/docs.js';

const JOB = { worktree: '/r/orbit-notes', repoPath: '/r/app', branch: 'feature/notes v2' };

test('walkthrough: named like build.py does, from the worktree (else the repo) and the branch', () => {
  assert.deepEqual(walkthroughPath(JOB, '/w'), { dir: '/w/orbit-notes', file: 'feature-notes-v2.html' });
  assert.deepEqual(walkthroughPath({ ...JOB, worktree: null }, '/w'), { dir: '/w/app', file: 'feature-notes-v2.html' });
  assert.equal(walkthroughPath({ ...JOB, branch: null }, '/w'), null);
});

test('walkthrough: info and page, its published link, and no symlinks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-'));
  assert.equal(await walkthroughInfo(JOB, root), null);
  await assert.rejects(readWalkthrough(JOB, { root }), (e) => e instanceof DocError && e.status === 404);
  await fs.mkdir(path.join(root, 'orbit-notes'));
  const file = path.join(root, 'orbit-notes', 'feature-notes-v2.html');
  await fs.writeFile(file, '<!doctype html><html><head><title>W</title></head><body><a href="https://github.com">x</a></body></html>');
  assert.equal((await walkthroughInfo(JOB, root)).url, null);
  await fs.writeFile(file.replace(/html$/, 'url'), 'https://claude.ai/code/artifact/abc-123\n');
  assert.equal((await walkthroughInfo(JOB, root)).url, 'https://claude.ai/code/artifact/abc-123');
  await fs.writeFile(file.replace(/html$/, 'url'), 'javascript:alert(1)');
  assert.equal((await walkthroughInfo(JOB, root)).url, null);
  assert.match((await readWalkthrough(JOB, { root })).html, /<head><base target="_blank"><title>/);
  await assert.rejects(readWalkthrough(JOB, { root, maxBytes: 10 }), (e) => e.status === 413);
  // A symlink in place of the page is never served.
  const elsewhere = path.join(root, 'secret.html');
  await fs.writeFile(elsewhere, 'secret');
  await fs.rm(file);
  await fs.symlink(elsewhere, file);
  assert.equal(await walkthroughInfo(JOB, root), null);
  await fs.rm(root, { recursive: true });
});
