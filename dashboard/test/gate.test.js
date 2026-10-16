// The Foreman's level suggestion in status.json, brief versions in the thread, the gate card's
// content, briefs answered from a gate card, and gate parking (lib/gate.js). No server, no model.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseStatusJson, LEVEL_REASON_MAX } from '../lib/status-json.js';
import { buildThread } from '../lib/thread.js';
import { gateView, isGateWaiting, answeredBriefs, usageLine, nextStageAfter, versionsFrom, GateParking, GATE_PARK_MS } from '../lib/gate.js';

const status = (extra) => JSON.stringify({ schema_version: 1, slug: 'x', stage: 'plan', stage_state: 'waiting_for_you', ...extra });

// ---------- status.json: suggested_level and level_reason ----------

test('status.json: suggested_level and level_reason are read on schema 1 without a warning', () => {
  const s = parseStatusJson(status({ suggested_level: 2, level_reason: 'Touches people queries, so at least L2.' }));
  assert.equal(s.ok, true);
  assert.deepEqual(s.warnings, []);
  assert.equal(s.suggestedLevel, 2);
  assert.equal(s.levelReason, 'Touches people queries, so at least L2.');
  assert.equal(parseStatusJson(status({ suggested_level: 0 })).suggestedLevel, 0, 'L0 is a level, not "missing"');
});

test('status.json: missing or null suggested_level is null, no warning; unknown keys still tolerated', () => {
  for (const extra of [{}, { suggested_level: null, level_reason: null }, { something_new: { a: 1 } }]) {
    const s = parseStatusJson(status(extra));
    assert.deepEqual(s.warnings, [], JSON.stringify(extra));
    assert.equal(s.suggestedLevel, null);
    assert.equal(s.levelReason, null);
  }
});

test('status.json: a suggested_level outside 0–3 is null with a warning; a long reason is cut', () => {
  for (const bad of [4, -1, 1.5, '2', 'L2', true, [2]]) {
    const s = parseStatusJson(status({ suggested_level: bad }));
    assert.equal(s.ok, true);
    assert.equal(s.suggestedLevel, null, JSON.stringify(bad));
    assert.equal(s.warnings.length, 1);
    assert.match(s.warnings[0], /^suggested_level: unexpected value/);
  }
  const long = parseStatusJson(status({ level_reason: `  ${'x'.repeat(LEVEL_REASON_MAX + 50)}  ` }));
  assert.equal(long.levelReason.length, LEVEL_REASON_MAX);
  assert.deepEqual(long.warnings, []);
  assert.equal(parseStatusJson(status({ level_reason: 42 })).levelReason, null, 'not a string: ignored');
});

// ---------- versions ----------

test('versions: from status.json spec and artifacts; null without status.json', () => {
  const s = parseStatusJson(status({ spec: { path: 'a.md', version: '0.3', status: 'DRAFT' }, artifacts: [{ name: 'plan', version: 2 }, { name: 'test-plan', version: null }, { version: 1 }] }));
  assert.deepEqual(versionsFrom(s), { spec: '0.3', artifacts: { plan: '2', 'test-plan': null } });
  assert.deepEqual(versionsFrom(parseStatusJson(status({}))), { spec: null, artifacts: {} });
  assert.equal(versionsFrom(null), null);
});

test('thread: a brief item carries the versions it was given, and its id does not depend on them', () => {
  const versions = { spec: '0.3', artifacts: { plan: '2' } };
  const with_ = buildThread({ briefs: [{ number: 1, stage: 'spec', file: 'briefs/001-spec.md' }, { number: 2, stage: 'plan', file: 'briefs/002-plan.md', versions }] });
  const without = buildThread({ briefs: [{ number: 1, stage: 'spec', file: 'briefs/001-spec.md' }, { number: 2, stage: 'plan', file: 'briefs/002-plan.md' }] });
  assert.equal(with_[0].versions, null, 'older brief: no versions');
  assert.deepEqual(with_[1].versions, versions);
  assert.equal(without[1].versions, null);
  assert.deepEqual(with_.map((t) => t.id), without.map((t) => t.id));
  assert.equal(with_[1].id, 'brief:briefs/002-plan.md');
});

// ---------- the gate ----------

const waitingJob = {
  stage: 'plan', stageState: 'waiting_for_you', waitingFor: 'approval', skipped: ['refine'],
  nextProposed: 'Build step 1 after your go-ahead',
  questions: [1, 2, 3, 4].map((n) => ({ id: String(n), text: `Q${n}?`, recommendation: 'a', options: [] })),
  decided: [{ id: 'D-1', decision: 'Reviewers: head inspector and locksmith', reason: 'L2 defaults', where: null, confirmed: false }],
  versions: { spec: '0.3', artifacts: { plan: '2' } }, waitingSince: '2026-10-15T10:00:00Z',
  level: 1, suggestedLevel: 2, levelReason: 'Touches people queries.',
};
const brief = { number: 2, file: 'briefs/002-plan.md', headline: 'Widget · plan done · plan v2' };

test('gate: waiting for you is waiting_for_you, or waiting for an approval or answers', () => {
  assert.equal(isGateWaiting({ stageState: 'waiting_for_you' }), true);
  assert.equal(isGateWaiting({ stageState: 'blocked', waitingFor: 'answers' }), true);
  assert.equal(isGateWaiting({ stageState: 'working', waitingFor: 'approval' }), true);
  assert.equal(isGateWaiting({ stageState: 'working', waitingFor: null }), false);
  assert.equal(isGateWaiting({ stageState: 'blocked', waitingFor: 'permission' }), false);
  assert.equal(isGateWaiting({ stageState: 'done' }), false);
});

