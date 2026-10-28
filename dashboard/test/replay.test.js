// The restart replay (runner/replay.js, packet G step 5): from fixture audit lines, a reply paused
// by a clean stop resumes, one cut off by a crash does not (and shows paused with its note), a
// closed job is left alone, and a lock a live process holds is respected.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { State } from '../lib/state.js';
import { buildThread } from '../lib/thread.js';
import { CRASH_NOTE, RESTART_NOTE, RESTART_TEXT, RESUME_KIND, replay, replayJob, withRestartNotes } from '../runner/replay.js';

function setup({ audit, sessions = () => ({}), jobs = ['alpha'] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-replay-'));
  const featuresDir = path.join(root, 'feature-work');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const dirs = Object.fromEntries(jobs.map((slug) => { const d = path.join(featuresDir, slug); fs.mkdirSync(d, { recursive: true }); return [slug, d]; }));
  const lines = audit(dirs).map((e) => JSON.stringify(e)).join('\n');
  fs.writeFileSync(path.join(stateDir, 'audit.jsonl'), `${lines}\n`);
  fs.writeFileSync(path.join(stateDir, 'sessions.json'), JSON.stringify(sessions(dirs)));
  return { root, featuresDir, stateDir, dirs, state: new State(stateDir) };
}

const t = (n) => new Date(Date.UTC(2026, 9, 28, 9, 0, n)).toISOString();
const send = (dir, slug, runId, at, extra = {}) => ({ at, action: 'send', featureDir: dir, slug, sessionId: 'sess-1', kind: 'message', text: 'Go on', runId, model: 'claude-opus-5-5', ...extra });
const ended = (dir, slug, runId, at, status = 'stopped') => ({ at, action: 'run-ended', featureDir: dir, slug, sessionId: 'sess-1', runId, status });
const linesOf = (stateDir) => fs.readFileSync(path.join(stateDir, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('a reply paused by a clean stop is resumed, with the same session', async () => {
  const s = setup({
    audit: ({ alpha }) => [
      { at: t(0), action: 'service-start', pid: 1 },
      send(alpha, 'alpha', 'run-1', t(1)),
      { at: t(5), action: 'service-stop', pid: 1, paused: [{ runId: 'run-1', slug: 'alpha', featureDir: alpha, sessionId: 'sess-1', model: 'claude-opus-5-5', cwd: '/repo', kind: 'message' }] },
      ended(alpha, 'alpha', 'run-1', t(6)), // the Stop ended it: still a clean pause
    ],
    sessions: ({ alpha }) => ({ [alpha]: { sessionId: 'sess-1', cwd: '/repo', model: 'claude-opus-5-5' } }),
  });
  const jobs = await replay({ state: s.state, featuresDir: s.featuresDir, pid: 2, isHeld: () => false });
  const j = jobs.get(s.dirs.alpha);
  assert.equal(j.cutOff, 'clean');
  assert.equal(j.sessionId, 'sess-1');
  assert.equal(j.cwd, '/repo');
  const lines = linesOf(s.stateDir);
  const start = lines.at(-1);
  assert.equal(start.action, 'service-start');
  assert.deepEqual(start.resumes, ['alpha']);
  assert.deepEqual(start.paused, []);
  assert.equal(lines.filter((e) => e.action === 'service-cut-off').length, 0);
  assert.equal(RESTART_TEXT, 'Ground Control restarted. Carry on from where you were.');
});

test('a reply cut off by a crash is not resumed: it shows paused, with the crash note, once', async () => {
  const s = setup({
    audit: ({ alpha }) => [
      { at: t(0), action: 'service-start', pid: 1 },
      send(alpha, 'alpha', 'run-1', t(1)),
      // no run-ended, no service-stop: the process died
    ],
    sessions: ({ alpha }) => ({ [alpha]: { sessionId: 'sess-1', cwd: '/repo' } }),
  });
  const jobs = await replay({ state: s.state, featuresDir: s.featuresDir, pid: 2, isHeld: () => false });
  assert.equal(jobs.get(s.dirs.alpha).cutOff, 'crash');
  let lines = linesOf(s.stateDir);
  const cut = lines.filter((e) => e.action === 'service-cut-off');
  assert.equal(cut.length, 1);
  assert.equal(cut[0].runId, 'run-1');
  assert.deepEqual(lines.find((e) => e.action === 'service-start' && e.pid === 2).paused, ['alpha']);

  // The thread shows the note; a clean stop and a second start carry the pause over without a second line.
  const thread = withRestartNotes(buildThread({ audit: lines.filter((e) => e.featureDir === s.dirs.alpha) }), lines.filter((e) => e.featureDir === s.dirs.alpha));
  assert.equal(thread.at(-1).kind, 'note');
  assert.equal(thread.at(-1).text, CRASH_NOTE);
  fs.appendFileSync(path.join(s.stateDir, 'audit.jsonl'), `${JSON.stringify({ at: new Date(Date.now() + 1000).toISOString(), action: 'service-stop', pid: 2, paused: [] })}\n`);
  const again = await replay({ state: new State(s.stateDir), featuresDir: s.featuresDir, pid: 3, isHeld: () => false });
  assert.equal(again.get(s.dirs.alpha).cutOff, 'crash');
  lines = linesOf(s.stateDir);
  assert.equal(lines.filter((e) => e.action === 'service-cut-off').length, 1);
});

test('a reply that ended, or one from before any service-start, is not cut off', () => {
  const dir = '/f/alpha';
  assert.equal(replayJob([send(dir, 'alpha', 'r', t(1)), ended(dir, 'alpha', 'r', t(2), 'done')], [{ action: 'service-start', at: t(0) }]).cutOff, null);
  assert.equal(replayJob([send(dir, 'alpha', 'r', t(1))], []).cutOff, null);
  // A crash pause ends with the next message.
  const audit = [send(dir, 'alpha', 'r', t(1)), { at: t(3), action: 'service-cut-off', featureDir: dir, runId: 'r' }, send(dir, 'alpha', 'r2', t(4)), ended(dir, 'alpha', 'r2', t(5), 'done')];
  assert.equal(replayJob(audit, [{ action: 'service-start', at: t(0) }, { action: 'service-start', at: t(3) }]).cutOff, null);
});

test('a closed job is left alone', async () => {
  const s = setup({
    jobs: ['alpha', 'beta'],
    audit: ({ alpha, beta }) => [
      { at: t(0), action: 'service-start', pid: 1 },
      send(alpha, 'alpha', 'run-a', t(1)),
      send(beta, 'beta', 'run-b', t(2)),
      { at: t(5), action: 'service-stop', pid: 1, paused: [{ runId: 'run-a', featureDir: alpha, slug: 'alpha', sessionId: 'sess-1' }, { runId: 'run-b', featureDir: beta, slug: 'beta', sessionId: 'sess-2' }] },
    ],
    sessions: ({ alpha, beta }) => ({ [alpha]: { sessionId: 'sess-1', closed: { as: 'done', at: t(6) } }, [beta]: { sessionId: 'sess-2' } }),
  });
  const jobs = await replay({ state: s.state, featuresDir: s.featuresDir, pid: 2, isHeld: () => false });
  assert.equal(jobs.has(s.dirs.alpha), false);
  assert.equal(jobs.get(s.dirs.beta).cutOff, 'clean');
  assert.deepEqual(linesOf(s.stateDir).at(-1).resumes, ['beta']);
});

test('a lock held by a live process is respected: its reply is that process’s, not cut off', async () => {
  const s = setup({
    audit: ({ alpha }) => [
      { at: t(0), action: 'service-start', pid: 1 },
      send(alpha, 'alpha', 'run-1', t(1)),
    ],
  });
  // A real lock file, held by this test's own process (alive), seen from another pid.
  fs.writeFileSync(path.join(s.dirs.alpha, 'lock.json'), JSON.stringify({ owner: 'terminal', pid: process.pid, branch: null, acquiredAt: new Date().toISOString() }));
  const { heldElsewhere } = await import('../lib/lock.js');
  const jobs = await replay({ state: s.state, featuresDir: s.featuresDir, pid: 2, isHeld: (dir) => Boolean(heldElsewhere(dir, { pid: 2 })) });
  assert.equal(jobs.get(s.dirs.alpha).cutOff, null);
  assert.equal(linesOf(s.stateDir).filter((e) => e.action === 'service-cut-off').length, 0);
  // A clean stop's reply stays paused while the lock is held: the runner carries it on once it is free.
  const stop = { action: 'service-stop', at: t(5), paused: [{ runId: 'run-1', featureDir: s.dirs.alpha, sessionId: 'sess-1' }] };
  assert.equal(replayJob([send(s.dirs.alpha, 'alpha', 'run-1', t(1))], [{ action: 'service-start', at: t(0) }, stop], { held: true }).cutOff, 'clean');
});

test('the status-check count and the gate are rebuilt from the audit', () => {
  const dir = '/f/alpha';
  const audit = [
    { at: t(1), action: 'status_invalid', featureDir: dir, attempt: 1, errors: ['a'], sent: true },
    { at: t(2), action: 'status_valid', featureDir: dir, after: 1 },
    { at: t(3), action: 'status_invalid', featureDir: dir, attempt: 1, errors: ['b'], sent: true },
    { at: t(4), action: 'status_invalid', featureDir: dir, attempt: 2, errors: ['c'], sent: true },
    send(dir, 'alpha', 'r', t(5), { kind: 'approve', gateBrief: 3 }),
    ended(dir, 'alpha', 'r', t(6), 'done'),
  ];
  const j = replayJob(audit, []);
  assert.equal(j.statusTries, 2);
  assert.deepEqual(j.statusErrors, ['c']);
  assert.deepEqual(j.gate.answered, [3]);
});

test('the carry-on message the runner sent by itself shows as a note, a resume you asked for as yours', () => {
  const dir = '/f/alpha';
  const audit = [
    send(dir, 'alpha', 'r1', t(1), { kind: RESUME_KIND, text: RESTART_TEXT }),
    { at: t(1), action: 'resumed', featureDir: dir, runId: 'r1', via: 'auto' },
    send(dir, 'alpha', 'r2', t(3), { kind: RESUME_KIND, text: RESTART_TEXT }),
    { at: t(3), action: 'resumed', featureDir: dir, runId: 'r2', via: 'cli' },
  ];
  const thread = withRestartNotes(buildThread({ audit }), audit);
  assert.equal(thread[0].kind, 'note');
  assert.equal(thread[0].text, RESTART_NOTE);
  assert.match(thread[0].id, /^note:/);
  assert.equal(thread[1].kind, 'you');
});
