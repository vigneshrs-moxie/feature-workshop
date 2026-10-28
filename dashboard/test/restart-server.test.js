// A restart through the real dashboard in demo mode (packet G step 5): a reply that waits on a
// permission card, then SIGTERM, then a start on the same state folder. The clean stop writes
// service-stop naming the reply; the start writes service-start and carries the reply on in the
// same Foreman session, by itself. Also: the site (dashboard/site/) reaches no driver, no local
// runner, no lock and no child_process, directly or through what it imports.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const DASHBOARD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(DASHBOARD, 'server.js');
const RUNNING = new Set(['starting', 'running', 'waiting_permission', 'stopping']);

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

const roots = [];
const children = new Set();
const CLI = path.join(DASHBOARD, '..', 'bin', 'ground-control.js');

after(async () => {
  for (const c of children) {
    if (c.exitCode !== null) continue;
    const gone = new Promise((r) => c.once('exit', r));
    c.kill('SIGTERM'); // only dashboards this test started
    await gone;
  }
  for (const r of roots) await fs.rm(r, { recursive: true, force: true });
});

async function startDashboard(env) {
  const port = await freePort();
  let wport = await freePort();
  while (wport === port) wport = await freePort();
  const output = [];
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env, PORT: String(port), WIREFRAMES_PORT: String(wport) }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The dashboard didn't start:\n${output.join('')}`)), 15000);
    child.stdout.on('data', (d) => { output.push(String(d)); if (output.join('').includes('Feature Workshop running')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', (d) => output.push(String(d)));
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`The dashboard exited (${code}):\n${output.join('')}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const token = (await (await fetch(`${base}/api/meta`)).json()).token;
  const get = async (p) => (await fetch(base + p)).json();
  const write = async (p, body = {}) => {
    const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workshop-Token': token }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const stop = async (signal = 'SIGTERM') => {
    const gone = new Promise((r) => child.once('exit', r));
    child.kill(signal);
    await gone;
    children.delete(child);
  };
  const waitFor = async (fn, what, ms = 15000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.\n${output.join('')}`);
      await sleep(100);
    }
  };
  return { base, get, write, stop, waitFor, output };
}

