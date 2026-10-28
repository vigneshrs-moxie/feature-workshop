// Usage warnings at 80 %, 90 % and full (lib/usage-warnings.js), each once per reset window. Nothing
// reaches the network or macOS: the meters are made up and the sender is a list.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { check, MEMORY_FILE, remember, sameWindow, UsageWarnings } from '../lib/usage-warnings.js';

const WEEK_RESET = '2026-10-29T13:00:00.000Z';
const FIVE_RESET = '2026-10-28T21:40:00.000Z';
const meters = (week, five = 10, { weekReset = WEEK_RESET, fiveReset = FIVE_RESET } = {}) => ({
  fiveHour: five == null ? null : { percent: five, resetsAt: fiveReset },
  week: week == null ? null : { percent: week, resetsAt: weekReset },
});
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'usage-warnings-'));

test('check: 80, 90 and full, each the highest reached and not fired yet in this window', () => {
  assert.deepEqual(check(meters(79), {}), []);
  assert.deepEqual(check(meters(82), {}).map((w) => [w.meter, w.threshold, w.percent]), [['week', 80, 82]]);
  assert.deepEqual(check(meters(95, 100), {}).map((w) => [w.meter, w.threshold]), [['fiveHour', 100], ['week', 90]]);
  const after80 = remember({}, meters(82), check(meters(82), {}));
  assert.deepEqual(after80, { week: { resetsAt: WEEK_RESET, fired: [80] } });
  assert.deepEqual(check(meters(85), after80), [], '80 has fired in this window');
  assert.deepEqual(check(meters(91), after80).map((w) => w.threshold), [90]);
});

test('check: a jump past two thresholds fires the higher one only, and the lower never comes after', () => {
  const fired = check(meters(95), {});
  assert.deepEqual(fired.map((w) => w.threshold), [90]);
  const mem = remember({}, meters(95), fired);
  assert.deepEqual(mem.week.fired, [80, 90]);
  assert.deepEqual(check(meters(88), mem), []);
});

test('check: nothing without meters (a failed read) or for a meter the plan lacks', () => {
  assert.deepEqual(check(null, {}), []);
  assert.deepEqual(check(undefined), []);
  assert.deepEqual(check(meters(null, null), {}), []);
});

test('a new reset time is a new window; a wobble of seconds is not', () => {
  assert.equal(sameWindow(WEEK_RESET, '2026-10-29T13:00:02.400Z'), true);
  assert.equal(sameWindow(WEEK_RESET, '2026-11-05T13:00:00.000Z'), false);
  assert.equal(sameWindow(null, null), true);
  assert.equal(sameWindow(null, WEEK_RESET), false);
  const mem = remember({}, meters(91), check(meters(91), {}));
  assert.deepEqual(check(meters(92, 10, { weekReset: '2026-10-29T13:00:01.000Z' }), mem), []);
  const next = { weekReset: '2026-11-05T13:00:00.000Z' };
  assert.deepEqual(check(meters(83, 10, next), mem).map((w) => w.threshold), [80]);
  assert.deepEqual(remember(mem, meters(5, 10, next), []), {}, 'the old window is forgotten');
});

test('UsageWarnings: sends once, keeps the memory in the state folder, and a restart does not warn again', async () => {
  const dir = await tmp();
  const sent = [];
  const send = async (w) => { sent.push(w); return { sent: true }; };
  const now = () => new Date(2026, 9, 28, 12, 0);
  const a = new UsageWarnings({ dir: () => dir, send, now });
  const first = await a.onRead(meters(82));
  assert.equal(first.length, 1);
  assert.match(first[0].text, /^Weekly Claude usage is at 82 %\. It resets /);
  assert.deepEqual(first[0].sent, { sent: true });
  assert.deepEqual(await a.onRead(meters(84)), []);
  const saved = JSON.parse(await fs.readFile(path.join(dir, MEMORY_FILE), 'utf8'));
  assert.deepEqual(saved, { week: { resetsAt: WEEK_RESET, fired: [80] } });
  const b = new UsageWarnings({ dir: () => dir, send, now });
  assert.deepEqual(await b.onRead(meters(86)), [], 'the memory survives a restart');
  assert.equal((await b.onRead(meters(100))).map((w) => w.text)[0].startsWith('Weekly Claude usage is full (100 %).'), true);
  assert.equal(sent.length, 2);
});

test('UsageWarnings: without a state folder the memory stays in this process; a failing sender is not fatal', async () => {
  const w = new UsageWarnings({ send: async () => { throw new Error('no macOS'); } });
  const out = await w.onRead(meters(90));
  assert.equal(out.length, 1);
  assert.equal(out[0].sent, null);
  assert.deepEqual(await w.onRead(meters(90)), []);
});
