// The top bar's usage meters (lib/plan-usage.js): parsing the usage report, and reading it with an
// injected token and fetch (never the network or the Keychain here).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseUsage, PlanUsage, USAGE_URL } from '../lib/plan-usage.js';

const REPORT = {
  five_hour: { utilization: 4.4, resets_at: '2026-10-26T21:39:59.541656+00:00' },
  seven_day: { utilization: 57, resets_at: '2026-10-28T22:59:59+00:00' },
  seven_day_opus: null,
};
const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const noTick = () => null;

test('parseUsage keeps the 5-hour and weekly meters, rounded, with ISO reset times', () => {
  assert.deepEqual(parseUsage(REPORT), {
    fiveHour: { percent: 4, resetsAt: '2026-10-26T21:39:59.541Z' },
    week: { percent: 57, resetsAt: '2026-10-28T22:59:59.000Z' },
  });
  assert.deepEqual(parseUsage({}), { fiveHour: null, week: null });
  assert.equal(parseUsage({ five_hour: { utilization: 140, resets_at: 'nope' } }).fiveHour.percent, 100);
  assert.equal(parseUsage({ five_hour: { utilization: 1, resets_at: 'nope' } }).fiveHour.resetsAt, null);
});

test('check reads with the sign-in token and says what changed', async () => {
  let asked = null;
  const u = new PlanUsage({ getToken: async () => 'tok', fetchFn: async (url, opts) => { asked = { url, opts }; return ok(REPORT)(); }, now: () => Date.parse('2026-10-26T20:00:00Z'), setTick: noTick });
  const seen = [];
  u.on('change', (v) => seen.push(v));
  const view = await u.check();
  assert.equal(asked.url, USAGE_URL);
  assert.equal(asked.opts.headers.Authorization, 'Bearer tok');
  assert.equal(view.fiveHour.percent, 4);
  assert.equal(view.week.percent, 57);
  assert.equal(view.checkedAt, '2026-10-26T20:00:00.000Z');
  assert.equal(view.error, null);
  assert.equal(seen.length, 1);
  await u.check(); // nothing new
  assert.equal(seen.length, 1);
});

test('trouble is said in words and the last good reading stays', async () => {
  let status = 200;
  const u = new PlanUsage({ getToken: async () => 'tok', fetchFn: async () => ({ ok: status === 200, status, json: async () => REPORT }), setTick: noTick });
  await u.check();
  status = 401;
  const view = await u.check();
  assert.match(view.error, /expired/);
  assert.equal(view.week.percent, 57);
  const none = new PlanUsage({ getToken: async () => null, fetchFn: async () => { throw new Error('never'); }, setTick: noTick });
  assert.match((await none.check()).error, /No Claude Code sign-in/);
});

test('off: never reads', async () => {
  let called = false;
  const u = new PlanUsage({ enabled: false, getToken: async () => { called = true; return 'x'; }, setTick: () => { called = true; } });
  u.start();
  const view = await u.check();
  assert.equal(called, false);
  assert.equal(view.enabled, false);
});
