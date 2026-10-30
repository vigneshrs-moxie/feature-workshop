// Where the Orbit token (orbfb_…, ORBIT-479) is kept: the OS credential store when there is one,
// else one file under the dashboard's state folder, readable by you only (mode 600).
//   keytar     when the keytar package is installed (Windows Credential Manager, macOS Keychain,
//              the Secret Service on Linux)
//   keychain   macOS without keytar: the login Keychain through the `security` command. The token
//              goes in on the command's standard input, never on its command line.
//   file       <state folder>/orbit-token, mode 600: everywhere else, and in demo mode and tests
// A store that fails to save falls back to the file, and says so (`kind`), so a paste never fails
// for want of a keychain. The token is never logged, and never written anywhere else.
//
// Every store is { kind, get(), set(token), clear() }. Paths, the platform, the command runner and
// the keytar import are injectable, so tests never touch the real Keychain or ~/.ground-control.
// `names` ({ service, account, file }) keeps another secret the same way under its own names: the
// laptop's site token (packet 2A, runner/site-link.js). Left out, it is the Orbit token's.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export const SERVICE = 'Ground Control Orbit token';
export const ACCOUNT = 'orbit-feedback';
export const TOKEN_FILE = 'orbit-token';

const ORBIT_NAMES = Object.freeze({ service: SERVICE, account: ACCOUNT, file: TOKEN_FILE });

/** The file store: <dir>/orbit-token (or names.file), mode 600, the folder 700. */
export function fileStore(dir, names = ORBIT_NAMES) {
  const file = path.join(dir, names.file);
  return {
    kind: 'file',
    file,
    async get() {
      try { return (await fs.readFile(file, 'utf8')).trim() || null; } catch { return null; }
    },
    async set(token) {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, token, { mode: 0o600 });
      await fs.chmod(tmp, 0o600); // a umask can't widen it
      await fs.rename(tmp, file);
    },
    async clear() {
      await fs.rm(file, { force: true });
    },
  };
}

/** The keytar store, given the loaded keytar module. */
export function keytarStore(keytar, { service, account } = ORBIT_NAMES) {
  return {
    kind: 'keytar',
    async get() { return (await keytar.getPassword(service, account)) || null; },
    async set(token) { await keytar.setPassword(service, account, token); },
    async clear() { await keytar.deletePassword(service, account); },
  };
}

// `security` with arguments (nothing secret in them); resolves { code, out }.
function runSecurity(args, input = null) {
  return new Promise((resolve) => {
    if (input === null) {
      execFile('security', args, { timeout: 5000 }, (err, out) => resolve({ code: err ? (err.code ?? 1) : 0, out: String(out ?? '') }));
      return;
    }
    const child = spawn('security', args, { stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => child.kill(), 5000);
    child.on('error', () => { clearTimeout(timer); resolve({ code: 1, out: '' }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out: '' }); });
    child.stdin.end(input);
  });
}

/**
 * The macOS login Keychain through `security`. `run(args, input)` is injectable for tests. The
 * token only ever reaches `security` on its standard input (interactive mode, one command), so it
 * never shows in the process list.
 */
export function keychainStore({ run = runSecurity, names: { service, account } = ORBIT_NAMES } = {}) {
  return {
    kind: 'keychain',
    async get() {
      const r = await run(['find-generic-password', '-a', account, '-s', service, '-w']);
      return r.code === 0 ? r.out.trim() || null : null;
    },
    async set(token) {
      if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new Error('The token has characters a token never has.');
      const r = await run(['-i'], `add-generic-password -U -a ${account} -s "${service}" -w ${token}\n`);
      if (r.code !== 0) throw new Error('The Keychain did not take the token.');
    },
    async clear() {
      await run(['delete-generic-password', '-a', account, '-s', service]);
    },
  };
}

/**
 * The first store that works, with the file behind it: set() saves to the first store and reads it
 * back; if that fails it saves to the file instead (and clears the file otherwise, so one copy is
 * kept). get() asks each in turn. clear() clears all. `kind` is where the token is now.
 */
export function layeredStore(primary, file) {
  if (!primary || primary === file) return file;
  let kind = primary.kind;
  return {
    get kind() { return kind; },
    file: file.file,
    async get() {
      try { const t = await primary.get(); if (t) { kind = primary.kind; return t; } } catch { /* try the file */ }
      const t = await file.get();
      if (t) kind = 'file';
      return t;
    },
    async set(token) {
      try {
        await primary.set(token);
        if ((await primary.get()) === token) { await file.clear(); kind = primary.kind; return; }
      } catch { /* fall back to the file */ }
      await file.set(token);
      kind = 'file';
    },
    async clear() {
      try { await primary.clear(); } catch { /* nothing there */ }
      await file.clear();
      kind = primary.kind;
    },
  };
}

/**
 * The store for this computer. `prefer`: 'file' forces the file (demo mode, tests, a manual check
 * with a throwaway state folder); otherwise keytar if it loads, else the Keychain on macOS, else the file.
 */
export async function tokenStore({ stateDir, prefer = 'auto', platform = process.platform, importKeytar = () => import('keytar'), run, names = ORBIT_NAMES } = {}) {
  const file = fileStore(stateDir, names);
  if (prefer === 'file') return file;
  try {
    const mod = await importKeytar();
    const keytar = mod?.default ?? mod;
    if (keytar?.getPassword) return layeredStore(keytarStore(keytar, names), file);
  } catch { /* not installed */ }
  if (platform === 'darwin') return layeredStore(keychainStore(run ? { run, names } : { names }), file);
  return file;
}
