// Starbase as the person's own background service, from sign-in (packet I step 3, plan §4.3):
//
//   Windows  a Task Scheduler task "Starbase", at logon, made with schtasks /Create /XML
//   macOS    a launchd agent com.moxie.starbase in ~/Library/LaunchAgents, loaded with
//            launchctl bootstrap gui/<uid>
//   Linux    a systemd user unit starbase.service, systemctl --user enable --now
//
// Always as the person, never as an administrator account. Each runs dashboard/server.js from where
// Starbase is installed, on port 4477, logs to ~/.starbase/logs/ and starts again when it
// fails. The files come from the templates in service/ with the {{…}} parts filled in.
//
// The service from before Starbase (G36: com.moxie.ground-control, ground-control.service, the
// task "Ground Control", or "Dashboard" while that was the placeholder name) is OLD_SERVICE:
// installService stops and removes it before it sets up Starbase's own (removeOldService), and
// doctor reports one still there (findOldService).
//
// On Windows the task runs `starbase service-run` (superviseServer below) in a hidden window,
// since Task Scheduler neither keeps a log nor stops a program gently: the supervisor writes the
// log, starts the dashboard again when it fails, and on `starbase stop` asks it to stop the
// way Ctrl+C does (replies in progress pause and carry on at the next start, packet G).
//
// Where the task can't be made (no rights, or no systemd user services), installService says so
// plainly and points to `starbase start --here`, which is fully supported.
//
// Every function takes `platform`, `home`, `env` and a command runner `run(file, args)` that
// resolves { code, stdout, stderr } (code null when the program isn't there), so tests can ask for
// any system and never touch the real service manager.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findOnPath } from './platform.js';
import { GC_STATE_FOLDER, PRODUCT, STATE_FOLDER } from './state.js';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SERVICE_PORT = 4477;
export const LABEL = 'com.moxie.starbase';
export const TASK_NAME = PRODUCT;
export const UNIT = 'starbase.service';
export const LOG_NAME = 'starbase.log';
/** The service's names before Starbase (G36). Windows' task had the product's name, "Dashboard" while that was the placeholder. */
export const OLD_SERVICE = Object.freeze({ label: 'com.moxie.ground-control', unit: 'ground-control.service', tasks: Object.freeze(['Ground Control', 'Dashboard']), taskFile: 'ground-control.xml' });
/** The file `starbase stop` leaves in the state folder for a supervised dashboard (superviseServer). */
export const STOP_REQUEST = 'stop-request';

const TEMPLATES = { darwin: 'com.moxie.starbase.plist', linux: 'starbase.service', win32: 'starbase.xml' };
// The paths written *into* a service file follow the system it is for (path.win32 for Windows).
// The files Starbase itself writes, removes or looks for always use this computer's own
// `path`: on the system the service is for the two are the same, and a test asking for another
// system's file then writes only inside its own temp folder.
const pathOf = (platform) => (platform === 'win32' ? path.win32 : path.posix);

/** Runs a program and resolves { code, stdout, stderr }; code null (and `missing`) when it isn't on this computer. */
export function runCommand(file, args, { timeout = 30_000, env } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...(env ? { env } : {}) }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') return resolve({ code: null, missing: true, stdout: '', stderr: '' });
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

// ---------- Where things go ----------

/** The logs folder: ~/.starbase/logs (pathApi: path.win32 or path.posix to shape it for that system). */
export const logDir = (home = os.homedir(), platform = process.platform, pathApi = pathOf(platform)) => pathApi.join(home, STATE_FOLDER, 'logs');

/** Where the service file goes on that system (pathApi as for logDir). */
export function serviceFilePath({ platform = process.platform, home = os.homedir(), pathApi = pathOf(platform) } = {}) {
  const p = pathApi;
  if (platform === 'darwin') return p.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
  if (platform === 'win32') return p.join(home, STATE_FOLDER, 'service', 'starbase.xml');
  return p.join(home, '.config', 'systemd', 'user', UNIT);
}

