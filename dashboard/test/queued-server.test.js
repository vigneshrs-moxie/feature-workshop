// A message waits for the Foreman instead of being refused (the job page rebuild, Task 16; design brief
// R8): POST /api/job/:slug/send with `queue: true` while a reply runs keeps one message for the job
// (202) and sends it when the reply ends, once; a second one replaces it only with `replace: true`;
// it survives a restart; cancel removes it; the usage limit and the terminal's lock still refuse when
// it is time to send, and the payload's `waiting` says why; Auto never queues. A real runner and site
// on temp folders; the Foreman is a stub that holds each reply until the test lets it end. No model,
// nothing leaves the computer, never ~/.starbase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRunner } from '../runner/index.js';
import { createSite } from '../site/index.js';
import { YOURS_NOW, autoRecord } from '../lib/auto.js';
import { OPUS } from '../lib/options.js';
import { WAITING_FILE } from '../lib/queued.js';
import { LOCAL_COMMANDS, REMOTE_COMMANDS } from '../lib/protocol.js';

const DASH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD = '2026-10-01T10:00:00Z';
const SLUG = 'visit-audit';
const ACTIVE = new Set(['starting', 'running', 'waiting_permission', 'stopping']);

/** A Foreman that holds each reply until `ends` lets it go (or it is stopped); `texts` collects what it was sent. */
function heldQuery(texts, ends) {
  return ({ prompt, options }) => {
    const sid = options.resume ?? crypto.randomUUID();
    let stop = () => {};
    const stopped = new Promise((r) => { stop = r; });
    const gen = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: sid, model: options.model ?? OPUS, apiKeySource: 'none', cwd: options.cwd, permissionMode: 'default' };
      const it = prompt[Symbol.asyncIterator]();
      const first = await it.next();
      texts.push(String(first.value?.message?.content ?? ''));
      let mine = null;
      await Promise.race([new Promise((r) => { mine = r; ends.push(r); }), stopped]);
      const at = ends.indexOf(mine);
      if (at >= 0) ends.splice(at, 1); // stopped: its turn in the list goes too
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0, session_id: sid, permission_denials: [] };
      yield { type: 'system', subtype: 'session_state_changed', state: 'idle', session_id: sid };
      while (!(await it.next()).done) { /* until the dashboard closes its input */ }
    })();
    gen.interrupt = async () => { stop(); };
    gen.setPermissionMode = async () => {};
    return gen;
  };
}

const gateStatus = () => ({
  schema_version: 1, slug: SLUG, title: 'Visit audit columns', route: 'small', stage: 'plan', stage_state: 'waiting_for_you', waiting_for: 'approval',
  waiting_since: OLD, brief: { number: 1, path: 'briefs/001-plan.md', headline: 'Visit audit · plan v1 ready' },
  questions: [{ id: '1', text: 'Question 1?', recommendation: 'a', options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] }],
  decided_on_your_behalf: [], next_proposed: 'Build step 1', artifacts: [{ name: 'implementation-plan', path: 'implementation-plan.md', version: 1 }],
  suggested_level: 1, level_reason: 'Small.', updated_at: OLD,
});

/** The same job working (no go-ahead waits): a waiting message goes when the reply ends. */
const workingStatus = () => {
  const { waiting_for: _w, waiting_since: _s, ...rest } = gateStatus();
  return { ...rest, stage_state: 'working' };
};

/**
 * A started job (a Foreman session saved) on temp folders, a runner and a site; `auto`: the job is in Auto; `gate`:
 * it waits at a go-ahead (else it is working).
 */
