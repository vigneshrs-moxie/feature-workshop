// The job page's Details rows (the job page rebuild, Task 5): one row per piece of work, newest first
// (step, who, the task it was given, how long, how it ended), cost by step under it, read from each
// crew member's log only when Details asks, and never twice while a log is unchanged. Temp folders
// and made-up logs only: no model, no Orbit, no Postgres.

import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { workView, jobWork, workFacts, mirrorWork, crewLogs, firstInstruction, runLines, TASK_MAX, READS_AT_ONCE } from '../lib/work-rows.js';
import { jobPageCache } from '../lib/job-payload-cache.js';
import jobPageRoutes from '../site/routes-job-page.js';
import { modelLabel } from '../lib/cost.js';
import { crewRef } from '../lib/stage-view.js';

const DASH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-11-13T12:00:00Z');
const SECRET = 'sk_' + 'live_51abcdefghijklmnopqrstuvwx';

const roots = [];
async function tempRoot() {
  const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'starbase-work-rows-')));
  roots.push(root);
  return root;
}
after(async () => { for (const r of roots) await fsp.rm(r, { recursive: true, force: true }); });

// ---------- Made-up logs ----------

const line = (o) => JSON.stringify(o);
const promptLine = (text, at, extra = {}) => line({ type: 'user', isSidechain: true, message: { role: 'user', content: text }, timestamp: at, ...extra });
const toolLine = (name, input, at, id = `toolu_${Math.random().toString(36).slice(2, 8)}`) => line({
  type: 'assistant', isSidechain: true, timestamp: at,
  message: { id: `msg_${id}`, model: 'claude-opus-4-6', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }], usage: { input_tokens: 10, output_tokens: 5 } },
});
const resultLine = (id, at) => line({ type: 'user', isSidechain: true, timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const apiErrorLine = (text, at) => line({
  type: 'assistant', isSidechain: true, timestamp: at, isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429,
  message: { id: `err_${at}`, model: '<synthetic>', role: 'assistant', stop_reason: 'stop_sequence', content: [{ type: 'text', text }], usage: { input_tokens: 0, output_tokens: 0 } },
});

/** One crew member's log under <projects>/<project>/<session>/subagents/agent-<id>.jsonl, with its .meta.json. */
async function writeCrewLog(projects, { project = '-tmp-sample-repo', sessionId, agentId, who, description, lines }) {
  const dir = path.join(projects, project, sessionId, 'subagents');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `agent-${agentId}.jsonl`);
  await fsp.writeFile(file, `${lines.join('\n')}\n`);
  await fsp.writeFile(file.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({ agentType: who, description }));
  return file;
}

// ---------- The rows ----------

const entry = (o) => ({ who: 'feature-implementer', name: 'Builder', description: 'Build the notes table', agentId: 'a1', model: 'claude-opus-4-6', sessionId: 's-1', state: 'finished', startedAt: '2026-11-13T10:00:00Z', lastAt: '2026-11-13T10:20:00Z', recent: [{ text: 'Using SubagentHandback', at: '2026-11-13T10:20:00Z' }], doing: 'Using SubagentHandback', lastCommand: { command: 'npm test', at: '2026-11-13T10:19:00Z', tail: 'ok' }, ...o });

test('one row per piece of work, newest first: step, who (role and model), the task it was given, how long, how it ended; no tool calls', () => {
  const activity = [
    { who: 'conductor', name: 'Foreman', sessionId: 's-1', state: 'delegating', lastAt: '2026-11-13T11:00:00Z', recent: [], doing: 'Sending work to feature-implementer' },
    entry({ who: 'feature-spec-writer', description: 'Write the spec', agentId: 'a0', startedAt: '2026-11-13T09:00:00Z', lastAt: '2026-11-13T09:12:30Z' }),
    entry({ agentId: 'a1', startedAt: '2026-11-13T10:00:00Z', lastAt: '2026-11-13T10:20:00Z' }),
    entry({ who: 'feature-tester', description: 'Run the checks', agentId: 'a2', model: null, state: 'stopped', startedAt: '2026-11-13T11:00:00Z', lastAt: '2026-11-13T11:05:00Z' }),
  ];
  const agents = [{ agentType: 'feature-tester', model: 'claude-sonnet-4-5', stage: 'test', usd: 1 }];
  const tasks = new Map([['a1', { task: 'Implement step 1 of the plan: the notes table.', failed: null }]]);
  const view = workView({ activity, agents, now: NOW }, (e) => tasks.get(e.agentId) ?? null);
  assert.deepEqual(view.rows.map((r) => r.who), ['feature-tester', 'feature-implementer', 'feature-spec-writer'], 'newest first; the Foreman’s own session is not a piece of work');
  const [test1, build, spec] = view.rows;
  assert.deepEqual(
    { step: build.step, stepLabel: build.stepLabel, role: build.role, model: build.model, task: build.task, durationMs: build.durationMs, ended: build.ended, state: build.state, startedAt: build.startedAt, endedAt: build.endedAt },
    { step: 'build', stepLabel: 'Build', role: 'Builder', model: modelLabel('claude-opus-4-6'), task: 'Implement step 1 of the plan: the notes table.', durationMs: 20 * 60_000, ended: 'Done', state: 'done', startedAt: '2026-11-13T10:00:00Z', endedAt: '2026-11-13T10:20:00Z' },
  );
  assert.equal(build.id, crewRef(activity[2], 2), 'the row’s id is the crew member’s ref (its index in the job’s activity)');
  assert.equal(spec.step, 'spec');
  assert.equal(spec.durationMs, 12.5 * 60_000);
  assert.equal(spec.task, 'Write the spec', 'no log read: the one-line task the Foreman gave');
  assert.equal(test1.model, modelLabel('claude-sonnet-4-5'), 'no model of its own: the cost row for its kind and step');
  assert.equal(test1.ended, 'Stopped');
  const json = JSON.stringify(view);
  for (const word of ['recent', 'doing', 'lastCommand', 'SubagentHandback', 'npm test', 'tail']) assert.doesNotMatch(json, new RegExp(word), `no tool-call list (${word})`);
});

test('how it ended: Done, Stopped, Failed: <one line>, Running; Running only by the job’s rule (the corrected state), never by a log', () => {
  const activity = [
    entry({ agentId: 'done', state: 'finished', startedAt: '2026-11-13T08:00:00Z' }),
    entry({ agentId: 'stop', state: 'stopped', startedAt: '2026-11-13T08:10:00Z', lastAt: '2026-11-13T08:30:00Z' }),
    entry({ agentId: 'limit', state: 'stopped', startedAt: '2026-11-13T08:20:00Z', lastAt: '2026-11-13T08:40:00Z' }),
    entry({ agentId: 'crash', state: 'stopped', startedAt: '2026-11-13T08:30:00Z', lastAt: '2026-11-13T09:00:00Z' }),
    entry({ agentId: 'run', state: 'running', startedAt: '2026-11-13T11:30:00Z', lastAt: '2026-11-13T11:58:00Z' }),
    entry({ agentId: 'deleg', state: 'delegating', startedAt: '2026-11-13T11:40:00Z', lastAt: '2026-11-13T11:59:00Z' }),
  ];
  const infos = {
    // A log can say how it failed; nothing a log says makes a row Running.
    limit: { task: 'x', failed: 'You’ve hit your session limit · resets 2pm\nmore words' },
    stop: { task: 'x', failed: null, running: true, state: 'running' },
    done: { task: 'x', failed: 'An old error the worker got past' },
  };
  // The reply the crash row was part of ended with an error (the job's audit: its send and its run-ended).
  const runs = [
    { runId: 'r1', startedAt: '2026-11-13T08:00:00Z', endedAt: '2026-11-13T08:31:00Z', status: 'done', error: null },
    { runId: 'r2', startedAt: '2026-11-13T08:35:00Z', endedAt: '2026-11-13T09:01:00Z', status: 'error', error: 'Claude Code process exited with code 1\n  at stack' },
  ];
  const view = workView({ activity, runs, now: NOW }, (e) => infos[e.agentId] ?? null);
  const by = Object.fromEntries(view.rows.map((r) => [r.id.split('.')[0], r]));
  const ended = Object.fromEntries(activity.map((a, i) => [a.agentId, by[`c${i}`]]));
  assert.equal(ended.done.ended, 'Done', 'a finished worker is Done, whatever its log says before its end');
  assert.equal(ended.stop.ended, 'Stopped');
  assert.equal(ended.stop.state, 'stopped');
  assert.equal(ended.limit.ended, 'Failed: You’ve hit your session limit · resets 2pm');
  assert.equal(ended.limit.state, 'failed');
  assert.equal(ended.crash.ended, 'Failed: Claude Code process exited with code 1', 'the reply it was part of ended with an error');
  assert.equal(ended.run.ended, 'Running');
  assert.equal(ended.run.state, 'running');
  assert.equal(ended.run.endedAt, null);
  assert.equal(ended.run.durationMs, NOW - Date.parse('2026-11-13T11:30:00Z'), 'still running: how long so far');
  assert.equal(ended.deleg.ended, 'Stopped', 'only the state the job’s rule left as running is Running');
  assert.equal(ended.run.ref, ended.run.id, 'a running row can be opened in a terminal');
  assert.equal(ended.stop.ref, null);
  const errRun = (error) => [{ runId: 'r', startedAt: '2026-11-13T08:00:00Z', endedAt: '2026-11-13T09:00:00Z', status: 'error', error }];
  const longError = workView({ activity: [entry({ state: 'stopped', lastAt: '2026-11-13T09:00:00Z' })], runs: errRun('e'.repeat(500)) }).rows[0].ended;
  assert.ok(longError.length <= 'Failed: '.length + TASK_MAX, 'one short line');
  assert.match(workView({ activity: [entry({ state: 'stopped', lastAt: '2026-11-13T09:00:00Z' })], runs: errRun(null) }).rows[0].ended, /^Failed: \S/, 'an error with no words still says it failed');
});

test('cost by step under the table: the runner’s cost rows by step, in the job’s order, and the total', () => {
  const agents = [
    { agentType: 'conductor', model: 'm', stage: 'spec', usd: 0.5 },
    { agentType: 'feature-implementer', model: 'm', stage: 'implement', usd: 3.25 },
    { agentType: 'feature-spec-writer', model: 'm', stage: 'spec-update', usd: 0.25 },
    { agentType: 'feature-review-ui', model: 'm', stage: 'review', usd: 1 },
    { agentType: 'conductor', model: 'm', stage: 'implement', usd: 0.75 },
    { agentType: 'odd', model: 'm', stage: 'other', usd: 0.1 },
    { agentType: 'feature-tester', model: 'm', stage: 'test', usd: 0 },
  ];
  const view = workView({ activity: [], agents, totalUsd: 5.85 });
  assert.deepEqual(view.costs, {
    steps: [
      { step: 'spec', label: 'Spec', usd: 0.5 },
      { step: 'investigate', label: 'Investigate', usd: 0.25 },
      { step: 'build', label: 'Build', usd: 4 },
      { step: 'review', label: 'Review', usd: 1 },
      { step: 'other', label: 'Other', usd: 0.1 },
    ],
    totalUsd: 5.85,
  });
  assert.equal(workView({ activity: [], agents }).costs.totalUsd, 5.85, 'without the runner’s total, the sum');
  assert.equal(view.note, 'No crew has worked on this job yet.');
});

test('the task in one line: the first line of the first instruction, without markdown, cut short, secrets hidden', () => {
  assert.equal(firstInstruction('\n\n## You are implementing Task 5\n\nRead the plan first.'), 'You are implementing Task 5');
  assert.equal(firstInstruction('<system-reminder>\nsomething\n</system-reminder>\nBuild   the   notes table.\nThen test it.'), 'Build the notes table.');
  assert.equal(firstInstruction('**Fix the login page.** It fails on Safari.'), 'Fix the login page. It fails on Safari.');
  const long = firstInstruction(`Do ${'x'.repeat(400)}`);
  assert.equal(long.length, TASK_MAX);
  assert.ok(long.endsWith('…'));
  assert.doesNotMatch(firstInstruction(`Use the key ${SECRET} to call it`), /sk_live_51/);
  assert.equal(firstInstruction(''), null);
  assert.equal(firstInstruction(null), null);
});

/** fs/promises with every open and readFile counted (the reader's reads). */
function countingFs() {
  const calls = { open: [], readFile: [] };
  const spy = {
    ...fsp,
    open: (p, ...rest) => { calls.open.push(String(p)); return fsp.open(p, ...rest); },
    readFile: (p, ...rest) => { calls.readFile.push(String(p)); return fsp.readFile(p, ...rest); },
  };
  return { fs: spy, calls, reads: () => calls.open.length + calls.readFile.length };
}

test('the log reader: the task is the first instruction in the log (not its last tool call); an API error at its end is how it failed', async () => {
  const projects = path.join(await tempRoot(), 'projects');
  await writeCrewLog(projects, {
    sessionId: 's-1', agentId: 'a1', who: 'feature-implementer', description: 'Build the notes table',
    lines: [
      line({ type: 'queue-operation', operation: 'dequeue', timestamp: '2026-11-13T10:00:00Z' }),
      promptLine('<system-reminder>be nice</system-reminder>', '2026-11-13T10:00:00Z', { isMeta: true }),
      promptLine('Implement step 1 of the plan: the notes table.\n\nRead implementation-plan.md first.', '2026-11-13T10:00:01Z'),
      toolLine('Read', { file_path: '/x/implementation-plan.md' }, '2026-11-13T10:01:00Z', 't1'),
      resultLine('t1', '2026-11-13T10:01:01Z'),
      toolLine('SubagentHandback', { message: 'done' }, '2026-11-13T10:20:00Z', 't2'),
    ],
  });
  await writeCrewLog(projects, {
    sessionId: 's-1', agentId: 'a2', who: 'feature-tester', description: 'Run the checks',
    lines: [
      promptLine([{ type: 'text', text: 'Run the approved checks in test-plan.md.' }], '2026-11-13T11:00:00Z'),
      toolLine('Bash', { command: 'npm test', description: 'Run the tests' }, '2026-11-13T11:01:00Z', 't3'),
      resultLine('t3', '2026-11-13T11:02:00Z'),
      apiErrorLine('You’ve hit your session limit · resets 2pm (America/Phoenix)', '2026-11-13T11:03:00Z'),
    ],
  });
  const logs = crewLogs({ projectsDir: projects });
  const a1 = await logs.read(entry({ agentId: 'a1' }));
  assert.deepEqual(a1, { task: 'Implement step 1 of the plan: the notes table.', failed: null });
  const a2 = await logs.read(entry({ who: 'feature-tester', description: 'Run the checks', agentId: 'a2' }));
  assert.deepEqual(a2, { task: 'Run the approved checks in test-plan.md.', failed: 'You’ve hit your session limit · resets 2pm (America/Phoenix)' });
  assert.equal(await logs.read(entry({ agentId: 'nope', sessionId: 's-2' })), null, 'no log on this computer');
  // A log found without its agent id (an older activity row): by its kind and task line.
  assert.equal((await logs.read(entry({ agentId: null }))).task, 'Implement step 1 of the plan: the notes table.');
});

test('the log reader reads a log once while it is unchanged (a second call reads no file), and again when it grows', async () => {
  const projects = path.join(await tempRoot(), 'projects');
  const file = await writeCrewLog(projects, {
    sessionId: 's-1', agentId: 'a1', who: 'feature-implementer', description: 'Build the notes table',
    lines: [promptLine('Implement step 1.', '2026-11-13T10:00:00Z'), toolLine('Read', { file_path: '/x/a.js' }, '2026-11-13T10:01:00Z', 't1')],
  });
  const spy = countingFs();
  let finds = 0;
  const { findCrewLog } = await import('../lib/stage-view.js');
  const logs = crewLogs({ projectsDir: projects, fs: spy.fs, findLog: (o) => { finds++; return findCrewLog(o); } });
  const e = entry({ agentId: 'a1' });
  assert.deepEqual(await logs.read(e), { task: 'Implement step 1.', failed: null });
  assert.ok(spy.reads() > 0, 'the first call reads the log');
  assert.equal(finds, 1);
  const before = spy.reads();
  assert.deepEqual(await logs.read(e), { task: 'Implement step 1.', failed: null });
  assert.equal(spy.reads(), before, 'unchanged: no file read');
  assert.equal(finds, 1, 'unchanged: the log is not looked for again');
  // The log grows: it is read again, and what it now ends with counts.
  await fsp.appendFile(file, `${apiErrorLine('API Error: 500 Internal server error', '2026-11-13T10:05:00Z')}\n`);
  const grown = await logs.read(e);
  assert.ok(spy.reads() > before, 'a grown log is read again');
  assert.deepEqual(grown, { task: 'Implement step 1.', failed: 'API Error: 500 Internal server error' });
  const again = spy.reads();
  await logs.read(e);
  assert.equal(spy.reads(), again, 'and then not again');
  assert.equal(logs.stats().files, 1);
});

test('jobWork: the rows with each log’s task, read in one go; without a log, the Foreman’s task line', async () => {
  const projects = path.join(await tempRoot(), 'projects');
  await writeCrewLog(projects, { sessionId: 's-1', agentId: 'a1', who: 'feature-implementer', description: 'Build the notes table', lines: [promptLine('Implement step 1 of the plan.', '2026-11-13T10:00:00Z')] });
  const logs = crewLogs({ projectsDir: projects });
  const facts = { activity: [entry({ agentId: 'a1' }), entry({ agentId: 'a9', description: 'Build the export', startedAt: '2026-11-13T10:30:00Z', lastAt: '2026-11-13T10:40:00Z' })], agents: [], totalUsd: 0, runs: [] };
  const view = await jobWork(facts, { logs, now: NOW });
  assert.deepEqual(view.rows.map((r) => r.task), ['Build the export', 'Implement step 1 of the plan.']);
  assert.equal(view.note, null);
  assert.deepEqual((await jobWork(null, { logs })).rows, [], 'no facts: no rows');
  assert.equal((await jobWork(null, { logs })).note, 'The work on this job isn’t known yet. Try again in a moment.', 'and not “no crew yet”');
});

test('workFacts keeps what Details needs from the job detail: the corrected activity, the cost rows, the replies’ ends', () => {
  const detail = {
    activity: [entry({ state: 'stopped' })], costDetail: { totalUsd: 2, agents: [{ agentType: 'conductor', stage: 'spec', usd: 2 }] },
    audit: [{ action: 'send', at: '2026-11-13T09:00:00Z', runId: 'r1', text: 'private words' }, { action: 'permission', at: '2026-11-13T09:10:00Z', runId: 'r1' }, { action: 'run-ended', at: '2026-11-13T09:30:00Z', runId: 'r1', status: 'error', error: 'boom', reply: 'long words' }],
  };
  const facts = workFacts(detail);
  assert.equal(facts.activity[0].state, 'stopped');
  assert.equal(facts.totalUsd, 2);
  assert.deepEqual(facts.runs, [{ runId: 'r1', startedAt: '2026-11-13T09:00:00Z', endedAt: '2026-11-13T09:30:00Z', status: 'error', error: 'boom' }]);
  assert.equal('recent' in facts.activity[0], false, 'no tool calls kept');
  assert.deepEqual(workFacts(null), { activity: [], agents: [], totalUsd: null, runs: [] });
});

test('the website: the mirror’s rows (the Foreman’s task line, no terminal), or a plain empty list with a reason', () => {
  const site = mirrorWork({ activity: [entry({ state: 'running' })], costDetail: { totalUsd: 1, agents: [] } });
  assert.equal(site.rows.length, 1);
  assert.equal(site.rows[0].task, 'Build the notes table');
  assert.equal(site.rows[0].ended, 'Running');
  assert.equal(site.rows[0].ref, null, 'no terminal on the website');
  assert.equal(site.note, 'The full task each one was given shows on your laptop.');
  assert.deepEqual(mirrorWork({ slug: 'x' }), { rows: [], costs: { steps: [], totalUsd: null }, note: 'The work on this job shows here once your laptop sends it.' });
  assert.deepEqual(mirrorWork(null).rows, []);
  assert.equal(mirrorWork({ activity: [] }).note, 'No crew has worked on this job yet.');
});

test('the cache keeps the build’s work facts for the work route, from its warm entry', async () => {
  let builds = 0;
  const cache = jobPageCache({ build: async (slug) => (slug === 'a' ? (builds++, { payload: { slug }, sources: new Map(), work: { activity: [entry({})], agents: [], totalUsd: 1, runs: [] } }) : null) });
  try {
    assert.equal((await cache.work('a')).activity.length, 1);
    await cache.work('a');
    assert.equal(builds, 1, 'answered from the entry');
    await assert.rejects(cache.work('nope'), (err) => err.status === 404);
    const old = jobPageCache({ build: async () => ({ payload: {}, sources: new Map() }) });
    assert.equal(await old.work('b'), null, 'a build without work facts: none');
    old.close();
  } finally { cache.close(); }
});

test('GET /api/job/:slug/work: the rows from read.jobWork, with the page’s viewer', async () => {
  const asked = [];
  const routes = jobPageRoutes({
    read: { jobWork: async (slug, o) => { asked.push([slug, o.viewer]); return { rows: [{ id: 'c1.x' }], costs: { steps: [], totalUsd: 0 }, note: null }; } },
    sendJson: (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); },
  });
  const route = routes.find((r) => r.path.test('/api/job/abc/work'));
  assert.ok(route, 'the route is there');
  assert.equal(route.method, 'GET');
  assert.equal(route.path.test('/api/job/abc/work/more'), false);
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const m = route.path.exec(url.pathname);
    if (!m) { res.writeHead(404); return res.end('{}'); }
    try { return await route.run({ req, res, url, m }); } catch (err) { res.writeHead(err.status ?? 500); return res.end(JSON.stringify({ error: err.message })); }
  });
  await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const res = await fetch(`${base}/api/job/abc/work?viewer=0123456789abcdef`);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).rows, [{ id: 'c1.x' }]);
    await fetch(`${base}/api/job/abc/work?viewer=../../nope`);
    assert.deepEqual(asked, [['abc', '0123456789abcdef'], ['abc', null]]);
  } finally { await new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }); }
});

