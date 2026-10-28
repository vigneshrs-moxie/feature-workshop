// Usage warnings: the plan's 5-hour and weekly meters (lib/plan-usage.js) warn once at 80 %, once at
// 90 % and once when full, per reset window, as a banner on the page and a notification (plan G20,
// D8). Nothing is ever stopped: this only tells.
//
// The memory of what has fired is kept per meter with the window's reset time, in the state folder
// (usage-warnings.json), so a restart of the dashboard doesn't warn again. A new reset time is a new
// window and starts with nothing fired. Claude's reset times wobble by a few seconds between reads,
// so two reset times less than an hour apart are the same window (a new 5-hour window starts after
// the old one ends, so its reset time is at least hours later).

import fs from 'node:fs/promises';
import path from 'node:path';

export const THRESHOLDS = [80, 90, 100];
export const METERS = ['fiveHour', 'week'];
const LABEL = { fiveHour: 'Five-hour', week: 'Weekly' };
const SAME_WINDOW_MS = 60 * 60_000;
export const MEMORY_FILE = 'usage-warnings.json';

/** Whether two reset times (ISO or null) belong to the same window. */
export function sameWindow(a, b) {
  if (a == null || b == null) return a == null && b == null;
  const d = Math.abs(Date.parse(a) - Date.parse(b));
  return Number.isFinite(d) && d < SAME_WINDOW_MS;
}

/** The highest threshold a percent has reached, or null under the first. */
export function reached(percent) {
  if (typeof percent !== 'number') return null;
  let top = null;
  for (const t of THRESHOLDS) if (percent >= t) top = t;
  return top;
}

/** The thresholds already fired for this meter's current window (memory entry kept only when it's the same window). */
function firedIn(memory, key, m) {
  const entry = memory?.[key];
  if (!entry || !Array.isArray(entry.fired) || !sameWindow(entry.resetsAt ?? null, m.resetsAt ?? null)) return [];
  return entry.fired.filter((t) => THRESHOLDS.includes(t));
}

/**
 * The warnings to fire now: for each meter, the highest threshold its percent has reached, when that
 * threshold (or a higher one) hasn't fired in this reset window yet. A jump past two thresholds in
 * one read fires only the higher one. meters: { fiveHour, week } as lib/plan-usage.js parses them;
 * a missing meter (or no meters: the read failed) fires nothing.
 * Each warning: { meter, threshold, percent, resetsAt, id }.
 */
export function check(meters, memory = {}) {
  const out = [];
  if (!meters || typeof meters !== 'object') return out;
  for (const key of METERS) {
    const m = meters[key];
    if (!m || typeof m.percent !== 'number') continue;
    const top = reached(m.percent);
    if (top == null) continue;
    const fired = firedIn(memory, key, m);
    if (fired.some((t) => t >= top)) continue;
    out.push({ meter: key, threshold: top, percent: m.percent, resetsAt: m.resetsAt ?? null, id: warningId(key, top, m.resetsAt ?? null) });
  }
  return out;
}

/**
 * The memory after a read: each meter's window with what has fired in it. A meter in a new window
 * starts over; the warnings just fired are added, with every lower threshold (a jump from 70 to 95
 * fires 90 only, and 80 never comes after it).
 */
export function remember(memory = {}, meters, warnings = []) {
  const next = {};
  for (const key of METERS) {
    const m = meters?.[key];
    if (!m || typeof m.percent !== 'number') { if (memory?.[key]) next[key] = memory[key]; continue; }
    const fired = new Set(firedIn(memory, key, m));
    for (const w of warnings) if (w.meter === key) for (const t of THRESHOLDS) if (t <= w.threshold) fired.add(t);
    if (fired.size) next[key] = { resetsAt: m.resetsAt ?? null, fired: [...fired].sort((a, b) => a - b) };
  }
  return next;
}

export function warningId(meter, threshold, resetsAt) {
  return `${meter}:${threshold}:${resetsAt ?? 'unknown'}`;
}

const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 24 * 60 * 60_000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "today 21:40", "tomorrow 02:40", "Thursday 14:00", "6 November 14:00" (local time). */
export function resetWhen(iso, now = new Date()) {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const days = Math.round((startOfDay(d) - startOfDay(now)) / DAY_MS);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString('en-GB', { weekday: 'long' })} ${time}`;
  return `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'long' })} ${time}`;
}

/** The warning in plain words, the same on the banner and in the notification. */
export function warningText({ meter, percent, resetsAt }, now = new Date()) {
  const label = LABEL[meter] ?? 'Claude';
  const head = percent >= 100 ? `${label} Claude usage is full (100 %).` : `${label} Claude usage is at ${percent} %.`;
  const when = resetWhen(resetsAt, now);
  return when ? `${head} It resets ${when}.` : `${head} Claude didn’t say when it resets.`;
}

/**
 * What the banner shows now, from the last good reading: for each meter at 80 % or more, its highest
 * threshold reached, with the text. The page hides one you dismissed (by its id); the next threshold
 * has a new id, so it shows again.
 */
export function activeWarnings(meters, now = new Date()) {
  const out = [];
  for (const key of METERS) {
    const m = meters?.[key];
    if (!m || typeof m.percent !== 'number') continue;
    const top = reached(m.percent);
    if (top == null) continue;
    const w = { meter: key, threshold: top, percent: m.percent, resetsAt: m.resetsAt ?? null };
    out.push({ ...w, id: warningId(key, top, w.resetsAt), text: warningText(w, now) });
  }
  return out;
}

/**
 * The warnings as they happen: after each good read, onRead(meters) works out what to fire, sends
 * each one (send), remembers it and returns them. dir: the state folder for the memory file (a
 * function, read when first needed; null keeps the memory in this process only).
 */
export class UsageWarnings {
  constructor({ dir = () => null, send = async () => null, now = () => new Date() } = {}) {
    Object.assign(this, { dir, send, now });
    this.memory = null;
    this.file = null;
  }

  async #load() {
    if (this.memory) return this.memory;
    const dir = typeof this.dir === 'function' ? this.dir() : this.dir;
    this.file = dir ? path.join(dir, MEMORY_FILE) : null;
    let raw = {};
    if (this.file) {
      try { raw = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch { raw = {}; }
    }
    this.memory = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return this.memory;
  }

  async #save() {
    if (!this.file) return;
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify(this.memory, null, 1), { mode: 0o600 });
    } catch { /* the memory is a convenience: at worst a warning comes again after a restart */ }
  }

  /** After a good read: the warnings fired now (each with its text and what send returned). */
  async onRead(meters) {
    const memory = await this.#load();
    const now = this.now();
    const fired = check(meters, memory);
    const next = remember(memory, meters, fired);
    const changed = JSON.stringify(next) !== JSON.stringify(memory);
    this.memory = next;
    if (changed) await this.#save();
    const out = [];
    for (const w of fired) {
      const text = warningText(w, now);
      let sent = null;
      try { sent = await this.send({ ...w, text }); } catch { sent = null; }
      out.push({ ...w, text, sent });
    }
    return out;
  }
}
