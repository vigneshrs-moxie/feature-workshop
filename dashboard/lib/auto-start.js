// Auto start by tag (Settings → Workflow → Auto start): a ticket assigned to you that carries the
// Orbit tag you wrote starts a job by itself, with Auto on, up to N jobs at a time (the setting's max).
//
// It can't loop, by construction:
//   - at most N working at a time: every open job whose Auto is on and not stopped holds a place,
//     whether the tag or the person switched it on; the next waits until one stops, finishes or is off;
//   - nothing starts while AUTO_CEILING (10) Auto jobs are unfinished (on, stopped or not);
//   - each ticket is started at most once ever: the memory file is written BEFORE the start;
//   - a failed start is remembered and never retried by itself (Start on the row clears it);
//   - nothing starts while the setting is off, the tag is empty, the Claude limit warning shows or
//     can't be read, Orbit can't be reached, or Orbit shows no tags to this token;
//   - a tag is matched against the row's tag names only, never its title, description or comments.
// The memory file is AUTO_START_FILE in Starbase's state folder: { started: [{ key, at, slug, tag }],
// failed: [{ key, at, reason }] }. A file that can't be read starts nothing (the history is unknown).

import fs from 'node:fs/promises';
import { writeFileAtomic } from './atomic-write.js';
import { isUnfinished, isWorking } from './auto.js';

export const AUTO_START_FILE = 'auto-start.json';
export const TAG_MAX = 60;
/** N, how many Auto jobs work at once: Settings → Workflow → Auto start, 1 to 10, 5 when missing. */
export const AUTO_MAX = Object.freeze({ min: 1, max: 10, default: 5 });
/** Nothing starts by itself while this many Auto jobs are unfinished (working or stopped), whatever N. */
export const AUTO_CEILING = 10;

const CLOSED = new Set(['closed', 'resolved']);

/** The setting as saved: { on: boolean, tag: string, max: number } (tag trimmed, at most 60 characters; max a whole number 1 to 10, else 5). */
export function normalizeAutoStart(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const max = Number.isInteger(r.max) && r.max >= AUTO_MAX.min && r.max <= AUTO_MAX.max ? r.max : AUTO_MAX.default;
  return { on: r.on === true, tag: typeof r.tag === 'string' ? r.tag.trim().slice(0, TAG_MAX) : '', max };
}

/** Whether a tag name of the row equals the tag, ignoring case and surrounding spaces. Never any other field. */
export function tagMatches(item, tag) {
  const want = String(tag ?? '').trim().toLowerCase();
  if (!want || !Array.isArray(item?.tags)) return false;
  return item.tags.some((t) => typeof t === 'string' && t.trim().toLowerCase() === want);
}

/**
 * The places taken, from the Auto records of the open jobs (the caller leaves closed jobs out). Pure.
 * working: Auto on and not stopped (lib/auto.js isWorking), whether the tag or the person switched it
 * on; each holds one of the N places. unfinished: Auto on, stopped or not (isUnfinished), against
 * AUTO_CEILING. A job finished (PR #1 open), set aside or switched off counts in neither.
 */
export function countAuto(records = []) {
  let working = 0;
  let unfinished = 0;
  for (const r of records) {
    if (isWorking(r)) working++;
    if (isUnfinished(r)) unfinished++;
  }
  return { working, unfinished };
}

/**
 * Why Auto start is paused, or null. Pure. Fails closed: when the Claude limit reading has an error
 * or has not arrived, it pauses ('limit-reading'), unless the person switched that reading off.
 *   reading  { enabled, error, checkedAt } from the plan usage
 */
export function pausedFor({ orbitError = null, limited = false, warnings = 0, reading = null } = {}) {
  if (orbitError) return 'orbit';
  if (limited || warnings > 0) return 'limit';
  if (reading && reading.enabled !== false && (reading.error || !reading.checkedAt)) return 'limit-reading';
  return null;
}

/**
 * The job a started entry made, or null. Pure. By its slug; when a crash between the start and the
 * save left no slug, by its ticket (an open job before a closed one), so that job still holds its place.
 *   jobs  [{ slug, key, closed }]
 */
export function lastJob(last, jobs = []) {
  if (!last) return null;
  if (last.slug) return jobs.find((j) => j.slug === last.slug) ?? null;
  const same = jobs.filter((j) => j.key && j.key === last.key);
  return same.find((j) => !j.closed) ?? same[0] ?? null;
}

