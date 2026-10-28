// The Done notice through the real dashboard (server.js noteFinish, lib/finish.js): told once when a
// job crosses the finish line you set; when the line moves further on, a job told Done at the old
// line is told again when it reaches the new one. Starts the dashboard in demo mode (invented flow
// facts from demo/fake-flow.js: a job's place follows its stage) on temp folders: no real job,
// ~/.claude or ~/.feature-workshop is touched and no Claude usage is spent.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');

let root, child, base, token, featuresDir, repo;
const output = [];

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

const statusOf = (stage) => JSON.stringify({
  schema_version: 1, slug: 'moving-job', title: 'Moving job', route: 'small', stage, stage_state: 'blocked', waiting_for: null,
  repo: { path: repo }, branch: 'feature/moving-job', updated_at: new Date().toISOString(),
}, null, 2);

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-finish-')));
  featuresDir = path.join(root, 'feature-work');
  repo = path.join(root, 'sample-repo');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state'), home: path.join(root, 'home') };
  for (const d of [path.join(featuresDir, 'moving-job', 'briefs'), repo, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  // The finish line starts at PR #1 open. The job is still being built: on the fork, no PR yet.
  await fs.writeFile(path.join(dirs.state, 'settings.json'), JSON.stringify({ policy: 'hands-off', workflow: { finishLine: 'pr1-open' } }));
  await fs.writeFile(path.join(featuresDir, 'moving-job', 'status.json'), statusOf('implement'));

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [SERVER], {
    env: {
      // The screens server takes PORT+1 unless told: give it its own free port, so a neighbour
      // test's server on the next number can't stop this one starting.
      ...process.env, PORT: String(port), WIREFRAMES_PORT: String(await freePort()), HOME: dirs.home, WORKSHOP_DEMO: '1',
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
  token = (await (await fetch(`${base}/api/meta`)).json()).token;
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM'); // exactly the dashboard this test started
    await gone;
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const post = async (p, body = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workshop-Token': token }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const get = async (p) => (await fetch(base + p)).json();
const laneOf = async () => (await get('/api/flow')).repos.flatMap((r) => r.lanes).find((l) => l.slug === 'moving-job') ?? null;

async function waitFor(fn, what, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.\n${output.join('')}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Move the job to `stage`, have the map read it again, and wait until its lane stands at `position`. */
async function moveTo(stage, position) {
  await fs.writeFile(path.join(featuresDir, 'moving-job', 'status.json'), statusOf(stage));
  await waitFor(async () => (await get('/api/snapshot')).jobs.find((j) => j.slug === 'moving-job')?.stage === stage, `the card at ${stage}`);
  await post('/api/flow/refresh');
  await waitFor(async () => (await laneOf())?.position === position, `the lane at ${position}`);
  await new Promise((r) => setTimeout(r, 300)); // the notices follow the map by a tick
}

// Every v2 event kept for catching up, read once (the ring replays them from since=0).
function eventsSince(epoch, ms = 400) {
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
const doneNotices = async () => (await eventsSince((await get('/api/snapshot')).epoch))
  .filter((e) => e.type === 'notification' && e.data?.level === 'done' && e.job === 'moving-job')
  .map((e) => e.data.body);

test('server: Done is told once per line; a line moved further on is told again when the job gets there', async () => {
  // The first look seeds: on the fork with no PR, nothing is past the line.
  await waitFor(async () => (await laneOf())?.position === 'fork', 'the first read of the map');
  assert.deepEqual(await doneNotices(), []);

  // PR #1 opens: the line (PR #1 open) is crossed. Told once.
  await moveTo('pr1', 'fork');
  assert.ok((await laneOf()).pr1?.state === 'open', 'the demo map shows PR #1 open at the pr1 stage');
  assert.deepEqual(await doneNotices(), ['PR #1 is open: the finish line you set.']);
  await post('/api/flow/refresh');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await doneNotices()).length, 1, 'another look says nothing new');

  // The line moves to staging. The job isn't there yet: the next look seeds it as not past the line.
  assert.equal((await post('/api/settings', { workflow: { finishLine: 'staging' } })).status, 200);
  await post('/api/flow/refresh');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await doneNotices()).length, 1, 'moving the line tells nothing by itself');

  // PR #2 merged: the job reaches staging, the new line. Told again, for this line.
  await moveTo('staging-qa', 'staging');
  assert.deepEqual(await doneNotices(), ['PR #1 is open: the finish line you set.', 'In staging (sample-repo): the finish line you set.']);
});
