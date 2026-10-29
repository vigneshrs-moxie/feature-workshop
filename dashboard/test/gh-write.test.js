// lib/gh-write.js (packet Q): the only code that writes to GitHub. Each write runs one exact
// command, only with your yes, and writes one audit line. A push has no flags at all (nothing is
// ever forced), never goes to an org remote or an org address, never to main, master or staging,
// and waits while another process holds the job's lock. gh here is a fake that records its calls;
// pushes go to a local bare repository in a temporary folder. Nothing reaches GitHub.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WriteRefused, createGhWrite, isYes, runSteps, yes } from '../lib/gh-write.js';

const roots = [];
after(async () => { for (const r of roots) await fs.rm(r, { recursive: true, force: true }); });

const sh = (dir, args) => new Promise((resolve) => {
  execFile('git', ['-C', dir, ...args], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout), err: err ? String(stderr || err.message).trim() : null }));
});
async function git(dir, ...args) {
  const r = await sh(dir, args);
  if (!r.ok) throw new Error(`git ${args.join(' ')}: ${r.err}`);
  return r.out.trim();
}

// A bare "fork" in a temporary folder and a clone of it on feature/x, one commit ahead.
async function forkAndClone() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-gh-write-')));
  roots.push(root);
  const bare = path.join(root, 'fork.git');
  const clone = path.join(root, 'clone');
  await fs.mkdir(bare);
  await git(bare, 'init', '--bare', '-q', '-b', 'main');
  await fs.mkdir(clone);
  await git(clone, 'init', '-q', '-b', 'main');
  await git(clone, 'config', 'user.email', 'test@example.com');
  await git(clone, 'config', 'user.name', 'Test');
  await git(clone, 'remote', 'add', 'origin', bare);
  await fs.writeFile(path.join(clone, 'a.txt'), 'one\n');
  await git(clone, 'add', '.');
  await git(clone, 'commit', '-q', '-m', 'one');
  await git(clone, 'push', '-q', 'origin', 'main');
  await git(clone, 'checkout', '-q', '-b', 'feature/x');
  await fs.writeFile(path.join(clone, 'a.txt'), 'two\n');
  await git(clone, 'commit', '-q', '-am', 'Rename to feedbackId (review: c7001)');
  return { root, bare, clone };
}

// A fake gh: records every call, answers from `answers` (a function of the args).
function fakeGh(answers = () => ({ ok: true, out: '' })) {
  const calls = [];
  const gh = async (args) => { calls.push(args); return answers(args); };
  return { gh, calls };
}

function writer({ gh = fakeGh().gh, gitCalls = [], lock = null, localOnly = true } = {}) {
  const audit = [];
  const w = createGhWrite({
    gh,
    git: async (dir, args) => { gitCalls.push(args); return sh(dir, args); },
    audit: async (line) => { audit.push(line); },
    lockFor: () => lock,
    localOnly,
  });
  return { w, audit, gitCalls };
}

const Y = () => yes({ what: 'Send back round 1 on PR #2' });
const base = { featureDir: '/jobs/sample-job', slug: 'sample-job' };
const repo = 'acme/sample-repo';

test('a yes is a token only yes() makes: a look-alike is no yes', () => {
  const y = Y();
  assert.equal(isYes(y), true);
  assert.equal(isYes({ what: 'Send back round 1 on PR #2', by: 'you' }), false);
  assert.equal(isYes(JSON.parse(JSON.stringify(y))), false, 'a yes doesn’t survive being sent as JSON');
  assert.ok(Object.isFrozen(y));
  assert.throws(() => yes({}), /says what it is for/);
});

