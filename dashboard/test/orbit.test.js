// Portal Feedback (ORBIT-479) from Ground Control: the token and where it is kept, the read-only
// client against a fake Orbit (an http server on a free port serving test/fixtures/orbit), the
// inbox poller's cadence on a fake clock, the scrubber, and a grep that keeps every request to
// Orbit a GET. Nothing here touches ~/.claude, the Keychain, ~/.ground-control or a real Orbit.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  checkToken, normalizeOrbitUrl, mcpEntry, writeMcpEntry, removeMcpEntry, setToken, clearToken, sessionEnv,
  parseTicketKey, canonicalKey, OrbitError, orbitClient, retryAfterMs, fromDay,
  OrbitInbox, inboxItem, sortItems, OPEN_EVERY_MS, IDLE_EVERY_MS, FULL_EVERY_MS, scrub, scrubDeep, rememberSecret,
} from '../lib/orbit.js';
import { State } from '../lib/state.js';
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
const everyMethod = new Set(); // every method that reached the fake Orbit, in every test of this file
async function fakeOrbit() {
  const requests = [];
  let override = null;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    everyMethod.add(req.method);
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

// ---------- Step 3: the poller ----------

/** A fake clock and timer: timers run only when the test moves time on. */
function fakeTime(start = Date.parse('2026-10-28T09:00:00Z')) {
  let t = start;
  let timers = [];
  let id = 0;
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = { id: ++id, at: t + ms, ms, fn }; timers.push(h); return h; },
    clearTimer: (h) => { timers = timers.filter((x) => x !== h); },
    pending: () => timers.map((h) => h.ms),
    /** Moves time on by `ms`, running each timer that falls due (and waiting for what it starts). */
    async advance(ms, settle = async () => {}) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((h) => h.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((h) => h !== due);
        t = due.at;
        due.fn();
        await settle();
      }
      t = end;
    },
  };
}

function inboxWith(clock, extra = {}) {
  const c = orbitClient({ baseUrl: fake.url, getToken: async () => TOKEN, now: clock.now });
  const inbox = new OrbitInbox({ client: c, orbitUrl: () => 'https://orbit.example.com', now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, ...extra });
  const settle = async () => { while (inbox.busy) await inbox.busy; };
  return { inbox, settle };
}

test('the inbox polls at once, then every 15 minutes, and every 3 while a browser has it open', async () => {
  const clock = fakeTime();
  const { inbox, settle } = inboxWith(clock);
  fake.requests.length = 0;
  inbox.start();
  assert.deepEqual(clock.pending(), [0]);
  await clock.advance(0, settle);
  const first = inbox.view();
  assert.equal(first.error, null);
  assert.equal(first.items.length, 54, '53 assigned plus one watched that isn’t (ORBIT-479 is both)');
  assert.deepEqual(first.items.find((i) => i.key === 'ORBIT-479').why, ['assigned', 'watching']);
  assert.equal(first.checkedAt, '2026-10-28T09:00:00.000Z');
  assert.deepEqual(clock.pending(), [IDLE_EVERY_MS]);
  const afterFirst = fake.requests.length;

  await clock.advance(IDLE_EVERY_MS - 1, settle);
  assert.equal(fake.requests.length, afterFirst, 'nothing before 15 minutes');
  const unwatch = inbox.watch(); // 14m59s after the last poll: more than 3 minutes, so now
  await clock.advance(0, settle);
  assert.ok(fake.requests.length > afterFirst);
  assert.deepEqual(clock.pending(), [OPEN_EVERY_MS]);
  const second = fake.requests.length;
  await clock.advance(OPEN_EVERY_MS, settle);
  assert.ok(fake.requests.length > second, 'again 3 minutes later');
  const second2 = fake.requests.length;
  const unwatch2 = inbox.watch();
  unwatch();
  unwatch(); // twice is once
  assert.equal(inbox.watchers, 1);
  unwatch2();
  assert.equal(inbox.watchers, 0);
  await clock.advance(OPEN_EVERY_MS, settle);
  assert.equal(fake.requests.length, second2, 'nobody watching: back to 15 minutes');
  inbox.stop();
  assert.deepEqual(clock.pending(), []);
});

