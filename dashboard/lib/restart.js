// Changing the Foreman's model starts the job again (spec 1.5): the model is fixed for a job once
// it has started. A restart moves the job's work aside and starts a new job from the same
// description. Nothing is deleted and nothing is pushed:
//   the worktree folder   moves to <worktree>.<date> (uncommitted changes go with it)
//   the job's branch      is renamed backup/<branch>-<date> (its commits stay on it)
//   the job's folder      moves to <features>/.restarted/<slug>-<date> (spec, plan, briefs, decisions)
//   the job's session     record (sessions.json) is copied into that archive folder, then cleared
//                         so the new job does not pick up the old Foreman
// When any of those names is taken (a second restart the same day) -2, -3, … is added.
// A step that fails before the new job exists is undone, in reverse order, so the old job is as it
// was; when an undo step itself fails, the message says exactly what is where.

import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { HttpError } from './http-guard.js';
import { FABLE } from './options.js';

const run = promisify(execFile);

/**
 * The options a restart carries to the new job: what the New job form itself can set. Nothing else is
 * copied. Left out on purpose: auto and auto_since (the old job's Auto level, and when it was set),
 * from_session (the old job's link to a past conversation), schema_version and updated_at (the new
 * job writes its own), stack (the stack's coordinator and its parts are not restarted), title, repo,
 * kind, ticket and branch (the start writes them from the description, repository, kind and ticket),
 * and any key not listed here.
 */
export const CARRIED_OPTION_KEYS = ['level', 'flow', 'skip', 'provided', 'reviewers', 'review_rounds', 'manual_test', 'fable_checks', 'models', 'all_fable', 'notes', 'wireframes', 'clarify', 'evidence'];

/** What a new job's start writes into its folder before it can fail: nothing else in there is the start's. */
const START_WRITES = new Set(['options.json', 'status.json', 'ticket.md', 'history.md']);

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

/**
 * A restart that did not go through. `moved` says what is still moved (and where to).
 *   no moved, no `undone`: nothing was touched.
 *   `undone`: steps had moved, and all of them were put back.
 *   `undoFailed` ({ what, why }): putting a step back failed; the rest stays where it is.
 *   `leftAlone` (text): Starbase could not be sure what was safe to remove, so it left everything.
 */
