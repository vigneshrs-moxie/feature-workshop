// The settings files of a job's app, read for Auto's own database (lib/local.js autoDatabase and
// startServer). Function only: what keeps Auto's app and migrate scripts away from his database is
// the sandbox and the door (lib/db-door.js), which read no file. This module points the settings it
// understands at the door and Auto's copy, so the app finds it. A setting it misses means the app
// fails to connect; it can't mean the app reaches his database.
//
//   readSettings({ job, main, extra, home })  every .env / .env.<anything> file of both checkouts
//       (down to 6 folders; not node_modules, .git, .next, dist, build, out, coverage, .turbo,
//       .vercel, .claude, .worktrees, nor a nested worktree) and the profile's files to copy:
//       { files: [{ label, where, name, sample, pairs, lines }], unreadable: [label] }, files in the
//       order an app loads them (the job's worktree before the main folder; .env.development.local,
//       .env.local, .env.development, .env, then other names; sample files last)
//   dbHint(settings, env)          the first database-looking line, or env setting: { file, key }
//   autoDbEnvParts(db, settings, base, door)  the child's environment, its database settings naming
//                                       the door and Auto's copy, and the keys Starbase set in it
//   leftover(settings, set, db, env)    a hint, never a gate: a database-looking line that holds his
//                                       database's name and whose key Starbase didn't set: { file, key }
// No value ever leaves this module but in a child's environment: hints carry a file and a key.
//
// It runs inside the server, so whatever is in the files it stays quick: no pattern backtracks over a
// long line, the reader stops after MAX_LINES lines and MAX_CHARS characters over all files, a value
// over MAX_VALUE characters is not filled in or rewritten, and filling in gives up past 32 levels or
// MAX_FILLED characters. Giving up leaves a key not set, which is safe (see above). The hints look at
// MAX_LINES likely lines over all files; past that the file itself is the hint (it may name a database).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.turbo', '.vercel', '.claude', '.worktrees']);
const MAX_DEPTH = 6;
const MAX_BYTES = 1024 * 1024;
const MAX_LINES = 20_000;
const MAX_CHARS = 4 * 1024 * 1024;
const MAX_VALUE = 8192;
const MAX_FILLED = 1024 * 1024;
const MAX_LEVELS = 32;
export const ENV_FILE = /^\.env(\..+)?$/;
const SAMPLE = new Set(['.env.example', '.env.sample', '.env.template', '.env.dist']);
const LOAD_ORDER = ['.env.development.local', '.env.local', '.env.development', '.env'];

// ---------- Reading the files ----------

/** Where a file is, for the reason lines (S9): the job's <rel>, your main folder's <rel>, else ~/<rel>. */
function labeller({ job, main, home }) {
  const inside = (root, abs) => root && (abs === root || abs.startsWith(root + path.sep)) ? path.relative(root, abs) : null;
  return (abs) => {
    let rel;
    if ((rel = inside(job, abs)) !== null) return { label: `the job's ${rel}`, where: 'job' };
    if ((rel = inside(main, abs)) !== null) return { label: `your main folder's ${rel}`, where: 'main' };
    if ((rel = inside(home, abs)) !== null) return { label: `~/${rel}`, where: 'other' };
    return { label: abs, where: 'other' };
  };
}

/**
 * A regular file's text, or null (not a regular file, over max bytes, or it can't be read). It is
 * opened without waiting and looked at by its handle, so something swapped in after the caller's own
 * look (a FIFO, a bigger file) is not waited on or read: at most max bytes are ever read.
 */
