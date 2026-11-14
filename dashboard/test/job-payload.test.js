// The new job page's payload (lib/job-payload.js): built from what the runner already knows about a
// job, with no I/O. Every fixture here is a small hand-made facts object; the text is made up.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askedOf, buildJobPage, headlineOf, stateOf } from '../lib/job-payload.js';

const T = (h, m = 0) => new Date(Date.UTC(2026, 10, 12, h, m)).toISOString();
const STATES = ['needs-you', 'working', 'waiting-github', 'paused', 'done'];

/** A job at the Review step, nothing running, nothing asked: override any part. */
function facts(over = {}) {
  const base = {
    v: 1,
    lane: 'resting',
    laneReason: 'Nothing happening; waits for your next message',
    card: {
      slug: 'orbit-901-widget-export', title: 'Widget export', kind: 'feature',
      stage: 'review', stageState: 'working', skipped: [], needsYou: false, working: false, paused: false,
      limitPaused: null, waitingFor: null, waitingSince: null, permissions: 0, nowDoing: [],
      level: 2, repo: { name: 'widgets', branch: 'feature/widget-export' }, cost: { totalUsd: 12.5 },
      auto: { on: false }, lock: null, parked: false, wireframes: null, walkthrough: null,
    },
    detail: {
      gate: null, permissionsPending: [], run: null, drive: { mode: 'workshop', model: null },
      heldReply: null, answeredBriefs: [], decidedOnYourBehalf: [], spec: null,
      auto: { on: false, tag: null },
      page: { ticket: null, times: {}, docs: {}, checks: null, handTest: null, plan: null, review: null, prs: [] },
    },
    thread: [],
  };
  return {
    ...base, ...over,
    card: { ...base.card, ...over.card },
    detail: { ...base.detail, ...over.detail, page: { ...base.detail.page, ...over.detail?.page } },
  };
}

const gate = (over = {}) => ({
  briefNumber: 15, briefFile: 'briefs/015-review.md', headline: 'The review is done: two findings, both fixed.',
  stage: 'review', nextStage: 'pr1', nextProposed: 'Open PR #1', waitingSince: T(15, 38),
  questions: [
    { id: '1', text: 'Smoke test first?', recommendation: 'b', options: [{ id: 'a', label: 'Yes', consequence: 'A day later' }, { id: 'b', label: 'No', consequence: null }] },
    { id: '2', text: 'Squash the commits?', recommendation: 'a', options: [{ id: 'a', label: 'Keep them', consequence: null }, { id: 'b', label: 'Squash', consequence: null }] },
  ],
  decided: [
    { id: 'd1', decision: 'Keep the old export', confirmed: true },
    { decision: 'Name the file widgets.csv', confirmed: false },
    { id: 'd3', decision: 'Cap at 10,000 rows', confirmed: false },
  ],
  stale: false, parked: false, runActive: false, usage: null,
  ...over,
});

const atGate = (over = {}) => facts({
  lane: 'needs-you', laneReason: 'Waiting for your go-ahead on PR #1',
  card: { stageState: 'waiting_for_you', needsYou: true, waitingFor: 'approval', waitingSince: T(15, 38) },
  detail: { gate: gate() },
  ...over,
});

// ---------- State ----------

test('stateOf: always one of the five words; a gate is needs-you, a live reply is working', () => {
  assert.equal(stateOf(atGate()), 'needs-you');
  const live = facts({ lane: 'working', laneReason: 'Run the unit tests', card: { working: true }, detail: { run: { id: 'r1', status: 'running', startedAt: T(9), lastAction: 'Run the unit tests' } } });
  assert.equal(stateOf(live), 'working');
  for (const lane of ['working', 'needs-you', 'in-review', 'ready', 'resting', 'done', 'something-new', undefined]) {
    assert.ok(STATES.includes(stateOf(facts({ lane }))), String(lane));
  }
});

test('stateOf: a paused job is paused even when old crew rows still read as running', () => {
  // A restart paused it; two crew rows from before the restart still say running (Task 3 fixes them at the source).
  const paused = facts({
    lane: 'working', laneReason: 'Run the unit tests',
    card: {
      working: true, paused: true, restartPaused: { how: 'crash', at: T(8) },
      nowDoing: [{ who: 'feature-tester', doing: 'Run the unit tests', lastAt: T(7) }, { who: 'feature-implementer', doing: 'Edit app.js', lastAt: T(7) }],
    },
  });
  assert.equal(stateOf(paused), 'paused');
  assert.equal(stateOf(facts({ lane: 'working', lanePaused: true, laneReason: 'Paused for the usage limit; carries on at 14:00', card: { limitPaused: T(14) } })), 'paused');
  // A live reply is working, whatever an older pause said.
  assert.equal(stateOf(facts({ lane: 'working', card: { working: true }, detail: { run: { id: 'r2', status: 'starting', startedAt: T(9) } } })), 'working');
});

test('stateOf: in-review and ready wait on GitHub, resting is paused, done and closed are done', () => {
  assert.equal(stateOf(facts({ lane: 'in-review' })), 'waiting-github');
  assert.equal(stateOf(facts({ lane: 'ready' })), 'waiting-github');
  assert.equal(stateOf(facts({ lane: 'resting' })), 'paused');
  assert.equal(stateOf(facts({ lane: 'done' })), 'done');
  assert.equal(stateOf(facts({ lane: 'working', card: { closed: { as: 'done', at: T(9) } } })), 'done');
});

