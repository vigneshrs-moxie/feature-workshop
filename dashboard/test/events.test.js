import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { EventLog, resumePoint, openStream, RING_SIZE } from '../lib/events.js';
import { groupFor, groupCards } from '../lib/snapshot.js';
import { buildThread, pageThread } from '../lib/thread.js';
import { Driver } from '../lib/driver.js';
import { State } from '../lib/state.js';

// ---------- the event log ----------

test('events: envelopes carry v, type, job, data and a rising seq', () => {
  const log = new EventLog({ epoch: 'abc' });
  const a = log.emit('run', 'widget', { id: 'r1' });
  const b = log.emit('usage', null, { limited: false });
  assert.deepEqual(a, { v: 2, type: 'run', job: 'widget', data: { id: 'r1' }, seq: 1 });
  assert.deepEqual(b, { v: 2, type: 'usage', job: null, data: { limited: false }, seq: 2 });
  assert.equal(log.seq, 2);
  assert.equal(log.id(), 'abc.2');
});

test('events: the ring keeps the last 500 and resumes from inside it', () => {
  assert.equal(RING_SIZE, 500);
  const log = new EventLog({ epoch: 'e1' });
  for (let i = 0; i < 520; i++) log.emit('change', null, { i });
  assert.equal(log.ring.length, 500);
  assert.equal(log.ring[0].seq, 21);
  assert.deepEqual(log.since(515).events.map((e) => e.seq), [516, 517, 518, 519, 520]);
  assert.deepEqual(log.since(520).events, []);
  assert.equal(log.since(20).events.length, 500, 'just at the edge: nothing missed');
  assert.deepEqual(log.since(19), { resync: 'too-far-behind' });
  assert.deepEqual(log.since(600), { resync: 'restarted' });
  assert.deepEqual(log.since(515, 'other'), { resync: 'restarted' });
  assert.deepEqual(log.since(515, 'e1').events.length, 5);
  assert.deepEqual(log.since(-1), { resync: 'unknown' });
  assert.deepEqual(new EventLog().since(0), { events: [] }, 'nothing yet, nothing missed');
});

test('events: live-only events reach open streams but are not kept for catching up', () => {
  const log = new EventLog({ epoch: 'e2', size: 5 });
  const got = [];
  log.subscribe((e) => got.push(e.seq));
  log.emit('run', 'widget', {});
  for (let i = 0; i < 50; i++) log.emit('local', 'widget', { chunk: i }, { replay: false });
  log.emit('thread', 'widget', {});
  assert.equal(got.length, 52, 'every event went out live');
  assert.equal(log.seq, 52);
  assert.deepEqual(log.ring.map((e) => e.type), ['run', 'thread']);
  // A page that saw only the first event isn't "too far behind": nothing it needs was pushed out.
  assert.deepEqual(log.since(1).events.map((e) => e.seq), [52]);
  assert.deepEqual(log.since(0).events.map((e) => e.seq), [1, 52]);
  const onlyLive = new EventLog({ epoch: 'e3' });
  onlyLive.emit('local', 'w', {}, { replay: false });
  onlyLive.emit('local', 'w', {}, { replay: false });
  assert.deepEqual(onlyLive.since(1), { events: [] });
});

test('events: Last-Event-ID wins over ?since=', () => {
  const q = (s) => new URLSearchParams(s);
  assert.equal(resumePoint({}, q('')), null);
  assert.deepEqual(resumePoint({}, q('since=7')), { since: 7, epoch: null });
  assert.deepEqual(resumePoint({}, q('since=7&epoch=ab12')), { since: 7, epoch: 'ab12' });
  assert.deepEqual(resumePoint({}, q('since=x')), { since: -1, epoch: null });
  assert.deepEqual(resumePoint({ 'last-event-id': 'ab12.42' }, q('since=7')), { since: 42, epoch: 'ab12' });
  assert.deepEqual(resumePoint({ 'last-event-id': 'nonsense' }, q('')), { since: -1, epoch: null });
});

