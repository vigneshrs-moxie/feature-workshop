// The finish line (lib/finish.js): the five choices against where a job's work is. Invented lanes
// and cards only; nothing is read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FINISH_LINE, FINISH_LINES, FINISH_LINE_INFO, finishLineOf, finishLineReached } from '../lib/finish.js';

const POS = ['local', 'fork', 'org', 'staging', 'main'];
const MERGED_1 = '2026-10-20T10:00:00.000Z';
const MERGED_2 = '2026-10-21T09:00:00.000Z';
// A lane at each position, with the PRs that position implies.
function lane(position, extra = {}) {
  const reached = POS.indexOf(position);
  return {
    slug: 'a', position, reached,
    pr1: reached >= 2 ? { number: 1, state: 'merged', mergedAt: MERGED_1 } : null,
    pr2: reached >= 3 ? { number: 2, state: 'merged', mergedAt: MERGED_2 } : null,
    ...extra,
  };
}
const card = (extra = {}) => ({ prs: [{ number: 1, url: null }], closed: null, ...extra });

test('finish line: the choices, the default and their words', () => {
  assert.deepEqual(FINISH_LINES, ['pr1-open', 'pr1-merged', 'staging', 'main', 'marked']);
  assert.equal(DEFAULT_FINISH_LINE, 'pr1-merged');
  for (const id of FINISH_LINES) assert.ok(FINISH_LINE_INFO[id].label && FINISH_LINE_INFO[id].hint, id);
  assert.equal(finishLineOf('staging'), 'staging');
  assert.equal(finishLineOf('whenever'), DEFAULT_FINISH_LINE);
  assert.equal(finishLineOf(undefined), DEFAULT_FINISH_LINE);
});

test('finish line: each choice against each lane position (nothing marked)', () => {
  // setting → the first position that crosses it
  const crossesAt = { 'pr1-open': 'org', 'pr1-merged': 'org', staging: 'staging', main: 'main' };
  for (const [setting, first] of Object.entries(crossesAt)) {
    for (const position of POS) {
      const f = finishLineReached(card(), lane(position), setting);
      const expected = POS.indexOf(position) >= POS.indexOf(first);
      assert.equal(f.reached, expected, `${setting} at ${position}`);
      assert.equal(f.by, expected ? setting : null, `${setting} at ${position}: by`);
      assert.equal(f.landed, position === 'main' ? 'main' : position === 'staging' ? 'staging' : null, `${setting} at ${position}: landed`);
    }
  }
  // "When I mark it done": no position crosses it.
  for (const position of POS) {
    const f = finishLineReached(card(), lane(position), 'marked');
    assert.equal(f.reached, false, `marked at ${position}`);
    assert.equal(f.landed, position === 'main' ? 'main' : position === 'staging' ? 'staging' : null);
  }
});

test('finish line: PR #1 open counts an open or draft PR #1, from the lane or status.json', () => {
  const open = lane('fork', { pr1: { number: 1, state: 'open', mergedAt: null } });
  assert.deepEqual(finishLineReached(card(), open, 'pr1-open'), { reached: true, at: null, by: 'pr1-open', landed: null });
  assert.equal(finishLineReached(card(), lane('fork', { pr1: { number: 1, state: 'draft' } }), 'pr1-open').reached, true);
  assert.equal(finishLineReached(card(), lane('fork', { pr1: { number: 1, state: 'closed' } }), 'pr1-open').reached, false, 'closed without merging is not open');
  assert.equal(finishLineReached(card(), open, 'pr1-merged').reached, false, 'open is not merged');
  // No lane yet (the map hasn't read this repo): status.json's first PR is enough.
  assert.equal(finishLineReached(card({ prs: [{ number: 1, url: 'https://github.com/o/r/pull/7', state: 'open' }] }), null, 'pr1-open').reached, true);
  assert.equal(finishLineReached(card({ prs: [{ number: 1, url: 'https://github.com/o/r/pull/7', state: 'open' }] }), null, 'pr1-merged').reached, false);
  assert.equal(finishLineReached(card({ prs: [{ number: 1, url: 'https://github.com/o/r/pull/7', state: 'merged' }] }), null, 'pr1-merged').reached, true);
  assert.equal(finishLineReached(card({ prs: [{ number: 1, url: 'https://github.com/o/r/pull/7', state: 'merged' }] }), null, 'staging').reached, false);
  assert.deepEqual(finishLineReached(card(), null, 'pr1-open'), { reached: false, at: null, by: null, landed: null });
});

test('finish line: when it was crossed comes from the PR merged', () => {
  assert.equal(finishLineReached(card(), lane('org'), 'pr1-merged').at, MERGED_1);
  assert.equal(finishLineReached(card(), lane('staging'), 'staging').at, MERGED_2);
  assert.equal(finishLineReached(card(), lane('staging'), 'pr1-merged').at, MERGED_1, 'the place the setting names, not where the work is');
  assert.equal(finishLineReached(card(), lane('main'), 'main').at, null, 'main has no time of its own');
});

test('finish line: marking a job done always counts, whatever the setting', () => {
  const closed = { as: 'done', at: '2026-10-21T12:00:00.000Z' };
  for (const setting of FINISH_LINES) {
    const f = finishLineReached(card({ closed }), lane('local'), setting);
    assert.deepEqual(f, { reached: true, at: closed.at, by: 'marked', landed: null }, setting);
  }
  // Dropped is not done.
  assert.equal(finishLineReached(card({ closed: { as: 'dropped', at: closed.at } }), lane('fork'), 'marked').reached, false);
  // Marked and past the line: the line's place is what crossed it; the landing shows regardless.
  const both = finishLineReached(card({ closed }), lane('staging'), 'pr1-merged');
  assert.deepEqual(both, { reached: true, at: MERGED_1, by: 'pr1-merged', landed: 'staging' });
  assert.deepEqual(finishLineReached(card({ closed }), lane('main'), 'marked'), { reached: true, at: closed.at, by: 'marked', landed: 'main' });
});

test('finish line: an unknown setting reads as the default, and a lane without `reached` still works', () => {
  assert.equal(finishLineReached(card(), lane('org'), 'whenever').by, 'pr1-merged');
  assert.equal(finishLineReached(card(), { position: 'staging', pr1: null, pr2: null }, 'staging').reached, true);
  assert.equal(finishLineReached(undefined, undefined, undefined).reached, false);
});
