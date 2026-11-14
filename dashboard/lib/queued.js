// The one message waiting for a job's Foreman (the job page rebuild, Task 16; design brief R8). While a
// reply runs, a message from the box is not refused: it waits here and goes when the reply ends
// (runner/index.js flushWaiting), once. One per job: a second one replaces the first only when asked
// (WaitingExists names the first otherwise). Cancel removes it. It is kept in Starbase's own state
// folder (<state dir>/waiting.json, beside sessions.json; mode 600: his words), so a restart finds it.
// When it is time to send and a check refuses (the usage limit, the terminal holding the job), it stays
// with `why`, the refusal in plain words, and goes at the next chance.
//
// The payload names it `waiting` ({ text, at, why }): the website already uses `queued` for the
// decisions it holds for the laptop. Auto's replies never wait here.
//
//   new WaitingMessages({ file, now })
//   load()                              read the file (a missing or broken one is no message)
//   get(featureDir)                     { slug, text, at, why, confirmNoTerminal } | null
//   view(featureDir)                    { text, at, why } | null: what the page shows
//   dirs()                              the jobs with a message waiting
//   put(featureDir, { slug, text, confirmNoTerminal }, { replace })   → view; WaitingExists when one waits
//   cancel(featureDir)                  → the message removed, or null
//   take(featureDir)                    → the message, removed (for sending: only one caller gets it), or null
//   refuse(featureDir, why, { held, toBox })   keep it, saying why it did not go (held: after a plain stop,
//                                       only his Send sends it; toBox: the Foreman asks him first, the page moves it)
//   release(featureDir)                 his Send on a held message: no why, goes at the next chance
//   putBack(featureDir, message, why)   a send that failed after take: back, unless a newer one waits

import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from './atomic-write.js';

export const WAITING_FILE = 'waiting.json';

/** A message already waits for this job: `waiting` is it (the page names it in the refusal). */
export class WaitingExists extends Error {
  constructor(waiting) {
    super('A message is already waiting for the Foreman.');
    this.name = 'WaitingExists';
    this.waiting = waiting;
  }
}

const viewOf = (m) => (m ? { text: m.text, at: m.at, why: m.why ?? null, ...(m.toBox ? { toBox: true } : {}) } : null);

export class WaitingMessages {
  constructor({ file, now = () => new Date().toISOString() }) {
    this.file = file;
    this.now = now;
    this.all = {};
    this.writing = Promise.resolve();
  }

  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.all = {};
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [dir, m] of Object.entries(raw)) {
          if (m && typeof m.text === 'string' && m.text) this.all[dir] = { slug: String(m.slug ?? ''), text: m.text, at: String(m.at ?? ''), why: typeof m.why === 'string' ? m.why : null, confirmNoTerminal: m.confirmNoTerminal === true, held: m.held === true, toBox: m.toBox === true };
        }
      }
    } catch {
      this.all = {};
    }
  }

  get(featureDir) { return this.all[featureDir] ?? null; }
  view(featureDir) { return viewOf(this.get(featureDir)); }
  dirs() { return Object.keys(this.all); }

  async put(featureDir, { slug, text, confirmNoTerminal = false }, { replace = false } = {}) {
    const was = this.get(featureDir);
    if (was && !replace) throw new WaitingExists(viewOf(was));
    this.all[featureDir] = { slug: String(slug ?? ''), text, at: this.now(), why: null, confirmNoTerminal: confirmNoTerminal === true, held: false, toBox: false };
    await this.#save();
    return this.view(featureDir);
  }

  async cancel(featureDir) {
    const was = this.get(featureDir);
    if (!was) return null;
    delete this.all[featureDir];
    await this.#save();
    return was;
  }

  /** Removed here, in memory, before the save: two callers at once never both get it. */
  async take(featureDir) {
    return this.cancel(featureDir);
  }

  /**
   * held: kept after a plain stop: only his Send (release) sends it. toBox: the Foreman is asking him something
   * first: the page moves the words into the box and cancels it.
   */
  async refuse(featureDir, why, { held = false, toBox = false } = {}) {
    const m = this.get(featureDir);
    if (!m) return;
    m.why = why ?? null;
    m.held = held === true;
    m.toBox = toBox === true;
    await this.#save();
  }

  /** His Send on a held message: it goes at the next chance again. */
  async release(featureDir) {
    const m = this.get(featureDir);
    if (!m) return;
    m.why = null;
    m.held = false;
    m.toBox = false;
    await this.#save();
  }

  async putBack(featureDir, message, why) {
    if (!message || this.get(featureDir)) return;
    this.all[featureDir] = { ...message, why: why ?? null, held: false, toBox: false };
    await this.#save();
  }

  // Saves go one after another, each the whole file as it is now.
  #save() {
    const mine = this.writing.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      await writeFileAtomic(this.file, JSON.stringify(this.all, null, 2), { mode: 0o600 });
    });
    this.writing = mine;
    return mine;
  }
}
