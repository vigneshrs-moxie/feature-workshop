// Telemetry's record (lib/usage-log.js): one line per Foreman turn, in the plan's shape, written
// through one queue and rotated at 50 MB. Pretend sessions only: no Claude, no usage, temp folders.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Driver } from '../lib/driver.js';
import { State } from '../lib/state.js';
import { claudeAccountId, parseLine, TurnMeter, turnCost, turnLines, UsageLog, usageDir, workerOf } from '../lib/usage-log.js';

const tmp = (p = 'usage-log-') => fs.mkdtemp(path.join(os.tmpdir(), p));
const usage = (input, output) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
const METERS = { fiveHour: { percent: 12, resetsAt: '2026-10-28T15:00:00.000Z' }, week: { percent: 61, resetsAt: '2026-10-29T14:00:00.000Z' } };
const CTX = { at: '2026-10-28T10:00:00.000Z', user: 'vignesh', account: 'acc-1', ticket: 'ORBIT-479', stage: 'implement', section: null, meters: METERS };

// The plan's line shape (§7a.1, packet T), plus the turn id, the session and Claude Code's running total.
const SHAPE = ['t', 'user', 'account', 'job', 'ticket', 'stage', 'section', 'worker', 'model', 'tokens', 'costUsd', 'costSource', 'meters', 'turn', 'session', 'cliTotalUsd'];

test('usageDir: ~/.ground-control, the state folder when one is given, GROUND_CONTROL_DIR over both', () => {
  assert.equal(usageDir({ env: {}, home: '/h' }), path.join('/h', '.ground-control'));
  assert.equal(usageDir({ env: {}, home: '/h', stateDir: '/s' }), path.resolve('/s'));
  assert.equal(usageDir({ env: { GROUND_CONTROL_DIR: '/g' }, home: '/h', stateDir: '/s' }), path.resolve('/g'));
});

test('workerOf: the Foreman, the builder, the review lenses and Fable checks, the tester', () => {
  assert.equal(workerOf(null), 'foreman');
  assert.equal(workerOf('feature-implementer'), 'implementer');
  assert.equal(workerOf('feature-review-tests'), 'lens');
  assert.equal(workerOf('feature-reviewer'), 'lens');
  assert.equal(workerOf('feature-fable-check'), 'lens');
  assert.equal(workerOf('feature-tester'), 'tester');
  assert.equal(workerOf('feature-planner'), 'planner');
});

test('turnCost: the difference from the total before, in the reply or on the session’s last line', () => {
  assert.equal(turnCost({ total: null }), null);
  assert.equal(turnCost({ total: 1.2 }), 1.2, 'a new session: all of it');
  assert.ok(Math.abs(turnCost({ total: 1.5, runPrev: 1.2 }) - 0.3) < 1e-9, 'a later turn in the same reply');
  // A resumed session that carried its earlier total: 5.30 after 5.00, and the tokens say about 0.30.
  assert.ok(Math.abs(turnCost({ total: 5.3, sessionPrev: 5, estimate: 0.29 }) - 0.3) < 1e-9);
  // One that started again from nothing: 0.31 now, the session's last line said 5.00.
  assert.equal(turnCost({ total: 0.31, sessionPrev: 5, estimate: 0.29 }), 0.31);
  // Above the last line, but the tokens say this turn alone was that big: no earlier total carried.
  assert.equal(turnCost({ total: 6, sessionPrev: 5, estimate: 5.8 }), 6);
});

test('claudeAccountId: the sign-in’s account id when Claude Code’s file has one, else null', async () => {
  const home = await tmp();
  assert.equal(await claudeAccountId({ home }), null);
  await fs.writeFile(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'acc-42', emailAddress: 'x@y.z' } }));
  assert.equal(await claudeAccountId({ home }), 'acc-42');
});