async function world({ auto = false, gate = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sb-queued-srv-')));
  const dirs = Object.fromEntries(['claude', 'features', 'projects', 'agents', 'skills', 'state', 'repo'].map((n) => [n, path.join(root, n)]));
  for (const d of Object.values(dirs)) await fs.mkdir(d, { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', dirs.repo, '-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  await fs.writeFile(path.join(dirs.repo, 'README.md'), 'hi\n');
  git('add', '.'); git('commit', '-q', '-m', 'base');
  const dir = path.join(dirs.features, SLUG);
  await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify(gate ? gateStatus() : workingStatus(), null, 2));
  await fs.writeFile(path.join(dir, 'briefs', '001-plan.md'), '**Visit audit · plan v1 ready**\n');
  await fs.writeFile(path.join(dir, 'options.json'), JSON.stringify({ schema_version: 2, level: 1, flow: 'quick', title: 'Visit audit columns' }, null, 2));
  await fs.writeFile(path.join(dirs.state, 'sessions.json'), JSON.stringify({
    [dir]: { sessionId: crypto.randomUUID(), cwd: dirs.repo, repoPath: dirs.repo, model: OPUS, ...(auto ? { auto: autoRecord(null, { on: true, now: OLD }) } : {}) },
  }));
  const texts = [];
  const ends = [];
  const asks = [];
  let hooks = {};
  let runner = null;
  let server = null;
  let base = null;
  const boot = async () => {
    runner = await createRunner({
      testHooks: (hooks = {}),
      host: '127.0.0.1', port: 1, token: 't', dashboardDir: DASH, claudeDir: dirs.claude, featuresDir: dirs.features, projectsDir: dirs.projects,
      agentsDir: dirs.agents, skillsDir: dirs.skills, stateDir: dirs.state, demo: true, claudePath: null,
      claudeSettingsFile: path.join(root, 'claude.json'), legacySettingsFile: null, planUsage: false, orbitStore: 'file',
      integrateDir: dirs.state, integrateRoot: path.join(DASH, '..'), siteLink: false, env: {},
      queryFn: heldQuery(texts, ends),
      askApprover: async (task) => { asks.push(task); return { ok: true, costUsd: 0.1, answer: { decision: 'go', answers: task.questions.map((q) => ({ id: q.id, choice: q.recommendation, other: null, reason: 'The recommendation.' })), why: 'Fine.', risk: 'low' } }; },
    });
    let handler = null;
    server = http.createServer((req, res) => handler(req, res));
    await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
    const port = server.address().port;
    handler = createSite({ runner, port, token: 't', wireframesOrigin: 'http://127.0.0.1:1', dashboardDir: DASH });
    base = `http://127.0.0.1:${port}`;
  };
  const close = async () => {
    if (server) await new Promise((r) => { server.close(r); server.closeAllConnections?.(); });
    server = null;
    await runner?.stop();
  };
  await boot();
  const until = async (fn, what) => {
    for (let i = 0; i < 300; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
    throw new Error(`Timed out waiting for ${what}`);
  };
  const post = async (p, body) => {
    const res = await fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Starbase-Token': 't' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const runs = async () => (await runner.read.runs()).runs;
  const working = async () => (await runs()).some((r) => ACTIVE.has(r.status));
  const page = () => runner.read.jobPage(SLUG);
  return {
    root, dirs, dir, texts, asks, get hooks() { return hooks; }, get runner() { return runner; }, until, post, page, runs,
    /** Start a reply and wait until the Foreman has it (held until end()). */
    async busy(text = 'Start working') {
      const n = ends.length;
      const r = await post(`/api/job/${SLUG}/send`, { kind: 'message', text });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      await until(() => ends.length > n, 'the Foreman to have the message');
    },
    /** A reply of Starbase's own (a resume, not a message of his), held until end(). */
    async busyOwn() {
      const n = ends.length;
      const sess = JSON.parse(await fs.readFile(path.join(dirs.state, 'sessions.json'), 'utf8'))[dir];
      await hooks.driver.start({ featureDir: dir, slug: SLUG, title: 'Visit audit columns', cwd: dirs.repo, sessionId: sess.sessionId, model: OPUS, text: 'Carry on.', kind: 'resume' });
      await until(() => ends.length > n, 'the Foreman to have it');
    },
    /** Stop the reply going: plainly, or as Stop it and send now (then: 'send-waiting'). */
    async stopReply(body = {}) {
      const run = (await runs()).find((r) => ACTIVE.has(r.status));
      return post(`/api/runs/${run.id}/stop`, body);
    },
    /** Let the oldest held reply end. */
    end() { ends.shift()?.(); },
    idle: () => until(async () => !(await working()), 'the reply to end'),
    /** The waiting file in the state folder. */
    async file() { return JSON.parse(await fs.readFile(path.join(dirs.state, WAITING_FILE), 'utf8').catch(() => '{}')); },
    async restart() { await close(); await boot(); },
    async stop() {
      while (ends.length) ends.shift()();
      await close();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

const sentTexts = (w, words) => w.texts.filter((t) => t.includes(words));

test('W1: queue while the Foreman works keeps one message (202) and the payload shows it with a new v', { timeout: 60_000 }, async () => {
  const w = await world();
  try {
    await w.busy();
    const before = await w.page();
    assert.equal(before.waiting, null);
    const r = await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'Also the header.', queue: true });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(r.body.waiting.text, 'Also the header.');
    assert.equal(r.body.waiting.why, null);
    assert.ok(Date.parse(r.body.waiting.at));
    const after = await w.until(async () => { const p = await w.page(); return p.waiting ? p : null; }, 'the payload to show it');
    assert.deepEqual(after.waiting, r.body.waiting);
    assert.ok(after.v > before.v, 'the payload’s v moved');
    assert.equal(sentTexts(w, 'Also the header.').length, 0, 'nothing sent yet');
    assert.equal((await w.file())[w.dir].text, 'Also the header.', 'kept in the state folder');
  } finally { await w.stop(); }
});

test('W2: it goes when the reply ends, once', { timeout: 60_000 }, async () => {
  const w = await world();
  try {
    await w.busy();
    assert.equal((await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'Then the footer.', queue: true })).status, 202);
    w.end();
    await w.until(() => sentTexts(w, 'Then the footer.').length === 1, 'the waiting message to go');
    await w.until(async () => (await w.page()).waiting === null, 'the payload to drop it');
    assert.deepEqual(await w.file(), {});
    w.end();
    await w.idle();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(sentTexts(w, 'Then the footer.').length, 1, 'once');
  } finally { await w.stop(); }
});

test('W3: a second message is refused (409) naming the first, unless it replaces it', { timeout: 60_000 }, async () => {
  const w = await world();
  try {
    await w.busy();
    await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'First words.', queue: true });
    const no = await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'Second words.', queue: true });
    assert.equal(no.status, 409);
    assert.equal(no.body.code, 'waiting');
    assert.equal(no.body.waiting.text, 'First words.');
    assert.match(no.body.error, /First words\./);
    const yes = await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'Second words.', queue: true, replace: true });
    assert.equal(yes.status, 202);
    assert.equal((await w.page()).waiting.text, 'Second words.');
    w.end();
    await w.until(() => sentTexts(w, 'Second words.').length === 1, 'the second to go');
    assert.equal(sentTexts(w, 'First words.').length, 0, 'the first never goes');
  } finally { await w.stop(); }
});