test('the one line is the lane reason, except for a resting job; the raw lane and reason stay in the payload', () => {
  const p = buildJobPage(facts({ lane: 'in-review', laneReason: 'PR #1 is open, waiting on a review' }));
  assert.equal(p.state, 'waiting-github');
  assert.equal(p.stateLine, 'PR #1 is open, waiting on a review');
  assert.equal(p.lane, 'in-review');
  assert.equal(p.laneReason, 'PR #1 is open, waiting on a review');
  const resting = buildJobPage(facts());
  assert.equal(resting.state, 'paused');
  assert.equal(resting.stateLine, 'Nothing is running. Send a message to carry on.');
  assert.equal(resting.laneReason, 'Nothing happening; waits for your next message');
});

// ---------- Headlines ----------

test('a reply’s headline is its first bold sentence, else its first sentence, cut at 140 characters on a word', () => {
  assert.equal(headlineOf({ kind: 'reply', reply: '**The build is done and 19 checks pass.** Two more things.\n\nMore here.' }), 'The build is done and 19 checks pass.');
  assert.equal(headlineOf({ kind: 'reply', reply: '## Where we are\n\n**Plan v3 is ready. It drops step 4.**\n' }), 'Plan v3 is ready.');
  assert.equal(headlineOf({ kind: 'reply', reply: 'I fixed the `total` on page two. Then I re-ran the tests.' }), 'I fixed the total on page two.');
  const long = `**${Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')}.**`;
  const cut = headlineOf({ kind: 'reply', reply: long });
  assert.ok(cut.length <= 140, String(cut.length));
  assert.ok(cut.endsWith('…'));
  assert.match(cut, /word\d+…$/, 'cut at the end of a word');
});

test('his own message’s headline is its first sentence; a brief’s says its number, step and answer', () => {
  assert.equal(headlineOf({ kind: 'you', text: 'Looks good. Please open the PR now.' }), 'Looks good.');
  assert.equal(headlineOf({ kind: 'you', text: 'ship it' }), 'ship it');
  const brief = { kind: 'brief', number: 15, stage: 'review', file: 'briefs/015-review.md', headline: 'The review is done.' };
  assert.equal(headlineOf(brief, { answered: 'Go' }), 'Brief #15 · Review · answered: Go');
  assert.equal(headlineOf(brief, { answered: false }), 'Brief #15 · Review · waiting');
  assert.equal(headlineOf({ ...brief, number: 9, stage: 'implement' }, { answered: true }), 'Brief #9 · Build · answered');
});

// ---------- Thread lines ----------

const thread = () => [
  { id: 'brief:briefs/012-plan.md', kind: 'brief', at: T(9), number: 12, stage: 'plan', file: 'briefs/012-plan.md', headline: 'Plan v3.' },
  { id: 'you:aa', kind: 'you', at: T(9, 5), text: 'Go ahead.', sendKind: 'approve', gateBrief: 12 },
  { id: 'note:bb', kind: 'note', at: T(9, 6), text: 'You updated this job’s notes (notes.md).', notes: true },
  { id: 'auto:cc', kind: 'auto', at: T(9, 7), runId: 'r1', items: [{ at: T(9, 7), headline: 'Read app.js' }, { at: T(9, 8), headline: 'Run npm test' }] },
  { id: 'brief:briefs/013-implement.md', kind: 'brief', at: T(10), number: 13, stage: 'implement', file: 'briefs/013-implement.md', headline: 'Built.' },
  { id: 'brief:briefs/013-implement-detail.md', kind: 'brief', at: T(10), number: 13, stage: 'implement-detail', file: 'briefs/013-implement-detail.md', headline: null },
  { id: 'reply:dd', kind: 'reply', at: T(10, 30), reply: '**All 9 commits are in.** Next is the test run.', stopped: false },
  { id: 'decision:ee', kind: 'decision', at: T(10, 31), text: 'You allowed: Run npm test' },
  { id: 'blocked:ff', kind: 'blocked', at: T(10, 32), by: 'auto', text: 'Auto mode blocked: rm -rf build', who: 'conductor' },
  { id: 'problem:gg', kind: 'problem', at: T(10, 33), text: 'The reply hit a problem. It stopped.' },
  { id: 'you:hh', kind: 'you', at: T(10, 40), text: 'Approved.', sendKind: 'approve', gateBrief: 13, by: 'auto' },
  { id: 'brief:briefs/015-review.md', kind: 'brief', at: T(15, 38), number: 15, stage: 'review', file: 'briefs/015-review.md', headline: 'Review done.' },
];

test('notes, his permission answers, routine steps and blocked actions are small; a failed reply is a problem', () => {
  const p = buildJobPage(atGate({ thread: thread() }));
  const kinds = Object.fromEntries(p.thread.map((l) => [l.id, l.kind]));
  assert.equal(kinds['note:bb'], 'small');
  assert.equal(kinds['auto:cc'], 'small');
  assert.equal(kinds['decision:ee'], 'small');
  assert.equal(kinds['blocked:ff'], 'small');
  assert.equal(kinds['problem:gg'], 'problem');
  assert.equal(kinds['reply:dd'], 'reply');
  assert.equal(kinds['you:aa'], 'you');
  assert.equal(kinds['brief:briefs/015-review.md'], 'brief');
});

