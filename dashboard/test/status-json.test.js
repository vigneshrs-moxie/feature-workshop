// The status.json check in the driver (lib/driver.js, plan D11): every write the Foreman makes
// during a reply is validated (lib/status-json.js); an invalid one is an audit line and one
// corrective message into the same session; after three, a Needs you card. Pretend sessions only:
// no Claude, no usage, no real job folder (temp folders).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Driver, STATUS_RETRIES, STATUS_TRY_AGAIN, STATUS_LEAVE, STATUS_CARD_HEADLINE, statusFixMessage, watchStatusFile } from '../lib/driver.js';
import { State } from '../lib/state.js';
import { validate } from '../lib/status-json.js';
import { defaultsForLevel, writeOptions, normalizeTicket, ticketKeyOf, ticketSlug, ticketBranch, shortTitle, startFromTicket, TICKET_KEY_PROBLEM } from '../lib/options.js';
import { makeFakeQuery } from '../demo/fake-query.js';
import { startDashboard } from './helpers/dashboard.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (check, ms = 3000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await sleep(5);
  }
};

const GOOD = (n = 0) => ({ schema_version: 1, slug: 'job', title: 'Job', route: 'small', stage: 'plan', stage_state: 'working', updated_at: `2026-10-28T10:00:0${n}Z` });
const BAD = (n = 0) => ({ ...GOOD(n), stage_state: 'in_progress', brief: { number: 'two' } });
const BAD_ERRORS = validate(BAD()).errors;

/**
 * A driver with a pretend session and a watcher the test fires by hand (every write fires it twice,
 * as fs.watch often does). script({ write, next, options, first }) is the reply: write(obj) writes
 * status.json, next() waits for the next message the session reads (null once the input closed).
 */
