// Steer: a message you send while the Foreman is still replying joins the session's live input
// (lib/driver.js), with delivery states queued -> delivered -> acted-on (or cancelled), and the
// route POST /api/runs/:id/steer. Pretend sessions only: no Claude, no usage, no real job.
//
// The pretend sessions read their input the way the SDK's query() does (Query.streamInput in
// @anthropic-ai/claude-agent-sdk: a for-await over the prompt all through the reply, writing each
// message to Claude Code as soon as it is yielded), so a steered message is taken mid-reply.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Driver, Busy } from '../lib/driver.js';
import { State } from '../lib/state.js';
import { buildThread } from '../lib/thread.js';
import { makeFakeQuery } from '../demo/fake-query.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (prefix) => fs.mkdtemp(path.join(os.tmpdir(), prefix));
const tmpState = async () => new State(await tmp('workshop-steer-state-'));
const until = (driver, runId, statuses) => new Promise((resolve) => {
  const now = driver.runs.get(runId);
  if (now && statuses.includes(now.status)) return resolve(driver.view(now));
  const on = (r) => { if (r.id === runId && statuses.includes(r.status)) { driver.off('run', on); resolve(r); } };
  driver.on('run', on);
});
// Resolves once the steered message has reached `state` (or already had: delivery can happen
// before driver.steer() returns).
const ORDER = ['queued', 'delivered', 'acted-on'];
const steerReaches = (driver, id, state) => new Promise((resolve) => {
  const reached = (s) => s.state === state || (ORDER.includes(state) && ORDER.indexOf(s.state) > ORDER.indexOf(state));
  for (const run of driver.runs.values()) {
    const s = run.steers.find((x) => x.id === id);
    if (s && reached(s)) return resolve(s);
  }
  const on = (s) => { if (s.id === id && reached(s)) { driver.off('steer', on); resolve(s); } };
  driver.on('steer', on);
});

/**
 * A pretend Claude Code session that reads its whole input as the SDK does: the first message
 * starts the reply, and every later one is collected in `received` the moment it is yielded.
 * script({ text, received, next, options, isInterrupted }): `next()` waits for the next message.
 */
function sdkLikeSession(script, { onInterrupt = null } = {}) {
  const sessions = [];
  const queryFn = ({ prompt, options }) => {
    const it = prompt[Symbol.asyncIterator]();
    const received = [];
    let waiter = null;
    let interrupted = false;
    const session = { received, options, interruptArgs: [] };
    sessions.push(session);
    const pump = async () => {
      for (;;) {
        const r = await it.next();
        if (r.done) { session.inputClosed = true; waiter?.(); return; }
        received.push(r.value);
        waiter?.();
      }
    };
    let cursor = 0;
    const next = async () => {
      while (received.length <= cursor && !session.inputClosed) await new Promise((r) => { waiter = r; });
      return received.length > cursor ? received[cursor++] : null;
    };
    const gen = (async function* () {
      const first = await it.next();
      pump();
      yield* script({ text: first.value.message.content, firstUuid: first.value.uuid, received, next, options, isInterrupted: () => interrupted, session });
    })();
    gen.interrupt = async (args) => { interrupted = true; session.interruptArgs.push(args); waiter?.(); return onInterrupt?.(session) ?? undefined; };
    return gen;
  };
  return { queryFn, sessions };
}

const init = (id) => ({ type: 'system', subtype: 'init', session_id: id, model: 'claude-opus-5-5', apiKeySource: 'none' });
const say = (text) => ({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } });
const done = (text) => ({ type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0.1, permission_denials: [] });
const idle = { type: 'system', subtype: 'session_state_changed', state: 'idle' };

