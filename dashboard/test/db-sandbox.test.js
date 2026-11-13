// The sandbox that keeps Auto's app and migrate scripts away from his Postgres server (lib/db-door.js
// sandboxProfile, sandboxed, sandboxWorks). macOS only. No Postgres anywhere: "his server" and "the
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

const mac = process.platform === 'darwin';

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

test("a sandboxed child and its grandchild can't reach his port by 127.0.0.1, localhost or ::1, nor a .s.PGSQL. socket, and can reach the door", { skip: !mac, timeout: 90_000 }, async () => {
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

test("a migrate script's sandbox also refuses an address outside the laptop", { skip: !mac, timeout: 90_000 }, async () => {
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

test('sandboxWorks is false off macOS, without sandbox-exec, and when the self-test fails', { skip: !mac, timeout: 90_000 }, async (t) => {
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
