// Usage warnings at 80 %, 90 % and full (lib/usage-warnings.js), each once per reset window. Nothing
// reaches the network or macOS: the meters are made up and the sender is a list.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { decide, Notifier, notifySettings, usageNotice, validateNotifyPatch } from '../lib/notify.js';
import { PlanUsage } from '../lib/plan-usage.js';
import { activeWarnings, check, MEMORY_FILE, remember, resetWhen, sameWindow, UsageWarnings, warningText } from '../lib/usage-warnings.js';

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
  const w = new UsageWarnings({ dir: () => null, send: async () => { throw new Error('no macOS'); } });
  const out = await w.onRead(meters(90));
  assert.equal(out.length, 1);
  assert.equal(out[0].sent, null);
  assert.deepEqual(await w.onRead(meters(90)), []);
});

test('the text: word and number, and when it resets, in local time', () => {
  const now = new Date(2026, 9, 28, 12, 0); // a Wednesday
  const thu = new Date(2026, 9, 29, 14, 0).toISOString();
  assert.equal(resetWhen(new Date(2026, 9, 28, 21, 40).toISOString(), now), 'today 21:40');
  assert.equal(resetWhen(thu, now), 'tomorrow 14:00');
  assert.equal(resetWhen(new Date(2026, 9, 31, 9, 5).toISOString(), now), 'Saturday 09:05');
  assert.equal(resetWhen(new Date(2026, 10, 6, 14, 0).toISOString(), now), '6 November 14:00');
  assert.equal(resetWhen(null, now), '');
  assert.equal(warningText({ meter: 'week', percent: 82, resetsAt: new Date(2026, 9, 30, 14, 0).toISOString() }, now), 'Weekly Claude usage is at 82 %. It resets Friday 14:00.');
  assert.equal(warningText({ meter: 'fiveHour', percent: 100, resetsAt: thu }, now), 'Five-hour Claude usage is full (100 %). It resets tomorrow 14:00.');
  assert.equal(warningText({ meter: 'week', percent: 91, resetsAt: null }, now), 'Weekly Claude usage is at 91 %. Claude didn’t say when it resets.');
});

test('the banner: each meter at 80 % or more, its highest threshold, with an id per threshold and window', () => {
  const now = new Date(2026, 9, 28, 12, 0);
  assert.deepEqual(activeWarnings(null, now), []);
  assert.deepEqual(activeWarnings(meters(79), now), []);
  const [w] = activeWarnings(meters(93), now);
  assert.equal(w.threshold, 90);
  assert.equal(w.id, `week:90:${WEEK_RESET}`);
  assert.match(w.text, /^Weekly Claude usage is at 93 %\./);
  assert.deepEqual(activeWarnings(meters(100, 85), now).map((x) => [x.meter, x.threshold]), [['fiveHour', 80], ['week', 100]]);
});

test('notify: the usage kind has its own switch, on unless turned off, and keeps the other rules', () => {
  const noon = new Date(2026, 9, 28, 12, 0);
  assert.deepEqual(decide('usage', notifySettings({}), { now: noon }), { send: true, sound: true, why: null });
  const off = validateNotifyPatch({ usageWarnings: false }, {});
  assert.equal(off.usageWarnings, false);
  assert.deepEqual(decide('usage', off, { now: noon }), { send: false, sound: false, why: 'Usage warnings are off.' });
  assert.equal(validateNotifyPatch({ usageWarnings: true }, off).usageWarnings, true);
  assert.throws(() => validateNotifyPatch({ usageWarnings: 'yes' }, {}), /on or off/);
  assert.equal(decide('usage', { enabled: false }, { now: noon }).send, false, 'all notifications off');
  assert.equal(decide('usage', {}, { now: noon, watching: true }).send, false, 'the banner shows it already');
  assert.equal(decide('usage', { quiet: { on: true, from: '11:00', to: '13:00' } }, { now: noon }).send, false, 'quiet hours');
  assert.equal(decide('usage', {}, { now: noon, demo: true }).send, false);
  assert.equal(decide('needs', off, { now: noon }).send, true, 'the other kinds are untouched');
});

