// Portal Feedback (ORBIT-479) from Ground Control: the token and where it is kept, the read-only
// client against a fake Orbit (an http server on a free port serving test/fixtures/orbit), the
// inbox poller's cadence on a fake clock, the scrubber, and a grep that keeps every request to
// Orbit a GET. Nothing here touches ~/.claude, the Keychain, ~/.ground-control or a real Orbit.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkToken, normalizeOrbitUrl, mcpEntry, writeMcpEntry, removeMcpEntry, setToken, clearToken, sessionEnv,
  parseTicketKey, canonicalKey, OrbitError, orbitClient, retryAfterMs, fromDay,
} from '../lib/orbit.js';
import { fileStore, keychainStore, layeredStore, tokenStore } from '../lib/orbit-token.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = `orbfb_${'A'.repeat(20)}${'b'.repeat(20)}_-9`; // 43 after the prefix
const tmpDirs = [];
async function tmp() {
  const d = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-orbit-')));
  tmpDirs.push(d);
  return d;
}
after(async () => { for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }); });

// ---------- Step 1: the token ----------

test('a pasted token is checked for the orbfb_ prefix and its length, in plain words', () => {
  assert.equal(TOKEN.length, 6 + 43);
  assert.equal(checkToken(`  ${TOKEN}\n`), TOKEN);
  assert.equal(checkToken(`Bearer ${TOKEN}`), TOKEN);
  assert.throws(() => checkToken(''), /Paste your Orbit token/);
  assert.throws(() => checkToken('ghp_abc'), /should start with orbfb_/);
  assert.throws(() => checkToken(TOKEN.slice(0, -1)), /wrong length/);
  assert.throws(() => checkToken(`${TOKEN.slice(0, -1)}!`), /wrong length or has a stray character/);
  assert.throws(() => checkToken(`${TOKEN}x`), (e) => e instanceof OrbitError && e.kind === 'token');
});

test('Orbit’s address: https, or http on this computer only; trailing slashes dropped', () => {
  assert.equal(normalizeOrbitUrl('https://orbit.example.com/'), 'https://orbit.example.com');
  assert.equal(normalizeOrbitUrl('http://127.0.0.1:5000'), 'http://127.0.0.1:5000');
  assert.throws(() => normalizeOrbitUrl('http://orbit.example.com'), /https/);
  assert.throws(() => normalizeOrbitUrl('not a url'), /should look like/);
  assert.throws(() => normalizeOrbitUrl('https://orbit.example.com/?a=1'), /just the site/);
});

