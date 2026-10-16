// The play ledger (lib/play.js): crew met, quests done, achievements and secrets, from fixture
// audit lines and job records only. Pure functions, plus PlayBook on a temp folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ACHIEVEMENTS, CREW_TYPES, EXPLORER_THEMES, GOLD_QUESTS, LENS_TYPES, PLAY_DEFAULTS, PLAY_EVENTS, PLAY_SCHEMA, PlayBook, PlayError,
  SECRET_IDS, THEME_IDS, buildLedger, jobKey, ledgerView, lensType, newlyDone, newlyUnlocked, parseReviewFindings, playSettings,
  themeUnlocked, unlocksOf, validatePlayPatch,
} from '../lib/play.js';
import { parseSessionLog } from '../lib/session-log.js';

const DIR = '/tmp/fw-play/feature-work';
const local = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();
const T0 = local(2026, 10, 16, 10, 0);
const plus = (at, min) => new Date(Date.parse(at) + min * 60000).toISOString();
const PR = [{ number: 1, url: 'https://github.com/example/repo/pull/7', state: 'open' }, { number: 2, url: null }, { number: 3, url: null }];

function job(slug, extra = {}) {
  return { slug, dir: `${DIR}/${slug}`, kind: 'feature', level: 2, prs: [{ number: 1, url: null }], updatedAt: T0, workers: [], review: null, ...extra };
}
const prJob = (slug, extra = {}) => job(slug, { prs: PR, ...extra });
// A job whose first PR the session log says was created at `at` (an exact finish time).
const prJobAt = (slug, at, extra = {}) => prJob(slug, { updatedAt: at, prLinks: [{ url: PR[0].url, number: 7, at }], ...extra });
const unlocked = (ledger) => Object.keys(ledger.achievements).sort();
const build = (input) => buildLedger({ now: plus(T0, 600), ...input });

// ---------- Settings ----------

test('play settings: defaults are Subtle, first PR, no sounds; bad stored values fall back', () => {
  assert.deepEqual(playSettings(undefined), { mode: 'subtle', questDone: 'first-pr', sounds: false });
  assert.deepEqual(PLAY_DEFAULTS, { mode: 'subtle', questDone: 'first-pr', sounds: false });
  assert.deepEqual(playSettings({ mode: 'full', questDone: 'marked-done', sounds: true }), { mode: 'full', questDone: 'marked-done', sounds: true });
  assert.deepEqual(playSettings({ mode: 'loud', questDone: 'whenever', sounds: 'yes' }), PLAY_DEFAULTS);
});

test('play settings: a change from the page takes only known fields with allowed values', () => {
  assert.deepEqual(validatePlayPatch({ mode: 'off' }), { mode: 'off' });
  assert.deepEqual(validatePlayPatch({ questDone: 'marked-done', sounds: true }), { questDone: 'marked-done', sounds: true });
  for (const bad of [null, [], 'full', {}, { mode: 'FULL' }, { mode: 'party' }, { questDone: 'merged' }, { sounds: 1 }, { xp: 10 }]) {
    assert.throws(() => validatePlayPatch(bad), PlayError, JSON.stringify(bad));
  }
});

// ---------- review.md ----------

test('review.md: the summary line, else the findings table, else "No findings"', () => {
  const summary = parseReviewFindings('# Review v1\n\n**Result:** 0 blockers, 2 majors, 3 minors\n');
  assert.deepEqual({ ...summary, byLens: undefined }, { blockers: 0, majors: 2, minors: 3, total: 5, byLens: undefined, round: 1, laterRound: false });
  const table = parseReviewFindings('## Findings\n\n| ID | Severity | Lens | Finding |\n|---|---|---|---|\n| R-1 | major | errors | x |\n| R-2 | **blocker** | Locksmith | y |\n| R-3 | minor | db | z |\n');
  assert.equal(table.total, 3);
  assert.equal(table.blockers, 1);
  assert.deepEqual(table.byLens['feature-review-errors'], { blockers: 0, majors: 1, minors: 0 });
  assert.deepEqual(table.byLens['feature-review-permissions'], { blockers: 1, majors: 0, minors: 0 });
  assert.deepEqual(table.byLens['feature-review-db'], { blockers: 0, majors: 0, minors: 1 });
  assert.equal(parseReviewFindings('# Review v2\n\n**Result:** No findings. Ship it.').total, 0);
  assert.equal(parseReviewFindings('# Review v2\n\n## Summary\n\nNo findings from any lens.\n').total, 0);
  assert.equal(parseReviewFindings('# Review\n\nStill being written.'), null);
  assert.equal(parseReviewFindings(''), null);
  // "No findings" counts only on a Result/summary line, not in passing.
  assert.equal(parseReviewFindings('# Review v1\n\nThe Painter had no findings; the rest are still running.\n'), null);
  // Counts on the Result line win over numbers mentioned elsewhere.
  assert.equal(parseReviewFindings('# Review v2\n\nRound 1 raised 2 blockers, both fixed.\n\n**Result:** 0 blockers, 0 majors, 1 minor\n').blockers, 0);
  // The Foreman's own pre-PR diff check is not a lens review.
  assert.equal(parseReviewFindings('# Pre-PR diff check\n\n**Result:** 0 blockers, 0 majors, 0 minors\n'), null);
  // Rows taken back (dropped, false positive) are not findings.
  const taken = parseReviewFindings('| ID | Severity | Lens | Finding | Status |\n|---|---|---|---|---|\n| R-1 | major | errors | x | open |\n| R-2 | blocker | db | y | dropped |\n| R-3 | minor | ui | z | False positive |\n');
  assert.deepEqual([taken.total, taken.majors, taken.blockers], [1, 1, 0]);
  assert.equal(lensType('performance'), 'feature-review-performance');
  assert.equal(lensType('spec'), 'feature-reviewer');
  assert.equal(lensType('nonsense'), null);
});

// ---------- Quests ----------

