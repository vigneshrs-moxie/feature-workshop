// What keeps Auto's app and Auto's migrate scripts away from his Postgres server. Two parts, and the
// guarantee rests on these two alone (no settings file is read here, and none has to be read right):
//   - the sandbox: macOS's sandbox-exec, with a profile that denies the child his server (its port,
//     port 5432, and every .s.PGSQL. socket). A sandbox is inherited by everything the child starts
//     and can't be dropped.
//   - the door: a relay on 127.0.0.1 that passes a session on to his server only when its startup
//     message names exactly Auto's copy, <name>__auto. Everything else is refused before a byte
//     reaches his server.
//
//   sandboxProfile({ port, migrate })     the profile's text: fixed lines and his server's port
//   sandboxed(file, args, profile)        { file, args } that start file under that profile
//   sandboxWorks()                        whether this computer can fence a child off (a self-test)
//   openDoor({ target, database })        { port, refused, close() }

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const wholePort = (p) => typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 65535;

// ---------- The sandbox ----------

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

/**
 * The sandbox profile for Auto's app (migrate: for one of Auto's migrate scripts, which also reaches
 * nothing outside this computer). port: his server's port, a whole number from 1 to 65535; anything
 * else throws, so nothing but that number and the fixed lines is ever in the text.
 */
export function sandboxProfile({ port, migrate = false } = {}) {
  if (!wholePort(port)) throw new TypeError('The sandbox profile takes a port: a whole number from 1 to 65535.');
  return [
    '(version 1)',
    '(allow default)',
    ...(migrate ? ['(deny network-outbound (remote ip "*:*"))', '(allow network-outbound (remote ip "localhost:*"))'] : []),
    '(deny network-outbound (remote unix-socket (regex #"\\.s\\.PGSQL\\.")))',
    '(deny network-outbound (remote tcp "*:5432"))',
    `(deny network-outbound (remote tcp "*:${port}"))`,
  ].join('\n');
}

/** What to start instead of file and args so they run under the profile: { file, args }. */
export function sandboxed(file, args, profile) {
  return { file: SANDBOX_EXEC, args: ['-p', profile, file, ...args] };
}

// What the self-test's child runs: it tries each target and writes what happened to each.
const SELF_TEST = [
  "const net = require('net');",
  'const targets = JSON.parse(process.argv[1]);',
  'const out = {};',
  'let left = Object.keys(targets).length;',
  'for (const k of Object.keys(targets)) {',
  '  const c = net.connect(targets[k]);',
  '  const end = (r) => { if (k in out) return; out[k] = r; c.destroy(); if (--left === 0) process.stdout.write(JSON.stringify(out)); };',
  "  c.on('connect', () => end('connected'));",
  "  c.on('error', (e) => end(String(e.code)));",
  '}',
].join('\n');

/**
 * The self-test: two loopback listeners A and B and a socket named like Postgres's, then one child
 * under the app's profile for A's port. It passes only when the child says A and the socket were
 * refused (EPERM) and B answered. It cleans up what it made.
 */
