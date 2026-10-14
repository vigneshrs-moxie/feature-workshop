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
// Timers that only fire when the test says so.
function manualTimers() {
  const due = [];
  return {
    due,
    setTimer: (fn, ms) => { const t = { fn, ms }; due.push(t); return t; },
    clearTimer: (t) => { const i = due.indexOf(t); if (i >= 0) due.splice(i, 1); },
  };
}
const run = (slug, status = 'running') => ({ id: `run-${slug}`, featureDir: `/f/${slug}`, slug, title: slug.toUpperCase(), cwd: '/r', sessionId: `s-${slug}`, model: 'm', status });

test('usage limit: pauses every running job and carries them on after the reset', async () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const driver = fakeDriver([run('a'), run('b', 'waiting_permission'), run('c', 'done')]);
  const timers = manualTimers();
  const state = await tmpState();
  const limits = new LimitWatch({ driver, state, now: () => now, ...timers });
  await limits.load();

  await limits.onLimit({ run: driver.runs[0], info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: now / 1000 + 3600 } });
  const v = limits.view();
  assert.equal(v.limited, true);
  assert.equal(v.label, '5-hour limit');
  assert.equal(v.resetKnown, true);
  assert.deepEqual(v.jobs.map((j) => j.slug), ['a', 'b'], 'finished jobs are left alone');
  assert.deepEqual(driver.stopped.map((s) => s.reason), ['usage-limit', 'usage-limit']);
  assert.equal(timers.due.length, 1);
  assert.ok(timers.due[0].ms >= 3600_000, 'waits until after the reset');

  const reloaded = new LimitWatch({ driver, state: new State(state.dir), now: () => now, ...manualTimers() });
  await reloaded.load();
  assert.equal(reloaded.view().jobs.length, 2, 'survives a dashboard restart');

  const resuming = limits.resume('auto');
  // Let the stagger timers run as they're set.
  for (let i = 0; i < 5 && driver.started.length < 2; i++) { await new Promise((r) => setImmediate(r)); timers.due.splice(0).forEach((t) => t.fn()); }
  await resuming;
  assert.deepEqual(driver.started.map((s) => s.slug), ['a', 'b']);
  assert.equal(driver.started[0].text, RESUME_TEXT);
  assert.equal(driver.started[0].sessionId, 's-a', 'resumes the same Foreman session');
  assert.equal(limits.view().limited, false);
});

test('usage limit: unknown reset retries later; auto carry-on can be turned off; warnings show and clear', async () => {
  const now = 1_000_000_000_000;
  const driver = fakeDriver([run('a')]);
  const timers = manualTimers();
  const limits = new LimitWatch({ driver, state: await tmpState(), now: () => now, ...timers });
  await limits.load();

  limits.onStatus({ status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.9, resetsAt: now / 1000 + 100 });
  assert.deepEqual(limits.view().warning, { label: 'weekly limit', percent: 90, resetsAt: new Date(now + 100_000).toISOString() });
  limits.onStatus({ status: 'allowed', rateLimitType: 'seven_day' });
  assert.equal(limits.view().warning, null);

  await limits.onLimit({ run: driver.runs[0], info: null });
  assert.equal(limits.view().resetKnown, false);
  assert.equal(timers.due[0].ms, 30 * 60_000);
  await limits.setAutoResume(false);
  assert.equal(timers.due.length, 0, 'nothing scheduled while automatic carry-on is off');
  await limits.forget('/f/a');
  assert.equal(limits.view().jobs.length, 0, 'a job you picked up yourself no longer waits');
});
