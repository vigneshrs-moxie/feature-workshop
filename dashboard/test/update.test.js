// `ground-control update` (packet I step 4, lib/update.js): newer, the same, a bad checksum, and no
// network. GitHub is never called: an injected `gh` answers from a local fake release (a folder
// with a package file and its SHA256SUMS), and `npm` only records what it was asked to install.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../../bin/ground-control.js';
import { CHECKSUM_MISMATCH, RELEASE_REPO, checkForUpdate, compareVersions, sumFor, update } from '../lib/update.js';

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** A fake release folder: the package file and SHA256SUMS (with the right sum, or a wrong one). */
function fakeRelease({ version = '1.6.0', badSum = false, noSums = false } = {}) {
  const dir = tmp('gc-release-');
  const name = `moxie-ground-control-${version}.tgz`;
  const bytes = Buffer.from(`pretend package ${version}\n`);
  fs.writeFileSync(path.join(dir, name), bytes);
  if (!noSums) fs.writeFileSync(path.join(dir, 'SHA256SUMS'), `${badSum ? sha(Buffer.from('something else')) : sha(bytes)}  ${name}\n${sha(Buffer.from('x'))}  install.sh\n`);
  return { dir, name, tag: `v${version}`, sum: sha(bytes) };
}

/** gh and npm, pretend: gh answers from the release folder; npm records the file it was given. */
function fakeTools(release, { offline = false } = {}) {
  const calls = [];
  const installed = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    if (file === 'gh' && offline) return { code: 1, stdout: '', stderr: 'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com' };
    if (file === 'gh' && args[0] === 'release' && args[1] === 'view') {
      const assets = fs.readdirSync(release.dir).map((n) => ({ name: n }));
      return { code: 0, stdout: JSON.stringify({ tagName: release.tag, assets }), stderr: '' };
    }
    if (file === 'gh' && args[0] === 'release' && args[1] === 'download') {
      assert.equal(args[2], release.tag);
      const dest = args[args.indexOf('--dir') + 1];
      const patterns = args.filter((a, i) => args[i - 1] === '--pattern');
      for (const p of patterns) if (fs.existsSync(path.join(release.dir, p))) fs.copyFileSync(path.join(release.dir, p), path.join(dest, p));
      return { code: 0, stdout: '', stderr: '' };
    }
    if (file === 'npm' || /cmd/i.test(file)) {
      const target = file === 'npm' ? args[2] : /npm i -g "([^"]+)"/.exec(args.at(-1))?.[1];
      installed.push({ file: target, sha: sha(fs.readFileSync(target)) });
      return { code: 0, stdout: 'added 1 package', stderr: '' };
    }
    return { code: null, missing: true, stdout: '', stderr: '' };
  };
  return { run, calls, installed };
}

const opts = (tools, extra = {}) => ({ run: tools.run, env: {}, platform: 'darwin', current: '1.5.0', checkout: false, tmpRoot: tmp('gc-dl-'), ...extra });

test('versions compare as numbers, and a pre-release comes before its release', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('v1.5.0', '1.5.0'), 0);
  assert.equal(compareVersions('1.5.0-beta.1', '1.5.0'), -1);
  assert.equal(compareVersions('1.4.9', '1.5.0'), -1);
  assert.equal(sumFor(`${'a'.repeat(64)}  dist/moxie-ground-control-1.6.0.tgz\n`, 'moxie-ground-control-1.6.0.tgz'), 'a'.repeat(64));
  assert.equal(sumFor(`${'b'.repeat(64)} *x.tgz\r\n`, 'x.tgz'), 'b'.repeat(64), 'binary-mode lines and Windows line ends');
  assert.equal(sumFor('nonsense', 'x.tgz'), null);
});

test('a newer release: downloaded, its checksum checked, installed with npm i -g', async () => {
  const release = fakeRelease({ version: '1.6.0' });
  const tools = fakeTools(release);
  const o = opts(tools);
  const r = await update(o);
  assert.equal(r.status, 'updated');
  assert.equal(r.latest, '1.6.0');
  assert.equal(r.message, 'Updated Dashboard from 1.5.0 to 1.6.0 (checksum checked).');
  assert.equal(tools.installed.length, 1);
  assert.equal(tools.installed[0].sha, release.sum, 'npm got exactly the file whose checksum was checked');
  assert.deepEqual(tools.calls[0], ['gh', 'release', 'view', '--repo', RELEASE_REPO, '--json', 'tagName,assets']);
  assert.ok(tools.calls.some((c) => c.join(' ').includes(`release download v1.6.0 --repo ${RELEASE_REPO} --pattern moxie-ground-control-1.6.0.tgz --pattern SHA256SUMS`)));
  assert.deepEqual(fs.readdirSync(o.tmpRoot), [], 'the download folder is cleaned up');
});

