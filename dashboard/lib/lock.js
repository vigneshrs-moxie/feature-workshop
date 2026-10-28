// One job, one driver (plan D12): the dashboard's runner or a terminal /feature session, never both.
// The lock is `lock.json` in the job's folder (~/.claude/feature-work/<slug>/):
//   { "owner": "runner" | "terminal", "pid": 1234, "branch": "feat/x", "acquiredAt": "<ISO time>" }
// It is created with O_EXCL (flag 'wx'), so of two processes starting at once only one gets it.
// The terminal session writes the same file with the shell (`set -o noclobber`, or New-Item on
// PowerShell; see the feature skill's SKILL.md), with the pid of its Claude Code process.
// A lock whose process is gone is taken over: the pid is checked with process.kill(pid, 0), or
// `tasklist` on Windows. There is no heartbeat; pid liveness is the rule. A lock written before the
// computer last started is stale too, since its pid may have been given to another program since.
// Everything here is synchronous, so nothing else in this process runs between the check and the write.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpError } from './http-guard.js';

export const LOCK_FILE = 'lock.json';

const lockPath = (jobDir) => path.join(jobDir, LOCK_FILE);

/** Is a process with this pid running? On Windows asks `tasklist`; elsewhere signal 0. */
export function pidAlive(pid, { platform = process.platform, run = execFileSync } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (platform === 'win32') {
    let out;
    try {
      out = String(run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 5000, windowsHide: true }));
    } catch {
      return true; // can't tell: don't take over a lock that may still be in use
    }
    // A match is a CSV row whose second field is the pid; no match prints an "INFO:" line instead.
    return out.split(/\r?\n/).some((line) => line.split(',')[1]?.replace(/"/g, '').trim() === String(pid));
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM'; // it exists, it just belongs to someone else
  }
}

/** The lock as written, or null when there is none. An unreadable or broken file reads as { broken: true }. */
export function readLock(jobDir) {
  return readLockFile(lockPath(jobDir));
}

function readLockFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return null;
    return { broken: true };
  }
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object') return { broken: true };
    const pid = Number(raw.pid);
    return {
      owner: raw.owner === 'terminal' ? 'terminal' : 'runner',
      pid: Number.isInteger(pid) && pid > 0 ? pid : null,
      branch: typeof raw.branch === 'string' && raw.branch ? raw.branch : null,
      acquiredAt: typeof raw.acquiredAt === 'string' ? raw.acquiredAt : null,
    };
  } catch {
    return { broken: true };
  }
}

const bootTime = () => Date.now() - os.uptime() * 1000;

/** Is this lock still in force: a readable lock whose process is running and started since the last restart? */
export function isLive(lock, { alive = pidAlive, bootedAt = bootTime } = {}) {
  if (!lock || lock.broken || !lock.pid) return false;
  const at = Date.parse(lock.acquiredAt ?? '');
  // A minute's slack for clocks; a time it can't read doesn't count against the lock.
  if (Number.isFinite(at) && at < bootedAt() - 60_000) return false;
  return Boolean(alive(lock.pid));
}

/**
 * Take the job's lock. Returns
 *   { held: false, lock, tookOver }   it is ours now (tookOver: the stale lock it replaced, or null);
 *   { held: true, by }                another running process has it (by: its lock);
 *   { held: false, lock: null, reason: 'no-folder' }   the job's folder isn't there, so there is
 *                                     nothing to lock (and nobody else can hold it).
 * A lock this same process already holds is simply rewritten. Other write errors are thrown.
 */
export function acquire(jobDir, { owner = 'runner', pid = process.pid, branch = null, now = () => new Date(), alive = pidAlive, bootedAt = bootTime } = {}) {
  const lock = { owner: owner === 'terminal' ? 'terminal' : 'runner', pid, branch: branch || null, acquiredAt: now().toISOString() };
  const text = `${JSON.stringify(lock)}\n`;
  let tookOver = null;
  for (let tries = 0; tries < 3; tries++) {
    try {
      fs.writeFileSync(lockPath(jobDir), text, { flag: 'wx', mode: 0o600 });
      return { held: false, lock, tookOver };
    } catch (err) {
      if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return { held: false, lock: null, reason: 'no-folder' };
      if (err?.code !== 'EEXIST') throw err;
    }
    const was = readLock(jobDir);
    if (was && !was.broken && was.pid === pid) {
      fs.writeFileSync(lockPath(jobDir), text, { mode: 0o600 });
      return { held: false, lock, tookOver: null };
    }
    if (isLive(was, { alive, bootedAt })) return { held: true, by: was };
    tookOver = was;
    clearStale(jobDir, was);
  }
  // Someone else kept writing a lock between our tries: theirs stands.
  const by = readLock(jobDir);
  return by && !by.broken ? { held: true, by } : { held: true, by: { owner: 'runner', pid: null, branch: null, acquiredAt: null } };
}

