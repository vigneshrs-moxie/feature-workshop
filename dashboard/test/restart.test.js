// Changing the Foreman model starts the job again (lib/restart.js). Real temporary git repository
// and folders; the new job is started by a stand-in for the New job handler. Nothing real is touched.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { planRestart, restartJob, realGit, remoteEnv } from '../lib/restart.js';

const TODAY = '2026-11-10';
const CARRIED_FOR_TEST = ['level', 'flow', 'skip', 'provided', 'reviewers', 'review_rounds', 'manual_test', 'fable_checks', 'models', 'all_fable', 'notes', 'wireframes', 'clarify', 'evidence'];
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
  // Auto, and when it was set, belong to the old job: never carried over.
  const next = JSON.parse(await fs.readFile(path.join(features, 'visit-audit', 'options.json'), 'utf8'));
  assert.equal('auto' in next, false);
  assert.equal('auto_since' in next, false);
});

test('F3: only the options the New job form can set are carried; Auto, its date, the session link, the stamps and unknown keys are not', async () => {
  const options = { ...job().options, from_session: { id: 'x' }, mystery: 1, wireframes: 'always', clarify: 'off', evidence: 'always', all_fable: false, reviewers: 'auto', review_rounds: 2, manual_test: true, fable_checks: [], skip: ['refine'], provided: {} };
  await restartJob(job({ options }), { model: 'claude-fable-5-2', start, today: TODAY });
  const sent = Object.keys(started.options).sort();
  assert.deepEqual(sent.filter((k) => !CARRIED_FOR_TEST.includes(k)), [], `carried a key that is not on the list: ${sent}`);
  for (const gone of ['auto', 'auto_since', 'from_session', 'schema_version', 'updated_at', 'stack', 'mystery']) assert.equal(gone in started.options, false, gone);
  for (const kept of ['level', 'models', 'notes', 'wireframes', 'clarify', 'evidence', 'reviewers', 'review_rounds', 'manual_test', 'fable_checks', 'skip']) assert.equal(kept in started.options, true, kept);
  const next = JSON.parse(await fs.readFile(path.join(features, 'visit-audit', 'options.json'), 'utf8'));
  for (const gone of ['auto', 'auto_since', 'from_session', 'stack', 'mystery']) assert.equal(gone in next, false, gone);
});

test('F3: a listed option the new job’s file lacks is carried from the archive', async () => {
  await fs.writeFile(path.join(features, 'visit-audit', 'options.json'), JSON.stringify({ ...job().options, evidence: 'always' }));
  const out = await restartJob(job({ options: { ...job().options, evidence: 'always' } }), { model: 'claude-fable-5-2', start, today: TODAY });
  const next = JSON.parse(await fs.readFile(path.join(features, 'visit-audit', 'options.json'), 'utf8'));
  assert.equal(next.evidence, 'always');
  assert.deepEqual(out.notes.filter((n) => /options/.test(n)), []);
});

test('F3 minor: a failed write of the carried options is reported to the person, not swallowed', async () => {
  const writeFails = { ...fs, writeFile: async (f, ...rest) => { if (String(f).endsWith(path.join('visit-audit', 'options.json'))) throw new Error('disk is full'); return fs.writeFile(f, ...rest); } };
  const out = await restartJob(job({ options: { ...job().options, evidence: 'always' } }), { model: 'claude-fable-5-2', fs: writeFails, start, today: TODAY });
  assert.equal(out.notes.some((n) => /options/.test(n) && /disk is full/.test(n)), true, JSON.stringify(out.notes));
});

test('F3 minor: an old options file that is missing is fine and says nothing', async () => {
  await fs.rm(path.join(features, 'visit-audit', 'options.json'));
  const out = await restartJob(job(), { model: 'claude-fable-5-2', start, today: TODAY });
  assert.deepEqual(out.notes.filter((n) => /options/.test(n)), []);
});

