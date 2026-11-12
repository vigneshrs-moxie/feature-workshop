// The job page's overview (Part 3, Task 1): what acceptance.md says the job is checked against.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAcceptance, stepTimes, stepDocs } from '../lib/job-page.js';
import { planSteps, stepStates, planView, prRows } from '../lib/job-page.js';
import { planDone, keepLatest } from '../lib/job-page.js';
import { parseLog } from '../lib/git.js';

test('readAcceptance reads both lists and drops the FR brackets', () => {
  const text = [
    '# Acceptance criteria',
    '',
    '## It works when',
    '1. A manager can add a note on any customer. (FR-001)',
    '',
    '## It must not',
    '1. Show notes to techs. (FR-004)',
    '2. Slow down the customer list.',
    '',
    '## Notes',
    '1. Not a check.',
  ].join('\n');
  assert.deepEqual(readAcceptance(text), {
    worksWhen: ['A manager can add a note on any customer.'],
    mustNot: ['Show notes to techs.', 'Slow down the customer list.'],
  });
  // One heading alone gives the other list empty.
  assert.deepEqual(readAcceptance('## It must not\n1. Lose a note. (FR-002, FR-003)\n'), { worksWhen: [], mustNot: ['Lose a note.'] });
});

test('a file with neither heading is null', () => {
  assert.equal(readAcceptance('# Acceptance criteria\n\nAC-001: it does what the request says.\n'), null);
  assert.equal(readAcceptance(''), null);
  assert.equal(readAcceptance(null), null);
});

// ---------- Each step's time and documents (Task 2, design 3.2) ----------

const H = (hhmm) => `2026-11-10T${hhmm}:00.000Z`;
const brief = (number, stage, hhmm) => ({ number, stage, file: `briefs/${String(number).padStart(3, '0')}-${stage}.md`, at: hhmm ? H(hhmm) : null });
const NONE = { startedAt: null, endedAt: null };

test('stepTimes: a job at Build', () => {
  const briefs = [brief(1, 'clarify', '08:40'), brief(2, 'spec', '09:10'), brief(3, 'investigate', '09:40'), brief(4, 'plan', '10:30')];
  assert.deepEqual(stepTimes({ briefs, startedAt: H('08:00'), stage: 'implement', kind: 'feature', skipped: [] }), {
    spec: { startedAt: H('08:00'), endedAt: H('09:10') },
    investigate: { startedAt: H('09:10'), endedAt: H('09:40') },
    plan: { startedAt: H('09:40'), endedAt: H('10:30') },
    build: { startedAt: H('10:30'), endedAt: null },
    test: NONE,
    review: NONE,
    ship: NONE,
  });
});

test('stepTimes: a skipped step has no times and the next starts where the last one ended', () => {
  const briefs = [brief(1, 'spec', '09:10'), brief(2, 'plan', '10:30')];
  const times = stepTimes({ briefs, startedAt: H('08:00'), stage: 'implement', kind: 'feature', skipped: ['investigate', 'spec-update'] });
  assert.deepEqual(times.spec, { startedAt: H('08:00'), endedAt: H('09:10') });
  assert.deepEqual(times.investigate, NONE);
  assert.deepEqual(times.plan, { startedAt: H('09:10'), endedAt: H('10:30') });
  assert.deepEqual(times.build, { startedAt: H('10:30'), endedAt: null });
});

test('stepTimes: with no start time the first step has no start', () => {
  const briefs = [brief(1, 'spec', '09:10'), brief(2, 'investigate', '09:40')];
  const times = stepTimes({ briefs, startedAt: null, stage: 'plan', kind: 'feature', skipped: [] });
  assert.deepEqual(times.spec, { startedAt: null, endedAt: H('09:10') });
  assert.deepEqual(times.investigate, { startedAt: H('09:10'), endedAt: H('09:40') });
  assert.deepEqual(times.plan, { startedAt: H('09:40'), endedAt: null });
  // An old job (no start, no briefs, no stage known) still has every step, each without times.
  const old = stepTimes({ briefs: [], startedAt: null, stage: null, kind: null, skipped: [] });
  assert.deepEqual(Object.keys(old), ['spec', 'investigate', 'plan', 'build', 'test', 'review', 'ship']);
  for (const t of Object.values(old)) assert.deepEqual(t, NONE);
});

