import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { normalize, defaultsFor, skippedFor, describeOptions, readOptions, writeOptions, FLOWS, LEVELS, flowFor, levelFor, foremanModel, OPUS, FABLE, SONNET, HAIKU } from '../lib/options.js';

test('job options: flows bring their defaults; your choices win', () => {
  const quick = normalize({ flow: 'quick' });
  assert.deepEqual(quick.skip, ['spec', 'refine', 'investigate', 'spec-update']);
  assert.deepEqual(quick.reviewers, ['feature-reviewer']);
  assert.equal(quick.manual_test, true);
  assert.deepEqual(normalize({ flow: 'large' }).fable_checks, ['plan', 'review'], 'large asks Fable for second looks; the Foreman stays Opus');
  for (const [id, f] of Object.entries(FLOWS)) assert.equal(f.model, OPUS, `no flow (${id}) defaults to a Fable Foreman`);
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
  assert.equal(lines[0], 'Level: L1 Small (quick flow).');
  assert.ok(lines.some((l) => /tests it by hand/.test(l)));
  assert.equal(describeOptions(defaultsFor('auto'))[0], 'Flow: Let the Foreman decide.', 'no level yet: today’s flow line');

  const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-options-')), 'job');
  await writeOptions(dir, normalize({ flow: 'quick' }), { title: 'Fix the thing', repo: '/r', kind: 'bug', evil: 'x' });
  const back = await readOptions(dir);
  assert.equal(back.flow, 'quick');
  assert.equal(back.title, 'Fix the thing');
  assert.equal(back.evil, undefined, 'only title, repo and kind ride along');
  assert.equal(await readOptions(path.join(dir, 'missing')), null);
});

test('levels: four of them, each with a hint, and the flow an old skill reads', () => {
  assert.deepEqual(LEVELS.map((l) => `L${l.level} ${l.name}`), ['L0 Tweak', 'L1 Small', 'L2 Standard', 'L3 Large']);
  for (const l of LEVELS) {
    assert.ok(l.hint.length > 10, `L${l.level} has a one-line hint`);
    assert.equal(l.models.foreman, OPUS, `L${l.level}: the Foreman is Opus`);
  }
  assert.equal(LEVELS[0].models.build, SONNET, 'L0 builds on Sonnet');
  assert.deepEqual([0, 1, 2, 3].map(flowFor), ['quick', 'quick', 'small', 'large']);
  assert.equal(flowFor(7), 'auto');
  assert.deepEqual(['quick', 'small', 'large', 'auto', 'bogus'].map(levelFor), [1, 2, 3, null, null]);
});

test('job options: a level brings its defaults and keeps flow in step with it', () => {
  const l0 = normalize({ level: 0 });
  assert.equal(l0.level, 0);
  assert.equal(l0.flow, 'quick');
  assert.ok(['plan', 'test', 'review'].every((s) => l0.skip.includes(s)), 'L0: one build, no plan, tester or reviewers');
  assert.deepEqual(l0.reviewers, []);
  assert.deepEqual(l0.models, { foreman: OPUS, build: SONNET, checks: SONNET });

  const l3 = normalize({ level: 3, flow: 'quick' });
  assert.equal(l3.flow, 'large', 'the level wins over a flow that disagrees');
  assert.deepEqual(l3.fable_checks, ['plan', 'review']);
  assert.equal(l3.models.foreman, OPUS);

  assert.equal(normalize({ level: '2' }).level, 2, 'a level from a form field');
  assert.equal(normalize({ flow: 'small' }).level, 2, 'a v1 flow maps to its level');
  assert.equal(normalize({ flow: 'auto' }).level, null, 'auto: no level yet, the rules and the Foreman suggest one');
  assert.equal(normalize({}).level, null);
  assert.throws(() => normalize({ level: 4 }), /L0, L1, L2 or L3/);
  assert.throws(() => normalize({ level: 1.5 }), /L0, L1, L2 or L3/);

  // A page that only knows flows (the classic one) keeps the level when its flow still matches.
  assert.equal(normalize({ flow: 'quick' }, { previous: { level: 0, flow: 'quick' } }).level, 0);
  assert.equal(normalize({ flow: 'small' }, { previous: { level: 0, flow: 'quick' } }).level, 2, 'a new flow picks its own level');
  assert.equal(normalize({ level: 1 }, { previous: { level: 0 } }).level, 1);
});

