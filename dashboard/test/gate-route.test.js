// The gate card's route (POST /api/job/:slug/gate) and a job's notes (GET/PUT /api/job/:slug/notes)
// through the real dashboard in demo mode (a pretend Foreman, nothing real runs) on temp folders:
// no real job, ~/.claude or ~/.feature-workshop is touched and no Claude usage is spent.
// The dashboard starts with Claude's usage limit reached (seeded in its settings), so the first
// test can hold a reply until "Carry on now"; the rest run with the limit lifted.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const OLD = '2026-10-01T10:00:00Z';

let root, featuresDir, stateDir, repo, child, base, token;
const output = [];

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

// A plan gate on brief 2: one question, one decision made on your behalf, versions named.
const planStatus = (slug) => ({
  schema_version: 1, slug, title: `Job ${slug}`, route: 'quick', stage: 'plan', stage_state: 'waiting_for_you', waiting_for: 'approval',
  waiting_since: OLD, brief: { number: 2, path: 'briefs/002-plan.md', headline: 'Plan v2 ready' },
  questions: [{ id: '1', text: 'Keep the old column?', recommendation: 'a', options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] }],
  decided_on_your_behalf: [{ id: 'D-1', decision: 'Reviewers: head inspector', reason: 'L1 default', where: 'review', confirmed: false }],
  next_proposed: 'Build step 1', spec: null, artifacts: [{ name: 'quick-plan', path: 'quick-plan.md', version: 2 }],
  repo: { path: repo }, updated_at: OLD,
});

