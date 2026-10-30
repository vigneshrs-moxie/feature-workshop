#!/usr/bin/env node
// ground-control: Ground Control from the terminal (plan §4.1; packet G wrote `resume`, packet I the rest).
//
//   start [--here] [--no-update]   start the service (or, with --here, run it in this terminal)
//   stop                           stop it; replies in progress pause and carry on at the next start
//   status                         the service, repositories, jobs by group, locks, usage
//   doctor [--json]                what this computer is missing, and the line that gets it
//   repo add <path>                register a repository (its ground-control.md, or five questions)
//   token set                      save the Orbit token and write Claude Code's MCP entry
//   resume <job>                   carry on a reply a restart (or Stop) paused
//   update                         move to the newest release, after checking its checksum
//   open <job>                     open the job's folder in your terminal and editor
//   install | uninstall            set up (or remove) the background service from sign-in
//   login --site <address>         pair this laptop with the hosted site (packet 2A)
//   logout                         unpair it
//   decisions <job> [--worktree]   copy the job's decisions.md into docs/decisions/, rebuild the index
//
// One small parser, no dependencies: --help on every command, plain errors, exit code 0 or 1.
// Commands that talk to the running service find it through service.json in the state folder
// (dashboard/runner/service-file.js: pid, port, write token). What the commands reach for (the
// service manager, GitHub, the terminal) comes through `deps`, so tests inject fakes.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { pidAlive } from '../dashboard/lib/lock.js';
import { readServiceFile } from '../dashboard/runner/service-file.js';
import { PRODUCT, stateDirFor } from '../dashboard/lib/state.js';

const BIN = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(BIN), '..');
const SERVICE_PORT = 4477;
const START_HINT = 'Start it with ground-control start (or ground-control start --here to run it in this terminal).';
const NOT_RUNNING = `${PRODUCT} isn’t running. ${START_HINT}`;

// ---------- The commands ----------

