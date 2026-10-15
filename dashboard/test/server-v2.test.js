// The new UI's routes, wired up in server.js: /api/snapshot, "load older" thread pages
// (?before=<id>) and the v2 live stream. Starts the real dashboard in demo mode (a pretend
// Foreman, nothing real runs) on temp folders, so no real job, ~/.claude or ~/.feature-workshop
// is touched and no Claude usage is spent.

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

let root, featuresDir, child, base, port;
const output = [];

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port: p } = s.address();
  await new Promise((r) => s.close(r));
  return p;
}

async function writeJob(slug, status) {
  const dir = path.join(featuresDir, slug);
  await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ schema_version: 1, slug, ...status }, null, 2));
  return dir;
}

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-server-v2-')));
  featuresDir = path.join(root, 'feature-work');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state'), home: path.join(root, 'home') };
  for (const d of [featuresDir, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });

  const waiting = await writeJob('widget-export', {
    title: 'Widget Export', route: 'small', stage: 'review', stage_state: 'waiting_for_you', waiting_for: 'answers',
    waiting_since: '2026-10-03T10:00:00Z', questions: [{ id: '1', text: 'Fix R-1 now?', options: [] }], updated_at: '2026-10-03T10:00:00Z',
  });
  await writeJob('report-scheduler', { title: 'Report Scheduler', route: 'large', stage: 'pr3', stage_state: 'done', updated_at: '2026-10-01T10:00:00Z' });
  // 70 messages already sent to widget-export: a newest page of 60, then 10 older ones.
  const lines = Array.from({ length: 70 }, (_, i) => JSON.stringify({
    at: new Date(Date.UTC(2026, 9, 3, 9, 0, i)).toISOString(), action: 'send', kind: 'message', featureDir: waiting, slug: 'widget-export', text: `message ${i}`,
  }));
  await fs.writeFile(path.join(dirs.state, 'audit.jsonl'), lines.join('\n') + '\n');

  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), HOME: dirs.home, WORKSHOP_DEMO: '1',
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

async function getJson(p) {
  const res = await fetch(base + p);
  return { status: res.status, body: await res.json() };
}

test('server: /api/snapshot has meta, grouped jobs and where to carry on from', async () => {
  const { status, body } = await getJson('/api/snapshot');
  assert.equal(status, 200);
  assert.equal(body.v, 2);
  assert.ok(Number.isInteger(body.seq) && body.seq >= 0);
  assert.match(body.epoch, /^[0-9a-f]+$/);
  assert.equal(typeof body.meta.token, 'string');
  assert.ok(Array.isArray(body.meta.stages));
  const group = Object.fromEntries(body.jobs.map((j) => [j.slug, j.group]));
  assert.equal(group['widget-export'], 'needs-you');
  assert.equal(group['report-scheduler'], 'done');
  assert.deepEqual(body.jobs.map((j) => j.slug), ['widget-export', 'report-scheduler'], 'ordered by group');
  assert.equal(body.needsYou, 1);
  assert.deepEqual(body.permissions, []);
  assert.ok(body.usage && typeof body.usage === 'object');
});

test('server: a job page holds the newest 60 thread items, ?before= gives the older ones', async () => {
  const { body: job } = await getJson('/api/job/widget-export');
  assert.equal(job.thread.length, 60);
  assert.equal(job.threadMore, true);
  assert.equal(job.thread.at(-1).text, 'message 69');
  const { status, body: older } = await getJson(`/api/job/widget-export?before=${encodeURIComponent(job.thread[0].id)}`);
  assert.equal(status, 200);
  assert.equal(older.slug, 'widget-export');
  assert.deepEqual(older.thread.map((t) => t.text), Array.from({ length: 10 }, (_, i) => `message ${i}`));
  assert.equal(older.threadMore, false);
  const gone = await getJson('/api/job/widget-export?before=you:000000000000');
  assert.equal(gone.status, 404);
  assert.match(gone.body.error, /Reload the job/);
  assert.equal((await getJson('/api/job/no-such-job?before=x')).status, 404);
});

// Reads the v2 stream until `match` returns true for an event (or gives up after 5 seconds).
function waitForEvent(query, match, { onOpen = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const seen = [];
    const req = http.get(`${base}/api/events?v=2&${query}`, (res) => {
      assert.equal(res.headers['content-type'], 'text/event-stream');
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!data) continue;
          const event = JSON.parse(data.slice(6));
          seen.push(event);
          if (match(event)) { clearTimeout(timer); req.destroy(); resolve({ event, seen }); }
        }
      });
      onOpen();
    });
    req.on('error', () => {});
    const timer = setTimeout(() => { req.destroy(); reject(new Error(`No matching event. Saw: ${JSON.stringify(seen)}`)); }, 5000);
  });
}

test('server: an audit line becomes a v2 thread event for that job', async () => {
  const { body: snap } = await getJson('/api/snapshot');
  const wait = waitForEvent(`since=${snap.seq}&epoch=${snap.epoch}`, (e) => e.type === 'thread' && e.job === 'widget-export', {
    onOpen: () => {
      fetch(`${base}/api/job/widget-export/reopen`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workshop-Token': snap.meta.token }, body: '{}',
      }).then((r) => assert.equal(r.status, 200));
    },
  });
  const { event } = await wait;
  assert.equal(event.v, 2);
  assert.equal(event.job, 'widget-export');
  assert.equal(event.data.why, 'reopen');
  assert.ok(event.seq > snap.seq);
});

test('server: a stream from an earlier dashboard run is told to resync', async () => {
  const { event } = await waitForEvent('since=3&epoch=00000000', () => true);
  assert.equal(event.type, 'resync');
  assert.equal(event.data.reason, 'restarted');
});
