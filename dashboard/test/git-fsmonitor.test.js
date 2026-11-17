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

import { execGit, execGitSync, ghRunner, noFsmonitorEnv, runGit } from '../lib/git.js';
import { gatherRepo } from '../lib/flow.js';
import { checkForUpdate } from '../lib/update.js';
import { git as integrateGit } from '../lib/integrate.js';
import { gitRead } from '../lib/review-round.js';
import { checkWorktree } from '../lib/close.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const onWindows = process.platform === 'win32';

// A repository (and a linked worktree) whose config names a program in core.fsmonitor. The program
// writes a marker file each time git runs it.
function hookedRepo(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'starbase-fsmonitor-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); // also when the test fails
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

test('the setup is real: a plain git status in that repository runs the core.fsmonitor program', { skip: onWindows }, (t) => {
  const r = hookedRepo(t);
  assert.equal(r.ran(), false, 'nothing ran while setting it up');
  execFileSync('git', ['-C', r.repo, 'status', '--porcelain'], { stdio: 'pipe' });
  assert.equal(r.ran(), true, 'git ran the program named in core.fsmonitor');
});

test('each kind of Starbase git call leaves the core.fsmonitor program unrun', { skip: onWindows }, async (t) => {
  const r = hookedRepo(t);
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
});

// ---------- No git spawn outside the helper ----------

// A call whose first argument is the word git: execFile('git', …), spawn("git", …), run('git', …), sh(`git`, …).
const GIT_CALL = /\b([A-Za-z_$][\w$]*)\s*\(\s*(['"`])git\2\s*,/g;
// Calls that take the word git as a label, never as the program to start.
const NOT_A_SPAWN = new Set(['check', 'refuse']);
// A child_process call that starts git (or gh) from a shell string, or with no arguments at all:
// exec('git status'), execSync(`git ${x}`), spawn('git'), exec("gh pr list"). Never allowed: a shell
// string can't go through the helper. (Not seen: a program named through a variable, as doctor.js's
// run(gitPath, ['--version']) and run(ghPath, ['auth', 'status']) do; neither reads a job folder.)
const SHELL_CALL = /\b(exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(\s*(['"`])(?:git|gh)(?:\s|\2\s*\))/g;
const HELPER = path.join('dashboard', 'lib', 'git.js');

const lineAt = (text, index) => text.slice(0, index).split('\n').length;
function strayGitCalls(text) {
  const found = [...text.matchAll(GIT_CALL)].filter((m) => !NOT_A_SPAWN.has(m[1])).map((m) => ({ callee: m[1], line: lineAt(text, m.index), at: m.index }));
  for (const m of text.matchAll(SHELL_CALL)) if (!found.some((f) => f.at === m.index)) found.push({ callee: m[1], line: lineAt(text, m.index), at: m.index });
  return found.sort((a, b) => a.at - b.at).map(({ callee, line }) => ({ callee, line }));
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
  assert.deepEqual(strayGitCalls("exec('git status'); execSync(`git ${x}`); spawn('git'); spawnSync( \"git\" ); exec('gh pr list')").map((s) => s.callee), ['exec', 'execSync', 'spawn', 'spawnSync', 'exec']);
  assert.deepEqual(strayGitCalls("check('git', 'Git', {}); refuse('git', 'words'); on('git'); install('git'); execGit(['status']); exec('github'); say('git is fine')"), []);
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

// ---------- gh: every git it starts runs with core.fsmonitor off too ----------

test('noFsmonitorEnv adds core.fsmonitor=false after any git settings already in the environment', () => {
  assert.deepEqual(noFsmonitorEnv({ PATH: '/bin' }), { PATH: '/bin', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false' });
  const base = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'Sample', GIT_CONFIG_KEY_1: 'core.pager', GIT_CONFIG_VALUE_1: 'cat' };
  const env = noFsmonitorEnv(base);
  assert.deepEqual(env, { ...base, GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_2: 'core.fsmonitor', GIT_CONFIG_VALUE_2: 'false' }, 'the two already there are kept');
  assert.equal(base.GIT_CONFIG_COUNT, '2', 'the environment given is not changed');
  assert.equal(noFsmonitorEnv({ GIT_CONFIG_COUNT: 'x' }).GIT_CONFIG_KEY_0, 'core.fsmonitor', 'a count that is not a number starts at 0');
  assert.equal(noFsmonitorEnv().GIT_CONFIG_COUNT !== undefined, true, 'process.env by default');
  // git itself reads it so: the setting is in force for a git started with this environment.
  assert.equal(execFileSync('git', ['config', '--get', 'core.fsmonitor'], { env: noFsmonitorEnv({ ...process.env, ...base }) }).toString().trim(), 'false');
});

test('every gh runner hands gh core.fsmonitor=false, after the git settings already there', { skip: onWindows }, async (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'starbase-gh-env-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'env.txt');
  fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh\nenv > "$SB_GH_ENV_OUT"\necho '[]'\n`, { mode: 0o755 }); // a stand-in gh that writes its environment
  const saved = { PATH: process.env.PATH, SB_GH_ENV_OUT: process.env.SB_GH_ENV_OUT, GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT, GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0 };
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  Object.assign(process.env, { PATH: `${dir}${path.delimiter}${process.env.PATH}`, SB_GH_ENV_OUT: out, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'Sample' });
  const seen = (what) => {
    assert.ok(fs.existsSync(out), `${what}: the stand-in gh ran`);
    const env = Object.fromEntries(fs.readFileSync(out, 'utf8').split('\n').filter((l) => l.startsWith('GIT_CONFIG_')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    assert.deepEqual(env, { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'Sample', GIT_CONFIG_KEY_1: 'core.fsmonitor', GIT_CONFIG_VALUE_1: 'false' }, what);
    fs.rmSync(out);
  };

  assert.equal((await ghRunner('gh')(['api', '--method', 'GET', 'user'])).ok, true);
  seen('lib/git.js ghRunner');
  const r = await gatherRepo({ repo: dir, jobs: [], fetch: true, git: async () => ({ ok: true, out: '' }), profileFor: async () => ({ github: 'sample/repo' }) });
  assert.deepEqual(r.errors ?? [], []);
  seen('lib/flow.js gatherRepo’s gh');
  await checkForUpdate({ env: {}, current: '1.0.0' });
  seen('lib/update.js checkForUpdate’s gh');
});

// A call whose first argument is the word gh: it must hand gh noFsmonitorEnv on the same line.
const GH_CALL = /\b([A-Za-z_$][\w$]*)\s*\(\s*(['"`])gh\2\s*,/g;

test('every gh spawn Starbase makes carries noFsmonitorEnv', () => {
  const files = [...sourceFiles(path.join(ROOT, 'dashboard')), ...sourceFiles(path.join(ROOT, 'bin'))];
  const stray = [];
  let seen = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(GH_CALL)) {
      if (NOT_A_SPAWN.has(m[1]) || m[1] === 'ghRunner') continue; // ghRunner hands gh the setting itself (checked below)
      seen++;
      const line = text.split('\n')[lineAt(text, m.index) - 1];
      if (!line.includes('noFsmonitorEnv(')) stray.push(`${path.relative(ROOT, file)}:${lineAt(text, m.index)} ${m[1]}('gh', …)`);
    }
  }
  assert.ok(seen >= 3, 'the walk found the gh calls (flow.js, update.js ×2)');
  assert.deepEqual(stray, [], `gh started without noFsmonitorEnv:\n${stray.join('\n')}`);
  // ghRunner names gh through a variable (STARBASE_GH's stand-in in tests), so the walk can't see it: its own line is checked.
  const helper = fs.readFileSync(path.join(ROOT, HELPER), 'utf8');
  const runner = helper.slice(helper.indexOf('export function ghRunner('), helper.indexOf('const defaultGh'));
  assert.match(runner, /execFile\([^\n]*env: noFsmonitorEnv\(/, 'ghRunner hands gh noFsmonitorEnv');
});
