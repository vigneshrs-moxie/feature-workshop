// The sandbox that keeps Auto's app and migrate scripts away from his Postgres server (lib/db-door.js
// sandboxProfile, sandboxed, sandboxWorks). The tests that start sandbox-exec run on macOS only. No Postgres anywhere: "his server" and "the
// door" are plain listeners made here, the socket is a plain socket named like Postgres's in a
// temporary folder, and the one outside address is 192.0.2.1 (reserved for documentation, routed
// nowhere; the sandbox refuses it before anything is sent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { sandboxProfile, sandboxed, sandboxWorks } from '../lib/db-door.js';

// The sandbox is macOS's: where there is none these tests are skipped (off macOS Auto makes no recording at all).
const NEEDS_SANDBOX = process.platform !== 'darwin' && 'needs the macOS sandbox';

// What a child runs: it tries each target (JSON in its first argument) and prints what happened to each.
const PROBE = `
const net = require('net');
const one = (t) => new Promise((res) => {
  const c = net.connect(t);
  const end = (r) => { clearTimeout(timer); c.destroy(); res(r); };
  const timer = setTimeout(() => end('no answer'), 4000);
  c.on('connect', () => end('connected'));
  c.on('error', (e) => end(e.code || (e.errors && e.errors[0] && e.errors[0].code) || String(e)));
});
Promise.all(JSON.parse(process.argv[1]).map(one)).then((r) => { console.log(JSON.stringify(r)); });
`;
// The same from a child of the child: what the sandboxed program starts is fenced too.
const VIA_CHILD = "const r = require('child_process').spawnSync(process.execPath, ['-e', process.argv[1], process.argv[2]], { encoding: 'utf8' }); process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');";

