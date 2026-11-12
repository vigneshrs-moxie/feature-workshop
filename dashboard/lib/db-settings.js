// The settings files of a job's app, read for Auto's own database (lib/local.js autoDatabase and
// startServer). Two parts that never lean on each other:
//   - the READER (parseEnv, expansion) only works out which keys Starbase sets in the child's
//     environment, and with which value. A value in the process wins over every file, so a key
//     Starbase sets is safe however the app reads its files.
//   - the JUDGE (leftover, dbHint) reads the raw lines, never the reader's values. A line the reader
//     misreads ends in a refusal, never in a reach of his database.
//
//   readSettings({ job, main, extra, home })  every .env / .env.<anything> file of both checkouts
//       (down to 6 folders; not node_modules, .git, .next, dist, build, out, coverage, .turbo,
//       .vercel, .claude, .worktrees, nor a nested worktree) and the profile's files to copy:
//       { files: [{ label, where, name, text, sample }], unreadable: [label] }, files in the order an
//       app loads them (the job's worktree before the main folder; .env.development.local,
//       .env.local, .env.development, .env, then other names; sample files last)
//   dbHint(settings, env)          the first database-looking line, or env setting: { file, key }
//   autoDbEnvParts(db, settings, base)  the child's environment and the keys Starbase set in it
//   leftover(settings, set, db, env)    a database-looking line that holds his database's name and
//                                       whose key Starbase didn't set: { file, key } or null
// No value ever leaves this module but in a child's environment: hints and leftovers carry a file and a key.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.turbo', '.vercel', '.claude', '.worktrees']);
const MAX_DEPTH = 6;
const MAX_BYTES = 1024 * 1024;
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
  try { return { file: { text: await fsp.readFile(real, 'utf8'), real, label } }; } catch { return { unreadable: true }; }
}

/** A folder below the root that is another worktree: its .git is a file pointing into a /worktrees/ folder (a submodule's points into /modules/). */
async function nestedWorktree(dir) {
  try {
    const st = await fsp.lstat(path.join(dir, '.git'));
    if (!st.isFile()) return false;
    return /[\\/]worktrees[\\/]/.test(await fsp.readFile(path.join(dir, '.git'), 'utf8'));
  } catch { return false; }
}

const rank = (name, sample) => (sample ? 9 : LOAD_ORDER.includes(name) ? LOAD_ORDER.indexOf(name) : 4);

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
  const add = async (abs) => {
    const where = label(abs);
    const r = await readOne(abs, where.label);
    if (r.unreadable) { unreadable.push(where.label); return; }
    if (!r.file || seen.has(r.file.real)) return;
    seen.add(r.file.real);
    // A file reached through a link is named where it really is.
    const at = r.file.real === abs ? where : label(r.file.real);
    const name = path.basename(abs);
    files.push({ label: at.label, where: at.where === 'other' ? where.where : at.where, name, text: r.file.text, sample: SAMPLE.has(name) });
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
  return { ...settingsFromTexts(files), unreadable };
}

/**
 * Settings from files already read, in load order: [{ label, text, name?, sample? }] (readSettings,
 * and the tests): each gets its reader's pairs and its judge's raw lines.
 */
export function settingsFromTexts(list) {
  const files = list.map((f) => {
    const name = f.name ?? path.basename(String(f.label ?? ''));
    const file = { where: 'job', ...f, name, sample: f.sample ?? SAMPLE.has(name) };
    return Object.assign(file, parseEnv(file.text), { lines: rawLines(file) });
  });
  return { files, unreadable: [] };
}

// ---------- The reader ----------

/** Where a quoted value ends: the next q not escaped by a backslash, or -1. */
function closing(body, q) {
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === q) { i++; continue; }
    if (body[i] === q) return i;
  }
  return -1;
}

/**
 * .env text the way dotenv reads it: \r\n and \r end lines; `export`; KEY=value and KEY: value;
 * single, double and backtick quotes (a quoted value may run over several lines, a backslash-escaped
 * quote doesn't end it, and a quote that never closes is read as an unquoted value on that one line);
 * a # comment after an unquoted value; a line starting with # is a comment.
 * pairs: [{ key, value, line }] (line: where the pair starts).
 */