test('quests: by default a job is done when its first PR is created, stamped with the session log’s PR time', () => {
  const l = build({ jobs: [prJobAt('a', plus(T0, 30), { updatedAt: plus(T0, 45) }), job('b')] });
  assert.deepEqual(Object.keys(l.quests), [jobKey('a', `${DIR}/a`)]);
  assert.equal(l.quests[jobKey('a', `${DIR}/a`)].doneAt, plus(T0, 30));
  assert.equal(l.quests[jobKey('a', `${DIR}/a`)].doneAtExact, true);
  assert.equal(l.achievements['first-quest'].unlockedAt, plus(T0, 30));
  // The same PR written another way still matches.
  const other = build({ jobs: [prJob('a', { prLinks: [{ url: 'http://GitHub.com/example/repo/pull/7/', at: plus(T0, 20) }] })] });
  assert.equal(other.quests[jobKey('a', `${DIR}/a`)].doneAt, plus(T0, 20));
  // No PR link in the logs: status.json’s time, marked as a guess.
  const guessed = build({ jobs: [prJob('a', { updatedAt: plus(T0, 30), prLinks: [{ url: 'https://github.com/example/repo/pull/8', at: T0 }] })] });
  assert.equal(guessed.quests[jobKey('a', `${DIR}/a`)].doneAt, plus(T0, 30));
  assert.equal(guessed.quests[jobKey('a', `${DIR}/a`)].doneAtExact, false);
  assert.ok(guessed.achievements['first-quest']);
  // A guessed time is put right once the log shows the PR; the quest is still counted once.
  const fixed = build({ jobs: [prJobAt('a', plus(T0, 10))], previous: guessed });
  assert.equal(fixed.quests[jobKey('a', `${DIR}/a`)].doneAt, plus(T0, 10));
  assert.equal(fixed.quests[jobKey('a', `${DIR}/a`)].doneAtExact, true);
  assert.equal(Object.keys(fixed.quests).length, 1);
  // Marking a job without a PR done is not a quest under this rule.
  const closed = build({ jobs: [job('b')], audit: [{ at: T0, action: 'close', as: 'done', featureDir: `${DIR}/b`, slug: 'b' }] });
  assert.deepEqual(closed.quests, {});
});

test('quests: with "I mark the job done", the first close as done counts; a PR alone or a drop does not', () => {
  const play = { questDone: 'marked-done' };
  assert.deepEqual(build({ play, jobs: [prJob('a')] }).quests, {});
  const dropped = build({ play, jobs: [job('a')], audit: [{ at: T0, action: 'close', as: 'dropped', featureDir: `${DIR}/a`, slug: 'a' }] });
  assert.deepEqual(dropped.quests, {});
  const l = build({ play, jobs: [job('a')], audit: [{ at: plus(T0, 5), action: 'close', as: 'done', featureDir: `${DIR}/a`, slug: 'a' }] });
  assert.equal(l.quests[jobKey('a', `${DIR}/a`)].doneAt, plus(T0, 5));
  assert.equal(l.quests[jobKey('a', `${DIR}/a`)].rule, 'marked-done');
  // A job marked done whose folder is gone still counts (the audit remembers it).
  const gone = build({ play, jobs: [], audit: [{ at: plus(T0, 5), action: 'close', as: 'done', featureDir: `${DIR}/old`, slug: 'old' }] });
  assert.equal(Object.keys(gone.quests).length, 1);
});

test('quests: counted once per job; reopening and finishing again never awards it twice', () => {
  const play = { questDone: 'marked-done' };
  const d = `${DIR}/a`;
  const audit = [
    { at: T0, action: 'close', as: 'done', featureDir: d, slug: 'a' },
    { at: plus(T0, 60), action: 'reopen', featureDir: d, slug: 'a', how: 'button' },
    { at: plus(T0, 120), action: 'close', as: 'done', featureDir: d, slug: 'a' },
  ];
  const first = build({ play, jobs: [job('a')], audit });
  assert.equal(Object.keys(first.quests).length, 1);
  assert.equal(first.quests[jobKey('a', d)].doneAt, T0, 'the first finish');
  // Built again on top of itself, and with the rule switched: still one quest, still the first time.
  const again = build({ play: { questDone: 'first-pr' }, jobs: [prJob('a', { updatedAt: plus(T0, 200) })], audit, previous: first });
  assert.equal(Object.keys(again.quests).length, 1);
  assert.equal(again.quests[jobKey('a', d)].doneAt, T0);
  // A quest stays done when its PR disappears from status.json later.
  const later = build({ jobs: [job('a')], audit: [], previous: again });
  assert.equal(Object.keys(later.quests).length, 1);
  assert.deepEqual(newlyUnlocked(first, later), []);
  // The same slug in another folder is another job.
  const other = build({ jobs: [prJob('a', { dir: `${DIR}-2/a` })], previous: later });
  assert.equal(Object.keys(other.quests).length, 2);
});

// ---------- Achievements, one by one ----------

test('Clean Sweep: the first lens review round of a job comes back clean; draining to clean later does not count', () => {
  const lens = [{ agentType: 'feature-review-errors', startedAt: T0, lastAt: plus(T0, 2) }];
  const review = (at, text) => ({ at, counts: parseReviewFindings(text) });
  const clean = build({ jobs: [job('a', { workers: lens, review: review(plus(T0, 3), '**Result:** 0 blockers, 0 majors, 0 minors') })] });
  assert.equal(clean.achievements['clean-sweep'].unlockedAt, plus(T0, 3));
  assert.deepEqual(clean.reviews[jobKey('a', `${DIR}/a`)].first, { at: plus(T0, 3), blockers: 0, majors: 0, minors: 0, total: 0 });

  // A first round with findings, then a clean one: no Clean Sweep (that is the boss fight's "Boss defeated").
  const dirty = build({ jobs: [job('a', { workers: lens, review: review(T0, '**Result:** 0 blockers, 1 major, 0 minors') })] });
  assert.equal(dirty.achievements['clean-sweep'], undefined);
  const drained = build({ jobs: [job('a', { workers: lens, review: review(plus(T0, 50), '**Result:** No findings.') })], previous: dirty });
  assert.equal(drained.achievements['clean-sweep'], undefined);
  assert.equal(drained.reviews[jobKey('a', `${DIR}/a`)].total, 0, 'the latest round is still recorded');
  assert.equal(drained.reviews[jobKey('a', `${DIR}/a`)].first.total, 1, 'the first round is kept as it was');

  // A rewrite of the first clean round later (findings added) doesn't take it back or change it.
  const rewritten = build({ jobs: [job('a', { workers: lens, review: review(plus(T0, 9), '**Result:** 1 blocker, 0 majors, 0 minors') })], previous: clean });
  assert.equal(rewritten.reviews[jobKey('a', `${DIR}/a`)].first.total, 0);
  assert.equal(rewritten.achievements['clean-sweep'].unlockedAt, plus(T0, 3));

  // No lens ran for the job: a clean review.md is not a lens round.
  const noLens = build({ jobs: [job('a', { review: review(plus(T0, 3), '**Result:** 0 blockers, 0 majors, 0 minors') })] });
  assert.equal(noLens.achievements['clean-sweep'], undefined);
  assert.equal(noLens.reviews[jobKey('a', `${DIR}/a`)].first, null);
  // A lens met through the audit (its own step) counts as having run.
  const byAudit = build({
    jobs: [job('a', { review: review(plus(T0, 3), '**Result:** 0 blockers, 0 majors, 0 minors') })],
    audit: [{ at: T0, action: 'auto-allowed', featureDir: `${DIR}/a`, slug: 'a', tool: 'Read', agentType: 'feature-review-db', headline: 'Read a file' }],
  });
  assert.ok(byAudit.achievements['clean-sweep']);
});

