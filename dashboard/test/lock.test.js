// The job lock (lib/lock.js, plan D12): one driver per job, the runner or a terminal /feature
// session. lock.json is written with wx; a live pid's lock refuses, a dead pid's (or one from
// before the last restart) is taken over, and only the process that holds it removes it. The
// driver takes it when a reply starts and gives it back when the reply ends; closing a job refuses
// while a terminal holds it. Pretend sessions only: no Claude, no usage, no real job.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { acquire, release, readLock, pidAlive, isLive, heldElsewhere, describeLock, JobLocked, LOCK_FILE, branchOf } from '../lib/lock.js';
import { Driver } from '../lib/driver.js';
import { State } from '../lib/state.js';
import { checkWorktree } from '../lib/close.js';

const tmp = (prefix = 'workshop-lock-') => fsp.mkdtemp(path.join(os.tmpdir(), prefix));
const lockFile = (dir) => path.join(dir, LOCK_FILE);
const write = (dir, lock) => fs.writeFileSync(lockFile(dir), JSON.stringify(lock));
const now = () => new Date().toISOString();

// A real process that is running now, and the pid of one that has ended.
function child() {
  const p = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  return p;
}
async function deadPid() {
  const p = child();
  const pid = p.pid;
  await new Promise((r) => { p.on('exit', r); p.kill('SIGKILL'); });
  return pid;
}

test('acquire writes lock.json with owner, pid, branch and time; a second acquire by another live pid is refused', async () => {
  const dir = await tmp();
  const got = acquire(dir, { owner: 'runner', branch: 'feat/x' });
  assert.equal(got.held, false);
  const onDisk = JSON.parse(fs.readFileSync(lockFile(dir), 'utf8'));
  assert.deepEqual(Object.keys(onDisk).sort(), ['acquiredAt', 'branch', 'owner', 'pid']);
  assert.equal(onDisk.pid, process.pid);
  assert.equal(onDisk.owner, 'runner');
  assert.equal(onDisk.branch, 'feat/x');
  assert.ok(Number.isFinite(Date.parse(onDisk.acquiredAt)));
  assert.equal((fs.statSync(lockFile(dir)).mode & 0o777), 0o600, 'only you can read it');

  // Another process (here: a pretend pid that is alive) can't have it.
  const other = acquire(dir, { owner: 'terminal', pid: 424242, alive: () => true });
  assert.equal(other.held, true);
  assert.equal(other.by.pid, process.pid);
  assert.equal(other.by.owner, 'runner');
  // The same process asking again just gets it again (one process drives one reply at a time).
  assert.equal(acquire(dir, { branch: 'feat/y' }).held, false);
  assert.equal(readLock(dir).branch, 'feat/y');
});

test('a lock held by a live process refuses, with a plain sentence saying who and since when', async () => {
  const dir = await tmp();
  const p = child();
  try {
    write(dir, { owner: 'terminal', pid: p.pid, branch: 'feat/x', acquiredAt: now() });
    assert.equal(pidAlive(p.pid), true);
    const got = acquire(dir, { owner: 'runner' });
    assert.equal(got.held, true);
    assert.equal(got.by.pid, p.pid);
    assert.equal(got.by.owner, 'terminal');
    assert.equal(readLock(dir).pid, p.pid, 'the terminal’s lock is left as it was');
    assert.match(describeLock(got.by), new RegExp(`^This job is open in a terminal \\(pid ${p.pid}, since .+\\)\\.$`));
    assert.deepEqual(heldElsewhere(dir), got.by);
    const err = new JobLocked(got.by);
    assert.equal(err.status, 409);
    assert.equal(err.extra.code, 'job-locked');
    assert.deepEqual(err.extra.lock, { owner: 'terminal', pid: p.pid, branch: 'feat/x', acquiredAt: got.by.acquiredAt });
    assert.match(err.message, /open in a terminal .* Only one place can work on a job at a time\. .*\/exit.* Nothing was sent\.$/);
    assert.match(describeLock({ ...got.by, owner: 'runner' }), /another copy of the dashboard/);
  } finally {
    p.kill('SIGKILL');
  }
});

test('a dead process’s lock is taken over; so is a broken file and one from before the computer last started', async () => {
  const dir = await tmp();
  const pid = await deadPid();
  assert.equal(pidAlive(pid), false);
  write(dir, { owner: 'terminal', pid, branch: 'feat/old', acquiredAt: now() });
  const got = acquire(dir, { owner: 'runner', branch: 'feat/x' });
  assert.equal(got.held, false);
  assert.equal(got.tookOver.pid, pid);
  assert.equal(readLock(dir).pid, process.pid);
  assert.deepEqual(fs.readdirSync(dir), [LOCK_FILE], 'nothing left over from the takeover');

  fs.writeFileSync(lockFile(dir), '{"owner":"term');
  assert.equal(acquire(dir).held, false, 'a half-written file has no pid to wait for');

  // A pid that is alive but whose lock is older than the last restart: the pid was reused.
  write(dir, { owner: 'terminal', pid: 424242, acquiredAt: new Date(Date.now() - 3 * 3600_000).toISOString() });
  const bootedAt = () => Date.now() - 3600_000;
  assert.equal(isLive(readLock(dir), { alive: () => true, bootedAt }), false);
  assert.equal(acquire(dir, { alive: () => true, bootedAt }).held, false);
  // The same lock written after the restart still stands.
  write(dir, { owner: 'terminal', pid: 424242, acquiredAt: now() });
  assert.equal(acquire(dir, { alive: () => true, bootedAt }).held, true);
});

