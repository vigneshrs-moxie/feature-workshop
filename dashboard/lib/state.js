// The dashboard's own small state, kept outside ~/.claude:
//   sessions.json  which Claude Code session drives each job, and who took it over
//   audit.jsonl    everything sent or decided from the browser, with the exact words
// Default folder: ~/.feature-workshop (WORKSHOP_STATE_DIR overrides it).

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export class State {
  constructor(dir = process.env.WORKSHOP_STATE_DIR || path.join(os.homedir(), '.feature-workshop')) {
    this.dir = dir;
    this.sessionsFile = path.join(dir, 'sessions.json');
    this.auditFile = path.join(dir, 'audit.jsonl');
    this.sessions = null;
  }

  async #ensure() {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
  }

  async #writeJson(file, data) {
    await this.#ensure();
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(tmp, file);
  }

  // { [featureDir]: { sessionId, cwd, model, takenOverAt, startedFromWorkshop } }
  async allSessions() {
    if (!this.sessions) {
      try { this.sessions = JSON.parse(await fs.readFile(this.sessionsFile, 'utf8')); } catch { this.sessions = {}; }
    }
    return this.sessions;
  }

  async sessionFor(featureDir) {
    return (await this.allSessions())[featureDir] ?? null;
  }

  async setSession(featureDir, patch) {
    const all = await this.allSessions();
    all[featureDir] = { ...(all[featureDir] ?? {}), ...patch, updatedAt: new Date().toISOString() };
    await this.#writeJson(this.sessionsFile, all);
    return all[featureDir];
  }

  async audit(entry) {
    await this.#ensure();
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n';
    await fs.appendFile(this.auditFile, line, { mode: 0o600 });
  }

  // The last reply sent from the dashboard that ended, per job: { [featureDir]: { at, status, sessionId } }.
  async lastRunEnds() {
    let text = '';
    try { text = await fs.readFile(this.auditFile, 'utf8'); } catch { return {}; }
    const out = {};
    for (const l of text.trim().split('\n')) {
      let e;
      try { e = JSON.parse(l); } catch { continue; }
      if (e?.action === 'run-ended' && e.featureDir) out[e.featureDir] = { at: e.at, status: e.status, sessionId: e.sessionId };
    }
    return out;
  }

  async auditFor(featureDir, limit = 200) {
    let text = '';
    try { text = await fs.readFile(this.auditFile, 'utf8'); } catch { return []; }
    return text.trim().split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.featureDir === featureDir)
      .slice(-limit);
  }
}