test('without your yes nothing runs: no gh call, no git call, and the refusal is in the audit', async () => {
  const { gh, calls } = fakeGh();
  const gitCalls = [];
  const { w, audit } = writer({ gh, gitCalls });
  const tries = [
    () => w.push({ ...base, dir: '/tmp/x', remote: 'origin', branch: 'feature/x' }),
    () => w.openPr({ ...base, repo, base: 'feature/x', head: 'you:feature/x', title: 't', body: 'b' }),
    () => w.mergePr({ ...base, repo, number: 7 }),
    () => w.reply({ ...base, repo, number: 7, comment: { type: 'line', id: 1 }, body: 'Fixed.' }),
    () => w.resolveThread({ ...base, repo, number: 7, commentId: 1 }),
    () => w.requestReview({ ...base, repo, number: 7, login: 'raj-moxie' }),
    () => w.reopenPr({ ...base, repo, number: 7 }),
    () => w.comment({ ...base, repo, number: 7, body: 'Hi' }),
  ];
  for (const t of tries) {
    await assert.rejects(t(), (err) => err instanceof WriteRefused && err.code === 'no-yes' && /without your yes/.test(err.message));
  }
  const fake = { what: 'Send back' };
  await assert.rejects(w.mergePr({ ...base, yes: fake, repo, number: 7 }), (err) => err.code === 'no-yes');
  assert.deepEqual(calls, [], 'gh never ran');
  assert.deepEqual(gitCalls, [], 'git never ran');
  assert.ok(audit.length >= tries.length);
  for (const line of audit) {
    assert.equal(line.action, 'gh-write');
    assert.equal(line.ok, false);
    assert.equal(line.refused, 'no-yes');
  }
});

test('push: git push <remote> <branch> from the worktree, no flags, to a local bare repository', async () => {
  const { bare, clone } = await forkAndClone();
  const gitCalls = [];
  const { w, audit } = writer({ gitCalls });
  const res = await w.push({ ...base, yes: Y(), dir: clone, remote: 'origin', branch: 'feature/x' });
  assert.equal(res.ok, true, res.err);
  assert.equal(res.command, 'git push origin feature/x');
  const pushes = gitCalls.filter((a) => a[0] === 'push');
  assert.deepEqual(pushes, [['push', 'origin', 'feature/x']], 'exactly one push, with no flags');
  assert.equal(await git(bare, 'rev-parse', 'feature/x'), await git(clone, 'rev-parse', 'HEAD'), 'the fork has the commit');
  assert.deepEqual(JSON.parse(JSON.stringify(audit)), [{ action: 'gh-write', what: 'push', featureDir: base.featureDir, slug: base.slug, yes: 'Send back round 1 on PR #2', command: 'git push origin feature/x', ok: true }]);
});

test('push never forces: a branch spelled like a flag, a refspec or a force (+) is refused before git runs', async () => {
  const { clone } = await forkAndClone();
  const gitCalls = [];
  const { w } = writer({ gitCalls });
  for (const branch of ['--force', '-f', '+feature/x', 'feature/x:main', 'HEAD:main', 'a..b', 'x@{1}', 'feature x', '']) {
    await assert.rejects(w.push({ ...base, yes: Y(), dir: clone, remote: 'origin', branch }), (err) => err.code === 'bad-argument', branch);
  }
  for (const remote of ['--force', '-f', '+origin', 'origin main', '']) {
    await assert.rejects(w.push({ ...base, yes: Y(), dir: clone, remote, branch: 'feature/x' }), (err) => err.code === 'bad-argument', remote);
  }
  assert.deepEqual(gitCalls, [], 'git never ran');
  // There is no way to ask for a force: an extra field is ignored, and the push has no flags.
  const res = await w.push({ ...base, yes: Y(), dir: clone, remote: 'origin', branch: 'feature/x', force: true, args: ['--force'] });
  assert.equal(res.ok, true);
  assert.deepEqual(gitCalls.filter((a) => a[0] === 'push'), [['push', 'origin', 'feature/x']]);
});

