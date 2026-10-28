// lib/credentials.js readSecret and plan-usage readClaudeToken on each system. Commands are built
// and handed to a fake runner; keytar and the file are fakes. No real Keychain, Credential Manager
// or home folder is touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { credentialManagerCommand, keychainCommand, readSecret } from '../lib/credentials.js';
import { readClaudeToken } from '../lib/plan-usage.js';

const noKeytar = async () => { throw new Error('Cannot find package keytar'); };
const noFile = async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
const recorder = (answer = () => ({ code: 1, out: '' })) => {
  const calls = [];
  return { calls, run: async (file, args) => { calls.push({ file, args }); return answer(file, args); } };
};

test('the commands: security on macOS; PowerShell Get-StoredCredential on Windows, only when it is there', () => {
  assert.deepEqual(keychainCommand({ service: 'Claude Code-credentials' }), { file: 'security', args: ['find-generic-password', '-s', 'Claude Code-credentials', '-w'] });
  assert.deepEqual(keychainCommand({ service: 'S', account: 'a' }).args, ['find-generic-password', '-s', 'S', '-a', 'a', '-w']);
  const win = credentialManagerCommand({ service: "Claude Code's credentials" });
  assert.equal(win.file, 'powershell.exe');
  assert.deepEqual(win.args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']);
  const script = win.args[5];
  assert.match(script, /if \(Get-Command Get-StoredCredential\)/, 'skipped when the module isn’t installed');
  assert.match(script, /-Target 'Claude Code''s credentials' -AsCredentialObject/, 'the name quoted for PowerShell');
  assert.match(credentialManagerCommand({ service: 'S', account: 'me' }).args[5], /\$_\.UserName -eq 'me'/);
});

test('readSecret: keytar first when it loads, then the system store, then the file', async () => {
  const keytar = { getPassword: async (s, a) => (s === 'S' && a === 'a' ? 'from keytar' : null), findPassword: async (s) => (s === 'S' ? 'any account' : null) };
  const none = recorder(() => assert.fail('keytar answered'));
  assert.equal(await readSecret({ service: 'S', account: 'a', platform: 'darwin', importKeytar: async () => ({ default: keytar }), run: none.run }), 'from keytar');
  assert.equal(await readSecret({ service: 'S', platform: 'linux', importKeytar: async () => keytar, run: none.run }), 'any account');

  const mac = recorder(() => ({ code: 0, out: 'from the Keychain\n' }));
  assert.equal(await readSecret({ service: 'S', file: '/f', platform: 'darwin', importKeytar: noKeytar, run: mac.run, readFile: () => assert.fail('not the file') }), 'from the Keychain');
  assert.equal(mac.calls[0].file, 'security');

  const win = recorder(() => ({ code: 0, out: 'from Credential Manager' }));
  assert.equal(await readSecret({ service: 'S', platform: 'win32', importKeytar: noKeytar, run: win.run }), 'from Credential Manager');
  assert.equal(win.calls[0].file, 'powershell.exe');

  const empty = recorder(() => ({ code: 0, out: '' })); // no Get-StoredCredential: prints nothing
  assert.equal(await readSecret({ service: 'S', file: 'C:\\f', platform: 'win32', importKeytar: noKeytar, run: empty.run, readFile: async (f) => `file ${f}` }), 'file C:\\f');

  const linux = recorder(() => assert.fail('no command on Linux'));
  assert.equal(await readSecret({ service: 'S', file: '/f', platform: 'linux', importKeytar: noKeytar, run: linux.run, readFile: async () => ' from the file \n' }), 'from the file');
  assert.equal(await readSecret({ service: 'S', file: '/f', platform: 'linux', importKeytar: noKeytar, readFile: noFile }), null);
  const broken = recorder(() => { throw new Error('spawn powershell.exe ENOENT'); });
  assert.equal(await readSecret({ service: 'S', platform: 'win32', importKeytar: noKeytar, run: broken.run }), null, 'no PowerShell: skipped');
});

test('readSecret: accept decides, so a store holding something else moves on to the next place', async () => {
  const run = async () => ({ code: 0, out: '{"other":1}' });
  const accept = (raw) => JSON.parse(raw).token ?? null;
  assert.equal(await readSecret({ service: 'S', file: '/f', accept, platform: 'darwin', importKeytar: noKeytar, run, readFile: async () => '{"token":"t"}' }), 't');
  assert.equal(await readSecret({ service: 'S', file: '/f', accept, platform: 'darwin', importKeytar: noKeytar, run, readFile: async () => 'not json' }), null);
});

test('readClaudeToken: the Keychain on macOS, the credentials file on Linux and Windows, CLAUDE_CONFIG_DIR respected', async () => {
  const body = JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-test' } });
  const asked = [];
  const read = async (o) => { asked.push(o); return o.accept(body); };
  assert.equal(await readClaudeToken({ home: '/Users/me', platform: 'darwin', env: {}, read }), 'sk-ant-oat-test');
  assert.deepEqual([asked[0].service, asked[0].file, asked[0].platform], ['Claude Code-credentials', path.join('/Users/me', '.claude', '.credentials.json'), 'darwin']);
  await readClaudeToken({ home: 'C:\\Users\\me', platform: 'win32', env: {}, read });
  assert.equal(asked[1].file, path.join('C:\\Users\\me', '.claude', '.credentials.json'));
  await readClaudeToken({ home: '/home/me', platform: 'linux', env: { CLAUDE_CONFIG_DIR: '/home/me/.claude-work' }, read });
  assert.equal(asked[2].file, path.join('/home/me/.claude-work', '.credentials.json'));
  assert.equal(asked[0].accept('{"claudeAiOauth":{}}'), null);
  assert.equal(asked[0].accept('nonsense'), null);
  // End to end through readSecret on Linux with nothing saved: null, so the meters say no sign-in was found.
  assert.equal(await readClaudeToken({ home: '/nowhere-gc-test', platform: 'linux', env: {} }), null);
});
