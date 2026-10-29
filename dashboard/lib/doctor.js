// `ground-control doctor`: what this computer is missing for Ground Control, and how to get it
// (packet I step 2, plan §4.1, §4.3). Each check returns
//
//   { id, name, ok, found, fix, needed, runnable }
//
//   found     what is there now, in plain words
//   fix       the exact line for this system (null when ok): winget on Windows, brew on macOS,
//             the package manager's own line on Linux, or a ground-control command
//   needed    true when Ground Control can't do its work without it; false for a warning
//   runnable  true when `fix` is a command the installer may offer to run (after asking)
//
// Doctor never installs or changes anything itself. Every look at the computer goes through an
// injectable function, so tests can ask for any system with anything found or missing.

import net from 'node:net';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { envGet, findOnPath } from './platform.js';
import { pgTool } from './local.js';
import { readServiceFile } from '../runner/service-file.js';
import { OLD_STATE_FOLDER, PRODUCT, stateDirFor } from './state.js';
import { checkService, runCommand, SERVICE_PORT } from './service.js';

export const PORTS = [SERVICE_PORT, SERVICE_PORT + 1];
export const NODE_MAJOR = 22;

const SYSTEM_NAMES = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
export const systemName = (platform) => SYSTEM_NAMES[platform] ?? platform;

// ---------- The fix lines ----------

// Linux: the package manager this computer has, the first one found.
const LINUX_MANAGERS = ['apt-get', 'dnf', 'pacman', 'zypper'];
export const PACKAGES = {
  node: { win32: 'winget install -e --id OpenJS.NodeJS.LTS', darwin: 'brew install node', 'apt-get': 'sudo apt-get install -y nodejs npm', dnf: 'sudo dnf install -y nodejs', pacman: 'sudo pacman -S nodejs npm', zypper: 'sudo zypper install nodejs22' },
  git: { win32: 'winget install -e --id Git.Git', darwin: 'brew install git', 'apt-get': 'sudo apt-get install -y git', dnf: 'sudo dnf install -y git', pacman: 'sudo pacman -S git', zypper: 'sudo zypper install git' },
  gh: { win32: 'winget install -e --id GitHub.cli', darwin: 'brew install gh', 'apt-get': 'sudo apt-get install -y gh', dnf: 'sudo dnf install -y gh', pacman: 'sudo pacman -S github-cli', zypper: 'sudo zypper install gh' },
  postgres: { win32: 'winget install -e --id PostgreSQL.PostgreSQL', darwin: 'brew install postgresql@17', 'apt-get': 'sudo apt-get install -y postgresql postgresql-client', dnf: 'sudo dnf install -y postgresql-server postgresql', pacman: 'sudo pacman -S postgresql', zypper: 'sudo zypper install postgresql-server postgresql' },
};

/** The package manager doctor's Linux lines are for: apt-get, dnf, pacman or zypper (apt-get when none is found). */
export function linuxManager({ env = process.env, exists } = {}) {
  return LINUX_MANAGERS.find((m) => findOnPath(m, { platform: 'linux', env, ...(exists ? { exists } : {}) })) ?? 'apt-get';
}

/** The line that installs `tool` on this system. */
export function installLine(tool, { platform = process.platform, manager = 'apt-get' } = {}) {
  const lines = PACKAGES[tool];
  if (platform === 'win32' || platform === 'darwin') return lines[platform];
  return lines[manager] ?? lines['apt-get'];
}

const portLookLine = (port, platform) => (platform === 'win32' ? `netstat -ano | findstr :${port}` : `lsof -nP -iTCP:${port} -sTCP:LISTEN`);

// ---------- Looking at the computer ----------

/** Whether something listens on 127.0.0.1:port: a connection is tried and closed at once; nothing is opened. */
export function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.setTimeout(800);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(false));
  });
}

/** Where Playwright keeps its browsers on this system. */
export function playwrightDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const own = envGet(env, 'PLAYWRIGHT_BROWSERS_PATH', platform);
  if (own && own !== '0') return own;
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'darwin') return p.join(home, 'Library', 'Caches', 'ms-playwright');
  if (platform === 'win32') return p.join(envGet(env, 'LOCALAPPDATA', platform) || p.join(home, 'AppData', 'Local'), 'ms-playwright');
  return p.join(envGet(env, 'XDG_CACHE_HOME', platform) || p.join(home, '.cache'), 'ms-playwright');
}

/** Claude Code's sign-in, by its own files: the account in ~/.claude.json, or a credentials file; or a key in the environment. */
async function claudeSignedIn({ home, env, platform, readFile }) {
  if (envGet(env, 'ANTHROPIC_API_KEY', platform) || envGet(env, 'CLAUDE_CODE_OAUTH_TOKEN', platform)) return true;
  const p = platform === 'win32' ? path.win32 : path.posix;
  try {
    const j = JSON.parse(await readFile(p.join(home, '.claude.json')));
    if (j?.oauthAccount && (j.oauthAccount.accountUuid || j.oauthAccount.emailAddress)) return true;
  } catch { /* not signed in, or no file */ }
  try { await readFile(p.join(home, '.claude', '.credentials.json')); return true; } catch { return false; }
}

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };

