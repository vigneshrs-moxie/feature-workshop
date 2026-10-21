// The dashboard's own small state, kept outside ~/.claude:
//   sessions.json  which Claude Code session drives each job, and who took it over
//   audit.jsonl    everything sent or decided from the browser, with the exact words
// Default folder: ~/.feature-workshop (WORKSHOP_STATE_DIR overrides it).

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { playSettings } from './play.js';
import { notifySettings } from './notify.js';
import { DEFAULT_FINISH_LINE, finishLineOf } from './finish.js';
import { WORKFLOW_CHOICES } from './options.js';

/** Screens (wireframes) and Clarify questions for new jobs: Auto (the workflow decides), Always, or Off (lib/options.js). */
export { WORKFLOW_CHOICES };
export const workflowChoiceOf = (raw) => (WORKFLOW_CHOICES.includes(raw) ? raw : 'auto');

/**
 * The workflow settings with defaults filled in (Settings → Workflow): { finishLine } (lib/finish.js),
 * and for new jobs `wireframes` and `clarify` ('auto' | 'always' | 'off', default auto); a new job's
 * options.json copies those two (lib/options.js normalize).
 */
export function workflowSettings(raw = {}) {
  const w = raw && typeof raw === 'object' ? raw : {};
  return { finishLine: finishLineOf(w.finishLine), wireframes: workflowChoiceOf(w.wireframes), clarify: workflowChoiceOf(w.clarify) };
}

// Settings from before the finish line kept the quest rule under play.questDone. The first read
// moves it: 'first-pr' → PR #1 open, 'marked-done' → when I mark it done. Returns the settings to
// keep and whether anything moved (then they are written back once).
const QUEST_DONE_TO_FINISH_LINE = { 'first-pr': 'pr1-open', 'marked-done': 'marked' };
export function migrateSettings(raw) {
  const s = raw && typeof raw === 'object' ? { ...raw } : {};
  const old = s.play && typeof s.play === 'object' ? s.play.questDone : undefined;
  if (old === undefined) return { settings: s, changed: false };
  const { questDone, ...play } = s.play;
  s.play = play;
  if (!s.workflow?.finishLine) s.workflow = { ...(s.workflow ?? {}), finishLine: QUEST_DONE_TO_FINISH_LINE[questDone] ?? DEFAULT_FINISH_LINE };
  return { settings: s, changed: true };
}

// Emits 'audit' (the entry as written) after each audit line is saved, so live views can say
// which job's conversation just changed.
export class State extends EventEmitter {
  constructor(dir = process.env.WORKSHOP_STATE_DIR || path.join(os.homedir(), '.feature-workshop')) {
    super();
    this.dir = dir;
    this.sessionsFile = path.join(dir, 'sessions.json');
    this.auditFile = path.join(dir, 'audit.jsonl');
    this.settingsFile = path.join(dir, 'settings.json');
    this.sessions = null;
    this.settings = null;
  }

  async #ensure() {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
  }

  // Writes to one file go one after another, each through its own temp file. Two at once (a
  // route and a run's first message both patching sessions.json) would otherwise write and rename
  // the same temp file, and the second rename would fail (ENOENT) and end the run in error.
  #writing = new Map();
  async #writeJson(file, data) {
    const text = JSON.stringify(data, null, 2); // this write's picture of the data, taken now
    const after = this.#writing.get(file) ?? Promise.resolve();
    const mine = after.catch(() => {}).then(async () => {
      await this.#ensure();
      const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
      await fs.writeFile(tmp, text, { mode: 0o600 });
      await fs.rename(tmp, file);
    });
    this.#writing.set(file, mine);
    try { await mine; } finally { if (this.#writing.get(file) === mine) this.#writing.delete(file); }
  }

  // { [featureDir]: { sessionId, cwd, model, takenOverAt, startedFromWorkshop } }
  async allSessions() {
    if (!this.sessions) {
      // One read, shared by everyone who asks while it is under way: callers patching at the same
      // moment must patch the same object, or all but the last patch would be lost.
      this.#loadingSessions ??= fs.readFile(this.sessionsFile, 'utf8').then((text) => JSON.parse(text)).catch(() => ({}));
      const loaded = await this.#loadingSessions;
      this.sessions ??= loaded;
    }
    return this.sessions;
  }
  #loadingSessions = null;

  async sessionFor(featureDir) {
    return (await this.allSessions())[featureDir] ?? null;
  }

  async setSession(featureDir, patch) {
    const all = await this.allSessions();
    all[featureDir] = { ...(all[featureDir] ?? {}), ...patch, updatedAt: new Date().toISOString() };
    await this.#writeJson(this.sessionsFile, all);
    return all[featureDir];
  }

  // Dashboard settings.
  //   policy     'hands-off' (routine steps automatic), 'ask-all' or 'auto' (Claude Code's auto mode)
  //   jobPolicy  { [featureDir]: policy }: jobs that override it
  //   autoMode   { available: true | false | null (not tried yet), reason, checkedAt }
  //   play       { mode: 'subtle' | 'full' | 'off', sounds } (lib/play.js)
  //   notify     notifications outside the browser: levels, quiet hours (lib/notify.js)
  //   workflow   { finishLine, wireframes, clarify }: what counts as done (lib/finish.js), and the
  //              screens and clarify defaults for new jobs
  async getSettings() {
    if (!this.settings) {
      let raw;
      try { raw = JSON.parse(await fs.readFile(this.settingsFile, 'utf8')); } catch { raw = {}; }
      const { settings, changed } = migrateSettings(raw);
      this.settings = settings;
      if (changed) { try { await this.#writeJson(this.settingsFile, this.settings); } catch { /* read again next start; the move is harmless to repeat */ } }
    }
    return {
      policy: 'hands-off', jobPolicy: {}, autoMode: { available: null, reason: null, checkedAt: null }, ...this.settings,
      play: playSettings(this.settings.play), notify: notifySettings(this.settings.notify), workflow: workflowSettings(this.settings.workflow),
    };
  }

  /** The permission setting for one job: its own, else the global one. */
  async policyFor(featureDir) {
    const s = await this.getSettings();
    return (featureDir && s.jobPolicy?.[featureDir]) || s.policy;
  }

  /** Set (or with null, clear) one job's own permission setting. */
  async setJobPolicy(featureDir, policy) {
    const s = await this.getSettings();
    const jobPolicy = { ...(s.jobPolicy ?? {}) };
    if (policy) jobPolicy[featureDir] = policy; else delete jobPolicy[featureDir];
    return this.setSettings({ jobPolicy });
  }

  async setSettings(patch) {
    this.settings = { ...(await this.getSettings()), ...patch };
    await this.#writeJson(this.settingsFile, this.settings);
    return this.settings;
  }

  async audit(entry) {
    await this.#ensure();
    const record = { at: new Date().toISOString(), ...entry };
    await fs.appendFile(this.auditFile, JSON.stringify(record) + '\n', { mode: 0o600 });
    try { this.emit('audit', record); } catch { /* a listener's problem must not fail the write */ }
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

  // Every audit entry, oldest first (unreadable lines left out).
  async auditAll() {
    let text = '';
    try { text = await fs.readFile(this.auditFile, 'utf8'); } catch { return []; }
    return text.trim().split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  }

  async auditFor(featureDir, limit = 200) {
    return (await this.auditAll()).filter((e) => e.featureDir === featureDir).slice(-limit);
  }
}
