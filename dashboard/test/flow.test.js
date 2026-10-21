// The flow map (lib/flow.js): git facts from a real temp repo with an org and a fork remote, PRs from
// a pretend gh, and the pure placing of each job. No network, no real GitHub.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { checksOf, FlowWatch, flowView, gatherRepo, githubSlug, laneOf, parseCounts, pickPr, prOf } from '../lib/flow.js';

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();
const commit = (cwd, msg) => { sh(cwd, 'commit', '--allow-empty', '-q', '-m', msg); };

// An org repo (main, staging) and a fork, both bare; a local clone with remotes moxie and origin;
// a job worktree on feature/x, 2 commits ahead of main, pushed to the fork, 1 more unpushed.
async function world() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-flow-'));
  const seed = path.join(root, 'seed');
  await fs.mkdir(seed);
  sh(seed, 'init', '-q', '-b', 'main');
  commit(seed, 'base');
  sh(seed, 'branch', 'staging');
  for (const name of ['org.git', 'fork.git']) sh(root, 'clone', '-q', '--bare', seed, name);
  const repo = path.join(root, 'moxie-portal');
  sh(root, 'clone', '-q', '-o', 'moxie', path.join(root, 'org.git'), repo);
  sh(repo, 'remote', 'add', 'origin', path.join(root, 'fork.git'));
  sh(repo, 'fetch', '-q', 'origin');
  // Main moves on by one commit; staging by three.
  const org = path.join(root, 'org-work');
  sh(root, 'clone', '-q', path.join(root, 'org.git'), org);
  commit(org, 'main moved'); sh(org, 'push', '-q', 'origin', 'main');
  sh(org, 'checkout', '-q', 'staging'); for (const m of ['s1', 's2', 's3']) commit(org, m); sh(org, 'push', '-q', 'origin', 'staging');
  sh(repo, 'fetch', '-q', 'moxie');
  const wt = path.join(root, 'orbit-x');
  sh(repo, 'worktree', 'add', '-q', '-b', 'feature/x', wt, 'moxie/main');
  commit(wt, 'x1'); commit(wt, 'x2');
  sh(wt, 'push', '-q', 'origin', 'feature/x');
  commit(wt, 'x3 unpushed');
  await fs.writeFile(path.join(wt, 'note.txt'), 'wip');
  return { root, repo, wt };
}

// gh replaced: the org's address is a local path here, so pretend it is GitHub's.
const ghWith = (prs) => async () => ({ ok: true, out: JSON.stringify(prs), err: null });

test('flow: helpers read git and gh output', () => {
  assert.deepEqual(parseCounts('3\t5\n'), { ahead: 3, behind: 5 });
  assert.equal(parseCounts('nope'), null);
  assert.equal(githubSlug('https://github.com/Moxie-Pest-Control-Phoenix/moxie-portal.git'), 'Moxie-Pest-Control-Phoenix/moxie-portal');
  assert.equal(githubSlug('git@github.com:me/app.git'), 'me/app');
  assert.equal(githubSlug('/tmp/x.git'), null);
  assert.equal(checksOf([]), null);
  assert.equal(checksOf([{ conclusion: 'SUCCESS' }, { conclusion: 'SKIPPED' }]), 'passing');
  assert.equal(checksOf([{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }]), 'pending');
  assert.equal(checksOf([{ conclusion: 'FAILURE' }, { status: 'IN_PROGRESS' }]), 'failing');
  assert.equal(prOf({ number: 3, state: 'OPEN', isDraft: true }).state, 'draft');
  assert.equal(prOf({ number: 3, state: 'MERGED', mergeCommit: { oid: 'abc' }, headRepositoryOwner: { login: 'me' } }).mergeCommit, 'abc');
  const p = (number, state) => ({ number, state });
  assert.equal(pickPr([p(106, 'merged'), p(135, 'merged'), p(127, 'merged')]).number, 135);
  assert.equal(pickPr([p(140, 'closed'), p(135, 'merged')]).number, 135, 'a merged one beats a newer closed one');
  assert.equal(pickPr([p(135, 'merged'), p(141, 'open')]).number, 141, 'an open one wins');
  assert.equal(pickPr([]), null);
});

