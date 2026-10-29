// Stacks, the plain code (lib/stack.js, packet K): the plan file and each plain error, the
// scheduler with its two caps and dependencies, the stuck rule at three, merging in a temp git repo
// (merged, a clash, a file outside the owned paths, a failed check undone), and the page's words.
// No model calls, no network.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CAP, STATE_WORDS, STUCK_AT, StackError, afterChecks, cleanCap, cleanSettings, describeStack, ensureWorktree,
  mergeSection, newStack, nextRunnable, nextToMerge, notchUp, parseStackPlan, readStack, sectionProgress, sectionReady,
  sectionSlug, stackPhase, stackSummary, writeStack,
} from '../lib/stack.js';
import { stackNames, stackRules, loadProfile } from '../lib/profile.js';

const PLAN = `# ORBIT-512 Work orders v2

## Section: api
The work order API: list, create and close.
Owns: app/api/work-orders/**, app/lib/work-orders.ts
Depends on: none

## Section: ui
The work order screens.
Owns:
- app/ui/work-orders/**
Depends on: api
Model: claude-sonnet-5-5
Effort: medium

## Section: docs
The help page.
Owns: \`docs/work-orders.md\`
Depends on: none

Order: api, ui, docs
`;

test('stack.md: sections in Order, with their briefs, owned paths, dependencies, model and effort', () => {
  const p = parseStackPlan(PLAN);
  assert.equal(p.ok, true, p.errors.join('\n'));
  assert.equal(p.title, 'ORBIT-512 Work orders v2');
  assert.deepEqual(p.order, ['api', 'ui', 'docs']);
  assert.deepEqual(p.sections.map((s) => s.name), ['api', 'ui', 'docs']);
  assert.deepEqual(p.sections[0], { name: 'api', brief: 'The work order API: list, create and close.', owns: ['app/api/work-orders/**', 'app/lib/work-orders.ts'], dependsOn: [], model: null, effort: null });
  assert.deepEqual(p.sections[1].owns, ['app/ui/work-orders/**']);
  assert.deepEqual(p.sections[1].dependsOn, ['api']);
  assert.equal(p.sections[1].model, 'claude-sonnet-5-5');
  assert.equal(p.sections[1].effort, 'medium');
  assert.deepEqual(p.sections[2].owns, ['docs/work-orders.md'], 'backticks are taken off');
  assert.deepEqual(p.warnings, []);
});

test('stack.md: an "## Order" list works as well as an Order line, and decides the order', () => {
  const p = parseStackPlan(`## Section: b\nB.\nOwns: b/**\n\n## Section: a\nA.\nOwns: a/**\n\n## Order\n1. a\n2. b\n`);
  assert.equal(p.ok, true, p.errors.join('\n'));
  assert.deepEqual(p.sections.map((s) => s.name), ['a', 'b']);
});

