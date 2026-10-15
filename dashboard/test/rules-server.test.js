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

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');

let root, stateDir, child, base, token;
const output = [];

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-rules-server-')));
  const featuresDir = path.join(root, 'feature-work');
  const repo = path.join(root, 'sample-repo');
  stateDir = path.join(root, 'state');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), home: path.join(root, 'home') };
  for (const d of [featuresDir, repo, stateDir, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  const job = path.join(featuresDir, 'sample-job');
  await fs.mkdir(path.join(job, 'briefs'), { recursive: true });
  await fs.writeFile(path.join(job, 'status.json'), JSON.stringify({
    schema_version: 1, slug: 'sample-job', title: 'Sample job', route: 'small', stage: 'implement', stage_state: 'in_progress',
    repo: { path: repo }, updated_at: '2026-10-15T10:00:00Z',
  }, null, 2));

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), HOME: dirs.home, WORKSHOP_DEMO: '1',
      WORKSHOP_FEATURES_DIR: featuresDir, WORKSHOP_PROJECTS_DIR: dirs.projects, WORKSHOP_AGENTS_DIR: dirs.agents,
      WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: stateDir,
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

test('server: Always allow saves a rule that covers the waiting request, allows it, and can be removed', async () => {
  assert.deepEqual((await get('/api/rules')).rules, []);
  const sent = await write('POST', '/api/job/sample-job/send', { text: 'Carry on, please.' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  // The pretend Foreman asks to run "npm run test:db" (its routine "git status" is allowed by itself).
  const card = await waitFor(async () => (await get('/api/snapshot')).permissions.find((p) => p.input?.command === 'npm run test:db'), 'the permission card');
  assert.equal(card.suggestions[0].rules[0].ruleContent, 'npm run test:db', 'Claude Code’s suggestions are on the card');
  assert.deepEqual(card.draft.options.map((o) => [o.kind, o.value]), [['exact', 'npm run test:db'], ['prefix', 'npm run test:db']]);

  // Writes need the page token; rules wider than their kind, or not covering the request, are refused.
  assert.equal((await write('POST', '/api/rules', { rule: { tool: 'Bash', kind: 'exact', value: 'npm run test:db' }, permissionId: card.id }, { auth: false })).status, 403);
  const wide = await write('POST', '/api/rules', { rule: { tool: 'Bash', kind: 'prefix', value: 'npm' }, permissionId: card.id });
  assert.equal(wide.status, 400);
  assert.match(wide.body.error, /every npm command/);
  const other = await write('POST', '/api/rules', { rule: { tool: 'Bash', kind: 'prefix', value: 'npm run lint' }, permissionId: card.id });
  assert.equal(other.status, 400);
  assert.match(other.body.error, /wouldn’t cover this request/);
  assert.deepEqual((await get('/api/rules')).rules, [], 'nothing saved by the refusals');

  const ok = await write('POST', '/api/rules', { rule: { tool: 'Bash', kind: 'prefix', value: 'npm run test:db' }, permissionId: card.id });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.added, true);
  assert.equal(ok.body.allowed, true);
  assert.equal(ok.body.rule.label, 'run any command starting with “npm run test:db”');
  assert.deepEqual(ok.body.rule.from, { slug: 'sample-job', title: 'Sample job', headline: 'Run a command in the terminal' });
  await waitFor(async () => !(await get('/api/snapshot')).permissions.some((p) => p.id === card.id), 'the card to go');

  const listed = await get('/api/rules');
  assert.equal(listed.active, true);
  assert.deepEqual(listed.rules.map((r) => r.id), [ok.body.rule.id]);
  const file = JSON.parse(await fs.readFile(path.join(stateDir, 'rules.json'), 'utf8'));
  assert.equal(file.rules[0].value, 'npm run test:db');

  // The audit log and the job's conversation say what happened.
  const audit = (await fs.readFile(path.join(stateDir, 'audit.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(audit.some((e) => e.action === 'rule-added' && e.rule === ok.body.rule.id && e.slug === 'sample-job'));
  assert.ok(audit.some((e) => e.action === 'permission' && e.decision === 'allow' && e.rule === ok.body.rule.id));
  const thread = await waitFor(async () => {
    const t = (await get('/api/job/sample-job')).thread;
    return t.some((i) => i.kind === 'note' && /saved an “Always allow” rule/.test(i.text)) ? t : null;
  }, 'the thread note');
  assert.ok(thread.some((i) => i.kind === 'decision' && /You allowed: Run a command in the terminal/.test(i.text)));

  // Removing it.
  assert.equal((await write('DELETE', `/api/rules/${ok.body.rule.id}`, {}, { auth: false })).status, 403);
  const removed = await write('DELETE', `/api/rules/${ok.body.rule.id}`);
  assert.equal(removed.status, 200);
  assert.equal((await write('DELETE', `/api/rules/${ok.body.rule.id}`)).status, 404);
  assert.deepEqual((await get('/api/rules')).rules, []);
  const after = (await fs.readFile(path.join(stateDir, 'audit.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(after.some((e) => e.action === 'rule-removed' && e.rule === ok.body.rule.id));
});

test('server: a rule for a request that’s gone is not saved', async () => {
  const res = await write('POST', '/api/rules', { rule: { tool: 'Bash', kind: 'exact', value: 'npm test' }, permissionId: 'no-such-request' });
  assert.equal(res.status, 404);
  assert.deepEqual((await get('/api/rules')).rules, []);
});

// ---------- Permission settings and auto mode (D5) ----------

const idle = () => waitFor(async () => !(await get('/api/runs')).runs.some((r) => ['starting', 'running', 'waiting_permission', 'stopping'].includes(r.status)), 'the earlier reply to end', 15000);

test('server: the permission setting takes auto mode, a job can override it, and both are saved', async () => {
  await idle(); // a change applies to a reply in progress at once; let the first test's reply end first
  assert.equal((await write('POST', '/api/settings', { policy: 'auto' }, { auth: false })).status, 403);
  assert.equal((await write('POST', '/api/settings', { policy: 'yolo' })).status, 400);
  const set = await write('POST', '/api/settings', { policy: 'auto' });
  assert.equal(set.status, 200);
  assert.equal(set.body.policy, 'auto');
  assert.equal((await get('/api/meta')).settings.policy, 'auto');

  assert.equal((await write('POST', '/api/job/sample-job/policy', { policy: 'sometimes' })).status, 400);
  assert.equal((await write('POST', '/api/job/no-such-job/policy', { policy: 'auto' })).status, 404);
  const own = await write('POST', '/api/job/sample-job/policy', { policy: 'ask-all' });
  assert.deepEqual(own.body, { policy: 'ask-all', policyOverride: 'ask-all', globalPolicy: 'auto', autoMode: { available: null, reason: null, checkedAt: null } });
  let detail = await get('/api/job/sample-job');
  assert.equal(detail.policy, 'ask-all');
  assert.equal(detail.policyOverride, 'ask-all');
  const saved = JSON.parse(await fs.readFile(path.join(stateDir, 'settings.json'), 'utf8'));
  assert.equal(saved.policy, 'auto');
  assert.deepEqual(Object.values(saved.jobPolicy), ['ask-all']);

  await write('POST', '/api/job/sample-job/policy', { policy: null });
  detail = await get('/api/job/sample-job');
  assert.equal(detail.policy, 'auto', 'it follows yours again');
  assert.equal(detail.policyOverride, null);
  await waitFor(async () => (await get('/api/job/sample-job')).thread.some((i) => i.kind === 'note' && /follows your global permission setting/.test(i.text)), 'the thread note');
});

test('server: in auto mode a push still asks, and what auto mode blocked shows in the thread', async () => {
  await write('POST', '/api/settings', { policy: 'auto' });
  const sent = await write('POST', '/api/job/sample-job/send', { text: 'Carry on.' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  // The pretend safety model can't decide about the database tests: a card, marked as coming from auto mode.
  const db = await waitFor(async () => (await get('/api/snapshot')).permissions.find((p) => p.input?.command === 'npm run test:db'), 'the database card');
  assert.equal(db.fromAutoMode, true);
  assert.equal((await write('POST', `/api/permissions/${db.id}`, { decision: 'allow' })).status, 200);
  // The push is a hard line: a card even in auto mode, and it can't be always allowed.
  const push = await waitFor(async () => (await get('/api/snapshot')).permissions.find((p) => p.input?.command?.startsWith('git push')), 'the push card');
  assert.equal(push.hardLine.line, 'git-push');
  assert.equal(push.draft, null);
  const always = await write('POST', '/api/rules', { rule: { tool: 'Bash', kind: 'prefix', value: 'git push' }, permissionId: push.id });
  assert.equal(always.status, 400);
  assert.match(always.body.error, /hard line/);
  assert.equal((await write('POST', `/api/permissions/${push.id}`, { decision: 'deny' })).status, 200);
  const thread = await waitFor(async () => {
    const t = (await get('/api/job/sample-job')).thread;
    return t.some((i) => i.kind === 'blocked') ? t : null;
  }, 'the blocked line');
  const blocked = thread.filter((i) => i.kind === 'blocked');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].by, 'auto');
  assert.match(blocked[0].preview, /curl/);
  assert.equal((await get('/api/meta')).settings.autoMode.available, true, 'the reply found auto mode available');
  await write('POST', '/api/settings', { policy: 'hands-off' });
});
