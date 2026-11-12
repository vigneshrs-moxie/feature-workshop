// The settings files of a job's app, read for Auto's own database (lib/local.js autoDatabase and
// startServer). The rule fails closed: whatever Starbase can't point at Auto's copy stops the recording.
//
//   readSettingsFiles(root)   every plain .env / .env.<anything> file under root, down to 6 folders
//                             (not node_modules, .git, .next, dist, build, out, coverage, .turbo,
//                             .vercel; no link followed): { files: [{ rel, pairs, loose }], unreadable: [rel] }
//   parseEnv(text)            dotenv's grammar: pairs [{ key, value, raw, line }], loose lines (neither a
//                             comment nor a KEY=value) [{ raw, line }]
//   looksLikeDb(key, value)   R1: a key or value that looks like a database setting
//   dbHint(files, env)        the first setting that looks like a database's: { file, key } or null
//   autoValue(key, value, db) a value as Auto's copy would have it, or null when it doesn't name his database
//   autoDbEnvParts(db, files, base)  the child's environment and the keys Starbase set in it
//   leftover(files, set, db)  R4: a database setting that holds his database's name and that Starbase
//                             didn't set: { file, key } or null
// No value ever leaves this module but in a child's environment: hints and leftovers carry a file and a key.

import fsp from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.turbo', '.vercel']);
const MAX_DEPTH = 6;
const MAX_BYTES = 1024 * 1024;
export const ENV_FILE = /^\.env(\..+)?$/;

/** Every settings file under root, read and parsed. A link, an unreadable file or one over 1 MB is unreadable. */
export async function readSettingsFiles(root) {
  const files = [];
  const unreadable = [];
  async function walk(dir, depth) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (ENV_FILE.test(e.name)) {
        const rel = path.relative(root, abs);
        // A link is not followed: the app may read what it points at, Starbase doesn't, so it counts as unreadable.
        if (!e.isFile()) { if (!e.isDirectory()) unreadable.push(rel); continue; }
        try {
          const st = await fsp.lstat(abs);
          if (st.size > MAX_BYTES) { unreadable.push(rel); continue; }
          files.push({ rel, ...parseEnv(await fsp.readFile(abs, 'utf8')) });
        } catch { unreadable.push(rel); }
        continue;
      }
      if (e.isDirectory() && !e.isSymbolicLink() && !SKIP_DIRS.has(e.name) && depth < MAX_DEPTH) await walk(abs, depth + 1);
    }
  }
  if (root) await walk(root, 0);
  return { files, unreadable };
}

/**
 * .env text the way dotenv reads it: \r\n and \r end lines; `export`; KEY=value and KEY: value;
 * single, double and backtick quotes (a quoted value may run over several lines); a # comment after
 * an unquoted value; a line starting with # is a comment.
 */
export function parseEnv(text) {
  const lines = String(text ?? '').split(/\r\n|\r|\n/);
  const pairs = [];
  const loose = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    const m = /^\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*|:\s+)(.*)$/.exec(raw);
    if (!m) { loose.push({ raw, line: i + 1 }); continue; }
    const key = m[1];
    let rest = m[2].replace(/^\s+/, '');
    let value;
    const q = rest[0];
    if (q === '"' || q === "'" || q === '`') {
      let body = rest.slice(1);
      let end = body.indexOf(q);
      const first = i;
      while (end < 0 && i + 1 < lines.length) { i++; body += `\n${lines[i]}`; end = body.indexOf(q); }
      if (end < 0) { loose.push({ raw, line: first + 1 }); continue; } // never closed: not a value dotenv reads
      value = body.slice(0, end);
      rest = body;
    } else {
      value = rest.split('#')[0].trim();
    }
    pairs.push({ key, value, raw: rest, line: i + 1 });
  }
  return { pairs, loose };
}

/** Each value with ${VAR} and $VAR filled in from the files' own pairs (the last one written wins). */
export function expandAll(files) {
  const known = new Map();
  for (const f of files) for (const p of f.pairs) known.set(p.key, p.value);
  const expand = (v) => {
    let out = String(v ?? '');
    for (let n = 0; n < 10 && /\$/.test(out); n++) {
      const next = out.replace(/\$\{([A-Za-z_]\w*)(?::?-[^}]*)?\}|\$([A-Za-z_]\w*)/g, (_, a, b) => known.get(a ?? b) ?? '');
      if (next === out) break;
      out = next;
    }
    return out;
  };
  for (const f of files) for (const p of f.pairs) p.expanded = expand(p.value);
  return files;
}

