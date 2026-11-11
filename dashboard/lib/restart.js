// Changing the Foreman's model starts the job again (spec 1.5): the model is fixed for a job once
// it has started. A restart moves the job's work aside and starts a new job from the same
// description. Nothing is deleted and nothing is pushed:
//   the worktree folder   moves to <worktree>.<date> (uncommitted changes go with it)
//   the job's branch      is renamed backup/<branch>-<date> (its commits stay on it)
//   the job's folder      moves to <features>/.restarted/<slug>-<date> (spec, plan, briefs, decisions)
//   the job's session     record (sessions.json) is copied into that archive folder, then cleared
//                         so the new job does not pick up the old Foreman
// When any of those names is taken (a second restart the same day) -2, -3, … is added.

import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { HttpError } from './http-guard.js';
import { FABLE } from './options.js';

const run = promisify(execFile);

/** Options keys a restart never copies from the old options.json: the new job writes its own. */
const OWN_OPTION_KEYS = new Set(['schema_version', 'updated_at', 'from_session']);

const free = (base, taken) => {
  const used = new Set(taken);
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
  return name;
};

/**
 * Where a restart puts things. Pure.
 * job: { slug, branch, worktree, archiveRoot } (worktree and branch null when the job has none).
 * today: YYYY-MM-DD. existingBranches, existingArchives (archive folders), existingPaths (other
 * folders the worktree might move to): what is already there.
 */
export function planRestart(job, { today, existingBranches = [], existingArchives = [], existingPaths = [] }) {
  return {
    archiveDir: free(path.join(job.archiveRoot, `${job.slug}-${today}`), existingArchives),
    backupBranch: job.branch ? free(`backup/${job.branch}-${today}`, existingBranches) : null,
    worktreeAside: job.worktree ? free(`${job.worktree}.${today}`, existingPaths) : null,
  };
}

/** A restart that stopped part way: `moved` says what had already moved (and where to). Nothing is moved back. */
export class RestartFailed extends Error {
  constructor(reason, moved) {
    const list = moved.map((m) => `${m.what} (${m.from} to ${m.to})`).join('; ');
    super(moved.length
      ? `The restart stopped part way: ${reason} Already moved, and left where it is now: ${list}. Nothing was deleted or moved back.`
      : `The restart did not start: ${reason} Nothing was changed.`);
    this.moved = moved;
    this.status = 409;
  }
}

