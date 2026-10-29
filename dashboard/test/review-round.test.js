// lib/review-round.js (packet Q): review rounds. The pure parts (the route, kinds, which comments
// open or join a round, the Foreman's report, Send back's plan, each state's words) and the
// coordinator with a fake gh that records its calls and a pretend driver: a round from Raj's
// "Request changes", fixed with the Foreman, a new comment joining it, sent back in one go (each
// GitHub write behind the go, in order), approved, reminded; a failure that stops Send back and Try
// again that never posts a reply twice; the lock held in a terminal; a merge only with its confirm.
// Nothing reaches GitHub, no model is called.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  GITHUB_EVERY_CHOICES, applyForeman, candidatesOf, countWords, createReviewRounds, foremanMessage, foremanReady, groupRounds,
  guessKind, nameFor, parseRoute, readRounds, reviewView, roundPanel, routesView, sendPlan, whoMergesLine,
} from '../lib/review-round.js';
import { createGhWrite } from '../lib/gh-write.js';
import { commentKey, readFeedback } from '../lib/pr-feedback.js';

const roots = [];
after(async () => { for (const r of roots) await fs.rm(r, { recursive: true, force: true }); });

const ORBIT = [
  "PR #1: your fork's branch into the same-named branch on moxie (you review and merge it)",
  'PR #2: the moxie branch into staging (Raj reviews and merges it)',
  'PR #3: staging into main (the release owner reviews and merges it)',
];
const REPO = 'acme/sample-repo';
const HEAD = 'aaa1111aaa1111aaa1111aaa1111aaa1111aaaa';
const FIXED = 'def5678def5678def5678def5678def5678defd';

// ---------- The pure parts ----------

test('the route: who reviews and who merges each PR, from the profile’s lines', () => {
  const route = parseRoute(ORBIT);
  assert.deepEqual(route.map((s) => [s.pr, s.reviewer?.name, s.merger?.name, s.youMayMerge]), [[1, 'you', 'you', true], [2, 'Raj', 'Raj', false], [3, 'the release owner', 'the release owner', false]]);
  assert.equal(route[1].into, 'staging');
  assert.equal(whoMergesLine(route), 'PR #1: you · PR #2: Raj · PR #3: the release owner');
  assert.equal(nameFor('raj-moxie', route), 'Raj', 'a login starting with the route’s name');
  assert.equal(nameFor('ana', route), 'ana');
  const withLogin = parseRoute(['PR #2: the org branch into staging (Raj @rpatel reviews it; you may merge it; squash)']);
  assert.equal(withLogin[0].reviewer.login, 'rpatel');
  assert.equal(withLogin[0].youMayMerge, true);
  assert.equal(withLogin[0].squash, true);
  assert.equal(nameFor('rpatel', withLogin), 'Raj');
  // No lines: the usual route, nobody named for PR #2, you may merge (it always asks).
  const none = parseRoute(undefined);
  assert.deepEqual(none.map((s) => s.pr), [1, 2]);
  assert.equal(none[1].reviewer, null);
  assert.equal(parseRoute([], { twoStep: false })[0].into, 'main');
});

test('routesView: who reviews and merges each PR, per repository, in words for Settings → Workflow', async () => {
  const views = await routesView(async () => [
    { name: 'Orbit', prRoute: ['PR #1: your fork into moxie (you review and merge it)', 'PR #2: moxie into staging (Raj @raj-moxie reviews and merges it)', 'PR #3: staging into main (the release owner reviews and merges it)'] },
    { name: 'Plain', prRoute: null },
  ]);
  assert.deepEqual(views[0], { name: 'Orbit', named: true, steps: [
    { pr: 1, from: 'your fork', into: 'moxie', reviews: 'You', merges: 'You' },
    { pr: 2, from: 'moxie', into: 'staging', reviews: 'Raj', merges: 'Raj' },
    { pr: 3, from: 'staging', into: 'main', reviews: 'the release owner', merges: 'the release owner' },
  ] });
  assert.equal(views[1].named, false);
  assert.deepEqual(views[1].steps.map((s) => [s.pr, s.reviews, s.merges]), [[1, 'You', 'You'], [2, 'Not named', 'You']]);
  assert.deepEqual(await routesView(async () => { throw new Error('no registry'); }), []);
  assert.deepEqual(await routesView(undefined), []);
});

test('a comment’s kind, as a first guess: a question asks for an answer, a nit says nit, the rest are changes', () => {
  assert.equal(guessKind('Why is this a let?'), 'question');
  assert.equal(guessKind('Is this ever null here?'), 'question');
  assert.equal(guessKind('nit: trailing space'), 'nit');
  assert.equal(guessKind('Small thing (nit) the name is long.'), 'nit');
  assert.equal(guessKind('Could you rename this to feedbackId?'), 'change');
  assert.equal(guessKind('Should we keep the old name as an alias?'), 'change');
  assert.equal(guessKind('Please rename this to feedbackId.'), 'change');
  assert.equal(guessKind('Why is this a let? Please make it a const.'), 'change');
});

const review = (id, state, body, at, commit = HEAD, login = 'raj-moxie') => ({ id, user: { login, type: 'User' }, state, body, submitted_at: at, commit_id: commit, html_url: `https://github.com/${REPO}/pull/152#pullrequestreview-${id}` });
const lineComment = (id, file, line, body, { reviewId = null, at = '2026-10-28T09:00:00Z', login = 'raj-moxie', commit = HEAD, outdated = false } = {}) => ({
  id, user: { login, type: 'User' }, path: file, line: outdated ? null : line, original_line: line, position: outdated ? null : 1, body, pull_request_review_id: reviewId, commit_id: commit, created_at: at, html_url: `https://github.com/${REPO}/pull/152#discussion_r${id}`,
});

test('candidatesOf: reviews, line comments and conversation comments; yours, summary bots, approvals and empty ones are skipped; outdated is kept, marked', () => {
  const list = candidatesOf({
    prNumber: 152, me: ['you'],
    reviews: [review(5001, 'CHANGES_REQUESTED', 'A few things before this goes in.', '2026-10-28T09:00:00Z'), review(5002, 'APPROVED', 'LGTM', '2026-10-28T11:00:00Z'), review(5003, 'COMMENTED', '', '2026-10-28T09:01:00Z')],
    lineComments: [
      lineComment(7001, 'web/src/App.tsx', 12, 'Please rename this to feedbackId.', { reviewId: 5001, at: '2026-10-28T08:58:00Z' }),
      lineComment(7002, 'lib/x.js', 3, 'Why is this a let?', { reviewId: 5001, outdated: true }),
      lineComment(7003, 'lib/x.js', 4, 'My own note.', { login: 'you' }),
    ],
    issueComments: [{ id: 801, user: { login: 'codecov[bot]', type: 'Bot' }, body: 'Coverage 91%', created_at: '2026-10-28T09:00:00Z' }, { id: 802, user: { login: 'ana', type: 'User' }, body: 'Does this need a migration?', created_at: '2026-10-28T09:30:00Z' }],
  });
  assert.deepEqual(list.map((c) => c.id), ['c7001', 'c7002', 'r5001', 'i802']);
  const [c1, c2, r1, i1] = list;
  assert.equal(c1.at, '2026-10-28T09:00:00Z', 'a line comment of a review takes the review’s time');
  assert.equal(c1.key, commentKey({ number: 152 }, 'c7001'));
  assert.equal(c2.outdated, true);
  assert.equal(c2.line, 3, 'the line it was on');
  assert.equal(r1.reviewState, 'CHANGES_REQUESTED');
  assert.equal(i1.key, null, 'a conversation comment isn’t one of N’s');
});

