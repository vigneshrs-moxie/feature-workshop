// The door between Auto's app and his Postgres server (lib/db-door.js openDoor): a relay that passes a
// session on only when its startup message names Auto's copy. No Postgres anywhere: the "server" is a
// plain listener made here that records what reaches it, and the "clients" are plain sockets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { openDoor } from '../lib/db-door.js';

const AUTO = 'orbit__auto';
const WORDS = "Starbase: Auto's app may only use its own copy of the database, orbit__auto.";
const SSL = 80877103;
const GSSENC = 80877104;
const CANCEL = 80877102;
const Z = Buffer.from([0]);
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** A message as a client sends it first: a length (counting itself), a code, a body. length: a lie to tell instead. */
function message(code, body = Buffer.alloc(0), { length = 8 + body.length } = {}) {
  const head = Buffer.alloc(8);
  head.writeInt32BE(length, 0);
  head.writeInt32BE(code, 4);
  return Buffer.concat([head, body]);
}
/** A startup message with these [key, value] pairs, in order. */
function startup(pairs, { major = 3, minor = 0 } = {}) {
  const body = Buffer.concat([...pairs.flatMap(([k, v]) => [Buffer.from(k), Z, Buffer.from(v), Z]), Z]);
  return message(major * 65536 + minor, body);
}
const forDb = (database) => startup([['user', 'me'], ['database', database], ['application_name', 'psql']]);

/** A plain listener standing for his server: every connection and the bytes it got. */
async function fakeServer(where = { host: '127.0.0.1', port: 0 }) {
  const conns = [];
  const server = net.createServer((socket) => {
    const c = { socket, bytes: Buffer.alloc(0), closed: false };
    conns.push(c);
    socket.on('data', (d) => { c.bytes = Buffer.concat([c.bytes, d]); });
    socket.on('close', () => { c.closed = true; });
    socket.on('error', () => {});
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(where, resolve); });
  const close = () => new Promise((resolve) => { for (const c of conns) c.socket.destroy(); server.close(() => resolve()); });
  return { conns, port: server.address()?.port ?? null, close };
}

/** One client: writes the chunks (slow: one at a time, each in its own packet), then gathers the answer until the door closes it or waitMs pass. */
function talk(port, chunks, { waitMs = 4000, slow = false, host = '127.0.0.1' } = {}) {
  return new Promise((resolve) => {
    const c = net.connect({ host, port });
    c.setNoDelay(true);
    const got = [];
    let done = false;
    const end = (closed, error = null) => { if (done) return; done = true; clearTimeout(timer); c.destroy(); resolve({ reply: Buffer.concat(got), closed, error }); };
    const timer = setTimeout(() => end(false), waitMs);
    c.on('data', (d) => got.push(d));
    c.on('close', () => end(true));
    c.on('error', (err) => end(true, err.code));
    c.on('connect', async () => {
      for (const chunk of chunks) {
        if (c.destroyed) return;
        c.write(chunk);
        if (slow) await sleep(1);
      }
    });
  });
}

/** A client that stays: { socket, bytes(), closed() }. */
async function session(port, first) {
  const socket = net.connect({ host: '127.0.0.1', port });
  let bytes = Buffer.alloc(0);
  let closed = false;
  socket.on('data', (d) => { bytes = Buffer.concat([bytes, d]); });
  socket.on('close', () => { closed = true; });
  socket.on('error', () => { closed = true; });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  if (first) socket.write(first);
  return { socket, bytes: () => bytes, closed: () => closed };
}

async function until(ok, what, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end;) { if (await ok()) return; await sleep(10); }
  assert.fail(what);
}

/** The fields of one ErrorResponse, which must be the whole answer. */
function errorFields(buf) {
  assert.ok(buf.length > 5, 'an answer came');
  assert.equal(String.fromCharCode(buf[0]), 'E', 'an ErrorResponse');
  assert.equal(buf.readInt32BE(1), buf.length - 1, 'one message, and nothing after it');
  const fields = {};
  let i = 5;
  while (buf[i] !== 0) {
    const end = buf.indexOf(0, i + 1);
    fields[String.fromCharCode(buf[i])] = buf.toString('latin1', i + 1, end);
    i = end + 1;
  }
  assert.equal(i, buf.length - 1, 'ends with one NUL');
  return fields;
}

/** A fake server and a door to it for Auto's copy. */
async function world(opts = {}) {
  const his = await fakeServer();
  const door = await openDoor({ target: { host: '127.0.0.1', port: his.port }, database: AUTO, ...opts });
  return { his, door, done: async () => { await door.close(); await his.close(); } };
}

