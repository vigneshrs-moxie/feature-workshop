// Claude Code use outside this app (packet U): every Claude Code session log on this computer
// (~/.claude/projects/<folder>/<session>.jsonl, and its sub-agents' logs under <session>/subagents/),
// read for usage numbers only, so Telemetry can count your own terminal use by name instead of
// folding it into "Other use".
//
// What leaves this reader: for each assistant reply with usage, its time, model family, the token
// counts, its cost (lib/cost.js prices) and whether a sub-agent wrote it. Never the text, prompts,
// tool input, file names or folder names. The cache in the state folder holds no names either: a
// session's folder and working folder are kept as short one-way hashes (enough to tell whether a
// session ran in one of this app's job worktrees), with its session id and the replies' message ids.
//
// Rules:
//   - each reply counts once. Claude Code writes the same message id on several lines while it
//     streams (one per content block): the last line wins. A resumed or forked session copies earlier
//     messages into its own file with the same ids: the copy in the file made first (its birth time)
//     is where the reply happened; when that can't be told, a reply copied into any left-out session
//     is left out (never counted twice);
//   - this app's own job sessions are left out, so their use is never counted twice with
//     usage.jsonl: by session id (usage.jsonl's sessions and the jobs' known sessions) and by folder
//     (sessions whose working folder is in a job's worktree);
//   - sessions in a temp folder (the demo's and tests' runs: the isTemp rule) are left out;
//   - only files changed in the last READ_DAYS days are read, and only replies from then on kept.
//
// Reading: the first full read (about 320 MB on Vignesh's Mac) streams each file in the background
// and never blocks a page: view() answers 'reading' until it is done. The cache is kept per file by
// size, modified time and inode, with how far the file was read, so a later read reads only the new
// bytes at the end of a file that grew.
//
// The setting ("Count my Claude Code use outside the app", on by default) is kept here too, in
// claude-code-usage.json in the state folder, until Settings → Workflow carries it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { estimateCost, modelFamily, tokensFromUsage } from './cost.js';
import { isTempPath, tempDirs } from './insights.js';

export const READ_DAYS = 100;
export const CACHE_FILE = 'claude-code-usage-cache.json';
export const SETTING_FILE = 'claude-code-usage.json';
const CACHE_VERSION = 1;
const DAY = 24 * 3600e3;
/** A refresh at most this often (each Telemetry request asks for one). */
export const MIN_REFRESH_MS = 30_000;

const ASSISTANT = Buffer.from('"type":"assistant"');
const USAGE = Buffer.from('"usage"');

/** A short one-way hash: the cache keeps no folder names. */
export const hashOf = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
/** The folder Claude Code keeps a working folder's sessions in: every character but letters and digits becomes '-'. */
export const projectFolderName = (dir) => String(dir).replace(/[^a-zA-Z0-9]/g, '-');
/** The folder and every folder above it (not the root), for "is it inside" by hash. */
function ancestors(p) {
  const out = [];
  let cur = path.resolve(p);
  for (;;) {
    const up = path.dirname(cur);
    if (up === cur) break;
    out.push(cur);
    cur = up;
  }
  return out;
}

// ---------- The setting ----------

