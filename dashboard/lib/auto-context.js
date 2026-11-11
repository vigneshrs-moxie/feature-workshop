// The job's repository, folders and branches for every safety rule (Auto's rules, the routine list,
// the rm -rf cover, the go-ahead cover, auto mode's environment and the Approver's read gate), from
// Starbase's own records and from git. Nothing the job writes (status.json, options.json, stack.json,
// any file in its folders) decides them on its own word:
//   - the repository is the one Starbase recorded when it made the job (or the person set); with no
//     record of Starbase's (a job started in a terminal), the job's records are believed only for a
//     repository the registry knows;
//   - a worktree named by status.json counts only when git lists it as a worktree of that repository
//     (real paths compared) and it is this job's: the profile's folder for this job or one of its stack
//     parts, or its folder name or checked-out branch holds the job's slug; and never the profile's folder
//     for another job Starbase knows. The profile's own worktree counts before it exists (the Foreman makes it
//     there) and, once it exists, under the same test. The main checkout is never one of the job's
//     worktrees, nor is a worktree with a branch that is never the job's own checked out;
//   - the job's branches are what git says is checked out in those worktrees, and the stack's part
//     branches that git shows checked out in a worktree of the repository; main, master, staging,
//     develop and the org remote's default branch never count;
//   - the spec folder counts only inside the repository (not its top folder), a worktree or the job folder.

import fs from 'node:fs';
import path from 'node:path';

const MAC = process.platform === 'darwin';
const fold = (x) => (MAC ? String(x).toLowerCase() : String(x));
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const exists = (p) => { try { fs.statSync(p); return true; } catch { return false; } };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && fold(real(a)) === fold(real(b));
const inside = (p, dir) => {
  const rel = path.relative(fold(real(dir)), fold(real(p)));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const usable = (p) => typeof p === 'string' && p.length > 0 && p.length <= 4096 && !p.includes('\0') && path.isAbsolute(p);

/** Branch names that are never a job's own, whatever git says. */
export const NEVER_JOB_BRANCH = /^(main|master|staging|develop)$/i;

/**
 * The verified context. in:
 *   featureDir      the job's folder (Starbase's own)
 *   f               the job as loadFeatures read it (its records: believed only as said above), or null
 *   recordedRepo    the repository Starbase recorded for the job, or null
 *   knownRepos      the registry's repositories
 *   slug            the job's slug (its folder's name, Starbase's own)
 *   profileWorktree where the repository's profile puts the job's worktree, or null
 *   stackWorktrees  where the profile puts this job's stack parts' worktrees
 *   otherWorktrees  where the profile puts every other job's worktree
 *   stack           stack.json, or null
 *   git             { worktrees(repo, { fresh }) -> [{ path, branch }] | null (main checkout first),
 *                     defaultBranch(repo) -> [branch names] (the org remote's default) }
 * out: { repo, mainCheckout, worktrees, specDirs, branches }
 */
/** The job's repository: the one Starbase recorded; with none, the job's own word only for a repository the registry knows. */
export function jobRepo({ recordedRepo = null, f = null, knownRepos = [] }) {
  if (usable(recordedRepo)) return path.resolve(recordedRepo);
  if (usable(f?.repoPath) && (knownRepos ?? []).some((r) => same(r, f.repoPath))) return path.resolve(f.repoPath);
  return null;
}

export async function verifiedJobContext({ featureDir, slug = null, f = null, recordedRepo = null, knownRepos = [], profileWorktree = null, stackWorktrees = [], otherWorktrees = [], stack = null, git }) {
  const none = { repo: null, mainCheckout: null, worktrees: [], specDirs: [], branches: [] };
  const repo = jobRepo({ recordedRepo, f, knownRepos });
  if (!repo) return none;

  const named = [f?.worktree, f?.statusWorktree].filter(usable);
  const profile = usable(profileWorktree) ? path.resolve(profileWorktree) : null;
  let list = null;
  try { list = await git.worktrees(repo); } catch { list = null; }
  // A folder made since git was last asked: ask again.
  if (list && [...named, profile].filter(Boolean).some((w) => exists(w) && !list.some((x) => same(x.path, w)))) {
    try { list = (await git.worktrees(repo, { fresh: true })) ?? list; } catch { /* keep the last answer */ }
  }
  let never = [];
  try { never = (await git.defaultBranch(repo)) ?? []; } catch { never = []; }
  const notOwn = (b) => !b || NEVER_JOB_BRANCH.test(b) || never.includes(b);
  const main = list?.[0] ?? null;
  const others = (list ?? []).slice(1).filter((x) => !same(x.path, repo) && !(main && same(x.path, main.path)));

  const worktrees = [];
  const branches = [];
  const keep = (p, branch) => {
    if (worktrees.some((w) => same(w, p))) return;
    worktrees.push(p);
    if (branch && !branches.includes(branch)) branches.push(branch);
  };
  // A listed worktree is this job's only by Starbase's own naming: the profile's folders for it, or its slug.
  const key = String(slug ?? (usable(featureDir) ? path.basename(featureDir) : '')).toLowerCase();
  const ours = (x) => {
    if ((otherWorktrees ?? []).some((o) => usable(o) && same(o, x.path))) return false;
    if ((profile && same(profile, x.path)) || (stackWorktrees ?? []).some((s) => usable(s) && same(s, x.path))) return true;
    return Boolean(key) && (path.basename(x.path).toLowerCase().includes(key) || String(x.branch ?? '').toLowerCase().includes(key));
  };
  for (const w of named) {
    const hit = others.find((x) => same(x.path, w));
    if (hit && ours(hit) && !(hit.branch && notOwn(hit.branch))) keep(hit.path, hit.branch);
  }
  if (profile && !same(profile, repo)) {
    const hit = others.find((x) => same(x.path, profile));
    if (hit) { if (!(hit.branch && notOwn(hit.branch))) keep(hit.path, hit.branch); } else if (!exists(profile)) keep(profile, null);
  }
  // The stack's part branches: only those git shows checked out in a worktree of the repository.
  for (const part of Array.isArray(stack?.sections) ? stack.sections : []) {
    const b = typeof part?.branch === 'string' ? part.branch : null;
    if (b && !notOwn(b) && others.some((x) => x.branch === b) && !branches.includes(b)) branches.push(b);
  }

  const specDirs = [path.join(repo, 'docs', 'plans')];
  const spec = f?.spec?.path;
  if (usable(spec)) {
    // Only docs/ or below it, in the repository or a worktree, or inside the job folder; never a folder whose path
    // there passes through a place that runs code later (N1).
    const dir = path.dirname(path.resolve(spec));
    const under = (root) => {
      if (!inside(dir, root)) return null;
      return path.relative(fold(real(root)), fold(real(dir))).split(/[\\/]/).filter(Boolean);
    };
    const codePart = (parts) => parts.some((x) => /^\.(git|github|husky|claude|githooks)$/i.test(x));
    const inDocs = (parts) => parts !== null && parts[0] === 'docs' && !codePart(parts);
    const inJob = usable(featureDir) ? under(featureDir) : null;
    const ok = inDocs(under(repo)) || worktrees.some((w) => inDocs(under(w))) || (inJob !== null && !codePart(inJob));
    if (ok && !specDirs.some((d) => same(d, dir))) specDirs.push(dir);
  }
  // For the workflow's set-up (N7): every branch git shows checked out, and the org remote's default branches.
  const listedBranches = (list ?? []).map((x) => x.branch).filter(Boolean);
  return { repo, mainCheckout: main ? main.path : repo, worktrees, specDirs, branches, listedBranches, neverBranches: never };
}
