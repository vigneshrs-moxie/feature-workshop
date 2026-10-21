// Notifications outside the browser: the dashboard itself tells macOS, so they arrive with the
// dashboard's tab closed or the browser hidden. terminal-notifier when it's installed (clicking
// opens the job), else macOS's built-in notifier (osascript; a click can't open the job).
//
// Three levels, each sound, silent or off (settings `notify`):
//   needs    something waits for you: a go-ahead, a question, a permission, a decision parked 4 h
//   problem  a reply ended in an error, or the usage limit stopped the work
//   done     a job's work reached staging or main, or you marked it done
// Quiet hours (off by default): only problems show, silently; the rest is kept in the history.
// While you're looking at the dashboard (the page says when it's visible), nothing pops: the page
// shows it already. Every notification, sent or not, goes into the history (the last 50).
// A notification only opens the page; it never approves, answers or sends anything.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export const LEVELS = ['needs', 'problem', 'done'];
export const MODES = ['sound', 'silent', 'off'];
export const NOTIFY_DEFAULTS = {
  enabled: true,
  levels: { needs: 'sound', problem: 'sound', done: 'silent' },
  quiet: { on: false, from: '22:00', to: '07:00' },
  skipWhenWatching: true,
};
const SOUNDS = { needs: 'Glass', problem: 'Basso', done: 'Pop' };
const HISTORY_MAX = 50;
const WATCHING_MS = 45000;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The notification settings with defaults filled in. */
export function notifySettings(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const levels = { ...NOTIFY_DEFAULTS.levels };
  for (const l of LEVELS) if (MODES.includes(r.levels?.[l])) levels[l] = r.levels[l];
  const quiet = { ...NOTIFY_DEFAULTS.quiet };
  if (typeof r.quiet?.on === 'boolean') quiet.on = r.quiet.on;
  for (const k of ['from', 'to']) if (TIME.test(r.quiet?.[k] ?? '')) quiet[k] = r.quiet[k];
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : NOTIFY_DEFAULTS.enabled,
    levels, quiet,
    skipWhenWatching: typeof r.skipWhenWatching === 'boolean' ? r.skipWhenWatching : NOTIFY_DEFAULTS.skipWhenWatching,
  };
}

/** A patch from the page, checked; throws with a plain message when something isn't allowed. */
export function validateNotifyPatch(patch, current) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('The notification settings must be an object.');
  const next = notifySettings(current);
  for (const key of Object.keys(patch)) if (!['enabled', 'levels', 'quiet', 'skipWhenWatching'].includes(key)) throw new Error(`Unknown notification setting: ${key}.`);
  if ('enabled' in patch) { if (typeof patch.enabled !== 'boolean') throw new Error('“enabled” must be true or false.'); next.enabled = patch.enabled; }
  if ('skipWhenWatching' in patch) { if (typeof patch.skipWhenWatching !== 'boolean') throw new Error('“skipWhenWatching” must be true or false.'); next.skipWhenWatching = patch.skipWhenWatching; }
  for (const [l, m] of Object.entries(patch.levels ?? {})) {
    if (!LEVELS.includes(l)) throw new Error(`Unknown level: ${l}.`);
    if (!MODES.includes(m)) throw new Error(`A level is ${MODES.join(', ')}.`);
    next.levels[l] = m;
  }
  if (patch.quiet) {
    if ('on' in patch.quiet) { if (typeof patch.quiet.on !== 'boolean') throw new Error('Quiet hours are on or off.'); next.quiet.on = patch.quiet.on; }
    for (const k of ['from', 'to']) {
      if (!(k in patch.quiet)) continue;
      if (!TIME.test(patch.quiet[k])) throw new Error('Quiet hours are times like 22:00.');
      next.quiet[k] = patch.quiet[k];
    }
  }
  return next;
}

/** Whether `date` (local time) falls in the quiet hours; they may run past midnight. */
export function inQuietHours(quiet, date = new Date()) {
  if (!quiet?.on) return false;
  const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const now = date.getHours() * 60 + date.getMinutes();
  const from = mins(quiet.from);
  const to = mins(quiet.to);
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

/** What happens to one notification: { send: boolean, sound: boolean, why }. */
export function decide(level, settings, { now = new Date(), watching = false, demo = false } = {}) {
  const s = notifySettings(settings);
  const mode = s.levels[level] ?? 'off';
  if (!s.enabled) return { send: false, sound: false, why: 'Notifications are off.' };
  if (mode === 'off') return { send: false, sound: false, why: 'This kind is off.' };
  if (demo) return { send: false, sound: false, why: 'Demo: nothing is sent to macOS (the test is).' };
  if (s.skipWhenWatching && watching) return { send: false, sound: false, why: 'You were looking at the dashboard.' };
  if (inQuietHours(s.quiet, now)) return level === 'problem' ? { send: true, sound: false, why: 'Quiet hours: shown without a sound.' } : { send: false, sound: false, why: 'Quiet hours.' };
  return { send: true, sound: mode === 'sound', why: null };
}

// AppleScript string literal.
const as = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// { ok, err }: err is the command's first line of complaint.
function exec(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 10000, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, err: err ? String(stderr || stdout || err.message).trim().split('\n')[0] : null })));
}
const succeeded = (r) => r === true || r?.ok === true;