test('thread lines: one per item, no body and no version; step from the latest brief before it; mine; a hash of the body', () => {
  const p = buildJobPage(atGate({ thread: thread() }));
  // The detail brief is part of its brief, not a line of its own.
  assert.equal(p.thread.some((l) => l.id === 'brief:briefs/013-implement-detail.md'), false);
  assert.equal(p.thread.length, 11);
  assert.equal(p.rows.conversation.count, 11);
  assert.deepEqual(Object.keys(p.rows.conversation), ['count']);
  for (const l of p.thread) {
    assert.equal('version' in l, false);
    assert.equal('reply' in l || 'text' in l || 'html' in l, false, 'no bodies in the payload');
    assert.match(l.hash, /^[0-9a-f]{12}$/);
  }
  const line = (id) => p.thread.find((l) => l.id === id);
  assert.equal(line('you:aa').step, 'plan');
  assert.equal(line('note:bb').step, 'plan');
  assert.equal(line('reply:dd').step, 'build');
  assert.equal(line('brief:briefs/015-review.md').step, 'review');
  assert.equal(line('you:aa').mine, true);
  assert.equal(line('note:bb').mine, true, 'his own notes save');
  assert.equal(line('decision:ee').mine, true, 'his answer to a permission');
  assert.equal(line('reply:dd').mine, false);
  assert.equal(line('you:hh').mine, false, 'Auto’s approval is not his');
  assert.equal(line('you:hh').by, 'auto');
  assert.equal(line('reply:dd').headline, 'All 9 commits are in.');
  assert.equal(line('auto:cc').headline, 'Allowed automatically: Read app.js and 1 more');
  // Briefs: answered by a gate reply (its word), by Auto, or still waiting.
  assert.equal(line('brief:briefs/012-plan.md').headline, 'Brief #12 · Plan · answered: Go');
  assert.equal(line('brief:briefs/012-plan.md').answered, 'Go');
  assert.equal(line('brief:briefs/013-implement.md').headline, 'Brief #13 · Build · answered by Auto: Go');
  assert.equal(line('brief:briefs/015-review.md').headline, 'Brief #15 · Review · waiting');
  // The same body gives the same hash; another body another.
  const again = buildJobPage(atGate({ thread: thread() }));
  assert.deepEqual(again.thread.map((l) => l.hash), p.thread.map((l) => l.hash));
  const changed = thread();
  changed[6] = { ...changed[6], reply: '**All 10 commits are in.**' };
  const q = buildJobPage(atGate({ thread: changed }));
  assert.notEqual(q.thread.find((l) => l.id === 'reply:dd').hash, line('reply:dd').hash);
});

// ---------- Steps ----------

const reviewDocs = () => ({
  spec: [{ file: 'spec', name: 'Product spec', version: '0.5' }, { file: 'briefs/002-spec.md', name: 'Brief #2 · spec', version: null }],
  investigate: [{ file: 'findings.md', name: 'Findings', version: '1' }],
  plan: [{ file: 'implementation-plan.md', name: 'Implementation plan', version: '3' }, { file: 'test-plan.md', name: 'Test plan', version: '3' }, { file: 'briefs/012-plan.md', name: 'Brief #12 · plan', version: null }],
  build: [{ file: 'implementation-plan.md', name: 'Implementation plan', version: '3' }],
  test: [{ file: 'test-report.md', name: 'Test report', version: '4' }, { file: 'test-report.md', name: 'Test report', version: '5' }],
  review: [
    { file: 'review.md', name: 'Review (combined)', version: '2' },
    { file: 'review/errors-r1.md', name: 'Review: errors r1', version: null },
    { file: 'review/errors-r2.md', name: 'Review: errors r2', version: null },
    { file: 'review/tests-r1.md', name: 'Review: tests r1', version: null },
    { file: 'review/facts.md', name: 'Review facts (round 1)', version: null },
    { file: 'review/facts-r2.md', name: 'Review facts (round 2)', version: null },
    { file: 'briefs/014-review.md', name: 'Brief #14 · review', version: null },
    { file: 'briefs/015-review.md', name: 'Brief #15 · review', version: null },
  ],
  ship: [], none: [],
});

const atReview = (over = {}) => atGate({
  commits: 9,
  card: { stageState: 'waiting_for_you', needsYou: true, waitingFor: 'approval', walkthrough: { url: 'x' } },
  detail: {
    gate: gate(),
    spec: { version: '0.5' },
    page: {
      docs: reviewDocs(),
      times: { spec: { startedAt: T(1), endedAt: T(2) }, investigate: { startedAt: T(2), endedAt: T(3, 30) }, plan: { startedAt: T(3, 30), endedAt: T(5) }, build: { startedAt: T(5), endedAt: T(9) }, test: { startedAt: T(9), endedAt: T(11) }, review: { startedAt: T(11), endedAt: null }, ship: { startedAt: null, endedAt: null } },
      plan: { version: '3', steps: [{ id: 'S1', state: 'done' }, { id: 'S2', state: 'done' }, { id: 'S3', state: 'done' }] },
      checks: { passed: 19, failed: 0, notRun: 0, at: T(11) },
      review: { at: T(15), rows: [{ severity: 'major', text: 'Saves twice', status: 'fixed' }, { severity: 'major', text: 'Wrong total', status: 'fixed' }, { severity: 'minor', text: 'A typo', status: 'open' }] },
      prs: [{ n: 1, number: null, url: null, state: 'not-started', review: null, checks: null }, { n: 2, state: 'not-started' }, { n: 3, state: 'not-started' }],
    },
  },
  ...over,
});

test('steps: seven rows; a done step carries its result word and no state word; durations from the step times', () => {
  const p = buildJobPage(atReview());
  assert.deepEqual(p.steps.map((s) => s.id), ['spec', 'investigate', 'plan', 'build', 'test', 'review', 'ship']);
  assert.deepEqual(p.steps.map((s) => s.state), ['done', 'done', 'done', 'done', 'done', 'current', 'todo']);
  assert.deepEqual(p.steps.map((s) => s.word), ['v0.5', 'findings v1', 'v3', '9 commits', '19 passed', '1 open', null]);
  for (const s of p.steps.filter((x) => x.state === 'done')) {
    assert.ok(!/working|waiting|not yet|done|now/i.test(s.word ?? ''), `${s.id}: ${s.word}`);
  }
  assert.equal(p.steps[0].durationMs, 60 * 60_000);
  assert.equal(p.steps[1].durationMs, 90 * 60_000);
  assert.equal(p.steps[5].durationMs, null, 'the current step has not ended');
  assert.equal(p.steps[5].startedAt, T(11));
});

