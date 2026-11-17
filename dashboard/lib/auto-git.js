// What Auto's fixed stop list needs from git, read without holding the server up: the branch checked out
// in the job's folder (every call) and where each remote pushes (remembered for a minute per job).
// exec(args, { cwd, timeout }) -> git's stdout text (the runner's goes through lib/git.js runGit); it rejects on a failure or a timeout. A read that
// fails or is slow gives null, and the rules stop a push they can't place (lib/auto-rules.js).
import path from 'node:path';

const LIMIT_MS = 3000;
const REMEMBER_MS = 60_000;

const read = async (exec, args, cwd) => {
  try { return String(await exec(args, { cwd, timeout: LIMIT_MS })).trim(); } catch { return null; }
};

// name -> push address for one folder, with '' for the branch's own push remote.
async function remotesOf(exec, dir) {
  const map = new Map();
  const list = await read(exec, ['remote', '-v'], dir);
  for (const line of (list ?? '').split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\(push\)$/.exec(line.trim());
    if (m) map.set(m[1], m[2]);
  }
  const push = await read(exec, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{push}'], dir);
  const own = push ? push.split('/')[0] : 'origin';
  if (map.has(own)) map.set('', map.get(own));
  return map;
}

// git worktree list --porcelain: [{ path, branch }] with the main checkout first (git lists it first).
function parseWorktrees(text) {
  if (text === null) return null;
  const list = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: path.resolve(line.slice(9).trim()), branch: null }; list.push(cur); }
    else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
  }
  return list.length ? list : null;
}

const FAILED_MS = 5000; // a failed or slow answer is asked again this soon
const AGAIN_MS = 250; // a fresh look is not asked more often than this

/** One cached git read: a result is kept REMEMBER_MS, a failure FAILED_MS; fresh asks again unless the last look is under a quarter second old. */
async function remembered({ cache, key, now, fresh, ask }) {
  const stamp = now();
  let entry = cache?.get(key);
  const stale = !entry || stamp - entry.at >= (entry.failed ? FAILED_MS : REMEMBER_MS) || (fresh && stamp - entry.at >= AGAIN_MS);
  if (stale) {
    entry = { at: stamp, failed: false, value: ask() };
    cache?.set(key, entry);
    const mine = entry;
    entry.value.then((v) => { if (v === null) mine.failed = true; }, () => { mine.failed = true; });
  }
  return entry.value;
}

/**
 * The worktrees git lists for a repository, [{ path, branch }] with the main checkout first, or null
 * when git can't say (a failure or the time limit). fresh: ask again (at most every quarter second), for a
 * folder that has just been made.
 */
export function gitWorktrees({ repo, exec, cache, now = Date.now, fresh = false }) {
  if (!repo) return Promise.resolve(null);
  return remembered({ cache, key: `worktrees\u0000${path.resolve(repo)}`, now, fresh, ask: async () => parseWorktrees(await read(exec, ['worktree', 'list', '--porcelain'], repo)) });
}

/** The branch a remote's HEAD names in a repository (its default branch, as git last fetched it), or null. */
export function gitRemoteDefault({ repo, remote, exec, cache, now = Date.now }) {
  if (!repo || !/^[\w.-]+$/.test(String(remote ?? ''))) return Promise.resolve(null);
  return remembered({
    cache, key: `default\u0000${path.resolve(repo)}\u0000${remote}`, now, fresh: false,
    ask: async () => {
      const ref = await read(exec, ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`], repo);
      return ref && ref.startsWith(`${remote}/`) ? ref.slice(remote.length + 1) : null;
    },
  });
}

/**
 * Is `sha` the commit `ref` names or one of its ancestors (git merge-base --is-ancestor)? true or false
 * as git says; null when git can't say (an error other than "no", or the time limit).
 */
export function gitIsAncestor({ repo, sha, ref, exec, cache, now = Date.now }) {
  if (!repo || !/^[0-9a-f]{40}$/.test(String(sha ?? '')) || !/^[\w./-]+$/.test(String(ref ?? ''))) return Promise.resolve(null);
  return remembered({
    cache, key: `ancestor\u0000${path.resolve(repo)}\u0000${sha}\u0000${ref}`, now, fresh: false,
    ask: async () => {
      try { await exec(['merge-base', '--is-ancestor', sha, ref], { cwd: repo, timeout: LIMIT_MS }); return true; } catch (err) { return err?.code === 1 ? false : null; }
    },
  });
}

/**
 * { currentBranch, remoteUrl(name, dir) } for a job. dirs: the job's folders (cwd is always read).
 * cache: a Map the caller keeps; key: the job's run; now(): for tests.
 */
export async function autoGitFacts({ cwd, dirs = [], exec, cache, key, now = Date.now }) {
  const folders = [...new Set([cwd, ...dirs].filter((d) => typeof d === 'string' && d).map((d) => path.resolve(d)))];
  const stamp = now();
  let entry = cache?.get(key);
  if (!entry || stamp - entry.at >= REMEMBER_MS) {
    entry = { at: stamp, maps: Promise.all(folders.map(async (d) => [d, await remotesOf(exec, d)])).then((x) => new Map(x)) };
    cache?.set(key, entry);
  }
  const [branch, maps] = await Promise.all([cwd ? read(exec, ['symbolic-ref', '--short', 'HEAD'], cwd) : null, entry.maps]);
  return {
    currentBranch: branch || null,
    remoteUrl(name, dir) {
      const at = dir || cwd;
      const map = at ? maps.get(path.resolve(at)) : null;
      return map?.get(name ?? '') ?? null;
    },
  };
}
