import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { composeReply } from '../lib/compose.js';
import { describePermission } from '../lib/permissions.js';
import { renderMarkdown, indexIds } from '../lib/markdown.js';
import { commits, show, parseLog, splitPatch } from '../lib/git.js';
import { checkWrite, hostAllowed, HttpError } from '../lib/http-guard.js';
import { costCsv, costMarkdown, whatIfConductor } from '../lib/cost.js';
import { Driver, Busy } from '../lib/driver.js';
import { State } from '../lib/state.js';

// ---------- composing replies ----------

const status = {
  brief: { number: 6 },
  nextProposed: 'Small fix round, then PR #1',
  spec: { version: '0.4', status: 'DRAFT' },
  artifacts: [{ name: 'Implementation plan', version: '1' }],
  questions: [
    { id: '1', text: 'Fix R-2 now?', recommendation: 'a', options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'Later' }] },
    { id: '2', text: 'File name?', recommendation: null, options: [] },
  ],
  decidedOnYourBehalf: [
    { id: 'D-1', decision: 'CSV only', confirmed: false },
    { id: 'D-2', decision: '10k rows', confirmed: false },
    { id: 'D-3', decision: 'Old one', confirmed: true },
  ],
};

test('compose: approve with answers, decisions and versions', () => {
  const text = composeReply({
    kind: 'approve', status,
    answers: { 1: { choice: 'a' }, 2: { other: 'widgets.csv' } },
    verdicts: { 'D-1': { verdict: 'confirm' }, 'D-2': { verdict: 'change', note: '50k rows' } },
  });
  assert.equal(text, [
    'My answers to brief 6:',
    '1. Fix R-2 now? → a) Yes',
    '2. File name? → widgets.csv',
    '',
    'Decided on my behalf, confirmed: D-1.',
    'Decided on my behalf, changed: D-2: 50k rows',
    '',
    'I approve. Go ahead with the next stage: Small fix round, then PR #1',
    'At these versions: spec v0.4 (DRAFT), Implementation plan v1.',
  ].join('\n'));
});

test('compose: unconfirmed decisions are named, not silently confirmed', () => {
  const text = composeReply({ kind: 'approve', status, answers: {} });
  assert.match(text, /Not confirmed yet: D-1, D-2\./);
  assert.doesNotMatch(text, /D-3/);
});

test('compose: changes, stop and free messages', () => {
  assert.match(composeReply({ kind: 'changes', status: {}, note: 'Rename the button' }), /stay in the current stage:\nRename the button$/);
  assert.match(composeReply({ kind: 'stop', status: {} }), /^Stop here\./);
  assert.equal(composeReply({ kind: 'message', status: {}, note: '  Explain finding 3  ' }), 'Explain finding 3');
});

// ---------- permission cards ----------

test('describePermission: plain words for common tools', () => {
  const bash = describePermission('Bash', { command: 'npm test', description: 'Run the unit tests' });
  assert.equal(bash.headline, 'Run a command in the terminal');
  assert.equal(bash.detail, 'Run the unit tests');
  assert.equal(bash.preview, 'npm test');
  assert.equal(bash.risk, 'normal');
  assert.equal(describePermission('Bash', { command: 'git push origin main' }).risk, 'high');
  const edit = describePermission('Edit', { file_path: '/r/app/x.ts', old_string: 'a', new_string: 'b' }, { cwd: '/r' });
  assert.equal(edit.headline, 'Change a file: app/x.ts');
  assert.equal(edit.preview, '- a\n+ b');
  assert.equal(describePermission('mcp__github__create_pr', {}).headline, 'Use “create_pr” from the github connection');
  // The folder outside the project comes as its own field, exactly as given, never mixed into detail.
  const outside = describePermission('Bash', { command: 'ls', description: 'List **it**' }, { blockedPath: '/etc/__pycache__/a*b' });
  assert.equal(outside.blockedPath, '/etc/__pycache__/a*b');
  assert.equal(outside.detail, 'List **it**');
  assert.equal(describePermission('Read', { file_path: '/x' }).blockedPath, undefined);
});

