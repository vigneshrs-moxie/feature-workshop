// "Choose the level for me" in the running dashboard (lib/auto-level.js, server.js checkLevels):
// off by default; on, it sets the level of a job the Foreman suggested one for, says why it asks
// instead when the rules say so, raises a level when the branch's diff passes the L0 limits, and
// stops raising once you change an automatic level yourself. Demo mode on temp folders: no real
// job, ~/.claude or ~/.feature-workshop is touched and no Claude usage is spent.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startDashboard } from './helpers/dashboard.js';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const OLD = '2026-10-01T10:00:00Z';
let root, featuresDir, dashboard, base, token;
const output = [];

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}
async function writeJob(slug, { status, options = null }) {
  const dir = path.join(featuresDir, slug);
  await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ schema_version: 1, slug, updated_at: OLD, ...status }, null, 2));
  if (options) await fs.writeFile(path.join(dir, 'options.json'), JSON.stringify({ schema_version: 2, ...options }, null, 2));
  return dir;
}
const optionsOf = async (slug) => JSON.parse(await fs.readFile(path.join(featuresDir, slug, 'options.json'), 'utf8').catch(() => 'null'));
const write = async (p, body) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workshop-Token': token }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const getJson = async (p) => (await fetch(base + p)).json();
async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) return v;
    await new Promise((r) => { setTimeout(r, 150); });
  }
}

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-autolevel-')));
  featuresDir = path.join(root, 'feature-work');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state'), home: path.join(root, 'home') };
  for (const d of [featuresDir, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });

  // The Foreman suggested L1 for a short single change and expects to touch one page file.
  await writeJob('save-label', { status: { title: 'Save label', stage: 'plan', stage_state: 'waiting_for_you', waiting_for: 'approval', suggested_level: 1, predicted_paths: ['app/pages/visits.tsx'] }, options: { title: 'Change the label on the save button to say Save visit' } });
  // A migration: a floor of L3, so it asks instead.
  await writeJob('visit-migration', { status: { title: 'Visit migration', stage: 'plan', stage_state: 'waiting_for_you', suggested_level: 3 }, options: { title: 'Add a migration for the visit audit columns in the database' } });
  // An L0 job whose branch already changes four files: past the L0 limits.
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' }).toString().trim();
  git('init', '-q', '-b', 'main');
  for (const f of ['a', 'b', 'c', 'd']) await fs.writeFile(path.join(repo, `${f}.ts`), 'x\n');
  git('add', '.'); git('commit', '-q', '-m', 'base');
  const baseSha = git('rev-parse', 'HEAD');
  for (const f of ['a', 'b', 'c', 'd']) await fs.writeFile(path.join(repo, `${f}.ts`), 'y\n');
  git('add', '.'); git('commit', '-q', '-m', 'change');
  await writeJob('tweak', { status: { title: 'Tweak', stage: 'implement', stage_state: 'working', worktree: repo, base_sha: baseSha, repo: { path: repo, base_branch: 'main' } }, options: { level: 0, flow: 'quick', title: 'Fix the typo on the save button' } });

  dashboard = await startDashboard({ env: { HOME: dirs.home, WORKSHOP_DEMO: '1', WORKSHOP_FEATURES_DIR: featuresDir, WORKSHOP_PROJECTS_DIR: dirs.projects, WORKSHOP_AGENTS_DIR: dirs.agents, WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: dirs.state }, output });
  ({ base } = dashboard);
  token = (await getJson('/api/meta')).token;
});

after(async () => {
  await dashboard?.stop(); // exactly the dashboard this test started, and what it started
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('off by default: nothing is chosen', { timeout: 60_000 }, async () => {
  await new Promise((r) => { setTimeout(r, 800); });
  assert.equal((await optionsOf('save-label')).level ?? null, null);
  assert.equal((await optionsOf('tweak')).level, 0);
});

test('on: picks, asks, raises after a build, and stops raising after your override', { timeout: 60_000 }, async () => {
  const set = await write('/api/settings', { workflow: { autoLevel: true } });
  assert.equal(set.status, 200);
  assert.equal(set.body.workflow.autoLevel, true);

  // Picked: rules L1 (a short single change), the Foreman L1.
  assert.equal(await until(async () => (await optionsOf('save-label'))?.level === 1), true);
  const thread = (await getJson('/api/job/save-label')).thread;
  assert.ok(thread.some((i) => i.kind === 'note' && /^Level set to L1 automatically/.test(i.text)), 'a one-line note in the conversation');

  // Asked instead: a migration sets L3.
  const asked = await until(async () => (await getJson('/api/job/visit-migration')).thread.find((i) => i.kind === 'note' && /not chosen automatically/.test(i.text)));
  assert.match(asked.text, /L3/);
  assert.equal((await optionsOf('visit-migration')).level ?? null, null);

  // After a build: four files changed at L0, so L1.
  assert.equal(await until(async () => (await optionsOf('tweak'))?.level === 1), true);
  const decisions = (await getJson('/api/job/tweak/decisions')).decisions;
  assert.equal(decisions[0].text, 'Level L0 → L1 (automatic, after a build)');

  // You put it back to L0: recorded as an override, and the automatic raises stop for this job.
  const back = await write('/api/job/tweak/options', { level: 0 });
  assert.equal(back.status, 200);
  await write('/api/settings', { workflow: { autoLevel: false } });
  await write('/api/settings', { workflow: { autoLevel: true } });
  await new Promise((r) => { setTimeout(r, 1500); });
  assert.equal((await optionsOf('tweak')).level, 0);
  assert.equal((await getJson('/api/job/tweak/decisions')).decisions[0].text, 'Level L1 → L0 (you changed the automatic pick)');

  assert.equal((await write('/api/settings', { workflow: { autoLevel: 'yes' } })).status, 400);
});