export function parseEnv(text) {
  const lines = String(text ?? '').split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    const m = /^\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*|:\s+)(.*)$/.exec(raw);
    if (!m) continue;
    const key = m[1];
    const rest = m[2].replace(/^\s+/, '');
    const start = i;
    const q = rest[0];
    let value = null;
    if (q === '"' || q === "'" || q === '`') {
      let body = rest.slice(1);
      let end = closing(body, q);
      let j = i;
      while (end < 0 && j + 1 < lines.length) { j++; body += `\n${lines[j]}`; end = closing(body, q); }
      if (end >= 0) { value = body.slice(0, end); i = j; }
    }
    if (value === null) value = rest.split('#')[0].trim(); // unquoted, or a quote that never closes
    pairs.push({ key, value, line: start + 1 });
  }
  return { pairs };
}

/**
 * value with $NAME, ${NAME}, ${NAME:-default} and ${NAME-default} filled in by lookup(name) (a string
 * or undefined), as dotenv-expand does; defaults and looked-up values are filled in too (8 deep).
 */
export function expandValue(value, lookup, depth = 8) {
  const s = String(value ?? '');
  if (depth <= 0 || !s.includes('$')) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '$') { out += '$'; i++; continue; }
    if (c !== '$') { out += c; continue; }
    let m;
    if (s[i + 1] === '{' && (m = /^\$\{([A-Za-z_][A-Za-z0-9_]*)/.exec(s.slice(i)))) {
      let j = i + m[0].length;
      let op = null;
      let def = '';
      if (s.startsWith(':-', j)) { op = ':-'; j += 2; } else if (s[j] === '-') { op = '-'; j += 1; }
      if (op) {
        let level = 1;
        const from = j;
        for (; j < s.length && level > 0; j++) { if (s[j] === '{') level++; else if (s[j] === '}') level--; }
        def = s.slice(from, j - 1);
      } else if (s[j] === '}') j += 1;
      else { out += c; continue; }
      const v = lookup(m[1]);
      const use = (op === ':-' && (v === undefined || v === '')) || (op === '-' && v === undefined) ? def : v ?? '';
      out += expandValue(use, lookup, depth - 1);
      i = j - 1;
    } else if ((m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(s.slice(i)))) {
      out += expandValue(lookup(m[1]) ?? '', lookup, depth - 1);
      i += m[0].length - 1;
    } else out += c;
  }
  return out;
}

// ---------- What looks like a database setting ----------

const parts = (key) => String(key ?? '').toUpperCase().split(/[_.-]/);
/** The key rule: DATABASE or POSTGRES in it, DB, PG, PSQL or SQL as a whole part (between _, . or -), or PG and letters (PGHOST). */
export function looksLikeDbKey(key) {
  const k = String(key ?? '').toUpperCase();
  return /DATABASE|POSTGRES/.test(k) || parts(k).some((p) => ['DB', 'PG', 'PSQL', 'SQL'].includes(p)) || /^PG[A-Z]+$/.test(k);
}
/** The value rule: postgres, postgis, pgsql or jdbc: in it, socket: at its start, or dbname=, database= or db=. */
export function looksLikeDbValue(value) {
  const v = String(value ?? '');
  return /postgres|postgis|pgsql|jdbc:/i.test(v) || /^\s*socket:/i.test(v) || /(^|[^A-Za-z0-9_])(dbname|database|db)\s*=/i.test(v);
}
const EXEMPT_PARTS = new Set(['USER', 'USERNAME', 'ROLE', 'PASSWORD', 'PASS', 'PWD', 'HOST', 'HOSTNAME', 'PORT']);
/** A key for a login or a server, not a database (POSTGRES_USER, DB_HOST; and libpq's PGUSER, PGPASSWORD, PGHOST, PGPORT). */
export const loginKey = (key) => EXEMPT_PARTS.has(parts(key).at(-1)) || /^PG(USER|PASSWORD|HOST|PORT)$/i.test(String(key ?? ''));
/** Keys whose bare value is a database's name: PGDATABASE, and a last part DB, DATABASE, DBNAME or NAME. */
const nameKey = (key) => /^PGDATABASE$/i.test(String(key ?? '')) || ['DB', 'DATABASE', 'DBNAME', 'NAME'].includes(parts(key).at(-1));
/** Starbase's own PATH, MANPATH…: a list of absolute folders is no database setting (Homebrew's postgresql@17 folder is often in it). */
const searchPath = (key, value) => /PATH$/i.test(String(key ?? '')) && /^\/[^:]*(?::\/[^:]*)*$/.test(String(value ?? ''));