const COMMANDS = {
  start: {
    usage: 'ground-control start [--here] [--no-update]',
    summary: `Start ${PRODUCT} (the service, or in this terminal with --here)`,
    help: [
      `Starts the ${PRODUCT} service, which then runs in the background at http://127.0.0.1:4477/next/.`,
      'It checks for a newer release first and installs it after checking its checksum; a check that',
      'can’t be made (no network) never stops the start.',
      '',
      '  --here        run it in this terminal instead of as a service (no service or admin rights',
      '                needed; PORT chooses the port, 4477 when it isn’t set). Ctrl+C stops it.',
      '  --no-update   don’t check for a newer release first',
    ],
    flags: ['here', 'no-update'],
    run: cmdStart,
  },
  stop: {
    usage: 'ground-control stop',
    summary: 'Stop it; replies in progress pause and carry on at the next start',
    help: [`Stops ${PRODUCT}. Foremen that are working pause, and carry on by themselves at the next start.`],
    run: cmdStop,
  },
  status: {
    usage: 'ground-control status',
    summary: 'One screen: the service, repositories, jobs, locks and usage',
    help: [`Shows whether ${PRODUCT} is running (and on which port), the repositories registered, the jobs in each group, the jobs held by a terminal or another copy, and both Claude usage meters.`],
    run: cmdStatus,
  },
  doctor: {
    usage: 'ground-control doctor [--json]',
    summary: 'Check what this computer is missing, and how to get it',
    help: [
      'Checks Node, Git, GitHub CLI and its sign-in, Claude Code and its sign-in, Playwright’s browser,',
      'the Postgres tools, the Orbit token, ports 4477 and 4478, the service and (on Windows) admin',
      'rights. For each one missing it prints the exact line that fixes it on this computer. It never',
      'installs anything itself.',
      '',
      '  --json   the same as JSON (for the installer)',
    ],
    flags: ['json'],
    run: cmdDoctor,
  },
  repo: {
    usage: 'ground-control repo add <path> [--profile <file>]',
    summary: 'Register a repository',
    help: [
      `Adds the repository at <path> to ${PRODUCT}’s list. Its ground-control.md (in the repository’s`,
      'root) says how work is done there. When it has none, five questions make one: the GitHub name,',
      'where job worktrees go, the command that starts the app, the ports to use and the files to copy.',
      `The answers are saved as a profile in ${PRODUCT}’s own folder; the repository isn’t changed.`,
      '',
      '  --profile <file>   use this profile file instead (a full path to a .md file)',
    ],
    values: ['profile'],
    args: { min: 2, max: 2, names: 'add <path>' },
    run: cmdRepo,
  },
  token: {
    usage: 'ground-control token set [--url <address>]',
    summary: 'Save the Orbit token and write Claude Code’s MCP entry',
    help: [
      'Asks for your Orbit token without showing it, saves it in this computer’s credential store and',
      'writes the orbit-feedback entry into Claude Code’s settings, so the Inbox and the Foreman can read',
      'tickets. Orbit’s address comes from Settings, or --url, or it asks.',
      '',
      '  --url <address>   Orbit’s address, like https://orbit.example.com',
    ],
    values: ['url'],
    args: { min: 1, max: 1, names: 'set' },
    run: cmdToken,
  },
  resume: {
    usage: 'ground-control resume <job>',
    summary: 'Carry on a reply a restart (or Stop) paused',
    help: ['Carries on a job’s reply that a restart paused (a crash’s waits for this) or that you paused with Stop.', '<job> is the job’s name (its slug) or the ticket it is for, like ORBIT-479.'],
    args: { min: 1, max: 1, names: '<job>' },
    run: cmdResume,
  },
  update: {
    usage: 'ground-control update [--check]',
    summary: 'Move to the newest release, after checking its checksum',
    help: [
      `Asks GitHub for the newest ${PRODUCT} release. When it is newer than this one, downloads it`,
      'with its checksum file, checks the one against the other, installs it with npm and restarts the',
      'service. A download that doesn’t match its checksum changes nothing.',
      '',
      '  --check   only say whether there is a newer release',
    ],
    flags: ['check'],
    run: cmdUpdate,
  },
  open: {
    usage: 'ground-control open <job> [--terminal] [--editor]',
    summary: 'Open a job’s folder in your terminal and editor',
    help: [`Opens the job’s worktree in the terminal app chosen in ${PRODUCT} and in VS Code.`, '', '  --terminal   only the terminal', '  --editor     only the editor'],
    flags: ['terminal', 'editor'],
    args: { min: 1, max: 1, names: '<job>' },
    run: cmdOpen,
  },
  install: {
    usage: 'ground-control install',
    summary: 'Set up the background service that starts at sign-in',
    help: [
      `Sets ${PRODUCT} up as your own background service, started each time you sign in, on port 4477:`,
      'a Task Scheduler task on Windows, a launchd agent on macOS, a systemd user service on Linux. It',
      'runs as you, never as an administrator account. Where the service can’t be set up (no rights),',
      `it says so: ground-control start --here then runs ${PRODUCT} fully in a terminal.`,
    ],
    run: cmdInstall,
  },
  uninstall: {
    usage: 'ground-control uninstall',
    summary: 'Remove the background service (your files stay)',
    help: [`Stops ${PRODUCT} and removes the background service. Your files in ~/.ground-control are kept.`],
    run: cmdUninstall,
  },
  login: {
    usage: 'ground-control login --site <address> [--name <name>]',
    summary: 'Pair this laptop with the hosted site, once',
    help: [
      `Pairs this laptop with the ${PRODUCT} site, so your jobs here show there. It prints a link and a`,
      'short code: open the link, sign in with your Moxie Google account, check the site shows the same',
      'code and press “Pair this laptop”. The laptop then keeps its own token in this computer’s',
      'credential store; the running service picks it up by itself. Running it again on a laptop',
      'already paired gives it a new token (the old one stops working).',
      '',
      '  --site <address>   the site’s address, like https://feature-workshop.example.com',
      '                     (not needed again once this laptop has been paired)',
      '  --name <name>      what the site calls this laptop (this computer’s name when not given)',
    ],
    values: ['site', 'name'],
    run: cmdLogin,
  },
  logout: {
    usage: 'ground-control logout',
    summary: 'Unpair this laptop from the hosted site',
    help: ['Tells the site to forget this laptop’s token, then forgets it here too. Your jobs stay on this laptop; they stop showing on the site.'],
    run: cmdLogout,
  },
  // The Foreman runs it at the ship stage, as the skill says (packet O).
  decisions: {
    usage: 'ground-control decisions <job> [--worktree <path>]',
    summary: 'Copy a job’s decisions into its repository, beside the index',
    help: [
      'Copies the job’s decisions.md into docs/decisions/ in the worktree, as ORBIT-0479-<short-title>.md,',
      'without the notes meant for agents, and rebuilds docs/decisions/README.md, the list of them.',
      'It never stages, commits or pushes: commit the two files on the feature branch yourself.',
      'Only a job for a ticket gets a file. When the repository still ignores docs/decisions/, it',
      'says so and writes nothing.',
      '',
      '<job> is the job’s name (its slug), the ticket it is for (like ORBIT-479), or its folder.',
      '',
      '  --worktree <path>   the checkout of the feature branch (the job’s own worktree when not given)',
    ],
    values: ['worktree'],
    args: { min: 1, max: 1, names: '<job>' },
    run: cmdDecisions,
  },
  // Not listed: what the Windows task runs (lib/service.js superviseServer).
  'service-run': {
    hidden: true,
    usage: 'ground-control service-run',
    summary: 'Run the dashboard as the service does (the Windows task runs this)',
    help: ['Runs the dashboard on port 4477, writes its output to ~/.ground-control/logs/, starts it again when it fails and stops it cleanly on ground-control stop. The Windows service runs this; you don’t need to.'],
    run: cmdServiceRun,
  },
};

export const COMMAND_NAMES = Object.keys(COMMANDS).filter((n) => !COMMANDS[n].hidden);

// ---------- Parsing ----------

class UsageError extends Error {}

/** argv after the command → { flags, values, args }, or a UsageError in plain words. */
export function parseArgs(name, spec, argv) {
  const flags = {};
  const values = {};
  const args = [];
  const known = new Set(spec.flags ?? []);
  const valued = new Set(spec.values ?? []);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--') { args.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq < 0 ? a.slice(2) : a.slice(2, eq);
      const inline = eq < 0 ? undefined : a.slice(eq + 1);
      if (known.has(key) && inline === undefined) { flags[key] = true; continue; }
      if (valued.has(key)) {
        const v = inline ?? argv[++i];
        if (v === undefined || v === '') throw new UsageError(`--${key} needs a value. Usage: ${spec.usage}`);
        values[key] = v;
        continue;
      }
      throw new UsageError(`${name} doesn’t take --${key}. Run ground-control ${name} --help to see what it takes.`);
    }
    if (a.startsWith('-') && a !== '-') throw new UsageError(`${name} doesn’t take ${a}. Run ground-control ${name} --help to see what it takes.`);
    args.push(a);
  }
  const { min = 0, max = 0 } = spec.args ?? {};
  if (args.length < min) throw new UsageError(`Usage: ${spec.usage}`);
  if (args.length > max) throw new UsageError(`${name} takes ${max === 0 ? 'nothing after it' : `only ${spec.args.names}`}. Usage: ${spec.usage}`);
  return { flags, values, args };
}