test('review.md: which round it says it is', () => {
  const r = (text) => { const c = parseReviewFindings(text); return [c.round, c.laterRound]; };
  assert.deepEqual(r('# Review v1\n\n**Result:** No findings.'), [1, false]);
  assert.deepEqual(r('# Review\n\n**Result:** No findings.'), [null, false]);
  assert.deepEqual(r('# Review v2\n\n**Result:** No findings.'), [2, true]);
  assert.deepEqual(r('# Review\n\n## Round 3\n\n**Result:** No findings.'), [3, true]);
  assert.deepEqual(r('# Review\n\nSecond round.\n\n**Result:** No findings.'), [2, true]);
  assert.deepEqual(r('# Review v1\n\nR-1 fixed in 3f2a1c.\n\n**Result:** No findings.'), [1, true]);
  // A version outside a heading is not the review's version.
  assert.deepEqual(r('# Review\n\nChecked against spec v3.\n\n**Result:** No findings.'), [null, false]);
});

test('Clean Sweep: only a review evidently in its first round; anything else is "unknown" and never awards', () => {
  const lens = [{ agentType: 'feature-review-errors', startedAt: T0, lastAt: plus(T0, 2) }];
  const key = jobKey('a', `${DIR}/a`);
  const review = (at, text) => ({ at, counts: parseReviewFindings(text) });
  // A fresh build that first sees a clean v2 review: it can't know round 1.
  const v2 = build({ jobs: [job('a', { workers: lens, review: review(plus(T0, 30), '# Review v2\n\n**Result:** 0 blockers, 0 majors, 0 minors') })] });
  assert.deepEqual(v2.reviews[key].first, { unknown: true });
  assert.equal(v2.reviews[key].cleanAt, null);
  assert.equal(v2.achievements['clean-sweep'], undefined);
  // "Round 2" or "fixed" wording does the same.
  for (const text of ['# Review\n\nRound 2.\n\n**Result:** No findings.', '# Review\n\nAll three findings fixed.\n\n**Result:** No findings.']) {
    assert.deepEqual(build({ jobs: [job('a', { workers: lens, review: review(plus(T0, 30), text) })] }).reviews[key].first, { unknown: true }, text);
  }
  // A lens that ran twice on the job: not round 1, even if review.md doesn't say.
  const twice = [...lens, { agentType: 'feature-review-errors', startedAt: plus(T0, 20), lastAt: plus(T0, 22) }];
  const rerun = build({ jobs: [job('a', { workers: twice, review: review(plus(T0, 30), '# Review\n\n**Result:** No findings.') })] });
  assert.deepEqual(rerun.reviews[key].first, { unknown: true });
  assert.equal(rerun.achievements['clean-sweep'], undefined);
  // Unknown stays unknown: a later clean round never turns it into a Clean Sweep.
  const later = build({ jobs: [job('a', { workers: lens, review: review(plus(T0, 60), '# Review v3\n\n**Result:** No findings.') })], previous: v2 });
  assert.deepEqual(later.reviews[key].first, { unknown: true });
  assert.equal(later.achievements['clean-sweep'], undefined);
  // A clean v1 with one run per lens still earns it.
  const v1 = build({ jobs: [job('a', { workers: lens, review: review(plus(T0, 3), '# Review v1\n\n**Result:** No findings.') })] });
  assert.equal(v1.achievements['clean-sweep'].unlockedAt, plus(T0, 3));
});

test('crew met: a permission you answered by hand meets no one, whatever agentType it carries', () => {
  const d = `${DIR}/a`;
  for (const decision of ['allow', 'allow-run', 'deny']) {
    const l = build({ audit: [{ at: T0, action: 'permission', featureDir: d, slug: 'a', tool: 'Bash', agentType: 'feature-implementer', headline: 'Run npm install', decision }], jobs: [job('a')] });
    assert.deepEqual(l.crew, {}, decision);
  }
  // The worker's own steps the dashboard decided without you do meet it.
  for (const action of ['auto-allowed', 'auto-blocked', 'hard-line-refused']) {
    const l = build({ audit: [{ at: T0, action, featureDir: d, slug: 'a', tool: 'Bash', agentType: 'feature-implementer', headline: 'Run curl' }], jobs: [job('a')] });
    assert.ok(l.crew['feature-implementer'], action);
  }
  // Any other line with an agentType (a settings change, a send) meets no one either.
  const other = build({ audit: [{ at: T0, action: 'send', featureDir: d, slug: 'a', agentType: 'feature-tester' }], jobs: [job('a')] });
  assert.equal(other.crew['feature-tester'], undefined);
});

test('PR times: a pr-link line without a timestamp takes the nearest earlier line’s, and is still exact', () => {
  const url = PR[0].url;
  const log = (lines) => lines.map((l) => JSON.stringify(l)).join('\n');
  const stamped = parseSessionLog(log([
    { type: 'user', timestamp: plus(T0, 1), message: { content: 'go' } },
    { type: 'pr-link', timestamp: plus(T0, 9), prUrl: url, prNumber: 7 },
  ]));
  assert.equal(stamped.prLinks[0].at, plus(T0, 9));
  const bare = parseSessionLog(log([
    { type: 'user', timestamp: plus(T0, 1), message: { content: 'go' } },
    { type: 'assistant', timestamp: plus(T0, 5), message: { id: 'm1', content: [] } },
    { type: 'summary' },
    { type: 'pr-link', prUrl: url, prNumber: 7 },
    { type: 'assistant', timestamp: plus(T0, 8), message: { id: 'm2', content: [] } },
  ]));
  assert.equal(bare.prLinks[0].at, plus(T0, 5), 'the nearest earlier timestamp, not a later one');
  const fromBare = build({ jobs: [prJob('a', { updatedAt: plus(T0, 40), prLinks: bare.prLinks })] });
  assert.equal(Object.values(fromBare.quests)[0].doneAt, plus(T0, 5));
  assert.equal(Object.values(fromBare.quests)[0].doneAtExact, true);
  // Nothing before it has a timestamp: no time, so the quest's time is a guess (not exact).
  const none = parseSessionLog(log([{ type: 'pr-link', prUrl: url, prNumber: 7 }, { type: 'user', timestamp: plus(T0, 8), message: { content: 'x' } }]));
  assert.equal(none.prLinks[0].at, null);
  const guessed = build({ jobs: [prJob('a', { updatedAt: plus(T0, 40), prLinks: none.prLinks })] });
  assert.equal(Object.values(guessed.quests)[0].doneAtExact, false);
});