export class RestartFailed extends Error {
  constructor(reason, moved, { undone = false, undoFailed = null, leftAlone = null } = {}) {
    const list = moved.map((m) => `${m.what} (${m.from} to ${m.to})`).join('; ');
    let text;
    if (undoFailed) text = `The restart stopped part way, and putting things back failed: ${reason} Starbase then tried to put back ${undoFailed.what} and could not: ${undoFailed.why} Where things are now: ${list}. Nothing was deleted.`;
    else if (leftAlone) text = `The restart stopped part way: ${reason} ${leftAlone} Where things are now: ${list}. Nothing was deleted.`;
    else if (undone) text = `The restart did not go through: ${reason} Everything it had moved was put back. Nothing was changed.`;
    else if (moved.length) text = `The restart stopped part way: ${reason} Already moved, and left where it is now: ${list}. Nothing was deleted or moved back.`;
    else text = `The restart did not start: ${reason} Nothing was changed.`;
    super(text);
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
 * session: { read(dir), clear(dir), write(dir, record) }, the job's sessions.json record (write puts it
 * back when a later step fails).  parked: { read(dir) → entries, forget(dir) }, replies and go-aheads
 * waiting to be sent for the job (the usage limit's list).
 * Returns { slug, archive, backupBranch, worktreeAside, run }.
 */
export async function restartJob(job, { model, git = realGit, fs = fsp, start, session = null, parked = null, today = dated() }) {
  const notes = [];
  if (job.running) throw new HttpError(409, 'Stop the reply first.');
  if (job.terminalOpen) throw new HttpError(409, 'Claude Code is open on this job in a terminal. Close it (type /exit there) and try again. Nothing was changed.');
  if (hasOpenPullRequest(job.prs)) throw new HttpError(409, 'This job has an open pull request, so its model can’t change: reviewed work would be thrown away. Close the pull request, or start a new job.');

  const refuse = (reason) => new RestartFailed(reason, []);
  if (job.options?.stack === true || await exists(fs, path.join(job.dir, 'stack.md')) || await exists(fs, path.join(job.dir, 'stack.json'))) {
    throw refuse('This job coordinates a stack, and its parts have branches and folders of their own that a restart does not move, so starting it again here could leave them pointing at nothing. Finish the stack on its current model, or start a new job.');
  }
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

  const moved = []; // each: { what, from, to, undo }
  // Put back what moved, newest first. Stops at the first step that cannot be put back.
  const putBack = async (reason, options = {}) => {
    const nothingMoved = moved.length === 0;
    while (moved.length) {
      const last = moved.at(-1);
      try { await last.undo(); } catch (err) {
        throw new RestartFailed(reason, moved.map(({ what, from, to }) => ({ what, from, to })), { undoFailed: { what: last.what, why: why(err) } });
      }
      moved.pop();
    }
    return new RestartFailed(reason, [], { undone: !nothingMoved, ...options });
  };
  const step = async (what, from, to, fn, undo) => {
    try { await fn(); } catch (err) { throw await putBack(`${what} failed: ${why(err)}`); }
    moved.push({ what, from, to, undo });
  };
  if (worktree) await step('the worktree folder', worktree, plan.worktreeAside, () => git.moveWorktree(repo ?? worktree, worktree, plan.worktreeAside), () => git.moveWorktree(repo ?? worktree, plan.worktreeAside, worktree));
  if (branch) await step('the branch', branch, plan.backupBranch, () => git.renameBranch(repo, branch, plan.backupBranch), () => git.renameBranch(repo, plan.backupBranch, branch));
  await step('the job folder', job.dir, plan.archiveDir, async () => {
    await fs.mkdir(archiveRoot, { recursive: true });
    await fs.rename(job.dir, plan.archiveDir);
  }, () => fs.rename(plan.archiveDir, job.dir));
  if (session) {
    const record = await session.read(job.dir);
    if (record) {
      const copy = path.join(plan.archiveDir, 'session-record.json');
      let cleared = false;
      await step('the Foreman session record', 'sessions.json', copy, async () => {
        await fs.writeFile(copy, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
        await session.clear(job.dir);
        cleared = true;
      }, async () => {
        if (cleared) {
          if (!session.write) throw new Error('there is no way to write it back');
          await session.write(job.dir, record);
        }
        await fs.rm(copy, { force: true });
      });
    }
  }
  // A reply or go-ahead waiting to be sent for this job is copied into the archive; it is forgotten
  // (never sent) only once the new job has started.
  const waiting = parked ? await parked.read(job.dir) : [];
  if (waiting.length) {
    const copy = path.join(plan.archiveDir, 'parked-reply.json');
    await step('the reply waiting to be sent', 'the paused jobs list', copy, () => fs.writeFile(copy, `${JSON.stringify(waiting, null, 2)}\n`, { mode: 0o600 }), () => fs.rm(copy, { force: true }));
  }

  // The options the new job starts with: only the listed ones, the new model in place of the old.
  const old = job.options ?? {};
  const carried = Object.fromEntries(CARRIED_OPTION_KEYS.filter((k) => old[k] !== undefined).map((k) => [k, old[k]]));
  const models = { ...(old.models && typeof old.models === 'object' ? old.models : {}), foreman: model };
  const options = { ...carried, models, ...(old.all_fable === true && model !== FABLE ? { all_fable: false } : {}) };
  const featuresDir = path.dirname(archiveRoot);
  const folders = async () => (await siblings(featuresDir)).filter((n) => !n.startsWith('.'));
  const before = new Set(await folders());
  let started;
  try {
    started = await start({ description: job.title, ticket: job.ticket ?? undefined, kind: job.kind, repoPath: repo ?? old.repo, level: old.level, options, model });
  } catch (err) {
    const reason = `starting the new job failed: ${why(err)}`;
    // What the failed start left behind: removed only when it is nothing but what the start itself writes.
    const fresh = (await folders()).filter((n) => !before.has(n)).map((n) => path.join(featuresDir, n));
    const unsure = [];
    for (const dir of fresh) {
      let names;
      try { names = await fs.readdir(dir, { withFileTypes: true }); } catch { unsure.push(dir); continue; }
      if (names.every((e) => e.isFile() && START_WRITES.has(e.name))) continue;
      unsure.push(dir);
    }
    if (unsure.length) {
      const where = fresh.length ? ` The half-started job's folder${unsure.length > 1 ? 's' : ''}: ${unsure.join(', ')}.` : '';
      throw new RestartFailed(reason, moved.map(({ what, from, to }) => ({ what, from, to })), { leftAlone: `Starbase is not sure which files in the new job's folder were written by Starbase and which by a person, so it left everything as it is.${where} To start the job again by hand, use the description "${job.title}"${job.ticket?.key ? `, the ticket ${job.ticket.key}` : ''} and the repository ${repo ?? old.repo ?? '(not recorded)'}. The old work is in ${plan.archiveDir}${plan.backupBranch ? `, on the branch ${plan.backupBranch}` : ''}${plan.worktreeAside ? `, and in the folder ${plan.worktreeAside}` : ''}.` });
    }
    for (const dir of fresh) { try { await fs.rm(dir, { recursive: true, force: true }); } catch (e) { throw new RestartFailed(reason, moved.map(({ what, from, to }) => ({ what, from, to })), { leftAlone: `Starbase could not clear the new job's half-written folder ${dir} (${why(e)}), so it left everything as it is. To start the job again by hand, use the description "${job.title}" and the repository ${repo ?? old.repo ?? '(not recorded)'}; the old work is in ${plan.archiveDir}.` }); } }
    throw await putBack(reason);
  }
  if (waiting.length) { await parked.forget(job.dir); notes.push(`A reply waiting to be sent for the old job was not sent. A copy is in ${path.join(plan.archiveDir, 'parked-reply.json')}.`); }

  // Listed options of the old options.json that the new job's file doesn't hold are kept. Only a
  // missing old file is fine; any other failure is told to the person (the new job is already running).
  const file = path.join(featuresDir, started.slug, 'options.json');
  try {
    const next = JSON.parse(await fs.readFile(file, 'utf8'));
    const prev = JSON.parse(await fs.readFile(path.join(plan.archiveDir, 'options.json'), 'utf8'));
    const extra = Object.fromEntries(Object.entries(prev).filter(([k]) => CARRIED_OPTION_KEYS.includes(k) && !(k in next)));
    if (Object.keys(extra).length) await fs.writeFile(file, `${JSON.stringify({ ...next, ...extra }, null, 2)}\n`);
  } catch (err) {
    if (err?.code !== 'ENOENT') notes.push(`Some of the old job's options could not be copied to the new job's options file (${why(err)}). Check them in the job's options.`);
  }

  return { slug: started.slug, archive: plan.archiveDir, backupBranch: plan.backupBranch, worktreeAside: plan.worktreeAside, run: started.run, notes };
}
