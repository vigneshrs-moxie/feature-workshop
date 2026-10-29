// Stacks through the real dashboard in demo mode (packet K, plan §6.5): a stack of three sections
// on a test git repo made in a temp folder runs with cap 2, shows one section queued with its
// reason, merges in order, undoes a merge whose checks fail, refuses to push without a go, and its
// decision file has a heading per section. The same stack with "Merge on its own" merges by itself
// and still waits for the push.
//
// The pretend Foreman (WORKSHOP_DEMO=1) makes no model calls; with "ask for everything" each of its
// replies waits on a permission card, so the test plays each section's Foreman itself: it commits
// the section's work in its worktree and writes its status.json "review done". The repository's
// remote is a local bare repo: the test checks nothing ever reaches it.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startDashboard } from './helpers/dashboard.js';

let root, repo, remote, featuresDir, stateDir, dashboard, base, token;
const output = [];

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const PROFILE = `---
name: Stack test repo
worktree: "../wt-{slug}"
sectionWorktree: "../wt-{slug}--{section}"
sectionBranch: "{kind}/{slug}--{section}"
checks:
  - node check.js
tryIt:
  ports: 24800-24899
---
A test repository for stacks.
`;

// The check fails while any section has left a file named FAIL.
const CHECK = `const fs = require('node:fs');
for (const d of ['a', 'b', 'c']) if (fs.existsSync(d + '/FAIL')) { console.error('the check failed: ' + d + '/FAIL is here'); process.exit(1); }
console.log('all good');
`;

const PLAN = `# Big job

## Section: a
The first part.
Owns: a/**

## Section: b
The second part.
Owns: b/**

## Section: c
The third part.
Owns: c/**

Order: a, b, c
`;

async function parentJob(slug, sessionId) {
  const dir = path.join(featuresDir, slug);
  await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({
    schema_version: 1, slug, title: `Stack ${slug}`, kind: 'feature', route: 'large', stage: 'plan', stage_state: 'waiting_for_you',
    repo: { path: repo, base_branch: 'main' }, session_id: sessionId, updated_at: '2026-10-28T10:00:00Z',
  }, null, 2));
  await fs.writeFile(path.join(dir, 'stack.md'), PLAN);
  return dir;
}

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-stack-server-')));
  featuresDir = path.join(root, 'feature-work');
  repo = path.join(root, 'repo');
  remote = path.join(root, 'fork.git');
  stateDir = path.join(root, 'state');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), home: path.join(root, 'home') };
  for (const d of [featuresDir, repo, stateDir, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });

  sh(root, 'init', '-q', '--bare', remote);
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, 'config', 'user.email', 'test@example.com');
  sh(repo, 'config', 'user.name', 'Test');
  sh(repo, 'config', 'commit.gpgsign', 'false');
  sh(repo, 'remote', 'add', 'origin', remote);
  await fs.writeFile(path.join(repo, 'ground-control.md'), PROFILE);
  await fs.writeFile(path.join(repo, 'check.js'), CHECK);
  for (const d of ['a', 'b', 'c']) { await fs.mkdir(path.join(repo, d)); await fs.writeFile(path.join(repo, d, '.keep'), ''); }
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-q', '-m', 'start');

  const one = await parentJob('big-job', 'sess-big');
  const two = await parentJob('auto-job', 'sess-auto');
  // The coordinators' sessions (each parent's Foreman), so the runner can resume them.
  await fs.writeFile(path.join(stateDir, 'sessions.json'), JSON.stringify({
    [one]: { sessionId: 'sess-big', cwd: repo, model: 'claude-opus-5-5' },
    [two]: { sessionId: 'sess-auto', cwd: repo, model: 'claude-opus-5-5' },
  }));
  // Every step asks, so each pretend reply waits on its card and changes nothing after that.
  await fs.writeFile(path.join(stateDir, 'settings.json'), JSON.stringify({ policy: 'ask-all' }));

  dashboard = await startDashboard({
    env: {
      HOME: dirs.home, WORKSHOP_FEATURES_DIR: featuresDir, WORKSHOP_PROJECTS_DIR: dirs.projects, WORKSHOP_AGENTS_DIR: dirs.agents,
      WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STACK_TICK_MS: '250', GROUND_CONTROL_DIR: path.join(root, 'gc'),
    },
    stateDir,
    output,
  });
  ({ base, token } = dashboard);
});

