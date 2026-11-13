// Levels, brief versions, the gate card and gate parking as the job page and the snapshot show
// them. Starts the real dashboard in demo mode (a pretend Foreman, nothing real runs) on temp
// folders with the parking time cut to under a second (STARBASE_GATE_PARK_MS), so no real job,
// ~/.claude or the real state folder is touched and no Claude usage is spent.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startDashboard } from './helpers/dashboard.js';
import { HOLD_HOOK } from './helpers/hold-restart.js';
import { OPUS, HAIKU, FABLE } from '../lib/options.js';
import { parseCommand } from '../lib/protocol.js';
import { State } from '../lib/state.js';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const OLD = '2026-10-01T10:00:00Z';
const STOPPED = { reason: 'the plan adds a migration', rule: 'database', at: OLD };

let root, repo0, featuresDir, dashboard, base, stateDir;
const output = [];

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

async function writeJob(slug, { status = null, options = null, briefs = {} } = {}) {
  const dir = path.join(featuresDir, slug);
  await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
  if (status) await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ schema_version: 1, slug, ...status }, null, 2));
  if (options) await fs.writeFile(path.join(dir, 'options.json'), JSON.stringify({ schema_version: 2, ...options }, null, 2));
  for (const [file, text] of Object.entries(briefs)) await fs.writeFile(path.join(dir, 'briefs', file), text);
  return dir;
}

