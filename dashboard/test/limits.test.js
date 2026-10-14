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
const settle = async (limits) => { for (let i = 0; i < 50 && limits.resuming; i++) await limits.resuming; };

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