function overview() {
  const width = Math.max(...COMMAND_NAMES.map((n) => n.length));
  return [
    `${PRODUCT}: your feature jobs, from the terminal.`,
    '',
    'Usage: ground-control <command> [options]',
    '',
    ...COMMAND_NAMES.map((n) => `  ${n.padEnd(width)}  ${COMMANDS[n].summary}`),
    '',
    'Run ground-control <command> --help for more about one.',
  ];
}

const commandHelp = (spec) => [`Usage: ${spec.usage}`, '', ...spec.help];

/** Runs one command line. Resolves the exit code: 0 when it did what was asked, else 1. */
export async function main(argv = process.argv.slice(2), overrides = {}) {
  const ctx = makeContext(overrides);
  const [name, ...rest] = argv;
  if (!name || name === '--help' || name === '-h' || name === 'help') {
    const about = name === 'help' ? rest[0] : null;
    if (about && !COMMANDS[about]) { ctx.err(`There is no command “${about}”. Run ground-control --help to see them.`); return 1; }
    for (const l of about ? commandHelp(COMMANDS[about]) : overview()) ctx.out(l);
    return 0;
  }
  if (name === '--version' || name === '-v') { ctx.out(ctx.version()); return 0; }
  const spec = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null;
  if (!spec) { ctx.err(`There is no command “${name}”. Run ground-control --help to see them.`); return 1; }
  let parsed;
  try { parsed = parseArgs(name, spec, rest); } catch (err) {
    if (err instanceof UsageError) { ctx.err(err.message); return 1; }
    throw err;
  }
  if (parsed.help) { for (const l of commandHelp(spec)) ctx.out(l); return 0; }
  try {
    const code = await spec.run(ctx, parsed);
    return code === 0 ? 0 : 1;
  } catch (err) {
    ctx.err(err?.plain ? err.message : `Something went wrong: ${err?.message ?? err}`);
    return 1;
  }
}

// ---------- What the commands use ----------

function makeContext(o = {}) {
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  const home = o.home ?? os.homedir();
  const out = o.out ?? ((l) => process.stdout.write(`${l}\n`));
  const err = o.err ?? ((l) => process.stderr.write(`${l}\n`));
  const stdin = o.stdin ?? process.stdin;
  const ctx = {
    env, platform, home, out, err, stdin, cwd: o.cwd ?? process.cwd(),
    stateDir: o.stateDir ?? stateDirFor(env, home),
    interactive: o.interactive ?? Boolean(stdin.isTTY),
    ask: o.ask ?? ((question) => askLine(question, { stdin })),
    askSecret: o.askSecret ?? ((question) => askHidden(question, { stdin })),
    version: () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return 'unknown'; } },
    fetch: o.fetch ?? globalThis.fetch,
    sleep: o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    alive: o.alive ?? pidAlive,
    kill: o.kill ?? ((pid, sig) => process.kill(pid, sig)),
    deps: o.deps ?? {},
  };
  /** The running Ground Control ({ pid, host, port, token }) from service.json, or null. */
  ctx.running = o.running ?? (() => {
    const s = readServiceFile(ctx.stateDir);
    return s && ctx.alive(s.pid) ? s : null;
  });
  return ctx;
}

const lib = async (ctx, name) => ctx.deps[name] ?? import(`../dashboard/lib/${name}.js`);
const plain = (message) => Object.assign(new Error(message), { plain: true });

function askLine(question, { stdin }) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: process.stdout, terminal: Boolean(stdin.isTTY) });
    let answered = false;
    rl.question(question, (answer) => { answered = true; rl.close(); resolve(answer); });
    rl.once('close', () => { if (!answered) resolve(''); });
  });
}

/** Reads one line without showing it (in a terminal); from a pipe, the first line given. */
function askHidden(question, { stdin }) {
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      let text = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (d) => { text += d; });
      stdin.on('end', () => resolve(text.split(/\r?\n/)[0] ?? ''));
    });
  }
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let text = '';
    const done = (fn) => { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); fn(); };
    function onData(chunk) {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') return done(() => resolve(text));
        if (c === '\u0003') return done(() => reject(plain('Stopped: nothing was saved.')));
        if (c === '\u007f' || c === '\b') text = text.slice(0, -1);
        else if (c >= ' ') text += c;
      }
    }
    stdin.on('data', onData);
  });
}

