// Starbase's own small state, kept outside ~/.claude:
//   sessions.json  which Claude Code session drives each job, and who took it over
//   audit.jsonl    everything sent or decided from the browser, with the exact words
// Default folder: ~/.starbase (STARBASE_STATE_DIR overrides it). Where it is, and its moves from
// the folders it had before, are lib/state-folder.js.

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { playSettings } from './play.js';
import { notifySettings } from './notify.js';
import { DEFAULT_FINISH_LINE, finishLineOf } from './finish.js';
import { WORKFLOW_CHOICES } from './options.js';
import { scrub } from './orbit.js';
import { PRODUCT } from './brand.js';
import { normalizeAutoStart } from './auto-start.js';
import { prepareStateFolder } from './state-folder.js';

/** Screens (wireframes) and Clarify questions for new jobs: Auto (the workflow decides), Always, or Off (lib/options.js). */
export { WORKFLOW_CHOICES };
export const workflowChoiceOf = (raw) => (WORKFLOW_CHOICES.includes(raw) ? raw : 'auto');

/**
 * The workflow settings with defaults filled in (Settings → Workflow): { finishLine } (lib/finish.js),
 * and for new jobs `wireframes` and `clarify` ('auto' | 'always' | 'off', default auto); a new job's
 * options.json copies those two (lib/options.js normalize). autoLevel: "Choose the level for me"
 * (lib/auto-level.js), off unless set to true. autoStart: { on, tag } (lib/auto-start.js), off with no tag. sectionsAtOnce: how many sections of stacks (plan §6.2)
 * run at once across every stack, 1 to 20, default 3 (lib/stack.js DEFAULT_CAP and MAX_CAP; saved
 * by POST /api/stacks/cap). It is there only once it has been set: until then the default holds,
 * and the first stack started takes the integration board's "packets at once" (integrate.json).
 */