async function regularText(abs, max) {
  let fh = null;
  try {
    fh = await fsp.open(abs, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
    const now = await fh.stat();
    if (!now.isFile() || now.size > max) return null;
    const buf = Buffer.alloc(now.size);
    let got = 0;
    while (got < buf.length) {
      const { bytesRead } = await fh.read(buf, got, buf.length - got, got);
      if (!bytesRead) break;
      got += bytesRead;
    }
    return buf.toString('utf8', 0, got);
  } catch { return null; } finally { await fh?.close().catch(() => {}); }
}

/**
 * One settings file by its path: { file } read, { unreadable } (a regular file Starbase can't read or
 * over 1 MB; anything not a regular file is never opened), or {} (no file there, or a folder).
 * A link is followed to a regular file wherever it lives; a dangling link or a link to a folder is ignored.
 */
async function readOne(abs, label) {
  let st;
  try { st = await fsp.lstat(abs); } catch (err) { return err.code === 'ENOENT' ? {} : { unreadable: true }; }
  let real = abs;
  if (st.isSymbolicLink()) {
    try { st = await fsp.stat(abs); real = await fsp.realpath(abs); } catch (err) { return err.code === 'ENOENT' ? {} : { unreadable: true }; }
  }
  if (st.isDirectory()) return {};
  if (!st.isFile() || st.size > MAX_BYTES) return { unreadable: true };
  const text = await regularText(real, MAX_BYTES);
  return text === null ? { unreadable: true } : { file: { text, real, label } };
}

/** A folder below the root that is another worktree: its .git is a file pointing into a /worktrees/ folder (a submodule's points into /modules/). */
async function nestedWorktree(dir) {
  try {
    const st = await fsp.lstat(path.join(dir, '.git'));
    if (!st.isFile() || st.size > 4096) return false;
    return /[\\/]worktrees[\\/]/.test(await regularText(path.join(dir, '.git'), 4096) ?? '');
  } catch { return false; }
}

const rank = (name, sample) => (sample ? 9 : LOAD_ORDER.includes(name) ? LOAD_ORDER.indexOf(name) : 4);
const newBudget = () => ({ lines: MAX_LINES, chars: MAX_CHARS, hints: MAX_LINES });

/**
 * Every settings file of the job's worktree (job) and the main folder (main), and extra files by path
 * (the profile's files to copy). Unreadable files and folders are listed by label: they mean no
 * recording. home: the home folder, for labels outside both checkouts.
 */
export async function readSettings({ job = null, main = null, extra = [], home = os.homedir() } = {}) {
  // Real paths, so a file reached through a link is named against the same roots (/var is /private/var on macOS).
  const real = async (p) => (p ? fsp.realpath(p).catch(() => p) : p);
  [job, main, home] = [await real(job), await real(main), await real(home)];
  extra = await Promise.all(extra.map(async (abs) => (abs ? path.join(await real(path.dirname(abs)), path.basename(abs)) : abs)));
  const label = labeller({ job, main, home });
  const seen = new Set();
  const files = [];
  const unreadable = [];
  const budget = newBudget();
  const add = async (abs) => {
    const where = label(abs);
    const r = await readOne(abs, where.label);
    if (r.unreadable) { unreadable.push(where.label); return; }
    if (!r.file || seen.has(r.file.real)) return;
    seen.add(r.file.real);
    // A file reached through a link is named where it really is.
    const at = r.file.real === abs ? where : label(r.file.real);
    const name = path.basename(abs);
    // Read here, one file at a time, so the server breathes between two files.
    files.push(readText({ label: at.label, where: at.where === 'other' ? where.where : at.where, name, text: r.file.text, sample: SAMPLE.has(name) }, budget));
  };
  async function walk(root, dir, depth) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (err) {
      if (!(dir === root && err.code === 'ENOENT')) unreadable.push(label(dir).label);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || depth >= MAX_DEPTH || await nestedWorktree(abs)) continue;
        await walk(root, abs, depth + 1);
      } else if (ENV_FILE.test(e.name)) {
        await add(abs); // a file, a link (followed to a file), or something never opened (unreadable)
      }
    }
  }
  for (const root of [job, main]) if (root) await walk(root, root, 0);
  for (const abs of extra) if (abs) await add(abs);
  const order = { job: 0, main: 1, other: 2 };
  files.sort((a, b) => (order[a.where] - order[b.where]) || (rank(a.name, a.sample) - rank(b.name, b.sample)) || a.label.localeCompare(b.label));
  return { files, unreadable };
}

