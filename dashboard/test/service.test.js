// The background service (packet I step 3, lib/service.js): the file written for each system, the
// commands given to its service manager, the plain message when the service can't be made, and
// the supervisor the Windows task (and `start --here`) runs. The service manager is always a fake:
// nothing is installed, loaded or started on this computer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LABEL, NO_RIGHTS_WINDOWS, NO_SYSTEMD, STOP_REQUEST, TASK_NAME, UNIT,
  checkService, installService, removeService, renderService, requestStop, serviceFilePath, startService, stopService, superviseServer, taskArguments,
} from '../lib/service.js';

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** A pretend service manager: records each command and answers from `answers` (by "file arg0"). */
function fakeRun(answers = {}) {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    const key = `${file} ${args[0] === '--user' ? args[1] : args[0]}`;
    return { code: 0, stdout: '', stderr: '', ...(answers[key] ?? {}) };
  };
  return { run, calls };
}

test('macOS: a launchd agent in ~/Library/LaunchAgents running server.js on 4477, logging to ~/.ground-control/logs', () => {
  const home = '/Users/sam & co';
  const r = renderService({ platform: 'darwin', home, env: { PATH: '/opt/homebrew/bin:/usr/bin' }, node: '/opt/homebrew/bin/node', packageRoot: '/opt/homebrew/lib/node_modules/@moxie/ground-control' });
  assert.equal(r.file, path.posix.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`));
  assert.equal(r.encoding, 'utf8');
  assert.match(r.content, /<string>com\.moxie\.ground-control<\/string>/);
  assert.match(r.content, /<string>\/opt\/homebrew\/bin\/node<\/string>\s*<string>\/opt\/homebrew\/lib\/node_modules\/@moxie\/ground-control\/dashboard\/server\.js<\/string>/);
  assert.match(r.content, /<key>PORT<\/key>\s*<string>4477<\/string>/);
  assert.match(r.content, /<key>PATH<\/key>\s*<string>\/opt\/homebrew\/bin:\/usr\/bin<\/string>/);
  assert.match(r.content, /<string>\/Users\/sam &amp; co\/\.ground-control\/logs\/ground-control\.log<\/string>/, 'the log path, with & escaped for XML');
  assert.match(r.content, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(r.content, /<key>SuccessfulExit<\/key>\s*<false\/>/, 'started again only when it fails, not after ground-control stop');
  assert.doesNotMatch(r.content, /\{\{[A-Z_]+\}\}/, "every part is filled in");
});

test('Linux: a systemd user unit, quoted for systemd, restarting on failure', () => {
  const r = renderService({ platform: 'linux', home: '/home/sam', env: { PATH: '/usr/bin:/odd%dir' }, node: '/usr/bin/node', packageRoot: '/usr/lib/node_modules/@moxie/ground-control' });
  assert.equal(r.file, '/home/sam/.config/systemd/user/ground-control.service');
  assert.match(r.content, /^ExecStart="\/usr\/bin\/node" "\/usr\/lib\/node_modules\/@moxie\/ground-control\/dashboard\/server\.js"$/m);
  assert.match(r.content, /^Environment=PORT=4477$/m);
  assert.match(r.content, /^Environment="PATH=\/usr\/bin:\/odd%%dir"$/m, 'a % is doubled, as systemd needs');
  assert.match(r.content, /^Restart=on-failure$/m);
  assert.match(r.content, /^StandardOutput=append:\/home\/sam\/\.ground-control\/logs\/ground-control\.log$/m);
  assert.match(r.content, /^WantedBy=default\.target$/m);
  assert.doesNotMatch(r.content, /\{\{[A-Z_]+\}\}/, "every part is filled in");
});

test('Windows: a Task Scheduler task at logon, as the person with normal rights, running the supervisor hidden', () => {
  const home = 'C:\\Users\\sam';
  const r = renderService({ platform: 'win32', home, env: { USERDOMAIN: 'MOXIE', USERNAME: 'sam', PATH: 'C:\\x' }, node: 'C:\\Program Files\\nodejs\\node.exe', packageRoot: 'C:\\Users\\sam\\AppData\\Roaming\\npm\\node_modules\\@moxie\\ground-control' });
  assert.equal(r.file, 'C:\\Users\\sam\\.ground-control\\service\\ground-control.xml');
  assert.equal(r.encoding, 'utf16le');
  assert.match(r.content, /encoding="UTF-16"/);
  assert.match(r.content, /<LogonTrigger>\s*<Enabled>true<\/Enabled>\s*<UserId>MOXIE\\sam<\/UserId>/);
  assert.match(r.content, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(r.content, /<RunLevel>LeastPrivilege<\/RunLevel>/, 'never with administrator rights');
  assert.match(r.content, /<RestartOnFailure>/);
  assert.match(r.content, /<Command>powershell\.exe<\/Command>/);
  assert.match(r.content, /-WindowStyle Hidden/);
  assert.match(r.content, /&amp; 'C:\\Program Files\\nodejs\\node\.exe' 'C:\\Users\\sam\\AppData\\Roaming\\npm\\node_modules\\@moxie\\ground-control\\bin\\ground-control\.js' service-run/);
  assert.doesNotMatch(r.content, /\{\{[A-Z_]+\}\}/, "every part is filled in");
  assert.equal(taskArguments({ node: "C:\\it's\\node.exe", bin: 'C:\\b.js' }), `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "& 'C:\\it''s\\node.exe' 'C:\\b.js' service-run"`);
});

test('install on macOS writes the agent and bootstraps it into gui/<uid>', async () => {
  const home = tmp('gc-svc-');
  const { run, calls } = fakeRun();
  const r = await installService({ platform: 'darwin', home, env: { PATH: '/usr/bin' }, run, uid: 501, node: '/usr/bin/node' });
  assert.equal(r.ok, true);
  assert.ok(fs.readFileSync(serviceFilePath({ platform: 'darwin', home }), 'utf8').includes(LABEL));
  assert.ok(fs.statSync(path.join(home, '.ground-control', 'logs')).isDirectory());
  assert.deepEqual(calls.at(-1), ['launchctl', 'bootstrap', 'gui/501', r.file]);
  assert.ok(calls.some((c) => c.join(' ') === `launchctl bootout gui/501/${LABEL}`), 'an older copy is unloaded first');
});

test('install on Linux writes the unit and runs systemctl --user enable --now', async () => {
  const home = tmp('gc-svc-');
  const { run, calls } = fakeRun();
  const r = await installService({ platform: 'linux', home, env: { PATH: '/usr/bin' }, run, node: '/usr/bin/node' });
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(path.join(home, '.config', 'systemd', 'user', UNIT)));
  assert.deepEqual(calls.map((c) => c.join(' ')), ['systemctl --user daemon-reload', `systemctl --user enable --now ${UNIT}`]);
});

test('install on Linux with no systemd user services says so plainly and points to start --here', async () => {
  const home = tmp('gc-svc-');
  const { run } = fakeRun({ 'systemctl daemon-reload': { code: 1, stderr: 'Failed to connect to bus: No medium found' } });
  const r = await installService({ platform: 'linux', home, env: {}, run, node: '/usr/bin/node' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-rights');
  assert.equal(r.message, NO_SYSTEMD);
  assert.match(r.message, /ground-control start --here/);
  assert.ok(!fs.existsSync(r.file), 'the unit is not left behind');
});

test('install on Windows saves the task file as UTF-16 and makes the task with schtasks /Create /XML', async () => {
  const home = tmp('gc-svc-');
  const { run, calls } = fakeRun();
  const r = await installService({ platform: 'win32', home, env: { USERDOMAIN: 'PC', USERNAME: 'sam' }, run, node: 'C:\\node.exe' });
  assert.equal(r.ok, true);
  assert.equal(r.file, path.join(home, '.ground-control', 'service', 'ground-control.xml'), 'written inside the home it was given, with this computer’s own path joins');
  assert.ok(fs.statSync(path.join(home, '.ground-control', 'logs')).isDirectory());
  const bytes = fs.readFileSync(r.file);
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe], 'UTF-16 with its byte-order mark');
  assert.match(bytes.toString('utf16le'), /<UserId>PC\\sam<\/UserId>/);
  assert.deepEqual(calls[0], ['schtasks', '/Create', '/TN', TASK_NAME, '/XML', r.file, '/F']);
  assert.deepEqual(calls[1], ['schtasks', '/Run', '/TN', TASK_NAME]);
});

test('install on Windows without the rights says so plainly: start --here works, or run it as administrator', async () => {
  const home = tmp('gc-svc-');
  const { run } = fakeRun({ 'schtasks /Create': { code: 1, stderr: 'ERROR: Access is denied.\r\n' } });
  const r = await installService({ platform: 'win32', home, env: { USERNAME: 'sam' }, run, node: 'C:\\node.exe' });
  assert.equal(r.ok, false);
  assert.ok(r.file.startsWith(home) && !fs.existsSync(r.file), 'the task file is removed again, from inside the temp home');
  assert.equal(r.reason, 'no-rights');
  assert.equal(r.message, NO_RIGHTS_WINDOWS);
  assert.match(r.message, /administrator rights/);
  assert.match(r.message, /ground-control start --here/);
  assert.doesNotMatch(r.message, /schtasks|XML|0x/i, 'plain words, no tool output');
});

test('another failure is reported with the tool’s own first line', async () => {
  const { run } = fakeRun({ 'launchctl bootstrap': { code: 5, stderr: 'Bootstrap failed: 5: Input/output error' } });
  const r = await installService({ platform: 'darwin', home: tmp('gc-svc-'), env: {}, run, uid: 501, node: '/n' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'failed');
  assert.match(r.message, /Bootstrap failed: 5/);
});

test('check, start, stop and remove ask each system’s manager', async () => {
  const home = tmp('gc-svc-');
  fs.mkdirSync(path.join(home, 'Library', 'LaunchAgents'), { recursive: true });
  fs.writeFileSync(serviceFilePath({ platform: 'darwin', home }), 'x');
  let { run, calls } = fakeRun({ 'launchctl print': { code: 0, stdout: `gui/501/${LABEL} = {\n\tstate = running\n\tpid = 4242\n}` } });
  assert.deepEqual(await checkService({ platform: 'darwin', home, run, uid: 501 }), { installed: true, fileOnly: false, running: true, file: serviceFilePath({ platform: 'darwin', home }), manager: 'launchd' });
  assert.deepEqual((await startService({ platform: 'darwin', home, run, uid: 501 })), { ok: true });
  assert.deepEqual(calls.at(-1), ['launchctl', 'kickstart', `gui/501/${LABEL}`]);
  await stopService({ platform: 'darwin', run, uid: 501 });
  assert.deepEqual(calls.at(-1), ['launchctl', 'kill', 'SIGTERM', `gui/501/${LABEL}`]);
  const removed = await removeService({ platform: 'darwin', home, run, uid: 501 });
  assert.equal(removed.removed, true);
  assert.ok(!fs.existsSync(serviceFilePath({ platform: 'darwin', home })));

  ({ run, calls } = fakeRun({ 'systemctl is-enabled': { stdout: 'disabled\n' }, 'systemctl is-active': { code: 3, stdout: 'inactive\n' } }));
  const linux = await checkService({ platform: 'linux', home, run });
  assert.equal(linux.installed, false);
  assert.equal(linux.running, false);

  ({ run, calls } = fakeRun({ 'schtasks /Query': { code: 1, stderr: 'ERROR: The system cannot find the file specified.' } }));
  const win = await checkService({ platform: 'win32', home, run });
  assert.equal(win.installed, false);
  assert.equal(win.running, null, 'Windows: service.json says whether it runs');
  await removeService({ platform: 'win32', home, run });
  assert.deepEqual(calls.at(-1), ['schtasks', '/Delete', '/TN', TASK_NAME, '/F']);
});

// A pretend dashboard: counts its starts, fails on the first when asked to, and on SIGTERM (or the
// supervisor's stop message, which becomes one) writes "stopped cleanly" and exits 0.
function fakeServer(dir, { failFirst = false } = {}) {
  const file = path.join(dir, 'server.js');
  fs.writeFileSync(file, `
import fs from 'node:fs';
const count = ${JSON.stringify(path.join(dir, 'starts'))};
const n = (fs.existsSync(count) ? Number(fs.readFileSync(count, 'utf8')) : 0) + 1;
fs.writeFileSync(count, String(n));
console.log('fake dashboard on port ' + process.env.PORT + ', start ' + n);
if (${failFirst} && n === 1) process.exit(3);
process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(path.join(dir, 'stopped'))}, 'stopped cleanly'); process.exit(0); });
setInterval(() => {}, 1000);
`);
  return file;
}

const until = async (fn, ms = 10_000) => {
  for (let t = 0; t < ms; t += 50) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
};

test('the supervisor writes the log, and a stop request stops the dashboard cleanly (how ground-control stop works on Windows)', async () => {
  const dir = tmp('gc-sup-');
  const log = path.join(dir, 'logs', 'ground-control.log');
  const done = superviseServer({ serverPath: fakeServer(dir), port: 4999, stateDir: dir, env: { ...process.env }, log, restart: true, pollMs: 50 });
  assert.ok(await until(() => fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('start 1')), 'the dashboard’s output goes to the log');
  requestStop(dir);
  assert.equal(await done, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'stopped'), 'utf8'), 'stopped cleanly', 'stopped through its own SIGTERM handler, not ended outright');
  assert.ok(!fs.existsSync(path.join(dir, STOP_REQUEST)), 'the request is used up');
  assert.match(fs.readFileSync(log, 'utf8'), /fake dashboard on port 4999/);
});

test('the supervisor starts a failed dashboard again (the service), and a terminal run just ends', async () => {
  const dir = tmp('gc-sup-');
  const log = path.join(dir, 'ground-control.log');
  const done = superviseServer({ serverPath: fakeServer(dir, { failFirst: true }), port: 4999, stateDir: dir, env: { ...process.env }, log, restart: true, pollMs: 50 });
  assert.ok(await until(() => fs.existsSync(path.join(dir, 'starts')) && fs.readFileSync(path.join(dir, 'starts'), 'utf8') === '2', 15_000), 'started a second time');
  assert.match(fs.readFileSync(log, 'utf8'), /it stopped \(code 3\); starting it again/);
  requestStop(dir);
  assert.equal(await done, 0);

  const once = tmp('gc-sup-');
  const code = await superviseServer({ serverPath: fakeServer(once, { failFirst: true }), port: 4999, stateDir: once, env: { ...process.env }, log: path.join(once, 'l.log'), restart: false, pollMs: 50 });
  assert.equal(code, 3);
  assert.equal(fs.readFileSync(path.join(once, 'starts'), 'utf8'), '1');
});