async function api(ctx, s, method, urlPath, body) {
  let res;
  try {
    res = await ctx.fetch(`http://${s.host ?? '127.0.0.1'}:${s.port}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Workshop-Token': s.token },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw plain(NOT_RUNNING);
  }
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  if (!res.ok) throw plain(json?.error ?? `${PRODUCT} said no (${res.status}).`);
  return json;
}

const urlOf = (s) => `http://${s.host ?? '127.0.0.1'}:${s.port}/next/`;

/** Waits for service.json to name a live process, up to `ms`. */
async function waitForService(ctx, ms = 30_000) {
  for (let t = 0; t <= ms; t += 500) {
    const s = ctx.running();
    if (s) return s;
    if (t < ms) await ctx.sleep(500);
  }
  return null;
}

async function waitForExit(ctx, pid, ms = 25_000) {
  for (let t = 0; t < ms; t += 250) {
    if (!ctx.alive(pid)) return true;
    await ctx.sleep(250);
  }
  return !ctx.alive(pid);
}

// ---------- start, stop ----------

async function cmdStart(ctx, { flags }) {
  const now = ctx.running();
  if (now) { ctx.out(`${PRODUCT} is already running at ${urlOf(now)} (pid ${now.pid}).`); return 0; }
  if (!flags['no-update']) {
    const updated = await updateBeforeStart(ctx);
    if (updated && flags.here) {
      // The new files are installed where these were: start them, not the code already loaded here.
      return (ctx.deps.reexec ?? reexec)(['start', '--here', '--no-update']);
    }
  }
  const service = await lib(ctx, 'service');
  if (flags.here) {
    const port = Number(ctx.env.PORT) || SERVICE_PORT;
    ctx.out(`Starting ${PRODUCT} in this terminal on port ${port}. Press Ctrl+C to stop it.`);
    return service.superviseServer({ port, stateDir: ctx.stateDir, env: ctx.env, restart: false, say: ctx.err });
  }
  const svc = await service.checkService({ platform: ctx.platform, home: ctx.home });
  if (!svc.installed) {
    ctx.err(`${PRODUCT} isn’t set up as a service on this computer. Run ground-control install to set it up, or ground-control start --here to run it in this terminal.`);
    return 1;
  }
  const r = await service.startService({ platform: ctx.platform, home: ctx.home });
  if (!r.ok) { ctx.err(`${r.message} ${PRODUCT} still works when started with ground-control start --here.`); return 1; }
  const up = await waitForService(ctx);
  if (!up) { ctx.err(`The service started but ${PRODUCT} hasn’t answered within 30 seconds. Its log is in ${service.logDir(ctx.home, ctx.platform)}.`); return 1; }
  ctx.out(`${PRODUCT} is running at ${urlOf(up)} (pid ${up.pid}).`);
  return 0;
}

/** The update check `start` makes first. True when it installed a newer version. Never stops the start. */
async function updateBeforeStart(ctx) {
  let r;
  try { r = await (await lib(ctx, 'update')).update({ env: ctx.env, platform: ctx.platform }); } catch (err) {
    ctx.out(`Update check: it couldn’t be made (${err.message}). Starting anyway.`);
    return false;
  }
  if (r.status === 'updated') { ctx.out(r.message); return true; }
  if (r.status === 'same' || r.status === 'checkout') return false;
  ctx.out(`Update check: ${r.message} Starting anyway.`);
  return false;
}

function reexec(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { stdio: 'inherit' });
    for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => {}); // the child has the terminal; it stops itself
    child.once('exit', (code) => resolve(code ?? 1));
    child.once('error', () => resolve(1));
  });
}

async function cmdStop(ctx) {
  const s = ctx.running();
  if (!s) { ctx.out(`${PRODUCT} isn’t running.`); return 0; }
  const stopped = await stopRunning(ctx, s);
  if (!stopped.ok) { ctx.err(stopped.message); return 1; }
  ctx.out(stopped.message);
  return 0;
}

const STOPPED = `Stopped ${PRODUCT}. Replies that were in progress are paused and carry on by themselves at the next start.`;

/** Stops the running copy, the gentle way first. */
async function stopRunning(ctx, s) {
  const service = await lib(ctx, 'service');
  if (ctx.platform === 'win32') {
    // No signals on Windows: the supervisor (service-run, or start --here) watches for this file.
    service.requestStop(ctx.stateDir);
    if (await waitForExit(ctx, s.pid)) return { ok: true, message: STOPPED };
    const svc = await service.checkService({ platform: ctx.platform, home: ctx.home }).catch(() => ({ installed: false }));
    if (svc.installed) await service.stopService({ platform: ctx.platform });
    const { killTree } = ctx.deps.platform ?? await import('../dashboard/lib/platform.js');
    killTree(s.pid, { platform: ctx.platform });
    if (await waitForExit(ctx, s.pid, 10_000)) return { ok: true, message: `${PRODUCT} didn’t stop by itself within 25 seconds, so it was ended. A reply that was in progress carries on with ground-control resume <job>.` };
    return { ok: false, message: `${PRODUCT} (pid ${s.pid}) didn’t stop. Close the window it runs in, or end it in Task Manager.` };
  }
  try { ctx.kill(s.pid, 'SIGTERM'); } catch { /* gone already */ }
  if (await waitForExit(ctx, s.pid)) return { ok: true, message: STOPPED };
  return { ok: false, message: `${PRODUCT} (pid ${s.pid}) hasn’t stopped after 25 seconds. Try again, or stop it with kill ${s.pid}.` };
}

async function cmdServiceRun(ctx) {
  const service = await lib(ctx, 'service');
  const log = path.join(service.logDir(ctx.home, ctx.platform), service.LOG_NAME);
  return service.superviseServer({ port: SERVICE_PORT, stateDir: ctx.stateDir, env: ctx.env, log, restart: true, say: ctx.err });
}

// ---------- status ----------

const GROUP_WORDS = { 'needs-you': 'need you', running: 'running', paused: 'paused', idle: 'idle', shipping: 'shipping', done: 'done' };