/** Settings from files already read, in load order: [{ label, text, name?, sample? }] (the tests). */
export function settingsFromTexts(list) {
  const budget = newBudget();
  const files = list.map((f) => {
    const name = f.name ?? path.basename(String(f.label ?? ''));
    return readText({ where: 'job', ...f, name, sample: f.sample ?? SAMPLE.has(name) }, budget);
  });
  return { files, unreadable: [] };
}

// ---------- What looks like a database setting ----------

const parts = (key) => String(key ?? '').toUpperCase().split(/[_.-]/);
const DB_KEY = /DATABASE|POSTGRES|(?:^|[_.-])(?:DB|DBNAME|PG|PSQL|SQL)(?:$|[_.-])|^PG[A-Z]+$/i;
/** The key rule: DATABASE or POSTGRES in it, DB, DBNAME, PG, PSQL or SQL as a whole part (between _, . or -), or PG and letters (PGHOST). */
export function looksLikeDbKey(key) {
  return DB_KEY.test(String(key ?? ''));
}
/** The value rule: postgres, postgis, pgsql or jdbc: in it, socket: at its start, or dbname=, database= or db=. */
export function looksLikeDbValue(value) {
  const v = String(value ?? '');
  return /postgres|postgis|pgsql|jdbc:/i.test(v) || /^\s*socket:/i.test(v) || /(^|[^A-Za-z0-9_])(dbname|database|db)\s*=/i.test(v);
}
// Every line either rule can match has one of these in it: one quick look saves the rules for the lines that need them.
const MAYBE_DB = /DATABASE|POSTGRES|POSTGIS|JDBC:|SOCKET:|DB|PG|SQL/i;
const EXEMPT_PARTS = new Set(['USER', 'USERNAME', 'ROLE', 'PASSWORD', 'PASS', 'PWD', 'HOST', 'HOSTNAME', 'PORT']);
/** A key for a login or a server, not a database (POSTGRES_USER, DB_HOST; and libpq's PGUSER, PGPASSWORD, PGHOST, PGPORT). */
export const loginKey = (key) => EXEMPT_PARTS.has(parts(key).at(-1)) || /^PG(USER|PASSWORD|HOST|PORT)$/i.test(String(key ?? ''));
/** Keys whose bare value is a database's name: PGDATABASE, and a last part DB, DATABASE, DBNAME or NAME. */
const nameKey = (key) => /^PGDATABASE$/i.test(String(key ?? '')) || ['DB', 'DATABASE', 'DBNAME', 'NAME'].includes(parts(key).at(-1));
/** Starbase's own PATH, MANPATH…: a list of absolute folders is no database setting (Homebrew's postgresql@17 folder is often in it). */
const searchPath = (key, value) => /PATH$/i.test(String(key ?? '')) && /^\/[^:]*(?::\/[^:]*)*$/.test(String(value ?? ''));

// ---------- The reader ----------

const LINE_END = /\r\n|\r|\n/;
const BLANK = /^\s*(?:#|$)/; // nothing, or a # comment
const PAIR = /^\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*|:\s+)(.*)$/;
const HINT_KEY = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*(?:=|:\s)/;

/** Where a quoted value ends: the next q not escaped by a backslash, or -1. */
function closing(body, q) {
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === q) { i++; continue; }
    if (body[i] === q) return i;
  }
  return -1;
}

/**
 * .env lines the way dotenv reads them: `export`; KEY=value and KEY: value; single, double and
 * backtick quotes (a quoted value may run over several lines, a backslash-escaped quote doesn't end
 * it, and a quote that never closes is read as an unquoted value on that one line); a # comment after
 * an unquoted value; a line starting with # is a comment. [{ key, value, line, file }] (line: where
 * the pair starts). It stops when the budget ({ lines, chars }, over all files) is used up.
 */