test('W4: it survives a Starbase restart and goes at the next chance', { timeout: 60_000 }, async () => {
  const w = await world();
  try {
    await w.busy();
    await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'Over the restart.', queue: true });
    await w.restart();
    const p = await w.page();
    assert.equal(p.waiting?.text, 'Over the restart.');
    assert.equal(sentTexts(w, 'Over the restart.').length, 0);
    await w.hooks.flushWaiting(); // what start() does once the restart's own carry-on is settled
    await w.until(() => sentTexts(w, 'Over the restart.').length === 1, 'it to go after the restart');
    await w.until(async () => (await w.page()).waiting === null, 'the payload to drop it');
  } finally { await w.stop(); }
});

test('W5: cancel removes it; nothing goes when the reply ends', { timeout: 60_000 }, async () => {
  const w = await world();
  try {
    await w.busy();
    await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'Never mind this.', queue: true });
    const c = await w.post(`/api/job/${SLUG}/waiting/cancel`, {});
    assert.equal(c.status, 200);
    assert.equal(c.body.cancelled, true);
    assert.equal(c.body.text, 'Never mind this.');
    assert.equal((await w.page()).waiting, null);
    assert.deepEqual(await w.file(), {});
    assert.equal((await w.post(`/api/job/${SLUG}/waiting/cancel`, {})).body.cancelled, false, 'nothing left');
    w.end();
    await w.idle();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(sentTexts(w, 'Never mind this.').length, 0);
  } finally { await w.stop(); }
});