test('on the runner: the page reads no agent log; Details reads each log once, says the task it was given, and a quiet old row reads Stopped', { timeout: 60_000 }, async () => {
  const { createRunner } = await import('../runner/index.js');
  const { createSite } = await import('../site/index.js');
  const root = await tempRoot();
  const dirs = Object.fromEntries(['claude', 'features', 'projects', 'agents', 'skills', 'state'].map((n) => [n, path.join(root, n)]));
  const repo = path.join(root, 'sample-repo');
  for (const d of [...Object.values(dirs), repo]) await fsp.mkdir(d, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  const slug = 'notes-on-customers';
  const jobDir = path.join(dirs.features, slug);
  await fsp.mkdir(path.join(jobDir, 'briefs'), { recursive: true });
  await fsp.writeFile(path.join(jobDir, 'status.json'), JSON.stringify({ schema_version: 1, slug, title: 'Notes on customers', route: 'small', stage: 'implement', stage_state: 'working', repo: { path: repo, base_branch: 'main' }, updated_at: '2026-10-01T10:00:00Z' }));
  await fsp.writeFile(path.join(jobDir, 'briefs/001-clarify.md'), '**Notes on customers** (demo)\n\n- Managers want notes.\n');
  // The Foreman's session (a /feature session that names the job's folder) and two crew logs, from October.
  const project = path.join(dirs.projects, '-tmp-sample-repo');
  await fsp.mkdir(project, { recursive: true });
  await fsp.writeFile(path.join(project, 's-1.jsonl'), [
    line({ type: 'user', sessionId: 's-1', timestamp: '2026-10-01T10:00:00Z', message: { role: 'user', content: `<command-name>/feature</command-name> work in ${jobDir}` } }),
    line({ type: 'assistant', sessionId: 's-1', timestamp: '2026-10-01T10:01:00Z', message: { id: 'm1', model: 'claude-opus-4-6', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { subagent_type: 'feature-implementer', description: 'Build step 1', prompt: 'x' } }, { type: 'tool_use', id: 'toolu_2', name: 'Agent', input: { subagent_type: 'feature-planner', description: 'Write the plan', prompt: 'y' } }], usage: { input_tokens: 10, output_tokens: 5 } } }),
  ].join('\n') + '\n');
  const quiet = await writeCrewLog(dirs.projects, {
    sessionId: 's-1', agentId: 'b1', who: 'feature-implementer', description: 'Build step 1',
    lines: [promptLine('Implement step 1 of the plan: the notes table.', '2026-10-01T10:02:00Z'), toolLine('Bash', { command: 'npm test', description: 'Run the tests' }, '2026-10-01T10:05:00Z', 'tb')],
  });
  await writeCrewLog(dirs.projects, {
    sessionId: 's-1', agentId: 'p1', who: 'feature-planner', description: 'Write the plan',
    lines: [promptLine('Write the implementation plan from the spec.', '2026-10-01T09:30:00Z'), toolLine('SubagentHandback', { message: 'done' }, '2026-10-01T09:50:00Z', 'tp')],
  });
  const hooks = {};
  const runner = await createRunner({
    testHooks: hooks,
    host: '127.0.0.1', port: 1, token: 't', dashboardDir: DASH, claudeDir: dirs.claude, featuresDir: dirs.features, projectsDir: dirs.projects,
    agentsDir: dirs.agents, skillsDir: dirs.skills, stateDir: dirs.state, demo: true, claudePath: null,
    claudeSettingsFile: path.join(root, 'claude.json'), legacySettingsFile: null, planUsage: false, orbitStore: 'file',
    integrateDir: dirs.state, integrateRoot: path.join(DASH, '..'), siteLink: false, env: {},
  });
  let handler = null;
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  handler = createSite({ runner, port, token: 't', wireframesOrigin: 'http://127.0.0.1:1', dashboardDir: DASH });
  const get = async (p) => { const res = await fetch(`http://127.0.0.1:${port}${p}`); return { status: res.status, body: await res.json() }; };
  const logReads = [];
  try {
    assert.equal((await get(`/api/job/${slug}/page`)).status, 200);
    // Every read under the logs folder from here on is counted.
    for (const name of ['readFile', 'open', 'readdir']) {
      const real = fsp[name];
      mock.method(fsp, name, function spy(p, ...rest) { if (String(p).startsWith(dirs.projects)) logReads.push(String(p)); return real.call(this, p, ...rest); });
    }
    for (const name of ['readFileSync', 'createReadStream', 'readdirSync', 'openSync']) {
      const real = fs[name];
      mock.method(fs, name, function spy(p, ...rest) { if (String(p).startsWith(dirs.projects)) logReads.push(String(p)); return real.call(this, p, ...rest); });
    }
    syncBuiltinESMExports();
    const builds = hooks.jobPages.stats().builds;
    for (let i = 0; i < 3; i++) assert.equal((await get(`/api/job/${slug}/page`)).status, 200);
    assert.deepEqual(logReads, [], 'the page reads no agent log');
    const work = await get(`/api/job/${slug}/work`);
    assert.equal(work.status, 200, JSON.stringify(work.body));
    assert.deepEqual(work.body.rows.map((r) => [r.role, r.step, r.task, r.ended]), [
      ['Builder', 'build', 'Implement step 1 of the plan: the notes table.', 'Stopped'],
      ['Planner', 'plan', 'Write the implementation plan from the spec.', 'Done'],
    ], 'its log’s raw state says running; the job’s rule says the quiet October row stopped');
    assert.ok(logReads.includes(quiet), 'Details read the crew’s logs');
    assert.ok(Array.isArray(work.body.costs.steps));
    logReads.length = 0;
    assert.equal((await get(`/api/job/${slug}/work`)).status, 200);
    assert.deepEqual(logReads, [], 'asked again with the logs unchanged: no file read');
    assert.equal(hooks.jobPages.stats().builds, builds, 'no rebuild for the work rows');
    assert.equal((await get('/api/job/no-such-job/work')).status, 404);
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    await new Promise((r) => { server.close(r); server.closeAllConnections?.(); });
    await runner.stop();
  }
});