/** R1, the key: DATABASE or POSTGRES in it, DB, PG, PSQL or SQL as a whole part between underscores, or PG and letters (PGHOST). */
export function looksLikeDbKey(key) {
  const k = String(key ?? '').toUpperCase();
  return /DATABASE|POSTGRES/.test(k) || k.split('_').some((p) => ['DB', 'PG', 'PSQL', 'SQL'].includes(p)) || /^PG[A-Z]+$/.test(k);
}
/** R1, the value: postgres, postgis, pgsql or jdbc: in it, socket: at its start, or dbname=, database= or db=. */
export function looksLikeDbValue(value) {
  const v = String(value ?? '');
  return /postgres|postgis|pgsql|jdbc:/i.test(v) || /^\s*socket:/i.test(v) || /(^|[^A-Za-z0-9_])(dbname|database|db)\s*=/i.test(v);
}
// A search path (PATH, MANPATH…) names folders, not a database, though Homebrew's postgresql@17 folder is often in it.
export const looksLikeDb = (key, value) => looksLikeDbKey(key) || (!/PATH$/i.test(String(key ?? '')) && looksLikeDbValue(value));

/** Whether text holds name as a whole word (orbit in /orbit?x, db=orbit, "/tmp orbit"; not in orbit_test or orbit__auto). */
export function holdsName(text, name) {
  const t = String(text ?? '');
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^A-Za-z0-9_])${esc}(?![A-Za-z0-9_])`);
  let decoded = t;
  try { decoded = decodeURIComponent(t); } catch { /* as written */ }
  return re.test(t) || re.test(decoded);
}

/** The first setting that looks like a database's, for the Test step: { file, key }, or { file, unreadable: true }. */
export function dbHint({ files, unreadable }, env = {}) {
  if (unreadable.length) return { file: unreadable[0], unreadable: true };
  for (const f of files) {
    for (const p of f.pairs) if (looksLikeDb(p.key, p.value)) return { file: f.rel, key: p.key };
    for (const l of f.loose) if (looksLikeDbValue(l.raw)) return { file: f.rel, key: `line ${l.line}` };
  }
  for (const [k, v] of Object.entries(env)) if (v != null && looksLikeDb(k, v)) return { file: null, key: k };
  return null;
}

const LOCAL_HOSTS = new Set(['', 'localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
const decode = (x) => { try { return decodeURIComponent(x); } catch { return null; } };
/** A host as written in an address or a conninfo: local (this computer's server, a socket, or none) or not. */
function isLocalHost(h) {
  const host = decode(String(h ?? '').trim()) ?? String(h);
  if (host.startsWith('/')) return true; // a socket
  return LOCAL_HOSTS.has(host.toLowerCase());
}
const URL_FORM = /^(jdbc:)?((?:postgres(?:ql)?|postgis|pgsql)(?:\+[\w.-]+)?):\/\/(.*)$/i;
/** Auto's own address (its host, port, user and password) in the value's own scheme. */
const autoAddress = (db, jdbc, scheme) => db.autoUrl.replace(/^[a-z0-9+.-]+:\/\//i, `${jdbc ?? ''}${scheme}://`);

/**
 * A settings value as Auto's copy would have it, or null when it doesn't name his database (db.name):
 *   - an address (postgres, postgresql, postgis, pgsql, with a +driver, or jdbc:postgresql) whose path
 *     or ?dbname= is his database's name: the name becomes Auto's (db.auto); on a host that isn't this
 *     computer's server, the whole value becomes Auto's own address (db.autoUrl), so nothing dials it;
 *   - a conninfo with dbname=<name>: dbname becomes Auto's (a remote host=: Auto's own address);
 *   - the bare name under a key that looks like a database's (R1): Auto's name.
 */
