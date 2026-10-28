// One place for what differs between macOS, Windows and Linux: the shell a command runs in, how a
// process and everything it started is stopped, how a terminal, an editor or a folder is opened,
// which terminal apps there are, finding a program on PATH, the temp folders, and the process list.
//
// Every function takes `platform` (default process.platform) and, where it looks at the computer,
// the environment and a file check or a command runner, so tests can ask for any system and only
// ever build commands, never run them.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pathOf = (platform) => (platform === 'win32' ? path.win32 : path.posix);
const fileExists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** An environment variable, by name in any case on Windows (its variables are not case sensitive). */
export function envGet(env, name, platform = process.platform) {
  if (!env) return undefined;
  if (name in env) return env[name];
  if (platform !== 'win32') return undefined;
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

// ---------- Running a command line ----------

/**
 * How to run one command line in this system's shell: { file, args, options }, with `options`
 * the extra spawn options it needs. macOS and Linux: $SHELL (else /bin/zsh on macOS, /bin/sh on
 * Linux) with -c, in a process group of its own (detached) so the whole group can be stopped.
 * Windows: cmd.exe /d /s /c "<command>", the way Node's own `shell: true` does it; Windows has no
 * process groups, so it isn't detached (that would open a console window of its own).
 */
export function shellFor(command, { platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') {
    return { file: envGet(env, 'ComSpec', platform) || 'cmd.exe', args: ['/d', '/s', '/c', `"${command}"`], options: { windowsVerbatimArguments: true, windowsHide: true } };
  }
  return { file: env?.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh'), args: ['-c', command], options: { detached: true } };
}

// ---------- Stopping a process and what it started ----------

/** The command that stops pid and everything it started on Windows, or null where a signal to its group does it. */
export function killTreeCommand(pid, { platform = process.platform } = {}) {
  return platform === 'win32' ? { file: 'taskkill', args: ['/pid', String(pid), '/T', '/F'] } : null;
}

/**
 * Stop pid and everything it started. macOS and Linux: the signal to its process group (it was
 * started detached), else to it alone. Windows: taskkill /pid <pid> /T /F (no signals there).
 * `kill` and `run` are injectable for tests. Returns how: 'group', 'process', 'taskkill' or null.
 */
export function killTree(pid, { platform = process.platform, signal = 'SIGTERM', kill = process.kill.bind(process), run = (file, args) => execFile(file, args, { windowsHide: true, timeout: 10_000 }, () => {}) } = {}) {
  if (!pid) return null;
  const cmd = killTreeCommand(pid, { platform });
  if (cmd) { run(cmd.file, cmd.args); return 'taskkill'; }
  try { kill(-pid, signal); return 'group'; } catch { /* not a group leader */ }
  try { kill(pid, signal); return 'process'; } catch { return null; }
}

// ---------- Finding programs ----------

/** The full path of a program on PATH (with PATHEXT on Windows), or null. */
export function findOnPath(name, { platform = process.platform, env = process.env, exists = fileExists } = {}) {
  const p = pathOf(platform);
  const list = String(envGet(env, 'PATH', platform) ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  let exts = [''];
  if (platform === 'win32') {
    const pathext = String(envGet(env, 'PATHEXT', platform) || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
    const has = pathext.some((e) => name.toLowerCase().endsWith(e.toLowerCase()));
    exts = has ? ['', ...pathext] : pathext;
  }
  for (const dir of list) {
    for (const ext of exts) {
      const full = p.join(dir.replace(/^"(.*)"$/, '$1'), name + ext);
      if (exists(full)) return full;
    }
  }
  return null;
}

// ---------- Terminals, editors and folders ----------

/** The terminal apps this system offers, the first one the default. */
export function terminalApps({ platform = process.platform } = {}) {
  if (platform === 'darwin') return ['iTerm', 'Terminal'];
  if (platform === 'win32') return ['Windows Terminal', 'Command Prompt'];
  return ['Terminal'];
}

/** What the "open the folder" button is called here: Finder on macOS, else "Open folder". */
export function folderLabel({ platform = process.platform } = {}) {
  return platform === 'darwin' ? 'Finder' : 'Open folder';
}

/**
 * The command that opens `dir` in a terminal, the editor or the file browser:
 * { file, args, options, wait }, or { error } when this computer has nothing to open it with.
 * what: 'terminal', 'editor' or 'folder'. wait: true when the command returns once it has opened
 * (macOS `open`); false for programs that keep running (a terminal) or whose exit code says
 * nothing (explorer.exe), which are started on their own and left running.
 *   macOS    open -a <terminal app> | open -a "Visual Studio Code" | open (Finder)
 *   Windows  wt.exe -d <dir>, else a Command Prompt window | code | explorer.exe
 *   Linux    x-terminal-emulator, else gnome-terminal | code | xdg-open
 */
export function openCommand(what, dir, { terminalApp, platform = process.platform, env = process.env, exists = fileExists } = {}) {
  const apps = terminalApps({ platform });
  const app = apps.includes(terminalApp) ? terminalApp : apps[0];
  const on = (name) => findOnPath(name, { platform, env, exists });
  const own = { detached: true, stdio: 'ignore' };
  if (platform === 'darwin') {
    if (what === 'folder') return { file: 'open', args: [dir], options: {}, wait: true };
    if (what === 'editor') return { file: 'open', args: ['-a', 'Visual Studio Code', dir], options: {}, wait: true };
    return { file: 'open', args: ['-a', app, dir], options: {}, wait: true };
  }
  if (platform === 'win32') {
    if (what === 'folder') return { file: 'explorer.exe', args: [dir], options: { ...own }, wait: false };
    if (what === 'editor') {
      // code is code.cmd on Windows, which only runs through cmd.exe.
      if (!on('code')) return { error: 'VS Code’s “code” command isn’t on PATH. In VS Code, run “Shell Command: Install ‘code’ command in PATH”, then try again.' };
      if (dir.includes('"')) return { error: 'This folder’s name has a quote in it, so it can’t be opened from here.' };
      const sh = shellFor(`code "${dir}"`, { platform, env });
      return { file: sh.file, args: sh.args, options: { ...sh.options, stdio: 'ignore' }, wait: false };
    }
    if (app === 'Windows Terminal' && on('wt.exe')) return { file: 'wt.exe', args: ['-d', dir], options: { ...own }, wait: false };
    // A Command Prompt in a window of its own (detached gives a console app a new window on Windows).
    return { file: envGet(env, 'ComSpec', platform) || 'cmd.exe', args: ['/k'], options: { ...own, cwd: dir }, wait: false };
  }
  if (what === 'folder') return on('xdg-open') ? { file: 'xdg-open', args: [dir], options: { ...own }, wait: false } : { error: 'There is no xdg-open on this computer to open the folder with.' };
  if (what === 'editor') return on('code') ? { file: 'code', args: [dir], options: { ...own }, wait: false } : { error: 'VS Code’s “code” command isn’t on PATH.' };
  if (on('x-terminal-emulator')) return { file: 'x-terminal-emulator', args: [], options: { ...own, cwd: dir }, wait: false };
  if (on('gnome-terminal')) return { file: 'gnome-terminal', args: [`--working-directory=${dir}`], options: { ...own }, wait: false };
  return { error: 'No terminal app was found on this computer (x-terminal-emulator or gnome-terminal).' };
}

/**
 * Open `dir` (see openCommand). Resolves { ok: true } or { ok: false, message } in plain words;
 * never throws. `spawnFn` is injectable for tests.
 */
export function openIn(what, dir, { terminalApp, platform = process.platform, env = process.env, exists = fileExists, spawnFn = spawn } = {}) {
  const cmd = openCommand(what, dir, { terminalApp, platform, env, exists });
  if (cmd.error) return Promise.resolve({ ok: false, message: cmd.error });
  return new Promise((resolve) => {
    let child;
    try { child = spawnFn(cmd.file, cmd.args, { windowsHide: false, ...cmd.options, ...(cmd.wait ? { stdio: ['ignore', 'ignore', 'pipe'] } : {}) }); } catch (err) { resolve({ ok: false, message: err.message }); return; }
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += String(d); });
    child.once('error', (err) => resolve({ ok: false, message: err.code === 'ENOENT' ? `${cmd.file} isn’t on this computer.` : err.message }));
    if (cmd.wait) {
      const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } resolve({ ok: false, message: 'It took too long to open.' }); }, 15_000);
      child.once('close', (code) => { clearTimeout(timer); resolve(code === 0 ? { ok: true } : { ok: false, message: stderr.trim() || 'unknown error' }); });
    } else {
      child.once('spawn', () => { child.unref?.(); resolve({ ok: true }); });
    }
  });
}