const tried = (memory, key) => (memory?.started ?? []).some((e) => e.key === key) || (memory?.failed ?? []).some((e) => e.key === key);

/**
 * Whether a ticket would start by itself when a place is free: Auto start on with a tag, the ticket
 * assigned to you, open, with no open job, carrying the tag, and not tried before (memory). Pure. The one
 * rule pickNext and the Auto queue's `next` share; pickNext also leaves out a ticket that had a job.
 */
export function startsByItself(item, setting, memory) {
  const s = normalizeAutoStart(setting);
  return s.on && Boolean(s.tag) && Array.isArray(item?.why) && item.why.includes('assigned')
    && !CLOSED.has(item.status) && !item.job
    && tagMatches(item, s.tag)
    && !tried(memory, item.key);
}

/**
 * What to do next. Pure.
 *   items          the Inbox's items, in the Inbox's order
 *   setting        { on, tag, max }
 *   memory         { started, failed }
 *   ticketsWithJobs  Set of ticket keys that have or had a job (closed ones too)
 *   working        how many open Auto jobs hold a place now (countAuto), default 0
 *   unfinished     how many open Auto jobs are unfinished (countAuto), default 0
 *   paused         'limit' | 'limit-reading' | 'orbit' | null
 *   tagsShown      Orbit shows tags to this token (the view's tagsShown); anything but true counts as no
 * Returns { start: item } or { wait: reason }.
 */
export function pickNext({ items = [], setting, memory, ticketsWithJobs = new Set(), working = 0, unfinished = 0, paused = null, tagsShown = false } = {}) {
  const s = normalizeAutoStart(setting);
  if (!s.on) return { wait: 'off' };
  if (!s.tag) return { wait: 'no-tag' };
  if (paused === 'orbit') return { wait: 'paused-orbit' };
  if (paused === 'limit' || paused === 'limit-reading') return { wait: 'paused-limit' };
  if (tagsShown !== true) return { wait: 'no-tags-shown' };
  if (working >= s.max) return { wait: 'busy' };
  if (unfinished >= AUTO_CEILING) return { wait: 'ceiling' };
  const hit = items.find((i) => startsByItself(i, s, memory) && !ticketsWithJobs.has(i.key));
  return hit ? { start: hit } : { wait: 'nothing' };
}

const emptyMemory = () => ({ started: [], failed: [] });
const listOf = (v) => (Array.isArray(v) ? v.filter((e) => e && typeof e.key === 'string') : []);

/**
 * The starter. Each pass starts at most one job, and after a good start asks for one more pass, so
 * the places fill one after another; runs never overlap (a run asked for
 * during another is folded into it).
 *   file       the memory file
 *   setting()  { on, tag, max }                       inbox()  the inbox view: { items, tagsShown }
 *   jobs(memory)  { ticketsWithJobs, working, unfinished }: counted over every open job's Auto record
 *                 (countAuto), not only the ones this starter started   paused() 'limit' | 'orbit' | null
 *   start(item, tag)  starts the job, returns { slug }, throws in plain words when it can't
 *   notify(n)  tells the person once per started job, and once per failed start
 */
export class AutoStarter {
  constructor({ file, setting, inbox, jobs, paused, start, notify = async () => {}, now = () => new Date().toISOString(), write = writeFileAtomic }) {
    Object.assign(this, { file, setting, inbox, jobs, paused, start, notify, now, write });
    this.dirty = false; // a started job's slug is in memory but not yet on disk
    this.memory = null; // null until read; { unreadable: true } when the file can't be trusted
    this.current = null;
    this.again = false;
    this.hadJobs = null; // the ticket keys that have or had a job (closed ones too), as the last pass saw them; null before it
  }

