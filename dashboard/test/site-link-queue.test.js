// The website send queue (runner/site-link.js eventQueue): held in memory, the file read once at
// start, each add one append, a drop one short mark line, the file rewritten only when most of it
// has been sent (and removed when nothing waits), and nothing blocks the event loop for long.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { eventQueue, QUEUE_FILE } from '../runner/site-link.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gc-site-queue-'));
const ev = (i, note = '') => ({ eid: `e-${i}`, v: 1, type: 'status', job: 'add-export', data: { slug: 'add-export', n: i, note } });

/** fs/promises with every call counted, and the bytes written. */
function countingFs() {
  const calls = { open: [], appendFile: 0, rename: 0, rm: 0, readFile: 0, writeFile: 0, written: 0 };
  const io = {
    ...fsp,
    readFile: (...a) => { calls.readFile++; return fsp.readFile(...a); },
    writeFile: (...a) => { calls.writeFile++; return fsp.writeFile(...a); },
    appendFile: (f, data, o) => { calls.appendFile++; calls.written += Buffer.byteLength(data); return fsp.appendFile(f, data, o); },
    rename: (...a) => { calls.rename++; return fsp.rename(...a); },
    rm: (...a) => { calls.rm++; return fsp.rm(...a); },
    open: async (f, flags = 'r', mode) => {
      calls.open.push(flags);
      const fh = await fsp.open(f, flags, mode);
      const write = fh.write.bind(fh);
      fh.write = (data, ...rest) => { calls.written += Buffer.byteLength(data); return write(data, ...rest); };
      return fh;
    },
  };
  return { io, calls };
}

/** Drains like the link's flush loop: batch, the site takes it, drop. Resolves the eids sent, in order. */
async function drain(q, { maxBytes, take = async () => {} } = {}) {
  const sent = [];
  for (;;) {
    const { events, count } = await q.batch(maxBytes);
    if (!count) return sent;
    await take(events);
    sent.push(...events.map((e) => e.eid));
    await q.drop(count);
  }
}

test('10,000 adds and their drains finish quickly: one append each, the file read once, rewritten only a few times', async () => {
  const dir = tmp();
  const file = path.join(dir, QUEUE_FILE);
  const { io, calls } = countingFs();
  const q = eventQueue(file, { fs: io });
  const t0 = Date.now();
  const sent = [];
  let bytes = 0;
  for (let i = 0; i < 10_000; i++) {
    const e = ev(i, 'x'.repeat(200));
    bytes += Buffer.byteLength(JSON.stringify(e)) + 1;
    await q.add(e);
    if (i % 1000 === 999) sent.push(...await drain(q, { maxBytes: 64 * 1024 }));
  }
  const ms = Date.now() - t0;
  assert.equal(sent.length, 10_000);
  assert.deepEqual(sent.slice(0, 3), ['e-0', 'e-1', 'e-2']);
  assert.equal(new Set(sent).size, 10_000, 'each sent once');
  assert.equal(q.size(), 0);
  assert.equal(fs.existsSync(file), false, 'empty: the file is gone');
  assert.ok(ms < 20_000, `${ms} ms (about 1 s alone; the version that read the file back on every add took minutes)`);
  assert.equal(calls.open.filter((f) => f === 'r').length, 1, 'the file is read once, at start');
  assert.equal(calls.readFile, 0);
  assert.ok(calls.appendFile <= 10_000 + 10_000 / 100, `${calls.appendFile} appends`);
  assert.ok(calls.rename <= 5, `${calls.rename} rewrites`);
  assert.ok(calls.written < 2 * bytes, `${calls.written} bytes written for ${bytes} bytes of events`);
});

test('a restart mid-drain reads the file again: what was sent is skipped, the batch not yet marked is sent again, nothing is lost', async () => {
  const file = path.join(tmp(), QUEUE_FILE);
  const a = eventQueue(file);
  for (let i = 0; i < 20; i++) await a.add(ev(i, 'y'.repeat(100)));
  const first = await a.batch(1024);
  assert.ok(first.count > 0 && first.count < 20);
  await a.drop(first.count); // the site had the first batch
  const second = await a.batch(1024); // the site takes the second… and the laptop stops before the drop
  assert.ok(second.count > 0);
  const b = eventQueue(file); // the restart
  const after = await drain(b, { maxBytes: 1024 });
  assert.equal(b.size(), 0);
  assert.deepEqual(after.slice(0, second.count), second.events.map((e) => e.eid), 'only the unmarked batch goes again');
  const all = new Set([...first.events.map((e) => e.eid), ...after]);
  assert.equal(all.size, 20, 'every event reached the site');
  assert.equal(after.length, 20 - first.count, 'nothing before the mark is sent again');
});