/** The running Ground Control, from service.json in the state folder (or the old folder, for a copy from before the move). */
export function runningService({ env = process.env, home = os.homedir(), alive = pidAlive } = {}) {
  for (const dir of [stateDirFor(env, home), path.join(home, OLD_STATE_FOLDER)]) {
    const s = readServiceFile(dir);
    if (s && alive(s.pid)) return { ...s, stateDir: dir };
  }
  return null;
}

// ---------- The checks ----------

const check = (id, name, { ok, found, fix = null, needed = true, runnable = false }) => ({ id, name, ok: Boolean(ok), found, fix: ok ? null : fix, needed, runnable: ok ? false : runnable });

/**
 * Runs every check. Options (all injectable for tests):
 *   platform, env, home, nodeVersion
 *   run(file, args)          resolves { code, stdout, stderr } (code null: not on this computer)
 *   exists(path)             a file check, for PATH lookups and Postgres' folders
 *   readdir(dir), readFile(file)
 *   portInUse(port)          whether something listens there
 *   service                  the running Ground Control ({ port, pid }) or null
 *   serviceCheck()           { installed, running } (lib/service.js checkService)
 *   tokenSaved()             whether the Orbit token is saved
 *   isAdmin()                Windows: whether this account has administrator rights
 * Returns { ok, system, checks }: ok when every needed check is.
 */
export async function runDoctor(opts = {}) {
  const {
    platform = process.platform, env = process.env, home = os.homedir(), nodeVersion = process.versions.node,
    run = runCommand, exists, readdir = (d) => fsp.readdir(d), readFile = (f) => fsp.readFile(f, 'utf8'),
    portInUse: inUse = portInUse,
    service = runningService({ env, home }),
    serviceCheck = () => checkService({ platform, home, run }),
    tokenSaved = defaultTokenSaved({ env, home }),
    isAdmin = async () => (await run('net', ['session'])).code === 0,
  } = opts;
  const on = (name) => findOnPath(name, { platform, env, ...(exists ? { exists } : {}) });
  const manager = platform === 'linux' ? linuxManager({ env, exists }) : null;
  const install = (tool) => installLine(tool, { platform, manager });
  const checks = [];

  // Node 22 or later (doctor runs in Node, so it is there; the version is what counts).
  const major = Number(String(nodeVersion).split('.')[0]);
  checks.push(check('node', `Node ${NODE_MAJOR} or later`, { ok: major >= NODE_MAJOR, found: `Node ${nodeVersion}`, fix: install('node'), runnable: true }));

  // git
  const gitPath = on('git');
  const gitVersion = gitPath ? (await run(gitPath, ['--version'])).stdout.trim().replace(/^git version\s*/, '') : null;
  checks.push(check('git', 'Git', { ok: Boolean(gitPath), found: gitPath ? `git ${gitVersion || ''}`.trim() : 'not found', fix: install('git'), runnable: true }));

  // GitHub CLI, installed and signed in
  const ghPath = on('gh');
  checks.push(check('gh', 'GitHub CLI', { ok: Boolean(ghPath), found: ghPath ?? 'not found', fix: install('gh'), runnable: true }));
  let ghAuth = { ok: false, found: 'GitHub CLI isn’t installed yet' };
  if (ghPath) {
    const r = await run(ghPath, ['auth', 'status']);
    const who = /account\s+(\S+)/i.exec(`${r.stdout}\n${r.stderr}`)?.[1] ?? /as\s+(\S+)/i.exec(`${r.stdout}\n${r.stderr}`)?.[1];
    ghAuth = r.code === 0 ? { ok: true, found: who ? `signed in as ${who}` : 'signed in' } : { ok: false, found: 'not signed in' };
  }
  checks.push(check('gh-auth', 'GitHub CLI signed in (gh auth status)', { ...ghAuth, fix: 'gh auth login', runnable: true }));

  // Claude Code, installed and signed in
  const claudePath = on('claude');
  checks.push(check('claude', 'Claude Code', { ok: Boolean(claudePath), found: claudePath ?? 'not found', fix: 'npm install -g @anthropic-ai/claude-code', runnable: true }));
  const signedIn = claudePath ? await claudeSignedIn({ home, env, platform, readFile }) : false;
  checks.push(check('claude-login', 'Claude Code signed in', { ok: signedIn, found: claudePath ? (signedIn ? 'signed in' : 'not signed in') : 'Claude Code isn’t installed yet', fix: 'claude   (then type /login, and /exit when it says you are signed in)' }));

  // Playwright's browser: a warning only, since a job records its evidence only when it can (lib/evidence.js BROWSER_FIX says the same fix)
  let chromium = false;
  const pwDir = playwrightDir({ platform, env, home });
  try { chromium = (await readdir(pwDir)).some((n) => /^chromium/i.test(n)); } catch { chromium = false; }
  checks.push(check('playwright', 'Playwright’s browser (Chromium)', { ok: chromium, found: chromium ? `in ${pwDir}` : 'not found (needed to record screenshots and videos of a job’s checks)', fix: 'npx playwright install chromium', needed: false, runnable: true }));

  // Postgres tools
  const psql = await pgTool('psql', { platform, env, readdir, ...(exists ? { exists } : {}) });
  const hasPsql = psql !== 'psql';
  checks.push(check('postgres', 'Postgres tools (psql)', { ok: hasPsql, found: hasPsql ? psql : 'not found on PATH or in the usual folders', fix: install('postgres'), needed: false, runnable: true }));

  // The Orbit token
  const saved = await Promise.resolve().then(tokenSaved).catch(() => false);
  checks.push(check('orbit-token', 'Orbit token saved', { ok: saved, found: saved ? 'saved' : 'not saved (the Inbox needs it)', fix: 'ground-control token set', needed: false }));

  // Ports 4477 and 4478, free or Ground Control's own
  for (const port of PORTS) {
    const busy = await inUse(port);
    const ours = busy && service && (service.port === port || service.port + 1 === port);
    checks.push(check(`port-${port}`, `Port ${port} free${port === SERVICE_PORT ? '' : ' (its screens page)'}`, {
      ok: !busy || ours,
      found: !busy ? 'free' : ours ? `used by ${PRODUCT} (pid ${service.pid})` : 'in use by another program',
      fix: `${portLookLine(port, platform)}   (shows what is using it; stop that, then run ground-control doctor again)`,
    }));
  }

  // The service, and on Windows the rights it needs
  const admin = platform === 'win32' ? await Promise.resolve().then(isAdmin).catch(() => false) : null;
  let svc = { installed: false, running: null };
  try { svc = await serviceCheck(); } catch { /* reported as not installed */ }
  const running = svc.running ?? Boolean(service);
  let svcFound;
  let svcFix;
  if (svc.installed) {
    svcFound = running ? 'installed and running' : 'installed, not running';
    svcFix = 'ground-control start';
  } else if (platform === 'win32' && admin === false) {
    svcFound = `not installed: this account has no administrator rights, which Task Scheduler needs to start ${PRODUCT} at sign-in`;
    svcFix = 'ground-control start --here   (works fully without the service; keep that window open)';
  } else {
    svcFound = 'not installed';
    svcFix = 'ground-control install   (or ground-control start --here to run it in a terminal instead)';
  }
  checks.push(check('service', `${PRODUCT} service`, { ok: svc.installed && running, found: svcFound, fix: svcFix, needed: false }));
  if (platform === 'win32') {
    checks.push(check('admin', 'Administrator rights (only to install the service)', {
      ok: admin === true || svc.installed,
      found: admin ? 'yes' : svc.installed ? 'not needed: the service is installed' : 'no',
      fix: 'Open PowerShell with “Run as administrator” and run ground-control install, or use ground-control start --here (it needs no rights).',
      needed: false,
    }));
  }

  return { ok: checks.every((c) => c.ok || !c.needed), system: systemName(platform), platform, checks };
}

