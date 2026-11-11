// Auto mode's switch (lib/auto.js): which jobs may run in Auto, the record kept in Starbase's own
// sessions.json, the card's view of it, and what options.json says about it. No model, no runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AUTO_MAX_LEVEL, AUTO_RULES, AUTO_L3, autoAllowed, autoCardView, autoOption, autoRecord } from '../lib/auto.js';

const L3 = 'Auto works up to L2. An L3 job needs you to approve each step.';

test('L3 is not allowed and says why', () => {
  assert.equal(AUTO_MAX_LEVEL, 2);
  assert.equal(AUTO_L3, L3);
  assert.deepEqual(autoAllowed({ level: 3 }), { ok: false, why: L3 });
  for (const level of [0, 1, 2]) assert.deepEqual(autoAllowed({ level, suggestedLevel: level }), { ok: true, why: null }, `L${level}`);
});

test('no level yet is allowed', () => {
  assert.deepEqual(autoAllowed({ level: null, suggestedLevel: null }), { ok: true, why: null });
  assert.deepEqual(autoAllowed({}), { ok: true, why: null });
  assert.deepEqual(autoAllowed({ level: null, suggestedLevel: 2 }), { ok: true, why: null });
});

test('a suggested L3 is not allowed, with no level and on an L2 job alike', () => {
  assert.deepEqual(autoAllowed({ level: null, suggestedLevel: 3 }), { ok: false, why: L3 });
  assert.deepEqual(autoAllowed({ level: 2, suggestedLevel: 3 }), { ok: false, why: L3 });
});

test('the stop rules are the fixed list', () => {
  assert.deepEqual(AUTO_RULES, ['merge', 'database', 'outside', 'push', 'level', 'loop', 'approver', 'judgment', 'blocked', 'status']);
  assert.ok(Object.isFrozen(AUTO_RULES));
});

test('the record: on starts fresh, off keeps that Auto ran', () => {
  const on = autoRecord(null, { on: true, by: 'you', now: '2026-11-10T09:00:00.000Z' });
  assert.deepEqual(on, { on: true, since: '2026-11-10T09:00:00.000Z', by: 'you', tag: null, ran: true, stopped: null, step: null, failures: 0, lastBrief: null });
  const off = autoRecord({ ...on, failures: 2, lastBrief: 4 }, { on: false, by: 'you', now: '2026-11-10T10:00:00.000Z' });
  assert.equal(off.on, false);
  assert.equal(off.ran, true, 'ran stays true once Auto has been on');
  assert.equal(autoRecord(null, { on: false }).ran, false, 'never on: never ran');
  assert.equal(autoRecord(null, { on: true, by: 'tag', tag: 'auto' }).tag, 'auto');
});

test('the card: on, ran, stopped, never deciding yet, and whether it is allowed', () => {
  const rec = autoRecord(null, { on: true, by: 'you', now: '2026-11-10T09:00:00.000Z' });
  assert.deepEqual(autoCardView(rec, { level: 1, suggestedLevel: null }), { on: true, ran: true, stopped: null, deciding: false, allowed: true, why: null });
  assert.deepEqual(autoCardView(null, { level: 3 }), { on: false, ran: false, stopped: null, deciding: false, allowed: false, why: L3 });
  const stopped = { reason: 'The plan adds a migration', rule: 'database', at: '2026-11-10T09:30:00.000Z' };
  assert.deepEqual(autoCardView({ ...rec, stopped }, { level: 2 }).stopped, stopped);
  assert.equal(autoCardView({ ...rec, on: false, stopped }, { level: 2 }).stopped, null, 'off: nothing is stopped');
});

test('options.json says Auto only while the record does, and never above L2', () => {
  const rec = autoRecord(null, { on: true, by: 'you', now: '2026-11-10T09:00:00.000Z' });
  assert.deepEqual(autoOption(rec, 2), { on: true, since: '2026-11-10T09:00:00.000Z' });
  assert.deepEqual(autoOption(rec, null), { on: true, since: '2026-11-10T09:00:00.000Z' });
  assert.deepEqual(autoOption(rec, 3), { on: false, since: null });
  assert.deepEqual(autoOption({ ...rec, on: false }, 1), { on: false, since: null });
  assert.deepEqual(autoOption(null, 1), { on: false, since: null });
  assert.deepEqual(autoOption({ on: 'yes', since: 'x' }, 1), { on: false, since: null }, 'only a literal true');
});

test('a stack section never takes its parent’s Auto', async () => {
  const { sectionOptions } = await import('../runner/stacks.js');
  const parent = { level: 2, skip: ['refine'], provided: {}, auto: true, auto_since: '2026-11-10T09:00:00.000Z', from_session: { id: 'x' }, updated_at: 'x' };
  const o = sectionOptions(parent, '/tmp/fw/section.md');
  assert.deepEqual(['auto' in o, 'auto_since' in o, 'from_session' in o, 'updated_at' in o], [false, false, false, false]);
  assert.deepEqual(o.skip, ['refine', 'clarify', 'spec']);
  assert.deepEqual(o.provided, { spec: '/tmp/fw/section.md' });
  assert.equal(o.level, 2);
});
