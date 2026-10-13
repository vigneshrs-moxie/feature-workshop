// Works out which repository, branch and worktree a job belongs to, from every clue available:
// status.json, workflow-status.md (standard fields or free text), the spec's location, the Foreman's
// session folder, git branches and worktrees in known repositories, and the person's own choice.
// Read-only: only runs `git` commands that inspect.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';

function git(dir, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, ...args], { timeout: 8000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout) => resolve(err ? null : stdout));
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
    const top = await git(dir, ['rev-parse', '--show-toplevel']);
    if (!top) return null;
    // A worktree reports its own folder; resolve it to the main checkout's folder.
    const common = (await git(top.trim(), ['rev-parse', '--path-format=absolute', '--git-common-dir']))?.trim();
    if (common && path.basename(common) === '.git') return path.dirname(common);
    return top.trim();
  });
}

// Absolute paths mentioned in free text (in backticks or plain), in order of appearance.
export function pathsIn(text) {
  const out = [];
  const re = /`(\/[^`\s]+)`|(?:^|[\s(])(\/(?:Users|home|private|tmp|Volumes|opt|srv|var)\/[^\s`)'",;]+)/g;
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
    if (!/^(main|master|staging|name|named|and|is|at|from|to)$/i.test(b)) out.push(b);
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
      if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: null }; list.push(cur); }
      else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    }
    return list;
  });
}

const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

/**
 * clues: { slug, title, statusRepo, statusBranch, statusWorktree, wsRepository: {path, branch}, wsText,
 *          specPath, sessionCwds[], override: {repoPath, branch}, knownRepos[] }
 * Returns { path, source, branch, branchSource, worktree, checkoutBranch, branchExists }.
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
      if (p.includes('/.claude/') || p.includes('/.codex/')) continue;
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
  let branch = clues.override?.branch ?? clues.statusBranch ?? null;
  let branchSource = clues.override?.branch ? 'your choice' : clues.statusBranch ? 'status.json' : null;
  if (!branch) {
    const fromText = [clues.wsRepository?.branch, ...branchesIn(clues.wsText)].filter((b) => b && !/^(main|master|staging)$/.test(b));
    if (fromText.length) { branch = fromText[0]; branchSource = 'workflow-status.md'; }
  }
  // Search known repositories for a branch named after the job when there's still no repo or branch.
  const repos = repo ? [repo.path] : [];
  if (!repo) for (const r of clues.knownRepos ?? []) if (!repos.includes(r)) repos.push(r);
  let branchExists = false;
  for (const r of repos) {
    const branches = await localBranches(r);
    if (branch && branches.includes(branch)) { branchExists = true; if (!repo) repo = { path: r, source: `has branch ${branch}` }; break; }
    if (!branch) {
      const match = branches.find((b) => b.toLowerCase().includes(String(clues.slug).toLowerCase()))
        ?? branches.find((b) => { const w = words(b); return w.length && w.filter((x) => slugWords.has(x)).length >= Math.min(2, w.length); });
      if (match && !/^(main|master|staging)$/.test(match)) {
        branch = match; branchSource = `git branch in ${path.basename(r)}`; branchExists = true;
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
  return { path: repo?.path ?? null, source: repo?.source ?? null, branch, branchSource, branchExists, worktree, checkoutBranch, tried };
}
