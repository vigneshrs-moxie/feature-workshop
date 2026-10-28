// Notifications outside the browser: the dashboard itself tells macOS, so they arrive with the
// dashboard's tab closed or the browser hidden. terminal-notifier when it's installed (clicking
// opens the job), else macOS's built-in notifier (osascript; a click can't open the job).
//
// Three levels, each sound, silent or off (settings `notify`):
//   needs    something waits for you: a go-ahead, a question, a permission, a decision parked 4 h
//   problem  a reply ended in an error, or the usage limit stopped the work
//   done     a job crossed the finish line you set (lib/finish.js), or you marked it done; reaching
//            staging or main after that is a quiet "Landed" (never with a sound)
// And one kind with a switch of its own (settings `notify.usageWarnings`, on unless turned off):
//   usage    the plan's 5-hour or weekly usage reached 80 %, 90 % or full (lib/usage-warnings.js),
//            with a sound; it only tells, nothing is stopped
// Quiet hours (off by default): only problems show, silently; the rest is kept in the history.
// While you're looking at the dashboard (the page says when it's visible), nothing pops: the page
// shows it already. Every notification, sent or not, goes into the history (the last 50).
// A notification only opens the page; it never approves, answers or sends anything.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { STAGES } from './stages.js';

export const LEVELS = ['needs', 'problem', 'done'];
export const USAGE_LEVEL = 'usage';
export const MODES = ['sound', 'silent', 'off'];
export const NOTIFY_DEFAULTS = {
  enabled: true,
  levels: { needs: 'sound', problem: 'sound', done: 'silent' },
  quiet: { on: false, from: '22:00', to: '07:00' },
  skipWhenWatching: true,
};
const SOUNDS = { needs: 'Glass', problem: 'Basso', done: 'Pop', usage: 'Purr' };
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
    // Usage warnings: on unless turned off, so it's only here once it has been set.
    ...(typeof r.usageWarnings === 'boolean' ? { usageWarnings: r.usageWarnings } : {}),
  };
}

/** A patch from the page, checked; throws with a plain message when something isn't allowed. */
export function validateNotifyPatch(patch, current) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('The notification settings must be an object.');
  const next = notifySettings(current);
  for (const key of Object.keys(patch)) if (!['enabled', 'levels', 'quiet', 'skipWhenWatching', 'usageWarnings'].includes(key)) throw new Error(`Unknown notification setting: ${key}.`);
  if ('enabled' in patch) { if (typeof patch.enabled !== 'boolean') throw new Error('“enabled” must be true or false.'); next.enabled = patch.enabled; }
  if ('usageWarnings' in patch) { if (typeof patch.usageWarnings !== 'boolean') throw new Error('Usage warnings are on or off.'); next.usageWarnings = patch.usageWarnings; }
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
  const mode = level === USAGE_LEVEL ? (s.usageWarnings === false ? 'off' : 'sound') : s.levels[level] ?? 'off';
  if (!s.enabled) return { send: false, sound: false, why: 'Notifications are off.' };
  if (level === USAGE_LEVEL && mode === 'off') return { send: false, sound: false, why: 'Usage warnings are off.' };
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
export function commandFor(method, { title, subtitle, body, url, execute, group, sound }) {
  if (method === 'terminal-notifier') {
    const click = execute ? ['-execute', execute] : url ? ['-open', url] : [];
    return ['terminal-notifier', ['-title', title, ...(subtitle ? ['-subtitle', subtitle] : []), '-message', body || ' ', ...click, ...(group ? ['-group', group] : []), ...(sound ? ['-sound', sound] : [])]];
  }
  if (method === 'osascript') {
    return ['osascript', ['-e', `display notification ${as(body || ' ')} with title ${as(title)}${subtitle ? ` subtitle ${as(subtitle)}` : ''}${sound ? ` sound name ${as(sound)}` : ''}`]];
  }
  return null;
}

/** "5m", "3h", "2d": how long something has waited; '' under a minute or without a time. */
export function waitedFor(since, now = new Date()) {
  const ms = now.getTime() - Date.parse(since ?? '');
  if (!(ms >= 60_000)) return '';
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}

/**
 * A notification's text: the stage and how long it has waited, then the brief's headline (without
 * the job's title in front, which the notification shows already) or, with none, `what`.
 * "Review · waiting 12m — Review done: 0 blockers, 2 majors".
 */
export function noticeBody({ stage, waitingSince, headline, title, what = '' }, now = new Date()) {
  const label = STAGES.find((s) => s.id === stage)?.label ?? (typeof stage === 'string' ? stage : '');
  const waited = waitedFor(waitingSince, now);
  const where = [label, waited && `waiting ${waited}`].filter(Boolean).join(' · ');
  let head = typeof headline === 'string' ? headline.trim() : '';
  if (head && title && head.toLowerCase().startsWith(String(title).toLowerCase())) head = head.slice(String(title).length).replace(/^\s*[·:—–-]\s*/, '');
  const text = (head || what).slice(0, 180);
  return [where, text].filter(Boolean).join(' — ');
}