/** The node to run the service with: the one on PATH (it survives upgrades better than a versioned folder), else this one. */
export function nodeFor({ platform = process.platform, env = process.env, exists } = {}) {
  return findOnPath('node', { platform, env, ...(exists ? { exists } : {}) }) ?? process.execPath;
}

// ---------- The files ----------

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// systemd: a value in double quotes, with \ and " escaped and % (its specifier sign) doubled.
const unitQuote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
const unitBare = (s) => String(s).replace(/%/g, '%%');
// PowerShell: a single-quoted string ('' for a quote inside).
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** The PowerShell arguments of the Windows task: the supervisor, in a hidden window. */
export function taskArguments({ node, bin }) {
  return `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "& ${psQuote(node)} ${psQuote(bin)} service-run"`;
}

/**
 * The service file for this system: { file, content, encoding }. content is a string; on Windows
 * it is written as UTF-16 with a byte-order mark (encoding 'utf16le'), which schtasks reads.
 * packageRoot: where Starbase is installed (its dashboard/server.js and bin/starbase.js).
 */
export function renderService({ platform = process.platform, home = os.homedir(), env = process.env, node, packageRoot = PACKAGE_ROOT, templatesDir = path.join(PACKAGE_ROOT, 'service'), port = SERVICE_PORT, user } = {}) {
  const name = TEMPLATES[platform] ?? TEMPLATES.linux;
  const p = pathOf(platform);
  const server = p.join(packageRoot, 'dashboard', 'server.js');
  const bin = p.join(packageRoot, 'bin', 'starbase.js');
  const log = p.join(logDir(home, platform), LOG_NAME);
  const nodePath = node ?? nodeFor({ platform, env });
  const PATH = String(env.PATH ?? env.Path ?? '');
  let values;
  if (platform === 'darwin') {
    values = { NODE: xml(nodePath), SERVER: xml(server), HOME: xml(home), PORT: String(port), PATH: xml(PATH || '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'), LOG: xml(log) };
  } else if (platform === 'win32') {
    const who = user ?? (env.USERDOMAIN && env.USERNAME ? `${env.USERDOMAIN}\\${env.USERNAME}` : env.USERNAME ?? os.userInfo().username);
    values = { USER: xml(who), HOME: xml(home), ARGUMENTS: xml(taskArguments({ node: nodePath, bin })) };
  } else {
    values = { NODE: unitQuote(nodePath), SERVER: unitQuote(server), HOME: unitBare(home), PORT: String(port), PATH_SETTING: unitQuote(`PATH=${PATH || '/usr/local/bin:/usr/bin:/bin'}`), LOG: unitBare(log) };
  }
  const template = fs.readFileSync(path.join(templatesDir, name), 'utf8');
  const content = template.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) => (key in values ? values[key] : m));
  return { file: serviceFilePath({ platform, home }), content, encoding: platform === 'win32' ? 'utf16le' : 'utf8', log, server, bin, node: nodePath };
}

/** The service file on this computer's disk (see pathOf). */
const diskFile = (platform, home) => serviceFilePath({ platform, home, pathApi: path });

function writeServiceFile({ file, content, encoding }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = encoding === 'utf16le' ? Buffer.from(`\ufeff${content}`, 'utf16le') : content;
  fs.writeFileSync(file, data, { mode: 0o644 });
}

// ---------- The plain words ----------

const said = (r) => `${r.stderr || ''}\n${r.stdout || ''}`.trim();
const firstLine = (r) => said(r).split(/\r?\n/).find((l) => l.trim())?.trim() ?? '';

export const NO_RIGHTS_WINDOWS = 'Windows didn’t let this account make the Task Scheduler task: making a task that starts at sign-in needs administrator rights on this computer. '
  + `${PRODUCT} still works fully when you start it yourself: run starbase start --here and keep that window open. `
  + 'If your own account can run programs as administrator, open PowerShell with “Run as administrator” and run starbase install again to have it start at sign-in.';
export const NO_SYSTEMD = `This computer has no systemd user services (systemctl --user doesn’t work here), so ${PRODUCT} can’t run as a service. `
  + 'It still works fully when you start it yourself: run starbase start --here and keep that terminal open.';