function run(file, args, { timeoutMs = 20_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${err.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
/** What each target answered, tried by a child (or, deep, by a child of that child), under the profile or under none. */
async function tried(targets, { profile = null, deep = false } = {}) {
  const args = deep ? ['-e', VIA_CHILD, PROBE, JSON.stringify(targets)] : ['-e', PROBE, JSON.stringify(targets)];
  const cmd = profile ? sandboxed(process.execPath, args, profile) : { file: process.execPath, args };
  const r = await run(cmd.file, cmd.args);
  assert.equal(r.code, 0, `the child ran: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

/** Plain listeners: his server's port (on 127.0.0.1, and ::1 where it can), the door, a socket named like Postgres's, another socket. */
async function listeners() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  const all = [];
  const listen = (where) => new Promise((resolve, reject) => {
    const hits = { n: 0 };
    const s = net.createServer((c) => { hits.n++; c.on('error', () => {}); c.end(); });
    s.once('error', reject);
    s.listen(where, () => { all.push(s); resolve({ port: s.address()?.port ?? null, hits }); });
  });
  const his = await listen({ host: '127.0.0.1', port: 0 });
  const his6 = await listen({ host: '::1', port: his.port }).catch(() => null);
  const door = await listen({ host: '127.0.0.1', port: 0 });
  const pgSocket = path.join(dir, `.s.PGSQL.${his.port}`);
  const otherSocket = path.join(dir, 'other.sock');
  const pg = await listen({ path: pgSocket });
  const other = await listen({ path: otherSocket });
  const done = async () => {
    await Promise.all(all.map((s) => new Promise((r) => { s.close(() => r()); })));
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { his, his6, door, pg, other, pgSocket, otherSocket, done };
}

test("a sandboxed child and its grandchild can't reach his port by 127.0.0.1, localhost or ::1, nor a .s.PGSQL. socket, and can reach the door", { skip: NEEDS_SANDBOX, timeout: 90_000 }, async () => {
  const l = await listeners();
  try {
    const targets = [
      { host: '127.0.0.1', port: l.his.port }, { host: 'localhost', port: l.his.port }, { host: '::1', port: l.his.port },
      { path: l.pgSocket }, { host: '127.0.0.1', port: l.door.port }, { path: l.otherSocket },
    ];
    // With no sandbox every one of them is there to be reached: what follows is the sandbox's doing.
    const open = await tried(targets);
    assert.deepEqual(open, ['connected', 'connected', l.his6 ? 'connected' : open[2], 'connected', 'connected', 'connected'], 'with no sandbox');
    const before = { his: l.his.hits.n, his6: l.his6?.hits.n ?? 0, pg: l.pg.hits.n, door: l.door.hits.n };
    const profile = sandboxProfile({ port: l.his.port });
    const fenced = ['EPERM', 'EPERM', 'EPERM', 'EPERM', 'connected', 'connected'];
    assert.deepEqual(await tried(targets, { profile }), fenced, 'the child');
    assert.deepEqual(await tried(targets, { profile, deep: true }), fenced, 'what the child starts');
    assert.deepEqual({ his: l.his.hits.n, his6: l.his6?.hits.n ?? 0, pg: l.pg.hits.n }, { his: before.his, his6: before.his6, pg: before.pg }, 'nothing reached his port or the socket');
    assert.equal(l.door.hits.n, before.door + 2, 'both reached the door');
  } finally { await l.done(); }
});

test("a migrate script's sandbox also refuses an address outside the laptop", { skip: NEEDS_SANDBOX, timeout: 90_000 }, async () => {
  const l = await listeners();
  try {
    const targets = [{ host: '192.0.2.1', port: 443 }, { host: '127.0.0.1', port: l.his.port }, { host: 'localhost', port: l.his.port }, { path: l.pgSocket }, { host: '127.0.0.1', port: l.door.port }, { path: l.otherSocket }];
    const profile = sandboxProfile({ port: l.his.port, migrate: true });
    const fenced = ['EPERM', 'EPERM', 'EPERM', 'EPERM', 'connected', 'connected'];
    assert.deepEqual(await tried(targets, { profile }), fenced, 'the script');
    assert.deepEqual(await tried(targets, { profile, deep: true }), fenced, 'what the script starts');
    assert.equal(l.his.hits.n + l.pg.hits.n + (l.his6?.hits.n ?? 0), 0, 'nothing reached his port or the socket');
    assert.equal(l.door.hits.n, 2, 'both reached the door');
  } finally { await l.done(); }
});

test('sandboxWorks is false off macOS, without sandbox-exec, and when the self-test fails', { skip: NEEDS_SANDBOX, timeout: 90_000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-works-'));
  const script = (name, body) => { const file = path.join(dir, name); fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return file; };
  const runs = path.join(dir, 'runs');
  const said = path.join(dir, 'arguments');
  const count = () => (fs.existsSync(runs) ? fs.readFileSync(runs, 'utf8').length : 0);
  // Stand-ins for sandbox-exec. "-p <profile>" are its first two arguments; the rest is the program.
  const NOT_FENCING = `printf x >> "${runs}"\nprintf '%s\\n' "$*" > "${said}"\nshift 2\nexec "$@"`;
  const REAL = `printf x >> "${runs}"\nexec /usr/bin/sandbox-exec "$@"`;
  try {
    assert.equal(await sandboxWorks(), true, 'on this Mac, with the real sandbox-exec');
    assert.equal(await sandboxWorks({ platform: 'linux' }), false, 'off macOS');
    assert.equal(await sandboxWorks({ platform: 'win32' }), false, 'off macOS');
    assert.equal(await sandboxWorks({ sandboxExec: path.join(dir, 'not-there') }), false, 'no sandbox-exec');
    assert.equal(await sandboxWorks({ execPath: path.join(dir, 'no-node') }), false, 'the child never ran');
    assert.equal(await sandboxWorks({ sandboxExec: script('silent', 'exit 0') }), false, 'no answer');
    assert.equal(await sandboxWorks({ sandboxExec: script('wrong', 'echo \'{"a":"EPERM","socket":"EPERM"}\'') }), false, 'half an answer');
    const started = Date.now();
    assert.equal(await sandboxWorks({ sandboxExec: script('hangs', 'exec sleep 30'), timeoutMs: 400 }), false, 'no answer in time');
    assert.ok(Date.now() - started < 10_000, 'it did not wait for the child');

    // A sandbox-exec that starts the program without fencing it: the child reaches what it must not.
    const fake = script('fake', NOT_FENCING);
    const [a, b] = await Promise.all([sandboxWorks({ sandboxExec: fake }), sandboxWorks({ sandboxExec: fake })]);
    assert.deepEqual([a, b], [false, false], 'not fenced');
    assert.equal(count(), 1, 'two asks at once are one self-test');
    // The self-test's own socket is named like Postgres's, in a short folder, and it cleans up what it made.
    const socket = /"(\/[^"]*\/\.s\.PGSQL\.\d+)"/.exec(fs.readFileSync(said, 'utf8'))?.[1];
    assert.ok(socket && socket.startsWith(`${os.tmpdir()}${path.sep}`), `a socket under the temp folder: ${socket}`);
    assert.ok(Buffer.byteLength(socket) < 104, 'short enough for a unix socket');
    assert.equal(fs.existsSync(path.dirname(socket)), false, 'its folder is gone');
    // A false answer is asked again at most once a minute.
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    script('fake', REAL);
    assert.equal(await sandboxWorks({ sandboxExec: fake }), false, 'within the minute: the last answer');
    assert.equal(count(), 1, 'and no new self-test');
    t.mock.timers.tick(61_000);
    assert.equal(await sandboxWorks({ sandboxExec: fake }), true, 'after a minute it is tried again');
    assert.equal(count(), 2);
    // A true answer is kept for the life of the process.
    script('fake', NOT_FENCING);
    t.mock.timers.tick(3_600_000);
    assert.equal(await sandboxWorks({ sandboxExec: fake }), true);
    assert.equal(count(), 2, 'never tested again');
    t.mock.timers.reset();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the profile takes only a whole port number', () => {
  const app = [
    '(version 1)',
    '(allow default)',
    '(deny network-outbound (remote unix-socket (regex #"\\.s\\.PGSQL\\.")))',
    '(deny file-write* (regex #"\\.s\\.PGSQL\\."))',
    '(deny file-link (regex #"\\.s\\.PGSQL\\."))',
    '(deny network-outbound (remote tcp "*:5432"))',
    '(deny network-outbound (remote tcp "*:5433"))',
  ];
  assert.equal(sandboxProfile({ port: 5433 }), app.join('\n'));
  assert.equal(sandboxProfile({ port: 5433, migrate: false }), app.join('\n'));
  assert.equal(sandboxProfile({ port: 5433, migrate: true }), [
    ...app.slice(0, 2),
    '(deny network-outbound (remote ip "*:*"))',
    '(allow network-outbound (remote ip "localhost:*"))',
    ...app.slice(2),
  ].join('\n'));
  assert.ok(sandboxProfile({ port: 1 }).endsWith('"*:1"))'));
  assert.ok(sandboxProfile({ port: 65535 }).endsWith('"*:65535"))'));
  for (const port of [0, -1, 65536, 1.5, NaN, Infinity, '5432', '5433"))\n(allow default)', ' 5433', null, undefined, true, {}, [5433], 5433n]) {
    assert.throws(() => sandboxProfile({ port }), TypeError, `port ${String(port)}`);
    assert.throws(() => sandboxProfile({ port, migrate: true }), TypeError, `port ${String(port)}, migrate`);
  }
  assert.throws(() => sandboxProfile(), TypeError);
  assert.deepEqual(sandboxed('npm', ['run', 'db:migrate', '--', '0002_b'], 'the profile'), { file: '/usr/bin/sandbox-exec', args: ['-p', 'the profile', 'npm', 'run', 'db:migrate', '--', '0002_b'] });
});

// ---------- Task 9 fix round 5: the socket file can't be moved out of the fence's sight ----------
// Seatbelt judges the path a connect() resolves to, so a socket renamed to a name without .s.PGSQL.
// would connect. Stand-in sockets only, in a folder the test makes: no real Postgres socket is touched.

// What a child runs: it tries each step (its second argument, a JSON list) on the socket (its first),
// then a connect to every name the socket may now have, and prints what happened.
const MOVE = `
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');
const socket = process.argv[1];
const at = (name) => path.join(path.dirname(socket), name);
const op = (fn) => { try { fn(); return 'done'; } catch (e) { return e.code; } };
const sh = (program, to) => (spawnSync('/bin/sh', ['-c', program + ' "$0" "$1"', socket, to]).status === 0 ? 'done' : 'refused');
const steps = {
  rename: () => op(() => fs.renameSync(socket, at('renamed'))),
  mv: () => sh('/bin/mv', at('moved')),
  link: () => op(() => fs.linkSync(socket, at('linked'))),
  ln: () => sh('/bin/ln', at('ln')),
  unlink: () => op(() => fs.unlinkSync(socket)),
};
const one = (p) => new Promise((res) => {
  const c = net.connect({ path: p });
  const end = (r) => { clearTimeout(timer); c.destroy(); res(r); };
  const timer = setTimeout(() => end('no answer'), 4000);
  c.on('connect', () => end('connected'));
  c.on('error', (e) => end(e.code));
});
(async () => {
  const out = { before: await one(socket) };
  for (const step of JSON.parse(process.argv[2])) {
    out[step] = steps[step]();
    out.reached = {};
    for (const name of [path.basename(socket), 'renamed', 'moved', 'linked', 'ln']) if (fs.existsSync(at(name))) out.reached[name] = await one(at(name));
  }
  console.log(JSON.stringify(out));
})();
`;
/** What a child's steps on a socket file came to, under the profile or under none. */
async function moved(socket, steps, { profile = null } = {}) {
  const args = ['-e', MOVE, socket, JSON.stringify(steps)];
  const cmd = profile ? sandboxed(process.execPath, args, profile) : { file: process.execPath, args };
  const r = await run(cmd.file, cmd.args);
  assert.equal(r.code, 0, `the child ran: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

test('the socket file stays where it is: a rename, mv through a shell, an unlink and a hard link are refused, and the socket still cannot be reached', { skip: NEEDS_SANDBOX, timeout: 90_000 }, async () => {
  // With no sandbox each of them goes through, and the socket answers under its new name: what follows is the sandbox's doing.
  for (const [step, name] of [['rename', 'renamed'], ['mv', 'moved']]) {
    const l = await listeners();
    try {
      const open = await moved(l.pgSocket, [step]);
      assert.deepEqual([open.before, open[step], open.reached], ['connected', 'done', { [name]: 'connected' }], `with no sandbox, ${step}`);
    } finally { await l.done(); }
  }
  const gone = await listeners();
  try {
    assert.equal((await moved(gone.pgSocket, ['unlink'])).unlink, 'done', 'with no sandbox, unlink');
    assert.equal(fs.existsSync(gone.pgSocket), false);
  } finally { await gone.done(); }

  for (const migrate of [false, true]) {
    const l = await listeners();
    try {
      const name = path.basename(l.pgSocket);
      const out = await moved(l.pgSocket, ['rename', 'mv', 'link', 'ln', 'unlink'], { profile: sandboxProfile({ port: l.his.port, migrate }) });
      assert.deepEqual(out, { before: 'EPERM', rename: 'EPERM', mv: 'refused', link: 'EPERM', ln: 'refused', unlink: 'EPERM', reached: { [name]: 'EPERM' } }, `migrate: ${migrate}`);
      assert.deepEqual(fs.readdirSync(path.dirname(l.pgSocket)).sort(), [name, 'other.sock'], 'the folder is as it was');
      assert.equal(l.pg.hits.n, 0, 'nothing reached the socket');
    } finally { await l.done(); }
  }
});

test('the fence is narrow: a socket with another name still opens and can still be renamed', { skip: NEEDS_SANDBOX, timeout: 90_000 }, async () => {
  for (const migrate of [false, true]) {
    const l = await listeners();
    try {
      const out = await moved(l.otherSocket, ['rename'], { profile: sandboxProfile({ port: l.his.port, migrate }) });
      assert.deepEqual(out, { before: 'connected', rename: 'done', reached: { renamed: 'connected' } }, `migrate: ${migrate}`);
      assert.equal(l.other.hits.n, 2, 'both reached it');
      assert.equal(l.pg.hits.n, 0);
    } finally { await l.done(); }
  }
});

test('the self-test fails when a rename gets through', { skip: NEEDS_SANDBOX, timeout: 90_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-works-'));
  try {
    // The profile the product uses passes; the same without its write line lets the self-test's own socket be renamed.
    const without = (line) => (o) => sandboxProfile(o).split('\n').filter((l) => !l.includes(line)).join('\n');
    assert.equal(await sandboxWorks({ profile: sandboxProfile }), true, 'the profile as it is');
    assert.equal(await sandboxWorks({ profile: without('file-write*') }), false, 'no write line: the rename gets through');
    assert.equal(await sandboxWorks({ profile: without('unix-socket') }), false, 'no socket line: the socket is reached');
    // Round 4's answer, with nothing said about the rename, is no pass either.
    const old = path.join(dir, 'round4');
    fs.writeFileSync(old, '#!/bin/sh\necho \'{"a":"EPERM","socket":"EPERM","b":"connected"}\'\n', { mode: 0o755 });
    assert.equal(await sandboxWorks({ sandboxExec: old }), false, 'an answer without the rename');
    // And an answer that is right but for a rename that went through.
    const renamed = path.join(dir, 'renamed');
    fs.writeFileSync(renamed, '#!/bin/sh\necho \'{"rename":"renamed","a":"EPERM","socket":"EPERM","b":"connected"}\'\n', { mode: 0o755 });
    assert.equal(await sandboxWorks({ sandboxExec: renamed }), false, 'the rename went through');
    const right = path.join(dir, 'right');
    fs.writeFileSync(right, '#!/bin/sh\necho \'{"rename":"EPERM","a":"EPERM","socket":"EPERM","b":"connected"}\'\n', { mode: 0o755 });
    assert.equal(await sandboxWorks({ sandboxExec: right }), true, 'the same answer with the rename refused is a pass: only the rename made the difference');
    const more = path.join(dir, 'more');
    fs.writeFileSync(more, '#!/bin/sh\necho \'{"rename":"EPERM","a":"EPERM","socket":"EPERM","b":"connected","c":"connected"}\'\n', { mode: 0o755 });
    assert.equal(await sandboxWorks({ sandboxExec: more }), false, 'an answer with more in it than was asked is no pass');
    // The self-test moves the socket to a name the profile does not know, as an app would: a profile that
    // only refuses making a name with .s.PGSQL. in it lets that through, and is no pass.
    const makingOnly = (o) => sandboxProfile(o).replace('(deny file-write* ', '(deny file-write-create ');
    assert.notEqual(makingOnly({ port: 1 }), sandboxProfile({ port: 1 }));
    assert.equal(await sandboxWorks({ profile: makingOnly }), false, 'the socket could be renamed away');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('off macOS there is no fence: sandboxWorks is false without starting anything', async () => {
  let asked = 0;
  const profile = (o) => { asked++; return sandboxProfile(o); };
  for (const platform of ['win32', 'linux']) assert.equal(await sandboxWorks({ platform, sandboxExec: process.execPath, profile }), false, platform);
  assert.equal(asked, 0, 'no self-test was made: no profile was asked for, so no program was started');
});
