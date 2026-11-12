// The job page's overview (Part 3, Task 1): what acceptance.md says the job is checked against.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAcceptance, stepTimes, stepDocs } from '../lib/job-page.js';

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
