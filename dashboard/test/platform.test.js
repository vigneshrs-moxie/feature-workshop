// lib/platform.js: the one place for what differs between macOS, Windows and Linux. Every system is
// asked for by name, so the Windows and Linux branches run on any computer. Commands are only built
// (or handed to a fake runner), never run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  envGet, findOnPath, folderLabel, killTree, killTreeCommand, nodeCommand, openCommand, openIn,
  parsePsRows, parseTasklistRows, processList, processListCommand, shellFor, tempDirs, terminalApps,
} from '../lib/platform.js';

const onPath = (...files) => (p) => files.includes(p);

test('shellFor: $SHELL -c in its own group on macOS and Linux, cmd.exe /d /s /c on Windows', () => {
  assert.deepEqual(shellFor('npm run dev', { platform: 'darwin', env: { SHELL: '/bin/bash' } }), { file: '/bin/bash', args: ['-c', 'npm run dev'], options: { detached: true } });
  assert.equal(shellFor('x', { platform: 'darwin', env: {} }).file, '/bin/zsh');
  assert.equal(shellFor('x', { platform: 'linux', env: {} }).file, '/bin/sh');
  const win = shellFor('npm run dev -- -p 3001', { platform: 'win32', env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' } });
  assert.deepEqual(win, { file: 'C:\\Windows\\system32\\cmd.exe', args: ['/d', '/s', '/c', '"npm run dev -- -p 3001"'], options: { windowsVerbatimArguments: true, windowsHide: true } });
  assert.equal(win.options.detached, undefined, 'no process groups on Windows');
  assert.equal(shellFor('x', { platform: 'win32', env: {} }).file, 'cmd.exe');
  assert.equal(shellFor('x', { platform: 'win32', env: { COMSPEC: 'D:\\cmd.exe' } }).file, 'D:\\cmd.exe', 'Windows variables in any case');
});

test('killTree: the process group on macOS and Linux (then the process alone), taskkill /T /F on Windows', () => {
  for (const platform of ['darwin', 'linux']) {
    const calls = [];
    assert.equal(killTree(42, { platform, signal: 'SIGKILL', kill: (pid, sig) => calls.push([pid, sig]), run: () => assert.fail('no command') }), 'group');
    assert.deepEqual(calls, [[-42, 'SIGKILL']]);
    const alone = [];
    assert.equal(killTree(43, { platform, kill: (pid, sig) => { alone.push([pid, sig]); if (pid < 0) throw new Error('ESRCH'); } }), 'process');
    assert.deepEqual(alone, [[-43, 'SIGTERM'], [43, 'SIGTERM']]);
    assert.equal(killTree(44, { platform, kill: () => { throw new Error('gone'); } }), null);
    assert.equal(killTreeCommand(42, { platform }), null);
  }
  const ran = [];
  assert.equal(killTree(42, { platform: 'win32', kill: () => assert.fail('no signals on Windows'), run: (f, a) => ran.push([f, a]) }), 'taskkill');
  assert.deepEqual(ran, [['taskkill', ['/pid', '42', '/T', '/F']]]);
  assert.equal(killTree(0, { platform: 'win32', run: () => assert.fail() }), null);
});

test('findOnPath: PATH with : on macOS and Linux; ; and PATHEXT on Windows, in any case', () => {
  assert.equal(findOnPath('psql', { platform: 'linux', env: { PATH: '/usr/bin:/usr/lib/postgresql/16/bin' }, exists: onPath('/usr/lib/postgresql/16/bin/psql') }), '/usr/lib/postgresql/16/bin/psql');
  assert.equal(findOnPath('psql', { platform: 'darwin', env: { PATH: '/usr/bin' }, exists: () => false }), null);
  const env = { Path: 'C:\\Windows\\system32;"C:\\Program Files\\Microsoft VS Code\\bin"', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  assert.equal(findOnPath('code', { platform: 'win32', env, exists: onPath('C:\\Program Files\\Microsoft VS Code\\bin\\code.CMD') }), 'C:\\Program Files\\Microsoft VS Code\\bin\\code.CMD');
  assert.equal(findOnPath('wt.exe', { platform: 'win32', env, exists: onPath('C:\\Windows\\system32\\wt.exe') }), 'C:\\Windows\\system32\\wt.exe', 'a name with its extension is tried as it is');
  assert.equal(findOnPath('code', { platform: 'win32', env: { PATH: 'C:\\bin' }, exists: onPath('C:\\bin\\code.CMD') }), 'C:\\bin\\code.CMD', 'the usual PATHEXT without one');
  assert.equal(findOnPath('code', { platform: 'win32', env, exists: onPath('C:\\Windows\\system32\\code') }), null, 'no bare name without an extension on Windows');
  assert.equal(envGet({ Path: 'x' }, 'PATH', 'linux'), undefined, 'only Windows ignores case');
});

test('terminalApps and the folder button: Mac names on macOS only', () => {
  assert.deepEqual(terminalApps({ platform: 'darwin' }), ['iTerm', 'Terminal']);
  assert.deepEqual(terminalApps({ platform: 'win32' }), ['Windows Terminal', 'Command Prompt']);
  assert.deepEqual(terminalApps({ platform: 'linux' }), ['Terminal']);
  assert.equal(folderLabel({ platform: 'darwin' }), 'Finder');
  assert.equal(folderLabel({ platform: 'win32' }), 'Open folder');
  assert.equal(folderLabel({ platform: 'linux' }), 'Open folder');
});

test('openCommand on macOS: open -a as before, waited for', () => {
  const dir = '/Users/me/wt/alpha';
  assert.deepEqual(openCommand('terminal', dir, { platform: 'darwin', terminalApp: 'iTerm' }), { file: 'open', args: ['-a', 'iTerm', dir], options: {}, wait: true });
  assert.deepEqual(openCommand('terminal', dir, { platform: 'darwin', terminalApp: 'Terminal' }).args, ['-a', 'Terminal', dir]);
  assert.deepEqual(openCommand('terminal', dir, { platform: 'darwin', terminalApp: 'Windows Terminal' }).args, ['-a', 'iTerm', dir], 'an app this system lacks: the default');
  assert.deepEqual(openCommand('editor', dir, { platform: 'darwin' }).args, ['-a', 'Visual Studio Code', dir]);
  assert.deepEqual(openCommand('folder', dir, { platform: 'darwin' }).args, [dir]);
});

test('openCommand on Windows: Windows Terminal (else a Command Prompt), code through cmd.exe, explorer.exe', () => {
  const dir = 'C:\\Users\\me\\wt\\alpha';
  const env = { PATH: 'C:\\Windows\\system32;C:\\code\\bin', PATHEXT: '.EXE;.CMD', ComSpec: 'C:\\Windows\\system32\\cmd.exe' };
  const all = onPath('C:\\Windows\\system32\\wt.exe', 'C:\\code\\bin\\code.CMD');
  const wt = openCommand('terminal', dir, { platform: 'win32', env, exists: all, terminalApp: 'Windows Terminal' });
  assert.deepEqual([wt.file, wt.args, wt.wait, wt.options.detached], ['wt.exe', ['-d', dir], false, true]);
  const noWt = openCommand('terminal', dir, { platform: 'win32', env, exists: () => false, terminalApp: 'Windows Terminal' });
  assert.deepEqual([noWt.file, noWt.args, noWt.options.cwd, noWt.options.detached], ['C:\\Windows\\system32\\cmd.exe', ['/k'], dir, true], 'no wt.exe: a Command Prompt window');
  assert.equal(openCommand('terminal', dir, { platform: 'win32', env, exists: all, terminalApp: 'Command Prompt' }).args[0], '/k');
  assert.equal(openCommand('terminal', dir, { platform: 'win32', env, exists: all, terminalApp: 'iTerm' }).file, 'wt.exe', 'a Mac name: the Windows default');
  const code = openCommand('editor', dir, { platform: 'win32', env, exists: all });
  assert.deepEqual([code.file, code.args, code.options.windowsVerbatimArguments], ['C:\\Windows\\system32\\cmd.exe', ['/d', '/s', '/c', `"code "${dir}""`], true]);
  assert.match(openCommand('editor', dir, { platform: 'win32', env, exists: () => false }).error, /isn’t on PATH/);
  assert.match(openCommand('editor', 'C:\\a"b', { platform: 'win32', env, exists: all }).error, /quote/);
  const folder = openCommand('folder', dir, { platform: 'win32', env, exists: all });
  assert.deepEqual([folder.file, folder.args, folder.wait], ['explorer.exe', [dir], false], 'explorer’s exit code says nothing, so it isn’t waited for');
});

test('openCommand on Linux: x-terminal-emulator (else gnome-terminal), code, xdg-open; a plain message when missing', () => {
  const dir = '/home/me/wt/alpha';
  const env = { PATH: '/usr/bin' };
  const t = openCommand('terminal', dir, { platform: 'linux', env, exists: onPath('/usr/bin/x-terminal-emulator', '/usr/bin/gnome-terminal') });
  assert.deepEqual([t.file, t.args, t.options.cwd, t.wait], ['x-terminal-emulator', [], dir, false]);
  const g = openCommand('terminal', dir, { platform: 'linux', env, exists: onPath('/usr/bin/gnome-terminal') });
  assert.deepEqual([g.file, g.args], ['gnome-terminal', [`--working-directory=${dir}`]]);
  assert.match(openCommand('terminal', dir, { platform: 'linux', env, exists: () => false }).error, /No terminal app was found/);
  assert.deepEqual(openCommand('editor', dir, { platform: 'linux', env, exists: onPath('/usr/bin/code') }).args, [dir]);
  assert.deepEqual(openCommand('folder', dir, { platform: 'linux', env, exists: onPath('/usr/bin/xdg-open') }).file, 'xdg-open');
  assert.match(openCommand('folder', dir, { platform: 'linux', env, exists: () => false }).error, /xdg-open/);
});

// A fake child process that spawns, errors or exits as told.
function fakeSpawn(behave) {
  const calls = [];
  const fn = (file, args, options) => {
    calls.push({ file, args, options });
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.unref = () => { child.unrefed = true; };
    child.kill = () => {};
    setImmediate(() => behave(child));
    return child;
  };
  return { fn, calls };
}

test('openIn: waits for macOS open, starts the others on their own, and says why it could not', async () => {
  const ok = fakeSpawn((c) => c.emit('close', 0));
  assert.deepEqual(await openIn('terminal', '/w', { platform: 'darwin', terminalApp: 'Terminal', spawnFn: ok.fn }), { ok: true });
  assert.deepEqual(ok.calls[0].args, ['-a', 'Terminal', '/w']);
  const bad = fakeSpawn((c) => { c.stderr.emit('data', 'Unable to find application named iTerm\n'); c.emit('close', 1); });
  assert.deepEqual(await openIn('terminal', '/w', { platform: 'darwin', spawnFn: bad.fn }), { ok: false, message: 'Unable to find application named iTerm' });
  const started = fakeSpawn((c) => c.emit('spawn'));
  assert.deepEqual(await openIn('folder', 'C:\\w', { platform: 'win32', env: {}, spawnFn: started.fn }), { ok: true });
  assert.equal(started.calls[0].options.detached, true);
  const missing = fakeSpawn((c) => c.emit('error', Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' })));
  assert.deepEqual(await openIn('folder', '/w', { platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => true, spawnFn: missing.fn }), { ok: false, message: 'xdg-open isn’t on this computer.' });
  const none = fakeSpawn(() => assert.fail('nothing to start'));
  assert.equal((await openIn('terminal', '/w', { platform: 'linux', env: {}, exists: () => false, spawnFn: none.fn })).ok, false);
});

test('tempDirs: os.tmpdir() always; /tmp and /private/tmp on macOS and Linux only', () => {
  assert.deepEqual(tempDirs({ platform: 'darwin', tmpdir: '/var/folders/xy/T' }), ['/tmp', '/private/tmp', '/var/folders/xy/T', '/private/var/folders/xy/T']);
  assert.deepEqual(tempDirs({ platform: 'linux', tmpdir: '/tmp' }), ['/tmp', '/private/tmp']);
  assert.deepEqual(tempDirs({ platform: 'win32', tmpdir: 'C:\\Users\\me\\AppData\\Local\\Temp' }), ['C:\\Users\\me\\AppData\\Local\\Temp']);
});

test('processList: ps on macOS and Linux, tasklist /fo csv on Windows (program names, no folders)', async () => {
  assert.deepEqual(processListCommand({ platform: 'darwin' }), { file: 'ps', args: ['-axo', 'pid=,lstart=,command='] });
  assert.deepEqual(processListCommand({ platform: 'linux' }), { file: 'ps', args: ['-axo', 'pid=,lstart=,command='] });
  assert.deepEqual(processListCommand({ platform: 'win32' }), { file: 'tasklist', args: ['/fo', 'csv', '/nh'] });
  const ps = ' 7001 Mon Oct 12 16:00:00 2026     claude --resume x\nnot a line\n';
  assert.deepEqual(parsePsRows(ps), [{ pid: 7001, started: new Date('Mon Oct 12 16:00:00 2026').toISOString(), command: 'claude --resume x' }]);
  const csv = '"System Idle Process","0","Services","0","8 K"\r\n"claude.exe","5120","Console","1","210,400 K"\r\n"odd ""name"".exe","77","Console","1","1 K"\r\nINFO: No tasks are running which match the specified criteria.\r\n';
  assert.deepEqual(parseTasklistRows(csv), [
    { pid: 0, started: null, command: 'System Idle Process' },
    { pid: 5120, started: null, command: 'claude.exe' },
    { pid: 77, started: null, command: 'odd "name".exe' },
  ]);
  const asked = [];
  const rows = await processList({ platform: 'win32', run: async (f, a) => { asked.push([f, a]); return csv; } });
  assert.deepEqual(asked, [['tasklist', ['/fo', 'csv', '/nh']]]);
  assert.equal(rows[1].command, 'claude.exe');
  assert.equal((await processList({ platform: 'linux', run: async () => ps }))[0].pid, 7001);
  assert.deepEqual(await processList({ platform: 'darwin', run: async () => '' }), []);
});

test('nodeCommand: the hook line works on every system', () => {
  assert.equal(nodeCommand('/Users/me/gc/dashboard/hooks/record.mjs'), 'node "/Users/me/gc/dashboard/hooks/record.mjs"');
  assert.equal(nodeCommand('C:\\Users\\me\\gc\\dashboard\\hooks\\record.mjs'), 'node "C:\\Users\\me\\gc\\dashboard\\hooks\\record.mjs"');
});
