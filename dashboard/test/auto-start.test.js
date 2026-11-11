// Auto start by tag (lib/auto-start.js): which ticket starts by itself, and the starter that keeps it
// to one job at a time, one try per ticket. No model, no Orbit, no real job: fakes stand in.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AutoStarter, isBusy, lastJob, normalizeAutoStart, pausedFor, pickNext, tagMatches } from '../lib/auto-start.js';

const dirs = [];
async function tmp() { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-autostart-')); dirs.push(d); return d; }
after(async () => { for (const d of dirs) await fs.rm(d, { recursive: true, force: true }); });

const item = (n, o = {}) => ({ key: `ORBIT-${n}`, number: n, title: `Ticket ${n}`, type: 'bug', status: 'open', why: ['assigned'], tags: ['auto'], url: `https://orbit.test/admin/feedback/ORBIT-${n}`, job: null, ...o });
const SETTING = { on: true, tag: 'auto' };
const MEMORY = { started: [], failed: [] };
const ask = (o = {}) => pickNext({ items: [item(1)], setting: SETTING, memory: MEMORY, ticketsWithJobs: new Set(), busy: false, paused: null, tagsShown: true, ...o });

test('a tagged assigned ticket starts', () => assert.equal(ask().start.key, 'ORBIT-1'));
test('an untagged ticket never starts', () => {
  assert.deepEqual(ask({ items: [item(1, { tags: [] }), item(2, { tags: ['other'] })] }), { wait: 'nothing' });
});
test('a tagged ticket that has or had a job is not started', () => {
  assert.deepEqual(ask({ ticketsWithJobs: new Set(['ORBIT-1']) }), { wait: 'nothing' });
  assert.deepEqual(ask({ items: [item(1, { job: { slug: 'orbit-1-x' } })] }), { wait: 'nothing' });
  assert.equal(ask({ items: [item(1), item(2)], ticketsWithJobs: new Set(['ORBIT-1']) }).start.key, 'ORBIT-2');
});
test('a ticket tried before is not started again', () => {
  assert.deepEqual(ask({ memory: { started: [{ key: 'ORBIT-1', at: 'x', slug: 's', tag: 'auto' }], failed: [] } }), { wait: 'nothing' });
  assert.deepEqual(ask({ memory: { started: [], failed: [{ key: 'ORBIT-1', at: 'x', reason: 'No.' }] } }), { wait: 'nothing' });
});
test('a tag that differs only in case matches, an archived tag counts', () => {
  assert.equal(tagMatches({ tags: ['Auto'] }, ' AUTO '), true);
  assert.equal(ask({ items: [item(1, { tags: ['AuTo'] })] }).start.key, 'ORBIT-1');
  assert.equal(tagMatches({ tags: ['automatic'] }, 'auto'), false);
});
test("the ticket's text saying the tag's name starts nothing", () => {
  const sneaky = item(1, { tags: [], title: 'please auto this', description: 'tag: auto', comment: 'auto' });
  assert.equal(tagMatches(sneaky, 'auto'), false);
  assert.deepEqual(ask({ items: [sneaky] }), { wait: 'nothing' });
  assert.equal(tagMatches({ title: 'auto' }, 'auto'), false);
});
test('only assigned, open tickets are candidates', () => {
  assert.deepEqual(ask({ items: [item(1, { why: [] })] }), { wait: 'nothing' });
  assert.deepEqual(ask({ items: [item(1, { status: 'closed' })] }), { wait: 'nothing' });
  assert.deepEqual(ask({ items: [item(1, { status: 'resolved' })] }), { wait: 'nothing' });
});
test('the first candidate in the Inbox order starts', () => assert.equal(ask({ items: [item(3), item(2)] }).start.key, 'ORBIT-3'));
test('switch off, empty tag, or no tags shown: nothing starts', () => {
  assert.deepEqual(ask({ setting: { on: false, tag: 'auto' } }), { wait: 'off' });
  assert.deepEqual(ask({ setting: { on: true, tag: '   ' } }), { wait: 'no-tag' });
  assert.deepEqual(ask({ tagsShown: false }), { wait: 'no-tags-shown' });
  assert.deepEqual(ask({ tagsShown: undefined }), { wait: 'no-tags-shown' });
});
test('nothing starts while the limit warning shows or Orbit cannot be reached', () => {
  assert.deepEqual(ask({ paused: 'limit' }), { wait: 'paused-limit' });
  assert.deepEqual(ask({ paused: 'orbit' }), { wait: 'paused-orbit' });
});
test('a job still running to PR #1 keeps the next ticket waiting', () => assert.deepEqual(ask({ busy: true }), { wait: 'busy' }));
test('the setting is trimmed and at most 60 characters', () => {
  assert.deepEqual(normalizeAutoStart(undefined), { on: false, tag: '' });
  assert.deepEqual(normalizeAutoStart({ on: 'yes', tag: ' auto ' }), { on: false, tag: 'auto' });
  assert.equal(normalizeAutoStart({ on: true, tag: 'x'.repeat(80) }).tag.length, 60);
});

// ---------- The starter ----------

async function rig(over = {}) {
  const dir = await tmp();
  const file = path.join(dir, 'auto-start.json');
  const r = {
    dir, file, items: [item(1)], setting: { ...SETTING }, tickets: new Set(), busy: false, paused: null, tagsShown: true,
    started: [], told: [], failWith: null, seenFile: [],
  };
  Object.assign(r, over);
  r.starter = new AutoStarter({
    file, now: () => '2026-11-11T10:00:00.000Z', ...(r.write ? { write: (...a) => r.write(...a) } : {}),
    setting: async () => r.setting,
    inbox: () => ({ items: r.items, tagsShown: r.tagsShown }),
    jobs: async () => ({ ticketsWithJobs: r.tickets, busy: r.busy }),
    paused: () => r.paused,
    start: async (it, tag) => {
      r.seenFile.push(JSON.parse(await fs.readFile(file, 'utf8')));
      if (r.failWith) throw new Error(r.failWith);
      r.started.push({ key: it.key, tag });
      return { slug: `orbit-${it.number}-t` };
    },
    notify: async (n) => { r.told.push(n); },
  });
  return r;
}

test('a tagged assigned ticket starts once', async () => {
  const r = await rig();
  await r.starter.run();
  await r.starter.run();
  assert.deepEqual(r.started, [{ key: 'ORBIT-1', tag: 'auto' }]);
  const saved = JSON.parse(await fs.readFile(r.file, 'utf8'));
  assert.deepEqual(saved.started, [{ key: 'ORBIT-1', at: '2026-11-11T10:00:00.000Z', slug: 'orbit-1-t', tag: 'auto' }]);
  // written before the start, and no temp file left behind
  assert.deepEqual(r.seenFile[0].started.map((e) => e.key), ['ORBIT-1']);
  assert.deepEqual((await fs.readdir(r.dir)).filter((f) => f.includes('.tmp')), []);
});
test('a notification is sent once per started job', async () => {
  const r = await rig({ items: [item(1, { title: 'Fix the dial' })] });
  await r.starter.run(); await r.starter.run();
  assert.equal(r.told.length, 1);
  assert.deepEqual({ level: r.told[0].level, title: r.told[0].title, body: r.told[0].body, slug: r.told[0].slug }, {
    level: 'needs', title: 'Started by Auto: ORBIT-1', slug: 'orbit-1-t',
    body: 'Fix the dial. It has the tag "auto". Auto runs it to PR #1 and asks you only if it must.',
  });
});
test('two tagged tickets start one after the other', async () => {
  const r = await rig({ items: [item(1), item(2)] });
  await r.starter.run();
  r.busy = true; // the first job is still on its way to PR #1
  r.tickets = new Set(['ORBIT-1']);
  await r.starter.run();
  assert.deepEqual(r.started.map((s) => s.key), ['ORBIT-1']);
  r.busy = false; // it stopped, or PR #1 is open
  await r.starter.run();
  assert.deepEqual(r.started.map((s) => s.key), ['ORBIT-1', 'ORBIT-2']);
});
test('a start that fails is remembered and not tried again', async () => {
  const r = await rig({ failWith: 'This laptop has no repository for it.' });
  await r.starter.run();
  r.failWith = null;
  await r.starter.run();
  assert.deepEqual(r.started, []);
  assert.deepEqual(r.told, []);
  const saved = JSON.parse(await fs.readFile(r.file, 'utf8'));
  assert.deepEqual(saved, { started: [], failed: [{ key: 'ORBIT-1', at: '2026-11-11T10:00:00.000Z', reason: 'This laptop has no repository for it.' }] });
  assert.equal(r.starter.failedReason('ORBIT-1'), 'This laptop has no repository for it.');
  // Start on its row clears it
  await r.starter.clearFailed('ORBIT-1');
  assert.equal(r.starter.failedReason('ORBIT-1'), null);
});
test('nothing starts while the limit warning shows, or Orbit is out of reach', async () => {
  const r = await rig({ paused: 'limit' });
  await r.starter.run();
  r.paused = 'orbit';
  await r.starter.run();
  assert.deepEqual(r.started, []);
});
test('switch off, empty tag, or no tags shown: the starter starts nothing', async () => {
  const r = await rig();
  r.setting = { on: false, tag: 'auto' }; await r.starter.run();
  r.setting = { on: true, tag: '' }; await r.starter.run();
  r.setting = { on: true, tag: 'auto' }; r.tagsShown = false; await r.starter.run();
  assert.deepEqual(r.started, []);
});
test('a memory file that cannot be read starts nothing', async () => {
  const r = await rig();
  await fs.writeFile(r.file, '{not json');
  await r.starter.run();
  assert.deepEqual(r.started, []);
});
test('runs overlapping start only one job', async () => {
  const r = await rig();
  await Promise.all([r.starter.run(), r.starter.run(), r.starter.run()]);
  assert.equal(r.started.length, 1);
});

// ---------- Fix round 1 ----------

const JOB = { jobOpen: true, pr1Open: false, replyRunning: false, autoOn: true, autoStopped: false };
test('A1: busy while the job is open, PR #1 is not, and a reply runs or Auto is on and not stopped', () => {
  assert.equal(isBusy({ ...JOB, autoOn: false, replyRunning: true }), true, 'Auto switched off, reply running');
  assert.equal(isBusy({ ...JOB, autoOn: false, replyRunning: false }), false, 'Auto switched off, idle');
  assert.equal(isBusy({ ...JOB, autoStopped: true }), false, 'Auto stopped, waiting for the person');
  assert.equal(isBusy({ ...JOB, autoStopped: true, replyRunning: true }), true, 'a reply runs even when stopped');
  assert.equal(isBusy({ ...JOB }), true, 'Auto on, idle at a gate');
  assert.equal(isBusy({ ...JOB, pr1Open: true }), false);
  assert.equal(isBusy({ ...JOB, jobOpen: false, replyRunning: true }), false);
});

test('A2: a save that fails after a good start is not a failed start, and is retried', async () => {
  let calls = 0;
  const r = await rig({ items: [item(1), item(2)], write: async (f, data, o) => {
    calls += 1;
    if (calls === 2) throw new Error('disk full'); // the save of the slug
    return (await import('../lib/atomic-write.js')).writeFileAtomic(f, data, o);
  } });
  const out = await r.starter.run();
  assert.deepEqual(r.started.map((s) => s.key), ['ORBIT-1']);
  assert.equal(r.starter.failedReason('ORBIT-1'), null);
  assert.equal(r.starter.lastStarted().slug, 'orbit-1-t'); // in memory
  r.busy = true; r.tickets = new Set(['ORBIT-1']);
  await r.starter.run();
  const saved = JSON.parse(await fs.readFile(r.file, 'utf8'));
  assert.deepEqual(saved.started.map((e) => [e.key, e.slug]), [['ORBIT-1', 'orbit-1-t']]);
  assert.deepEqual(saved.failed, []);
  assert.deepEqual(r.started.map((s) => s.key), ['ORBIT-1']);
  void out;
});

test('A3: a started entry with no slug and no job is shown as a failed start, never restarted', async () => {
  const r = await rig();
  await fs.writeFile(r.file, JSON.stringify({ started: [{ key: 'ORBIT-1', at: 'x', slug: null, tag: 'auto' }], failed: [] }));
  await r.starter.run();
  assert.deepEqual(r.started, []);
  assert.match(r.starter.failedReason('ORBIT-1'), /stopped while it was starting/i);
  const saved = JSON.parse(await fs.readFile(r.file, 'utf8'));
  assert.deepEqual(saved.started, []);
  assert.equal(saved.failed[0].key, 'ORBIT-1');
  // one that does have a job is left alone
  const r2 = await rig({ tickets: new Set(['ORBIT-1']) });
  await fs.writeFile(r2.file, JSON.stringify({ started: [{ key: 'ORBIT-1', at: 'x', slug: null, tag: 'auto' }], failed: [] }));
  await r2.starter.run();
  assert.equal(r2.starter.failedReason('ORBIT-1'), null);
});

test('A4: the limit pause fails closed, unless the reading is switched off', () => {
  const ok = { orbitError: null, limited: false, warnings: 0, reading: { enabled: true, error: null, checkedAt: '2026-11-11T10:00:00Z' } };
  assert.equal(pausedFor(ok), null);
  assert.equal(pausedFor({ ...ok, orbitError: 'x' }), 'orbit');
  assert.equal(pausedFor({ ...ok, limited: true }), 'limit');
  assert.equal(pausedFor({ ...ok, warnings: 1 }), 'limit');
  assert.equal(pausedFor({ ...ok, reading: { ...ok.reading, error: 'Claude answered 429.' } }), 'limit-reading');
  assert.equal(pausedFor({ ...ok, reading: { ...ok.reading, checkedAt: null } }), 'limit-reading');
  assert.equal(pausedFor({ ...ok, reading: { enabled: false, error: null, checkedAt: null } }), null);
});

test('A5: a start refused because of the limit is not a failed start; the ticket stays untried', async () => {
  const r = await rig({ items: [item(1), item(2)] });
  r.starter.start = async () => { throw Object.assign(new Error('Limit.'), { extra: { code: 'limited' }, status: 409 }); };
  const out = await r.starter.run();
  assert.equal(r.starter.failedReason('ORBIT-1'), null);
  assert.deepEqual(JSON.parse(await fs.readFile(r.file, 'utf8')), { started: [], failed: [] });
  r.starter.start = async (it) => { r.started.push({ key: it.key }); return { slug: 's' }; };
  await r.starter.run();
  assert.deepEqual(r.started.map((s) => s.key), ['ORBIT-1']);
  void out;
});

test('A6: an unreadable memory file is reported', async () => {
  const r = await rig();
  assert.equal(r.starter.memoryUnreadable(), false);
  await fs.writeFile(r.file, '{not json');
  await r.starter.run();
  assert.equal(r.starter.memoryUnreadable(), true);
});

test('a refusal that is not the limit is a failed start, whatever its status', async () => {
  const r = await rig({ items: [item(1)] });
  r.starter.start = async () => { throw Object.assign(new Error('A job is already starting.'), { status: 409 }); };
  await r.starter.run();
  assert.equal(r.starter.failedReason('ORBIT-1'), 'A job is already starting.');
});

test('the last job is found by its slug, and by its ticket when a crash left no slug', () => {
  const jobs = [{ slug: 'a', key: 'ORBIT-1', closed: true }, { slug: 'b', key: 'ORBIT-1', closed: false }, { slug: 'c', key: 'ORBIT-2', closed: false }];
  assert.equal(lastJob({ key: 'ORBIT-2', slug: 'c' }, jobs).slug, 'c');
  assert.equal(lastJob({ key: 'ORBIT-1', slug: null }, jobs).slug, 'b', 'the open job for that ticket');
  assert.equal(lastJob({ key: 'ORBIT-1', slug: 'gone' }, jobs), null);
  assert.equal(lastJob({ key: 'ORBIT-9', slug: null }, jobs), null);
  assert.equal(lastJob(null, jobs), null);
});