export function autoValue(key, value, db) {
  const v = String(value ?? '');
  const { name, auto } = db;
  const m = URL_FORM.exec(v);
  if (m) {
    const rest = /^([^/?#]*)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/.exec(m[3]);
    if (!rest) return null;
    const [, hostPart, pathPart = '', query = '', hash = ''] = rest;
    let hit = false;
    let newPath = pathPart;
    if (pathPart && decode(pathPart.slice(1)) === name) { newPath = `/${auto}`; hit = true; }
    const newQuery = query.replace(/([?&]dbname=)([^&]*)/gi, (all, k, x) => (decode(x) === name ? ((hit = true), `${k}${auto}`) : all));
    if (!hit) return null;
    const hosts = hostPart.replace(/^.*@/, '').split(',').map((h) => (h.startsWith('[') ? h.replace(/\]:\d*$/, ']') : h.replace(/:\d*$/, '')));
    const queryHosts = [...query.matchAll(/[?&]host=([^&]*)/gi)].map((x) => x[1]);
    if ([...hosts, ...queryHosts].some((h) => !isLocalHost(h))) return autoAddress(db, m[1], m[2]);
    return `${m[1] ?? ''}${m[2]}://${hostPart}${newPath}${newQuery}${hash}`;
  }
  if (/(^|\s)dbname\s*=/i.test(v)) {
    let hit = false;
    const out = v.replace(/((?:^|\s)dbname\s*=\s*)('([^']*)'|[^\s']+)/gi, (all, k, x, quoted) => ((quoted ?? x) === name ? ((hit = true), `${k}${quoted !== undefined ? `'${auto}'` : auto}`) : all));
    if (!hit) return null;
    const hosts = [...v.matchAll(/(?:^|\s)host\s*=\s*('([^']*)'|[^\s']+)/gi)].flatMap((x) => (x[2] ?? x[1]).split(','));
    if (hosts.some((h) => !isLocalHost(h))) return db.autoUrl;
    return out;
  }
  if (looksLikeDbKey(key) && v.trim() === name) return auto;
  return null;
}

// libpq reads a service's settings (its dbname too) before the PG* fallbacks: set empty, so a file can't bring them back.
const PG_SERVICE = { PGSERVICE: '', PGSERVICEFILE: '/dev/null' };

/**
 * The environment for everything Auto starts on its own database, and the keys Starbase set in it:
 * base (Starbase's own, as a child gets it) with
 *   - each settings key whose value (filled in, else as written) names his database (autoValue) set
 *     to Auto's value: a value in the process wins over the files for an app that loads them as
 *     Next.js and dotenv do, so setting it is what protects it;
 *   - every key from base that names his database, or looks like a database setting and holds its
 *     name, left out;
 *   - DATABASE_URL, the profile's key (db.key) and PGDATABASE set to Auto's (db.autoUrl, db.auto);
 *     PGSERVICE set empty and PGSERVICEFILE to /dev/null.
 * Nothing else changes. db: { url, name, key, auto, autoUrl }; files: readSettingsFiles' (expanded here).
 */
export function autoDbEnvParts(db, files, base = process.env) {
  expandAll(files);
  const env = {};
  const set = new Set();
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || k in PG_SERVICE) continue;
    if (autoValue(k, v, db) !== null || (looksLikeDb(k, v) && holdsName(v, db.name))) continue;
    env[k] = v;
  }
  for (const f of files) {
    for (const p of f.pairs) {
      const a = autoValue(p.key, p.expanded, db) ?? autoValue(p.key, p.value, db);
      if (a !== null) { env[p.key] = a; set.add(p.key); }
    }
  }
  const forced = { DATABASE_URL: db.autoUrl, ...(db.key ? { [db.key]: db.autoUrl } : {}), PGDATABASE: db.auto, ...PG_SERVICE };
  for (const [k, v] of Object.entries(forced)) { env[k] = v; set.add(k); }
  return { env, set };
}

/**
 * R4, the net under every gap in the reading: a settings line (not a comment) that looks like a
 * database setting, holds his database's name as a whole word (as written or filled in), and whose
 * key Starbase didn't set in the child's environment (or that isn't a KEY=value at all): { file, key }.
 */
export function leftover(files, set, db) {
  for (const f of files) {
    for (const p of f.pairs) {
      if (set.has(p.key)) continue;
      const texts = [p.value, p.expanded];
      if (texts.some((t) => looksLikeDb(p.key, t)) && texts.some((t) => holdsName(t, db.name))) return { file: f.rel, key: p.key };
    }
    for (const l of f.loose) {
      const word = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)/.exec(l.raw)?.[1] ?? '';
      if ((looksLikeDbValue(l.raw) || looksLikeDbKey(word)) && holdsName(l.raw, db.name)) return { file: f.rel, key: `line ${l.line}` };
    }
  }
  return null;
}
