// One demo dashboard for a server test: its own free ports for PORT and WIREFRAMES_PORT (so two
// tests running at once never share a screens port), WORKSHOP_DEMO=1 (a pretend Foreman: no model
// calls), the test's own state folders, and a stop() that stops the whole process tree and always
// returns, even when the dashboard has already exited.
//
//   const d = await startDashboard({ env: { HOME: home, WORKSHOP_FEATURES_DIR: … }, stateDir, output });
//   d.base, d.port, d.screensPort, d.token, d.child, d.output; await d.stop();
//
// HOME is copied to USERPROFILE, which is where Windows looks for the home folder, so a test's
// pretend home is the home on every system.

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killTree } from '../../lib/platform.js';

export const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'server.js');

// Ports are picked at random from 20000 to 31999, below the range the system hands out for
// outgoing connections and listen(0) (macOS and Windows from 49152, Linux from 32768): a port
// taken from that range is soon handed out again, often before the dashboard listens on it.
const LOW = 20000;
const HIGH = 32000;
const handedOut = new Set();
const canListen = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});

/** A port nobody is listening on right now, not one of `not` nor one this file was given before. */
export async function freePort(not = []) {
  for (let i = 0; i < 200; i++) {
    const port = LOW + Math.floor(Math.random() * (HIGH - LOW));
    if (not.includes(port) || handedOut.has(port)) continue;
    if (await canListen(port)) { handedOut.add(port); return port; }
  }
  throw new Error('No free port found for the test dashboard.');
}

// Dashboards still running when the test file ends are stopped with it.
const running = new Set();
process.on('exit', () => {
  for (const child of running) {
    if (process.platform === 'win32') { try { child.kill(); } catch { /* gone */ } } else killTree(child.pid, { signal: 'SIGKILL' });
  }
});

const exited = (child, ms) => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
  const timer = setTimeout(() => resolve(false), ms);
  child.once('exit', () => { clearTimeout(timer); resolve(true); });
});

/**
 * Start server.js and wait for its first line. env: added to (and over) process.env, after
 * WORKSHOP_DEMO=1; stateDir: WORKSHOP_STATE_DIR; output: an array the dashboard's output is pushed
 * to (the test's own, for its messages); ready: what the first line says. Rejects with the output
 * when the dashboard exits or says nothing in time (and stops it first).
 */
export async function startDashboard(opts = {}) {
  for (let attempt = 1; ; attempt++) {
    const length = opts.output?.length ?? 0;
    try {
      return await startOnce(opts);
    } catch (err) {
      // Its port was taken between the check and the listen: once more on other ports.
      if (attempt >= 3 || !/EADDRINUSE/.test(err.message)) throw err;
      opts.output?.splice(length);
    }
  }
}

async function startOnce({ env = {}, stateDir = null, output = [], ready = 'running at', startMs = 20_000 } = {}) {
  const port = await freePort();
  const screensPort = await freePort([port]);
  const childEnv = { ...process.env, WORKSHOP_DEMO: '1', ...env, PORT: String(port), WIREFRAMES_PORT: String(screensPort) };
  if (stateDir) childEnv.WORKSHOP_STATE_DIR = stateDir;
  if (env.HOME && !env.USERPROFILE) childEnv.USERPROFILE = env.HOME;
  const child = spawn(process.execPath, [SERVER], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
  running.add(child);
  child.once('exit', () => running.delete(child));
  // A test that times out never reaches its own stop(): the dashboard then doesn't hold the test
  // file open, and is stopped when the file ends (above).
  child.unref();
  child.stdout.unref?.();
  child.stderr.unref?.();

  async function stop() {
    if (await exited(child, 0)) return;
    killTree(child.pid, { signal: 'SIGTERM' }); // exactly the dashboard this test started, and what it started
    if (await exited(child, 10_000)) return;
    killTree(child.pid, { signal: 'SIGKILL' });
    await exited(child, 5_000);
  }

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`The dashboard didn't start:\n${output.join('')}`)), startMs);
      child.stdout.on('data', (d) => { output.push(String(d)); if (output.join('').includes(ready)) { clearTimeout(timer); resolve(); } });
      child.stderr.on('data', (d) => output.push(String(d)));
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`The dashboard exited (${code}):\n${output.join('')}`)); });
    });
  } catch (err) {
    await stop();
    throw err;
  }
  const base = `http://127.0.0.1:${port}`;
  let token = null;
  try { token = (await (await fetch(`${base}/api/meta`)).json()).token ?? null; } catch { /* the test reads it itself */ }
  return { port, screensPort, base, token, child, output, stop };
}
