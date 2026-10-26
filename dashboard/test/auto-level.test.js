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
