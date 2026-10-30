// Packet V: what the Stack pages show about each part (lib/stack-parts.js), the read-only changes
// reader a stack's view carries (lib/stack.js withChanges), and the routes that add them
// (site/routes-stacks.js), on fixture stacks and a fake git. No model calls, no real git.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  LANES, diffStat, enrichView, fileDiff, mergeChecklist, nowLine, parseNumstat, partLane, partPage, partTitle,
  stackAsk, stackCard, stackRisks, usageByJob,
} from '../lib/stack-parts.js';
import { describeStack, parseStackPlan, stackSummary, withChanges } from '../lib/stack.js';
import stacksRoutes from '../site/routes-stacks.js';

const PLAN = `# Invoice export

Why: the model first, because everything reads it.

## Section: model
The invoice model.
Owns: app/model.ts

## Section: api
The billing API.
Owns: app/billing/**
Depends on: model

## Section: email
Email delivery.
Owns: app/email/**, app/billing/billing.ts
Depends on: api

## Section: csv
The CSV export.
Owns: app/csv/**
Depends on: model

## Section: refunds
Refunds.
Owns: app/refunds/**

## Section: dunning
Dunning.
Owns: app/dunning/**

## Section: ui
The screens.
Owns: app/ui/**

## Section: reports
Reports.
Owns: app/reports/**
Depends on: csv

Order: model, api, email, csv, refunds, dunning, ui, reports
`;

const sec = (name, state, extra = {}) => ({ name, state, slug: state === 'pending' ? null : `inv--${name}`, branch: state === 'pending' ? null : `feature/inv--${name}`, worktree: null, port: null, failures: 0, mergedAt: null, owns: [], dependsOn: [], problem: null, ...extra });

function fixtureView({ busy = null } = {}) {
  const plan = parseStackPlan(PLAN);
  const at = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const stack = {
    version: 1, parent: 'inv', cap: 4, autoIntegrate: false, model: 'claude-opus-5-5', effort: 'high', repo: '/repo', parentBranch: 'feature/inv', parentWorktree: '/repo',
    planApprovedAt: at(50), planHash: null, push: { state: 'waiting' },
    sections: [
      sec('model', 'integrated', { owns: ['app/model.ts'], mergedAt: at(1), startedAt: at(48) }),
      sec('api', 'integrated', { owns: ['app/billing/**'], dependsOn: ['model'], mergedAt: at(30) }),
      sec('email', 'blocked', { owns: ['app/email/**', 'app/billing/billing.ts'], dependsOn: ['api'], problem: { kind: 'conflict', words: 'It clashes.', files: ['app/billing/billing.ts'] } }),
      sec('csv', 'ready', { owns: ['app/csv/**'], dependsOn: ['model'], readyAt: at(2) }),
      sec('refunds', 'running', { owns: ['app/refunds/**'], failures: 1, problem: { kind: 'checks', words: 'Tests failed.', files: [] } }),
      sec('dunning', 'failed', { owns: ['app/dunning/**'], failures: 3 }),
      sec('ui', 'running', { owns: ['app/ui/**'] }),
      sec('reports', 'pending', { owns: ['app/reports/**'], dependsOn: ['csv'] }),
    ],
    log: [
      { at: at(50), event: 'plan-approved', words: 'Approved.' },
      { at: at(30), event: 'merged', section: 'api', words: 'api merged.', checks: [{ command: 'npm test', ok: true }] },
      { at: at(1), event: 'merged', section: 'model', words: 'model merged.' },
      { at: at(0.5), event: 'conflict', section: 'email', words: 'email clashes.' },
    ],
  };
  const statuses = { ui: { stage: 'test', stage_state: 'working' }, refunds: { stage: 'implement', stage_state: 'working' } };
  return describeStack({ slug: 'inv', title: 'Invoice export', ticketKey: 'ORBIT-521', plan, planText: PLAN, stack, statuses, busy });
}