export const NO_RIGHTS_OTHER = `This account isn’t allowed to set up the service. ${PRODUCT} still works fully when you start it yourself: run starbase start --here and keep that terminal open.`;

const deniedWindows = (r) => /access is denied|zugriff verweigert|accès refusé|acceso denegado/i.test(said(r));
const noUserBus = (r) => r.missing || /failed to connect to bus|no medium found|not been booted with systemd|\$DBUS_SESSION_BUS_ADDRESS|XDG_RUNTIME_DIR/i.test(said(r));

const uidOf = (uid) => (uid ?? process.getuid?.() ?? 0);

// ---------- The service from before Starbase ----------

/** Where the old service's files are on this computer: the launchd file, the systemd unit, or the task's saved XML. */
function oldServiceFiles(platform, home) {
  if (platform === 'darwin') return [path.join(home, 'Library', 'LaunchAgents', `${OLD_SERVICE.label}.plist`)];
  if (platform === 'win32') return [path.join(home, STATE_FOLDER, 'service', OLD_SERVICE.taskFile), path.join(home, GC_STATE_FOLDER, 'service', OLD_SERVICE.taskFile)];
  return [path.join(home, '.config', 'systemd', 'user', OLD_SERVICE.unit)];
}

/**
 * The service from before Starbase, if it is still on this computer: { found, names, files }.
 * names: what the service manager still knows by an old name (on Windows only a task that runs
 * `service-run`, so a task of someone else's called "Dashboard" is never counted); files: the old
 * service files still on disk.
 */
export async function findOldService({ platform = process.platform, home = os.homedir(), run = runCommand, uid } = {}) {
  const names = [];
  if (platform === 'darwin') {
    const r = await run('launchctl', ['print', `gui/${uidOf(uid)}/${OLD_SERVICE.label}`]);
    if (r.code === 0 && r.stdout.includes(OLD_SERVICE.label)) names.push(OLD_SERVICE.label);
  } else if (platform === 'win32') {
    for (const task of OLD_SERVICE.tasks) {
      const r = await run('schtasks', ['/Query', '/TN', task, '/XML']);
      if (r.code === 0 && /service-run/.test(r.stdout)) names.push(task);
    }
  } else {
    const enabled = await run('systemctl', ['--user', 'is-enabled', OLD_SERVICE.unit]);
    if (/^(enabled|disabled|static|linked)/.test(enabled.stdout.trim())) names.push(OLD_SERVICE.unit);
  }
  const files = [...new Set(oldServiceFiles(platform, home))].filter((f) => fs.existsSync(f));
  return { found: names.length > 0 || files.length > 0, names, files };
}

/**
 * Stops the service from before Starbase and removes it (and its files). Returns { removed: [names
 * and files], message? }; message when the service manager said no (Windows without the rights).
 */
export async function removeOldService({ platform = process.platform, home = os.homedir(), run = runCommand, uid } = {}) {
  const old = await findOldService({ platform, home, run, uid });
  if (!old.found) return { removed: [] };
  const removed = [];
  let message = null;
  for (const name of old.names) {
    let r;
    if (platform === 'darwin') r = await run('launchctl', ['bootout', `gui/${uidOf(uid)}/${name}`]);
    else if (platform === 'win32') { await run('schtasks', ['/End', '/TN', name]); r = await run('schtasks', ['/Delete', '/TN', name, '/F']); }
    else r = await run('systemctl', ['--user', 'disable', '--now', name]);
    if (r.code === 0) removed.push(name);
    else if (platform === 'win32' && deniedWindows(r)) message = `Windows didn’t let this account delete the old Task Scheduler task “${name}”. Delete it in Task Scheduler, or run starbase install again in PowerShell opened with “Run as administrator”.`;
  }
  for (const f of old.files) { try { fs.rmSync(f, { force: true }); removed.push(f); } catch { /* left; doctor says so */ } }
  if (platform === 'linux' && old.files.length) await run('systemctl', ['--user', 'daemon-reload']);
  return { removed, ...(message ? { message } : {}) };
}

// ---------- Install, remove, check, start, stop ----------

