// Claude Code sessions open in terminals right now, from the operating system's process list.
// No logs or settings needed: each interactive `claude` process and the folder it runs in.
// Headless runs (this dashboard's own, `claude -p`, the SDK) and helper processes are left out.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout));
});

// Parse `ps -axo pid=,lstart=,command=` output into interactive Claude Code processes.
export function parsePs(out) {
  const list = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, pid, started, command] = m;
    const exe = command.split(/\s+/)[0];
    const base = exe.split('/').pop();
    if (base !== 'claude' && base !== 'claude.exe') continue;
    // Not interactive: headless/SDK runs and the browser helper.
    if (/\s(-p|--print)(\s|$)|--output-format|--input-format|stream-json|--chrome-native-host|--sdk|\bmcp\s+serve\b/.test(command)) continue;
    list.push({ pid: Number(pid), started: new Date(started).toISOString(), command: command.slice(0, 200) });
  }
  return list;
}

async function cwdOf(pid) {
  try { return await fs.readlink(`/proc/${pid}/cwd`); } catch { /* not Linux */ }
  const out = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  return out.split('\n').find((l) => l.startsWith('n'))?.slice(1) ?? null;
}

let cache = { at: 0, list: [] };
export async function liveTerminals({ maxAgeMs = 8000 } = {}) {
  if (Date.now() - cache.at < maxAgeMs) return cache.list;
  const procs = parsePs(await run('ps', ['-axo', 'pid=,lstart=,command=']));
  const list = [];
  for (const p of procs) list.push({ ...p, cwd: await cwdOf(p.pid) });
  cache = { at: Date.now(), list };
  return list;
}