test('partLane: every state in a word, never a colour alone', () => {
  const v = fixtureView();
  const lanes = Object.fromEntries(v.parts.map((p) => [p.name, partLane(p, v)]));
  assert.deepEqual(lanes.model, { lane: 'merged', words: 'Merged' });
  assert.deepEqual(lanes.email, { lane: 'needs-you', words: 'Clash at its merge' });
  assert.equal(lanes.csv.lane, 'ready');
  assert.equal(lanes.refunds.lane, 'working');
  assert.equal(lanes.dunning.lane, 'stuck');
  assert.deepEqual(lanes.ui, { lane: 'checks', words: 'Checks running' });
  assert.deepEqual(lanes.reports, { lane: 'waiting', words: 'Waiting on part 4' });
  for (const l of Object.values(lanes)) assert.ok(LANES.includes(l.lane) && l.words.length > 3);
  // Being merged comes from what runs now.
  const busy = fixtureView({ busy: { what: 'merging', section: 'csv', words: 'Merging…' } });
  assert.equal(partLane(busy.parts.find((p) => p.name === 'csv'), busy).lane, 'merging');
  // Before the plan is approved: waiting on another part, or ready to start.
  const plan = describeStack({ slug: 'inv', plan: parseStackPlan(PLAN) });
  assert.deepEqual(partLane(plan.parts[0], plan), { lane: 'queued', words: 'Ready to start' });
  assert.deepEqual(partLane(plan.parts[1], plan), { lane: 'waiting', words: 'Waiting on part 1' });
});

test('nowLine: the crew member at work from the job card, else the stage’s, else the Foreman waiting', () => {
  const part = { name: 'ui', state: 'running', progress: { stage: 'implement', words: 'Building' }, startedAt: null };
  assert.deepEqual(nowLine({ nowDoing: [{ who: 'feature-implementer', name: 'Builder', doing: 'Editing invoice.ts', since: 'T' }] }, part, 'working'), { who: 'Builder', crew: 'feature-implementer', what: 'editing invoice.ts', since: 'T', tone: 'working' });
  assert.equal(nowLine({ nextProposed: 'Finish the list screen', updatedAt: 'U' }, part, 'working').who, 'Builder');
  assert.equal(nowLine(null, { ...part, progress: { stage: 'test' } }, 'checks').who, 'Tester');
  assert.equal(nowLine({ waitingSince: 'W' }, part, 'needs-you').what, 'waiting for your go-ahead');
  assert.equal(nowLine(null, part, 'merged'), null);
  assert.equal(nowLine(null, part, 'waiting'), null);
});

test('stackRisks: the clash names both parts and the file, a failed merge says it was undone, stuck says so', () => {
  const risks = stackRisks(fixtureView());
  const words = risks.map((r) => r.words);
  assert.ok(words.includes('Clash: parts 2 and 3 both change billing.ts'), words.join(' | '));
  assert.ok(words.includes('Tests failed after merging part 5 (undone)'));
  assert.ok(words.includes('Part 6 is stuck: its tests failed 3 times'));
  // The plan's overlap warning is dropped: part 2 has merged and the clash already says it.
  assert.ok(!risks.some((r) => r.kind === 'overlap'));
});

test('stackAsk: the one thing it needs from you, with its one action', () => {
  assert.equal(stackAsk(fixtureView()).action, 'open-part'); // stuck first
  const plan = describeStack({ slug: 'inv', plan: parseStackPlan(PLAN) });
  assert.deepEqual(stackAsk(plan), { action: 'approve-plan', label: 'Check the plan', part: null, words: 'The Foreman split it into 8 parts. Check them and approve.' });
});