function readPairs(all, budget, file) {
  const pairs = [];
  for (let i = 0; i < all.length && budget.lines > 0 && budget.chars > 0; i++) {
    const raw = all[i];
    budget.chars -= raw.length + 1;
    if (BLANK.test(raw)) continue;
    budget.lines--;
    const m = PAIR.exec(raw);
    if (!m) continue;
    const start = i;
    const rest = m[2];
    const q = rest[0];
    let value = null;
    if (q === '"' || q === "'" || q === '`') {
      const body = rest.slice(1);
      let end = closing(body, q);
      if (end >= 0) value = body.slice(0, end);
      else {
        // It closes on a later line, or never. The lines looked at are the value's, or (a miss) hold no
        // such quote, so no later line opens with it: every line is looked at a few times at most.
        let j = i + 1;
        while (j < all.length && (end = closing(all[j], q)) < 0) j++;
        if (j < all.length) { value = [body, ...all.slice(i + 1, j), all[j].slice(0, end)].join('\n'); i = j; }
      }
    }
    if (value === null) value = rest.split('#')[0].trim(); // unquoted, or a quote that never closes
    pairs.push({ key: m[1], value, line: start + 1, file });
  }
  return pairs;
}

/**
 * One file read: its pairs (the reader's, within the budget) and its lines (for the hints: every raw
 * line, not blank and not a # comment, that looks like a database setting by its key or its text,
 * whatever the reader makes of it): [{ n, key (or null), rest }]. Past budget.hints likely lines
 * (over all files) the rest is not looked at line by line: the next likely line is listed as it is,
 * with no key, so the file still counts as one that may name a database.
 */
function readText(file, budget = newBudget()) {
  const all = String(file.text ?? '').split(LINE_END);
  const lines = [];
  for (let i = 0; i < all.length; i++) {
    const text = all[i];
    if (!MAYBE_DB.test(text) || BLANK.test(text)) continue;
    if (budget.hints-- <= 0) { lines.push({ n: i + 1, key: null, rest: '' }); break; }
    const m = HINT_KEY.exec(text);
    const key = m ? m[1] : null;
    const rest = m ? text.slice(m[0].length) : text;
    if (looksLikeDbKey(key) || looksLikeDbValue(rest)) lines.push({ n: i + 1, key, rest });
  }
  return Object.assign(file, { pairs: readPairs(all, budget, file), lines });
}

