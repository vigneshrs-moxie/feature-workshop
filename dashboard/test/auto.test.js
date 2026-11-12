// Auto mode's switch (lib/auto.js): which jobs may run in Auto, the record kept in Starbase's own
// sessions.json, the card's view of it, and what options.json says about it. No model, no runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as autoLib from '../lib/auto.js';
import { AUTO_MAX_LEVEL, AUTO_RULES, autoAllowed, autoCardView, autoOption, autoRecord } from '../lib/auto.js';

test('autoAllowed: every level and a suggested L3 are allowed', () => {
  assert.equal(AUTO_MAX_LEVEL, 3);
  assert.equal('AUTO_L3' in autoLib, false, 'no sentence for a refusal that no longer happens');
  for (const level of [0, 1, 2, 3]) assert.deepEqual(autoAllowed({ level, suggestedLevel: level }), { ok: true, why: null }, `L${level}`);
  for (const level of [null, 0, 1, 2, 3]) assert.deepEqual(autoAllowed({ level, suggestedLevel: 3 }), { ok: true, why: null }, `L${level} with a suggested L3`);
  assert.deepEqual(autoAllowed({ level: 3, suggestedLevel: null }), { ok: true, why: null });
});

test('no level yet is allowed', () => {
  assert.deepEqual(autoAllowed({ level: null, suggestedLevel: null }), { ok: true, why: null });
  assert.deepEqual(autoAllowed({}), { ok: true, why: null });
  assert.deepEqual(autoAllowed({ level: null, suggestedLevel: 2 }), { ok: true, why: null });
});

test('the stop rules are the fixed list', () => {
  assert.deepEqual(AUTO_RULES, ['merge', 'database', 'outside', 'push', 'level', 'loop', 'approver', 'judgment', 'blocked', 'status', 'tool']);
  assert.ok(Object.isFrozen(AUTO_RULES));
});

test('the record: on starts fresh, off keeps that Auto ran', () => {
  const on = autoRecord(null, { on: true, by: 'you', now: '2026-11-10T09:00:00.000Z' });
  assert.deepEqual(on, { on: true, since: '2026-11-10T09:00:00.000Z', by: 'you', tag: null, ran: true, stopped: null, step: null, failures: 0, lastBrief: null, began: 'you', beganTag: null, risky: 0, tooBig: null, asOne: false, acted: null, finished: null });
  const off = autoRecord({ ...on, failures: 2, lastBrief: 4 }, { on: false, by: 'you', now: '2026-11-10T10:00:00.000Z' });
  assert.equal(off.on, false);
  assert.equal(off.ran, true, 'ran stays true once Auto has been on');
  assert.equal(autoRecord(null, { on: false }).ran, false, 'never on: never ran');
  assert.equal(autoRecord(null, { on: true, by: 'tag', tag: 'auto' }).tag, 'auto');
});

test('the card: on, ran, stopped, never deciding yet, and whether it is allowed', () => {
  const rec = autoRecord(null, { on: true, by: 'you', now: '2026-11-10T09:00:00.000Z' });
  assert.deepEqual(autoCardView(rec, { level: 1, suggestedLevel: null }), { on: true, by: 'you', ran: true, stopped: null, deciding: false, allowed: true, why: null, began: 'you', group: 'working', waitingToTest: false, tooBig: null, risky: 0, finished: null });
  assert.deepEqual(autoCardView(null, { level: 3 }), { on: false, by: null, ran: false, stopped: null, deciding: false, allowed: true, why: null, began: null, group: null, waitingToTest: false, tooBig: null, risky: 0, finished: null });
  assert.deepEqual([autoCardView(rec, { level: 2, suggestedLevel: 3 }).allowed, autoCardView(rec, { level: 2, suggestedLevel: 3 }).why], [true, null], 'a suggested L3 too');
  const stopped = { reason: 'The plan adds a migration', rule: 'database', at: '2026-11-10T09:30:00.000Z' };
  assert.deepEqual(autoCardView({ ...rec, stopped }, { level: 2 }).stopped, stopped);
  assert.equal(autoCardView({ ...rec, on: false, stopped }, { level: 2 }).stopped, null, 'off: nothing is stopped');
});