// ---------- Fix round 1 ----------

test('Failed names only the reply the row was part of: a clean old reply outside the last 50 audit lines, and a crash, do not take a later reply’s error', () => {
  const audit = [
    { action: 'send', at: '2026-11-13T08:00:00Z', runId: 'r1', text: 'Build step 1' },
    { action: 'run-ended', at: '2026-11-13T08:30:00Z', runId: 'r1', status: 'done', error: null },
    ...Array.from({ length: 100 }, (_, i) => ({ action: 'permission', at: `2026-11-13T09:${String(i % 60).padStart(2, '0')}:00Z`, runId: 'r1b' })),
    { action: 'send', at: '2026-11-13T10:00:00Z', runId: 'r2' },
    { action: 'run-ended', at: '2026-11-13T10:30:00Z', runId: 'r2', status: 'error', error: 'Claude Code process exited with code 1' },
    // r3 crashed: no run-ended. r4 errored after it.
    { action: 'send', at: '2026-11-13T11:00:00Z', runId: 'r3' },
    { action: 'send', at: '2026-11-13T11:30:00Z', runId: 'r4' },
    { action: 'run-ended', at: '2026-11-13T11:45:00Z', runId: 'r4', status: 'error', error: 'API Error: 500' },
  ];
  const activity = [
    entry({ agentId: 'old', state: 'stopped', startedAt: '2026-11-13T08:05:00Z', lastAt: '2026-11-13T08:20:00Z' }),
    entry({ agentId: 'bad', state: 'stopped', startedAt: '2026-11-13T10:05:00Z', lastAt: '2026-11-13T10:20:00Z' }),
    entry({ agentId: 'crash', state: 'stopped', startedAt: '2026-11-13T11:05:00Z', lastAt: '2026-11-13T11:10:00Z' }),
    entry({ agentId: 'after', state: 'stopped', startedAt: '2026-11-13T11:31:00Z', lastAt: '2026-11-13T11:40:00Z' }),
  ];
  const endedBy = (view) => Object.fromEntries(view.rows.map((r) => [activity[Number(r.id.slice(1).split('.')[0])].agentId, r.ended]));
  // The runner passes the whole audit's replies (jobDetail whole: runLines).
  const whole = endedBy(workView(workFacts({ activity, runLines: runLines(audit) })));
  assert.deepEqual(whole, { old: 'Stopped', bad: 'Failed: Claude Code process exited with code 1', crash: 'Stopped', after: 'Failed: API Error: 500' });
  // Even from only the last 50 lines, the old row is not given the later error.
  assert.equal(endedBy(workView(workFacts({ activity, audit: audit.slice(-50) }))).old, 'Stopped');
  // runLines keeps only the replies' starts and ends, without their words.
  const lines = runLines(audit);
  assert.equal(lines.length, 7);
  assert.doesNotMatch(JSON.stringify(lines), /Build step 1|private/);
});

