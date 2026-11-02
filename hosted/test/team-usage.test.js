// Packet 2E step 1: a laptop's usage numbers reach the site, checked again there. Lines with a text
// field the site doesn't expect are refused whole and named; the rest of the batch is kept; a line
// sent twice is kept once; the person is the laptop's, never what the laptop says.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUsageBatch } from '../lib/team-usage.js';
import { makeSite, SITE } from './helpers.js';
import { paired } from './laptops.js';

const NOW = Date.parse('2026-10-30T16:00:00Z');
const hex = (n) => n.toString(16).padStart(24, '0');
const tokens = { input: 1200, output: 300, cacheRead: 50000, cacheWrite5m: 2000, cacheWrite1h: 0 };
const meters = { week: { percent: 41, resetsAt: '2026-11-04T23:00:00.000Z' }, fiveHour: { percent: 12, resetsAt: '2026-10-30T19:00:00.000Z' } };
const appLine = (n, extra = {}) => ({ id: hex(n), t: new Date(NOW - n * 60e3).toISOString(), job: 'add-export', stage: 'implement', model: 'claude-opus-4-1-20250805', tokens, usd: 0.42, meters, ...extra });

async function postUsage(s, token, body) {
  const r = await s.fetch(`${SITE}/api/runner/usage`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test('the check: the expected numbers pass; any field it doesn’t expect, or text where a short name goes, is refused whole', () => {
  const ok = checkUsageBatch({ app: [appLine(1)], claudeCode: [{ id: hex(2), t: new Date(NOW).toISOString(), family: 'sonnet', tokens, usd: 0.1 }], readings: [{ id: hex(3), t: new Date(NOW).toISOString(), meters }], counting: 'counted' }, { now: NOW });
  assert.equal(ok.lines.length, 3);
  assert.deepEqual(ok.refused, []);
  const bad = [
    ['a prompt', appLine(4, { prompt: 'Please add an export button' })],
    ['a file name', appLine(5, { featureDir: '/Users/someone/jobs/add-export' })],
    ['the person', appLine(6, { user: 'raj-moxie' })],
    ['text in the job', appLine(7, { job: 'Add an export button to the report' })],
    ['a made-up stage', appLine(8, { stage: 'some words here' })],
    ['text in the model', appLine(9, { model: 'opus, and here is the diff' })],
    ['text in the tokens', appLine(10, { tokens: { ...tokens, note: 'hello' } })],
    ['text in a meter', appLine(11, { meters: { week: { percent: 41, resetsAt: null, why: 'busy' }, fiveHour: null } })],
    ['a session id', appLine(12, { session: 'a1b2c3' })],
    ['a bad id', appLine(13, { id: 'not-an-id' })],
  ];
  const r = checkUsageBatch({ app: bad.map((b) => b[1]) }, { now: NOW });
  assert.equal(r.lines.length, 0);
  assert.equal(r.refused.length, bad.length);
  assert.match(r.refused[0].error, /a field the site doesn’t expect \(prompt\)/);
  assert.match(r.refused[1].error, /\(featureDir\)/);
  assert.match(r.refused[2].error, /\(user\)/);
  assert.match(r.refused[3].error, /job’s short name/);
  assert.match(r.refused[4].error, /stages’ names/);
  assert.match(r.refused[5].error, /model’s name/);
  assert.match(r.refused[6].error, /tokens carried a field the site doesn’t expect \(note\)/);
  assert.match(r.refused[7].error, /\(why\)/);
  assert.match(r.refused[8].error, /\(session\)/);
  // A Claude Code reply with its text, or a family that isn't one, is refused too.
  const cc = checkUsageBatch({ claudeCode: [{ id: hex(20), t: new Date(NOW).toISOString(), family: 'sonnet', tokens, usd: 0.1, text: 'the reply itself' }, { id: hex(21), t: new Date(NOW).toISOString(), family: 'gpt', tokens, usd: 0.1 }] }, { now: NOW });
  assert.equal(cc.lines.length, 0);
  assert.match(cc.refused[0].error, /\(text\)/);
  assert.match(cc.refused[1].error, /model families/);
  // The batch itself: an unexpected field, or a bad counting word, is refused.
  assert.throws(() => checkUsageBatch({ app: [], notes: 'x' }, { now: NOW }), /doesn’t expect \(notes\)/);
  assert.throws(() => checkUsageBatch({ counting: 'maybe' }, { now: NOW }), /counted, off, reading or not-sent/);
  // Too far in the future or the past.
  const when = checkUsageBatch({ app: [appLine(0, { t: new Date(NOW + 2 * 3600e3).toISOString() }), appLine(0, { id: hex(30), t: new Date(NOW - 120 * 864e5).toISOString() })] }, { now: NOW });
  assert.match(when.refused[0].error, /future/);
  assert.match(when.refused[1].error, /older than 100 days/);
});

test('a laptop’s lines are kept for its person; a refused line is named and the rest kept; a repeat is kept once', async () => {
  const s = await makeSite();
  try {
    const raj = await paired(s, 'raj.manager@example.test', 'Raj’s Mac');
    const r1 = await postUsage(s, raj.token, {
      app: [appLine(1), appLine(2), appLine(3, { prompt: 'secret words' })],
      claudeCode: [{ id: hex(10), t: new Date(NOW - 5 * 60e3).toISOString(), family: 'opus', tokens, usd: 1.5 }],
      readings: [{ id: hex(11), t: new Date(NOW).toISOString(), meters }],
      counting: 'counted',
    });
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.body.accepted, { app: 2, claudeCode: 1, readings: 1 });
    assert.equal(r1.body.refused.length, 1);
    assert.equal(r1.body.refused[0].id, hex(3));
    assert.match(r1.body.refused[0].error, /\(prompt\)/);
    // Sent again (the link delivers at least once): nothing new is kept.
    const r2 = await postUsage(s, raj.token, { app: [appLine(1), appLine(2)], counting: 'counted' });
    assert.deepEqual(r2.body.kept, { app: 0, claudeCode: 0, readings: 0 });
    const rows = (await s.db.query('SELECT p.email, u.kind, u.job, u.usd, u.week_percent FROM usage_lines u JOIN people p ON p.id = u.person_id ORDER BY u.kind, u.id')).rows;
    assert.equal(rows.length, 4);
    assert.ok(rows.every((r) => r.email === 'raj.manager@example.test'));
    assert.deepEqual(rows.map((r) => r.kind), ['app', 'app', 'claude-code', 'reading']);
    // Nothing of the refused line's words is anywhere in the table.
    const all = JSON.stringify((await s.db.query('SELECT * FROM usage_lines')).rows);
    assert.doesNotMatch(all, /secret words/);
    const src = (await s.db.query('SELECT claude_code FROM usage_sources')).rows;
    assert.deepEqual(src.map((x) => x.claude_code), ['counted']);
    // Without the laptop's token: 401. A batch that isn't one: 400, in words.
    const none = await s.fetch(`${SITE}/api/runner/usage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(none.status, 401);
    const odd = await postUsage(s, raj.token, { lines: [] });
    assert.equal(odd.status, 400);
    assert.match(odd.body.error, /doesn’t expect \(lines\)/);
  } finally { await s.close(); }
});
