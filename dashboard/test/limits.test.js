import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { State } from '../lib/state.js';
import { LimitWatch, RESUME_TEXT } from '../lib/limits.js';

const tmpState = async () => new State(await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-limits-')));

// A stand-in driver: lists runs, records stops and starts.
function fakeDriver(runs) {
  return {
    runs, stopped: [], started: [],
    list() { return this.runs; },
    async stop(id, opts) { this.stopped.push({ id, ...opts }); return true; },
    async start(o) { this.started.push(o); return { id: `r${this.started.length}` }; },
  };
}
// Timers that fire straight away, and a clock tick the test fires by hand.
function clock(start) {
  const c = { t: start, ticks: [] };
  return Object.assign(c, {
    now: () => c.t,
    setTimer: (fn) => { setImmediate(fn); return {}; },
    clearTimer: () => {},
    setTick: (fn) => { const t = { fn }; c.ticks.push(t); return t; },
    clearTick: (t) => { c.ticks = c.ticks.filter((x) => x !== t); },
    fire: () => c.ticks.forEach((t) => t.fn()),
  });
}
const run = (slug, status = 'running') => ({ id: `run-${slug}`, featureDir: `/f/${slug}`, slug, title: slug.toUpperCase(), cwd: '/r', sessionId: `s-${slug}`, model: 'm', status, additionalDirectories: [] });
// Wait for the carry-on to begin (resume saves to disk before it starts draining) and to finish.
const settle = async (limits) => {
  for (let i = 0; i < 200; i++) {
    if (limits.resuming) { await limits.resuming; if (!limits.queue.length) return; }
    else if (!limits.limit && !limits.queue.length && i > 20) return;
    await new Promise((r) => setTimeout(r, 5));
  }
};

test('usage limit: pauses every running job and carries them on after the reset', async () => {
  const c = clock(Date.parse('2026-10-14T12:00:00Z'));
  const driver = fakeDriver([run('a'), run('b', 'waiting_permission'), run('c', 'done')]);
  const state = await tmpState();
  const limits = new LimitWatch({ driver, state, ...c });
  await limits.load();

  await limits.onLimit({ run: driver.runs[0], info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: c.t / 1000 + 3600 } });
  const v = limits.view();
  assert.equal(v.limited, true);
  assert.equal(v.label, '5-hour limit');
  assert.equal(v.resetKnown, true);
  assert.deepEqual(v.jobs.map((j) => j.slug), ['a', 'b'], 'finished jobs are left alone');
  assert.deepEqual(driver.stopped.map((s) => s.reason), ['usage-limit', 'usage-limit']);
  assert.equal(limits.isLimited(), true);

  const reloaded = new LimitWatch({ driver, state: new State(state.dir), ...clock(c.t) });
  await reloaded.load();
  assert.equal(reloaded.view().jobs.length, 2, 'survives a dashboard restart');

  c.fire();
  assert.equal(driver.started.length, 0, 'nothing happens before the reset');
  c.t += 3600_000 + 91_000;
  c.fire();
  await settle(limits);
  assert.deepEqual(driver.started.map((s) => s.slug), ['a', 'b']);
  assert.equal(driver.started[0].text, RESUME_TEXT);
  assert.equal(driver.started[0].sessionId, 's-a', 'resumes the same Foreman session');
  assert.equal(limits.view().limited, false);
  assert.deepEqual((await new State(state.dir).getSettings()).usageResumeQueue, [], 'the queue empties as jobs start');
});

test('usage limit: skips jobs picked up elsewhere; unknown reset retries later; auto carry-on off; warnings', async () => {
  const c = clock(1_000_000_000_000);
  const driver = fakeDriver([run('a'), run('b')]);
  const limits = new LimitWatch({ driver, state: await tmpState(), canResume: async (job) => job.slug !== 'b', ...c });
  await limits.load();

  limits.onStatus({ status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.9, resetsAt: c.t / 1000 + 100 });
  assert.deepEqual(limits.view().warning, { label: 'weekly limit', percent: 90, resetsAt: new Date(c.t + 100_000).toISOString() });
  limits.onStatus({ status: 'allowed', rateLimitType: 'seven_day' });
  assert.equal(limits.view().warning, null);

  await limits.onLimit({ run: driver.runs[0], info: null });
  assert.equal(limits.view().resetKnown, false);
  await limits.setAutoResume(false);
  assert.equal(c.ticks.length, 0, 'nothing scheduled while automatic carry-on is off');
  c.t += 31 * 60_000;
  assert.equal(limits.isLimited(), false, 'with carry-on off, sends go through again once the limit has passed');
  assert.equal(limits.view().limited, true, 'the paused jobs still wait for Carry on now');

  const r = await limits.resume('you');
  await settle(limits);
  assert.deepEqual(r.resumed, ['a'], 'a job picked up in a terminal since the pause is skipped');
  await limits.forget('/f/a');
  assert.equal(limits.view().jobs.length, 0);
});