// Move the stale lock aside and look at what was moved: if another process replaced it in the
// meantime with a fresh one of its own, put that back (link never overwrites) instead of deleting it.
function clearStale(jobDir, seen) {
  const aside = path.join(jobDir, `${LOCK_FILE}.stale-${process.pid}-${Date.now()}`);
  try { fs.renameSync(lockPath(jobDir), aside); } catch (err) { if (err?.code === 'ENOENT') return; throw err; }
  const moved = readLockFile(aside);
  const same = (a, b) => (a?.broken && b?.broken) || (a && b && !a.broken && !b.broken && a.pid === b.pid && a.acquiredAt === b.acquiredAt);
  if (!same(moved, seen)) { try { fs.linkSync(aside, lockPath(jobDir)); } catch { /* a newer one is there already */ } }
  try { fs.unlinkSync(aside); } catch { /* gone already */ }
}

/** Remove the lock, only when it is this process's (pid). Returns whether it removed one. */
export function release(jobDir, { pid = process.pid } = {}) {
  const was = readLock(jobDir);
  if (!was || was.broken || was.pid !== pid) return false;
  try { fs.unlinkSync(lockPath(jobDir)); return true; } catch { return false; }
}

/** Another running process's lock on this job, or null (none, ours, or stale). */
export function heldElsewhere(jobDir, { pid = process.pid, alive = pidAlive, bootedAt = bootTime } = {}) {
  const lock = readLock(jobDir);
  if (!lock || lock.broken || lock.pid === pid) return null;
  return isLive(lock, { alive, bootedAt }) ? lock : null;
}

const when = (iso) => {
  const d = new Date(iso ?? '');
  return Number.isFinite(d.getTime()) ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'a while ago';
};

/** One plain sentence saying who has the job: "This job is open in a terminal (pid N, since T)." */
export function describeLock(lock) {
  const facts = `(pid ${lock?.pid ?? 'unknown'}, since ${when(lock?.acquiredAt)})`;
  return lock?.owner === 'terminal'
    ? `This job is open in a terminal ${facts}.`
    : `This job is being run by another copy of the dashboard ${facts}.`;
}

/** The refusal when the job is held elsewhere: a 409 the page shows as the lock card (code 'job-locked'). */
export class JobLocked extends HttpError {
  constructor(lock) {
    const next = lock?.owner === 'terminal'
      ? 'Finish there, or close that Claude Code session (/exit), then send again. Nothing was sent.'
      : 'Stop it there first, then send again. Nothing was sent.';
    super(409, `${describeLock(lock)} Only one place can work on a job at a time. ${next}`, {
      code: 'job-locked',
      lock: { owner: lock?.owner ?? 'runner', pid: lock?.pid ?? null, branch: lock?.branch ?? null, acquiredAt: lock?.acquiredAt ?? null },
    });
    this.name = 'JobLocked';
    this.lock = lock;
  }
}

/**
 * The branch checked out in a folder (or the git folder above it), or null (not git, detached).
 * Read from .git/HEAD directly, without running git, so it costs no time when a reply starts.
 */
export function branchOf(dir) {
  if (!dir) return null;
  try {
    for (let at = path.resolve(dir); ; at = path.dirname(at)) {
      const dotGit = path.join(at, '.git');
      let st = null;
      try { st = fs.statSync(dotGit); } catch { /* not here */ }
      if (st) {
        // A worktree's .git is a file naming its real git folder.
        const gitDir = st.isDirectory() ? dotGit : path.resolve(at, /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'))?.[1]?.trim() ?? '');
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8');
        return /^ref:\s*refs\/heads\/(.+)$/m.exec(head)?.[1]?.trim() || null;
      }
      if (path.dirname(at) === at) return null;
    }
  } catch {
    return null;
  }
}
