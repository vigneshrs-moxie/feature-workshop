// PR feedback through the real dashboard in demo mode (packet N): the demo's flow map gives the job
// an open PR #1, and a fake gh (WORKSHOP_GH) says one check failed and Ana left a comment. Each
// becomes a card under Needs you; Send resumes the job's own session with kind pr-feedback; Leave
// it sends nothing; a Refresh asks about neither again; gh is only ever asked to read.

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
const TOKEN = 'orbfb_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

async function freePort() {
  for (;;) {
    const s = net.createServer();
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    const { port } = s.address();
    await new Promise((r) => s.close(r));
    if (![4477, 4479, 4485].includes(port)) return port;
  }
}

const roots = [];
const children = new Set();
after(async () => {
  for (const c of children) {
    if (c.exitCode !== null) continue;
    const gone = new Promise((r) => c.once('exit', r));
    c.kill('SIGTERM'); // only dashboards this test started
    await gone;
  }
  for (const r of roots) await fs.rm(r, { recursive: true, force: true });
});

// A fake gh: answers from fixture.json, writes each call to calls.jsonl, refuses anything else.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const here = path.dirname(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(path.join(here, 'calls.jsonl'), JSON.stringify(args) + '\\n');
const fx = JSON.parse(fs.readFileSync(path.join(here, 'fixture.json'), 'utf8'));
const a = args.join(' ');
let out = null;
if (args[0] === 'pr' && args[1] === 'view' && args.includes('statusCheckRollup,headRefOid')) out = JSON.stringify(fx.rollup);
else if (args[0] === 'api' && args[1] === '--method' && args[2] === 'GET' && /\\/pulls\\/\\d+\\/comments/.test(args[3])) out = JSON.stringify(fx.comments);
else if (args[0] === 'api' && args[1] === '--method' && args[2] === 'GET' && /\\/pulls\\/\\d+\\/reviews/.test(args[3])) out = JSON.stringify(fx.reviews);
else if (args[0] === 'api' && args[1] === '--method' && args[2] === 'GET' && args[3] === 'user') out = JSON.stringify({ login: 'you' });
else if (args[0] === 'run' && args[1] === 'view' && args[2] === '4242' && args.includes('--log-failed')) out = fx.log;
if (out === null) { process.stderr.write('fake gh: not expected: ' + a + '\\n'); process.exit(1); }
process.stdout.write(out);
`;

async function makeJob() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-prfb-server-')));
  roots.push(root);
  const featuresDir = path.join(root, 'feature-work');
  const repo = path.join(root, 'sample-repo');
  const ghDir = path.join(root, 'gh');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state'), home: path.join(root, 'home') };
  for (const d of [featuresDir, repo, ghDir, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  const job = path.join(featuresDir, 'sample-job');
  await fs.mkdir(path.join(job, 'briefs'), { recursive: true });
  // At PR #1: the demo's flow map gives it an open PR #1 from your fork.
  await fs.writeFile(path.join(job, 'status.json'), JSON.stringify({
    schema_version: 1, slug: 'sample-job', title: 'Sample job', route: 'small', stage: 'pr1', stage_state: 'in_progress',
    repo: { path: repo }, updated_at: '2026-10-15T10:00:00Z',
  }, null, 2));
  // The job's Foreman session, last driven from here.
  await fs.writeFile(path.join(dirs.state, 'sessions.json'), JSON.stringify({ [job]: { sessionId: 'sess-pr-feedback', cwd: repo, model: 'claude-opus-5-5' } }));
  // Every step asks, so the resumed reply waits on a permission card (it is still working).
  await fs.writeFile(path.join(dirs.state, 'settings.json'), JSON.stringify({ policy: 'ask-all' }));

  await fs.writeFile(path.join(ghDir, 'fixture.json'), JSON.stringify({
    rollup: {
      headRefOid: 'abc1234',
      statusCheckRollup: [
        { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/acme/sample-repo/actions/runs/4242/job/9' },
        { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/acme/sample-repo/actions/runs/4243/job/10' },
      ],
    },
    comments: [
      { id: 901, user: { login: 'ana', type: 'User' }, path: 'web/src/App.tsx', line: 40, body: 'Please use a const here.', html_url: 'https://github.com/acme/sample-repo/pull/1#discussion_r901', created_at: '2026-10-27T10:00:00Z' },
      { id: 902, user: { login: 'you', type: 'User' }, path: 'web/src/App.tsx', line: 41, body: 'My own note.', html_url: 'x', created_at: '2026-10-27T10:01:00Z' },
    ],
    reviews: [],
    log: `lint\tRun npm run lint\t> eslint .\nlint\tRun npm run lint\tsrc/a.js: 'x' is assigned a value but never used\nlint\tRun npm run lint\tGH_TOKEN would be ${TOKEN}\nlint\tRun npm run lint\t##[error]Process completed with exit code 1.\n`,
  }));
  const gh = path.join(ghDir, 'gh.cjs');
  await fs.writeFile(gh, FAKE_GH, { mode: 0o755 });

  const env = {
    HOME: dirs.home, WORKSHOP_DEMO: '1', WORKSHOP_FEATURES_DIR: featuresDir, WORKSHOP_PROJECTS_DIR: dirs.projects,
    WORKSHOP_AGENTS_DIR: dirs.agents, WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: dirs.state, WORKSHOP_GH: gh,
  };
  const audit = () => (fsSync.existsSync(path.join(dirs.state, 'audit.jsonl')) ? fsSync.readFileSync(path.join(dirs.state, 'audit.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const ghCalls = () => (fsSync.existsSync(path.join(ghDir, 'calls.jsonl')) ? fsSync.readFileSync(path.join(ghDir, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { env, audit, ghCalls, job };
}

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
  const stop = async () => {
    const gone = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
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
  return { get, write, stop, waitFor, output };
}

const feedbackCards = async (d) => (await d.get('/api/snapshot')).permissions.filter((p) => p.feedbackCard && p.slug === 'sample-job');
const answerWith = (card, label) => ({ decision: 'allow', answers: { [card.input.questions[0].question]: label } });

test('a failed check and a comment become cards in Needs you; Send resumes the same session, Leave it sends nothing', async () => {
  const { env, audit, ghCalls, job } = await makeJob();
  const d = await startDashboard(env);

  // The flow map's first network refresh, at start: two cards (your own comment is skipped).
  const cards = await d.waitFor(async () => { const c = await feedbackCards(d); return c.length === 2 ? c : null; }, 'the two feedback cards');
  const lint = cards.find((c) => c.item.kind === 'check');
  const ana = cards.find((c) => c.item.kind === 'comment');
  assert.match(lint.input.questions[0].question, /^A check failed on PR #1: lint\. The end of its log: “.*exit code 1\.”\. Send it to the Foreman\?$/);
  assert.ok(!JSON.stringify(cards).includes('orbfb_'), 'no token on the cards');
  assert.match(ana.input.questions[0].question, /^ana commented on PR #1, web\/src\/App\.tsx line 40\. “Please use a const here\.” Send it to the Foreman\?$/);
  assert.deepEqual(lint.input.questions[0].options.map((o) => o.label), ['Send it to the Foreman', 'Leave it']);
  const card = (await d.get('/api/features')).features.find((c) => c.slug === 'sample-job');
  assert.equal(card.needsYou, true, 'the job is under Needs you');
  assert.equal(card.permissions, 2);
  assert.equal(audit().filter((e) => e.action === 'pr-feedback-found').length, 2);
  const record = JSON.parse(await fs.readFile(path.join(job, 'pr-feedback.json'), 'utf8'));
  assert.deepEqual(Object.values(record.items).map((i) => i.state), ['waiting', 'waiting']);

  // Send: the job's own session is resumed with the log quoted, kind pr-feedback.
  const sent = await d.write(`/api/permissions/${lint.id}`, answerWith(lint, 'Send it to the Foreman'));
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const send = await d.waitFor(() => audit().find((e) => e.action === 'send' && e.kind === 'pr-feedback'), 'the feedback message');
  assert.equal(send.sessionId, 'sess-pr-feedback', 'the same session');
  assert.match(send.text, /^A check failed on PR #1: lint\. The end of its log is below\. Fix it on this branch, run the tests, and commit\. Don't push\./);
  assert.match(send.text, /'x' is assigned a value but never used/);
  assert.ok(!send.text.includes('orbfb_'), 'the token is hidden');
  const run = await d.waitFor(async () => (await d.get('/api/runs')).runs.find((r) => r.id === send.runId), 'the resumed reply');
  assert.equal(run.sessionId, 'sess-pr-feedback');
  assert.equal(run.kind, 'pr-feedback');
  await d.waitFor(() => audit().find((e) => e.action === 'pr-feedback-sent'), 'the pr-feedback-sent line');

  // Leave it: nothing is sent for the comment.
  const left = await d.write(`/api/permissions/${ana.id}`, answerWith(ana, 'Leave it'));
  assert.equal(left.status, 200, JSON.stringify(left.body));
  await d.waitFor(() => audit().find((e) => e.action === 'pr-feedback-left'), 'the pr-feedback-left line');
  await sleep(500);
  assert.equal(audit().filter((e) => e.action === 'send' && e.kind === 'pr-feedback').length, 1, 'only the check went to the Foreman');
  assert.equal((await feedbackCards(d)).length, 0);
  const after = JSON.parse(await fs.readFile(path.join(job, 'pr-feedback.json'), 'utf8'));
  assert.deepEqual(Object.values(after.items).map((i) => i.state).sort(), ['left', 'sent']);

  // Refresh on Flow: the same failure and comment are not asked about again.
  const before = (await d.get('/api/flow')).fetchedAt;
  const calls = ghCalls().length;
  await d.write('/api/flow/refresh');
  await d.waitFor(async () => { const v = await d.get('/api/flow'); return v.fetchedAt !== before && !v.refreshing; }, 'the refresh');
  await d.waitFor(() => ghCalls().length > calls, 'gh asked again');
  await sleep(500);
  assert.equal((await feedbackCards(d)).length, 0, 'no new card');
  assert.equal(audit().filter((e) => e.action === 'pr-feedback-found').length, 2, 'nothing found twice');

  // The thread: a note, not a message from you.
  const detail = await d.get('/api/job/sample-job');
  assert.ok(detail.thread.some((t) => t.kind === 'note' && t.text === 'You sent the failed check lint on PR #1 to the Foreman.'), JSON.stringify(detail.thread.map((t) => [t.kind, t.text])));
  assert.ok(!detail.thread.some((t) => t.kind === 'you' && t.sendKind === 'pr-feedback'));

  // gh was only ever asked to read.
  for (const args of ghCalls()) {
    const read = (args[0] === 'pr' && args[1] === 'view') || (args[0] === 'run' && args[1] === 'view') || (args[0] === 'api' && args[1] === '--method' && args[2] === 'GET');
    assert.ok(read, `not a read: gh ${args.join(' ')}`);
  }
  await d.stop();
});

test('a card still waiting comes back after a restart, once', async () => {
  const { env, audit } = await makeJob();
  const a = await startDashboard(env);
  await a.waitFor(async () => (await feedbackCards(a)).length === 2, 'the two feedback cards');
  await a.stop();
  const b = await startDashboard(env);
  const back = await b.waitFor(async () => { const c = await feedbackCards(b); return c.length === 2 ? c : null; }, 'the cards after the restart');
  assert.deepEqual(back.map((c) => c.item.kind).sort(), ['check', 'comment']);
  await sleep(500);
  assert.equal((await feedbackCards(b)).length, 2, 'not doubled');
  assert.equal(audit().filter((e) => e.action === 'pr-feedback-found').length, 2, 'not found again');
  await b.stop();
});