test('the task line skips the opening of a dispatch prompt shaped like the /feature and /bugfix conductors’ (made-up words)', () => {
  const featurePrompt = [
    '**Stage:** implement (plan step 3 of 7)',
    'Job: notes-on-customers',
    'Private folder: /tmp/fw/notes-on-customers',
    'Repository: /tmp/sample-repo',
    'Worktree: /tmp/sample-repo-notes (branch feature/notes-on-customers)',
    'Follow ~/.claude/skills/workflow-common/worker-rules.md.',
    '',
    'Read first:',
    '- spec.md v2',
    '- implementation-plan.md v3',
    '',
    'Build the customer notes table and its migration (plan step 3).',
    'Checklists: all.md, db.md.',
    'Return the report described in your agent definition.',
  ].join('\n');
  assert.equal(firstInstruction(featurePrompt), 'Build the customer notes table and its migration (plan step 3).');
  assert.equal(firstInstruction('You are the Tester for this job.\n\n## Task: Run the approved checks in test-plan.md v2 and write test-report.md.'), 'Run the approved checks in test-plan.md v2 and write test-report.md.');
  assert.equal(firstInstruction('Stage: implement\nThis is a bug job: the gates file is ~/.claude/skills/bugfix/levels.md\nDiagnosis: diagnosis.md v1\nImplement step 2: the export button.'), 'Implement step 2: the export button.', 'a task line with a colon is not a label');
  assert.equal(firstInstruction('You are implementing Task 5 of the notes job: the Details rows.\nRead the plan first.'), 'You are implementing Task 5 of the notes job: the Details rows.');
  assert.equal(firstInstruction('Stage: review\nRepository: /tmp/sample-repo\nRange: abc123..def456\nReturn the report described in your agent definition.'), null, 'nothing past the opening: no task line');
});

