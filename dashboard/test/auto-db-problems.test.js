// What the runner does with a migration problem on Auto's database (runner/auto-db-problems.js), on a
// fake driver: a failed migration goes to the Foreman as Starbase's own message, the way the
// status-fix send goes; one that didn't land on Auto's copy stops Auto on the job instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { autoDbProblems } from '../runner/auto-db-problems.js';
import { AUTO_NOT_LANDED_STOP } from '../runner/evidence.js';
import { Busy } from '../lib/driver.js';

const f = { dir: '/jobs/auto-job', slug: 'auto-job', title: 'Auto job', stage: 'test' };
const failed = { code: 'migration', migration: '0002_b', tail: 'error: column "x" already exists' };

function world({ active = null, session = { sessionId: 's1', slug: 'auto-job', title: 'Auto job', cwd: '/wt', model: 'opus', additionalDirectories: [] }, start = null, autoOn = true, autoStopped = false } = {}) {
  const driver = new EventEmitter();
  const started = [];
  const audits = [];
  const stops = [];
  let run = active;
  driver.activeRunFor = ({ featureDir }) => (featureDir === f.dir && run && ['starting', 'running', 'waiting_permission', 'stopping'].includes(run.status) ? run : null);
  driver.feedbackSession = async () => session;
  driver.start = async (o) => { if (start) return start(o); started.push(o); return { id: 'r2' }; };
  const end = (status) => { run = { ...run, status }; driver.emit('run', run); };
  const handle = autoDbProblems({ driver, state: { audit: async (l) => { audits.push(l); } }, autoOn: async () => autoOn, autoStopped: async () => (typeof autoStopped === 'function' ? autoStopped() : autoStopped), stopAuto: async (job, reason) => { stops.push({ job, reason }); } });
  return { handle, started, audits, stops, end, driver };
}

test('a failed migration is sent at once when no reply runs, as Starbase\'s own message with the plan\'s first and last words', async () => {
  const w = world();
  assert.deepEqual(await w.handle(f, failed), { sent: true });
  assert.equal(w.started.length, 1);
  const s = w.started[0];
  assert.equal(s.kind, 'auto-migration');
  assert.equal(s.sessionId, 's1');
  assert.ok(s.text.startsWith('Starbase couldn\'t apply 0002_b to Auto\'s copy of the database:\n'), s.text);
  assert.ok(s.text.endsWith('\nFix it, then raise the brief into Test again.'), s.text);
  assert.match(s.text, /column "x" already exists/);
  assert.deepEqual(w.audits, []);
});

test('while a reply runs it waits, and goes once that reply ends done', async () => {
  const w = world({ active: { id: 'r1', status: 'running' } });
  const p = w.handle(f, failed);
  await new Promise((r) => { setTimeout(r, 20); });
  assert.equal(w.started.length, 0, 'not while the reply runs');
  w.end('done');
  assert.deepEqual(await p, { sent: true });
  assert.equal(w.started.length, 1);
  assert.equal(w.driver.listenerCount('run'), 0);
});

test('a reply that ends stopped, with an error or at a limit: not sent, and an audit line says why', async () => {
  for (const status of ['stopped', 'error', 'limited']) {
    const w = world({ active: { id: 'r1', status: 'running' } });
    const p = w.handle(f, failed);
    await new Promise((r) => { setTimeout(r, 20); }); // it is waiting for the reply
    w.end(status);
    assert.deepEqual(await p, { sent: false }, status);
    assert.equal(w.started.length, 0);
    assert.equal(w.audits.length, 1);
    assert.equal(w.audits[0].action, 'auto_migration_not_sent');
    assert.equal(w.audits[0].migration, '0002_b');
    assert.match(w.audits[0].reason, new RegExp(status));
  }
});

test('no session to carry on, a refused session, a start that fails, or Auto off: not sent, with the line', async () => {
  const cases = [
    world({ session: null }),
    world({ session: { refused: 'This job is marked done.' } }),
    world({ start: async () => { throw new Error('locked elsewhere'); } }),
    world({ autoOn: false }),
  ];
  for (const w of cases) {
    assert.deepEqual(await w.handle(f, failed), { sent: false });
    assert.equal(w.audits.length, 1);
    assert.equal(w.audits[0].action, 'auto_migration_not_sent');
  }
  assert.match(cases[1].audits[0].reason, /marked done/);
  assert.match(cases[3].audits[0].reason, /Auto is off/);
});

test('a reply that begins at the same moment: the message waits for it', async () => {
  let tries = 0;
  const w = world({ start: async () => { tries++; if (tries === 1) { w.begin(); throw new Busy('busy'); } return { id: 'r3' }; } });
  w.begin = () => { w.driver.activeRunFor = ({ featureDir }) => (featureDir === f.dir && w.running ? { id: 'r9', status: 'running' } : null); w.running = true; };
  const p = w.handle(f, failed);
  await new Promise((r) => { setTimeout(r, 20); });
  w.running = false;
  w.driver.emit('run', { id: 'r9', status: 'done' });
  assert.deepEqual(await p, { sent: true });
  assert.equal(tries, 2);
});

