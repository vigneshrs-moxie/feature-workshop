import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseWorkflowStatus } from '../lib/workflow-status.js';
import { parseStatusJson } from '../lib/status-json.js';
import { parseSessionLog, usageByModel, activityState, quietHint, describeTool, spendSince } from '../lib/session-log.js';
import { estimateCost, tokensFromUsage, calibrationFactors, toCsv, modelFamily, modelLabel } from '../lib/cost.js';
import { agentInfo, detectStage, detectState } from '../lib/stages.js';
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
  assert.equal(detectStage('Wireframes v2 ready for review'), 'wireframe');
  assert.equal(detectStage('clarify · waiting for your answers'), 'clarify');
  assert.deepEqual(agentInfo('feature-wireframer'), { name: 'Painter', role: 'Draws the feature’s screens (wireframes) from the spec', stage: 'wireframe' }, 'the wireframer is the Painter at the screens stage');
  assert.equal(agentInfo('feature-review-ui').stage, 'review');
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

test('status.json: a clarify brief may ask five questions, each option with its consequence', () => {
  const q = (i) => ({ id: String(i), text: `Question ${i}?`, recommendation: 'a', options: [
    { id: 'a', label: 'Phoenix only', consequence: 'One office rule; ships this week' },
    { id: 'b', label: 'All offices', consequence: 'Needs the scoping lens; L3' },
    { id: 'c', label: 'Later' },
  ] });
  const base = { schema_version: 1, slug: 'x', title: 'X', stage_state: 'waiting_for_you', waiting_for: 'answers', questions: [1, 2, 3, 4, 5, 6].map(q) };
  const clarify = parseStatusJson(JSON.stringify({ ...base, stage: 'clarify' }));
  assert.equal(clarify.ok, true);
  assert.equal(clarify.stage, 'clarify');
  assert.equal(clarify.questions.length, 5, 'five on a clarify brief');
  assert.deepEqual(clarify.questions[0].options.map((o) => o.consequence), ['One office rule; ships this week', 'Needs the scoping lens; L3', null]);
  const spec = parseStatusJson(JSON.stringify({ ...base, stage: 'spec' }));
  assert.equal(spec.questions.length, 3, 'three anywhere else');
  assert.equal(parseStatusJson(JSON.stringify({ ...base, stage: 'wireframe' })).stage, 'wireframe', 'the screens stage is a known stage');
  // A consequence that isn't a line of text is dropped, a long one is cut.
  const odd = parseStatusJson(JSON.stringify({ ...base, stage: 'clarify', questions: [{ id: '1', text: 'Q', options: [{ id: 'a', label: 'A', consequence: 42 }, { id: 'b', label: 'B', consequence: 'x'.repeat(300) }] }] }));
  assert.equal(odd.questions[0].options[0].consequence, null);
  assert.equal(odd.questions[0].options[1].consequence.length, 200);
});

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
  assert.equal(activityState(p), 'finished');
});

test('session log: subagent usage by model and running state', async () => {
  const p = parseSessionLog(await read('projects/-tmp-widget-repo/sess-widget-1/subagents/agent-a1.jsonl'));
  const u = usageByModel(p);
  close(u['claude-opus-5-5'].estimateUsd, 0.102012);
  assert.equal(u['claude-opus-5-5'].tokens.output, 2500);
  // Cut the log after its first tool call: it is mid-work.
  const partial = parseSessionLog((await read('projects/-tmp-widget-repo/sess-widget-1/subagents/agent-a1.jsonl')).split('\n').slice(0, 2).join('\n'));
  assert.equal(activityState(partial), 'running', 'no time limit: still working until it finishes');
  assert.equal(quietHint(partial, Date.parse('2026-10-03T09:03:00Z')), null, 'no hint in the first 5 minutes');
  assert.equal(quietHint(partial, Date.parse('2026-10-05T09:00:00Z')).tool, 'Write', 'a hint, however long it has been');
  // The conductor waiting on a worker it dispatched is delegating, not working itself.
  const conductor = parseSessionLog((await read('projects/-tmp-widget-repo/sess-widget-1.jsonl')).split('\n').slice(0, 4).join('\n'));
  assert.equal(activityState(conductor), 'delegating');
  assert.equal(partial.lastAction.text, 'Writing spec.md');
});

