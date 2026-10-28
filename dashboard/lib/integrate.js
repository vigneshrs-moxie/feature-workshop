// The integration board (packet Z): the packet worktrees of this repository, each with its
// branch, how far it is ahead of and behind the main checkout's branch, its last commit, the
// last test run this process did for it, and the files it changed outside its brief's "Owns"
// list. A packet is a worktree on a branch named packet/<id>-<name>; its brief is
// docs/plans/packets/<id>-*.md. "Merge next" merges the first packet in the stated order that
// isn't merged yet into the main checkout, then runs both test suites there.
//
// Git runs through execFile (no shell) with validated names and a time limit. Nothing here
// pushes, ever.

import { execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
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

// ---------- Merge next ----------

/** The plan's integration order for the v1 packets (plan §11): Z, then C, D, E, F, then A and T, then B. */
export const DEFAULT_ORDER = ['Z', 'C', 'D', 'E', 'F', 'A', 'T', 'B'];
export const DEFAULT_SLOTS = 3;
export const MAX_SLOTS = 20;

/** Both test suites, as the packet briefs name them: `npm test`, then `npx vitest run` in web/. */
export const TEST_COMMANDS = [
  { label: 'npm test', cmd: 'npm', args: ['test'], cwd: '.' },
  { label: 'web tests (npx vitest run)', cmd: 'npx', args: ['vitest', 'run'], cwd: 'web' },
];
const TEST_TIMEOUT_MS = 20 * 60 * 1000;
const ACTIVE = new Set(['starting', 'running', 'waiting_permission', 'stopping']);

export class IntegrateError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** An order as the board keeps it: packet ids, each once, upper and lower case as written. */
export function cleanOrder(order) {
  if (!Array.isArray(order)) throw new IntegrateError(400, 'The order must be a list of packet ids.');
  if (order.length > 50) throw new IntegrateError(400, 'The order can hold at most 50 packets.');
  const seen = new Set();
  const out = [];
  for (const raw of order) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!ID_RE.test(id)) throw new IntegrateError(400, `“${String(raw).slice(0, 20)}” is not a packet id (letters and digits, like C or T2).`);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function cleanSlots(slots) {
  const n = Number(slots);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SLOTS) throw new IntegrateError(400, `Packets at once must be a whole number from 1 to ${MAX_SLOTS}.`);
  return n;
}

