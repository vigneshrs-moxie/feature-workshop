import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseWorkflowStatus } from '../lib/workflow-status.js';
import { parseStatusJson } from '../lib/status-json.js';
import { parseSessionLog, usageByModel, activityState, describeTool } from '../lib/session-log.js';
import { estimateCost, tokensFromUsage, calibrationFactors, toCsv, modelFamily } from '../lib/cost.js';
import { detectStage, detectState } from '../lib/stages.js';
import { parseTable } from '../lib/markdown-tables.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (f) => fs.readFile(path.join(FIX, f), 'utf8');
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// ---------- workflow-status.md ----------

test('workflow-status: standard format', async () => {
  const ws = parseWorkflowStatus(await read('workflow-status-standard.md'));
  assert.equal(ws.ok, true);
  assert.equal(ws.title, 'Widget Export');
  assert.equal(ws.slug, 'widget-export');
  assert.equal(ws.route, 'small');
  assert.deepEqual(
    { path: ws.spec.path, version: ws.spec.version, status: ws.spec.status },
    { path: '/tmp/widget-repo/docs/plans/2026-10-01-widget-export-product-spec.md', version: '0.3', status: 'DRAFT' },
  );
  assert.equal(ws.repository.branch, 'main');
  assert.equal(ws.repository.commit, '1a2b3c4');
  assert.equal(ws.worktree, '/tmp/orbit-widget-export');
  assert.equal(ws.stage, 'review');
  assert.equal(ws.stageState, 'waiting_for_you');
  assert.equal(ws.nextProposed, 'PR #1 after your go-ahead');
  assert.equal(ws.artifacts.length, 3);
  assert.equal(ws.artifacts[1].path, 'findings.md');
  assert.equal(ws.artifacts[1].basedOn, 'spec v0.2, commit 1a2b3c4');
  assert.equal(ws.approvals.length, 3);
  assert.equal(ws.approvals[1].superseded, true);
  assert.equal(ws.approvals[0].superseded, false);
  assert.equal(ws.approvals[2].said, '"yes | go"', 'escaped pipe stays inside the cell');
  assert.equal(ws.history.length, 2);
});

test('workflow-status: free-form file still yields stage, state and approvals', async () => {
  const ws = parseWorkflowStatus(await read('workflow-status-freeform.md'));
  assert.equal(ws.ok, true);
  assert.equal(ws.title, 'Bulk Archive');
  assert.equal(ws.route, null);
  assert.equal(ws.stage, 'plan');
  assert.equal(ws.stageState, 'waiting_for_you');
  assert.equal(ws.updated, '2026-10-05');
  assert.equal(ws.artifacts.length, 2);
  assert.equal(ws.artifacts[0].version, 'v1.0. Reviewed.');
  assert.equal(ws.approvals.length, 2);
  assert.equal(ws.approvals[0].date, '2026-10-04');
  assert.match(ws.nextProposed, /Human review/);
});

test('workflow-status: empty or junk input never throws', () => {
  assert.equal(parseWorkflowStatus('').ok, false);
  assert.equal(parseWorkflowStatus(undefined).ok, false);
  const junk = parseWorkflowStatus('just some words\n| broken | table\n');
  assert.equal(junk.ok, true);
  assert.equal(junk.stage, null);
  assert.ok(junk.warnings.length > 0);
});

test('stage and state detection', () => {
  assert.equal(detectStage('Planning: complete. Implementation plan awaiting review'), 'plan');
  assert.equal(detectStage('review · presented for review (implementation S1–S3)'), 'review');
  assert.equal(detectStage('spec update after findings'), 'spec-update');
  assert.equal(detectStage('PR #2 waiting for Raj'), 'pr2');
  assert.equal(detectStage('test · in progress'), 'test');
  assert.equal(detectStage('nothing here'), null);
  assert.equal(detectState('presented for review'), 'waiting_for_you');
  assert.equal(detectState('implement · in progress'), 'working');
  assert.equal(detectState('stopped by request'), 'done');
  assert.equal(detectState('blocked on permissions'), 'blocked');
});

test('markdown table with backticked pipes', () => {
  const rows = parseTable('| A | B |\n|---|---|\n| `x | y` | z |\n');
  assert.deepEqual(rows, [{ a: '`x | y`', b: 'z' }]);
});

// ---------- status.json ----------