async function setup(script, { ticket = null } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-status-check-'));
  const dir = path.join(root, 'job');
  await fs.mkdir(dir, { recursive: true });
  if (ticket) await fs.writeFile(path.join(dir, 'options.json'), JSON.stringify({ ...defaultsForLevel(2), schema_version: 2, title: 'Job', repo: '/repo', ticket }));
  const watchers = new Map();
  const sessions = [];
  const write = async (obj) => {
    await fs.writeFile(path.join(dir, 'status.json'), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
    watchers.get(dir)?.();
    watchers.get(dir)?.();
  };
  const queryFn = ({ prompt, options }) => {
    const it = prompt[Symbol.asyncIterator]();
    const session = { options, received: [] };
    sessions.push(session);
    const next = async () => {
      const r = await it.next();
      if (r.done) return null;
      session.received.push(r.value.message.content);
      return r.value.message.content;
    };
    const gen = (async function* () {
      const first = await next();
      yield { type: 'system', subtype: 'init', session_id: options.resume ?? 'sess-1', model: 'claude-opus-5-5', permissionMode: 'default' };
      await script({ write, next, options, first, session, dir });
      yield { type: 'result', subtype: 'success', result: 'Done.', total_cost_usd: 0 };
      // Read until the input closes; a message taken after the result gets a reply (and result) of its own.
      while ((await next()) !== null) yield { type: 'result', subtype: 'success', result: 'Noted.', total_cost_usd: 0 };
    })();
    gen.interrupt = async () => {};
    return gen;
  };
  const state = new State(path.join(root, 'state'));
  const driver = new Driver({
    queryFn, state, projectsDir: '/nonexistent', locks: null,
    statusWatch: (d, onChange) => { watchers.set(d, onChange); return () => watchers.delete(d); },
  });
  driver.idleGraceMs = 20;
  driver.statusDebounceMs = 5;
  const audits = async (action) => (await state.auditAll()).filter((e) => e.action === action);
  const ended = (id) => until(() => { const r = driver.runs.get(id); return r && ['done', 'error', 'stopped'].includes(r.status) && r.endedAt ? r : null; });
  const start = (extra = {}) => driver.start({ featureDir: dir, slug: 'job', title: 'Job', cwd: '/repo', text: 'go', ...extra });
  return { root, dir, driver, state, sessions, write, audits, ended, start };
}

test('an invalid write gets one corrective message in the same session and an audit line; the fix ends it', async () => {
  const t = await setup(async ({ write, next }) => {
    await write(BAD(1));
    const msg = await next();
    assert.equal(msg, statusFixMessage(BAD_ERRORS), 'the errors, in the same session');
    await write(GOOD(2));
    await sleep(30);
  });
  const run = await t.start();
  await t.ended(run.id);
  assert.equal(t.sessions.length, 1, 'no second session: the message went into the reply');
  assert.deepEqual(t.sessions[0].received, ['go', statusFixMessage(BAD_ERRORS)], 'one message for one write, though the watcher fired twice');
  const invalid = await t.audits('status_invalid');
  assert.equal(invalid.length, 1);
  assert.deepEqual(invalid[0].errors, BAD_ERRORS);
  assert.equal(invalid[0].attempt, 1);
  assert.equal(invalid[0].sent, true);
  assert.equal(invalid[0].sessionId, 'sess-1');
  assert.equal((await t.audits('status_valid')).length, 1, 'the valid rewrite is recorded');
  assert.equal(t.driver.pendingPermissions().length, 0, 'no card');
  // The message reads as the plan words it.
  assert.match(statusFixMessage(BAD_ERRORS), /^status\.json is invalid: stage_state: "in_progress" is not one of working, waiting_for_you, blocked, done; brief\.number: expected a whole number or null, got text "two"\. Rewrite the whole file to match ~\/\.claude\/skills\/feature\/status-json\.md and write it again\.$/);
  assert.equal((await t.audits('steer')).length, 0, 'not shown as a message you sent');
});

test('a valid write, or a file nobody wrote during the reply, sends nothing', async () => {
  const t = await setup(async ({ write }) => { await write(GOOD(1)); await sleep(30); });
  await fs.writeFile(path.join(t.dir, 'status.json'), JSON.stringify(BAD(0))); // there before the reply
  const run = await t.start();
  await t.ended(run.id);
  assert.deepEqual(t.sessions[0].received, ['go']);
  assert.equal((await t.audits('status_invalid')).length, 0);

  const quiet = await setup(async () => { await sleep(20); });
  await fs.writeFile(path.join(quiet.dir, 'status.json'), JSON.stringify(BAD(0)));
  const r2 = await quiet.start();
  await quiet.ended(r2.id);
  assert.equal((await quiet.audits('status_invalid')).length, 0, 'an old invalid file is not the Foreman’s write');
  assert.equal(quiet.sessions.length, 1);
});

test('three corrective messages, then a Needs you card with the errors; it stays after the reply ends', async () => {
  const t = await setup(async ({ write, next }) => {
    for (let i = 1; i <= STATUS_RETRIES; i++) {
      await write(BAD(i));
      assert.equal(await next(), statusFixMessage(BAD_ERRORS), `message ${i}`);
    }
    await write(BAD(STATUS_RETRIES + 1)); // the fourth invalid write in a row
    await sleep(40);
  });
  const run = await t.start();
  await t.ended(run.id);
  assert.equal(t.sessions[0].received.length, 1 + STATUS_RETRIES, 'the first message and three corrections, no fourth');
  const invalid = await t.audits('status_invalid');
  assert.deepEqual(invalid.map((e) => [e.attempt, e.sent, e.card ?? false]), [[1, true, false], [2, true, false], [3, true, false], [4, false, true]]);
  // The card: a question card under Needs you for this job, kept outside the reply.
  const cards = t.driver.pendingPermissions().filter((p) => p.featureDir === t.dir);
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.equal(card.kind, 'question');
  assert.equal(card.toolName, 'AskUserQuestion');
  assert.equal(card.plain.headline, STATUS_CARD_HEADLINE);
  assert.equal(card.plain.preview, BAD_ERRORS.join('\n'));
  assert.deepEqual(card.errors, BAD_ERRORS);
  const q = card.input.questions[0];
  assert.match(q.question, /^The Foreman cannot write a valid status\.json\. It was told what is wrong 3 times and it is still wrong: stage_state: /);
  assert.deepEqual(q.options.map((o) => o.label), [STATUS_TRY_AGAIN, STATUS_LEAVE]);
  assert.equal(t.driver.pendingRequest(card.id).id, card.id);
  assert.equal(t.driver.runs.get(run.id).status, 'done', 'the reply ended; the card is still waiting');
});

test('the card: Ask it to try again resumes the same session with the errors; Leave it sends nothing more', async () => {
  let round = 0;
  const t = await setup(async ({ write, next }) => {
    round++;
    if (round === 1) {
      for (let i = 1; i <= STATUS_RETRIES; i++) { await write(BAD(i)); await next(); }
      await write(BAD(4));
      await sleep(40);
    } else if (round === 2) {
      await write(BAD(5)); // still wrong after Try again: a new count, so a message again
      await next();
      await write(BAD(6));
      await next();
      await write(BAD(7));
      await next();
      await write(BAD(8));
      await sleep(40);
    } else {
      await write(BAD(9));
      await sleep(40);
    }
  });
  const run = await t.start();
  await t.ended(run.id);
  const [card] = t.driver.pendingPermissions();
  const gone = [];
  t.driver.on('permission-gone', (p) => gone.push(p));
  assert.equal(await t.driver.decide(card.id, { decision: 'allow', answers: { [card.input.questions[0].question]: STATUS_TRY_AGAIN } }), true);
  assert.deepEqual(gone.map((g) => [g.id, g.reason]), [[card.id, 'answered']]);
  await until(() => t.sessions.length === 2 || null);
  const second = t.sessions[1];
  assert.equal(second.options.resume, 'sess-1', 'the same session, resumed');
  assert.equal(second.received[0], statusFixMessage(BAD_ERRORS));
  const sends = (await t.audits('send')).filter((e) => e.kind === 'status-fix');
  assert.equal(sends.length, 1);
  const runs = t.driver.list();
  await t.ended(runs.at(-1).id);
  assert.equal(second.received.length, 1 + STATUS_RETRIES, 'three more tries after Try again');
  const [card2] = t.driver.pendingPermissions();
  assert.ok(card2, 'a new card after three more');
  assert.equal(await t.driver.decide(card2.id, { decision: 'allow', answers: { q: STATUS_LEAVE } }), true);
  assert.equal(t.driver.pendingPermissions().length, 0);
  const answers = await t.audits('status_invalid_answer');
  assert.deepEqual(answers.map((a) => a.answer), [STATUS_TRY_AGAIN, STATUS_LEAVE]);
  // Left: the next reply's invalid write is recorded, nothing is sent, no card.
  const r3 = await t.start({ sessionId: 'sess-1' });
  await t.ended(r3.id);
  assert.deepEqual(t.sessions[2].received, ['go']);
  const last = (await t.audits('status_invalid')).at(-1);
  assert.equal(last.sent, false);
  assert.equal(last.reason, 'left');
  assert.equal(t.driver.pendingPermissions().length, 0);
});

test('a valid write takes the card away', async () => {
  let round = 0;
  const t = await setup(async ({ write, next }) => {
    round++;
    if (round === 1) {
      for (let i = 1; i <= STATUS_RETRIES; i++) { await write(BAD(i)); await next(); }
      await write(BAD(4));
    } else {
      await write(GOOD(5));
    }
    await sleep(40);
  });
  const r1 = await t.start();
  await t.ended(r1.id);
  const [card] = t.driver.pendingPermissions();
  assert.ok(card);
  const gone = [];
  t.driver.on('permission-gone', (p) => gone.push(p));
  const r2 = await t.start({ sessionId: 'sess-1' });
  await t.ended(r2.id);
  assert.deepEqual(gone.map((g) => [g.id, g.reason]), [[card.id, 'resolved']]);
  assert.equal(t.driver.pendingPermissions().length, 0);
  assert.equal((await t.audits('status_valid')).at(-1).after, STATUS_RETRIES + 1);
});

test('a write found as the reply ends (the watcher missed it): the same session is resumed with the message', async () => {
  let round = 0;
  const t = await setup(async ({ dir }) => {
    round++;
    // Written without the watcher firing: only the check as the reply ends sees it.
    if (round === 1) await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify(BAD(1)));
  });
  const run = await t.start();
  await t.ended(run.id);
  await until(() => t.sessions.length === 2 || null);
  assert.equal(t.sessions[1].options.resume, 'sess-1');
  assert.equal(t.sessions[1].received[0], statusFixMessage(BAD_ERRORS));
  await t.ended(t.driver.list().at(-1).id);
  assert.equal((await t.audits('status_invalid')).length, 1);
});