// ---------- Markdown ----------

test('markdown: raw HTML and unsafe links are neutralised', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1)) [ok](https://example.com) <img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">ok<\/a>/);
});

test('markdown: requirement IDs link to their definition, but not inside links or code', () => {
  const html = renderMarkdown('FR-001 covers AC-002. See [FR-003](https://example.com). `AC-009`', { idHref: (id) => `#/job/x/id/${id}` });
  assert.match(html, /<a class="id-link" href="#\/job\/x\/id\/FR-001" data-id="FR-001">FR-001<\/a>/);
  assert.match(html, /data-id="AC-002"/);
  assert.doesNotMatch(html, /data-id="FR-003"/);
  assert.doesNotMatch(html, /data-id="AC-009"/);
});

test('indexIds: finds the definition (preferring the spec) and every mention', () => {
  const idx = indexIds([
    { name: 'Plan', file: 'implementation-plan.md', text: 'S1 implements FR-001.\n| FR-001 | wrongly looks like a definition |' },
    { name: 'Spec', file: 'spec', isSpec: true, text: '## Requirements\n| FR-001 | Copy the full ID |\nAC-001: copies' },
  ]);
  assert.equal(idx['FR-001'].definition.doc, 'Spec');
  assert.equal(idx['FR-001'].mentions.length, 3);
  assert.equal(idx['AC-001'].definition.line, 3);
});

// ---------- git ----------

test('git: commits on a branch and one commit’s diff', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-git-'));
  const run = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString();
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 't@example.invalid'); run('config', 'user.name', 'T');
  await fs.writeFile(path.join(dir, 'a.txt'), 'one\n'); run('add', '.'); run('commit', '-q', '-m', 'Start');
  const base = run('rev-parse', 'HEAD').trim();
  run('switch', '-q', '-c', 'feature/x');
  await fs.writeFile(path.join(dir, 'a.txt'), 'one\ntwo\n'); run('commit', '-qam', 'feat(app): add two [S1]');
  await fs.writeFile(path.join(dir, 'b.txt'), 'new\n'); run('add', '.'); run('commit', '-q', '-m', 'S2: add b');
  const list = await commits(dir, { base, head: 'feature/x' });
  assert.deepEqual(list.map((c) => c.subject), ['S2: add b', 'feat(app): add two [S1]']);
  assert.deepEqual(list.map((c) => c.step), ['S2', 'S1']);
  const one = await show(dir, list[1].sha);
  assert.deepEqual(one.files, [{ path: 'a.txt', added: 1, removed: 0 }]);
  assert.ok(one.patchFiles[0].lines.includes('+two'));
  await assert.rejects(commits(dir, { base: '--output=/tmp/x', head: 'feature/x' }), /Unexpected/);
  await assert.rejects(show(dir, 'HEAD; rm -rf /'), /Unexpected/);
  await fs.rm(dir, { recursive: true, force: true });
});

test('git: patch splitting trims very large diffs', () => {
  const big = ['diff --git a/x b/x', 'index 1..2', '--- a/x', '+++ b/x', ...Array.from({ length: 50 }, (_, i) => `+line ${i}`)].join('\n');
  const out = splitPatch(big, 20);
  assert.equal(out.truncated, true);
  assert.equal(out.patchFiles[0].path, 'x');
  assert.ok(out.patchFiles[0].lines.every((l) => l.startsWith('+')));
  assert.deepEqual(parseLog(''), []);
});

// ---------- request safety ----------