test("a session that names Auto's copy is passed on, byte for byte", async () => {
  const w = await world();
  const unix = process.platform !== 'win32'; // a server behind a socket file: not on Windows, which has none
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-door-'));
  const onSocket = unix ? await fakeServer({ path: path.join(dir, 'server.sock') }) : null;
  const socketDoor = unix ? await openDoor({ target: { socket: path.join(dir, 'server.sock') }, database: AUTO }) : null;
  try {
    for (const [name, door, his, first] of [
      ['a host and a port', w.door, w.his, forDb(AUTO)],
      ['a newer protocol (3.2), the database first', w.door, w.his, startup([['database', AUTO], ['user', 'me'], ['options', '-c x=1'], ['_pq_.x', 'y']], { minor: 2 })],
      ...(unix ? [['a socket', socketDoor, onSocket, forDb(AUTO)]] : []),
    ]) {
      const before = his.conns.length;
      const s = await session(door.port, first);
      await until(() => his.conns.length === before + 1 && his.conns.at(-1).bytes.length >= first.length, `${name}: the session never reached the server`);
      assert.ok(his.conns.at(-1).bytes.equals(first), `${name}: the same bytes`);
      assert.equal(s.bytes().length, 0, `${name}: the door answered nothing itself`);
      s.socket.destroy();
    }
    assert.deepEqual(w.door.refused, [], 'nothing was refused');
  } finally {
    await socketDoor?.close();
    await onSocket?.close();
    await w.done();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a session that names his database is refused with the door's words and never reaches the server", async () => {
  const w = await world();
  try {
    const r = await talk(w.door.port, [forDb('orbit')]);
    assert.equal(r.closed, true, 'the door ended it');
    assert.deepEqual(errorFields(r.reply), { S: 'FATAL', V: 'FATAL', C: '3D000', M: WORDS });
    assert.equal(w.his.conns.length, 0, 'no connection to his server was opened');
    assert.equal(w.door.refused.length, 1);
    assert.deepEqual(Object.keys(w.door.refused[0]), ['database', 'at'], 'nothing else of the message is kept');
    assert.equal(w.door.refused[0].database, 'orbit');
    assert.ok(Math.abs(Date.parse(w.door.refused[0].at) - Date.now()) < 60_000);
  } finally { await w.done(); }
});

test('what the door refuses', async () => {
  const pair = (k, v) => Buffer.concat([Buffer.from(k), Z, Buffer.from(v), Z]);
  // [what, the first bytes, refused with the words (true) or only closed (false)]
  const rows = [
    ['no database key', startup([['user', 'orbit__auto']]), true],
    ['orbit', forDb('orbit'), true],
    ['orbit__original', forDb('orbit__original'), true],
    ['orbit__auto2', forDb('orbit__auto2'), true],
    ['ORBIT__AUTO', forDb('ORBIT__AUTO'), true],
    ['orbit__auto with a space after it', forDb('orbit__auto '), true],
    ['two database keys, both Auto\'s', startup([['database', AUTO], ['database', AUTO]]), true],
    ['two database keys, his second', startup([['database', AUTO], ['user', 'me'], ['database', 'orbit']]), true],
    ['two database keys, his first', startup([['database', 'orbit'], ['database', AUTO]]), true],
    ['a replication key', startup([['user', 'me'], ['database', AUTO], ['replication', 'database']]), true],
    ['protocol major 2', startup([['user', 'me'], ['database', AUTO]], { major: 2 }), false],
    ['length 7', message(196608, Buffer.alloc(0), { length: 7 }), false],
    ['length 10,001', message(196608, Buffer.alloc(9993, 0x61), { length: 10_001 }), false],
    ['a negative length', message(196608, pair('database', AUTO), { length: -1 }), false],
    ['a body with no closing NUL', message(196608, pair('database', AUTO)), false],
    ['an odd number of strings', message(196608, Buffer.concat([pair('database', AUTO), Buffer.from('user'), Z, Z])), false],
    ['a key with no value', message(196608, Buffer.concat([pair('database', AUTO), Buffer.from('user'), Z])), false],
    ['bytes after the last NUL', message(196608, Buffer.concat([pair('database', AUTO), Z, pair('database', 'orbit'), Z])), false],
    ['an empty body', message(196608), false],
    ['bytes that are no message at all', Buffer.from('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n'), false],
    ['a TLS hello', Buffer.from([0x16, 0x03, 0x01, 0x02, 0x00, 0x01, 0x00, 0x01, 0xfc, 0x03, 0x03]), false],
    ['a cancel request', message(CANCEL, Buffer.alloc(8, 1)), false],
    ['an SSLRequest that is not 8 long', message(SSL, Buffer.alloc(4)), false],
    ['another code', message(12345), false],
  ];
  const w = await world();
  try {
    for (const [what, bytes, words] of rows) {
      const r = await talk(w.door.port, [bytes]);
      assert.equal(r.closed, true, `${what}: closed`);
      if (words) assert.equal(errorFields(r.reply).M, WORDS, `${what}: the door's words`);
      else assert.equal(r.reply.length, 0, `${what}: closed with no answer`);
      assert.equal(w.his.conns.length, 0, `${what}: the server saw no connection`);
    }
    assert.equal(w.door.refused.length, rows.filter((r) => r[2]).length, 'each refusal is noted, a closed connection is not');
  } finally { await w.done(); }
});

test('SSLRequest and GSSENCRequest are answered N and the startup message after them is judged', async () => {
  const w = await world();
  try {
    // Auto's copy after one request, and after both: passed, and only the startup message reaches the server.
    for (const asks of [[message(SSL)], [message(GSSENC), message(SSL)]]) {
      const first = forDb(AUTO);
      const before = w.his.conns.length;
      const s = await session(w.door.port);
      for (const [i, ask] of asks.entries()) {
        s.socket.write(ask);
        await until(() => s.bytes().length === i + 1, 'no answer to the request');
      }
      assert.equal(s.bytes().toString('latin1'), 'N'.repeat(asks.length));
      s.socket.write(first);
      await until(() => w.his.conns.length === before + 1 && w.his.conns.at(-1).bytes.length >= first.length, 'the startup message never reached the server');
      assert.ok(w.his.conns.at(-1).bytes.equals(first), 'the startup message alone, as it came');
      s.socket.destroy();
    }
    // The request and the startup message in one packet.
    const before = w.his.conns.length;
    const s = await session(w.door.port, Buffer.concat([message(SSL), forDb(AUTO)]));
    await until(() => w.his.conns.length === before + 1 && w.his.conns.at(-1).bytes.length > 0, 'both in one packet: never passed');
    assert.ok(w.his.conns.at(-1).bytes.equals(forDb(AUTO)));
    s.socket.destroy();
    // His database after a request: N, then the door's words, and nothing reaches the server.
    const n = w.his.conns.length;
    const r = await talk(w.door.port, [message(SSL), forDb('orbit')]);
    assert.equal(String.fromCharCode(r.reply[0]), 'N');
    assert.equal(errorFields(r.reply.subarray(1)).M, WORDS);
    assert.equal(w.his.conns.length, n);
  } finally { await w.done(); }
});

test('three in a row closes', async () => {
  const w = await world();
  try {
    const r = await talk(w.door.port, [message(SSL), message(GSSENC), message(SSL), forDb(AUTO)]);
    assert.equal(r.closed, true);
    assert.equal(r.reply.toString('latin1'), 'NN', 'two answers, then closed');
    assert.equal(w.his.conns.length, 0);
  } finally { await w.done(); }
});

test('a first message that arrives one byte at a time is still judged', async () => {
  const w = await world();
  try {
    const bytes = (buf) => [...buf].map((b) => Buffer.from([b]));
    const refused = await talk(w.door.port, bytes(forDb('orbit')), { slow: true });
    assert.equal(errorFields(refused.reply).M, WORDS);
    assert.equal(w.his.conns.length, 0);
    const first = forDb(AUTO);
    const passed = talk(w.door.port, bytes(Buffer.concat([message(SSL), first])), { slow: true, waitMs: 3000 });
    await until(() => w.his.conns.length === 1 && w.his.conns[0].bytes.length >= first.length, 'never passed on');
    assert.ok(w.his.conns[0].bytes.equals(first));
    w.his.conns[0].socket.destroy();
    assert.equal((await passed).reply.toString('latin1'), 'N');
  } finally { await w.done(); }
});

test('no first message in time closes', async () => {
  const w = await world({ firstMessageMs: 200 });
  try {
    for (const [what, chunks, answer] of [
      ['nothing sent', [], ''],
      ['half a message', [forDb(AUTO).subarray(0, 20)], ''],
      ['an SSLRequest and then nothing', [message(SSL)], 'N'],
    ]) {
      const started = Date.now();
      const r = await talk(w.door.port, chunks, { waitMs: 5000 });
      assert.equal(r.closed, true, `${what}: closed`);
      assert.equal(r.reply.toString('latin1'), answer, what);
      assert.ok(Date.now() - started >= 150, `${what}: not before its time`);
    }
    assert.equal(w.his.conns.length, 0);
    // A session that was passed on is not cut off by that clock.
    const s = await session(w.door.port, forDb(AUTO));
    await until(() => w.his.conns.length === 1, 'never passed on');
    await sleep(400);
    assert.equal(s.closed(), false, 'still open after the first-message time');
    s.socket.destroy();
  } finally { await w.done(); }
});

test('after the startup message the door reads nothing: bytes pass both ways, and a close on either side closes the other', async () => {
  const w = await world();
  try {
    const first = forDb(AUTO);
    // What follows would be refused or closed as a first message: after it, it is only bytes.
    const after = Buffer.concat([forDb('orbit'), message(CANCEL, Buffer.alloc(8, 7)), Buffer.from([0, 0, 0, 3, 255]), Buffer.alloc(30_000, 0x51)]);
    const s = await session(w.door.port, Buffer.concat([first, after.subarray(0, 10)]));
    await until(() => w.his.conns.length === 1, 'never passed on');
    s.socket.write(after.subarray(10));
    const conn = w.his.conns[0];
    await until(() => conn.bytes.length >= first.length + after.length, 'the client\'s bytes never all came');
    assert.ok(conn.bytes.equals(Buffer.concat([first, after])), 'client to server, as sent');
    const back = Buffer.concat([Buffer.from('R\0\0\0\x08\0\0\0\0', 'latin1'), Buffer.alloc(40_000, 0x5a)]);
    conn.socket.write(back);
    await until(() => s.bytes().length >= back.length, 'the server\'s bytes never all came');
    assert.ok(s.bytes().equals(back), 'server to client, as sent');
    assert.deepEqual(w.door.refused, [], 'the later bytes were not judged');
    // The client closes: the server's side closes.
    s.socket.destroy();
    await until(() => conn.closed, 'the server side stayed open after the client closed');
    // The server closes: the client's side closes.
    const s2 = await session(w.door.port, first);
    await until(() => w.his.conns.length === 2, 'the second session never passed');
    w.his.conns[1].socket.destroy();
    await until(() => s2.closed(), 'the client side stayed open after the server closed');
    // The client fails (a reset, no orderly end): the server's side closes too.
    const s3 = await session(w.door.port, first);
    await until(() => w.his.conns.length === 3, 'the third session never passed');
    s3.socket.resetAndDestroy();
    await until(() => w.his.conns[2].closed, 'the server side stayed open after the client was reset');
  } finally { await w.done(); }
});

test('a server that is not there: the session is closed', async () => {
  const gone = await fakeServer();
  const port = gone.port;
  await gone.close();
  const door = await openDoor({ target: { host: '127.0.0.1', port }, database: AUTO });
  try {
    const r = await talk(door.port, [forDb(AUTO)]);
    assert.equal(r.closed, true);
  } finally { await door.close(); }
});

test('the door listens on 127.0.0.1 only, never on 5432 or his port', async () => {
  const w = await world();
  try {
    assert.ok(Number.isInteger(w.door.port) && w.door.port > 0);
    assert.notEqual(w.door.port, 5432);
    assert.notEqual(w.door.port, w.his.port);
    assert.equal((await talk(w.door.port, [], { waitMs: 300 })).error, null, 'it answers on 127.0.0.1');
    assert.equal((await talk(w.door.port, [], { host: '::1', waitMs: 8000 })).error, 'ECONNREFUSED', 'not on ::1');
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? null;
    if (lan) assert.equal((await talk(w.door.port, [], { host: lan, waitMs: 8000 })).error, 'ECONNREFUSED', 'not on this computer\'s network address');
  } finally { await w.done(); }
  // The port the OS hands out is 5432, or his: the door opens again, and lets that one go.
  for (const [what, taken] of [['5432', () => 5432], ['his port', (his) => his]]) {
    const hisPort = 40_000 + Math.floor(Math.random() * 1000); // nothing is ever sent there
    const made = [];
    const createServer = (onConnection) => {
      const server = net.createServer(onConnection);
      if (!made.length) { const real = server.address.bind(server); server.address = () => ({ ...real(), port: taken(hisPort) }); }
      made.push(server);
      return server;
    };
    const door = await openDoor({ target: { host: '127.0.0.1', port: hisPort }, database: AUTO, createServer });
    try {
      assert.equal(made.length, 2, `${what}: it opened again`);
      assert.notEqual(door.port, taken(hisPort), what);
      assert.equal(door.port, made[1].address().port);
      assert.equal(made[0].listening, false, `${what}: the first listener is closed`);
      assert.equal(made[1].address().address, '127.0.0.1');
    } finally { await door.close(); }
  }
});

test('refusals are kept: the last 20, the name cut and cleaned', async () => {
  const w = await world();
  try {
    for (let i = 0; i < 25; i++) await talk(w.door.port, [forDb(`n${i}`)]);
    assert.equal(w.door.refused.length, 20);
    assert.deepEqual(w.door.refused.map((r) => r.database), Array.from({ length: 20 }, (_, i) => `n${i + 5}`), 'the last 20, oldest first');
    const asked = async (first) => { await talk(w.door.port, [first]); return w.door.refused.at(-1).database; };
    assert.equal(await asked(forDb('a'.repeat(100))), 'a'.repeat(60), 'cut to 60 characters');
    assert.equal(await asked(forDb('his.db-1_x')), 'his.db-1_x', 'letters, digits, _ - and . are kept');
    for (const odd of ['or bit', 'orbit;drop', 'orbit"', '<b>', 'ørbit', 'a\nb', '']) assert.equal(await asked(forDb(odd)), 'another name', JSON.stringify(odd));
    assert.equal(await asked(forDb(`${'a'.repeat(59)} b`)), 'another name', 'cleaned after the cut');
    assert.equal(await asked(startup([['user', 'secret-user'], ['password', 'hunter2']])), 'another name', 'no database key');
    assert.equal(await asked(startup([['database', AUTO], ['replication', 'true']])), 'another name', 'Auto\'s own name is not the name refused');
    assert.equal(await asked(startup([['database', AUTO], ['database', 'orbit']])), 'orbit', 'the one that is not Auto\'s');
    assert.equal(w.door.refused.length, 20);
    assert.doesNotMatch(JSON.stringify(w.door.refused), /secret-user|hunter2|psql/, 'nothing else of a message is kept');
    assert.equal(w.his.conns.length, 0);
  } finally { await w.done(); }
});

test('close ends the sessions through the door', async () => {
  const w = await world({ firstMessageMs: 60_000 });
  try {
    const passed = await session(w.door.port, forDb(AUTO));
    await until(() => w.his.conns.length === 1, 'never passed on');
    const waiting = await session(w.door.port); // has said nothing yet
    await w.door.close();
    await until(() => passed.closed() && waiting.closed(), 'a client stayed open');
    await until(() => w.his.conns[0].closed, 'the server side stayed open');
    assert.equal((await talk(w.door.port, [], { waitMs: 8000 })).error, 'ECONNREFUSED', 'it no longer listens');
    await w.door.close(); // a second close is nothing
  } finally { await w.done(); }
});

test('at most 200 connections are open at once', async () => {
  const w = await world({ firstMessageMs: 60_000 });
  const held = [];
  try {
    for (let i = 0; i < 200; i++) held.push(await session(w.door.port));
    await sleep(100);
    assert.equal(held.filter((s) => s.closed()).length, 0, 'the first 200 stay');
    const r = await talk(w.door.port, [forDb(AUTO)], { waitMs: 3000 });
    assert.equal(r.closed, true, 'the 201st is closed');
    assert.equal(r.reply.length, 0);
    assert.equal(w.his.conns.length, 0);
    held[0].socket.destroy();
    await sleep(100);
    const s = await session(w.door.port, forDb(AUTO));
    await until(() => w.his.conns.length === 1, 'with one gone, the next is served');
    s.socket.destroy();
  } finally { for (const s of held) s.socket.destroy(); await w.done(); }
});

test('openDoor takes only a name that ends in __auto, and a target it can dial', async () => {
  const target = { host: '127.0.0.1', port: 40_123 };
  for (const database of ['orbit', 'orbit__original', '', '__auto', 'or bit__auto', 'orbit__auto ', null, undefined, 5]) {
    await assert.rejects(openDoor({ target, database }), { name: 'TypeError', message: /named <name>__auto/ }, JSON.stringify(database));
  }
  for (const bad of [null, {}, { host: '127.0.0.1' }, { host: '127.0.0.1', port: 0 }, { host: '127.0.0.1', port: '5432' }, { host: '', port: 5432 }, { socket: '' }, { socket: 'relative/.s.PGSQL.5432' }]) {
    await assert.rejects(openDoor({ target: bad, database: AUTO }), { name: 'TypeError', message: /needs his server/ }, JSON.stringify(bad));
  }
});