test('job options: models must be ones the crew knows; review rounds go up to 3', () => {
  const o = normalize({ level: 2, models: { build: SONNET, checks: HAIKU, extra: 'x' } });
  assert.deepEqual(o.models, { foreman: OPUS, build: SONNET, checks: HAIKU });
  assert.equal(normalize({ level: 2, models: { foreman: FABLE } }).models.foreman, FABLE, 'you can still ask for Fable yourself');
  assert.throws(() => normalize({ models: { build: 'gpt-9' } }), /isn’t a model/);
  assert.equal(normalize({ review_rounds: 3 }).review_rounds, 3);
  assert.equal(normalize({ review_rounds: 4 }).review_rounds, 1, '4 rounds is not allowed; the default stands');
  assert.equal(normalize({ review_rounds: 0 }).review_rounds, 1);
});

test('job options: L3 never starts a Fable Foreman', () => {
  const allowed = [OPUS, FABLE, HAIKU];
  assert.equal(foremanModel(undefined, normalize({ level: 3 }), allowed), OPUS);
  assert.equal(foremanModel(undefined, normalize({ flow: 'large' }), allowed), OPUS, 'nor does the large flow');
  assert.equal(foremanModel('nonsense', normalize({ level: 3 }), allowed), OPUS);
  assert.equal(foremanModel(undefined, null, allowed), OPUS);
  assert.equal(foremanModel(HAIKU, normalize({ level: 3 }), allowed), HAIKU, 'the model you pick wins');
  assert.equal(foremanModel(SONNET, normalize({ level: 1 }), allowed), OPUS, 'only models offered for the Foreman can be picked');
});

test('job options: describeOptions leads with the level', () => {
  const lines = describeOptions(normalize({ level: 2 }));
  assert.equal(lines[0], 'Level: L2 Standard (small flow).');
  assert.ok(lines.some((l) => l.startsWith('Reviewers:')) && lines.some((l) => l.startsWith('Fable checks:')), 'the old lines follow');
  assert.equal(describeOptions(normalize({ level: 0 }))[0], 'Level: L0 Tweak (quick flow).');
});

test('job options: schema 2 is written with every v1 field; schema 1 files still load', async () => {
  const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-options-v2-')), 'job');
  const from = { id: 'abc', chain: ['abc'], mode: 'summary', branch: null, cwd: '/r' };
  await writeOptions(dir, normalize({ level: 2, notes: 'n' }), { title: 'T', repo: '/r', kind: 'feature', from_session: from });
  const written = JSON.parse(await fs.readFile(path.join(dir, 'options.json'), 'utf8'));
  assert.equal(written.schema_version, 2);
  for (const k of ['flow', 'skip', 'provided', 'reviewers', 'review_rounds', 'manual_test', 'fable_checks', 'notes', 'kind', 'title', 'repo', 'from_session', 'updated_at']) {
    assert.ok(k in written, `schema 2 still carries ${k}`);
  }
  assert.equal(written.flow, 'small');
  assert.equal(written.level, 2);
  assert.deepEqual(Object.keys(written.models).sort(), ['build', 'checks', 'foreman']);

  // A job started before levels: schema 1, a flow and no level or models.
  const old = path.join(path.dirname(dir), 'old-job');
  await fs.mkdir(old);
  await fs.writeFile(path.join(old, 'options.json'), JSON.stringify({
    schema_version: 1, flow: 'quick', skip: ['spec', 'refine', 'investigate', 'spec-update'], provided: {}, reviewers: ['feature-reviewer'],
    review_rounds: 2, manual_test: true, fable_checks: [], notes: '', title: 'Old', repo: '/r', kind: 'bug', updated_at: '2026-10-10T10:00:00Z',
  }));
  const back = await readOptions(old);
  assert.equal(back.schema_version, 1, 'read as it is; rewritten as schema 2 only when saved');
  assert.equal(back.level, 1, 'quick flow is L1');
  assert.equal(back.review_rounds, 2);
  assert.equal(back.models.foreman, OPUS);
  assert.equal(describeOptions(back)[0], 'Level: L1 Small (quick flow).');
  const again = normalize(back, { previous: back });
  assert.equal(again.level, 1);
  assert.equal(again.flow, 'quick');
  assert.equal(again.schema_version, 2);
  assert.equal(again.review_rounds, 2);

  await fs.writeFile(path.join(old, 'options.json'), JSON.stringify({ schema_version: 1, flow: 'auto', skip: [], reviewers: 'auto', review_rounds: 1, manual_test: false, fable_checks: [] }));
  assert.equal((await readOptions(old)).level, null, 'an auto job has no level yet');
  assert.equal(describeOptions(await readOptions(old))[0], 'Flow: Let the Foreman decide.');
});