test('driver: a steered message reaches the live session mid-reply: queued, delivered, then acted on', async () => {
  const state = await tmpState();
  let release;
  const working = new Promise((r) => { release = r; });
  const { queryFn, sessions } = sdkLikeSession(async function* ({ next }) {
    yield init('s-steer-1');
    yield say('Working on it.');
    const steered = await next(); // the reply is still going; your message arrives in its input
    await working;
    yield say(`Heard you: ${steered.message.content}`);
    yield done('Finished.');
    yield idle;
  });
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent' });
  driver.idleGraceMs = 30;
  const states = [];
  driver.on('steer', (s) => states.push(s.state));
  const run = await driver.start({ featureDir: '/f/a', slug: 'a', title: 'A', cwd: '/repo', text: 'go' });
  await until(driver, run.id, ['running']);

  const s = await driver.steer(run.id, 'Use the smaller table instead.');
  assert.ok(['queued', 'delivered'].includes(s.state), s.state); // handed over before the audit write, so possibly already delivered
  assert.equal(s.slug, 'a');
  await steerReaches(driver, s.id, 'delivered');
  while (!sessions[0].received.length) await sleep(2);
  const msg = sessions[0].received[0];
  assert.equal(msg.type, 'user');
  assert.equal(msg.message.content, 'Use the smaller table instead.');
  assert.equal(msg.uuid, s.id, 'stamped with the steer id, so Stop can cancel it in Claude Code’s queue');
  assert.equal(driver.runs.get(run.id).status, 'running', 'delivered while the reply is still going');

  release();
  const ended = await until(driver, run.id, ['done', 'error', 'stopped']);
  assert.equal(ended.status, 'done');
  assert.deepEqual(states, ['queued', 'delivered', 'acted-on']);
  assert.equal(ended.steers[0].state, 'acted-on');
  assert.ok(ended.steers[0].deliveredAt && ended.steers[0].actedAt);
  assert.equal(ended.lastText, 'Heard you: Use the smaller table instead.');
  assert.equal(sessions[0].inputClosed, true, 'the input still closes when the reply finishes');

  assert.equal(await driver.steer(run.id, 'too late'), null, 'nothing to steer once the reply is over');
  const audit = await state.auditFor('/f/a');
  const line = audit.find((e) => e.action === 'steer');
  assert.equal(line.text, 'Use the smaller table instead.');
  assert.equal(line.steerId, s.id);
  assert.equal(line.runId, run.id);
});

test('driver: where Claude Code stamps replies, only a reply naming the steered message counts as acting on it', async () => {
  const state = await tmpState();
  let go, checkpoint, more;
  const gate = new Promise((r) => { go = r; });
  const reached = new Promise((r) => { checkpoint = r; });
  const gate2 = new Promise((r) => { more = r; });
  const stamped = (text, uuids) => ({ ...say(text), user_message_uuid: uuids.at(-1), user_message_uuids: uuids });
  const { queryFn } = sdkLikeSession(async function* ({ next, firstUuid }) {
    yield init('s-steer-stamp');
    yield stamped('Starting on your first message.', [firstUuid]);
    const m = await next();
    await gate;
    yield say('Still finishing the step I was on.'); // an unstamped frame of the same turn
    checkpoint();
    await gate2;
    yield stamped('Read your note.', [firstUuid, m.uuid]);
    yield done('ok');
    yield idle;
  });
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent' });
  driver.idleGraceMs = 30;
  const run = await driver.start({ featureDir: '/f/st', slug: 'st', title: 'St', cwd: '/repo', text: 'go' });
  await until(driver, run.id, ['running']);
  const s = await driver.steer(run.id, 'Note this.');
  await steerReaches(driver, s.id, 'delivered');
  go();
  await reached;
  await sleep(10);
  assert.equal(driver.runs.get(run.id).steers[0].state, 'delivered', 'an unstamped message doesn’t count once Claude Code stamps');
  more();
  const ended = await until(driver, run.id, ['done', 'error']);
  assert.equal(ended.steers[0].state, 'acted-on');
});

test('driver: several steered messages are delivered in order; the input is a queue', async () => {
  const state = await tmpState();
  let go;
  const gate = new Promise((r) => { go = r; });
  const { queryFn, sessions } = sdkLikeSession(async function* ({ received }) {
    yield init('s-steer-2');
    await gate;
    while (received.length < 3) await sleep(5);
    yield say(`Read ${received.length}.`);
    yield done('ok');
    yield idle;
  });
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent' });
  driver.idleGraceMs = 30;
  const run = await driver.start({ featureDir: '/f/b', slug: 'b', title: 'B', cwd: '/repo', text: 'go' });
  await until(driver, run.id, ['running']);
  const ids = [];
  for (const t of ['one', 'two', 'three']) ids.push((await driver.steer(run.id, t)).id);
  go();
  const ended = await until(driver, run.id, ['done', 'error']);
  assert.deepEqual(sessions[0].received.map((m) => m.message.content), ['one', 'two', 'three']);
  assert.deepEqual(ended.steers.map((x) => [x.id, x.state]), ids.map((id) => [id, 'acted-on']));
});

