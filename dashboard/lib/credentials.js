// Reading a saved sign-in (a secret another program keeps) on any system, read-only. In turn:
//   keytar          when the keytar package loads (it reaches the Keychain, Windows Credential
//                   Manager and the Secret Service on Linux)
//   macOS Keychain  `security find-generic-password -s <service> [-a <account>] -w`
//   Windows         Credential Manager through PowerShell's Get-StoredCredential (the
//                   CredentialManager module), only when that command is there; otherwise skipped
//   the file        last, on every system
// The first place with a secret that `accept` takes wins. Nothing is written, logged or passed on.
// The system, the command runner, the keytar import and the file read are injectable, so tests
// only build commands and never touch a real Keychain, Credential Manager or home folder.
//
// Where Claude Code keeps its own sign-in (its docs, "Credential management"): the macOS Keychain
// ("Claude Code-credentials"; ~/.claude/.credentials.json when the Keychain refuses the write); on
// Linux ~/.claude/.credentials.json (mode 600); on Windows %USERPROFILE%\.claude\.credentials.json.
// CLAUDE_CONFIG_DIR moves the file into that folder.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';

/** A PowerShell string literal (single quotes, doubled inside). */
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** The macOS Keychain command for one entry: { file, args }. */
export function keychainCommand({ service, account }) {
  return { file: 'security', args: ['find-generic-password', '-s', service, ...(account ? ['-a', account] : []), '-w'] };
}

/**
 * The Windows Credential Manager command for one entry: { file, args }. It prints the password and
 * nothing else, and prints nothing (and fails nothing) when Get-StoredCredential isn't installed.
 */
export function credentialManagerCommand({ service, account }) {
  const target = psq(service);
  const user = account ? ` | Where-Object { $_.UserName -eq ${psq(account)} }` : '';
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    'if (Get-Command Get-StoredCredential) {',
    `  $c = Get-StoredCredential -Target ${target} -AsCredentialObject${user} | Select-Object -First 1`,
    '  if ($c -and $c.Password) { [Console]::Out.Write($c.Password) }',
    '}',
  ].join('\n');
  return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script] };
}

// { code, out }; never throws.
const runCommand = (file, args) => new Promise((resolve) => {
  execFile(file, args, { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, out) => resolve({ code: err ? (err.code ?? 1) : 0, out: String(out ?? '') }));
});

const nonEmpty = (raw) => (typeof raw === 'string' && raw.trim() ? raw.trim() : null);

/**
 * A saved secret, or null. service/account name the entry in the system's credential store (account
 * may be left out: then any account of that service); file is the fallback file. accept(raw) turns
 * what was found into the value to return, or null to look in the next place.
 */
export async function readSecret({ service, account = null, file = null, accept = nonEmpty, platform = process.platform, run = runCommand, importKeytar = () => import('keytar'), readFile = (f) => fs.readFile(f, 'utf8') } = {}) {
  const take = (raw) => { try { return raw == null ? null : accept(String(raw)); } catch { return null; } };
  if (service) {
    try {
      const mod = await importKeytar();
      const keytar = mod?.default ?? mod;
      if (keytar?.getPassword) {
        const found = take(account ? await keytar.getPassword(service, account) : await keytar.findPassword(service));
        if (found) return found;
      }
    } catch { /* keytar isn't installed */ }
    const cmd = platform === 'darwin' ? keychainCommand({ service, account }) : platform === 'win32' ? credentialManagerCommand({ service, account }) : null;
    if (cmd) {
      try {
        const r = await run(cmd.file, cmd.args);
        const found = r.code === 0 ? take(r.out.trim()) : null;
        if (found) return found;
      } catch { /* not there */ }
    }
  }
  if (file) {
    try { return take(await readFile(file)); } catch { return null; }
  }
  return null;
}