// ---------- Holding his database's name ----------

const URL_FORM = /^(jdbc:)?((?:postgres(?:ql)?|postgis|pgsql)(?:\+[\w.-]+)?):\/\/(.*)$/i;
const decode = (x) => { try { return decodeURIComponent(x); } catch { return null; } };
/** An address's parts: { userinfo, hostPart, pathPart, query, hash }, or null. */
function urlParts(rest) {
  const m = /^([^/?#]*)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/.exec(rest);
  if (!m) return null;
  const [, hostAll, pathPart = '', query = '', hash = ''] = m;
  const at = hostAll.lastIndexOf('@');
  return { userinfo: at >= 0 ? hostAll.slice(0, at) : '', hostPart: hostAll, pathPart, query, hash };
}

/**
 * Whether a line's text holds his database's name. A plain value (one token, no space, quote,
 * backslash or $) that is a Postgres address holds it only in its database part (path or ?dbname=),
 * or as its user when it has no database part. Anything else: the name as a whole word, a word
 * character being [A-Za-z0-9_-] (so orbit-test and orbit_test don't hold orbit), as written or decoded.
 */
export function holdsName(rest, name) {
  let t = String(rest ?? '').trim().replace(/\s+#.*$/, '');
  const quoted = /^(['"`])(.*)\1$/.exec(t);
  if (quoted) t = quoted[2];
  const m = !/[\s'"`\\$]/.test(t) ? URL_FORM.exec(t) : null;
  const u = m ? urlParts(m[3]) : null;
  if (u) {
    const db = u.pathPart.length > 1 ? decode(u.pathPart.slice(1)) : null;
    const dbnames = [...u.query.matchAll(/[?&]dbname=([^&]*)/gi)].map((x) => decode(x[1]));
    if (db !== null || dbnames.length) return db === name || dbnames.includes(name);
    return decode(u.userinfo.split(':')[0]) === name;
  }
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^A-Za-z0-9_-])${esc}(?![A-Za-z0-9_-])`);
  const raw = String(rest ?? '');
  return re.test(raw) || re.test(decode(raw) ?? raw);
}

// ---------- The judge: raw lines ----------

const REF = /\$\{?([A-Za-z_][A-Za-z0-9_]*)/g;
/** A file's raw lines (not blank, not a # comment): { n, key (or null), rest, refs }. */
function rawLines(file) {
  const out = [];
  String(file.text ?? '').split(/\r\n|\r|\n/).forEach((text, i) => {
    if (!text.trim() || text.trimStart().startsWith('#')) return;
    const m = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*(?:=|:\s)/.exec(text);
    out.push({ file, n: i + 1, key: m ? m[1] : null, rest: m ? text.slice(m[0].length) : text, refs: [...text.matchAll(REF)].map((x) => x[1]) });
  });
  return out;
}

/** Every raw line of every file, with dbLike set: the key rule, the value rule, or a key a database-like line refers to (any depth). */
function judgedLines(settings) {
  const lines = settings.files.flatMap((f) => f.lines);
  const byKey = new Map();
  for (const l of lines) if (l.key) byKey.set(l.key, [...(byKey.get(l.key) ?? []), l]);
  const queue = [];
  for (const l of lines) { l.dbLike = looksLikeDbKey(l.key) || looksLikeDbValue(l.rest); if (l.dbLike) queue.push(l); }
  while (queue.length) {
    for (const r of queue.shift().refs) for (const l of byKey.get(r) ?? []) if (!l.dbLike) { l.dbLike = true; queue.push(l); }
  }
  return { lines, byKey };
}

/**
 * The first database-looking setting, for Auto's path and the Test step: an unreadable file
 * ({ file, unreadable }), a database-like raw line ({ file, key } or key `line <n>`), else a setting
 * in env (Starbase's own) by the key or value rule ({ file: null, key }); a search path doesn't count.
 */
export function dbHint(settings, env = {}) {
  if (settings.unreadable.length) return { file: settings.unreadable[0], unreadable: true };
  const l = judgedLines(settings).lines.find((x) => x.dbLike);
  if (l) return { file: l.file.label, key: l.key ?? `line ${l.n}` };
  for (const [k, v] of Object.entries(env)) if (v != null && !searchPath(k, v) && (looksLikeDbKey(k) || looksLikeDbValue(v))) return { file: null, key: k };
  return null;
}

/**
 * The rule: every database-like raw line that holds his database's name (as written, or through a
 * variable Starbase doesn't set whose value anywhere holds it) must have a key Starbase sets in the
 * child's environment. A login or server key (loginKey) whose text isn't database-like is not judged.
 * The first line that breaks it: { file, key } (key `line <n>` for a line with no key), else null.
 */
export function leftover(settings, set, db, env = {}) {
  const { lines, byKey } = judgedLines(settings);
  const candidates = (name) => [...(env[name] != null ? [String(env[name])] : []), ...(byKey.get(name) ?? []).map((l) => l.rest)];
  const viaRef = (name, depth, seen) => {
    if (set.has(name) || seen.has(name) || depth <= 0) return false;
    seen.add(name);
    return candidates(name).some((c) => holdsName(c, db.name) || [...c.matchAll(REF)].some((x) => viaRef(x[1], depth - 1, seen)));
  };
  for (const l of lines) {
    if (!l.dbLike) continue;
    if (l.key && loginKey(l.key) && !looksLikeDbValue(l.rest)) continue;
    if (l.key && set.has(l.key)) continue;
    if (holdsName(l.rest, db.name) || l.refs.some((r) => viaRef(r, 8, new Set()))) return { file: l.file.label, key: l.key ?? `line ${l.n}` };
  }
  return null;
}

// ---------- The reader's rewrite ----------

const LOCAL_HOSTS = new Set(['', 'localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
/** A host as written in an address or a conninfo: local (this computer's server, a socket, or none) or not. */
function isLocalHost(h) {
  const host = decode(String(h ?? '').trim()) ?? String(h);
  if (host.startsWith('/')) return true; // a socket
  return LOCAL_HOSTS.has(host.toLowerCase());
}
/** Auto's own address (its host, port, user and password) in the value's own scheme. */
const autoAddress = (db, jdbc, scheme) => db.autoUrl.replace(/^[a-z0-9+.-]+:\/\//i, `${jdbc ?? ''}${scheme}://`);

/**
 * A value as Auto's copy would have it, or null when it doesn't name his database (db.name):
 *   - an address (postgres, postgresql, postgis, pgsql, with a +driver, or jdbc:postgresql) whose path
 *     or ?dbname= is his database's name: the name becomes Auto's (db.auto); on a host that isn't this
 *     computer's server, the whole value becomes Auto's own address (db.autoUrl), so nothing dials it;
 *   - a conninfo with dbname=<name>: dbname becomes Auto's (a remote host=: Auto's own address);
 *   - the bare name, only when bare is true (a database-like line of a key that holds a database's name).
 */
export function autoValue(key, value, db, { bare = false } = {}) {
  const v = String(value ?? '');
  const { name, auto } = db;
  const m = URL_FORM.exec(v);
  if (m) {
    const u = urlParts(m[3]);
    if (!u) return null;
    let hit = false;
    let newPath = u.pathPart;
    if (u.pathPart && decode(u.pathPart.slice(1)) === name) { newPath = `/${auto}`; hit = true; }
    const newQuery = u.query.replace(/([?&]dbname=)([^&]*)/gi, (all, k, x) => (decode(x) === name ? ((hit = true), `${k}${auto}`) : all));
    if (!hit) return null;
    const hosts = u.hostPart.replace(/^.*@/, '').split(',').map((h) => (h.startsWith('[') ? h.replace(/\]:\d*$/, ']') : h.replace(/:\d*$/, '')));
    const queryHosts = [...u.query.matchAll(/[?&]host=([^&]*)/gi)].map((x) => x[1]);
    if ([...hosts, ...queryHosts].some((h) => !isLocalHost(h))) return autoAddress(db, m[1], m[2]);
    return `${m[1] ?? ''}${m[2]}://${u.hostPart}${newPath}${newQuery}${u.hash}`;
  }
  if (/(^|\s)dbname\s*=/i.test(v)) {
    let hit = false;
    const out = v.replace(/((?:^|\s)dbname\s*=\s*)('([^']*)'|[^\s']+)/gi, (all, k, x, quoted) => ((quoted ?? x) === name ? ((hit = true), `${k}${quoted !== undefined ? `'${auto}'` : auto}`) : all));
    if (!hit) return null;
    const hosts = [...v.matchAll(/(?:^|\s)host\s*=\s*('([^']*)'|[^\s']+)/gi)].flatMap((x) => (x[2] ?? x[1]).split(','));
    if (hosts.some((h) => !isLocalHost(h))) return db.autoUrl;
    return out;
  }
  if (bare && v.trim() === name) return auto;
  return null;
}