const doc = (file) => ({ file, name: file, group: 'other', version: null, updatedAt: H('09:00'), size: 10, type: file.endsWith('.json') ? 'json' : file.endsWith('.html') ? 'html' : 'md' });
const filesOf = (byStep) => Object.fromEntries(Object.entries(byStep).map(([k, list]) => [k, list.map((d) => d.file)]));

test('stepDocs: each known file sits under its step, a brief under the step of its stage, the plan under Plan and Build, notes and status under none', () => {
  const docs = [
    'spec', 'requirements.md', 'ticket.md', 'wireframes.html', 'wireframes.json',
    'findings.md',
    'implementation-plan.md', 'test-plan.md', 'acceptance.md', 'dev-tests.md', 'manual-test.md',
    'implementation-log.md',
    'test-report.md', 'evidence/evidence.json',
    'review.md', 'review/ui.md', 'fable/1-plan.md',
    'briefs/001-clarify.md', 'briefs/002-wireframe.md', 'briefs/003-spec-update.md', 'briefs/004-implement-detail.md', 'briefs/005-pr1.md',
    'notes.md', 'status.json', 'workflow-status.md', 'history.md', 'options.json', 'scratch.md',
  ].map(doc);
  assert.deepEqual(filesOf(stepDocs(docs, 'feature')), {
    spec: ['spec', 'requirements.md', 'ticket.md', 'wireframes.html', 'wireframes.json', 'briefs/001-clarify.md', 'briefs/002-wireframe.md'],
    investigate: ['findings.md', 'briefs/003-spec-update.md'],
    plan: ['implementation-plan.md', 'test-plan.md', 'acceptance.md', 'dev-tests.md', 'manual-test.md'],
    build: ['implementation-plan.md', 'implementation-log.md', 'briefs/004-implement-detail.md'],
    test: ['test-report.md', 'evidence/evidence.json'],
    review: ['review.md', 'review/ui.md', 'fable/1-plan.md'],
    ship: ['briefs/005-pr1.md'],
    none: ['notes.md', 'status.json', 'workflow-status.md', 'history.md', 'options.json', 'scratch.md'],
  });
  // A quick plan is the plan file too; each entry is the list's own, unchanged.
  const quick = stepDocs([doc('quick-plan.md')], 'feature');
  assert.deepEqual(quick.plan, [doc('quick-plan.md')]);
  assert.deepEqual(quick.build, [doc('quick-plan.md')]);
  // No documents: every step, empty.
  assert.deepEqual(stepDocs([], 'feature'), { spec: [], investigate: [], plan: [], build: [], test: [], review: [], ship: [], none: [] });
});

test('stepDocs: a bug job’s triage, reproduce and diagnose briefs go to Spec, Investigate and Plan', () => {
  const byStep = filesOf(stepDocs(['briefs/001-triage.md', 'briefs/002-reproduce.md', 'briefs/003-diagnose.md'].map(doc), 'bug'));
  assert.deepEqual(byStep.spec, ['briefs/001-triage.md']);
  assert.deepEqual(byStep.investigate, ['briefs/002-reproduce.md']);
  assert.deepEqual(byStep.plan, ['briefs/003-diagnose.md']);
});

// ---------- The Tester's check counts (Task 5c, design 3.5) ----------

test('checkCounts counts each acceptance line once', async () => {
  const { checkCounts } = await import('../lib/job-page.js');
  const report = [
    '# Test report',
    '',
    '## Results',
    '- AC-1 PASS',
    '- AC-2 FAIL',
    '- AC-2 PASS',
    '- AC-3 NOT RUN',
    '',
    '## Evidence',
    '- AC-1: Managers see the Hours column. Spec: evidence/specs/AC-1.spec.mjs',
  ].join('\n');
  assert.deepEqual(checkCounts(report), { passed: 2, failed: 0, notRun: 1 });
  // A table row counts the same, and its last mention still wins.
  assert.deepEqual(checkCounts('| AC-1 | Managers see it | FAIL |\n| AC-01 | Again | PASS |\n| AC-2 | Export | FAIL |\n'), { passed: 1, failed: 1, notRun: 0 });
});

