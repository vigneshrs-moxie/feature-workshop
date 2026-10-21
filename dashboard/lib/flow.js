// The flow map (Home): where each job's work is on its way to main, per repo.
//
// The Orbit flow (the git workflow docs): a job's branch lives in its worktree, is pushed to your
// fork (origin/<branch>), goes by PR #1 to the same-named org branch (moxie/<branch>), by PR #2
// into moxie/staging, and reaches moxie/main with the release PR (staging → main) that carries
// everything in staging. A repo without an org remote or a staging branch has a shorter flow:
// fork → main.
//
// Where a job is comes from its PRs, not from git ancestry: PRs are squash-merged, so a branch's
// own commits never show up in staging. "In staging" = its PR into staging merged; "in main" = that
// PR's merge commit is in the org's main. The counts (ahead/behind main and staging, unpushed,
// uncommitted) come from local git, after a fetch.
//
//   gatherRepo()   the facts for one repo: git (read-only; `fetch` also runs git fetch --prune of
//                  both remotes) and one `gh pr list` on the org repo
//   flowView()     pure: the facts → the map's repos, lanes and boxes
//   FlowWatch      keeps the view fresh: the network every 10 minutes (or on Refresh), the local
//                  counts every minute and when jobs change; one refresh at a time
//
// Nothing here writes to a repo or to GitHub.

import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import path from 'node:path';

import { ORG_REMOTES, ORG_URL } from './hard-lines.js';

export const NETWORK_EVERY_MS = 10 * 60 * 1000;
export const LOCAL_EVERY_MS = 60 * 1000;
const BRANCH = /^(?!-)[\w./-]{1,200}$/;

function run(cmd, args, { cwd, timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout ?? ''), err: err ? String(stderr || err.message).split('\n')[0] : null }));
  });
}
const git = (dir, args, opts) => run('git', ['-C', dir, ...args], opts);

/** "Owner/name" for a GitHub address, or null. */
export function githubSlug(url) {
  const m = /github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(String(url ?? ''));
  return m ? `${m[1]}/${m[2]}` : null;
}

/** "3\t5" (git rev-list --left-right --count A...B) → { ahead: 3, behind: 5 }. */
export function parseCounts(out) {
  const m = /^(\d+)\s+(\d+)/.exec(String(out ?? '').trim());
  return m ? { ahead: Number(m[1]), behind: Number(m[2]) } : null;
}