/** The git calls a restart makes (injectable for tests). */
export const realGit = {
  async branches(repo) {
    const { stdout } = await run('git', ['-C', repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads']);
    return stdout.split('\n').filter(Boolean);
  },
  async moveWorktree(repo, from, to) { await run('git', ['-C', repo, 'worktree', 'move', from, to]); },
  async renameBranch(repo, from, to) { await run('git', ['-C', repo, 'branch', '-m', from, to]); },
  /** Every folder git has a checkout in, with the branch checked out there: [{ path, branch }]. */
  async worktrees(repo) {
    const { stdout } = await run('git', ['-C', repo, 'worktree', 'list', '--porcelain']);
    return stdout.split('\n\n').map((block) => {
      const line = (key) => block.split('\n').find((l) => l.startsWith(`${key} `))?.slice(key.length + 1) ?? null;
      const branch = line('branch');
      return { path: line('worktree'), branch: branch ? branch.replace(/^refs\/heads\//, '') : null };
    }).filter((w) => w.path);
  },
  /** The branch the remote calls its default (origin/HEAD), or null when git doesn't know. */
  async defaultBranch(repo) {
    try {
      const { stdout } = await run('git', ['-C', repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
      return stdout.trim().replace(/^origin\//, '') || null;
    } catch { return null; }
  },
  async remotes(repo) {
    const { stdout } = await run('git', ['-C', repo, 'remote']);
    return stdout.split('\n').filter(Boolean);
  },
  /** Whether the remote has a branch of this name: true, false, or null when it could not be asked (offline, no such remote, too slow). */
  async remoteHasBranch(repo, remote, branch) {
    try {
      const { stdout } = await run('git', ['-C', repo, 'ls-remote', '--heads', remote, branch], { timeout: 8000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
      return stdout.split('\n').some((l) => l.trim().endsWith(`refs/heads/${branch}`));
    } catch { return null; }
  },
};

const exists = async (fs, p) => { try { await fs.access(p); return true; } catch { return false; } };
const dated = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const why = (err) => String(err?.stderr || err?.message || err).trim().split('\n')[0].replace(/\.?$/, '.');

/** Whether a job has a pull request in play (open, draft, in review, approved or merged): reviewed work a restart would throw away. Closed without merging, or not started, is none. */
export function hasOpenPullRequest(prs) {
  return (Array.isArray(prs) ? prs : []).some((p) => {
    const state = String(p?.state ?? '').toLowerCase();
    return state ? !['not_started', 'closed'].includes(state) : Boolean(p?.url);
  });
}

/** Ask every remote whether it has the branch: { onRemote: name | null, notes: [what could not be checked] }. */
async function remoteCheck(git, repo, branch) {
  let remotes = [];
  try { remotes = await git.remotes(repo); } catch { remotes = []; }
  let unsure = remotes.length === 0;
  for (const remote of remotes) {
    const has = await git.remoteHasBranch(repo, remote, branch);
    if (has === true) return { onRemote: remote, notes: [] };
    if (has === null) unsure = true;
  }
  return { onRemote: null, notes: unsure ? [`Whether the branch ${branch} had already been pushed could not be checked (no remote could be reached). If it was pushed, the new job's branch of the same name will collide with it when you push.`] : [] };
}

/**
 * Restart a job on another Foreman model, in this order (each step checked before the next):
 * refuse when a reply is running or a pull request is open; move the worktree folder aside; rename
 * the branch; move the job folder to the archive; start a new job with the old one's description,
 * ticket, kind, repository, level and options and the new model.
 *
 * job: { slug, dir, title, kind, ticket, repoPath, branch, worktree, prs, options (options.json as
 * read), running, archiveRoot }.  model: the new Foreman model (already checked by the caller).
 * git: realGit.  fs: node:fs/promises.  start(body): the New job handler.
 * session: { read(dir), clear(dir) }, the job's sessions.json record.
 * Returns { slug, archive, backupBranch, worktreeAside, run }.
 */
export async function restartJob(job, { model, git = realGit, fs = fsp, start, session = null, today = dated() }) {
  const notes = [];
  if (job.running) throw new HttpError(409, 'Stop the reply first.');
  if (job.terminalOpen) throw new HttpError(409, 'Claude Code is open on this job in a terminal. Close it (type /exit there) and try again. Nothing was changed.');
  if (hasOpenPullRequest(job.prs)) throw new HttpError(409, 'This job has an open pull request, so its model can’t change: reviewed work would be thrown away. Close the pull request, or start a new job.');

  const refuse = (reason) => new RestartFailed(reason, []);
  const repo = job.repoPath ?? null;
  const real = async (p) => { try { return await fs.realpath(p); } catch { return null; } };
  const archiveRoot = job.archiveRoot;
  let branches = [];
  if (repo) {
    try { branches = await git.branches(repo); } catch (err) { throw refuse(`Starbase could not read the list of branches in ${repo} (${why(err)}), so it can't tell what is safe to move.`); }
  }
  const branch = job.branch && branches.includes(job.branch) ? job.branch : null;
  // The main checkout is never moved: only a worktree that is a folder of its own. Real paths, so a
  // link or a trailing slash can't hide that the "worktree" is the repository itself.
  const repoReal = repo ? await real(repo) : null;
  const worktreeReal = job.worktree ? await real(job.worktree) : null;
  const worktreeIsRepo = Boolean(worktreeReal && repoReal && worktreeReal === repoReal);
  const worktree = worktreeReal && !worktreeIsRepo ? job.worktree : null;
  const inMain = (what) => refuse(`This job works in the main checkout of ${repo}${what}, so Starbase can't move its work aside without taking it away from that checkout. Finish the job on its current model, or start a new job instead.`);
  if (worktreeIsRepo && job.branch) throw inMain(` (on the branch ${job.branch})`);
  if (branch) {
    const bases = new Set(['main', 'master', job.baseBranch, await git.defaultBranch(repo)].filter(Boolean));
    if (bases.has(branch)) throw refuse(`This job's branch, ${branch}, is the repository's base branch, so Starbase can't rename it. Finish the job on its current model, or start a new job instead.`);
    let checkouts = [];
    try { checkouts = await git.worktrees(repo); } catch (err) { throw refuse(`Starbase could not read where the branch ${branch} is checked out (${why(err)}), so it can't tell what is safe to move.`); }
    for (const w of checkouts) {
      if (w.branch !== branch) continue;
      const at = await real(w.path);
      if (at && at === worktreeReal) continue;
      throw (at === repoReal ? inMain(` (on the branch ${branch})`) : refuse(`This job's branch, ${branch}, is also checked out in ${w.path}, which is not the job's own worktree, so Starbase can't move the branch out from under it. Close whatever is using that folder, or finish the job on its current model.`));
    }
    // A branch already pushed keeps its name on the remote: a new job on the same name would collide with it.
    const checked = await remoteCheck(git, repo, branch);
    if (checked.onRemote) throw refuse(`The branch ${branch} is already on the remote (${checked.onRemote}), and the new job would use the same branch name and collide with it. You can finish the job on this model, or close its pull request and delete or rename the branch on the remote, then try again.`);
    notes.push(...checked.notes);
  }
  const siblings = async (dir) => { try { return await fs.readdir(dir); } catch { return []; } };
  const plan = planRestart({ slug: job.slug, branch, worktree, archiveRoot }, {
    today, existingBranches: branches,
    existingArchives: (await siblings(archiveRoot)).map((n) => path.join(archiveRoot, n)),
    existingPaths: worktree ? (await siblings(path.dirname(worktree))).map((n) => path.join(path.dirname(worktree), n)) : [],
  });

  const moved = [];
  const step = async (what, from, to, fn) => {
    try { await fn(); } catch (err) { throw new RestartFailed(`${what} failed: ${why(err)}`, moved); }
    moved.push({ what, from, to });
  };
  if (worktree) await step('the worktree folder', worktree, plan.worktreeAside, () => git.moveWorktree(repo ?? worktree, worktree, plan.worktreeAside));
  if (branch) await step('the branch', branch, plan.backupBranch, () => git.renameBranch(repo, branch, plan.backupBranch));
  await step('the job folder', job.dir, plan.archiveDir, async () => {
    await fs.mkdir(archiveRoot, { recursive: true });
    await fs.rename(job.dir, plan.archiveDir);
  });
  if (session) {
    const record = await session.read(job.dir);
    if (record) {
      await step('the Foreman session record', 'sessions.json', path.join(plan.archiveDir, 'session-record.json'), async () => {
        await fs.writeFile(path.join(plan.archiveDir, 'session-record.json'), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
        await session.clear(job.dir);
      });
    }
  }

  const old = job.options ?? {};
  const models = { ...(old.models && typeof old.models === 'object' ? old.models : {}), foreman: model };
  const options = { ...Object.fromEntries(Object.entries(old).filter(([k]) => !OWN_OPTION_KEYS.has(k))), models, ...(old.all_fable === true && model !== FABLE ? { all_fable: false } : {}) };
  let started;
  try {
    started = await start({ description: job.title, ticket: job.ticket ?? undefined, kind: job.kind, repoPath: repo ?? old.repo, level: old.level, options, model });
  } catch (err) { throw new RestartFailed(`starting the new job failed: ${why(err)}`, moved); }

  // Keys of the old options.json the new job's options don't know (written by other parts of
  // Starbase) are kept, so a restart never drops one by name.
  try {
    const file = path.join(path.dirname(archiveRoot), started.slug, 'options.json');
    {
      const next = JSON.parse(await fs.readFile(file, 'utf8'));
      const prev = JSON.parse(await fs.readFile(path.join(plan.archiveDir, 'options.json'), 'utf8'));
      const extra = Object.fromEntries(Object.entries(prev).filter(([k]) => !OWN_OPTION_KEYS.has(k) && !(k in next)));
      if (Object.keys(extra).length) await fs.writeFile(file, `${JSON.stringify({ ...next, ...extra }, null, 2)}\n`);
    }
  } catch { /* the old file was missing or not JSON: nothing to carry over */ }

  return { slug: started.slug, archive: plan.archiveDir, backupBranch: plan.backupBranch, worktreeAside: plan.worktreeAside, run: started.run, notes };
}
