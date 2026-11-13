// "Try it on your computer": run a job's work locally, next to your main checkout.
// For a job with a worktree it finds the app folder, gives the job its own port, prepares the app's
// settings file from the main checkout's (port and the local sign-in skip), starts and stops the
// dev server, runs commands there, and opens a terminal in it. For apps that keep a migration ledger
// (an applied_migrations table and an npm "db:migrate" script) it can also switch the shared local
// database to match the job's branch, and put the saved original back.
// Nothing here runs by itself: each action is a click on the job page. Output streams to the page.
// The app folder, the start command, the port range, the files to copy and the keys in them come
// from the job's repository's profile (lib/profile.js, through lib/repos.js); a repository with no
// profile gets the general case (profile.js GENERAL), as before profiles existed.

import { spawn, execFile } from 'node:child_process';
import { execGit } from './git.js';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { envGet, findOnPath, folderLabel, killTree as stopProcessTree, openIn, shellFor, terminalApps } from './platform.js';
import { GENERAL, GENERAL_FILE_RULE, devCommand, fillPattern, tryItRules } from './profile.js';
import { openRegistry } from './repos.js';
import { guessedWorktree, guessWords } from './locate.js';
import { PRODUCT } from './brand.js';
import { autoDbEnvParts, dbHint, leftover, readSettings } from './db-settings.js';
import { openDoor, sandboxProfile, sandboxed, sandboxWorks } from './db-door.js';

const OUTPUT_MAX = 200_000; // characters kept per output box
const PRESETS = [
  { id: 'check', script: 'check', label: 'Run all checks', hint: 'Types, lint and tests, as the job’s checks run them' },
  { id: 'test', script: 'test', label: 'Run tests' },
  { id: 'typecheck', script: 'typecheck', label: 'Check types' },
  { id: 'lint', script: 'lint', label: 'Lint' },
  { id: 'build', script: 'build', label: 'Build', hint: 'Builds the app the way it ships' },
];
const GIT_PRESETS = [
  { id: 'git-status', label: 'What’s changed', command: 'git status --short --branch', where: 'root' },
  { id: 'git-log', label: 'Recent commits', command: 'git log --oneline -15', where: 'root' },
];
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CHILD_ENV_DROP = /^(PORT|STARBASE_[A-Z_]*|WORKSHOP_[A-Z_]*|GROUND_CONTROL_[A-Z_]*)$/; // ours, by the new and the old names
// Where the Postgres tools usually are, per system; pgTool() also looks in the versioned folders
// (Homebrew's opt/postgresql@<n>, Debian's /usr/lib/postgresql/<n>, Windows' PostgreSQL\<n>) and on PATH.
const PG_DIRS = {
  darwin: ['/opt/homebrew/bin', '/usr/local/bin', '/Applications/Postgres.app/Contents/Versions/latest/bin'],
  linux: ['/usr/bin', '/usr/local/bin'],
  win32: [],
};

const exists = (p) => fs.existsSync(p);
const readJson = async (file) => { try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return null; } };
const shDone = (resolve) => (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code ?? 1 : 0, killed: Boolean(err?.killed), stdout: String(stdout), stderr: String(stderr) });
const sh = (file, args, opts = {}) => new Promise((resolve) => {
  execFile(file, args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024, ...opts }, shDone(resolve));
});
const shGit = (args, opts = {}) => new Promise((resolve) => {
  execGit(args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024, ...opts }, shDone(resolve));
});

// ---------- Settings files ----------

/** The value of KEY in .env text (the last one wins, as in dotenv), or null. */
export function envValue(text, key) {
  let value = null;
  for (const line of String(text).split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || m[1] !== key) continue;
    let v = m[2].trim();
    const quoted = /^(['"])(.*?)\1\s*(?:#.*)?$/.exec(v);
    v = quoted ? quoted[2] : v.replace(/\s+#.*$/, '');
    value = v;
  }
  return value;
}

/** Sets KEY=value lines in .env text, keeping every other line as it was. */
export function setEnvKeys(text, values) {
  const seen = new Set();
  const lines = String(text).split('\n').map((line) => {
    const m = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!m || !(m[2] in values)) return line;
    seen.add(m[2]);
    return `${m[1]}${m[2]}=${values[m[2]]}`;
  });
  const missing = Object.entries(values).filter(([k]) => !seen.has(k));
  if (missing.length && lines.at(-1) !== '') lines.push('');
  for (const [k, v] of missing) lines.splice(lines.length - 1, 0, `${k}=${v}`);
  return lines.join('\n');
}

const isLocalHost = (h) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(h);

/**
 * The changes a job's settings file needs for its port: { values, notes }. Values never leave the
 * server. rule: the profile's file entry (portKeys: the settings whose localhost address follows
 * the job's port, such as sign-in callbacks; signInSkip: the local sign-in skip, set to true when
 * the file has it); the general case's without one.
 */
export function envChanges(text, port, rule = GENERAL_FILE_RULE) {
  const values = {};
  const notes = [];
  for (const key of rule.portKeys ?? []) {
    const v = envValue(text, key);
    if (v === null || v === '') continue;
    let u;
    try { u = new URL(v); } catch { notes.push(`${key} isn’t a web address, so it was left alone.`); continue; }
    if (!isLocalHost(u.hostname)) { notes.push(`${key} points somewhere other than this computer, so it was left alone.`); continue; }
    u.port = String(port);
    values[key] = u.toString().replace(/\/$/, v.endsWith('/') ? '/' : '');
  }
  if (rule.signInSkip && envValue(text, rule.signInSkip) !== null) values[rule.signInSkip] = 'true';
  return { values, notes };
}

// ---------- Ports and processes ----------

const portInUse = (port) => new Promise((resolve) => {
  const s = net.connect({ port, host: '127.0.0.1' });
  s.setTimeout(800);
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('timeout', () => { s.destroy(); resolve(false); });
  s.once('error', () => resolve(false));
});

function childEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !CHILD_ENV_DROP.test(k)));
  return { ...env, NO_COLOR: '1', FORCE_COLOR: '0', CI: env.CI ?? '', ...extra };
}

// Kill a process and everything it started (dev servers start helpers of their own).
// On Windows (no process groups) taskkill /T stops the whole tree (lib/platform.js).
function killTree(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  if (stopProcessTree(child.pid, { signal }) === null) { try { child.kill(signal); } catch { /* gone */ } }
}

const clip = (s) => (s.length > OUTPUT_MAX ? `…(earlier output trimmed)…\n${s.slice(-OUTPUT_MAX)}` : s);

// ---------- Database (shared local database, migration ledger) ----------

/**
 * Where a Postgres tool (psql, createdb, dropdb) is: the usual folders for this system first, then
 * PATH; else the bare name. The system, environment, file check and folder listing are injectable.
 */
export async function pgTool(name, { platform = process.platform, env = process.env, exists: has = exists, readdir = (d) => fsp.readdir(d) } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const dirs = [...(PG_DIRS[platform] ?? [])];
  const versioned = async (parent, re, sub) => {
    try {
      const names = (await readdir(parent)).filter((d) => re.test(d));
      if (platform !== 'darwin') names.sort((a, b) => (Number(/\d+/.exec(b)?.[0] ?? 0) - Number(/\d+/.exec(a)?.[0] ?? 0))); // the newest first (macOS: as listed, as before)
      for (const d of names) dirs.push(p.join(parent, d, sub));
    } catch { /* not installed there */ }
  };
  if (platform === 'darwin') await versioned('/opt/homebrew/opt', /^postgresql(@\d+)?$/, 'bin');
  if (platform === 'linux') await versioned('/usr/lib/postgresql', /^\d+$/, 'bin');
  if (platform === 'win32') {
    const roots = new Set([envGet(env, 'ProgramFiles', platform), envGet(env, 'ProgramW6432', platform), 'C:\\Program Files'].filter(Boolean));
    for (const root of roots) await versioned(p.join(root, 'PostgreSQL'), /^\d+(\.\d+)?$/, 'bin');
  }
  const file = platform === 'win32' ? `${name}.exe` : name;
  for (const d of dirs) if (has(p.join(d, file))) return p.join(d, file);
  return findOnPath(name, { platform, env, exists: has }) ?? name;
}