const isInside = (p, dir) => {
  if (typeof p !== 'string' || !p) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/**
 * A job running on the checkout at `root`, or null. Looks in each state folder's sessions.json
 * ({ [jobFolder]: { cwd, repoPath, status | running } }, or a list of such entries) for a session
 * whose folder or repository is that checkout and that is marked running (running: true, or a
 * status of starting, running, waiting_permission or stopping), or whose job folder holds a
 * lock.json (packet C) with a live pid. `extra` is asked too (this dashboard's own runs).
 */
export async function runningJobFor(root, { stateDirs = [], extra = null } = {}) {
  for (const dir of stateDirs) {
    let all;
    try { all = JSON.parse(await fs.readFile(path.join(dir, 'sessions.json'), 'utf8')); } catch { continue; }
    const entries = Array.isArray(all) ? all.map((v) => [v?.featureDir ?? v?.dir ?? '', v]) : Object.entries(all ?? {});
    for (const [jobDir, s] of entries) {
      if (!s || typeof s !== 'object') continue;
      if (!isInside(s.cwd, root) && !isInside(s.repoPath, root) && !isInside(s.repo, root)) continue;
      const status = s.status ?? s.state ?? s.run?.status;
      let running = s.running === true || ACTIVE.has(status);
      if (!running && jobDir) {
        try { running = pidAlive(JSON.parse(await fs.readFile(path.join(jobDir, 'lock.json'), 'utf8'))?.pid); } catch { /* no lock */ }
      }
      if (running) return { slug: path.basename(jobDir || String(s.slug ?? 'a job')), dir: jobDir || null, from: dir };
    }
  }
  const own = extra ? await extra(root) : null;
  return own ?? null;
}

/**
 * Run each test command in `dir`, one after another, every one even when one fails. Output goes
 * to onOutput(text, { step, stream }) as it arrives. Resolves { ok, steps: [{ label, code, ok, ms }] }.
 */
export async function runTests({ dir, commands = TEST_COMMANDS, onOutput = () => {}, timeoutMs = TEST_TIMEOUT_MS }) {
  const steps = [];
  for (const c of commands) {
    const started = Date.now();
    onOutput(`\n$ ${c.label}\n`, { step: c.label, stream: 'info' });
    const code = await new Promise((resolve) => {
      const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' };
      delete env.PORT; delete env.WIREFRAMES_PORT; // the tests pick their own ports
      let child;
      try {
        child = spawn(c.cmd, c.args, { cwd: path.resolve(dir, c.cwd ?? '.'), env, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        onOutput(`Couldn’t start ${c.label}: ${err.message}\n`, { step: c.label, stream: 'stderr' });
        return resolve(null);
      }
      const timer = setTimeout(() => { onOutput(`\n${c.label} took longer than ${Math.round(timeoutMs / 60000)} minutes and was stopped.\n`, { step: c.label, stream: 'stderr' }); child.kill('SIGTERM'); }, timeoutMs);
      child.stdout.on('data', (d) => onOutput(String(d), { step: c.label, stream: 'stdout' }));
      child.stderr.on('data', (d) => onOutput(String(d), { step: c.label, stream: 'stderr' }));
      child.on('error', (err) => { clearTimeout(timer); onOutput(`Couldn’t start ${c.label}: ${err.message}\n`, { step: c.label, stream: 'stderr' }); resolve(null); });
      child.on('close', (exit) => { clearTimeout(timer); resolve(exit); });
    });
    steps.push({ label: c.label, code, ok: code === 0, ms: Date.now() - started });
  }
  return { ok: steps.every((s) => s.ok), steps };
}

/** The files a stopped merge left in conflict at `root`. */
export async function conflictedFiles(root) {
  const out = (await gitOut(root, ['diff', '--name-only', '--diff-filter=U'])) ?? '';
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * Where each packet in `order` stands: [{ id, branch, state, ahead }], state as mergeState says,
 * or 'missing' when there is no packet/<id>-* branch.
 */
export async function orderStates(root, base, order) {
  const branches = await packetBranches(root);
  return Promise.all(order.map(async (id) => {
    const branch = branches[id] ?? null;
    if (!branch) return { id, branch: null, state: 'missing', ahead: null };
    const { ahead } = await aheadBehind(root, base, branch);
    return { id, branch, state: await mergeState(root, branch, ahead), ahead };
  }));
}

/**
 * Merge the first packet in `order` that is not merged yet into the main checkout at `root`
 * (`git merge --no-ff <branch> -m "Merge packet <id>: <name>"`), then run both test suites there.
 * Never pushes. Refuses while the checkout has uncommitted changes or a merge under way, or while
 * a job runs on it (runningJobFor). Stops (nothing is skipped) when the next packet has no branch
 * or no commits yet. On a conflict nothing is undone: the files are listed and it stops.
 * Resolves one result: { outcome, message, at, id?, name?, branch?, sha?, files?, tests? }, outcome:
 *   refused | blocked | nothing | conflict | failed | merged (tests.ok says how the tests went)
 */
export async function mergeNext({ root, order = DEFAULT_ORDER, commands = TEST_COMMANDS, stateDirs = [], extraRunning = null, onOutput = () => {}, onStage = () => {} }) {
  const at = () => new Date().toISOString();
  const main = (await mainCheckout(root)) ?? root;
  const base = await currentBranch(main);
  if (!base) return { outcome: 'refused', at: at(), message: 'The main checkout isn’t on a branch, so there is nothing to merge into.' };
  if ((await git(main, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).code === 0) {
    return { outcome: 'refused', at: at(), files: await conflictedFiles(main), message: 'A merge is already under way in the main checkout. Finish it (or undo it) there first.' };
  }
  const dirty = await gitOut(main, ['status', '--porcelain', '--untracked-files=no']);
  if (dirty === null) return { outcome: 'refused', at: at(), message: 'Couldn’t read the main checkout with git.' };
  if (dirty.trim()) return { outcome: 'refused', at: at(), message: 'The main checkout has changes that aren’t committed. Commit them or put them aside first.' };
  const job = await runningJobFor(main, { stateDirs, extra: extraRunning });
  if (job) return { outcome: 'refused', at: at(), message: `A job is running on the main checkout (${job.slug}). Wait until it finishes, then merge.` };

  const states = await orderStates(main, base, order);
  const next = states.find((s) => s.state !== 'merged');
  if (!next) return { outcome: 'nothing', at: at(), message: order.length ? 'Every packet in the order is merged.' : 'The order is empty: add packets to it first.' };
  if (next.state === 'missing') return { outcome: 'blocked', at: at(), id: next.id, message: `Packet ${next.id} is next in the order, but there is no packet/${next.id}-… branch yet. Start it, or take it out of the order.` };
  if (next.state === 'empty') return { outcome: 'blocked', at: at(), id: next.id, branch: next.branch, message: `Packet ${next.id} is next in the order, but nothing is committed on ${next.branch} yet.` };
  if (next.state === 'unknown') return { outcome: 'failed', at: at(), id: next.id, branch: next.branch, message: `Couldn’t compare ${next.branch} with ${base}.` };

  const brief = await readBrief(main, next.id);
  const name = (brief && briefTitle(brief.text)) || packetOfBranch(next.branch).slug.replace(/-/g, ' ');
  const message = `Merge packet ${next.id}: ${name}`;
  onStage({ stage: 'merging', id: next.id, branch: next.branch });
  onOutput(`$ git merge --no-ff ${next.branch} -m "${message}"\n`, { step: 'merge', stream: 'info' });
  const merged = await git(main, ['merge', '--no-ff', '--no-edit', next.branch, '-m', message], { timeout: 120000 });
  if (merged.stdout) onOutput(merged.stdout, { step: 'merge', stream: 'stdout' });
  if (merged.stderr) onOutput(merged.stderr, { step: 'merge', stream: 'stderr' });
  const common = { id: next.id, name, branch: next.branch, base };
  if (merged.code !== 0) {
    const files = await conflictedFiles(main);
    if (files.length) {
      return { outcome: 'conflict', at: at(), ...common, files, message: `Merging packet ${next.id} stopped on a conflict in ${files.length === 1 ? 'one file' : `${files.length} files`}. Nothing was undone: settle ${files.length === 1 ? 'it' : 'them'} in the main checkout and commit, then merge the next one.` };
    }
    return { outcome: 'failed', at: at(), ...common, message: `git couldn’t merge ${next.branch}: ${(merged.stderr || merged.stdout).trim().split('\n').pop() || 'no reason given'}.` };
  }
  const sha = (await gitOut(main, ['rev-parse', 'HEAD']))?.trim() ?? null;
  onStage({ stage: 'testing', id: next.id, branch: next.branch });
  const tests = await runTests({ dir: main, commands, onOutput });
  return {
    outcome: 'merged', at: at(), ...common, sha, tests,
    message: tests.ok ? `Packet ${next.id} is merged into ${base} and the tests passed (${tests.steps.map((s) => s.label).join(', ')}).` : `Packet ${next.id} is merged into ${base}, but ${tests.steps.filter((s) => !s.ok).map((s) => s.label).join(' and ')} failed. The merge is kept: fix it in the main checkout.`,
  };
}

// ---------- The board's state in this process ----------

const LOG_MAX = 4000; // lines kept for the page

/**
 * One integration board: its settings in <configDir>/integrate.json ({ order, slots, last }),
 * the test results this process saw, and the one step running now (a merge or a packet's tests)
 * with its output. Emits 'line' ({ text, stream }), 'step' (the running step, or null) and
 * 'done' (the result).
 */
export class Integrator extends EventEmitter {
  constructor({ root, configDir, stateDirs = [], commands = TEST_COMMANDS, extraRunning = null }) {
    super();
    this.root = root;
    this.file = path.join(configDir, 'integrate.json');
    this.configDir = configDir;
    this.stateDirs = stateDirs;
    this.commands = commands;
    this.extraRunning = extraRunning;
    this.testsStates = new Map();
    this.running = null; // { kind: 'merge' | 'tests', id?, stage, startedAt }
    this.log = [];
    this.lastRun = null;
  }

  async config() {
    let raw = {};
    try { raw = JSON.parse(await fs.readFile(this.file, 'utf8')) ?? {}; } catch { /* first use */ }
    let order = DEFAULT_ORDER;
    try { if (raw.order !== undefined) order = cleanOrder(raw.order); } catch { /* a bad file: the plan's order */ }
    let slots = DEFAULT_SLOTS;
    try { if (raw.slots !== undefined) slots = cleanSlots(raw.slots); } catch { /* the default */ }
    return { order, slots, last: raw.last && typeof raw.last === 'object' ? raw.last : null };
  }

  async #save(patch) {
    const now = await this.config();
    const next = { ...now, ...patch };
    await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
    return next;
  }

  saveOrder(order) { return this.#save({ order: cleanOrder(order) }); }
  saveSlots(slots) { return this.#save({ slots: cleanSlots(slots) }); }

  /** Everything the page shows. */
  async view() {
    const [{ root, base, packets }, cfg] = await Promise.all([listPackets({ root: this.root, testsStates: this.testsStates }), this.config()]);
    const order = await orderStates(root, base, cfg.order);
    for (const o of order) o.name = packets.find((p) => p.id === o.id)?.name ?? (await readBrief(root, o.id).then((b) => (b && briefTitle(b.text)) || null));
    const inUse = packets.filter((p) => p.state !== 'merged').length;
    const next = order.find((o) => o.state !== 'merged') ?? null;
    return { root, base, packets, order, next, slots: cfg.slots, inUse, last: this.lastRun ?? cfg.last, running: this.running, log: this.log.join('') };
  }

  #line(text, { stream = 'stdout' } = {}) {
    this.log.push(text);
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
    this.emit('line', { text, stream });
  }

  #begin(step) {
    if (this.running) throw new IntegrateError(409, this.running.kind === 'merge' ? 'A merge is running now. Wait for it to finish.' : `The tests for packet ${this.running.id} are running now. Wait for them to finish.`);
    this.running = { ...step, startedAt: new Date().toISOString() };
    this.log = [];
    this.emit('step', this.running);
  }

  async #finish(result, { save = false } = {}) {
    this.running = null;
    this.lastRun = result;
    if (save) { try { await this.#save({ last: result }); } catch { /* shown from memory */ } }
    this.#line(`\n${result.message}\n`, { stream: 'info' });
    this.emit('step', null);
    this.emit('done', result);
    return result;
  }

  /** Start "Merge next": { done } (the promise of its result). Throws IntegrateError(409) while a step runs. */
  mergeNext() {
    this.#begin({ kind: 'merge', stage: 'checking' });
    const run = (async () => {
      const { order } = await this.config();
      const result = await mergeNext({
        root: this.root, order, commands: this.commands, stateDirs: this.stateDirs, extraRunning: this.extraRunning,
        onOutput: (text, o) => this.#line(text, o),
        onStage: (s) => { this.running = { ...this.running, ...s }; this.emit('step', this.running); },
      });
      return this.#finish(result, { save: true });
    })().catch((err) => this.#finish({ outcome: 'failed', at: new Date().toISOString(), message: `Merge next stopped: ${err.message}` }, { save: true }));
    return { done: run };
  }

  /** Start both test suites in packet `id`'s worktree: resolves { done } (the promise of its result) once started. */
  async runPacketTests(id) {
    if (!ID_RE.test(String(id ?? ''))) throw new IntegrateError(400, 'Which packet? Give its id, like C.');
    const { packets } = await listPackets({ root: this.root, testsStates: this.testsStates });
    const p = packets.find((x) => x.id === id);
    if (!p) throw new IntegrateError(404, `No worktree for packet ${id}.`);
    this.#begin({ kind: 'tests', id, stage: 'testing' });
    this.testsStates.set(id, { state: 'running', at: new Date().toISOString() });
    const done = (async () => {
      const tests = await runTests({ dir: p.path, commands: this.commands, onOutput: (text, o) => this.#line(text, o) });
      this.testsStates.set(id, { state: tests.ok ? 'green' : 'red', at: new Date().toISOString() });
      return this.#finish({ outcome: 'tests', at: new Date().toISOString(), id, branch: p.branch, tests, message: tests.ok ? `Packet ${id}: the tests passed in its worktree (${tests.steps.map((s) => s.label).join(', ')}).` : `Packet ${id}: ${tests.steps.filter((s) => !s.ok).map((s) => s.label).join(' and ')} failed in its worktree.` });
    })().catch((err) => {
      this.testsStates.set(id, { state: 'red', at: new Date().toISOString() });
      return this.#finish({ outcome: 'failed', at: new Date().toISOString(), id, message: `The tests for packet ${id} stopped: ${err.message}` });
    });
    return { done };
  }
}
