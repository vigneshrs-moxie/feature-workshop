// Auto start by tag (Settings → Workflow → Auto start): a ticket assigned to you that carries the
// Orbit tag you wrote starts a job by itself, with Auto on, one job at a time.
//
// It can't loop, by construction:
//   - one job at a time: the next waits until the last one has stopped or has PR #1 open;
//   - each ticket is started at most once ever: the memory file is written BEFORE the start;
//   - a failed start is remembered and never retried by itself (Start on the row clears it);
//   - nothing starts while the setting is off, the tag is empty, the Claude limit warning shows,
//     Orbit can't be reached, or Orbit shows no tags to this token;
//   - a tag is matched against the row's tag names only, never its title, description or comments.
// The memory file is AUTO_START_FILE in Starbase's state folder: { started: [{ key, at, slug, tag }],
// failed: [{ key, at, reason }] }. A file that can't be read starts nothing (the history is unknown).

import fs from 'node:fs/promises';
import { writeFileAtomic } from './atomic-write.js';

export const AUTO_START_FILE = 'auto-start.json';
export const TAG_MAX = 60;

const CLOSED = new Set(['closed', 'resolved']);

/** The setting as saved: { on: boolean, tag: string } (tag trimmed, at most 60 characters). */
export function normalizeAutoStart(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return { on: r.on === true, tag: typeof r.tag === 'string' ? r.tag.trim().slice(0, TAG_MAX) : '' };
}

/** Whether a tag name of the row equals the tag, ignoring case and surrounding spaces. Never any other field. */
export function tagMatches(item, tag) {
  const want = String(tag ?? '').trim().toLowerCase();
  if (!want || !Array.isArray(item?.tags)) return false;
  return item.tags.some((t) => typeof t === 'string' && t.trim().toLowerCase() === want);
}

const tried = (memory, key) => memory.started.some((e) => e.key === key) || memory.failed.some((e) => e.key === key);

/**
 * What to do next. Pure.
 *   items          the Inbox's items, in the Inbox's order
 *   setting        { on, tag }
 *   memory         { started, failed }
 *   ticketsWithJobs  Set of ticket keys that have or had a job (closed ones too)
 *   busy           the last started job is still on its way to PR #1
 *   paused         'limit' | 'orbit' | null
 *   tagsShown      Orbit shows tags to this token (the view's tagsShown); anything but true counts as no
 * Returns { start: item } or { wait: reason }.
 */
export function pickNext({ items = [], setting, memory, ticketsWithJobs = new Set(), busy = false, paused = null, tagsShown = false } = {}) {
  const s = normalizeAutoStart(setting);
  if (!s.on) return { wait: 'off' };
  if (!s.tag) return { wait: 'no-tag' };
  if (paused === 'orbit') return { wait: 'paused-orbit' };
  if (paused === 'limit') return { wait: 'paused-limit' };
  if (tagsShown !== true) return { wait: 'no-tags-shown' };
  if (busy) return { wait: 'busy' };
  const hit = items.find((i) => Array.isArray(i?.why) && i.why.includes('assigned')
    && !CLOSED.has(i.status) && !i.job
    && tagMatches(i, s.tag)
    && !ticketsWithJobs.has(i.key) && !tried(memory, i.key));
  return hit ? { start: hit } : { wait: 'nothing' };
}

const emptyMemory = () => ({ started: [], failed: [] });
const listOf = (v) => (Array.isArray(v) ? v.filter((e) => e && typeof e.key === 'string') : []);

/**
 * The starter. run() looks once and starts at most one job; runs never overlap (a run asked for
 * during another is folded into it).
 *   file       the memory file
 *   setting()  { on, tag }                            inbox()  the inbox view: { items, tagsShown }
 *   jobs()     { ticketsWithJobs, busy }              paused() 'limit' | 'orbit' | null
 *   start(item, tag)  starts the job, returns { slug }, throws in plain words when it can't
 *   notify(n)  tells the person once per started job
 */
export class AutoStarter {
  constructor({ file, setting, inbox, jobs, paused, start, notify = async () => {}, now = () => new Date().toISOString() }) {
    Object.assign(this, { file, setting, inbox, jobs, paused, start, notify, now });
    this.memory = null; // null until read; { unreadable: true } when the file can't be trusted
    this.current = null;
    this.again = false;
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

  #save() { return writeFileAtomic(this.file, `${JSON.stringify({ started: this.memory.started, failed: this.memory.failed }, null, 2)}\n`, { mode: 0o600 }); }

  /** The sentence a failed start gave, for the row (null when the ticket has none). Known after the first run. */
  failedReason(key) { return this.memory?.failed?.find?.((e) => e.key === key)?.reason ?? null; }

  /** Start on the row works as usual and clears a failed ticket. */
  async clearFailed(key) {
    const m = await this.#load();
    if (m.unreadable || !m.failed.some((e) => e.key === key)) return;
    m.failed = m.failed.filter((e) => e.key !== key);
    await this.#save();
  }

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
    const setting = await this.setting();
    const view = this.inbox();
    const { ticketsWithJobs, busy } = await this.jobs(memory);
    const next = pickNext({ items: view.items, setting, memory, ticketsWithJobs, busy, paused: this.paused(), tagsShown: view.tagsShown });
    if (!next.start) return next;
    const it = next.start;
    const tag = normalizeAutoStart(setting).tag;
    const entry = { key: it.key, at: this.now(), slug: null, tag };
    memory.started.push(entry);
    await this.#save(); // before the start: a crash can never start it twice
    try {
      const { slug } = await this.start(it, tag);
      entry.slug = slug ?? null;
      await this.#save();
    } catch (err) {
      memory.started = memory.started.filter((e) => e !== entry);
      memory.failed.push({ key: it.key, at: this.now(), reason: String(err?.message ?? err).replace(/\s+/g, ' ').trim().slice(0, 300) || 'It did not start.' });
      await this.#save();
      return { failed: it };
    }
    await this.notify({ level: 'needs', title: `Started by Auto: ${it.key}`, body: `${it.title}. It has the tag "${tag}". Auto runs it to PR #1 and asks you only if it must.`, slug: entry.slug, key: `auto-start:${it.key}` });
    return { started: it };
  }
}
