// What Auto's fixed stop list needs from git, read without holding the server up: the branch checked out
// in the job's folder (every call) and where each remote pushes (remembered for a minute per job).
// exec(file, args, { cwd, timeout }) -> stdout text; it rejects on a failure or a timeout. A read that
// fails or is slow gives null, and the rules stop a push they can't place (lib/auto-rules.js).
import path from 'node:path';

const LIMIT_MS = 3000;
const REMEMBER_MS = 60_000;

const read = async (exec, args, cwd) => {
  try { return String(await exec('git', args, { cwd, timeout: LIMIT_MS })).trim(); } catch { return null; }
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