test('between full reads only changes are fetched (from=<day>), merged into the list; a full read every hour', async () => {
  const clock = fakeTime();
  const { inbox, settle } = inboxWith(clock);
  inbox.start();
  await clock.advance(0, settle);
  fake.requests.length = 0;
  await clock.advance(IDLE_EVERY_MS, settle);
  assert.ok(fake.requests.length >= 2);
  for (const q of fake.requests) assert.equal(q.query.get('from'), '2026-10-27', 'since the last poll, from the day before');
  assert.equal(inbox.view().items.length, 54, 'the list is kept, changes merged in');
  fake.requests.length = 0;
  await clock.advance(FULL_EVERY_MS - IDLE_EVERY_MS, settle);
  assert.ok(fake.requests.some((q) => q.query.get('from') === null), 'a full read after an hour');
  inbox.stop();
});

test('one request in flight at a time; the last list stays, with its time, when Orbit fails', async () => {
  const clock = fakeTime();
  const { inbox, settle } = inboxWith(clock);
  fake.requests.length = 0;
  const a = inbox.refresh();
  const b = inbox.refresh();
  assert.equal(a, b, 'the second caller shares the first poll');
  await a;
  assert.equal(fake.requests.length, 3, 'two pages assigned, one watched: once');
  const good = inbox.view();
  fake.override(() => ({ status: 401, body: { error: 'Unauthorized' } }));
  const changes = [];
  inbox.on('change', (v) => changes.push(v));
  await inbox.refresh();
  fake.override(null);
  const bad = inbox.view();
  assert.equal(bad.items.length, good.items.length, 'the last list is still there');
  assert.equal(bad.checkedAt, good.checkedAt, 'with the time it was read');
  assert.equal(bad.errorKind, 'auth');
  assert.match(bad.error, /expired or was revoked/);
  assert.equal(changes.length, 1);
  await settle();
  inbox.reset();
  assert.equal(inbox.view().items.length, 0);
  assert.equal(inbox.view().checkedAt, null);
});

test('after a 429 the next poll waits for Retry-After, not just the cadence', async () => {
  const clock = fakeTime();
  const { inbox, settle } = inboxWith(clock);
  fake.override(() => ({ status: 429, body: {}, headers: { 'Retry-After': String(20 * 60) } }));
  inbox.start();
  await clock.advance(0, settle);
  fake.override(null);
  assert.equal(inbox.view().errorKind, 'rate');
  assert.deepEqual(clock.pending(), [15 * 60_000], 'Retry-After (capped at 15 minutes) when longer than the cadence');
  inbox.watch();
  assert.deepEqual(clock.pending(), [15 * 60_000], 'a watcher does not make it ask sooner');
  inbox.stop();
});

test('saved views: read once a day; a view’s tickets fetched when its tab opens', async () => {
  const clock = fakeTime();
  const { inbox } = inboxWith(clock);
  fake.requests.length = 0;
  const views = await inbox.views();
  assert.deepEqual(views.map((v) => v.name), ['Critical, mine', 'Team triage']);
  await inbox.views();
  assert.equal(fake.requests.filter((q) => q.path.endsWith('/views')).length, 1);
  const list = await inbox.viewList(views[0].id);
  assert.ok(list.items.length > 0);
  for (const i of list.items) assert.equal(i.severity, 'critical');
  await assert.rejects(inbox.viewList('nope'), /saved view is gone/);
});