test('W6: the usage limit still refuses when it is time to send: it stays, and waiting says why', { timeout: 60_000 }, async () => {
  const w = await world();
  try {
    await w.busy();
    await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'After the limit.', queue: true });
    // Claude's limit: Starbase pauses the reply that is going (the reply ends), then the waiting message's checks run.
    w.hooks.driver.emit('usage-limit', { run: null, info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: Math.floor(Date.now() / 1000) + 3600 } });
    const p = await w.until(async () => { const x = await w.page(); return x.waiting?.why ? x : null; }, 'waiting to say why');
    assert.equal(p.waiting.text, 'After the limit.');
    assert.match(p.waiting.why, /limit is reached/);
    assert.equal(sentTexts(w, 'After the limit.').length, 0, 'nothing sent');
    assert.equal((await w.file())[w.dir].why, p.waiting.why);
  } finally { await w.stop(); }
});

test('W7: the terminal’s lock still refuses when it is time to send: it stays, and waiting says why', { timeout: 60_000 }, async () => {
  const w = await world();
  try {
    await w.busy();
    await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'After the terminal.', queue: true });
    // A terminal takes the job while the reply runs (a live process: this test's parent).
    await fs.writeFile(path.join(w.dir, 'lock.json'), JSON.stringify({ owner: 'terminal', pid: process.ppid, branch: null, acquiredAt: new Date().toISOString() }));
    w.end();
    const p = await w.until(async () => { const x = await w.page(); return x.waiting?.why ? x : null; }, 'waiting to say why');
    assert.match(p.waiting.why, /open in a terminal/);
    assert.equal(sentTexts(w, 'After the terminal.').length, 0, 'nothing sent');
    // The terminal lets go: the job's folder changes, and it goes then.
    await fs.rm(path.join(w.dir, 'lock.json'), { force: true });
    w.hooks.featuresWatch('rename', path.join(SLUG, 'lock.json')); // what the jobs folder's watch hears (start() opens it)
    await w.until(() => sentTexts(w, 'After the terminal.').length === 1, 'it to go once the lock is free');
    await w.until(async () => (await w.page()).waiting === null, 'the payload to drop it');
  } finally { await w.stop(); }
});

test('W8: Auto never queues: its answer while the Foreman works is refused, nothing waits; and it never answers ahead of his message that can still go', { timeout: 60_000 }, async () => {
  const w = await world({ auto: true, gate: true });
  try {
    await w.busy();
    await assert.rejects(w.hooks.decideGate('approve', { slug: SLUG, briefNumber: 1, answers: { 1: { choice: 'a' } }, note: 'Auto: go' }, { by: 'auto' }), (err) => err.status === 409);
    assert.equal((await w.page()).waiting, null);
    assert.deepEqual(await w.file(), {});
    // His message waits; Starbase restarts before it goes: until it goes, Auto's answer is "not now".
    await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'Mine first.', queue: true });
    await w.restart();
    await assert.rejects(w.hooks.decideGate('approve', { slug: SLUG, briefNumber: 1, answers: { 1: { choice: 'a' } }, note: 'Auto: go' }, { by: 'auto' }), (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.extra.code, 'busy');
      assert.match(err.message, /Your message waiting for the Foreman goes first/);
      return true;
    });
    assert.equal(sentTexts(w, 'Auto: go').length, 0);
  } finally { await w.stop(); }
});

test('W9: queue when nothing runs sends at once (200, a run); queueing and cancelling are this computer’s only', { timeout: 60_000 }, async () => {
  const w = await world();
  try {
    const r = await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'Nothing is running.', queue: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.run?.id);
    await w.until(() => sentTexts(w, 'Nothing is running.').length === 1, 'it to go now');
    assert.equal((await w.page()).waiting, null);
    assert.ok(Object.hasOwn(LOCAL_COMMANDS, 'queue-message') && Object.hasOwn(LOCAL_COMMANDS, 'cancel-waiting'));
    assert.equal(Object.hasOwn(REMOTE_COMMANDS, 'queue-message'), false, 'the website never queues on the laptop');
  } finally { await w.stop(); }
});