async function cmdStatus(ctx) {
  const s = ctx.running();
  const lines = [PRODUCT];
  let snap = null;
  if (s) {
    try { snap = await api(ctx, s, 'GET', '/api/snapshot'); } catch { snap = null; }
    lines.push(`  Service    running at ${urlOf(s)} (pid ${s.pid}, port ${s.port})${snap ? '' : ', but it didn’t answer just now'}`);
  } else {
    lines.push(`  Service    not running. ${START_HINT}`);
  }
  // The repositories, from the registry file (it is there whether or not the service runs).
  try {
    const { openRegistry } = await lib(ctx, 'repos');
    const repos = await openRegistry({ dir: ctx.stateDir }).listRepos();
    if (!repos.length) lines.push('  Repos      none registered yet (ground-control repo add <path>)');
    else {
      lines.push(`  Repos      ${repos.length} registered`);
      for (const r of repos) lines.push(`               ${r.name}  ${r.path}${r.ok ? '' : `  (its profile has a problem: ${r.errors[0]})`}${r.exists ? '' : '  (folder missing)'}`);
    }
  } catch (err) {
    lines.push(`  Repos      the list can’t be read (${err.message})`);
  }
  if (!snap) {
    lines.push(`  Jobs, locks and usage show here while ${PRODUCT} is running.`);
  } else {
    const jobs = snap.jobs ?? [];
    const counts = Object.entries(GROUP_WORDS).map(([g, w]) => `${jobs.filter((j) => j.group === g).length} ${w}`);
    lines.push(`  Jobs       ${jobs.length ? counts.join(', ') : 'none yet'}`);
    const held = jobs.filter((j) => j.lock);
    if (!held.length) lines.push('  Locks      none: no job is held by a terminal or another copy');
    else {
      const { describeLock } = await import('../dashboard/lib/lock.js');
      lines.push(`  Locks      ${held.length}`);
      for (const j of held) lines.push(`               ${j.slug}: ${describeLock(j.lock)}`);
    }
    const u = snap.planUsage;
    if (!u || u.enabled === false) lines.push('  Usage      not read (turned off)');
    else if (!u.fiveHour && !u.week) lines.push(`  Usage      not read yet${u.error ? ` (${u.error})` : ''}`);
    else lines.push(`  Usage      5-hour ${u.fiveHour ? `${u.fiveHour.percent} % used` : 'unknown'}, week ${u.week ? `${u.week.percent} % used` : 'unknown'}${u.error ? ` (last reading: ${u.error})` : ''}`);
  }
  for (const l of lines) ctx.out(l);
  return 0;
}

// ---------- doctor ----------

async function cmdDoctor(ctx, { flags }) {
  const d = await lib(ctx, 'doctor');
  const report = await d.runDoctor({ platform: ctx.platform, env: ctx.env, home: ctx.home, ...(ctx.deps.doctorOptions ?? {}) });
  if (flags.json) ctx.out(JSON.stringify(report, null, 2));
  else for (const l of d.formatDoctor(report)) ctx.out(l);
  return report.ok ? 0 : 1;
}

// ---------- repo add ----------

const quoted = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** A profile from the five answers (plan §4.1), as ground-control.md text. */
export function profileFromAnswers({ name, github, worktree, command, ports, files }, { date = new Date() } = {}) {
  const lines = ['---', `# Made by ground-control repo add on ${date.toISOString().slice(0, 10)} from your answers. Change it any time;`, '# a ground-control.md in the repository’s own root takes its place.', `name: ${quoted(name)}`];
  if (github) lines.push(`github: ${quoted(github)}`);
  lines.push(`worktree: ${quoted(worktree)}`, 'tryIt:');
  if (command) lines.push(`  command: ${quoted(command)}`);
  lines.push(`  ports: ${ports}`);
  if (files.length) {
    lines.push('filesToCopy:');
    for (const f of files) lines.push(`  - from: ${quoted(f)}`, `    to: ${quoted(f)}`);
  }
  lines.push('---', '', `Notes about ${name} for people go here.`, '');
  return lines.join('\n');
}