test('TurnMeter + turnLines: a turn split by who worked and which model, each message counted once', () => {
  const meter = new TurnMeter();
  const at = { runId: 'r1', slug: 'orbit-479-feedback-api', featureDir: '/f/orbit-479', sessionId: 's-1', model: 'claude-opus-5-5' };
  const fm = { id: 'm1', model: 'claude-opus-5-5', usage: usage(1000, 500) };
  // The same message comes once per content block; the Agent call names the crew member.
  assert.equal(meter.onMessage({ ...at, msg: { type: 'assistant', parent_tool_use_id: null, message: { ...fm, content: [{ type: 'text', text: 'Sending to the builder' }] } } }), null);
  meter.onMessage({ ...at, msg: { type: 'assistant', parent_tool_use_id: null, message: { ...fm, content: [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { subagent_type: 'feature-implementer' } }] } } });
  meter.onMessage({ ...at, msg: { type: 'assistant', parent_tool_use_id: 'tu1', message: { id: 'm2', model: 'claude-sonnet-5-5', usage: usage(2000, 1000), content: [] } } });
  const turn = meter.onMessage({ ...at, msg: { type: 'result', total_cost_usd: 1.2, session_id: 's-1' } });
  assert.equal(turn.groups.length, 2);
  const lines = turnLines(turn, CTX);
  for (const l of lines) assert.deepEqual(Object.keys(l), SHAPE);
  const [foreman, builder] = lines;
  assert.equal(foreman.worker, 'foreman');
  assert.equal(foreman.model, 'claude-opus-5-5');
  assert.deepEqual(foreman.tokens, { input: 1000, output: 500, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, 'counted once, not twice');
  assert.equal(foreman.stage, 'implement', 'the Foreman: the job’s stage now');
  assert.equal(builder.worker, 'implementer');
  assert.equal(builder.model, 'claude-sonnet-5-5');
  assert.equal(builder.stage, 'implement', 'the builder’s own stage');
  // Opus 1000 in + 500 out = $0.014; Sonnet 2000 in + 1000 out = $0.014: Claude Code's $1.20 shared evenly.
  assert.equal(foreman.costUsd, 0.6);
  assert.equal(builder.costUsd, 0.6);
  for (const l of lines) {
    assert.equal(l.costSource, 'cli');
    assert.equal(l.job, 'orbit-479-feedback-api');
    assert.equal(l.ticket, 'ORBIT-479');
    assert.equal(l.user, 'vignesh');
    assert.equal(l.account, 'acc-1');
    assert.deepEqual(l.meters, METERS);
    assert.equal(l.turn, 'r1');
    assert.equal(l.session, 's-1');
    assert.equal(l.cliTotalUsd, 1.2);
  }

  // A message steered in after the result: a second turn in the same reply, from the total before.
  meter.onMessage({ ...at, msg: { type: 'assistant', parent_tool_use_id: null, message: { id: 'm3', model: 'claude-opus-5-5', usage: usage(500, 250), content: [] } } });
  const second = turnLines(meter.onMessage({ ...at, msg: { type: 'result', total_cost_usd: 1.5, session_id: 's-1' } }), CTX);
  assert.equal(second.length, 1);
  assert.ok(Math.abs(second[0].costUsd - 0.3) < 1e-9);
});

test('turnLines: without Claude Code’s figure each line is the estimate; a turn with no usage is one Foreman line', () => {
  const meter = new TurnMeter();
  meter.onMessage({ runId: 'r2', slug: 'a', msg: { type: 'assistant', message: { id: 'x', model: 'claude-opus-5-5', usage: usage(1000, 500), content: [] } } });
  const stopped = turnLines(meter.forget('r2', { slug: 'a', sessionId: 's-2' }), CTX);
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].costSource, 'estimate');
  assert.ok(Math.abs(stopped[0].costUsd - 0.014) < 1e-9);
  assert.equal(meter.forget('r2'), null, 'forgotten');

  // The demo's pretend Foreman: no usage on its messages, only the result's total.
  const bare = turnLines(new TurnMeter().onMessage({ runId: 'r3', slug: 'b', model: 'claude-opus-5-5', msg: { type: 'result', total_cost_usd: 0.42 } }), { ...CTX, meters: { fiveHour: null, week: null } });
  assert.equal(bare.length, 1);
  assert.equal(bare[0].worker, 'foreman');
  assert.equal(bare[0].costUsd, 0.42);
  assert.deepEqual(bare[0].meters, { fiveHour: null, week: null });
});