test('a write while the reply is finishing: the message still joins that reply', async () => {
  const t = await setup(async ({ write }) => { await write(BAD(1)); });
  const run = await t.start();
  await t.ended(run.id);
  await until(async () => (t.sessions.flatMap((s) => s.received).includes(statusFixMessage(BAD_ERRORS)) ? true : null));
  await sleep(30);
  // It joins the reply while it is still reading; on a busy machine the reply can end first, and
  // the same session is resumed with it instead. Either way the correction is sent exactly once.
  assert.ok(t.sessions.length <= 2);
  assert.equal(t.sessions[0].received[0], 'go');
  assert.equal(t.sessions.flatMap((s) => s.received).filter((m) => m === statusFixMessage(BAD_ERRORS)).length, 1);
});

test('stopped: a correction not yet read is not sent afterwards', async () => {
  const t = await setup(async ({ write }) => { await write(BAD(1)); await sleep(200); });
  const run = await t.start();
  await until(async () => (await t.audits('status_invalid')).length || null);
  await t.driver.stop(run.id);
  await t.ended(run.id);
  await sleep(50);
  assert.equal(t.sessions.length, 1);
});

test('a job started from a ticket must write version 2 with that key', async () => {
  const ticket = { key: 'ORBIT-479', title: 'Feedback API', url: 'https://orbit.example.com/t/479' };
  const v2 = { ...GOOD(2), schema_version: 2, slug: 'orbit-479-feedback-api', ticket: { ...ticket, level: 'L2' } };
  const t = await setup(async ({ write, next }) => {
    await write(GOOD(1));
    const msg = await next();
    assert.match(msg, /this job was started from ORBIT-479, so write schema_version 2 with the ticket block/);
    await write(v2);
    await sleep(30);
  }, { ticket });
  const run = await t.start();
  await t.ended(run.id);
  assert.equal(t.sessions[0].received.length, 2);
  assert.equal((await t.audits('status_valid')).length, 1);
});

