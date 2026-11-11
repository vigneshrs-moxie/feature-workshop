// The Auto log (lib/auto-log.js): every decision Auto made on a job, with its reason and its cost.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AUTO_LOG_FILE, autoCost, autoLog, autoLogMarkdown, autoTime, writeAutoLog } from '../lib/auto-log.js';
import { AUTO_MARK } from '../lib/auto.js';

// Local times, so the tests do not depend on the machine's time zone.
const at = (d, h, m) => new Date(2026, 10, d, h, m).toISOString();

const LINES = [
  { at: at(11, 8, 0), action: 'auto', what: 'on', by: 'you' },
  { at: at(11, 8, 5), action: 'auto', what: 'gate', stage: 'plan', briefNumber: 3, asked: 'Brief 3: go ahead?', chose: 'Approved the plan', why: 'It matches the spec.', risk: 'Low: no migration.', costUsd: 0.015 },
  { at: at(11, 8, 9), action: 'auto', what: 'question', stage: 'implement', asked: '2 questions', chose: 'Keep the column', why: 'Safer.', answers: [{ question: 'Keep the old column?', choice: 'Yes', reason: 'Nothing reads it.' }], costUsd: 0.025 },
  { at: at(11, 8, 10), action: 'send', kind: 'message', text: 'hello' },
];

test('the log has the three summary lines then entries newest first', () => {
  const v = autoLog(LINES, { title: 'Roster', now: at(11, 9, 0) });
  assert.deepEqual(v.summary, [
    'Auto made 2 decisions on this job. The Approver cost $0.04.',
    'Auto is on.',
    `Last decision: ${autoTime(at(11, 8, 9))}, Build: Keep the column.`,
  ]);
  assert.equal(autoTime(at(11, 8, 9)), '11 Nov 08:09');
  assert.deepEqual(v.entries.map((e) => [e.at, e.stage, e.chose]), [[at(11, 8, 9), 'Build', 'Keep the column'], [at(11, 8, 5), 'Plan', 'Approved the plan']]);
  assert.deepEqual(v.entries[0].answers, [{ question: 'Keep the old column?', choice: 'Yes', reason: 'Nothing reads it.' }]);
  assert.equal(v.entries[1].risk, 'Low: no migration.');
  assert.equal('answers' in v.entries[1], false);
  const md = autoLogMarkdown(v);
  assert.ok(md.indexOf('## 11 Nov 08:09 · Build · Keep the column') < md.indexOf('## 11 Nov 08:05 · Plan · Approved the plan'));
  assert.ok(md.includes('Asked: Brief 3: go ahead?'));
  assert.ok(md.includes('Keep the old column? → Yes. Why: Nothing reads it.'));
  assert.ok(md.includes('Why: It matches the spec.'));
  assert.ok(md.includes('Risk: Low: no migration.'));
  assert.ok(md.startsWith('# Auto log: Roster'));
});

test('singular, none, and the other line-2 and line-3 wordings', () => {
  assert.deepEqual(autoLog([{ ...LINES[1], costUsd: 0.016 }], {}).summary.slice(0, 2), ['Auto made 1 decision on this job. The Approver cost $0.02.', 'Auto is off.']);
  assert.deepEqual(autoLog([LINES[0]], {}).summary, ['Auto made 0 decisions on this job. The Approver cost $0.00.', 'Auto is on.', 'No decisions yet.']);
  const stop = { at: at(11, 8, 20), action: 'auto', what: 'stop', rule: 'database', reason: 'A migration needs you.' };
  assert.equal(autoLog([...LINES, stop], {}).summary[1], 'Auto stopped: A migration needs you.');
  // The person carrying on after a stop puts Auto back on; Auto's own replies do not.
  assert.equal(autoLog([...LINES, stop, { at: at(11, 8, 30), action: 'send', kind: 'approve', by: 'auto' }], {}).summary[1], 'Auto stopped: A migration needs you.');
  assert.equal(autoLog([...LINES, stop, { at: at(11, 8, 30), action: 'send', kind: 'approve' }], {}).summary[1], 'Auto is on.');
  assert.equal(autoLog([...LINES, stop, { at: at(11, 8, 30), action: 'permission', decision: 'allow' }], {}).summary[1], 'Auto is on.');
  assert.equal(autoLog([...LINES, { at: at(11, 9, 0), action: 'auto', what: 'finished' }], {}).summary[1], 'Auto finished: PR #1 is open.');
  assert.equal(autoLog([...LINES, { at: at(11, 9, 0), action: 'auto', what: 'off', by: 'you' }], {}).summary[1], 'Auto is off.');
});