test('checkWrite: token, origin and JSON are all required', () => {
  const ok = { 'x-workshop-token': 't0k', origin: 'http://127.0.0.1:4477', 'content-type': 'application/json' };
  assert.doesNotThrow(() => checkWrite(ok, { port: 4477, token: 't0k' }));
  assert.doesNotThrow(() => checkWrite({ ...ok, origin: undefined }, { port: 4477, token: 't0k' }));
  assert.throws(() => checkWrite({ ...ok, 'x-workshop-token': 'nope' }, { port: 4477, token: 't0k' }), (e) => e instanceof HttpError && e.status === 403);
  assert.throws(() => checkWrite({ ...ok, origin: 'https://evil.example' }, { port: 4477, token: 't0k' }), /Wrong origin/);
  assert.throws(() => checkWrite({ ...ok, 'content-type': 'text/plain' }, { port: 4477, token: 't0k' }), /JSON/);
  assert.throws(() => checkWrite(ok, { port: 4477, token: '' }), /must come from/);
  assert.equal(hostAllowed('127.0.0.1:4477'), true);
  assert.equal(hostAllowed('localhost'), true);
  assert.equal(hostAllowed('evil.example:4477'), false);
});

// ---------- cost reports ----------

const job = (title, agents) => ({
  title, slug: title.toLowerCase(), project: { name: 'acme' }, kind: 'feature', route: 'small', stage: 'review',
  cost: { totalUsd: agents.reduce((s, a) => s + a.usd, 0), source: 'claude-code', perModel: { 'claude-fable-5-1': agents[0].usd }, agents },
});
const tokens = { input: 0, output: 100000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };

test('cost export: CSV rows, Markdown report and what-if', () => {
  const features = [job('=Widget', [{ agentType: 'conductor', stage: 'spec', model: 'claude-fable-5-1', usd: 5, tokens }, { agentType: 'feature-planner', stage: 'plan', model: 'claude-opus-5-5', usd: 2, tokens }])];
  const csv = costCsv(features);
  assert.match(csv.split('\n')[0], /^Job,Project,Kind,Route,Stage,Crew member,Model/);
  assert.match(csv, /^'=Widget,acme,feature,small,spec,Foreman \(conductor\),Fable 5\.1,0,100000,0,0,5\.0000,Claude Code figure$/m);
  const md = costMarkdown(features, { generatedAt: new Date('2026-10-12T10:00:00Z') });
  assert.match(md, /\*\*Total across 1 job: \$7\.00\*\*/);
  assert.match(md, /\| =Widget \| acme \| review \| \$7\.00 \| 71% \| Claude Code figure \|/);
  const w = whatIfConductor(features[0].cost.agents);
  assert.equal(w.actual, 5);
  assert.equal(Math.round(w.alternatives.opus * 100) / 100, 2);
  assert.equal(Math.round(w.alternatives.fable * 100) / 100, 5);
});

// ---------- the driver, with a pretend Claude ----------

function fakeSession(script) {
  return ({ prompt, options }) => {
    let interrupted = false;
    const gen = (async function* () {
      const first = await prompt[Symbol.asyncIterator]().next();
      yield* script({ text: first.value.message.content, options, isInterrupted: () => interrupted });
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

test('driver: a permission waits for a click, then the reply finishes', async () => {
  const state = await tmpState();
  let decision = null;
  const queryFn = fakeSession(async function* ({ text, options }) {
    yield { type: 'system', subtype: 'init', session_id: 's-1', model: 'claude-fable-5-1', apiKeySource: 'none' };
    decision = await options.canUseTool('Bash', { command: 'npm test' }, { signal: new AbortController().signal, toolUseID: 't', requestId: 'r', suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'localSettings' }] });
    yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: `Got: ${text}` }] } };
    yield { type: 'result', subtype: 'success', is_error: false, result: 'brief', total_cost_usd: 1.25, permission_denials: [] };
  });
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent' });
  driver.idleGraceMs = 30;
  const seen = [];
  driver.on('permission', (p) => seen.push(p));
  const run = await driver.start({ featureDir: '/f/a', slug: 'a', title: 'A', cwd: '/repo', text: 'go' });
  await assert.rejects(driver.start({ featureDir: '/f/a', slug: 'a', title: 'A', cwd: '/repo', text: 'again' }), Busy);
  await until(driver, run.id, ['waiting_permission']);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].plain.headline, 'Run a command in the terminal');
  assert.equal(seen[0].canAllowForRun, true);
  assert.equal(seen[0].originalInput, undefined, 'raw input is not sent to the page twice');
  assert.equal(driver.pendingPermissions().length, 1);
  await driver.decide(seen[0].id, { decision: 'allow-run' });
  const done = await until(driver, run.id, ['done', 'error']);
  assert.equal(done.status, 'done');
  assert.equal(done.sessionId, 's-1');
  assert.equal(done.costUsd, 1.25);
  assert.equal(done.lastText, 'Got: go');
  assert.equal(decision.behavior, 'allow');
  assert.deepEqual(decision.updatedPermissions.map((u) => u.destination), ['session'], '“for this reply” never writes settings');
  assert.equal((await state.sessionFor('/f/a')).sessionId, 's-1');
  const audit = await state.auditFor('/f/a');
  assert.deepEqual(audit.map((e) => e.action), ['send', 'permission', 'run-ended']);
  assert.equal(audit[0].text, 'go');
});