// libpq reads a service's settings (its dbname too) before the PG* fallbacks: PGSERVICE is never passed
// on (set empty, libpq looks for a service named ""), there is no service file, and no system folder.
let sysconf = null;
const emptySysconf = () => (sysconf ??= fs.mkdtempSync(path.join(os.tmpdir(), 'starbase-pgsysconf-')));

/**
 * The environment for everything Auto starts on its own database, and the keys Starbase set in it:
 *   - base (Starbase's own): PGSERVICE removed; a setting that looks like a database's by the key or
 *     value rule and names his database is rewritten to Auto's, or left out when it can't be; a login
 *     or server key (PGUSER…) and a search path (PATH…) stay as they are;
 *   - each settings key whose value names his database, as written or filled in (expandValue: the keys
 *     Starbase sets, then base, then the files in load order, first wins), set to Auto's value, taken
 *     from the first file in load order whose value names it (a sample file only when no other file
 *     has the key); again until nothing is added (8 passes at most);
 *   - DATABASE_URL, the profile's key (db.key) and PGDATABASE: Auto's; PGSERVICEFILE=/dev/null and
 *     PGSYSCONFDIR an empty folder.
 * db: { url, name, key, auto, autoUrl }; settings: readSettings'.
 */
export function autoDbEnvParts(db, settings, base = process.env) {
  const env = {};
  const set = new Set();
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || k === 'PGSERVICE') continue;
    if (!searchPath(k, v) && !(loginKey(k) && !looksLikeDbValue(v)) && (looksLikeDbKey(k) || looksLikeDbValue(v)) && holdsName(v, db.name)) {
      const a = autoValue(k, v, db, { bare: nameKey(k) });
      if (a !== null) { env[k] = a; set.add(k); }
      continue; // left out when it can't be pointed at Auto's copy
    }
    env[k] = v;
  }
  const { lines } = judgedLines(settings);
  const dbLikeAt = new Map(lines.map((l) => [`${l.file.label}:${l.n}`, l.dbLike]));
  // Each key's pairs, in load order; a sample file's only when no other file has the key.
  const byKey = new Map();
  for (const f of settings.files) for (const p of f.pairs) byKey.set(p.key, [...(byKey.get(p.key) ?? []), { ...p, file: f }]);
  for (const [k, list] of byKey) if (list.some((p) => !p.file.sample)) byKey.set(k, list.filter((p) => !p.file.sample));
  const lookup = (n) => (set.has(n) ? env[n] : base[n] !== undefined ? String(base[n]) : byKey.get(n)?.[0]?.value);
  for (let pass = 0, added = true; added && pass < 8; pass++) {
    added = false;
    for (const [k, list] of byKey) {
      if (set.has(k)) continue;
      for (const p of list) {
        const bare = nameKey(k) && !loginKey(k) && dbLikeAt.get(`${p.file.label}:${p.line}`) === true;
        const a = autoValue(k, p.value, db, { bare }) ?? autoValue(k, expandValue(p.value, lookup), db, { bare });
        if (a !== null) { env[k] = a; set.add(k); added = true; break; }
      }
    }
  }
  const forced = { DATABASE_URL: db.autoUrl, ...(db.key ? { [db.key]: db.autoUrl } : {}), PGDATABASE: db.auto, PGSERVICEFILE: '/dev/null', PGSYSCONFDIR: emptySysconf() };
  for (const [k, v] of Object.entries(forced)) { env[k] = v; set.add(k); }
  return { env, set };
}