function pgEnv(url) {
  const u = new URL(url);
  return {
    PGHOST: u.hostname.replace(/^\[|\]$/g, ''), PGPORT: u.port || '5432',
    ...(u.username ? { PGUSER: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { PGPASSWORD: decodeURIComponent(u.password) } : {}),
  };
}

/**
 * createdb's arguments for a copy of `from` named `to`. fileCopy (Postgres 15 or later): copy the
 * files instead of the default, row by row (on the owner's 6.9 GB database, 11 s instead of 99 s).
 */
export function createdbArgs(from, to, { fileCopy }) {
  return ['-T', from, ...(fileCopy ? ['--strategy=file_copy'] : []), to];
}

const ADDRESS = /postgres(?:ql)?:(?:\\?\/){2}[^\s'"`<>]+/gi; // also as JSON writes it (postgres:\/\/…)
const PASSWORD_SETTING = /(^|[^A-Za-z])((?:pg)?password"?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi;

/**
 * Text with every database address blanked (`<database address>`), and each of `secrets` (the
 * passwords in the addresses, as written and decoded) too: what a tool printed may go to the
 * Foreman and the job page, and no address leaves the laptop. A secret under 4 characters isn't
 * blanked alone (it would blank parts of words); the address it was in still is, and so is any
 * `PGPASSWORD=…` or `password: …` / `password=…` printed, whatever its length.
 */
export function blankAddresses(text, secrets = []) {
  let out = String(text ?? '').replace(ADDRESS, '<database address>').replace(PASSWORD_SETTING, '$1$2<password>');
  for (const s of secrets) if (typeof s === 'string' && s.length >= 4) out = out.split(s).join('<password>');
  return out;
}

/**
 * Why Auto's database couldn't be made. code: 'no-original' (no saved original, and it can't be
 * saved now), 'busy' (another switch didn't end in time), 'copy' (dropping or copying failed this
 * time), 'no-database' (this app has no database Starbase can copy: it never will, as it is),
 * 'migration' (a migration failed: migration names it, tail is its last 20 lines), 'not-landed' (a
 * migration ended well but isn't in __auto's ledger: it went somewhere else; migration names it).
 * Database addresses are blanked from the message and the tail (blankAddresses).
 */
export class AutoDbError extends Error {
  constructor(code, message, { migration = null, tail = null } = {}) {
    super(blankAddresses(message));
    this.name = 'AutoDbError';
    this.code = code;
    this.migration = migration;
    this.tail = tail === null ? null : blankAddresses(tail);
  }
}

/** Try it's server for a job is running, so Auto's recording of it can't start on Auto's database (plan's words). */
export const AUTO_TRY_IT_RUNNING = 'Try it is running for this job, so Auto can\'t record it on its own database. Stop Try it, then press Record.';

/** His Try it Start while an Auto recording runs the job's app on Auto's database (lead's words). */
export const AUTO_RECORDING_APP = 'Auto is recording this job on its own copy of the database. Start Try it when the recording ends.';

/** The same two for an Auto job whose app names no database where Starbase looks: its recording has no copy to speak of. */
export const AUTO_TRY_IT_RUNNING_NO_DB = 'Try it is running for this job, so Auto can\'t record it. Stop Try it, then press Record.';
export const AUTO_RECORDING_NO_DB = 'Auto is recording this job. Start Try it when the recording ends.';

/** This computer can't fence a program off from his database (lib/db-door.js sandboxWorks), so nothing of Auto's is copied, started or run (lead's words). */
export const AUTO_NO_FENCE = 'Auto could not fence its app off from your database on this computer, so it made no recording.';

/** His Postgres server as db.env names it, for the door: a PGHOST that starts with / is a socket folder. */
const hisServer = (db) => (db.env.PGHOST.startsWith('/') ? { socket: `${db.env.PGHOST}/.s.PGSQL.${db.env.PGPORT}` } : { host: db.env.PGHOST, port: Number(db.env.PGPORT) });

const pgPort = (u) => u.port || '5432';
const sameServer = (a, b) => (isLocalHost(a.hostname) ? isLocalHost(b.hostname) : a.hostname.toLowerCase() === b.hostname.toLowerCase()) && pgPort(a) === pgPort(b);

const AUTO_DB_WAIT_MS = 120_000; // how long Auto waits for another database switch to end
const AUTO_STEP_MS = 600_000; // how long one of Auto's database steps may run before it is stopped
const PSQL_MS = 30_000; // how long a psql read may run (Try it's and Auto's)
const HOLD_MAX_MS = 600_000; // the longest an Auto recording holds his database's reads (holdHisReads), if its finally never runs
const lastLines = (text, n) => String(text).replace(/\s+$/, '').split('\n').slice(-n).join('\n');
/** A time limit in words: "10 minutes", "30 seconds", "1 second", "200 milliseconds". */
const spanWords = (ms) => {
  const [n, unit] = ms >= 60_000 ? [Math.round(ms / 60_000), 'minute'] : ms >= 1000 ? [Math.round(ms / 1000), 'second'] : [ms, 'millisecond'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
};

// Auto's database steps running now: stopAll ends them (they run in their own group, so they'd outlive Starbase).
const autoChildren = new Set();

// A fixed program with fixed arguments (no shell), its output kept, not streamed: Auto's database steps.
// exactEnv: the whole environment, as given (autoDbEnv's); else Starbase's own with env added.
// timeoutMs: past it, the program and everything it started are killed and the result is
// { ok: false, code: 'timeout', timedOut: true } at once, so a hung step never holds the lock.
function capture(file, args, { env, cwd, exactEnv = null, timeoutMs = 0 } = {}) {
  return new Promise((resolve) => {
    let output = '';
    let timer = null;
    const add = (b) => { output = clip(output + String(b).replace(ANSI, '')); };
    const end = (r) => { clearTimeout(timer); resolve({ ...r, output }); };
    // Its own process group (macOS, Linux), so killTree reaches what it started (npm's shell, the script).
    const child = spawn(file, args, { cwd, env: exactEnv ?? childEnv(env), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    autoChildren.add(child);
    child.on('close', () => autoChildren.delete(child));
    child.on('error', () => autoChildren.delete(child));
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    child.on('error', (err) => { add(`${err.message}\n`); end({ ok: false, code: err.code }); });
    child.on('close', (code) => end({ ok: code === 0, code }));
    if (timeoutMs > 0) timer = setTimeout(() => { killTree(child, 'SIGKILL'); end({ ok: false, code: 'timeout', timedOut: true }); }, timeoutMs);
  });
}

/** Migrations on disk in an app folder: names like 0134_something, in order. */
async function diskMigrations(appDir) {
  try {
    return (await fsp.readdir(path.join(appDir, 'prisma', 'migrations'), { withFileTypes: true }))
      .filter((d) => d.isDirectory() && /^\d{3,}_[\w-]+$/.test(d.name)).map((d) => d.name).sort();
  } catch { return []; }
}

// ---------- The service ----------

export class LocalRunner extends EventEmitter {
  #pgTool;
  #autoStepMs;
  #canFence;
  #doors = new Set(); // the doors open now (lib/db-door.js): one per app on Auto's database, one per migrate loop
  #starts = new Map(); // slug -> the start under way (startServer)
  #hisHeld = new Map(); // his database's name -> { promise }: Starbase's own reads of it wait (holdHisReads)
  #lastFacts = new Map(); // his database's name -> the last facts read (#dbFacts), answered while it is held
  #fileCopy = new Map(); // server and createdb -> a promise: whether createdb's file copy can be used (read once)

  /**
   * state: State (settings key "local"). demo: nothing real runs. registry: lib/repos.js's (the state
   * folder's by default). pgTool: where a Postgres tool is, by name (tests point it at fakes).
   * autoStepMs: how long each program autoDatabase starts may run before it is stopped (Try it's
   * own switch has no such limit: a copy of his database is never killed half way).
   * sandboxWorks: whether this computer can fence a program off from his database (lib/db-door.js's;
   * tests answer for it).
   */
  constructor({ state, demo = false, registry = null, pgTool: findPgTool = pgTool, autoStepMs = AUTO_STEP_MS, sandboxWorks: canFence = sandboxWorks }) {
    super();
    this.#pgTool = findPgTool;
    this.#autoStepMs = autoStepMs;
    this.#canFence = canFence;
    this.state = state;
    this.demo = demo;
    this.jobs = new Map(); // slug -> { server, cmd }
    this.dbBusy = false;
    this.dbCache = new Map(); // slug -> { at, view }
    this.registry = registry ?? (state?.dir ? openRegistry({ dir: state.dir }) : null);
    this.ranges = new Map(); // slug -> the port range of its repository's profile (where() sets it)
  }

  #slot(slug) {
    if (!this.jobs.has(slug)) this.jobs.set(slug, { server: null, cmd: null });
    return this.jobs.get(slug);
  }

  async #settings() { return (await this.state.getSettings()).local ?? {}; }
  async #saveSettings(patch) {
    const cur = await this.#settings();
    await this.state.setSettings({ local: { ...cur, ...patch } });
  }

  /** The Try it rules for the job's repository: its profile's, or the general case's (lib/profile.js tryItRules). */
  async #rules(f) {
    const hit = f.repoPath && this.registry ? await this.registry.profileFor(f.repoPath).catch(() => null) : null;
    const rules = tryItRules(hit?.ok ? hit.profile : null);
    this.ranges.set(f.slug, rules.ports);
    // profile: the one in use, or null (the job page says the repository has none yet); a profile
    // with errors isn't used, and its errors come along for the page.
    const profile = rules.profile ? { ...rules.profile, file: hit.file, source: hit.source } : null;
    return { rules, profile, profileErrors: hit && !hit.ok ? hit.errors : [] };
  }

  /**
   * Where a job's work can run: { root, app, mainApp, mainRoot, tryIt, files, profile, profileErrors }
   * or { reason }. files: the profile's files to copy, with the app folder filled in.
   */
  async where(f) {
    if (!f.worktree) return { reason: 'This job has no worktree yet. It gets one when building starts, and then you can try it here.' };
    // Found only through a guessed branch (lib/locate.js): it may be another job's, so nothing runs or is copied there.
    if (guessedWorktree(f)) return { reason: guessWords(f) };
    const { rules, profile, profileErrors } = await this.#rules(f);
    const around = (rel) => ({
      mainRoot: f.repoPath ?? null, tryIt: rules, profile, profileErrors,
      files: rules.files.map((r) => ({ ...r, from: fillPattern(r.from, { app: rel }), to: fillPattern(r.to, { app: rel }) })),
    });
    if (this.demo) {
      const rel = rules.appDirs[0] || 'app';
      return { root: f.worktree, app: { dir: path.join(f.worktree, rel), rel, scripts: { dev: 'next dev', check: 'npm run typecheck && npm test', test: 'vitest run' } }, mainApp: f.repoPath ? path.join(f.repoPath, rel) : null, ...around(rel) };
    }
    if (!exists(f.worktree)) return { reason: `The job’s worktree isn’t there any more (${f.worktree}).` };
    let app = null;
    for (const rel of rules.appDirs) {
      const dir = path.join(f.worktree, rel);
      const pkg = await readJson(path.join(dir, 'package.json'));
      if (pkg?.scripts?.dev) { app = { dir, rel, scripts: pkg.scripts }; break; }
    }
    const mainApp = app && f.repoPath ? path.join(f.repoPath, app.rel) : null;
    return { root: f.worktree, app, mainApp, ...around(app?.rel ?? '') };
  }

  /**
   * The job's port: the one it was given, else the first free one in its repository's range (the
   * range where() last saw for it, else the general case's). When the whole range is taken, a port
   * an older job was given and isn't using is handed on; failing that, a plain error.
   */
  async portFor(slug) {
    const s = await this.#settings();
    const ports = s.ports ?? {};
    if (ports[slug]) return ports[slug];
    const range = this.ranges.get(slug) ?? GENERAL.tryIt.ports;
    const taken = new Set(Object.values(ports));
    const free = async (p) => this.demo || !(await portInUse(p));
    const inRange = (p) => p >= range.first && (!range.last || p <= range.last);
    let port = range.first;
    while (inRange(port) && (taken.has(port) || !(await free(port)))) port++;
    let next = { ...ports };
    if (!inRange(port)) {
      const running = new Set([...this.jobs].filter(([, j]) => j.server && ['starting', 'running'].includes(j.server.status)).map(([k]) => k));
      port = null;
      for (const [k, p] of Object.entries(ports)) {
        if (inRange(p) && !running.has(k) && await free(p)) { delete next[k]; port = p; break; }
      }
      if (port === null) throw new Error(`Every port from ${range.first} to ${range.last} is taken, so this job has none. Stop another app, or widen the range in the repository’s profile.`);
    }
    next = { ...next, [slug]: port };
    await this.#saveSettings({ ports: next });
    return port;
  }

  // ----- settings file -----

  /** The job's settings file: the first file to copy that has keys to set (else the first), or null. */
  static settingsFile(w) {
    return w.files?.find((r) => r.portKeys?.length || r.signInSkip) ?? w.files?.[0] ?? null;
  }

  async envStatus(w, port) {
    const rule = LocalRunner.settingsFile(w);
    if (!w.app || !rule) return null;
    const file = path.join(w.root, rule.to);
    const source = w.mainRoot ? path.join(w.mainRoot, rule.from) : null;
    const status = { file: rule.to, exists: exists(file), sourceExists: Boolean(source && exists(source)), ready: false, signInSkipped: null, portOk: null, notes: [] };
    if (!status.exists) return status;
    const text = await fsp.readFile(file, 'utf8').catch(() => '');
    const { values, notes } = envChanges(text, port, rule);
    const skip = rule.signInSkip ? envValue(text, rule.signInSkip) : null;
    status.notes = notes;
    status.signInSkipped = skip === null ? null : skip === 'true';
    status.portOk = Object.entries(values).filter(([k]) => k !== rule.signInSkip).every(([k, v]) => envValue(text, k) === v);
    status.ready = status.portOk && status.signInSkipped !== false;
    return status;
  }

  /** Create or fix the job's settings files (the profile's files to copy). Never sends values to the page. */
  async setupEnv(f) {
    const w = await this.where(f);
    if (!w.app) throw new Error(w.reason ?? 'No app folder (a package.json with a "dev" script) in this job’s worktree.');
    if (this.demo) return { changed: [], notes: ['Demo mode: nothing was written.'] };
    if (!w.files.length) throw new Error('This repository’s profile names no files to copy, so there is nothing to set up.');
    const port = await this.portFor(f.slug);
    // Every file must be ignored by git before any is written.
    for (const rule of w.files) {
      const ignored = await shGit(['-C', w.root, 'check-ignore', '-q', rule.to]);
      if (!ignored.ok) throw new Error(`${path.basename(rule.to)} isn’t ignored by git in this worktree, so it could be committed by mistake. Not writing it.`);
    }
    let copied = false;
    const changed = [];
    const notes = [];
    for (const rule of w.files) {
      const file = path.join(w.root, rule.to);
      let text;
      if (exists(file)) text = await fsp.readFile(file, 'utf8');
      else {
        const source = w.mainRoot && path.join(w.mainRoot, rule.from);
        if (!source || !exists(source)) throw new Error(`Your main folder has no ${path.basename(rule.from)} to copy (looked in ${source ?? 'the main checkout'}).`);
        text = await fsp.readFile(source, 'utf8');
        copied = true;
      }
      const got = envChanges(text, port, rule);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, setEnvKeys(text, got.values), { mode: 0o600 });
      changed.push(...Object.keys(got.values));
      notes.push(...got.notes);
    }
    this.#changed(f.slug);
    return { copied, changed, notes, port };
  }

  // ----- dev server -----

  /**
   * Start the job's dev server. databaseUrl: Auto's database (its recording): the app is fenced off
   * from his database (#autoFence: it runs inside the sandbox, and its settings name a door that
   * passes on only sessions for Auto's copy; the door closes when the app stops, exits or fails to
   * start), and the server's view says db: 'auto'. His Try it server already running for the job is
   * never stopped for it: that is refused (AUTO_TRY_IT_RUNNING). fenced: an Auto recording's app
   * that names no database where Starbase looks (its own code may name one): it runs inside the
   * sandbox all the same, with the profile for port 5432, and nothing else is different (no door,
   * its environment as ever, db: null). The same gate (AutoDbError 'no-database' where this computer
   * has no sandbox) and the same two refusals, in their own words. His own Try it app (neither)
   * starts as ever: no sandbox, no door.
   */
  startServer(f, opts = {}) {
    // One start at a time per job: a second start (his Try it while the recorder starts the app) waits
    // for the first, then finds its server, so two apps are never spawned for one job.
    const before = this.#starts.get(f.slug) ?? Promise.resolve();
    const mine = before.catch(() => {}).then(() => this.#startServer(f, opts));
    this.#starts.set(f.slug, mine);
    mine.finally(() => { if (this.#starts.get(f.slug) === mine) this.#starts.delete(f.slug); }).catch(() => {});
    return mine;
  }

  async #startServer(f, { databaseUrl = null, fenced = false } = {}) {
    const w = await this.where(f);
    if (!w.app) throw new Error(w.reason ?? 'No app folder (a package.json with a "dev" script) in this job’s worktree.');
    const slot = this.#slot(f.slug);
    if (slot.server && ['starting', 'running'].includes(slot.server.status)) {
      if (databaseUrl && slot.server.db !== 'auto') throw new Error(AUTO_TRY_IT_RUNNING);
      // His Try it Start while the app runs on Auto's database (a recording): never his to take over.
      if (!databaseUrl && slot.server.db === 'auto') throw new Error(AUTO_RECORDING_APP);
      // The same two for a fenced app with no database: never his running (unfenced) app, and never his to take over.
      if (fenced && !slot.server.profile) throw new Error(AUTO_TRY_IT_RUNNING_NO_DB);
      if (!databaseUrl && !fenced && slot.server.profile) throw new Error(AUTO_RECORDING_NO_DB);
      return this.#serverView(slot.server);
    }
    let autoEnv = null;
    if (databaseUrl && !this.demo) {
      const db = await this.#database(w);
      if (!db.url) throw new Error(db.reason ?? `This job’s app has no database ${PRODUCT} can copy for Auto.`);
      // Only Auto's own copy, on his database's server: anything else is refused.
      let u = null;
      try { u = new URL(databaseUrl); } catch { u = null; }
      let name = null;
      try { name = u ? decodeURIComponent(u.pathname.slice(1)) : null; } catch { name = null; }
      if (!u || name !== db.auto || !sameServer(u, new URL(db.url))) throw new Error(`That isn’t the address of Auto’s copy of the database, so the app wasn’t started.`);
      autoEnv = { ...db, autoUrl: databaseUrl, auto: name };
    }
    const port = await this.portFor(f.slug);
    if (!this.demo && await portInUse(port)) throw new Error(`Something else is already using port ${port}. Stop it, or close the other app, and try again.`);
    // The profile's command, or the app's dev script (only on this computer for a Next.js app: with
    // the sign-in skip on, the app must not be reachable from the network).
    const command = devCommand(w.tryIt, w.app.scripts.dev, port);
    const base = childEnv({ PORT: String(port), HOSTNAME: '127.0.0.1', HOST: '127.0.0.1' });
    // On Auto's database: refused (nothing starts) where this computer has no sandbox or a settings file can't be read.
    let fence = autoEnv ? await this.#autoFence(autoEnv, await this.#autoGate(w, (m) => new Error(m)), base) : null;
    // An Auto recording's app that names no database: the same gate, then the sandbox alone, with port 5432
    // (where a database named in its own code would be). No door, and its environment as ever.
    if (fenced && !autoEnv && !this.demo) {
      await this.#autoGate(w, (m) => new AutoDbError('no-database', m));
      fence = { profile: sandboxProfile({ port: 5432 }), env: base, close: () => {} };
    }
    // door, hint: the fence's, kept for the recording's note (autoRefusal). profile: the fence's, kept for the recording's browser run (autoProfile).
    const server = { status: 'starting', port, url: fillPattern(w.tryIt.url, { port }), command, startedAt: new Date().toISOString(), output: '', child: null, exitCode: null, db: databaseUrl ? 'auto' : null, door: fence?.door ?? null, hint: fence?.hint ?? null, profile: fence?.profile ?? null };
    slot.server = server;
    if (this.demo) {
      server.output = `$ ${command}\nDemo mode: nothing real runs.\n`;
      server.status = 'running';
      this.#changed(f.slug);
      return this.#serverView(server);
    }
    server.output = `$ ${command}   (in ${w.app.dir})\n`;
    const shell = shellFor(command);
    // Auto's app: the same shell and command inside the sandbox (sandbox-exec becomes the shell, so the
    // process group is the app's as ever). His own: as it is.
    const run = fence ? sandboxed(shell.file, shell.args, fence.profile) : shell;
    let child;
    try { child = spawn(run.file, run.args, { cwd: w.app.dir, env: fence?.env ?? base, ...shell.options, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (err) { fence?.close(); throw err; }
    server.child = child;
    const onData = (buf) => {
      const chunk = String(buf).replace(ANSI, '');
      server.output = clip(server.output + chunk);
      this.emit('output', { slug: f.slug, stream: 'server', chunk });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => { fence?.close(); onData(`\n${err.message}\n`); });
    child.on('exit', (code, signal) => {
      fence?.close();
      server.status = server.stopRequested ? 'stopped' : 'exited';
      server.exitCode = code ?? signal;
      onData(`\n[The app stopped${server.stopRequested ? '' : ` by itself (${code ?? signal})`}.]\n`);
      this.#changed(f.slug);
    });
    // Ready when the port answers.
    const started = Date.now();
    const poll = setInterval(async () => {
      if (server.status !== 'starting') return clearInterval(poll);
      if (await portInUse(port)) { server.status = 'running'; clearInterval(poll); this.#changed(f.slug); }
      else if (Date.now() - started > 180_000) { clearInterval(poll); onData('\n[Still not answering after 3 minutes. Check the log above.]\n'); }
    }, 1000);
    this.#changed(f.slug);
    return this.#serverView(server);
  }

  stopServer(slug) {
    const server = this.jobs.get(slug)?.server;
    if (!server || !['starting', 'running'].includes(server.status)) return false;
    server.stopRequested = true;
    if (this.demo || !server.child) { server.status = 'stopped'; this.#changed(slug); return true; }
    killTree(server.child, 'SIGTERM');
    setTimeout(() => { if (server.status === 'starting' || server.status === 'running') killTree(server.child, 'SIGKILL'); }, 6000).unref?.();
    return true;
  }

  /** Stop the app and wait until it has actually exited (or give up after `ms`). */
  stopServerAndWait(slug, ms = 10_000) {
    const server = this.jobs.get(slug)?.server;
    if (!server || !['starting', 'running'].includes(server.status)) return Promise.resolve(true);
    if (this.demo || !server.child) { this.stopServer(slug); return Promise.resolve(true); }
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), ms);
      server.child.once('exit', () => { clearTimeout(t); resolve(true); });
      this.stopServer(slug);
    });
  }

  /** Is a command from the job page still running for this job? */
  busy(slug) {
    const slot = this.jobs.get(slug);
    return slot?.cmd?.status === 'running';
  }

  #serverView(s) {
    return s ? { status: s.status, port: s.port, url: s.url, command: s.command, startedAt: s.startedAt, exitCode: s.exitCode, ...(s.db ? { db: s.db } : {}) } : null;
  }

  // ----- commands -----

  /** Run a command (or a preset) in the job's app folder or its whole worktree; resolves when it ends. */
  async runCommand(f, opts) {
    const prepared = await this.prepareCommand(f, opts);
    return this.#exec(f.slug, prepared);
  }

  /** Start a prepared command; output streams to the page. */
  startPrepared(slug, prepared) {
    this.#exec(slug, prepared).catch(() => {});
  }

  /** Check a command can run here and work out where: { command, cwd, label }. Throws a plain message. */
  async prepareCommand(f, { command, preset, where = 'app' }) {
    const w = await this.where(f);
    if (!w.root) throw new Error(w.reason);
    const slot = this.#slot(f.slug);
    if (slot.cmd?.status === 'running') throw new Error('A command is still running here. Stop it first, or wait for it.');
    let label = null;
    if (preset) {
      const p = this.presets(w).find((x) => x.id === preset);
      if (!p) throw new Error('Unknown quick command.');
      ({ command, where, label } = { command: p.command, where: p.where, label: p.label });
    }
    command = String(command ?? '').trim();
    if (!command) throw new Error('Type a command first.');
    const cwd = where === 'root' || !w.app ? w.root : w.app.dir;
    return { command, cwd, label };
  }

  stopCommand(slug) {
    const cmd = this.jobs.get(slug)?.cmd;
    if (!cmd || cmd.status !== 'running' || !cmd.child) return false;
    if (cmd.stoppable === false) throw new Error('This step can’t be stopped half-way. It finishes in a moment.');
    cmd.stopRequested = true;
    killTree(cmd.child, 'SIGTERM');
    setTimeout(() => { if (cmd.status === 'running') killTree(cmd.child, 'SIGKILL'); }, 5000).unref?.();
    return true;
  }

  // One command, streamed into the job's output box. Resolves when it ends.
  #exec(slug, { command, cwd, label = null }) {
    const slot = this.#slot(slug);
    const cmd = { id: Date.now().toString(36), output: '', label, command, cwd, status: 'running', startedAt: new Date().toISOString(), endedAt: null, exitCode: null, stoppable: true, stopRequested: false };
    slot.cmd = cmd;
    const write = (chunk) => { cmd.output = clip(cmd.output + chunk); this.emit('output', { slug, stream: 'cmd', chunk }); };
    write(`$ ${command}\n`);
    this.#changed(slug);
    if (this.demo) {
      write('Demo mode: nothing real runs.\n');
      Object.assign(cmd, { status: 'done', exitCode: 0, endedAt: new Date().toISOString() });
      this.#changed(slug);
      return Promise.resolve({ ok: true, code: 0 });
    }
    return new Promise((resolve) => {
      const shell = shellFor(command);
      const child = spawn(shell.file, shell.args, { cwd, env: childEnv(), ...shell.options, stdio: ['ignore', 'pipe', 'pipe'] });
      cmd.child = child;
      const onData = (buf) => write(String(buf).replace(ANSI, ''));
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (err) => onData(`${err.message}\n`));
      child.on('close', (code, signal) => {
        Object.assign(cmd, { status: cmd.stopRequested ? 'stopped' : code === 0 ? 'done' : 'failed', exitCode: code ?? signal, endedAt: new Date().toISOString(), child: null });
        write(cmd.stopRequested ? '[Stopped.]\n' : code === 0 ? '' : `[Finished with exit code ${code ?? signal}.]\n`);
        this.#changed(slug);
        resolve({ ok: code === 0, code: code ?? signal });
      });
    });
  }

  presets(w) {
    const out = [];
    if (w.app) {
      for (const p of PRESETS) if (w.app.scripts[p.script]) out.push({ id: p.id, label: p.label, hint: p.hint ?? null, command: `npm run ${p.script}`, where: 'app' });
      if (w.app.scripts['db:migrate']) out.push({ id: 'db-status', label: 'Database changes status', hint: 'Which of this branch’s database changes your local database has', command: 'npm run db:migrate -- --status', where: 'app' });
    }
    for (const p of GIT_PRESETS) out.push({ ...p, hint: null });
    return out;
  }

  // ----- terminal and folders -----

  /**
   * Open the job's folder: what is 'terminal', 'vscode' (the editor) or 'finder' (the file browser,
   * whatever this system calls it). terminalApp: one of terminalApps() (else this system's first).
   */
  async open(f, what, terminalApp = terminalApps()[0]) {
    const w = await this.where(f);
    if (!w.root) throw new Error(w.reason);
    const dir = w.app?.dir ?? w.root;
    if (this.demo) return { dir };
    const kind = what === 'finder' ? 'folder' : what === 'vscode' ? 'editor' : 'terminal';
    const app = terminalApps().includes(terminalApp) ? terminalApp : terminalApps()[0];
    const r = await openIn(kind, dir, { terminalApp: app });
    if (!r.ok) throw new Error(kind === 'terminal' ? `Couldn’t open ${app}: ${r.message}` : r.message || 'Couldn’t open it.');
    return { dir };
  }

  // ----- database -----

  /** The shared local database this app uses, if it's one we can switch: { url, name, app } or { reason }. */
  async #database(w) {
    const key = w.tryIt?.dbUrlKey;
    const rule = LocalRunner.settingsFile(w);
    if (!key || !rule || !w.app?.scripts['db:migrate'] || !exists(path.join(w.app.dir, 'prisma', 'migrations'))) return { reason: null };
    const source = w.mainRoot && path.join(w.mainRoot, rule.from);
    const text = source && exists(source) ? await fsp.readFile(source, 'utf8').catch(() => '') : '';
    const url = envValue(text, key);
    if (!url) return { reason: `Your main folder’s ${path.basename(rule.from)} has no ${key}.` };
    let u;
    try { u = new URL(url); } catch { return { reason: `${key} isn’t a database address ${PRODUCT} can read.` }; }
    if (!/^postgres(ql)?:$/.test(u.protocol)) return { reason: 'Only Postgres databases can be switched from here.' };
    if (!isLocalHost(u.hostname)) return { reason: `Your app’s database isn’t on this computer, so ${PRODUCT} won’t touch it.` };
    let name;
    let env;
    try { name = decodeURIComponent(u.pathname.slice(1)); env = pgEnv(url); } catch { return { reason: `${key} has characters ${PRODUCT} can’t read.` }; }
    if (!/^[A-Za-z0-9_]{1,50}$/.test(name)) return { reason: `The database name has characters ${PRODUCT} won’t risk.` };
    // Auto's own database, beside his: autoUrl is his address with that name, and never leaves the server.
    const auto = `${name}__auto`;
    u.pathname = `/${auto}`;
    return { url, name, key, original: `${name}__original`, incoming: `${name}__incoming`, auto, autoUrl: u.toString(), env };
  }

  /**
   * Every settings file of both checkouts (the job's worktree and his main folder) and the profile's
   * files to copy (each from in the main folder, each to in the worktree, whatever their names), as
   * lib/db-settings.js reads them: { files, unreadable }. The text stays on the server.
   */
  async #settingsFiles(w) {
    const extra = (w.files ?? []).flatMap((r) => [w.mainRoot && path.join(w.mainRoot, r.from), w.root && path.join(w.root, r.to)]).filter(Boolean);
    return readSettings({ job: w.root, main: w.mainRoot && w.mainRoot !== w.root ? w.mainRoot : null, extra });
  }

  /**
   * R1: whether the job's app may use a database, so an Auto job takes Auto's copy or nothing. True
   * when the profile names a database key, any settings file has a line that looks like a database
   * setting (lib/db-settings.js looksLikeDb) or can't be read, or env (Starbase's own, by default)
   * has one. An Auto job in a repository with none has no copy and no door, but its app and its
   * browser run still go inside the sandbox (startServer's fenced): its own code may name a database.
   */
  async namesADatabase(f, env = process.env) {
    const w = await this.where(f);
    if (!w.root) return false;
    if (w.profile && w.tryIt?.dbUrlKey) return true;
    return Boolean(dbHint(await this.#settingsFiles(w), env));
  }

  /**
   * The gate before anything of Auto's is copied, started or run: this computer can fence a program
   * off from his database (lib/db-door.js sandboxWorks), and every settings file can be read. Each
   * refuses with its words. Returns the settings (lib/db-settings.js readSettings).
   */
  async #autoGate(w, refuse) {
    if (!(await this.#canFence())) throw refuse(AUTO_NO_FENCE);
    const settings = await this.#settingsFiles(w);
    if (settings.unreadable.length) throw refuse(`Auto could not read ${settings.unreadable[0]}, so it made no recording.`);
    return settings;
  }

  /**
   * The fence around one app or one migrate loop of Auto's (lib/db-door.js). What keeps the child
   * off his database is these two, and no settings file:
   *   profile  the sandbox profile it is started with: his Postgres server is denied to it and to
   *            everything it starts (migrate: everything outside this laptop too);
   *   door     Starbase's relay to his server, which passes on only a session that names Auto's copy.
   * env is the child's environment, its database settings naming the door (lib/db-settings.js
   * autoDbEnvParts: function only). hint: a setting that holds his database's name and that Starbase
   * couldn't point at the door ({ file, key }, leftover), or null; it stops nothing. The caller
   * closes the door with close().
   */
  async #autoFence(db, settings, base, { migrate = false } = {}) {
    const profile = sandboxProfile({ port: Number(db.env.PGPORT), migrate });
    const door = await openDoor({ target: hisServer(db), database: db.auto });
    this.#doors.add(door);
    const close = () => { this.#doors.delete(door); return door.close(); };
    try {
      const { env, set } = autoDbEnvParts(db, settings, base, { port: door.port });
      return { door, profile, env, hint: leftover(settings, set, db, base), close };
    } catch (err) { await close(); throw err; }
  }

  /**
   * What the door refused for the job's app on Auto's database: { asked, hint } for the latest
   * refusal (asked: the database's name as the door keeps it; hint: a setting that may be what names
   * it, { file, key }, or null), or null when it refused nothing. For the recording's note.
   */
  autoRefusal(slug) {
    const server = this.jobs.get(slug)?.server;
    const last = server?.door?.refused.at(-1);
    return last ? { asked: last.database, hint: server.hint } : null;
  }

  /**
   * The sandbox profile an Auto recording's app for the job was started under (lib/db-door.js: on
   * Auto's database his server's port, with no database port 5432), or null (no app, or his own Try
   * it app, which has none). For what else an Auto recording starts that runs the job's code: its
   * browser run goes under the same fence.
   */
  autoProfile(slug) {
    return this.jobs.get(slug)?.server?.profile ?? null;
  }

  /**
   * Whether createdb can use the file copy here: the server (db's host and port) and the createdb
   * program both Postgres 15 or later. Asked once per server and program; a failed read of the
   * server is asked again next time, and a createdb that can't say its version means no.
   */
  #canFileCopy(db, createdb) {
    const key = `${db.env.PGHOST}:${db.env.PGPORT} ${createdb}`;
    if (!this.#fileCopy.has(key)) {
      const client = sh(createdb, ['--version'], { timeout: PSQL_MS }).then((r) => (r.ok ? Number(/(\d+)\.\d+/.exec(r.stdout)?.[1] ?? 0) : 0)); // "createdb (PostgreSQL) 17.11"
      const server = this.#psql({ ...db, dbName: 'postgres' }, 'show server_version_num').then(Number);
      this.#fileCopy.set(key, Promise.all([server, client])
        .then(([s, c]) => s >= 150000 && c >= 15)
        .catch((err) => { this.#fileCopy.delete(key); throw err; }));
    }
    return this.#fileCopy.get(key);
  }

  // timeout: Auto's reads pass the lower of this and its step limit. A read stopped by it throws with timedOut.
  async #psql(db, sql, { timeout = PSQL_MS, held = 'wait' } = {}) {
    // A read of his database waits while an Auto recording watches it for new sessions (holdHisReads),
    // or, for Try it's panel (held: 'fail'), doesn't go at all.
    const target = db.dbName ?? db.name;
    while (target !== 'postgres' && this.#hisHeld.has(target)) {
      if (held === 'fail') throw Object.assign(new Error('held'), { held: true });
      await this.#hisHeld.get(target).promise;
    }
    const r = await sh(await this.#pgTool('psql'), ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db.dbName ?? db.name, '-c', sql], { env: childEnv(db.env), timeout });
    if (r.killed) throw Object.assign(new Error(`psql took longer than ${spanWords(timeout)} and was stopped.`), { timedOut: true });
    if (!r.ok) throw new Error(r.stderr.trim().split('\n')[0] || 'psql failed');
    return r.stdout.trim();
  }

  /**
   * cached: a read for Try it's panel or the stage (dbView). While an Auto recording holds his
   * database (holdHisReads) it never waits: the last facts read, else it fails as a read does.
   */
  async #dbFacts(db, { cached = false } = {}) {
    const fromLast = () => {
      const last = this.#lastFacts.get(db.name);
      if (last) return last;
      throw new Error(`Auto is recording, so ${PRODUCT} is not reading your database right now. This fills in when the recording ends.`);
    };
    let facts;
    try { facts = await this.#dbFactsNow(db, cached ? 'fail' : 'wait'); } catch (err) { if (err.held) return fromLast(); throw err; }
    this.#lastFacts.set(db.name, facts);
    return facts;
  }

  async #dbFactsNow(db, held) {
    const onAdmin = { ...db, dbName: 'postgres' };
    const rows = (await this.#psql(onAdmin, `select datname from pg_database where datname in ('${db.name}', '${db.original}')`)).split('\n').filter(Boolean);
    const facts = { exists: rows.includes(db.name), originalExists: rows.includes(db.original), ledger: null, connections: 0 };
    if (!facts.exists) return facts;
    facts.connections = Number(await this.#psql(onAdmin, `select count(*) from pg_stat_activity where datname = '${db.name}' and pid <> pg_backend_pid()`)) || 0;
    const hasLedger = (await this.#psql(db, "select to_regclass('public.applied_migrations') is not null", { held })) === 't';
    facts.ledger = hasLedger ? (await this.#psql(db, 'select name from applied_migrations order by name', { held })).split('\n').filter(Boolean) : null;
    return facts;
  }

  async dbView(f, { fresh = false } = {}) {
    const hit = this.dbCache.get(f.slug);
    if (!fresh && hit && Date.now() - hit.at < 10_000) return hit.view;
    const view = await this.#dbViewUncached(f);
    this.dbCache.set(f.slug, { at: Date.now(), view });
    return view;
  }

  async #dbViewUncached(f) {
    if (this.demo) return null;
    const w = await this.where(f);
    if (!w.app) return null;
    const db = await this.#database(w);
    if (!db.url) return db.reason ? { available: false, reason: db.reason } : null;
    let facts;
    try { facts = await this.#dbFacts(db, { cached: true }); } catch (err) { return { available: false, name: db.name, reason: `Couldn’t read the local database: ${err.message}` }; }
    const saved0 = (await this.#settings()).db?.[db.name] ?? {};
    if (!facts.exists && facts.originalExists) return { available: true, gone: true, name: db.name, busy: this.dbBusy, original: { exists: true, savedAt: saved0.originalAt ?? null }, matches: saved0.matches ?? null, missing: [], extra: [], connections: 0 };
    if (!facts.exists) return { available: false, name: db.name, reason: `The database ${db.name} doesn’t exist on this computer.` };
    if (!facts.ledger) return { available: false, name: db.name, reason: `This database has no applied_migrations table, so ${PRODUCT} can’t tell which changes it has.` };
    const disk = await diskMigrations(w.app.dir);
    const have = new Set(facts.ledger);
    const saved = (await this.#settings()).db?.[db.name] ?? {};
    return {
      available: true, name: db.name, busy: this.dbBusy,
      original: { exists: facts.originalExists, savedAt: saved.originalAt ?? null },
      matches: saved.matches ?? null, // { kind: 'original' } | { kind: 'job', slug, title, branch, added, partial, at }
      missing: disk.filter((n) => !have.has(n)), // this branch's changes the database doesn't have
      extra: facts.ledger.filter((n) => !disk.includes(n)), // changes from somewhere else (another branch)
      connections: facts.connections,
    };
  }

  // Stop our own dev servers (they hold database connections), then make sure nothing else is connected.
  async #needQuietDb(slug, db) {
    for (const [s, slot] of this.jobs) {
      // An app on Auto's database (a recording) isn't connected to his: his switch leaves it alone.
      if (slot.server && ['starting', 'running'].includes(slot.server.status) && slot.server.db !== 'auto') {
        this.#note(slug, `Stopping the app for ${s} (it’s connected to the database)…\n`);
        this.stopServer(s);
      }
    }
    for (let i = 0; i < 20; i++) {
      const facts = await this.#dbFacts(db);
      if (!facts.connections) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Something else is still connected to ${db.name}: probably your main app’s dev server or a database tool. Stop it and try again.`);
  }

  #note(slug, text) {
    const slot = this.#slot(slug);
    if (!slot.cmd) return;
    slot.cmd.output = clip(slot.cmd.output + text);
    this.emit('output', { slug, stream: 'cmd', chunk: text });
  }

  // A database step runs a fixed program with fixed arguments (no shell), streamed like a command.
  #run(slug, file, args, env, cwd = undefined) {
    const slot = this.#slot(slug);
    const cmd = slot.cmd;
    const write = (chunk) => { cmd.output = clip(cmd.output + chunk); this.emit('output', { slug, stream: 'cmd', chunk }); };
    write(`$ ${path.basename(file)} ${args.join(' ')}\n`);
    return new Promise((resolve) => {
      const child = spawn(file, args, { cwd, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (b) => write(String(b).replace(ANSI, '')));
      child.stderr.on('data', (b) => write(String(b).replace(ANSI, '')));
      child.on('error', (err) => { write(`${err.message}\n`); resolve({ ok: false, code: err.code }); });
      child.on('close', (code) => resolve({ ok: code === 0, code }));
    });
  }

  /**
   * Switch the shared local database. action: 'match' (rebuild from the original, then add this
   * job's changes), 'original' (put the original back) or 'save-original' (make the current
   * database the new original). Output goes to the job's output box.
   */
  async database(f, action) {
    if (this.demo) throw new Error('Demo mode: nothing real runs.');
    if (this.dbBusy) throw new Error('The database is already being switched. Wait for it to finish.');
    const w = await this.where(f);
    const db = w.app ? await this.#database(w) : { reason: w.reason };
    if (!db.url) throw new Error(db.reason ?? `This job’s app has no database ${PRODUCT} can switch.`);
    if (!['match', 'original', 'save-original'].includes(action)) throw new Error('Unknown database action.');
    const slot = this.#slot(f.slug);
    if (slot.cmd?.status === 'running') throw new Error('A command is still running here. Stop it first, or wait for it.');
    if (this.dbBusy) throw new Error('The database is already being switched. Wait for it to finish.'); // Auto may have begun meanwhile
    this.dbBusy = true;
    const labels = { match: 'Matching the database to this job', original: 'Putting the original database back', 'save-original': 'Saving the database as the new original' };
    slot.cmd = { id: Date.now().toString(36), label: labels[action], command: labels[action], cwd: null, output: '', status: 'running', startedAt: new Date().toISOString(), endedAt: null, exitCode: null, stoppable: false };
    this.#changed(f.slug);
    try {
      const dbs = (await this.#settings()).db ?? {};
      const saved = dbs[db.name] ?? {};
      const save = async (patch) => { Object.assign(saved, patch); await this.#saveSettings({ db: { ...dbs, [db.name]: saved } }); };
      const [createdb, dropdb] = [await this.#pgTool('createdb'), await this.#pgTool('dropdb')];
      const step = async (file, args) => { const r = await this.#run(f.slug, file, args, db.env); if (!r.ok) throw new Error(`${path.basename(file)} failed (exit ${r.code}).`); };
      await this.#needQuietDb(f.slug, db);
      let facts = await this.#dbFacts(db);
      const admin = { ...db, dbName: 'postgres' };
      const fileCopy = await this.#canFileCopy(db, createdb).catch(() => false); // not known: the default copy, slower but never wrong
      // Build a copy under a temporary name, then swap it in: a failed copy never costs a database.
      const swapIn = async (from, to) => {
        await step(dropdb, ['--if-exists', db.incoming]);
        await step(createdb, createdbArgs(from, db.incoming, { fileCopy }));
        await step(dropdb, ['--if-exists', to]);
        this.#note(f.slug, `$ rename ${db.incoming} to ${to}\n`);
        await this.#psql(admin, `alter database "${db.incoming}" rename to "${to}"`);
      };
      if (action === 'save-original' || !facts.originalExists) {
        if (!facts.exists) throw new Error(`${db.name} isn’t there, so there’s nothing to save as the original. Nothing was changed.`);
        if (facts.originalExists) {
          this.#note(f.slug, `Replacing the saved original with the database as it is now…\n`);
          await swapIn(db.name, db.original);
        } else {
          this.#note(f.slug, `First time: saving your database as it is now, as the original (${db.original}). This copy is never changed by switching.\n`);
          await step(createdb, createdbArgs(db.name, db.original, { fileCopy }));
        }
        await save({ originalAt: new Date().toISOString(), matches: action === 'save-original' ? { kind: 'original' } : saved.matches ?? { kind: 'original' } });
        if (action === 'save-original') { this.#finish(f.slug, 'done', 'Saved. Switching back to the original now restores the database as it is at this moment.\n'); return; }
      }
      facts = await this.#dbFacts(db);
      if (!facts.originalExists) throw new Error('The original copy isn’t there, so nothing was changed.');
      this.#note(f.slug, `Rebuilding ${db.name} from the saved original…\n`);
      await swapIn(db.original, db.name);
      if (action === 'original') {
        await save({ matches: { kind: 'original', at: new Date().toISOString() } });
        this.#finish(f.slug, 'done', 'Done: your local database is the original again.\n');
        return;
      }
      facts = await this.#dbFacts(db);
      const have = new Set(facts.ledger ?? []);
      const toAdd = (await diskMigrations(w.app.dir)).filter((n) => !have.has(n));
      await save({ matches: { kind: 'job', slug: f.slug, title: f.title, branch: f.branch, added: [], partial: toAdd.length > 0, at: new Date().toISOString() } });
      if (!toAdd.length) this.#note(f.slug, 'This branch has no database changes beyond the original.\n');
      for (const name of toAdd) {
        this.#note(f.slug, `Adding ${name}…\n`);
        const r = await this.#run(f.slug, 'npm', ['run', 'db:migrate', '--', name], { ...db.env, DATABASE_URL: db.url }, w.app.dir);
        if (!r.ok) throw new Error(`Adding ${name} failed. The database has the changes before it; “Put the original back” undoes them.`);
        saved.matches.added.push(name);
        await save({ matches: saved.matches });
      }
      await save({ matches: { ...saved.matches, partial: false } });
      this.#finish(f.slug, 'done', `Done: your local database matches ${f.branch ?? 'this job'}${toAdd.length ? ` (added ${toAdd.join(', ')})` : ''}.\n`);
    } catch (err) {
      this.#finish(f.slug, 'failed', `\n${err.message}\n`);
      throw err;
    } finally {
      this.dbBusy = false;
      this.dbCache.clear();
      this.#changed(f.slug);
    }
  }

  // ----- Auto's database -----

  /**
   * Make Auto's own database afresh for a job's turn: <name>__auto, copied from the saved original,
   * then this branch's migrations added, each script fenced off from his database (#autoFence: inside
   * the sandbox, its settings naming a door that passes on only sessions for Auto's copy) and
   * checked in __auto's ledger after it ends (else 'not-landed', and nothing more). Returns
   * { url, name, added }; url never leaves the server. His database and the saved original appear
   * only as a copy's source: Auto never changes them, never connects to them, and never stops a Try
   * it app. The one exception: with no saved original, Auto saves one, and only while nothing is
   * connected to his database and no Try it app runs (createdb never overwrites a database).
   * One switch at a time: it waits up to waitMs for another to end. Throws AutoDbError.
   */
  async autoDatabase(f, { waitMs = AUTO_DB_WAIT_MS, env: ownEnv = process.env } = {}) {
    if (this.demo) throw new Error('Demo mode: nothing real runs.');
    const until = Date.now() + waitMs;
    while (this.dbBusy) {
      if (Date.now() >= until) throw new AutoDbError('busy', 'Another switch of the local database didn’t end in time, so Auto’s database wasn’t made.');
      await new Promise((r) => setTimeout(r, Math.min(250, waitMs)));
    }
    this.dbBusy = true; // held from the same moment it was seen free
    this.dbCache.clear();
    this.#changed(f.slug); // Try it's panel shows the switch as busy
    try {
      const w = await this.where(f);
      const db = w.app ? await this.#database(w) : { reason: w.reason };
      if (!db.url) {
        // The profile names no database key, but the app looks like it uses one: say where (a file and a key, never a value).
        const hint = !(w.profile && w.tryIt?.dbUrlKey) && w.root ? dbHint(await this.#settingsFiles(w), ownEnv) : null;
        if (hint?.unreadable) throw new AutoDbError('no-database', `Auto could not read ${hint.file}, so it made no recording.`);
        if (hint) throw new AutoDbError('no-database', `This job’s app looks like it uses a database (${hint.file ?? `${PRODUCT}’s own environment`}, ${hint.key}), but ${PRODUCT} does not know which one, so Auto made no recording.`);
        throw new AutoDbError('no-database', db.reason ?? `This job’s app has no database ${PRODUCT} can copy for Auto.`);
      }
      // His database named postgres: Starbase's own reads go there, so its sessions can't be watched (S8, lead's words).
      if (db.name === 'postgres') throw new AutoDbError('no-database', `Your database is named postgres, which ${PRODUCT}'s own reads use, so Auto made no recording.`);
      // Every error's words with the addresses and the password blanked (no address leaves the laptop).
      const secrets = (() => { const p = new URL(db.url).password; try { return [p, decodeURIComponent(p)]; } catch { return [p]; } })();
      const fail = (code, message, extra = {}) => new AutoDbError(code, blankAddresses(message, secrets), { ...extra, ...(extra.tail ? { tail: blankAddresses(extra.tail, secrets) } : {}) });
      // No sandbox on this computer, or a settings file that can't be read: refused before anything is copied or run.
      const settings = await this.#autoGate(w, (m) => fail('no-database', m));
      const admin = { ...db, dbName: 'postgres' };
      // Every program started here has a time limit (autoStepMs; psql's reads keep their lower one).
      const limit = spanWords(this.#autoStepMs);
      const ask = (on, sql) => this.#psql(on, sql, { timeout: Math.min(PSQL_MS, this.#autoStepMs) }).catch((err) => { throw fail('copy', `Couldn’t read the local database: ${err.message}`); });
      const [createdb, dropdb] = [await this.#pgTool('createdb'), await this.#pgTool('dropdb')];
      const fileCopy = await this.#canFileCopy(db, createdb).catch((err) => { throw fail('copy', `Couldn’t read the local database: ${err.message}`); });
      const step = async (file, args) => {
        const r = await capture(file, args, { env: db.env, timeoutMs: this.#autoStepMs });
        if (r.timedOut) throw fail('copy', `Making Auto’s database ${db.auto} took longer than ${limit}, so ${path.basename(file)} was stopped. Your database and the saved original weren’t changed.`);
        if (!r.ok) throw fail('copy', `Making Auto’s database ${db.auto} failed: ${path.basename(file)} ended with exit ${r.code} (${lastLines(r.output, 1)}). Your database and the saved original weren’t changed.`);
      };

      const names = (await ask(admin, `select datname from pg_database where datname in ('${db.name}', '${db.original}')`)).split('\n').filter(Boolean);
      if (!names.includes(db.original)) {
        if (!names.includes(db.name)) throw new AutoDbError('no-original', `There’s no saved original of ${db.name}, and ${db.name} isn’t there to save one from.`);
        const connections = Number(await ask(admin, `select count(*) from pg_stat_activity where datname = '${db.name}' and pid <> pg_backend_pid()`)) || 0;
        const tryItRuns = [...this.jobs.values()].some((s) => s.server && ['starting', 'running'].includes(s.server.status));
        const waiting = `There’s no saved original of ${db.name} yet. Auto saves one when nothing is connected to ${db.name} and no Try it app is running.`;
        if (connections || tryItRuns) throw fail('no-original', waiting);
        // While Postgres copies it (about 11 s), a new connection to his database waits; nothing is ended or changed.
        const r = await capture(createdb, createdbArgs(db.name, db.original, { fileCopy }), { env: db.env, timeoutMs: this.#autoStepMs });
        if (r.timedOut) throw fail('copy', `Saving ${db.name} as the original took longer than ${limit}, so createdb was stopped. Your database wasn’t changed.`);
        if (!r.ok) throw fail('no-original', `${waiting} Saving it didn’t work this time (${lastLines(r.output, 1)}).`);
        const dbs = (await this.#settings()).db ?? {};
        const saved = dbs[db.name] ?? {};
        await this.#saveSettings({ db: { ...dbs, [db.name]: { ...saved, originalAt: new Date().toISOString(), matches: saved.matches ?? { kind: 'original' } } } });
      }

      await step(dropdb, ['--if-exists', '--force', db.auto]);
      await step(createdb, createdbArgs(db.original, db.auto, { fileCopy }));
      const onAuto = { ...db, dbName: db.auto };
      // No ledger in the original: which changes it has can't be told (Try it's panel refuses it too).
      if ((await ask(onAuto, "select to_regclass('public.applied_migrations') is not null")) !== 't') {
        throw fail('no-database', `The saved original of ${db.name} has no applied_migrations table, so ${PRODUCT} can’t tell which changes Auto’s copy needs.`);
      }
      // __auto's ledger, read from __auto only.
      const ledgerNow = async () => {
        const hasLedger = (await ask(onAuto, "select to_regclass('public.applied_migrations') is not null")) === 't';
        return hasLedger ? (await ask(onAuto, 'select name from applied_migrations order by name')).split('\n').filter(Boolean) : [];
      };
      const ledger = await ledgerNow();
      const toAdd = (await diskMigrations(w.app.dir)).filter((n) => !ledger.includes(n));
      const added = [];
      if (toAdd.length) {
        // The migrate scripts are fenced off from his database (#autoFence): each runs inside the sandbox
        // (his server and everything outside this laptop denied), with the server's own settings (db.env)
        // and its database settings naming one door for the loop, closed however the loop ends.
        const fence = await this.#autoFence(db, settings, childEnv(db.env), { migrate: true });
        try {
          for (const name of toAdd) {
            const refusedBefore = fence.door.refused.at(-1);
            const run = sandboxed('npm', ['run', 'db:migrate', '--', name], fence.profile);
            const r = await capture(run.file, run.args, { exactEnv: fence.env, cwd: w.app.dir, timeoutMs: this.#autoStepMs });
            if (r.timedOut) throw fail('migration', `Adding ${name} to Auto’s database took longer than ${limit}, so it was stopped.`, { migration: name, tail: lastLines(r.output, 20) || null });
            if (!r.ok) {
              // The door refused a session while the script ran: say which database it asked for.
              const refused = fence.door.refused.at(-1);
              const why = refused && refused !== refusedBefore ? `: the script asked for the database ${refused.database}, and ${PRODUCT} refused it.` : ` (exit ${r.code}).`;
              throw fail('migration', `Adding ${name} to Auto’s database failed${why}`, { migration: name, tail: lastLines(r.output, 20) });
            }
            // Ended well but not in __auto's ledger: the script went somewhere else. Nothing more is applied.
            if (!(await ledgerNow()).includes(name)) throw fail('not-landed', `${name} did not land on Auto's copy of the database, so nothing more was applied.`, { migration: name });
            added.push(name);
          }
        } finally { await fence.close(); }
      }
      return { url: db.autoUrl, name: db.auto, added };
    } finally {
      this.dbBusy = false;
      this.dbCache.clear();
      this.#changed(f.slug);
    }
  }

  /** How many connections Auto's database has, not counting the one asking. */
  async autoConnections(f) {
    if (this.demo) throw new Error('Demo mode: nothing real runs.');
    const w = await this.where(f);
    const db = w.app ? await this.#database(w) : { reason: w.reason };
    if (!db.url) throw new Error(db.reason ?? `This job’s app has no database ${PRODUCT} can copy for Auto.`);
    return Number(await this.#psql({ ...db, dbName: 'postgres' }, `select count(*) from pg_stat_activity where datname = '${db.auto}' and pid <> pg_backend_pid()`)) || 0;
  }

  /**
   * The backends on HIS database now (their process ids), read through the admin database only:
   * Auto never connects to his database. The recording compares them before and after its app starts.
   */
  async hisBackends(f) {
    if (this.demo) throw new Error('Demo mode: nothing real runs.');
    const w = await this.where(f);
    const db = w.app ? await this.#database(w) : { reason: w.reason };
    if (!db.url) throw new Error(db.reason ?? `This job’s app has no database ${PRODUCT} can copy for Auto.`);
    return (await this.#psql({ ...db, dbName: 'postgres' }, `select pid from pg_stat_activity where datname = '${db.name}' and backend_type = 'client backend' and pid <> pg_backend_pid()`)).split('\n').filter(Boolean);
  }

  /**
   * How many sessions his database has had (pg_stat_database's sessions, Postgres 14 or later), read
   * through the admin database: a session that opened and closed between two looks still counts.
   * null when the server has no such column.
   */
  async hisSessions(f) {
    if (this.demo) throw new Error('Demo mode: nothing real runs.');
    const w = await this.where(f);
    const db = w.app ? await this.#database(w) : { reason: w.reason };
    if (!db.url) throw new Error(db.reason ?? `This job’s app has no database ${PRODUCT} can copy for Auto.`);
    try {
      const v = await this.#psql({ ...db, dbName: 'postgres' }, `select sessions from pg_stat_database where datname = '${db.name}'`);
      return Number(v) || 0;
    } catch (err) {
      if (/column .*sessions.* does not exist/i.test(err.message)) return null;
      throw err;
    }
  }

  /**
   * While an Auto recording watches his database for new sessions, Starbase's own reads of it never
   * reach it: Try it's panel and the stage answer from the last facts (#dbFacts), his own switch waits.
   * Returns the release, which the recording's finally calls; a safety cap of maxMs (10 minutes) for
   * a finally that never runs.
   */
  async holdHisReads(f, maxMs = HOLD_MAX_MS) {
    const w = await this.where(f);
    const db = w.app ? await this.#database(w) : {};
    if (!db.name) return () => {};
    let release;
    const promise = new Promise((r) => { release = r; });
    const held = { promise };
    this.#hisHeld.set(db.name, held);
    // At its end the answers kept from the hold go (a failed view is cached for 10 s), and the page hears it.
    const end = () => { clearTimeout(timer); if (this.#hisHeld.get(db.name) === held) this.#hisHeld.delete(db.name); release(); this.dbCache.clear(); this.#changed(f.slug); };
    const timer = setTimeout(end, maxMs);
    timer.unref?.();
    return end;
  }

  #finish(slug, status, text) {
    const cmd = this.#slot(slug).cmd;
    this.#note(slug, text);
    Object.assign(cmd, { status, exitCode: status === 'done' ? 0 : 1, endedAt: new Date().toISOString() });
  }

  // ----- the page's view -----

  async view(f, { fresh = false } = {}) {
    const w = await this.where(f);
    const s = await this.#settings();
    const slot = this.jobs.get(f.slug) ?? { server: null, cmd: null };
    const apps = terminalApps();
    // The terminal apps and the folder button's name for this system (lib/platform.js).
    const base = { slug: f.slug, demo: this.demo, terminalApp: apps.includes(s.terminalApp) ? s.terminalApp : apps[0], terminalApps: apps, folderLabel: folderLabel() };
    if (!w.root) return { ...base, available: false, reason: w.reason };
    const port = w.app ? await this.portFor(f.slug) : null;
    return {
      ...base, available: true, root: w.root, branch: f.branch,
      app: w.app ? { dir: w.app.dir, rel: w.app.rel || '.' } : null,
      port, url: port ? fillPattern(w.tryIt.url, { port }) : null,
      // The repository's profile ({ name, github, file, source }) or null: the page then says it has none yet.
      profile: w.profile ? { name: w.profile.name, github: w.profile.github, file: w.profile.file, source: w.profile.source } : null,
      profileErrors: w.profileErrors,
      env: await this.envStatus(w, port),
      server: this.#serverView(slot.server), serverOutput: slot.server?.output ?? '',
      cmd: slot.cmd ? { label: slot.cmd.label, command: slot.cmd.command, status: slot.cmd.status, exitCode: slot.cmd.exitCode, startedAt: slot.cmd.startedAt, endedAt: slot.cmd.endedAt, stoppable: slot.cmd.stoppable !== false, output: slot.cmd.output } : null,
      presets: this.presets(w).map(({ id, label, hint, command }) => ({ id, label, hint, command })),
      db: await this.dbView(f, { fresh }),
    };
  }

  async setTerminalApp(name) {
    const apps = terminalApps();
    if (!apps.includes(name)) throw new Error(`Choose ${apps.length > 1 ? `${apps.slice(0, -1).join(', ')} or ${apps.at(-1)}` : apps[0]}.`);
    await this.#saveSettings({ terminalApp: name });
  }

  #changed(slug) {
    this.dbCache.delete(slug);
    this.emit('changed', { slug });
  }

  /** On shutdown: stop every dev server and command we started. */
  stopAll() {
    for (const child of autoChildren) killTree(child, 'SIGKILL'); // Auto's database steps run in their own group
    for (const door of this.#doors) door.close(); // and the doors they and Auto's apps went through
    for (const slot of this.jobs.values()) {
      if (slot.server?.child && ['starting', 'running'].includes(slot.server.status)) killTree(slot.server.child);
      if (slot.cmd?.child && slot.cmd.status === 'running') killTree(slot.cmd.child);
    }
  }
}
