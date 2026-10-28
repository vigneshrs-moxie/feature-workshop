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
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { envGet, findOnPath, folderLabel, killTree as stopProcessTree, openIn, shellFor, terminalApps } from './platform.js';
import { GENERAL, GENERAL_FILE_RULE, devCommand, fillPattern, tryItRules } from './profile.js';
import { openRegistry } from './repos.js';

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
const CHILD_ENV_DROP = /^(PORT|WORKSHOP_[A-Z_]*)$/;
// Where the Postgres tools usually are, per system; pgTool() also looks in the versioned folders
// (Homebrew's opt/postgresql@<n>, Debian's /usr/lib/postgresql/<n>, Windows' PostgreSQL\<n>) and on PATH.
const PG_DIRS = {
  darwin: ['/opt/homebrew/bin', '/usr/local/bin', '/Applications/Postgres.app/Contents/Versions/latest/bin'],
  linux: ['/usr/bin', '/usr/local/bin'],
  win32: [],
};

const exists = (p) => fs.existsSync(p);
const readJson = async (file) => { try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return null; } };
const sh = (file, args, opts = {}) => new Promise((resolve) => {
  execFile(file, args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code ?? 1 : 0, stdout: String(stdout), stderr: String(stderr) }));
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

/** Migrations on disk in an app folder: names like 0134_something, in order. */
async function diskMigrations(appDir) {
  try {
    return (await fsp.readdir(path.join(appDir, 'prisma', 'migrations'), { withFileTypes: true }))
      .filter((d) => d.isDirectory() && /^\d{3,}_[\w-]+$/.test(d.name)).map((d) => d.name).sort();
  } catch { return []; }
}

// ---------- The service ----------