// A held reply for a job with no Foreman session yet (a gate reply "start after reset").
const heldJob = (slug) => ({ featureDir: `/f/${slug}`, slug, title: slug.toUpperCase(), cwd: '/r', sessionId: null, model: 'm', additionalDirectories: [] });
const HELD = { text: '/feature h Private folder: /f/h\n\nI approve.', kind: 'approve', gateBrief: 2 };
const limitInfo = (c) => ({ status: 'rejected', rateLimitType: 'five_hour', resetsAt: c.t / 1000 + 3600 });

test('usage limit hits again while carrying on: a held reply (even with no session) waits with it, then goes as composed', async () => {
  const c = clock(Date.parse('2026-10-16T12:00:00Z'));
  const driver = fakeDriver([run('a')]);
  const state = await tmpState();
  const limits = new LimitWatch({ driver, state, ...c });
  await limits.load();
  await limits.onLimit({ run: driver.runs[0], info: limitInfo(c) });
  await limits.hold(heldJob('h'), HELD);
  assert.deepEqual(limits.view().jobs.map((j) => [j.slug, Boolean(j.held)]), [['a', false], ['h', true]]);

  // The first job carried on hits the limit again at once, while h still waits in the queue.
  const start = driver.start.bind(driver);
  driver.start = async (o) => {
    const r = await start(o);
    if (driver.started.length === 1) await limits.onLimit({ run: { ...o, id: r.id, status: 'running' }, info: limitInfo(c) });
    return r;
  };
  await limits.resume('you');
  await settle(limits);
  assert.deepEqual(driver.started.map((s) => s.slug), ['a'], 'h waits for the new limit');
  assert.deepEqual(limits.heldFor('/f/h'), { kind: 'approve', gateBrief: 2, at: new Date(c.t).toISOString() }, 'the held reply is kept');
  const h = limits.pausedJob('/f/h');
  assert.equal(h.sessionId, null);
  assert.equal(h.send.text, HELD.text);
  assert.deepEqual((await new State(state.dir).getSettings()).usageLimit.jobs.find((j) => j.slug === 'h').send.text, HELD.text, 'saved with it');
  assert.ok(!(await state.auditAll()).some((e) => e.action === 'usage-limit-skip'), 'nothing reported as skipped');

  await limits.resume('you');
  await settle(limits);
  const sent = driver.started.find((s) => s.slug === 'h');
  assert.equal(sent.text, HELD.text, 'the held reply, not the carry-on message');
  assert.equal(sent.kind, 'approve');
  assert.equal(sent.gateBrief, 2);
  assert.equal(sent.sessionId, null);
  assert.equal(driver.started.filter((s) => s.slug === 'a').length, 2);
  assert.equal(driver.started.find((s) => s.slug === 'a' && s !== driver.started[0]).text, RESUME_TEXT);
});

test('a message you send yourself drops the held reply: audited, and a carry-on mid-retry never sends it after yours', async () => {
  const c = clock(Date.parse('2026-10-16T12:00:00Z'));
  const driver = fakeDriver([]);
  const state = await tmpState();
  const limits = new LimitWatch({ driver, state, ...c });
  await limits.load();
  await limits.onLimit({ run: null, info: limitInfo(c) });

  // Forgotten while paused: dropped and audited with its brief.
  await limits.hold(heldJob('h'), HELD);
  await limits.forget('/f/h');
  assert.equal(limits.heldFor('/f/h'), null);
  let audit = await state.auditAll();
  const dropped = audit.filter((e) => e.action === 'send-held-dropped');
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].slug, 'h');
  assert.equal(dropped[0].gateBrief, 2);
  assert.equal(dropped[0].kind, 'approve');
  await limits.forget('/f/h');
  assert.equal((await state.auditAll()).filter((e) => e.action === 'send-held-dropped').length, 1, 'nothing to drop twice');

  // Held again; the carry-on finds the job busy (its last reply finishing), and while it waits to
  // try again you send a message yourself: the held reply must not follow yours.
  await limits.hold(heldJob('h'), HELD);
  let tries = 0;
  driver.start = async (o) => {
    tries += 1;
    await limits.forget(o.featureDir); // your message, sent meanwhile
    const err = new Error('busy');
    err.name = 'Busy';
    throw err;
  };
  const r = await limits.resume('you');
  await settle(limits);
  assert.deepEqual(r.resumed, []);
  assert.equal(tries, 1, 'no second try after your message');
  audit = await state.auditAll();
  assert.equal(audit.filter((e) => e.action === 'send-held-dropped').length, 2);
  const skip = audit.find((e) => e.action === 'usage-limit-skip');
  assert.equal(skip.reason, 'You sent a message yourself.');
  assert.equal(skip.held, undefined, 'the drop is noted once (send-held-dropped), not twice');
  assert.deepEqual(limits.queue, []);
});