test('flow: gatherRepo counts ahead/behind main and staging, unpushed and uncommitted, from real git', async () => {
  const { repo, wt } = await world();
  const f = await gatherRepo({ repo, jobs: [{ slug: 'x', branch: 'feature/x', worktree: wt }, { slug: 'gone', branch: 'feature/gone', worktree: null }] });
  assert.equal(f.org.remote, 'moxie');
  assert.equal(f.fork.remote, 'origin');
  assert.equal(f.main.ref, 'moxie/main');
  assert.equal(f.staging.ref, 'moxie/staging');
  assert.deepEqual(f.staging.vsMain, { ahead: 3, behind: 1 }, 'staging: 3 commits waiting for release, and 1 behind main');
  const x = f.jobs.find((j) => j.slug === 'x');
  assert.deepEqual(x.vsMain, { ahead: 3, behind: 0 });
  assert.deepEqual(x.vsStaging, { ahead: 4, behind: 3 }, 'main’s newer commit counts too: staging hasn’t had it');
  assert.deepEqual(x.fork, { exists: true, ahead: 1, behind: 0 }, 'one commit not pushed yet');
  assert.equal(x.dirty, 1);
  assert.deepEqual(x.org, { exists: false });
  assert.equal(f.jobs.find((j) => j.slug === 'gone').hasHead, false, 'a branch that exists nowhere: no counts');
  assert.equal(f.prs, null, 'no network read: PRs unknown');
});

test('flow: fetch brings remote changes in, and the PRs place the job', async () => {
  const { root, repo, wt } = await world();
  // Someone merges feature/x's work into staging (squash) and releases it to main.
  const org = path.join(root, 'org-work');
  sh(org, 'checkout', '-q', 'staging'); commit(org, 'Squash: feature/x (#136)');
  const merge = sh(org, 'rev-parse', 'HEAD').trim();
  sh(org, 'push', '-q', 'origin', 'staging');
  const prs = [
    { number: 135, state: 'MERGED', headRefName: 'feature/x', baseRefName: 'feature/x', headRepositoryOwner: { login: 'me' }, url: 'https://github.com/o/r/pull/135', statusCheckRollup: [{ conclusion: 'SUCCESS' }] },
    { number: 136, state: 'MERGED', headRefName: 'feature/x', baseRefName: 'staging', headRepositoryOwner: { login: 'o' }, url: 'https://github.com/o/r/pull/136', mergeCommit: { oid: merge }, reviewDecision: 'APPROVED' },
    { number: 140, state: 'OPEN', headRefName: 'staging', baseRefName: 'main', headRepositoryOwner: { login: 'o' }, url: 'https://github.com/o/r/pull/140' },
  ];
  const facts = await gatherRepo({ repo, jobs: [{ slug: 'x', branch: 'feature/x', worktree: wt }], fetch: true, prs: prs.map(prOf), gh: ghWith(prs) });
  assert.deepEqual(facts.staging.vsMain, { ahead: 4, behind: 1 }, 'fetched: the new staging commit is counted');
  assert.equal(facts.inMain[merge], false);
  // The org's address is a local path (no GitHub name), so gh isn't asked: the PRs passed in are kept.
  const view = flowView([facts], [{ slug: 'x', title: 'X' }]);
  const lane = view[0].lanes[0];
  assert.equal(lane.position, 'staging');
  assert.equal(lane.pr1.number, 135);
  assert.equal(lane.pr2.number, 136);
  assert.equal(lane.pr2.review, 'approved');
  assert.equal(view[0].release.number, 140, 'the open release PR shows on staging → main');
  // Released: the merge commit reaches main.
  sh(org, 'checkout', '-q', 'main'); sh(org, 'merge', '-q', '--no-edit', 'staging'); sh(org, 'push', '-q', 'origin', 'main');
  const after = await gatherRepo({ repo, jobs: [{ slug: 'x', branch: 'feature/x', worktree: wt }], fetch: true, prs: prs.map(prOf), gh: async () => ({ ok: false, out: '', err: 'offline' }) });
  assert.equal(after.inMain[merge], true);
  assert.equal(flowView([after], [{ slug: 'x' }])[0].lanes[0].position, 'main');
  assert.equal(after.prs.length, 3, 'a failed gh read keeps the last PRs');
});

