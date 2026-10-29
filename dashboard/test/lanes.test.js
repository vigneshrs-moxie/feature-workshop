// The four lanes of Jobs (lib/snapshot.js laneFor, packet M): Working, Needs you, In review and
// Ready to merge, with Resting and Done folded under the board. Each case from a fixture job card,
// as the runner's boardCard builds it, with its flow lane (lib/flow.js laneOf) and pending cards.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LANES, laneFor } from '../lib/snapshot.js';
import { startDashboard } from './helpers/dashboard.js';

// A demo dashboard (no model calls) with two fixture jobs: one waiting for a go-ahead, one resting.
let root, dashboard;
before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-lanes-')));
  const featuresDir = path.join(root, 'feature-work');
  const repo = path.join(root, 'repo');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), home: path.join(root, 'home'), state: path.join(root, 'state') };
  for (const d of [featuresDir, repo, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  const status = (slug, extra) => JSON.stringify({ schema_version: 1, slug, title: slug, route: 'small', stage: 'plan', repo: { path: repo }, updated_at: '2026-10-15T10:00:00Z', ...extra });
  for (const [slug, extra] of [['waits-for-you', { stage_state: 'waiting_for_you', waiting_for: 'approval', waiting_since: '2026-10-15T10:00:00Z' }], ['resting-job', { stage_state: 'idle' }]]) {
    await fs.mkdir(path.join(featuresDir, slug, 'briefs'), { recursive: true });
    await fs.writeFile(path.join(featuresDir, slug, 'status.json'), status(slug, extra));
  }
  dashboard = await startDashboard({
    env: {
      HOME: dirs.home, WORKSHOP_DEMO: '1', WORKSHOP_FEATURES_DIR: featuresDir, WORKSHOP_PROJECTS_DIR: dirs.projects,
      WORKSHOP_AGENTS_DIR: dirs.agents, WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: dirs.state,
    },
  });
});
after(async () => { await dashboard?.stop(); if (root) await fs.rm(root, { recursive: true, force: true }); });

test('lanes: every job card in the snapshot carries its lane and the reason in words', async () => {
  const snap = await (await fetch(`${dashboard.base}/api/snapshot`)).json();
  const by = Object.fromEntries(snap.jobs.map((j) => [j.slug, j]));
  assert.equal(by['waits-for-you'].lane, 'needs-you');
  assert.equal(by['waits-for-you'].laneReason, 'Waiting for your go-ahead on the plan');
  assert.equal(by['resting-job'].lane, 'resting');
  for (const j of snap.jobs) assert.ok(LANES.includes(j.lane) && typeof j.laneReason === 'string' && j.laneReason, j.slug);
});

const card = (extra = {}) => ({ slug: 'orbit-471', title: 'Customer notes', stage: 'plan', stageState: 'idle', needsYou: false, working: false, permissions: 0, ...extra });
const pr = (extra = {}) => ({ number: 12, state: 'open', review: null, checks: 'passing', ...extra });

test('lanes: the four lanes and the two under the board, in order', () => {
  assert.deepEqual(LANES, ['working', 'needs-you', 'in-review', 'ready', 'resting', 'done']);
});

test('lanes: Working is a job the Foreman or the crew is at, with what it is doing in words', () => {
  assert.deepEqual(laneFor(card({ working: true, nowDoing: [{ who: 'feature-implementer', doing: 'Writing step 3 of 6' }] })), { lane: 'working', laneReason: 'Writing step 3 of 6' });
  assert.deepEqual(laneFor(card({ working: true })), { lane: 'working', laneReason: 'The crew is at work' });
  assert.deepEqual(laneFor(card({ starting: true })), { lane: 'working', laneReason: 'Starting the job' });
});

test('lanes: a usage-limit pause stays in Working, marked paused, with when it carries on', () => {
  const at = new Date(2026, 9, 29, 18, 0).toISOString();
  assert.deepEqual(laneFor(card({ limitPaused: at, paused: true, stageState: 'paused' })), { lane: 'working', paused: true, laneReason: 'Paused for the usage limit; carries on at 18:00' });
  assert.equal(laneFor(card({ restartPaused: { how: 'crash' } })).laneReason, 'Paused by a restart; waits for Resume');
});

test('lanes: Needs you: a go-ahead, an answer, a reply', () => {
  assert.deepEqual(laneFor(card({ needsYou: true, waitingFor: 'approval', stage: 'plan' })), { lane: 'needs-you', laneReason: 'Waiting for your go-ahead on the plan' });
  assert.deepEqual(laneFor(card({ needsYou: true, waitingFor: 'answers', stage: 'spec' })), { lane: 'needs-you', laneReason: 'The Foreman asked you something' });
  assert.deepEqual(laneFor(card({ needsYou: true, waitingFor: null })), { lane: 'needs-you', laneReason: 'Waiting for your reply' });
});

