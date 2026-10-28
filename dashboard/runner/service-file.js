// service.json: how a command on this computer finds the running Ground Control (packet G step 6).
// The runner writes it in the state folder when it starts (mode 600: pid, port, its write token)
// and removes it when it stops. `ground-control resume <job>` (bin/ground-control.js) reads it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SERVICE_FILE = 'service.json';

/**
 * The state folder, by the host's own rule (dashboard/server.js): WORKSHOP_STATE_DIR, else in demo
 * mode the folder `state` next to WORKSHOP_FEATURES_DIR, else ~/.feature-workshop.
 */
export function stateDirFor(env = process.env, home = os.homedir()) {
  if (env.WORKSHOP_STATE_DIR) return path.resolve(env.WORKSHOP_STATE_DIR);
  if (env.WORKSHOP_DEMO) {
    const features = path.resolve(env.WORKSHOP_FEATURES_DIR || path.join(home, '.claude', 'feature-work'));
    return path.join(path.dirname(features), 'state');
  }
  return path.join(home, '.feature-workshop');
}

export const serviceFilePath = (stateDir) => path.join(stateDir, SERVICE_FILE);

/** Writes service.json (mode 600, also when it was there with looser permissions). */
export function writeServiceFile(stateDir, { pid = process.pid, port, host = '127.0.0.1', token }) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = serviceFilePath(stateDir);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ pid, host, port, token, startedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  return file;
}

/** service.json's contents, or null when there is none (or it can't be read). */
export function readServiceFile(stateDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(serviceFilePath(stateDir), 'utf8'));
    const pid = Number(raw?.pid);
    const port = Number(raw?.port);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port <= 0 || typeof raw.token !== 'string') return null;
    return { pid, port, host: typeof raw.host === 'string' ? raw.host : '127.0.0.1', token: raw.token, startedAt: raw.startedAt ?? null };
  } catch {
    return null;
  }
}

/** Removes service.json, only when it is this process's (pid). Returns whether it removed it. */
export function removeServiceFile(stateDir, { pid = process.pid } = {}) {
  const now = readServiceFile(stateDir);
  if (now && now.pid !== pid) return false;
  try { fs.unlinkSync(serviceFilePath(stateDir)); return true; } catch { return false; }
}
