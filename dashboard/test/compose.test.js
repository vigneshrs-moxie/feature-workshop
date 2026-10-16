// The gate card's next-step chips in the reply (lib/compose.js): the exact lines the workflow's
// job-options.md defines ("Option lines from the gate card"), where they sit, and what's left out.
// Also a held reply (lib/limits.js hold) and the notes line in the thread (lib/thread.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { composeReply, chipLine, cleanChips, CHIP_STAGES, CHIP_SKIPPABLE, CHIP_POINTS, MAX_CHIPS } from '../lib/compose.js';
import { STAGES } from '../lib/stages.js';
import { SKIPPABLE, FABLE_POINTS } from '../lib/options.js';
import { buildThread } from '../lib/thread.js';
import { State } from '../lib/state.js';
import { LimitWatch } from '../lib/limits.js';

test('chips: each kind is the exact line job-options.md defines', () => {
  assert.equal(chipLine({ kind: 'skip', stage: 'test' }), 'Option change for the next step: skip test');
  assert.equal(chipLine({ kind: 'lighter', stage: 'review' }), 'Option change for the next step: lighter review');
  assert.equal(chipLine({ kind: 'heavier', stage: 'implement' }), 'Option change for the next step: heavier implement');
  assert.equal(chipLine({ kind: 'fable', point: 'plan' }), 'Option change for the next step: ask Fable at plan');
  assert.equal(chipLine({ kind: 'self', stage: 'spec-update' }), "Option change for the next step: I'll do spec-update myself");
  assert.equal(chipLine({ kind: 'level', level: 2, was: 1 }), 'Option change for the next step: level L2 (was L1)');
});

test('chips: malformed ones are left out', () => {
  const bad = [
    null, 'skip test', [], {}, { kind: 'push' },
    { kind: 'skip', stage: 'implement' }, // building can't be skipped
    { kind: 'skip', stage: 'pr1' }, { kind: 'skip', stage: '../etc' }, { kind: 'lighter' }, { kind: 'heavier', stage: 'staging-qa' },
    { kind: 'fable', point: 'implement' }, { kind: 'fable', stage: 'plan' }, { kind: 'self', stage: 'pr2' },
    { kind: 'level', level: 4, was: 1 }, { kind: 'level', level: 2 }, { kind: 'level', level: 2, was: 2 }, { kind: 'level', level: '2', was: 1 }, { kind: 'level', level: 1.5, was: 1 },
  ];
  for (const c of bad) assert.equal(chipLine(c), null, JSON.stringify(c));
  assert.deepEqual(cleanChips(bad), []);
  assert.deepEqual(cleanChips('nope'), []);
});

test('chips: repeats dropped, one level change (the first), at most eight, only their own fields', () => {
  const chips = cleanChips([
    { kind: 'skip', stage: 'test', extra: 'x' }, { kind: 'skip', stage: 'test' },
    { kind: 'level', level: 2, was: 1 }, { kind: 'level', level: 3, was: 1 },
    { kind: 'fable', point: 'review', stage: 'plan' },
  ]);
  assert.deepEqual(chips, [{ kind: 'skip', stage: 'test' }, { kind: 'level', level: 2, was: 1 }, { kind: 'fable', point: 'review' }]);
  const many = CHIP_STAGES.flatMap((stage) => [{ kind: 'lighter', stage }, { kind: 'heavier', stage }]);
  assert.equal(cleanChips(many).length, MAX_CHIPS);
});

test('chips: the stage lists match the dashboard’s stages, skippable stages and Fable points', () => {
  const ids = STAGES.map((s) => s.id);
  assert.deepEqual(CHIP_STAGES, ids.slice(0, ids.indexOf('review') + 1));
  assert.deepEqual(CHIP_SKIPPABLE, SKIPPABLE.map((s) => s.id));
  assert.deepEqual(CHIP_POINTS, FABLE_POINTS.map((p) => p.id));
});

const status = {
  questions: [{ id: '1', text: 'Keep the old column?', options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] }],
  decidedOnYourBehalf: [{ id: 'D-1', decision: 'Reviewers', confirmed: false }],
  nextProposed: 'Build step 1',
  spec: { version: '0.3', status: 'DRAFT' },
  artifacts: [{ name: 'implementation-plan', version: 2 }],
  brief: { number: 2 },
};

test('compose: the chip block sits after the answers and verdicts, before the approval', () => {
  const text = composeReply({
    kind: 'approve', status, answers: { 1: { choice: 'a' } }, verdicts: { 'D-1': { verdict: 'confirm' } },
    chips: [{ kind: 'skip', stage: 'test' }, { kind: 'bogus' }, { kind: 'fable', point: 'review' }],
  });
  assert.equal(text, [
    'My answers to brief 2:',
    '1. Keep the old column? → a) Yes',
    '',
    'Decided on my behalf, confirmed: D-1.',
    '',
    'Option change for the next step: skip test',
    'Option change for the next step: ask Fable at review',
    '',
    'I approve. Go ahead with the next stage: Build step 1',
    'At these versions: spec v0.3 (DRAFT), implementation-plan v2.',
  ].join('\n'));
});