const planStatus = (n) => ({
  title: 'Visit audit columns', route: 'small', stage: 'plan', stage_state: 'waiting_for_you', waiting_for: 'approval',
  waiting_since: OLD, brief: { number: n, path: `briefs/00${n}-plan.md`, headline: `Visit audit · plan v${n} ready` },
  questions: [1, 2, 3, 4].map((i) => ({ id: String(i), text: `Question ${i}?`, recommendation: 'a', options: [{ id: 'a', label: 'Yes' }] })),
  decided_on_your_behalf: [{ id: 'D-1', decision: 'Reviewers: head inspector, locksmith, gauge', reason: 'L2 defaults', where: 'review', confirmed: false }],
  next_proposed: 'Build step 1', spec: { path: 'docs/spec.md', version: '0.3', status: 'DRAFT' },
  artifacts: [{ name: 'implementation-plan', path: 'implementation-plan.md', version: n }],
  suggested_level: 2, level_reason: 'Adds columns to an existing table.', updated_at: OLD,
});

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-gate-')));
  featuresDir = path.join(root, 'feature-work');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state'), home: path.join(root, 'home') };
  for (const d of [featuresDir, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });

  // A plan gate: L1 chosen, the Foreman suggests L2, the description names a migration (rules: L3).
  const plan = await writeJob('visit-audit', {
    status: planStatus(2),
    options: { level: 1, flow: 'quick', title: 'Add a migration for visit audit columns' },
    briefs: { '001-spec.md': '**Visit audit · spec v0.3**\n', '002-plan.md': '**Visit audit · plan v2 ready**\n', '002-detail.md': 'detail' },
  });

  // Working, with a worktree whose branch adds a migration: the rules see it on the job page only.
  const repo = path.join(root, 'repo');
  repo0 = repo;
  await fs.mkdir(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' }).toString().trim();
  git('init', '-q', '-b', 'main');
  await fs.writeFile(path.join(repo, 'README.md'), 'hi\n');
  git('add', '.'); git('commit', '-q', '-m', 'base');
  const baseSha = git('rev-parse', 'HEAD');
  await fs.mkdir(path.join(repo, 'db', 'migrations'), { recursive: true });
  await fs.writeFile(path.join(repo, 'db', 'migrations', '001_visits.sql'), 'alter table visits add column x int;\n');
  git('add', '.'); git('commit', '-q', '-m', 'change');
  await writeJob('button-label', {
    status: { title: 'Button label', route: 'quick', stage: 'implement', stage_state: 'working', worktree: repo, base_sha: baseSha, repo: { path: repo, base_branch: 'main' }, updated_at: OLD },
    options: { level: 0, flow: 'quick', title: 'Fix the typo on the save button label' },
  });

  // Started jobs (a Foreman session on Opus is saved for each): the model is fixed for them. restart-me
  // has a worktree and a branch; has-pr has an open pull request.
  const sessions = {};
  const started = async (slug, status = {}, options = {}) => {
    const dir = await writeJob(slug, { status: { title: slug, route: 'small', stage: 'plan', stage_state: 'working', repo: { path: repo, base_branch: 'main' }, updated_at: OLD, ...status }, options: { level: 2, flow: 'small', title: `Do the ${slug} job`, repo, ...options } });
    sessions[dir] = { sessionId: crypto.randomUUID(), cwd: repo, model: OPUS };
    return dir;
  };
  await started('model-fixed');
  await started('gate-fixed');
  await started('has-pr', { prs: [{ number: 1, state: 'open', url: 'https://github.com/example/repo/pull/5' }] });
  await started('busy-job');
  const wt = path.join(root, 'repo-worktrees', 'restart-me');
  git('worktree', 'add', '-q', '-b', 'feature/restart-me', wt);
  await started('restart-me', { branch: 'feature/restart-me', worktree: wt, base_sha: baseSha }, { models: { foreman: OPUS, build: OPUS, checks: OPUS } });
  // More started jobs for the restart's guards (a terminal open, two restarts at once, a send during one).
  for (const slug of ['race-one', 'race-two', 'policy-job']) {
    const w = path.join(root, 'repo-worktrees', slug);
    git('worktree', 'add', '-q', '-b', `feature/${slug}`, w);
    await started(slug, { branch: `feature/${slug}`, worktree: w, base_sha: baseSha }, { models: { foreman: OPUS, build: OPUS, checks: OPUS } });
  }
  // I2: ticket jobs restarted. orbit-12-export has a worktree on the ticket's branch (the driver will
  // hold a run of it); orbit-13-import has the old Foreman's session log, which names its folder;
  // orbit-14-report's restart fails after the boundary (a provided file that is gone) and is put back.
  const ticketJob = async (slug, key, title, extra = {}) => started(slug, { title, repo: { path: repo, base_branch: 'main' }, ...extra.status }, { title: `${key}: ${title}`, ticket: { key, title, url: null }, models: { foreman: OPUS, build: OPUS, checks: OPUS }, ...extra.options });
  const wt12 = path.join(root, 'repo-worktrees', 'orbit-12-export');
  git('worktree', 'add', '-q', '-b', 'feature/orbit-12-export', wt12);
  await ticketJob('orbit-12-export', 'ORBIT-12', 'Export', { status: { branch: 'feature/orbit-12-export', worktree: wt12, base_sha: baseSha }, options: { branch: 'feature/orbit-12-export' } });
  const oldLog = async (sessionId, dir) => {
    const proj = path.join(dirs.projects, '-repo');
    await fs.mkdir(path.join(proj, sessionId, 'subagents'), { recursive: true });
    const line = (o) => JSON.stringify({ sessionId, cwd: repo, ...o });
    const usage = { input_tokens: 2000, output_tokens: 90000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    await fs.writeFile(path.join(proj, `${sessionId}.jsonl`), `${[
      line({ type: 'user', timestamp: '2026-11-10T09:00:00Z', message: { role: 'user', content: `/feature Old run. Private folder: ${dir}` } }),
      line({ type: 'assistant', timestamp: '2026-11-10T09:00:05Z', message: { id: `${sessionId}-f1`, model: OPUS, stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: `toolu_${sessionId}`, name: 'Agent', input: { subagent_type: 'feature-implementer', description: 'Build it' } }] } }),
      line({ type: 'pr-link', timestamp: '2026-11-10T09:40:00Z', prNumber: 7, prUrl: 'https://github.com/o/r/pull/7', prRepository: 'o/r' }),
    ].join('\n')}\n`);
    await fs.writeFile(path.join(proj, sessionId, 'subagents', 'agent-w1.jsonl'), `${[
      line({ agentId: 'w1', isSidechain: true, type: 'user', timestamp: '2026-11-10T09:00:06Z', message: { role: 'user', content: 'Stage: Implement.' } }),
      line({ agentId: 'w1', isSidechain: true, type: 'assistant', timestamp: '2026-11-10T09:10:00Z', message: { id: `${sessionId}-w1m`, model: OPUS, stop_reason: null, usage, content: [{ type: 'tool_use', id: `toolu_${sessionId}_B`, name: 'Bash', input: { command: 'npm test' } }] } }),
    ].join('\n')}\n`);
    await fs.writeFile(path.join(proj, sessionId, 'subagents', 'agent-w1.meta.json'), JSON.stringify({ agentType: 'feature-implementer', description: 'Build it', toolUseId: `toolu_${sessionId}` }));
  };
  const dir13 = await ticketJob('orbit-13-import', 'ORBIT-13', 'Import');
  sessions[dir13] = { sessionId: 'old-sess-13', cwd: repo, model: OPUS };
  await oldLog('old-sess-13', dir13);
  const dir14 = await ticketJob('orbit-14-report', 'ORBIT-14', 'Report', { options: { provided: { spec: path.join(root, 'gone-spec.md') } } });
  delete sessions[dir14]; // its Foreman session is known only from its log
  await oldLog('old-sess-14', dir14);
  await started('term-job');
  await fs.mkdir(path.join(dirs.state, 'hook-events'), { recursive: true });
  await fs.writeFile(path.join(dirs.state, 'hook-events', 'events.jsonl'), `${new Date().toISOString()}\t${JSON.stringify({ session_id: 'term-1', hook_event_name: 'UserPromptSubmit', cwd: repo, prompt: `carry on with feature-work/term-job` })}\n`);
  // A started job and one that has not started (no Foreman session), both on Opus, for the locked model.
  await started('lock-job', {}, { models: { foreman: OPUS, build: OPUS, checks: OPUS }, all_fable: false });
  await started('flag-job', {}, { models: { foreman: OPUS, build: OPUS, checks: OPUS }, all_fable: true });
  await writeJob('fresh-two', { status: { title: 'Fresh two', route: 'small', stage: 'plan', stage_state: 'working', repo: { path: repo, base_branch: 'main' }, updated_at: OLD }, options: { level: 2, flow: 'small', title: 'Do the fresh-two job', repo, models: { foreman: OPUS, build: OPUS, checks: OPUS } } });
  await writeJob('fresh-job', { status: { title: 'Fresh', route: 'small', stage: 'plan', stage_state: 'working', repo: { path: repo, base_branch: 'main' }, updated_at: OLD }, options: { level: 2, flow: 'small', title: 'Do the fresh-job job', repo, models: { foreman: FABLE, build: OPUS, checks: OPUS } } });

  // Waiting with no waiting_since and no brief named: timed from the newest brief file.
  const noSince = await writeJob('no-since', {
    status: { title: 'No since', route: 'small', stage: 'spec', stage_state: 'waiting_for_you', updated_at: OLD },
    briefs: { '001-spec.md': '**No since · spec v0.1**\n' },
  });
  await fs.utimes(path.join(noSince, 'briefs', '001-spec.md'), new Date('2026-01-02T03:04:05Z'), new Date('2026-01-02T03:04:05Z'));

  // Waiting, but a gate reply was already sent for this brief: never reported as parked.
  const answered = await writeJob('answered', {
    status: { title: 'Answered', route: 'small', stage: 'plan', stage_state: 'waiting_for_you', waiting_for: 'approval', waiting_since: OLD, brief: { number: 4, path: 'briefs/004-plan.md', headline: null }, updated_at: OLD },
    briefs: { '004-plan.md': '**Answered · plan v1**\n' },
  });

  // Auto mode's switch: an L2 job, an L3 job and an L1 job whose Foreman writes options.json itself.
  // None of them waits at a gate, so the parking tests above see only their own jobs.
  for (const [slug, level] of [['auto-job', 2], ['big-job', 3], ['foreman-job', 1]]) {
    await writeJob(slug, {
      status: { title: slug, route: 'small', stage: 'implement', stage_state: 'working', updated_at: OLD },
      options: { level, flow: level === 3 ? 'large' : level === 2 ? 'small' : 'quick', title: slug, updated_at: OLD },
    });
  }

  // A job run only from a terminal: no options.json at all.
  await writeJob('no-options-job', { status: { title: 'No options', route: 'small', stage: 'implement', stage_state: 'working', updated_at: OLD } });
  // A job already in Auto, which Auto has stopped on (its record seeded in sessions.json).
  const stoppedDir = await writeJob('stopped-job', {
    status: { title: 'stopped-job', route: 'quick', stage: 'implement', stage_state: 'working', updated_at: OLD },
    options: { level: 1, flow: 'quick', title: 'stopped-job', updated_at: OLD, auto: true, auto_since: OLD },
  });
  const stoppedSession = { auto: { on: true, since: OLD, by: 'you', tag: null, ran: true, stopped: STOPPED, step: { stage: 'implement', count: 2 }, failures: 1, lastBrief: 3 } };

  const audit = [
    { at: '2026-10-02T09:00:00Z', action: 'send', kind: 'approve', featureDir: plan, slug: 'visit-audit', text: 'I approve the spec.', gateBrief: 1 },
    { at: '2026-10-02T09:05:00Z', action: 'send', kind: 'message', featureDir: plan, slug: 'visit-audit', text: 'And one more thing' },
    { at: '2026-10-02T09:00:00Z', action: 'send', kind: 'approve', featureDir: answered, slug: 'answered', text: 'go', gateBrief: 4 },
  ];
  await fs.writeFile(path.join(dirs.state, 'audit.jsonl'), audit.map((l) => JSON.stringify(l)).join('\n') + '\n');

  stateDir = dirs.state;
  // One file holds both: the started jobs' Foreman sessions and the job Auto stopped on.
  await fs.writeFile(path.join(dirs.state, 'sessions.json'), JSON.stringify({ ...sessions, [stoppedDir]: stoppedSession }));

  dashboard = await startDashboard({
    env: {
      HOME: dirs.home, STARBASE_DEMO: '1', STARBASE_GATE_PARK_MS: '600',
      STARBASE_FEATURES_DIR: featuresDir, STARBASE_PROJECTS_DIR: dirs.projects, STARBASE_AGENTS_DIR: dirs.agents,
      STARBASE_SKILLS_DIR: dirs.skills, STARBASE_STATE_DIR: dirs.state, STARBASE_TEST_HOLD_RESTART: path.join(root, 'hold-restart'),
    },
    output,
    nodeArgs: ['--import', HOLD_HOOK], // the restart hold, a test hook only
  });
  ({ base } = dashboard);
});