// ---------- Fix round 1 ----------

test('F1 (I1, I2): Stop it and send now (then: send-waiting) stops the reply, and the message goes once', { timeout: 60_000 }, async () => {
  const w = await world();
  try {
    await w.busy();
    await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'Stop and use this.', queue: true });
    const r = await w.stopReply({ then: 'send-waiting' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await w.until(() => sentTexts(w, 'Stop and use this.').length === 1, 'the message to go after the stop');
    await w.until(async () => (await w.page()).waiting === null, 'the payload to drop it');
    w.end();
    await w.idle();
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(sentTexts(w, 'Stop and use this.').length, 1, 'once');
  } finally { await w.stop(); }
});

test('F2 (I1, I2): a plain stop keeps the message, says so, and nothing sends it but his Send', { timeout: 60_000 }, async () => {
  const w = await world();
  try {
    await w.busy();
    await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'Not yet.', queue: true });
    assert.equal((await w.stopReply()).status, 200);
    const p = await w.until(async () => { const x = await w.page(); return x.waiting?.why ? x : null; }, 'the message to be kept');
    assert.equal(p.waiting.why, 'Kept: you stopped the reply. Press Send to send it.');
    assert.equal(p.waiting.text, 'Not yet.');
    await w.hooks.flushWaiting(); // start()'s look, as after a restart
    await w.restart();
    await w.hooks.flushWaiting();
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(sentTexts(w, 'Not yet.').length, 0, 'kept over a restart, never sent by itself');
    assert.equal((await w.page()).waiting.why, 'Kept: you stopped the reply. Press Send to send it.');
    const s = await w.post(`/api/job/${SLUG}/waiting/send`, {});
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.body.waiting, null);
    await w.until(() => sentTexts(w, 'Not yet.').length === 1, 'his Send to send it');
  } finally { await w.stop(); }
});

test('F3 (M4): a reply that ends at a go-ahead never sends the message: it is marked for the box; Auto’s rules run as usual', { timeout: 60_000 }, async () => {
  const w = await world({ auto: true, gate: true });
  try {
    await w.busyOwn();
    await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'For the box.', queue: true });
    w.end();
    const p = await w.until(async () => { const x = await w.page(); return x.waiting?.toBox ? x : null; }, 'it to be marked for the box');
    assert.deepEqual(p.waiting, { text: 'For the box.', at: p.waiting.at, why: 'The Foreman is asking you something first.', toBox: true });
    assert.equal(sentTexts(w, 'For the box.').length, 0);
    // Auto is not held back by words on their way to the box: its pass answers the go-ahead as usual.
    await w.runner.auto.pass();
    await w.until(() => w.texts.some((t) => t.includes('Sent by Starbase')), 'Auto to answer the go-ahead');
    assert.equal(sentTexts(w, 'For the box.').length, 0, 'still never sent');
  } finally { await w.stop(); }
});

test('F4 (M1): a pause dropped after a restart (a terminal took the job) does not leave the message stuck: it says why', { timeout: 60_000 }, async () => {
  const w = await world();
  try {
    await w.busy();
    await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'After the restart.', queue: true });
    await w.restart();
    await w.hooks.replay(); // the clean stop paused the reply: it carries on first
    await w.hooks.flushWaiting();
    assert.equal((await w.page()).waiting.why, null, 'waits for the carry-on');
    // A terminal picks the job up before the carry-on: the pause is dropped without a reply.
    await fs.mkdir(path.join(w.dirs.state, 'hook-events'), { recursive: true });
    await fs.writeFile(path.join(w.dirs.state, 'hook-events', 'events.jsonl'), `${new Date().toISOString()}\t${JSON.stringify({ session_id: 'term-1', hook_event_name: 'UserPromptSubmit', cwd: w.dirs.repo, prompt: `carry on with feature-work/${SLUG}` })}\n`);
    await w.hooks.carryOn();
    const p = await w.until(async () => { const x = await w.page(); return x.waiting?.why ? x : null; }, 'the message to say why');
    assert.match(p.waiting.why, /terminal/);
    assert.equal(sentTexts(w, 'After the restart.').length, 0);
  } finally { await w.stop(); }
});