test('push is refused to an org remote, an org address, a protected branch, anything but a local folder here, and while the lock is held', async () => {
  const { clone } = await forkAndClone();
  await git(clone, 'remote', 'add', 'moxie', 'https://github.com/moxie-pest/sample-repo.git');
  await git(clone, 'remote', 'add', 'sneaky', 'git@github.com:moxie-pest/sample-repo.git');
  await git(clone, 'remote', 'add', 'elsewhere', 'https://github.com/you/sample-repo.git');
  const gitCalls = [];
  const { w, audit } = writer({ gitCalls });
  await assert.rejects(w.push({ ...base, yes: Y(), dir: clone, remote: 'moxie', branch: 'feature/x' }), (err) => err.code === 'org-push');
  await assert.rejects(w.push({ ...base, yes: Y(), dir: clone, remote: 'sneaky', branch: 'feature/x' }), (err) => err.code === 'org-push' && /org repository/.test(err.message));
  for (const branch of ['main', 'master', 'staging']) {
    await assert.rejects(w.push({ ...base, yes: Y(), dir: clone, remote: 'origin', branch }), (err) => err.code === 'protected-branch', branch);
  }
  await assert.rejects(w.push({ ...base, yes: Y(), dir: clone, remote: 'elsewhere', branch: 'feature/x' }), (err) => err.code === 'local-only');
  await assert.rejects(w.push({ ...base, yes: Y(), dir: 'relative/dir', remote: 'origin', branch: 'feature/x' }), (err) => err.code === 'bad-argument');
  await assert.rejects(w.push({ ...base, yes: Y(), dir: clone, remote: 'nowhere', branch: 'feature/x' }), (err) => err.code === 'bad-argument');
  assert.equal(gitCalls.filter((a) => a[0] === 'push').length, 0, 'no push ran');
  assert.ok(audit.every((l) => l.ok === false && l.refused));

  const locked = writer({ lock: { pid: 4242, branch: 'feature/x', owner: 'terminal' } });
  await assert.rejects(locked.w.push({ ...base, yes: Y(), dir: clone, remote: 'origin', branch: 'feature/x' }), (err) => err.code === 'job-locked' && /pid 4242/.test(err.message));
  await assert.rejects(locked.w.mergePr({ ...base, yes: Y(), repo, number: 3 }), (err) => err.code === 'job-locked');
  assert.deepEqual(locked.gitCalls, []);
});

test('the gh writes run these exact commands', async () => {
  const { gh, calls } = fakeGh((args) => {
    if (args[0] === 'pr' && args[1] === 'create') return { ok: true, out: 'https://github.com/acme/sample-repo/pull/777\n' };
    if (args[0] === 'api' && args[3]?.endsWith('/replies')) return { ok: true, out: '{"id":9001}' };
    if (args[0] === 'api' && args[3]?.includes('/issues/')) return { ok: true, out: '{"id":9002}' };
    return { ok: true, out: '' };
  });
  const { w, audit } = writer({ gh });
  const opened = await w.openPr({ ...base, yes: Y(), repo, base: 'feature/x', head: 'you:feature/x', title: 'Follow-up for Raj’s review on PR #2', body: 'Follow-up.\n\n## What changed' });
  assert.equal(opened.number, 777);
  assert.equal(opened.url, 'https://github.com/acme/sample-repo/pull/777');
  await w.mergePr({ ...base, yes: Y(), repo, number: 777 });
  await w.mergePr({ ...base, yes: Y(), repo, number: 778, method: 'squash' });
  const line = await w.reply({ ...base, yes: Y(), repo, number: 152, comment: { type: 'line', id: 7001 }, body: 'Fixed in a1b2c3d: renamed to feedbackId.' });
  assert.equal(line.posted, 9001);
  const review = await w.reply({ ...base, yes: Y(), repo, number: 152, comment: { type: 'review', id: 5001, author: 'raj-moxie', quote: 'A few things before this goes in.\nSecond line.' }, body: 'Thanks: all three are done.' });
  assert.equal(review.posted, 9002);
  await w.requestReview({ ...base, yes: Y(), repo, number: 152, login: 'raj-moxie' });
  await w.reopenPr({ ...base, yes: Y(), repo, number: 152 });
  await w.comment({ ...base, yes: Y(), repo, number: 152, body: 'Hi Raj, could you merge it?' });
  assert.deepEqual(calls, [
    ['pr', 'create', '--repo', repo, '--base', 'feature/x', '--head', 'you:feature/x', '--title', 'Follow-up for Raj’s review on PR #2', '--body', 'Follow-up.\n\n## What changed'],
    ['pr', 'merge', '777', '--repo', repo, '--merge'],
    ['pr', 'merge', '778', '--repo', repo, '--squash'],
    ['api', '--method', 'POST', `repos/${repo}/pulls/152/comments/7001/replies`, '-f', 'body=Fixed in a1b2c3d: renamed to feedbackId.'],
    ['api', '--method', 'POST', `repos/${repo}/issues/152/comments`, '-f', 'body=@raj-moxie \n> A few things before this goes in.\n\nThanks: all three are done.'],
    ['pr', 'edit', '152', '--repo', repo, '--add-reviewer', 'raj-moxie'],
    ['pr', 'reopen', '152', '--repo', repo],
    ['pr', 'comment', '152', '--repo', repo, '--body', 'Hi Raj, could you merge it?'],
  ]);
  assert.deepEqual(audit.map((l) => [l.action, l.what, l.ok, l.yes]), [
    ['gh-write', 'open-pr', true, 'Send back round 1 on PR #2'], ['gh-write', 'merge', true, 'Send back round 1 on PR #2'], ['gh-write', 'merge', true, 'Send back round 1 on PR #2'],
    ['gh-write', 'reply', true, 'Send back round 1 on PR #2'], ['gh-write', 'reply', true, 'Send back round 1 on PR #2'], ['gh-write', 'request-review', true, 'Send back round 1 on PR #2'],
    ['gh-write', 'reopen', true, 'Send back round 1 on PR #2'], ['gh-write', 'comment', true, 'Send back round 1 on PR #2'],
  ]);
  assert.match(audit[0].command, /^gh pr create --repo acme\/sample-repo --base feature\/x --head you:feature\/x --title "Follow-up for Raj’s review on PR #2" --body /);
  // Never --admin, never --auto, never a rebase merge, never a force.
  for (const args of calls) for (const bad of ['--admin', '--auto', '--rebase', '--force', '-f=force']) assert.ok(!args.includes(bad), `${bad} in gh ${args.join(' ')}`);
});

