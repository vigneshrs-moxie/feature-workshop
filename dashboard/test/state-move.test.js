// The one-time move of the state folder from ~/.feature-workshop to ~/.ground-control (packet I
// step 7, lib/state.js moveOldState). Every test uses a throwaway home folder; the real one is never
// read or changed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MOVED_NOTE, defaultStateDir, moveOldState, stateDirFor, stateDirNow } from '../lib/state.js';

const STATE_JS = pathToFileURL(path.join(import.meta.dirname, '..', 'lib', 'state.js')).href;

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-home-'));
  const old = path.join(home, '.feature-workshop');
  fs.mkdirSync(path.join(old, 'hook-events'), { recursive: true });
  fs.writeFileSync(path.join(old, 'settings.json'), '{"policy":"ask-all"}');
  fs.writeFileSync(path.join(old, 'sessions.json'), '{"/jobs/a":{"sessionId":"s1"}}');
  fs.writeFileSync(path.join(old, 'audit.jsonl'), '{"at":"2026-10-01T00:00:00.000Z","action":"send"}\n');
  fs.writeFileSync(path.join(old, 'hook-events', 'events.jsonl'), '{"e":1}\n');
  fs.writeFileSync(path.join(old, 'usage.jsonl'), '{"old":true}\n');
  fs.writeFileSync(path.join(old, 'service.json'), JSON.stringify({ pid: 999999, port: 4477, token: 't' }));
  const now = path.join(home, '.ground-control');
  fs.mkdirSync(now);
  fs.writeFileSync(path.join(now, 'integrate.json'), '{"slots":3}');
  fs.writeFileSync(path.join(now, 'usage.jsonl'), '{"new":true}\n');
  return { home, old, now };
}

const read = (p) => fs.readFileSync(p, 'utf8');
const notAlive = () => false;

test('the files move once, what is already in ~/.ground-control is kept, and a note is left behind', () => {
  const { home, old, now } = makeHome();
  assert.equal(stateDirNow(home), old, 'before the move the state is still in the old folder');
  const r = moveOldState({ home, alive: notAlive, now: () => new Date('2026-10-28T10:00:00Z') });
  assert.deepEqual(r.moved, ['audit.jsonl', 'hook-events', 'sessions.json', 'settings.json']);
  assert.deepEqual(r.kept, ['usage.jsonl']);
  assert.equal(r.to, now);
  assert.equal(read(path.join(now, 'settings.json')), '{"policy":"ask-all"}');
  assert.equal(read(path.join(now, 'hook-events', 'events.jsonl')), '{"e":1}\n');
  assert.equal(read(path.join(now, 'integrate.json')), '{"slots":3}', 'integrate.json already there is kept');
  assert.equal(read(path.join(now, 'usage.jsonl')), '{"new":true}\n', 'usage.jsonl already there is kept');
  assert.equal(read(path.join(old, 'usage.jsonl')), '{"old":true}\n', 'the old copy stays where it was, so nothing is lost');
  assert.ok(!fs.existsSync(path.join(now, 'service.json')), 'a stopped copy’s service.json is not carried over');
  const audit = read(path.join(now, 'audit.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(audit[0].action, 'send', 'the old audit lines moved with the file');
  assert.equal(audit.at(-1).action, 'state-moved');
  assert.deepEqual(audit.at(-1).moved, r.moved);
  const note = read(path.join(old, MOVED_NOTE));
  assert.match(note, /moved its files from this folder to/);
  assert.match(note, /usage\.jsonl/);
  assert.equal(stateDirNow(home), now);

  // Once only: a second start changes nothing.
  const again = moveOldState({ home, alive: notAlive });
  assert.equal(again.skipped, 'moved-before');
  assert.equal(read(path.join(now, 'audit.jsonl')).trim().split('\n').length, audit.length);
});

test('nothing moves when ~/.ground-control already has settings.json, or there is no old folder', () => {
  const { home, old, now } = makeHome();
  fs.writeFileSync(path.join(now, 'settings.json'), '{"policy":"hands-off"}');
  assert.equal(moveOldState({ home, alive: notAlive }).skipped, 'already-set-up');
  assert.ok(fs.existsSync(path.join(old, 'sessions.json')));
  assert.ok(!fs.existsSync(path.join(old, MOVED_NOTE)));
  assert.equal(stateDirNow(home), now);

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-home-'));
  assert.equal(moveOldState({ home: empty }).skipped, 'no-old-folder');
  assert.equal(stateDirNow(empty), defaultStateDir(empty));
});

test('while a copy from before the move still runs from the old folder, the files stay and that folder is used', () => {
  const { home, old } = makeHome();
  const r = moveOldState({ home, alive: (pid) => pid === 999999 });
  assert.equal(r.skipped, 'old-copy-running');
  assert.equal(r.pid, 999999);
  assert.ok(fs.existsSync(path.join(old, 'settings.json')));
  assert.equal(stateDirNow(home), old);
});

test('stateDirFor: WORKSHOP_STATE_DIR wins, then demo mode’s folder, then the folder in use', () => {
  const { home, old } = makeHome();
  assert.equal(stateDirFor({ WORKSHOP_STATE_DIR: '/x/state' }, home), path.resolve('/x/state'));
  assert.equal(stateDirFor({ WORKSHOP_DEMO: '1', WORKSHOP_FEATURES_DIR: '/x/features' }, home), path.join(path.resolve('/x'), 'state'));
  assert.equal(stateDirFor({}, home), old);
});

// new State() in a process of its own, with a throwaway HOME (and USERPROFILE, Windows' home).
function newStateIn(home, env = {}) {
  const code = `const { State } = await import(${JSON.stringify(STATE_JS)}); console.log(JSON.stringify({ dir: new State().dir }));`;
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, HOME: home, USERPROFILE: home, ...env };
    if (!env.WORKSHOP_STATE_DIR) delete childEnv.WORKSHOP_STATE_DIR;
    execFile(process.execPath, ['--input-type=module', '-e', code], { env: childEnv }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(JSON.parse(stdout.trim().split('\n').at(-1)));
    });
  });
}

test('new State() with WORKSHOP_STATE_DIR moves nothing; without it, it moves and uses ~/.ground-control', async () => {
  const { home, old, now } = makeHome();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-state-'));
  assert.equal((await newStateIn(home, { WORKSHOP_STATE_DIR: elsewhere })).dir, elsewhere);
  assert.ok(fs.existsSync(path.join(old, 'settings.json')), 'WORKSHOP_STATE_DIR: the old folder is left alone');
  assert.ok(!fs.existsSync(path.join(old, MOVED_NOTE)));

  assert.equal((await newStateIn(home)).dir, now);
  assert.ok(fs.existsSync(path.join(now, 'settings.json')));
  assert.ok(fs.existsSync(path.join(old, MOVED_NOTE)));
});