test('Crew-dex findings: the most each lens raised on a job, kept across rounds', () => {
  const lens = [{ agentType: 'feature-review-errors', startedAt: T0, lastAt: plus(T0, 2) }];
  const table = (rows) => ({ at: T0, counts: parseReviewFindings(`| ID | Severity | Lens | Finding |\n|---|---|---|---|\n${rows}`) });
  const r1 = build({ jobs: [job('a', { workers: lens, review: table('| R-1 | blocker | errors | x |\n| R-2 | major | errors | y |\n| R-3 | major | errors | z |\n') })] });
  const r2 = build({ jobs: [job('a', { workers: lens, review: table('| R-4 | blocker | errors | w |\n| R-5 | blocker | errors | v |\n') })], previous: r1 });
  const r3 = build({ jobs: [job('a', { workers: lens, review: { at: T0, counts: parseReviewFindings('**Result:** No findings.') } })], previous: r2 });
  const v = ledgerView(r3);
  assert.equal(v.crew['feature-review-errors'].blockers, 2, 'round 2 had the most blockers');
  assert.equal(v.crew['feature-review-errors'].majors, 2, 'round 1 had the most majors');
  // Another job adds its own maximum.
  const two = build({ jobs: [job('a', { workers: lens }), job('b', { workers: lens, review: table('| R-1 | major | errors | x |\n') })], previous: r3 });
  assert.equal(ledgerView(two).crew['feature-review-errors'].majors, 3);
});

test('Speedrun: an L0 job from start to done in 15 minutes or less', () => {
  const start = (slug) => ({ at: T0, action: 'new-job', featureDir: `${DIR}/${slug}`, slug, options: { level: 0 } });
  const fast = build({ jobs: [prJobAt('a', plus(T0, 14), { level: 0 })], audit: [start('a')] });
  assert.ok(fast.achievements.speedrun);
  const slow = build({ jobs: [prJobAt('a', plus(T0, 16), { level: 0 })], audit: [start('a')] });
  assert.equal(slow.achievements.speedrun, undefined);
  const notL0 = build({ jobs: [prJobAt('a', plus(T0, 5), { level: 1 })], audit: [start('a')] });
  assert.equal(notL0.achievements.speedrun, undefined);
  // The start can come from the first worker's log when the job began in a terminal.
  const fromLog = build({ jobs: [prJobAt('a', plus(T0, 12), { level: 0, workers: [{ agentType: 'feature-implementer', startedAt: T0, lastAt: plus(T0, 8) }] })] });
  assert.ok(fromLog.achievements.speedrun);
  // Or from the Foreman's first session line (job.startedAt): a job that began long before its
  // first worker is no speedrun.
  const slowStart = build({ jobs: [prJobAt('a', plus(T0, 12), { level: 0, startedAt: plus(T0, -60), workers: [{ agentType: 'feature-implementer', startedAt: T0, lastAt: plus(T0, 8) }] })] });
  assert.equal(slowStart.achievements.speedrun, undefined);
  assert.equal(slowStart.quests[jobKey('a', `${DIR}/a`)].startedAt, plus(T0, -60));
  // A finish time that is only a guess (no PR link in the logs) never makes a speedrun.
  const guessed = build({ jobs: [prJob('a', { level: 0, updatedAt: plus(T0, 5) })], audit: [start('a')] });
  assert.equal(guessed.achievements.speedrun, undefined);
});

test('Full Panel: all 8 review lenses on one job', () => {
  const workers = (types) => types.map((t, i) => ({ agentType: t, startedAt: plus(T0, i), lastAt: plus(T0, i + 5) }));
  assert.equal(LENS_TYPES.length, 8);
  const full = build({ jobs: [job('a', { workers: workers(LENS_TYPES) })] });
  assert.equal(full.achievements['full-panel'].unlockedAt, plus(T0, 7), 'when the last lens arrived');
  const split = build({ jobs: [job('a', { workers: workers(LENS_TYPES.slice(0, 7)) }), job('b', { workers: workers(LENS_TYPES.slice(7)) })] });
  assert.equal(split.achievements['full-panel'], undefined);
});

test('Boss Slayer: an L3 quest done', () => {
  assert.ok(build({ jobs: [prJob('a', { level: 3 })] }).achievements['boss-slayer']);
  assert.equal(build({ jobs: [prJob('a', { level: 2 })] }).achievements['boss-slayer'], undefined);
  // The level from the audit when options.json is gone.
  const fromAudit = build({ jobs: [prJob('a', { level: null })], audit: [{ at: T0, action: 'options', featureDir: `${DIR}/a`, slug: 'a', options: { level: 3 } }] });
  assert.ok(fromAudit.achievements['boss-slayer']);
});

test('Bug Hunter: 10 bug quests, earned with the tenth', () => {
  const bugs = (n) => Array.from({ length: n }, (_, i) => prJob(`bug-${i}`, { kind: 'bug', updatedAt: plus(T0, i) }));
  assert.equal(build({ jobs: [...bugs(9), prJob('feat')] }).achievements['bug-hunter'], undefined);
  assert.equal(build({ jobs: bugs(10) }).achievements['bug-hunter'].unlockedAt, plus(T0, 9));
});

test('Night Owl: a quest done between midnight and 4am (local time)', () => {
  assert.ok(build({ jobs: [prJobAt('a', local(2026, 10, 16, 2, 30))], now: local(2026, 10, 16, 9) }).achievements['night-owl']);
  assert.equal(build({ jobs: [prJobAt('a', local(2026, 10, 16, 4, 0))], now: local(2026, 10, 16, 9) }).achievements['night-owl'], undefined);
  assert.equal(build({ jobs: [prJobAt('a', local(2026, 10, 16, 23, 59))], now: local(2026, 10, 17, 9) }).achievements['night-owl'], undefined);
  // Only status.json's time (a guess): no Night Owl, though the quest counts.
  const guessed = build({ jobs: [prJob('a', { updatedAt: local(2026, 10, 16, 2, 30) })], now: local(2026, 10, 16, 9) });
  assert.equal(guessed.achievements['night-owl'], undefined);
  assert.ok(guessed.achievements['first-quest']);
  // "I mark the job done": the close time is exact.
  const marked = build({ play: { questDone: 'marked-done' }, jobs: [job('a')], audit: [{ at: local(2026, 10, 16, 1), action: 'close', as: 'done', featureDir: `${DIR}/a`, slug: 'a' }] });
  assert.ok(marked.achievements['night-owl']);
});

test('Comeback: carried on after a usage pause and finished the same day', () => {
  const resumed = (at, extra = {}) => ({ at, action: 'usage-limit-resumed', how: 'auto', jobs: ['a'], ...extra });
  const now = local(2026, 10, 17, 9);
  assert.ok(build({ now, jobs: [prJobAt('a', local(2026, 10, 16, 15))], audit: [resumed(local(2026, 10, 16, 10))] }).achievements.comeback);
  assert.equal(build({ now, jobs: [prJobAt('a', local(2026, 10, 16, 15))], audit: [resumed(local(2026, 10, 15, 22))] }).achievements.comeback, undefined, 'the day before');
  assert.equal(build({ now, jobs: [prJobAt('a', local(2026, 10, 16, 9))], audit: [resumed(local(2026, 10, 16, 10))] }).achievements.comeback, undefined, 'finished before the carry-on');
  assert.equal(build({ now, jobs: [prJobAt('b', local(2026, 10, 16, 15))], audit: [resumed(local(2026, 10, 16, 10))] }).achievements.comeback, undefined, 'another job');
  assert.equal(build({ now, jobs: [prJob('a', { updatedAt: local(2026, 10, 16, 15) })], audit: [resumed(local(2026, 10, 16, 10))] }).achievements.comeback, undefined, 'a guessed finish time');
  // With the job folders on the line, the folder decides: the same slug in another folder is another job.
  const dirs = (d) => resumed(local(2026, 10, 16, 10), { featureDirs: [d] });
  assert.ok(build({ now, jobs: [prJobAt('a', local(2026, 10, 16, 15))], audit: [dirs(`${DIR}/a`)] }).achievements.comeback);
  assert.equal(build({ now, jobs: [prJobAt('a', local(2026, 10, 16, 15))], audit: [dirs(`${DIR}-2/a`)] }).achievements.comeback, undefined, 'same slug, other folder');
});

