// A session log that grows is read on from where the last read stopped (lib/features.js SessionIndex),
// and what that says is exactly what a full read of the same file says (lib/session-log.js parseSessionLog).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SessionIndex } from '../lib/features.js';
import { parseSessionLog } from '../lib/session-log.js';

const SID = 'sess-grow';
const at = (s) => `2026-11-10T09:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}Z`;
const usage = { input_tokens: 10, output_tokens: 300, cache_read_input_tokens: 5000, cache_creation_input_tokens: 200, cache_creation: { ephemeral_1h_input_tokens: 200, ephemeral_5m_input_tokens: 0 } };
const base = { sessionId: SID, cwd: '/tmp/grow-repo', entrypoint: 'cli' };
const user = (content, when, extra = {}) => JSON.stringify({ ...base, type: 'user', timestamp: when, message: { role: 'user', content }, ...extra });
const said = (id, text, when, stop = 'end_turn') => JSON.stringify({ ...base, type: 'assistant', timestamp: when, message: { id, model: 'claude-opus-5-5', stop_reason: stop, content: [{ type: 'text', text }], usage } });
const call = (id, msg, name, input, when) => JSON.stringify({ ...base, type: 'assistant', timestamp: when, message: { id: msg, model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }], usage } });
const answer = (id, content, when) => user([{ type: 'tool_result', tool_use_id: id, content }], when);

// A realistic log: prompts and replies with text in many scripts, a Bash call whose result comes much
// later, a pr-link line with no time of its own (dated by the line before it), cost lines, a bad line.
function logLines() {
  const lines = [
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: at(0), sessionId: SID, content: 'Fix the café menu — naïve façade 🍰' }),
    user('Fix the café menu — naïve façade 🍰', at(1)),
    said('m1', 'Looking at it: 日本語のテキスト, Ελληνικά, עברית, emoji 🧪🚀', at(2), 'tool_use'),
    call('t1', 'm2', 'Read', { file_path: '/tmp/grow-repo/menü.md' }, at(3)),
    answer('t1', 'Crème brûlée — 4,50 €\n'.repeat(40), at(4)),
    call('b1', 'm3', 'Bash', { command: 'npm test -- --grep "çà"', description: 'Run the tests ✓' }, at(5)),
  ];
  for (let i = 0; i < 30; i++) lines.push(said(`m-x${i}`, `Thinking aloud ${i}: ${'données '.repeat(20)}🌍`, at(6 + i), 'tool_use'));
  lines.push(
    answer('b1', [{ type: 'text', text: `${'ok ✓ test passé\n'.repeat(30)}all 12 passed 🎉` }], at(40)),
    JSON.stringify({ type: 'pr-link', prUrl: 'https://github.com/o/r/pull/7', prNumber: 7 }),
    JSON.stringify({ type: 'cost-state', totalCostUSD: 1.25, modelUsage: { 'claude-opus-5-5': { costUSD: 1.25 } } }),
    '{"type":"assistant","timest', // a bad line from a crash, ended by a newline
    call('a1', 'm4', 'Agent', { subagent_type: 'general-purpose', description: 'Look around 🔎' }, at(41)),
    user('Une autre question, s’il vous plaît ✨', at(42)),
    said('m5', 'Voilà — fini. 完了', at(43)),
  );
  return lines;
}

async function tmpDir() { return fs.mkdtemp(path.join(os.tmpdir(), 'session-grow-')); }

async function sessionFile(root) {
  const dir = path.join(root, '-tmp-grow-repo');
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, `${SID}.jsonl`);
}

async function readOne(index) {
  const all = await index.allSessions();
  assert.equal(all.length, 1);
  return all[0];
}

test('a log read on in pieces says exactly what a full read says, at every piece', async () => {
  const root = await tmpDir();
  const file = await sessionFile(root);
  const bytes = Buffer.from(`${logLines().join('\n')}\n`, 'utf8');
  // Cuts in the middle of lines, one in the middle of a character of several bytes (the 🍰 on line 2),
  // one in the middle of the late Bash result, and one at a line's end.
  const cake = bytes.indexOf(Buffer.from('🍰', 'utf8'), bytes.indexOf(0x0a)) + 2;
  const late = bytes.indexOf(Buffer.from('all 12 passed', 'utf8')) + 5;
  const lineEnd = bytes.indexOf(0x0a, Math.floor(bytes.length * 0.6)) + 1;
  const cuts = [cake, Math.floor(bytes.length * 0.3), Math.floor(bytes.length * 0.5), lineEnd, late, bytes.length - 3, bytes.length];
  assert.deepEqual([...cuts].sort((a, b) => a - b), cuts, 'the cuts are in order');

  const index = new SessionIndex(root);
  let written = 0;
  for (const cut of cuts) {
    await fs.appendFile(file, bytes.subarray(written, cut));
    written = cut;
    const log = await readOne(index);
    assert.deepStrictEqual(log.parsed, parseSessionLog(bytes.subarray(0, cut).toString('utf8')), `the same as a full read at byte ${cut}`);
  }
  assert.equal(index.fullReads, 1, 'only the first read was a full one');
  assert.equal(index.partReads, cuts.length - 1);

  const done = (await readOne(index)).parsed;
  assert.equal(done.lastCommand.command, 'npm test -- --grep "çà"');
  assert.match(done.lastCommand.tail, /all 12 passed 🎉$/, 'the Bash result that came in a later piece');
  assert.equal(done.prLinks[0].at, at(40), 'the pr-link dated by the line before it');
  assert.equal(done.badLines, 1);
  assert.deepStrictEqual(done, (await readOne(new SessionIndex(root))).parsed, 'and the same as a fresh index reads it');
  await fs.rm(root, { recursive: true, force: true });
});