test('notify: a usage warning is told with the banner’s words, through the dashboard’s notifier, into its state folder', async () => {
  const dir = await tmp();
  const runs = [];
  const notifier = new Notifier({ dir, settings: async () => ({}), baseUrl: 'http://127.0.0.1:4485', method: 'osascript', run: async (cmd, args) => { runs.push([cmd, args]); return { ok: true }; }, now: () => new Date(2026, 9, 28, 12, 0) });
  const w = new UsageWarnings({ now: () => new Date(2026, 9, 28, 12, 0) }); // the defaults: the notifier made last
  const [fired] = await w.onRead(meters(91));
  assert.equal(fired.sent.sent, true);
  assert.equal(fired.sent.level, 'usage');
  assert.equal(fired.sent.title, 'Claude usage at 91 %');
  assert.equal(fired.sent.body, fired.text);
  assert.equal(runs.length, 1);
  assert.match(runs[0][1][1], /Weekly Claude usage is at 91 %\. It resets /);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, MEMORY_FILE), 'utf8')).week.fired, [80, 90]);
  assert.equal((await notifier.list())[0].level, 'usage');
  assert.deepEqual(usageNotice({ meter: 'fiveHour', threshold: 100, percent: 100, text: 'x' }), { level: 'usage', title: 'Claude usage is full', body: 'x', key: 'usage-fiveHour' });
});

// Through the minute's reads (lib/plan-usage.js): an injected token, fetch and sender.
function reading() {
  const r = { status: 200, week: 50, five: 10, weekReset: '2026-10-29T13:00:00.541656+00:00', fiveReset: '2026-10-28T21:40:00+00:00', sent: [], events: [] };
  const fetchFn = async () => ({
    ok: r.status === 200, status: r.status, headers: { get: () => null },
    json: async () => ({ five_hour: { utilization: r.five, resets_at: r.fiveReset }, seven_day: { utilization: r.week, resets_at: r.weekReset } }),
  });
  const warnings = new UsageWarnings({ dir: () => null, send: async (w) => { r.sent.push(`${w.meter} ${w.threshold}`); return { sent: true }; }, now: () => new Date(2026, 9, 28, 12, 0) });
  r.usage = new PlanUsage({ getToken: async () => 'tok', fetchFn, now: () => Date.parse('2026-10-28T12:00:00Z'), setTick: () => null, warnings });
  r.usage.on('warning', (w) => r.events.push(w.id));
  return r;
}

test('reads: 80, 90 and full each fire once, however many reads sit at that level', async () => {
  const r = reading();
  for (const pct of [50, 79, 80, 81, 85, 89, 90, 92, 99, 100, 100, 100]) { r.week = pct; await r.usage.check(); }
  assert.deepEqual(r.sent, ['week 80', 'week 90', 'week 100']);
  assert.equal(r.events.length, 3, 'each one is emitted too');
  assert.equal(r.usage.view().warnings[0].text.startsWith('Weekly Claude usage is full (100 %).'), true);
});

test('reads: a new reset window starts over; the same window with a wobbled reset time does not', async () => {
  const r = reading();
  r.week = 91; await r.usage.check();
  r.weekReset = '2026-10-29T13:00:03.100000+00:00'; r.week = 93; await r.usage.check();
  assert.deepEqual(r.sent, ['week 90']);
  // The week resets: low again, then climbing in the new window.
  r.weekReset = '2026-11-05T13:00:00+00:00'; r.week = 2; await r.usage.check();
  assert.deepEqual(r.usage.view().warnings, [], 'the banner clears with the reset');
  r.week = 80; await r.usage.check();
  r.week = 90; await r.usage.check();
  assert.deepEqual(r.sent, ['week 90', 'week 80', 'week 90']);
});

test('reads: no warning when the read failed, and the five-hour meter counts on its own', async () => {
  const r = reading();
  r.week = 95;
  for (const status of [401, 429, 500]) { r.status = status; await r.usage.check(); }
  assert.deepEqual(r.sent, []);
  assert.deepEqual(r.usage.view().warnings, [], 'nothing on the banner before a good read');
  const none = new PlanUsage({ getToken: async () => null, fetchFn: async () => { throw new Error('never'); }, setTick: () => null, warnings: { onRead: async () => { throw new Error('must not be asked'); } } });
  assert.match((await none.check()).error, /No Claude Code sign-in/);
  r.status = 200; r.five = 84; await r.usage.check();
  assert.deepEqual(r.sent.sort(), ['fiveHour 80', 'week 90']);
  // A failed read after a good one keeps the banner from the last good numbers and sends nothing new.
  r.status = 429; r.five = 100; await r.usage.check();
  assert.equal(r.sent.length, 2);
  assert.deepEqual(r.usage.view().warnings.map((w) => w.id).sort(), ['fiveHour:80:2026-10-28T21:40:00.000Z', 'week:90:2026-10-29T13:00:00.541Z']);
});