test('the demo Foreman’s status.json writes pass the check', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-status-demo-'));
  const featuresDir = path.join(root, 'feature-work');
  const dir = path.join(featuresDir, 'footer-typo');
  await writeOptions(dir, defaultsForLevel(2), { title: 'Fix the typo in the invoice footer', repo: '/repo' });
  const state = new State(path.join(root, 'state'));
  const driver = new Driver({ queryFn: makeFakeQuery({ featuresDir, pace: 0.02 }), state, projectsDir: '/nonexistent' });
  driver.idleGraceMs = 20;
  driver.on('permission', (p) => { if (!driver.statusCards.has(p.id)) driver.decide(p.id, { decision: 'allow' }); });
  const run = await driver.start({ featureDir: dir, slug: 'footer-typo', title: 'Footer typo', cwd: '/repo', text: `/feature Fix the typo in the invoice footer Private folder: ${dir}\n\nJob options:\n- Level: L2` });
  await until(() => { const r = driver.runs.get(run.id); return r?.endedAt ? r : null; }, 10000);
  await sleep(50);
  const status = JSON.parse(await fs.readFile(path.join(dir, 'status.json'), 'utf8'));
  assert.equal(validate(status).ok, true, validate(status).errors.join('; '));
  assert.equal((await state.auditAll()).filter((e) => e.action === 'status_invalid').length, 0);
});

test('watchStatusFile: fs.watch on the folder calls back for status.json', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-status-watch-'));
  let calls = 0;
  const stop = watchStatusFile(dir, () => { calls++; });
  try {
    await sleep(50);
    await fs.writeFile(path.join(dir, 'status.json'), '{}');
    await until(() => calls > 0 || null, 3000);
    const before = calls;
    await fs.writeFile(path.join(dir, 'other.md'), 'x');
    await sleep(100);
    assert.equal(calls, before, 'other files are not status.json');
  } finally { stop(); }
});

