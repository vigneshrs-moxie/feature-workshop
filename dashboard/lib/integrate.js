// The integration board (packet Z): the packet worktrees of this repository, each with its
// branch, how far it is ahead of and behind the main checkout's branch, its last commit, the
// last test run this process did for it, and the files it changed outside its brief's "Owns"
// list. A packet is a worktree on a branch named packet/<id>-<name>; its brief is
// docs/plans/packets/<id>-*.md.
//
// Git runs through execFile (no shell) with validated names and a time limit. Nothing here
// pushes, ever.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export const BRANCH_RE = /^packet\/([A-Za-z0-9]{1,12})-([\w.-]{1,120})$/;
export const ID_RE = /^[A-Za-z0-9]{1,12}$/;
export const TEST_STATES = ['unknown', 'running', 'green', 'red'];
const PACKETS_DIR = path.join('docs', 'plans', 'packets');
const WEB_ROUTER = 'web/src/app/router.ts';
const WEB_NAV = 'web/src/app/App.tsx'; // the top bar, where the nav links are

/** Run git in `dir`. Resolves { code, stdout, stderr }; never rejects for a non-zero exit. */
export function git(dir, args, { timeout = 30000, maxBuffer = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, ...args], { timeout, maxBuffer, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (err && typeof err.code !== 'number' ? err.message : '') });
    });
  });
}

async function gitOut(dir, args) {
  const r = await git(dir, args);
  return r.code === 0 ? r.stdout : null;
}