test('a prompt that is only the opening gives the Foreman’s task line', async () => {
  const projects = path.join(await tempRoot(), 'projects');
  await writeCrewLog(projects, { sessionId: 's-1', agentId: 'r1', who: 'feature-reviewer', description: 'Review the notes diff', lines: [promptLine('Stage: review\nRepository: /tmp/sample-repo\nRange: abc123..def456\nReturn the report described in your agent definition.', '2026-11-13T10:00:00Z')] });
  const view = await jobWork({ activity: [entry({ who: 'feature-reviewer', agentId: 'r1', description: 'Review the notes diff' })] }, { logs: crewLogs({ projectsDir: projects }), now: NOW });
  assert.equal(view.rows[0].task, 'Review the notes diff');
});

test('big logs: a long non-ASCII first prompt, a big middle, an API error and a half-written last line; reads stay bounded', async () => {
  const projects = path.join(await tempRoot(), 'projects');
  const prompt = `Bygg tabellen för kundanteckningar — 日本語のメモ ${'é'.repeat(50_000)}`; // about 100 KB: past the first 64 KB read
  const middle = Array.from({ length: 600 }, (_, i) => toolLine('Read', { file_path: `/x/${'ü'.repeat(200)}-${i}.js` }, '2026-11-13T10:01:00Z', `t${i}`));
  const file = await writeCrewLog(projects, {
    sessionId: 's-1', agentId: 'big', who: 'feature-implementer', description: 'Build the notes table',
    lines: [promptLine(prompt, '2026-11-13T10:00:00Z'), ...middle, apiErrorLine('API Error: 529 Overloaded — 日本語', '2026-11-13T10:30:00Z')],
  });
  await fsp.appendFile(file, '{"type":"assistant","message":{"content":[{"type":"text","text":"half wri'); // a log being written
  const size = (await fsp.stat(file)).size;
  assert.ok(size > 400 * 1024, `a big log (${size} bytes)`);
  let bytes = 0;
  let readFiles = 0;
  const spyFs = {
    ...fsp,
    readFile: (...a) => { readFiles++; return fsp.readFile(...a); },
    open: async (...a) => {
      const fh = await fsp.open(...a);
      return { read: async (buf, off, len, pos) => { const r = await fh.read(buf, off, len, pos); bytes += r.bytesRead; return r; }, close: () => fh.close() };
    },
  };
  const got = await crewLogs({ projectsDir: projects, fs: spyFs }).read(entry({ agentId: 'big' }));
  assert.equal(got.task, firstInstruction(prompt));
  assert.ok(got.task.startsWith('Bygg tabellen för kundanteckningar — 日本語のメモ é'));
  assert.equal(got.failed, 'API Error: 529 Overloaded — 日本語', 'the half-written last line is skipped');
  assert.equal(readFiles, 0, 'never the whole file');
  assert.ok(bytes <= 64 * 1024 + 256 * 1024 + 64 * 1024, `bounded reads (${bytes} bytes)`);
  // A first prompt longer than 256 KB: no task line from the log, the Foreman's instead.
  await writeCrewLog(projects, { sessionId: 's-1', agentId: 'huge', who: 'feature-implementer', description: 'Build the notes table', lines: [promptLine(`Do it ${'x'.repeat(300 * 1024)}`, '2026-11-13T10:00:00Z')] });
  assert.equal((await crewLogs({ projectsDir: projects }).read(entry({ agentId: 'huge' }))).task, null);
});