test('stack.md: each plain error', () => {
  const errs = (text) => parseStackPlan(text).errors.join('\n');
  assert.match(errs('# Nothing here\n'), /There are no sections/);
  assert.match(errs('## Section: a\nA.\nOwns: a/**\n\n## Section: a\nB.\nOwns: b/**\n\nOrder: a\n'), /The section name “a” is used twice/);
  assert.match(errs('## Section: a\nA.\nOwns: a/**\nDepends on: zed\n\nOrder: a\n'), /depends on “zed”, which isn’t a section/);
  assert.match(errs('## Section: a\nA.\nOwns: a/**\nDepends on: a\n\nOrder: a\n'), /depends on itself/);
  const loop = errs('## Section: a\nA.\nOwns: a/**\nDepends on: b\n\n## Section: b\nB.\nOwns: b/**\nDepends on: a\n\nOrder: a, b\n');
  assert.match(loop, /Sections a and b depend on each other in a loop/);
  assert.match(errs('## Section: a\nA.\nOwns: a/**\n\n## Section: b\nB.\nOwns: b/**\n\nOrder: a\n'), /Section b is missing from the Order line/);
  assert.match(errs('## Section: a\nA.\n\nOrder: a\n'), /Section a owns no paths/);
  assert.match(errs('## Section: a\nA.\nOwns: a/**\n'), /There is no Order line/);
  assert.match(errs('## Section: a\nA.\nOwns: a/**\n\nOrder: a, b\n'), /names “b”, which isn’t a section/);
  assert.match(errs('## Section: a\nA.\nOwns: ../elsewhere/**\n\nOrder: a\n'), /owned paths must be inside the repository/);
  assert.match(errs('## Section: Big Name\nA.\nOwns: a/**\n\nOrder: Big Name\n'), /can’t be a section name/);
  assert.match(errs('## Section: a\nA.\nOwns: a/**\nEffort: huge\n\nOrder: a\n'), /Effort must be/);
  assert.match(errs('## Section: a\nA.\nOwns: a/**\n\n## Section: b\nB.\nOwns: b/**\nDepends on: a\n\nOrder: b, a\n'), /depends on a, but comes before it in the Order line/);
  // Warnings don't stop it: overlapping owned paths, and a section with no brief.
  const w = parseStackPlan('## Section: a\nOwns: shared/x.ts\n\n## Section: b\nB.\nOwns: shared/**\n\nOrder: a, b\n');
  assert.equal(w.ok, true);
  assert.match(w.warnings.join('\n'), /Sections a and b both own shared\/x\.ts/);
  assert.match(w.warnings.join('\n'), /Section a has no brief/);
});

const where = { repo: '/r', parentBranch: 'fix/orbit-512-work-orders', parentWorktree: '/w', base: 'main', remote: 'origin' };
const stackOf = (opts = {}) => newStack({ parent: 'orbit-512', plan: parseStackPlan(PLAN), planText: PLAN, where, ...opts });

test('stack.json: a new stack has every section pending, its settings, and one log line', () => {
  const s = stackOf({ cap: 2 });
  assert.equal(s.version, 1);
  assert.equal(s.parent, 'orbit-512');
  assert.equal(s.cap, 2);
  assert.equal(s.autoIntegrate, false);
  assert.equal(s.model, 'claude-opus-5-5');
  assert.equal(s.effort, 'high');
  assert.deepEqual(s.sections.map((x) => [x.name, x.state, x.failures, x.slug, x.mergedAt]), [['api', 'pending', 0, null, null], ['ui', 'pending', 0, null, null], ['docs', 'pending', 0, null, null]]);
  assert.equal(s.push.state, 'waiting');
  assert.match(s.log[0].words, /The plan was approved: 3 sections, merging in the order api, ui, docs/);
  assert.equal(sectionSlug('orbit-512', 'api'), 'orbit-512--api');
  assert.equal(notchUp('high'), 'xhigh');
  assert.equal(notchUp('max'), 'max');
});

test('nextRunnable: dependencies first, then the stack’s cap, then the global cap, each with a reason in words', () => {
  const s = stackOf({ cap: 2 });
  let r = nextRunnable(s, { globalRunning: 0, globalCap: 3 });
  assert.deepEqual(r.start, ['api', 'docs'], 'ui waits for api; api and docs start in the plan’s order');
  assert.deepEqual(r.queued, [{ name: 'ui', reason: 'Waiting for section api to merge' }]);

  // Three without dependencies, cap 2: two start, the third waits for a slot.
  const free = newStack({ parent: 'p', plan: parseStackPlan('## Section: a\nA.\nOwns: a/**\n\n## Section: b\nB.\nOwns: b/**\n\n## Section: c\nC.\nOwns: c/**\n\nOrder: a, b, c\n'), where, cap: 2 });
  r = nextRunnable(free, { globalRunning: 0, globalCap: 3 });
  assert.deepEqual(r.start, ['a', 'b']);
  assert.deepEqual(r.queued, [{ name: 'c', reason: 'Waiting for a free slot: 2 of 2 in use' }]);
  free.sections[0].state = 'running';
  free.sections[1].state = 'blocked'; // back with its Foreman: it still holds its slot
  assert.deepEqual(nextRunnable(free, { globalRunning: 2, globalCap: 3 }).queued, [{ name: 'c', reason: 'Waiting for a free slot: 2 of 2 in use' }]);
  free.sections[1].state = 'ready';
  assert.deepEqual(nextRunnable(free, { globalRunning: 1, globalCap: 3 }).start, ['c']);

  // The global cap counts every stack's running sections.
  const g = stackOf({ cap: 3 });
  r = nextRunnable(g, { globalRunning: 2, globalCap: 3 });
  assert.deepEqual(r.start, ['api']);
  assert.deepEqual(r.queued, [{ name: 'ui', reason: 'Waiting for section api to merge' }, { name: 'docs', reason: 'Waiting for a free slot: 3 of 3 in use across every stack' }]);

  // Once api has merged, ui may start.
  g.sections[0].state = 'integrated';
  assert.deepEqual(nextRunnable(g, { globalRunning: 0, globalCap: 3 }).start, ['ui', 'docs']);
  assert.equal(DEFAULT_CAP, 3);
});

