// A job's "Your decisions" log (lib/decisions.js): what counts as your decision, in words, newest first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decisionId, decisionLog, decisionOf, decisionPrefix } from '../lib/decisions.js';

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
