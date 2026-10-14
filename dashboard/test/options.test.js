import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { normalize, defaultsFor, skippedFor, describeOptions, readOptions, writeOptions, FLOWS } from '../lib/options.js';

test('job options: flows bring their defaults; your choices win', () => {
  const quick = normalize({ flow: 'quick' });
  assert.deepEqual(quick.skip, ['spec', 'refine', 'investigate', 'spec-update']);
  assert.deepEqual(quick.reviewers, ['feature-reviewer']);
  assert.equal(quick.manual_test, true);
  assert.deepEqual(normalize({ flow: 'large' }).fable_checks, ['plan', 'review']);
  assert.equal(FLOWS.quick.model, 'claude-opus-5-5', 'Fable is not the default Foreman for quick jobs');
  assert.equal(normalize({ flow: 'nonsense' }).flow, 'auto');

  const mine = normalize({ flow: 'small', skip: ['review', 'bogus'], reviewers: ['feature-review-permissions', 'nope'], fable_checks: ['plan'], review_rounds: 2, notes: ' keep it small ' });
  assert.deepEqual(mine.skip, ['review'], 'unknown stages are dropped');
  assert.deepEqual(mine.reviewers, ['feature-review-permissions']);
  assert.equal(mine.review_rounds, 2);
  assert.deepEqual(mine.fable_checks, ['plan'], 'Fable checks can be asked for on a small job');
  assert.equal(mine.notes, 'keep it small');
  assert.ok(normalize({ reviewers: [] }).skip.includes('review'), 'no reviewers means no review stage');
});

test('job options: documents you already have skip their stage and must exist', () => {
  const exists = (p) => p === '/plans/spec.md';
  const o = normalize({ flow: 'small', provided: { spec: '/plans/spec.md' } }, { exists });
  assert.equal(o.provided.spec, '/plans/spec.md');
  assert.ok(o.skip.includes('spec') && o.skip.includes('refine'));
  assert.throws(() => normalize({ provided: { plan: 'relative/plan.md' } }, { exists }), /full path/);
  assert.throws(() => normalize({ provided: { plan: '/missing.md' } }, { exists }), /no file/);
});

test('job options: skipped stages, the plain summary, and the file round trip', async () => {
  assert.deepEqual(skippedFor('small', null), ['refine']);
  assert.deepEqual(skippedFor('quick', null).sort(), ['investigate', 'refine', 'spec', 'spec-update']);
  assert.deepEqual(skippedFor('large', { skip: ['review'] }), ['review']);
  const lines = describeOptions(defaultsFor('quick'));
  assert.match(lines[0], /Quick/);
  assert.ok(lines.some((l) => /tests it by hand/.test(l)));

  const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-options-')), 'job');
  await writeOptions(dir, normalize({ flow: 'quick' }), { title: 'Fix the thing', repo: '/r', kind: 'bug', evil: 'x' });
  const back = await readOptions(dir);
  assert.equal(back.flow, 'quick');
  assert.equal(back.title, 'Fix the thing');
  assert.equal(back.evil, undefined, 'only title, repo and kind ride along');
  assert.equal(await readOptions(path.join(dir, 'missing')), null);
});