test('afterChecks: a failure counts one; the third makes the section failed (stuck)', () => {
  let s = { name: 'api', state: 'ready', failures: 0 };
  assert.deepEqual(afterChecks(s, true), s);
  s = afterChecks(s, false);
  assert.deepEqual([s.state, s.failures], ['running', 1]);
  s = afterChecks(s, false);
  assert.deepEqual([s.state, s.failures], ['running', 2]);
  s = afterChecks(s, false);
  assert.deepEqual([s.state, s.failures], ['failed', STUCK_AT]);
});

test('nextToMerge: only ever the first section not merged, with why it waits', () => {
  const s = stackOf();
  s.sections[2].state = 'ready'; // docs is ready, but api comes first
  let n = nextToMerge(s);
  assert.equal(n.section.name, 'api');
  assert.equal(n.ready, false);
  assert.match(n.reason, /Section api is next to merge, and it hasn’t started yet. Sections merge only in order./);
  s.sections[0].state = 'ready';
  n = nextToMerge(s);
  assert.deepEqual([n.section.name, n.ready], ['api', true]);
  for (const x of s.sections) x.state = 'integrated';
  assert.equal(nextToMerge(s).section, null);
});

test('sectionReady and sectionProgress: from the section’s own status.json, in words', () => {
  assert.equal(sectionReady({ stage: 'review', stage_state: 'done' }), true);
  assert.equal(sectionReady({ stage: 'review', stage_state: 'working' }), false);
  assert.equal(sectionReady({ stage: 'pr1', stage_state: 'waiting_for_you' }), true);
  assert.equal(sectionReady(null), false);
  assert.deepEqual(sectionProgress({ stage: 'implement', stage_state: 'working' }, 'running'), { stage: 'implement', step: 1, of: 4, words: 'Building' });
  assert.equal(sectionProgress({ stage: 'test', stage_state: 'waiting_for_you' }, 'running').words, 'Testing: waiting for you');
  assert.equal(sectionProgress(null, 'pending').words, 'Not started');
  assert.equal(sectionProgress(null, 'integrated').words, 'Merged');
});

test('cleanCap and cleanSettings: whole numbers from 1 to 20, and plain refusals', () => {
  assert.equal(cleanCap(2), 2);
  assert.throws(() => cleanCap(0), (e) => e instanceof StackError && e.status === 400 && /whole number from 1 to 20/.test(e.message));
  assert.throws(() => cleanCap('x'), StackError);
  assert.deepEqual(cleanSettings({ cap: 4, autoIntegrate: true, effort: 'max' }), { cap: 4, autoIntegrate: true, effort: 'max' });
  assert.throws(() => cleanSettings({ autoIntegrate: 'yes' }), /on or off/);
  assert.throws(() => cleanSettings({ model: 'claude-x' }, { models: ['claude-opus-5-5'] }), /Pick one of the offered models/);
});