// ---------- Temp folders ----------

/** The folders scratch output may go to: os.tmpdir() always, plus /tmp and /private/tmp on macOS and Linux. */
export function tempDirs({ platform = process.platform, tmpdir = os.tmpdir() } = {}) {
  if (platform === 'win32') return [tmpdir];
  return [...new Set(['/tmp', '/private/tmp', tmpdir, path.posix.join('/private', tmpdir)])];
}

// ---------- The process list ----------

/** The command that lists processes: ps on macOS and Linux, tasklist on Windows. */
export function processListCommand({ platform = process.platform } = {}) {
  return platform === 'win32' ? { file: 'tasklist', args: ['/fo', 'csv', '/nh'] } : { file: 'ps', args: ['-axo', 'pid=,lstart=,command='] };
}

/** `ps -axo pid=,lstart=,command=` output as [{ pid, started, command }]. */
export function parsePsRows(out) {
  const rows = [];
  for (const line of String(out).split('\n')) {
    const m = /^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(line);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), started: new Date(m[2]).toISOString(), command: m[3] });
  }
  return rows;
}

// One tasklist CSV line: every field in double quotes, "" for a quote inside.
const csvFields = (line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));

/** `tasklist /fo csv /nh` output as [{ pid, started: null, command }]: the program name only, no folder or start time. */
export function parseTasklistRows(out) {
  const rows = [];
  for (const line of String(out).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name, pid] = csvFields(line.trim());
    if (!name || !/^\d+$/.test(pid ?? '')) continue;
    rows.push({ pid: Number(pid), started: null, command: name });
  }
  return rows;
}

/**
 * The processes running now: [{ pid, started, command }]. On Windows `command` is the program name
 * only (tasklist doesn't give the command line, the start time or the folder). `run(file, args)`
 * resolves the command's output ('' when it fails) and is injectable for tests.
 */
export async function processList({ platform = process.platform, run = (file, args) => new Promise((resolve) => { execFile(file, args, { timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout))); }) } = {}) {
  const cmd = processListCommand({ platform });
  const out = await run(cmd.file, cmd.args);
  return platform === 'win32' ? parseTasklistRows(out) : parsePsRows(out);
}

// ---------- Hooks ----------

/** The hook command line for a Node script, which works on all three systems: node "<script>". */
export function nodeCommand(script) {
  return `node "${script}"`;
}