// A real HTTP stream, read until `count` data frames have arrived.
async function readStream(log, { headers = {}, query = '', count, during = () => {} }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    openStream(req, res, { log, resume: resumePoint(req.headers, url.searchParams) });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { req.destroy(); reject(new Error(`stream gave ${frames.length} of ${count} frames`)); }, 2000);
      const frames = [];
      const req = http.get({ host: '127.0.0.1', port, path: `/api/events?v=2${query}`, headers }, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buf += chunk;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const id = /^id: (.*)$/m.exec(block)?.[1] ?? null;
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (data) frames.push({ id, event: JSON.parse(data) });
            if (frames.length === count) { clearTimeout(timer); req.destroy(); resolve({ frames, type: res.headers['content-type'] }); }
          }
        });
        setTimeout(during, 30);
      });
      req.on('error', (err) => { if (err.code !== 'ECONNRESET') reject(err); });
    });
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}

test('events: a reconnecting page gets what it missed, then live events', async () => {
  const log = new EventLog({ epoch: 'e0' });
  log.emit('run', 'a', { n: 1 });
  log.emit('thread', 'a', { why: 'send' });
  log.emit('usage', null, {});
  const { frames, type } = await readStream(log, { headers: { 'Last-Event-ID': 'e0.1' }, count: 3, during: () => log.emit('permission-gone', 'b', { id: 'p1' }) });
  assert.equal(type, 'text/event-stream');
  assert.deepEqual(frames.map((f) => f.id), ['e0.2', 'e0.3', 'e0.4']);
  assert.deepEqual(frames.map((f) => f.event.type), ['thread', 'usage', 'permission-gone']);
  assert.equal(frames[2].event.job, 'b');
  for (let i = 0; i < 50 && log.subscribers.size; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(log.subscribers.size, 0, 'the stream unsubscribes when the page goes');
});

test('events: a page from an earlier dashboard run is told to resync', async () => {
  const log = new EventLog({ epoch: 'beef' });
  log.emit('run', 'a', {});
  const { frames } = await readStream(log, { query: '&since=1&epoch=dead', count: 1 });
  assert.equal(frames[0].event.type, 'resync');
  assert.equal(frames[0].event.data.reason, 'restarted');
  assert.equal(frames[0].id, 'beef.1', 'its next reconnect carries on from now');
  assert.equal(log.ring.length, 1, 'resync is not stored for others');
});

// ---------- snapshot groups ----------

test('snapshot: each job lands in one group', () => {
  assert.equal(groupFor({ permissions: 1, working: true }), 'needs-you');
  assert.equal(groupFor({ working: true }), 'running');
  assert.equal(groupFor({ starting: true }), 'running');
  assert.equal(groupFor({ limitPaused: '2026-10-15T20:00:00Z', paused: true, stageState: 'paused' }), 'paused');
  assert.equal(groupFor({ limitPaused: '2026-10-15T20:00:00Z', needsYou: true }), 'paused', 'a limit pause outranks an open brief');
  assert.equal(groupFor({ paused: true, stageState: 'paused' }), 'idle', 'stopped by you: waits for your next message');
  assert.equal(groupFor({ needsYou: true, stageState: 'waiting' }), 'needs-you');
  assert.equal(groupFor({ stageState: 'done' }), 'done');
  assert.equal(groupFor({ closed: { as: 'dropped' }, stageState: 'idle' }), 'done');
  assert.equal(groupFor({ stageState: 'idle' }), 'idle');
  assert.equal(groupFor({ stageState: 'working', working: false }), 'idle');
});

test('snapshot: cards are ordered by group, keeping their order inside one', () => {
  const out = groupCards([
    { slug: 'd', stageState: 'done' },
    { slug: 'i1', stageState: 'idle' },
    { slug: 'r', working: true },
    { slug: 'n', needsYou: true },
    { slug: 'i2', stageState: 'idle' },
    { slug: 'p', limitPaused: 'x' },
  ]);
  assert.deepEqual(out.map((c) => `${c.slug}:${c.group}`), ['n:needs-you', 'r:running', 'p:paused', 'i1:idle', 'i2:idle', 'd:done']);
});

// ---------- thread ids and load older ----------

const auditLines = (n, from = 0) => Array.from({ length: n }, (_, i) => ({
  at: new Date(Date.UTC(2026, 9, 15, 10, 0, from + i)).toISOString(), action: 'send', featureDir: '/f/x', slug: 'x', kind: 'message', text: `message ${from + i}`,
}));

test('thread: ids stay the same as the job grows', () => {
  const audit = [
    ...auditLines(2),
    { at: '2026-10-15T10:01:00.000Z', action: 'auto-allowed', runId: 'r1', headline: 'Read a file', reason: 'routine' },
    { at: '2026-10-15T10:01:01.000Z', action: 'auto-allowed', runId: 'r1', headline: 'Read another', reason: 'routine' },
    { at: '2026-10-15T10:02:00.000Z', action: 'run-ended', runId: 'r1', status: 'done', reply: '**Done**' },
  ];
  const briefs = [{ number: 1, stage: 'spec', file: 'briefs/01-spec.md', at: '2026-10-15T09:00:00.000Z', headline: 'Spec ready' }];
  const first = buildThread({ briefs, audit });
  assert.deepEqual(first.map((t) => t.kind), ['brief', 'you', 'you', 'auto', 'reply']);
  assert.equal(first[0].id, 'brief:briefs/01-spec.md');
  assert.match(first[1].id, /^you:[0-9a-f]{12}$/);
  assert.equal(first[4].reply, '**Done**');
  assert.equal(new Set(first.map((t) => t.id)).size, first.length);
  const later = buildThread({ briefs, audit: [...audit, { at: '2026-10-15T10:03:00.000Z', action: 'permission', decision: 'allow', headline: 'Run tests' }] });
  assert.deepEqual(later.slice(0, 5).map((t) => t.id), first.map((t) => t.id));
  assert.equal(later[5].kind, 'decision');
});

test('thread: identical lines still get different ids', () => {
  const line = auditLines(1)[0];
  const t = buildThread({ audit: [line, { ...line }] });
  assert.equal(t.length, 2);
  assert.notEqual(t[0].id, t[1].id);
  assert.equal(t[1].id, `${t[0].id}~2`);
});

test('thread: pages of 60, then older ones before an id', () => {
  const thread = buildThread({ audit: auditLines(130) });
  const newest = pageThread(thread);
  assert.equal(newest.items.length, 60);
  assert.equal(newest.items.at(-1).text, 'message 129');
  assert.equal(newest.more, true);
  const older = pageThread(thread, { before: newest.items[0].id });
  assert.equal(older.items.length, 60);
  assert.equal(older.items.at(-1).text, 'message 69');
  assert.equal(older.more, true);
  const oldest = pageThread(thread, { before: older.items[0].id });
  assert.deepEqual(oldest.items.map((t) => t.text), ['message 0', 'message 1', 'message 2', 'message 3', 'message 4', 'message 5', 'message 6', 'message 7', 'message 8', 'message 9']);
  assert.equal(oldest.more, false);
  assert.equal(pageThread(thread, { before: 'you:000000000000' }), null);
  assert.equal(pageThread(buildThread({ audit: auditLines(3) })).more, false);
});

// ---------- the audit log tells listeners ----------

test('state: each audit line is announced after it is written', async () => {
  const state = new State(await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-state-')));
  const seen = [];
  state.on('audit', (e) => seen.push(e));
  await state.audit({ action: 'send', featureDir: '/f/x', slug: 'x', text: 'hi' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].slug, 'x');
  assert.ok(seen[0].at);
  assert.equal((await state.auditFor('/f/x', Infinity)).length, 1);
});

// ---------- permission-gone when a stop or the end of a reply says no ----------

function fakeSession(script) {
  return ({ prompt, options }) => {
    let interrupted = false;
    const gen = (async function* () {
      await prompt[Symbol.asyncIterator]().next();
      yield* script({ options, isInterrupted: () => interrupted });
    })();
    gen.interrupt = async () => { interrupted = true; };
    return gen;
  };
}
const until = (driver, runId, statuses) => new Promise((resolve) => {
  const on = (r) => { if (r.id === runId && statuses.includes(r.status)) { driver.off('run', on); resolve(r); } };
  driver.on('run', on);
});
const tmpState = async () => new State(await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-state-')));

test('driver: Stop takes open cards away (permission-gone)', async () => {
  const state = await tmpState();
  let answer = null;
  const queryFn = fakeSession(async function* ({ options, isInterrupted }) {
    yield { type: 'system', subtype: 'init', session_id: 's-g1' };
    answer = await options.canUseTool('Bash', { command: 'npm test' }, { signal: new AbortController().signal });
    while (!isInterrupted()) await new Promise((r) => setTimeout(r, 10));
    yield { type: 'result', subtype: 'error_during_execution', is_error: true, result: '', permission_denials: [] };
  });
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent' });
  driver.idleGraceMs = 30;
  const gone = [];
  driver.on('permission-gone', (p) => gone.push(p));
  const asked = new Promise((r) => driver.once('permission', r));
  const run = await driver.start({ featureDir: '/f/g', slug: 'g', title: 'G', cwd: '/repo', text: 'go' });
  const p = await asked;
  assert.equal(await driver.stop(run.id), true);
  await until(driver, run.id, ['stopped', 'error', 'done']);
  assert.deepEqual(gone, [{ id: p.id, slug: 'g', reason: 'stopped' }]);
  assert.equal(answer.behavior, 'deny');
  assert.equal(driver.pendingPermissions().length, 0);
});

test('driver: a reply that ends with a card open takes it away too', async () => {
  const state = await tmpState();
  const queryFn = fakeSession(async function* ({ options }) {
    yield { type: 'system', subtype: 'init', session_id: 's-g2' };
    // The session asks, then ends without waiting for the answer (for example it crashed).
    options.canUseTool('Write', { file_path: '/repo/x', content: 'y' }, { signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 20));
    throw new Error('the session ended');
  });
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent' });
  const gone = [];
  driver.on('permission-gone', (p) => gone.push(p));
  const asked = new Promise((r) => driver.once('permission', r));
  const run = await driver.start({ featureDir: '/f/h', slug: 'h', title: 'H', cwd: '/repo', text: 'go' });
  const p = await asked;
  await until(driver, run.id, ['error', 'stopped', 'done']);
  assert.deepEqual(gone, [{ id: p.id, slug: 'h', reason: 'run-ended' }]);
});

test('driver: an answered card is gone once, even if its request is cancelled later', async () => {
  const state = await tmpState();
  const abort = new AbortController();
  const queryFn = fakeSession(async function* ({ options }) {
    yield { type: 'system', subtype: 'init', session_id: 's-g3' };
    await options.canUseTool('Bash', { command: 'ls' }, { signal: abort.signal });
    abort.abort();
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', permission_denials: [] };
  });
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent' });
  driver.idleGraceMs = 30;
  const gone = [];
  driver.on('permission-gone', (p) => gone.push(p));
  driver.on('permission', (p) => setTimeout(() => driver.decide(p.id, { decision: 'allow' }), 5));
  const run = await driver.start({ featureDir: '/f/k', slug: 'k', title: 'K', cwd: '/repo', text: 'go' });
  await until(driver, run.id, ['done', 'error']);
  assert.equal(gone.length, 1);
  assert.equal(gone[0].reason, 'answered');
  assert.equal(gone[0].slug, 'k');
});