test('describeStack: the steps, the one next thing in words, and each part’s state in words', () => {
  const plan = parseStackPlan(PLAN);
  // Before approval: approve the plan.
  let v = describeStack({ slug: 'orbit-512', plan, planText: PLAN });
  assert.equal(v.phase, 'plan');
  assert.deepEqual(v.steps.map((s) => [s.id, s.state, s.words]), [['plan', 'now', 'Now'], ['build', 'next', 'Not yet'], ['merge', 'next', 'Not yet'], ['push', 'next', 'Not yet']]);
  assert.deepEqual([v.next.action, v.next.label, v.next.key], ['approve-plan', 'Approve plan', 'a']);
  assert.ok(v.parts.every((p) => p.stateWords === 'Queued' && p.reason === 'Starts once you approve the plan'));
  // A broken plan: fix it first.
  v = describeStack({ slug: 'x', plan: parseStackPlan('## Section: a\nA.\nOwns: a/**\n') });
  assert.equal(v.next.action, 'fix-plan');
  assert.match(v.next.words, /a problem to fix first: There is no Order line/);

  // Building with cap 2 and a dependency.
  const stack = stackOf({ cap: 2 });
  stack.sections[0].state = 'running';
  stack.sections[2].state = 'running';
  v = describeStack({ slug: 'orbit-512', plan, planText: PLAN, stack, statuses: { api: { stage: 'implement', stage_state: 'working' } }, runs: { api: 'running' }, globalRunning: 2, globalCap: 3 });
  assert.equal(v.phase, 'build');
  assert.deepEqual(v.parts.map((p) => [p.n, p.name, p.state, p.stateWords]), [[1, 'api', 'running', 'Building'], [2, 'ui', 'pending', 'Queued'], [3, 'docs', 'running', 'Building']]);
  assert.equal(v.parts[1].reason, 'Waiting for section api to merge');
  assert.equal(v.parts[0].progress.words, 'Building');
  assert.equal(v.next.action, 'wait');
  assert.equal(v.coordinatorEffort, 'xhigh');

  // Ready: merge part 1 (m), or "merges on its own".
  stack.sections[0].state = 'ready';
  v = describeStack({ slug: 'orbit-512', plan, planText: PLAN, stack });
  assert.equal(v.phase, 'merge');
  assert.deepEqual([v.next.action, v.next.label, v.next.key, v.next.section], ['merge', 'Merge section 1', 'm', 'api']);
  v = describeStack({ slug: 'orbit-512', plan, planText: PLAN, stack: { ...stack, autoIntegrate: true } });
  assert.equal(v.next.action, 'wait');
  assert.match(v.next.words, /merges on its own/);

  // A clash: send it back (r). Stuck: open it (o).
  stack.sections[0] = { ...stack.sections[0], state: 'blocked', problem: { kind: 'conflict', words: 'Section api clashes with fix/orbit-512-work-orders in app/x.ts.', files: ['app/x.ts'] } };
  v = describeStack({ slug: 'orbit-512', plan, planText: PLAN, stack });
  assert.deepEqual([v.next.action, v.next.key, v.parts[0].stateWords], ['hand-back', 'r', 'Back with its Foreman']);
  stack.sections[0] = { ...stack.sections[0], state: 'failed', failures: 3, problem: null };
  v = describeStack({ slug: 'orbit-512', plan, planText: PLAN, stack });
  assert.deepEqual([v.next.action, v.next.key, v.parts[0].stuck, v.parts[0].stateWords], ['open-part', 'o', true, 'Stuck: needs you']);
  assert.match(v.parts[0].reason, /failed 3 times\. It has stopped and needs you/);

  // All merged: push (p), which waits for the go.
  for (const x of stack.sections) Object.assign(x, { state: 'integrated', problem: null });
  v = describeStack({ slug: 'orbit-512', plan, planText: PLAN, stack });
  assert.equal(v.phase, 'push');
  assert.deepEqual([v.next.action, v.next.label, v.next.key], ['push', 'Push', 'p']);
  assert.equal(stackPhase({ ...stack, push: { state: 'pushed' } }), 'pushed');
  assert.ok(Object.values(STATE_WORDS).every((w) => /^[A-Z]/.test(w)), 'every state has words');
  const sum = stackSummary(v);
  assert.deepEqual([sum.parts, sum.counts.integrated, sum.action], [3, 3, 'push']);
  // The plan changed after it was approved: the page can say so.
  assert.equal(describeStack({ slug: 'orbit-512', plan, planText: `${PLAN}\nmore`, stack }).plan.changedSinceApproval, true);
});

