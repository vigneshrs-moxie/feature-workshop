// The play ledger (lib/play.js): crew met, quests done, achievements and secrets, from fixture
// audit lines and job records only. Pure functions, plus PlayBook on a temp folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ACHIEVEMENTS, CREW_TYPES, LENS_TYPES, PLAY_DEFAULTS, PLAY_SCHEMA, PlayBook, PlayError, SECRET_IDS,
  buildLedger, jobKey, ledgerView, lensType, newlyUnlocked, parseReviewFindings, playSettings, validatePlayPatch,
} from '../lib/play.js';

const DIR = '/tmp/fw-play/feature-work';
const local = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();
const T0 = local(2026, 10, 16, 10, 0);
const plus = (at, min) => new Date(Date.parse(at) + min * 60000).toISOString();
const PR = [{ number: 1, url: 'https://github.com/example/repo/pull/7', state: 'open' }, { number: 2, url: null }, { number: 3, url: null }];

function job(slug, extra = {}) {
  return { slug, dir: `${DIR}/${slug}`, kind: 'feature', level: 2, prs: [{ number: 1, url: null }], updatedAt: T0, workers: [], review: null, ...extra };
}
const prJob = (slug, extra = {}) => job(slug, { prs: PR, ...extra });
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
  assert.deepEqual({ ...summary, byLens: undefined }, { blockers: 0, majors: 2, minors: 3, total: 5, byLens: undefined });
  const table = parseReviewFindings('## Findings\n\n| ID | Severity | Lens | Finding |\n|---|---|---|---|\n| R-1 | major | errors | x |\n| R-2 | **blocker** | Locksmith | y |\n| R-3 | minor | db | z |\n');
  assert.equal(table.total, 3);
  assert.equal(table.blockers, 1);
  assert.deepEqual(table.byLens['feature-review-errors'], { blockers: 0, majors: 1, minors: 0 });
  assert.deepEqual(table.byLens['feature-review-permissions'], { blockers: 1, majors: 0, minors: 0 });
  assert.deepEqual(table.byLens['feature-review-db'], { blockers: 0, majors: 0, minors: 1 });
  assert.equal(parseReviewFindings('# Review v2\n\nNo findings. Ship it.').total, 0);
  assert.equal(parseReviewFindings('# Review\n\nStill being written.'), null);
  assert.equal(parseReviewFindings(''), null);
  assert.equal(lensType('performance'), 'feature-review-performance');
  assert.equal(lensType('spec'), 'feature-reviewer');
  assert.equal(lensType('nonsense'), null);
});

// ---------- Quests ----------