/** Whether your Claude Code use outside the app is counted: { count } (on unless turned off). */
export async function readSetting(stateDir) {
  try {
    const d = JSON.parse(await fsp.readFile(path.join(stateDir, SETTING_FILE), 'utf8'));
    return { count: d?.count !== false };
  } catch { return { count: true }; }
}
/** Turns it on or off. */
export async function writeSetting(stateDir, { count }) {
  if (typeof count !== 'boolean') throw new TypeError('count is true or false.');
  await fsp.mkdir(stateDir, { recursive: true, mode: 0o700 });
  const file = path.join(stateDir, SETTING_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify({ count, changedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  await fsp.rename(tmp, file);
  return { count };
}

// ---------- One line ----------

/**
 * The usage numbers of one assistant reply, or null for any other line: { id, t (ms), family,
 * tokens, sidechain }. Nothing else of the line is kept.
 */
export function replyOf(d, { sidechain = false } = {}) {
  if (!d || typeof d !== 'object' || d.type !== 'assistant' || !d.message || typeof d.message !== 'object') return null;
  const m = d.message;
  if (!m.usage || typeof m.usage !== 'object' || !m.model || m.model === '<synthetic>') return null;
  const t = Date.parse(d.timestamp);
  const id = m.id ?? d.requestId ?? d.uuid;
  if (!Number.isFinite(t) || !id) return null;
  return { id: String(id), t, family: modelFamily(m.model) ?? 'other', tokens: tokensFromUsage(m.usage), sidechain: sidechain || d.isSidechain === true };
}

const packReply = (r) => [r.t, r.family, r.tokens.input, r.tokens.output, r.tokens.cacheRead, r.tokens.cacheWrite5m, r.tokens.cacheWrite1h, r.sidechain ? 1 : 0];
const unpackReply = (id, p) => ({ id, t: p[0], family: p[1], tokens: { input: p[2], output: p[3], cacheRead: p[4], cacheWrite5m: p[5], cacheWrite1h: p[6] }, sidechain: p[7] === 1 });
const newEntry = (st) => ({ size: 0, mtimeMs: 0, ino: st.ino, born: st.birthtimeMs || 0, offset: 0, session: null, dirs: null, temp: false, bad: 0, replies: new Map() });

// ---------- The reader ----------

export class ClaudeCodeUsage {
  /**
   * projectsDir: Claude Code's projects folder (injected: tests never read the real one).
   * stateDir: where the cache goes (null: no cache on disk). user: the person (groundControlUser).
   * tempRoots: the temp folders (insights.js tempDirs()). days: how far back to read.
   */
  constructor({ projectsDir, stateDir = null, user = 'unknown', tempRoots = tempDirs(), days = READ_DAYS, now = () => Date.now(), minRefreshMs = MIN_REFRESH_MS } = {}) {
    if (!projectsDir) throw new TypeError('projectsDir is required.');
    this.projectsDir = path.resolve(projectsDir);
    this.cacheFile = stateDir ? path.join(stateDir, CACHE_FILE) : null;
    this.user = user;
    this.tempRoots = tempRoots;
    this.days = days;
    this.now = now;
    this.minRefreshMs = minRefreshMs;
    this.files = new Map(); // file path → entry (in memory only; the cache on disk is keyed by hash)
    this.state = 'reading'; // until the first full read is done: then 'ready', or 'error'
    this.error = null;
    this.readAt = null;
    this.running = null;
    this.lastStart = 0;
    this.generation = 0;
    this.memo = null;
    this.stats = { files: 0, bytesRead: 0, lines: 0, bad: 0 };
  }

  /** Starts a refresh in the background unless one is running or one started a moment ago. Never waits. */
  poke() {
    if (this.running || this.now() - this.lastStart < this.minRefreshMs) return;
    this.refresh().catch(() => {});
  }

  /** Reads what is new (everything, the first time). Resolves when done; one at a time. */
  refresh() {
    if (this.running) return this.running;
    this.lastStart = this.now();
    this.running = this.#refresh().then(() => {
      this.state = 'ready';
      this.error = null;
      this.readAt = new Date(this.now()).toISOString();
    }, (err) => {
      // A failed first read says so; a failed later one keeps what was read before.
      if (this.state !== 'ready') this.state = 'error';
      this.error = String(err?.message ?? err).split('\n')[0];
    }).finally(() => { this.running = null; });
    return this.running;
  }

  async #refresh() {
    if (!this.loaded) { this.loaded = true; await this.#loadCache(); }
    const from = this.now() - this.days * DAY;
    const seen = new Set();
    let changed = false;
    for (const { file, rel } of await this.#walk()) {
      const st = await fsp.stat(file).catch(() => null);
      if (!st || !st.isFile() || st.mtimeMs < from) continue;
      seen.add(file);
      let e = this.files.get(file);
      if (e && e.size === st.size && e.mtimeMs === st.mtimeMs && e.ino === st.ino) continue;
      // A file that shrank or was replaced is read again from the start.
      if (!e || e.ino !== st.ino || st.size < e.offset) { e = newEntry(st); this.files.set(file, e); }
      await this.#readNew(file, rel, e, { from, size: st.size });
      e.size = st.size;
      e.mtimeMs = st.mtimeMs;
      changed = true;
    }
    for (const file of [...this.files.keys()]) if (!seen.has(file)) { this.files.delete(file); changed = true; }
    // Replies older than the read window go.
    for (const e of this.files.values()) for (const [id, p] of e.replies) if (p[0] < from) { e.replies.delete(id); changed = true; }
    if (changed) { this.generation++; this.memo = null; await this.#saveCache(); }
  }

  /** Every .jsonl under the projects folder (sessions, and sub-agents' logs below them). */
  async #walk() {
    const out = [];
    const walk = async (dir, depth) => {
      if (depth > 6) return;
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const ent of ents) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) await walk(p, depth + 1);
        else if (ent.isFile() && ent.name.endsWith('.jsonl') && depth >= 1) out.push({ file: p, rel: path.relative(this.projectsDir, p).split(path.sep) });
      }
    };
    await walk(this.projectsDir, 0);
    return out;
  }

  /** Streams the file from where the last read stopped, keeping whole lines only (a half-written last line waits). */
  async #readNew(file, rel, e, { from, size }) {
    const sidechain = rel.includes('subagents');
    e.folder ??= hashOf(rel[0]);
    // The session the file belongs to, when no line says: <session>.jsonl, or the <session> folder above a sub-agent's log.
    const fallbackSession = rel.length === 2 ? rel[1].replace(/\.jsonl$/, '') : rel[1] ?? null;
    let bufStart = e.offset;
    let rest = null;
    const stream = size > e.offset ? fs.createReadStream(file, { start: e.offset, end: size - 1, highWaterMark: 1 << 20 }) : [];
    for await (const chunk of stream) {
      const buf = rest ? Buffer.concat([rest, chunk]) : chunk;
      let start = 0;
      let nl;
      while ((nl = buf.indexOf(10, start)) !== -1) {
        this.#line(buf.subarray(start, nl), e, { from, sidechain });
        start = nl + 1;
      }
      bufStart += start;
      rest = start < buf.length ? Buffer.from(buf.subarray(start)) : null;
      this.stats.bytesRead += chunk.length;
    }
    e.offset = bufStart;
    e.session ??= fallbackSession;
    // No line said its working folder: the temp rule goes by the folder Claude Code keeps it in.
    if (!e.dirs) e.temp = this.tempRoots.some((t) => rel[0] === projectFolderName(t) || rel[0].startsWith(`${projectFolderName(t)}-`));
    this.stats.files++;
  }

  #line(buf, e, { from, sidechain }) {
    this.stats.lines++;
    // Only assistant replies with usage are parsed at all; everything else is skipped unread.
    if (buf.indexOf(ASSISTANT) === -1 || buf.indexOf(USAGE) === -1) return;
    let d;
    try { d = JSON.parse(buf.toString('utf8')); } catch { e.bad++; this.stats.bad++; return; }
    if (!d || typeof d !== 'object') { e.bad++; this.stats.bad++; return; }
    if (typeof d.sessionId === 'string' && !e.session) e.session = d.sessionId;
    if (typeof d.cwd === 'string' && d.cwd && !e.dirs) {
      e.dirs = ancestors(d.cwd).map(hashOf);
      e.temp = isTempPath(d.cwd, this.tempRoots);
    }
    const r = replyOf(d, { sidechain });
    if (!r || r.t < from) return;
    // The same message on several lines while it streamed: the last line wins.
    e.replies.delete(r.id);
    e.replies.set(r.id, packReply(r));
  }

  async #loadCache() {
    if (!this.cacheFile) return;
    let d;
    try { d = JSON.parse(await fsp.readFile(this.cacheFile, 'utf8')); } catch { return; }
    if (d?.version !== CACHE_VERSION || !Array.isArray(d.files)) return;
    // Keyed by the file path's hash: match each cached entry to the file it was read from.
    const byHash = new Map(d.files.map((f) => [f.key, f]));
    for (const { file } of await this.#walk()) {
      const f = byHash.get(hashOf(file));
      if (!f) continue;
      this.files.set(file, {
        size: f.size, mtimeMs: f.mtimeMs, ino: f.ino, born: f.born ?? 0, offset: f.offset, session: f.session ?? null, folder: f.folder ?? null,
        dirs: f.dirs ?? null, temp: f.temp === true, bad: f.bad ?? 0, replies: new Map(f.replies ?? []),
      });
    }
  }

  async #saveCache() {
    if (!this.cacheFile) return;
    const files = [...this.files.entries()].map(([file, e]) => ({
      key: hashOf(file), size: e.size, mtimeMs: e.mtimeMs, ino: e.ino, born: e.born, offset: e.offset, session: e.session, folder: e.folder ?? null,
      dirs: e.dirs, temp: e.temp, bad: e.bad, replies: e.temp ? [] : [...e.replies.entries()],
    }));
    await fsp.mkdir(path.dirname(this.cacheFile), { recursive: true, mode: 0o700 });
    const tmp = `${this.cacheFile}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify({ version: CACHE_VERSION, files }), { mode: 0o600 });
    await fsp.rename(tmp, this.cacheFile);
  }

  /**
   * Your Claude Code use outside this app: { state, replies, readAt, error }. state: 'reading' (the
   * first read isn't done: replies is null), 'ready' or 'error'. replies: [{ t (ISO), user, usd,
   * family, tokens, sidechain }], the oldest first, from `since` to `until` (ms; both optional).
   * exclude: { sessions (session ids), dirs (job worktree folders) } — this app's own jobs.
   */
  view({ exclude = {}, since = -Infinity, until = Infinity } = {}) {
    const base = { state: this.state, readAt: this.readAt, error: this.error };
    if (this.state !== 'ready') return { ...base, replies: null };
    const sessions = new Set([...(exclude.sessions ?? [])].filter(Boolean));
    const dirs = [...new Set([...(exclude.dirs ?? [])].filter(Boolean).map((d) => path.resolve(d)))];
    const key = `${this.generation}|${[...sessions].sort().join(',')}|${dirs.sort().join('\n')}`;
    if (this.memo?.key !== key) this.memo = { key, all: this.#combine({ sessions, dirs }) };
    const replies = this.memo.all.filter((r) => r.ms >= since && r.ms <= until).map(({ ms, ...r }) => r);
    return { ...base, replies };
  }

  #combine({ sessions, dirs }) {
    const dirHashes = new Set(dirs.map(hashOf));
    const folderHashes = new Set(dirs.map((d) => hashOf(projectFolderName(d))));
    const out = (e) => sessions.has(e.session) || folderHashes.has(e.folder) || (e.dirs ?? []).some((h) => dirHashes.has(h));
    // One reply per message id: the copy in the file made first, else any copy left out leaves it out.
    const byId = new Map();
    for (const e of this.files.values()) {
      if (e.temp) continue;
      const left = out(e);
      for (const [id, p] of e.replies) {
        const cur = byId.get(id);
        if (!cur) { byId.set(id, { p, left, born: e.born }); continue; }
        const firstHere = e.born > 0 && cur.born > 0 && e.born < cur.born;
        const firstThere = e.born > 0 && cur.born > 0 && cur.born < e.born;
        if (firstHere) byId.set(id, { p, left, born: e.born });
        else if (!firstThere) { cur.left ||= left; if (p[3] > cur.p[3]) cur.p = p; }
      }
    }
    const all = [];
    for (const [id, { p, left }] of byId) {
      if (left) continue;
      const r = unpackReply(id, p);
      all.push({ ms: r.t, t: new Date(r.t).toISOString(), user: this.user, usd: Math.round((estimateCost(r.family, r.tokens) ?? 0) * 1e6) / 1e6, family: r.family, tokens: r.tokens, sidechain: r.sidechain });
    }
    return all.sort((a, b) => a.ms - b.ms);
  }
}

// ---------- Words for the page ----------

export const CLAUDE_CODE_WORDS = {
  off: 'Your Claude Code use outside this app isn’t counted: it is in Other use. Turn it on in Settings → Workflow → Count my Claude Code use outside the app.',
  demo: 'The demo doesn’t read Claude Code’s logs.',
  reading: 'Reading Claude Code’s logs…',
  ready: 'Your Claude Code use outside this app is counted by name, from this computer’s Claude Code logs.',
  error: 'Couldn’t read Claude Code’s logs, so they aren’t counted yet: this app’s own use only.',
};
/** What the reader can't see, said on the page. */
export const CLAUDE_CODE_NOTE = 'Only this computer’s Claude Code logs are read. A teammate’s Claude Code on their own computer stays in Other use until they run this app too.';