/**
 * Writes the service file and registers it with this system's service manager, then starts it.
 * Returns { ok: true, file, log } or { ok: false, reason: 'no-rights' | 'failed', message, file }.
 */
export async function installService({ platform = process.platform, home = os.homedir(), env = process.env, run = runCommand, uid, node, packageRoot, templatesDir, user } = {}) {
  // The service from before Starbase first: it would start a second copy at sign-in, on the same port.
  const old = await removeOldService({ platform, home, run, uid });
  if (old.message) return { ok: false, reason: 'old-service', message: old.message, file: diskFile(platform, home) };
  const rendered = { ...renderService({ platform, home, env, node, packageRoot, templatesDir, user }), file: diskFile(platform, home) };
  fs.mkdirSync(logDir(home, platform, path), { recursive: true, mode: 0o700 });
  writeServiceFile(rendered);
  const out = { file: rendered.file, log: rendered.log, removedOld: old.removed };
  if (platform === 'darwin') {
    const domain = `gui/${uidOf(uid)}`;
    await run('launchctl', ['bootout', `${domain}/${LABEL}`]); // an older copy, if one is loaded; fine when there is none
    await run('launchctl', ['enable', `${domain}/${LABEL}`]);
    const r = await run('launchctl', ['bootstrap', domain, rendered.file]);
    if (r.code !== 0) return { ok: false, reason: /not permitted|permission/i.test(said(r)) ? 'no-rights' : 'failed', message: /not permitted|permission/i.test(said(r)) ? NO_RIGHTS_OTHER : `launchctl couldn’t load the service: ${firstLine(r) || `it stopped with code ${r.code}`}.`, ...out };
    return { ok: true, ...out };
  }
  if (platform === 'win32') {
    const r = await run('schtasks', ['/Create', '/TN', TASK_NAME, '/XML', rendered.file, '/F']);
    if (r.code !== 0) {
      if (deniedWindows(r)) { try { fs.rmSync(rendered.file, { force: true }); } catch { /* left */ } return { ok: false, reason: 'no-rights', message: NO_RIGHTS_WINDOWS, ...out }; }
      return { ok: false, reason: 'failed', message: `Task Scheduler couldn’t make the task: ${firstLine(r) || `schtasks stopped with code ${r.code}`}.`, ...out };
    }
    const started = await run('schtasks', ['/Run', '/TN', TASK_NAME]);
    if (started.code !== 0) return { ok: false, reason: 'failed', message: `The task is made, but it didn’t start: ${firstLine(started) || `schtasks stopped with code ${started.code}`}. It starts by itself at your next sign-in.`, ...out };
    return { ok: true, ...out };
  }
  const reload = await run('systemctl', ['--user', 'daemon-reload']);
  if (noUserBus(reload)) { try { fs.rmSync(rendered.file, { force: true }); } catch { /* left */ } return { ok: false, reason: 'no-rights', message: NO_SYSTEMD, ...out }; }
  const r = await run('systemctl', ['--user', 'enable', '--now', UNIT]);
  if (r.code !== 0) {
    if (noUserBus(r)) return { ok: false, reason: 'no-rights', message: NO_SYSTEMD, ...out };
    return { ok: false, reason: 'failed', message: `systemd couldn’t start the service: ${firstLine(r) || `systemctl stopped with code ${r.code}`}.`, ...out };
  }
  return { ok: true, ...out };
}

/** Stops the service, takes it out of the service manager and deletes its file. Returns { ok, removed, message? }. */
export async function removeService({ platform = process.platform, home = os.homedir(), run = runCommand, uid } = {}) {
  const file = diskFile(platform, home);
  let removed = false;
  let message = null;
  if (platform === 'darwin') {
    const r = await run('launchctl', ['bootout', `gui/${uidOf(uid)}/${LABEL}`]);
    removed = r.code === 0;
  } else if (platform === 'win32') {
    const r = await run('schtasks', ['/Delete', '/TN', TASK_NAME, '/F']);
    removed = r.code === 0;
    if (r.code !== 0 && deniedWindows(r)) message = `Windows didn’t let this account delete the Task Scheduler task “${PRODUCT}”. Open PowerShell with “Run as administrator” and run starbase uninstall again, or delete the task in Task Scheduler.`;
  } else {
    const r = await run('systemctl', ['--user', 'disable', '--now', UNIT]);
    removed = r.code === 0;
  }
  const hadFile = fs.existsSync(file);
  if (hadFile) fs.rmSync(file, { force: true });
  if (platform === 'linux' && hadFile) await run('systemctl', ['--user', 'daemon-reload']);
  return { ok: !message, removed: removed || hadFile, file, message };
}

