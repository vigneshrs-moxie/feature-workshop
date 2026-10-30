// The state folder's moves (lib/state.js): ~/.ground-control renamed to ~/.starbase with a link left
// by the old name (packet Y, moveToStarbase), and the older one-time move of ~/.feature-workshop's
// files into it (packet I step 7, moveOldState). Every test uses a throwaway home folder; the real
// one is never read or changed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LEFT_ALONE_NOTE, MOVED_NOTE, MOVED_TO_STARBASE, defaultStateDir, moveOldState, moveToStarbase, prepareStateFolder, stateDirFor, stateDirNow } from '../lib/state.js';
import { main } from '../../bin/starbase.js';

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
  const now = path.join(home, '.starbase');
  fs.mkdirSync(now);
  fs.writeFileSync(path.join(now, 'integrate.json'), '{"slots":3}');
  fs.writeFileSync(path.join(now, 'usage.jsonl'), '{"new":true}\n');
  return { home, old, now };
}

const read = (p) => fs.readFileSync(p, 'utf8');
const notAlive = () => false;

test('~/.feature-workshop: the files move once, what is already in ~/.starbase is kept, and a note is left behind', () => {
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

test('nothing moves from ~/.feature-workshop when ~/.starbase already has settings.json, or there is no old folder', () => {
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

test('stateDirFor: STARBASE_STATE_DIR wins, then demo mode’s folder, then the folder in use', () => {
  const { home, old } = makeHome();
  assert.equal(stateDirFor({ STARBASE_STATE_DIR: '/x/state' }, home), path.resolve('/x/state'));
  assert.equal(stateDirFor({ STARBASE_DEMO: '1', STARBASE_FEATURES_DIR: '/x/features' }, home), path.join(path.resolve('/x'), 'state'));
  assert.equal(stateDirFor({}, home), old);
});

// new State() in a process of its own, with a throwaway HOME (and USERPROFILE, Windows' home).
function newStateIn(home, env = {}) {
  const code = `const { State } = await import(${JSON.stringify(STATE_JS)}); console.log(JSON.stringify({ dir: new State().dir }));`;
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, HOME: home, USERPROFILE: home, ...env };
    if (!env.STARBASE_STATE_DIR) delete childEnv.STARBASE_STATE_DIR;
    execFile(process.execPath, ['--input-type=module', '-e', code], { env: childEnv }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(JSON.parse(stdout.trim().split('\n').at(-1)));
    });
  });
}

test('new State() with STARBASE_STATE_DIR moves nothing; without it, it moves and uses ~/.starbase', async () => {
  const { home, old, now } = makeHome();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-state-'));
  assert.equal((await newStateIn(home, { STARBASE_STATE_DIR: elsewhere })).dir, elsewhere);
  assert.ok(fs.existsSync(path.join(old, 'settings.json')), 'STARBASE_STATE_DIR: the old folder is left alone');
  assert.ok(!fs.existsSync(path.join(old, MOVED_NOTE)));

  assert.equal((await newStateIn(home)).dir, now);
  assert.ok(fs.existsSync(path.join(now, 'settings.json')));
  assert.ok(fs.existsSync(path.join(old, MOVED_NOTE)));
});

// ---------- ~/.ground-control → ~/.starbase (packet Y) ----------

function gcHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-home-'));
  const gc = path.join(home, '.ground-control');
  fs.mkdirSync(path.join(gc, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(gc, 'settings.json'), '{"policy":"ask-all"}');
  fs.writeFileSync(path.join(gc, 'audit.jsonl'), '{"at":"2026-10-29T00:00:00.000Z","action":"send"}\n');
  fs.writeFileSync(path.join(gc, 'usage.jsonl'), '{"turn":1}\n');
  fs.writeFileSync(path.join(gc, 'service.json'), JSON.stringify({ pid: 999999, port: 4477, token: 't' }));
  return { home, gc, sb: path.join(home, '.starbase') };
}
const auditOf = (dir) => read(path.join(dir, 'audit.jsonl')).trim().split('\n').map((l) => JSON.parse(l));

test('~/.ground-control is renamed to ~/.starbase, a link is left by the old name, and the audit says so once', () => {
  const { home, gc, sb } = gcHome();
  assert.equal(stateDirNow(home), gc, 'before the move the state is still in ~/.ground-control');
  const r = moveToStarbase({ home, now: () => new Date('2026-10-30T09:00:00Z') });
  assert.equal(r.moved, true);
  assert.equal(r.linked, true);
  assert.equal(read(path.join(sb, 'settings.json')), '{"policy":"ask-all"}', 'everything is in ~/.starbase');
  assert.ok(fs.statSync(path.join(sb, 'logs')).isDirectory());
  assert.ok(fs.lstatSync(gc).isSymbolicLink(), '~/.ground-control is a link now');
  assert.equal(fs.realpathSync(gc), fs.realpathSync(sb));
  assert.equal(read(path.join(gc, 'usage.jsonl')), '{"turn":1}\n', 'a copy still running finds its files by the old name');
  const audit = auditOf(sb);
  assert.equal(audit[0].action, 'send', 'the old lines are kept');
  assert.equal(audit.at(-1).action, 'state-moved');
  assert.equal(audit.at(-1).message, 'Moved ~/.ground-control to ~/.starbase');
  assert.equal(stateDirNow(home), sb);
  assert.equal(stateDirFor({}, home), sb);

  const again = moveToStarbase({ home });
  assert.equal(again.skipped, 'moved-before');
  assert.equal(auditOf(sb).length, audit.length, 'once only');
});