test('driver: deny passes the note on; the reply waits for background workers', async () => {
  const state = await tmpState();
  let release;
  const workerDone = new Promise((r) => { release = r; });
  let denial = null;
  const queryFn = fakeSession(async function* ({ options }) {
    yield { type: 'system', subtype: 'init', session_id: 's-2' };
    yield { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'w1', task_type: 'local_agent', subagent_type: 'feature-implementer', description: 'S1' }] };
    yield { type: 'result', subtype: 'success', is_error: false, result: 'started', total_cost_usd: 0.5, permission_denials: [] };
    denial = await options.canUseTool('Write', { file_path: '/repo/x', content: 'y' }, { signal: new AbortController().signal, toolUseID: 't', requestId: 'r', agentID: 'a1' });
    await workerDone;
    yield { type: 'system', subtype: 'background_tasks_changed', tasks: [] };
    yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Brief after the worker' }] } };
    yield { type: 'result', subtype: 'success', is_error: false, result: 'brief', total_cost_usd: 2, permission_denials: [] };
  });
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent' });
  driver.idleGraceMs = 30;
  driver.on('permission', (p) => setTimeout(() => driver.decide(p.id, { decision: 'deny', note: 'not that file' }), 10));
  const run = await driver.start({ featureDir: '/f/b', slug: 'b', title: 'B', cwd: '/repo', text: 'go' });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(driver.runs.get(run.id).status, 'running', 'still running while a worker is in the background');
  assert.equal(denial.behavior, 'deny');
  assert.match(denial.message, /not that file/);
  release();
  const done = await until(driver, run.id, ['done', 'error']);
  assert.equal(done.lastText, 'Brief after the worker');
  assert.equal(done.costUsd, 2);
});

test('driver: pause interrupts and reports stopped, not an error', async () => {
  const state = await tmpState();
  const queryFn = fakeSession(async function* ({ isInterrupted }) {
    yield { type: 'system', subtype: 'init', session_id: 's-3' };
    while (!isInterrupted()) await new Promise((r) => setTimeout(r, 10));
    yield { type: 'result', subtype: 'error_during_execution', is_error: true, result: '', total_cost_usd: 0.1, permission_denials: [] };
  });
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent' });
  driver.idleGraceMs = 30;
  const run = await driver.start({ featureDir: '/f/c', slug: 'c', title: 'C', cwd: '/repo', text: 'go' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await driver.stop(run.id), true);
  const done = await until(driver, run.id, ['stopped', 'error', 'done']);
  assert.equal(done.status, 'stopped');
  assert.equal(done.error, null);
});