/**
 * Whether the service is installed (its file is there and the manager knows it) and whether the
 * manager says it is running: { installed, running, file, manager }. running is null when this
 * system's manager can't say (Windows: Task Scheduler's status words depend on the language; the
 * caller reads service.json for that).
 */
export async function checkService({ platform = process.platform, home = os.homedir(), run = runCommand, uid } = {}) {
  const file = diskFile(platform, home);
  const hasFile = fs.existsSync(file);
  if (platform === 'darwin') {
    const r = await run('launchctl', ['print', `gui/${uidOf(uid)}/${LABEL}`]);
    const loaded = r.code === 0;
    return { installed: hasFile && loaded, fileOnly: hasFile && !loaded, running: loaded && /\bstate = running\b/.test(r.stdout), file, manager: 'launchd' };
  }
  if (platform === 'win32') {
    const r = await run('schtasks', ['/Query', '/TN', TASK_NAME]);
    return { installed: r.code === 0, fileOnly: hasFile && r.code !== 0, running: null, file, manager: 'Task Scheduler' };
  }
  const enabled = await run('systemctl', ['--user', 'is-enabled', UNIT]);
  const active = await run('systemctl', ['--user', 'is-active', UNIT]);
  const on = enabled.stdout.trim() === 'enabled';
  return { installed: hasFile && on, fileOnly: hasFile && !on, running: active.stdout.trim() === 'active', file, manager: 'systemd' };
}

/** Starts the installed service. Returns { ok, message? }. */
export async function startService({ platform = process.platform, home = os.homedir(), run = runCommand, uid } = {}) {
  let r;
  if (platform === 'darwin') {
    const domain = `gui/${uidOf(uid)}`;
    r = await run('launchctl', ['kickstart', `${domain}/${LABEL}`]);
    if (r.code !== 0) r = await run('launchctl', ['bootstrap', domain, diskFile(platform, home)]);
  } else if (platform === 'win32') {
    r = await run('schtasks', ['/Run', '/TN', TASK_NAME]);
  } else {
    r = await run('systemctl', ['--user', 'start', UNIT]);
  }
  return r.code === 0 ? { ok: true } : { ok: false, message: `The service didn’t start: ${firstLine(r) || `it stopped with code ${r.code}`}.` };
}

/**
 * Asks the service manager to stop the service (macOS and Linux; the dashboard pauses replies in
 * progress as it does on Ctrl+C). On Windows `starbase stop` leaves a stop request for the
 * supervisor instead (requestStop); this ends the task outright and is only the last resort.
 */
export async function stopService({ platform = process.platform, run = runCommand, uid } = {}) {
  let r;
  if (platform === 'darwin') r = await run('launchctl', ['kill', 'SIGTERM', `gui/${uidOf(uid)}/${LABEL}`]);
  else if (platform === 'win32') r = await run('schtasks', ['/End', '/TN', TASK_NAME]);
  else r = await run('systemctl', ['--user', 'stop', UNIT]);
  return r.code === 0 ? { ok: true } : { ok: false, message: firstLine(r) || `it stopped with code ${r.code}` };
}

// ---------- The supervisor (Windows service, and `start --here` everywhere) ----------

// Loaded into the dashboard's process before server.js: a stop message over the supervisor's
// channel becomes the same SIGTERM the dashboard handles on macOS and Linux (Windows has no
// signals to send to another process), so a stop there pauses replies cleanly too.
export const STOP_HOOK = `data:text/javascript,${encodeURIComponent("process.on('message', (m) => { if (m && m.type === 'starbase-stop') process.emit('SIGTERM', 'SIGTERM'); }); process.channel?.unref?.();")}`;