test('the file store keeps the token in one file, mode 600, in a 700 folder', async () => {
  const dir = path.join(await tmp(), 'state');
  const store = fileStore(dir);
  assert.equal(await store.get(), null);
  await store.set(TOKEN);
  assert.equal(await store.get(), TOKEN);
  assert.equal((await fs.stat(store.file)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
  await store.clear();
  assert.equal(await store.get(), null);
});

test('the Keychain store passes the token on standard input only, never on the command line', async () => {
  const calls = [];
  let saved = null;
  const run = async (args, input = null) => {
    calls.push({ args, input });
    if (args[0] === '-i') { saved = /-w (\S+)/.exec(input)[1]; return { code: 0, out: '' }; }
    if (args[0] === 'find-generic-password') return saved ? { code: 0, out: `${saved}\n` } : { code: 44, out: '' };
    if (args[0] === 'delete-generic-password') { saved = null; return { code: 0, out: '' }; }
    return { code: 1, out: '' };
  };
  const store = keychainStore({ run });
  await store.set(TOKEN);
  assert.equal(await store.get(), TOKEN);
  for (const c of calls) assert.ok(!c.args.join(' ').includes(TOKEN), 'the token is never an argument');
  assert.ok(calls[0].input.includes(TOKEN));
  await store.clear();
  assert.equal(await store.get(), null);
});

test('a credential store that fails falls back to the file, and says so; clearing clears both', async () => {
  const file = fileStore(await tmp());
  const broken = { kind: 'keychain', get: async () => null, set: async () => { throw new Error('locked'); }, clear: async () => {} };
  const store = layeredStore(broken, file);
  await store.set(TOKEN);
  assert.equal(store.kind, 'file');
  assert.equal(await store.get(), TOKEN);
  await store.clear();
  assert.equal(await file.get(), null);

  let kept = null;
  const working = { kind: 'keytar', get: async () => kept, set: async (t) => { kept = t; }, clear: async () => { kept = null; } };
  const both = layeredStore(working, file);
  await both.set(TOKEN);
  assert.equal(both.kind, 'keytar');
  assert.equal(await file.get(), null, 'no second copy in the file');
});

test('tokenStore picks keytar when it loads, the Keychain on macOS, else the file; prefer file forces the file', async () => {
  const stateDir = await tmp();
  const noKeytar = async () => { throw new Error('Cannot find package keytar'); };
  const fakeKeytar = async () => ({ default: { getPassword: async () => null, setPassword: async () => {}, deletePassword: async () => {} } });
  assert.equal((await tokenStore({ stateDir, prefer: 'file', importKeytar: fakeKeytar })).kind, 'file');
  assert.equal((await tokenStore({ stateDir, importKeytar: fakeKeytar })).kind, 'keytar');
  assert.equal((await tokenStore({ stateDir, importKeytar: noKeytar, platform: 'darwin', run: async () => ({ code: 44, out: '' }) })).kind, 'keychain');
  assert.equal((await tokenStore({ stateDir, importKeytar: noKeytar, platform: 'linux' })).kind, 'file');
});

test('setToken stores the token and writes the Foreman’s MCP entry with a variable, never the token; clearToken undoes both', async () => {
  const root = await tmp();
  const claudeSettingsFile = path.join(root, 'home', '.claude', 'settings.json');
  await fs.mkdir(path.dirname(claudeSettingsFile), { recursive: true });
  await fs.writeFile(claudeSettingsFile, JSON.stringify({ model: 'opus', mcpServers: { other: { type: 'stdio', command: 'x' } } }), { mode: 0o644 });
  const store = fileStore(path.join(root, 'state'));

  const r = await setToken(TOKEN, { store, claudeSettingsFile, orbitUrl: 'https://orbit.example.com/' });
  assert.equal(r.store, 'file');
  assert.equal(await store.get(), TOKEN);
  const text = await fs.readFile(claudeSettingsFile, 'utf8');
  assert.ok(!text.includes('orbfb_'), 'the token never reaches Claude Code’s settings');
  const written = JSON.parse(text);
  assert.equal(written.model, 'opus', 'everything else is kept');
  assert.deepEqual(written.mcpServers.other, { type: 'stdio', command: 'x' });
  assert.deepEqual(written.mcpServers['orbit-feedback'], { type: 'http', url: 'https://orbit.example.com/api/mcp/feedback', headers: { Authorization: 'Bearer ${ORBIT_FEEDBACK_TOKEN}' } });
  assert.deepEqual(written.mcpServers['orbit-feedback'], mcpEntry('https://orbit.example.com'));
  assert.equal((await fs.stat(claudeSettingsFile)).mode & 0o777, 0o644, 'the file keeps its mode');
  assert.deepEqual(await sessionEnv(store), { ORBIT_FEEDBACK_TOKEN: TOKEN });

  await clearToken({ store, claudeSettingsFile });
  assert.equal(await store.get(), null);
  const cleared = JSON.parse(await fs.readFile(claudeSettingsFile, 'utf8'));
  assert.equal(cleared.mcpServers['orbit-feedback'], undefined);
  assert.ok(cleared.mcpServers.other);
  assert.deepEqual(await sessionEnv(store), {});
});

test('setToken refuses a bad token or address before saving anything; a broken settings file is left alone', async () => {
  const root = await tmp();
  const claudeSettingsFile = path.join(root, '.claude', 'settings.json');
  const store = fileStore(path.join(root, 'state'));
  await assert.rejects(setToken('orbfb_short', { store, claudeSettingsFile, orbitUrl: 'https://o.example.com' }), /wrong length/);
  await assert.rejects(setToken(TOKEN, { store, claudeSettingsFile, orbitUrl: 'http://o.example.com' }), /https/);
  assert.equal(await store.get(), null);
  // No settings file yet: one is made with just the entry.
  await setToken(TOKEN, { store, claudeSettingsFile, orbitUrl: 'https://o.example.com' });
  assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(claudeSettingsFile, 'utf8'))), ['mcpServers']);
  await clearToken({ store, claudeSettingsFile });
  assert.deepEqual(JSON.parse(await fs.readFile(claudeSettingsFile, 'utf8')), {}, 'an emptied mcpServers goes too');
  await fs.writeFile(claudeSettingsFile, '{ not json');
  await assert.rejects(writeMcpEntry(claudeSettingsFile, 'https://o.example.com'), /isn’t valid JSON/);
  assert.equal(await fs.readFile(claudeSettingsFile, 'utf8'), '{ not json');
  assert.equal(await removeMcpEntry(claudeSettingsFile), false);
});