test('enrichView and stackCard: counts by lane, cost from Telemetry’s record, times, the card’s fields', () => {
  const usage = usageByJob([
    { t: 'x', job: 'inv--model', costUsd: 1.25 }, { t: 'x', job: 'inv--model', costUsd: 0.75 }, { t: 'x', job: 'inv', costUsd: 2 },
    { t: 'x', job: 'inv', section: 'ui', costUsd: 0.5 }, { t: 'x', job: 'other', costUsd: 9 },
  ]);
  const cards = new Map([['inv--ui', { slug: 'inv--ui', nowDoing: [{ who: 'feature-tester', name: 'Tester', doing: 'Run the tests', since: 'S' }], cost: { totalUsd: 3 } }]]);
  const v = enrichView(fixtureView(), { cards, usage });
  assert.equal(v.counts.merged, 2);
  assert.equal(v.counts['needs-you'], 1);
  assert.equal(v.counts.stuck, 1);
  assert.equal(v.total, 8);
  assert.equal(v.parts[0].costUsd, 2);
  assert.equal(v.parts[0].costSource, 'telemetry');
  assert.equal(v.parts.find((p) => p.name === 'ui').costUsd, 0.5); // the stack's line for its section wins over the card's
  assert.equal(v.costUsd, 4.5);
  assert.equal(v.mergedToday >= 1, true);
  assert.deepEqual(v.parts.find((p) => p.name === 'reports').waitsOn, [4]);
  assert.deepEqual(v.parts[0].unblocks, [2, 4]);
  assert.equal(v.parts.find((p) => p.name === 'ui').now.what, 'run the tests');

  const card = stackCard(stackSummary(fixtureView()), { cards, usage });
  assert.equal(card.detail, undefined, 'the view it came from is left out');
  assert.equal(card.segments.length, 8);
  assert.equal(card.standing, 'needs-you');
  assert.equal(card.why, 'Why: the model first, because everything reads it.');
  assert.deepEqual(card.atWork.map((a) => a.n), [5, 7]);
  assert.ok(card.risks.length >= 3);
  assert.equal(JSON.stringify(card).includes('readChanges'), false);
});

test('partPage and mergeChecklist: neighbours, history and a checklist in words', () => {
  const v = enrichView(fixtureView());
  const page = partPage(v, 3);
  assert.equal(page.part.name, 'email');
  assert.equal(page.prev.n, 2);
  assert.equal(page.next.n, 4);
  assert.equal(page.history[0].event, 'conflict');
  const list = Object.fromEntries(page.checklist.map((c) => [c.id, c]));
  assert.equal(list.clash.ok, false);
  assert.match(list.clash.words, /billing\.ts/);
  assert.equal(list.waits.ok, true);
  assert.equal(partPage(v, 99), null);
  const csv = mergeChecklist(v, v.parts.find((p) => p.name === 'csv'));
  assert.equal(csv.find((c) => c.id === 'checks').ok, true);
  assert.equal(csv.find((c) => c.id === 'order').ok, false);
});

test('partTitle: the brief’s first words', () => {
  assert.equal(partTitle({ name: 'csv', brief: 'The CSV export: one row per line.' }), 'The CSV export');
  assert.equal(partTitle({ name: 'csv', brief: '' }), 'csv');
});

// ---------- git, faked ----------

function fakeGit(answers) {
  const calls = [];
  const fn = async (dir, args) => {
    calls.push([dir, ...args]);
    const a = answers(args);
    return typeof a === 'string' ? { code: 0, stdout: a, stderr: '' } : a ?? { code: 1, stdout: '', stderr: 'no' };
  };
  fn.calls = calls;
  return fn;
}

test('diffStat: numstat against the stack’s branch, cached by the two heads; fileDiff refuses odd paths', async () => {
  assert.deepEqual(parseNumstat('3\t1\tapp/a.ts\n-\t-\timg.png\n'), [{ file: 'app/a.ts', added: 3, removed: 1, binary: false }, { file: 'img.png', added: 0, removed: 0, binary: true }]);
  const git = fakeGit((args) => (args[0] === 'rev-parse' ? 'aaa\nbbb\n' : args[0] === 'diff' && args.includes('--numstat') ? '10\t2\tapp/x.ts\n4\t0\tapp/y.ts\n' : args[0] === 'diff' ? 'diff --git a/app/x.ts b/app/x.ts\n+hi\n' : null));
  const cache = new Map();
  const a = await diffStat({ git, dir: '/r', base: 'feature/inv', branch: 'feature/inv--ui', cache });
  assert.deepEqual([a.added, a.removed, a.files.length], [14, 2, 2]);
  await diffStat({ git, dir: '/r', base: 'feature/inv', branch: 'feature/inv--ui', cache });
  assert.equal(git.calls.filter((c) => c[1] === 'diff').length, 1, 'the second look reuses the first');
  for (const c of git.calls) assert.ok(['rev-parse', 'diff'].includes(c[1]), 'read-only git only');
  assert.match((await diffStat({ git, dir: '/r', base: null, branch: null })).error, /no branch yet/);
  assert.equal((await fileDiff({ git, dir: '/r', base: 'b', branch: 'c', file: 'app/x.ts' })).diff.includes('+hi'), true);
  for (const bad of ['../etc/passwd', '/etc/passwd', '--output=x', '']) assert.ok((await fileDiff({ git, dir: '/r', base: 'b', branch: 'c', file: bad })).error, bad);
});

