// "Choose the level for me" (lib/auto-level.js): the pick, when it asks instead, and the after-build check.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDiff, chooseLevel } from '../lib/auto-level.js';

test('the higher of the rules and the Foreman wins, and never under a level already set', () => {
  const c = chooseLevel({ description: 'Fix the typo in the dashboard header title', foreman: 1 });
  assert.equal(c.level, 1);
  assert.equal(c.ask, null);
  assert.match(c.note, /^Level set to L1 automatically \(rules L0, Foreman L1/);
  assert.equal(chooseLevel({ description: 'Fix the typo in the dashboard header title', foreman: 0, current: 2 }).level, 2);
});

test('predicted files count: a config file raises the pick to L2', () => {
  const c = chooseLevel({ description: 'Change the label on the save button please', predictedPaths: ['app/next.config.js'], foreman: 1 });
  assert.equal(c.level, 2);
  assert.ok(c.triggers.includes('shared-config'));
});

test('asks instead: an L3 floor, rules and Foreman two apart, or too vague', () => {
  assert.match(chooseLevel({ description: 'Add a migration for the new report table', foreman: 3 }).ask, /L3/);
  assert.match(chooseLevel({ description: 'Fix the typo in the dashboard header title', foreman: 2 }).ask, /too far apart/);
  assert.match(chooseLevel({ description: 'fix it', foreman: 1 }).ask, /too short/);
  assert.equal(chooseLevel({ description: 'fix it', foreman: 1 }).note, null);
});

test('after a build: a floor above the level raises it; L0 limits raise to L1', () => {
  assert.deepEqual(checkDiff({ level: 1, diff: { paths: ['app/lib/auth/session.ts'], lines: 10, added: [] } }).raiseTo, 3);
  assert.equal(checkDiff({ level: 0, diff: { paths: ['a.ts', 'b.ts'], lines: 20, added: [] } }).raiseTo, null);
  const many = checkDiff({ level: 0, diff: { paths: ['a.ts', 'b.ts', 'c.ts', 'd.ts'], lines: 20, added: [] } });
  assert.equal(many.raiseTo, 1);
  assert.match(many.reasons[0], /4 files/);
  assert.match(checkDiff({ level: 0, diff: { paths: ['a.ts'], lines: 80, added: [] } }).reasons[0], /80 changed lines/);
  assert.match(checkDiff({ level: 0, diff: { paths: ['a.ts'], lines: 5, added: ['a.ts'] } }).reasons[0], /existing files only/);
  assert.equal(checkDiff({ level: 2, diff: { paths: Array.from({ length: 30 }, (_, i) => `f${i}.ts`), lines: 900, added: ['x.ts'] } }).raiseTo, null);
  assert.equal(checkDiff({ level: 1, diff: null }).raiseTo, null);
});

test('his own level stands: the latest level line is his options change, made after an automatic level', async () => {
  const { ownLevelStands } = await import('../lib/auto-level.js');
  const auto = (level) => ({ action: 'auto-level', level });
  const his = (level, extra = {}) => ({ action: 'options', options: { level }, ...extra });
  assert.equal(ownLevelStands([]), false, 'no level line');
  assert.equal(ownLevelStands([auto(3)]), false, 'the latest is Auto\'s own');
  assert.equal(ownLevelStands([auto(3), his(2, { overrode: 'auto' })]), true, 'he changed the automatic level');
  assert.equal(ownLevelStands([auto(3), his(2, { overrode: 'auto' }), his(1)]), true, 'and changed it again');
  assert.equal(ownLevelStands([auto(3), his(2, { overrode: 'auto' }), auto(2)]), false, 'Auto set a level after his');
  assert.equal(ownLevelStands([his(1)]), false, 'a level he set with no automatic level before it');
  assert.equal(ownLevelStands([auto(3), { action: 'options', options: { flow: 'small' } }]), false, 'an options line with no level is not a level line');
  assert.equal(ownLevelStands([auto(3), his(2), { action: 'send', kind: 'approve' }]), true, 'other lines after it change nothing');
});

test('his own level stands only for a save that changed the level (was), from the options editor or a gate chip', async () => {
  const { ownLevelStands } = await import('../lib/auto-level.js');
  const auto = (level) => ({ action: 'auto-level', level });
  const his = (level, was, extra = {}) => ({ action: 'options', options: { level, notes: 'x' }, was, ...extra });
  assert.equal(ownLevelStands([auto(2), his(2, 2)]), false, 'a save that keeps the level (a note, reviewers, a chip) is not a level choice');
  assert.equal(ownLevelStands([auto(3), his(2, 3)]), true, 'a save that changes the level is');
  assert.equal(ownLevelStands([auto(3), his(2, 3, { via: 'gate' })]), true, 'the gate card\'s level chip counts as his change');
  assert.equal(ownLevelStands([auto(3), his(2, 3), his(2, 2)]), true, 'a later save that keeps his level leaves it standing');
  assert.equal(ownLevelStands([auto(3), his(3, 3, { via: 'gate' })]), false, 'a skip or Fable chip on a gate he answers by hand is not a level choice');
});
