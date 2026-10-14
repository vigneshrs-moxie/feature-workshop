// Removing a finished job's worktree, only when nothing would be lost: no uncommitted or untracked
// changes, and every commit on it already on GitHub (on some remote branch: pushed, or merged).
// Uses `git worktree remove` without --force, so git refuses too if anything is off. The branch is
// never deleted. Commands run through execFile (no shell) with a time limit.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function git(dir, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, ...args], { timeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout).trim(), err: String(stderr).trim() });
    });
  });
}

/** Can this worktree go? { ok, reason } — reason in plain words when it can't. */
export async function checkWorktree(worktree, repoPath, { fetch = true } = {}) {
  if (!worktree || !path.isAbsolute(worktree) || !fs.existsSync(worktree)) return { ok: false, reason: 'The job’s worktree isn’t there (already removed?).' };
  const top = await git(worktree, ['rev-parse', '--show-toplevel']);
  if (!top.ok || path.resolve(top.out) !== path.resolve(worktree)) return { ok: false, reason: 'That folder isn’t the top of a git worktree.' };
  const common = await git(worktree, ['rev-parse', '--git-common-dir']);
  const gitDir = await git(worktree, ['rev-parse', '--git-dir']);
  if (!common.ok || !gitDir.ok || path.resolve(worktree, common.out) === path.resolve(worktree, gitDir.out)) return { ok: false, reason: 'That’s a main checkout, not a worktree. Only worktrees are removed.' };
  if (repoPath && path.resolve(repoPath) === path.resolve(worktree)) return { ok: false, reason: 'That’s your main folder. Only the job’s own worktree is removed.' };
  const status = await git(worktree, ['status', '--porcelain', '--untracked-files=normal']);
  if (!status.ok) return { ok: false, reason: 'Couldn’t read the worktree’s state.' };
  if (status.out) return { ok: false, reason: `It has changes that aren’t committed (${status.out.split('\n').length} file${status.out.split('\n').length === 1 ? '' : 's'}). Commit or discard them first.` };
  // Bring the remote branches up to date, so "on GitHub" is current; carry on with what we have if offline.
  if (fetch) await git(worktree, ['fetch', '--all', '--prune', '--quiet'], 60000);
  const head = await git(worktree, ['rev-parse', 'HEAD']);
  if (!head.ok) return { ok: false, reason: 'Couldn’t read the worktree’s latest commit.' };
  const remote = await git(worktree, ['branch', '-r', '--contains', head.out]);
  if (!remote.ok || !remote.out) return { ok: false, reason: 'Its latest commit isn’t on GitHub yet (not pushed or merged), so removing it could lose work.' };
  return { ok: true, head: head.out.slice(0, 8), on: remote.out.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 3) };
}

/** Remove the worktree (not the branch). Checks first. */
export async function removeWorktree(worktree, repoPath) {
  const check = await checkWorktree(worktree, repoPath);
  if (!check.ok) return check;
  const rm = await git(repoPath && fs.existsSync(repoPath) ? repoPath : worktree, ['worktree', 'remove', worktree]);
  if (!rm.ok) return { ok: false, reason: `git wouldn’t remove it: ${rm.err.split('\n')[0] || 'unknown error'}` };
  return { ok: true, head: check.head, on: check.on };
}