test('a restart after many drops and a rewrite: only what waits is read', async () => {
  const file = path.join(tmp(), QUEUE_FILE);
  const a = eventQueue(file);
  const big = 'z'.repeat(20 * 1024);
  for (let i = 0; i < 150; i++) await a.add(ev(i, big)); // ~3 MB
  let left = 150;
  while (left > 10) { const { count } = await a.batch(64 * 1024); await a.drop(count); left -= count; }
  assert.equal(a.size(), left);
  assert.ok(fs.statSync(file).size < 3 * 1024 * 1024, 'the sent part was cut from the file');
  const b = eventQueue(file);
  const rest = await drain(b);
  assert.deepEqual(rest, Array.from({ length: left }, (_, k) => `e-${150 - left + k}`));
});

test('past the most that may wait, the oldest are dropped with the same log line, across a restart too', async () => {
  const file = path.join(tmp(), QUEUE_FILE);
  const lines = [];
  const q = eventQueue(file, { max: 3, log: (l) => lines.push(l) });
  for (let i = 0; i < 5; i++) await q.add(ev(i));
  assert.equal(q.size(), 3);
  assert.deepEqual(lines, ['site link: more than 3 events waiting; the oldest 1 are dropped.', 'site link: more than 3 events waiting; the oldest 1 are dropped.']);
  assert.deepEqual(await drain(eventQueue(file, { max: 3 })), ['e-2', 'e-3', 'e-4']);
});

test('a line that can’t be read is skipped (a queue left by the old version, a line cut short by a crash)', async () => {
  const file = path.join(tmp(), QUEUE_FILE);
  fs.writeFileSync(file, `${JSON.stringify(ev(1))}\nnot json\n${JSON.stringify(ev(2))}\n{"eid":"cut-sh`, { mode: 0o600 });
  const q = eventQueue(file);
  await q.add(ev(3)); // starts on its own line, after the cut one
  assert.equal(q.size(), 5);
  const { events, count } = await q.batch();
  assert.deepEqual(events.map((e) => e.eid), ['e-1', 'e-2', 'e-3']);
  assert.equal(count, 5);
  await q.drop(count);
  assert.equal(fs.existsSync(file), false);
});

test('the file is removed when the queue empties; it is readable by you only, in a folder only you can open', async () => {
  const dir = path.join(tmp(), 'state');
  const file = path.join(dir, QUEUE_FILE);
  const q = eventQueue(file);
  let drained = 0;
  q.events.on('drained', () => drained++);
  await q.add(ev(1));
  await q.add(ev(2));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  await q.drop(1);
  assert.equal(drained, 0);
  await q.drop(1);
  assert.equal(drained, 1, 'it says when it drains');
  assert.equal(fs.existsSync(file), false);
  assert.equal(q.size(), 0);
  await q.add(ev(3));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'made again, still yours only');
  const empty = q.whenEmpty();
  await q.drop(1);
  await empty;
  assert.equal(fs.existsSync(file), false);
});

test('timing: 5,000 events of 50 KB drain through a fake site with no synchronous stretch over ~50 ms', { timeout: 240_000 }, async () => {
  const dir = tmp();
  const file = path.join(dir, QUEUE_FILE);
  const note = 'q'.repeat(50 * 1024);
  const fd = fs.openSync(file, 'w', 0o600);
  for (let i = 0; i < 5000; i++) fs.writeSync(fd, `${JSON.stringify(ev(i, note))}\n`);
  fs.closeSync(fd);
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  const t0 = Date.now();
  try {
    const q = eventQueue(file); // a restart with a full queue
    const site = async (events) => { JSON.stringify({ events }); await new Promise((r) => setImmediate(r)); };
    const sent = await drain(q, { maxBytes: 256 * 1024, take: site });
    assert.equal(sent.length, 5000);
  } finally {
    h.disable();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const maxMs = h.max / 1e6;
  console.log(`# 5,000 x 50 KB drained in ${Date.now() - t0} ms; event-loop delay max ${maxMs.toFixed(1)} ms, p99 ${(h.percentile(99) / 1e6).toFixed(1)} ms`);
  assert.ok(maxMs < 60, `the longest stretch was ${maxMs.toFixed(1)} ms`);
});

test('reload reads the file again: a queue file removed by another process (login with a new address, logout) is gone from memory too', async () => {
  const file = path.join(tmp(), QUEUE_FILE);
  const q = eventQueue(file);
  await q.add(ev(1));
  await q.add(ev(2));
  fs.rmSync(file); // as pairWithSite and unpairFromSite do, in the CLI's own process
  assert.equal(q.size(), 2, 'memory still holds them');
  await q.reload();
  assert.equal(q.size(), 0);
  await q.add(ev(3));
  assert.deepEqual(await drain(q), ['e-3']);
});