test('steps: only the latest version of each document is listed; briefs are not outputs', () => {
  const p = buildJobPage(atReview());
  const step = (id) => p.steps.find((s) => s.id === id);
  const docs = (id) => step(id).outputs.filter((o) => o.kind === 'doc').map((o) => [o.id, o.version]);
  assert.deepEqual(docs('spec'), [['spec', '0.5']]);
  assert.deepEqual(docs('plan'), [['implementation-plan.md', '3'], ['test-plan.md', '3']]);
  assert.deepEqual(docs('test'), [['test-report.md', '5']]);
  assert.deepEqual(docs('review'), [['review.md', '2']]);
  assert.equal(step('plan').outputs.find((o) => o.id === 'implementation-plan.md').meta, '3 steps');
  // The step's own outputs: Changes under Build, Checks under Test, Findings and the walkthrough under Review, the PRs under Ship.
  assert.deepEqual(step('build').outputs[0], { kind: 'changes', id: 'changes', label: 'Changes', meta: '9 commits', version: null });
  assert.deepEqual(step('test').outputs[0], { kind: 'checks', id: 'checks', label: 'Checks', meta: '19 passed', version: null });
  assert.deepEqual(step('review').outputs[0], { kind: 'findings', id: 'findings', label: 'Findings', meta: '1 open', version: null });
  assert.ok(step('review').outputs.some((o) => o.kind === 'walkthrough'));
  assert.deepEqual(step('ship').outputs.map((o) => [o.kind, o.id]), [['pr', '1'], ['pr', '2'], ['pr', '3']]);
});

test('Review counts as open only the findings whose status in the latest review is open', () => {
  const allFixed = atReview();
  allFixed.detail.page.review = { at: T(15), rows: [{ severity: 'major', text: 'Saves twice', status: 'fixed' }, { severity: 'major', text: 'Wrong total', status: 'fixed' }, { severity: 'minor', text: 'Later', status: 'not-doing' }] };
  const p = buildJobPage(allFixed);
  assert.equal(p.steps.find((s) => s.id === 'review').word, 'nothing open');
  assert.equal(p.steps.find((s) => s.id === 'review').outputs[0].meta, 'nothing open');
});

test('Ship’s word is its newest PR that has started, and failed checks lead the Test word', () => {
  const f = atReview();
  f.card.stage = 'pr1';
  f.detail.page.prs = [{ n: 1, number: 247, url: 'https://github.com/x/y/pull/247', state: 'open', review: 'waiting', checks: 'passed' }, { n: 2, state: 'not-started' }, { n: 3, state: 'not-started' }];
  f.detail.page.checks = { passed: 17, failed: 2, notRun: 0 };
  const p = buildJobPage(f);
  assert.equal(p.steps.find((s) => s.id === 'ship').word, 'PR #1 open');
  assert.equal(p.steps.find((s) => s.id === 'test').word, '2 failed');
  assert.deepEqual(p.prs[0], { n: 1, number: 247, url: 'https://github.com/x/y/pull/247', state: 'open', word: 'open · checks passed', next: null, comments: null });
  assert.equal(p.prs[1].word, 'not open');
});

// ---------- The gate ----------

test('a gate’s questions carry recommended on exactly one option each; Go says what it does; the open decisions are keyed', () => {
  const p = buildJobPage(atReview());
  assert.equal(p.move.kind, 'gate');
  assert.equal(p.move.brief, 15);
  assert.equal(p.move.ask, 'The review is done: two findings, both fixed.');
  assert.equal(p.move.since, T(15, 38));
  assert.equal(p.move.goSays, 'open PR #1');
  for (const q of p.move.questions) assert.equal(q.options.filter((o) => o.recommended).length, 1, q.id);
  assert.deepEqual(p.move.questions[0].options.map((o) => [o.id, o.recommended, o.consequence]), [['a', false, 'A day later'], ['b', true, null]]);
  assert.equal(p.move.decided, 3);
  assert.deepEqual(p.move.openDecisions, ['Name the file widgets.csv', 'd3']);
  assert.equal(p.move.stale, false);
  assert.equal(p.move.parked, false);
  // Other steps: what Go starts.
  const at = (nextStage) => buildJobPage(atGate({ detail: { gate: gate({ nextStage }) } })).move.goSays;
  assert.equal(at('implement'), 'start the build');
  assert.equal(at('pr2'), 'open PR #2');
  assert.equal(at(null), 'carry on');
  // A recommendation that names no option marks none (Go waits for his pick, as the gate card does).
  const odd = buildJobPage(atGate({ detail: { gate: gate({ questions: [{ id: '1', text: 'Which?', recommendation: 'z', options: [{ id: 'a', label: 'A' }] }] }) } }));
  assert.deepEqual(odd.move.questions[0].options.map((o) => o.recommended), [false]);
});

// ---------- What the reader opens on arrival (decision 2) ----------