test('ticket keys: the lenient forms Orbit accepts, stored as ORBIT-<n>', () => {
  for (const s of ['ORBIT-479', 'orbit-479', 'orbit479', '#479', '479', ' Orbit-#479 ']) assert.equal(canonicalKey(s), 'ORBIT-479', s);
  assert.equal(parseTicketKey('ORBIT-0479'), 479);
  for (const s of ['', 'ORBIT-', 'ORB-479', 'orbit 479', '1234567890', 'ORBIT-12a', null]) assert.equal(canonicalKey(s), null, String(s));
});


// ---------- A fake Orbit: the four read routes over test/fixtures/orbit ----------

const FIXTURES = path.join(HERE, 'fixtures', 'orbit');
const fixture = async (name) => JSON.parse(await fs.readFile(path.join(FIXTURES, name), 'utf8'));

/**
 * An http server answering like ORBIT-479's v1 routes, for TOKEN only. `fake.requests` lists what
 * came in; `fake.override(fn)` answers the next requests itself (fn(req, url) → { status, headers, body } or null).
 */
async function fakeOrbit() {
  const requests = [];
  let override = null;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push({ method: req.method, path: url.pathname, query: url.searchParams, auth: req.headers.authorization });
    const reply = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
    const o = override?.(req, url);
    if (o) return reply(o.status, o.body ?? {}, o.headers);
    if (req.method !== 'GET') return reply(405, { error: 'Method not allowed' });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { error: 'Unauthorized' }, { 'WWW-Authenticate': 'Bearer realm="orbit-feedback"' });
    const p = url.pathname;
    if (p === '/api/feedback/v1/tickets') {
      const page = Number(url.searchParams.get('page') ?? 1);
      if (url.searchParams.get('watched') === 'me') return reply(200, await fixture('tickets-watched.json'));
      if (url.searchParams.get('severity') === 'critical') {
        const all = await fixture('tickets-assigned-page-1.json');
        const rows = all.tickets.filter((t) => t.severity === 'critical');
        return reply(200, { ...all, total: rows.length, tickets: rows });
      }
      const body = await fixture(page === 1 ? 'tickets-assigned-page-1.json' : 'tickets-assigned-page-2.json');
      if (page > 2) body.tickets = [];
      if (url.searchParams.get('from')) {
        const from = url.searchParams.get('from');
        body.tickets = body.tickets.filter((t) => t.activityAt.slice(0, 10) >= from);
        body.total = body.tickets.length;
      }
      return reply(200, body);
    }
    if (p === '/api/feedback/v1/tickets/ORBIT-479') return reply(200, await fixture('ticket-ORBIT-479.json'));
    if (p === '/api/feedback/v1/tickets/ORBIT-479/references') return reply(200, await fixture('references-ORBIT-479.json'));
    if (p === '/api/feedback/v1/views') return reply(200, await fixture('views.json'));
    if (/^\/api\/feedback\/v1\/tickets\/[^/]+$/.test(p)) return reply(404, { error: 'Not found' });
    return reply(404, { error: 'Not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, requests,
    override(fn) { override = fn; },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

let fake;
before(async () => { fake = await fakeOrbit(); });
after(async () => { await fake?.close(); });
const client = (extra = {}) => orbitClient({ baseUrl: fake.url, getToken: async () => TOKEN, ...extra });

// ---------- Step 2: the client ----------

test('listTickets pages through 50 at a time until the total, with the token as a Bearer header', async () => {
  fake.requests.length = 0;
  const r = await client().listTickets('assignee=me&status=open,in_progress');
  assert.equal(r.tickets.length, 53);
  assert.equal(r.total, 53);
  assert.equal(r.audience, 'tech');
  assert.equal(r.truncated, false);
  assert.deepEqual(fake.requests.map((q) => q.query.get('page')), ['1', '2']);
  for (const q of fake.requests) {
    assert.equal(q.method, 'GET');
    assert.equal(q.path, '/api/feedback/v1/tickets');
    assert.equal(q.auth, `Bearer ${TOKEN}`);
    assert.equal(q.query.get('assignee'), 'me');
    assert.equal(q.query.get('status'), 'open,in_progress');
  }
});

test('with since: datefield=updated&from=<the day before>, then only tickets changed since that minute', async () => {
  fake.requests.length = 0;
  const since = '2026-10-25T10:30:45.000Z';
  const r = await client().listTickets('assignee=me', { since });
  assert.equal(fake.requests[0].query.get('datefield'), 'updated');
  assert.equal(fake.requests[0].query.get('from'), '2026-10-24');
  assert.equal(fromDay(since), '2026-10-24');
  assert.ok(r.tickets.length > 0);
  for (const t of r.tickets) assert.ok(t.activityAt >= '2026-10-25T10:30:00.000Z', t.activityAt);
  const all = await client().listTickets('assignee=me');
  const expected = all.tickets.filter((t) => t.activityAt >= '2026-10-25T10:30:00.000Z').length;
  assert.equal(r.tickets.length, expected, 'filtered to the minute, not the day');
});

test('detail, references and views', async () => {
  const c = client();
  const d = await c.getTicket('orbit-479');
  assert.equal(d.audience, 'tech');
  assert.equal(d.ticket.ticket.number, 479);
  assert.ok(d.ticket.timeline.length >= 2);
  assert.equal((await c.listReferences('#479')).references[0].kind, 'branch');
  assert.equal((await c.listViews()).views.length, 2);
  await assert.rejects(c.getTicket('ORBIT-1'), (e) => e.kind === 'not-found' && /no ticket by that key/.test(e.message));
  await assert.rejects(c.getTicket('../views'), (e) => e.kind === 'not-found' && /isn’t a ticket key/.test(e.message));
});

test('a 401 says the token expired or was revoked', async () => {
  const c = orbitClient({ baseUrl: fake.url, getToken: async () => `orbfb_${'z'.repeat(43)}` });
  await assert.rejects(c.listTickets(''), (e) => e instanceof OrbitError && e.kind === 'auth' && e.status === 401 && /expired or was revoked/.test(e.message));
  await assert.rejects(orbitClient({ baseUrl: fake.url, getToken: async () => null }).listViews(), (e) => e.kind === 'token');
  await assert.rejects(orbitClient({ baseUrl: '', getToken: async () => TOKEN }).listViews(), (e) => e.kind === 'settings');
});

test('a 429 is honoured: nothing reaches Orbit until Retry-After has passed', async () => {
  let t = Date.parse('2026-10-28T09:00:00Z');
  const c = client({ now: () => t });
  fake.override(() => ({ status: 429, body: { error: 'Too many requests' }, headers: { 'Retry-After': '30' } }));
  fake.requests.length = 0;
  await assert.rejects(c.listViews(), (e) => e.kind === 'rate' && e.retryAfterMs === 30_000);
  fake.override(null);
  t += 10_000;
  await assert.rejects(c.listViews(), (e) => e.kind === 'rate' && e.retryAfterMs === 20_000);
  assert.equal(fake.requests.length, 1, 'the second call never reached Orbit');
  assert.equal(c.waiting(), 20_000);
  t += 20_000;
  assert.equal((await c.listViews()).views.length, 2);
  assert.equal(retryAfterMs('120'), 120_000);
  assert.equal(retryAfterMs('99999'), 15 * 60_000, 'never more than 15 minutes');
  assert.equal(retryAfterMs(new Date(Date.parse('2026-10-28T09:01:00Z')).toUTCString(), Date.parse('2026-10-28T09:00:00Z')), 60_000);
  assert.equal(retryAfterMs(null), null);
});

test('Orbit out of reach, or answering 500, is a plain error', async () => {
  fake.override(() => ({ status: 500, body: {} }));
  await assert.rejects(client().listViews(), (e) => e.kind === 'http' && /answered 500/.test(e.message));
  fake.override(null);
  await assert.rejects(orbitClient({ baseUrl: 'http://127.0.0.1:1', getToken: async () => TOKEN }).listViews(), (e) => e.kind === 'network' && /Could not reach Orbit/.test(e.message));
});