after(async () => {
  await dashboard?.stop(); // exactly the dashboard this test started, and what it started
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const getJson = async (p) => (await fetch(base + p)).json();
const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });

// Every v2 event from the start of this dashboard run, read for `ms` milliseconds.
function eventsFor(ms, epoch) {
  return new Promise((resolve) => {
    const seen = [];
    const req = http.get(`${base}/api/events?v=2&since=0&epoch=${epoch}`, (res) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const data = buf.slice(0, i).split('\n').find((l) => l.startsWith('data: '));
          buf = buf.slice(i + 2);
          if (data) seen.push(JSON.parse(data.slice(6)));
        }
      });
    });
    req.on('error', () => {});
    setTimeout(() => { req.destroy(); resolve(seen); }, ms);
  });
}

test('job page: level chosen, the Foreman’s suggestion and the rules’ one', { timeout: 60_000 }, async () => {
  const job = await getJson('/api/job/visit-audit');
  assert.equal(job.level, 1);
  assert.equal(job.suggestedLevel, 2);
  assert.equal(job.levelReason, 'Adds columns to an existing table.');
  assert.equal(job.rulesLevel.level, 3, 'a migration in the description');
  assert.ok(job.rulesLevel.triggers.includes('migrations'));
  assert.equal(job.rulesLevel.fromDiff, false, 'no worktree yet');
  assert.deepEqual(job.warnings, [], 'the new fields raise no warning');
});

test('job page: with a worktree and a base, the rules also read the changed paths; the snapshot does not', { timeout: 60_000 }, async () => {
  const job = await getJson('/api/job/button-label');
  assert.equal(job.level, 0);
  assert.equal(job.rulesLevel.fromDiff, true);
  assert.equal(job.rulesLevel.changedFiles, 1);
  assert.equal(job.rulesLevel.level, 3, 'the branch adds a migration');
  const snap = await getJson('/api/snapshot');
  const card = snap.jobs.find((j) => j.slug === 'button-label');
  assert.equal(card.rulesLevel.fromDiff, false, 'no git for the snapshot');
  assert.equal(card.rulesLevel.level, 0, 'a typo fix, by its description');
  assert.equal(card.level, 0);
});

test('thread: only the brief status.json names carries versions', { timeout: 60_000 }, async () => {
  const job = await getJson('/api/job/visit-audit');
  const briefs = Object.fromEntries(job.thread.filter((t) => t.kind === 'brief').map((t) => [t.file, t]));
  assert.deepEqual(briefs['briefs/002-plan.md'].versions, { spec: '0.3', artifacts: { 'implementation-plan': '2' } });
  assert.equal(briefs['briefs/001-spec.md'].versions, null);
  assert.equal(briefs['briefs/002-detail.md'].versions, null);
  assert.equal(briefs['briefs/002-plan.md'].id, 'brief:briefs/002-plan.md');
  const noSince = await getJson('/api/job/no-since');
  assert.equal(noSince.thread.find((t) => t.kind === 'brief').versions, null, 'status.json names no brief');
});

test('gate: the plan gate in full; null while working; answered briefs from gate replies', { timeout: 60_000 }, async () => {
  const job = await getJson('/api/job/visit-audit');
  const g = job.gate;
  assert.ok(g);
  assert.equal(g.briefNumber, 2);
  assert.equal(g.briefFile, 'briefs/002-plan.md');
  assert.equal(g.headline, 'Visit audit · plan v2 ready');
  assert.equal(g.stage, 'plan');
  assert.equal(g.nextStage, 'implement');
  assert.equal(g.nextProposed, 'Build step 1');
  assert.equal(g.questions.length, 3);
  assert.equal(g.decided[0].id, 'D-1');
  assert.deepEqual(g.versions, { spec: '0.3', artifacts: { 'implementation-plan': '2' } });
  assert.deepEqual(g.raisedVersions, g.versions);
  assert.equal(g.stale, false);
  assert.equal(g.runActive, false);
  assert.equal(g.waitingSince, OLD);
  assert.deepEqual([g.level, g.suggestedLevel, g.levelReason], [1, 2, 'Adds columns to an existing table.']);
  assert.equal(g.usage, null, 'no usage limit in the demo');
  assert.deepEqual(job.answeredBriefs, [1]);

  assert.equal((await getJson('/api/job/button-label')).gate, null);
  const noSince = await getJson('/api/job/no-since');
  assert.equal(noSince.gate.briefNumber, 1);
  assert.equal(noSince.gate.headline, 'No since · spec v0.1', 'from the brief file when status.json names none');
  assert.equal(noSince.gate.waitingSince, '2026-01-02T03:04:05.000Z', 'timed from the brief file');
  assert.deepEqual((await getJson('/api/job/answered')).answeredBriefs, [4]);
});

