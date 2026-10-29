// The dashboard's own small state, kept outside ~/.claude:
//   sessions.json  which Claude Code session drives each job, and who took it over
//   audit.jsonl    everything sent or decided from the browser, with the exact words
// Default folder: ~/.ground-control (WORKSHOP_STATE_DIR overrides it). Before packet I it was
// ~/.feature-workshop: the first start with the new default moves those files across once
// (moveOldState below).

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { playSettings } from './play.js';
import { notifySettings } from './notify.js';
import { DEFAULT_FINISH_LINE, finishLineOf } from './finish.js';
import { WORKFLOW_CHOICES } from './options.js';
import { scrub } from './orbit.js';

/** Screens (wireframes) and Clarify questions for new jobs: Auto (the workflow decides), Always, or Off (lib/options.js). */
export { WORKFLOW_CHOICES };
export const workflowChoiceOf = (raw) => (WORKFLOW_CHOICES.includes(raw) ? raw : 'auto');

/**
 * The workflow settings with defaults filled in (Settings → Workflow): { finishLine } (lib/finish.js),
 * and for new jobs `wireframes` and `clarify` ('auto' | 'always' | 'off', default auto); a new job's
 * options.json copies those two (lib/options.js normalize). autoLevel: "Choose the level for me"
 * (lib/auto-level.js), off unless set to true. sectionsAtOnce: how many sections of stacks (plan §6.2)
 * run at once across every stack, 1 to 20, default 3 (lib/stack.js DEFAULT_CAP and MAX_CAP; saved
 * by POST /api/stacks/cap). It is there only once it has been set: until then the default holds,
 * and the first stack started takes the integration board's "packets at once" (integrate.json).
 */
export const SECTIONS_AT_ONCE = Object.freeze({ default: 3, max: 20 });
export const sectionsAtOnceOf = (raw) => (Number.isInteger(raw) && raw >= 1 && raw <= SECTIONS_AT_ONCE.max ? raw : SECTIONS_AT_ONCE.default);
export function workflowSettings(raw = {}) {
  const w = raw && typeof raw === 'object' ? raw : {};
  return { finishLine: finishLineOf(w.finishLine), wireframes: workflowChoiceOf(w.wireframes), clarify: workflowChoiceOf(w.clarify), autoLevel: w.autoLevel === true, ...(w.sectionsAtOnce !== undefined ? { sectionsAtOnce: sectionsAtOnceOf(w.sectionsAtOnce) } : {}) };
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

// ---------- The state folder ----------

/**
 * The product's name in every sentence a person reads (the CLI, doctor, the service, update, the
 * move note). "Ground Control" is a working name: change it here, and only here.
 */
export const PRODUCT = 'Ground Control';

/** The state folder's name in the home folder, and the one it had before (plan G31). */
export const STATE_FOLDER = '.ground-control';
export const OLD_STATE_FOLDER = '.feature-workshop';
/** The note left in the old folder once its files have moved. */
export const MOVED_NOTE = 'MOVED.txt';
// service.json belongs to the copy that wrote it: a stopped one's is stale, a running one's is its own.
const NOT_MOVED = new Set([MOVED_NOTE, 'service.json', 'stop-request']);

/** ~/.ground-control: the state folder when WORKSHOP_STATE_DIR doesn't name one. */
export const defaultStateDir = (home = os.homedir()) => path.join(home, STATE_FOLDER);

const pidAliveHere = (pid) => {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
};

/**
 * The one-time move from ~/.feature-workshop to ~/.ground-control (packet I step 7). It happens
 * when the old folder exists, has not been moved before (no MOVED.txt in it), and the new folder has
 * no settings.json yet. Each file or folder in the old folder is moved across unless the new folder
 * already has one by that name (integrate.json and usage.jsonl live there already): that one is
 * kept, and the old one stays where it was. Then one audit line `state-moved` goes into the new
 * folder's audit.jsonl and MOVED.txt is left in the old folder saying where everything went.
 *
 * Not while a copy of Ground Control from before the move is still running from the old folder
 * (its service.json names a live process): its files would move out from under it. It happens on
 * the first start after that one has stopped.
 *
 * Returns { moved: [names], kept: [names], from, to } when it moved, else null with `why`
 * in { skipped }. Never throws: a move that fails partway says so in `error`.
 */
export function moveOldState({ home = os.homedir(), now = () => new Date(), alive = pidAliveHere } = {}) {
  const from = path.join(home, OLD_STATE_FOLDER);
  const to = defaultStateDir(home);
  const isDir = (p) => { try { return fsSync.statSync(p).isDirectory(); } catch { return false; } };
  const has = (p) => { try { fsSync.lstatSync(p); return true; } catch { return false; } };
  if (!isDir(from)) return { skipped: 'no-old-folder' };
  if (has(path.join(from, MOVED_NOTE))) return { skipped: 'moved-before' };
  if (has(path.join(to, 'settings.json'))) return { skipped: 'already-set-up' };
  try {
    const old = JSON.parse(fsSync.readFileSync(path.join(from, 'service.json'), 'utf8'));
    if (Number.isInteger(old?.pid) && old.pid !== process.pid && alive(old.pid)) return { skipped: 'old-copy-running', pid: old.pid };
  } catch { /* none, or unreadable: nothing is running from there */ }

  fsSync.mkdirSync(to, { recursive: true, mode: 0o700 });
  const moved = [];
  const kept = [];
  let error = null;
  for (const name of fsSync.readdirSync(from).sort()) {
    if (NOT_MOVED.has(name)) continue;
    const src = path.join(from, name);
    const dest = path.join(to, name);
    if (has(dest)) { kept.push(name); continue; }
    try {
      try { fsSync.renameSync(src, dest); } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        fsSync.cpSync(src, dest, { recursive: true, preserveTimestamps: true });
        fsSync.rmSync(src, { recursive: true, force: true });
      }
      moved.push(name);
    } catch (err) {
      error = `${name} couldn’t be moved (${err.code ?? err.message}).`;
      break;
    }
  }
  const at = now().toISOString();
  const entry = { at, action: 'state-moved', from, to, moved, kept, ...(error ? { error } : {}) };
  try { fsSync.appendFileSync(path.join(to, 'audit.jsonl'), `${JSON.stringify(entry)}\n`, { mode: 0o600 }); } catch { /* the note below still says it */ }
  const lines = [
    `${PRODUCT} moved its files from this folder to ${to} on ${at}.`,
    '',
    moved.length ? `Moved: ${moved.join(', ')}.` : 'Nothing needed moving.',
    ...(kept.length ? [`Left here, because ${to} already had its own copy: ${kept.join(', ')}.`] : []),
    ...(error ? [`Stopped early: ${error} Whatever is still here wasn’t moved; move it by hand.`] : []),
    '',
    `${PRODUCT} doesn’t read this folder any more. Once you have checked that nothing you need is left, you can delete it.`,
    '',
  ];
  try { fsSync.writeFileSync(path.join(from, MOVED_NOTE), lines.join('\n'), { mode: 0o600 }); } catch { /* the audit line still says it */ }
  return { moved, kept, from, to, ...(error ? { error } : {}) };
}