// ---------- Start from a ticket (lib/options.js; POST /api/jobs) ----------

test('a ticket: its key in any lenient form, a clean title and link; a bad key is refused in plain words', () => {
  assert.equal(normalizeTicket(undefined), null);
  assert.equal(normalizeTicket(null), null);
  assert.deepEqual(normalizeTicket({ key: 'orbit-479', title: '  ORBIT-479:  Feedback API\n and MCP ', url: 'https://orbit.example.com/t/479' }), { key: 'ORBIT-479', title: 'Feedback API and MCP', url: 'https://orbit.example.com/t/479' });
  assert.deepEqual(normalizeTicket({ key: '#12', url: 'javascript:alert(1)' }), { key: 'ORBIT-12', title: null, url: null });
  for (const bad of [{ key: 'ORBIT-0' }, { key: 'TICKET-4' }, { title: 'no key' }, 'ORBIT-479', []]) assert.throws(() => normalizeTicket(bad), { message: TICKET_KEY_PROBLEM });
  assert.equal(ticketKeyOf('orbit479'), 'ORBIT-479');
});

test('a ticket’s slug and branch: orbit-<n>-<short-title>, feature/ or fix/ by kind', () => {
  const t = normalizeTicket({ key: 'ORBIT-479', title: 'Feedback API and MCP for the portal’s team members' });
  assert.equal(ticketSlug(t), 'orbit-479-feedback-api-and-mcp-for-the-portals');
  assert.ok(shortTitle(t.title).length <= 40);
  assert.equal(ticketSlug({ key: 'ORBIT-7', title: null }), 'orbit-7');
  assert.equal(ticketSlug({ key: 'ORBIT-7', title: '!!!' }), 'orbit-7');
  assert.equal(ticketBranch('feature', 'orbit-479-feedback-api'), 'feature/orbit-479-feedback-api');
  assert.equal(ticketBranch('bug', 'orbit-124-comment-save'), 'fix/orbit-124-comment-save');
});

test('Start from a ticket writes the folder with the ticket block (a valid version 2 status.json) and the brief lines', async () => {
  const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-ticket-start-')), 'orbit-479-feedback-api');
  const ticket = normalizeTicket({ key: 'ORBIT-479', title: 'Feedback API', url: 'https://orbit.example.com/t/479' });
  const slug = ticketSlug(ticket);
  await writeOptions(dir, defaultsForLevel(2), { title: 'ORBIT-479: Feedback API', repo: '/repo', kind: 'feature', ticket, branch: ticketBranch('feature', slug) });
  const out = await startFromTicket(dir, { ticket, slug, title: 'ORBIT-479: Feedback API', kind: 'feature', level: 2, repo: '/repo' });
  assert.equal(out.branch, 'feature/orbit-479-feedback-api');
  const status = JSON.parse(await fs.readFile(path.join(dir, 'status.json'), 'utf8'));
  assert.equal(status.schema_version, 2);
  assert.deepEqual(status.ticket, { key: 'ORBIT-479', title: 'Feedback API', url: 'https://orbit.example.com/t/479', level: 'L2' });
  assert.equal(status.slug, 'orbit-479-feedback-api');
  assert.deepEqual(validate(status, { ticketKey: 'ORBIT-479' }), { ok: true, errors: [], warnings: [] });
  const options = JSON.parse(await fs.readFile(path.join(dir, 'options.json'), 'utf8'));
  assert.deepEqual(options.ticket, ticket);
  assert.equal(options.branch, 'feature/orbit-479-feedback-api');
  // The first message: the key, the MCP server to read it through, the branch, the ticket's title quoted.
  assert.match(out.brief, /^Orbit ticket: ORBIT-479 \(https:\/\/orbit\.example\.com\/t\/479\)\. Its title, as Orbit gives it:\n> Feedback API\n/);
  assert.match(out.brief, /orbit-feedback MCP server \(feedback_get_ticket with ORBIT-479\) at clarify, at spec and again at test\. Read only: never write to Orbit\./);
  assert.match(out.brief, /Branch: feature\/orbit-479-feedback-api /);
  // Never over a status.json already there.
  await fs.writeFile(path.join(dir, 'status.json'), '{"kept":true}');
  await startFromTicket(dir, { ticket, slug, kind: 'feature' });
  assert.equal(await fs.readFile(path.join(dir, 'status.json'), 'utf8'), '{"kept":true}');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['options.json', 'status.json'], 'no temp file left');
});

