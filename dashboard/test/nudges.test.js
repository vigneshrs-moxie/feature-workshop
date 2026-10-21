// Hand-off nudges (lib/nudges.js): which one a job gets at each PR place, from its lane or its
// status.json, after the finish line or not, and dismissed. Invented jobs and PRs only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NUDGE_IDS, nudgesFor } from '../lib/nudges.js';

const URL1 = 'https://github.com/acme/portal/pull/141';
const URL2 = 'https://github.com/acme/portal/pull/142';
const pr = (number, state, extra = {}) => ({ number, url: number === 141 ? URL1 : URL2, state, review: null, checks: 'passing', mergedAt: null, ...extra });
const lane = (position, pr1, pr2) => ({ slug: 'a', position, reached: ['local', 'fork', 'org', 'staging', 'main'].indexOf(position), pr1, pr2 });
const card = (extra = {}) => ({ stage: 'review', prs: [], closed: null, ...extra });
const ids = (list) => list.map((n) => n.id);

test('the table: one nudge per PR place, in words, with a link or a sentence for the Foreman', () => {
  assert.deepEqual(NUDGE_IDS, ['pr1-merge', 'pr2-open', 'pr2-review', 'pr2-merge']);
  const cases = [
    [lane('fork', pr(141, 'open', { checks: 'failing' }), null), 'pr1-merge', 'link', 'Self-review and merge PR #1 on GitHub', URL1],
    [lane('org', pr(141, 'merged'), null), 'pr2-open', 'ask', 'Open PR #2 to staging?', 'Please open PR #2 (org branch → staging).'],
    [lane('org', pr(141, 'merged'), pr(142, 'open', { review: 'review_required' })), 'pr2-review', 'ask', 'Ask Raj for a review?', 'Please request Raj’s review on PR #2.'],
    [lane('org', pr(141, 'merged'), pr(142, 'open', { review: 'changes_requested' })), 'pr2-review', 'ask', 'Ask Raj for a review?', 'Please request Raj’s review on PR #2.'],
    [lane('org', pr(141, 'merged'), pr(142, 'open', { review: 'approved' })), 'pr2-merge', 'link', 'Merge PR #2 on GitHub', URL2],
  ];
  for (const [l, id, kind, title, target] of cases) {
    const got = nudgesFor(card({ stage: l.pr2 ? 'pr2' : l.pr1?.state === 'merged' ? 'pr1' : 'pr1' }), l, { finishLine: 'main' });
    assert.equal(got.length, 1, id);
    const n = got[0];
    assert.equal(n.id, id);
    assert.equal(n.kind, kind);
    assert.equal(n.title, title);
    assert.ok(n.text.length > 20, 'says what it is about');
    if (kind === 'link') { assert.equal(n.link, target); assert.equal(n.action, null); } else { assert.equal(n.link, null); assert.deepEqual(n.action, { send: target }); }
    assert.equal(n.afterLine, false, 'the finish line is main: nothing is after it');
  }
  assert.match(nudgesFor(card(), lane('fork', pr(141, 'open', { checks: 'failing' }), null), { finishLine: 'main' })[0].text, /checks are failing/);
});

test('nothing before PR #1, once PR #2 is merged, past the pr2 stage, or on a dropped job', () => {
  assert.deepEqual(nudgesFor(card(), lane('local', null, null), { finishLine: 'main' }), []);
  assert.deepEqual(nudgesFor(card(), lane('fork', null, null), { finishLine: 'main' }), []);
  assert.deepEqual(nudgesFor(card(), lane('fork', pr(141, 'draft'), null), { finishLine: 'main' }), [], 'a draft PR #1 is not ready to merge');
  assert.deepEqual(nudgesFor(card({ stage: 'pr2' }), lane('org', pr(141, 'merged'), pr(142, 'draft')), { finishLine: 'main' }), [], 'a draft PR #2 is not ready for Raj');
  assert.deepEqual(nudgesFor(card({ stage: 'pr3' }), lane('staging', pr(141, 'merged'), pr(142, 'merged')), { finishLine: 'main' }), []);
  assert.deepEqual(nudgesFor(card({ stage: 'staging-qa' }), lane('org', pr(141, 'merged'), null), { finishLine: 'main' }), [], 'past pr2: no second PR #2');
  assert.deepEqual(nudgesFor(card({ stage: 'pr1', closed: { as: 'dropped', at: '2026-10-21T10:00:00Z' } }), lane('fork', pr(141, 'open'), null), { finishLine: 'main' }), []);
  assert.deepEqual(nudgesFor(null, null, {}), []);
});