test('driver: a message steered in after the result keeps the reply open until it is answered', async () => {
  const state = await tmpState();
  let resultSent, answer;
  const afterResult = new Promise((r) => { resultSent = r; });
  const answering = new Promise((r) => { answer = r; });
  const { queryFn } = sdkLikeSession(async function* ({ next }) {
    yield init('s-steer-3');
    yield say('First answer.');
    yield done('First answer.');
    resultSent();
    const m = await next(); // Claude Code would start a new turn for it
    if (!m) return;
    await answering;
    yield say(`Second answer, about: ${m.message.content}`);
    yield done('Second answer.');
    yield idle;
  });
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent' });
  driver.idleGraceMs = 200;
  const run = await driver.start({ featureDir: '/f/c', slug: 'c', title: 'C', cwd: '/repo', text: 'go' });
  await afterResult;
  const s = await driver.steer(run.id, 'One more thing.');
  assert.ok(s, 'still open in the grace period after the result');
  await sleep(300); // longer than the idle grace: the run must not end with the message unanswered
  assert.notEqual(driver.runs.get(run.id).status, 'done');
  assert.equal(driver.runs.get(run.id).steers[0].state, 'delivered');
  answer();
  const ended = await until(driver, run.id, ['done', 'error']);
  assert.equal(ended.status, 'done');
  assert.equal(ended.lastText, 'Second answer, about: One more thing.');
  assert.equal(ended.steers[0].state, 'acted-on');
});

test('driver: Stop cancels steered messages the session never read, and asks Claude Code to drop its queue', async () => {
  const state = await tmpState();
  // This session never asks for more input, so a steered message stays queued in the dashboard.
  const sessions = [];
  const queryFn = ({ prompt }) => {
    let interrupted = false;
    const session = { interruptArgs: [] };
    sessions.push(session);
    const gen = (async function* () {
      await prompt[Symbol.asyncIterator]().next();
      yield init('s-steer-4');
      while (!interrupted) await sleep(5);
      yield { type: 'result', subtype: 'error_during_execution', is_error: true, result: '', total_cost_usd: 0.1, permission_denials: [] };
    })();
    gen.interrupt = async (args) => { interrupted = true; session.interruptArgs.push(args); return { still_queued: [], cancelled: [] }; };
    return gen;
  };
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent' });
  driver.idleGraceMs = 30;
  const run = await driver.start({ featureDir: '/f/d', slug: 'd', title: 'D', cwd: '/repo', text: 'go' });
  await until(driver, run.id, ['running']);
  const s = await driver.steer(run.id, 'Actually, wait.');
  await sleep(20);
  assert.equal(driver.runs.get(run.id).steers[0].state, 'queued', 'not handed over: the session hasn’t asked for more');
  const cancelled = steerReaches(driver, s.id, 'cancelled');
  assert.equal(await driver.stop(run.id), true);
  await cancelled;
  assert.deepEqual(sessions[0].interruptArgs, [{ cancelQueued: true }]);
  await assert.rejects(driver.steer(run.id, 'and this?'), Busy, 'no steering while it stops');
  const ended = await until(driver, run.id, ['stopped', 'error', 'done']);
  assert.equal(ended.status, 'stopped');
  assert.equal(ended.steers[0].state, 'cancelled');
});

test('driver: Stop marks a delivered message cancelled when Claude Code says it dropped it', async () => {
  const state = await tmpState();
  const { queryFn } = sdkLikeSession(async function* ({ next, isInterrupted }) {
    yield init('s-steer-5');
    await next();
    while (!isInterrupted()) await sleep(5);
    yield { type: 'result', subtype: 'error_during_execution', is_error: true, result: '', total_cost_usd: 0.1, permission_denials: [] };
  }, { onInterrupt: (session) => ({ still_queued: [], cancelled: session.received.map((m) => m.uuid) }) });
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent' });
  driver.idleGraceMs = 30;
  const run = await driver.start({ featureDir: '/f/e', slug: 'e', title: 'E', cwd: '/repo', text: 'go' });
  await until(driver, run.id, ['running']);
  const s = await driver.steer(run.id, 'Change of plan.');
  await steerReaches(driver, s.id, 'delivered');
  await driver.stop(run.id);
  const ended = await until(driver, run.id, ['stopped', 'error', 'done']);
  assert.equal(ended.steers[0].state, 'cancelled');
});