/** Leaves a stop request for a supervised dashboard (superviseServer polls for it). */
export function requestStop(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(stateDir, STOP_REQUEST), `${new Date().toISOString()}\n`, { mode: 0o600 });
}

/** Opens the log for appending, moving a log over 10 MB to starbase.log.1 first. */
function openLog(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { if (fs.statSync(file).size > 10 * 1024 * 1024) fs.renameSync(file, `${file}.1`); } catch { /* new log */ }
  return fs.openSync(file, 'a', 0o600);
}

/**
 * Runs dashboard/server.js as a child and looks after it until it stops. Resolves its exit code.
 *   port      PORT for the dashboard
 *   stateDir  where `starbase stop` leaves its stop request
 *   log       a file for its output (the Windows service); else it shares this terminal
 *   restart   start it again when it fails (the service); a run in a terminal just ends
 * A stop request, Ctrl+C or SIGTERM sends the stop message (STOP_HOOK); after `graceMs` without
 * it ending, it is ended outright. More than 5 failures in 10 minutes and it gives up (code 1).
 */
export function superviseServer({ serverPath = path.join(PACKAGE_ROOT, 'dashboard', 'server.js'), port, stateDir, env = process.env, log = null, restart = false, spawnFn = spawn, pollMs = 1000, graceMs = 20_000, say = (line) => console.log(line) } = {}) {
  const stopFile = path.join(stateDir, STOP_REQUEST);
  try { fs.rmSync(stopFile, { force: true }); } catch { /* none */ }
  return new Promise((resolve) => {
    let child = null;
    let stopping = false;
    let done = false;
    const failures = [];
    let fd = null;
    let poll = null;
    let graceTimer = null;
    const signals = process.platform === 'win32' ? ['SIGINT', 'SIGBREAK'] : ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const onSignal = () => stop();
    for (const s of signals) process.on(s, onSignal);

    function finish(code) {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(graceTimer);
      for (const s of signals) process.off(s, onSignal);
      if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } }
      resolve(code);
    }

    function stop() {
      if (stopping) return;
      stopping = true;
      if (!child || child.exitCode !== null) return finish(0);
      try { child.send({ type: 'starbase-stop' }); } catch { /* channel closed: it is ending */ }
      graceTimer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, graceMs);
      graceTimer.unref?.();
    }

    function launch() {
      if (log) { if (fd === null) fd = openLog(log); fs.writeSync(fd, `\n--- ${new Date().toISOString()} starting ${PRODUCT} on port ${port}\n`); }
      child = spawnFn(process.execPath, ['--import', STOP_HOOK, serverPath], {
        env: { ...env, PORT: String(port) },
        stdio: log ? ['ignore', fd, fd, 'ipc'] : ['inherit', 'inherit', 'inherit', 'ipc'],
        windowsHide: true,
      });
      child.once('error', (err) => { say(`${PRODUCT} couldn’t start: ${err.message}`); finish(1); });
      child.once('exit', (code, signal) => {
        if (stopping) return finish(0);
        if (!restart || code === 0) return finish(code ?? (signal ? 1 : 0));
        const now = Date.now();
        failures.push(now);
        while (failures.length && now - failures[0] > 10 * 60_000) failures.shift();
        if (failures.length > 5) {
          if (fd !== null) fs.writeSync(fd, `--- ${new Date().toISOString()} it failed ${failures.length} times in 10 minutes; not starting it again. Run starbase start to try again.\n`);
          return finish(1);
        }
        const wait = Math.min(60_000, 2000 * 2 ** (failures.length - 1));
        if (fd !== null) fs.writeSync(fd, `--- ${new Date().toISOString()} it stopped (${signal ?? `code ${code}`}); starting it again in ${Math.round(wait / 1000)} s\n`);
        setTimeout(() => { if (!stopping) launch(); else finish(0); }, wait);
      });
    }

    poll = setInterval(() => {
      if (fs.existsSync(stopFile)) {
        try { fs.rmSync(stopFile, { force: true }); } catch { /* gone */ }
        stop();
      }
    }, pollMs);
    launch();
  });
}
