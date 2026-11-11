// Changing the Foreman model starts the job again (lib/restart.js). Real temporary git repository
// and folders; the new job is started by a stand-in for the New job handler. Nothing real is touched.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { planRestart, restartJob, realGit } from '../lib/restart.js';

const TODAY = '2026-11-10';
let root, repo, features, worktree, started;

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' }).toString().trim();
const exists = (p) => fs.access(p).then(() => true, () => false);

function job(over = {}) {
  return {
    slug: 'visit-audit', dir: path.join(features, 'visit-audit'), title: 'Add visit audit columns', kind: 'feature', ticket: { key: 'ORBIT-9', title: 'Audit', url: 'https://example.test/9' },
    repoPath: repo, branch: 'feature/visit-audit', worktree, prs: null, running: false, archiveRoot: path.join(features, '.restarted'),
    options: { schema_version: 2, level: 2, flow: 'small', title: 'Add visit audit columns', repo, kind: 'feature', models: { foreman: 'claude-opus-5-5', build: 'claude-opus-5-5', checks: 'claude-opus-5-5' }, notes: 'be careful', auto: { on: true }, auto_since: '2026-11-09', updated_at: 'x' },
    ...over,
  };
}

// Stands in for the New job handler: records what it was asked and makes the new job's folder.
const start = async (body) => {
  started = body;
  const slug = 'visit-audit';
  await fs.mkdir(path.join(features, slug), { recursive: true });
  await fs.writeFile(path.join(features, slug, 'options.json'), JSON.stringify({ schema_version: 2, level: body.options.level, models: body.options.models, notes: body.options.notes }));
  return { slug, run: { id: 'r1' } };
};

beforeEach(async () => {
  started = null;
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sb-restart-')));
  repo = path.join(root, 'repo');
  features = path.join(root, 'feature-work');
  worktree = path.join(root, 'repo-worktrees', 'visit-audit');
  await fs.mkdir(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  await fs.writeFile(path.join(repo, 'README.md'), 'hi\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'base');
  await fs.mkdir(path.dirname(worktree), { recursive: true });
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/visit-audit', worktree);
  await fs.writeFile(path.join(worktree, 'a.txt'), 'built\n');
  git(worktree, 'add', '.'); git(worktree, 'commit', '-q', '-m', 'step 1');
  const dir = path.join(features, 'visit-audit');
  await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'briefs', '001-spec.md'), 'the spec');
  await fs.writeFile(path.join(dir, 'decisions.md'), 'decided');
  await fs.writeFile(path.join(dir, 'options.json'), JSON.stringify(job().options));
});
afterEach(() => fs.rm(root, { recursive: true, force: true }));

test('planRestart: names, and -2, -3 when taken', () => {
  const j = { slug: 's', branch: 'feature/s', worktree: '/w/s', archiveRoot: '/f/.restarted' };
  assert.deepEqual(planRestart(j, { today: TODAY }), { archiveDir: '/f/.restarted/s-2026-11-10', backupBranch: 'backup/feature/s-2026-11-10', worktreeAside: '/w/s.2026-11-10' });
  const second = planRestart(j, { today: TODAY, existingBranches: ['backup/feature/s-2026-11-10'], existingArchives: ['/f/.restarted/s-2026-11-10'], existingPaths: ['/w/s.2026-11-10'] });
  assert.deepEqual(second, { archiveDir: '/f/.restarted/s-2026-11-10-2', backupBranch: 'backup/feature/s-2026-11-10-2', worktreeAside: '/w/s.2026-11-10-2' });
  const third = planRestart(j, { today: TODAY, existingBranches: ['backup/feature/s-2026-11-10', 'backup/feature/s-2026-11-10-2'] });
  assert.equal(third.backupBranch, 'backup/feature/s-2026-11-10-3');
  assert.equal(planRestart({ ...j, branch: null, worktree: null }, { today: TODAY }).backupBranch, null);
});

test('the old folder is in the archive and the old commits are on the backup branch', async () => {
  const before = git(repo, 'rev-parse', 'feature/visit-audit');
  const out = await restartJob(job(), { model: 'claude-fable-5-2', start, today: TODAY });
  const archive = path.join(features, '.restarted', 'visit-audit-2026-11-10');
  assert.equal(out.archive, archive);
  assert.equal(out.backupBranch, 'backup/feature/visit-audit-2026-11-10');
  assert.equal(await fs.readFile(path.join(archive, 'briefs', '001-spec.md'), 'utf8'), 'the spec');
  assert.equal(await fs.readFile(path.join(archive, 'decisions.md'), 'utf8'), 'decided');
  assert.equal(git(repo, 'rev-parse', out.backupBranch), before);
  assert.equal(git(repo, 'branch', '--list', 'feature/visit-audit'), '', 'the old branch name is free for the new job');
});

test('uncommitted changes are still in the worktree folder moved aside', async () => {
  await fs.writeFile(path.join(worktree, 'wip.txt'), 'not committed\n');
  const out = await restartJob(job(), { model: 'claude-fable-5-2', start, today: TODAY });
  assert.equal(out.worktreeAside, `${worktree}.2026-11-10`);
  assert.equal(await fs.readFile(path.join(out.worktreeAside, 'wip.txt'), 'utf8'), 'not committed\n');
  assert.equal(await exists(worktree), false);
  assert.equal(git(out.worktreeAside, 'rev-parse', '--abbrev-ref', 'HEAD'), 'backup/feature/visit-audit-2026-11-10');
});