test('stackRules and stackNames: the profile’s section patterns (Orbit), and the general ones', async () => {
  const orbit = await loadProfile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'profiles', 'orbit.md'));
  assert.equal(orbit.ok, true, orbit.errors?.join('\n'));
  const rules = stackRules(orbit.profile);
  assert.deepEqual(stackNames(rules, '/x/repo', { slug: 'orbit-512-work-orders', n: '512', kind: 'bug', section: 'api' }), { worktree: path.resolve('/x/orbit-512-api'), branch: 'fix/orbit-512-api' });
  assert.ok(rules.checks.length >= 1);
  const general = stackRules(null);
  assert.deepEqual(stackNames(general, '/x/repo', { slug: 'big-job', section: 'ui' }), { worktree: path.resolve('/x/big-job--ui'), branch: 'feature/big-job--ui' });
  assert.deepEqual(general.checks, []);
});

// ---------- Merging in a temp git repo ----------

const roots = [];
after(async () => { for (const r of roots) await fs.rm(r, { recursive: true, force: true }); });
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function repoWithParent() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-stack-')));
  roots.push(root);
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, 'config', 'user.email', 'test@example.com');
  sh(repo, 'config', 'user.name', 'Test');
  sh(repo, 'config', 'commit.gpgsign', 'false');
  await fs.mkdir(path.join(repo, 'app'), { recursive: true });
  await fs.writeFile(path.join(repo, 'app', 'shared.txt'), 'one\n');
  // The check: fails while FAIL-CHECK is there.
  await fs.writeFile(path.join(repo, 'check.js'), "const fs = require('node:fs'); if (fs.existsSync('FAIL-CHECK')) { console.error('the check failed: FAIL-CHECK is here'); process.exit(1); } console.log('ok');\n");
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-q', '-m', 'start');
  const parentWorktree = path.join(root, 'parent');
  const made = await ensureWorktree({ repo, worktree: parentWorktree, branch: 'feature/big', from: 'main' });
  assert.equal(made.ok, true, made.message);
  async function section(name, files, owns) {
    const worktree = path.join(root, `big--${name}`);
    const r = await ensureWorktree({ repo, worktree, branch: `feature/big--${name}`, from: 'feature/big' });
    assert.equal(r.ok, true, r.message);
    for (const [f, text] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(worktree, f)), { recursive: true });
      await fs.writeFile(path.join(worktree, f), text);
    }
    sh(worktree, 'add', '.');
    sh(worktree, 'commit', '-q', '-m', `section ${name}`);
    return { name, branch: `feature/big--${name}`, worktree, owns };
  }
  return { root, repo, parentWorktree, section };
}

