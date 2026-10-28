// A job's "Your decisions" log (lib/decisions.js): what counts as your decision, in words, newest first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decisionId, decisionLog, decisionOf, decisionPrefix, decisionRows, gateAnswers, gateNote } from '../lib/decisions.js';

test('approvals, send-backs with their note, stops, permissions, levels, closing', () => {
  const log = decisionLog([
    { at: '2026-10-26T10:00:00Z', action: 'send', kind: 'approve', gateBrief: 2, text: 'I approve.' },
    { at: '2026-10-26T10:05:00Z', action: 'send', kind: 'changes', gateBrief: 3, text: '\nKeep the old column.\nAnd more.' },
    { at: '2026-10-26T10:06:00Z', action: 'send', kind: 'message', text: 'a question' },
    { at: '2026-10-26T10:07:00Z', action: 'permission', decision: 'deny', headline: 'Run rm -rf', note: 'not that' },
    { at: '2026-10-26T10:08:00Z', action: 'options', options: { level: 3 }, was: 2, via: 'gate' },
    { at: '2026-10-26T10:09:00Z', action: 'auto-allowed', headline: 'Read' },
    { at: '2026-10-26T10:10:00Z', action: 'close', as: 'dropped' },
  ]);
  assert.deepEqual(log.map((d) => d.text), ['Dropped the job', 'Level L2 → L3 (from a gate)', 'Said no to: Run rm -rf', 'Sent back brief 3 for changes', 'Approved brief 2']);
  assert.equal(log[3].note, 'Keep the old column.');
  assert.equal(log[2].note, 'not that');
  assert.equal('note' in log[0], false);
});

test('anything else is not a decision', () => {
  for (const e of [null, {}, { action: 'steer', text: 'x' }, { action: 'run-ended' }, { action: 'send', kind: 'resume' }]) assert.equal(decisionOf(e), null);
});

test('automatic picks and your overrides are in the log', () => {
  const log = decisionLog([
    { at: '2026-10-26T10:00:00Z', action: 'auto-level', how: 'chose', level: 2, was: null },
    { at: '2026-10-26T10:05:00Z', action: 'options', options: { level: 1 }, was: 2, overrode: 'auto' },
    { at: '2026-10-26T10:09:00Z', action: 'auto-level', how: 'diff', level: 3, was: 1 },
  ]);
  assert.deepEqual(log.map((d) => d.text), ['Level L1 → L3 (automatic, after a build)', 'Level L2 → L1 (you changed the automatic pick)', 'Level L2 (automatic)']);
});

test('automatic picks and your overrides are in the log', () => {
  const log = decisionLog([
    { at: '2026-10-26T10:00:00Z', action: 'auto-level', how: 'chose', level: 2, was: null },
    { at: '2026-10-26T10:05:00Z', action: 'options', options: { level: 1 }, was: 2, overrode: 'auto' },
    { at: '2026-10-26T10:09:00Z', action: 'auto-level', how: 'diff', level: 3, was: 1 },
  ]);
  assert.deepEqual(log.map((d) => d.text), ['Level L1 → L3 (automatic, after a build)', 'Level L2 → L1 (you changed the automatic pick)', 'Level L2 (automatic)']);
});

// ---------- decisions.md ----------

test('ids: the ticket key when there is one, else orbit-<n>- from the slug, else the slug', () => {
  assert.equal(decisionPrefix({ slug: 'feedback-api', ticketKey: 'ORBIT-479' }), 'ORBIT-479');
  assert.equal(decisionPrefix({ slug: 'feedback-api', ticketKey: 'orbit-12' }), 'ORBIT-12');
  assert.equal(decisionPrefix({ slug: 'orbit-479-feedback-api' }), 'ORBIT-479');
  assert.equal(decisionPrefix({ slug: 'orbit-0479-feedback-api' }), 'ORBIT-479');
  assert.equal(decisionPrefix({ slug: 'orbital-sander' }), 'orbital-sander');
  assert.equal(decisionPrefix({ slug: 'add-csv-export', ticketKey: 'not a key' }), 'add-csv-export');
  assert.equal(decisionId('ORBIT-479', 3), 'ORBIT-479.D3');
  assert.equal(decisionId('add-csv-export', 1), 'add-csv-export.D1');
});