// A click on a notification: the dashboard's tab in Chrome when one is open (brought to the front
// and moved to the job), else the link in a new tab of the default browser. Chrome asks once to let
// the notifier control it; refused (or no Chrome), it opens a new tab as before.
export const OPEN_TAB_SCRIPT = `on run argv
  set u to item 1 of argv
  set origins to rest of argv
  try
    if application "Google Chrome" is running then
      tell application "Google Chrome"
        repeat with w in windows
          set i to 0
          repeat with t in tabs of w
            set i to i + 1
            set here to false
            repeat with o in origins
              if (URL of t) starts with (o as text) then set here to true
            end repeat
            if here then
              set URL of t to u
              set active tab index of w to i
              set index of w to 1
              activate
              return
            end if
          end repeat
        end repeat
      end tell
    end if
  end try
  open location u
end run
`;

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The shell line terminal-notifier runs on a click: the script above with the job's link. */
export function openTabCommand(scriptFile, url, origins) {
  return ['/usr/bin/osascript', scriptFile, url, ...origins].map(shq).join(' ');
}

/** A usage warning (lib/usage-warnings.js) as a notification: the same words as the banner. */
export function usageNotice(w) {
  return {
    level: USAGE_LEVEL,
    title: w.threshold >= 100 ? 'Claude usage is full' : `Claude usage at ${w.percent} %`,
    body: w.text,
    key: `usage-${w.meter}`,
  };
}

// The dashboard's notifier, for the usage warnings (lib/plan-usage.js is made before it).
let latest = null;
/** The notifier made last (the dashboard makes one), or null. */
export function currentNotifier() { return latest; }

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
    latest = this;
  }

  /** The page is visible (it says so every half minute while it is). */
  seen() { this.watchingAt = this.now().getTime(); }
  /** The page went to the background: notifications may pop again at once. */
  unseen() { this.watchingAt = 0; }
  get watching() { return this.now().getTime() - this.watchingAt < WATCHING_MS; }

  async method() { return this.methodPromise; }

  async list() {
    if (!this.history) {
      try { this.history = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch { this.history = []; }
      if (!Array.isArray(this.history)) this.history = [];
    }
    return this.history;
  }

  /** The click command for a link, with the tab script written to the state folder; null without one. */
  async #openTab(url) {
    if (!this.file) return null;
    const scriptFile = path.join(this.dir, 'open-tab.applescript');
    try {
      if (!this.scriptWritten) { await fs.mkdir(this.dir, { recursive: true }); await fs.writeFile(scriptFile, OPEN_TAB_SCRIPT, { mode: 0o600 }); this.scriptWritten = true; }
    } catch { return null; }
    const { protocol, port } = new URL(this.baseUrl);
    const origins = [...new Set([new URL(this.baseUrl).origin, `${protocol}//127.0.0.1:${port}`, `${protocol}//localhost:${port}`])].map((o) => `${o}/`);
    return openTabCommand(scriptFile, url, origins);
  }

  async #remember(entry) {
    const list = await this.list();
    list.unshift(entry);
    list.splice(HISTORY_MAX);
    if (this.file) {
      try { await fs.mkdir(this.dir, { recursive: true }); await fs.writeFile(this.file, JSON.stringify(list, null, 1), { mode: 0o600 }); } catch { /* the history is a convenience */ }
    }
  }

  /**
   * One notification: { level, title, body, slug, key, test, quiet }. quiet: shown without a sound
   * even when the level has one (the "Landed" marks). Returns the history entry.
   */
  async notify({ level, title, body = '', slug = null, key = null, test = false, quiet = false }) {
    const now = this.now();
    const verdict = test ? { send: true, sound: true, why: null } : decide(level, await this.settings(), { now, watching: this.watching, demo: this.demo });
    if (quiet) verdict.sound = false;
    const method = await this.method();
    const url = `${this.baseUrl}/next/${slug ? `#/job/${encodeURIComponent(slug)}` : '#/'}`;
    let sent = false;
    let why = verdict.why;
    if (verdict.send) {
      const execute = method === 'terminal-notifier' ? await this.#openTab(url) : null;
      const what = { title: 'Feature Workshop', subtitle: title, body, url, execute, group: key ?? slug ?? undefined, sound: verdict.sound ? SOUNDS[level] ?? 'Glass' : null };
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
    const entry = { at: now.toISOString(), level, title, body, slug, sent, why: why ?? undefined, test: test || undefined, quiet: quiet || undefined };
    await this.#remember(entry);
    return entry;
  }
}