test('only a failed migration is sent; one that did not land stops Auto on the job with the reason; anything else does nothing', async () => {
  const w = world();
  assert.deepEqual(await w.handle(f, { code: 'not-landed', migration: '0002_b' }), { stopped: true });
  assert.equal(w.started.length, 0, 'nothing to the Foreman');
  assert.deepEqual(w.stops, [{ job: f, reason: AUTO_NOT_LANDED_STOP }]);
  assert.equal(AUTO_NOT_LANDED_STOP, 'A migration from this job did not land on Auto\'s copy of the database. It may have run on yours. Check your database before this job goes on.');
  for (const code of ['copy', 'no-database', 'no-original', 'busy']) assert.equal(await w.handle(f, { code }), null, code);
  assert.equal(w.started.length, 0);
});

test('R8: when the stop writes nothing (Auto already stopped, or switched off), the not-landed notice still goes with the stop\'s sentence', async () => {
  const notes = [];
  const handle = autoDbProblems({ driver: new EventEmitter(), state: { audit: async () => {} }, stopAuto: async () => false, notify: (n) => notes.push(n) });
  assert.deepEqual(await handle(f, { code: 'not-landed', migration: '0002_b' }), { stopped: true });
  assert.equal(notes.length, 1);
  assert.deepEqual({ level: notes[0].level, title: notes[0].title, body: notes[0].body, slug: notes[0].slug }, { level: 'needs', title: 'Auto job', body: AUTO_NOT_LANDED_STOP, slug: 'auto-job' });
  const written = [];
  await autoDbProblems({ driver: new EventEmitter(), state: { audit: async () => {} }, stopAuto: async () => true, notify: (n) => written.push(n) })(f, { code: 'not-landed' });
  assert.deepEqual(written, [], 'a stop that was written sends its own notice');
});

// ---------- Part B fix round 1, F4: a stopped job is his, so Starbase writes nothing to its Foreman ----------

test('a migration that fails on Auto\'s database while Auto is stopped on the job sends the Foreman nothing', async () => {
  // Stopped when the problem comes: no reply is started, and one line says why.
  const w = world({ autoStopped: true });
  assert.deepEqual(await w.handle(f, failed), { sent: false });
  assert.equal(w.started.length, 0);
  assert.deepEqual(w.audits.map((l) => [l.action, l.migration, l.reason]), [['auto_migration_not_sent', '0002_b', 'Auto is stopped on this job.']]);
  // Auto stops while the message waits for a reply to end: nothing goes after that reply.
  let stopped = false;
  const late = world({ active: { id: 'r1', status: 'running' }, autoStopped: () => stopped });
  const p = late.handle(f, failed);
  await new Promise((r) => { setTimeout(r, 20); });
  stopped = true;
  late.end('done');
  assert.deepEqual(await p, { sent: false });
  assert.equal(late.started.length, 0);
  assert.deepEqual(late.audits.map((l) => l.reason), ['Auto is stopped on this job.']);
  assert.equal(late.driver.listenerCount('run'), 0);
  // Auto stops between the look for the Foreman's session and the start: asked again there, and still nothing goes.
  let asked = 0;
  const between = world({ autoStopped: () => ++asked > 1 });
  assert.deepEqual(await between.handle(f, failed), { sent: false });
  assert.equal(asked, 2);
  assert.equal(between.started.length, 0);
  assert.deepEqual(between.audits.map((l) => l.reason), ['Auto is stopped on this job.']);
  // Off and stopped: the line says off, as it did.
  const off = world({ autoOn: false, autoStopped: true });
  assert.deepEqual(await off.handle(f, failed), { sent: false });
  assert.deepEqual(off.audits.map((l) => l.reason), ['Auto is off for this job.']);
  // On and working: it goes, as before.
  const on = world({ autoStopped: false });
  assert.deepEqual(await on.handle(f, failed), { sent: true });
  assert.equal(on.started.length, 1);
  // A migration that did not land is not a message: its stop and notice are as they were while Auto is stopped.
  const landed = world({ autoStopped: true });
  assert.deepEqual(await landed.handle(f, { code: 'not-landed', migration: '0002_b' }), { stopped: true });
  assert.equal(landed.stops.length, 1);
});

test('the runner\'s two questions about a job\'s Auto are read from the job\'s saved session', async () => {
  const sessions = {
    '/jobs/on': { auto: { on: true, stopped: null } },
    '/jobs/stopped': { auto: { on: true, stopped: { rule: 'judgment', reason: 'x', at: '2026-11-12T00:00:00.000Z' } } },
    '/jobs/off': { auto: { on: false, stopped: null } },
    '/jobs/off-stopped': { auto: { on: false, stopped: { rule: 'judgment', reason: 'x' } } },
    '/jobs/none': {},
  };
  const { autoQuestions } = await import('../runner/auto-db-problems.js');
  const q = autoQuestions(async (dir) => sessions[dir] ?? null);
  const both = async (dir) => [await q.autoOn({ dir }), await q.autoStopped({ dir })];
  assert.deepEqual(await both('/jobs/on'), [true, false]);
  assert.deepEqual(await both('/jobs/stopped'), [true, true]);
  assert.deepEqual(await both('/jobs/off'), [false, false]);
  assert.deepEqual(await both('/jobs/off-stopped'), [false, true]);
  assert.deepEqual(await both('/jobs/none'), [false, false]);
  assert.deepEqual(await both('/jobs/unknown'), [false, false]);
  // Through the handler: the stopped job's Foreman gets nothing, the working job's gets the message.
  for (const [dir, sent] of [['/jobs/stopped', false], ['/jobs/on', true], ['/jobs/off', false]]) {
    const w = world();
    const handle = autoDbProblems({ driver: w.driver, state: { audit: async () => {} }, ...q });
    assert.deepEqual(await handle({ ...f, dir }, failed), { sent }, dir);
  }
});