test('driver: a delivered message the reply never answered ends up unanswered, not "delivered" forever', async () => {
  // A Stop on a Claude Code too old to return a cancelQueued receipt, and a reply that errors.
  for (const ending of ['stop-no-receipt', 'error']) {
    const state = await tmpState();
    const { queryFn } = sdkLikeSession(async function* ({ next, isInterrupted }) {
      yield init('s-steer-6');
      await next();
      if (ending === 'error') throw new Error('Claude Code exited');
      while (!isInterrupted()) await sleep(5);
      yield { type: 'result', subtype: 'error_during_execution', is_error: true, result: '', total_cost_usd: 0.1, permission_denials: [] };
    });
    const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent' });
    driver.idleGraceMs = 30;
    const run = await driver.start({ featureDir: '/f/g', slug: 'g', title: 'G', cwd: '/repo', text: 'go' });
    await until(driver, run.id, ['running']);
    const s = await driver.steer(run.id, 'Also this.');
    await steerReaches(driver, s.id, 'delivered');
    if (ending !== 'error') await driver.stop(run.id);
    const ended = await until(driver, run.id, ['stopped', 'error', 'done']);
    assert.equal(ended.steers[0].state, 'unanswered', ending);
  }
});

test('driver: a steered message is handed over without waiting for the audit write', async () => {
  const state = await tmpState();
  let release;
  const held = new Promise((r) => { release = r; });
  const audit = state.audit.bind(state);
  state.audit = async (entry) => { if (entry.action === 'steer') await held; return audit(entry); };
  const { queryFn } = sdkLikeSession(async function* ({ next }) {
    yield init('s-steer-7');
    const m = await next();
    if (!m) return;
    yield say(`Got: ${m.message.content}`);
    yield done('ok');
    yield idle;
  });
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent' });
  driver.idleGraceMs = 30;
  const run = await driver.start({ featureDir: '/f/h', slug: 'h', title: 'H', cwd: '/repo', text: 'go' });
  await until(driver, run.id, ['running']);
  const steering = driver.steer(run.id, 'Quick one.');
  const id = driver.runs.get(run.id).steers[0].id;
  await steerReaches(driver, id, 'delivered'); // while the audit write is still held
  release();
  assert.notEqual((await steering).state, 'cancelled');
  await until(driver, run.id, ['done', 'error']);
});

test('demo Foreman: steering works in demo mode (the pretend Foreman answers it at its next step)', async () => {
  const featuresDir = await tmp('workshop-steer-features-');
  const state = await tmpState();
  const driver = new Driver({ queryFn: makeFakeQuery({ featuresDir }), state, projectsDir: '/nonexistent', policy: async () => ({ auto: true, reason: 'Routine.' }) });
  driver.idleGraceMs = 30;
  const texts = [];
  driver.on('run', (r) => { if (r.lastText) texts.push(r.lastText); });
  const run = await driver.start({ featureDir: '/f/demo', slug: 'demo', title: 'Demo', cwd: '/repo', text: 'go' });
  await until(driver, run.id, ['running']);
  const s = await driver.steer(run.id, 'Skip the slow tests this time.');
  await steerReaches(driver, s.id, 'delivered');
  await steerReaches(driver, s.id, 'acted-on');
  assert.ok(texts.some((t) => t.startsWith('Noted: “Skip the slow tests this time.”')), texts.join(' | '));
  const ended = await until(driver, run.id, ['done', 'error']);
  assert.equal(ended.status, 'done', ended.error);
});