/** Which way notifications can reach macOS here: 'terminal-notifier', 'osascript' or null. */
export async function findMethod({ platform = process.platform, which = async (c) => succeeded(await exec('/usr/bin/which', [c])) } = {}) {
  if (platform !== 'darwin') return null;
  if (await which('terminal-notifier')) return 'terminal-notifier';
  return (await which('osascript')) ? 'osascript' : null;
}

/** The command that shows one notification. */
export function commandFor(method, { title, subtitle, body, url, group, sound }) {
  if (method === 'terminal-notifier') {
    return ['terminal-notifier', ['-title', title, ...(subtitle ? ['-subtitle', subtitle] : []), '-message', body || ' ', ...(url ? ['-open', url] : []), ...(group ? ['-group', group] : []), ...(sound ? ['-sound', sound] : [])]];
  }
  if (method === 'osascript') {
    return ['osascript', ['-e', `display notification ${as(body || ' ')} with title ${as(title)}${subtitle ? ` subtitle ${as(subtitle)}` : ''}${sound ? ` sound name ${as(sound)}` : ''}`]];
  }
  return null;
}

/**
 * Sends notifications and keeps their history (dir/notifications.json).
 * settings(): the current `notify` settings. baseUrl: the dashboard's address, for the link.
 */
export class Notifier {
  constructor({ dir, settings, baseUrl, demo = false, method = null, run = exec, now = () => new Date() }) {
    Object.assign(this, { dir, settings, baseUrl, demo, run, now });
    this.methodPromise = method === null ? findMethod() : Promise.resolve(method);
    this.history = null;
    this.watchingAt = 0;
    this.file = dir ? path.join(dir, 'notifications.json') : null;
    // Set when macOS refused terminal-notifier (its notifications aren't allowed yet in System
    // Settings): notifications then go through the built-in notifier until it works again.
    this.blocked = null;
  }

  /** The page is visible (it says so every half minute while it is). */
  seen() { this.watchingAt = this.now().getTime(); }
  get watching() { return this.now().getTime() - this.watchingAt < WATCHING_MS; }

  async method() { return this.methodPromise; }

  async list() {
    if (!this.history) {
      try { this.history = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch { this.history = []; }
      if (!Array.isArray(this.history)) this.history = [];
    }
    return this.history;
  }

  async #remember(entry) {
    const list = await this.list();
    list.unshift(entry);
    list.splice(HISTORY_MAX);
    if (this.file) {
      try { await fs.mkdir(this.dir, { recursive: true }); await fs.writeFile(this.file, JSON.stringify(list, null, 1), { mode: 0o600 }); } catch { /* the history is a convenience */ }
    }
  }

  /** One notification: { level, title, body, slug, key, test }. Returns the history entry. */
  async notify({ level, title, body = '', slug = null, key = null, test = false }) {
    const now = this.now();
    const verdict = test ? { send: true, sound: true, why: null } : decide(level, await this.settings(), { now, watching: this.watching, demo: this.demo });
    const method = await this.method();
    const url = `${this.baseUrl}/next/${slug ? `#/job/${encodeURIComponent(slug)}` : '#/'}`;
    let sent = false;
    let why = verdict.why;
    if (verdict.send) {
      const what = { title: 'Feature Workshop', subtitle: title, body, url, group: key ?? slug ?? undefined, sound: verdict.sound ? SOUNDS[level] ?? 'Glass' : null };
      const cmd = method && commandFor(method, what);
      if (!cmd) why = 'No way to reach macOS here.';
      else {
        const res = await this.run(cmd[0], cmd[1]);
        sent = succeeded(res);
        if (sent && method === 'terminal-notifier') this.blocked = null;
        if (!sent && method === 'terminal-notifier') {
          // Not allowed yet (or broken): say so, and show it with the built-in notifier instead.
          this.blocked = res?.err || 'terminal-notifier couldn’t show it.';
          const fallback = commandFor('osascript', what);
          sent = succeeded(await this.run(fallback[0], fallback[1]));
          why = sent ? 'Shown with macOS’s built-in notifier: terminal-notifier isn’t allowed yet.' : 'macOS didn’t take it.';
        } else if (!sent) why = 'macOS didn’t take it.';
      }
    }
    const entry = { at: now.toISOString(), level, title, body, slug, sent, why: why ?? undefined, test: test || undefined };
    await this.#remember(entry);
    return entry;
  }
}