// Log lines as Claude Code writes them: an assistant tool call, and the user line holding its result.
const toolCall = (id, name, at, msgId = `m-${id}`) => JSON.stringify({
  type: 'assistant', timestamp: at, message: { id: msgId, model: 'claude-opus-5-5', stop_reason: null, content: [{ type: 'tool_use', id, name, input: {} }] },
});
const toolResult = (id, at) => JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const workerStart = JSON.stringify({ type: 'user', timestamp: '2026-11-10T09:00:00Z', message: { role: 'user', content: 'Stage: Implement.' } });
const handedBackLog = [workerStart, toolCall('t1', 'Bash', '2026-11-10T09:01:00Z'), toolResult('t1', '2026-11-10T09:01:05Z'), toolCall('t2', 'SubagentHandback', '2026-11-10T09:02:00Z'), toolResult('t2', '2026-11-10T09:02:01Z')];

test('a worker log ending in a hand-back is finished', () => {
  const p = parseSessionLog(handedBackLog.join('\n'));
  assert.equal(p.handedBack, true);
  assert.equal(activityState(p), 'finished');
});

test('an unanswered hand-back is finished too', () => {
  const p = parseSessionLog(handedBackLog.slice(0, -1).join('\n'));
  assert.equal(p.handedBack, true);
  assert.equal(activityState(p), 'finished');
});

test('C-M1: a worker resumed with a new prompt after its hand-back is running before it writes again', () => {
  const resumed = JSON.stringify({ type: 'user', timestamp: '2026-11-10T09:30:01Z', message: { role: 'user', content: 'Fix round: two things' } });
  const p = parseSessionLog([...handedBackLog, resumed].join('\n'));
  assert.equal(p.handedBack, false);
  assert.equal(activityState(p), 'running');
  const blocks = JSON.stringify({ type: 'user', timestamp: '2026-11-10T09:30:01Z', message: { role: 'user', content: [{ type: 'text', text: 'Fix round' }] } });
  assert.equal(activityState(parseSessionLog([...handedBackLog, blocks].join('\n'))), 'running', 'a prompt in blocks too');
  assert.equal(parseSessionLog(handedBackLog.join('\n')).handedBack, true, 'the hand-back\'s own tool result is no new prompt');
});

