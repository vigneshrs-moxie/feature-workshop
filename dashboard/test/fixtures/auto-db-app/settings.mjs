// How the stand-in app reads its settings file, .env.local in its folder (the folder it runs in).
// As Next.js (@next/env) and dotenv do by default: a value already in the process wins over the
// file. override: the file wins instead, as an app that ignores the address it is given.
// databaseSettings(): the database settings in the environment, for the tests to read: every PG*
// setting and every value that is a Postgres address.
import fs from 'node:fs';

export function loadSettings({ override = false } = {}) {
  let text = '';
  try { text = fs.readFileSync('.env.local', 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    if (override || process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

export const databaseSettings = () => Object.fromEntries(Object.entries(process.env)
  .filter(([k, v]) => /^PG[A-Z0-9_]*$/.test(k) || /^postgres(ql)?:\/\//i.test(String(v))));

/** The database name in a Postgres address. */
export const dbName = (url) => decodeURIComponent(new URL(url).pathname.slice(1));