test('an inbox row: key, title, priority, severity, age, assignee; a participant row hides priority and severity', () => {
  const tech = inboxItem({ number: 12, subject: 'Hi', priority: 'high', severity: 'critical', createdAt: '2026-10-01T00:00:00Z', activityAt: '2026-10-02T00:00:00Z', assignedToId: 'x', status: 'open' }, { why: ['watching'], orbitUrl: 'https://o.example.com' });
  assert.equal(tech.key, 'ORBIT-12');
  assert.equal(tech.priority, 'high');
  assert.equal(tech.severity, 'critical');
  assert.equal(tech.changedAt, '2026-10-02T00:00:00Z');
  assert.deepEqual(tech.assignee, { name: 'Someone else', you: false });
  assert.equal(tech.url, 'https://o.example.com/admin/feedback/ORBIT-12');
  const mine = inboxItem({ number: 13, subject: 'x' }, { why: ['assigned'] });
  assert.deepEqual(mine.assignee, { name: 'You', you: true });
  const part = inboxItem({ number: 14, subject: 'p', updatedAt: '2026-10-03T00:00:00Z', assignee: { name: 'Sam' }, priority: 'high' }, { audience: 'participant', orbitUrl: 'https://o.example.com' });
  assert.equal(part.priority, null);
  assert.equal(part.severity, null);
  assert.deepEqual(part.assignee, { name: 'Sam', you: false });
  assert.equal(part.url, 'https://o.example.com/feedback/ORBIT-14');
  const order = sortItems([
    { key: 'a', severity: null, priority: 'high', changedAt: '1' },
    { key: 'b', severity: 'low', priority: 'low', changedAt: '1' },
    { key: 'c', severity: 'critical', priority: 'low', changedAt: '1' },
    { key: 'd', severity: 'critical', priority: 'high', changedAt: '0' },
    { key: 'e', severity: 'critical', priority: 'high', changedAt: '2' },
  ]).map((i) => i.key);
  assert.deepEqual(order, ['e', 'd', 'c', 'b', 'a']);
});

// ---------- Step 4: scrub ----------

test('scrub hides Orbit, GitHub and Anthropic tokens and .env secrets, and keeps the rest', () => {
  const gh = `ghp_${'a1'.repeat(18)}`;
  const pat = `github_pat_${'B2'.repeat(15)}`;
  const ant = `sk-ant-api03-${'x'.repeat(40)}`;
  const out = scrub(`token ${TOKEN}, ${gh} ${pat} and ${ant}.`);
  assert.equal(out, 'token [Orbit token hidden], [GitHub token hidden] [GitHub token hidden] and [Anthropic key hidden].');
  assert.equal(scrub('DATABASE_URL=postgres://u:p@h/db STRIPE_SECRET_KEY="sk_live_1" PORT=3000 MY_TOKEN=\'abc\''), 'DATABASE_URL=[hidden] STRIPE_SECRET_KEY=[hidden] PORT=3000 MY_TOKEN=[hidden]');
  assert.equal(scrub(`ORBIT_FEEDBACK_TOKEN=${TOKEN}`), 'ORBIT_FEEDBACK_TOKEN=[Orbit token hidden]');
  assert.equal(scrub('It should start with orbfb_. A monkey=banana.'), 'It should start with orbfb_. A monkey=banana.', 'words are left alone');
  assert.equal(scrub('the value is s3cr3t-value-here', { secrets: ['s3cr3t-value-here'] }), 'the value is [hidden]');
  assert.equal(scrub(''), '');
  assert.equal(scrub(null), null);
});

test('scrub keeps a JSON line valid, and a token saved this run is hidden even out of shape', () => {
  const line = JSON.stringify({ text: `paste API_KEY="abc def" then ${TOKEN}`, n: 1, nested: { list: [`Bearer ${TOKEN}`] } });
  const clean = scrub(line);
  assert.ok(!clean.includes('orbfb_'));
  assert.ok(!clean.includes('abc def'));
  assert.deepEqual(JSON.parse(clean).nested.list, ['Bearer [Orbit token hidden]']);
  rememberSecret('weird-but-saved-secret-1234');
  assert.equal(scrub('x weird-but-saved-secret-1234 y'), 'x [hidden] y');
  const deep = scrubDeep({ a: [TOKEN, 3, null], b: { c: `ghp_${'z'.repeat(36)}` }, d: true });
  assert.deepEqual(deep, { a: ['[Orbit token hidden]', 3, null], b: { c: '[GitHub token hidden]' }, d: true });
});