test('release removes the lock only for the process that holds it', async () => {
  const dir = await tmp();
  write(dir, { owner: 'terminal', pid: 424242, acquiredAt: now() });
  assert.equal(release(dir), false, 'not ours: left alone');
  assert.equal(readLock(dir).pid, 424242);
  assert.equal(release(dir, { pid: 424242 }), true);
  assert.equal(fs.existsSync(lockFile(dir)), false);
  assert.equal(release(dir), false, 'nothing to release');
  acquire(dir);
  assert.equal(release(dir), true);
  assert.equal(fs.existsSync(lockFile(dir)), false);
});

test('no job folder: nothing to lock, and the start is not refused', async () => {
  const dir = path.join(await tmp(), 'not-there');
  assert.deepEqual(acquire(dir), { held: false, lock: null, reason: 'no-folder' });
  assert.equal(fs.existsSync(dir), false, 'the folder is not created');
  assert.equal(readLock(dir), null);
  assert.equal(release(dir), false);
});

test('Windows: liveness comes from tasklist, chosen by process.platform', () => {
  const calls = [];
  const running = (cmd, args) => { calls.push([cmd, ...args]); return '"node.exe","4242","Console","1","40,000 K"\r\n'; };
  const none = () => 'INFO: No tasks are running which match the specified criteria.\r\n';
  assert.equal(pidAlive(4242, { platform: 'win32', run: running }), true);
  assert.deepEqual(calls[0], ['tasklist', '/FI', 'PID eq 4242', '/FO', 'CSV', '/NH']);
  assert.equal(pidAlive(4242, { platform: 'win32', run: none }), false);
  // A row for another pid (42420 contains 4242) doesn't count.
  assert.equal(pidAlive(4242, { platform: 'win32', run: () => '"node.exe","42420","Console","1","4 K"\r\n' }), false);
  // tasklist failing: can't tell, so the lock is kept.
  assert.equal(pidAlive(4242, { platform: 'win32', run: () => { throw new Error('no tasklist'); } }), true);
  // Elsewhere tasklist is never asked.
  let asked = false;
  pidAlive(process.pid, { platform: 'darwin', run: () => { asked = true; return ''; } });
  assert.equal(asked, false);
  assert.equal(pidAlive(0), false);
  assert.equal(pidAlive(-1), false);
  assert.equal(pidAlive(Number.NaN), false);
});