// A demo job folder and state folder of its own, with the dashboard's environment for them.
async function makeJob() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-restart-')));
  roots.push(root);
  const featuresDir = path.join(root, 'feature-work');
  const repo = path.join(root, 'sample-repo');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state'), home: path.join(root, 'home') };
  for (const d of [featuresDir, repo, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  const job = path.join(featuresDir, 'sample-job');
  await fs.mkdir(path.join(job, 'briefs'), { recursive: true });
  await fs.writeFile(path.join(job, 'status.json'), JSON.stringify({
    schema_version: 1, slug: 'sample-job', title: 'Sample job', route: 'small', stage: 'implement', stage_state: 'in_progress',
    repo: { path: repo }, updated_at: '2026-10-15T10:00:00Z',
  }, null, 2));
  // Every step asks, so the pretend Foreman's reply waits on a permission card.
  await fs.writeFile(path.join(dirs.state, 'settings.json'), JSON.stringify({ policy: 'ask-all' }));
  const env = {
    HOME: dirs.home, WORKSHOP_DEMO: '1', WORKSHOP_FEATURES_DIR: featuresDir, WORKSHOP_PROJECTS_DIR: dirs.projects,
    WORKSHOP_AGENTS_DIR: dirs.agents, WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: dirs.state,
  };
  const audit = () => fsSync.readFileSync(path.join(dirs.state, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { env, audit, dirs: { ...dirs, job } };
}

// ground-control itself, with the dashboard's environment (so it finds the same state folder).
function cli(env, ...args) {
  return new Promise((resolve) => {
    const out = [];
    const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => out.push(String(d)));
    p.stderr.on('data', (d) => out.push(String(d)));
    p.on('exit', (code) => resolve({ code, text: out.join('').trim() }));
  });
}

// Sends a message and waits for the pretend Foreman's permission card: a reply that waits.
async function replyThatWaits(d) {
  const sent = await d.write('/api/job/sample-job/send', { text: 'Carry on, please.' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  await d.waitFor(async () => (await d.get('/api/snapshot')).permissions.find((p) => p.slug === 'sample-job'), 'the permission card');
  const run = (await d.get('/api/runs')).runs.find((r) => r.id === sent.body.run.id);
  assert.ok(RUNNING.has(run.status), run.status);
  assert.ok(run.sessionId, 'the reply has its session');
  return run;
}

test('a reply paused by a clean stop carries on after the restart, in the same session, once its lock is free', async () => {
  const { env, audit, dirs } = await makeJob();

  // The first dashboard: a reply that waits.
  const a = await startDashboard(env);
  assert.ok(fsSync.existsSync(path.join(dirs.state, 'service.json')), 'service.json while it runs');
  assert.equal(fsSync.statSync(path.join(dirs.state, 'service.json')).mode & 0o777, 0o600);
  const { id: runId, sessionId } = await replyThatWaits(a);
  await a.stop();
  assert.ok(!fsSync.existsSync(path.join(dirs.state, 'service.json')), 'service.json removed at stop');

  const stops = audit().filter((e) => e.action === 'service-stop');
  assert.equal(stops.length, 1, 'one service-stop line');
  assert.deepEqual(stops[0].paused.map((p) => [p.runId, p.slug, p.sessionId]), [[runId, 'sample-job', sessionId]]);

  // Meanwhile a terminal (this test's own process, alive) holds the job's lock.
  const lockFile = path.join(dirs.job, 'lock.json');
  const held = { owner: 'terminal', pid: process.pid, branch: null, acquiredAt: new Date().toISOString() };
  await fs.writeFile(lockFile, JSON.stringify(held));

  // The second, on the same state folder: the reply waits for the lock, then carries on by itself.
  const b = await startDashboard(env);
  const starts = audit().filter((e) => e.action === 'service-start');
  assert.ok(starts.length >= 1, 'a service-start line');
  assert.deepEqual(starts.at(-1).resumes, ['sample-job']);
  const card = (await b.get('/api/features')).features.find((c) => c.slug === 'sample-job');
  assert.deepEqual(card.lock, held, 'the card shows who holds the job');
  assert.equal(card.paused, true);
  assert.equal(card.restartPaused.how, 'clean');
  assert.deepEqual((await b.get('/api/job/sample-job')).lock, held, 'and so does the job detail');
  await sleep(1500);
  assert.equal(audit().filter((e) => e.action === 'send' && e.kind === 'resume-after-restart').length, 0, 'nothing sent while the lock is held');
  await fs.rm(lockFile);
  const resumed = await b.waitFor(() => audit().find((e) => e.action === 'send' && e.kind === 'resume-after-restart'), 'the carry-on message');
  assert.equal(resumed.sessionId, sessionId, 'the same session');
  assert.equal(resumed.text, 'Ground Control restarted. Carry on from where you were.');
  assert.equal(resumed.slug, 'sample-job');
  const lines = audit();
  assert.ok(lines.findIndex((e) => e.action === 'send' && e.kind === 'resume-after-restart') > lines.findLastIndex((e) => e.action === 'service-start'), 'after service-start');
  const newRun = await b.waitFor(async () => (await b.get('/api/runs')).runs.find((r) => r.id === resumed.runId), 'the carried-on reply');
  assert.equal(newRun.sessionId, sessionId);

  // The thread says what happened, as a note, not as a message from you.
  const detail = await b.get('/api/job/sample-job');
  const note = detail.thread.find((t) => t.kind === 'note' && t.text === 'Ground Control restarted, so it told the Foreman to carry on.');
  assert.ok(note, JSON.stringify(detail.thread.map((t) => [t.kind, t.text])));
  assert.ok(!detail.thread.some((t) => t.kind === 'you' && t.sendKind === 'resume-after-restart'));

  // Nothing is left to resume once it is going.
  const again = await b.write('/api/job/sample-job/resume', {});
  assert.equal(again.status, 409);
  await b.stop();
});

test('a reply cut off by a crash shows paused with its note, and ground-control resume carries it on', async () => {
  const { env, audit } = await makeJob();
  const none = await cli(env, 'resume', 'sample-job');
  assert.equal(none.code, 1);
  assert.equal(none.text, 'Ground Control isn\u2019t running. Start it with npm start (ground-control start once it is installed). A job paused by a clean stop carries on by itself.');

  const a = await startDashboard(env);
  const { id: runId, sessionId } = await replyThatWaits(a);
  await a.stop('SIGKILL'); // no service-stop: a crash
  assert.equal(audit().filter((e) => e.action === 'service-stop').length, 0);
  // service.json is still there, naming a process that has gone.
  assert.equal((await cli(env, 'resume', 'sample-job')).code, 1);

  const b = await startDashboard(env);
  assert.deepEqual(audit().filter((e) => e.action === 'service-start').at(-1).paused, ['sample-job']);
  assert.equal(audit().find((e) => e.action === 'service-cut-off')?.runId, runId);
  const card = (await b.get('/api/features')).features.find((c) => c.slug === 'sample-job');
  assert.equal(card.paused, true);
  assert.equal(card.stageState, 'paused');
  assert.equal(card.restartPaused.how, 'crash');
  const detail = await b.get('/api/job/sample-job');
  assert.equal(detail.thread.filter((t) => t.kind === 'note' && t.text === 'Ground Control stopped while the Foreman was working. Resume to carry on.').length, 1);
  // Nothing carries on by itself.
  await sleep(1500);
  assert.equal(audit().filter((e) => e.action === 'send' && e.kind === 'resume-after-restart').length, 0);

  const resumed = await cli(env, 'resume', 'sample-job');
  assert.equal(resumed.code, 0, resumed.text);
  assert.match(resumed.text, /^Resumed sample-job/);
  const send = audit().find((e) => e.action === 'send' && e.kind === 'resume-after-restart');
  assert.equal(send.sessionId, sessionId, 'the same session');
  assert.equal(audit().find((e) => e.action === 'resumed')?.via, 'cli');
  assert.equal((await b.get('/api/job/sample-job')).restartPaused, undefined, 'no longer paused');
  assert.equal((await b.write('/api/job/no-such-job/resume', {})).status, 404);
  await b.stop();
});

// ---------- the site reaches nothing of the machine half ----------

const IMPORT = /(?:^|\n)\s*import\s[^'"]*?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*export\s[^'"\n]*?from\s+['"]([^'"]+)['"]/g;

function importsOf(file) {
  const text = fsSync.readFileSync(file, 'utf8');
  return [...text.matchAll(IMPORT)].map((m) => m[1] ?? m[2] ?? m[3]);
}

test('dashboard/site/ imports no driver, local runner, lock or child_process, directly or through what it imports', () => {
  const siteDir = path.join(DASHBOARD, 'site');
  const files = fsSync.readdirSync(siteDir).filter((n) => n.endsWith('.js')).map((n) => path.join(siteDir, n));
  assert.ok(files.length >= 2, 'the site files');
  const banned = [
    (spec, file) => /(^|\/)lib\/driver\.js$/.test(file ?? ''),
    (spec, file) => /(^|\/)lib\/local\.js$/.test(file ?? ''),
    (spec, file) => /(^|\/)lib\/lock\.js$/.test(file ?? ''),
    (spec) => spec === 'child_process' || spec === 'node:child_process',
    (spec, file) => /(^|\/)runner\//.test(path.relative(DASHBOARD, file ?? '')),
  ];
  const seen = new Set();
  const queue = files.map((f) => [f, [path.relative(DASHBOARD, f)]]);
  while (queue.length) {
    const [file, chain] = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      const target = spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : null;
      const hit = banned.find((b) => b(spec, target));
      assert.ok(!hit, `${[...chain, spec].join(' → ')} reaches the machine half`);
      if (target && target.endsWith('.js') && fsSync.existsSync(target)) queue.push([target, [...chain, path.relative(DASHBOARD, target)]]);
    }
  }
  // The direct check the brief names, as plain text too.
  for (const f of files) {
    const text = fsSync.readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /from\s+['"][^'"]*(lib\/driver|lib\/local|lib\/lock|child_process)(\.js)?['"]/, path.basename(f));
  }
});
