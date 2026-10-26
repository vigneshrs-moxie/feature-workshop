// How long a Foreman reply usually takes (lib/run-typical.js), for the running rows' time left.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { typicalRuns } from '../lib/run-typical.js';

const at = (min) => new Date(Date.UTC(2026, 9, 26, 10, min)).toISOString();
const run = (id, kind, start, mins, status = 'done') => [
  { action: 'send', runId: id, kind, at: at(start) },
  { action: 'run-ended', runId: id, status, at: at(start + mins) },
];

test('medians per kind and overall, from finished replies only', () => {
  const audit = [...run('a', 'approve', 0, 10), ...run('b', 'approve', 0, 20), ...run('c', 'approve', 0, 30), ...run('d', 'message', 0, 2), ...run('e', 'approve', 0, 99, 'stopped')];
  const t = typicalRuns(audit);
  assert.equal(t.byKind.approve, 20 * 60_000);
  assert.equal(t.byKind.message, undefined); // one isn't enough
  assert.equal(t.all, 15 * 60_000); // 2, 10, 20, 30
});

test('too few replies: no estimate', () => {
  assert.deepEqual(typicalRuns(run('a', 'approve', 0, 5)), { all: null, byKind: {} });
});
