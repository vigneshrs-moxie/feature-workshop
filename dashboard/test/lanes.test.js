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

// Times relative to now: a worker log that stops mid-call counts as working for 30 minutes when no
// run is on record (runner stillRunning). The fixture jobs were marked done ten minutes ago.
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const MARK = ago(10);
const BEFORE_MARK = ago(20);
const AFTER_MARK = ago(5);
const LONG_AGO = ago(120);

// A Foreman session for the job at `dir` that sent one worker and waits on it. The worker's log
// stops on a Bash call with no result, its last line at `workerLastAt`.
async function workerSession(projects, dir, sessionId, workerLastAt) {
  const session = path.join(projects, '-tmp-repo', sessionId);
  await fs.mkdir(path.join(session, 'subagents'), { recursive: true });
  const line = (o) => JSON.stringify({ sessionId, cwd: '/tmp/repo', ...o });
  await fs.writeFile(`${session}.jsonl`, `${[
    line({ type: 'user', timestamp: '2026-10-15T09:00:00.000Z', message: { role: 'user', content: `/feature Job. Private folder: ${dir}` } }),
    line({ type: 'assistant', timestamp: '2026-10-15T09:00:05.000Z', message: { id: `${sessionId}-f1`, model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `${sessionId}-W`, name: 'Agent', input: { subagent_type: 'feature-implementer', description: 'Build it' } }] } }),
  ].join('\n')}\n`);
  await fs.writeFile(path.join(session, 'subagents', 'agent-w1.jsonl'), `${[
    line({ agentId: 'w1', isSidechain: true, type: 'user', timestamp: '2026-10-15T09:00:06.000Z', message: { role: 'user', content: 'Stage: Implement.' } }),
    line({ agentId: 'w1', isSidechain: true, type: 'assistant', timestamp: workerLastAt, message: { id: `${sessionId}-w1m`, model: 'claude-opus-5-5', stop_reason: null, content: [{ type: 'tool_use', id: `${sessionId}-B`, name: 'Bash', input: { command: 'npm test' } }] } }),
  ].join('\n')}\n`);
  await fs.writeFile(path.join(session, 'subagents', 'agent-w1.meta.json'), JSON.stringify({ agentType: 'feature-implementer', description: 'Build it', toolUseId: `${sessionId}-W` }));
}