test('F5 (M1): a message that can’t go is his: Auto stops at the go-ahead as yours now, without asking the Approver', { timeout: 60_000 }, async () => {
  const w = await world({ auto: true, gate: true });
  try {
    await w.busyOwn();
    await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'Kept by the stop.', queue: true });
    await w.stopReply();
    await w.until(async () => (await w.page()).waiting?.why, 'the message to be kept');
    await w.runner.auto.pass();
    const rec = await w.until(async () => JSON.parse(await fs.readFile(path.join(w.dirs.state, 'sessions.json'), 'utf8'))[w.dir]?.auto?.stopped, 'Auto to stop');
    assert.equal(rec.reason, YOURS_NOW);
    assert.equal(w.asks.length, 0, 'the Approver was not asked');
  } finally { await w.stop(); }
});

// ---------- A message sent into the reply that the Foreman never read (the job page's Send while it works) ----------

/** Send words into the reply going (POST /api/runs/:id/steer). The stub Foreman never reads its input while it holds a reply. */
async function steerIn(w, text) {
  const run = (await w.runs()).find((r) => ACTIVE.has(r.status));
  const r = await w.post(`/api/runs/${run.id}/steer`, { text });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.steer.state, 'queued');
  return r.body.steer;
}

test('S1: a message sent into the reply that the Foreman never read goes as a new message when the reply ends, once', { timeout: 60_000 }, async () => {
  const w = await world();
  try {
    await w.busy();
    await steerIn(w, 'Use the short header.');
    assert.equal(sentTexts(w, 'Use the short header.').length, 0, 'not read yet');
    w.end();
    await w.until(() => sentTexts(w, 'Use the short header.').length === 1, 'the unread message to go as a new one');
    await w.until(async () => (await w.page()).waiting === null, 'the payload to drop it');
    assert.deepEqual(await w.file(), {});
    w.end();
    await w.idle();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(sentTexts(w, 'Use the short header.').length, 1, 'once');
  } finally { await w.stop(); }
});

test('S2: after a plain stop the unread message is kept for his Send, not sent and not lost', { timeout: 60_000 }, async () => {
  const w = await world();
  try {
    await w.busy();
    await steerIn(w, 'Drop the footer.');
    assert.equal((await w.stopReply()).status, 200);
    await w.idle();
    const p = await w.until(async () => { const x = await w.page(); return x.waiting?.why ? x : null; }, 'the payload to show it kept');
    assert.equal(p.waiting.text, 'Drop the footer.');
    assert.equal(p.waiting.why, 'Kept: you stopped the reply. Press Send to send it.');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(sentTexts(w, 'Drop the footer.').length, 0, 'not sent by itself');
    const s = await w.post(`/api/job/${SLUG}/waiting/send`, {});
    assert.equal(s.status, 200, JSON.stringify(s.body));
    await w.until(() => sentTexts(w, 'Drop the footer.').length === 1, 'his Send to send it');
  } finally { await w.stop(); }
});

test('S3: an unread message joins the one already waiting: one message, in the order he wrote them', { timeout: 60_000 }, async () => {
  const w = await world();
  try {
    await w.busy();
    assert.equal((await w.post(`/api/job/${SLUG}/send`, { kind: 'message', text: 'First words.', queue: true })).status, 202);
    await steerIn(w, 'Second words.');
    await steerIn(w, 'Third words.');
    w.end();
    const both = await w.until(() => w.texts.find((t) => t.includes('First words.') && t.includes('Second words.') && t.includes('Third words.')), 'all three to go as one message');
    assert.ok(both.indexOf('First words.') < both.indexOf('Second words.') && both.indexOf('Second words.') < both.indexOf('Third words.'), 'in his order');
    assert.equal(sentTexts(w, 'Second words.').length, 1, 'once');
  } finally { await w.stop(); }
});
