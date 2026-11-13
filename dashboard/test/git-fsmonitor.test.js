// Starbase's own git calls never run the program a repository's core.fsmonitor setting names: a job
// folder's git settings are not trusted code. Every git command Starbase starts goes through the
// helpers in lib/git.js (execGit, execGitSync, runGit), which turn the setting off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { execGit, execGitSync, runGit } from '../lib/git.js';
import { git as integrateGit } from '../lib/integrate.js';
import { gitRead } from '../lib/review-round.js';
import { checkWorktree } from '../lib/close.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const onWindows = process.platform === 'win32';

// A repository (and a linked worktree) whose config names a program in core.fsmonitor. The program
// writes a marker file each time git runs it.
function hookedRepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'starbase-fsmonitor-')));
  const repo = path.join(root, 'repo');
  const wt = path.join(root, 'wt');
  const marker = path.join(root, 'fsmonitor-ran');
  const hook = path.join(root, 'fsmonitor-hook.sh');
  fs.writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o755 });
  fs.mkdirSync(repo);
  const g = (dir, ...a) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', dir, ...a], { stdio: 'pipe' }).toString();
  g(repo, 'init', '-q', '-b', 'main');
  g(repo, 'config', 'user.email', 't@example.invalid'); g(repo, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  g(repo, 'add', '.'); g(repo, 'commit', '-qm', 'a');
  g(repo, 'worktree', 'add', '-q', '-b', 'feature/x', wt);
  g(repo, 'config', 'core.fsmonitor', hook); // last: setting the repository up never ran it
  fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
  const ran = () => fs.existsSync(marker);
  const clear = () => fs.rmSync(marker, { force: true });
  return { root, repo, wt, ran, clear };
}

test('the setup is real: a plain git status in that repository runs the core.fsmonitor program', { skip: onWindows }, () => {
  const r = hookedRepo();
  assert.equal(r.ran(), false, 'nothing ran while setting it up');
  execFileSync('git', ['-C', r.repo, 'status', '--porcelain'], { stdio: 'pipe' });
  assert.equal(r.ran(), true, 'git ran the program named in core.fsmonitor');
  fs.rmSync(r.root, { recursive: true, force: true });
});

test('each kind of Starbase git call leaves the core.fsmonitor program unrun', { skip: onWindows }, async () => {
  const r = hookedRepo();
  const none = (what) => { assert.equal(r.ran(), false, `${what} ran the core.fsmonitor program`); r.clear(); };

  // The helpers themselves: callback, sync and promise.
  const out = await new Promise((resolve, reject) => execGit(['-C', r.repo, 'status', '--porcelain'], {}, (err, stdout) => (err ? reject(err) : resolve(String(stdout)))));
  assert.match(out, /a\.txt/);
  none('execGit');
  assert.match(String(execGitSync(['-C', r.repo, 'status', '--porcelain'], { stdio: 'pipe' })), /a\.txt/);
  none('execGitSync');
  assert.match((await runGit(['-C', r.repo, 'diff', '--stat'])).stdout, /a\.txt/);
  none('runGit');
  await assert.rejects(runGit(['-C', r.repo, 'no-such-command']), (err) => typeof err.stderr === 'string' && err.code === 1, 'a failure rejects with git’s words and exit code');
  r.clear();

  // The modules' own git runners, through calls that read the working tree.
  assert.equal((await integrateGit(r.repo, ['status', '--porcelain'])).code, 0);
  none('lib/integrate.js git');
  assert.match((await gitRead(r.repo, ['status', '--porcelain'])).out, /a\.txt/);
  none('lib/review-round.js gitRead');
  fs.writeFileSync(path.join(r.wt, 'b.txt'), 'b\n');
  assert.match((await checkWorktree(r.wt, r.repo, { fetch: false })).reason, /aren’t committed/, 'the check got as far as git status');
  none('lib/close.js checkWorktree');
  fs.rmSync(r.root, { recursive: true, force: true });
});

// ---------- No git spawn outside the helper ----------

// A call whose first argument is the word git: execFile('git', …), spawn("git", …), run('git', …), sh(`git`, …).
const GIT_CALL = /\b([A-Za-z_$][\w$]*)\s*\(\s*(['"`])git\2\s*,/g;
// Calls that take the word git as a label, never as the program to start.
const NOT_A_SPAWN = new Set(['check', 'refuse']);
const HELPER = path.join('dashboard', 'lib', 'git.js');

function strayGitCalls(text) {
  return [...text.matchAll(GIT_CALL)].filter((m) => !NOT_A_SPAWN.has(m[1])).map((m) => ({ callee: m[1], line: text.slice(0, m.index).split('\n').length }));
}

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'test') sourceFiles(p, out); }
    else if (/\.[cm]?js$/.test(e.name)) out.push(p);
  }
  return out;
}

test('the source walk catches a git spawn in any of its forms', () => {
  assert.deepEqual(strayGitCalls("execFile('git', ['status'])").map((s) => s.callee), ['execFile']);
  assert.deepEqual(strayGitCalls('const x = 1;\n  spawn(\n    "git", args)').map((s) => s.line), [2]);
  assert.deepEqual(strayGitCalls('await run(`git`, [x]); sh( \'git\' , y); execFileSync(\'git\', z)').map((s) => s.callee), ['run', 'sh', 'execFileSync']);
  assert.deepEqual(strayGitCalls("check('git', 'Git', {}); refuse('git', 'words'); on('git'); execGit(['status'])"), []);
});

test('every git command Starbase starts goes through the helper in lib/git.js', () => {
  const files = [...sourceFiles(path.join(ROOT, 'dashboard')), ...sourceFiles(path.join(ROOT, 'bin'))];
  assert.ok(files.length > 50, 'the walk found the source');
  const stray = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const found = strayGitCalls(fs.readFileSync(file, 'utf8'));
    if (rel === HELPER) {
      // The helper's own two: execFile and execFileSync, each with the setting turned off.
      assert.deepEqual(found.map((s) => s.callee).sort(), ['execFile', 'execFileSync'], 'lib/git.js starts git only in its helpers');
      continue;
    }
    for (const s of found) stray.push(`${rel}:${s.line} ${s.callee}('git', …)`);
  }
  assert.deepEqual(stray, [], `git started outside lib/git.js execGit / execGitSync / runGit:\n${stray.join('\n')}`);
  assert.match(fs.readFileSync(path.join(ROOT, HELPER), 'utf8'), /'-c', 'core\.fsmonitor=false'/, 'the helper turns the setting off');
});