test('mergeSection: merged with the checks passing; a clash and a file outside the owned paths leave the branch as it was', async () => {
  const { parentWorktree, section } = await repoWithParent();
  const api = await section('api', { 'app/api/a.txt': 'api\n' }, ['app/api/**']);
  const before = sh(parentWorktree, 'rev-parse', 'HEAD');
  let r = await mergeSection({ parentWorktree, parentBranch: 'feature/big', section: api, checks: ['node check.js'] });
  assert.equal(r.outcome, 'merged', r.words);
  assert.match(r.words, /Section api is merged into feature\/big, and the checks passed \(node check\.js\)/);
  assert.equal(sh(parentWorktree, 'rev-parse', 'HEAD'), r.sha);
  assert.notEqual(r.sha, before);
  assert.equal(await fs.readFile(path.join(parentWorktree, 'app/api/a.txt'), 'utf8'), 'api\n');

  // Nothing new to merge.
  r = await mergeSection({ parentWorktree, parentBranch: 'feature/big', section: api });
  assert.equal(r.outcome, 'empty');

  // Outside its owned paths: refused, with the list, nothing merged.
  const sneaky = await section('ui', { 'app/ui/u.txt': 'ui\n', 'app/api/b.txt': 'not mine\n' }, ['app/ui/**']);
  const head = sh(parentWorktree, 'rev-parse', 'HEAD');
  r = await mergeSection({ parentWorktree, parentBranch: 'feature/big', section: sneaky });
  assert.equal(r.outcome, 'outside');
  assert.deepEqual(r.files, ['app/api/b.txt']);
  assert.match(r.words, /changed a file outside its owned paths, so it wasn’t merged: app\/api\/b\.txt/);
  assert.equal(sh(parentWorktree, 'rev-parse', 'HEAD'), head);

  // A clash: aborted, the files named, the branch unchanged and clean.
  const a = await section('one', { 'app/shared.txt': 'from one\n' }, ['app/shared.txt']);
  const b = await section('two', { 'app/shared.txt': 'from two\n' }, ['app/shared.txt']);
  assert.equal((await mergeSection({ parentWorktree, parentBranch: 'feature/big', section: a })).outcome, 'merged');
  const mid = sh(parentWorktree, 'rev-parse', 'HEAD');
  r = await mergeSection({ parentWorktree, parentBranch: 'feature/big', section: b });
  assert.equal(r.outcome, 'conflict', r.words);
  assert.deepEqual(r.files, ['app/shared.txt']);
  assert.match(r.words, /clashes with feature\/big in app\/shared\.txt\. Nothing was merged/);
  assert.equal(sh(parentWorktree, 'rev-parse', 'HEAD'), mid);
  assert.equal(sh(parentWorktree, 'status', '--porcelain'), '');
});

test('mergeSection: a failed check after the merge undoes it, so the branch always passes', async () => {
  const { parentWorktree, section } = await repoWithParent();
  const bad = await section('bad', { 'FAIL-CHECK': 'x\n' }, ['FAIL-CHECK']);
  const before = sh(parentWorktree, 'rev-parse', 'HEAD');
  const r = await mergeSection({ parentWorktree, parentBranch: 'feature/big', section: bad, checks: ['node check.js'] });
  assert.equal(r.outcome, 'checks-failed');
  assert.equal(r.undone, true);
  assert.equal(r.before, before);
  assert.match(r.words, /The checks failed after merging section bad \(node check\.js\), so the merge was undone and feature\/big is back where it was/);
  assert.match(r.checks[0].tail, /FAIL-CHECK is here/);
  assert.equal(sh(parentWorktree, 'rev-parse', 'HEAD'), before);
  await assert.rejects(fs.stat(path.join(parentWorktree, 'FAIL-CHECK')));
  // The parent's worktree on another branch: refused, nothing merged.
  sh(parentWorktree, 'checkout', '-q', '-b', 'elsewhere');
  const refused = await mergeSection({ parentWorktree, parentBranch: 'feature/big', section: bad });
  assert.equal(refused.outcome, 'refused');
  assert.match(refused.words, /is on elsewhere, not feature\/big/);
});

test('readStack and writeStack: through a temp file, read back the same', async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-stackjson-')));
  roots.push(dir);
  assert.equal(await readStack(dir), null);
  const s = stackOf();
  await writeStack(dir, s);
  assert.deepEqual(await readStack(dir), s);
  assert.deepEqual((await fs.readdir(dir)).sort(), ['stack.json']);
});

test('status.json: a section names its stack and its section, both or neither, in either version', async () => {
  const { parseStatusJson, validate } = await import('../lib/status-json.js');
  const base = { schema_version: 1, slug: 'orbit-512--api', stage: 'plan', stage_state: 'working' };
  const both = validate({ ...base, stack: 'orbit-512-work-orders', section: 'api' });
  assert.deepEqual([both.ok, both.warnings], [true, []], JSON.stringify(both));
  assert.equal(validate({ ...base }).ok, true, 'a job that isn’t a section names neither');
  assert.equal(validate({ ...base, stack: 'orbit-512' }).ok, false, 'a stack without a section');
  assert.equal(validate({ ...base, section: 'api' }).ok, false, 'a section without a stack');
  assert.equal(validate({ ...base, stack: 'orbit-512', section: 'Not A Name' }).ok, false, 'a section name as stack.md has it');
  const v2 = validate({ ...base, schema_version: 2, ticket: { key: 'ORBIT-512', title: 'Work orders', url: null, level: 'L2' }, stack: 'orbit-512', section: 'ui' });
  assert.equal(v2.ok, true, JSON.stringify(v2));
  const read = parseStatusJson(JSON.stringify({ ...base, stack: 'orbit-512', section: 'api' }));
  assert.deepEqual([read.stack, read.section], ['orbit-512', 'api']);
  const plain = parseStatusJson(JSON.stringify(base));
  assert.deepEqual([plain.stack, plain.section], [null, null]);
});