test('every turn of a sample job through the driver is one line in usage.jsonl', async () => {
  const dir = await tmp();
  const featureDir = await tmp('usage-log-job-');
  const state = new State(await tmp('usage-log-state-'));
  const log = new UsageLog({ dir });
  const meter = new TurnMeter();
  // Three replies, each one turn: the pretend Foreman says something and finishes, the total rising.
  let total = 0;
  const queryFn = ({ prompt }) => (async function* () {
    const first = await prompt[Symbol.asyncIterator]().next();
    total += 0.25;
    yield { type: 'system', subtype: 'init', session_id: 's-job', model: 'claude-opus-5-5' };
    yield { type: 'assistant', parent_tool_use_id: null, message: { id: `m-${total}`, model: 'claude-opus-5-5', usage: usage(100, 50), content: [{ type: 'text', text: `Got: ${first.value.message.content}` }] } };
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: total, session_id: 's-job', permission_denials: [] };
  })();
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent', locks: null });
  driver.idleGraceMs = 10;
  const writes = [];
  driver.on('usage', (e) => {
    const turn = meter.onMessage(e);
    if (turn) writes.push((async () => log.append(turnLines(turn, { ...CTX, sessionPrev: turn.runPrev === null ? await log.sessionTotal(turn.sessionId) : null })))());
  });
  for (const text of ['spec', 'plan', 'build']) {
    const run = await driver.start({ featureDir, slug: 'sample', title: 'Sample', cwd: featureDir, sessionId: text === 'spec' ? null : 's-job', text });
    await new Promise((resolve) => {
      const on = (r) => { if (r.id === run.id && ['done', 'error', 'stopped'].includes(r.status)) { driver.off('run', on); resolve(); } };
      driver.on('run', on);
    });
    await Promise.all(writes);
  }
  const lines = await log.read();
  assert.equal(lines.length, 3, 'one line per turn');
  assert.deepEqual(lines.map((l) => l.job), ['sample', 'sample', 'sample']);
  // Each resumed reply's cost is the rise in the session's running total since the line before.
  assert.deepEqual(lines.map((l) => l.costUsd), [0.25, 0.25, 0.25]);
  assert.deepEqual(lines.map((l) => l.cliTotalUsd), [0.25, 0.5, 0.75]);
});

test('UsageLog: appends in order through one queue, and reads only lines', async () => {
  const dir = await tmp();
  const log = new UsageLog({ dir });
  const line = (i) => ({ t: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), job: `j${i}` });
  await Promise.all(Array.from({ length: 20 }, (_, i) => log.append(line(i))));
  const text = await fs.readFile(path.join(dir, 'usage.jsonl'), 'utf8');
  assert.deepEqual(text.trim().split('\n').map((l) => JSON.parse(l).job), Array.from({ length: 20 }, (_, i) => `j${i}`));
  await fs.appendFile(path.join(dir, 'usage.jsonl'), 'not json\n{"t":"never"}\n\n');
  assert.equal((await log.read()).length, 20);
  assert.equal((await log.read({ since: Date.UTC(2026, 9, 1, 0, 15) })).length, 5);
  assert.equal(parseLine('{"t":"2026-10-01T00:00:00Z"}').t, '2026-10-01T00:00:00Z');
  assert.equal(parseLine('[1]'), null);
});

test('UsageLog: at the size limit a new file starts; the old one is kept and still read', async () => {
  const dir = await tmp();
  const now = () => new Date('2026-10-28T09:30:00.000Z');
  const log = new UsageLog({ dir, maxBytes: 300, now });
  const line = (i) => ({ t: new Date(Date.UTC(2026, 9, 1, i)).toISOString(), job: 'x'.repeat(60), i });
  for (let i = 0; i < 6; i++) await log.append(line(i));
  const files = (await fs.readdir(dir)).sort();
  assert.ok(files.includes('usage.jsonl'));
  const rotated = files.filter((f) => f.startsWith('usage-'));
  assert.ok(rotated.length >= 1, `rotated files: ${files.join(', ')}`);
  assert.ok(rotated.includes('usage-20261028T093000Z.jsonl'), 'named by the time it was set aside');
  assert.ok(rotated.length < 2 || rotated.includes('usage-20261028T093000Z-1.jsonl'), 'a second one in the same second gets -1');
  for (const f of files) assert.ok((await fs.stat(path.join(dir, f))).size <= 300, `${f} stays under the limit`);
  assert.deepEqual((await log.read()).map((l) => l.i), [0, 1, 2, 3, 4, 5], 'every line, from every file, in order');
});

test('UsageLog.sessionTotal: the running total on the session’s last line, also after a restart', async () => {
  const dir = await tmp();
  const log = new UsageLog({ dir });
  await log.append([{ t: '2026-10-01T00:00:00Z', session: 's-a', cliTotalUsd: 1 }, { t: '2026-10-01T01:00:00Z', session: 's-a', cliTotalUsd: 2.5 }, { t: '2026-10-01T02:00:00Z', session: 's-b', cliTotalUsd: 0.4 }]);
  assert.equal(await log.sessionTotal('s-a'), 2.5);
  const again = new UsageLog({ dir });
  assert.equal(await again.sessionTotal('s-a'), 2.5);
  assert.equal(await again.sessionTotal('s-b'), 0.4);
  assert.equal(await again.sessionTotal('nope'), null);
  await again.append({ t: '2026-10-01T03:00:00Z', session: 's-b', cliTotalUsd: 0.9 });
  assert.equal(await again.sessionTotal('s-b'), 0.9);
});