async function selfTest({ execPath, sandboxExec, timeoutMs }) {
  if (!fs.existsSync(sandboxExec)) return false;
  const servers = [];
  let dir = null;
  let child = null;
  const listen = (where) => new Promise((resolve, reject) => {
    const s = net.createServer((c) => { c.on('error', () => {}); c.end(); });
    s.once('error', reject);
    s.listen(where, () => { servers.push(s); resolve(s); });
  });
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbf-'));
    const a = await listen({ host: '127.0.0.1', port: 0 });
    const b = await listen({ host: '127.0.0.1', port: 0 });
    const socket = path.join(dir, `.s.PGSQL.${a.address().port}`);
    if (Buffer.byteLength(socket) >= 104) return false; // too long for a unix socket: no test, no fence
    await listen({ path: socket });
    const targets = { a: { host: '127.0.0.1', port: a.address().port }, socket: { path: socket }, b: { host: '127.0.0.1', port: b.address().port } };
    const { args } = sandboxed(execPath, ['-e', SELF_TEST, JSON.stringify(targets)], sandboxProfile({ port: a.address().port }));
    const said = await new Promise((resolve) => {
      let text = '';
      const timer = setTimeout(() => resolve(null), timeoutMs);
      const end = (v) => { clearTimeout(timer); resolve(v); };
      child = spawn(sandboxExec, args, { stdio: ['ignore', 'pipe', 'ignore'], env: {} });
      child.stdout.on('data', (d) => { if (text.length < 4096) text += d; });
      child.on('error', () => end(null));
      child.on('close', () => end(text));
    });
    let answer = null;
    try { answer = JSON.parse(said); } catch { return false; }
    return Boolean(answer) && Object.keys(answer).length === 3 && answer.a === 'EPERM' && answer.socket === 'EPERM' && answer.b === 'connected';
  } finally {
    try { child?.kill('SIGKILL'); } catch { /* gone */ }
    for (const s of servers) s.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

const tested = new Map(); // execPath and sandbox-exec -> { ok, at } or { pending }

/**
 * Whether this computer can fence a child off from his server: only on macOS, with sandbox-exec
 * there, and after the self-test passed. A yes is kept for the life of the process; a no is tested
 * again at most once a minute. timeoutMs: how long the self-test's child may take (5 seconds).
 */
export function sandboxWorks({ platform = process.platform, execPath = process.execPath, sandboxExec = SANDBOX_EXEC, timeoutMs = 5000 } = {}) {
  if (platform !== 'darwin') return Promise.resolve(false);
  const key = `${execPath}\n${sandboxExec}`;
  const last = tested.get(key);
  if (last?.pending) return last.pending;
  if (last && (last.ok || Date.now() - last.at < 60_000)) return Promise.resolve(last.ok);
  const pending = selfTest({ execPath, sandboxExec, timeoutMs }).catch(() => false).then((ok) => {
    tested.set(key, { ok, at: Date.now() });
    return ok;
  });
  tested.set(key, { pending });
  return pending;
}

// ---------- The door ----------

const SSL_REQUEST = 80877103;
const GSSENC_REQUEST = 80877104;
const CANCEL_REQUEST = 80877102;
const MAX_FIRST_MESSAGE = 10_000;
const MAX_CONNECTIONS = 200;
const MAX_REFUSALS = 20;
const NAME_SHOWN = /^[A-Za-z0-9_.-]+$/;
const AUTO_NAME = /^[A-Za-z0-9_]+__auto$/;
const KEY_DATABASE = Buffer.from('database');
const KEY_REPLICATION = Buffer.from('replication');

/** The [key, value] pairs of a startup message (the whole message, its 8-byte head included), or null when its body isn't NUL-terminated strings in pairs and then one last NUL. */
function startupPairs(msg) {
  const pairs = [];
  for (let i = 8; ;) {
    const keyEnd = msg.indexOf(0, i);
    if (keyEnd < 0) return null;
    if (keyEnd === i) return keyEnd === msg.length - 1 ? pairs : null; // the last NUL, and nothing after it
    const valueEnd = msg.indexOf(0, keyEnd + 1);
    if (valueEnd < 0) return null;
    pairs.push([msg.subarray(i, keyEnd), msg.subarray(keyEnd + 1, valueEnd)]);
    i = valueEnd + 1;
  }
}

/** The one ErrorResponse the door ever writes. */
function refusalMessage(database) {
  const fields = Buffer.concat([
    ...[['S', 'FATAL'], ['V', 'FATAL'], ['C', '3D000'], ['M', `Starbase: Auto's app may only use its own copy of the database, ${database}.`]]
      .map(([k, v]) => Buffer.from(`${k}${v}\0`, 'latin1')),
    Buffer.from([0]),
  ]);
  const head = Buffer.alloc(5);
  head.write('E', 0, 'latin1');
  head.writeInt32BE(4 + fields.length, 1);
  return Buffer.concat([head, fields]);
}

/**
 * Opens the door to his server for one database, Auto's copy.
 *   target    his server: { host, port } or { socket } (the socket file's whole path)
 *   database  Auto's copy's name, <name>__auto (anything else throws: a door is never opened for his)
 * It listens on 127.0.0.1 only, on a port the OS picks (never 5432, never his server's). For each
 * connection it reads the first message, in however many pieces it comes:
 *   1. 8 bytes: a length (Int32, counting itself) and a code (Int32). A length under 8 or over 10,000: closed.
 *   2. SSLRequest or GSSENCRequest (length 8): answered with the byte N, and the next message is read.
 *      At most two per connection; a third: closed.
 *   3. CancelRequest: closed, never passed on.
 *   4. A startup message (the code's upper 16 bits are 3): its body must be NUL-terminated strings in
 *      pairs and one last NUL, else closed. Passed on only with exactly one `database` key whose value
 *      is, byte for byte, `database`, and no `replication` key.
 *   5. Any other code: closed.
 *   6. No complete first message within firstMessageMs: closed.
 *   7. Refused (4): one ErrorResponse (FATAL, 3D000, the door's words), the refusal noted, and no
 *      connection to his server is ever opened for it.
 *   8. Passed: a connection to target, the startup message's bytes exactly as they came, then bytes
 *      both ways, unread. When either side closes or fails, both are destroyed.
 *   9. At most 200 connections at once; one more is closed.
 * Returns { port, refused, close() }. refused: the last 20 refusals, oldest first, each { database, at }:
 * the name asked for (the first database value that isn't Auto's), cut to 60 characters, and
 * `another name` unless it is only letters, digits, _ - and . Nothing else of any message is kept,
 * logged or returned. close(): stops listening and ends every session through the door.
 * createServer: net.createServer (the tests hand in one whose port they choose).
 */
export async function openDoor({ target, database, firstMessageMs = 10_000, createServer = net.createServer } = {}) {
  if (typeof database !== 'string' || !AUTO_NAME.test(database)) throw new TypeError('The door opens only for a database named <name>__auto.');
  const dial = typeof target?.socket === 'string' && target.socket.startsWith('/') ? { path: target.socket }
    : typeof target?.host === 'string' && target.host && wholePort(target.port) ? { host: target.host, port: target.port }
      : null;
  if (!dial) throw new TypeError('The door needs his server: { host, port } or { socket }.');
  const wanted = Buffer.from(database);
  const answer = refusalMessage(database);
  const refused = [];
  const sockets = new Set(); // every socket of every session: the clients' and the ones to his server
  let clients = 0;
  let closed = false;

  const keep = (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    return socket;
  };

  function refuse(client, pairs) {
    const other = pairs.find(([k, v]) => k.equals(KEY_DATABASE) && !v.equals(wanted));
    const name = other ? other[1].toString('utf8').slice(0, 60) : '';
    refused.push({ database: NAME_SHOWN.test(name) ? name : 'another name', at: new Date().toISOString() });
    if (refused.length > MAX_REFUSALS) refused.shift();
    client.resume(); // whatever else it sends is dropped
    client.end(answer);
    setTimeout(() => client.destroy(), 2000).unref();
  }

  function pass(client, first, rest) {
    const server = keep(net.connect(dial));
    const both = () => { client.destroy(); server.destroy(); };
    client.on('close', both);
    server.on('close', both);
    server.write(first);
    if (rest.length) server.write(rest);
    client.pipe(server);
    server.pipe(client);
  }

  function onConnection(client) {
    if (closed || clients >= MAX_CONNECTIONS) { client.destroy(); return; }
    clients++;
    keep(client).on('close', () => { clients--; });
    let buf = Buffer.alloc(0);
    let asks = 0;
    const timer = setTimeout(() => client.destroy(), firstMessageMs);
    client.on('close', () => clearTimeout(timer));
    const settled = () => { clearTimeout(timer); client.off('data', onData); };
    const shut = () => { settled(); client.destroy(); };
    function onData(chunk) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      for (;;) {
        if (buf.length < 8) return;
        const length = buf.readInt32BE(0);
        const code = buf.readInt32BE(4);
        if (length < 8 || length > MAX_FIRST_MESSAGE) return shut();
        if (buf.length < length) return;
        const msg = buf.subarray(0, length);
        const rest = buf.subarray(length);
        if ((code === SSL_REQUEST || code === GSSENC_REQUEST) && length === 8) {
          if (++asks > 2) return shut();
          client.write('N');
          buf = rest;
          continue;
        }
        if (code === CANCEL_REQUEST || code >>> 16 !== 3) return shut(); // a cancel request, or no startup message at all
        const pairs = startupPairs(msg);
        if (!pairs) return shut();
        settled();
        // The one comparison everything rests on: exactly one database key, naming exactly Auto's copy.
        const named = pairs.filter(([k]) => k.equals(KEY_DATABASE));
        const ok = named.length === 1 && named[0][1].equals(wanted) && !pairs.some(([k]) => k.equals(KEY_REPLICATION));
        return ok ? pass(client, msg, rest) : refuse(client, pairs);
      }
    }
    client.on('data', onData);
  }

  // A port the OS picks; 5432 or his server's is held until another is picked, then let go.
  const barred = (port) => port === 5432 || port === dial.port;
  const held = [];
  let server = null;
  try {
    for (let tries = 0; ; tries++) {
      const s = createServer(onConnection);
      await new Promise((resolve, reject) => { s.once('error', reject); s.listen({ host: '127.0.0.1', port: 0 }, resolve); });
      if (!barred(s.address().port)) { server = s; break; }
      held.push(s);
      if (tries >= 5) throw new Error('The door found no port to listen on.');
    }
  } finally {
    for (const s of held) s.close();
  }
  server.on('error', () => {});

  return {
    port: server.address().port,
    refused,
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      for (const s of sockets) s.destroy();
      return new Promise((resolve) => { server.close(() => resolve()); });
    },
  };
}