// A demo dashboard (no model calls) with fixture jobs: one waiting for a go-ahead, one resting,
// three marked done, and four run only in a terminal (no Starbase run on record).
let root, dashboard, closeWorktree;
before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-lanes-')));
  const featuresDir = path.join(root, 'feature-work');
  const repo = path.join(root, 'repo');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), home: path.join(root, 'home'), state: path.join(root, 'state') };
  for (const d of [featuresDir, repo, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  const status = (slug, extra) => JSON.stringify({ schema_version: 1, slug, title: slug, route: 'small', stage: 'plan', repo: { path: repo }, updated_at: '2026-10-15T10:00:00Z', ...extra });
  for (const [slug, extra] of [
    ['waits-for-you', { stage_state: 'waiting_for_you', waiting_for: 'approval', waiting_since: '2026-10-15T10:00:00Z' }], ['resting-job', { stage_state: 'idle' }],
    ['quiet-before-mark', { stage_state: 'working' }], ['worker-after-mark', { stage_state: 'working' }], ['status-after-mark', { stage_state: 'idle', updated_at: AFTER_MARK }],
    ['silent-terminal-job', { stage_state: 'working' }], ['fresh-terminal-job', { stage_state: 'working' }], ['locked-silent-job', { stage_state: 'working' }],
    ['close-silent-job', { stage_state: 'working', worktree: closeWorktree = path.join(root, 'close-silent-worktree') }],
    // PR #1 open, nothing else: the default finish line (PR #1 merged) isn't crossed, an Auto job's is.
    ['auto-pr-open', { stage: 'pr1', stage_state: 'idle', prs: [{ number: 1, state: 'open', url: 'https://github.com/me/app/pull/1' }] }],
    ['plain-pr-open', { stage: 'pr1', stage_state: 'idle', prs: [{ number: 1, state: 'open', url: 'https://github.com/me/app/pull/2' }] }],
  ]) {
    await fs.mkdir(path.join(featuresDir, slug, 'briefs'), { recursive: true });
    await fs.writeFile(path.join(featuresDir, slug, 'status.json'), status(slug, extra));
  }
  // Three jobs marked done. Two have a worker whose log stops mid-call and still counts as running
  // (it wrote within the last 30 minutes): one went quiet before the mark, one wrote a line after it.
  await workerSession(dirs.projects, path.join(featuresDir, 'quiet-before-mark'), 'sess-quiet', BEFORE_MARK);
  await workerSession(dirs.projects, path.join(featuresDir, 'worker-after-mark'), 'sess-after', AFTER_MARK);
  // Terminal jobs, never marked: a worker silent for two hours, one that wrote five minutes ago, a
  // silent one on a job whose lock a live process holds (this test process), and a silent one on
  // a job with a worktree (a plain folder: the close route's worktree check refuses it, later).
  await workerSession(dirs.projects, path.join(featuresDir, 'silent-terminal-job'), 'sess-silent', LONG_AGO);
  await workerSession(dirs.projects, path.join(featuresDir, 'fresh-terminal-job'), 'sess-fresh', AFTER_MARK);
  await workerSession(dirs.projects, path.join(featuresDir, 'locked-silent-job'), 'sess-locked', LONG_AGO);
  await fs.writeFile(path.join(featuresDir, 'locked-silent-job', 'lock.json'), JSON.stringify({ owner: 'terminal', pid: process.pid, branch: null, acquiredAt: new Date().toISOString() }));
  await workerSession(dirs.projects, path.join(featuresDir, 'close-silent-job'), 'sess-close', LONG_AGO);
  await fs.mkdir(closeWorktree, { recursive: true });
  const closed = { as: 'done', at: MARK };
  // The Auto job was in Auto and has left it (ran stays true): its finish line is still PR #1 open.
  const autoRan = { on: false, since: LONG_AGO, by: 'you', tag: null, ran: true, stopped: null, step: null, failures: 0, lastBrief: null };
  await fs.writeFile(path.join(dirs.state, 'sessions.json'), JSON.stringify({
    ...Object.fromEntries(['quiet-before-mark', 'worker-after-mark', 'status-after-mark'].map((slug) => [path.join(featuresDir, slug), { closed }])),
    [path.join(featuresDir, 'auto-pr-open')]: { auto: autoRan },
  }));
  dashboard = await startDashboard({
    env: {
      HOME: dirs.home, STARBASE_DEMO: '1', STARBASE_FEATURES_DIR: featuresDir, STARBASE_PROJECTS_DIR: dirs.projects,
      STARBASE_AGENTS_DIR: dirs.agents, STARBASE_SKILLS_DIR: dirs.skills, STARBASE_STATE_DIR: dirs.state,
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

test('a job marked done stays off the board when its only running worker went quiet before the mark', async () => {
  const snap = await (await fetch(`${dashboard.base}/api/snapshot`)).json();
  const job = snap.jobs.find((j) => j.slug === 'quiet-before-mark');
  assert.deepEqual(job.closed, { as: 'done', at: MARK });
  assert.equal(job.closedEarlier, undefined);
  assert.equal(job.lane, 'done');
  assert.equal(job.working, false);
  assert.deepEqual(job.nowDoing, []);
});

test('a worker line written after the mark brings the job back', async () => {
  const snap = await (await fetch(`${dashboard.base}/api/snapshot`)).json();
  const job = snap.jobs.find((j) => j.slug === 'worker-after-mark');
  assert.deepEqual(job.closedEarlier, { as: 'done', at: MARK });
  assert.equal(job.closed, undefined);
});

test('a status change after the mark brings the job back', async () => {
  const snap = await (await fetch(`${dashboard.base}/api/snapshot`)).json();
  const job = snap.jobs.find((j) => j.slug === 'status-after-mark');
  assert.deepEqual(job.closedEarlier, { as: 'done', at: MARK });
  assert.equal(job.closed, undefined);
});

const jobCard = async (slug) => (await (await fetch(`${dashboard.base}/api/snapshot`)).json()).jobs.find((j) => j.slug === slug);

test('a terminal job whose worker went silent two hours ago is not working', async () => {
  const job = await jobCard('silent-terminal-job');
  assert.equal(job.working, false);
  assert.notEqual(job.lane, 'working');
  assert.deepEqual(job.nowDoing, []);
});

test('a terminal worker that wrote five minutes ago is working', async () => {
  const job = await jobCard('fresh-terminal-job');
  assert.equal(job.working, true);
  assert.equal(job.lane, 'working');
  assert.equal(job.nowDoing.length, 1);
});

test('a silent worker still counts while the job\'s lock is held by a live process', async () => {
  const job = await jobCard('locked-silent-job');
  assert.equal(job.working, true);
  assert.equal(job.nowDoing[0]?.who, 'feature-implementer');
});

test('a silent worker reads Stopped on the job page', async () => {
  const job = await (await fetch(`${dashboard.base}/api/job/silent-terminal-job`)).json();
  assert.equal(job.activity.find((a) => a.who === 'feature-implementer').state, 'stopped');
});

test('marking done with the worktree removed is not refused by a worker that went silent long ago', async () => {
  const { token } = await (await fetch(`${dashboard.base}/api/meta`)).json();
  const res = await fetch(`${dashboard.base}/api/job/close-silent-job/close`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Starbase-Token': token }, body: JSON.stringify({ as: 'done', removeWorktree: true }),
  });
  const body = await res.text();
  // Past the crew check: the worktree check (a plain folder, not a git worktree) is what refuses.
  assert.doesNotMatch(body, /crew member is still working/);
  assert.match(body, /worktree can’t be removed safely/);
});

test('an Auto job\'s finish is PR #1 open', async () => {
  const auto = await jobCard('auto-pr-open');
  assert.equal(auto.auto.ran, true);
  assert.equal(auto.auto.on, false);
  assert.equal(auto.finish.reached, true);
  assert.equal(auto.finish.by, 'pr1-open');
  const plain = await jobCard('plain-pr-open');
  assert.equal(plain.auto.ran, false);
  assert.equal(plain.finish.reached, false, 'the default finish line is PR #1 merged');
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

test('lanes: Auto is deciding: a gate or card waiting on an Auto job is Working, with the stage in words', () => {
  const auto = { on: true, ran: true, stopped: null, deciding: false, allowed: true, why: null };
  assert.deepEqual(laneFor(card({ needsYou: true, waitingFor: 'approval', stage: 'plan', auto })), { lane: 'working', laneReason: 'Auto is deciding: the plan' });
  assert.deepEqual(laneFor(card({ permissions: 1, stage: 'implement', auto }), { pending: [{ id: 'q', kind: 'question' }] }), { lane: 'working', laneReason: 'Auto is deciding: the build' });
  // Auto off (or never on): as before.
  assert.equal(laneFor(card({ needsYou: true, waitingFor: 'approval', auto: { ...auto, on: false } })).lane, 'needs-you');
  // Nothing waiting: Auto changes nothing.
  assert.deepEqual(laneFor(card({ auto })), { lane: 'resting', laneReason: 'Nothing happening; waits for your next message' });
});

test('lanes: Auto stopped: a stopped Auto job with something waiting needs you, with the reason', () => {
  const stopped = { reason: 'the plan adds a migration', rule: 'database', at: '2026-11-10T09:30:00.000Z' };
  const auto = { on: true, ran: true, stopped, deciding: false, allowed: true, why: null };
  assert.deepEqual(laneFor(card({ needsYou: true, waitingFor: 'approval', stage: 'plan', auto })), { lane: 'needs-you', laneReason: 'Auto stopped: the plan adds a migration' });
  assert.deepEqual(laneFor(card({ permissions: 1, auto }), { pending: [{ id: 'p1', kind: 'permission' }] }), { lane: 'needs-you', laneReason: 'Auto stopped: the plan adds a migration' });
});

test('lanes: every reason is a plain sentence, never empty', () => {
  const cases = [card(), card({ working: true }), card({ needsYou: true, waitingFor: 'approval', stage: 'implement' }), card({ closed: { as: 'done' } })];
  for (const c of cases) {
    const r = laneFor(c);
    assert.ok(LANES.includes(r.lane));
    assert.match(r.laneReason, /^[A-Z][^]*[a-z0-9)]$/);
  }
});

test('lanes: a job being recorded is working and its reason is the line number', () => {
  const testing = 'Recording evidence: line 4 of 19';
  assert.deepEqual(laneFor(card({ stage: 'test', testing })), { lane: 'working', laneReason: testing });
  assert.deepEqual(laneFor(card({ stage: 'test', testing, working: true })), { lane: 'working', laneReason: testing }, 'over “The crew is at work”');
  assert.deepEqual(laneFor(card({ stage: 'test', testing: null })), { lane: 'resting', laneReason: 'Nothing happening; waits for your next message' });
});

test('lanes: a waiting gate wins over the recording', () => {
  const testing = 'Recording evidence: line 4 of 19';
  assert.deepEqual(laneFor(card({ stage: 'test', testing, needsYou: true, waitingFor: 'approval' })), { lane: 'needs-you', laneReason: 'Waiting for your go-ahead on the tests' });
  assert.deepEqual(laneFor(card({ stage: 'test', testing, permissions: 1 }), { pending: [{ id: 'p1', kind: 'permission' }] }), { lane: 'needs-you', laneReason: 'A permission waits for your yes' });
});