const PR = { number: 152, route: 2, label: 'PR #2', url: `https://github.com/${REPO}/pull/152` };

test('groupRounds: a Request changes opens a round with its comments; a lone comment stays N’s; two close together open one', () => {
  const crs = candidatesOf({ prNumber: 152, reviews: [review(5001, 'CHANGES_REQUESTED', 'A few things.', '2026-10-28T09:00:00Z')], lineComments: [lineComment(7001, 'a.js', 1, 'Rename it.', { reviewId: 5001 })] });
  const g = groupRounds({ candidates: crs, head: HEAD, pr: PR, at: '2026-10-28T09:05:00Z' });
  assert.equal(g.rounds.length, 1);
  assert.deepEqual(g.rounds[0].items.map((i) => i.id), ['c7001', 'r5001']);
  assert.equal(g.rounds[0].pr, 2, 'its place on the route');
  assert.equal(g.rounds[0].prNumber, 152, 'its number on GitHub');
  assert.equal(g.rounds[0].state, 'asked');
  assert.deepEqual(g.claimed.sort(), [commentKey({ number: 152 }, 'c7001'), commentKey({ number: 152 }, 'r5001')].sort());

  const lone = candidatesOf({ prNumber: 152, lineComments: [lineComment(7101, 'a.js', 1, 'Rename it.', { login: 'ana' })] });
  assert.equal(groupRounds({ candidates: lone, head: HEAD, pr: PR }).rounds.length, 0, 'a lone comment is N’s card');

  const two = candidatesOf({ prNumber: 152, lineComments: [lineComment(7101, 'a.js', 1, 'Rename it.', { login: 'ana', at: '2026-10-28T09:00:00Z' }), lineComment(7102, 'b.js', 2, 'And this one.', { login: 'ana', at: '2026-10-28T09:04:00Z' })] });
  assert.equal(groupRounds({ candidates: two, head: HEAD, pr: PR }).rounds[0].items.length, 2);
  const apart = candidatesOf({ prNumber: 152, lineComments: [lineComment(7101, 'a.js', 1, 'Rename it.', { login: 'ana', at: '2026-10-28T09:00:00Z' }), lineComment(7102, 'b.js', 2, 'And this one.', { login: 'ana', at: '2026-10-28T11:00:00Z' })] });
  assert.equal(groupRounds({ candidates: apart, head: HEAD, pr: PR }).rounds.length, 0, 'two hours apart: two of N’s cards');

  // N already answered one (sent to the Foreman on its own): the round doesn't take it again.
  const sentByN = groupRounds({ candidates: crs, head: HEAD, pr: PR, feedback: { [commentKey({ number: 152 }, 'c7001')]: { state: 'sent' } } });
  assert.deepEqual(sentByN.rounds[0].items.map((i) => i.id), ['r5001']);
  // N's card still waiting: the round takes it, and N's card goes.
  const waiting = groupRounds({ candidates: crs, head: HEAD, pr: PR, feedback: { [commentKey({ number: 152 }, 'c7001')]: { state: 'waiting' } } });
  assert.deepEqual(waiting.takeFromN, [commentKey({ number: 152 }, 'c7001')]);
});

test('groupRounds, first look: only a Request changes that is still the reviewer’s latest word on the newest commit opens a round', () => {
  const old = candidatesOf({ prNumber: 152, reviews: [review(5001, 'CHANGES_REQUESTED', 'A few things.', '2026-10-27T09:00:00Z', 'oldsha1')] });
  assert.equal(groupRounds({ candidates: old, head: HEAD, pr: PR, firstLook: true }).rounds.length, 0, 'on an older commit');
  const cur = candidatesOf({ prNumber: 152, reviews: [review(5001, 'CHANGES_REQUESTED', 'A few things.', '2026-10-28T09:00:00Z')], lineComments: [lineComment(7101, 'a.js', 1, 'Old chatter.', { login: 'ana' }), lineComment(7102, 'b.js', 1, 'More.', { login: 'ana' })] });
  const g = groupRounds({ candidates: cur, head: HEAD, pr: PR, firstLook: true });
  assert.equal(g.rounds.length, 1);
  assert.deepEqual(g.rounds[0].items.map((i) => i.id), ['r5001'], 'Ana’s old comments are left alone');
  assert.equal(groupRounds({ candidates: cur, head: HEAD, pr: PR, firstLook: true, decision: 'approved' }).rounds.length, 0, 'approved since');
});

test('groupRounds: a comment while the Foreman works joins the round as new; a left round comes back; a check failing on the pushed commit re-opens a sent round', () => {
  const first = groupRounds({ candidates: candidatesOf({ prNumber: 152, reviews: [review(5001, 'CHANGES_REQUESTED', 'A few things.', '2026-10-28T09:00:00Z')] }), head: HEAD, pr: PR }).rounds;
  const more = candidatesOf({ prNumber: 152, reviews: [review(5001, 'CHANGES_REQUESTED', 'A few things.', '2026-10-28T09:00:00Z')], lineComments: [lineComment(7003, 'a.js', 9, 'One more thing.', { at: '2026-10-28T10:05:00Z' })] });
  const fixing = groupRounds({ rounds: [{ ...first[0], state: 'fixing' }], candidates: more, head: HEAD, pr: PR }).rounds[0];
  const late = fixing.items.find((i) => i.id === 'c7003');
  assert.equal(late.late, true);
  assert.equal(late.added, false, 'it waits for your yes');
  const left = groupRounds({ rounds: [{ ...first[0], state: 'left' }], candidates: more, head: HEAD, pr: PR }).rounds[0];
  assert.equal(left.state, 'asked');
  assert.equal(left.items.find((i) => i.id === 'c7003').late, false);

  const sent = { ...first[0], state: 'sent', sentHead: FIXED };
  const g = groupRounds({ rounds: [sent], candidates: [], checks: [{ name: 'lint', state: 'fail', runId: '42', link: 'https://github.com/acme/sample-repo/actions/runs/42/job/1' }, { name: 'test', state: 'pass' }], head: FIXED, pr: PR, at: '2026-10-28T12:00:00Z' });
  assert.equal(g.rounds[0].state, 'check-failed');
  assert.deepEqual(g.rounds[0].items.filter((i) => i.type === 'check').map((i) => i.name), ['lint']);
  assert.match(g.rounds[0].timeline.at(-1).words, /^lint failed on the push\.$/);
  // A failure on a commit nobody sent stays N's.
  assert.equal(groupRounds({ rounds: [sent], checks: [{ name: 'lint', state: 'fail' }], head: 'other12', pr: PR }).rounds[0].state, 'sent');
});