test('every audit line passes through scrub: a token in an entry never reaches audit.jsonl', async () => {
  const dir = await tmp();
  const state = new State(dir);
  const seen = [];
  state.on('audit', (e) => seen.push(e));
  await state.audit({ action: 'send', text: `here is my token ${TOKEN} and GITHUB_TOKEN=ghp_${'q'.repeat(36)}` });
  const text = await fs.readFile(path.join(dir, 'audit.jsonl'), 'utf8');
  assert.ok(!text.includes('orbfb_'));
  assert.ok(!text.includes('ghp_'));
  assert.equal(JSON.parse(text.trim()).action, 'send');
  assert.ok(!JSON.stringify(seen).includes('orbfb_'), 'the live copy is the scrubbed one too');
  assert.equal((await state.auditAll()).length, 1);
});

// ---------- Step 5: the routes, on a running (demo) dashboard ----------
// Temp folders for everything: HOME (so ~/.claude/settings.json is a temp file), the jobs, the
// state folder (the token goes to its 600 file: demo mode never uses the Keychain).

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}

test('the /api/orbit routes: save a token, the inbox with jobs already on a ticket, detail, views, the stream, forget it; the token in no record', async (t) => {
  const root = await tmp();
  const dirs = { features: path.join(root, 'feature-work'), projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), home: path.join(root, 'home'), state: path.join(root, 'state') };
  for (const d of Object.values(dirs)) await fs.mkdir(d, { recursive: true });
  const job = async (slug, extra = {}) => {
    await fs.mkdir(path.join(dirs.features, slug, 'briefs'), { recursive: true });
    await fs.writeFile(path.join(dirs.features, slug, 'status.json'), JSON.stringify({ schema_version: 1, slug, title: slug, route: 'small', stage: 'plan', stage_state: 'working', updated_at: '2026-10-27T10:00:00Z', ...extra }));
  };
  await job('orbit-479-feedback-api');
  await job('tidy-tracker', { ticket: { key: 'orbit-501', title: 'x' } });
  await job('orbit-4790-other'); // ORBIT-4790, not ORBIT-479

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const output = [];
  const child = spawn(process.execPath, [path.join(HERE, '..', 'server.js')], {
    env: {
      ...process.env, PORT: String(port), WIREFRAMES_PORT: String(await freePort()), HOME: dirs.home, WORKSHOP_DEMO: '1',
      WORKSHOP_FEATURES_DIR: dirs.features, WORKSHOP_PROJECTS_DIR: dirs.projects, WORKSHOP_AGENTS_DIR: dirs.agents,
      WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: dirs.state, GROUND_CONTROL_ORBIT_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) { const gone = new Promise((r) => child.once('exit', r)); child.kill('SIGTERM'); await gone; }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The dashboard didn't start:\n${output.join('')}`)), 15000);
    child.stdout.on('data', (d) => { output.push(String(d)); if (output.join('').includes('Feature Workshop running')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', (d) => output.push(String(d)));
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`The dashboard exited (${code}):\n${output.join('')}`)); });
  });
  const pageToken = (await (await fetch(`${base}/api/meta`)).json()).token;
  const bodies = [];
  const get = async (p) => { const res = await fetch(base + p); const text = await res.text(); bodies.push(text); return { status: res.status, body: JSON.parse(text) }; };
  const write = async (method, p, body = {}, { auth = true } = {}) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Workshop-Token': pageToken } : {}) }, body: JSON.stringify(body) });
    const text = await res.text();
    bodies.push(text);
    return { status: res.status, body: JSON.parse(text) };
  };

  // Nothing saved yet.
  let r = await get('/api/orbit/status');
  assert.equal(r.status, 200);
  assert.equal(r.body.tokenPresent, false);
  assert.deepEqual((await get('/api/orbit/inbox')).body.items, []);

  // Writes need the page's token; a bad token is refused in words.
  assert.equal((await write('POST', '/api/orbit/token', { token: TOKEN, url: fake.url }, { auth: false })).status, 403);
  r = await write('POST', '/api/orbit/token', { token: 'orbfb_nope', url: fake.url });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /wrong length/);
  r = await write('POST', '/api/orbit/token', { token: TOKEN, url: 'http://orbit.example.com' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /https/);

  // A well-formed token Orbit doesn't know: saved, and the status says it expired or was revoked.
  r = await write('POST', '/api/orbit/token', { token: `orbfb_${'n'.repeat(43)}`, url: fake.url });
  assert.equal(r.status, 200);
  assert.equal(r.body.errorKind, 'auth');
  assert.match(r.body.lastError, /expired or was revoked/);

  // The real one.
  fake.requests.length = 0;
  r = await write('POST', '/api/orbit/token', { token: TOKEN, url: `${fake.url}/`, expiresInDays: 30 });
  assert.equal(r.status, 200);
  assert.equal(r.body.tokenPresent, true);
  assert.equal(r.body.store, 'file');
  assert.equal(r.body.url, fake.url);
  assert.equal(r.body.lastError, null);
  assert.ok(r.body.lastPoll);
  assert.ok(Math.abs(Date.parse(r.body.expiresAt) - (Date.now() + 30 * 86_400_000)) < 60_000);
  assert.ok(fake.requests.length >= 3 && fake.requests.every((q) => q.method === 'GET'));

  const mcp = JSON.parse(await fs.readFile(path.join(dirs.home, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers['orbit-feedback'], { type: 'http', url: `${fake.url}/api/mcp/feedback`, headers: { Authorization: 'Bearer ${ORBIT_FEEDBACK_TOKEN}' } });
  assert.equal((await fs.stat(path.join(dirs.state, 'orbit-token'))).mode & 0o777, 0o600);

  // The inbox: priority, severity, age, assignee, and the jobs already on a ticket.
  r = await get('/api/orbit/inbox');
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 54);
  const item = (key) => r.body.items.find((i) => i.key === key);
  assert.equal(item('ORBIT-479').title, 'Read-only feedback API and MCP for Ground Control');
  assert.deepEqual(item('ORBIT-479').job, { slug: 'orbit-479-feedback-api', title: 'orbit-479-feedback-api' });
  assert.equal(item('ORBIT-501').job.slug, 'tidy-tracker', 'status.json ticket.key counts');
  assert.equal(item('ORBIT-502').job, null);
  assert.equal(item('ORBIT-700').assignee.name, 'Someone else');
  assert.equal(item('ORBIT-501').assignee.name, 'You');
  for (const i of r.body.items) { assert.ok(i.createdAt); assert.ok('priority' in i && 'severity' in i); }

  // Refresh, a saved view's tab, the views.
  assert.equal((await get('/api/orbit/inbox?refresh=1')).body.items.length, 54);
  const views = (await get('/api/orbit/views')).body.views;
  assert.deepEqual(views.map((v) => v.name), ['Critical, mine', 'Team triage']);
  const crit = (await get(`/api/orbit/inbox?view=${views[0].id}`)).body;
  assert.ok(crit.items.length > 0 && crit.items.every((i) => i.severity === 'critical'));
  assert.equal((await get('/api/orbit/inbox?view=nope')).status, 404);

  // Detail and references; a pasted token in a comment comes out hidden.
  r = await get('/api/orbit/tickets/orbit-479');
  assert.equal(r.status, 200);
  assert.equal(r.body.item.key, 'ORBIT-479');
  assert.equal(r.body.item.job.slug, 'orbit-479-feedback-api');
  assert.equal(r.body.ticket.timeline.length, 2);
  assert.match(r.body.ticket.timeline[1].comment.body, /\[Orbit token hidden\]/);
  assert.equal((await get('/api/orbit/tickets/ORBIT-479/references')).body.references[0].label, 'feature/orbit-479-feedback-api-mcp');
  r = await get('/api/orbit/tickets/ORBIT-1');
  assert.equal(r.status, 404);
  assert.match(r.body.error, /no ticket by that key/);
  assert.equal((await get('/api/orbit/tickets/not-a-key')).status, 404);

  // An open Inbox (the stream) makes the cadence 3 minutes; closing it, 15 again.
  const ctrl = new AbortController();
  const stream = await fetch(`${base}/api/orbit/events`, { signal: ctrl.signal });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  await reader.read();
  r = await get('/api/orbit/status');
  assert.equal(r.body.watchers, 1);
  assert.equal(r.body.everyMs, 3 * 60_000);
  ctrl.abort();
  for (let i = 0; i < 50 && (await get('/api/orbit/status')).body.watchers !== 0; i++) await new Promise((res) => setTimeout(res, 50));
  r = await get('/api/orbit/status');
  assert.equal(r.body.watchers, 0);
  assert.equal(r.body.everyMs, 15 * 60_000);

  // The token is in its one file and nowhere else: no answer, no record, no audit line, no settings.
  for (const b of bodies) assert.ok(!b.includes(TOKEN) && !b.includes('orbfb_n'), 'never in an answer');
  for (const file of [...await walk(dirs.state), ...await walk(dirs.home), ...await walk(dirs.features)]) {
    if (file === path.join(dirs.state, 'orbit-token')) continue;
    assert.ok(!(await fs.readFile(file, 'utf8')).includes('orbfb_'), `no token in ${path.relative(root, file)}`);
  }
  const audit = (await fs.readFile(path.join(dirs.state, 'audit.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(audit.some((e) => e.action === 'orbit-token' && e.what === 'saved' && e.store === 'file'));

  // Forget it: out of the store and out of Claude Code's settings.
  r = await write('DELETE', '/api/orbit/token');
  assert.equal(r.status, 200);
  assert.equal(r.body.tokenPresent, false);
  await assert.rejects(fs.stat(path.join(dirs.state, 'orbit-token')));
  assert.equal(JSON.parse(await fs.readFile(path.join(dirs.home, '.claude', 'settings.json'), 'utf8')).mcpServers, undefined);
  assert.deepEqual((await get('/api/orbit/inbox')).body.items, []);
  assert.equal((await fetch(`${base}/api/orbit/token`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Workshop-Token': pageToken }, body: '{}' })).status, 405);
});

// ---------- Step 7: no write path to Orbit ----------

test('nothing in dashboard/lib (or server.js) can send Orbit anything but a GET', async () => {
  const LIB = path.join(HERE, '..', 'lib');
  const files = (await walk(LIB)).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 10);
  const texts = Object.fromEntries(await Promise.all(files.map(async (f) => [path.relative(LIB, f), await fs.readFile(f, 'utf8')])));
  // Only lib/orbit.js names Orbit's API at all; server.js only through it.
  const naming = Object.keys(texts).filter((f) => /\/api\/feedback|\/api\/mcp\/feedback/.test(texts[f]));
  assert.deepEqual(naming, ['orbit.js']);
  assert.ok(!/\/api\/feedback\/v1/.test(await fs.readFile(path.join(HERE, '..', 'server.js'), 'utf8')), 'server.js goes through lib/orbit.js');
  // Anywhere in lib: no fetch or request whose call names the feedback API with another method.
  for (const [file, text] of Object.entries(texts)) {
    for (const m of text.matchAll(/\b(?:fetch|fetchFn|request|got|axios)\s*\(([\s\S]{0,400}?)\)\s*;/g)) {
      if (!/feedback|API_BASE|\burl\b/.test(m[1]) || !/method\s*:/.test(m[1])) continue;
      assert.match(m[1], /method\s*:\s*'GET'/, `${file}: ${m[0].slice(0, 120)}`);
    }
  }
  const orbit = texts['orbit.js'];
  // In orbit.js: one call that reaches the network, and it is a GET; no other method is even written.
  const calls = [...orbit.matchAll(/\bfetchFn\s*\(/g)];
  assert.equal(calls.length, 1, 'one place reaches Orbit');
  const call = orbit.slice(calls[0].index, calls[0].index + 400);
  assert.match(call, /method: 'GET'/);
  assert.ok(!/\b(?:https?\.request|https?\.get|XMLHttpRequest|undici|node:net|node:http)\b/.test(orbit), 'no other way out');
  assert.ok(!/['"`](?:POST|PUT|PATCH|DELETE)['"`]/.test(orbit), 'no write method named in orbit.js');
  assert.ok(!/\bmethod\s*:(?!\s*'GET')/.test(orbit), 'every method: is GET');
  // And at run time: everything this file sent the fake Orbit was a GET.
  assert.deepEqual([...everyMethod], ['GET']);
});