  async #load() {
    if (this.memory) return this.memory;
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object');
      this.memory = { started: listOf(raw.started), failed: listOf(raw.failed) };
    } catch (err) {
      this.memory = err?.code === 'ENOENT' ? emptyMemory() : { unreadable: true };
    }
    return this.memory;
  }

  #save() { return this.write(this.file, `${JSON.stringify({ started: this.memory.started, failed: this.memory.failed }, null, 2)}\n`, { mode: 0o600 }); }

  /** The sentence a failed start gave, for the row (null when the ticket has none). Known after the first run. */
  failedReason(key) { return this.memory?.failed?.find?.((e) => e.key === key)?.reason ?? null; }

  /** Every failed start, { key, reason }, for the Auto queue's Couldn't start (empty until the memory is read). */
  failedList() { return Array.isArray(this.memory?.failed) ? this.memory.failed.map((e) => ({ key: e.key, reason: e.reason ?? null })) : []; }

  /** Every ticket Auto started, { key }, so the queue's Next up leaves them out (empty until the memory is read). */
  startedList() { return Array.isArray(this.memory?.started) ? this.memory.started.map((e) => ({ key: e.key })) : []; }

  /** The ticket keys that have or had a job, closed ones too, as the last pass saw them; null before the first pass. */
  hadJobList() { return this.hadJobs ? [...this.hadJobs] : null; }

  /** Read the memory file now (once), so the queue knows what was started or failed before the first pass. */
  async load() { await this.#load(); }

  /** Start on the row works as usual and clears a failed ticket. */
  async clearFailed(key) {
    const m = await this.#load();
    if (m.unreadable || !m.failed.some((e) => e.key === key)) return;
    m.failed = m.failed.filter((e) => e.key !== key);
    await this.#save();
  }

  /** The memory file can't be read, so nothing starts (the Inbox line says so). */
  memoryUnreadable() { return this.memory?.unreadable === true; }

  /** The slug of the job started last, or null. */
  lastStarted() { return this.memory?.started?.at?.(-1) ?? null; }

  async run() {
    if (this.current) { this.again = true; return this.current; }
    this.current = (async () => {
      try {
        do { this.again = false; await this.#once(); } while (this.again);
      } finally { this.current = null; }
    })();
    return this.current;
  }

  async #once() {
    const memory = await this.#load();
    if (memory.unreadable) return { wait: 'nothing' };
    if (this.dirty) { try { await this.#save(); this.dirty = false; } catch { /* tried again next pass */ } }
    const setting = await this.setting();
    const view = this.inbox();
    const { ticketsWithJobs, working, unfinished } = await this.jobs(memory);
    this.hadJobs = new Set(ticketsWithJobs);
    // A crash mid-start left an entry with no slug and no job: show it as a failed start (never started again).
    const lost = memory.started.filter((e) => !e.slug && !ticketsWithJobs.has(e.key));
    if (lost.length) {
      memory.started = memory.started.filter((e) => !lost.includes(e));
      for (const e of lost) memory.failed.push({ key: e.key, at: this.now(), reason: 'Starbase stopped while it was starting this one. Press Start to try.' });
      await this.#save();
    }
    const next = pickNext({ items: view.items, setting, memory, ticketsWithJobs, working, unfinished, paused: this.paused(), tagsShown: view.tagsShown });
    if (!next.start) return next;
    const it = next.start;
    const tag = normalizeAutoStart(setting).tag;
    const entry = { key: it.key, at: this.now(), slug: null, tag };
    memory.started.push(entry);
    await this.#save(); // before the start: a crash can never start it twice
    try {
      const { slug } = await this.start(it, tag);
      entry.slug = slug ?? null;
    } catch (err) {
      memory.started = memory.started.filter((e) => e !== entry);
      if (err?.code === 'limited' || err?.extra?.code === 'limited') {
        await this.#save(); // refused for the limit: not a failed start, the ticket stays untried
        return { wait: 'paused-limit' };
      }
      const reason = String(err?.message ?? err).replace(/\s+/g, ' ').trim().slice(0, 300) || 'It did not start.';
      memory.failed.push({ key: it.key, at: this.now(), reason });
      try { await this.#save(); } finally {
        // Told once per failed start (it is never tried again by itself): the row is not the only place it shows.
        await this.notify({ level: 'problem', title: `Auto start could not start ${it.key}`, body: reason, slug: null, key: `auto-start-failed:${it.key}` });
      }
      return { failed: it };
    }
    try { await this.#save(); } catch { this.dirty = true; } // the job exists: kept as started, saved again next pass
    await this.notify({ level: 'needs', title: `Started by Auto: ${it.key}`, body: `${it.title}. It has the tag "${tag}". Auto runs it to PR #1 and asks you only if it must.`, slug: entry.slug, key: `auto-start:${it.key}` });
    this.again = true; // a place may be free: look again (a failed start never asks)
    return { started: it };
  }
}