test('Explorer: all five themes besides Default tried', () => {
  const tried = (ids) => ids.map((id, i) => ({ at: plus(T0, i), action: 'play-event', kind: 'theme', id }));
  const five = ['neon-arcade', 'blueprint', 'pixel-crew', 'sunset-paper', 'candy-pop'];
  assert.equal(build({ audit: tried(five) }).achievements.explorer.unlockedAt, plus(T0, 4));
  assert.equal(build({ audit: tried(['default', ...five.slice(0, 4)]) }).achievements.explorer, undefined);
  assert.equal(build({ audit: tried(['crt-terminal', ...five.slice(0, 4)]) }).themes['crt-terminal'], undefined, 'only known themes');
});

test('Collector: all 15 crew members met (the Foreman by its first reply)', () => {
  assert.equal(CREW_TYPES.length, 15);
  const workers = CREW_TYPES.filter((t) => t !== 'conductor').map((t, i) => ({ agentType: t, startedAt: plus(T0, i + 1), lastAt: plus(T0, i + 2) }));
  const l = build({ jobs: [job('a', { workers })], audit: [{ at: T0, action: 'run-ended', featureDir: `${DIR}/a`, slug: 'a', status: 'done' }] });
  assert.equal(Object.keys(l.crew).length, 15);
  assert.equal(l.achievements.collector.unlockedAt, plus(T0, 14));
  const fourteen = build({ jobs: [job('a', { workers: workers.slice(1) })] });
  assert.equal(fourteen.achievements.collector, undefined);
});

test('crew met: auto-allowed dispatches, the session logs and the worker’s own steps, not counted twice', () => {
  const d = `${DIR}/a`;
  const audit = [
    { at: T0, action: 'auto-allowed', featureDir: d, slug: 'a', tool: 'Agent', agentType: null, headline: 'Start a helper: feature-tester' },
    { at: plus(T0, 1), action: 'permission', featureDir: d, slug: 'a', tool: 'Task', headline: 'Start a helper: feature-planner', decision: 'deny' },
    { at: plus(T0, 2), action: 'auto-allowed', featureDir: d, slug: 'a', tool: 'Bash', agentType: 'feature-implementer', headline: 'Run npm test' },
  ];
  const l = build({ audit, jobs: [job('a', { workers: [{ agentType: 'feature-tester', startedAt: T0, lastAt: plus(T0, 10) }] })] });
  const v = ledgerView(l);
  assert.equal(v.crew['feature-tester'].dispatches, 1, 'one dispatch, seen in the audit and the log');
  assert.equal(v.crew['feature-tester'].jobs, 1);
  assert.equal(v.crew['feature-tester'].avgStageMs, 10 * 60000);
  assert.equal(v.crew['feature-planner'], undefined, 'a dispatch you said no to');
  assert.equal(v.crew['feature-implementer'].dispatches, 0, 'met by its own step, not dispatched');
  assert.ok(v.crew.conductor, 'someone dispatched them');
});

test('crew met: a dispatch permission you allowed, alone, meets no one', () => {
  const d = `${DIR}/a`;
  const allowed = [
    { at: T0, action: 'permission', featureDir: d, slug: 'a', tool: 'Agent', headline: 'Start a helper: feature-planner', decision: 'allow' },
    { at: plus(T0, 1), action: 'permission', featureDir: d, slug: 'a', tool: 'Task', dispatch: 'feature-review-db', decision: 'allow-always' },
  ];
  const l = build({ audit: allowed, jobs: [job('a')] });
  assert.deepEqual(l.crew, {});
  assert.deepEqual(l.achievements, {});
  // Once the worker's session log shows it ran, it is met.
  const ran = build({ audit: allowed, jobs: [job('a', { workers: [{ agentType: 'feature-planner', startedAt: plus(T0, 2), lastAt: plus(T0, 9) }] })] });
  assert.deepEqual(Object.keys(ran.crew).sort(), ['conductor', 'feature-planner']);
  assert.equal(ledgerView(ran).crew['feature-planner'].dispatches, 1);
});

test('ledgerView: the Foreman’s jobs and dispatches are the work it handed out', () => {
  const l = build({ jobs: [
    job('a', { workers: [{ agentType: 'feature-planner', startedAt: T0, lastAt: plus(T0, 5) }, { agentType: 'feature-tester', startedAt: plus(T0, 6), lastAt: plus(T0, 9) }] }),
    job('b', { workers: [{ agentType: 'feature-planner', startedAt: plus(T0, 20), lastAt: plus(T0, 30) }] }),
  ] });
  const v = ledgerView(l);
  assert.equal(v.crew.conductor.jobs, 2, 'every job its crew worked on');
  assert.equal(v.crew.conductor.dispatches, 3, 'two planners and a tester handed out');
  assert.equal(v.crew.conductor.lastSeen, plus(T0, 30), 'last seen when its crew last worked');
  assert.equal(v.crew['feature-planner'].jobs, 2);
});

test('secrets: only the 13 known ids, each an easter-egg achievement once found', () => {
  assert.equal(SECRET_IDS.length, 13);
  const l = build({ audit: [{ at: T0, action: 'play-secret', id: 'konami' }, { at: T0, action: 'play-secret', id: 'free-xp' }] });
  assert.deepEqual(Object.keys(l.secrets), ['konami']);
  assert.ok(l.achievements['secret-konami']);
  const v = ledgerView(l);
  assert.deepEqual(v.secrets, { found: ['konami'], total: 13 });
  assert.equal(v.unlocks.crt, true);
  // Secrets not yet found are not listed (no names, no hints); the visible ten always are.
  assert.equal(v.achievements.filter((a) => a.secret).length, 1);
  assert.equal(v.achievements.filter((a) => !a.secret).length, 10);
  assert.ok(ACHIEVEMENTS.every((a) => a.id && a.name && a.howTo && typeof a.secret === 'boolean'));
});