test('a value handed out before the log grew still says what it said', async () => {
  const root = await tmpDir();
  const file = await sessionFile(root);
  const lines = logLines();
  await fs.writeFile(file, `${lines.slice(0, 10).join('\n')}\n`);
  const index = new SessionIndex(root);
  const first = (await readOne(index)).parsed;
  const copy = parseSessionLog(`${lines.slice(0, 10).join('\n')}\n`);
  await fs.appendFile(file, `${lines.slice(10).join('\n')}\n`);
  await readOne(index);
  assert.deepStrictEqual(first, copy);
  await fs.rm(root, { recursive: true, force: true });
});

test('a log that got shorter is read again in full', async () => {
  const root = await tmpDir();
  const file = await sessionFile(root);
  const lines = logLines();
  await fs.writeFile(file, `${lines.join('\n')}\n`);
  const index = new SessionIndex(root);
  await readOne(index);
  const shorter = `${lines.slice(0, 8).join('\n')}\n`;
  await fs.writeFile(file, shorter);
  const log = await readOne(index);
  assert.equal(index.fullReads, 2);
  assert.equal(index.partReads, 0);
  assert.deepStrictEqual(log.parsed, parseSessionLog(shorter));
  await fs.rm(root, { recursive: true, force: true });
});

test('a log whose first bytes changed is read again in full, even when it is longer', async () => {
  const root = await tmpDir();
  const file = await sessionFile(root);
  const lines = logLines();
  await fs.writeFile(file, `${lines.slice(0, 10).join('\n')}\n`);
  const index = new SessionIndex(root);
  await readOne(index);
  const replaced = `${[user('Ein ganz anderer Anfang ✏️', at(0)), ...lines.slice(1)].join('\n')}\n`;
  await fs.writeFile(file, replaced);
  const log = await readOne(index);
  assert.equal(index.fullReads, 2);
  assert.equal(index.partReads, 0);
  assert.deepStrictEqual(log.parsed, parseSessionLog(replaced));
  assert.equal(log.parsed.firstPrompt, 'Ein ganz anderer Anfang ✏️');
  await fs.rm(root, { recursive: true, force: true });
});

test('a workflow session read on in pieces still finds its job folder, counted as a full read counts it', async () => {
  const root = await tmpDir();
  const projects = path.join(root, 'projects');
  const jobA = path.join(root, 'feature-work', 'job-a');
  const jobB = path.join(root, 'feature-work', 'job-b');
  const file = await sessionFile(projects);
  const index = new SessionIndex(projects);
  const owner = async () => {
    const by = await index.sessionsByFeature([jobA, jobB]);
    return by[jobA].length ? 'a' : by[jobB].length ? 'b' : null;
  };
  await fs.writeFile(file, `${user(`/feature Grow. Private folder: ${jobA}`, at(0))}\n`);
  assert.equal(await owner(), 'a');
  // Job B is named more often, over two later pieces (one ending in the middle of a line).
  const more = `${[said('m1', `Now in ${jobB}`, at(1)), said('m2', `Still ${jobB}`, at(2)), said('m3', `And ${jobB} — 🚀`, at(3))].join('\n')}\n`;
  const cut = more.indexOf(jobB, more.indexOf('Still')) + jobB.length + 2;
  await fs.appendFile(file, more.slice(0, cut));
  assert.equal(await owner(), 'b', 'two mentions of B (one in the unfinished line) against one of A');
  await fs.appendFile(file, more.slice(cut));
  assert.equal(await owner(), 'b');
  const [log] = await index.allSessions();
  assert.equal(log.text, await fs.readFile(file, 'utf8'), 'the whole text is kept for a workflow session');
  assert.equal(log.mentions(jobB), 3);
  assert.equal(index.fullReads, 1);
  await fs.rm(root, { recursive: true, force: true });
});

test('a session that becomes a workflow session in a later piece is read again in full, to keep its whole text', async () => {
  const root = await tmpDir();
  const file = await sessionFile(root);
  const index = new SessionIndex(root);
  await fs.writeFile(file, `${user('Just a question', at(0))}\n`);
  assert.equal((await readOne(index)).isWorkflow, false);
  await fs.appendFile(file, `${call('a1', 'm1', 'Agent', { subagent_type: 'feature-spec-writer', description: 'Draft' }, at(1))}\n`);
  const log = await readOne(index);
  assert.equal(log.isWorkflow, true);
  assert.equal(log.text, await fs.readFile(file, 'utf8'));
  assert.equal(index.fullReads, 2);
  await fs.rm(root, { recursive: true, force: true });
});