const NAME_AT = /[A-Za-z_][A-Za-z0-9_]*/y;
const NAMES_IN = /\$\{?([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * A function that fills in $NAME, ${NAME}, ${NAME:-default} and ${NAME-default} by lookup(name) (a
 * string or undefined), as dotenv-expand does; defaults and looked-up values are filled in too.
 * Each name is worked out once. It answers null when it gives up: a text over MAX_VALUE characters,
 * more than MAX_LEVELS levels, or more than MAX_FILLED characters filled in over all its calls.
 */
export function expander(lookup) {
  const known = new Map(); // name -> its value filled in, or null (given up)
  let left = MAX_FILLED;
  const named = (name, level) => {
    if (known.has(name)) return known.get(name);
    const raw = lookup(name);
    if (raw === undefined) return undefined;
    known.set(name, ''); // a name that leads back to itself is empty there
    const v = fill(String(raw), level + 1);
    known.set(name, v);
    return v;
  };
  const fill = (s, level) => {
    if (!s.includes('$')) return s;
    if (level > MAX_LEVELS || s.length > MAX_VALUE) return null;
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\' && s[i + 1] === '$') { out += '$'; i++; continue; }
      if (c !== '$') { out += c; continue; }
      const braced = s[i + 1] === '{';
      NAME_AT.lastIndex = i + (braced ? 2 : 1);
      const m = NAME_AT.exec(s);
      if (!m) { out += c; continue; }
      let j = NAME_AT.lastIndex;
      let op = null;
      let def = '';
      if (braced) {
        if (s.startsWith(':-', j)) { op = ':-'; j += 2; } else if (s[j] === '-') { op = '-'; j += 1; }
        if (op) {
          let depth = 1;
          const from = j;
          for (; j < s.length && depth > 0; j++) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; }
          def = s.slice(from, j - 1);
        } else if (s[j] === '}') j += 1;
        else { out += c; continue; }
      }
      const v = named(m[0], level);
      if (v === null) return null;
      const use = (op === ':-' && (v === undefined || v === '')) || (op === '-' && v === undefined) ? fill(def, level + 1) : v ?? '';
      if (use === null) return null;
      out += use;
      if (out.length > MAX_VALUE) return null;
      i = j - 1;
    }
    left -= out.length;
    return left < 0 ? null : out;
  };
  return (value) => fill(String(value ?? ''), 0);
}

const byKeyOf = new WeakMap(); // settings -> pairsByKey's answer, made once
/** Each key's pairs over all files, in load order; a sample file's only when no other file has the key. */
function pairsByKey(settings) {
  let byKey = byKeyOf.get(settings);
  if (byKey) return byKey;
  byKey = new Map();
  let samples = false;
  for (const f of settings.files) {
    if (f.sample && f.pairs.length) samples = true;
    for (const p of f.pairs) {
      const list = byKey.get(p.key);
      if (list) list.push(p); else byKey.set(p.key, [p]);
    }
  }
  if (samples) for (const [k, list] of byKey) if (list.some((p) => p.file.sample) && list.some((p) => !p.file.sample)) byKey.set(k, list.filter((p) => !p.file.sample));
  byKeyOf.set(settings, byKey);
  return byKey;
}

/** What a name stands for when an app fills it in: the process's value (base) first, then the first file's in load order. */
const lookupIn = (byKey, base) => (n) => (base[n] != null ? String(base[n]) : byKey.get(n)?.[0]?.value);

// ---------- Naming the door and Auto's copy ----------

const URL_FORM = /^(jdbc:)?((?:postgres(?:ql)?|postgis|pgsql)(?:\+[\w.-]+)?):\/\/(.*)$/i;
const decode = (x) => { try { return decodeURIComponent(x); } catch { return null; } };
/** An address's parts: { userinfo, pathPart, query }, or null. */
function urlParts(rest) {
  const m = /^([^/?#]*)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/.exec(rest);
  if (!m) return null;
  const [, hostAll, pathPart = '', query = ''] = m;
  const at = hostAll.lastIndexOf('@');
  return { userinfo: at >= 0 ? hostAll.slice(0, at) : '', pathPart, query };
}
// What says where the server is, which database, or how to encrypt: these go; the door's own are added.
const WHERE_KEY = /^(?:host|hostaddr|port|dbname|service|passfile|ssl.*)$/i;
const CONNINFO_PAIR = /(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*('(?:[^'\\]|\\.)*'|[^\s']*)/g;

/** An address for Auto's copy through the door: the same scheme, user and password, the query kept but for WHERE_KEY, sslmode=disable. */
function doorUrl(m, u, db, door) {
  const kept = u.query.slice(1).split('&').filter((p) => p && !WHERE_KEY.test(p.split('=')[0]));
  return `${m[1] ?? ''}${m[2]}://${u.userinfo ? `${u.userinfo}@` : ''}127.0.0.1:${door.port}/${db.auto}?${[...kept, 'sslmode=disable'].join('&')}`;
}

/**
 * A value as Auto's copy has it behind the door, or null when it doesn't name his database (db.name):
 *   - an address (postgres, postgresql, postgis, pgsql, with a +driver, or jdbc:postgresql) whose path
 *     or ?dbname= is his database's name: doorUrl;
 *   - a conninfo with dbname=<name>: its other settings kept (but for WHERE_KEY), then the door's
 *     host and port, Auto's dbname and sslmode=disable;
 *   - the bare name, only when bare is true (a database-like setting whose key holds a database's name).
 * door: { port }.
 */
export function autoValue(value, db, door, { bare = false } = {}) {
  const v = String(value ?? '');
  if (v.length > MAX_VALUE) return null;
  const { name, auto } = db;
  const m = URL_FORM.exec(v);
  if (m) {
    const u = urlParts(m[3]);
    if (!u) return null;
    const named = [u.pathPart ? decode(u.pathPart.slice(1)) : null, ...[...u.query.matchAll(/[?&]dbname=([^&]*)/gi)].map((x) => decode(x[1]))];
    return named.includes(name) ? doorUrl(m, u, db, door) : null;
  }
  if (/(^|\s)dbname\s*=/i.test(v)) {
    const pairs = [...v.matchAll(CONNINFO_PAIR)];
    const unquoted = (x) => (x.startsWith("'") ? x.slice(1, -1) : x);
    if (!pairs.some((p) => p[1].toLowerCase() === 'dbname' && unquoted(p[2]) === name)) return null;
    const kept = pairs.filter((p) => !WHERE_KEY.test(p[1])).map((p) => `${p[1]}=${p[2]}`);
    return [...kept, 'host=127.0.0.1', `port=${door.port}`, `dbname=${auto}`, 'sslmode=disable'].join(' ');
  }
  if (bare && v.trim() === name) return auto;
  return null;
}

// libpq reads a service's settings (its dbname too) before the PG* fallbacks: no service is passed on,
// and its system folder is an empty one.
let sysconf = null;
const emptySysconf = () => (sysconf ??= fs.mkdtempSync(path.join(os.tmpdir(), 'starbase-pgsysconf-')));

/**
 * The environment for everything Auto starts on its own database, and the keys Starbase set in it.
 * Every value it sets names the door (127.0.0.1 and door.port) and Auto's copy (db.auto):
 *   - base (Starbase's own): a value that names his database is rewritten (autoValue); the rest stays;
 *   - each settings key whose value names his database, as written or filled in (expander: base, then
 *     the files in load order, first wins): rewritten, from the first file in load order whose value
 *     names it (a sample file only when no other file has the key). A bare name counts on a key that
 *     holds a database's name and that looks like a database setting, or that such a setting refers to;
 *   - DATABASE_URL and the profile's key (db.key): Auto's address through the door; PGHOST, PGPORT,
 *     PGDATABASE and PGSSLMODE=disable: the door and Auto's copy; PGHOSTADDR, PGSERVICE and
 *     PGSERVICEFILE removed; PGSYSCONFDIR an empty folder.
 * db: { url, name, key, auto, autoUrl }; settings: readSettings'; door: { port }, the door's.
 */
export function autoDbEnvParts(db, settings, base = process.env, door = null) {
  if (!Number.isInteger(door?.port) || door.port < 1 || door.port > 65535) throw new TypeError('autoDbEnvParts needs the door’s port.');
  const env = {};
  const set = new Set();
  const put = (k, v) => { env[k] = v; set.add(k); };
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    const a = autoValue(v, db, door, { bare: nameKey(k) && !loginKey(k) && looksLikeDbKey(k) });
    if (a !== null) put(k, a); else env[k] = v;
  }
  const byKey = pairsByKey(settings);
  // A pair is database-like by its key, by its value, or because a database-like pair refers to its key.
  const dbLike = [];
  for (const list of byKey.values()) {
    for (const p of list) {
      p.dbLike = (MAYBE_DB.test(p.key) || MAYBE_DB.test(p.value)) && (looksLikeDbKey(p.key) || looksLikeDbValue(p.value));
      if (p.dbLike) dbLike.push(p);
    }
  }
  const referred = new Set();
  for (let i = 0; i < dbLike.length; i++) {
    if (!dbLike[i].value.includes('$') || dbLike[i].value.length > MAX_VALUE) continue;
    for (const ref of dbLike[i].value.matchAll(NAMES_IN)) {
      if (referred.has(ref[1])) continue;
      referred.add(ref[1]);
      for (const p of byKey.get(ref[1]) ?? []) if (!p.dbLike) { p.dbLike = true; dbLike.push(p); }
    }
  }
  const fill = expander(lookupIn(byKey, base));
  for (const [k, list] of byKey) {
    if (set.has(k)) continue;
    for (const p of list) {
      const refers = p.value.includes('$');
      if (!refers && !p.value.includes(db.name) && !p.value.includes('%')) continue; // it can't name his database
      const bare = nameKey(k) && !loginKey(k) && p.dbLike === true;
      let a = autoValue(p.value, db, door, { bare });
      if (a === null && refers) { const filled = fill(p.value); if (filled !== null) a = autoValue(filled, db, door, { bare }); }
      if (a !== null) { put(k, a); break; }
    }
  }
  const m = URL_FORM.exec(String(db.autoUrl ?? ''));
  const u = m ? urlParts(m[3]) : null;
  const url = u ? doorUrl(m, u, db, door) : `postgres://127.0.0.1:${door.port}/${db.auto}?sslmode=disable`;
  put('DATABASE_URL', url);
  if (db.key) put(db.key, url);
  put('PGHOST', '127.0.0.1');
  put('PGPORT', String(door.port));
  put('PGDATABASE', db.auto);
  put('PGSSLMODE', 'disable');
  put('PGSYSCONFDIR', emptySysconf());
  for (const k of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']) { delete env[k]; set.delete(k); }
  return { env, set };
}

// ---------- The hints ----------

/**
 * The first database-looking setting, for Auto's path and the Test step: an unreadable file
 * ({ file, unreadable }), a database-like raw line ({ file, key } or key `line <n>`), else a setting
 * in env (Starbase's own) by the key or value rule ({ file: null, key }); a search path doesn't count.
 */
export function dbHint(settings, env = {}) {
  if (settings.unreadable.length) return { file: settings.unreadable[0], unreadable: true };
  for (const f of settings.files) if (f.lines.length) return { file: f.label, key: f.lines[0].key ?? `line ${f.lines[0].n}` };
  for (const [k, v] of Object.entries(env)) if (v != null && !searchPath(k, v) && (looksLikeDbKey(k) || looksLikeDbValue(v))) return { file: null, key: k };
  return null;
}

/** A test for his database's name in a line's text: the name as a whole word, a word character being [A-Za-z0-9_-] (so orbit-test and orbit_test don't hold orbit), as written or decoded; an unquoted value's # comment is not looked at. */
function holder(name) {
  const re = new RegExp(`(^|[^A-Za-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`);
  return (text) => {
    let t = String(text ?? '');
    if (!/^\s*['"`]/.test(t)) { const cut = t.search(/\s#/); if (cut >= 0) t = t.slice(0, cut); }
    return re.test(t) || re.test(decode(t) ?? t);
  };
}

/**
 * A hint for when the app asked for the wrong database (it gates nothing): the first database-like
 * raw line that holds his database's name, as written or filled in, and whose key Starbase didn't
 * set: { file, key } (key `line <n>` for a line with no key), else null. A login or server key
 * (loginKey) whose text isn't database-like is not looked at.
 */
export function leftover(settings, set, db, env = {}) {
  const holds = holder(db.name);
  const fill = expander(lookupIn(pairsByKey(settings), env));
  for (const f of settings.files) {
    for (const l of f.lines) {
      if (l.key && (set.has(l.key) || (loginKey(l.key) && !looksLikeDbValue(l.rest)))) continue;
      const filled = l.rest.includes('$') ? fill(l.rest) : null;
      if (holds(l.rest) || (filled !== null && holds(filled))) return { file: f.label, key: l.key ?? `line ${l.n}` };
    }
  }
  return null;
}
