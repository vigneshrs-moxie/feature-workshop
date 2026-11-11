// The laptop's half of the hosted site (runner/site-link.js, packet 2A): where the runner token is
// kept, site.json, and the site's address. The pairing itself and the link against a real site
// run in hosted/test/ (pairing.test.js, link.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { keychainStore, tokenStore } from '../lib/orbit-token.js';
import { createSiteLink, normalizeSiteUrl, repoChoices, readSiteFile, SITE_TOKEN_NAMES, siteTokenStore, thisLaptop, writeSiteFile } from '../runner/site-link.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gc-site-link-'));

test('the runner token has its own names in the same stores as the Orbit token, and never mixes with it', async () => {
  const dir = tmp();
  const site = await siteTokenStore({ stateDir: dir, prefer: 'file' });
  const orbit = await tokenStore({ stateDir: dir, prefer: 'file' });
  await site.set('runner-token-for-a-test-only');
  await orbit.set('orbfb_test_only');
  assert.equal(fs.readFileSync(path.join(dir, 'site-token'), 'utf8'), 'runner-token-for-a-test-only');
  assert.equal(await orbit.get(), 'orbfb_test_only');
  await site.clear();
  assert.equal(await site.get(), null);
  assert.equal(await orbit.get(), 'orbfb_test_only');
  // The Keychain store under the site's names: its own service and account, the token on stdin.
  const calls = [];
  const kc = keychainStore({ run: async (args, input) => { calls.push({ args, input }); return { code: 0, out: '' }; }, names: SITE_TOKEN_NAMES });
  await kc.set('abc_DEF-123');
  await kc.get();
  assert.match(calls[0].input, /-a runner -s "Starbase site token" -w abc_DEF-123/);
  assert.ok(!calls[0].args.join(' ').includes('abc_DEF-123'), 'never on the command line');
  assert.deepEqual(calls[1].args, ['find-generic-password', '-a', 'runner', '-s', 'Starbase site token', '-w']);
});

test('site.json: the address, the device id and who it is for; no token; readable by you only', () => {
  const dir = tmp();
  assert.equal(readSiteFile(dir), null);
  writeSiteFile(dir, { url: 'https://starbase.example.test', deviceId: 'device-aaaa-1111', runnerId: 3 });
  assert.equal(readSiteFile(dir).runnerId, 3);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'site.json')).mode & 0o777, 0o600);
});

test('the site’s address: https, or http only for this computer', () => {
  assert.equal(normalizeSiteUrl('https://starbase.example.test/some/path'), 'https://starbase.example.test');
  assert.equal(normalizeSiteUrl('http://localhost:4507/'), 'http://localhost:4507');
  assert.throws(() => normalizeSiteUrl('http://starbase.example.test'), /must start with https/);
  assert.throws(() => normalizeSiteUrl('not an address'), /isn’t a web address/);
  assert.throws(() => normalizeSiteUrl('https://user:pw@example.test'), /name or password/);
});

test('this laptop as the site lists it', () => {
  assert.deepEqual(thisLaptop({ platform: 'darwin', hostname: 'Studio-Mac.local' }), { name: 'Studio-Mac', os: 'macOS' });
  assert.deepEqual(thisLaptop({ platform: 'win32', hostname: 'DESK-1' }), { name: 'DESK-1', os: 'Windows' });
  assert.deepEqual(thisLaptop({ platform: 'linux', hostname: '' }), { name: 'This laptop', os: 'Linux' });
});

test('the laptop sends its repository names, never paths', () => {
  const sent = repoChoices({
    defaultPath: '/Users/someone/Projects/orbit',
    repos: [
      { name: 'orbit', path: '/Users/someone/Projects/orbit', ok: true },
      { name: 'starbase', path: '/Users/someone/Projects/starbase', ok: true },
      { name: 'gone', path: '/Users/someone/Projects/gone', ok: false },
      { name: '/Users/someone/Projects/odd', path: '/Users/someone/Projects/odd', ok: true },
      { name: 'twin', path: '/a/twin', ok: true }, { name: 'twin', path: '/b/twin', ok: true },
    ],
  });
  assert.deepEqual(sent, [{ name: 'orbit', default: true }, { name: 'starbase', default: false }]);
  assert.ok(!JSON.stringify(sent).includes('/Users'), 'no path leaves the laptop');
  assert.deepEqual(repoChoices(null), []);
});

test('C-M12: a repository added later reaches the website: the laptop says hello again, then sends its whole record', async () => {
  const dir = tmp();
  writeSiteFile(dir, { url: 'https://starbase.example.test', deviceId: 'device-test-0012', runnerId: 1, name: 'Test Laptop' });
  const store = await siteTokenStore({ stateDir: dir, prefer: 'file' });
  await store.set('runner-token-for-a-test-only');
  const ee = new EventEmitter();
  const repo = (name) => ({ ok: true, name, path: `/code/${name}` });
  let repos = [repo('orbit')];
  const runner = {
    read: { features: async () => ({ features: [] }), snapshot: async () => ({ jobs: [] }), startRepos: async () => ({ repos, defaultPath: '/code/orbit' }) },
    on(type, fn) { ee.on(type, fn); return () => ee.off(type, fn); },
  };
  const posted = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    let body = {};
    if (u.pathname === '/api/runner/events') { posted.push(...JSON.parse(init.body).events); body = { refused: [] }; }
    if (u.pathname === '/api/runner/commands') { await new Promise((r) => setTimeout(r, 300)); body = { commands: [] }; }
    return { status: 200, json: async () => body };
  };
  const link = createSiteLink({ runner, stateDir: dir, store, fetch, waitSeconds: 1, debounceMs: 10, watchEveryMs: 0, log: () => {}, version: '0.1.0' }).start();
  const hellos = () => posted.filter((e) => e.type === 'hello');
  const synced = () => posted.filter((e) => e.type === 'record' && e.data.kind === 'synced');
  const until = async (check, what) => { for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 25)); assert.ok(check(), what); };
  try {
    await until(() => synced().length === 1, 'the first sync');
    assert.deepEqual(hellos().map((h) => h.data.repos.map((r) => r.name)), [['orbit']]);
    ee.emit('*', 'settings', null, {}); // something else in Settings changed: no hello
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(hellos().length, 1);
    repos = [repo('orbit'), repo('starbase')];
    ee.emit('*', 'settings', null, {}); // Settings → Repos added one
    await until(() => synced().length === 2, 'the record sent again after the second hello');
    assert.deepEqual(hellos().map((h) => h.data.repos.map((r) => r.name)), [['orbit'], ['orbit', 'starbase']]);
    assert.equal(hellos()[1].data.name, 'Test Laptop');
    assert.ok(posted.indexOf(hellos()[1]) < posted.indexOf(synced()[1]), 'hello first, then the record');
  } finally { link.stop(); }
});

