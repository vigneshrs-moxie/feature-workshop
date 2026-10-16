// Levels, brief versions, the gate card and gate parking as the job page and the snapshot show
// them. Starts the real dashboard in demo mode (a pretend Foreman, nothing real runs) on temp
// folders with the parking time cut to under a second (WORKSHOP_GATE_PARK_MS), so no real job,
// ~/.claude or ~/.feature-workshop is touched and no Claude usage is spent.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const OLD = '2026-10-01T10:00:00Z';

let root, featuresDir, child, base, stateDir;
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

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), HOME: dirs.home, WORKSHOP_DEMO: '1', WORKSHOP_GATE_PARK_MS: '600',
      WORKSHOP_FEATURES_DIR: featuresDir, WORKSHOP_PROJECTS_DIR: dirs.projects, WORKSHOP_AGENTS_DIR: dirs.agents,
      WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: dirs.state,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The dashboard didn't start:\n${output.join('')}`)), 15000);
    child.stdout.on('data', (d) => { output.push(String(d)); if (output.join('').includes('Feature Workshop running')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', (d) => output.push(String(d)));
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`The dashboard exited (${code}):\n${output.join('')}`)); });
  });
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM'); // exactly the dashboard this test started
    await gone;
  }
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

test('job page: level chosen, the Foreman’s suggestion and the rules’ one', async () => {
  const job = await getJson('/api/job/visit-audit');
  assert.equal(job.level, 1);
  assert.equal(job.suggestedLevel, 2);
  assert.equal(job.levelReason, 'Adds columns to an existing table.');
  assert.equal(job.rulesLevel.level, 3, 'a migration in the description');
  assert.ok(job.rulesLevel.triggers.includes('migrations'));
  assert.equal(job.rulesLevel.fromDiff, false, 'no worktree yet');
  assert.deepEqual(job.warnings, [], 'the new fields raise no warning');
});

test('job page: with a worktree and a base, the rules also read the changed paths; the snapshot does not', async () => {
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

test('thread: only the brief status.json names carries versions', async () => {
  const job = await getJson('/api/job/visit-audit');
  const briefs = Object.fromEntries(job.thread.filter((t) => t.kind === 'brief').map((t) => [t.file, t]));
  assert.deepEqual(briefs['briefs/002-plan.md'].versions, { spec: '0.3', artifacts: { 'implementation-plan': '2' } });
  assert.equal(briefs['briefs/001-spec.md'].versions, null);
  assert.equal(briefs['briefs/002-detail.md'].versions, null);
  assert.equal(briefs['briefs/002-plan.md'].id, 'brief:briefs/002-plan.md');
  const noSince = await getJson('/api/job/no-since');
  assert.equal(noSince.thread.find((t) => t.kind === 'brief').versions, null, 'status.json names no brief');
});

test('gate: the plan gate in full; null while working; answered briefs from gate replies', async () => {
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

test('gate: the versions it was raised at stay put when the plan moves on; the card is stale', async () => {
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

test('parking: one gate-stale per job and brief; the row says parked and stays under Needs you', async () => {
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