test('a copy still running from ~/.ground-control keeps writing to its open files, and they are in ~/.starbase', () => {
  const { home, gc, sb } = gcHome();
  const fd = fs.openSync(path.join(gc, 'usage.jsonl'), 'a'); // the running copy's open log
  moveToStarbase({ home });
  fs.writeSync(fd, '{"turn":2}\n');
  fs.closeSync(fd);
  fs.appendFileSync(path.join(gc, 'audit.jsonl'), '{"action":"late"}\n'); // a file it opens again, by the old name
  assert.equal(read(path.join(sb, 'usage.jsonl')), '{"turn":1}\n{"turn":2}\n');
  assert.equal(auditOf(sb).at(-1).action, 'late');
});

test('when the link can’t be made (Windows without the rights), a MOVED-TO-STARBASE.txt is left instead and nothing fails', () => {
  const { home, gc, sb } = gcHome();
  const r = moveToStarbase({ home, link: () => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); } });
  assert.equal(r.moved, true);
  assert.equal(r.linked, false);
  assert.ok(fs.statSync(gc).isDirectory() && !fs.lstatSync(gc).isSymbolicLink());
  assert.deepEqual(fs.readdirSync(gc), [MOVED_TO_STARBASE], 'only the note');
  assert.match(read(path.join(gc, MOVED_TO_STARBASE)), /moved this folder to .*\.starbase/);
  assert.equal(auditOf(sb).at(-1).linked, false);
  assert.equal(stateDirNow(home), sb);
  assert.equal(moveToStarbase({ home }).skipped, 'moved-before', 'the note counts as moved');
});

test('both folders there: nothing is merged, ~/.starbase is used, and the terminal is told once', () => {
  const { home, gc, sb } = gcHome();
  fs.mkdirSync(sb);
  fs.writeFileSync(path.join(sb, 'settings.json'), '{"policy":"hands-off"}');
  const first = prepareStateFolder({ home });
  assert.equal(first.dir, sb);
  assert.equal(first.lines.length, 1);
  assert.match(first.lines[0], /both there, so nothing was merged: Starbase uses ~\/\.starbase and left ~\/\.ground-control alone/);
  assert.equal(read(path.join(gc, 'settings.json')), '{"policy":"ask-all"}', 'the old folder is as it was');
  assert.equal(read(path.join(sb, 'settings.json')), '{"policy":"hands-off"}');
  assert.ok(fs.existsSync(path.join(sb, LEFT_ALONE_NOTE)));
  assert.deepEqual(prepareStateFolder({ home }).lines, [], 'said once');
  assert.equal(stateDirNow(home), sb);
});

test('an empty ~/.starbase (made before the move) doesn’t stop the rename', () => {
  const { home, sb } = gcHome();
  fs.mkdirSync(sb);
  assert.equal(moveToStarbase({ home }).moved, true);
  assert.equal(read(path.join(sb, 'settings.json')), '{"policy":"ask-all"}');
});

test('only ~/.feature-workshop: its older move ends in ~/.starbase', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-home-'));
  const fw = path.join(home, '.feature-workshop');
  fs.mkdirSync(fw);
  fs.writeFileSync(path.join(fw, 'settings.json'), '{"policy":"ask-all"}');
  const r = prepareStateFolder({ home, alive: notAlive });
  assert.equal(r.dir, path.join(home, '.starbase'));
  assert.equal(read(path.join(home, '.starbase', 'settings.json')), '{"policy":"ask-all"}');
  assert.ok(fs.existsSync(path.join(fw, MOVED_NOTE)));
  assert.match(r.lines[0], /^Moved 1 item from .*\.feature-workshop to .*\.starbase/);
});

test('both old folders: ~/.ground-control is renamed first, then ~/.feature-workshop’s files are moved in beside its own', () => {
  const { home, gc, sb } = gcHome();
  const fw = path.join(home, '.feature-workshop');
  fs.mkdirSync(fw);
  fs.writeFileSync(path.join(fw, 'sessions.json'), '{"/jobs/a":{"sessionId":"s1"}}');
  fs.writeFileSync(path.join(fw, 'settings.json'), '{"policy":"old"}');
  const r = prepareStateFolder({ home, alive: notAlive });
  assert.equal(r.dir, sb);
  assert.equal(r.lines.length, 1, 'the older move waits: ~/.starbase already has settings.json');
  assert.match(r.lines[0], /^Moved ~\/\.ground-control to ~\/\.starbase, and left a link/);
  assert.equal(read(path.join(sb, 'settings.json')), '{"policy":"ask-all"}', '~/.ground-control’s settings are the ones in use');
  assert.ok(fs.lstatSync(gc).isSymbolicLink());
});

test('nothing old: nothing happens, and ~/.starbase is the folder', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-home-'));
  assert.deepEqual(prepareStateFolder({ home }), { dir: path.join(home, '.starbase'), lines: [] });
  assert.ok(!fs.existsSync(path.join(home, '.starbase')), 'nothing is made just by looking');
});

test('new State() and the starbase command move ~/.ground-control on their first start', async () => {
  const a = gcHome();
  assert.equal((await newStateIn(a.home)).dir, a.sb);
  assert.ok(fs.lstatSync(a.gc).isSymbolicLink());

  const b = gcHome();
  const out = [];
  const err = [];
  const code = await main(['stop'], { home: b.home, env: {}, platform: process.platform, running: () => null, out: (l) => out.push(l), err: (l) => err.push(l) });
  assert.equal(code, 0);
  assert.deepEqual(out, ['Starbase isn’t running.']);
  assert.match(err[0], /^Moved ~\/\.ground-control to ~\/\.starbase/);
  assert.ok(fs.existsSync(path.join(b.sb, 'settings.json')));
});