test('thread: a steered message shows as your message, carrying its steer id', () => {
  const thread = buildThread({ audit: [{ at: '2026-10-15T10:00:00Z', action: 'steer', featureDir: '/f/x', slug: 'x', runId: 'r1', steerId: 'st-1', text: 'Use the smaller table.' }] });
  assert.equal(thread.length, 1);
  assert.equal(thread[0].kind, 'you');
  assert.equal(thread[0].sendKind, 'steer');
  assert.equal(thread[0].steerId, 'st-1');
  assert.equal(thread[0].runId, 'r1');
  assert.equal(thread[0].text, 'Use the smaller table.');
});

// ---------- the route, through the real dashboard in demo mode ----------

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
let root, child, base, token;
const output = [];

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

before(async () => {
  root = await fs.realpath(await tmp('fw-steer-server-'));
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
  const port = await freePort();
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

const write = async (p, body = {}, { auth = true } = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Workshop-Token': token } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const get = async (p) => (await fetch(base + p)).json();

async function waitFor(fn, what, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.\n${output.join('')}`);
    await sleep(100);
  }
}

// Collects v2 events from `since` until `match` is true for one (or gives up after 10 seconds).
function collectEvents(since, epoch, match) {
  return new Promise((resolve, reject) => {
    const seen = [];
    const req = http.get(`${base}/api/events?v=2&since=${since}&epoch=${epoch}`, (res) => {
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
          if (match(event)) { clearTimeout(timer); req.destroy(); resolve(seen); }
        }
      });
    });
    req.on('error', () => {});
    const timer = setTimeout(() => { req.destroy(); reject(new Error(`No matching event. Saw: ${JSON.stringify(seen.map((e) => [e.type, e.data?.state]))}`)); }, 10000);
  });
}

test('server: POST /api/runs/:id/steer adds to a reply in progress; its states arrive over the v2 stream', async () => {
  assert.equal((await write('/api/runs/no-such-run/steer', { text: 'hi' })).status, 404);
  assert.equal((await write('/api/runs/no-such-run/steer', { text: '   ' })).status, 400);

  const snap = await get('/api/snapshot');
  const sent = await write('/api/job/sample-job/send', { text: 'Carry on, please.' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const runId = sent.body.run.id;
  assert.equal((await write(`/api/runs/${runId}/steer`, { text: 'hi' }, { auth: false })).status, 403, 'writes need the page token');

  const events = collectEvents(snap.seq, snap.epoch, (e) => e.type === 'steer' && e.data.state === 'acted-on');
  const steered = await write(`/api/runs/${runId}/steer`, { text: 'Leave the README alone.' });
  assert.equal(steered.status, 200, JSON.stringify(steered.body));
  assert.ok(['queued', 'delivered'].includes(steered.body.steer.state), steered.body.steer.state);
  assert.equal(steered.body.steer.runId, runId);
  const seen = await events;
  const mine = seen.filter((e) => e.type === 'steer' && e.data.id === steered.body.steer.id);
  assert.deepEqual(mine.map((e) => e.data.state), ['queued', 'delivered', 'acted-on']);
  assert.ok(mine.every((e) => e.job === 'sample-job'), 'tagged with the job');

  // The conversation shows it as your message, with its steer id.
  const you = await waitFor(async () => (await get('/api/job/sample-job')).thread.find((t) => t.kind === 'you' && t.steerId === steered.body.steer.id), 'the steered message in the thread');
  assert.equal(you.text, 'Leave the README alone.');
  assert.equal(you.sendKind, 'steer');

  // Answer the pretend Foreman's card so the reply can finish; then there is nothing to steer.
  const card = await waitFor(async () => (await get('/api/snapshot')).permissions.find((p) => p.slug === 'sample-job'), 'the permission card');
  assert.equal((await write(`/api/permissions/${card.id}`, { decision: 'allow' })).status, 200);
  await waitFor(async () => !(await get('/api/runs')).runs.some((r) => r.id === runId && ['starting', 'running', 'waiting_permission', 'stopping'].includes(r.status)), 'the reply to end');
  const late = await write(`/api/runs/${runId}/steer`, { text: 'One more thing.' });
  assert.equal(late.status, 404);
  assert.equal(late.body.code, 'finished');
  const run = (await get('/api/runs')).runs.find((r) => r.id === runId);
  assert.equal(run.steers[0].state, 'acted-on');
});
