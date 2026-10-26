import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { normalize, defaultsFor, skippedFor, describeOptions, readOptions, writeOptions, FLOWS, LEVELS, flowFor, levelFor, foremanModel, levelsForClient, levelChangeLine, optionsAtLevel, OPUS, FABLE, SONNET, HAIKU } from '../lib/options.js';
import { buildThread } from '../lib/thread.js';
import { workflowSettings } from '../lib/state.js';

test('job options: flows bring their defaults; your choices win', () => {
  const quick = normalize({ flow: 'quick' });
  assert.deepEqual(quick.skip, ['clarify', 'spec', 'refine', 'wireframe', 'investigate', 'spec-update']);
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

test('job options: screens and clarify follow the job’s own choice, else Settings → Workflow, else Auto', () => {
  assert.deepEqual([normalize({}).wireframes, normalize({}).clarify], ['auto', 'auto']);
  const fromSettings = normalize({ level: 2 }, { workflow: { finishLine: 'main', wireframes: 'always', clarify: 'off' } });
  assert.equal(fromSettings.wireframes, 'always');
  assert.equal(fromSettings.clarify, 'off');
  const own = normalize({ level: 2, wireframes: 'off', clarify: 'sometimes' }, { workflow: { wireframes: 'always', clarify: 'always' } });
  assert.equal(own.wireframes, 'off', 'the job’s choice wins');
  assert.equal(own.clarify, 'always', 'an unknown value falls back to the default for new jobs');
  const kept = normalize({ level: 3 }, { previous: { ...own, level: 2 } });
  assert.equal(kept.wireframes, 'off', 'a later edit keeps what the job had');
  assert.equal(optionsAtLevel(own, 0).wireframes, 'off');
  assert.ok(describeOptions(own).includes('Screens (wireframes): off.'));
  assert.ok(!describeOptions(normalize({})).some((l) => l.startsWith('Screens')), 'Auto says nothing');
  assert.deepEqual(workflowSettings({ finishLine: 'main', wireframes: 'off', clarify: 'nope' }), { finishLine: 'main', wireframes: 'off', clarify: 'auto', autoLevel: false });
  assert.deepEqual(workflowSettings(undefined), { finishLine: 'pr1-merged', wireframes: 'auto', clarify: 'auto', autoLevel: false });
});

test('job options: the clarify and wireframe stages follow their fields; L0 and L1 skip both by default', () => {
  assert.ok(LEVELS[0].skip.includes('clarify') && LEVELS[0].skip.includes('wireframe'), 'L0 never runs them');
  assert.ok(LEVELS[1].skip.includes('clarify') && LEVELS[1].skip.includes('wireframe'), 'L1 only when asked');
  assert.ok(!LEVELS[2].skip.includes('clarify') && !LEVELS[2].skip.includes('wireframe') && !LEVELS[3].skip.includes('wireframe'), 'L2 and L3 run both');
  // Always takes the stage out of the skip list (L1: asked for); Off puts it in (L2); Auto leaves the level's choice.
  assert.deepEqual(normalize({ level: 1, wireframes: 'always', clarify: 'always' }).skip, ['spec', 'refine', 'investigate', 'spec-update']);
  assert.deepEqual(normalize({ level: 2, wireframes: 'off', clarify: 'off' }).skip, ['clarify', 'refine', 'wireframe']);
  assert.deepEqual(normalize({ level: 2 }).skip, ['refine']);
  assert.deepEqual(normalize({ level: 1 }).skip, ['clarify', 'spec', 'refine', 'wireframe', 'investigate', 'spec-update']);
  assert.ok(normalize({ level: 0, wireframes: 'always' }).skip.includes('wireframe'), 'never at L0, whatever the field says');
  // The Settings → Workflow default for new jobs drives the stage the same way.
  assert.deepEqual(normalize({ level: 1 }, { workflow: { wireframes: 'always', clarify: 'auto' } }).skip, ['clarify', 'spec', 'refine', 'investigate', 'spec-update']);
  // The skip list and the levels' hints name them.
  assert.ok(describeOptions(normalize({ level: 2, clarify: 'off' })).some((l) => l.includes('Clarify (questions before the spec)')));
  assert.ok(LEVELS[2].hint.includes('Clarify') && LEVELS[2].hint.includes('screens'));
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
  assert.deepEqual(skippedFor('quick', null).sort(), ['clarify', 'investigate', 'refine', 'spec', 'spec-update', 'wireframe']);
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
  await fs.rm(path.dirname(dir), { recursive: true, force: true });
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
  assert.throws(() => normalize({ level: 2, models: { foreman: SONNET } }), /for the Foreman/, 'the Foreman runs only on the models offered for it');
  assert.equal(normalize({ level: 2, models: { build: SONNET } }).models.build, SONNET, 'Sonnet is fine for the build');
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
  assert.equal(foremanModel(undefined, { models: { foreman: SONNET } }, allowed), OPUS, 'nor named in options.json');
  assert.equal(foremanModel(undefined, { models: { foreman: HAIKU } }, allowed), HAIKU);
  assert.equal(foremanModel(undefined, { models: { foreman: SONNET } }), OPUS, 'the default list is the Foreman list');
});

test('job options: a resave that sends no models keeps the job’s own while the level stays', () => {
  const previous = normalize({ level: 2, models: { build: SONNET, checks: HAIKU, foreman: FABLE } });
  // The classic page: a flow, no level, no models.
  const resaved = normalize({ flow: 'small', review_rounds: 2 }, { previous });
  assert.equal(resaved.level, 2);
  assert.deepEqual(resaved.models, { foreman: FABLE, build: SONNET, checks: HAIKU });
  assert.equal(resaved.review_rounds, 2);
  assert.deepEqual(normalize({ level: 2 }, { previous }).models, previous.models, 'same level, no models sent');
  // A new level brings its own models; models sent win.
  assert.deepEqual(normalize({ flow: 'large' }, { previous }).models, LEVELS[3].models);
  assert.equal(normalize({ level: 2, models: { build: OPUS } }, { previous }).models.build, OPUS);
  // Anything odd in the old file isn't carried over.
  assert.equal(normalize({ level: 2 }, { previous: { level: 2, models: { foreman: SONNET, build: 'gpt-9' } } }).models.foreman, OPUS);
  assert.equal(normalize({ level: 2 }, { previous: { level: 2, models: { foreman: SONNET, build: 'gpt-9' } } }).models.build, LEVELS[2].models.build);
});

test('optionsAtLevel: manual test and models follow the new level unless they were the job’s own choice', () => {
  const exists = () => true;
  // L0 → L1 with L0's defaults (Sonnet build and checks, no manual test): L1's Opus build and your own testing.
  const l0 = normalize({ level: 0, notes: 'Tiny.', review_rounds: 2 });
  const up = optionsAtLevel(l0, 1, { exists });
  assert.equal(up.level, 1);
  assert.equal(up.flow, 'quick');
  assert.deepEqual(up.models, LEVELS[1].models, 'L0’s default models give way to L1’s');
  assert.equal(up.manual_test, true, 'L1 tests by hand by default');
  assert.deepEqual(up.skip, LEVELS[1].skip);
  assert.deepEqual(up.reviewers, LEVELS[1].reviewers);
  assert.equal(up.notes, 'Tiny.');
  assert.equal(up.review_rounds, 2);
  // L1 → L0 with L1's defaults: back to L0's Sonnet build and no manual test.
  const down = optionsAtLevel(normalize({ level: 1 }), 0, { exists });
  assert.deepEqual(down.models, LEVELS[0].models);
  assert.equal(down.manual_test, false);
  assert.deepEqual(down.skip, LEVELS[0].skip);
  // Your own choices (differing from the old level's default) are kept either way.
  const mine = normalize({ level: 1, manual_test: false, models: { build: SONNET, checks: HAIKU } });
  const kept = optionsAtLevel(mine, 0, { exists });
  assert.deepEqual(kept.models, { foreman: OPUS, build: SONNET, checks: HAIKU });
  assert.equal(kept.manual_test, false);
  const mineUp = optionsAtLevel(normalize({ level: 0, manual_test: true, models: { build: HAIKU } }), 1, { exists });
  assert.equal(mineUp.manual_test, true);
  assert.equal(mineUp.models.build, HAIKU, 'your Haiku build stays');
  assert.equal(mineUp.models.checks, LEVELS[1].models.checks, 'L0’s default checks model gives way');
  // A job with no level yet compares with its flow's defaults; documents given earlier needn't exist now.
  const auto = optionsAtLevel({ ...defaultsFor('auto'), provided: { plan: '/gone/plan.md' } }, 2, { exists: () => false });
  assert.deepEqual(auto.models, LEVELS[2].models);
  assert.deepEqual(auto.provided, { plan: '/gone/plan.md' });
  assert.ok(auto.skip.includes('plan'));
  assert.deepEqual(optionsAtLevel(null, 3, { exists }).fable_checks, ['plan', 'review']);
});

test('levels for the page: each with its hint, models, skipped stages and reviewers', () => {
  const list = levelsForClient();
  assert.deepEqual(list.map((l) => l.label), ['L0 Tweak', 'L1 Small', 'L2 Standard', 'L3 Large']);
  assert.deepEqual(list[1].reviewers, ['feature-reviewer']);
  assert.equal(list[2].reviewers, 'auto');
  assert.ok(list[0].skip.includes('plan') && !list[3].skip.length);
  list[0].skip.push('x');
  assert.ok(!LEVELS[0].skip.includes('x'), 'a copy, not the table itself');
  // Whether you try it yourself and the Fable points, for the page's "L1→L2 adds: …" line.
  assert.deepEqual(list.map((l) => l.manualTest), [false, true, true, true]);
  assert.deepEqual(list[3].fable, ['plan', 'review']);
  list[3].fable.push('x');
  assert.ok(!LEVELS[3].fable.includes('x'), 'a copy');
});

test('levels: an options change that moves the level says so in the conversation', () => {
  assert.equal(levelChangeLine(1, 2), 'Level changed from L1 Small to L2 Standard.');
  assert.equal(levelChangeLine(null, 3), 'Level changed from none yet to L3 Large.');
  assert.equal(levelChangeLine(2, null), 'Level changed from L2 Standard to none (the Foreman suggests one).');
  assert.equal(levelChangeLine(2, 2), null, 'same level');
  assert.equal(levelChangeLine(undefined, 2), null, 'an older audit line: the level before isn’t known');
  const options = normalize({ level: 3 });
  const [changed, kept, old] = buildThread({ audit: [
    { at: '2026-10-16T10:00:00Z', action: 'options', slug: 'a', options, was: 2 },
    { at: '2026-10-16T10:01:00Z', action: 'options', slug: 'a', options, was: 3 },
    { at: '2026-10-16T10:02:00Z', action: 'options', slug: 'a', options },
  ] });
  assert.equal(changed.text, 'You changed how this job runs (from the next stage): Level changed from L2 Standard to L3 Large. Level: L3 Large (large flow). Reviewers: Head inspector, Locksmith, Gauge, Stickler, Fuse, Mason, Stopwatch, Painter, at most 1 fix round. The human tests it by hand on their computer before review. Fable checks: Before you approve the plan, When the review is wrapped up.');
  assert.ok(kept.text.startsWith('You changed how this job runs (from the next stage): Level: L3 Large'));
  assert.ok(old.text.startsWith('You changed how this job runs (from the next stage): Level: L3 Large'));
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
  await fs.rm(path.dirname(dir), { recursive: true, force: true });
});

test('job options: a document the job already had is kept when saved again, even if it moved; a new one must exist', () => {
  const nowhere = () => false;
  const previous = { level: 2, provided: { plan: '/tmp/fw-test/moved-plan.md' } };
  const again = normalize({ level: 2, provided: { plan: '/tmp/fw-test/moved-plan.md' } }, { previous, exists: nowhere });
  assert.equal(again.provided.plan, '/tmp/fw-test/moved-plan.md');
  assert.ok(again.skip.includes('plan'), 'it still skips its stage');
  assert.throws(() => normalize({ level: 2, provided: { spec: '/tmp/fw-test/new-spec.md' } }, { previous, exists: nowhere }), /Spec: there’s no file at/);
  assert.throws(() => normalize({ level: 2, provided: { plan: '/tmp/fw-test/moved-plan.md' } }, { exists: nowhere }), /no file at/, 'without the earlier options it is checked');
});