test('withChanges: the view carries a reader that isn’t in its JSON', async () => {
  const git = fakeGit((args) => (args[0] === 'rev-parse' ? 'a b' : args.includes('--numstat') ? '1\t1\tapp/ui/a.tsx\n' : 'diff'));
  const view = withChanges(fixtureView(), git);
  assert.equal(JSON.stringify(view).includes('readChanges'), false);
  const files = await view.readChanges.files('ui');
  assert.equal(files.files[0].file, 'app/ui/a.tsx');
  assert.equal(git.calls[0][0], '/repo', 'no worktree on disk: git runs in the repository');
  assert.equal((await view.readChanges.files('nope')).error, 'No such part.');
});

// ---------- The routes ----------

test('routes: GET /api/stacks adds each card; a stack’s view adds lanes; a part’s page and one file’s diff', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-stack-parts-'));
  const usageFile = path.join(dir, 'usage.jsonl');
  await fs.writeFile(usageFile, `${JSON.stringify({ t: new Date().toISOString(), job: 'inv--model', costUsd: 2.5 })}\n`);
  const git = fakeGit((args) => (args[0] === 'rev-parse' ? 'a b' : args.includes('--numstat') ? '7\t3\tapp/email/send.ts\n' : 'diff --git\n+x\n'));
  const stacks = {
    list: async () => ({ stacks: [stackSummary(fixtureView())], globalCap: 3, globalRunning: 2 }),
    view: async (slug) => { if (slug !== 'inv') throw Object.assign(new Error('No stack by that name.'), { status: 404 }); return withChanges(fixtureView(), git); },
    httpError: (e) => e,
  };
  let reads = 0;
  const read = { features: async () => { reads += 1; return { features: [{ slug: 'inv--ui', nowDoing: [{ who: 'feature-tester', name: 'Tester', doing: 'Run the tests' }] }] }; } };
  let answer;
  const route = stacksRoutes({ local: { stacks }, read, usageFile, sendJson: (_r, status, body) => { answer = { status, body }; }, readBody: async () => ({}), checkWrite: () => {} });
  const get = async (url) => { const u = new URL(url, 'http://x'); await route.mount({ method: 'GET', headers: {} }, {}, u.pathname, u); return answer; };

  const list = await get('/api/stacks');
  assert.equal(list.status, 200);
  assert.equal(list.body.stacks[0].segments.length, 8);
  assert.equal(list.body.stacks[0].costUsd, 2.5);
  assert.equal(list.body.stacks[0].detail, undefined);

  const one = await get('/api/stacks/inv');
  assert.equal(one.body.parts.find((p) => p.name === 'ui').now.who, 'Tester');
  assert.ok(one.body.risks.length);
  assert.equal(reads, 1, 'the jobs’ cards are reused between quick looks');

  const part = await get('/api/stacks/inv/part/3');
  assert.equal(part.body.part.name, 'email');
  assert.deepEqual(part.body.changes.files, [{ file: 'app/email/send.ts', added: 7, removed: 3, binary: false }]);
  const diff = await get('/api/stacks/inv/part/3/diff?file=app/email/send.ts');
  assert.match(diff.body.diff, /\+x/);
  await assert.rejects(get('/api/stacks/inv/part/42'), /no part 42/);
  await fs.rm(dir, { recursive: true, force: true });
});