test('gate: null when the Foreman is working', () => {
  assert.equal(gateView({ ...waitingJob, stageState: 'working', waitingFor: null }, { brief }), null);
  assert.equal(gateView(null), null);
});

test('gate: brief, questions (at most 3), decisions, versions, levels and the next stage', () => {
  const g = gateView(waitingJob, { brief, parked: true });
  assert.equal(g.briefNumber, 2);
  assert.equal(g.briefFile, 'briefs/002-plan.md');
  assert.equal(g.headline, brief.headline);
  assert.equal(g.stage, 'plan');
  assert.equal(g.nextStage, 'implement');
  assert.equal(g.nextProposed, waitingJob.nextProposed);
  assert.deepEqual(g.questions.map((q) => q.text), ['Q1?', 'Q2?', 'Q3?']);
  assert.deepEqual(g.decided, waitingJob.decided);
  assert.deepEqual(g.versions, waitingJob.versions);
  assert.equal(g.waitingSince, waitingJob.waitingSince);
  assert.equal(g.parked, true);
  assert.deepEqual([g.level, g.suggestedLevel, g.levelReason], [1, 2, 'Touches people queries.']);
  assert.equal(g.usage, null, 'no limit trouble: no usage line');
  assert.equal(gateView(waitingJob).briefNumber, null, 'no brief known');
});

test('gate: next stage skips the stages this job does not run', () => {
  assert.equal(nextStageAfter('implement', []), 'test');
  assert.equal(nextStageAfter('implement', ['test']), 'review');
  assert.equal(nextStageAfter('pr3', []), null);
  assert.equal(nextStageAfter(null, []), null);
});

test('gate: a usage line only before build, test or review, when the limit is reached or close', () => {
  const time = () => '3:40 PM';
  const limited = { limited: true, label: '5-hour limit', resetsAt: '2026-10-16T22:40:00Z', resetKnown: true, warning: null };
  const close = { limited: false, label: null, resetsAt: null, warning: { label: '5-hour limit', percent: 92, resetsAt: '2026-10-16T22:40:00Z' } };
  const fine = { limited: false, label: null, resetsAt: null, warning: null };

  assert.equal(gateView(waitingJob, { brief, usage: limited, time }).usage, 'Paused: Claude’s 5-hour limit is reached (it resets around 3:40 PM). Build can’t start before then.');
  assert.equal(gateView(waitingJob, { brief, usage: close, time }).usage, 'Claude’s 5-hour limit is at 92% (resets around 3:40 PM): Build may pause part-way.');
  assert.equal(gateView(waitingJob, { brief, usage: fine, time }).usage, null);
  // Next is PR #1: no usage line, even when the limit is reached.
  const atPr = { ...waitingJob, stage: 'review', nextProposed: 'PR #1 after your go-ahead' };
  assert.equal(gateView(atPr, { brief, usage: limited, time }).nextStage, 'pr1');
  assert.equal(gateView(atPr, { brief, usage: limited, time }).usage, null);
  // ...unless the Foreman proposes a fix round next.
  assert.match(gateView({ ...atPr, nextProposed: 'Small fix round for R-2, then PR #1' }, { brief, usage: limited, time }).usage, /^Paused/);
  assert.equal(usageLine(limited, { heavy: false }), null);
});

// ---------- briefs answered from a gate card ----------

test('answeredBriefs: from audit send lines that carry gateBrief, each once, oldest first', () => {
  const audit = [
    { action: 'send', kind: 'approve', gateBrief: 3 },
    { action: 'send', kind: 'message', text: 'go' }, // a plain message: not a gate reply
    { action: 'send', kind: 'approve', gateBrief: 1 },
    { action: 'send', kind: 'changes', gateBrief: 3 },
    { action: 'options', gateBrief: 5 }, // not a send
    { action: 'send', gateBrief: '4' }, // not a number
    { action: 'send', gateBrief: 0 },
  ];
  assert.deepEqual(answeredBriefs(audit), [1, 3]);
  assert.deepEqual(answeredBriefs([]), []);
});

// ---------- parking ----------

test('parking: four hours by default; a gate is due once past the threshold, once per brief', () => {
  assert.equal(GATE_PARK_MS, 4 * 60 * 60 * 1000);
  let now = Date.parse('2026-10-16T10:00:00Z');
  const p = new GateParking({ thresholdMs: 60_000, now: () => now });
  const gates = [
    { slug: 'a', briefNumber: 2, waitingSince: '2026-10-16T09:59:30Z' },
    { slug: 'b', briefNumber: 1, waitingSince: null }, // nothing to time it by: never due
  ];
  assert.deepEqual(p.due(gates), [], '30 seconds: not yet');
  now += 30_000;
  const due = p.due(gates);
  assert.deepEqual(due.map((g) => g.slug), ['a']);
  p.mark(due[0]);
  assert.equal(p.isParked('a', 2), true);
  assert.equal(p.isParked('a', 3), false);
  now += 3_600_000;
  assert.deepEqual(p.due(gates), [], 'reported once');
  // The Foreman raises brief 3: a new gate, timed again from its own waiting_since.
  const next = [{ slug: 'a', briefNumber: 3, waitingSince: new Date(now - 1000).toISOString() }];
  assert.deepEqual(p.due(next), []);
  now += 60_000;
  assert.deepEqual(p.due(next).map((g) => g.briefNumber), [3]);
});