test('gate: the versions it was raised at stay put when the plan moves on; the card is stale', { timeout: 60_000 }, async () => {
  const dir = path.join(featuresDir, 'visit-audit');
  const bumped = planStatus(2);
  bumped.artifacts = [{ name: 'implementation-plan', path: 'implementation-plan.md', version: 3 }];
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ schema_version: 1, slug: 'visit-audit', ...bumped }, null, 2));
  await pause(1600); // the job list is cached for 1.5 seconds
  const g = (await getJson('/api/job/visit-audit')).gate;
  assert.equal(g.briefNumber, 2, 'the same brief');
  assert.deepEqual(g.raisedVersions, { spec: '0.3', artifacts: { 'implementation-plan': '2' } });
  assert.deepEqual(g.versions, { spec: '0.3', artifacts: { 'implementation-plan': '3' } });
  assert.equal(g.stale, true);
  const job = await getJson('/api/job/visit-audit');
  assert.deepEqual(job.thread.find((t) => t.file === 'briefs/002-plan.md').versions.artifacts, { 'implementation-plan': '2' }, 'the brief item keeps them too');
});

test('parking: one gate-stale per job and brief; the row says parked and stays under Needs you', { timeout: 60_000 }, async () => {
  const snap = await getJson('/api/snapshot');
  let seen = await eventsFor(1500, snap.epoch); // the check runs every 200 ms here
  const stale = (list) => list.filter((e) => e.type === 'gate-stale').map((e) => `${e.job}#${e.data.briefNumber}`).sort();
  assert.deepEqual(stale(seen), ['no-since#1', 'visit-audit#2'], 'once each; never the answered or the working job');
  const ev = seen.find((e) => e.type === 'gate-stale' && e.job === 'visit-audit');
  assert.deepEqual(ev.data, { job: 'visit-audit', briefNumber: 2, waitingSince: OLD });

  const after1 = await getJson('/api/snapshot');
  const row = after1.jobs.find((j) => j.slug === 'visit-audit');
  assert.equal(row.parked, true);
  assert.equal(row.group, 'needs-you');
  assert.equal(after1.jobs.find((j) => j.slug === 'answered').parked, false);
  assert.equal(after1.jobs.find((j) => j.slug === 'button-label').parked, false);
  assert.equal((await getJson('/api/job/visit-audit')).gate.parked, true);
  // Kept across restarts, in the dashboard's state folder.
  const saved = JSON.parse(await fs.readFile(path.join(stateDir, 'gate-parking.json'), 'utf8'));
  assert.deepEqual(saved.alerted, ['no-since#1#2026-01-02T03:04:05.000Z', `visit-audit#2#${OLD}`]);

  // The Foreman raises brief 3: a new gate, reported once more; brief 2 is not reported again.
  const dir = path.join(featuresDir, 'visit-audit');
  await fs.writeFile(path.join(dir, 'briefs', '003-plan.md'), '**Visit audit · plan v3 ready**\n');
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ schema_version: 1, slug: 'visit-audit', ...planStatus(3) }, null, 2));
  await pause(2000); // the job list is cached for 1.5 seconds
  seen = await eventsFor(800, snap.epoch);
  assert.deepEqual(stale(seen), ['no-since#1', 'visit-audit#2', 'visit-audit#3']);
  const trimmed = JSON.parse(await fs.readFile(path.join(stateDir, 'gate-parking.json'), 'utf8'));
  assert.deepEqual(trimmed.alerted, ['no-since#1#2026-01-02T03:04:05.000Z', `visit-audit#3#${OLD}`], 'brief 2 no longer waits: forgotten');
});

// ---- The Foreman model is fixed once a job has started (spec 1.5) ----

const post = async (p, body) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Starbase-Token': dashboard.token }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const auditLines = async () => (await fs.readFile(path.join(stateDir, 'audit.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
const modelOf = async (slug) => JSON.parse(await fs.readFile(path.join(stateDir, 'sessions.json'), 'utf8'))[path.join(featuresDir, slug)]?.model;

test('a message to a started job runs on the job’s model whatever the request says (send)', { timeout: 60_000 }, async () => {
  const res = await post('/api/job/model-fixed/send', { text: 'Carry on please', model: HAIKU });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const sent = (await auditLines()).filter((l) => l.action === 'send' && l.slug === 'model-fixed').at(-1);
  assert.equal(sent.model, OPUS);
  assert.equal(await modelOf('model-fixed'), OPUS);
});

test('a message to a started job runs on the job’s model whatever the request says (gate)', { timeout: 60_000 }, async () => {
  let res;
  for (let i = 0; i < 40; i++) { // until the first reply has ended and this one is sent
    res = await post('/api/job/gate-fixed/gate', { kind: 'message', note: 'One more thing', model: FABLE });
    if (res.body?.sent) break;
    await pause(500);
  }
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.sent, true, JSON.stringify(res.body));
  const sent = (await auditLines()).filter((l) => l.action === 'send' && l.slug === 'gate-fixed').at(-1);
  assert.equal(sent.text.includes('One more thing'), true);
  assert.equal(sent.model, OPUS);
  assert.equal(await modelOf('gate-fixed'), OPUS);
});