test('status.json: valid file, with limits and unsafe values cleaned', async () => {
  const s = parseStatusJson(await read('status-valid.json'));
  assert.equal(s.ok, true);
  assert.equal(s.stage, 'review');
  assert.equal(s.stageState, 'waiting_for_you');
  assert.equal(s.waitingFor, 'answers');
  assert.equal(s.questions.length, 3, 'at most three questions');
  assert.equal(s.questions[0].recommendation, 'a');
  assert.deepEqual(s.questions[1].options, []);
  assert.equal(s.decidedOnYourBehalf[0].confirmed, false);
  assert.equal(s.spec.version, '0.3', 'numeric version becomes a string');
  assert.equal(s.baseSha, '1a2b3c4');
  assert.equal(s.prs.length, 3);
  assert.equal(s.prs[0].url, 'https://github.com/example/repo/pull/7');
  assert.equal(s.prs[1].url, null, 'non-GitHub URL dropped');
  assert.equal(s.prs[1].state, null, 'unknown PR state dropped');
  assert.equal(s.prs[2].state, 'not_started');
  assert.ok(s.warnings.some((w) => w.includes('prs[2].state')));
});

test('status.json: bad JSON and bad enums', () => {
  assert.equal(parseStatusJson('{nope').ok, false);
  assert.equal(parseStatusJson('[]').ok, false);
  const s = parseStatusJson(JSON.stringify({ schema_version: 2, stage: 'deploy', stage_state: 'snoozing' }));
  assert.equal(s.ok, true);
  assert.equal(s.stage, null);
  assert.equal(s.stageState, null);
  assert.equal(s.warnings.length, 3);
});

// ---------- session logs ----------

test('session log: dedupes repeated message lines, finds dispatches and cost-state', async () => {
  const p = parseSessionLog(await read('projects/-tmp-widget-repo/sess-widget-1.jsonl'));
  assert.equal(p.sessionId, 'sess-widget-1');
  assert.equal(p.messages.size, 2, 'message m1 logged twice counts once');
  assert.equal(p.badLines, 1);
  assert.match(p.firstPrompt, /^\/feature Add widget export/);
  assert.equal(p.dispatches.length, 1);
  assert.equal(p.dispatches[0].agentType, 'feature-spec-writer');
  assert.equal(p.cliCost.totalUsd, 0.702012);
  assert.equal(p.lastStopReason, 'end_turn');
  assert.equal(activityState(p, Date.parse('2026-10-03T09:06:00Z')), 'finished');
});

test('session log: subagent usage by model and running state', async () => {
  const p = parseSessionLog(await read('projects/-tmp-widget-repo/sess-widget-1/subagents/agent-a1.jsonl'));
  const u = usageByModel(p);
  close(u['claude-opus-5-5'].estimateUsd, 0.102012);
  assert.equal(u['claude-opus-5-5'].tokens.output, 2500);
  // Cut the log after its first tool call: it is mid-work.
  const partial = parseSessionLog((await read('projects/-tmp-widget-repo/sess-widget-1/subagents/agent-a1.jsonl')).split('\n').slice(0, 2).join('\n'));
  assert.equal(activityState(partial, Date.parse('2026-10-03T09:02:00Z')), 'running');
  assert.equal(activityState(partial, Date.parse('2026-10-03T10:00:00Z')), 'idle');
  assert.equal(partial.lastAction.text, 'Writing spec.md');
});

test('describeTool gives plain one-liners', () => {
  assert.equal(describeTool('Read', { file_path: '/a/b/findings.md' }), 'Reading findings.md');
  assert.equal(describeTool('Bash', { command: 'npm test', description: 'Run the unit tests' }), 'Run the unit tests');
  assert.match(describeTool('Agent', { subagent_type: 'feature-tester', description: 'Run checks' }), /feature-tester: Run checks/);
  assert.equal(describeTool('Mystery', {}), 'Using Mystery');
});

// ---------- cost ----------

test('cost: prices, cache-write rates and unknown models', () => {
  const t = tokensFromUsage({ input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation: { ephemeral_5m_input_tokens: 1e6, ephemeral_1h_input_tokens: 1e6 } });
  // Fable: 10 + 50 + 0.25 + 12.5 + 20
  close(estimateCost('claude-fable-5-1', t), 92.75);
  // Without the breakdown, cache writes are treated as 5-minute writes.
  close(estimateCost('claude-sonnet-5-5', tokensFromUsage({ cache_creation_input_tokens: 1e6 })), 2.5);
  assert.equal(estimateCost('some-other-model', t), null);
  assert.equal(modelFamily('claude-haiku-5-5'), 'haiku');
});

test('cost: calibration and CSV safety', () => {
  const f = calibrationFactors({ a: 2, b: 0, c: 1 }, { a: 3, b: 1 });
  assert.deepEqual(f, { a: 1.5, b: 1, c: 1 });
  const csv = toCsv(['name', 'usd'], [['=HYPERLINK("x")', 1.5], ['a, "b"', null]]);
  assert.equal(csv, 'name,usd\n"\'=HYPERLINK(""x"")",1.5\n"a, ""b""",\n');
});