test('falls back to status.json’s prs when the map has no lane; not_started is no PR', () => {
  const prs = [{ number: 1, label: 'fork → org branch', url: URL1, state: 'open' }, { number: 2, label: 'org branch → staging', url: null, state: 'not_started' }];
  const got = nudgesFor(card({ stage: 'pr1', prs }), null, { finishLine: 'main' });
  assert.deepEqual(ids(got), ['pr1-merge']);
  assert.equal(got[0].link, URL1);
  assert.match(got[0].text, /#1 \(#1\)/);
  const merged = [{ number: 1, url: URL1, state: 'merged' }, { number: 2, url: URL2, state: 'open' }];
  assert.deepEqual(ids(nudgesFor(card({ stage: 'pr2', prs: merged }), null, { finishLine: 'main' })), ['pr2-review']);
  assert.deepEqual(ids(nudgesFor(card({ stage: 'pr2', prs: [merged[0]] }), null, { finishLine: 'main' })), ['pr2-open']);
  // The lane wins over the record when both are there.
  assert.deepEqual(ids(nudgesFor(card({ stage: 'pr1', prs }), lane('org', pr(141, 'merged'), null), { finishLine: 'main' })), ['pr2-open']);
});

test('afterLine: a job past the finish line keeps its nudges, marked, whether the card or the setting says so', () => {
  const l = lane('org', pr(141, 'merged'), pr(142, 'open', { review: 'review_required' }));
  // The default line (PR #1 merged) is crossed: the nudge is after it.
  assert.equal(nudgesFor(card({ stage: 'pr2' }), l, { finishLine: 'pr1-merged' })[0].afterLine, true);
  assert.equal(nudgesFor(card({ stage: 'pr2' }), l, { finishLine: 'staging' })[0].afterLine, false);
  // A card that carries `finish` is believed as it is.
  assert.equal(nudgesFor(card({ stage: 'pr2', finish: { reached: true, at: null, by: 'pr1-merged', landed: null } }), l, { finishLine: 'main' })[0].afterLine, true);
  assert.equal(nudgesFor(card({ stage: 'pr2', finish: { reached: false, at: null, by: null, landed: null } }), l, { finishLine: 'pr1-open' })[0].afterLine, false);
  // Marked done by hand: after the line too.
  assert.equal(nudgesFor(card({ stage: 'pr1', closed: { as: 'done', at: '2026-10-21T10:00:00Z' } }), lane('fork', pr(141, 'open'), null), { finishLine: 'main' })[0].afterLine, true);
});

test('dismissed ids are left out; unknown ids in the list are harmless', () => {
  const l = lane('org', pr(141, 'merged'), pr(142, 'open'));
  assert.deepEqual(ids(nudgesFor(card({ stage: 'pr2' }), l, { finishLine: 'main', dismissed: ['pr2-review'] })), []);
  assert.deepEqual(ids(nudgesFor(card({ stage: 'pr2' }), l, { finishLine: 'main', dismissed: ['pr1-merge', 'nonsense'] })), ['pr2-review']);
  assert.deepEqual(ids(nudgesFor(card({ stage: 'pr2' }), l, { finishLine: 'main', dismissed: 'pr2-review' })), ['pr2-review'], 'not a list: nothing dismissed');
});