/** `git worktree list --porcelain` as [{ path, head, branch }] (branch without refs/heads/, or null). */
export function parseWorktrees(out) {
  const list = [];
  for (const block of String(out).split(/\n\s*\n/)) {
    const wt = { path: null, head: null, branch: null };
    for (const line of block.split('\n')) {
      const [key, ...rest] = line.split(' ');
      const value = rest.join(' ');
      if (key === 'worktree') wt.path = value;
      else if (key === 'HEAD') wt.head = value;
      else if (key === 'branch') wt.branch = value.replace(/^refs\/heads\//, '');
    }
    if (wt.path) list.push(wt);
  }
  return list;
}

export async function worktrees(dir) {
  const out = await gitOut(dir, ['worktree', 'list', '--porcelain']);
  return out === null ? [] : parseWorktrees(out);
}

/** The main checkout of the repository `dir` belongs to (the first worktree), or null when `dir` isn't in one. */
export async function mainCheckout(dir) {
  const list = await worktrees(dir);
  return list[0]?.path ?? null;
}

/** The branch the checkout at `root` is on, or null (detached, or not a repository). */
export async function currentBranch(root) {
  const out = await gitOut(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return out?.trim() || null;
}

/** The packet a branch name belongs to: { id, slug } for packet/<id>-<slug>, else null. */
export function packetOfBranch(branch) {
  const m = BRANCH_RE.exec(branch ?? '');
  return m ? { id: m[1], slug: m[2] } : null;
}

/** Every local packet/<id>-* branch: { [id]: branch } (the first one found, by name, for each id). */
export async function packetBranches(root) {
  const out = (await gitOut(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/packet/'])) ?? '';
  const map = {};
  for (const b of out.split('\n').map((s) => s.trim()).filter(Boolean).sort()) {
    const p = packetOfBranch(b);
    if (p && !map[p.id]) map[p.id] = b;
  }
  return map;
}

/** { ahead, behind } of `branch` against `base`, or nulls when git can't say. */
export async function aheadBehind(root, base, branch) {
  const out = await gitOut(root, ['rev-list', '--left-right', '--count', `${base}...${branch}`, '--']);
  const m = /^(\d+)\s+(\d+)/.exec(out?.trim() ?? '');
  return m ? { behind: Number(m[1]), ahead: Number(m[2]) } : { ahead: null, behind: null };
}

/** The newest commit on `ref`: { sha, short, subject, time }, or null. */
export async function lastCommit(root, ref) {
  const out = await gitOut(root, ['log', '-1', '--no-color', '--format=%H%x1f%h%x1f%s%x1f%cI', ref, '--']);
  if (!out?.trim()) return null;
  const [sha, short, subject, time] = out.trim().split('\x1f');
  return { sha, short, subject, time };
}

/**
 * Whether a packet's work is in the base yet:
 *   'waiting'  it has commits the base doesn't have
 *   'merged'   it has none left, and the branch has moved since it was made (its work came in)
 *   'empty'    it has none left because nothing was committed on it yet
 * The branch's reflog says where it was made; without one, nothing left counts as merged.
 */
export async function mergeState(root, branch, ahead) {
  if (ahead === null) return 'unknown';
  if (ahead > 0) return 'waiting';
  const head = (await gitOut(root, ['rev-parse', '--verify', '--quiet', `${branch}^{commit}`]))?.trim();
  const log = (await gitOut(root, ['reflog', 'show', '--format=%H', `refs/heads/${branch}`, '--'])) ?? '';
  const entries = log.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!entries.length) return 'merged';
  const createdAt = entries[entries.length - 1];
  return head && head === createdAt ? 'empty' : 'merged';
}

/** The paths changed on `branch` since it left `base` (committed work only). */
export async function changedSince(root, base, branch) {
  const out = await gitOut(root, ['diff', '--name-only', '--no-renames', `${base}...${branch}`, '--']);
  return out === null ? null : out.split('\n').map((s) => s.trim()).filter(Boolean);
}

// ---------- The packet's brief: its name and its "Owns" list ----------

/** The brief for packet `id` under `dir`: { file, text }, or null. */
export async function readBrief(dir, id) {
  const folder = path.join(dir, PACKETS_DIR);
  let names;
  try { names = await fs.readdir(folder); } catch { return null; }
  const name = names.sort().find((n) => n.startsWith(`${id}-`) && n.endsWith('.md'));
  if (!name) return null;
  try { return { file: path.join(folder, name), text: await fs.readFile(path.join(folder, name), 'utf8') }; } catch { return null; }
}

/** "# Packet Z · Integration board" → "Integration board". */
export function briefTitle(text) {
  const m = /^#\s+(.+)$/m.exec(text ?? '');
  if (!m) return null;
  return m[1].replace(/^Packet\s+[A-Za-z0-9]+\s*[·:\-–—]\s*/i, '').trim() || null;
}

/**
 * The paths a brief's "Owns" paragraph names, read leniently: the text under a "## Owns" heading
 * (or after "Owns:" / "**Owns**"), up to the next heading; every `backticked` piece that looks
 * like a path (no spaces, not a URL route or a home-folder path, with a slash or a file ending).
 * null when there is no such paragraph.
 */
export function parseOwns(text) {
  const lines = String(text ?? '').split('\n');
  let start = lines.findIndex((l) => /^#{1,6}\s*Owns\b/i.test(l.trim()));
  let body;
  if (start >= 0) {
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^#{1,6}\s/.test(l.trim()));
    body = (end < 0 ? rest : rest.slice(0, end)).join('\n');
  } else {
    start = lines.findIndex((l) => /^\s*(\*\*)?Owns(\*\*)?\s*[:.]/i.test(l) || /^\s*\*\*Owns[:.]?\*\*/i.test(l));
    if (start < 0) return null;
    const rest = lines.slice(start);
    const end = rest.findIndex((l, i) => i > 0 && (/^#{1,6}\s/.test(l.trim()) || !l.trim()));
    body = (end < 0 ? rest : rest.slice(0, end)).join('\n');
  }
  const paths = [];
  for (const m of body.matchAll(/`([^`]+)`/g)) {
    const t = m[1].trim();
    if (!t || /\s/.test(t) || t.startsWith('/') || t.startsWith('~') || /^[a-z]+:/i.test(t)) continue;
    if (!t.includes('/') && !/\.[A-Za-z0-9]+\*?$/.test(t)) continue;
    if (BRANCH_RE.test(t)) continue; // the packet's branch name, not a file
    paths.push(t.replace(/^\.\//, ''));
  }
  // The briefs say "one route (entry)" and "one nav entry" for the web app's two shared files.
  if (/\bone route\b|\broute entry\b/i.test(body)) paths.push(WEB_ROUTER);
  if (/\bnav entry\b/i.test(body)) paths.push(WEB_NAV);
  return [...new Set(paths)];
}

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/**
 * A test for "this path is one the brief owns". An entry matches itself; a folder (ending in /,
 * or any entry a path sits under) matches what is inside; `*` matches within one folder and `…`,
 * `...` or `**` across folders; a file also owns its test beside it (Integrate.tsx →
 * Integrate.test.tsx); a bare file name (no folder) matches that name in any folder.
 */
export function ownedMatcher(entries) {
  const tests = entries.map((e) => {
    if (/[*…]|\.\.\./.test(e)) {
      const re = e.split(/(\*\*|…|\.\.\.|\*)/).map((part) => (part === '**' || part === '…' || part === '...' ? '.*' : part === '*' ? '[^/]*' : escapeRe(part))).join('');
      const rx = new RegExp(`^${re}$`);
      return (p) => rx.test(p);
    }
    if (!e.includes('/')) return (p) => p === e || p.endsWith(`/${e}`);
    const dir = e.replace(/\/+$/, '');
    const stem = /^(.*)\.([A-Za-z0-9]+)$/.exec(e)?.[1];
    const testRx = stem ? new RegExp(`^${escapeRe(stem)}\\.(test|spec)\\.[A-Za-z0-9.]+$`) : null;
    return (p) => p === e || p === dir || p.startsWith(`${dir}/`) || Boolean(testRx?.test(p));
  });
  return (p) => tests.some((t) => t(p));
}

/** The changed paths that are not in the owned list; null when the list is unknown. */
export function outsideOwned(changed, owned) {
  if (!owned || !changed) return null;
  const isOwned = ownedMatcher(owned);
  return changed.filter((p) => !isOwned(p));
}

// ---------- The list ----------

/** A test run's state for the board: one of TEST_STATES. */
const testsStateOf = (rec) => (rec && TEST_STATES.includes(rec.state) ? rec.state : 'unknown');

/**
 * The packet worktrees of the repository at `root` (its main checkout), against the branch that
 * checkout is on. testsStates: Map id → { state, at } from the runs this process did.
 * Returns { root, base, packets: [...] }, each packet:
 *   { id, name, path, branch, base, ahead, behind, state, lastCommit, testsState, testsAt,
 *     owned, touchedOutsideOwned }
 * touchedOutsideOwned is null ("unknown") when the brief or its Owns paragraph can't be read.
 */
export async function listPackets({ root, testsStates = new Map() } = {}) {
  const main = (await mainCheckout(root)) ?? root;
  const base = (await currentBranch(main)) ?? 'main';
  const list = (await worktrees(main)).filter((w) => w.path !== main && packetOfBranch(w.branch));
  const packets = await Promise.all(list.map((w) => describePacket({ root: main, base, worktree: w, testsStates })));
  packets.sort((a, b) => a.id.localeCompare(b.id));
  return { root: main, base, packets };
}

export async function describePacket({ root, base, worktree, testsStates = new Map() }) {
  const { id, slug } = packetOfBranch(worktree.branch);
  const brief = (await readBrief(root, id)) ?? (await readBrief(worktree.path, id));
  const owned = brief ? parseOwns(brief.text) : null;
  const { ahead, behind } = await aheadBehind(root, base, worktree.branch);
  const changed = await changedSince(root, base, worktree.branch);
  const rec = testsStates.get(id);
  return {
    id,
    name: (brief && briefTitle(brief.text)) || slug.replace(/-/g, ' '),
    path: worktree.path,
    branch: worktree.branch,
    base,
    ahead,
    behind,
    state: await mergeState(root, worktree.branch, ahead),
    lastCommit: await lastCommit(root, worktree.branch),
    testsState: testsStateOf(rec),
    testsAt: rec?.at ?? null,
    brief: brief ? path.relative(root, brief.file).startsWith('..') ? brief.file : path.relative(root, brief.file) : null,
    owned,
    touchedOutsideOwned: outsideOwned(changed, owned),
  };
}