/** Whether an Orbit token is saved, read the way the dashboard reads it (lib/orbit-token.js). */
function defaultTokenSaved({ env, home }) {
  return async () => {
    const { tokenStore } = await import('./orbit-token.js');
    const store = await tokenStore({ stateDir: stateDirFor(env, home), prefer: env.WORKSHOP_ORBIT_STORE === 'file' || env.WORKSHOP_DEMO ? 'file' : 'auto' });
    return Boolean(await store.get());
  };
}

/** Doctor's report as lines for a terminal: the words say each check's state, never colour alone. */
export function formatDoctor(report) {
  const width = Math.max(...report.checks.map((c) => c.name.length));
  const lines = [`${PRODUCT} doctor (${report.system})`, ''];
  for (const c of report.checks) {
    const word = c.ok ? 'OK' : c.needed ? 'MISSING' : 'WARNING';
    lines.push(`  ${word.padEnd(8)} ${c.name.padEnd(width)}  ${c.found}`);
    if (!c.ok && c.fix) lines.push(`  ${''.padEnd(8)} ${''.padEnd(width)}  Fix: ${c.fix}`);
  }
  const missing = report.checks.filter((c) => !c.ok && c.needed).length;
  const warnings = report.checks.filter((c) => !c.ok && !c.needed).length;
  lines.push('');
  if (!missing && !warnings) lines.push('Everything is in place.');
  else {
    const parts = [];
    if (missing) parts.push(`${missing} ${missing === 1 ? 'thing is' : 'things are'} missing`);
    if (warnings) parts.push(`${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`);
    lines.push(`${parts.join(' and ')}. Doctor never installs anything itself: run the Fix lines above, then run ground-control doctor again.`);
  }
  return lines;
}
