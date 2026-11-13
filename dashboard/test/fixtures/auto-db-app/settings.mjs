// How the stand-in app reads its settings files, in the folder it runs in: .env.development.local,
// .env.local, .env.development and .env, in that order, as Next.js does; a value already in the
// process wins over the files (Next.js's @next/env and dotenv by default), and an earlier file wins
// over a later one. override: the files win instead, as an app that ignores the address it is given.
// readSettings(): .env.local's own values, whatever the process has.
// databaseSettings(): the database settings in the environment, for the tests to read: every PG*
// setting, every key naming a database, URL or connection, and every value that is a Postgres address.
import fs from 'node:fs';

const FILES = ['.env.development.local', '.env.local', '.env.development', '.env'];

function parse(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    out.push([m[1], value]);
  }
  return out;
}

export function loadSettings({ override = false } = {}) {
  const had = new Set(Object.keys(process.env));
  const set = new Set();
  for (const file of FILES) {
    for (const [k, v] of parse(file)) {
      if (override ? !set.has(k) : !had.has(k) && !set.has(k)) { process.env[k] = v; set.add(k); }
    }
  }
}

export const readSettings = () => Object.fromEntries(parse('.env.local'));

export const databaseSettings = () => Object.fromEntries(Object.entries(process.env)
  .filter(([k, v]) => /^PG[A-Z0-9_]*$/.test(k) || /DB|DATABASE|URL|CONNINFO|POSTGRES|PG/i.test(k) || /postgres(ql)?:\/\//i.test(String(v))));

/** The database name in a Postgres address. */
export const dbName = (url) => decodeURIComponent(new URL(url).pathname.slice(1));