export class LocalRunner extends EventEmitter {
  /** state: State (settings key "local"). demo: nothing real runs. registry: lib/repos.js's (the state folder's by default). */
  constructor({ state, demo = false, registry = null }) {
    super();
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
      const ignored = await sh('git', ['-C', w.root, 'check-ignore', '-q', rule.to]);
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

  async startServer(f) {
    const w = await this.where(f);
    if (!w.app) throw new Error(w.reason ?? 'No app folder (a package.json with a "dev" script) in this job’s worktree.');
    const slot = this.#slot(f.slug);
    if (slot.server && ['starting', 'running'].includes(slot.server.status)) return this.#serverView(slot.server);
    const port = await this.portFor(f.slug);
    if (!this.demo && await portInUse(port)) throw new Error(`Something else is already using port ${port}. Stop it, or close the other app, and try again.`);
    // The profile's command, or the app's dev script (only on this computer for a Next.js app: with
    // the sign-in skip on, the app must not be reachable from the network).
    const command = devCommand(w.tryIt, w.app.scripts.dev, port);
    const server = { status: 'starting', port, url: fillPattern(w.tryIt.url, { port }), command, startedAt: new Date().toISOString(), output: '', child: null, exitCode: null };
    slot.server = server;
    if (this.demo) {
      server.output = `$ ${command}\nDemo mode: nothing real runs.\n`;
      server.status = 'running';
      this.#changed(f.slug);
      return this.#serverView(server);
    }
    server.output = `$ ${command}   (in ${w.app.dir})\n`;
    const shell = shellFor(command);
    const child = spawn(shell.file, shell.args, { cwd: w.app.dir, env: childEnv({ PORT: String(port), HOSTNAME: '127.0.0.1', HOST: '127.0.0.1' }), ...shell.options, stdio: ['ignore', 'pipe', 'pipe'] });
    server.child = child;
    const onData = (buf) => {
      const chunk = String(buf).replace(ANSI, '');
      server.output = clip(server.output + chunk);
      this.emit('output', { slug: f.slug, stream: 'server', chunk });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => onData(`\n${err.message}\n`));
    child.on('exit', (code, signal) => {
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
    return s ? { status: s.status, port: s.port, url: s.url, command: s.command, startedAt: s.startedAt, exitCode: s.exitCode } : null;
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
    try { u = new URL(url); } catch { return { reason: `${key} isn’t a database address the workshop can read.` }; }
    if (!/^postgres(ql)?:$/.test(u.protocol)) return { reason: 'Only Postgres databases can be switched from here.' };
    if (!isLocalHost(u.hostname)) return { reason: 'Your app’s database isn’t on this computer, so the workshop won’t touch it.' };
    let name;
    let env;
    try { name = decodeURIComponent(u.pathname.slice(1)); env = pgEnv(url); } catch { return { reason: `${key} has characters the workshop can’t read.` }; }
    if (!/^[A-Za-z0-9_]{1,50}$/.test(name)) return { reason: 'The database name has characters the workshop won’t risk.' };
    return { url, name, original: `${name}__original`, incoming: `${name}__incoming`, env };
  }

  async #psql(db, sql) {
    const r = await sh(await pgTool('psql'), ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db.dbName ?? db.name, '-c', sql], { env: childEnv(db.env), timeout: 30_000 });
    if (!r.ok) throw new Error(r.stderr.trim().split('\n')[0] || 'psql failed');
    return r.stdout.trim();
  }

  async #dbFacts(db) {
    const onAdmin = { ...db, dbName: 'postgres' };
    const rows = (await this.#psql(onAdmin, `select datname from pg_database where datname in ('${db.name}', '${db.original}')`)).split('\n').filter(Boolean);
    const facts = { exists: rows.includes(db.name), originalExists: rows.includes(db.original), ledger: null, connections: 0 };
    if (!facts.exists) return facts;
    facts.connections = Number(await this.#psql(onAdmin, `select count(*) from pg_stat_activity where datname = '${db.name}' and pid <> pg_backend_pid()`)) || 0;
    const hasLedger = (await this.#psql(db, "select to_regclass('public.applied_migrations') is not null")) === 't';
    facts.ledger = hasLedger ? (await this.#psql(db, 'select name from applied_migrations order by name')).split('\n').filter(Boolean) : null;
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
    try { facts = await this.#dbFacts(db); } catch (err) { return { available: false, name: db.name, reason: `Couldn’t read the local database: ${err.message}` }; }
    const saved0 = (await this.#settings()).db?.[db.name] ?? {};
    if (!facts.exists && facts.originalExists) return { available: true, gone: true, name: db.name, busy: this.dbBusy, original: { exists: true, savedAt: saved0.originalAt ?? null }, matches: saved0.matches ?? null, missing: [], extra: [], connections: 0 };
    if (!facts.exists) return { available: false, name: db.name, reason: `The database ${db.name} doesn’t exist on this computer.` };
    if (!facts.ledger) return { available: false, name: db.name, reason: 'This database has no applied_migrations table, so the workshop can’t tell which changes it has.' };
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
      if (slot.server && ['starting', 'running'].includes(slot.server.status)) {
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
    if (!db.url) throw new Error(db.reason ?? 'This job’s app has no database the workshop can switch.');
    if (!['match', 'original', 'save-original'].includes(action)) throw new Error('Unknown database action.');
    const slot = this.#slot(f.slug);
    if (slot.cmd?.status === 'running') throw new Error('A command is still running here. Stop it first, or wait for it.');
    this.dbBusy = true;
    const labels = { match: 'Matching the database to this job', original: 'Putting the original database back', 'save-original': 'Saving the database as the new original' };
    slot.cmd = { id: Date.now().toString(36), label: labels[action], command: labels[action], cwd: null, output: '', status: 'running', startedAt: new Date().toISOString(), endedAt: null, exitCode: null, stoppable: false };
    this.#changed(f.slug);
    try {
      const dbs = (await this.#settings()).db ?? {};
      const saved = dbs[db.name] ?? {};
      const save = async (patch) => { Object.assign(saved, patch); await this.#saveSettings({ db: { ...dbs, [db.name]: saved } }); };
      const [createdb, dropdb] = [await pgTool('createdb'), await pgTool('dropdb')];
      const step = async (file, args) => { const r = await this.#run(f.slug, file, args, db.env); if (!r.ok) throw new Error(`${path.basename(file)} failed (exit ${r.code}).`); };
      await this.#needQuietDb(f.slug, db);
      let facts = await this.#dbFacts(db);
      const admin = { ...db, dbName: 'postgres' };
      // Build a copy under a temporary name, then swap it in: a failed copy never costs a database.
      const swapIn = async (from, to) => {
        await step(dropdb, ['--if-exists', db.incoming]);
        await step(createdb, ['-T', from, db.incoming]);
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
          await step(createdb, ['-T', db.name, db.original]);
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
    for (const slot of this.jobs.values()) {
      if (slot.server?.child && ['starting', 'running'].includes(slot.server.status)) killTree(slot.server.child);
      if (slot.cmd?.child && slot.cmd.status === 'running') killTree(slot.cmd.child);
    }
  }
}