test('F3: a reply waiting to be sent is copied into the archive before it is forgotten', async () => {
  const entries = [{ featureDir: path.join(features, 'visit-audit'), slug: 'visit-audit', send: { text: 'Approve the plan', kind: 'approve', gateBrief: 2 } }];
  const forgot = [];
  const parked = { read: async () => entries, forget: async (d) => { forgot.push(d); } };
  const out = await restartJob(job(), { model: 'claude-fable-5-2', start, parked, today: TODAY });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(out.archive, 'parked-reply.json'), 'utf8')), entries);
  assert.deepEqual(forgot, [path.join(features, 'visit-audit')]);
  assert.equal(out.notes.some((n) => /waiting to be sent/.test(n) && /not sent/.test(n)), true, JSON.stringify(out.notes));
});

test('F3: a restart that fails keeps the parked reply (it is forgotten only once the new job has started)', async () => {
  const forgot = [];
  const parked = { read: async () => [{ send: { text: 'x' } }], forget: async (d) => { forgot.push(d); } };
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', start: async () => { throw new Error('nope'); }, parked, today: TODAY }));
  assert.deepEqual(forgot, []);
  assert.equal(await exists(path.join(features, 'visit-audit', 'parked-reply.json')), false);
});

test('F3 follow-on: a job with a stack plan is refused, and nothing moved', async () => {
  await fs.writeFile(path.join(features, 'visit-audit', 'stack.md'), 'sections');
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', start, today: TODAY }), refused(/stack/i));
  await assertUntouched();
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

// F2: a failure before the new job exists puts everything back, in reverse order.
async function assertOldJobUsable() {
  assert.equal(await exists(worktree), true, 'the worktree is back in place');
  assert.equal(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/visit-audit', 'the branch name is back');
  assert.equal(git(repo, 'branch', '--list', 'backup/*'), '');
  assert.equal(await exists(`${worktree}.2026-11-10`), false);
  assert.equal(await fs.readFile(path.join(features, 'visit-audit', 'decisions.md'), 'utf8'), 'decided', 'the job is listed where it was');
  assert.equal(await fs.readFile(path.join(features, 'visit-audit', 'briefs', '001-spec.md'), 'utf8'), 'the spec');
  assert.equal(await exists(path.join(features, '.restarted', 'visit-audit-2026-11-10')), false);
}
const putBack = (reasonPattern) => (e) => e.status === 409 && reasonPattern.test(e.message) && /Nothing was changed\./.test(e.message) && /put back/.test(e.message);

test('F2: a failure at the branch rename puts the worktree back and says nothing was changed', async () => {
  const bad = { ...realGit, renameBranch: async () => { throw new Error('branch is locked'); } };
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', git: bad, start, today: TODAY }), putBack(/the branch failed: branch is locked/));
  await assertOldJobUsable();
  assert.equal(started, null);
});

test('F2: a failure at the job folder move puts the branch name and the worktree back', async () => {
  const fsFail = { ...fs, rename: async () => { throw new Error('disk is full'); } };
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', fs: fsFail, start, today: TODAY }), putBack(/the job folder failed: disk is full/));
  await assertOldJobUsable();
  assert.equal(started, null);
});

test('F2: a failure at the session record puts the folder, the branch and the worktree back, and the record stays', async () => {
  let record = { sessionId: 'abc' };
  const session = { read: async () => record, clear: async () => { throw new Error('state file is locked'); }, write: async (_d, r) => { record = r; } };
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', start, session, today: TODAY }), putBack(/state file is locked/));
  await assertOldJobUsable();
  assert.deepEqual(record, { sessionId: 'abc' });
});

test('F2: a session record that was cleared is written back when a later step fails', async () => {
  let record = { sessionId: 'abc', model: 'claude-opus-5-5' };
  const session = { read: async () => record, clear: async () => { record = null; }, write: async (_d, r) => { record = r; } };
  const failing = async () => { throw new Error('the model service is down'); };
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', start: failing, session, today: TODAY }), putBack(/starting the new job failed: the model service is down/));
  await assertOldJobUsable();
  assert.deepEqual(record, { sessionId: 'abc', model: 'claude-opus-5-5' });
  assert.equal(await exists(path.join(features, 'visit-audit', 'session-record.json')), false, 'the copy made for the archive is gone');
});

test('F2: a failed new start whose half-written folder holds only what the start wrote is cleared, and everything is put back', async () => {
  const half = async () => {
    await fs.mkdir(path.join(features, 'visit-audit'), { recursive: true }); // the same path as the old job, as a ticket job has
    await fs.writeFile(path.join(features, 'visit-audit', 'options.json'), JSON.stringify({ title: 'Add visit audit columns', repo }));
    await fs.mkdir(path.join(features, 'other-new-job'), { recursive: true });
    await fs.writeFile(path.join(features, 'other-new-job', 'status.json'), '{}');
    await fs.writeFile(path.join(features, 'other-new-job', 'options.json'), JSON.stringify({ title: 'Add visit audit columns', repo }));
    throw new Error('the repository is not there');
  };
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', start: half, today: TODAY }), putBack(/starting the new job failed: the repository is not there/));
  await assertOldJobUsable();
  assert.equal(await exists(path.join(features, 'other-new-job')), false, 'the half-written folder is removed');
  assert.equal(await exists(path.join(features, 'visit-audit', 'options.json')), true, 'the old options are back (the old job’s own file)');
  assert.equal(JSON.parse(await fs.readFile(path.join(features, 'visit-audit', 'options.json'), 'utf8')).level, 2);
});

test('F2: a failed new start whose folder holds a file a person made leaves everything and says where it all is', async () => {
  const messy = async () => {
    await fs.mkdir(path.join(features, 'new-job'), { recursive: true });
    await fs.writeFile(path.join(features, 'new-job', 'options.json'), JSON.stringify({ title: 'Add visit audit columns', repo }));
    await fs.writeFile(path.join(features, 'new-job', 'notes.md'), 'my own notes');
    throw new Error('the repository is not there');
  };
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', start: messy, today: TODAY }), (e) => {
    assert.equal(e.status, 409);
    assert.match(e.message, /starting the new job failed: the repository is not there/);
    assert.match(e.message, /Nothing was deleted/);
    assert.match(e.message, /not sure/i);
    assert.match(e.message, new RegExp(path.join(features, 'new-job').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(e.message, /Add visit audit columns/);
    assert.match(e.message, /ORBIT-9/);
    assert.match(e.message, new RegExp(repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(e.message, new RegExp(path.join(features, '.restarted', 'visit-audit-2026-11-10').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(e.message, /Nothing was changed\./);
    return true;
  });
  assert.equal(await fs.readFile(path.join(features, 'new-job', 'notes.md'), 'utf8'), 'my own notes');
  assert.equal(await exists(path.join(features, '.restarted', 'visit-audit-2026-11-10', 'decisions.md')), true, 'the old work stays in the archive');
  assert.equal(await exists(`${worktree}.2026-11-10`), true);
});

test('F2: when an undo step itself fails, undoing stops and the message says exactly what is where', async () => {
  const stuck = { ...realGit, renameBranch: async (r, from, to) => { if (from.startsWith('backup/')) throw new Error('branch is locked'); return realGit.renameBranch(r, from, to); } };
  const fsFail = { ...fs, rename: async () => { throw new Error('disk is full'); } };
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', git: stuck, fs: fsFail, start, today: TODAY }), (e) => {
    assert.equal(e.status, 409);
    assert.match(e.message, /the job folder failed: disk is full/);
    assert.match(e.message, /tried to put back the branch and could not: branch is locked/);
    assert.match(e.message, /the branch \(feature\/visit-audit to backup\/feature\/visit-audit-2026-11-10\)/);
    assert.match(e.message, /the worktree folder/);
    assert.match(e.message, /Nothing was deleted/);
    assert.doesNotMatch(e.message, /Nothing was changed\./);
    assert.deepEqual(e.moved.map((m) => m.what), ['the worktree folder', 'the branch']);
    return true;
  });
  // Undoing stopped at the branch: it is still under the backup name and the worktree is still aside.
  assert.notEqual(git(repo, 'branch', '--list', 'backup/feature/visit-audit-2026-11-10'), '');
  assert.equal(await exists(`${worktree}.2026-11-10`), true);
  assert.equal(await exists(worktree), false);
  assert.equal(await exists(path.join(features, 'visit-audit', 'decisions.md')), true);
});

// ---------- Fix round 1: refusals before anything moves ----------

// Everything a refusal must leave as it was: branch names, folders, the job folder, no new job.
async function assertUntouched(extra = {}) {
  assert.notEqual(git(repo, 'branch', '--list', extra.branch ?? 'feature/visit-audit'), '', 'the branch keeps its name');
  assert.equal(git(repo, 'branch', '--list', 'backup/*'), '', 'no backup branch was made');
  assert.equal(await exists(path.join(features, 'visit-audit', 'decisions.md')), true, 'the job folder is where it was');
  assert.equal(await exists(path.join(features, '.restarted')), false, 'no archive was made');
  assert.equal(await exists(extra.worktree ?? worktree), true, 'the worktree is where it was');
  assert.equal(started, null, 'no new job was started');
}
const refused = (reasonPattern) => (e) => e.status === 409 && /did not start/.test(e.message) && /Nothing was changed\./.test(e.message) && reasonPattern.test(e.message) && e.moved.length === 0;

test('F1: a branch also checked out in the main checkout refuses, and nothing moved', async () => {
  // The job's worktree has gone, and its branch is checked out in the main checkout.
  git(repo, 'worktree', 'remove', '--force', worktree);
  git(repo, 'checkout', '-q', 'feature/visit-audit');
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', start, today: TODAY }), refused(/main checkout/));
  assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/visit-audit');
  assert.equal(git(repo, 'branch', '--list', 'backup/*'), '');
  assert.equal(await exists(path.join(features, 'visit-audit', 'decisions.md')), true);
  assert.equal(started, null);
});

test('F1: a branch checked out in some other folder than the job’s own worktree refuses', async () => {
  // The branch is in the job's worktree AND the main checkout cannot have it too, so use a second worktree on a detached name:
  // move the job's branch to another folder by pointing the job at a different worktree path.
  const other = path.join(root, 'repo-worktrees', 'other');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/other', other);
  await assert.rejects(restartJob(job({ branch: 'feature/other' }), { model: 'claude-fable-5-2', start, today: TODAY }), refused(/checked out in/));
  assert.notEqual(git(repo, 'branch', '--list', 'feature/other'), '');
  assert.equal(await exists(other), true);
  assert.equal(await exists(worktree), true);
  assert.equal(started, null);
});

test('F1: the base branch is never renamed', async () => {
  // The job is recorded as working on main: in the main checkout, with a worktree of its own named for it.
  await assert.rejects(restartJob(job({ branch: 'main', worktree: null }), { model: 'claude-fable-5-2', start, today: TODAY }), refused(/main checkout|base branch/));
  assert.notEqual(git(repo, 'branch', '--list', 'main'), '');
  assert.equal(git(repo, 'branch', '--list', 'backup/*'), '');
  assert.equal(started, null);
});

test('F1: the base branch named by the job is refused even when it is not main', async () => {
  git(repo, 'branch', 'develop');
  await assert.rejects(restartJob(job({ branch: 'develop', baseBranch: 'develop', worktree: null }), { model: 'claude-fable-5-2', start, today: TODAY }), refused(/base branch/));
  assert.notEqual(git(repo, 'branch', '--list', 'develop'), '');
  assert.equal(started, null);
});

test('F1: a worktree that is the repository itself, with a branch set, refuses (compared by real path)', async () => {
  const link = path.join(root, 'repo-link');
  await fs.symlink(repo, link);
  await assert.rejects(restartJob(job({ worktree: link }), { model: 'claude-fable-5-2', start, today: TODAY }), refused(/main checkout/));
  assert.notEqual(git(repo, 'branch', '--list', 'feature/visit-audit'), '');
  assert.equal(git(repo, 'branch', '--list', 'backup/*'), '');
  assert.equal(await exists(path.join(features, 'visit-audit', 'decisions.md')), true);
  assert.equal(started, null);
});

test('F6: a branch list that cannot be read stops the restart before anything moves', async () => {
  const broken = { ...realGit, branches: async () => { throw new Error('fatal: not a git repository'); } };
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', git: broken, start, today: TODAY }), refused(/list of branches/));
  await assertUntouched();
});

// ---------- F5: a branch already on the remote ----------

async function withRemote(branchOnRemote) {
  const bare = path.join(root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  git(repo, 'remote', 'add', 'origin', bare);
  if (branchOnRemote) git(repo, 'push', '-q', 'origin', 'feature/visit-audit');
  else git(repo, 'push', '-q', 'origin', 'main');
  return bare;
}

test('F5: a branch already on the remote refuses, and nothing moved', async () => {
  await withRemote(true);
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', start, today: TODAY }), refused(/already on the remote[\s\S]*finish the job on this model[\s\S]*delete or rename the branch on the remote/i));
  await assertUntouched();
});

test('F5: a branch that is not on the remote goes ahead', async () => {
  await withRemote(false);
  const out = await restartJob(job(), { model: 'claude-fable-5-2', start, today: TODAY });
  assert.equal(out.notes.some((n) => /could not be checked/.test(n)), false);
  assert.equal(out.backupBranch, 'backup/feature/visit-audit-2026-11-10');
});

test('F5: an unreachable remote goes ahead, and the result says it could not be checked', async () => {
  git(repo, 'remote', 'add', 'origin', path.join(root, 'no-such-remote.git'));
  const out = await restartJob(job(), { model: 'claude-fable-5-2', start, today: TODAY });
  assert.equal(out.backupBranch, 'backup/feature/visit-audit-2026-11-10');
  assert.equal(out.notes.some((n) => /could not be checked/.test(n) && /pushed/.test(n) && /no remote could be reached/.test(n)), true, JSON.stringify(out.notes));
});

test('G6: no remote at all goes ahead with no note about a remote; an unreachable one still says so', async () => {
  const out = await restartJob(job(), { model: 'claude-fable-5-2', start, today: TODAY });
  assert.deepEqual(out.notes.filter((n) => /remote|pushed/.test(n)), []);
});

test('F7: Claude Code open in a terminal on the job refuses, and nothing moved', async () => {
  await assert.rejects(restartJob(job({ terminalOpen: true }), { model: 'claude-fable-5-2', start, today: TODAY }), (e) => e.status === 409 && /in a terminal/.test(e.message) && /close/i.test(e.message) && /Nothing was changed\./.test(e.message));
  await assertUntouched();
});

test('a first step that fails says nothing was changed', async () => {
  const badGit = { ...realGit, moveWorktree: async () => { throw new Error('worktree is locked'); } };
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', git: badGit, start, today: TODAY }), (e) => /did not start/.test(e.message) && /Nothing was changed/.test(e.message) && e.moved.length === 0);
  assert.equal(await exists(worktree), true);
});

// ---------- Fix round 2 ----------

test('G2: a failed start removes only its own half-made folder; another new job’s folder stays and is not mentioned', async () => {
  const racing = async () => {
    await fs.mkdir(path.join(features, 'mine'), { recursive: true });
    await fs.writeFile(path.join(features, 'mine', 'options.json'), JSON.stringify({ title: 'Add visit audit columns', repo }));
    await fs.mkdir(path.join(features, 'someone-elses'), { recursive: true });
    await fs.writeFile(path.join(features, 'someone-elses', 'options.json'), JSON.stringify({ title: 'Another job entirely', repo }));
    throw new Error('the repository is not there');
  };
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', start: racing, today: TODAY }), putBack(/the repository is not there/));
  await assertOldJobUsable();
  assert.equal(await exists(path.join(features, 'mine')), false, 'its own half-made folder is removed');
  assert.equal(await exists(path.join(features, 'someone-elses', 'options.json')), true, 'another job’s folder is left alone');
});

test('G3: one part of a stack is refused, and nothing moved', async () => {
  await fs.writeFile(path.join(features, 'visit-audit', 'status.json'), JSON.stringify({ slug: 'visit-audit', stack: 'big-feature', section: 'api' }));
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', start, today: TODAY }), refused(/one part of a stack, and Starbase can't restart one part on its own/));
  await assertUntouched();
});

test('G4: a failed session step leaves no copy of the record behind', async () => {
  const session = { read: async () => ({ sessionId: 'abc' }), clear: async () => { throw new Error('state file is locked'); }, write: async () => {} };
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', start, session, today: TODAY }), putBack(/state file is locked/));
  await assertOldJobUsable();
  assert.equal(await exists(path.join(features, 'visit-audit', 'session-record.json')), false, 'no stray copy in the job folder');
});

test('G5: the old job’s state is cleared before the new start, and put back when the start fails', async () => {
  const log = [];
  const clearOldState = async () => { log.push('cleared'); return async () => { log.push('restored'); }; };
  const watching = async (body) => { log.push('start'); return start(body); };
  await restartJob(job(), { model: 'claude-fable-5-2', start: watching, clearOldState, today: TODAY });
  assert.deepEqual(log, ['cleared', 'start'], 'cleared first, and kept cleared on success');
  log.length = 0;
  const failing = async () => { log.push('start'); throw new Error('nope'); };
  await assert.rejects(restartJob(job(), { model: 'claude-fable-5-2', start: failing, clearOldState, today: TODAY }), putBack(/nope/));
  assert.deepEqual(log, ['cleared', 'start', 'restored']);
});

test('G5: a step after the new job exists that throws goes into the notes; the restart still succeeds', async () => {
  const parked = { read: async () => [{ send: { text: 'x' } }], forget: async () => { throw new Error('the list is locked'); } };
  const out = await restartJob(job(), { model: 'claude-fable-5-2', start, parked, today: TODAY });
  assert.equal(out.slug, 'visit-audit');
  assert.equal(out.notes.some((n) => /the list is locked/.test(n)), true, JSON.stringify(out.notes));
});

test('G6: a job last run in a terminal (no window open) is told to take it over in Starbase first', async () => {
  await assert.rejects(restartJob(job({ lastRunInTerminal: true }), { model: 'claude-fable-5-2', start, today: TODAY }), (e) => e.status === 409 && /last run in a terminal/.test(e.message) && /take it over in Starbase first, then change the model/i.test(e.message) && !/close it/i.test(e.message) && /Nothing was changed\./.test(e.message));
  await assertUntouched();
});

test('G7: the remote check never waits for an ssh password, unless the environment already sets the command', () => {
  assert.equal(remoteEnv({ PATH: '/bin' }).GIT_SSH_COMMAND, 'ssh -o BatchMode=yes');
  assert.equal(remoteEnv({ PATH: '/bin' }).GIT_TERMINAL_PROMPT, '0');
  assert.equal(remoteEnv({ GIT_SSH_COMMAND: 'ssh -i key' }).GIT_SSH_COMMAND, 'ssh -i key');
});