test('open: the ask when the job waits for him, the current step’s main output when it works, else the conversation', () => {
  assert.deepEqual(buildJobPage(atReview()).open, { kind: 'brief', id: 'brief:briefs/015-review.md' });
  const working = atReview({ lane: 'working', laneReason: 'Edit app.js', card: { stage: 'implement', stageState: 'working', needsYou: false, working: true } });
  working.detail.gate = null;
  working.detail.run = { id: 'r1', status: 'running', startedAt: T(9) };
  assert.deepEqual(buildJobPage(working).open, { kind: 'changes', id: 'changes' });
  const testing = atReview({ lane: 'working', laneReason: 'Run the tests', card: { stage: 'test', stageState: 'working', needsYou: false, working: true } });
  testing.detail.gate = null;
  assert.deepEqual(buildJobPage(testing).open, { kind: 'checks', id: 'checks' });
  const specWork = atReview({ lane: 'working', laneReason: 'Write the spec', card: { stage: 'spec', stageState: 'working', needsYou: false, working: true } });
  specWork.detail.gate = null;
  assert.deepEqual(buildJobPage(specWork).open, { kind: 'doc', id: 'spec' });
  assert.deepEqual(buildJobPage(facts()).open, { kind: 'conversation', id: 'conversation' });
  assert.deepEqual(buildJobPage(facts({ lane: 'in-review' })).open, { kind: 'conversation', id: 'conversation' });
});

test('a question in the Foreman’s message is the move, with its quoted replies; the reader opens that message', () => {
  const f = facts({
    lane: 'needs-you', laneReason: 'Waiting for your reply',
    card: { needsYou: true, waitingFor: 'reply', waitingSince: T(12, 3) },
    thread: [
      { id: 'reply:q1', kind: 'reply', at: T(12, 3), reply: '**Can you smoke test it first?** Start Try it, then reply like "smoke ok, 1 yes, 2 yes" or “smoke failed”.' },
    ],
  });
  const p = buildJobPage(f);
  assert.deepEqual(p.move, { kind: 'question', ask: 'Can you smoke test it first?', since: T(12, 3), quick: ['smoke ok, 1 yes, 2 yes', 'smoke failed'], itemId: 'reply:q1' });
  assert.deepEqual(p.open, { kind: 'message', id: 'reply:q1' });
});

test('a waiting permission or crew question takes the move ahead of a gate, with its flags', () => {
  const pending = [{
    id: 'p1', kind: 'question', toolName: 'AskUserQuestion', createdAt: T(12, 31), canAllowForRun: false, hardLine: false, defaultToNo: true,
    plain: { headline: 'The Tester asks which browser', risk: null }, input: { questions: [{ question: 'Which browser?', options: [{ label: 'Chrome' }, { label: 'Safari' }] }] }, draft: null,
  }];
  const p = buildJobPage(atGate({ card: { permissions: 1 }, detail: { gate: gate(), permissionsPending: pending } }));
  assert.deepEqual(p.move, {
    kind: 'permission', id: 'p1', card: 'question', what: 'The Tester asks which browser', command: null,
    questions: [{ question: 'Which browser?', options: [{ label: 'Chrome' }, { label: 'Safari' }] }], risk: null,
    since: T(12, 31), canAllowForRun: false, hardLine: false, defaultToNo: true, canAlwaysAllow: false,
  });
  assert.deepEqual(p.open, { kind: 'permission', id: 'p1' });
  const push = [{ id: 'p2', kind: 'permission', toolName: 'Bash', createdAt: T(12, 31), canAllowForRun: true, hardLine: true, plain: { headline: 'Push the branch to your fork', risk: 'Changes GitHub' }, input: { command: 'git push origin feature/x' }, draft: { tool: 'Bash' } }];
  const q = buildJobPage(atGate({ detail: { gate: gate(), permissionsPending: push } }));
  assert.equal(q.move.card, 'permission');
  assert.equal(q.move.command, 'git push origin feature/x');
  assert.equal(q.move.canAllowForRun, true);
  assert.equal(q.move.hardLine, true);
  assert.equal(q.move.defaultToNo, false);
  assert.equal(q.move.canAlwaysAllow, true);
  assert.equal(q.move.questions, null);
});

// ---------- The rest of the payload ----------

test('the payload carries the facts the page needs, and the fields later tasks fill are null', () => {
  const f = atReview({ key: null, orbitUrl: 'https://orbit.example.com', usage: { limited: false, resetsAt: null, label: null } });
  f.detail.run = { id: 'r9', status: 'done', startedAt: T(8), lastAction: 'Wrote the brief', costUsd: 3 };
  f.detail.drive = { mode: 'terminal-open', model: 'claude-opus-5-5', terminals: [{}] };
  f.detail.heldReply = { kind: 'approve', gateBrief: 15, at: T(16) };
  f.detail.decidedOnYourBehalf = [{}, {}, {}];
  f.detail.auto = { on: true, tag: 'auto', decided: ['a', 'b'] };
  f.card.lock = { owner: 'terminal', pid: 42, branch: 'x', acquiredAt: T(7) };
  f.card.skipped = ['wireframe'];
  f.card.parked = true;
  const p = buildJobPage(f);
  assert.equal(p.v, 1);
  assert.equal(p.slug, 'orbit-901-widget-export');
  assert.equal(p.key, 'ORBIT-901');
  assert.equal(p.keyUrl, 'https://orbit.example.com/admin/feedback/ORBIT-901');
  assert.equal(p.title, 'Widget export');
  assert.equal(p.kind, 'feature');
  assert.deepEqual(p.facts, { level: 2, repo: 'widgets', branch: 'feature/widget-export', cost: 12.5, model: 'Opus 5.5' });
  assert.deepEqual(p.auto, { on: true, tag: 'auto', decided: ['a', 'b'] });
  assert.deepEqual(p.run, { id: 'r9', status: 'done', startedAt: T(8), lastAction: 'Wrote the brief' });
  assert.deepEqual(p.drive, { mode: 'terminal-open' });
  assert.deepEqual(p.lock, { owner: 'terminal', pid: 42, branch: 'x', acquiredAt: T(7) });
  assert.deepEqual(p.heldReply, { kind: 'approve', gateBrief: 15, at: T(16) });
  assert.deepEqual(p.usage, { limited: false, resetsAt: null, label: null, line: null });
  assert.equal(p.closed, null);
  assert.deepEqual(p.skipped, ['wireframe']);
  assert.equal(p.parked, true);
  assert.deepEqual(p.rows.decisions, { count: 5 });
  assert.equal(p.asked, null);
  assert.equal(p.waiting, null);
  assert.equal(p.hosted, false);
  assert.ok(p.prs.every((pr) => pr.next === null && pr.comments === null));
  // A ticket the job was started from wins over the slug; a branch only guessed is not shown; no level is null.
  const g = atReview();
  g.detail.page.ticket = { key: 'ORBIT-77', url: 'https://orbit.example.com/admin/feedback/ORBIT-77' };
  g.card.repo = { name: 'widgets', branch: 'other', branchGuessed: true };
  g.card.level = null;
  const q = buildJobPage(g);
  assert.equal(q.key, 'ORBIT-77');
  assert.equal(q.keyUrl, 'https://orbit.example.com/admin/feedback/ORBIT-77');
  assert.equal(q.facts.branch, null);
  assert.equal(q.facts.level, null);
  assert.equal(buildJobPage(facts({ card: { slug: 'widget-export' } })).key, null);
  assert.equal(buildJobPage(facts({ card: { kind: 'bug' } })).kind, 'bug');
  assert.equal(buildJobPage(facts({ hosted: true })).hosted, true);
});