test('applyForeman: the report fills the round; a kind you picked and a reply you edited stand; the same report twice changes nothing', () => {
  const round = groupRounds({ candidates: candidatesOf({ prNumber: 152, reviews: [review(5001, 'CHANGES_REQUESTED', 'A few things.', '2026-10-28T09:00:00Z')], lineComments: [lineComment(7001, 'a.js', 1, 'Rename it.', { reviewId: 5001 }), lineComment(7002, 'b.js', 3, 'Why is this a let?', { reviewId: 5001 })] }), head: HEAD, pr: PR }).rounds[0];
  round.state = 'fixing';
  Object.assign(round.items.find((i) => i.id === 'c7001'), { kind: 'nit', kindBy: 'you' });
  const report = { round: 1, state: 'fixing', doing: 'Renaming it', next: null, checks: null, items: [
    { id: 'c7001', kind: 'change', plan: 'fix', planText: 'Rename to feedbackId', state: 'fixed', commit: 'abc1234', reply: 'Fixed in abc1234.' },
    { id: 'c7002', kind: 'question', plan: 'answer', planText: 'Explain the loop', state: 'working', reply: 'It is reassigned below.' },
  ] };
  assert.equal(applyForeman(round, report), true);
  const c1 = round.items.find((i) => i.id === 'c7001');
  assert.equal(c1.kind, 'nit', 'your kind wins');
  assert.equal(c1.state, 'fixed');
  assert.equal(c1.commit, 'abc1234');
  assert.equal(foremanReady(round), false);
  round.items.find((i) => i.id === 'c7002').reply = 'My words.';
  round.items.find((i) => i.id === 'c7002').replyEdited = true;
  assert.equal(applyForeman(round, report), false, 'nothing new');
  const done = { ...report, state: 'ready', items: [report.items[0], { ...report.items[1], state: 'answered', reply: 'Its words.' }, { id: 'r5001', state: 'answered', reply: 'Thanks.' }] };
  assert.equal(applyForeman(round, done), true);
  assert.equal(round.items.find((i) => i.id === 'c7002').reply, 'My words.', 'your edited reply wins');
  assert.equal(foremanReady(round), true);
  assert.equal(applyForeman(round, { ...done, round: 2 }), false, 'another round’s report');
});