test('lanes: Needs you: a permission, a crew question, a PR feedback card, even mid-reply', () => {
  assert.deepEqual(laneFor(card({ permissions: 1, working: true }), { pending: [{ id: 'p1', kind: 'permission' }] }), { lane: 'needs-you', laneReason: 'A permission waits for your yes' });
  assert.equal(laneFor(card({ permissions: 2 }), { pending: [{ id: 'p1' }, { id: 'p2' }] }).laneReason, '2 permissions wait for your yes');
  assert.equal(laneFor(card({ permissions: 1 }), { pending: [{ id: 'q', kind: 'question' }] }).laneReason, 'A crew member asked you something');
  assert.equal(laneFor(card({ permissions: 1 }), { pending: [{ id: 'f', kind: 'question', feedbackCard: true }] }).laneReason, 'A PR feedback card waits for you');
  // Without the pending list (an older caller), the count alone still puts it in Needs you.
  assert.equal(laneFor(card({ permissions: 1 })).lane, 'needs-you');
});

test('lanes: Needs you: a stuck stack part, and changes asked for on a PR', () => {
  assert.deepEqual(laneFor(card({ stuck: 'Part 2 (CSV writer)', working: false })), { lane: 'needs-you', laneReason: 'Part 2 (CSV writer) is stuck and needs you' });
  assert.deepEqual(laneFor(card({ stage: 'pr2' }), { lane: { pr2: pr({ review: 'changes_requested' }) } }), { lane: 'needs-you', laneReason: 'Changes were asked for on PR #2' });
});

test('lanes: In review: a PR open and waiting on others', () => {
  assert.deepEqual(laneFor(card({ stage: 'pr2' }), { lane: { pr1: pr({ state: 'merged' }), pr2: pr({ review: 'review_required' }) } }), { lane: 'in-review', laneReason: 'PR #2 is open, waiting on a review' });
  assert.equal(laneFor(card({ stage: 'pr2' }), { lane: { pr2: pr({ checks: 'pending', review: 'approved' }) } }).laneReason, 'PR #2’s checks are running');
  assert.equal(laneFor(card({ stage: 'pr2' }), { lane: { pr2: pr({ checks: 'failing' }) } }).laneReason, 'PR #2’s checks are failing');
  assert.equal(laneFor(card({ stage: 'pr1' }), { lane: { pr1: pr({ state: 'draft' }) } }).laneReason, 'PR #1 is a draft');
  // Past the finish line with nothing open: on its way to main, waiting on other people.
  assert.deepEqual(laneFor(card({ finish: { reached: true, landed: 'staging' } })), { lane: 'in-review', laneReason: 'In staging, on its way to main' });
});

test('lanes: Ready to merge: checks green and approvals in (PR #1 is yours to self-review)', () => {
  assert.deepEqual(laneFor(card({ stage: 'pr2' }), { lane: { pr2: pr({ review: 'approved' }) } }), { lane: 'ready', laneReason: 'Checks passed and PR #2 is approved' });
  assert.equal(laneFor(card({ stage: 'pr1' }), { lane: { pr1: pr() } }).lane, 'ready');
  assert.equal(laneFor(card({ stage: 'pr2' }), { lane: { pr2: pr() } }).lane, 'in-review', 'PR #2 needs its approval');
});

test('lanes: a waiting go-ahead outranks an open PR; a running job outranks both', () => {
  assert.equal(laneFor(card({ needsYou: true, waitingFor: 'approval' }), { lane: { pr2: pr({ review: 'approved' }) } }).lane, 'needs-you');
  assert.equal(laneFor(card({ working: true }), { lane: { pr2: pr({ review: 'approved' }) } }).lane, 'working');
});

test('lanes: Resting and Done fold under the board', () => {
  assert.deepEqual(laneFor(card()), { lane: 'resting', laneReason: 'Nothing happening; waits for your next message' });
  assert.deepEqual(laneFor(card({ paused: true, stageState: 'paused' })), { lane: 'resting', laneReason: 'Stopped; waits for your next message' });
  assert.deepEqual(laneFor(card({ closed: { as: 'done' } })), { lane: 'done', laneReason: 'Marked done' });
  assert.deepEqual(laneFor(card({ closed: { as: 'dropped' } })), { lane: 'done', laneReason: 'Dropped' });
  assert.deepEqual(laneFor(card({ finish: { reached: true, landed: 'main' } })), { lane: 'done', laneReason: 'In main' });
  assert.deepEqual(laneFor(card({ stageState: 'done' })), { lane: 'done', laneReason: 'Done' });
});

test('lanes: every reason is a plain sentence, never empty', () => {
  const cases = [card(), card({ working: true }), card({ needsYou: true, waitingFor: 'approval', stage: 'implement' }), card({ closed: { as: 'done' } })];
  for (const c of cases) {
    const r = laneFor(c);
    assert.ok(LANES.includes(r.lane));
    assert.match(r.laneReason, /^[A-Z][^]*[a-z0-9)]$/);
  }
});
