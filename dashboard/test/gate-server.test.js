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
import { OPUS, HAIKU, FABLE } from '../lib/options.js';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const OLD = '2026-10-01T10:00:00Z';

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

  const audit = [
    { at: '2026-10-02T09:00:00Z', action: 'send', kind: 'approve', featureDir: plan, slug: 'visit-audit', text: 'I approve the spec.', gateBrief: 1 },
    { at: '2026-10-02T09:05:00Z', action: 'send', kind: 'message', featureDir: plan, slug: 'visit-audit', text: 'And one more thing' },
    { at: '2026-10-02T09:00:00Z', action: 'send', kind: 'approve', featureDir: answered, slug: 'answered', text: 'go', gateBrief: 4 },
  ];
  await fs.writeFile(path.join(dirs.state, 'audit.jsonl'), audit.map((l) => JSON.stringify(l)).join('\n') + '\n');

  stateDir = dirs.state;
  await fs.writeFile(path.join(dirs.state, 'sessions.json'), JSON.stringify(sessions));

  dashboard = await startDashboard({
    env: {
      HOME: dirs.home, STARBASE_DEMO: '1', STARBASE_GATE_PARK_MS: '600',
      STARBASE_FEATURES_DIR: featuresDir, STARBASE_PROJECTS_DIR: dirs.projects, STARBASE_AGENTS_DIR: dirs.agents,
      STARBASE_SKILLS_DIR: dirs.skills, STARBASE_STATE_DIR: dirs.state, STARBASE_TEST_HOLD_RESTART: path.join(root, 'hold-restart'),
    },
    output,
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
  assert.match(res.body.archive, /\.restarted\/restart-me-\d{4}-\d\d-\d\d$/);
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