async function cmdRepo(ctx, { args, values }) {
  const [sub, where] = args;
  if (sub !== 'add') { ctx.err(`repo only has add for now. Usage: ${COMMANDS.repo.usage}`); return 1; }
  const repos = await lib(ctx, 'repos');
  const { PROFILE_FILE, parseProfile } = await lib(ctx, 'profile');
  const checked = await repos.checkRepo(path.resolve(where));
  if (!checked.ok) { ctx.err(checked.reason); return 1; }
  const top = checked.path;
  const registry = repos.openRegistry({ dir: ctx.stateDir });
  const tell = (r, extra = '') => {
    if (!r.ok) { for (const e of r.errors) ctx.err(e); return 1; }
    ctx.out(`Added ${r.repo.name} (${r.repo.path})${extra}.`);
    for (const w of r.warnings ?? []) ctx.out(`  Note: ${w}`);
    return 0;
  };
  if (values.profile) return tell(await registry.addRepo(top, { profileFile: path.resolve(values.profile) }), `, with the profile ${path.resolve(values.profile)}`);
  if (fs.existsSync(path.join(top, PROFILE_FILE))) return tell(await registry.addRepo(top), `, with its own ${PROFILE_FILE}`);
  // No profile of its own: a profile Ground Control carries may name it (Orbit's does).
  const first = await registry.addRepo(top);
  if (first.ok || !first.errors.some((e) => e.includes(PROFILE_FILE))) return tell(first, first.ok && first.repo.profileFile ? `, with the profile ${first.repo.profileFile}` : '');

  if (!ctx.interactive) {
    ctx.err(`${top} has no ${PROFILE_FILE}. Run this in a terminal to answer five questions that make one, write one in the repository’s root, or name one with --profile <file>.`);
    return 1;
  }
  const folder = path.basename(top);
  ctx.out(`${folder} has no ${PROFILE_FILE}, so five questions make one. Press Enter to take the suggestion in brackets.`);
  const ask = async (question, suggestion) => {
    const a = String(await ctx.ask(`${question}${suggestion ? ` [${suggestion}]` : ''}: `)).trim();
    if (/["\u0000-\u001f]/.test(a)) throw plain('Answers can’t have double quotes or line breaks in them. Nothing was saved.');
    return a || suggestion || '';
  };
  const answers = {
    name: folder,
    github: await ask('1. Its GitHub name, as org/repo', await originGithub(top)),
    worktree: await ask('2. Where a job’s worktree goes, with {slug} for the job’s name', `../${folder}-{slug}`),
    command: await ask('3. The command that starts the app, with {port} for its port (Enter: the app’s own dev script)', ''),
    ports: await ask('4. The ports jobs may use, first-last', '3001-3099'),
    files: (await ask('5. Files to copy from your checkout into each worktree, separated by commas (or none)', '.env.local'))
      .split(',').map((f) => f.trim()).filter((f) => f && f.toLowerCase() !== 'none'),
  };
  const text = profileFromAnswers(answers);
  const parsed = parseProfile(text);
  if (!parsed.ok) {
    ctx.err('Those answers don’t make a profile yet:');
    for (const e of parsed.errors) ctx.err(`  ${e}`);
    ctx.err('Nothing was saved. Run ground-control repo add again.');
    return 1;
  }
  const dir = path.join(ctx.stateDir, 'profiles');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let file = path.join(dir, `${folder}.md`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${folder}-${n}.md`);
  fs.writeFileSync(file, text, { mode: 0o600 });
  const r = await registry.addRepo(top, { profileFile: file });
  if (!r.ok) fs.rmSync(file, { force: true });
  return tell(r, `, with the profile saved at ${file}`);
}

/** The org/repo of the folder's origin remote, when it is on GitHub, else ''. */
async function originGithub(dir) {
  const { githubOfUrl } = await import('../dashboard/lib/profile.js');
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, 'remote', 'get-url', 'origin'], { timeout: 5000, windowsHide: true }, (err, stdout) => resolve(err ? '' : githubOfUrl(String(stdout).trim()) ?? ''));
  });
}

// ---------- token set ----------

async function cmdToken(ctx, { args, values }) {
  if (args[0] !== 'set') { ctx.err(`token only has set. Usage: ${COMMANDS.token.usage}`); return 1; }
  const orbit = await lib(ctx, 'orbit');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(path.join(ctx.stateDir, 'settings.json'), 'utf8'))?.orbit ?? {}; } catch { saved = {}; }
  let url = values.url || saved.url || ctx.env.GROUND_CONTROL_ORBIT_URL || '';
  if (!url) {
    if (!ctx.interactive) { ctx.err('Say Orbit’s address with --url <address>, like --url https://orbit.example.com.'); return 1; }
    url = String(await ctx.ask('Orbit’s address (like https://orbit.example.com): ')).trim();
  }
  try { url = orbit.normalizeOrbitUrl(url); } catch (err) { ctx.err(err.message); return 1; }
  const token = String(await ctx.askSecret('Paste your Orbit token (it isn’t shown as you type), then press Enter: ')).trim();
  try { orbit.checkToken(token); } catch (err) { ctx.err(`${err.message} Nothing was saved.`); return 1; }

  const s = ctx.running();
  const claudeSettingsFile = path.resolve(ctx.env.WORKSHOP_CLAUDE_SETTINGS || path.join(ctx.home, '.claude.json'));
  if (s) {
    // The running service saves it (with setToken, as Settings does), so its Inbox starts reading at once.
    await api(ctx, s, 'POST', '/api/orbit/token', { token, url });
  } else {
    const { tokenStore } = await lib(ctx, 'orbit-token');
    const store = await tokenStore({ stateDir: ctx.stateDir, prefer: ctx.env.WORKSHOP_ORBIT_STORE === 'file' || ctx.env.WORKSHOP_DEMO ? 'file' : 'auto' });
    try { await orbit.setToken(token, { store, claudeSettingsFile, orbitUrl: url }); } catch (err) { ctx.err(`${err.message} Nothing was saved.`); return 1; }
    const { State } = await lib(ctx, 'state');
    const state = new State(ctx.stateDir);
    await state.setSettings({ orbit: { ...saved, url, savedAt: new Date().toISOString(), expiresAt: saved.expiresAt ?? null } });
    await state.audit({ action: 'orbit-token', what: 'saved', store: store.kind, mcp: orbit.MCP_NAME, via: 'cli' });
  }
  ctx.out(`Saved the Orbit token and wrote the ${orbit.MCP_NAME} entry into ${s ? 'Claude Code’s settings' : claudeSettingsFile}. Claude Code sessions started from now on can read tickets.`);
  return 0;
}

// ---------- login, logout (packet 2A): pairing with the hosted site ----------

async function siteStore(ctx) {
  const link = ctx.deps['site-link'] ?? await import('../dashboard/runner/site-link.js');
  const store = await link.siteTokenStore({ stateDir: ctx.stateDir, prefer: ctx.env.WORKSHOP_ORBIT_STORE === 'file' || ctx.env.WORKSHOP_DEMO ? 'file' : 'auto' });
  return { link, store };
}

async function cmdLogin(ctx, { values }) {
  const { link, store } = await siteStore(ctx);
  const siteUrl = values.site || link.readSiteFile(ctx.stateDir)?.url;
  if (!siteUrl) { ctx.err(`Say which site with --site <address>. Usage: ${COMMANDS.login.usage}`); return 1; }
  const r = await link.pairWithSite({ siteUrl, stateDir: ctx.stateDir, store, fetch: ctx.fetch, out: ctx.out, sleep: ctx.sleep, version: ctx.version(), name: values.name });
  ctx.out(r.rotated
    ? `Paired again: this laptop is “${r.runner.name}” on the site, for ${r.person.email}. Its old token no longer works.`
    : `Paired: this laptop is “${r.runner.name}” on the site, for ${r.person.email}.`);
  ctx.out(ctx.running() ? 'Your jobs show on the site from now on.' : `Your jobs show on the site while ${PRODUCT} runs. ${START_HINT}`);
  return 0;
}

async function cmdLogout(ctx) {
  const { link, store } = await siteStore(ctx);
  const r = await link.unpairFromSite({ stateDir: ctx.stateDir, store, fetch: ctx.fetch });
  if (!r) { ctx.out('This laptop isn’t paired with a site, so there was nothing to forget.'); return 0; }
  ctx.out(r.told
    ? `Unpaired: ${r.url} has forgotten this laptop, and its token is gone from here too.`
    : `Unpaired here: the token is gone from this laptop. ${r.url ?? 'The site'} couldn’t be reached, so the token still works there until you remove this laptop in the site’s Settings → Laptops.`);
  return 0;
}

// ---------- resume (packet G) ----------

// G's own words, kept as they were (restart-server.test.js expects them).
const RESUME_NOT_RUNNING = `${PRODUCT} isn’t running. Start it with npm start (ground-control start once it is installed). A job paused by a clean stop carries on by itself.`;

async function cmdResume(ctx, { args }) {
  const name = args[0];
  const s = ctx.running();
  if (!s) { ctx.err(RESUME_NOT_RUNNING); return 1; }
  const body = await api(ctx, s, 'POST', `/api/job/${encodeURIComponent(name)}/resume`, { via: 'cli' });
  ctx.out(`Resumed ${name}: the Foreman is carrying on${body?.run?.sessionId ? ` in the same session (${body.run.sessionId})` : ''}.`);
  return 0;
}

// ---------- update ----------

async function cmdUpdate(ctx, { flags }) {
  const u = await lib(ctx, 'update');
  if (flags.check) {
    const r = await u.checkForUpdate({ env: ctx.env });
    if (r.status === 'newer') ctx.out(`${PRODUCT} ${r.latest} is out (this is ${r.current}). Run ground-control update to move to it.`);
    else if (r.status === 'same' || r.status === 'older') ctx.out(`${PRODUCT} ${r.current} is the newest version.`);
    else { ctx.err(r.message); return 1; }
    return 0;
  }
  const r = await u.update({ env: ctx.env, platform: ctx.platform });
  if (r.status === 'same' || r.status === 'checkout') { ctx.out(r.message); return 0; }
  if (r.status !== 'updated') { ctx.err(r.message); return 1; }
  ctx.out(r.message);
  const s = ctx.running();
  if (!s) return 0;
  const service = await lib(ctx, 'service');
  const svc = await service.checkService({ platform: ctx.platform, home: ctx.home }).catch(() => ({ installed: false }));
  if (!svc.installed) { ctx.out(`${PRODUCT} is running in a terminal: stop it there (Ctrl+C) and start it again to use the new version.`); return 0; }
  const stopped = await stopRunning(ctx, s);
  if (!stopped.ok) { ctx.err(stopped.message); return 1; }
  const started = await service.startService({ platform: ctx.platform, home: ctx.home });
  if (!started.ok) { ctx.err(started.message); return 1; }
  const up = await waitForService(ctx);
  if (!up) { ctx.err('The service restarted but hasn’t answered within 30 seconds. Run ground-control status to see.'); return 1; }
  ctx.out(`Restarted: ${PRODUCT} ${r.latest} is running at ${urlOf(up)}.`);
  return 0;
}

// ---------- open ----------

async function cmdOpen(ctx, { args, flags }) {
  const s = ctx.running();
  if (!s) { ctx.err(NOT_RUNNING); return 1; }
  const view = await api(ctx, s, 'GET', `/api/job/${encodeURIComponent(args[0])}/local`);
  if (!view?.available) { ctx.err(view?.reason ?? 'This job has no folder to open yet.'); return 1; }
  const dir = view.app?.dir ?? view.root;
  const { openIn } = ctx.deps.platform ?? await import('../dashboard/lib/platform.js');
  const what = flags.terminal || flags.editor ? [flags.terminal && 'terminal', flags.editor && 'editor'].filter(Boolean) : ['terminal', 'editor'];
  let failed = 0;
  for (const kind of what) {
    const where = kind === 'terminal' ? view.terminalApp : 'VS Code';
    const r = await openIn(kind, dir, { terminalApp: view.terminalApp, platform: ctx.platform, env: ctx.env });
    if (r.ok) ctx.out(`Opened ${dir} in ${where}.`);
    else { failed++; ctx.err(`Couldn’t open it in ${where}: ${r.message}`); }
  }
  return failed ? 1 : 0;
}

// ---------- decisions (packet O) ----------

const readJsonFile = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** A job's folder from its slug, its ticket key or its path; null when there is none. */
export function findJobDir(name, { env = process.env, home = os.homedir(), cwd = process.cwd() } = {}) {
  const features = path.resolve(env.WORKSHOP_FEATURES_DIR || path.join(home, '.claude', 'feature-work'));
  if (/[\\/]/.test(name) || name === '.' || name === '..') {
    const dir = path.resolve(cwd, name);
    return isDir(dir) ? dir : null;
  }
  if (!name.startsWith('.') && isDir(path.join(features, name))) return path.join(features, name);
  const key = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(name);
  if (!key) return null;
  let names = [];
  try { names = fs.readdirSync(features).sort(); } catch { return null; }
  const want = `${key[1].toUpperCase()}-${Number(key[2])}`;
  const hits = names.filter((n) => !n.startsWith('.') && isDir(path.join(features, n))).filter((n) => {
    const t = readJsonFile(path.join(features, n, 'status.json'))?.ticket?.key;
    if (typeof t === 'string') return t.toUpperCase() === want;
    return key[1].toUpperCase() === 'ORBIT' && new RegExp(`^orbit-0*${Number(key[2])}(-|$)`, 'i').test(n);
  });
  // A stack's sections share its ticket (<parent>--<section>): the parent is the job.
  const top = hits.filter((n) => !n.includes('--'));
  return (top.length === 1 ? path.join(features, top[0]) : hits.length === 1 ? path.join(features, hits[0]) : null);
}

async function cmdDecisions(ctx, { args, values }) {
  const name = args[0];
  const jobDir = findJobDir(name, { env: ctx.env, home: ctx.home, cwd: ctx.cwd });
  if (!jobDir) { ctx.err(`There is no job “${name}”. Give its name (the folder’s name), the ticket it is for, or its folder.`); return 1; }
  const status = readJsonFile(path.join(jobDir, 'status.json'));
  const worktree = values.worktree ? path.resolve(ctx.cwd, values.worktree) : (typeof status?.worktree === 'string' && status.worktree) || null;
  if (!worktree) { ctx.err('This job doesn’t say where its worktree is. Give it with --worktree <path>.'); return 1; }
  const { writeRepoCopy } = await lib(ctx, 'decisions');
  const r = await writeRepoCopy({ jobDir, worktree });
  if (!r.ok) { ctx.err(r.reason); return 1; }
  const key = r.name.replace(/^([A-Z][A-Z0-9]*)-0*(\d+).*$/, '$1-$2');
  ctx.out(`${r.changed.file ? 'Wrote' : 'Already up to date:'} ${r.file}`);
  ctx.out(`${r.changed.index ? 'Rebuilt' : 'Already up to date:'} ${r.index}`);
  ctx.out('Nothing is staged or committed. On the feature branch, commit just these two:');
  const root = path.dirname(path.dirname(path.dirname(r.file))); // <root>/docs/decisions/<name>
  ctx.out(`  git -C "${root}" add -- ${r.paths.join(' ')}`);
  ctx.out(`  git -C "${root}" commit -m "docs(decisions): ${key} decisions" -- ${r.paths.join(' ')}`);
  return 0;
}

// ---------- install, uninstall ----------

async function cmdInstall(ctx) {
  const service = await lib(ctx, 'service');
  const svc = await service.checkService({ platform: ctx.platform, home: ctx.home }).catch(() => ({ installed: false }));
  const now = ctx.running();
  if (now && !svc.installed) {
    ctx.err(`${PRODUCT} is running now outside the service (pid ${now.pid}). Stop it first with ground-control stop, then run ground-control install again.`);
    return 1;
  }
  if (now) { const stopped = await stopRunning(ctx, now); if (!stopped.ok) { ctx.err(stopped.message); return 1; } }
  const r = await service.installService({ platform: ctx.platform, home: ctx.home, env: ctx.env });
  if (!r.ok) { ctx.err(r.message); return 1; }
  const up = await waitForService(ctx);
  if (!up) { ctx.err(`The service is set up, but ${PRODUCT} hasn’t answered within 30 seconds. Its log: ${r.log}`); return 1; }
  ctx.out(`Installed. ${PRODUCT} is running at ${urlOf(up)} and starts by itself each time you sign in.`);
  ctx.out(`  Its log: ${r.log}`);
  return 0;
}

async function cmdUninstall(ctx) {
  const service = await lib(ctx, 'service');
  const now = ctx.running();
  if (now) { const stopped = await stopRunning(ctx, now); if (!stopped.ok) { ctx.err(stopped.message); return 1; } }
  const r = await service.removeService({ platform: ctx.platform, home: ctx.home });
  if (!r.ok) { ctx.err(r.message); return 1; }
  ctx.out(r.removed ? `Removed the service: ${PRODUCT} no longer starts at sign-in.` : 'There was no service to remove.');
  ctx.out('Your files in ~/.ground-control are kept. To remove the program too: npm rm -g @moxie/ground-control');
  return 0;
}

// ---------- Run ----------

const isMain = (() => {
  try { return fs.realpathSync(process.argv[1] ?? '') === fs.realpathSync(BIN); } catch { return false; }
})();
if (isMain) process.exitCode = await main();
