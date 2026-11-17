// Works out which repository, branch and worktree a job belongs to, from every clue available:
// status.json, workflow-status.md (standard fields or free text), the spec's location, the Foreman's
// session folder, git branches and worktrees in known repositories, and the person's own choice.
// Read-only: only runs `git` commands that inspect.

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execGit } from './git.js';
import { branchLike } from './workflow-status.js';

function git(dir, args) {
  return new Promise((resolve) => {
    execGit(['-C', dir, ...args], { timeout: 8000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout) => resolve(err ? null : stdout));
  });
}

const cache = new Map(); // key -> { at, value }
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// The top folder of the git repository that contains `p` (a file or folder), or null.
export async function repoRootOf(p) {
  if (!p) return null;
  return cached(`root:${p}`, 60000, async () => {
    let dir = p;
    try {
      const st = await fs.stat(dir);
      if (!st.isDirectory()) dir = path.dirname(dir);
    } catch {
      dir = path.dirname(dir);
      try { await fs.stat(dir); } catch { return null; }
    }
    // git prints C:/Users/... on Windows; path.resolve gives the C:\Users\... used everywhere else.
    const top = (await git(dir, ['rev-parse', '--show-toplevel']))?.trim();
    if (!top) return null;
    // A worktree reports its own folder; resolve it to the main checkout's folder.
    const common = (await git(top, ['rev-parse', '--path-format=absolute', '--git-common-dir']))?.trim();
    if (common && path.basename(common) === '.git') return path.resolve(path.dirname(common));
    return path.resolve(top);
  });
}