test('nothing is ever earned for approving: approve sends, gate replies and allowed permissions award nothing', () => {
  const d = `${DIR}/a`;
  const audit = [];
  for (let i = 0; i < 40; i++) {
    audit.push({ at: plus(T0, i), action: 'send', kind: 'approve', featureDir: d, slug: 'a', text: 'Approved. Go ahead.', gateBrief: i + 1 });
    audit.push({ at: plus(T0, i), action: 'permission', featureDir: d, slug: 'a', tool: 'Bash', headline: 'Run git push', decision: 'allow' });
    audit.push({ at: plus(T0, i), action: 'send-held', kind: 'approve', featureDir: d, slug: 'a', text: 'Approved.' });
  }
  const l = build({ audit, jobs: [job('a', { level: 0 })], now: local(2026, 10, 16, 2) });
  assert.deepEqual(l.achievements, {});
  assert.deepEqual(l.quests, {});
});

test('newlyUnlocked lists only what the new ledger adds, with names', () => {
  const before = build({ jobs: [] });
  const after = build({ jobs: [prJob('a', { level: 3 })], previous: before });
  assert.deepEqual(newlyUnlocked(before, after).map((a) => a.id).sort(), ['boss-slayer', 'first-quest']);
  assert.equal(newlyUnlocked(before, after)[0].name.length > 0, true);
  assert.deepEqual(newlyUnlocked(after, build({ jobs: [prJob('a', { level: 3 })], previous: after })), []);
});

test('ledgerView: counts, quests and the Gold unlock after 10 quests', () => {
  const jobs = Array.from({ length: 10 }, (_, i) => prJob(`j${i}`, { kind: i < 3 ? 'bug' : 'feature', updatedAt: plus(T0, i) }));
  const v = ledgerView(build({ jobs }), { mode: 'full' });
  assert.equal(v.mode, 'full');
  assert.equal(v.questDone, 'first-pr');
  assert.equal(v.quests.done, 10);
  assert.equal(v.quests.bugs, 3);
  assert.equal(v.quests.recent[0].slug, 'j9', 'newest first');
  assert.equal(v.unlocks.gold, true);
  assert.equal(v.crewTotal, 15);
  assert.equal(v.schema, PLAY_SCHEMA);
  assert.equal(ledgerView(null).quests.done, 0);
});

test('hidden themes: CRT Terminal from the Konami secret, Gold at 10 quests, nothing before', () => {
  assert.deepEqual(THEME_IDS, ['default', 'neon-arcade', 'blueprint', 'pixel-crew', 'sunset-paper', 'candy-pop', 'crt', 'gold']);
  assert.deepEqual(PLAY_EVENTS.theme, THEME_IDS, 'both can be reported as tried');
  assert.deepEqual(unlocksOf(null), { crt: false, gold: false });
  assert.deepEqual(unlocksOf(build({})), { crt: false, gold: false });

  const otherSecret = build({ audit: [{ at: T0, action: 'play-secret', id: 'teapot' }] });
  assert.equal(unlocksOf(otherSecret).crt, false, 'only the Konami code opens CRT Terminal');
  const konami = build({ audit: [{ at: T0, action: 'play-secret', id: 'konami' }] });
  assert.deepEqual(unlocksOf(konami), { crt: true, gold: false });

  const quests = (n) => Array.from({ length: n }, (_, i) => prJob(`q${i}`, { updatedAt: plus(T0, i) }));
  assert.equal(GOLD_QUESTS, 10);
  assert.equal(unlocksOf(build({ jobs: quests(9) })).gold, false, '9 quests');
  assert.equal(unlocksOf(build({ jobs: quests(10) })).gold, true, '10 quests');
  assert.deepEqual(ledgerView(build({ jobs: quests(9) })).unlocks, { crt: false, gold: false });
  // Kept: a quest counted once stays counted, so Gold stays open when the jobs are gone.
  const ten = build({ jobs: quests(10) });
  assert.equal(unlocksOf(build({ jobs: [], previous: ten })).gold, true);

  // A theme you may use: the originals always, a hidden one only once unlocked, nothing unknown.
  for (const id of ['default', 'candy-pop']) assert.equal(themeUnlocked(null, id), true, id);
  assert.equal(themeUnlocked(null, 'crt'), false);
  assert.equal(themeUnlocked(konami, 'crt'), true);
  assert.equal(themeUnlocked(konami, 'gold'), false);
  assert.equal(themeUnlocked(ten, 'gold'), true);
  assert.equal(themeUnlocked(ten, 'hot-pink'), false);
});

test('Explorer stays about the five original themes: the hidden two neither count nor stand in', () => {
  const tried = (ids) => ids.map((id, i) => ({ at: plus(T0, i), action: 'play-event', kind: 'theme', id }));
  const secret = { at: T0, action: 'play-secret', id: 'konami' };
  assert.deepEqual(EXPLORER_THEMES, ['neon-arcade', 'blueprint', 'pixel-crew', 'sunset-paper', 'candy-pop']);
  const almost = build({ audit: [secret, ...tried(['crt', 'gold', 'neon-arcade', 'blueprint', 'pixel-crew', 'sunset-paper'])] });
  assert.equal(almost.achievements.explorer, undefined);
  assert.ok(almost.themes.crt, 'CRT Terminal is remembered as tried');
  assert.ok(build({ audit: tried(EXPLORER_THEMES) }).achievements.explorer);
});

test('newlyDone lists the quests the new ledger adds, once', () => {
  const before = build({ jobs: [prJob('a')] });
  const after = build({ jobs: [prJob('a'), prJob('b', { kind: 'bug', level: 1 })], previous: before });
  assert.deepEqual(newlyDone(before, after).map((q) => [q.slug, q.kind, q.level, q.rule]), [['b', 'bug', 1, 'first-pr']]);
  assert.deepEqual(newlyDone(after, build({ jobs: [prJob('a'), prJob('b')], previous: after })), []);
});

// ---------- play.json ----------