test('restart route: refuses an unknown job, a model that is not offered, an open pull request; changes nothing', { timeout: 60_000 }, async () => {
  const before = await fs.readdir(featuresDir);
  assert.equal((await post('/api/job/no-such-job/restart', { model: FABLE })).status, 404);
  const bad = await post('/api/job/restart-me/restart', { model: 'gpt-9' });
  assert.equal(bad.status, 400);
  assert.equal((await post('/api/job/restart-me/restart', {})).status, 400);
  const pr = await post('/api/job/has-pr/restart', { model: FABLE });
  assert.equal(pr.status, 409);
  assert.match(pr.body.error ?? pr.body.message, /open pull request/);
  assert.deepEqual(await fs.readdir(featuresDir), before);
  assert.equal(await modelOf('has-pr'), OPUS);
});

test('restart route: refuses while a reply is running', { timeout: 60_000 }, async () => {
  const sent = await post('/api/job/busy-job/send', { text: 'Start working' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const res = await post('/api/job/busy-job/restart', { model: FABLE });
  assert.equal(res.status, 409);
  assert.equal(res.body.error ?? res.body.message, 'Stop the reply first.');
  assert.equal(await fs.access(path.join(featuresDir, 'busy-job')).then(() => true, () => false), true);
});

test('restart route: the job starts again on the new model; the old work is kept', { timeout: 60_000 }, async () => {
  const wt = path.join(path.dirname(repo0), 'repo-worktrees', 'restart-me');
  await fs.writeFile(path.join(wt, 'wip.txt'), 'not committed\n');
  const res = await post('/api/job/restart-me/restart', { model: FABLE });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.slug, 'do-the-restart-me-job', 'the new job is named from the description, as New job does');
  assert.match(res.body.archive, /\.restarted[\\/]restart-me-\d{4}-\d\d-\d\d$/);
  assert.match(res.body.backupBranch, /^backup\/feature\/restart-me-\d{4}-\d\d-\d\d$/);
  assert.equal(await fs.readFile(path.join(res.body.archive, 'status.json'), 'utf8').then((t) => JSON.parse(t).slug), 'restart-me');
  assert.equal(await fs.readFile(`${wt}.${res.body.backupBranch.slice(-10)}`+'/wip.txt', 'utf8'), 'not committed\n');
  const first = (await auditLines()).find((l) => l.action === 'send' && l.slug === 'do-the-restart-me-job');
  assert.equal(first.model, FABLE, 'the new job’s Foreman runs on the new model');
  assert.equal(await modelOf('restart-me'), undefined, 'the old job’s session record is not reused');
  const opts = JSON.parse(await fs.readFile(path.join(featuresDir, 'do-the-restart-me-job', 'options.json'), 'utf8'));
  assert.equal(opts.models.foreman, FABLE);
  assert.equal(opts.title, 'Do the restart-me job');
  const audit = (await auditLines()).filter((l) => l.action === 'restart' && l.slug === 'restart-me');
  assert.equal(audit.length, 1);
});

// ---- I2: a restarted job keeps its name and its branch name, and nothing of the old run is the new job's ----

const runsOf = async (slug) => (await getJson('/api/runs')).runs.filter((r) => r.slug === slug);
const ACTIVE = new Set(['starting', 'running', 'waiting_permission', 'stopping']);
async function untilNoReply(slug) {
  for (let i = 0; i < 200; i++) {
    const active = (await runsOf(slug)).filter((r) => ACTIVE.has(r.status));
    if (!active.length) return;
    for (const r of active) if (r.status !== 'stopping') await post(`/api/runs/${r.id}/stop`, {});
    await pause(100);
  }
  throw new Error(`${slug} still has a reply running`);
}

test('I2 A: a ticket job restarted while the driver holds its old run keeps its name and its branch name', { timeout: 60_000 }, async () => {
  const sent = await post('/api/job/orbit-12-export/send', { text: 'Carry on' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  await untilNoReply('orbit-12-export');
  assert.ok((await runsOf('orbit-12-export')).length >= 1, 'the driver holds the old job’s run');
  const res = await post('/api/job/orbit-12-export/restart', { model: FABLE });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.slug, 'orbit-12-export', 'the same name, no -2');
  assert.match(res.body.backupBranch, /^backup\/feature\/orbit-12-export-\d{4}-\d\d-\d\d$/, 'the old branch under its backup name');
  assert.equal((await optionsOf('orbit-12-export')).branch, 'feature/orbit-12-export', 'the same branch name');
  const branches = execFileSync('git', ['-C', repo0, 'for-each-ref', '--format=%(refname:short)', 'refs/heads']).toString().split('\n');
  assert.ok(branches.includes(res.body.backupBranch));
  assert.ok(!(await fs.readdir(featuresDir)).some((n) => n.startsWith('orbit-12-export-')), 'no second folder');
  await untilNoReply('orbit-12-export');
});

test('I2 B: after Starbase started again, a restarted ticket job shows nothing of the old Foreman and never resumes it', { timeout: 60_000 }, async () => {
  const before = await getJson('/api/job/orbit-13-import');
  assert.equal(before.drive.sessionId, 'old-sess-13', 'the old job, before: its Foreman is the old session');
  assert.ok(before.costDetail.totalUsd > 0);
  assert.equal((await runsOf('orbit-13-import')).length, 0, 'the driver holds nothing of it');
  const res = await post('/api/job/orbit-13-import/restart', { model: FABLE });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.slug, 'orbit-13-import');
  // From the first moment: whatever the new reply has got to, nothing of the old session is the new job's.
  const job = await getJson('/api/job/orbit-13-import');
  assert.notEqual(job.drive.sessionId, 'old-sess-13', 'no old session id');
  assert.equal(job.drive.model, FABLE, 'the new model');
  assert.equal(job.costDetail.totalUsd, 0, 'no old spend');
  assert.deepEqual(job.activity.filter((a) => a.sessionId === 'old-sess-13'), [], 'no old crew');
  const lines = await auditLines();
  const boundary = lines.findLastIndex((l) => l.action === 'restart' && l.slug === 'orbit-13-import');
  const sends = () => lines.slice(boundary).filter((l) => l.action === 'send' && l.slug === 'orbit-13-import');
  assert.equal(sends()[0].sessionId, null, 'the first reply starts a new session');
  // The next reply resumes the new Foreman, never the old one.
  // Stopped while still starting, the first reply would have no session yet, and the next one rightly
  // starts afresh: wait for its session to begin, so there is a new Foreman to resume.
  for (let i = 0; i < 200 && !(await runsOf('orbit-13-import')).some((r) => r.sessionId); i++) await pause(50);
  const newSession = (await runsOf('orbit-13-import')).find((r) => r.sessionId)?.sessionId;
  assert.ok(newSession, 'the first reply began a session');
  await untilNoReply('orbit-13-import');
  const again = await post('/api/job/orbit-13-import/send', { text: 'Carry on' });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const next = (await auditLines()).filter((l) => l.action === 'send' && l.slug === 'orbit-13-import').at(-1);
  assert.notEqual(next.sessionId, 'old-sess-13', 'the old session is never resumed');
  assert.equal(next.sessionId, newSession, 'the new session is');
  assert.equal(next.model, FABLE);
  await untilNoReply('orbit-13-import');
});

test('I2: a restart that failed and was put back leaves the old logs counting again', { timeout: 60_000 }, async () => {
  const res = await post('/api/job/orbit-14-report/restart', { model: FABLE });
  assert.notEqual(res.status, 200, JSON.stringify(res.body));
  const failed = (await auditLines()).filter((l) => l.slug === 'orbit-14-report' && /^restart/.test(l.action));
  assert.deepEqual(failed.map((l) => [l.action, l.afterBoundary ?? null]), [['restart', null], ['restart-failed', true]]);
  assert.match(failed[1].error, /Everything it had moved was put back/);
  assert.equal(await fs.access(path.join(featuresDir, 'orbit-14-report', 'options.json')).then(() => true, () => false), true, 'the old job is back in its folder');
  const job = await getJson('/api/job/orbit-14-report');
  assert.equal(job.drive.sessionId, 'old-sess-14', 'the old Foreman is the job’s again');
  assert.ok(job.costDetail.totalUsd > 0, 'and so is its spend');
});

test('F7: a terminal open on the job refuses the restart; nothing changed', { timeout: 60_000 }, async () => {
  const res = await post('/api/job/term-job/restart', { model: FABLE });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.match(res.body.error ?? res.body.message, /in a terminal[\s\S]*Nothing was changed/);
  assert.equal(await fs.access(path.join(featuresDir, 'term-job')).then(() => true, () => false), true);
  assert.equal(await modelOf('term-job'), OPUS);
});

test('F7: a second restart while the first is under way answers 409', { timeout: 60_000 }, async () => {
  const [a, b] = await Promise.all([post('/api/job/race-one/restart', { model: FABLE }), post('/api/job/race-one/restart', { model: FABLE })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
  const refused = a.status === 409 ? a : b;
  assert.match(refused.body.error ?? refused.body.message, /already being started again|being restarted/i);
  const archives = (await fs.readdir(path.join(featuresDir, '.restarted'))).filter((n) => n.startsWith('race-one-'));
  assert.equal(archives.length, 1, 'only one restart moved the work');
});

test('F7: a send and a gate answer during a restart answer 409', { timeout: 60_000 }, async () => {
  // The restart is held open on purpose (the dashboard's test hook), so nothing here depends on timing.
  const hold = path.join(root, 'hold-restart');
  await fs.writeFile(hold, '');
  const restart = post('/api/job/race-two/restart', { model: FABLE });
  while (!(await fs.access(`${hold}.held`).then(() => true, () => false))) await pause(20); // until it is under way
  const send = await post('/api/job/race-two/send', { text: 'Hello' });
  const gate = await post('/api/job/race-two/gate', { kind: 'message', note: 'Hello' });
  const auto = await post('/api/job/race-two/auto', { on: true });
  assert.equal(auto.status, 409, JSON.stringify(auto.body));
  assert.match(auto.body.error ?? auto.body.message, /being started again on another model/);
  await fs.rm(hold);
  assert.equal(send.status, 409, JSON.stringify(send.body));
  assert.equal(gate.status, 409, JSON.stringify(gate.body));
  for (const r of [send, gate]) assert.match(r.body.error ?? r.body.message, /being started again on another model/);
  const res = await restart;
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('F2/F3: a refused restart is on the audit record; a restart clears the old job’s own permission setting', { timeout: 60_000 }, async () => {
  const refused = await post('/api/job/has-pr/restart', { model: FABLE });
  assert.equal(refused.status, 409);
  const line = (await auditLines()).filter((l) => l.action === 'restart-failed' && l.slug === 'has-pr').at(-1);
  assert.match(line.error, /open pull request/);
  assert.equal(line.model, FABLE);

  const dir = path.join(featuresDir, 'policy-job');
  const set = await post('/api/job/policy-job/policy', { policy: 'ask-all' });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const settings = async () => JSON.parse(await fs.readFile(path.join(stateDir, 'settings.json'), 'utf8'));
  assert.equal((await settings()).jobPolicy?.[dir], 'ask-all');
  const res = await post('/api/job/policy-job/restart', { model: FABLE });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await settings()).jobPolicy?.[dir], undefined, 'the old job’s own setting does not follow the new job');
  assert.equal(Array.isArray(res.body.notes), true);
});

// ---- F4: the server keeps a started job's model, whatever the page sends ----
const optionsOf = async (slug) => JSON.parse(await fs.readFile(path.join(featuresDir, slug, 'options.json'), 'utf8'));
const asked = (extra = {}) => ({ options: { level: 2, notes: 'changed notes', models: { foreman: FABLE, build: HAIKU, checks: OPUS }, all_fable: false, ...extra } });

test('F4: options for a started job ignore models.foreman and all_fable; the rest is saved', { timeout: 60_000 }, async () => {
  const res = await post('/api/job/lock-job/options', { slug: 'lock-job', ...asked() });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const o = await optionsOf('lock-job');
  assert.equal(o.models.foreman, OPUS, 'the Foreman stays on the model it started with');
  assert.equal(o.models.build, HAIKU, 'the other models are saved as before');
  assert.equal(o.notes, 'changed notes');
  const res2 = await post('/api/job/lock-job/options', { slug: 'lock-job', ...asked({ all_fable: true }) });
  assert.equal(res2.status, 200, JSON.stringify(res2.body));
  const o2 = await optionsOf('lock-job');
  assert.equal(o2.all_fable, false, 'the whole-job-on-Fable switch is ignored too');
  assert.equal(o2.models.foreman, OPUS);
  assert.equal(res2.body.options.models.foreman, OPUS, 'and the answer says so');
  const level = await post('/api/job/lock-job/options', { slug: 'lock-job', level: 3 });
  assert.equal(level.status, 200, JSON.stringify(level.body));
  assert.equal((await optionsOf('lock-job')).models.foreman, OPUS, 'a level change leaves it too');
  const sent = await post('/api/job/lock-job/send', { text: 'Carry on' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal((await auditLines()).filter((l) => l.action === 'send' && l.slug === 'lock-job').at(-1).model, OPUS);
});

test('F4: a started job whose options say all_fable still sends on the model its session started with', { timeout: 60_000 }, async () => {
  const sent = await post('/api/job/flag-job/send', { text: 'Carry on' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal((await auditLines()).filter((l) => l.action === 'send' && l.slug === 'flag-job').at(-1).model, OPUS);
});

test('F4: the same options request for a job with no Foreman session still changes the model', { timeout: 60_000 }, async () => {
  const res = await post('/api/job/fresh-two/options', { slug: 'fresh-two', ...asked() });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await optionsOf('fresh-two')).models.foreman, FABLE);
  const all = await post('/api/job/fresh-two/options', { slug: 'fresh-two', ...asked({ all_fable: true }) });
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.equal((await optionsOf('fresh-two')).all_fable, true);
});

test('minor: a job with no session sends its first message on the model its options name', { timeout: 60_000 }, async () => {
  const sent = await post('/api/job/fresh-job/send', { text: 'Start please' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal((await auditLines()).filter((l) => l.action === 'send' && l.slug === 'fresh-job').at(-1).model, FABLE);
});

// ---------- Auto mode's switch: kept in Starbase's own sessions.json, never in the job's folder ----------

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const sessions = () => readJson(path.join(stateDir, 'sessions.json')).catch(() => ({}));

test('turning Auto on writes the record, options.json and the audit line', { timeout: 60_000 }, async () => {
  const dir = path.join(featuresDir, 'auto-job');
  const r = await post('/api/job/auto-job/auto', { on: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rec = (await sessions())[dir]?.auto;
  assert.ok(rec, 'the record is in sessions.json');
  assert.equal(rec.on, true);
  assert.equal(rec.by, 'you');
  assert.equal(rec.tag, null);
  assert.equal(rec.ran, true);
  assert.deepEqual([rec.stopped, rec.step, rec.failures, rec.lastBrief], [null, null, 0, null]);
  assert.ok(Number.isFinite(Date.parse(rec.since)));
  const o = await optionsOf('auto-job');
  assert.equal(o.auto, true);
  assert.equal(o.auto_since, rec.since);
  assert.deepEqual([o.level, o.title, o.updated_at], [2, 'auto-job', OLD], 'nothing else in options.json changes');
  const line = (await auditLines()).filter((e) => e.action === 'auto' && e.slug === 'auto-job').at(-1);
  assert.deepEqual([line.what, line.by, line.featureDir], ['on', 'you', dir]);
  const job = await getJson('/api/job/auto-job');
  // decided: what Auto decided that Copy decisions keeps (Task 8): nothing yet.
  assert.deepEqual(job.auto, { on: true, by: 'you', ran: true, stopped: null, deciding: false, allowed: true, why: null, began: 'you', group: 'working', waitingToTest: false, tooBig: null, risky: 0, finished: null, tag: null, decided: [] });
  const card = (await getJson('/api/snapshot')).jobs.find((j) => j.slug === 'auto-job');
  assert.equal(card.auto.on, true);
  assert.equal(card.auto.tag, undefined, 'the tag is the job page’s');
});

test('policyFor says auto while Auto is on and the job\'s own setting after', { timeout: 60_000 }, async () => {
  const dir = path.join(featuresDir, 'auto-job');
  assert.equal((await post('/api/job/auto-job/policy', { policy: 'ask-all' })).status, 200);
  // Auto is still on from the test before.
  assert.equal(await new State(stateDir).policyFor(dir), 'auto');
  let job = await getJson('/api/job/auto-job');
  assert.equal(job.policy, 'auto');
  assert.equal(job.policyOverride, 'ask-all', 'the job’s own setting is kept, untouched');
  const r = await post('/api/job/auto-job/auto', { on: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await new State(stateDir).policyFor(dir), 'ask-all');
  job = await getJson('/api/job/auto-job');
  assert.equal(job.policy, 'ask-all');
  assert.deepEqual([job.auto.on, job.auto.ran], [false, true], 'ran stays true');
  const o = await optionsOf('auto-job');
  assert.equal('auto' in o, false);
  assert.equal('auto_since' in o, false);
  const lines = (await auditLines()).filter((e) => e.action === 'auto' && e.slug === 'auto-job');
  assert.deepEqual(lines.map((e) => e.what), ['on', 'off']);
  assert.equal(lines.some((e) => e.what === 'stray-option'), false, 'Starbase’s own writes are never stray');
});

test('a Foreman that writes auto: true into options.json does not turn Auto on', { timeout: 60_000 }, async () => {
  const dir = path.join(featuresDir, 'foreman-job');
  const stray = () => auditLines().then((l) => l.filter((e) => e.action === 'auto' && e.what === 'stray-option' && e.slug === 'foreman-job'));
  for (const round of [1, 2]) {
    await fs.writeFile(path.join(dir, 'options.json'), JSON.stringify({ ...(await optionsOf('foreman-job')), auto: true, auto_since: new Date().toISOString() }, null, 2));
    await pause(1600); // the job list is cached for 1.5 seconds
    const job = await getJson('/api/job/foreman-job');
    assert.equal(job.auto.on, false, `round ${round}: the card`);
    assert.equal(job.policy, 'hands-off', `round ${round}: the policy is the job's own`);
    assert.equal(await new State(stateDir).policyFor(dir), 'hands-off');
    assert.equal((await sessions())[dir]?.auto?.on ?? false, false, `round ${round}: no record says on`);
    const o = await optionsOf('foreman-job');
    assert.equal('auto' in o, false, `round ${round}: taken out again`);
    assert.equal('auto_since' in o, false, `round ${round}: its time too`);
    assert.deepEqual([o.level, o.title], [1, 'foreman-job'], 'the rest is left as it was');
    assert.equal((await stray()).length, round, `round ${round}: one audit line per removal`);
  }
  const line = (await stray())[0];
  assert.deepEqual([line.action, line.what, line.featureDir], ['auto', 'stray-option', dir]);
});

test('the site cannot send by: \'auto\'', () => {
  const r = parseCommand({ type: 'approve', slug: 'auto-job', by: 'auto' }, { from: 'site' });
  assert.equal(r.ok, false);
  assert.match(r.error, /doesn’t take “by”/);
  assert.equal(parseCommand({ type: 'approve', slug: 'auto-job', by: 'auto' }, { from: 'local' }).ok, false, 'not from this computer’s page either');
});

test('L3: the switch answers 200', { timeout: 60_000 }, async () => {
  const dir = path.join(featuresDir, 'big-job');
  const before = await getJson('/api/job/big-job');
  assert.deepEqual([before.auto.on, before.auto.allowed, before.auto.why], [false, true, null], 'the switch is not held back at L3');
  const r = await post('/api/job/big-job/auto', { on: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await sessions())[dir]?.auto?.on, true, 'the record is written');
  const o = await optionsOf('big-job');
  assert.deepEqual([o.level, o.auto], [3, true]);
  const job = await getJson('/api/job/big-job');
  assert.deepEqual([job.auto.on, job.auto.allowed, job.auto.why], [true, true, null]);
  // Off again, so the tests after this one see the job as it was.
  assert.equal((await post('/api/job/big-job/auto', { on: false })).status, 200);
});

test('turning Auto on for a job with no options.json writes one with auto and auto_since', { timeout: 60_000 }, async () => {
  const dir = path.join(featuresDir, 'no-options-job');
  await assert.rejects(fs.stat(path.join(dir, 'options.json')), 'no options.json to start with');
  const r = await post('/api/job/no-options-job/auto', { on: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rec = (await sessions())[dir].auto;
  let o = await optionsOf('no-options-job');
  assert.deepEqual([o.auto, o.auto_since], [true, rec.since]);
  assert.equal(o.schema_version, 2, 'a whole options file, as a new job gets');
  assert.equal(o.level, null, 'no level yet');
  assert.ok(Array.isArray(o.skip));
  assert.equal(o.title, 'No options');
  // Off again: the file stays, without the two fields.
  assert.equal((await post('/api/job/no-options-job/auto', { on: false })).status, 200);
  o = await optionsOf('no-options-job');
  assert.deepEqual(['auto' in o, 'auto_since' in o, o.schema_version], [false, false, 2]);
});

test('turning Auto on twice keeps since, stopped and the audit count', { timeout: 60_000 }, async () => {
  const autoLines = async (slug) => (await auditLines()).filter((e) => e.action === 'auto' && e.slug === slug).length;
  // A job Auto stopped on: on again changes nothing, the stop included.
  const dir = path.join(featuresDir, 'stopped-job');
  const before = await autoLines('stopped-job');
  const r = await post('/api/job/stopped-job/auto', { on: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.auto.stopped, STOPPED);
  const rec = (await sessions())[dir].auto;
  assert.deepEqual([rec.since, rec.stopped, rec.step, rec.failures, rec.lastBrief], [OLD, STOPPED, { stage: 'implement', count: 2 }, 1, 3]);
  assert.equal((await optionsOf('stopped-job')).auto_since, OLD, 'auto_since does not move');
  assert.equal(await autoLines('stopped-job'), before, 'no audit line');
  // And twice in a row on a job turned on here.
  assert.equal((await post('/api/job/auto-job/auto', { on: true })).status, 200);
  const first = (await sessions())[path.join(featuresDir, 'auto-job')].auto.since;
  const count = await autoLines('auto-job');
  await pause(20);
  assert.equal((await post('/api/job/auto-job/auto', { on: true })).status, 200);
  assert.equal((await sessions())[path.join(featuresDir, 'auto-job')].auto.since, first);
  assert.equal((await optionsOf('auto-job')).auto_since, first);
  assert.equal(await autoLines('auto-job'), count);
  assert.equal((await post('/api/job/auto-job/auto', { on: false })).status, 200);
});

test('turning Auto off on a job that never had it writes nothing', { timeout: 60_000 }, async () => {
  const dir = path.join(featuresDir, 'button-label');
  const optionsBefore = await fs.readFile(path.join(dir, 'options.json'), 'utf8');
  const linesBefore = (await auditLines()).length;
  const r = await post('/api/job/button-label/auto', { on: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.auto.on, false);
  assert.equal((await sessions())[dir]?.auto, undefined, 'no record made');
  assert.equal(await fs.readFile(path.join(dir, 'options.json'), 'utf8'), optionsBefore, 'options.json untouched');
  assert.equal((await auditLines()).length, linesBefore, 'no audit line');
});

test('with Auto on, a Foreman that moves auto_since or removes auto gets both put back from the record', { timeout: 60_000 }, async () => {
  const dir = path.join(featuresDir, 'stopped-job');
  const file = path.join(dir, 'options.json');
  const strayBefore = (await auditLines()).filter((e) => e.what === 'stray-option' && e.slug === 'stopped-job').length;
  // Moved forward, past a "stop" said in the conversation.
  await fs.writeFile(file, JSON.stringify({ ...(await optionsOf('stopped-job')), auto_since: new Date().toISOString() }, null, 2));
  await pause(1600); // the job list is cached for 1.5 seconds
  await getJson('/api/job/stopped-job');
  assert.deepEqual([(await optionsOf('stopped-job')).auto, (await optionsOf('stopped-job')).auto_since], [true, OLD]);
  // Taken out.
  const o = await optionsOf('stopped-job');
  delete o.auto;
  delete o.auto_since;
  await fs.writeFile(file, JSON.stringify(o, null, 2));
  await pause(1600);
  await getJson('/api/job/stopped-job');
  const back = await optionsOf('stopped-job');
  assert.deepEqual([back.auto, back.auto_since, back.level], [true, OLD, 1]);
  assert.equal((await sessions())[dir].auto.since, OLD, 'the record is the one that stays');
  assert.equal((await auditLines()).filter((e) => e.what === 'stray-option' && e.slug === 'stopped-job').length, strayBefore, 'putting it back writes no audit line');
});
