// Claude Code sessions open in terminals right now, from the operating system's process list
// (lib/platform.js processList: ps on macOS and Linux, tasklist on Windows). No logs or settings
// needed: each interactive `claude` process and the folder it runs in. Headless runs (this
// dashboard's own, `claude -p`, the SDK) and helper processes are left out.
// The folder comes from /proc on Linux, else lsof. Windows gives no folders (and no command lines),
// so there a session whose folder can't be read is left out, never guessed.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { parsePsRows, processList } from './platform.js';

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => resolve(err ? '' : stdout));
});

/** The interactive Claude Code processes among [{ pid, started, command }]. */
export function claudeSessions(rows) {
  const list = [];
  for (const { pid, started, command } of rows) {
    const exe = command.split(/\s+/)[0];
    const base = exe.split(/[\\/]/).pop();
    if (base !== 'claude' && base !== 'claude.exe') continue;
    // Not interactive: headless/SDK runs and the browser helper.
    if (/\s(-p|--print)(\s|$)|--output-format|--input-format|stream-json|--chrome-native-host|--sdk|\bmcp\s+serve\b/.test(command)) continue;
    list.push({ pid, started, command: command.slice(0, 200) });
  }
  return list;
}

// Parse `ps -axo pid=,lstart=,command=` output into interactive Claude Code processes.
export function parsePs(out) {
  return claudeSessions(parsePsRows(out));
}

async function cwdOf(pid, platform) {
  if (platform === 'win32') return null; // Windows doesn't say
  try { return await fs.readlink(`/proc/${pid}/cwd`); } catch { /* not Linux */ }
  const out = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  return out.split('\n').find((l) => l.startsWith('n'))?.slice(1) ?? null;
}

let cache = { at: 0, list: [] };
export async function liveTerminals({ maxAgeMs = 8000, platform = process.platform, list: listFn = processList, folderOf = cwdOf } = {}) {
  if (Date.now() - cache.at < maxAgeMs) return cache.list;
  const procs = claudeSessions(await listFn({ platform }));
  const list = [];
  for (const p of procs) {
    const cwd = await folderOf(p.pid, platform);
    if (cwd === null && platform === 'win32') continue; // no folder: left out on Windows, never guessed
    list.push({ ...p, cwd });
  }
  cache = { at: Date.now(), list };
  return list;
}