test('the first Details reads at most READS_AT_ONCE logs at a time, and every one', async () => {
  let inFlight = 0;
  let most = 0;
  const read = new Set();
  const logs = {
    read: async (e) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => { setTimeout(r, 2); });
      inFlight--;
      read.add(e.agentId);
      return { task: `Task ${e.agentId}`, failed: null };
    },
  };
  const activity = Array.from({ length: 30 }, (_, i) => entry({ agentId: `a${i}`, startedAt: `2026-11-13T10:${String(i).padStart(2, '0')}:00Z` }));
  const view = await jobWork({ activity }, { logs, now: NOW });
  assert.equal(read.size, 30);
  assert.ok(most <= READS_AT_ONCE, `at most ${READS_AT_ONCE} at once (saw ${most})`);
  assert.equal(most, READS_AT_ONCE);
  assert.equal(view.rows[0].task, 'Task a29');
});

// ---------- Fix round 2 ----------

test('a heading or a bare label is never the task: “## Task”, “Task:”, “## Your task” name the next line; “## Context” is skipped with its list', () => {
  assert.equal(firstInstruction('Stage: implement\n\n## Task\n\nBuild the customer notes table.\nThen run the checks.'), 'Build the customer notes table.');
  assert.equal(firstInstruction('Job: notes-on-customers\nTask:\nAdd the export button to the notes page.'), 'Add the export button to the notes page.');
  assert.equal(firstInstruction('### Your task\n- Fix the date filter on the notes list.'), 'Fix the date filter on the notes list.');
  assert.equal(firstInstruction('## Context\n- The notes page exists.\n- Managers use it daily.\n\n## Task\nAdd the export button.'), 'Add the export button.');
  assert.equal(firstInstruction('## Context\nTask:'), null, 'labels only: no task line');
  for (const t of ['## Task', 'Task:', '## Your task', '## Context']) assert.notEqual(firstInstruction(`${t}\nDo the thing well.`), t.replace(/^#+ /, ''));
});

test('the opening skip is loose: a role line keeps what follows it; long “Use …” and “Report: …” sentences are not boilerplate', () => {
  assert.equal(firstInstruction('You are the implementer for this job: build the notes table and its migration.'), 'Build the notes table and its migration.');
  assert.equal(firstInstruction('You are the Builder for this job.\nAdd the export button.'), 'Add the export button.', 'a role line alone is still skipped');
  const use = 'Use the existing customer service to load the notes, and add a paged list with a search box on top of it.';
  assert.equal(firstInstruction(`Stage: implement\n${use}`), use);
  const report = 'Report: write what changed, why, and which checks you ran into implementation-log.md before you hand back.';
  assert.equal(firstInstruction(`Stage: implement\n${report}`), report);
  assert.equal(firstInstruction('Use ~/.claude/skills/workflow-common/worker-rules.md.\nReport: as usual.\nFix the login page.'), 'Fix the login page.', 'short ones are still skipped');
});

// ---------- Fix round 3 ----------

test('a role line’s tail is the task only after a colon or a dash, and only when it is not boilerplate itself', () => {
  const next = '\nAdd the export button to the notes page.';
  assert.equal(firstInstruction(`You are the feature-implementer for job notes-on-customers (stage Build).${next}`), 'Add the export button to the notes page.');
  assert.equal(firstInstruction(`You are the Builder for this job, working in /tmp/sample-repo-notes${next}`), 'Add the export button to the notes page.');
  assert.equal(firstInstruction(`You are the Builder for this job. Read ~/.claude/rules.md first.${next}`), 'Add the export button to the notes page.');
  assert.equal(firstInstruction('You are the feature-implementer for job notes-on-customers (stage Build).'), null, 'nothing else: the description is used');
  assert.equal(firstInstruction(`You are the Builder for this job: read ~/.claude/rules.md first.${next}`), 'Add the export button to the notes page.', 'a boilerplate tail after a colon is skipped too');
  assert.equal(firstInstruction('You are the Builder for this job — fix the date filter.'), 'Fix the date filter.');
});

test('emphasis is not a separator; after “## Task” further headings are skipped', () => {
  assert.equal(firstInstruction('***Important:*** fix the login page on Safari.'), 'Important: fix the login page on Safari.');
  assert.equal(firstInstruction('---\n* * *\n===== FACTS START =====\nFix the login page.'), 'Fix the login page.', 'separators and a block’s edge are skipped');
  assert.equal(firstInstruction('## Task\n### Details\n#### Step 3\nBuild the notes table.'), 'Build the notes table.');
  assert.equal(firstInstruction('Run the checks in src/*.js and keep test_plan.md as it is.'), 'Run the checks in src/*.js and keep test_plan.md as it is.', 'a star in a path stays');
});