// Absolute paths mentioned in free text (in backticks or plain), in order of appearance. On Windows
// the Foreman writes C:\Users\... paths, so a drive letter starts one too.
export function pathsIn(text) {
  const out = [];
  const re = /`(\/[^`\s]+|[A-Za-z]:[\\/][^`\s]+)`|(?:^|[\s(])(\/(?:Users|home|private|tmp|Volumes|opt|srv|var)\/[^\s`)'",;]+|[A-Za-z]:\\Users\\[^\s`)'",;]+)/g;
  let m;
  while ((m = re.exec(String(text ?? '')))) out.push((m[1] ?? m[2]).replace(/[.:]+$/, ''));
  return [...new Set(out)];
}

// Branch names mentioned in free text, e.g. "branch `feature/x`" or "on feature/x at e6d7422".
export function branchesIn(text) {
  const out = [];
  const re = /\bbranch(?:es)?\s+`?([\w.-]+\/[\w./-]+|[\w.-]+)`?|`((?:feature|fix|bug|hotfix|chore)\/[\w./-]+)`/gi;
  let m;
  while ((m = re.exec(String(text ?? '')))) {
    const b = (m[1] ?? m[2]).replace(/[.,:;]+$/, '');
    // A plain word is never a branch (branch create after …), in backticks or not (Nov 17).
    const quoted = m[2] !== undefined || /`/.test(m[0].slice(m[0].search(/\s/)));
    if (!/^(main|master|staging|name|named|and|is|at|from|to)$/i.test(b) && branchLike(b, { quoted })) out.push(b);
  }
  return [...new Set(out)];
}

async function localBranches(repo) {
  return cached(`branches:${repo}`, 15000, async () => {
    const out = await git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
    return out ? out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  });
}

export async function worktrees(repo) {
  return cached(`worktrees:${repo}`, 15000, async () => {
    const out = await git(repo, ['worktree', 'list', '--porcelain']);
    if (!out) return [];
    const list = [];
    let cur = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) { cur = { path: path.resolve(line.slice(9).trim()), branch: null }; list.push(cur); }
      else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    }
    return list;
  });
}

const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
// Ticket keys in a name: letters, a hyphen, digits ("orbit-463"), lower case.
const ticketKeys = (s) => [...String(s ?? '').toLowerCase().matchAll(/(?:^|[^a-z0-9])([a-z]+-\d+)(?![a-z0-9])/g)].map((m) => m[1]);
const BRANCH_TYPES = ['feature', 'fix', 'bug', 'hotfix', 'chore'];

/** The worktree a job was given only because its branch was guessed (locateJob's branchGuessed), or null: never the job's own. */
export function guessedWorktree(f) {
  const loc = f?.locate;
  return loc?.branchGuessed === true && loc.worktree && loc.worktree !== f.statusWorktree ? loc.worktree : null;
}

// The job's own facts, never a guess (one rule for the runner, the job list and the page): a branch
// locateJob only guessed may be another job's, so it reads as no branch, the worktree found through
// it as no worktree, and the flow map's lane (found by that branch) as no lane. Pure.

/** The job's branch, or null when it is only a guess (branchGuessed). */
export function ownBranch(f) {
  return f?.locate?.branchGuessed === true ? null : f?.branch ?? null;
}

/** The job's worktree, or null when it was found only through a guessed branch (guessedWorktree). */
export function ownWorktree(f) {
  return guessedWorktree(f) ? null : f?.worktree ?? null;
}

/** Where the job's code is read: its own worktree while it is there (exists), else its repository, or null. */
export function ownCodeDir(f, exists = existsSync) {
  const w = ownWorktree(f);
  return w && exists(w) ? w : f?.repoPath ?? null;
}

/** The job's lane on the flow map (lanes: Map of slug to lane), or null when its branch is only a guess. */
export function ownLane(f, lanes) {
  return f?.locate?.branchGuessed === true ? null : lanes?.get?.(f?.slug) ?? null;
}

const inside = (p, dir) => {
  if (!p || !dir) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** The Claude Code terminals (open: [{ cwd }]) in the job's repository or its own worktree; never one in a guessed worktree. */
export function jobTerminals(f, open) {
  const worktree = ownWorktree(f);
  return (open ?? []).filter((t) => t?.cwd && (inside(t.cwd, f?.repoPath) || inside(t.cwd, worktree)));
}

/** What a refusal caused by a guessed branch says, with what to do (the job page's "This is the job's branch"). */
export function guessWords(f) {
  const branch = f?.locate?.branch ?? null;
  return branch ? `Starbase isn't sure which branch is this job's. It looks like ${branch}. Confirm it on the job page and try again.` : 'Starbase doesn\'t know this job\'s branch yet.';
}

/**
 * clues: { slug, title, statusRepo, statusBranch, statusWorktree, wsRepository: {path, branch}, wsText,
 *          specPath, sessionCwds[], override: {repoPath, branch}, knownRepos[] }
 * Returns { path, source, branch, branchSource, branchGuessed, worktree, checkoutBranch, branchExists }.
 * branchGuessed: the branch came from a name match in git or from a branch the workflow-status.md text only
 * mentions, not from your choice, status.json or the Repository field (false with no branch).
 */
export async function locateJob(clues) {
  const tried = [];
  const pick = async (candidate, source) => {
    if (!candidate) return null;
    tried.push(candidate);
    const root = await repoRootOf(candidate);
    return root ? { path: root, source } : null;
  };
  let repo =
    (await pick(clues.override?.repoPath, 'your choice')) ??
    (await pick(clues.statusRepo, 'status.json')) ??
    (await pick(clues.statusWorktree, 'status.json worktree')) ??
    (await pick(clues.wsRepository?.path, 'workflow-status.md')) ??
    (await pick(clues.specPath, 'the spec’s location')) ??
    null;
  if (!repo) {
    for (const p of pathsIn(clues.wsText)) {
      if (/[\\/]\.(claude|codex)[\\/]/.test(p)) continue;
      repo = await pick(p, 'workflow-status.md (text)');
      if (repo) break;
    }
  }
  if (!repo) {
    for (const cwd of clues.sessionCwds ?? []) {
      repo = await pick(cwd, 'the Foreman’s session folder');
      if (repo) break;
    }
  }

  // Branch: what the records say, else a local branch named after the job.
  const slugWords = new Set([...words(clues.slug), ...words(clues.title)]);
  // The job's own ticket key: the slug's; the title's only when the slug has none (a title may mention another ticket).
  // A slug's key is the one it starts with ("orbit-463-…"); "…-phase-2" further in is no ticket key.
  const slugKeys = ticketKeys(clues.slug).filter((k) => String(clues.slug).toLowerCase().startsWith(k));
  const jobKeys = new Set(slugKeys.length ? slugKeys : ticketKeys(clues.title));
  const otherTicket = (b) => { const keys = ticketKeys(b); return keys.length > 0 && jobKeys.size > 0 && !keys.some((k) => jobKeys.has(k)); };
  // The whole slug in the branch name, ending where a word ends.
  const slugAt = new RegExp(`${String(clues.slug ?? '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`);
  // By its words: never another ticket's branch; the job's own key alone, else at least two words in common besides
  // the ticket keys' words and the branch type.
  const byWords = (b) => {
    const keys = ticketKeys(b);
    if (otherTicket(b)) return false;
    if (keys.some((k) => jobKeys.has(k))) return true;
    const skip = new Set([...BRANCH_TYPES, ...[...keys, ...jobKeys].flatMap((k) => k.split('-'))]);
    const w = words(b).filter((x) => !skip.has(x));
    return w.filter((x) => slugWords.has(x)).length >= 2;
  };
  let branch = clues.override?.branch ?? clues.statusBranch ?? null;
  let branchSource = clues.override?.branch ? 'your choice' : clues.statusBranch ? 'status.json' : null;
  let branchGuessed = false;
  // Search known repositories for a branch named after the job when there's still no repo or branch.
  const repos = repo ? [repo.path] : [];
  if (!repo) for (const r of clues.knownRepos ?? []) if (!repos.includes(r)) repos.push(r);
  if (!branch) {
    const field = clues.wsRepository?.branch && !/^(main|master|staging)$/.test(clues.wsRepository.branch) ? clues.wsRepository.branch : null;
    const mentioned = branchesIn(clues.wsText).filter((b) => !otherTicket(b) && b !== field && !/^(main|master|staging)$/.test(b));
    if (field) { branch = field; branchSource = 'workflow-status.md'; }
    else {
      // A branch the text only mentions is a guess: used only when git has it (Nov 17), else the search below looks by name.
      for (const b of mentioned) {
        let has = false;
        for (const r of repos) if ((await localBranches(r)).includes(b)) { has = true; break; }
        if (has) { branch = b; branchSource = 'workflow-status.md'; branchGuessed = true; break; }
      }
    }
  }
  // The names the workflow gives a job's branch (git-workflow.md): feature/<slug>, or fix/<slug> for a bug job.
  const expected = clues.slug ? [`feature/${clues.slug}`, `fix/${clues.slug}`] : [];
  let branchExists = false;
  for (const r of repos) {
    const branches = await localBranches(r);
    if (branch && branches.includes(branch)) { branchExists = true; if (!repo) repo = { path: r, source: `has branch ${branch}` }; break; }
    if (!branch) {
      const match = expected.find((b) => branches.includes(b))
        ?? branches.find((b) => !otherTicket(b) && slugAt.test(b.toLowerCase()))
        ?? branches.find(byWords);
      if (match && !/^(main|master|staging)$/.test(match)) {
        branch = match; branchSource = `git branch in ${path.basename(r)}`; branchExists = true; branchGuessed = true;
        if (!repo) repo = { path: r, source: `has branch ${match}` };
        break;
      }
    }
  }

  let worktree = null;
  let checkoutBranch = null;
  if (repo) {
    const wts = await worktrees(repo.path);
    checkoutBranch = wts.find((w) => w.path === repo.path)?.branch ?? null;
    const wt = branch ? wts.find((w) => w.branch === branch) : null;
    worktree = clues.statusWorktree ?? (wt && wt.path !== repo.path ? wt.path : null);
  }
  return { path: repo?.path ?? null, source: repo?.source ?? null, branch, branchSource, branchGuessed, branchExists, worktree, checkoutBranch, tried };
}
