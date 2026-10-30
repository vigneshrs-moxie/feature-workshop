// The laptop's half of the hosted site (runner/site-link.js, packet 2A): where the runner token is
// kept, site.json, and the site's address. The pairing itself and the link against a real site
// run in hosted/test/ (pairing.test.js, link.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keychainStore, tokenStore } from '../lib/orbit-token.js';
import { normalizeSiteUrl, readSiteFile, SITE_TOKEN_NAMES, siteTokenStore, thisLaptop, writeSiteFile } from '../runner/site-link.js';

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
  assert.match(calls[0].input, /-a runner -s "Ground Control site token" -w abc_DEF-123/);
  assert.ok(!calls[0].args.join(' ').includes('abc_DEF-123'), 'never on the command line');
  assert.deepEqual(calls[1].args, ['find-generic-password', '-a', 'runner', '-s', 'Ground Control site token', '-w']);
});

test('site.json: the address, the device id and who it is for; no token; readable by you only', () => {
  const dir = tmp();
  assert.equal(readSiteFile(dir), null);
  writeSiteFile(dir, { url: 'https://feature-workshop.example.test', deviceId: 'device-aaaa-1111', runnerId: 3 });
  assert.equal(readSiteFile(dir).runnerId, 3);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'site.json')).mode & 0o777, 0o600);
});

test('the site’s address: https, or http only for this computer', () => {
  assert.equal(normalizeSiteUrl('https://feature-workshop.example.test/some/path'), 'https://feature-workshop.example.test');
  assert.equal(normalizeSiteUrl('http://localhost:4507/'), 'http://localhost:4507');
  assert.throws(() => normalizeSiteUrl('http://feature-workshop.example.test'), /must start with https/);
  assert.throws(() => normalizeSiteUrl('not an address'), /isn’t a web address/);
  assert.throws(() => normalizeSiteUrl('https://user:pw@example.test'), /name or password/);
});

test('this laptop as the site lists it', () => {
  assert.deepEqual(thisLaptop({ platform: 'darwin', hostname: 'Studio-Mac.local' }), { name: 'Studio-Mac', os: 'macOS' });
  assert.deepEqual(thisLaptop({ platform: 'win32', hostname: 'DESK-1' }), { name: 'DESK-1', os: 'Windows' });
  assert.deepEqual(thisLaptop({ platform: 'linux', hostname: '' }), { name: 'This laptop', os: 'Linux' });
});