test('sendPlan: PR #2 from the org branch goes by a follow-up PR #1; a round of answers only pushes nothing', () => {
  const route = parseRoute(ORBIT);
  const round = groupRounds({ candidates: candidatesOf({ prNumber: 152, reviews: [review(5001, 'CHANGES_REQUESTED', 'A few things.', '2026-10-28T09:00:00Z')], lineComments: [lineComment(7001, 'a.js', 1, 'Rename it.', { reviewId: 5001 }), lineComment(7002, 'b.js', 3, 'Why is this a let?', { reviewId: 5001 })] }), head: HEAD, pr: PR }).rounds[0];
  applyForeman(round, { round: 1, state: 'ready', items: [{ id: 'c7001', state: 'fixed', commit: 'abc1234', reply: 'Fixed.' }, { id: 'c7002', state: 'answered', reply: 'It is reassigned.' }, { id: 'r5001', state: 'answered', reply: 'Thanks.' }] });
  const plan = sendPlan(round, { ahead: 2, fork: 'origin', branch: 'feature/sample-job', orgRemote: 'moxie', twoStep: true, mergeFollowUp: true }, { route });
  assert.deepEqual(plan.map((s) => [s.number, s.id, s.words]), [
    [1, 'push', 'Push 2 commits to your fork'],
    [2, 'follow-up', 'PR #2 is Raj’s, from the moxie branch: open the follow-up PR #1, your fork → the moxie branch, and merge it once its checks pass'],
    [3, 'replies', 'Reply on GitHub to each of Raj’s 3 comments'],
    [4, 'resolve', 'Mark the 1 fixed comment resolved'],
    [5, 'request', 'Ask Raj to review PR #2 again'],
  ]);
  assert.equal(plan[0].detail, 'git push origin feature/sample-job · never forced');
  const mine = sendPlan(round, { ahead: 2, fork: 'origin', branch: 'feature/sample-job', orgRemote: 'moxie', twoStep: true, mergeFollowUp: false }, { route });
  assert.match(mine[1].words, /, and stop there$/);
  assert.match(mine[1].choice, /^I’ll merge PR #1 myself/);
  const answers = sendPlan(round, { ahead: 0, twoStep: true }, { route });
  assert.deepEqual(answers.map((s) => s.id), ['replies', 'resolve', 'request'], 'no push, no follow-up');
});

test('reviewView: each state has its words and one next action', () => {
  const route = parseRoute(ORBIT);
  const pr = { number: 152, label: 'PR #2', routeNumber: 2, state: 'open', review: 'review_required', checks: 'passing', base: 'staging', reviewRequests: [], url: 'u' };
  const at = Date.parse('2026-10-28T12:00:00Z');
  const v = (over, ctx = {}) => reviewView({ job: { slug: 'sample-job', title: 'Sample job' }, pr: { ...pr, ...over }, route, now: at, ...ctx });

  const nobody = v({});
  assert.equal(nobody.state, 'no-reviewer');
  assert.equal(nobody.bar.headline, 'No one has been asked to review PR #2');
  assert.equal(nobody.bar.reviewer.name, 'Raj');
  assert.deepEqual(nobody.bar.actions.map((a) => a.id), ['ask-review']);

  const closed = v({ state: 'closed', closedBy: 'raj-moxie', closedAt: '2026-10-28T11:00:00Z' });
  assert.equal(closed.state, 'closed');
  assert.equal(closed.bar.headline, 'PR #2 was closed without merging');
  assert.match(closed.bar.detail, /^Closed by Raj at .*Your branch and its commits are kept\.$/);
  assert.equal(closed.desk.actions[0].id, 'reopen');

  const conflicts = v({ mergeable: 'CONFLICTING', reviewRequests: ['raj-moxie'] });
  assert.equal(conflicts.state, 'conflicts');
  assert.match(conflicts.bar.detail, /merged in, never rebased, so nothing has to be force-pushed/);
  assert.equal(conflicts.bar.actions[0].id, 'sync');

  const reset = v({ reviewRequests: ['raj-moxie'] }, { approvalReset: true });
  assert.equal(reset.state, 'approval-reset');
  assert.equal(reset.bar.on, 'reviewer');

  const theyMerge = v({ review: 'approved', approvedAt: '2026-10-28T10:00:00Z', reviewRequests: [] }, { now: at });
  assert.equal(theyMerge.state, 'approved-they-merge');
  assert.equal(theyMerge.bar.headline, 'Waiting for Raj to merge PR #2');
  assert.equal(theyMerge.remind.can, false, 'not before a day after the approval');
  assert.match(theyMerge.remind.text, /^Hi Raj, PR #2 \(Sample job\) is approved and its checks are green\. Could you merge it into staging/);
  assert.equal(v({ review: 'approved', approvedAt: '2026-10-27T10:00:00Z' }).remind.can, true);

  const youMerge = reviewView({ job: { slug: 'sample-job' }, pr: { ...pr, review: 'approved', repo: REPO }, route: parseRoute(undefined), now: at });
  assert.equal(youMerge.state, 'approved-you-merge');
  assert.equal(youMerge.merge.command, `gh pr merge 152 --repo ${REPO} --merge`);
  const merge = youMerge.bar.actions[0];
  assert.equal(merge.go, null, 'the a key never merges: the button opens the ask');
  assert.equal(merge.confirm.hardLine, 'Hard line');
  assert.equal(merge.confirm.keyNote, 'The a key never merges.');

  const merged = v({ state: 'merged', mergedBy: 'raj-moxie', mergedAt: '2026-10-28T11:30:00Z' }, { stagingNext: 'staging QA, then PR #3 with the release' });
  assert.equal(merged.bar.headline, 'PR #2 is merged into staging');
  assert.match(merged.bar.detail, /^Merged by Raj at .*\. Next on the route: staging QA, then PR #3 with the release\.$/);

  // Held in a terminal: the same state underneath, its buttons off, said in words.
  const held = v({}, { lock: { pid: 4242, branch: 'feature/sample-job', owner: 'terminal', acquiredAt: '2026-10-28T11:00:00Z' } });
  assert.equal(held.state, 'held');
  assert.equal(held.heldState, 'no-reviewer');
  assert.equal(held.bar.headline, 'This job is being driven from a terminal');
  assert.ok(held.bar.actions.every((a) => a.client || (a.enabled === false && a.reason === 'Send back is off until the terminal lets go.')));
  assert.equal(held.bar.was.headline, 'No one has been asked to review PR #2');
});

test('the panel’s round: grouped by file, the whole PR next, the checks last; counts and states in words', () => {
  const round = groupRounds({
    candidates: candidatesOf({ prNumber: 152, reviews: [review(5001, 'CHANGES_REQUESTED', 'A few things.', '2026-10-28T09:00:00Z')], lineComments: [lineComment(7001, 'web/a.js', 1, 'Rename it.', { reviewId: 5001 }), lineComment(7002, 'lib/b.js', 3, 'Why is this a let?', { reviewId: 5001 })] }),
    checks: [{ name: 'lint', state: 'fail', runId: '42' }], head: HEAD, pr: PR,
  }).rounds[0];
  const panel = roundPanel(round, { route: parseRoute(ORBIT) });
  assert.equal(panel.title, 'Round 1 · PR #2');
  assert.match(panel.from, /^From Raj’s review at \d\d:\d\d \(Request changes\) and the lint check on the same commit$/);
  assert.deepEqual(panel.groups.map((g) => g.heading), ['lib/b.js', 'web/a.js', 'On the whole pull request', 'Checks on the same commit']);
  assert.equal(panel.includedWords, '4 of 4 included');
  assert.equal(countWords(round.items), '2 comments, 1 question');
  assert.ok(panel.groups.flatMap((g) => g.items).every((i) => i.stateWords === 'To do'));
  assert.equal(panel.groups[3].items[0].reply, null, 'a check gets no reply');
});

test('foremanMessage: the whole round, the plan first, one commit per item, and never push, reply or merge', () => {
  const round = groupRounds({ candidates: candidatesOf({ prNumber: 152, reviews: [review(5001, 'CHANGES_REQUESTED', 'A few things.', '2026-10-28T09:00:00Z')], lineComments: [lineComment(7001, 'web/a.js', 1, 'Rename it.', { reviewId: 5001 }), lineComment(7002, 'lib/b.js', 3, 'Why?', { reviewId: 5001 })] }), head: HEAD, pr: PR }).rounds[0];
  round.items.find((i) => i.id === 'c7002').included = false;
  round.note = 'Keep the old name as an alias.';
  const text = foremanMessage(round, { route: parseRoute(ORBIT), checks: ['npm test'], roundFile: '/jobs/sample-job/review/rounds/round-1.md' });
  assert.match(text, /^Raj asked for changes on PR #2: this is round 1\./);
  assert.match(text, /A note from the person: Keep the old name as an alias\./);
  assert.match(text, /write status\.json prs\[k\]\.rounds with this round, state "planning"/);
  assert.match(text, /one commit per item or per small group/);
  assert.match(text, /Run the checks \(npm test\)/);
  assert.match(text, /Don’t push, don’t reply on GitHub, and don’t merge: Send back does those, after the person says go\./);
  assert.match(text, /c7001 · Change · web\/a\.js line 1 · from raj-moxie\n> Rename it\./);
  assert.ok(!/^c7002 ·/m.test(text), 'a left-out item isn’t sent');
  assert.match(text, /Left out by the person, not to be worked on: c7002\./);
  assert.match(text, /The round is also in \/jobs\/sample-job\/review\/rounds\/round-1\.md\./);
});

// ---------- The coordinator, with a fake gh ----------

const ok = (v) => ({ ok: true, out: typeof v === 'string' ? v : JSON.stringify(v), err: null });
const fail = (err) => ({ ok: false, out: '', err });

function prView(number, over = {}) {
  return {
    number, state: 'OPEN', isDraft: false, reviewDecision: 'CHANGES_REQUESTED', reviewRequests: [], mergeable: 'MERGEABLE', headRefOid: HEAD,
    headRefName: 'feature/sample-job', baseRefName: 'staging', url: `https://github.com/${REPO}/pull/${number}`, title: 'Sample job', mergedAt: null, mergedBy: null, closedAt: null,
    statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: `https://github.com/${REPO}/actions/runs/11/job/1` }],
    ...over,
  };
}

// GitHub as the fake gh sees it: PR #2 (152) with Raj's review, and the follow-up PR #1 once opened (777).
function fakeGitHub() {
  const prs = {
    152: {
      view: prView(152),
      reviews: [review(5001, 'CHANGES_REQUESTED', 'A few things before this goes in.', '2026-10-28T09:00:00Z')],
      comments: [lineComment(7001, 'web/src/App.tsx', 12, 'Please rename this to feedbackId.', { reviewId: 5001 }), lineComment(7002, 'lib/x.js', 3, 'Why is this a let?', { reviewId: 5001 })],
      issues: [],
    },
  };
  const calls = [];
  const fails = new Map(); // a command's start → its error, once
  let posted = 9000;
  const gh = async (args) => {
    calls.push(args);
    const a = args.join(' ');
    for (const [start, err] of fails) if (a.startsWith(start)) { fails.delete(start); return fail(err); }
    if (args[0] === 'pr' && args[1] === 'view') { const p = prs[args[2]]; return p ? ok(p.view) : fail('no pull requests found'); }
    if (args[0] === 'api' && args[2] === 'GET') {
      if (args[3] === 'user') return ok({ login: 'you' });
      const m = /^repos\/acme\/sample-repo\/(pulls|issues)\/(\d+)\/(reviews|comments|events)/.exec(args[3]);
      const p = m && prs[m[2]];
      if (!p) return fail('HTTP 404');
      return ok(m[3] === 'reviews' ? p.reviews : m[3] === 'events' ? [] : m[1] === 'issues' ? p.issues : p.comments);
    }
    if (args[0] === 'api' && args[2] === 'POST') return ok({ id: ++posted });
    if (args[0] === 'api' && args[1] === 'graphql') {
      if (args.some((x) => x.startsWith('query=query'))) {
        const n = Number(args.find((x) => x.startsWith('number=')).slice(7));
        return ok({ data: { repository: { pullRequest: { reviewThreads: { nodes: (prs[n]?.comments ?? []).map((c) => ({ id: `PRRT_${c.id}`, isResolved: false, comments: { nodes: [{ databaseId: c.id }] } })) } } } } });
      }
      return ok({ data: { resolveReviewThread: { thread: { isResolved: true } } } });
    }
    if (args[0] === 'pr' && args[1] === 'create') {
      prs[777] = { view: prView(777, { reviewDecision: null, headRefOid: FIXED, baseRefName: 'feature/sample-job' }), reviews: [], comments: [], issues: [] };
      return ok(`https://github.com/${REPO}/pull/777\n`);
    }
    if (args[0] === 'pr' && args[1] === 'merge') { const p = prs[args[2]]; if (p) p.view.state = 'MERGED'; return ok(''); }
    if (args[0] === 'pr' && ['edit', 'comment', 'reopen'].includes(args[1])) return ok('');
    return fail(`fake gh: not expected: gh ${a}`);
  };
  const isRead = (args) => (args[0] === 'pr' && args[1] === 'view') || (args[0] === 'api' && args[1] === '--method' && args[2] === 'GET') || (args[0] === 'api' && args[1] === 'graphql' && args.some((x) => x.startsWith('query=query')));
  return { prs, calls, gh, fails, writes: () => calls.filter((c) => !isRead(c)) };
}

// A pretend driver: the round card, the message to the Foreman, whether it is replying now.
function fakeDriver() {
  return {
    cards: new Map(), sent: [], active: false,
    parkRoundCard(job, card) { this.cards.set(job.featureDir, card); return card; },
    dropRoundCard(dir) { return this.cards.delete(dir); },
    roundCardFor(dir) { return this.cards.get(dir) ?? null; },
    async sendRoundMessage(m) { this.sent.push(m); return { outcome: 'sent', runId: `run-${this.sent.length}` }; },
    activeRunFor() { return this.active ? { id: 'run' } : null; },
    feedbackCardFor() { return null; },
  };
}

async function setup({ route = ORBIT, lock = null } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-review-round-')));
  roots.push(root);
  const dir = path.join(root, 'sample-job');
  await fs.mkdir(dir, { recursive: true });
  const worktree = path.join(root, 'worktree');
  const github = fakeGitHub();
  const driver = fakeDriver();
  const audit = [];
  const gitCalls = [];
  const t = { now: Date.parse('2026-10-28T10:00:00Z'), status: null, ahead: 2, lock, settings: {}, refreshes: 0, emitted: [] };
  // The writer, with its own git stubbed: the fork is a local folder, and a push just says done.
  const write = createGhWrite({
    gh: github.gh, audit: async (l) => { audit.push(l); }, lockFor: () => t.lock, localOnly: true,
    git: async (d, args) => { gitCalls.push([d, ...args]); return args[0] === 'remote' ? ok(`${root}/fork.git\n`) : ok(''); },
  });
  const coordinator = createReviewRounds({
    gh: github.gh, write, driver,
    jobs: async () => [{ dir, slug: 'sample-job', title: 'Sample job', branch: 'feature/sample-job', worktree, repoPath: '/repos/sample-repo', closed: null, ticket: null }],
    profileFor: async () => ({ prRoute: route, checks: ['npm test'] }),
    audit: async (l) => { audit.push(l); },
    emit: (slug, view) => t.emitted.push([slug, view?.state ?? null]),
    changed: () => {},
    lockFor: () => t.lock,
    readStatus: async () => t.status,
    login: async () => 'you',
    git: async (d, args) => {
      if (args[0] === 'rev-list') return ok(`${t.ahead}\n`);
      if (args[0] === 'rev-parse') return ok(`${FIXED}\n`);
      if (args[0] === 'log') return ok(`abc1234abc1234abc1234abc1234abc1234abcd\tRename to feedbackId (review: c7001)\n${FIXED}\tAlias the old name\n`);
      return fail('not a read');
    },
    settings: async () => t.settings,
    saveSettings: async (s) => { t.settings = s; },
    refresh: () => { t.refreshes++; },
    now: () => t.now,
    sleep: async () => {},
    checksEveryMs: 0,
  });
  const flow = (lane = {}) => ({ repos: [{
    repo: '/repos/sample-repo', org: { remote: 'moxie', slug: REPO }, fork: { remote: 'origin', slug: 'you/sample-repo' }, main: { ref: 'moxie/main' }, prsKnown: true,
    lanes: [{ slug: 'sample-job', branch: 'feature/sample-job', unpushed: 0, pr1: { number: 151, state: 'merged', url: `https://github.com/${REPO}/pull/151` }, pr2: { number: 152, state: 'open', url: `https://github.com/${REPO}/pull/152` }, ...lane }],
  }] });
  const view = () => coordinator.view('sample-job');
  return { root, dir, github, driver, audit, gitCalls, t, c: coordinator, flow, view };
}

const report = (items, state = 'ready') => ({ prs: [{ number: 1, rounds: [] }, { number: 2, rounds: [{ round: 1, state, doing: null, next: null, checks: 'npm test passes (212 of 212).', items }] }, { number: 3, rounds: [] }] });

test('a round from Request changes to Send back: the card, Fix with the Foreman, a new comment joining, then every write in order, each behind the go', async () => {
  const s = await setup();
  const { c, t, driver, github, audit } = s;

  // The first look: Raj's Request changes on the newest commit opens round 1.
  await c.pass(s.flow());
  let v = await s.view();
  assert.equal(v.state, 'asked');
  assert.equal(v.bar.headline, 'Raj asked for changes on PR #2 · 2 comments, 1 question');
  assert.deepEqual(v.bar.actions.map((a) => [a.id, a.key, a.go]), [['fix', 'a', true], ['leave', 'r', false], ['open', 'o', null]]);
  assert.equal(v.round.title, 'Round 1 · PR #2');
  assert.equal(v.pr.reviews, undefined, 'the view carries the round, not GitHub’s raw comments');
  assert.equal(v.pr.checks, 'passing');
  assert.equal(v.who.mergesLine, 'PR #1: you · PR #2: Raj · PR #3: the release owner');
  const card = driver.cards.get(s.dir);
  assert.deepEqual(card.actions.map((a) => [a.id, a.label]), [['fix', 'Fix with the Foreman'], ['leave', 'Leave it for now']]);
  assert.equal(card.header, 'PR #2');
  const record = await readFeedback(s.dir);
  for (const id of ['c7001', 'c7002', 'r5001']) assert.equal(record.items[commentKey({ number: 152 }, id)]?.state, 'round', `${id} is the round’s, so N doesn’t card it`);
  assert.equal(audit.filter((l) => l.action === 'review-round-opened').length, 1);
  assert.deepEqual(github.writes(), [], 'only reads so far');

  // Nothing goes back before the Foreman is done.
  await assert.rejects(c.act('sample-job', 'send', { go: true }), (e) => e.status === 409);
  await assert.rejects(c.act('sample-job', 'send', {}), (e) => e.status === 400 && /only on your go/.test(e.message));

  // Your kind and your go, with a note.
  await c.act('sample-job', 'item', { id: 'r5001', kind: 'nit' });
  await assert.rejects(c.act('sample-job', 'item', { id: 'r5001', kind: 'check' }), (e) => e.status === 400);
  driver.active = true; // the Foreman is replying
  v = await c.act('sample-job', 'fix', { note: 'Keep the old name as an alias.' });
  assert.equal(v.state, 'fixing');
  assert.equal(v.bar.headline, 'The Foreman is on round 1');
  assert.equal(driver.sent.length, 1);
  assert.match(driver.sent[0].text, /^Raj asked for changes on PR #2: this is round 1\./);
  assert.match(driver.sent[0].text, /A note from the person: Keep the old name as an alias\./);
  assert.equal(driver.sent[0].key, 'round-1');
  assert.equal(driver.cards.has(s.dir), false, 'no card while the Foreman works');

  // Raj adds a comment meanwhile: it joins round 1 as new, and waits for your yes.
  github.prs[152].comments.push(lineComment(7003, 'web/src/App.tsx', 30, 'One more: drop the console.log.', { at: '2026-10-28T10:05:00Z' }));
  t.now = Date.parse('2026-10-28T10:06:00Z');
  await c.pass(s.flow());
  v = await s.view();
  assert.equal(v.state, 'new-comment');
  assert.equal(v.bar.headline, 'Raj added a comment while the Foreman works on round 1');
  assert.equal(v.round.pending[0].newWords, 'New · joined round 1');
  await c.act('sample-job', 'add-new');
  assert.match(driver.sent[1].text, /^New items joined round 1 on PR #2\./);
  assert.match(driver.sent[1].text, /c7003 · Change · web\/src\/App\.tsx line 30/);
  assert.ok(!/c7001 ·/.test(driver.sent[1].text), 'only the new one');

  // The Foreman reports in status.json, then its reply ends: ready to send back.
  t.status = report([
    { id: 'c7001', kind: 'change', plan: 'fix', planText: 'Rename to feedbackId', state: 'fixed', commit: 'abc1234', reply: 'Fixed in abc1234: renamed to feedbackId.' },
    { id: 'c7002', kind: 'question', plan: 'answer', planText: 'Explain', state: 'answered', reply: 'It is reassigned in the loop below, so it stays a let.' },
    { id: 'r5001', kind: 'change', plan: 'answer', state: 'answered', reply: 'Thanks: all done.' },
    { id: 'c7003', kind: 'change', plan: 'fix', state: 'fixed', commit: 'def5678', reply: 'Fixed in def5678: dropped it.' },
  ]);
  driver.active = false;
  v = await c.refreshJob('sample-job');
  assert.equal(v.state, 'ready');
  assert.equal(v.bar.headline, 'Round 1 is ready to send back');
  assert.equal(v.bar.detail, '2 fixed and 2 answered. npm test passes (212 of 212).');
  assert.equal(v.round.groups.flatMap((g) => g.items).find((i) => i.id === 'r5001').kind, 'nit', 'the kind you picked stands');
  assert.deepEqual(v.send.steps.map((x) => [x.number, x.id, x.stateWords]), [[1, 'push', 'Will do'], [2, 'follow-up', 'Will do'], [3, 'replies', 'Will do'], [4, 'resolve', 'Will do'], [5, 'request', 'Will do']]);
  assert.equal(driver.cards.get(s.dir).actions[0].label, 'Send back to Raj');
  assert.equal(c.isWaiting(), false);

  // Drop one reply, then go.
  await c.act('sample-job', 'item', { id: 'r5001', replyDropped: true });
  v = await c.act('sample-job', 'send', { go: true });
  assert.ok(['sending', 'waiting'].includes(v.state));
  await c.sendingNow('sample-job');
  v = await s.view();
  assert.equal(v.state, 'waiting');
  assert.equal(v.bar.headline, 'Waiting on Raj to review PR #2 again');
  assert.equal(c.isWaiting(), true, 'GitHub is checked every minute meanwhile');

  // Every write, in order: the push (no flags, to your fork), the follow-up PR #1 opened and merged
  // once green, one reply per comment, the fixed ones resolved, Raj asked again.
  const pushes = s.gitCalls.filter((g) => g[1] === 'push');
  assert.deepEqual(pushes, [[path.join(s.root, 'worktree'), 'push', 'origin', 'feature/sample-job']]);
  const writes = github.writes();
  assert.deepEqual(writes.map((w) => w.slice(0, 4)), [
    ['pr', 'create', '--repo', REPO],
    ['pr', 'merge', '777', '--repo'],
    ['api', '--method', 'POST', `repos/${REPO}/pulls/152/comments/7001/replies`],
    ['api', '--method', 'POST', `repos/${REPO}/pulls/152/comments/7002/replies`],
    ['api', '--method', 'POST', `repos/${REPO}/pulls/152/comments/7003/replies`],
    ['api', 'graphql', '-f', 'query=mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}'],
    ['api', 'graphql', '-f', 'query=mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}'],
    ['pr', 'edit', '152', '--repo'],
  ]);
  assert.deepEqual(writes[0], ['pr', 'create', '--repo', REPO, '--base', 'feature/sample-job', '--head', 'you:feature/sample-job', '--title', 'Follow-up for Raj’s review on PR #2', '--body', writes[0][11]]);
  assert.match(writes[0][11], /^Follow-up for Raj’s review on PR #2 \(https:\/\/github\.com\/acme\/sample-repo\/pull\/152\), round 1\.\n\n## What changed\n- abc1234 Rename to feedbackId \(review: c7001\)/);
  assert.deepEqual(writes[1], ['pr', 'merge', '777', '--repo', REPO, '--merge']);
  assert.deepEqual(writes[2].slice(4), ['-f', 'body=Fixed in abc1234: renamed to feedbackId.']);
  assert.deepEqual(writes[3].slice(4), ['-f', 'body=It is reassigned in the loop below, so it stays a let.'], 'the reply as drafted');
  assert.deepEqual([writes[5].at(-1), writes[6].at(-1)], ['id=PRRT_7001', 'id=PRRT_7003'], 'only the fixed ones: not the answered question');
  assert.deepEqual(writes[7], ['pr', 'edit', '152', '--repo', REPO, '--add-reviewer', 'raj-moxie']);
  assert.ok(!writes.some((w) => w.includes(`repos/${REPO}/issues/152/comments`)), 'the dropped reply isn’t posted');
  // The follow-up PR #1's checks were read before it was merged.
  const merged = github.calls.findIndex((x) => x[1] === 'merge');
  assert.ok(github.calls.slice(0, merged).some((x) => x[0] === 'pr' && x[1] === 'view' && x[2] === '777'));

  const ghLines = audit.filter((l) => l.action === 'gh-write');
  assert.deepEqual(ghLines.map((l) => l.what), ['push', 'open-pr', 'merge', 'reply', 'reply', 'reply', 'resolve', 'resolve', 'request-review']);
  assert.ok(ghLines.every((l) => l.ok && l.yes === 'Send back round 1 on PR #2'), 'each write carries your go');
  assert.deepEqual(audit.filter((l) => l.action === 'review-round-step').map((l) => [l.number, l.ok]), [[1, true], [2, true], [3, true], [4, true], [5, true]]);
  assert.equal(audit.filter((l) => l.action === 'review-round-sent').length, 1);
  const [saved] = await readRounds(s.dir);
  assert.equal(saved.state, 'sent');
  assert.equal(saved.sentHead, FIXED);
  assert.deepEqual(saved.followUp, { number: 777, url: `https://github.com/${REPO}/pull/777`, opened: true });
  assert.ok(t.refreshes > 0, 'GitHub is read again right after the push');

  // Raj approves: round 1 is done, and he merges PR #2, so there's nothing for you to do.
  github.prs[152].view = prView(152, { reviewDecision: 'APPROVED', headRefOid: FIXED, reviewRequests: [] });
  github.prs[152].reviews.push(review(5009, 'APPROVED', '', '2026-10-28T11:00:00Z', FIXED));
  t.now = Date.parse('2026-10-28T11:30:00Z');
  await c.pass(s.flow());
  v = await s.view();
  assert.equal(v.state, 'approved-they-merge');
  assert.equal(v.bar.headline, 'Waiting for Raj to merge PR #2');
  assert.equal((await readRounds(s.dir))[0].state, 'done');
  await assert.rejects(c.act('sample-job', 'merge', { go: true, confirm: 'merge PR #2' }), (e) => e.status === 409, 'Raj merges PR #2, not you');
  await assert.rejects(c.act('sample-job', 'remind', { go: true }), (e) => e.status === 409 && /a day after the approval/.test(e.message));
  // A day later: Remind Raj, the comment as shown (edited).
  t.now = Date.parse('2026-10-29T11:30:00Z');
  await c.refreshJob('sample-job');
  v = await s.view();
  assert.equal(v.remind.can, true);
  await c.act('sample-job', 'remind', { go: true, text: 'Hi Raj, could you merge PR #2 when you get a moment? Thanks!' });
  assert.deepEqual(github.writes().at(-1), ['pr', 'comment', '152', '--repo', REPO, '--body', 'Hi Raj, could you merge PR #2 when you get a moment? Thanks!']);
  assert.equal((await s.view()).remind.can, false, 'once a day at most');
  assert.ok(audit.some((l) => l.action === 'review-remind' && l.who === 'Raj'));
  // Nothing ever forced, merged with --admin, or pushed to the org.
  for (const w of github.calls) for (const bad of ['--force', '--admin', '--auto', 'moxie']) assert.ok(!w.includes(bad), `gh ${w.join(' ')}`);
});

test('Send back stops at the first failure and says which line; Try again from here never posts a reply twice; the lock held in a terminal turns it off', async () => {
  const s = await setup();
  const { c, t, driver, github, audit } = s;
  await c.pass(s.flow());
  await c.act('sample-job', 'fix', {});
  t.status = report([
    { id: 'c7001', state: 'fixed', commit: 'abc1234', reply: 'Fixed in abc1234.' },
    { id: 'c7002', state: 'answered', reply: 'It is reassigned below.' },
    { id: 'r5001', state: 'answered', reply: 'Thanks.' },
  ]);
  let v = await c.refreshJob('sample-job');
  assert.equal(v.state, 'ready');

  // The lock is taken in a terminal: the state stays, its go is off, Send back is refused.
  t.lock = { pid: 4242, branch: 'feature/sample-job', owner: 'terminal', acquiredAt: '2026-10-28T09:50:00Z' };
  v = await c.refreshJob('sample-job');
  assert.equal(v.state, 'held');
  assert.equal(v.heldState, 'ready');
  assert.match(v.bar.detail, /^pid 4242, branch feature\/sample-job, since \d\d:\d\d\. Carry on there, or close it there to send back from here\.$/);
  assert.equal(driver.cards.get(s.dir).disabled, 'Send back is off until the terminal lets go.');
  await assert.rejects(c.act('sample-job', 'send', { go: true }), (e) => e.status === 409 && e.code === 'job-locked');
  t.lock = null;
  await c.refreshJob('sample-job');

  // The second reply fails (GitHub 502): step 3 stops, 4 and 5 don't run.
  github.fails.set(`api --method POST repos/${REPO}/pulls/152/comments/7002/replies`, 'HTTP 502: Bad Gateway');
  await c.act('sample-job', 'send', { go: true, mergeFollowUp: true });
  await c.sendingNow('sample-job');
  v = await s.view();
  assert.equal(v.state, 'stopped');
  assert.equal(v.bar.headline, 'Stopped at step 3: reply 2 of 3 didn’t post');
  assert.equal(v.bar.detail, 'GitHub had a problem (502). Steps 1 and 2 are done, 1 reply is posted, and steps 4 and 5 didn’t run.');
  assert.equal(v.bar.error, 'HTTP 502: Bad Gateway');
  assert.deepEqual(v.send.steps.map((x) => x.stateWords), ['Done', 'Done', 'Stopped here', 'Not run', 'Not run']);
  assert.deepEqual(v.bar.actions.map((a) => [a.id, a.label]), [['retry', 'Try again from here'], ['not-yet', 'Not yet']]);
  assert.ok(!github.writes().some((w) => w[1] === 'edit'), 'Raj wasn’t asked again');
  assert.equal(audit.filter((l) => l.action === 'review-round-stopped').at(-1).at, 3);

  // Try again from here: the push and the follow-up don't run again, the posted reply isn't posted twice.
  const before = github.writes().length;
  await c.act('sample-job', 'retry', { go: true });
  await c.sendingNow('sample-job');
  v = await s.view();
  assert.equal(v.state, 'waiting');
  const again = github.writes().slice(before);
  const label = (w) => (w[1] === 'graphql' ? 'resolve' : w[2] === 'POST' ? w[3] : w[1]);
  assert.deepEqual(again.map(label), [`repos/${REPO}/pulls/152/comments/7002/replies`, `repos/${REPO}/issues/152/comments`, 'resolve', 'edit'], 'one fixed comment, resolved once');
  const replies = github.writes().filter((w) => /\/replies$/.test(w[3] ?? ''));
  assert.deepEqual(replies.map((w) => w[3].split('/').at(-2)), ['7001', '7002', '7002'], '7001 once; 7002 tried, then posted');
  assert.equal(s.gitCalls.filter((g) => g[1] === 'push').length, 1, 'pushed once');
  // The review comment's reply: a comment on the PR quoting it.
  assert.equal(github.writes().find((w) => w[3] === `repos/${REPO}/issues/152/comments`).at(-1), 'body=@raj-moxie \n> A few things before this goes in.\n\nThanks.');
});

test('I’ll merge PR #1 myself: Send back stops after opening it, and carries on once it is merged', async () => {
  const s = await setup();
  const { c, t, github } = s;
  await c.pass(s.flow());
  await c.act('sample-job', 'fix', {});
  t.status = report([{ id: 'c7001', state: 'fixed', commit: 'abc1234', reply: 'Fixed.' }, { id: 'c7002', state: 'answered', reply: 'Kept.' }, { id: 'r5001', state: 'answered', reply: 'Thanks.' }]);
  await c.refreshJob('sample-job');
  await c.act('sample-job', 'send', { go: true, mergeFollowUp: false });
  await c.sendingNow('sample-job');
  let v = await s.view();
  assert.equal(v.state, 'after-pr1');
  assert.equal(v.bar.headline, 'Waiting for you to merge the follow-up PR #1 (#777)');
  assert.deepEqual(v.send.steps.map((x) => x.stateWords), ['Done', 'Done', 'After PR #1 is merged', 'After PR #1 is merged', 'After PR #1 is merged']);
  assert.equal(c.isWaiting(), true);
  assert.ok(!github.writes().some((w) => w[1] === 'merge'), 'not merged from here');
  // You merge it on GitHub: the next look carries on with steps 3 to 5.
  github.prs[777].view.state = 'MERGED';
  await c.pass(s.flow({ pr1: { number: 777, state: 'merged', url: `https://github.com/${REPO}/pull/777` } }));
  await c.sendingNow('sample-job');
  v = await s.view();
  assert.equal(v.state, 'waiting');
  assert.deepEqual(github.writes().map((w) => w[1] === 'graphql' ? 'resolve' : w[1] === '--method' ? 'reply' : w[1]), ['create', 'reply', 'reply', 'reply', 'resolve', 'edit']);
});

test('merge: only when the route lets you, only on the ask’s go with its confirm', async () => {
  const s = await setup({ route: [] });
  const { c, github, audit } = s;
  github.prs[152].view = prView(152, { reviewDecision: 'APPROVED', reviewRequests: [] });
  github.prs[152].reviews = [review(5009, 'APPROVED', '', '2026-10-28T09:30:00Z')];
  github.prs[152].comments = [];
  await c.pass(s.flow());
  let v = await s.view();
  assert.equal(v.state, 'approved-you-merge');
  assert.equal(v.bar.headline, 'PR #2 is approved and green: merge it into staging?');
  await assert.rejects(c.act('sample-job', 'merge', { go: true }), (e) => e.status === 400 && e.code === 'merge-needs-confirm');
  await assert.rejects(c.act('sample-job', 'merge', { go: false, confirm: 'merge PR #2' }), (e) => e.code === 'merge-needs-confirm');
  await assert.rejects(c.act('sample-job', 'merge', { go: true, confirm: 'merge PR #3' }), (e) => e.code === 'merge-needs-confirm');
  assert.deepEqual(github.writes(), [], 'nothing merged without the confirm');
  v = await c.act('sample-job', 'merge', { go: true, confirm: 'merge PR #2' });
  assert.deepEqual(github.writes(), [['pr', 'merge', '152', '--repo', REPO, '--merge']]);
  assert.equal(v.state, 'merged');
  assert.equal(v.bar.headline, 'PR #2 is merged into staging');
  assert.ok(audit.some((l) => l.action === 'gh-write' && l.what === 'merge' && l.yes === 'Merge PR #2 into staging'));
});

test('no reviewer asked: Ask for a review with their GitHub name; closed: reopen it; both on your go', async () => {
  const s = await setup();
  const { c, github } = s;
  github.prs[152].view = prView(152, { reviewDecision: 'REVIEW_REQUIRED', reviewRequests: [] });
  github.prs[152].reviews = [];
  github.prs[152].comments = [];
  await c.pass(s.flow());
  assert.equal((await s.view()).state, 'no-reviewer');
  await assert.rejects(c.act('sample-job', 'ask-review', { login: 'raj-moxie' }), (e) => e.status === 400);
  await assert.rejects(c.act('sample-job', 'ask-review', { go: true, login: 'raj moxie' }), (e) => e.status === 400 && /GitHub name/.test(e.message));
  await c.act('sample-job', 'ask-review', { go: true, login: '@raj-moxie' });
  assert.deepEqual(github.writes(), [['pr', 'edit', '152', '--repo', REPO, '--add-reviewer', 'raj-moxie']]);

  github.prs[152].view = prView(152, { state: 'CLOSED', closedAt: '2026-10-28T09:40:00Z', reviewDecision: 'REVIEW_REQUIRED', reviewRequests: [{ login: 'raj-moxie' }] });
  await c.pass(s.flow({ pr2: { number: 152, state: 'closed' } }));
  const v = await s.view();
  assert.equal(v.state, 'closed', 'a PR closed while the job was on it stays, for Reopen');
  assert.equal(v.bar.headline, 'PR #2 was closed without merging');
  assert.deepEqual(s.driver.cards.get(s.dir).actions.map((a) => a.label), ['Reopen PR #2'], 'Mark the job dropped is the page’s own');
  await assert.rejects(c.act('sample-job', 'reopen', {}), (e) => e.status === 400);
  await c.act('sample-job', 'reopen', { go: true });
  assert.deepEqual(github.writes().at(-1), ['pr', 'reopen', '152', '--repo', REPO]);
  assert.ok(s.audit.some((l) => l.action === 'review-reopen' && l.prLabel === 'PR #2'));
});

test('settings: how often to check GitHub is 1, 5, 10 or 30 minutes; anything else is refused in words', async () => {
  const s = await setup();
  assert.deepEqual(GITHUB_EVERY_CHOICES, [1, 5, 10, 30]);
  assert.deepEqual(await s.c.settings(), { githubEveryMin: 1, mergeFollowUp: true });
  await assert.rejects(s.c.setSettings({ githubEveryMin: 7 }), (e) => e.status === 400 && e.message === 'How often to check GitHub is every 1, 5, 10 or 30 minutes.');
  await assert.rejects(s.c.setSettings({ githubEveryMin: '5' }), (e) => e.status === 400);
  await assert.rejects(s.c.setSettings({ mergeFollowUp: 'yes' }), (e) => e.status === 400);
  assert.deepEqual(await s.c.setSettings({ githubEveryMin: 5, mergeFollowUp: false }), { githubEveryMin: 5, mergeFollowUp: false });
  assert.deepEqual(s.t.settings, { githubEveryMin: 5, mergeFollowUp: false });
});
