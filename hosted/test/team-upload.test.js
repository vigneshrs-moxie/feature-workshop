// Packet 2E step 2: the runner's usage upload. Each laptop's usage log (in a temporary home, never
// the real one) reaches the site as numbers only: the cleaned lines, the Claude Code replies outside
// the app when the runner offers them, and meter readings. Nothing of a line's text goes; a line
// added later goes on its own; a restart sends nothing twice; a site that is down gets it later.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createSiteLink, siteTokenStore, writeSiteFile, usageBatches, usageWire, USAGE_STATE_FILE } from '../../dashboard/runner/site-link.js';
import { makeSite, SITE } from './helpers.js';
import { fakeRunner, paired, tmp, until } from './laptops.js';

const NOW = Date.parse('2026-10-30T16:00:00Z');
const tokens = { input: 1000, output: 400, cacheRead: 20000, cacheWrite5m: 500, cacheWrite1h: 0 };
const meters = (week, five = 10) => ({ week: { percent: week, resetsAt: '2026-11-04T23:00:00.000Z' }, fiveHour: { percent: five, resetsAt: '2026-10-30T19:00:00.000Z' } });

/** One usage.jsonl line as lib/usage-log.js writes it, with the words a line carries on the laptop. */
const logLine = (minsAgo, extra = {}) => ({
  t: new Date(NOW - minsAgo * 60e3).toISOString(), user: 'raj-moxie', account: 'acct-1234', job: 'add-export', ticket: 'SALES-12', stage: 'implement',
  section: 'Add the export button to the report page', worker: 'foreman', model: 'claude-opus-4-1-20250805', tokens, costUsd: 0.5, costSource: 'estimate',
  meters: meters(40), turn: `turn-${minsAgo}`, session: `session-${minsAgo}`, cliTotalUsd: null, ...extra,
});
const writeLog = (dir, lines) => { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, 'usage.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`); };

async function link(s, token, { runner, stateDir = tmp(), usageDir = path.join(stateDir, 'usage'), fetch = s.fetch, log = () => {} } = {}) {
  writeSiteFile(stateDir, { url: SITE, deviceId: 'device-usage-0001', runnerId: 1, name: 'Test Laptop' });
  const store = await siteTokenStore({ stateDir, prefer: 'file' });
  await store.set(token);
  const timers = { now: () => s.clock.t, sleep: (ms) => new Promise((r) => { setTimeout(r, Math.min(ms, 30)).unref?.(); }) };
  const l = createSiteLink({ runner, stateDir, store, fetch, waitSeconds: 1, debounceMs: 20, watchEveryMs: 0, log, version: '0.1.0', usageEveryMs: 40, usageDir, timers });
  return { link: l.start(), stateDir, usageDir };
}
const rowsOf = async (s) => (await s.db.query('SELECT p.email, u.* FROM usage_lines u JOIN people p ON p.id = u.person_id ORDER BY u.t, u.kind')).rows;

test('the wire: only numbers and short names leave the laptop; batches stay under the limit', () => {
  const [w] = usageWire([{ t: '2026-10-30T15:00:00.000Z', ms: Date.parse('2026-10-30T15:00:00Z'), job: 'add-export', stage: 'implement', model: 'claude-opus-4-1', usd: 0.5, tokens, turn: 't1', session: 's1', worker: 'foreman', week: { percent: 40, resetsAt: '2026-11-04T23:00:00.000Z' }, fiveHour: null }]);
  assert.deepEqual(Object.keys(w).sort(), ['id', 'job', 'meters', 'model', 'stage', 't', 'tokens', 'usd']);
  assert.match(w.id, /^[0-9a-f]{24}$/);
  // A stage the site wouldn't know, or a job name with spaces, goes as nothing rather than as text.
  const [odd] = usageWire([{ t: '2026-10-30T15:00:00.000Z', job: 'An export button', stage: 'thinking hard', model: 'opus with notes', usd: 0, tokens }]);
  assert.deepEqual([odd.job, odd.stage, odd.model], [null, null, null]);
  const many = Array.from({ length: 3000 }, (_, i) => ({ ...w, id: i.toString(16).padStart(24, '0') }));
  const batches = usageBatches({ app: many, claudeCode: [], readings: [], counting: 'off' }, 64 * 1024);
  assert.ok(batches.length > 1);
  assert.equal(batches.reduce((n, b) => n + b.app.length, 0), 3000);
  for (const b of batches) assert.ok(Buffer.byteLength(JSON.stringify(b)) <= 64 * 1024);
});

test('two laptops: each one’s numbers reach the site for its own person, with nothing of the lines’ words', async () => {
  const s = await makeSite();
  const raj = await paired(s, 'raj.manager@example.test', 'Raj’s Mac');
  const sam = await paired(s, 'sam.member@example.test', 'Sam’s laptop');
  const rajRunner = fakeRunner();
  rajRunner.read.claudeCodeReplies = async () => ({ state: 'ready', replies: [{ t: new Date(NOW - 30 * 60e3).toISOString(), user: 'raj-moxie', usd: 1.25, family: 'opus', tokens, sidechain: false }] });
  rajRunner.read.snapshot = async () => ({ planUsage: { enabled: true, week: { percent: 43, resetsAt: '2026-11-04T23:00:00.000Z' }, fiveHour: { percent: 15, resetsAt: '2026-10-30T19:00:00.000Z' }, checkedAt: new Date(NOW - 60e3).toISOString() } });
  const samRunner = fakeRunner();
  samRunner.read.claudeCodeReplies = async () => ({ state: 'off', replies: null });
  const a = tmp();
  const b = tmp();
  writeLog(path.join(a, 'usage'), [logLine(50), logLine(40), logLine(35, { demo: true }), logLine(20, { featureDir: '/tmp/a-test-run/add-export', job: 'test-run' })]);
  writeLog(path.join(b, 'usage'), [logLine(45, { user: 'sam-moxie', job: 'route-sharing', stage: 'test', costUsd: 0.75, meters: meters(41) })]);
  const la = await link(s, raj.token, { runner: rajRunner, stateDir: a });
  const lb = await link(s, sam.token, { runner: samRunner, stateDir: b });
  try {
    await until(async () => (await rowsOf(s)).length === 5, { what: 'both laptops’ usage' });
    const rows = await rowsOf(s);
    const by = (email, kind) => rows.filter((r) => r.email === email && r.kind === kind);
    // Raj: two app lines (the demo line and the test-folder line stay home), one Claude Code reply, one reading.
    assert.equal(by('raj.manager@example.test', 'app').length, 2);
    assert.equal(by('raj.manager@example.test', 'claude-code').length, 1);
    assert.equal(by('raj.manager@example.test', 'reading').length, 1);
    assert.equal(by('raj.manager@example.test', 'reading')[0].week_percent, 43);
    assert.equal(by('sam.member@example.test', 'app').length, 1);
    assert.equal(by('sam.member@example.test', 'app')[0].job, 'route-sharing');
    // Nothing of what the lines said in words: no section, ticket, user name, account, session or turn.
    const all = JSON.stringify(rows);
    for (const words of ['Add the export button', 'SALES-12', 'raj-moxie', 'sam-moxie', 'acct-1234', 'session-', 'turn-', '/tmp/']) assert.ok(!all.includes(words), `"${words}" reached the site`);
    // Each laptop said whether its Claude Code use outside the app is counted.
    const src = (await s.db.query('SELECT p.email, u.claude_code FROM usage_sources u JOIN people p ON p.id = u.person_id ORDER BY p.email')).rows;
    assert.deepEqual(src.map((x) => [x.email, x.claude_code]), [['raj.manager@example.test', 'counted'], ['sam.member@example.test', 'off']]);

    // A line added later goes on its own; nothing is sent twice.
    writeLog(path.join(a, 'usage'), [logLine(5, { costUsd: 0.2 })]);
    await until(async () => (await rowsOf(s)).length === 6, { what: 'the new line' });
    assert.equal((await rowsOf(s)).filter((r) => r.email === 'raj.manager@example.test' && r.kind === 'app').length, 3);
    const state = JSON.parse(fs.readFileSync(path.join(a, USAGE_STATE_FILE), 'utf8'));
    assert.equal(state.url, SITE);
    assert.equal(state.app.t, NOW - 5 * 60e3);
  } finally { la.link.stop(); lb.link.stop(); await s.close(); }
});

test('a restart sends nothing twice; a site that is down gets the lines once it is back', async () => {
  const s = await makeSite();
  const raj = await paired(s, 'raj.manager@example.test', 'Raj’s Mac');
  const dir = tmp();
  writeLog(path.join(dir, 'usage'), [logLine(30), logLine(20)]);
  let calls = 0;
  const one = await link(s, raj.token, { runner: fakeRunner(), stateDir: dir, fetch: async (url, init) => { if (String(url).includes('/api/runner/usage')) calls++; return s.fetch(url, init); } });
  await until(async () => (await rowsOf(s)).length === 2, { what: 'the first upload' });
  one.link.stop();
  const before = calls;
  // Restarted: the same laptop, the same state folder. Nothing new, so nothing is sent at all.
  const two = await link(s, raj.token, { runner: fakeRunner(), stateDir: dir, fetch: async (url, init) => { if (String(url).includes('/api/runner/usage')) calls++; return s.fetch(url, init); } });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(calls, before);
  two.link.stop();
  // The site is down for the usage upload: the line waits in the log and goes once it is back.
  writeLog(path.join(dir, 'usage'), [logLine(10)]);
  let down = true;
  const logs = [];
  const three = await link(s, raj.token, {
    runner: fakeRunner(), stateDir: dir, log: (l) => logs.push(l),
    fetch: async (url, init) => (down && String(url).includes('/api/runner/usage') ? new Response(JSON.stringify({ error: 'Down for a moment.' }), { status: 503 }) : s.fetch(url, init)),
  });
  try {
    await until(() => logs.some((l) => /didn’t take the usage numbers \(503\)/.test(l)), { what: 'the refusal to be noted' });
    assert.equal((await rowsOf(s)).length, 2);
    down = false;
    await until(async () => (await rowsOf(s)).length === 3, { what: 'the line after the site came back', ms: 15000 });
  } finally { three.link.stop(); await s.close(); }
});