test('a report with no marks is null', async () => {
  const { checkCounts } = await import('../lib/job-page.js');
  assert.equal(checkCounts('# Test report\n\n- AC-1: Managers see the Hours column.\n- Everything PASS here names no line.\n'), null);
  assert.equal(checkCounts(''), null);
  assert.equal(checkCounts(null), null);
});

test('every AC on one line gets the line’s mark', async () => {
  const { checkCounts } = await import('../lib/job-page.js');
  assert.deepEqual(checkCounts('- AC-1, AC-2: PASS\n- AC-3 and AC-4 FAIL\n'), { passed: 2, failed: 2, notRun: 0 });
  // The later line for the same AC still wins.
  assert.deepEqual(checkCounts('- AC-1, AC-2: PASS\n- AC-2 FAIL\n'), { passed: 1, failed: 1, notRun: 0 });
});

test('a line with both PASS and FAIL counts as failed', async () => {
  const { checkCounts } = await import('../lib/job-page.js');
  assert.deepEqual(checkCounts('- AC-2 expected PASS, got FAIL\n'), { passed: 0, failed: 1, notRun: 0 });
  assert.deepEqual(checkCounts('- AC-2 FAIL, then PASS on a retry of another check\n'), { passed: 0, failed: 1, notRun: 0 });
  assert.deepEqual(checkCounts('- AC-3 PASSED before, FAILED now\n'), { passed: 0, failed: 1, notRun: 0 });
});

test('PASSED and FAILED count; lower case does not', async () => {
  const { checkCounts } = await import('../lib/job-page.js');
  assert.deepEqual(checkCounts('- AC-1 PASSED\n- AC-2 FAILED\n- AC-3 NOT RUN\n'), { passed: 1, failed: 1, notRun: 1 });
  assert.equal(checkCounts('- AC-1 passed\n- AC-2 failed\n- AC-3 should pass\n'), null);
  // Whole words only.
  assert.equal(checkCounts('- AC-1 PASSES\n- AC-2 FAILING\n- AC-3 BYPASS\n'), null);
});

// ---------- Fix round 1 ----------

test('stepDocs: a bug job’s repro.md is under Investigate, its diagnosis.md under Plan and Build; a feature job is unchanged', () => {
  const docs = ['repro.md', 'diagnosis.md', 'findings.md'].map(doc);
  const bug = filesOf(stepDocs(docs, 'bug'));
  assert.deepEqual(bug.investigate, ['repro.md', 'findings.md']);
  assert.deepEqual(bug.plan, ['diagnosis.md']);
  assert.deepEqual(bug.build, ['diagnosis.md']);
  assert.deepEqual(bug.none, []);
  const feature = filesOf(stepDocs(docs, 'feature'));
  assert.deepEqual(feature.investigate, ['findings.md']);
  assert.deepEqual(feature.plan, []);
  assert.deepEqual(feature.build, []);
  assert.deepEqual(feature.none, ['repro.md', 'diagnosis.md']);
});

test('stepDocs: wireframes.brief.md sits with the wireframes, under Spec', () => {
  assert.deepEqual(filesOf(stepDocs([doc('wireframes.html'), doc('wireframes.brief.md')], 'feature')).spec, ['wireframes.html', 'wireframes.brief.md']);
});

test('stepTimes: briefs whose times are out of order give no step that ends before it starts', () => {
  // The spec brief was rewritten after the investigate brief: its file time is the later one.
  const briefs = [brief(1, 'spec', '09:50'), brief(2, 'investigate', '09:40'), brief(3, 'plan', '10:30')];
  const times = stepTimes({ briefs, startedAt: H('08:00'), stage: 'implement', kind: 'feature', skipped: [] });
  for (const [stop, t] of Object.entries(times)) {
    if (t.startedAt && t.endedAt) assert.ok(Date.parse(t.endedAt) >= Date.parse(t.startedAt), `${stop}: ${t.startedAt} to ${t.endedAt}`);
  }
  assert.deepEqual(times.spec, { startedAt: H('08:00'), endedAt: H('09:50') });
  assert.deepEqual(times.investigate, { startedAt: null, endedAt: H('09:40') });
  // The next step starts at the latest time seen so far, not at the earlier end.
  assert.deepEqual(times.plan, { startedAt: H('09:50'), endedAt: H('10:30') });
  assert.deepEqual(times.build, { startedAt: H('10:30'), endedAt: null });
});

