// The one message waiting for a job's Foreman (lib/queued.js, the job page rebuild Task 16, R8): one per
// job, kept in Starbase's own state folder so a restart finds it, replaced only when asked, taken once.
// Temp folders only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WAITING_FILE, WaitingExists, WaitingMessages } from '../lib/queued.js';

const JOB = '/jobs/visit-audit';
const OTHER = '/jobs/other';

async function tmp() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sb-queued-')));
  return { dir, file: path.join(dir, WAITING_FILE), done: () => fs.rm(dir, { recursive: true, force: true }) };
}
const clock = () => { let n = 0; return () => `2026-11-13T12:00:0${n++}.000Z`; };

test('Q1: one message per job; the view is its words, when and why (null until a send is refused)', async () => {
  const t = await tmp();
  try {
    const w = new WaitingMessages({ file: t.file, now: clock() });
    await w.load();
    assert.equal(w.get(JOB), null);
    assert.equal(w.view(JOB), null);
    const v = await w.put(JOB, { slug: 'visit-audit', text: 'Also the header.' });
    assert.deepEqual(v, { text: 'Also the header.', at: '2026-11-13T12:00:00.000Z', why: null });
    assert.deepEqual(w.view(JOB), v);
    assert.equal(w.get(JOB).slug, 'visit-audit');
    assert.equal(w.view(OTHER), null, 'another job has none');
  } finally { await t.done(); }
});

test('Q2: a second message is refused, naming the first, unless it replaces it', async () => {
  const t = await tmp();
  try {
    const w = new WaitingMessages({ file: t.file, now: clock() });
    await w.load();
    await w.put(JOB, { slug: 'visit-audit', text: 'First words.' });
    await assert.rejects(w.put(JOB, { slug: 'visit-audit', text: 'Second words.' }), (err) => {
      assert.ok(err instanceof WaitingExists);
      assert.deepEqual(err.waiting, { text: 'First words.', at: '2026-11-13T12:00:00.000Z', why: null });
      return true;
    });
    assert.equal(w.view(JOB).text, 'First words.');
    const v = await w.put(JOB, { slug: 'visit-audit', text: 'Second words.' }, { replace: true });
    assert.equal(v.text, 'Second words.');
    assert.equal(w.view(JOB).text, 'Second words.');
  } finally { await t.done(); }
});

test('Q3: it survives a restart (read back from the state folder); a broken or missing file is no message', async () => {
  const t = await tmp();
  try {
    const a = new WaitingMessages({ file: t.file, now: clock() });
    await a.load();
    await a.put(JOB, { slug: 'visit-audit', text: 'Kept over a restart.', confirmNoTerminal: true });
    const b = new WaitingMessages({ file: t.file });
    await b.load();
    assert.deepEqual(b.view(JOB), { text: 'Kept over a restart.', at: '2026-11-13T12:00:00.000Z', why: null });
    assert.equal(b.get(JOB).confirmNoTerminal, true);
    assert.equal((await fs.stat(t.file)).mode & 0o777, 0o600, 'his words: readable by him only');
    await fs.writeFile(t.file, '{ not json');
    const c = new WaitingMessages({ file: t.file });
    await c.load();
    assert.equal(c.view(JOB), null);
    const d = new WaitingMessages({ file: path.join(t.dir, 'none', WAITING_FILE) });
    await d.load();
    assert.equal(d.view(JOB), null);
    await d.put(JOB, { slug: 'visit-audit', text: 'A folder made for it.' });
    assert.equal(JSON.parse(await fs.readFile(path.join(t.dir, 'none', WAITING_FILE), 'utf8'))[JOB].text, 'A folder made for it.');
  } finally { await t.done(); }
});

test('Q4: cancel removes it (and says what it removed); take removes it once for sending', async () => {
  const t = await tmp();
  try {
    const w = new WaitingMessages({ file: t.file, now: clock() });
    await w.load();
    await w.put(JOB, { slug: 'visit-audit', text: 'Cancel me.' });
    assert.equal((await w.cancel(JOB)).text, 'Cancel me.');
    assert.equal(w.view(JOB), null);
    assert.equal(await w.cancel(JOB), null, 'nothing left to cancel');
    await w.put(JOB, { slug: 'visit-audit', text: 'Send me.' });
    const [one, two] = await Promise.all([w.take(JOB), w.take(JOB)]);
    assert.equal(one.text, 'Send me.');
    assert.equal(two, null, 'taken once');
    const again = new WaitingMessages({ file: t.file });
    await again.load();
    assert.equal(again.view(JOB), null, 'gone from the file too');
  } finally { await t.done(); }
});

test('Q5: a refusal at send time keeps it with why; put back after a failed start, unless a newer one waits', async () => {
  const t = await tmp();
  try {
    const w = new WaitingMessages({ file: t.file, now: clock() });
    await w.load();
    await w.put(JOB, { slug: 'visit-audit', text: 'Refused for now.' });
    await w.refuse(JOB, 'Claude’s usage limit is reached.');
    assert.equal(w.view(JOB).why, 'Claude’s usage limit is reached.');
    const b = new WaitingMessages({ file: t.file });
    await b.load();
    assert.equal(b.view(JOB).why, 'Claude’s usage limit is reached.', 'the why is kept too');
    await w.refuse(OTHER, 'No message: nothing to say.');
    assert.equal(w.view(OTHER), null);
    const taken = await w.take(JOB);
    await w.putBack(JOB, taken, 'This job is open in a terminal.');
    assert.deepEqual(w.view(JOB), { text: 'Refused for now.', at: '2026-11-13T12:00:00.000Z', why: 'This job is open in a terminal.' });
    const again = await w.take(JOB);
    await w.put(JOB, { slug: 'visit-audit', text: 'Newer words.' });
    await w.putBack(JOB, again, null);
    assert.equal(w.view(JOB).text, 'Newer words.', 'a newer message is never overwritten');
    await w.put(JOB, { slug: 'visit-audit', text: 'Newest.' }, { replace: true });
    assert.equal(w.view(JOB).why, null, 'a new message has no old why');
  } finally { await t.done(); }
});

test('Q6 (fix round 1): held after a plain stop, or moved to the box at a question; release clears both; both survive a restart', async () => {
  const t = await tmp();
  try {
    const w = new WaitingMessages({ file: t.file, now: clock() });
    await w.load();
    await w.put(JOB, { slug: 'visit-audit', text: 'Hold me.' });
    await w.refuse(JOB, 'Kept: you stopped the reply. Press Send to send it.', { held: true });
    assert.equal(w.get(JOB).held, true);
    assert.deepEqual(w.view(JOB), { text: 'Hold me.', at: '2026-11-13T12:00:00.000Z', why: 'Kept: you stopped the reply. Press Send to send it.' });
    const b = new WaitingMessages({ file: t.file });
    await b.load();
    assert.equal(b.get(JOB).held, true, 'held over a restart');
    await w.release(JOB);
    assert.equal(w.get(JOB).held, false);
    assert.equal(w.view(JOB).why, null);
    await w.refuse(JOB, 'The Foreman is asking you something first.', { toBox: true });
    assert.deepEqual(w.view(JOB), { text: 'Hold me.', at: '2026-11-13T12:00:00.000Z', why: 'The Foreman is asking you something first.', toBox: true });
    const c = new WaitingMessages({ file: t.file });
    await c.load();
    assert.equal(c.view(JOB).toBox, true);
    await w.put(JOB, { slug: 'visit-audit', text: 'New.' }, { replace: true });
    assert.equal(w.get(JOB).held, false);
    assert.equal(w.view(JOB).toBox, undefined);
  } finally { await t.done(); }
});