// Through the real dashboard (demo mode, temp folders). Runs once server.js's POST /api/jobs takes
// `ticket` (the edit packet B hands over under "Needs from others"); until then it is skipped.
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const serverTakesTickets = (await fs.readFile(SERVER, 'utf8')).includes('startFromTicket(');
test('POST /api/jobs with a ticket: the job, its folder and branch carry the key; the Foreman is told', { timeout: 60_000, skip: serverTakesTickets ? false : 'server.js does not take a ticket yet (see packet B, Needs from others)' }, async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-ticket-start-')));
  const featuresDir = path.join(root, 'feature-work');
  const repo = path.join(root, 'sample-repo');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state'), home: path.join(root, 'home') };
  for (const d of [featuresDir, repo, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  const output = [];
  let dashboard = null;
  try {
    dashboard = await startDashboard({ env: { HOME: dirs.home, WORKSHOP_DEMO: '1', WORKSHOP_FEATURES_DIR: featuresDir, WORKSHOP_PROJECTS_DIR: dirs.projects, WORKSHOP_AGENTS_DIR: dirs.agents, WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: dirs.state }, output });
    const { base } = dashboard;
    const token = (await (await fetch(`${base}/api/meta`)).json()).token;
    const post = async (body) => {
      const res = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workshop-Token': token }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    const bad = await post({ description: 'ORBIT-0: nothing', repoPath: repo, ticket: { key: 'ORBIT-0' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, TICKET_KEY_PROBLEM);
    const r = await post({ description: 'ORBIT-479: Feedback API and MCP', kind: 'bug', repoPath: repo, options: { level: 2 }, ticket: { key: 'ORBIT-479', title: 'Feedback API and MCP', url: 'https://orbit.example.com/t/479' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.slug, 'orbit-479-feedback-api-and-mcp');
    const dir = path.join(featuresDir, r.body.slug);
    const options = JSON.parse(await fs.readFile(path.join(dir, 'options.json'), 'utf8'));
    assert.equal(options.ticket.key, 'ORBIT-479');
    assert.equal(options.branch, 'fix/orbit-479-feedback-api-and-mcp');
    const status = JSON.parse(await fs.readFile(path.join(dir, 'status.json'), 'utf8'));
    assert.equal(status.ticket.key, 'ORBIT-479');
    const audit = (await fs.readFile(path.join(dirs.state, 'audit.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const send = audit.find((e) => e.action === 'send' && e.featureDir === dir);
    assert.match(send.text, /^\/feature ORBIT-479: Feedback API and MCP \(This is a bug fix\.\) Private folder: /);
    assert.match(send.text, /Orbit ticket: ORBIT-479 .*\n> Feedback API and MCP\n.*orbit-feedback MCP server/);
    assert.match(send.text, /Branch: fix\/orbit-479-feedback-api-and-mcp /);
    assert.equal(audit.find((e) => e.action === 'new-job').ticket, 'ORBIT-479');
    // The demo Foreman's later writes keep the ticket block, so the check never sends anything back.
    const end = Date.now() + 10000;
    while (Date.now() < end && !(await fs.readFile(path.join(dir, 'status.json'), 'utf8')).includes('"brief"')) await sleep(50);
    await sleep(300);
    const after = (await fs.readFile(path.join(dirs.state, 'audit.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(after.filter((e) => e.action === 'status_invalid').length, 0);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'status.json'), 'utf8')).ticket.key, 'ORBIT-479');
  } finally {
    await dashboard?.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});