test('on Windows npm runs through cmd.exe (npm is npm.cmd there)', async () => {
  const release = fakeRelease({ version: '1.6.0' });
  const tools = fakeTools(release);
  const r = await update(opts(tools, { platform: 'win32', env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' } }));
  assert.equal(r.status, 'updated');
  const npm = tools.calls.find((c) => c[0].endsWith('cmd.exe'));
  assert.deepEqual(npm.slice(1, 4), ['/d', '/s', '/c']);
  assert.match(npm[4], /^""?npm i -g "/);
});

test('the same version (or an older one): nothing is downloaded', async () => {
  for (const version of ['1.5.0', '1.4.2']) {
    const tools = fakeTools(fakeRelease({ version }));
    const r = await update(opts(tools));
    assert.equal(r.status, 'same');
    assert.equal(r.message, 'Dashboard 1.5.0 is the newest version.');
    assert.equal(tools.calls.length, 1, 'only the question, no download');
    assert.equal(tools.installed.length, 0);
  }
});

test('a download that doesn’t match its checksum stops the update and changes nothing', async () => {
  const tools = fakeTools(fakeRelease({ version: '1.6.0', badSum: true }));
  const o = opts(tools);
  const r = await update(o);
  assert.equal(r.status, 'mismatch');
  assert.equal(r.message, CHECKSUM_MISMATCH);
  assert.equal(r.message, 'The download didn’t match its checksum. Nothing was changed.');
  assert.equal(tools.installed.length, 0, 'npm was never asked');
  assert.deepEqual(fs.readdirSync(o.tmpRoot), [], 'the bad download is deleted');
});

test('a release without SHA256SUMS is never installed', async () => {
  const tools = fakeTools(fakeRelease({ version: '1.6.0', noSums: true }));
  const r = await update(opts(tools));
  assert.equal(r.status, 'unavailable');
  assert.match(r.message, /SHA256SUMS/);
  assert.equal(tools.installed.length, 0);
});

test('no network: the check says so in plain words, and start goes on anyway', async () => {
  const tools = fakeTools(fakeRelease(), { offline: true });
  const r = await checkForUpdate({ run: tools.run, env: {}, current: '1.5.0' });
  assert.equal(r.status, 'offline');
  assert.equal(r.message, 'GitHub can’t be reached right now (no network?), so updates weren’t checked.');

  // ground-control start --here with the network down: the check fails, the start doesn't.
  const out = [];
  let supervised = null;
  const code = await main(['start', '--here'], {
    env: { PORT: '4481' }, out: (l) => out.push(l), err: (l) => out.push(l), stateDir: tmp('gc-state-'),
    running: () => null,
    deps: {
      update: { update: (o) => update({ ...o, run: tools.run, current: '1.5.0', checkout: false }) },
      service: { superviseServer: async (o) => { supervised = o; return 0; } },
    },
  });
  assert.equal(code, 0);
  assert.equal(supervised.port, 4481);
  assert.ok(out.some((l) => l === 'Update check: GitHub can’t be reached right now (no network?), so updates weren’t checked. Starting anyway.'), out.join('\n'));
});

test('no gh at all, or a git checkout: no update, said plainly', async () => {
  const none = await checkForUpdate({ run: async () => ({ code: null, missing: true, stdout: '', stderr: '' }), env: {}, current: '1.5.0' });
  assert.equal(none.status, 'unavailable');
  assert.match(none.message, /GitHub CLI \(gh\) isn’t on this computer/);
  const dev = await update({ run: async () => assert.fail('nothing is asked'), checkout: true, root: '/src/ground-control', current: '1.5.0' });
  assert.equal(dev.status, 'checkout');
  assert.match(dev.message, /git pull/);
});

test('GROUND_CONTROL_RELEASE_REPO names another repository', async () => {
  const tools = fakeTools(fakeRelease({ version: '1.5.0' }));
  await checkForUpdate({ run: tools.run, env: { GROUND_CONTROL_RELEASE_REPO: 'moxie/ground-control' }, current: '1.5.0' });
  assert.equal(tools.calls[0][4], 'moxie/ground-control');
});