test('flow: laneOf places a job from its PRs and refs', () => {
  const rf = (prs = [], extra = {}) => ({ org: { slug: 'org/app' }, fork: { owner: 'me' }, staging: { ref: 'moxie/staging' }, prs, inMain: {}, ...extra });
  const pr = (number, base, state, extra = {}) => ({ number, head: 'feature/x', base, state, headOwner: base === 'feature/x' ? 'me' : 'org', ...extra });
  const jf = (extra = {}) => ({ branch: 'feature/x', fork: { exists: false }, org: { exists: false }, ...extra });
  const place = (r, j) => laneOf({ slug: 'x' }, j, r).position;
  assert.equal(place(rf(), jf()), 'local');
  assert.equal(place(rf(), jf({ fork: { exists: true, ahead: 0, behind: 0 } })), 'fork');
  assert.equal(place(rf([pr(1, 'feature/x', 'open')]), jf({ fork: { exists: true } })), 'fork', 'PR #1 open: still on the fork');
  assert.equal(place(rf([pr(1, 'feature/x', 'merged')]), jf({ fork: { exists: true } })), 'org');
  assert.equal(place(rf([pr(1, 'feature/x', 'merged'), pr(2, 'staging', 'open')]), jf({ fork: { exists: true } })), 'org');
  assert.equal(place(rf([pr(1, 'feature/x', 'merged'), pr(2, 'staging', 'merged', { mergeCommit: 'm' })]), jf()), 'staging');
  assert.equal(place(rf([pr(2, 'staging', 'merged', { mergeCommit: 'm' })], { inMain: { m: true } }), jf()), 'main');
  // A new round: PR #1 merged again after the last merge into staging (#129, then #130–#134): that
  // round is on the org branch, not in staging; the old staging PR is no longer the arrow's.
  const rounds = rf([pr(129, 'staging', 'merged', { mergeCommit: 'm' }), pr(130, 'feature/x', 'merged'), pr(134, 'feature/x', 'merged')], { inMain: { m: true } });
  assert.equal(place(rounds, jf({ fork: { exists: true } })), 'org');
  assert.equal(laneOf({ slug: 'x' }, jf(), rounds).pr2, null);
  assert.equal(place(rf([pr(129, 'staging', 'merged', { mergeCommit: 'm' }), pr(140, 'feature/x', 'open')]), jf({ fork: { exists: true } })), 'fork', 'a new PR #1 still open');
  assert.equal(place(rf([pr(129, 'staging', 'merged', { mergeCommit: 'm' }), pr(120, 'feature/x', 'merged')]), jf()), 'staging', 'the merge into staging came after');
  // A clone of the org repo only (no fork): a branch on the org is on the org branch.
  assert.equal(place({ org: { slug: 'org/app' }, fork: null, staging: { ref: 's' }, prs: [], inMain: {} }, jf({ org: { exists: true } })), 'org');
  // A repo with no org remote and no staging: fork → main.
  const simple = { org: null, fork: { owner: 'me' }, staging: null, prs: [pr(4, 'main', 'merged')], inMain: {} };
  assert.equal(place(simple, jf({ fork: { exists: true } })), 'main');
  const lane = laneOf({ slug: 'x' }, jf({ fork: { exists: true, ahead: 2, behind: 0 }, vsMain: { ahead: 5, behind: 1 }, dirty: 3 }), rf());
  assert.equal(lane.unpushed, 2);
  assert.deepEqual(lane.vsMain, { ahead: 5, behind: 1 });
  assert.equal(lane.dirty, 3);
});

test('flow: FlowWatch refreshes one at a time and emits the view', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const watch = new FlowWatch({
    jobsFor: async () => [{ slug: 'x', title: 'X', branch: 'feature/x', repoPath: '/r' }, { slug: 'no-repo' }],
    gather: async ({ repo, fetch }) => { calls++; await gate; return { repo, name: 'r', jobs: [{ slug: 'x', branch: 'feature/x' }], prs: fetch ? [] : null, inMain: {}, errors: [] }; },
    now: () => Date.parse('2026-10-21T12:00:00Z'),
  });
  const seen = [];
  watch.on('flow', (v) => seen.push(v.refreshing));
  const a = watch.refresh({ network: true });
  watch.refresh({ network: false });
  watch.refresh({ network: false });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 1, 'one at a time');
  release();
  await a;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 2, 'the requests made meanwhile run once, after it');
  const v = watch.view();
  assert.equal(v.repos[0].lanes[0].slug, 'x');
  assert.equal(v.fetchedAt, '2026-10-21T12:00:00.000Z');
  assert.equal(v.nextFetchAt, '2026-10-21T12:10:00.000Z');
  assert.deepEqual(seen.slice(0, 2), [true, false]);
  // A local recount that changes nothing sends nothing, and never says it is reading.
  const before = seen.length;
  await watch.refresh({ network: false });
  assert.equal(seen.length, before);
});

test('flow: a failing refresh never rejects, and the next one still runs', async () => {
  let n = 0;
  const watch = new FlowWatch({ jobsFor: async () => { n++; if (n === 1) throw new Error('boom'); return []; } });
  const problems = [];
  watch.on('problem', (e) => problems.push(e.message));
  await watch.refresh({ network: true });
  assert.deepEqual(problems, ['boom']);
  await watch.refresh({ network: false });
  assert.equal(n, 2);
  assert.equal(watch.view().refreshing, false);
});