test('bad arguments are refused before gh runs', async () => {
  const { gh, calls } = fakeGh();
  const { w } = writer({ gh });
  const y = Y();
  await assert.rejects(w.mergePr({ ...base, yes: y, repo, number: 7, method: 'rebase' }), (e) => e.code === 'bad-argument');
  await assert.rejects(w.mergePr({ ...base, yes: y, repo: 'acme/sample repo', number: 7 }), (e) => e.code === 'bad-argument');
  await assert.rejects(w.mergePr({ ...base, yes: y, repo, number: '7' }), (e) => e.code === 'bad-argument');
  await assert.rejects(w.reply({ ...base, yes: y, repo, number: 7, comment: { type: 'line', id: 1 }, body: '   ' }), (e) => e.code === 'bad-argument' && /empty/.test(e.message));
  await assert.rejects(w.reply({ ...base, yes: y, repo, number: 7, comment: { type: 'line', id: 'x' }, body: 'Fixed.' }), (e) => e.code === 'bad-argument');
  await assert.rejects(w.requestReview({ ...base, yes: y, repo, number: 7, login: '--admin' }), (e) => e.code === 'bad-argument');
  await assert.rejects(w.openPr({ ...base, yes: y, repo, base: 'staging', head: 'you:-f', title: 't', body: 'b' }), (e) => e.code === 'bad-argument');
  assert.deepEqual(calls, []);
});

test('resolveThread finds the comment’s thread and resolves it; already resolved is nothing to do', async () => {
  const threads = (resolved) => JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [
    { id: 'PRRT_other', isResolved: false, comments: { nodes: [{ databaseId: 1 }] } },
    { id: 'PRRT_kwDO7001', isResolved: resolved, comments: { nodes: [{ databaseId: 7001 }, { databaseId: 7010 }] } },
  ] } } } } });
  let resolved = false;
  const { gh, calls } = fakeGh((args) => (args.some((a) => a.startsWith('query=query')) ? { ok: true, out: threads(resolved) } : { ok: true, out: '{}' }));
  const { w } = writer({ gh });
  const res = await w.resolveThread({ ...base, yes: Y(), repo, number: 152, commentId: 7001 });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].slice(0, 2), ['api', 'graphql']);
  assert.ok(calls[0].includes('owner=acme') && calls[0].includes('name=sample-repo') && calls[0].includes('number=152'));
  assert.deepEqual(calls[1], ['api', 'graphql', '-f', 'query=mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}', '-f', 'id=PRRT_kwDO7001']);
  resolved = true;
  const again = await w.resolveThread({ ...base, yes: Y(), repo, number: 152, commentId: 7001 });
  assert.equal(again.ok, true);
  assert.equal(again.already, true);
  assert.equal(calls.length, 3, 'only looked');
  const missing = await w.resolveThread({ ...base, yes: Y(), repo, number: 152, commentId: 9999 });
  assert.equal(missing.ok, false);
  assert.match(missing.err, /thread wasn’t found/);
});