test('the laptop sends its last suggestion as an inbox-suggest record, and null when switched off', async () => {
  const dir = tmp();
  writeSiteFile(dir, { url: 'https://starbase.example.test', deviceId: 'device-test-0001', runnerId: 1, name: 'Test Laptop' });
  const store = await siteTokenStore({ stateDir: dir, prefer: 'file' });
  await store.set('runner-token-for-a-test-only');
  const ee = new EventEmitter();
  let suggestion = { at: '2026-11-10T09:00:00.000Z', picks: [{ key: 'ORBIT-12', reason: 'Small and quick' }], forList: ['ORBIT-12@x'] };
  const runner = {
    read: { features: async () => ({ features: [] }), snapshot: async () => ({ jobs: [] }), inboxSuggest: () => suggestion },
    on(type, fn) { ee.on(type, fn); return () => ee.off(type, fn); },
  };
  const posted = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    let body = {};
    if (u.pathname === '/api/runner/events') { posted.push(...JSON.parse(init.body).events); body = { refused: [] }; }
    if (u.pathname === '/api/runner/commands') { await new Promise((r) => setTimeout(r, 300)); body = { commands: [] }; }
    return { status: 200, json: async () => body };
  };
  const link = createSiteLink({ runner, stateDir: dir, store, fetch, waitSeconds: 1, debounceMs: 10, watchEveryMs: 0, log: () => {}, version: '0.1.0' }).start();
  const records = () => posted.filter((e) => e.type === 'record' && e.data.kind === 'inbox-suggest');
  const until = async (check) => { for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 25)); assert.ok(check(), 'the record to be sent'); };
  try {
    await until(() => records().length === 1);
    assert.equal(records()[0].data.key, '');
    assert.deepEqual(records()[0].data.value, suggestion);
    suggestion = null; // switched off
    ee.emit('*', 'inbox-suggest', null, { at: 1 });
    await until(() => records().length === 2);
    assert.equal(records()[1].data.value, null);
  } finally { link.stop(); }
});

test('a job with Auto lines sends an auto-log record shaped { on, stopped, tag, summary, entries }; one without sends none', async () => {
  const dir = tmp();
  writeSiteFile(dir, { url: 'https://starbase.example.test', deviceId: 'device-test-0003', runnerId: 1, name: 'Test Laptop' });
  const store = await siteTokenStore({ stateDir: dir, prefer: 'file' });
  await store.set('runner-token-for-a-test-only');
  const ee = new EventEmitter();
  const log = { on: true, stopped: null, tag: 'auto-ok', summary: ['Auto made 1 decision on this job. The Approver cost $0.01.', 'Auto is on.', 'Last decision: 30 Oct 15:30, Plan: Go.'], entries: [{ at: '2026-10-30T15:30:00.000Z', stage: 'Plan', chose: 'Go', asked: 'Start?', why: 'Small.' }] };
  const card = (slug) => ({ slug, title: slug, stage: 'plan', group: 'working' });
  const runner = {
    read: {
      features: async () => ({ features: [card('with-auto'), card('without-auto')] }),
      snapshot: async () => ({ jobs: [card('with-auto'), card('without-auto')] }),
      job: async (slug) => card(slug),
      autoLog: async (slug) => (slug === 'with-auto' ? log : null),
    },
    on(type, fn) { ee.on(type, fn); return () => ee.off(type, fn); },
  };
  const posted = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    let body = {};
    if (u.pathname === '/api/runner/events') { posted.push(...JSON.parse(init.body).events); body = { refused: [] }; }
    if (u.pathname === '/api/runner/commands') { await new Promise((r) => setTimeout(r, 300)); body = { commands: [] }; }
    return { status: 200, json: async () => body };
  };
  const link = createSiteLink({ runner, stateDir: dir, store, fetch, waitSeconds: 1, debounceMs: 10, watchEveryMs: 0, log: () => {}, version: '0.1.0' }).start();
  const jobRecords = () => posted.filter((e) => e.type === 'record' && e.data.kind === 'job').length;
  const logs = () => posted.filter((e) => e.type === 'record' && e.data.kind === 'auto-log');
  try {
    for (let i = 0; i < 200 && jobRecords() < 2; i++) await new Promise((r) => setTimeout(r, 25));
    assert.equal(jobRecords(), 2);
    assert.equal(logs().length, 1);
    assert.equal(logs()[0].data.key, 'with-auto');
    assert.deepEqual(logs()[0].data.value, log);
  } finally { link.stop(); }
});