test('a finished worker stays finished: an isMeta user line with text, or one carrying a tool result with text, does not clear its hand-back; a real prompt does', () => {
  const meta = JSON.stringify({ type: 'user', isMeta: true, timestamp: '2026-11-10T09:30:00Z', message: { role: 'user', content: [{ type: 'text', text: 'Caveat: the messages below were generated by the user while running local commands.' }] } });
  const metaString = JSON.stringify({ type: 'user', isMeta: true, timestamp: '2026-11-10T09:30:00Z', message: { role: 'user', content: '<system-reminder>…</system-reminder>' } });
  const resultWithText = JSON.stringify({ type: 'user', timestamp: '2026-11-10T09:30:00Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }, { type: 'text', text: 'Hook said: done.' }] } });
  for (const line of [meta, metaString, resultWithText]) {
    const p = parseSessionLog([...handedBackLog, line].join('\n'));
    assert.equal(p.handedBack, true, line);
    assert.equal(activityState(p), 'finished');
  }
  const prompt = JSON.stringify({ type: 'user', timestamp: '2026-11-10T09:31:00Z', message: { role: 'user', content: 'Fix round: one more thing' } });
  assert.equal(activityState(parseSessionLog([...handedBackLog, meta, prompt].join('\n'))), 'running');
});

test('a hand-back followed by more work is not finished', () => {
  const p = parseSessionLog([...handedBackLog, toolCall('t3', 'Bash', '2026-11-10T09:03:00Z')].join('\n'));
  assert.equal(p.handedBack, false);
  assert.equal(activityState(p), 'running');
});

test('the parser records answered tool calls', () => {
  const p = parseSessionLog([toolCall('toolu_A', 'Agent', '2026-11-10T09:00:00Z'), toolResult('toolu_A', '2026-11-10T09:10:00Z')].join('\n'));
  assert.equal(p.answeredToolUses.get('toolu_A'), '2026-11-10T09:10:00Z', 'when the result came back');
  assert.equal(p.answeredToolUses.has('toolu_B'), false);
});

test('spendSince counts only messages from that time on', async () => {
  const p = parseSessionLog(await read('projects/-tmp-widget-repo/sess-widget-1.jsonl'));
  const all = spendSince(p, 0);
  close(all.usd, 0.51515);
  const later = spendSince(p, Date.parse('2026-10-03T09:01:00Z'));
  close(later.usd, 0.04005);
  assert.equal(later.tokens, 5 + 200 + 120000);
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
  // Fable 5.2: 8 + 40 + 0.2 + 10 + 16
  close(estimateCost('claude-fable-5-2', t), 74.2);
  // Fable 5.1 in older logs keeps its own price (10 + 50 + 0.25 + 12.5 + 20) and name, with or without a 1M suffix.
  close(estimateCost('claude-fable-5-1', t), 92.75);
  close(estimateCost('claude-fable-5-1[1m]', t), 92.75);
  assert.equal(modelLabel('claude-fable-5-1'), 'Fable 5.1');
  assert.equal(modelLabel('claude-fable-5-2'), 'Fable 5.2');
  assert.equal(modelFamily('claude-fable-5-1'), 'fable', 'both still count as Fable in the totals');
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

// ---------- the crew's last actions (the job page's live feed) ----------

const at = (s) => `2026-11-10T09:${String(s).padStart(2, '0')}:00Z`;
const call = (id, name, input, when) => JSON.stringify({
  type: 'assistant', timestamp: when, message: { id: `m-${id}`, model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] },
});
const answer = (id, content, when) => JSON.stringify({ type: 'user', timestamp: when, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });

test('the session log keeps the last six actions in words, oldest first', () => {
  const lines = [];
  for (let i = 1; i <= 8; i++) {
    lines.push(call(`r${i}`, 'Read', { file_path: `/repo/f${i}.md` }, at(i * 2)), answer(`r${i}`, 'file contents', at(i * 2 + 1)));
  }
  const p = parseSessionLog(lines.join('\n'));
  assert.equal(p.recent.length, 6);
  assert.deepEqual(p.recent.map((r) => r.text), ['Reading f3.md', 'Reading f4.md', 'Reading f5.md', 'Reading f6.md', 'Reading f7.md', 'Reading f8.md']);
  assert.deepEqual(p.recent[0], { text: 'Reading f3.md', at: at(6) });
  assert.equal(p.recent.at(-1).text, p.lastAction.text);
  assert.equal(p.recent.at(-1).at, p.lastAction.at);
  // An unknown tool still reads as a line, and a cut-off last line is skipped.
  const odd = parseSessionLog([...lines, call('x1', 'Mystery', {}, at(30)), '{"type":"assistant","timest'].join('\n'));
  assert.equal(odd.recent.at(-1).text, 'Using Mystery');
  assert.equal(odd.recent.length, 6);
  assert.deepEqual(parseSessionLog('').recent, [], 'no actions yet: an empty feed');
});

test('two same actions in a row are one line', () => {
  const p = parseSessionLog([
    call('a', 'Read', { file_path: '/r/a.md' }, at(1)), answer('a', 'ok', at(2)),
    call('b', 'Read', { file_path: '/r/a.md' }, at(3)), answer('b', 'ok', at(4)),
    call('c', 'Read', { file_path: '/r/b.md' }, at(5)), answer('c', 'ok', at(6)),
    call('d', 'Read', { file_path: '/r/a.md' }, at(7)),
  ].join('\n'));
  assert.deepEqual(p.recent, [{ text: 'Reading a.md', at: at(1) }, { text: 'Reading b.md', at: at(5) }, { text: 'Reading a.md', at: at(7) }]);
});

test('the last command keeps its last 12 lines of output', () => {
  const output = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');
  const run = call('b1', 'Bash', { command: 'npm test', description: 'Run the unit tests' }, at(1));
  const p = parseSessionLog([run, answer('b1', `${output}\n`, at(2)), call('r1', 'Read', { file_path: '/r/a.md' }, at(3))].join('\n'));
  assert.deepEqual(p.lastCommand, { command: 'npm test', at: at(1), tail: Array.from({ length: 12 }, (_, i) => `line ${i + 29}`).join('\n') });
  // Not answered yet: no output.
  assert.deepEqual(parseSessionLog(run).lastCommand, { command: 'npm test', at: at(1), tail: null });
  // The output as text blocks; a long command is cut at 200 characters, long output at 1,200.
  const long = call('b2', 'Bash', { command: `echo ${'x'.repeat(300)}` }, at(4));
  const wide = Array.from({ length: 12 }, () => 'y'.repeat(300)).join('\n');
  const q = parseSessionLog([run, answer('b1', 'ok', at(2)), long, answer('b2', [{ type: 'text', text: wide }], at(5))].join('\n'));
  assert.equal(q.lastCommand.command.length, 200);
  assert.ok(q.lastCommand.command.startsWith('echo xxx'));
  assert.equal(q.lastCommand.at, at(4));
  assert.equal(q.lastCommand.tail.length, 1200);
  assert.ok(wide.endsWith(q.lastCommand.tail));
  // Only a Bash call is a command; none yet is null.
  assert.equal(parseSessionLog(call('r', 'Read', { file_path: '/r/a.md' }, at(1))).lastCommand, null);
});

test('a long session log keeps only its last actions', () => {
  const lines = [];
  for (let i = 0; i < 5000; i++) {
    lines.push(call(`t${i}`, i % 2 ? 'Bash' : 'Grep', i % 2 ? { command: `step ${i}` } : { pattern: `p${i}` }, at(i % 60)), answer(`t${i}`, `out ${i}`, at(i % 60)));
  }
  const p = parseSessionLog(lines.join('\n'));
  assert.equal(p.recent.length, 6);
  assert.equal(p.recent.at(-1).text, 'Running step 4999');
  assert.deepEqual(p.lastCommand, { command: 'step 4999', at: at(4999 % 60), tail: 'out 4999' });
});

// ---------- Fix round 1: secrets are hidden before a command is cut; cuts keep characters whole ----------

const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test('a secret that straddles the cut is hidden before the command is cut', () => {
  const token = `ghp_${'Q7w8'.repeat(9)}`;
  // The token starts at character 190 of the command (the 200 cut), and at 40 of the feed line's 50.
  const long = call('s1', 'Bash', { command: `${'x'.repeat(189)} ${token} done` }, at(1));
  const p = parseSessionLog(long);
  assert.equal(p.lastCommand.command.length <= 200, true);
  assert.equal(p.lastCommand.command.includes('ghp_'), false, p.lastCommand.command);
  assert.equal(p.lastCommand.command.includes('Q7w8'), false);
  const short = parseSessionLog(call('s2', 'Bash', { command: `echo ${'y'.repeat(35)} ${token}` }, at(2)));
  assert.equal(short.recent[0].text.includes('ghp_'), false, short.recent[0].text);
  assert.equal(short.lastAction.text.includes('ghp_'), false);
  assert.equal(describeTool('Bash', { command: `curl -u admin:hunter2pass ${'z'.repeat(80)}` }).includes('hunter2pass'), false);
  assert.equal(describeTool('Bash', { description: `Log in with ${token}` }).includes('ghp_'), false, 'a description is scrubbed too');
});

test('cuts never split a character in two', () => {
  const smile = '😀';
  const cmd = parseSessionLog(call('e1', 'Bash', { command: `${'a'.repeat(198)}${smile}${'b'.repeat(20)}` }, at(1))).lastCommand.command;
  assert.equal(loneSurrogate.test(cmd), false, 'the command');
  assert.ok(cmd.length <= 200);
  const out = `${smile}${'c'.repeat(1199)}`; // 1,201 units: the 1,200 cut lands inside the smile
  const tail = parseSessionLog([call('e2', 'Bash', { command: 'run' }, at(1)), answer('e2', out, at(2))].join('\n')).lastCommand.tail;
  assert.equal(loneSurrogate.test(tail), false, 'the output');
  assert.ok(tail.length <= 1200);
  assert.equal(loneSurrogate.test(describeTool('Bash', { command: `${'d'.repeat(48)}${smile}${'e'.repeat(10)}` })), false, 'a feed line');
});

test('Nov 17 (5): the Repository field\'s branch must look like a branch: never a plain word such as create', () => {
  const branchOf = (line) => parseWorkflowStatus(`# X\n\n**Repository:** ${line}\n\n**Current stage:** Plan\n`).repository?.branch ?? null;
  for (const line of ['`/r` · branch create after the plan is approved', '/r · branch new', '/r · branch tbd', '/r · branch none yet', '/r · branch `create`', '/r · branch to be made', '/r · branch will be feature/x', '/r · branch the job\'s own']) assert.equal(branchOf(line), null, line);
  assert.equal(branchOf('/r · branch `feature/orbit-463-x` · commit 1a2b3c4'), 'feature/orbit-463-x');
  assert.equal(branchOf('/r · branch feature/orbit-463-x'), 'feature/orbit-463-x');
  assert.equal(branchOf('/r · branch `orbit-463-x`'), 'orbit-463-x');
  assert.equal(branchOf('/r · branch main · commit 1a2b3c4'), 'main', 'the main checkout\'s branch (locateJob leaves main out)');
});