test('a gh failure comes back in words with GitHub’s code, scrubbed, and is in the audit', async () => {
  const { gh } = fakeGh(() => ({ ok: false, out: '', err: 'HTTP 502: Bad Gateway (https://api.github.com/repos/acme/sample-repo/pulls/152/comments/7002/replies) token ghp_abcdefghijklmnopqrstuvwxyz0123456789' }));
  const { w, audit } = writer({ gh });
  const res = await w.reply({ ...base, yes: Y(), repo, number: 152, comment: { type: 'line', id: 7002 }, body: 'It stays a let.' });
  assert.equal(res.ok, false);
  assert.equal(res.code, '502');
  assert.match(res.err, /^HTTP 502: Bad Gateway/);
  assert.ok(!res.err.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), 'the token is hidden');
  assert.equal(audit.at(-1).ok, false);
  assert.equal(audit.at(-1).code, '502');
});

test('runSteps: in order; the first failure stops the rest and names its line; Try again runs from there; what is done never runs again', async () => {
  const ran = [];
  let failReplies = true;
  const steps = [
    { id: 'push', number: 1, words: 'Push 2 commits to your fork', run: async () => { ran.push('push'); return { ok: true }; } },
    { id: 'replies', number: 2, words: 'Reply on GitHub to each of Raj’s 3 comments', run: async () => { ran.push('replies'); return failReplies ? { ok: false, err: 'HTTP 502: Bad Gateway', code: '502', failWords: 'reply 2 of 3 didn’t post' } : { ok: true }; } },
    { id: 'resolve', number: 3, words: 'Mark the 2 fixed comments resolved', run: async () => { ran.push('resolve'); return { ok: true }; } },
    { id: 'request', number: 4, words: 'Ask Raj to review PR #2 again', run: async () => { ran.push('request'); return { ok: true }; } },
  ];
  const seen = [];
  const res = await runSteps(steps, { onStep: async (s) => seen.push(`${s.id}:${s.state}`) });
  assert.equal(res.ok, false);
  assert.equal(res.stoppedAt, 1);
  assert.deepEqual(ran, ['push', 'replies']);
  assert.deepEqual(steps.map((s) => s.state), ['done', 'stopped', 'not-run', 'not-run']);
  assert.equal(steps[1].failWords, 'reply 2 of 3 didn’t post');
  assert.equal(steps[1].code, '502');
  assert.deepEqual(seen, ['push:working', 'push:done', 'replies:working', 'replies:stopped']);

  // Try again from here: the failed step and the ones after it.
  failReplies = false;
  for (const s of steps) if (s.state !== 'done') s.state = 'will';
  const again = await runSteps(steps);
  assert.equal(again.ok, true);
  assert.deepEqual(ran, ['push', 'replies', 'replies', 'resolve', 'request'], 'the push didn’t run twice');
  assert.deepEqual(steps.map((s) => s.state), ['done', 'done', 'done', 'done']);
});

test('runSteps: a thrown error stops like a failure; Stop after this step; a step that waits leaves the rest for after PR #1', async () => {
  const boom = [{ id: 'a', run: async () => { throw new WriteRefused('Nothing is written to GitHub without your yes.', { code: 'no-yes' }); } }, { id: 'b', run: async () => ({ ok: true }) }];
  const r1 = await runSteps(boom);
  assert.equal(r1.stoppedAt, 0);
  assert.equal(boom[0].code, 'no-yes');
  assert.equal(boom[1].state, 'not-run');

  let stop = false;
  const three = ['a', 'b', 'c'].map((id) => ({ id, run: async () => { if (id === 'a') stop = true; return { ok: true }; } }));
  const r2 = await runSteps(three, { stopAfter: () => stop });
  assert.equal(r2.stoppedByYou, true);
  assert.deepEqual(three.map((s) => s.state), ['done', 'not-run', 'not-run']);

  const wait = [{ id: 'push', run: async () => ({ ok: true }) }, { id: 'follow-up', run: async () => ({ ok: true, waiting: true }) }, { id: 'replies', run: async () => ({ ok: true }) }];
  const r3 = await runSteps(wait);
  assert.equal(r3.waiting, true);
  assert.deepEqual(wait.map((s) => s.state), ['done', 'done', 'after-pr1']);
});