async function writeJob(slug, { provided = null } = {}) {
  const dir = path.join(featuresDir, slug);
  await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify(planStatus(slug), null, 2));
  await fs.writeFile(path.join(dir, 'options.json'), JSON.stringify({
    schema_version: 2, level: 1, flow: 'quick', skip: ['spec', 'refine', 'investigate', 'spec-update'], provided: provided ?? {}, reviewers: ['feature-reviewer'],
    review_rounds: 2, manual_test: true, fable_checks: [], models: { foreman: 'claude-opus-5-5', build: 'claude-opus-5-5', checks: 'claude-opus-5-5' }, notes: 'Keep it small.',
    title: `Job ${slug}`, repo, kind: 'feature',
  }, null, 2));
  for (const f of ['001-spec.md', '002-plan.md']) await fs.writeFile(path.join(dir, 'briefs', f), `**Job ${slug} · ${f}**\n`);
  return dir;
}

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-gate-route-')));
  featuresDir = path.join(root, 'feature-work');
  stateDir = path.join(root, 'state');
  repo = path.join(root, 'repo');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), home: path.join(root, 'home') };
  for (const d of [featuresDir, stateDir, repo, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  // A document handed over earlier, since moved away: a level change must still go through.
  await writeJob('gate-job', { provided: { plan: path.join(root, 'moved-away.md') } });
  await writeJob('held-job');
  await writeJob('checks-job');
  await writeJob('notes-job');
  // Claude's usage limit is reached, resetting in an hour (as the limit watch saves it).
  const now = Date.now();
  await fs.writeFile(path.join(stateDir, 'settings.json'), JSON.stringify({ usageLimit: { kind: 'five_hour', since: now, resetsAt: now + 3600_000, resetKnown: true, jobs: [] } }));

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
  return { status: res.status, body: await res.json().catch(() => null) };
};
const get = async (p) => (await fetch(base + p)).json();
const readJson = async (...p) => JSON.parse(await fs.readFile(path.join(...p), 'utf8'));
const auditLines = async () => (await fs.readFile(path.join(stateDir, 'audit.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sendsFor = async (slug) => (await auditLines()).filter((e) => e.action === 'send' && e.slug === slug);

async function waitFor(fn, what, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.\n${output.join('')}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Pause the pretend Foreman's reply for a job and wait until it has ended.
async function stopReply(slug) {
  const job = await get(`/api/job/${slug}`);
  if (job.run && ['starting', 'running', 'waiting_permission'].includes(job.run.status)) await write('POST', `/api/runs/${job.run.id}/stop`);
  await waitFor(async () => (await get(`/api/job/${slug}`)).drive.mode !== 'running', `${slug}'s reply to end`);
}

const APPROVE_TEXT = 'I approve. Go ahead with the next stage: Build step 1\nAt these versions: quick-plan v2.';

test('usage limit: the gate refuses like /send; “start after reset” holds the reply; Carry on now sends it with its brief', async () => {
  const send = await write('POST', '/api/job/held-job/send', { text: 'go' });
  assert.equal(send.status, 409);
  assert.equal(send.body.code, 'limited');
  const refused = await write('POST', '/api/job/held-job/gate', { kind: 'approve', briefNumber: 2, chips: [{ kind: 'fable', point: 'plan' }] });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'limited');
  assert.deepEqual((await readJson(featuresDir, 'held-job', 'options.json')).fable_checks, [], 'a refusal changes no option');

  const held = await write('POST', '/api/job/held-job/gate', { kind: 'approve', briefNumber: 2, startAfterReset: true, chips: [{ kind: 'fable', point: 'plan' }] });
  assert.equal(held.status, 200, JSON.stringify(held.body));
  assert.equal(held.body.sent, false);
  assert.equal(held.body.held, true);
  assert.match(held.body.message, /^Held: it goes to the Foreman when Claude’s usage limit resets/);
  assert.equal(held.body.text, `Not confirmed yet: D-1.\n\nOption change for the next step: ask Fable at plan\n\n${APPROVE_TEXT}`);
  assert.deepEqual((await readJson(featuresDir, 'held-job', 'options.json')).fable_checks, ['plan'], 'held: the option change is saved now');
  assert.deepEqual(await sendsFor('held-job'), [], 'nothing sent yet');
  const job = await get('/api/job/held-job');
  assert.equal(job.heldReply.kind, 'approve');
  assert.equal(job.heldReply.gateBrief, 2);
  assert.ok(job.thread.some((t) => t.kind === 'note' && /^Your reply to brief 2 waits for Claude’s usage limit to reset/.test(t.text)));
  assert.deepEqual(job.answeredBriefs, [], 'not answered until it is sent');

  const resumed = await write('POST', '/api/usage/resume');
  assert.equal(resumed.status, 200);
  assert.deepEqual(resumed.body.resumed, ['held-job']);
  const [sent] = await waitFor(() => sendsFor('held-job').then((l) => (l.length ? l : null)), 'the held reply to go');
  assert.equal(sent.kind, 'approve');
  assert.equal(sent.gateBrief, 2);
  assert.equal(sent.text, `/feature held-job Private folder: ${path.join(featuresDir, 'held-job')}\n\n${held.body.text}`, 'no Foreman session yet: a new one picks the job up');
  assert.deepEqual((await get('/api/job/held-job')).answeredBriefs, [2]);
  await stopReply('held-job');
});

test('gate: composes the reply, patches options from the chips, sends it with its brief audited', async () => {
  const r = await write('POST', '/api/job/gate-job/gate', {
    kind: 'approve', briefNumber: 2, answers: { 1: { choice: 'a' } }, verdicts: { 'D-1': { verdict: 'confirm' } },
    chips: [{ kind: 'skip', stage: 'test' }, { kind: 'level', level: 2, was: 0 }, { kind: 'fable', point: 'review' }, { kind: 'lighter', stage: 'review' }, { kind: 'skip', stage: 'implement' }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sent, true);
  assert.equal(r.body.chipsDropped, 1);
  assert.equal(r.body.text, [
    'My answers to brief 2:', '1. Keep the old column? → a) Yes', '',
    'Decided on my behalf, confirmed: D-1.', '',
    'Option change for the next step: skip test',
    'Option change for the next step: level L2 (was L1)', // the job's level, not the page's
    'Option change for the next step: ask Fable at review',
    'Option change for the next step: lighter review', '',
    APPROVE_TEXT,
  ].join('\n'));

  // Level → L2's defaults, keeping the provided document, notes and fix rounds; then skip and Fable on top.
  const o = await readJson(featuresDir, 'gate-job', 'options.json');
  assert.equal(o.level, 2);
  assert.equal(o.flow, 'small');
  assert.deepEqual(o.skip, ['refine', 'plan', 'test'], 'refine (L2), plan (provided), test (chip)');
  assert.deepEqual(o.provided, { plan: path.join(root, 'moved-away.md') });
  assert.deepEqual(o.fable_checks, ['review']);
  assert.equal(o.review_rounds, 2);
  assert.equal(o.notes, 'Keep it small.');
  assert.equal(o.title, 'Job gate-job', 'the job’s title is kept');
  assert.deepEqual(r.body.options.skip, o.skip);
  assert.ok(r.body.summary[0].startsWith('Level: L2 Standard'));

  const audit = await auditLines();
  const sent = audit.filter((e) => e.action === 'send' && e.slug === 'gate-job');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'approve');
  assert.equal(sent[0].gateBrief, 2);
  assert.ok(sent[0].text.endsWith(r.body.text));
  const opt = audit.find((e) => e.action === 'options' && e.slug === 'gate-job');
  assert.equal(opt.via, 'gate');
  assert.equal(opt.options.level, 2);

  const job = await get('/api/job/gate-job');
  assert.deepEqual(job.answeredBriefs, [2]);
  assert.ok(job.thread.some((t) => t.kind === 'you' && t.gateBrief === 2 && t.sendKind === 'approve'));
  assert.ok(job.thread.some((t) => t.kind === 'note' && t.text.startsWith('You changed how this job runs')));
});

test('gate: with a reply in progress nothing is sent; the text comes back and the options are saved; /send refuses', async () => {
  assert.equal((await get('/api/job/gate-job')).drive.mode, 'running', 'the pretend Foreman is still on the last reply');
  const send = await write('POST', '/api/job/gate-job/send', { text: 'more' });
  assert.equal(send.status, 409);
  const before = (await sendsFor('gate-job')).length;
  const r = await write('POST', '/api/job/gate-job/gate', { kind: 'message', briefNumber: 2, note: 'Also check the CSV export.', chips: [{ kind: 'fable', point: 'plan' }, { kind: 'self', stage: 'test' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sent, false);
  assert.equal(r.body.queued, false);
  assert.match(r.body.message, /nothing was sent\. The option changes are saved/);
  assert.equal(r.body.text, "Not confirmed yet: D-1.\n\nOption change for the next step: ask Fable at plan\nOption change for the next step: I'll do test myself\n\nAlso check the CSV export.");
  assert.deepEqual((await readJson(featuresDir, 'gate-job', 'options.json')).fable_checks, ['plan', 'review']);
  assert.equal((await sendsFor('gate-job')).length, before, 'nothing sent');
  await stopReply('gate-job');
});

test('gate: refusals send nothing and change nothing', async () => {
  const optionsBefore = await fs.readFile(path.join(featuresDir, 'checks-job', 'options.json'), 'utf8');
  const cases = [
    [{ kind: 'approve', briefNumber: 1 }, 409, /moved on to brief 2/],
    [{ kind: 'yes' }, 400, /Unknown decision/],
    [{ kind: 'approve', briefNumber: '2' }, 400, /brief number/],
    [{ kind: 'message', note: 'x'.repeat(4001) }, 400, /too long/],
    [{ kind: 'changes', note: '  ' }, 400, /Say what to change/],
    [{ kind: 'approve', answers: { 1: { choice: 'a' }, 2: {}, 3: {}, 4: {} } }, 400, /at most 3/],
    [{ kind: 'approve', verdicts: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`D-${i}`, { verdict: 'confirm' }])) }, 400, /at most 20/],
    [{ kind: 'approve', verdicts: { 'D-1': { verdict: 'maybe' } } }, 400, /confirm or change/],
    [{ kind: 'approve', chips: Array.from({ length: 9 }, () => ({ kind: 'skip', stage: 'test' })) }, 400, /at most 8/],
    [{ kind: 'approve', chips: { kind: 'skip' } }, 400, /a list/],
    [{ kind: 'message', chips: [{ kind: 'skip', stage: 'implement' }] }, 400, /empty/],
  ];
  for (const [body, status, error] of cases) {
    const r = await write('POST', '/api/job/checks-job/gate', { chips: [{ kind: 'skip', stage: 'test' }], ...body });
    assert.equal(r.status, status, JSON.stringify(body).slice(0, 80));
    assert.match(r.body.error, error);
  }
  assert.equal(r409code(await write('POST', '/api/job/checks-job/gate', { kind: 'approve', briefNumber: 1 })), 'stale-brief');
  assert.equal((await write('POST', '/api/job/checks-job/gate', { kind: 'approve' }, { auth: false })).status, 403);
  assert.equal((await write('POST', '/api/job/no-such-job/gate', { kind: 'approve' })).status, 404);
  assert.equal((await write('POST', '/api/job/..%2Fstate/gate', { kind: 'approve' })).status, 404);
  assert.equal(await fs.readFile(path.join(featuresDir, 'checks-job', 'options.json'), 'utf8'), optionsBefore);
  const audit = await auditLines();
  assert.ok(!audit.some((e) => e.slug === 'checks-job'), 'nothing audited');
});
const r409code = (r) => r.body?.code;

test('notes: PUT writes notes.md in the job folder, capped and token-checked; GET reads it; audited by size', async () => {
  assert.deepEqual(await get('/api/job/notes-job/notes'), { text: '', updatedAt: null });
  const saved = await write('PUT', '/api/job/notes-job/notes', { text: 'Ask Raj about the CSV.\n' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(await fs.readFile(path.join(featuresDir, 'notes-job', 'notes.md'), 'utf8'), 'Ask Raj about the CSV.\n');
  const read = await get('/api/job/notes-job/notes');
  assert.equal(read.text, 'Ask Raj about the CSV.\n');
  assert.ok(read.updatedAt);
  assert.equal((await write('PUT', '/api/job/notes-job/notes', { text: 'Second save.' })).status, 200);

  assert.equal((await write('PUT', '/api/job/notes-job/notes', { text: 'x' }, { auth: false })).status, 403);
  const big = await write('PUT', '/api/job/notes-job/notes', { text: 'x'.repeat(20001) });
  assert.equal(big.status, 413);
  assert.equal((await write('PUT', '/api/job/notes-job/notes', { text: 42 })).status, 400);
  assert.equal((await write('PUT', '/api/job/..%2F..%2Fescape/notes', { text: 'x' })).status, 404);
  assert.equal((await write('PUT', '/api/job/notes-job/other', { text: 'x' })).status, 404);
  assert.equal(await fs.readFile(path.join(featuresDir, 'notes-job', 'notes.md'), 'utf8'), 'Second save.', 'refusals leave it alone');
  assert.deepEqual((await fs.readdir(path.join(featuresDir, 'notes-job'))).filter((n) => n.endsWith('.tmp')), [], 'no temp files left');

  const notes = (await auditLines()).filter((e) => e.action === 'notes');
  assert.deepEqual(notes.map((e) => e.size), [23, 12]);
  assert.ok(notes.every((e) => !('text' in e)), 'the words themselves aren’t audited');
  const thread = (await get('/api/job/notes-job')).thread.filter((t) => t.kind === 'note' && t.notes);
  assert.equal(thread.length, 1, 'two saves in a row: one line');
});