test('Settings → Workflow: sections at once across every stack, 1 to 20, default 3, there only once set', async () => {
  const { workflowSettings, sectionsAtOnceOf, SECTIONS_AT_ONCE } = await import('../lib/state.js');
  assert.equal(SECTIONS_AT_ONCE.default, DEFAULT_CAP);
  assert.equal(workflowSettings({}).sectionsAtOnce, undefined, 'the default holds until it is set');
  assert.equal(workflowSettings({ sectionsAtOnce: 5 }).sectionsAtOnce, 5);
  for (const bad of [0, 21, 2.5, '4', null]) assert.equal(sectionsAtOnceOf(bad), 3, String(bad));
});

test('decisions.md of a stack: each section’s decisions under its heading, numbered on in the parent’s ticket, one Not doing', async () => {
  const { writeDecisionsFile } = await import('../lib/decisions.js');
  const features = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-stack-decisions-')));
  roots.push(features);
  const parent = path.join(features, 'orbit-512-work-orders');
  const dirs = { api: path.join(features, 'orbit-512-work-orders--api'), ui: path.join(features, 'orbit-512-work-orders--ui') };
  for (const d of [parent, ...Object.values(dirs)]) await fs.mkdir(d);
  const ticket = { key: 'ORBIT-512', title: 'Work orders', url: null, level: 'L2' };
  await fs.writeFile(path.join(parent, 'status.json'), JSON.stringify({ schema_version: 2, slug: 'orbit-512-work-orders', title: 'Work orders', stage: 'plan', stage_state: 'done', ticket }));
  await fs.writeFile(path.join(parent, 'stack.json'), JSON.stringify({
    version: 1, parent: 'orbit-512-work-orders',
    sections: [{ name: 'api', slug: 'orbit-512-work-orders--api', state: 'integrated' }, { name: 'ui', slug: 'orbit-512-work-orders--ui', state: 'running' }, { name: 'docs', slug: null, state: 'pending' }],
  }));
  await fs.writeFile(path.join(dirs.ui, 'decisions.md'), '# x\n\n## Not doing\n- No offline mode.\n');
  const approve = (dir, at) => ({ at, action: 'send', kind: 'approve', featureDir: dir, text: 'Approved.' });
  const audits = {
    [parent]: [approve(parent, '2026-10-28T10:00:00Z'), approve(parent, '2026-10-28T11:00:00Z')],
    [dirs.api]: [approve(dirs.api, '2026-10-28T12:00:00Z'), approve(dirs.api, '2026-10-28T13:00:00Z')],
    [dirs.ui]: [approve(dirs.ui, '2026-10-28T14:00:00Z')],
  };
  const r = await writeDecisionsFile(parent, { auditFor: async (d) => audits[d] ?? [], person: 'Vignesh' });
  const t = r.text;
  const at = ['ORBIT-512.D1', 'ORBIT-512.D2', '## Section: api', 'ORBIT-512.D3', 'ORBIT-512.D4', '## Section: ui', 'ORBIT-512.D5', '## Section: docs', 'No decisions yet.', '## Not doing', '- No offline mode.'].map((s) => t.indexOf(s));
  assert.ok(at.every((i) => i >= 0), t);
  assert.deepEqual([...at].sort((x, y) => x - y), at, t);
  assert.equal(t.match(/## Not doing/g).length, 1);
  assert.equal(t.includes('ORBIT-512.D6'), false);
});