// The PlayBook's sources over plain arrays, counting what they are asked for. `fresh` is the list
// sources.jobs({ fresh: true }) answers with (null: none at hand).
function fakeSources(input) {
  const calls = { readAudit: 0, jobsFull: 0, jobsFresh: 0, job: [] };
  const s = {
    calls, ino: 1, fresh: null,
    readAudit: async () => { calls.readAudit++; return [...input.audit]; },
    auditStat: async () => ({ size: input.audit.reduce((n, e) => n + JSON.stringify(e).length + 1, 0), ino: s.ino }),
    jobs: async ({ fresh }) => {
      if (fresh) { calls.jobsFresh++; return s.fresh; }
      calls.jobsFull++;
      return [...input.jobs];
    },
    job: async (folder, known) => { calls.job.push(folder); return input.jobs.find((j) => path.basename(j.dir) === folder) ?? known; },
    settings: () => input.play ?? PLAY_DEFAULTS,
  };
  return s;
}
const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'fw-play-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('PlayBook: saves play.json, tells about new unlocks, and rebuilds from the audit when the file is lost', async () => {
  const dir = await tempDir();
  try {
    const input = { audit: [{ at: T0, action: 'play-event', kind: 'theme', id: 'blueprint' }], jobs: [], play: PLAY_DEFAULTS };
    const heard = [];
    const quests = [];
    const book = new PlayBook({ dir, sources: fakeSources(input), onUnlock: (a) => heard.push(a.id), onQuest: (q) => quests.push(q.slug), now: () => Date.parse(plus(T0, 100)) });
    await book.refresh();
    assert.deepEqual(heard, [], 'the first build only finds what was already earned');
    assert.deepEqual(quests, []);
    const file = path.join(dir, 'play.json');
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).schema, PLAY_SCHEMA);
    assert.equal(((await fs.stat(file)).mode & 0o777).toString(8), '600');

    const teapot = { at: plus(T0, 1), action: 'play-secret', id: 'teapot' };
    input.audit.push(teapot);
    book.noteAudit(teapot);
    input.jobs.push(prJob('a', { level: 3 }));
    book.noteJob('a');
    await book.refresh();
    assert.deepEqual(heard.sort(), ['boss-slayer', 'first-quest', 'secret-teapot']);
    assert.deepEqual(quests, ['a'], 'the quest done is told once');
    await book.refresh();
    assert.deepEqual(quests, ['a']);
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.ok((await fs.readdir(dir)).every((n) => !n.endsWith('.tmp')), 'no temp files left');

    // Lost: rebuilt from the same data, with the same unlocks and times.
    await fs.rm(file);
    const fresh = new PlayBook({ dir, sources: fakeSources(input), now: () => Date.parse(plus(T0, 999)) });
    assert.equal(await fresh.load(), null);
    const rebuilt = await fresh.refresh();
    assert.deepEqual(rebuilt.achievements, saved.achievements);
    assert.deepEqual(rebuilt.secrets, saved.secrets);

    // Another schema: rebuilt too.
    await fs.writeFile(file, JSON.stringify({ schema: 99, quests: {} }));
    const other = new PlayBook({ dir, sources: fakeSources(input) });
    assert.equal(await other.load(), null);
    assert.equal((await other.current()).schema, PLAY_SCHEMA);
    assert.deepEqual(Object.keys((await other.current()).achievements).sort(), unlocked(saved));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('PlayBook: refreshes asked for while one runs are folded into one more run', async () => {
  const dir = await tempDir();
  try {
    const sources = fakeSources({ audit: [], jobs: [] });
    let builds = 0;
    sources.jobs = async ({ fresh }) => { if (!fresh) return null; builds++; await wait(20); return []; };
    const book = new PlayBook({ dir, sources });
    await Promise.all([book.refresh(), book.refresh(), book.refresh()]);
    assert.equal(builds, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('PlayBook: an audit line is folded in; the whole audit is read only at start, or when it shrank or was replaced', async () => {
  const dir = await tempDir();
  try {
    const input = { audit: [{ at: T0, action: 'play-event', kind: 'theme', id: 'blueprint' }], jobs: [job('a')] };
    const sources = fakeSources(input);
    let now = Date.parse(plus(T0, 100));
    const book = new PlayBook({ dir, sources, now: () => now });
    await book.refresh();
    assert.equal(sources.calls.readAudit, 1);
    assert.equal(sources.calls.jobsFull, 1);

    // One new line: folded in from the event, the file isn't read again.
    const line = { at: plus(T0, 2), action: 'play-secret', id: 'konami' };
    input.audit.push(line);
    book.noteAudit(line);
    await book.refresh();
    assert.equal(sources.calls.readAudit, 1, 'no full re-read after one audit line');
    assert.ok(book.ledger.secrets.konami);
    // Folding the same line twice changes nothing (a line seen in a full read and as it was written).
    book.noteAudit(line);
    const auto = { at: plus(T0, 3), action: 'auto-allowed', featureDir: `${DIR}/a`, slug: 'a', tool: 'Agent', headline: 'Start a helper: feature-tester' };
    input.audit.push(auto);
    book.noteAudit(auto);
    book.noteAudit(auto);
    await book.refresh();
    assert.equal(ledgerView(book.ledger).crew['feature-tester'].dispatches, 1);
    assert.equal(sources.calls.readAudit, 1);

    // The file shrank (rotated, cleared): read again. Another file (inode): read again.
    input.audit.splice(0, 1);
    await book.refresh();
    assert.equal(sources.calls.readAudit, 2);
    sources.ino = 2;
    await book.refresh();
    assert.equal(sources.calls.readAudit, 3);
    await book.refresh();
    assert.equal(sources.calls.readAudit, 3);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('PlayBook: jobs come from a fresh list when there is one, else a full read at most every minute; a changed job alone is re-read', async () => {
  const dir = await tempDir();
  try {
    const input = { audit: [], jobs: [job('a'), job('b')] };
    const sources = fakeSources(input);
    let now = Date.parse(plus(T0, 100));
    const book = new PlayBook({ dir, sources, now: () => now });
    await book.refresh();
    assert.equal(sources.calls.jobsFull, 1);
    now += 30_000;
    await book.refresh();
    assert.equal(sources.calls.jobsFull, 1, 'not again within a minute');
    // A file in job b changed: only b is read again.
    input.jobs[1] = prJobAt('b', plus(T0, 50));
    book.noteJob('b');
    await book.refresh();
    assert.deepEqual(sources.calls.job, ['b']);
    assert.equal(sources.calls.jobsFull, 1);
    assert.equal(Object.keys(book.ledger.quests).length, 1);
    // A minute on: a full read.
    now += 31_000;
    await book.refresh();
    assert.equal(sources.calls.jobsFull, 2);
    // A fresh list at hand: used instead, no full read.
    now += 120_000;
    sources.fresh = [job('a', { workers: [{ agentType: 'feature-tester', startedAt: T0, lastAt: plus(T0, 1) }] }), input.jobs[1]];
    await book.refresh();
    assert.equal(sources.calls.jobsFull, 2);
    assert.ok(book.ledger.crew['feature-tester']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('PlayBook: play.json is written only when the ledger changed (builtAt aside)', async () => {
  const dir = await tempDir();
  try {
    const input = { audit: [{ at: T0, action: 'play-secret', id: 'teapot' }], jobs: [] };
    let now = Date.parse(plus(T0, 100));
    const book = new PlayBook({ dir, sources: fakeSources(input), now: () => now });
    const saves = [];
    const save = book.save.bind(book);
    book.save = async (l) => { saves.push(l); return save(l); };
    await book.refresh();
    assert.equal(saves.length, 1);
    now += 5000;
    await book.refresh();
    await book.refresh();
    assert.equal(saves.length, 1, 'nothing changed but the time');
    const line = { at: plus(T0, 1), action: 'play-secret', id: 'konami' };
    input.audit.push(line);
    book.noteAudit(line);
    await book.refresh();
    assert.equal(saves.length, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('PlayBook: a failed play.json write is logged and the ledger still answers', async () => {
  const dir = await tempDir();
  try {
    // The state "folder" is a file: nothing can be written under it.
    const blocked = path.join(dir, 'not-a-folder');
    await fs.writeFile(blocked, 'x');
    const logged = [];
    const book = new PlayBook({ dir: blocked, sources: fakeSources({ audit: [{ at: T0, action: 'play-secret', id: 'teapot' }], jobs: [prJob('a')] }), log: (msg, err) => logged.push([msg, err?.code]) });
    const ledger = await book.current();
    assert.ok(ledger.secrets.teapot);
    assert.ok(ledger.achievements['first-quest']);
    assert.equal(logged.length, 1);
    assert.match(logged[0][0], /could not save play\.json/);
    assert.deepEqual(ledgerView(await book.current()).secrets.found, ['teapot']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('PlayBook: while Play is Off nothing is scheduled or folded; turning it on again catches up without unlock events', async () => {
  const dir = await tempDir();
  try {
    let on = true;
    const input = { audit: [], jobs: [] };
    const sources = fakeSources(input);
    const heard = [];
    const book = new PlayBook({ dir, sources, isOn: () => on, onUnlock: (a) => heard.push(a.id) });
    await book.refresh();
    assert.equal(sources.calls.readAudit, 1);

    on = false;
    book.forget();
    const line = { at: plus(T0, 1), action: 'play-secret', id: 'teapot' };
    input.audit.push(line);
    book.noteAudit(line);
    input.jobs.push(prJobAt('a', plus(T0, 3), { level: 3 }));
    book.noteJob('a');
    book.schedule(0);
    await wait(30);
    assert.equal(sources.calls.readAudit, 1, 'nothing read while Off');
    assert.equal(sources.calls.jobsFull, 1);
    assert.equal(sources.calls.jobsFresh, 1);
    assert.deepEqual(sources.calls.job, []);

    // On again: one muted refresh reads everything afresh and finds what happened meanwhile.
    on = true;
    await book.refresh({ muted: true });
    assert.equal(sources.calls.readAudit, 2);
    assert.ok(book.ledger.secrets.teapot);
    assert.ok(book.ledger.achievements['boss-slayer']);
    assert.deepEqual(heard, [], 'no unlock events for what was found on the way back');

    // A muted schedule (the quest rule changed) folds in with a plain one and stays muted.
    input.play = { questDone: 'marked-done' };
    input.audit.push({ at: plus(T0, 5), action: 'close', as: 'done', featureDir: `${DIR}/b`, slug: 'b' });
    book.noteAudit(input.audit.at(-1));
    input.jobs.push(job('b', { level: 0 }));
    book.noteJob('b');
    book.schedule(0, { muted: true });
    book.schedule(0);
    await wait(30);
    await book.current();
    assert.equal(Object.keys(book.ledger.quests).length, 2);
    assert.deepEqual(heard, []);
    // A plain refresh afterwards does tell.
    input.audit.push({ at: plus(T0, 6), action: 'play-secret', id: 'konami' });
    book.noteAudit(input.audit.at(-1));
    await book.refresh();
    assert.deepEqual(heard, ['secret-konami']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('PlayBook: a refresh already running when Play goes Off stops, keeps nothing it read and saves nothing', async () => {
  const dir = await tempDir();
  try {
    let on = true;
    const input = { audit: [{ at: T0, action: 'play-secret', id: 'teapot' }], jobs: [prJob('a')] };
    const sources = fakeSources(input);
    let release;
    const gate = new Promise((r) => { release = r; });
    const readAudit = sources.readAudit;
    sources.readAudit = async () => { const all = await readAudit(); await gate; return all; };
    const book = new PlayBook({ dir, sources, isOn: () => on });
    const saves = [];
    book.save = async (l) => { saves.push(l); };
    const running = book.refresh();
    await wait(5);
    // Play goes Off mid-read; another refresh was asked for meanwhile.
    on = false;
    book.forget();
    book.refresh();
    release();
    await running;
    assert.equal(book.fold, null, 'what was read is dropped');
    assert.equal(book.ledger, null);
    assert.deepEqual(saves, [], 'nothing saved');
    assert.equal(sources.calls.jobsFull, 0, 'it stopped before reading the jobs');
    // On again: a fresh refresh reads everything.
    on = true;
    await book.refresh({ muted: true });
    assert.ok(book.ledger.secrets.teapot);
    assert.equal(saves.length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('PlayBook: a failed play.json write is tried again at the next refresh, even with nothing new', async () => {
  const dir = await tempDir();
  try {
    const logged = [];
    const book = new PlayBook({ dir, sources: fakeSources({ audit: [{ at: T0, action: 'play-secret', id: 'teapot' }], jobs: [] }), log: (msg) => logged.push(msg) });
    let fail = true;
    const tries = [];
    const save = book.save.bind(book);
    book.save = async (l) => { tries.push(l); if (fail) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); return save(l); };
    await book.refresh();
    assert.equal(tries.length, 1);
    assert.equal(logged.length, 1);
    fail = false;
    await book.refresh();
    assert.equal(tries.length, 2, 'unchanged, but play.json never had it: written now');
    assert.ok(JSON.parse(await fs.readFile(path.join(dir, 'play.json'), 'utf8')).secrets.teapot);
    await book.refresh();
    assert.equal(tries.length, 2, 'saved: not written again');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('PlayBook: Clean Sweep is never awarded for a later round, after Off and On or with play.json lost', async () => {
  const dir = await tempDir();
  try {
    let on = true;
    const lens = [{ agentType: 'feature-review-errors', startedAt: T0, lastAt: plus(T0, 2) }];
    const review = (at, text) => ({ at, counts: parseReviewFindings(text) });
    const input = { audit: [], jobs: [job('a', { workers: lens })] };
    const book = new PlayBook({ dir, sources: fakeSources(input), isOn: () => on });
    await book.refresh();
    // Off while round 1 (two majors) and round 2 (clean) happen.
    on = false;
    book.forget();
    input.jobs[0] = job('a', { workers: [...lens, { agentType: 'feature-review-errors', startedAt: plus(T0, 20), lastAt: plus(T0, 21) }], review: review(plus(T0, 30), '# Review v2\n\nR-1 and R-2 fixed.\n\n**Result:** No findings.') });
    on = true;
    await book.refresh({ muted: true });
    const key = jobKey('a', `${DIR}/a`);
    assert.deepEqual(book.ledger.reviews[key].first, { unknown: true });
    assert.equal(book.ledger.achievements['clean-sweep'], undefined);

    // play.json lost: the rebuild sees only the v2 review and awards nothing either.
    await fs.rm(path.join(dir, 'play.json'));
    const fresh = new PlayBook({ dir, sources: fakeSources(input) });
    const rebuilt = await fresh.current();
    assert.deepEqual(rebuilt.reviews[key].first, { unknown: true });
    assert.equal(rebuilt.achievements['clean-sweep'], undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