/** A PR's checks in one word: 'failing', 'pending', 'passing', or null when it has none. */
export function checksOf(rollup) {
  const list = Array.isArray(rollup) ? rollup : [];
  if (!list.length) return null;
  const word = (c) => String(c?.conclusion || c?.state || c?.status || '').toUpperCase();
  if (list.some((c) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(word(c)))) return 'failing';
  if (list.some((c) => ['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'WAITING', 'REQUESTED', ''].includes(word(c)))) return 'pending';
  return 'passing';
}

const PR_FIELDS = 'number,title,state,isDraft,headRefName,baseRefName,headRepositoryOwner,url,reviewDecision,mergedAt,mergeCommit,statusCheckRollup,updatedAt';

/** One PR from gh's JSON, trimmed to what the map shows. */
export function prOf(p) {
  return {
    number: p.number, title: p.title ?? '', url: p.url ?? null,
    state: p.state === 'OPEN' && p.isDraft ? 'draft' : String(p.state ?? '').toLowerCase(), // open | draft | merged | closed
    head: p.headRefName, base: p.baseRefName, headOwner: p.headRepositoryOwner?.login ?? null,
    review: p.reviewDecision ? String(p.reviewDecision).toLowerCase() : null, // approved | changes_requested | review_required
    checks: checksOf(p.statusCheckRollup), mergedAt: p.mergedAt ?? null, mergeCommit: p.mergeCommit?.oid ?? null,
    updatedAt: p.updatedAt ?? null,
  };
}

// The PR to show for an arrow: the newest open one, else the newest merged, else the newest closed.
export function pickPr(prs) {
  const sorted = [...prs].sort((a, b) => b.number - a.number);
  return sorted.find((p) => p.state === 'open' || p.state === 'draft') ?? sorted.find((p) => p.state === 'merged') ?? sorted[0] ?? null;
}

/**
 * The facts for one repo. jobs: [{ slug, branch, worktree }]. fetch: also git fetch --prune both
 * remotes and read the org's PRs with gh. prs: the PRs from the last network refresh (kept when
 * this one doesn't read them).
 */
export async function gatherRepo({ repo, jobs, fetch = false, prs = null, git: gitFn = git, gh = (args) => run('gh', args, { timeout: 30000 }) }) {
  const errors = [];
  const remotesOut = await gitFn(repo, ['remote', '-v']);
  const remotes = new Map();
  for (const line of remotesOut.out.split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\(push\)$/.exec(line);
    if (m) remotes.set(m[1], m[2]);
  }
  const orgName = [...remotes].find(([n, u]) => ORG_REMOTES.includes(n) || ORG_URL.test(u))?.[0] ?? null;
  const forkName = remotes.has('origin') && 'origin' !== orgName ? 'origin' : null;
  const upstream = orgName ?? forkName; // where main (and staging) live
  if (fetch) {
    for (const r of [orgName, forkName].filter(Boolean)) {
      const res = await gitFn(repo, ['fetch', '--prune', '--quiet', r], { timeout: 90000 });
      if (!res.ok) errors.push(`git fetch ${r}: ${res.err}`);
    }
  }
  const exists = async (dir, ref) => (await gitFn(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).ok;
  const counts = async (dir, a, b) => parseCounts((await gitFn(dir, ['rev-list', '--left-right', '--count', `${a}...${b}`])).out);
  const tip = async (ref) => {
    const r = await gitFn(repo, ['log', '-1', '--format=%H%x09%cI%x09%s', ref]);
    const [sha, at, subject] = r.ok ? r.out.trim().split('\t') : [];
    return sha ? { sha, at, subject } : null;
  };
  const main = upstream && await exists(repo, `${upstream}/main`) ? `${upstream}/main` : null;
  const staging = orgName && await exists(repo, `${orgName}/staging`) ? `${orgName}/staging` : null;

  let prList = prs;
  const orgSlug = githubSlug(remotes.get(orgName ?? '') ?? remotes.get(forkName ?? '') ?? '');
  if (fetch && orgSlug) {
    const res = await gh(['pr', 'list', '--repo', orgSlug, '--state', 'all', '--limit', '200', '--json', PR_FIELDS]);
    if (res.ok) { try { prList = JSON.parse(res.out).map(prOf); } catch { errors.push('gh pr list: unreadable output'); } } else errors.push(`gh pr list: ${res.err}`);
  }
  // Which of the jobs' merged PRs into staging have reached main (their merge commit is in main).
  const inMain = {};
  const branches = new Set(jobs.map((j) => j.branch).filter(Boolean));
  if (main) {
    for (const p of prList ?? []) {
      if (p.state === 'merged' && p.base === 'staging' && p.mergeCommit && branches.has(p.head)) inMain[p.mergeCommit] = (await gitFn(repo, ['merge-base', '--is-ancestor', p.mergeCommit, main])).ok;
    }
  }

  const jobFacts = [];
  for (const j of jobs) {
    if (!j.branch || !BRANCH.test(j.branch)) { jobFacts.push({ slug: j.slug, branch: j.branch ?? null }); continue; }
    const wt = j.worktree && (await gitFn(j.worktree, ['rev-parse', '--git-dir'])).ok ? j.worktree : null;
    const dir = wt ?? repo;
    const head = wt ? 'HEAD' : (await exists(repo, `refs/heads/${j.branch}`) ? `refs/heads/${j.branch}` : forkName && await exists(repo, `${forkName}/${j.branch}`) ? `${forkName}/${j.branch}` : null);
    const f = { slug: j.slug, branch: j.branch, worktree: wt, hasHead: Boolean(head) };
    if (head) {
      if (main) f.vsMain = await counts(dir, head, main);
      if (staging) f.vsStaging = await counts(dir, head, staging);
      if (forkName) f.fork = await exists(dir, `${forkName}/${j.branch}`) ? { exists: true, ...(await counts(dir, head, `${forkName}/${j.branch}`)) } : { exists: false };
      if (orgName) f.org = { exists: await exists(dir, `${orgName}/${j.branch}`) };
      if (wt) f.dirty = (await gitFn(wt, ['status', '--porcelain'])).out.split('\n').filter(Boolean).length;
    }
    jobFacts.push(f);
  }
  return {
    repo, name: path.basename(repo), fetchedNow: fetch,
    org: orgName ? { remote: orgName, url: remotes.get(orgName), slug: githubSlug(remotes.get(orgName)) } : null,
    fork: forkName ? { remote: forkName, url: remotes.get(forkName), owner: githubSlug(remotes.get(forkName))?.split('/')[0] ?? null } : null,
    main: main ? { ref: main, tip: await tip(main) } : null,
    staging: staging ? { ref: staging, tip: await tip(staging), vsMain: main ? await counts(repo, staging, main) : null } : null,
    prs: prList, inMain, jobs: jobFacts, errors,
  };
}

// ---------- pure: facts → the map ----------

const POSITIONS = ['local', 'fork', 'org', 'staging', 'main'];

/**
 * One job's lane. facts: from gatherRepo (its repo's) and the job's own. job: { slug, title, … }
 * as the snapshot has it. Returns the lane: where the work is and each arrow's PR.
 */
export function laneOf(job, jf, repoFacts) {
  const prs = (repoFacts.prs ?? []).filter((p) => p.head === jf?.branch);
  const forkOwner = repoFacts.fork?.owner ?? null;
  const fromFork = (p) => !forkOwner || p.headOwner === forkOwner || p.headOwner !== repoFacts.org?.slug?.split('/')[0];
  const hasStaging = Boolean(repoFacts.staging);
  const twoStep = Boolean(repoFacts.org && repoFacts.fork); // fork → org branch → staging
  const pr1 = twoStep ? pickPr(prs.filter((p) => p.base === jf?.branch && fromFork(p))) : null;
  const toStaging = hasStaging ? pickPr(prs.filter((p) => p.base === 'staging')) : null;
  const toMain = pickPr(prs.filter((p) => p.base === 'main'));
  const pr2 = toStaging ?? (!hasStaging ? toMain : null);
  let position = 'local';
  if (jf?.fork?.exists) position = 'fork';
  if (twoStep && (pr1?.state === 'merged' || jf?.org?.exists)) position = 'org';
  if (hasStaging && toStaging?.state === 'merged') position = 'staging';
  if (hasStaging && toStaging?.state === 'merged' && toStaging.mergeCommit && repoFacts.inMain?.[toStaging.mergeCommit]) position = 'main';
  if (!hasStaging && toMain?.state === 'merged') position = 'main';
  return {
    slug: job.slug, title: job.title ?? null, branch: jf?.branch ?? job.branch ?? null, worktree: jf?.worktree ?? null,
    position, reached: POSITIONS.indexOf(position),
    vsMain: jf?.vsMain ?? null, vsStaging: jf?.vsStaging ?? null,
    unpushed: jf?.fork?.exists ? jf.fork.ahead ?? 0 : null, forkBehind: jf?.fork?.exists ? jf.fork.behind ?? 0 : null,
    dirty: jf?.dirty ?? null, pushed: Boolean(jf?.fork?.exists), orgBranch: Boolean(jf?.org?.exists),
    pr1, pr2,
  };
}

/** The whole map from each repo's facts. jobs: the snapshot's jobs (slug, title, repoPath, …). */
export function flowView(repoFacts, jobs) {
  return repoFacts.map((rf) => {
    const lanes = rf.jobs.map((jf) => laneOf(jobs.find((j) => j.slug === jf.slug) ?? { slug: jf.slug }, jf, rf));
    const release = rf.staging ? pickPr((rf.prs ?? []).filter((p) => p.head === 'staging' && p.base === 'main')) : null;
    return {
      repo: rf.repo, name: rf.name,
      org: rf.org ? { remote: rf.org.remote, slug: rf.org.slug } : null,
      fork: rf.fork ? { remote: rf.fork.remote, slug: githubSlug(rf.fork.url) } : null,
      main: rf.main, staging: rf.staging,
      release: release && (release.state === 'open' || release.state === 'draft') ? release : null,
      prsKnown: Array.isArray(rf.prs),
      lanes, errors: rf.errors ?? [],
    };
  });
}

// ---------- keeping it fresh ----------

/**
 * jobsFor(): the jobs to map, [{ slug, title, branch, worktree, repoPath, … }]. gather: gatherRepo
 * (a demo passes invented facts). Emits 'flow' with view() whenever it changes.
 */
export class FlowWatch extends EventEmitter {
  constructor({ jobsFor, gather = gatherRepo, networkEveryMs = NETWORK_EVERY_MS, localEveryMs = LOCAL_EVERY_MS, now = () => Date.now() }) {
    super();
    Object.assign(this, { jobsFor, gather, networkEveryMs, localEveryMs, now });
    this.facts = new Map(); // repo → facts
    this.repos = [];
    this.fetchedAt = null;
    this.checkedAt = null;
    this.running = null;
    this.again = null;
    this.timers = [];
  }

  view() {
    return { repos: this.repos, fetchedAt: this.fetchedAt, checkedAt: this.checkedAt, refreshing: Boolean(this.running), nextFetchAt: this.fetchedAt ? new Date(Date.parse(this.fetchedAt) + this.networkEveryMs).toISOString() : null };
  }

  /** Refresh now. network: also fetch and read PRs. One at a time; a request during one runs after it. */
  refresh({ network = false } = {}) {
    if (this.running) {
      this.again = { network: network || Boolean(this.again?.network) };
      return this.running;
    }
    this.running = this.#refresh(network).finally(() => {
      this.running = null;
      const next = this.again;
      this.again = null;
      if (next) this.refresh(next);
    });
    this.emit('flow', this.view());
    return this.running;
  }

  async #refresh(network) {
    const jobs = (await this.jobsFor()).filter((j) => j.repoPath);
    const byRepo = new Map();
    for (const j of jobs) byRepo.set(j.repoPath, [...(byRepo.get(j.repoPath) ?? []), j]);
    const facts = [];
    for (const [repo, list] of byRepo) {
      try {
        const f = await this.gather({ repo, jobs: list, fetch: network, prs: this.facts.get(repo)?.prs ?? null });
        this.facts.set(repo, f);
        facts.push(f);
      } catch (err) {
        facts.push({ repo, name: path.basename(repo), jobs: [], prs: null, errors: [String(err?.message ?? err)] });
      }
    }
    for (const repo of [...this.facts.keys()]) if (!byRepo.has(repo)) this.facts.delete(repo);
    this.repos = flowView(facts, jobs);
    const at = new Date(this.now()).toISOString();
    this.checkedAt = at;
    if (network) this.fetchedAt = at;
    this.emit('flow', { ...this.view(), refreshing: false });
  }

  start() {
    this.refresh({ network: true });
    this.timers.push(setInterval(() => this.refresh({ network: true }), this.networkEveryMs));
    this.timers.push(setInterval(() => this.refresh({ network: false }), this.localEveryMs));
    for (const t of this.timers) t.unref?.();
  }

  stop() { for (const t of this.timers) clearInterval(t); this.timers = []; }
}