after(async () => {
  await dashboard?.stop(); // exactly the dashboard this test started, and what it started
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const post = async (p, body = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workshop-Token': token }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const get = async (p) => (await fetch(base + p)).json();
const view = (slug) => get(`/api/stacks/${slug}`);
const part = (v, name) => v.parts.find((p) => p.name === name);

async function waitFor(fn, what, ms = 30_000) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    last = await fn();
    if (last && last.ok !== false) return last;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.\nLast: ${JSON.stringify(last?.v ?? last, null, 1)?.slice(0, 3000)}\n${output.join('').slice(-3000)}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
const until = (slug, test, what, ms) => waitFor(async () => { const v = await view(slug); return test(v) ? v : { ok: false, v }; }, what, ms);

// Play the section's Foreman: commit its work in its worktree, then say review is done.
async function finishSection(v, name, files) {
  const p = part(v, name);
  for (const [f, text] of Object.entries(files)) {
    const file = path.join(p.worktree, f);
    if (text === null) await fs.rm(file); else await fs.writeFile(file, text);
  }
  sh(p.worktree, 'add', '-A');
  sh(p.worktree, '-c', 'user.email=test@example.com', '-c', 'user.name=Test', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `section ${name}`);
  const statusFile = path.join(featuresDir, p.slug, 'status.json');
  const status = JSON.parse(await fs.readFile(statusFile, 'utf8'));
  await new Promise((r) => setTimeout(r, 20)); // a later modification time than the last send-back
  await fs.writeFile(statusFile, JSON.stringify({ ...status, stage: 'review', stage_state: 'done', updated_at: new Date().toISOString() }, null, 2));
}
const remoteBranches = () => sh(remote, 'for-each-ref', '--format=%(refname)');
const allTold = (v) => [...v.coordinator.told.map((t) => t.words), ...v.coordinator.waiting.map((t) => t.words)].join('\n');

test('server: a stack of three with cap 2 starts two, queues one with its reason, merges in order, undoes a failed check, waits for the go to push', { timeout: 180_000 }, async () => {
  // Before approval: the plan, and nothing to merge or push.
  const list = await get('/api/stacks');
  const mine = list.stacks.find((s) => s.slug === 'big-job');
  assert.equal(mine.action, 'approve-plan');
  assert.equal(mine.parts, 3);
  let v = await view('big-job');
  assert.equal(v.phase, 'plan');
  assert.deepEqual([v.next.label, v.next.key], ['Approve plan', 'a']);
  assert.equal((await post('/api/stacks/big-job/merge')).status, 409);
  assert.equal((await post('/api/stacks/big-job/push', { go: true })).status, 409);
  assert.equal((await get('/api/stacks/no-such-stack')).error, 'No stack by that name.');

  // Approve with cap 2: two start, the third waits for a slot.
  const approved = await post('/api/stacks/big-job/approve-plan', { cap: 2 });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal((await post('/api/stacks/big-job/approve-plan', { cap: 2 })).status, 409, 'approved once only');
  v = await until('big-job', (x) => part(x, 'a').state === 'running' && part(x, 'b').state === 'running', 'a and b to start');
  assert.equal(part(v, 'c').state, 'pending');
  assert.equal(part(v, 'c').stateWords, 'Queued');
  assert.equal(part(v, 'c').reason, 'Waiting for a free slot: 2 of 2 in use');
  assert.equal(v.parentBranch, 'feature/big-job');
  assert.equal(v.parentWorktree, path.join(root, 'wt-big-job'));
  // Each section is a child job: its folder, status.json naming its stack and section, its brief, its worktree, branch and port.
  const a = part(v, 'a');
  assert.equal(a.slug, 'big-job--a');
  assert.equal(a.branch, 'feature/big-job--a');
  assert.equal(a.worktree, path.join(root, 'wt-big-job--a'));
  assert.ok(a.port >= 24800 && a.port <= 24899, `port ${a.port}`);
  assert.notEqual(part(v, 'b').port, a.port);
  const aStatus = JSON.parse(await fs.readFile(path.join(featuresDir, 'big-job--a', 'status.json'), 'utf8'));
  assert.deepEqual([aStatus.stack, aStatus.section], ['big-job', 'a']);
  assert.match(await fs.readFile(path.join(featuresDir, 'big-job--a', 'section.md'), 'utf8'), /# Section 1 of 3: a[\s\S]*Owns \(the only paths you may change\): `a\/\*\*`/);
  const aOptions = JSON.parse(await fs.readFile(path.join(featuresDir, 'big-job--a', 'options.json'), 'utf8'));
  assert.ok(['clarify', 'spec'].every((s) => aOptions.skip.includes(s)), 'a section skips clarify and spec');
  assert.equal(sh(a.worktree, 'rev-parse', 'HEAD'), sh(v.parentWorktree, 'rev-parse', 'HEAD'), 'made from the parent’s branch');
  // The coordinator was told, and the sections' Foremen are working (on a card).
  v = await until('big-job', (x) => part(x, 'a').run === 'waiting_permission' && part(x, 'b').run === 'waiting_permission', 'both Foremen to wait on their cards');
  assert.match(allTold(v), /The person approved the stack plan/);
  const send = JSON.parse(`[${(await fs.readFile(path.join(stateDir, 'audit.jsonl'), 'utf8')).trim().split('\n').join(',')}]`).find((e) => e.action === 'send' && e.featureDir === path.join(featuresDir, 'big-job--a'));
  assert.equal(send.kind, 'stack-section');
  assert.match(send.text, /^\/feature Stack big-job · a Private folder: /);

  // b is ready first, but sections merge only in order.
  await finishSection(v, 'b', { 'b/b.txt': 'b\n' });
  v = await until('big-job', (x) => part(x, 'b').state === 'ready', 'b to be ready');
  assert.equal(part(v, 'b').stateWords, 'Ready to merge');
  // A ready section's Foreman is done, so its slot is free: c starts from the parent's branch as it is.
  const parentNow = sh(path.join(root, 'wt-big-job'), 'rev-parse', 'HEAD');
  v = await until('big-job', (x) => part(x, 'c').state === 'running', 'c to take b’s slot once b is ready');
  assert.equal(sh(part(v, 'c').worktree, 'rev-parse', 'HEAD'), parentNow, 'c is made from the parent’s branch');
  const early = await post('/api/stacks/big-job/merge', { section: 'b' });
  assert.equal(early.status, 409);
  assert.match(early.body.error, /Sections merge only in order: a is next, not b/);
  assert.match((await post('/api/stacks/big-job/merge')).body.error, /Section a is next to merge, and it is still being built/);
  assert.match(allTold(v), /Section b is ready to merge\./);

  // a is ready: your yes merges it, the checks run, and c takes the free slot.
  await finishSection(v, 'a', { 'a/a.txt': 'a\n' });
  v = await until('big-job', (x) => part(x, 'a').state === 'ready', 'a to be ready');
  assert.deepEqual([v.next.action, v.next.key, v.next.section], ['merge', 'm', 'a']);
  const yes = await post('/api/stacks/big-job/merge');
  assert.equal(yes.status, 202, JSON.stringify(yes.body));
  v = await until('big-job', (x) => part(x, 'a').state === 'integrated', 'a to merge');
  assert.equal(part(v, 'a').stateWords, 'Merged');
  assert.equal(sh(v.parentWorktree, 'rev-parse', 'HEAD'), part(v, 'a').mergeSha);
  assert.ok(v.log.some((l) => l.event === 'merged' && /Section a is merged into feature\/big-job, and the checks passed \(node check\.js\)/.test(l.words)));

  assert.equal((await post('/api/stacks/big-job/merge')).status, 202);
  v = await until('big-job', (x) => part(x, 'b').state === 'integrated', 'b to merge');

  // c fails the checks after merging: the merge is undone and c goes back to its Foreman (1 of 3).
  v = await until('big-job', (x) => part(x, 'c').run === 'waiting_permission', 'c’s Foreman to wait on its card');
  const beforeC = sh(v.parentWorktree, 'rev-parse', 'HEAD');
  await finishSection(v, 'c', { 'c/c.txt': 'c\n', 'c/FAIL': 'x\n' });
  v = await until('big-job', (x) => part(x, 'c').state === 'ready', 'c to be ready');
  assert.equal((await post('/api/stacks/big-job/merge')).status, 202);
  v = await until('big-job', (x) => part(x, 'c').failures === 1 && !x.busy, 'c’s checks to fail');
  assert.equal(part(v, 'c').state, 'running');
  assert.equal(part(v, 'c').problem.kind, 'checks');
  assert.match(part(v, 'c').reason, /The checks failed after merging section c \(node check\.js\), so the merge was undone and feature\/big-job is back where it was/);
  assert.equal(sh(v.parentWorktree, 'rev-parse', 'HEAD'), beforeC, 'the branch is back where it was');
  await assert.rejects(fs.stat(path.join(v.parentWorktree, 'c', 'FAIL')));
  assert.match(allTold(v), /It went back to section c’s Foreman \(1 of 3\)/);

  // Fixed on its branch, ready again, merged.
  await finishSection(v, 'c', { 'c/FAIL': null });
  v = await until('big-job', (x) => part(x, 'c').state === 'ready', 'c to be ready again');
  assert.equal((await post('/api/stacks/big-job/merge')).status, 202);
  v = await until('big-job', (x) => x.phase === 'push' && !x.busy, 'every section to merge');
  assert.deepEqual(v.parts.map((p) => p.state), ['integrated', 'integrated', 'integrated']);
  assert.deepEqual(sh(v.parentWorktree, 'log', '--format=%s', '--merges').split('\n'), ['Merge section c into feature/big-job', 'Merge section b into feature/big-job', 'Merge section a into feature/big-job'], 'merged in the plan’s order');
  assert.deepEqual([v.next.action, v.next.label, v.next.key], ['push', 'Push', 'p']);

  // Pushing: never without a go. No go first, then go: the coordinator is told; the runner itself pushes nothing.
  const noAnswer = await post('/api/stacks/big-job/push', {});
  assert.equal(noAnswer.status, 400);
  assert.match(noAnswer.body.error, /nothing is pushed without a go/);
  assert.equal((await post('/api/stacks/big-job/push', { go: false, note: 'Not today.' })).status, 200);
  v = await view('big-job');
  assert.equal(v.push.state, 'declined');
  assert.equal(remoteBranches(), '', 'nothing reached the fork');
  const go = await post('/api/stacks/big-job/push', { go: true });
  assert.equal(go.status, 200, JSON.stringify(go.body));
  v = go.body;
  assert.equal(v.push.state, 'approved');
  assert.equal(v.push.remote, 'origin');
  assert.match(allTold(v), /Told the coordinator to push feature\/big-job to origin\./);
  assert.equal(v.next.action, 'wait');
  assert.equal((await post('/api/stacks/big-job/push', { go: true })).status, 409, 'one go only');
  assert.equal(remoteBranches(), '', 'the runner never pushes: the coordinator does, through its own permission card');

  // The decision file: one heading per section, in order, and one Not doing.
  const decisions = await waitFor(async () => {
    const text = await fs.readFile(path.join(featuresDir, 'big-job', 'decisions.md'), 'utf8').catch(() => '');
    return /## Section: c/.test(text) ? text : { ok: false, v: text };
  }, 'the decision file');
  const at = ['## Section: a', '## Section: b', '## Section: c', '## Not doing'].map((h) => decisions.indexOf(h));
  assert.ok(at.every((i) => i >= 0), decisions);
  assert.deepEqual([...at].sort((x, y) => x - y), at, 'in plan order, Not doing last');
  assert.equal(decisions.match(/## Not doing/g).length, 1);

  // stack.json has the whole story, one line per event.
  const stack = JSON.parse(await fs.readFile(path.join(featuresDir, 'big-job', 'stack.json'), 'utf8'));
  assert.deepEqual(stack.log.map((l) => l.event).filter((e) => ['merged', 'checks-failed', 'push-no', 'push-yes'].includes(e)), ['merged', 'merged', 'checks-failed', 'merged', 'push-no', 'push-yes']);
});

test('server: with "Merge on its own" the same stack merges by itself and still waits for the go to push', { timeout: 180_000 }, async () => {
  const approved = await post('/api/stacks/auto-job/approve-plan', { cap: 2, autoIntegrate: true });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  let v = await until('auto-job', (x) => part(x, 'a').run === 'waiting_permission' && part(x, 'b').run === 'waiting_permission', 'a and b to start');
  assert.equal(part(v, 'c').reason, 'Waiting for a free slot: 2 of 2 in use');
  await finishSection(v, 'a', { 'a/a.txt': 'a\n' });
  await finishSection(v, 'b', { 'b/b.txt': 'b\n' });
  v = await until('auto-job', (x) => part(x, 'b').state === 'integrated', 'a and b to merge on their own');
  assert.equal(part(v, 'a').state, 'integrated');
  v = await until('auto-job', (x) => part(x, 'c').run === 'waiting_permission', 'c to start');
  await finishSection(v, 'c', { 'c/c.txt': 'c\n' });
  v = await until('auto-job', (x) => x.phase === 'push' && !x.busy, 'every section to merge on its own');
  assert.ok(v.log.filter((l) => l.event === 'merge-started').every((l) => /Merging on its own/.test(l.words)));
  // Pushing still waits for your go.
  await new Promise((r) => setTimeout(r, 1000));
  v = await view('auto-job');
  assert.equal(v.push.state, 'waiting');
  assert.deepEqual([v.next.action, v.next.key], ['push', 'p']);
  assert.ok(!/Told the coordinator to push/.test(allTold(v)), 'the coordinator isn’t told to push');
  assert.equal(remoteBranches(), '');
});

test('server: the global cap is saved in Settings → Workflow, and plain refusals', async () => {
  const bad = await post('/api/stacks/cap', { cap: 0 });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /whole number from 1 to 20/);
  const ok = await post('/api/stacks/cap', { cap: 5 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.globalCap, 5);
  assert.equal((await get('/api/meta')).settings?.workflow?.sectionsAtOnce ?? JSON.parse(await fs.readFile(path.join(stateDir, 'settings.json'), 'utf8')).workflow.sectionsAtOnce, 5);
  assert.equal((await post('/api/stacks/big-job/settings', { autoIntegrate: 'yes' })).status, 400);
  assert.equal((await post('/api/stacks/big-job/nonsense')).status, 404);
  const noToken = await fetch(`${base}/api/stacks/cap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"cap":2}' });
  assert.equal(noToken.status, 403);
});