test('compose: chips alone, with a message or changes; none at all is the classic text unchanged', () => {
  assert.equal(composeReply({ kind: 'message', status: {}, note: 'Thanks', chips: [{ kind: 'self', stage: 'test' }] }), "Option change for the next step: I'll do test myself\n\nThanks");
  assert.equal(composeReply({ kind: 'message', status: {}, chips: [{ kind: 'level', level: 3, was: 2 }] }), 'Option change for the next step: level L3 (was L2)');
  assert.match(composeReply({ kind: 'changes', status: {}, note: 'Rename it', chips: [{ kind: 'heavier', stage: 'plan' }] }), /^Option change for the next step: heavier plan\n\nPlease make changes/);
  const classic = composeReply({ kind: 'approve', status, answers: {} });
  assert.equal(composeReply({ kind: 'approve', status, answers: {}, chips: [] }), classic);
  assert.equal(composeReply({ kind: 'approve', status, answers: {}, chips: [{ kind: 'skip', stage: 'implement' }] }), classic, 'a malformed chip adds nothing');
});

test('thread: a run of notes saves is one dim note; held replies and their failure are notes', () => {
  const t = buildThread({ audit: [
    { at: '2026-10-16T10:00:00Z', action: 'notes', featureDir: '/f/a', size: 10 },
    { at: '2026-10-16T10:01:00Z', action: 'notes', featureDir: '/f/a', size: 12 },
    { at: '2026-10-16T10:02:00Z', action: 'send', kind: 'approve', text: 'I approve.', gateBrief: 3 },
    { at: '2026-10-16T10:03:00Z', action: 'notes', featureDir: '/f/a', size: 14 },
    { at: '2026-10-16T10:04:00Z', action: 'send-held', kind: 'approve', gateBrief: 4, autoResume: true },
    { at: '2026-10-16T10:05:00Z', action: 'usage-limit-skip', reason: 'It’s been picked up somewhere else since the pause.', held: { kind: 'approve', gateBrief: 4, text: 'x' } },
    { at: '2026-10-16T10:06:00Z', action: 'usage-limit-skip', reason: 'other' },
  ] });
  assert.deepEqual(t.map((i) => i.kind), ['note', 'you', 'note', 'note', 'note']);
  assert.equal(t[0].text, 'You updated this job’s notes (notes.md).');
  assert.equal(t[0].at, '2026-10-16T10:01:00Z', 'the run of saves shows its latest time');
  assert.equal(t[1].gateBrief, 3);
  assert.match(t[3].text, /^Your reply to brief 4 waits for Claude’s usage limit to reset; it goes to the Foreman then\.$/);
  assert.match(t[4].text, /^Your reply held for the usage-limit reset wasn’t sent: It’s been picked up/);
  // Ids stay put as the log grows.
  const again = buildThread({ audit: [{ at: '2026-10-16T10:00:00Z', action: 'notes', featureDir: '/f/a', size: 10 }] });
  assert.equal(again[0].id, t[0].id);
});

test('usage limit: a held reply goes in place of the carry-on message, with its brief', async () => {
  const state = new State(await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-hold-')));
  const started = [];
  const driver = { list: () => [], stop: async () => true, start: async (o) => { started.push(o); return { id: 'r1' }; } };
  const t = { now: Date.parse('2026-10-16T12:00:00Z') };
  const limits = new LimitWatch({ driver, state, now: () => t.now, setTimer: (fn) => { setImmediate(fn); return {}; }, clearTimer: () => {}, setTick: () => ({}), clearTick: () => {} });
  await limits.load();
  await assert.rejects(limits.hold({ featureDir: '/f/a', slug: 'a' }, { text: 'x' }), /No usage limit/);
  await limits.onLimit({ run: null, info: { rateLimitType: 'five_hour', resetsAt: t.now / 1000 + 600 } });
  const job = { featureDir: '/f/a', slug: 'a', title: 'A', cwd: '/r', sessionId: null, model: 'claude-opus-5-5', additionalDirectories: [] };
  const held = await limits.hold(job, { text: '/feature a Private folder: /f/a\n\nI approve.', kind: 'approve', gateBrief: 3 });
  assert.equal(held.resetKnown, true);
  assert.deepEqual(limits.heldFor('/f/a'), { kind: 'approve', gateBrief: 3, at: '2026-10-16T12:00:00.000Z' });
  assert.deepEqual(limits.view().jobs, [{ slug: 'a', title: 'A', held: true }]);
  // Survives a restart.
  const again = new LimitWatch({ driver, state: new State(state.dir), now: () => t.now, setTick: () => ({}), clearTick: () => {} });
  await again.load();
  assert.equal(again.heldFor('/f/a').gateBrief, 3);

  await limits.resume('you');
  assert.equal(started.length, 1);
  assert.equal(started[0].text, '/feature a Private folder: /f/a\n\nI approve.');
  assert.equal(started[0].kind, 'approve');
  assert.equal(started[0].gateBrief, 3);
  assert.equal(started[0].sessionId, null);
  assert.equal(limits.heldFor('/f/a'), null);

  // A message sent by hand meanwhile drops the held one.
  await limits.onLimit({ run: null, info: { rateLimitType: 'five_hour', resetsAt: t.now / 1000 + 600 } });
  await limits.hold(job, { text: 'later', kind: 'approve', gateBrief: 5 });
  await limits.forget('/f/a');
  assert.equal(limits.heldFor('/f/a'), null);
  await fs.rm(state.dir, { recursive: true, force: true });
});