test('the job record decides line 2 when it is passed', () => {
  assert.equal(autoLog(LINES, { record: { on: true, stopped: 'The tests would not pass.' } }).summary[1], 'Auto stopped: The tests would not pass.');
  assert.equal(autoLog(LINES, { record: { on: true, stopped: { reason: 'Three failures.', rule: 'loop' } } }).summary[1], 'Auto stopped: Three failures.');
  assert.equal(autoLog(LINES, { record: { on: true, stopped: null } }).summary[1], 'Auto is on.');
  assert.equal(autoLog(LINES, { record: { on: false } }).summary[1], 'Auto is off.');
  const done = [...LINES, { at: at(11, 9, 0), action: 'auto', what: 'finished' }];
  assert.equal(autoLog(done, { record: { on: false } }).summary[1], 'Auto finished: PR #1 is open.');
  assert.equal(autoLog(done, { record: { on: true } }).summary[1], 'Auto is on.');
});

test('autoCost adds the Approver cost of Auto lines only', () => {
  assert.equal(autoCost(LINES), 0.04);
  assert.equal(autoCost([]), 0);
  assert.equal(autoCost([{ action: 'send', costUsd: 5 }, { action: 'auto', what: 'gate', costUsd: 'x' }, null]), 0);
  assert.equal(autoLog([{ action: 'auto', what: 'gate', stage: 'plan', chose: 'x', costUsd: 0.004 }], {}).summary[0], 'Auto made 1 decision on this job. The Approver cost $0.00.');
});

test('words from the Approver or a ticket cannot start a heading or a list item', () => {
  const evil = '\n# Heading\n- item\n## Another ' + 'x'.repeat(400);
  const md = autoLogMarkdown(autoLog([{ at: at(11, 8, 5), action: 'auto', what: 'gate', stage: 'plan', asked: evil, chose: evil, why: evil, risk: evil, answers: [{ question: evil, choice: evil, reason: evil }] }], { title: evil }));
  const lines = md.split('\n');
  assert.deepEqual(lines.filter((l) => /^#{1,6}\s/.test(l)).length, 2);
  assert.equal(lines.filter((l) => /^[-*]\s/.test(l)).length, 1);
  for (const l of lines) assert.ok(l.length < 1000, 'each line is capped (300 per part)');
  assert.ok(md.includes('# Heading - item ## Another'));
});

test('a job with no Auto lines has no auto-log.md', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-log-'));
  try {
    assert.equal(await writeAutoLog(dir, [{ action: 'send', kind: 'approve' }], { title: 'T' }), null);
    assert.equal(await writeAutoLog(dir, [], {}), null);
    assert.deepEqual(await fs.readdir(dir), []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('auto-log.md is written again after each decision', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-log-'));
  try {
    const file = path.join(dir, AUTO_LOG_FILE);
    assert.equal(AUTO_LOG_FILE, 'auto-log.md');
    assert.equal(await writeAutoLog(dir, LINES.slice(0, 2), { title: 'T' }), file);
    const first = await fs.readFile(file, 'utf8');
    assert.ok(first.includes('Auto made 1 decision'));
    await writeAutoLog(dir, LINES, { title: 'T' });
    const second = await fs.readFile(file, 'utf8');
    assert.ok(second.includes('Auto made 2 decisions') && second.includes('Keep the column'));
    assert.deepEqual(await fs.readdir(dir), ['auto-log.md']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('the mark is the exact sentence', () => {
  assert.equal(AUTO_MARK, "(Sent by Starbase's Auto for the person. options.json says auto: true.)");
});
