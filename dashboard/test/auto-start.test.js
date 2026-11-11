// Auto start by tag (lib/auto-start.js): which ticket starts by itself, and the starter that keeps it
// to one job at a time, one try per ticket. No model, no Orbit, no real job: fakes stand in.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AutoStarter, normalizeAutoStart, pickNext, tagMatches } from '../lib/auto-start.js';

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
    file, now: () => '2026-11-11T10:00:00.000Z',
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