// A job's audit lines, oldest first, as the dashboard writes them.
const AUDIT = [
  { at: '2026-10-27T09:00:00Z', action: 'new-job', featureDir: '/f/orbit-479-feedback-api' },
  { at: '2026-10-27T09:10:00Z', action: 'send', kind: 'approve', gateBrief: 1, text: 'My answers to brief 1:\n1. Write-back from agents? → a) None\n2. Who sees it? → b) Office managers. Only Phoenix for now\n\nI approve. Go ahead with the next stage: write the spec\nAt these versions: spec v0.1 (draft).\nagents must not write; people paste links' },
  { at: '2026-10-27T09:20:00Z', action: 'permission', decision: 'allow', headline: 'Read the env file' },
  { at: '2026-10-27T09:21:00Z', action: 'permission', decision: 'deny', headline: 'Run rm -rf build | tee x', note: 'not on my machine' },
  { at: '2026-10-27T09:22:00Z', action: 'permission', decision: 'allow', tool: 'AskUserQuestion', answers: { 'Keep the old column?': 'Yes' } },
  { at: '2026-10-27T09:30:00Z', action: 'options', options: { level: 3 }, was: 2, via: 'gate' },
  { at: '2026-10-27T09:31:00Z', action: 'options', options: { level: 3, fable: [] }, was: 3 },
  { at: '2026-10-27T09:32:00Z', action: 'auto-level', level: 2, was: 3 },
  { at: '2026-10-27T09:40:00Z', action: 'send', kind: 'changes', gateBrief: 2, text: 'Please make changes before moving on, and stay in the current stage:\nKeep the export button where it is.' },
  { at: '2026-10-27T09:41:00Z', action: 'send', kind: 'message', text: 'just a question' },
  { at: '2026-10-28T08:00:00Z', action: 'send', kind: 'stop', text: 'Stop here. Record where things stand in workflow-status.md and don’t start anything else.' },
];

test('rows: gate decisions with their answers and note, level changes, questions answered, permissions with a reason', () => {
  const rows = decisionRows(AUDIT, { prefix: 'ORBIT-479', person: 'Vignesh', briefs: { 1: 'clarify', 2: 'spec' } });
  assert.deepEqual(rows.map((r) => [r.id, r.question, r.choice, r.why]), [
    ['ORBIT-479.D1', 'Write-back from agents?', 'None', ''],
    ['ORBIT-479.D2', 'Who sees it?', 'Office managers. Only Phoenix for now', ''],
    ['ORBIT-479.D3', 'Brief 1 (clarify): go ahead?', 'approve', 'agents must not write; people paste links'],
    ['ORBIT-479.D4', 'Allow “Run rm -rf build | tee x”?', 'say no', 'not on my machine'],
    ['ORBIT-479.D5', 'Keep the old column?', 'Yes', ''],
    ['ORBIT-479.D6', 'Level for this job', 'L3', 'was L2, from a gate'],
    ['ORBIT-479.D7', 'Brief 2 (spec): go ahead?', 'send back', 'Keep the export button where it is.'],
    ['ORBIT-479.D8', 'The Foreman’s latest brief: go ahead?', 'stop', ''],
  ]);
  assert.ok(rows.every((r) => r.who === 'Vignesh'));
  assert.deepEqual(rows.map((r) => r.when), ['2026-10-27', '2026-10-27', '2026-10-27', '2026-10-27', '2026-10-27', '2026-10-27', '2026-10-27', '2026-10-28']);
  assert.equal(rows[2].options, 'approve · send back · stop');
  assert.equal(rows[5].options, 'L0 · L1 · L2 · L3');
});

test('the note typed on the card is read back out of the reply; an edited reply gives its first own line', () => {
  assert.equal(gateNote('approve', 'I approve. Go ahead with the next stage you proposed.'), '');
  assert.equal(gateNote('changes', 'Please make changes before moving on, and stay in the current stage:\n(describe the changes)'), '');
  assert.equal(gateNote('stop', 'Stop here. Record where things stand.\nOut of time this week.'), 'Out of time this week.');
  assert.equal(gateNote('approve', 'My answers to brief 2:\n1. Q → a) x\n\nLooks fine, ship the spec.\nThanks'), 'Looks fine, ship the spec.');
  assert.deepEqual(gateAnswers('I approve.'), []);
});
