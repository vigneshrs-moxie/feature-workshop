// Removing a finished job's worktree, only when nothing would be lost:
// - no uncommitted or untracked changes, and no files with hidden local edits;
// - no files git ignores except ones that come back by themselves (installed packages, build
//   output, generated code) or the settings file the job page made (unchanged apart from its port
//   and sign-in skip);
// - its latest commit already on GitHub (on some remote branch: pushed, or merged).
// Uses `git worktree remove` without --force, so git refuses too if anything is off. The branch is
// never deleted. Commands run through execFile (no shell) with time limits.
// With the job's folder (opts.jobDir), it is refused while another running process holds the job's
// lock (a terminal /feature session, lib/lock.js), and this process's own lock goes once it's removed.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { heldElsewhere, describeLock, release } from './lock.js';

// Ignored things that come back on their own (npm install, a build, prisma generate).
const REGENERABLE = /(^|\/)(node_modules|\.next|\.turbo|\.cache|coverage|dist|build|out|generated)\/?$|(^|\/)\.husky\/_\/?$|\.tsbuildinfo$|(^|\/)next-env\.d\.ts$|(^|\/)\.DS_Store$/;
// Keys the job page's "Try it" sets in a copied settings file.
const PAGE_KEYS = new Set(['AUTH_URL', 'NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL', 'APP_URL', 'NEXT_PUBLIC_SITE_URL', 'SITE_URL', 'DEV_BYPASS_AUTH']);

function git(dir, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, ...args], { timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout).trim(), err: String(stderr).trim(), killed: Boolean(err?.killed) });
    });
  });
}

const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };

// A settings file the job page copied: the same as the main folder's apart from the keys it sets.
function sameSettings(a, b) {
  const norm = (t) => t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .filter((l) => !PAGE_KEYS.has(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l)?.[1] ?? '')).sort().join('\n');
  return norm(a) === norm(b);
}

/** Can this worktree go? { ok, reason } — reason in plain words when it can't. */
export async function checkWorktree(worktree, repoPath, { fetch = true, jobDir = null } = {}) {
  const lock = jobDir ? heldElsewhere(jobDir) : null;
  if (lock) return { ok: false, reason: `${describeLock(lock)} ${lock.owner === 'terminal' ? 'Close it there (/exit) first.' : 'Stop it there first.'}` };
  if (!worktree || !path.isAbsolute(worktree) || !fs.existsSync(worktree)) return { ok: false, reason: 'The job’s worktree isn’t there (already removed?).' };
  const wt = real(worktree);
  const top = await git(wt, ['rev-parse', '--show-toplevel']);
  if (!top.ok || real(top.out) !== wt) return { ok: false, reason: 'That folder isn’t the top of a git worktree.' };
  const common = await git(wt, ['rev-parse', '--git-common-dir']);
  const gitDir = await git(wt, ['rev-parse', '--git-dir']);
  if (!common.ok || !gitDir.ok || real(path.resolve(wt, common.out)) === real(path.resolve(wt, gitDir.out))) return { ok: false, reason: 'That’s a main checkout, not a worktree. Only worktrees are removed.' };
  if (repoPath && real(repoPath) === wt) return { ok: false, reason: 'That’s your main folder. Only the job’s own worktree is removed.' };
  const status = await git(wt, ['status', '--porcelain', '--untracked-files=normal']);
  if (!status.ok) return { ok: false, reason: 'Couldn’t read the worktree’s state.' };
  const changed = status.out ? status.out.split('\n').length : 0;
  if (changed) return { ok: false, reason: `It has changes that aren’t committed (${changed} file${changed === 1 ? '' : 's'}). Commit or discard them first.` };
  // Files marked "assume unchanged" or "skip worktree" can hold local edits status doesn't show.
  const flagged = (await git(wt, ['ls-files', '-v'])).out.split('\n').filter((l) => /^[a-zS]/.test(l)).map((l) => l.slice(2));
  if (flagged.length) return { ok: false, reason: `It has files with hidden local edits (${flagged.slice(0, 5).join(', ')}${flagged.length > 5 ? ', …' : ''}). Check them first.` };
  // Ignored files: fine when they come back by themselves; anything else would be lost.
  const ignored = (await git(wt, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'])).out.split('\n').filter(Boolean);
  const keep = [];
  for (const rel of ignored) {
    if (REGENERABLE.test(rel.replace(/\/$/, ''))) continue;
    if (/(^|\/)\.env\.local$/.test(rel) && repoPath) {
      const mine = fs.readFileSync(path.join(wt, rel), 'utf8');
      const main = path.join(repoPath, rel);
      if (fs.existsSync(main) && sameSettings(mine, fs.readFileSync(main, 'utf8'))) continue;
    }
    keep.push(rel);
  }
  if (keep.length) return { ok: false, reason: `It has files git ignores that would be lost: ${keep.slice(0, 6).join(', ')}${keep.length > 6 ? `, and ${keep.length - 6} more` : ''}. Move or delete them first, or remove the worktree yourself.` };
  // Bring the remote branches up to date, so "on GitHub" is current; carry on with what we have if offline.
  if (fetch) await git(wt, ['fetch', '--all', '--prune', '--quiet'], 60000);
  const head = await git(wt, ['rev-parse', 'HEAD']);
  if (!head.ok) return { ok: false, reason: 'Couldn’t read the worktree’s latest commit.' };
  const remote = await git(wt, ['branch', '-r', '--contains', head.out]);
  if (!remote.ok || !remote.out) return { ok: false, reason: 'Its latest commit isn’t on GitHub yet (not pushed or merged), so removing it could lose work.' };
  return { ok: true, path: wt, head: head.out.slice(0, 8), on: remote.out.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 3) };
}

/** Remove the worktree (not the branch). Checks first. */
export async function removeWorktree(worktree, repoPath, opts = {}) {
  const check = await checkWorktree(worktree, repoPath, opts);
  if (!check.ok) return check;
  const from = repoPath && fs.existsSync(repoPath) ? repoPath : check.path;
  // Deleting installed packages can take minutes; a cut-off delete would leave a half-removed folder.
  const rm = await git(from, ['worktree', 'remove', check.path], 10 * 60_000);
  if (rm.ok) {
    if (opts.jobDir) { try { release(opts.jobDir); } catch { /* only ever our own lock; a dead one is taken over anyway */ } }
    return { ok: true, head: check.head, on: check.on };
  }
  // Did git delete some of it before stopping? Gone files show as deletions; a vanished folder needs a prune.
  let partly = !fs.existsSync(check.path);
  if (!partly) {
    const st = await git(check.path, ['status', '--porcelain']);
    partly = !st.ok || /^( D|D )/m.test(st.out);
  }
  const why = rm.killed ? 'it took too long' : rm.err.split('\n')[0] || 'unknown error';
  return {
    ok: false,
    partial: partly,
    reason: partly
      ? `The worktree was only partly removed (${why}). Everything in it was already on GitHub; to finish, run: git -C ${from} worktree remove --force ${check.path} (then git worktree prune).`
      : `git wouldn’t remove it: ${why}.`,
  };
}
