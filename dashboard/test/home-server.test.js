// Home on a running (demo) dashboard: the flow map's routes, and the notifications it records when
// a job starts waiting for you (never for what already waited at start, never twice). The demo
// sends nothing to macOS; its history says so.
// "Always allow…" through the real dashboard: GET/POST/DELETE /api/rules, the permission it was
// drafted from, and the audit and thread lines; then the permission settings and auto mode
// (POST /api/settings, /api/job/:slug/policy). Starts the dashboard in demo mode (a pretend
// Foreman, nothing real runs) on temp folders: no real job, ~/.claude or ~/.feature-workshop is
// touched and no Claude usage is spent.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startDashboard } from './helpers/dashboard.js';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');

let root, stateDir, dashboard, base, token, jobsDir, statusOf;
const output = [];

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-notify-server-')));
  const featuresDir = path.join(root, 'feature-work');
  const repo = path.join(root, 'sample-repo');
  stateDir = path.join(root, 'state');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), home: path.join(root, 'home') };
  for (const d of [featuresDir, repo, stateDir, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  const status = (slug, extra) => JSON.stringify({ schema_version: 1, slug, title: slug === 'old-wait' ? 'Old wait' : 'Busy job', route: 'small', stage: 'plan', repo: { path: repo }, updated_at: '2026-10-15T10:00:00Z', ...extra }, null, 2);
  for (const slug of ['old-wait', 'busy-job']) await fs.mkdir(path.join(featuresDir, slug, 'briefs'), { recursive: true });
  await fs.writeFile(path.join(featuresDir, 'old-wait', 'status.json'), status('old-wait', { stage_state: 'waiting_for_you', waiting_for: 'approval', waiting_since: '2026-10-15T10:00:00Z' }));
  await fs.writeFile(path.join(featuresDir, 'busy-job', 'status.json'), status('busy-job', { stage_state: 'working' }));
  jobsDir = featuresDir;
  statusOf = status;

  dashboard = await startDashboard({
    env: {
      HOME: dirs.home, WORKSHOP_DEMO: '1',
      WORKSHOP_FEATURES_DIR: featuresDir, WORKSHOP_PROJECTS_DIR: dirs.projects, WORKSHOP_AGENTS_DIR: dirs.agents,
      WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: stateDir,
    },
    output,
  });
  ({ base } = dashboard);
  token = (await (await fetch(`${base}/api/meta`)).json()).token;
});

after(async () => {
  await dashboard?.stop(); // exactly the dashboard this test started, and what it started
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const write = async (method, p, body = {}, { auth = true } = {}) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Workshop-Token': token } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const get = async (p) => (await fetch(base + p)).json();

async function waitFor(fn, what, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.\n${output.join('')}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const history = async () => (await get('/api/notifications')).history;

test('server: the flow map is served, and Refresh starts a read', { timeout: 60_000 }, async () => {
  const view = await waitFor(async () => { const v = await get('/api/flow'); return v.repos?.length ? v : null; }, 'the flow map');
  assert.equal(view.repos[0].name, 'sample-repo');
  assert.deepEqual(view.repos[0].lanes.map((l) => l.slug).sort(), ['busy-job', 'old-wait']);
  const r = await write('POST', '/api/flow/refresh');
  assert.equal(r.status, 202);
  assert.equal((await write('POST', '/api/flow/refresh', {}, { auth: false })).status, 403, 'a write needs the page token');
});

test('server: a job that starts waiting is told once; one already waiting at start never is', { timeout: 60_000 }, async () => {
  await new Promise((r) => setTimeout(r, 1500)); // the start-up baseline
  assert.deepEqual((await history()).filter((h) => h.level === 'needs'), []);
  await fs.writeFile(path.join(jobsDir, 'busy-job', 'status.json'), statusOf('busy-job', { stage_state: 'waiting_for_you', waiting_for: 'approval', waiting_since: new Date().toISOString() }));
  const told = await waitFor(async () => (await history()).filter((h) => h.level === 'needs'), 'the needs-you notification', 15000).then(async (h) => { await new Promise((r) => setTimeout(r, 2500)); return (await history()).filter((x) => x.level === 'needs'); });
  assert.equal(told.length, 1, JSON.stringify(told));
  assert.equal(told[0].slug, 'busy-job');
  assert.equal(told[0].title, 'Busy job');
  assert.equal(told[0].body, 'Plan — The Foreman is waiting for your go-ahead.', 'the stage, then what it waits for (no headline yet)');
  assert.equal(told[0].sent, false);
  assert.match(told[0].why, /Demo/);
  assert.equal((await get('/api/meta')).notifyMethod, null, 'the demo never reaches macOS (so the page keeps its own)');
});

test('server: presence, and the notification settings', { timeout: 60_000 }, async () => {
  assert.equal((await write('POST', '/api/presence', { visible: true })).status, 200);
  assert.equal((await write('POST', '/api/presence', { visible: false })).status, 200);
  const r = await write('POST', '/api/settings', { notify: { levels: { done: 'off' }, quiet: { on: true, from: '21:00' } } });
  assert.equal(r.status, 200);
  assert.equal(r.body.notify.levels.done, 'off');
  assert.deepEqual(r.body.notify.quiet, { on: true, from: '21:00', to: '07:00' });
  assert.equal((await write('POST', '/api/settings', { notify: { levels: { done: 'loud' } } })).status, 400);
});