test('stepTimes: a closed job’s current step ends; an open job’s does not', () => {
  const briefs = [brief(1, 'spec', '09:10'), brief(2, 'pr1', '11:00')];
  const args = { briefs, startedAt: H('08:00'), stage: 'pr1', kind: 'feature', skipped: ['investigate', 'spec-update', 'plan', 'implement', 'test', 'review'] };
  assert.deepEqual(stepTimes(args).ship, { startedAt: H('09:10'), endedAt: null });
  // Closed with its time known: the step ends then.
  assert.deepEqual(stepTimes({ ...args, closed: { at: H('11:20'), as: 'done' } }).ship, { startedAt: H('09:10'), endedAt: H('11:20') });
  // Closed with no time known: at its own last brief.
  assert.deepEqual(stepTimes({ ...args, closed: { as: 'dropped' } }).ship, { startedAt: H('09:10'), endedAt: H('11:00') });
});

// ---------- Plan, Build and Ship facts (Task 4, design 3.2) ----------

test('planSteps reads the S headings in order', () => {
  const text = [
    '# Implementation plan',
    '',
    '## Steps',
    '### S1: The form',
    'Build the form.',
    '### S2: The list: sorted by name',
    '### Notes',
    '```',
    '### S99: not a heading, inside a code block',
    '```',
    ...Array.from({ length: 7 }, (_, i) => `### S${i + 3}: Step ${i + 3}`),
    '### S10: After nine',
    '## S11: a level-two heading is not a step',
  ].join('\n');
  const steps = planSteps(text);
  assert.deepEqual(steps.slice(0, 2), [{ id: 'S1', name: 'The form' }, { id: 'S2', name: 'The list: sorted by name' }]);
  assert.deepEqual(steps.map((s) => s.id), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10'], 'as written: S10 after S9');
});

test('planSteps keeps at most 50 steps, each name cut at 200 characters (final fixes C2)', () => {
  const text = Array.from({ length: 80 }, (_, i) => `### S${i + 1}: ${'n'.repeat(500)}`).join('\n');
  const steps = planSteps(text);
  assert.equal(steps.length, 50);
  assert.equal(steps.at(-1).id, 'S50', 'the first 50, in the order written');
  assert.ok(steps.every((s) => s.name.length === 200));
  assert.deepEqual(planSteps('### S1: Short'), [{ id: 'S1', name: 'Short' }], 'a short plan is as it was');
});

test('a plan with no S headings has no steps', () => {
  // A plan from before this change (Review Focus 1): numbered steps, no ### S1 headings.
  assert.deepEqual(planSteps('# Plan\n\n## Step 1: the form\n1. Build it.\n### Testing\n'), []);
  assert.deepEqual(planSteps(''), []);
  assert.deepEqual(planSteps(null), []);
});

test('stepStates: a step with a commit is done, the first without one is being built, the rest are not yet', () => {
  const steps = ['S1', 'S2', 'S3', 'S4'].map((id) => ({ id, name: `Step ${id}` }));
  // What parseLog gives for `[S1] the form`, `S2: the list` and `Fix a typo`.
  const commits = parseLog(['[S1] the form', 'S2: the list', 'Fix a typo'].map((s, i) => `sha${i}\x1fs${i}\x1fme\x1f2026-11-10T09:00:00Z\x1f${s}\x1e`).join('\n'));
  assert.deepEqual(commits.map((c) => c.step), ['S1', 'S2', null]);
  const states = (building) => stepStates(steps, commits, building).map((s) => s.state);
  assert.deepEqual(states(true), ['done', 'done', 'now', 'next']);
  assert.deepEqual(states(false), ['done', 'done', 'next', 'next']);
  assert.deepEqual(stepStates(steps, commits, true)[0], { id: 'S1', name: 'Step S1', state: 'done' });
  // Only an exact id: a commit for S10 does not finish S1.
  assert.deepEqual(stepStates([{ id: 'S1', name: 'a' }, { id: 'S10', name: 'b' }], [{ step: 'S10' }], false).map((s) => s.state), ['next', 'done']);
  assert.deepEqual(stepStates([], [{ step: 'S1' }], true), []);
});

test('a job at Plan has its plan’s steps, all next, and reads no commits', async () => {
  const text = '### S1: The form\n### S2: The list\n';
  let reads = 0;
  const readCommits = async () => { reads++; return [{ step: 'S1' }]; };
  assert.deepEqual(await planView({ text, version: '1', stage: 'plan', building: false, readCommits }), {
    version: '1', steps: [{ id: 'S1', name: 'The form', state: 'next' }, { id: 'S2', name: 'The list', state: 'next' }],
  });
  assert.equal(reads, 0, 'before Build no commits are read');
  // At Build the commits are read once: S1 is built, S2 is being built.
  assert.deepEqual((await planView({ text, version: '1', stage: 'implement', building: true, readCommits })).steps.map((s) => s.state), ['done', 'now']);
  assert.equal(reads, 1);
  // A git read that fails gives no commits, never an error.
  const failing = async () => { throw new Error('not a git repository'); };
  assert.deepEqual((await planView({ text, stage: 'review', building: false, readCommits: failing })).steps.map((s) => s.state), ['next', 'next']);
  // No steps: no plan.
  assert.equal(await planView({ text: '# Plan\n', stage: 'implement', building: true, readCommits }), null);
});

const LANE_PR = (over = {}) => ({
  number: 7, title: 'Hours column', url: 'https://github.com/o/r/pull/7', state: 'open', head: 'feature/x', base: 'feature/x',
  review: null, checks: 'pending', mergedAt: null, updatedAt: '2026-11-10T10:00:00.000Z', createdAt: '2026-11-10T09:00:00.000Z', ...over,
});

test('prRows: PR #1 open and waiting for a review, the other two not started', () => {
  const prs = [{ number: 1, label: 'fork → org branch', url: 'https://github.com/o/r/pull/7', state: 'open' }, { number: 2, url: null, state: 'not_started' }, { number: 3, url: null, state: 'not_started' }];
  const rows = prRows(prs, { pr1: LANE_PR(), pr2: null });
  assert.deepEqual(rows[0], {
    n: 1, number: 7, title: 'Hours column', url: 'https://github.com/o/r/pull/7', state: 'open', review: 'waiting', checks: 'running',
    openedAt: '2026-11-10T09:00:00.000Z', updatedAt: '2026-11-10T10:00:00.000Z',
  });
  const notStarted = (n) => ({ n, number: null, title: null, url: null, state: 'not-started', review: null, checks: null, openedAt: null, updatedAt: null });
  assert.deepEqual(rows.slice(1), [notStarted(2), notStarted(3)]);
  // An old job, or none known at all: still three rows.
  assert.deepEqual(prRows(null, null), [notStarted(1), notStarted(2), notStarted(3)]);
  assert.deepEqual(prRows('nonsense', 'nonsense'), [notStarted(1), notStarted(2), notStarted(3)]);
  // status.json alone (the flow map hasn't read GitHub): its url gives the number, and nothing it can't know.
  assert.deepEqual(prRows([{ number: 1, url: 'https://github.com/o/r/pull/12', state: 'merged' }], null)[0], {
    n: 1, number: 12, title: null, url: 'https://github.com/o/r/pull/12', state: 'merged', review: null, checks: null, openedAt: null, updatedAt: null,
  });
});

test('prRows maps the flow map’s review and checks words', () => {
  const one = (over) => prRows([], { pr1: LANE_PR(over), pr2: null })[0];
  assert.equal(one({ review: 'changes_requested' }).review, 'changes');
  assert.equal(one({ review: 'approved' }).review, 'approved');
  assert.equal(one({ review: 'review_required' }).review, 'waiting');
  assert.equal(one({ review: null }).review, 'waiting');
  assert.equal(one({ review: 'something new' }).review, null, 'an unknown word is not known');
  assert.equal(one({ checks: 'passing' }).checks, 'passed');
  assert.equal(one({ checks: 'pending' }).checks, 'running');
  assert.equal(one({ checks: 'failing' }).checks, 'failed');
  assert.equal(one({ checks: null }).checks, null);
  assert.equal(one({ checks: 'odd' }).checks, null);
  assert.equal(one({ review: 'constructor', checks: 'toString' }).review, null, 'not one of Object’s own names either');
  assert.equal(prRows([{ number: 1, state: 'constructor' }], null)[0].state, 'not-started');
  // A review word on a pull request that is not open says nothing.
  assert.equal(one({ state: 'merged', review: 'approved' }).review, null);
  assert.equal(one({ state: 'merged' }).state, 'merged');
  assert.equal(one({ state: 'draft' }).state, 'draft');
  assert.equal(one({ state: 'closed' }).state, 'closed');
  assert.equal(one({ createdAt: undefined }).openedAt, null, 'not read by the flow map yet');
  // PR #2 comes from the lane's pr2; PR #3 from status.json only.
  const rows = prRows([{ number: 3, url: 'https://github.com/o/r/pull/30', state: 'open' }], { pr1: null, pr2: LANE_PR({ number: 9, url: 'https://github.com/o/r/pull/9', state: 'merged' }) });
  assert.deepEqual(rows.map((r) => [r.n, r.number, r.state]), [[1, null, 'not-started'], [2, 9, 'merged'], [3, 30, 'open']]);
});

// ---------- Fix round 1 (Task 4) ----------

test('planSteps drops a heading’s closing #s, and a ``` line inside a ~~~ block doesn’t end it', () => {
  assert.deepEqual(planSteps('### S1: The form ###\n### S2: C# client\n'), [{ id: 'S1', name: 'The form' }, { id: 'S2', name: 'C# client' }]);
  const text = ['~~~', '```', '### S9: inside the ~~~ block', '~~~', '### S1: After the block', '````', '```', '### S8: still inside', '````'].join('\n');
  assert.deepEqual(planSteps(text), [{ id: 'S1', name: 'After the block' }]);
});

test('a job closed as done, or whose PR #1 is merged, has every plan step done; one closed as dropped keeps what the commits say', async () => {
  const merged = [{ number: 1, url: 'https://github.com/o/r/pull/7', state: 'merged' }];
  assert.equal(planDone({ closed: { as: 'done', at: H('12:00') }, prs: null, lane: null }), true);
  assert.equal(planDone({ closed: null, prs: merged, lane: null }), true, 'PR #1 merged by status.json');
  assert.equal(planDone({ closed: null, prs: null, lane: { pr1: { number: 7, state: 'merged' }, pr2: null } }), true, 'PR #1 merged by the flow map');
  assert.equal(planDone({ closed: { as: 'dropped', at: H('12:00') }, prs: null, lane: null }), false);
  assert.equal(planDone({ closed: null, prs: [{ number: 1, url: 'https://github.com/o/r/pull/7', state: 'open' }], lane: null }), false);
  assert.equal(planDone({}), false);
  const text = '### S1: The form\n### S2: The list\n';
  let reads = 0;
  // The base branch has the job's commits now (or the branch is gone): the read finds none.
  const readCommits = async () => { reads++; return []; };
  const done = await planView({ text, stage: 'pr3', building: false, finished: true, readCommits });
  assert.deepEqual(done.steps.map((s) => s.state), ['done', 'done']);
  assert.equal(reads, 0, 'a finished job reads no commits');
  const dropped = await planView({ text, stage: 'implement', building: false, finished: false, readCommits: async () => [{ step: 'S1' }] });
  assert.deepEqual(dropped.steps.map((s) => s.state), ['done', 'next']);
});

test('keepLatest keeps a small number of entries, the oldest out first', () => {
  const m = new Map();
  for (const k of ['a', 'b', 'c']) keepLatest(m, k, k.toUpperCase(), 2);
  assert.deepEqual([...m.keys()], ['b', 'c']);
  keepLatest(m, 'b', 'B2', 2); // set again: now the newest
  keepLatest(m, 'd', 'D', 2);
  assert.deepEqual([...m.entries()], [['b', 'B2'], ['d', 'D']]);
});
