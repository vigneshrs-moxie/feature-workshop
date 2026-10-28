// Portal Feedback (ORBIT-479) from Ground Control: the token and where it is kept, the read-only
// client against a fake Orbit (an http server on a free port serving test/fixtures/orbit), the
// inbox poller's cadence on a fake clock, the scrubber, and a grep that keeps every request to
// Orbit a GET. Nothing here touches ~/.claude, the Keychain, ~/.ground-control or a real Orbit.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkToken, normalizeOrbitUrl, mcpEntry, writeMcpEntry, removeMcpEntry, setToken, clearToken, sessionEnv,
  parseTicketKey, canonicalKey, OrbitError,
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