test('quests: by default a job is done when its first PR is created, stamped with status.json’s time', () => {
  const l = build({ jobs: [prJob('a', { updatedAt: plus(T0, 30) }), job('b')] });
  assert.deepEqual(Object.keys(l.quests), [jobKey('a', `${DIR}/a`)]);
  assert.equal(l.quests[jobKey('a', `${DIR}/a`)].doneAt, plus(T0, 30));
  assert.equal(l.achievements['first-quest'].unlockedAt, plus(T0, 30));
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

test('Clean Sweep: a review with zero findings, not one with findings', () => {
  const clean = build({ jobs: [job('a', { review: { at: plus(T0, 3), counts: parseReviewFindings('0 blockers, 0 majors, 0 minors') } })] });
  assert.equal(clean.achievements['clean-sweep'].unlockedAt, plus(T0, 3));
  const dirty = build({ jobs: [job('a', { review: { at: T0, counts: parseReviewFindings('0 blockers, 1 major, 0 minors') } })] });
  assert.equal(dirty.achievements['clean-sweep'], undefined);
  // A clean round after a dirty one earns it.
  const fixed = build({ jobs: [job('a', { review: { at: plus(T0, 50), counts: parseReviewFindings('No findings.') } })], previous: dirty });
  assert.ok(fixed.achievements['clean-sweep']);
});

test('Speedrun: an L0 job from start to done in 15 minutes or less', () => {
  const start = (slug) => ({ at: T0, action: 'new-job', featureDir: `${DIR}/${slug}`, slug, options: { level: 0 } });
  const fast = build({ jobs: [prJob('a', { level: 0, updatedAt: plus(T0, 14) })], audit: [start('a')] });
  assert.ok(fast.achievements.speedrun);
  const slow = build({ jobs: [prJob('a', { level: 0, updatedAt: plus(T0, 16) })], audit: [start('a')] });
  assert.equal(slow.achievements.speedrun, undefined);
  const notL0 = build({ jobs: [prJob('a', { level: 1, updatedAt: plus(T0, 5) })], audit: [start('a')] });
  assert.equal(notL0.achievements.speedrun, undefined);
  // The start can come from the first worker's log when the job began in a terminal.
  const fromLog = build({ jobs: [prJob('a', { level: 0, updatedAt: plus(T0, 12), workers: [{ agentType: 'feature-implementer', startedAt: T0, lastAt: plus(T0, 8) }] })] });
  assert.ok(fromLog.achievements.speedrun);
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
  assert.ok(build({ jobs: [prJob('a', { updatedAt: local(2026, 10, 16, 2, 30) })], now: local(2026, 10, 16, 9) }).achievements['night-owl']);
  assert.equal(build({ jobs: [prJob('a', { updatedAt: local(2026, 10, 16, 4, 0) })], now: local(2026, 10, 16, 9) }).achievements['night-owl'], undefined);
  assert.equal(build({ jobs: [prJob('a', { updatedAt: local(2026, 10, 16, 23, 59) })], now: local(2026, 10, 17, 9) }).achievements['night-owl'], undefined);
});

test('Comeback: carried on after a usage pause and finished the same day', () => {
  const resumed = (at) => ({ at, action: 'usage-limit-resumed', how: 'auto', jobs: ['a'] });
  const now = local(2026, 10, 17, 9);
  assert.ok(build({ now, jobs: [prJob('a', { updatedAt: local(2026, 10, 16, 15) })], audit: [resumed(local(2026, 10, 16, 10))] }).achievements.comeback);
  assert.equal(build({ now, jobs: [prJob('a', { updatedAt: local(2026, 10, 16, 15) })], audit: [resumed(local(2026, 10, 15, 22))] }).achievements.comeback, undefined, 'the day before');
  assert.equal(build({ now, jobs: [prJob('a', { updatedAt: local(2026, 10, 16, 9) })], audit: [resumed(local(2026, 10, 16, 10))] }).achievements.comeback, undefined, 'finished before the carry-on');
  assert.equal(build({ now, jobs: [prJob('b', { updatedAt: local(2026, 10, 16, 15) })], audit: [resumed(local(2026, 10, 16, 10))] }).achievements.comeback, undefined, 'another job');
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

test('crew met: dispatches from the audit (Agent steps allowed) and from the session logs, not counted twice', () => {
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

// ---------- play.json ----------

test('PlayBook: saves play.json, tells about new unlocks, and rebuilds from the audit when the file is lost', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-play-'));
  try {
    const input = { audit: [{ at: T0, action: 'play-event', kind: 'theme', id: 'blueprint' }], jobs: [], play: PLAY_DEFAULTS };
    const heard = [];
    const book = new PlayBook({ dir, collect: async () => input, onUnlock: (a) => heard.push(a.id), now: () => Date.parse(plus(T0, 100)) });
    await book.refresh();
    assert.deepEqual(heard, [], 'the first build only finds what was already earned');
    const file = path.join(dir, 'play.json');
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).schema, PLAY_SCHEMA);
    assert.equal(((await fs.stat(file)).mode & 0o777).toString(8), '600');

    input.audit.push({ at: plus(T0, 1), action: 'play-secret', id: 'teapot' });
    input.jobs.push(prJob('a', { level: 3 }));
    await book.refresh();
    assert.deepEqual(heard.sort(), ['boss-slayer', 'first-quest', 'secret-teapot']);
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.ok((await fs.readdir(dir)).every((n) => !n.endsWith('.tmp')), 'no temp files left');

    // Lost: rebuilt from the same data, with the same unlocks and times.
    await fs.rm(file);
    const fresh = new PlayBook({ dir, collect: async () => input, now: () => Date.parse(plus(T0, 999)) });
    assert.equal(await fresh.load(), null);
    const rebuilt = await fresh.refresh();
    assert.deepEqual(rebuilt.achievements, saved.achievements);
    assert.deepEqual(rebuilt.secrets, saved.secrets);

    // Another schema: rebuilt too.
    await fs.writeFile(file, JSON.stringify({ schema: 99, quests: {} }));
    const other = new PlayBook({ dir, collect: async () => input });
    assert.equal(await other.load(), null);
    assert.equal((await other.current()).schema, PLAY_SCHEMA);
    assert.deepEqual(Object.keys((await other.current()).achievements).sort(), unlocked(saved));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('PlayBook: refreshes asked for while one runs are folded into one more run', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-play-'));
  try {
    let calls = 0;
    const book = new PlayBook({ dir, collect: async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return { audit: [], jobs: [] }; } });
    await Promise.all([book.refresh(), book.refresh(), book.refresh()]);
    assert.equal(calls, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