test('the branch comes from .git/HEAD without running git: a folder, a worktree, a subfolder, detached, none', async () => {
  const root = await tmp();
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, '.git', 'worktrees', 'wt'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  assert.equal(branchOf(repo), 'main');
  assert.equal(branchOf(path.join(repo, 'src', 'deep')), 'main');
  const wt = path.join(root, 'wt');
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(repo, '.git', 'worktrees', 'wt')}\n`);
  fs.writeFileSync(path.join(repo, '.git', 'worktrees', 'wt', 'HEAD'), 'ref: refs/heads/feature/x\n');
  assert.equal(branchOf(wt), 'feature/x');
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), '3d68e67aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n');
  assert.equal(branchOf(repo), null, 'detached');
  assert.equal(branchOf(path.join(root, 'nowhere')), null);
  assert.equal(branchOf(null), null);
});

// A pretend session: init, one reply, the result. `hold` keeps it going until released.
// Like the SDK, a cut-off (the run's abort signal) ends it with an error.
function pretendQuery({ hold = null, fail = false } = {}) {
  return ({ prompt, options }) => (async function* run() {
    const it = prompt[Symbol.asyncIterator]();
    await it.next();
    yield { type: 'system', subtype: 'init', session_id: 'sess-lock', model: 'pretend' };
    if (hold) {
      const signal = options.abortController.signal;
      await Promise.race([hold, new Promise((_r, no) => signal.addEventListener('abort', () => no(new Error('Aborted.')), { once: true }))]);
    }
    if (fail) throw new Error('The pretend session broke.');
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } };
    yield { type: 'result', subtype: 'success', result: 'Done.', total_cost_usd: 0 };
  })();
}
const ended = (driver, id) => new Promise((resolve) => {
  const on = (r) => { if (r.id === id && ['done', 'stopped', 'error', 'limited'].includes(r.status) && r.endedAt) { driver.off('run', on); resolve(r); } };
  driver.on('run', on);
});

test('driver: a reply takes the job’s lock as it starts and gives it back when it ends (done, error, stop)', async () => {
  const jobDir = await tmp('workshop-lock-job-');
  const state = new State(await tmp('workshop-lock-state-'));
  let let_go;
  const hold = new Promise((r) => { let_go = r; });
  const driver = new Driver({ queryFn: pretendQuery({ hold }), state, projectsDir: await tmp() });
  driver.idleGraceMs = 10;
  const base = { featureDir: jobDir, slug: 'lock-job', title: 'Lock job', cwd: jobDir, text: 'Go' };

  const run = await driver.start(base);
  const held = readLock(jobDir);
  assert.equal(held.owner, 'runner');
  assert.equal(held.pid, process.pid);
  assert.equal(held.branch, null, 'not a git folder: no branch');
  let_go();
  assert.equal((await ended(driver, run.id)).status, 'done');
  assert.equal(fs.existsSync(lockFile(jobDir)), false, 'released when the reply ended');

  const broken = new Driver({ queryFn: pretendQuery({ fail: true }), state, projectsDir: await tmp() });
  const r2 = await broken.start(base);
  assert.equal(readLock(jobDir).pid, process.pid);
  assert.equal((await ended(broken, r2.id)).status, 'error');
  assert.equal(fs.existsSync(lockFile(jobDir)), false, 'released on an error');

  const forever = new Driver({ queryFn: pretendQuery({ hold: new Promise(() => {}) }), state, projectsDir: await tmp() });
  const r3 = await forever.start(base);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(readLock(jobDir).pid, process.pid);
  const done = ended(forever, r3.id);
  await forever.stop(r3.id);
  forever.runs.get(r3.id).abort.abort(); // the pretend session ignores interrupts; cut it off
  assert.equal((await done).status, 'stopped');
  assert.equal(fs.existsSync(lockFile(jobDir)), false, 'released on stop');
});

test('driver: a job open in a terminal refuses the start with the lock card’s details, and nothing is sent', async () => {
  const jobDir = await tmp('workshop-lock-job-');
  const state = new State(await tmp('workshop-lock-state-'));
  const p = child();
  try {
    write(jobDir, { owner: 'terminal', pid: p.pid, branch: 'feat/x', acquiredAt: now() });
    let sessions = 0;
    const driver = new Driver({ queryFn: (...a) => { sessions++; return pretendQuery()(...a); }, state, projectsDir: await tmp() });
    await assert.rejects(driver.start({ featureDir: jobDir, slug: 'lock-job', title: 'Lock job', cwd: jobDir, text: 'Go' }), (err) => {
      assert.ok(err instanceof JobLocked);
      assert.equal(err.name, 'JobLocked', 'not Busy: a carry-on after a usage limit reports it instead of retrying');
      assert.equal(err.status, 409);
      assert.equal(err.extra.code, 'job-locked');
      assert.equal(err.extra.lock.pid, p.pid);
      assert.match(err.message, new RegExp(`This job is open in a terminal \\(pid ${p.pid}, since `));
      return true;
    });
    assert.equal(sessions, 0, 'no session was started');
    assert.equal(driver.list().length, 0, 'no run was listed');
    assert.equal(readLock(jobDir).pid, p.pid, 'the terminal’s lock is untouched');
    const audit = await fsp.readFile(state.auditFile, 'utf8').catch(() => '');
    assert.doesNotMatch(audit, /"action":"send"/, 'no send was recorded');
  } finally {
    p.kill('SIGKILL');
  }
  // Once the terminal's Claude Code has ended, the next start takes the job over.
  await new Promise((r) => setTimeout(r, 50));
  const driver = new Driver({ queryFn: pretendQuery(), state, projectsDir: await tmp() });
  driver.idleGraceMs = 10;
  const run = await driver.start({ featureDir: jobDir, slug: 'lock-job', title: 'Lock job', cwd: jobDir, text: 'Go' });
  assert.equal((await ended(driver, run.id)).status, 'done');
  assert.equal(fs.existsSync(lockFile(jobDir)), false);
});

test('closing a job: its worktree is not removed while a terminal holds the job', async () => {
  const jobDir = await tmp('workshop-lock-job-');
  const p = child();
  try {
    write(jobDir, { owner: 'terminal', pid: p.pid, branch: 'feat/x', acquiredAt: now() });
    const check = await checkWorktree(path.join(jobDir, 'no-worktree-needed'), null, { jobDir, fetch: false });
    assert.equal(check.ok, false);
    assert.match(check.reason, new RegExp(`^This job is open in a terminal \\(pid ${p.pid}, since .+\\)\\. Close it there \\(/exit\\) first\\.$`));
  } finally {
    p.kill('SIGKILL');
  }
  // Our own lock doesn't stand in the way (the check goes on to the worktree itself).
  write(jobDir, { owner: 'runner', pid: process.pid, acquiredAt: now() });
  const check = await checkWorktree(path.join(jobDir, 'not-there'), null, { jobDir, fetch: false });
  assert.match(check.reason, /worktree isn’t there/);
});