test('options.json says Auto only while the record does, at every level', () => {
  const rec = autoRecord(null, { on: true, by: 'you', now: '2026-11-10T09:00:00.000Z' });
  assert.deepEqual(autoOption(rec, 2), { on: true, since: '2026-11-10T09:00:00.000Z' });
  assert.deepEqual(autoOption(rec, null), { on: true, since: '2026-11-10T09:00:00.000Z' });
  assert.deepEqual(autoOption(rec, 3), { on: true, since: '2026-11-10T09:00:00.000Z' });
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

test('K1: a folder\'s lines start at its last restart; a restart that was put back does not count; a parked answer is forgotten at a restart', async () => {
  const { sinceRestart } = await import('../lib/state.js');
  const { GateParking } = await import('../lib/gate.js');
  const a = [{ action: 'send', n: 1 }, { action: 'restart' }, { action: 'send', n: 2 }];
  assert.deepEqual(sinceRestart(a).map((e) => e.action), ['restart', 'send']);
  assert.deepEqual(sinceRestart([...a, { action: 'restart-failed', afterBoundary: true }]).map((e) => e.n ?? e.action), [1, 'restart', 2, 'restart-failed'], 'put back: all of it');
  assert.equal(sinceRestart([{ action: 'send', n: 1 }, { action: 'restart-failed' }]).length, 2, 'a refusal before any boundary cancels nothing');
  const p = new GateParking({ now: () => 0 });
  p.noteAudit('job', { action: 'send', kind: 'approve', gateBrief: 1, at: '2026-10-01T10:00:00Z' });
  assert.equal(p.isAnswered('job', 1), true);
  p.noteAudit('job', { action: 'restart' });
  assert.equal(p.isAnswered('job', 1), false);
});

test('L5: the card carries who started Auto, so "Started by Auto" can show', () => {
  assert.equal(autoCardView(autoRecord(null, { on: true, by: 'tag', tag: 'nightly' }), { level: 1 }).by, 'tag');
  assert.equal(autoCardView(autoRecord(null, { on: true }), { level: 1 }).by, 'you');
  assert.equal(autoCardView(autoRecord(null, { on: false }), { level: 1 }).by, null);
  // began: how the job first came into Auto, kept after it is switched off (by is only while it is on).
  assert.equal(autoCardView(autoRecord(null, { on: true, by: 'tag', tag: 'nightly' }), { level: 1 }).began, 'tag');
  assert.equal(autoCardView(autoRecord(autoRecord(null, { on: true, by: 'tag', tag: 'nightly' }), { on: false }), { level: 1 }).began, 'tag');
  assert.equal(autoCardView(autoRecord(null, { on: true }), { level: 1 }).began, 'you');
  assert.equal(autoCardView(autoRecord(null, { on: false }), { level: 1 }).began, null, 'never on: it never began');
});

test('R3: a brief answered, or held for the usage limit, still counts after a restart that was put back', async () => {
  const { GateParking, feedParking } = await import('../lib/gate.js');
  const lines = [
    { action: 'send', kind: 'approve', gateBrief: 1, at: '2026-10-01T10:00:00Z' },
    { action: 'send-held', kind: 'approve', gateBrief: 2, at: '2026-10-01T11:00:00Z' },
    { action: 'restart', at: '2026-10-01T12:00:00Z' }, // cancelled by the restart-failed line that follows
    { action: 'restart-failed', afterBoundary: true, at: '2026-10-01T12:01:00Z' },
  ];
  const p = new GateParking({ now: () => 0 });
  feedParking(p, () => 'job', lines);
  assert.equal(p.isAnswered('job', 1), true, 'answered');
  assert.equal(p.held.has('job#2'), true, 'held');
  // A real boundary as the first line still forgets what came before it (nothing does) and keeps what follows.
  const q = new GateParking({ now: () => 0 });
  feedParking(q, () => 'job', [{ action: 'restart', at: '2026-10-01T09:00:00Z' }, { action: 'send', kind: 'approve', gateBrief: 1, at: '2026-10-01T10:00:00Z' }]);
  assert.equal(q.isAnswered('job', 1), true);
});

test('wroteWhileWaiting: a message of his after the brief is his; one before the brief or before Auto was switched on is not; Starbase\'s own sends are not; a steer is', async () => {
  const { wroteWhileWaiting } = await import('../lib/auto.js');
  const at = (hm) => `2026-11-10T${hm}:00.000Z`;
  const when = { briefAt: at('10:00'), since: at('09:00') };
  const one = (line, w = when) => wroteWhileWaiting([line], w);
  assert.equal(one({ action: 'send', kind: 'message', at: at('10:05'), text: 'Use the other table.' }), true, 'his message after the brief');
  assert.equal(one({ action: 'send', kind: 'message', at: at('09:55'), text: 'Earlier words.' }), false, 'before the brief was raised');
  assert.equal(one({ action: 'send', kind: 'message', at: at('10:05') }, { briefAt: at('10:00'), since: at('10:10') }), false, 'before Auto was switched on');
  assert.equal(one({ action: 'send', kind: 'message', at: at('10:00') }), false, 'at the brief\'s own time is not after it');
  for (const kind of ['nudge', 'resume', 'resume-after-restart', 'status-fix', 'pr-feedback', 'review-round', 'stack-section', 'stack-ready', 'stack-merged', 'stack-stuck', 'stack-checks-failed']) {
    assert.equal(one({ action: 'send', kind, at: at('10:05') }), false, `Starbase's own: ${kind}`);
  }
  for (const kind of ['stack-plan', 'stack-plan-change', 'stack-push', 'stack-push-no', 'stack-sendback']) assert.equal(one({ action: 'send', kind, at: at('10:05') }), true, `his: ${kind}`);
  assert.equal(one({ action: 'send', kind: 'approve', gateBrief: 1, by: 'auto', at: at('10:05') }), false, 'Auto\'s own reply');
  assert.equal(one({ action: 'steer', at: at('10:05'), text: 'Leave the old table alone.' }), true, 'a steer');
  assert.equal(one({ action: 'run-ended', at: at('10:05') }), false, 'not a message');
  // No time known: any message of his counts. No lines: nothing he wrote.
  assert.equal(wroteWhileWaiting([{ action: 'send', kind: 'message', at: at('10:05') }], { briefAt: null, since: null }), true);
  assert.equal(wroteWhileWaiting([], when), false);
});

test('autoRecord: a tag start keeps began tag through off and on', () => {
  const r = autoRecord(autoRecord(autoRecord(null, { on: true, by: 'tag', tag: 'auto' }), { on: false }), { on: true, by: 'you' });
  assert.equal(r.began, 'tag');
  assert.equal(r.beganTag, 'auto');
  assert.equal(r.by, 'you');
  assert.equal(r.tag, null, 'tag is who turned it on this time');
  const you = autoRecord(autoRecord(autoRecord(null, { on: true, by: 'you' }), { on: false }), { on: true, by: 'tag', tag: 'auto' });
  assert.deepEqual([you.began, you.beganTag, you.by], ['you', null, 'tag'], 'a job he started stays his start');
  // A record from before (no began) that ran: the first on after it keeps what beganOf read from it.
  const old = autoRecord({ on: false, since: 'x', by: 'tag', tag: 'nightly', ran: true }, { on: true, by: 'you' });
  assert.deepEqual([old.began, old.beganTag], ['tag', 'nightly']);
});

test('autoRecord: on keeps risky, clears tooBig, acted and finished, and remembers asOne', () => {
  const prev = { on: false, risky: 2, tooBig: { at: 't', reason: 'r' }, finished: 'f', acted: null };
  const r = autoRecord(prev, { on: true, by: 'you', now: '2026-11-12T09:00:00.000Z' });
  assert.deepEqual({ risky: r.risky, tooBig: r.tooBig, asOne: r.asOne, finished: r.finished, acted: r.acted }, { risky: 2, tooBig: null, asOne: true, finished: null, acted: null });
  assert.equal(autoRecord({ ...prev, acted: '2026-11-12T08:00:00.000Z' }, { on: true }).acted, null, 'acted is cleared');
  assert.equal(autoRecord({ on: false, asOne: true, tooBig: null }, { on: true }).asOne, true, 'asOne stays once set');
  assert.equal(autoRecord({ on: false, tooBig: null }, { on: true }).asOne, false, 'never set aside: not asOne');
  assert.equal(autoRecord(null, { on: true }).risky, 0, 'no risky calls yet');
  // Off keeps everything.
  const off = autoRecord({ ...r, risky: 3, tooBig: { at: 't2', reason: 'r2' }, acted: 'a', finished: 'f2' }, { on: false });
  assert.deepEqual({ risky: off.risky, tooBig: off.tooBig, asOne: off.asOne, acted: off.acted, finished: off.finished, began: off.began }, { risky: 3, tooBig: { at: 't2', reason: 'r2' }, asOne: true, acted: 'a', finished: 'f2', began: 'you' });
});

test('autoGroup: working, needs you, ready, or Yours', async () => {
  const { autoGroup, isWorking, isUnfinished } = await import('../lib/auto.js');
  const stopped = { reason: 'the plan is unclear', rule: 'judgment', at: 't' };
  assert.equal(autoGroup({ on: true, stopped: null }), 'working');
  assert.equal(autoGroup({ on: true, stopped }), 'needs-you');
  assert.equal(autoGroup({ on: false, tooBig: { at: 't', reason: 'r' } }), 'needs-you');
  assert.equal(autoGroup({ on: false, finished: 'f' }), 'ready');
  assert.equal(autoGroup({ on: false, finished: 'f', acted: null }), 'ready');
  assert.equal(autoGroup({ on: false, finished: 'f', acted: 'a' }), null, 'he acted after PR #1: Yours');
  assert.equal(autoGroup({ on: false }), null);
  assert.equal(autoGroup(null), null);
  for (const r of [{ on: true }, { on: true, stopped }, { on: false, tooBig: { at: 't', reason: 'r' } }, { on: false, finished: 'f' }]) {
    assert.equal(autoGroup(r, { closed: true }), null, `closed: ${JSON.stringify(r)}`);
  }
  assert.deepEqual([isWorking({ on: true }), isWorking({ on: true, stopped }), isWorking({ on: false }), isWorking(null)], [true, false, false, false]);
  assert.deepEqual([isUnfinished({ on: true }), isUnfinished({ on: true, stopped }), isUnfinished({ on: false, tooBig: { at: 't', reason: 'r' } }), isUnfinished(null)], [true, true, false, false]);
});

test('beganOf reads a record from before', async () => {
  const { beganOf } = await import('../lib/auto.js');
  assert.equal(beganOf({ by: 'tag', ran: true }), 'tag');
  assert.equal(beganOf({ by: 'you', ran: true }), 'you');
  assert.equal(beganOf(null), null);
  assert.equal(beganOf({ began: 'tag', by: 'you', ran: true }), 'tag', 'began wins over by');
  assert.equal(beganOf({ on: true, by: 'tag' }), 'tag', 'on now: it began');
});

test('autoCardView carries began, group, waitingToTest, tooBig, risky and finished', () => {
  const tooBig = { at: '2026-11-12T09:00:00.000Z', reason: 'It touches 14 files in 3 areas.' };
  const aside = { ...autoRecord(autoRecord(null, { on: true, by: 'tag', tag: 'auto' }), { on: false }), tooBig, risky: 2 };
  const c = autoCardView(aside, { level: 1 });
  assert.deepEqual({ began: c.began, group: c.group, waitingToTest: c.waitingToTest, tooBig: c.tooBig, risky: c.risky, finished: c.finished }, { began: 'tag', group: 'needs-you', waitingToTest: false, tooBig, risky: 2, finished: null });
  const done = { ...autoRecord(autoRecord(null, { on: true }), { on: false }), finished: '2026-11-12T10:00:00.000Z' };
  assert.equal(autoCardView(done, { level: 1 }).group, 'ready');
  assert.equal(autoCardView(done, { level: 1 }).finished, '2026-11-12T10:00:00.000Z');
  assert.equal(autoCardView(done, { level: 1, closed: true }).group, null, 'a closed job is in no Auto group');
  assert.equal(autoCardView(autoRecord(null, { on: true }), { level: 1, waitingToTest: true }).waitingToTest, true);
  // A record from before: none of the new fields.
  const old = autoCardView({ on: true, since: 'x', by: 'tag', tag: 'nightly', ran: true, stopped: null }, { level: 1 });
  assert.deepEqual({ began: old.began, group: old.group, tooBig: old.tooBig, risky: old.risky, finished: old.finished }, { began: 'tag', group: 'working', tooBig: null, risky: 0, finished: null });
});