export const SECTIONS_AT_ONCE = Object.freeze({ default: 3, max: 20 });
export const sectionsAtOnceOf = (raw) => (Number.isInteger(raw) && raw >= 1 && raw <= SECTIONS_AT_ONCE.max ? raw : SECTIONS_AT_ONCE.default);
export function workflowSettings(raw = {}) {
  const w = raw && typeof raw === 'object' ? raw : {};
  return { finishLine: finishLineOf(w.finishLine), wireframes: workflowChoiceOf(w.wireframes), clarify: workflowChoiceOf(w.clarify), autoLevel: w.autoLevel === true, inboxSuggest: w.inboxSuggest !== false, autoStart: normalizeAutoStart(w.autoStart), ...(w.sectionsAtOnce !== undefined ? { sectionsAtOnce: sectionsAtOnceOf(w.sectionsAtOnce) } : {}) };
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

// ---------- The state folder (lib/state-folder.js) ----------

/** The product's name (lib/brand.js), kept here too for the files that read it from state.js. */
export { PRODUCT };
export {
  GC_STATE_FOLDER, LEFT_ALONE_NOTE, MOVED_NOTE, MOVED_TO_STARBASE, OLD_STATE_FOLDER, STATE_FOLDER,
  defaultStateDir, moveOldState, moveToStarbase, prepareStateFolder, stateDirFor, stateDirNow,
} from './state-folder.js';
import { writeFileAtomic } from './atomic-write.js';

/**
 * One folder's audit lines (oldest first) cut at its last restart: a successful restart writes a
 * `restart` line before the new job's first line, and the lines before it belong to the old job.
 * A restart that failed and put everything back says so (`restart-failed` with `afterBoundary`), and
 * its boundary no longer counts.
 */
export function sinceRestart(lines) {
  const marks = [];
  lines.forEach((e, i) => {
    if (e?.action === 'restart') marks.push(i);
    else if (e?.action === 'restart-failed' && e.afterBoundary === true) marks.pop();
  });
  return marks.length ? lines.slice(marks.at(-1)) : lines;
}

/**
 * Each folder's last restart that still counts, by sinceRestart's rule: { [featureDir]: at }. A folder
 * with none is not there. Session logs that ended at or before it are the old job's (lib/features.js).
 */
export function restartTimes(lines) {
  const marks = new Map(); // featureDir → the times of its restarts that still count
  for (const e of lines) {
    if (!e?.featureDir) continue;
    if (e.action === 'restart') { if (!marks.has(e.featureDir)) marks.set(e.featureDir, []); marks.get(e.featureDir).push(e.at); }
    else if (e.action === 'restart-failed' && e.afterBoundary === true) marks.get(e.featureDir)?.pop();
  }
  const out = {};
  for (const [dir, times] of marks) if (times.length && times.at(-1)) out[dir] = times.at(-1);
  return out;
}

// Emits 'audit' (the entry as written) after each audit line is saved, so live views can say
// which job's conversation just changed.
export class State extends EventEmitter {
  // With no folder named (and no STARBASE_STATE_DIR) it is ~/.starbase, and the old folders are
  // moved into it first, once (prepareStateFolder).
  constructor(dir = process.env.STARBASE_STATE_DIR || null) {
    super();
    if (!dir) {
      const r = prepareStateFolder();
      dir = r.dir;
      for (const line of r.lines) console.log(`state: ${line}`);
    }
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
      await writeFileAtomic(file, text, { mode: 0o600 });
    });
    this.#writing.set(file, mine);
    try { await mine; } finally { if (this.#writing.get(file) === mine) this.#writing.delete(file); }
  }

  // { [featureDir]: { sessionId, cwd, model, takenOverAt, startedFromWorkshop, closed, auto } }
  // auto: Auto mode's record (lib/auto.js), the only thing that says a job is in Auto.
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

  /** Forget a job's session record (its Foreman); the caller has kept a copy. */
  // The file is written first; the record is forgotten in memory only once that write worked, so a
  // failed write leaves memory matching the file.
  async clearSession(featureDir) {
    const all = await this.allSessions();
    if (!(featureDir in all)) return;
    const record = all[featureDir];
    const { [featureDir]: _left, ...rest } = all;
    await this.#writeJson(this.sessionsFile, rest);
    if (all[featureDir] === record) delete all[featureDir]; // unless it was set again meanwhile
    // A write queued while this one ran took its picture with the record in it: write once more without it.
    if (this.#writing.has(this.sessionsFile)) await this.#writeJson(this.sessionsFile, all);
  }

  // Starbase's settings.
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

  /**
   * The permission setting for one job: 'auto' while the job's Auto is on (its record here, lib/auto.js),
   * else its own, else the global one. Turning Auto off leaves the job's own setting as it was.
   */
  async policyFor(featureDir) {
    if (featureDir && (await this.sessionFor(featureDir))?.auto?.on === true) return 'auto';
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
    // Every line through the scrubber (lib/orbit.js): no token or key ever reaches the audit.
    const line = scrub(JSON.stringify({ at: new Date().toISOString(), ...entry }));
    await fs.appendFile(this.auditFile, line + '\n', { mode: 0o600 });
    this.#auditParsed = null;
    try { this.emit('audit', JSON.parse(line)); } catch { /* a listener's problem must not fail the write */ }
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

  // Every audit entry, oldest first (unreadable lines left out). The parsed file is kept and reused
  // while its size and modified time are unchanged (one parse serves every job and every caller);
  // a write through audit() drops it. The list is a copy, so what a caller does to it stays its own.
  #auditParsed = null; // { size, mtimeMs, entries }
  auditParses = 0;
  async auditAll() {
    let st;
    try { st = await fs.stat(this.auditFile); } catch { this.#auditParsed = null; return []; }
    const kept = this.#auditParsed;
    if (kept && kept.size === st.size && kept.mtimeMs === st.mtimeMs) return [...kept.entries];
    let text = '';
    try { text = await fs.readFile(this.auditFile, 'utf8'); } catch { return []; }
    this.auditParses++;
    const entries = text.trim().split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    this.#auditParsed = { size: st.size, mtimeMs: st.mtimeMs, entries };
    return [...entries];
  }

  /**
   * One job folder's lines, oldest first, from its last restart on (the `restart` line included), then the
   * newest `limit`. A restart starts a new job in the same folder; the old job's lines stay in the file
   * and are not the new job's. `limit` Infinity keeps all of them.
   */
  async auditFor(featureDir, limit = 200) {
    return sinceRestart((await this.auditAll()).filter((e) => e.featureDir === featureDir)).slice(-limit);
  }
}