test('buildJobPage is pure: it changes nothing it is given, and the same facts give the same payload', () => {
  const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
  const f = deepFreeze(atReview({ thread: thread() }));
  const a = buildJobPage(f);
  const b = buildJobPage(f);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// ---------- Fix round 1 ----------

test('stateOf: a stopped reply’s pause does not hide a PR on GitHub or a recording in progress', () => {
  // card.paused stays true after he stops a reply, until the next run.
  const stopped = { paused: true, stageState: 'paused' };
  const inReview = buildJobPage(facts({ lane: 'in-review', laneReason: 'PR #1 is open, waiting on a review', card: stopped }));
  assert.equal(inReview.state, 'waiting-github');
  assert.equal(inReview.stateLine, 'PR #1 is open, waiting on a review');
  assert.equal(stateOf(facts({ lane: 'ready', laneReason: 'Checks passed and PR #1 is approved', card: stopped })), 'waiting-github');
  assert.equal(stateOf(facts({ lane: 'working', laneReason: 'Recording evidence: line 4 of 19', card: { ...stopped, testing: 'Recording evidence: line 4 of 19' } })), 'working');
  // With no lane at all, the pause still wins.
  assert.equal(stateOf(facts({ lane: undefined, card: { ...stopped, working: true } })), 'paused');
});

test('a reply’s bold opener counts only in its first prose block, and a bold label takes the whole line’s first sentence', () => {
  assert.equal(headlineOf({ kind: 'reply', reply: 'I checked the branch and it is clean.\n\n- **Build:** 9 commits\n- **Test:** 19 passed' }), 'I checked the branch and it is clean.');
  assert.equal(headlineOf({ kind: 'reply', reply: '**Status:** the build is done. Two more things.' }), 'Status: the build is done.');
  assert.equal(headlineOf({ kind: 'reply', reply: '- **Short answer:** yes, it ships today. More below.' }), 'Short answer: yes, it ships today.');
  assert.equal(headlineOf({ kind: 'reply', reply: '## Where we are\n\n**Plan v3 is ready. It drops step 4.**\n\n- **Build:** later' }), 'Plan v3 is ready.');
});

test('a bold line with no sentence in it stands as a heading; a word that ends right at the cut is kept whole', () => {
  assert.equal(headlineOf({ kind: 'reply', reply: '**Where we are**\n\nPlan v3 is ready. More soon.' }), 'Plan v3 is ready.');
  assert.equal(headlineOf({ kind: 'reply', reply: '**Summary:**\n\n- The build is done.' }), 'The build is done.');
  // 'abcdef ' repeated: the 140th character is a space, so the 20th word fits whole before the ….
  const cutHere = headlineOf({ kind: 'you', text: 'abcdef '.repeat(25).trim() });
  assert.equal(cutHere.length, 140);
  assert.ok(cutHere.endsWith('abcdef…'));
});

test('stateOf: the one working rule (lib/working.js) — a paused job is never working, a job with no lane works only as jobWorking says', async () => {
  const { jobWorking, cardPaused } = await import('../lib/working.js');
  // The card the runner now gives a job a crash cut off (Task 3): paused, nothing working, no crew at work.
  const cut = facts({ lane: 'working', lanePaused: true, laneReason: 'Paused by a restart; waits for Resume', card: { stageState: 'paused', paused: true, working: false, nowDoing: [], restartPaused: { how: 'crash', at: T(8) } } });
  assert.equal(stateOf(cut), 'paused');
  assert.equal(buildJobPage(cut).stateLine, 'Paused by a restart; waits for Resume');
  // With no lane, the page's word follows the same rule as the card's working.
  const cards = [
    { working: true },
    { working: true, paused: true },
    { working: true, limitPaused: T(14) },
    { working: true, restartPaused: { how: 'clean', at: T(8) } },
    { working: false },
  ];
  for (const card of cards) {
    const working = jobWorking({ active: false, paused: cardPaused(card), working: card.working });
    assert.equal(stateOf(facts({ lane: undefined, card })) === 'working', working, JSON.stringify(card));
  }
});

test('the ⋯ menu’s laptop items get the job’s folder, worktree, own permission setting and whether it has started; the website gets none of it', async () => {
  const { mirrorJobPage } = await import('../lib/job-payload.js');
  const f = facts();
  f.detail.dir = '/made/up/jobs/orbit-901-widget-export';
  f.detail.worktree = '/made/up/worktrees/widget-export';
  f.detail.policyOverride = 'ask-all';
  f.detail.drive = { mode: 'workshop', model: 'claude-opus-5-5', sessionId: 'sess-1' };
  assert.deepEqual(buildJobPage(f).local, { dir: '/made/up/jobs/orbit-901-widget-export', worktree: '/made/up/worktrees/widget-export', policyOverride: 'ask-all', started: true });
  assert.deepEqual(buildJobPage(facts()).local, { dir: null, worktree: null, policyOverride: null, started: false });
  assert.equal('local' in mirrorJobPage({ ...f.card, ...f.detail }), false);
});

test('Review lists the combined review only: the lenses’ rounds, the review facts and the Fable second looks are read from inside the reader (Task 10)', () => {
  const f = atReview();
  f.detail.page.docs.review.push(
    { file: 'fable/001-plan.md', name: 'Fable second look #1 · plan', version: '1' },
    { file: 'fable/002-review.md', name: 'Fable second look #2 · review', version: '2' },
  );
  const p = buildJobPage(f);
  const review = p.steps.find((s) => s.id === 'review');
  assert.deepEqual(review.outputs.map((o) => [o.kind, o.id]), [['findings', 'findings'], ['doc', 'review.md'], ['walkthrough', 'walkthrough']]);
  // With no combined review yet, the latest round of each lens still shows, so the step is never empty.
  const early = atReview();
  early.detail.page.docs.review = early.detail.page.docs.review.filter((d) => d.file !== 'review.md');
  const docs = buildJobPage(early).steps.find((s) => s.id === 'review').outputs.filter((o) => o.kind === 'doc').map((o) => o.id);
  assert.deepEqual(docs, ['review/errors-r2.md', 'review/tests-r1.md', 'review/facts-r2.md']);
});

test('Task 10 fix round 1: Build lists Changes only; what a step does not list is in its reader-only `more`', () => {
  const f = atReview();
  f.detail.page.docs.build = [{ file: 'implementation-plan.md', name: 'Implementation plan', version: '3' }, { file: 'implementation-log.md', name: 'Implementation log', version: '2' }];
  f.detail.page.docs.review.push({ file: 'fable/002-review.md', name: 'Fable second look #2 · review', version: '2' });
  const p = buildJobPage(f);
  const step = (id) => p.steps.find((s) => s.id === id);
  assert.deepEqual(step('build').outputs.map((o) => o.id), ['changes']);
  assert.deepEqual(step('build').more.map((o) => [o.kind, o.id]), [['doc', 'implementation-plan.md'], ['doc', 'implementation-log.md']]);
  // Every lens round (older ones too), the review facts and the second looks; never a brief, never what is listed.
  assert.deepEqual(step('review').more.map((o) => o.id), ['review/errors-r1.md', 'review/errors-r2.md', 'review/tests-r1.md', 'review/facts.md', 'review/facts-r2.md', 'fable/002-review.md']);
  // The test report listed twice (v4, v5) is listed once and is not in `more`.
  assert.deepEqual(step('test').more, []);
  for (const s of p.steps) assert.ok(Array.isArray(s.more), s.id);
});

test('Task 10 fix round 1: each step sends its main output; a step not started (or skipped) has `not-yet`', () => {
  const p = buildJobPage(atReview());
  assert.deepEqual(Object.fromEntries(p.steps.map((s) => [s.id, s.main])), {
    spec: { kind: 'doc', id: 'spec' },
    investigate: { kind: 'doc', id: 'findings.md' },
    plan: { kind: 'doc', id: 'implementation-plan.md' },
    build: { kind: 'changes', id: 'changes' },
    test: { kind: 'checks', id: 'checks' },
    review: { kind: 'findings', id: 'findings' },
    ship: { kind: 'not-yet', id: 'ship' },
  });
  const working = atReview();
  working.card.stage = 'implement';
  working.card.stageState = 'working';
  working.card.needsYou = false;
  working.lane = 'working';
  const q = buildJobPage(working);
  assert.deepEqual(q.steps.find((s) => s.id === 'build').main, { kind: 'changes', id: 'changes' });
  assert.deepEqual(q.steps.find((s) => s.id === 'test').main, { kind: 'not-yet', id: 'test' });
});

test('Task 13: a brief Auto said Go to reads `answered by Auto: Go` and its line carries by: auto; his own Go stays plain', () => {
  const p = buildJobPage(atGate({ thread: thread() }));
  const line = (id) => p.thread.find((l) => l.id === id);
  assert.equal(line('brief:briefs/013-implement.md').headline, 'Brief #13 · Build · answered by Auto: Go');
  assert.equal(line('brief:briefs/013-implement.md').answered, 'Go');
  assert.equal(line('brief:briefs/013-implement.md').by, 'auto');
  assert.equal(line('brief:briefs/012-plan.md').headline, 'Brief #12 · Plan · answered: Go');
  assert.equal('by' in line('brief:briefs/012-plan.md'), false);
  assert.equal(headlineOf({ kind: 'brief', number: 4, stage: 'plan' }, { answered: 'Send back', by: 'auto' }), 'Brief #4 · Plan · answered by Auto: Send back');
});

// ---------- Task 18 (R5): what you asked ----------

const SENT = [
  'Please make changes before moving on, and stay in the current stage:',
  '--- Notes (4) --- 1. [change] Implementation plan v2 · step 4 "Add the filter to the table" > Add the filter Note: use the existing badge',
  '2. [change] src/EmployeesTable.tsx:88 (commit 1a2b3c4) > <Badge size="lg" /> Note: a smaller badge',
  '3. [explain] Findings · major · Saves twice > Saves twice',
  '4. [drop] Product spec v0.5 · acceptance line 6 > Export to PDF',
  '--- End of notes ---',
].join(' ');
const ANSWER = [
  'I made the changes you asked for.',
  '',
  '--- Notes answered ---',
  '1. done · Implementation plan v3 · step 4 now uses the existing badge',
  '2. done · commit abc1234 · EmployeesTable.tsx',
  '3. done · explained · The save button fires twice because the form submits too.',
  '4. not done · needs your answer: keep the PDF export for admins?',
  '--- End ---',
].join('\n');
const askedJob = (thread) => atReview({ thread });
const you = (id, text, at = T(15, 40)) => ({ id, kind: 'you', at, text, sendKind: 'changes', gateBrief: 15 });
const reply = (id, text, at = T(16)) => ({ id, kind: 'reply', at, reply: text, stopped: false });

test('Task 18: the Foreman’s answer to each note, note by note, each opening where its change is', () => {
  const p = buildJobPage(askedJob([you('you:n', SENT), reply('reply:a', ANSWER)]));
  assert.equal(p.asked.total, 4);
  assert.equal(p.asked.done, 3);
  const [plan, commit, explain, drop] = p.asked.notes;
  assert.deepEqual(plan, {
    n: 1, note: 'use the existing badge', place: 'Implementation plan v2 · step 4 "Add the filter to the table"', done: true,
    what: 'Implementation plan v3 · step 4 now uses the existing badge', target: { kind: 'doc', id: 'implementation-plan.md' },
    ask: { kind: 'change', place: 'Implementation plan v2 · step 4 "Add the filter to the table"', quote: 'Add the filter', note: 'use the existing badge' },
  });
  assert.equal(commit.what, 'commit abc1234 · EmployeesTable.tsx');
  assert.deepEqual(commit.target, { kind: 'changes', id: 'changes' });
  assert.deepEqual(commit.commit, { sha: 'abc1234', file: 'EmployeesTable.tsx' });
  assert.equal(explain.done, true);
  assert.equal(explain.explained, true);
  assert.equal(explain.note, 'Explain');
  assert.equal(explain.what, 'The save button fires twice because the form submits too.');
  assert.deepEqual(explain.target, { kind: 'findings', id: 'findings' }, 'an answer in words opens the place he pointed at');
  assert.equal(drop.done, false);
  assert.equal(drop.note, 'Drop this');
  assert.equal(drop.what, 'needs your answer: keep the PDF export for admins?');
  assert.deepEqual(drop.target, { kind: 'doc', id: 'spec' });
  assert.deepEqual(drop.ask, { kind: 'drop', place: 'Product spec v0.5 · acceptance line 6', quote: 'Export to PDF', note: null });
});

test('Task 18: a reply without the block gives asked: null, as does a newer reply without one or a message of his after it', () => {
  assert.equal(buildJobPage(atReview()).asked, null);
  assert.equal(buildJobPage(askedJob([you('you:n', SENT), reply('reply:a', 'I made the changes.')])).asked, null);
  assert.equal(buildJobPage(askedJob([you('you:n', SENT), reply('reply:a', ANSWER), reply('reply:b', 'Anything else?', T(17))])).asked, null);
  assert.equal(buildJobPage(askedJob([you('you:n', SENT), reply('reply:a', ANSWER), you('you:m', 'Go ahead.', T(17))])).asked, null);
  // The website's record has no reply words (they show on the laptop): nothing to read there.
  assert.equal(buildJobPage(askedJob([you('you:n', SENT), { id: 'reply:a', kind: 'reply', at: T(16), stopped: false }])).asked, null);
});

test('Task 18: answers with no notes block to name them, and notes the reply leaves unanswered', () => {
  const alone = buildJobPage(askedJob([reply('reply:a', ANSWER)])).asked;
  assert.equal(alone.total, 4);
  assert.deepEqual(alone.notes.map((n) => [n.n, n.note, n.place, n.ask]), [[1, 'Note 1', null, null], [2, 'Note 2', null, null], [3, 'Note 3', null, null], [4, 'Note 4', null, null]]);
  assert.deepEqual(alone.notes[0].target, { kind: 'doc', id: 'implementation-plan.md' });
  const short = ANSWER.replace(/^4\. .*\n/m, '');
  const missing = buildJobPage(askedJob([you('you:n', SENT), reply('reply:a', short)])).asked;
  assert.equal(missing.total, 4);
  assert.equal(missing.done, 3);
  assert.equal(missing.notes[3].done, false);
  assert.equal(missing.notes[3].what, 'The Foreman’s reply doesn’t answer this note.');
});

test('Task 18: a change shown in an older version than the one now opens that version (the versions the cache stamps)', () => {
  const p = buildJobPage(askedJob([you('you:n', SENT), reply('reply:a', ANSWER.replace('Implementation plan v3', 'Implementation plan v2'))]));
  const steps = p.steps.map((s) => ({ ...s, outputs: s.outputs.map((o) => (o.id === 'implementation-plan.md' ? { ...o, versions: [{ n: '2', id: 'versions/implementation-plan.v2.md' }] } : o)) }));
  assert.deepEqual(askedOf([you('you:n', SENT), reply('reply:a', ANSWER.replace('Implementation plan v3', 'Implementation plan v2'))], steps).notes[0].target, { kind: 'doc', id: 'versions/implementation-plan.v2.md' });
  // The Foreman's short name for it (`Plan v3`) finds it too.
  assert.deepEqual(askedOf([reply('reply:a', ANSWER.replace('Implementation plan v3', 'Plan v3'))], p.steps).notes[0].target, { kind: 'doc', id: 'implementation-plan.md' });
});