test('a second restart the same day gets -2 names', async () => {
  await restartJob(job(), { model: 'claude-fable-5-2', start, today: TODAY });
  // The new job builds: a branch and worktree of the same names again.
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/visit-audit', worktree);
  const out = await restartJob(job(), { model: 'claude-opus-5-5', start, today: TODAY });
  assert.equal(out.archive, path.join(features, '.restarted', 'visit-audit-2026-11-10-2'));
  assert.equal(out.backupBranch, 'backup/feature/visit-audit-2026-11-10-2');
  assert.equal(out.worktreeAside, `${worktree}.2026-11-10-2`);
  assert.equal(await exists(path.join(features, '.restarted', 'visit-audit-2026-11-10')), true, 'the first archive is untouched');
});

test('an open pull request refuses, and nothing moved', async () => {
  await assert.rejects(restartJob(job({ prs: [{ number: 5, state: 'open', url: 'https://x/5' }] }), { model: 'claude-fable-5-2', start, today: TODAY }), (e) => e.status === 409 && /open pull request/.test(e.message));
  assert.equal(await exists(worktree), true);
  assert.equal(await exists(path.join(features, 'visit-audit', 'decisions.md')), true);
  assert.equal(git(repo, 'branch', '--list', 'feature/visit-audit') !== '', true);
  assert.equal(started, null);
});

test('a running reply refuses', async () => {
  await assert.rejects(restartJob(job({ running: true }), { model: 'claude-fable-5-2', start, today: TODAY }), (e) => e.status === 409 && e.message === 'Stop the reply first.');
  assert.equal(await exists(worktree), true);
  assert.equal(await exists(path.join(features, '.restarted')), false);
  assert.equal(started, null);
});

test('the new job has the same description, ticket, kind, repository, level and options, and the new model', async () => {
  await restartJob(job(), { model: 'claude-fable-5-2', start, today: TODAY });
  assert.equal(started.description, 'Add visit audit columns');
  assert.equal(started.ticket.key, 'ORBIT-9');
  assert.equal(started.kind, 'feature');
  assert.equal(started.repoPath, repo);
  assert.equal(started.level, 2);
  assert.equal(started.model, 'claude-fable-5-2');
  assert.equal(started.options.models.foreman, 'claude-fable-5-2');
  assert.equal(started.options.models.build, 'claude-opus-5-5');
  assert.equal(started.options.notes, 'be careful');
  // Keys this code does not know are kept by name, in the new job's options.json.
  const next = JSON.parse(await fs.readFile(path.join(features, 'visit-audit', 'options.json'), 'utf8'));
  assert.deepEqual(next.auto, { on: true });
  assert.equal(next.auto_since, '2026-11-09');
});

test('the Foreman session record is kept in the archive and cleared for the new job', async () => {
  const cleared = [];
  const session = { read: async () => ({ sessionId: 'abc', model: 'claude-opus-5-5', extra: 1 }), clear: async (d) => { cleared.push(d); } };
  const out = await restartJob(job(), { model: 'claude-fable-5-2', start, session, today: TODAY });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(out.archive, 'session-record.json'), 'utf8')), { sessionId: 'abc', model: 'claude-opus-5-5', extra: 1 });
  assert.deepEqual(cleared, [path.join(features, 'visit-audit')]);
});

test('a job with no branch or worktree yet restarts, and the main checkout is never moved', async () => {
  const out = await restartJob(job({ branch: null, worktree: repo }), { model: 'claude-fable-5-2', start, today: TODAY });
  assert.equal(out.backupBranch, null);
  assert.equal(out.worktreeAside, null);
  assert.equal(await exists(path.join(repo, 'README.md')), true);
});

test('a failure after the branch rename reports what was moved and moves nothing back silently', async () => {
  const failing = { ...realGit, async moveWorktree(...a) { return realGit.moveWorktree(...a); } };
  const fsFail = { ...fs, rename: async () => { throw new Error('disk is full'); } };
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', git: failing, fs: fsFail, start, today: TODAY }), (e) => {
    assert.match(e.message, /stopped part way/);
    assert.match(e.message, /the job folder failed: disk is full/);
    assert.match(e.message, /the worktree folder/);
    assert.match(e.message, /the branch/);
    assert.match(e.message, /Nothing was deleted or moved back/);
    assert.deepEqual(e.moved.map((m) => m.what), ['the worktree folder', 'the branch']);
    return true;
  });
  // Left as they were moved: the branch is renamed, the worktree is aside, the job folder never moved.
  assert.notEqual(git(repo, 'branch', '--list', 'backup/feature/visit-audit-2026-11-10'), '');
  assert.equal(await exists(`${worktree}.2026-11-10`), true);
  assert.equal(await exists(path.join(features, 'visit-audit', 'decisions.md')), true);
  assert.equal(started, null);
});

test('a first step that fails says nothing was changed', async () => {
  const badGit = { ...realGit, moveWorktree: async () => { throw new Error('worktree is locked'); } };
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', git: badGit, start, today: TODAY }), (e) => /did not start/.test(e.message) && /Nothing was changed/.test(e.message) && e.moved.length === 0);
  assert.equal(await exists(worktree), true);
});