/**
 * Where the state is right now, without moving anything: ~/.feature-workshop while it is still
 * waiting for its one-time move (it exists, has no MOVED.txt, and ~/.ground-control has no
 * settings.json), else ~/.ground-control.
 */
export function stateDirNow(home = os.homedir()) {
  const from = path.join(home, OLD_STATE_FOLDER);
  const to = defaultStateDir(home);
  const has = (p) => { try { fsSync.lstatSync(p); return true; } catch { return false; } };
  const waiting = (() => { try { return fsSync.statSync(from).isDirectory(); } catch { return false; } })()
    && !has(path.join(from, MOVED_NOTE)) && !has(path.join(to, 'settings.json'));
  return waiting ? from : to;
}

/**
 * The state folder by the host's rule (dashboard/server.js): WORKSHOP_STATE_DIR, else in demo mode
 * the folder `state` next to WORKSHOP_FEATURES_DIR, else stateDirNow().
 */
export function stateDirFor(env = process.env, home = os.homedir()) {
  if (env.WORKSHOP_STATE_DIR) return path.resolve(env.WORKSHOP_STATE_DIR);
  if (env.WORKSHOP_DEMO) {
    const features = path.resolve(env.WORKSHOP_FEATURES_DIR || path.join(home, '.claude', 'feature-work'));
    return path.join(path.dirname(features), 'state');
  }
  return stateDirNow(home);
}

// Emits 'audit' (the entry as written) after each audit line is saved, so live views can say
// which job's conversation just changed.
export class State extends EventEmitter {
  // With no folder named (and no WORKSHOP_STATE_DIR) it is ~/.ground-control, and the old
  // ~/.feature-workshop is moved into it first, once (moveOldState).
  constructor(dir = process.env.WORKSHOP_STATE_DIR || null) {
    super();
    if (!dir) {
      const r = moveOldState();
      dir = stateDirNow();
      if (r.moved) console.log(`state: moved ${r.moved.length} item${r.moved.length === 1 ? '' : 's'} from ${r.from} to ${r.to}${r.kept.length ? ` (kept the copies already there of ${r.kept.join(', ')})` : ''}${r.error ? `; ${r.error}` : ''}. A note is left in the old folder.`);
      else if (r.skipped === 'old-copy-running') console.log(`state: ${dir} is still in use by another copy of ${PRODUCT} (pid ${r.pid}), so this one uses it too; it moves to ~/${STATE_FOLDER} on the first start after that copy stops.`);
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
    // Every line through the scrubber (lib/orbit.js): no token or key ever reaches the audit.
    const line = scrub(JSON.stringify({ at: new Date().toISOString(), ...entry }));
    await fs.appendFile(this.auditFile, line + '\n', { mode: 0o600 });
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
