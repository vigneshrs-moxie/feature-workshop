// The command line (packet I step 1, bin/ground-control.js): each command's --help, its plain
// errors and its exit code (0 or 1). Everything a command reaches for (the service manager,
// doctor, GitHub, the running service) is a fake here: nothing is installed, started or asked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COMMAND_NAMES, main, parseArgs, profileFromAnswers } from '../../bin/ground-control.js';
import { PRODUCT } from '../lib/state.js';
import { parseProfile } from '../lib/profile.js';

const tmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

/** Runs one command line with fakes; resolves { code, out, err, text }. */
async function cli(argv, o = {}) {
  const out = [];
  const err = [];
  const code = await main(argv, {
    env: {}, home: tmp('gc-cli-home-'), stateDir: tmp('gc-cli-state-'), running: () => null, interactive: false, platform: 'darwin',
    ...o, out: (l) => out.push(l), err: (l) => err.push(l),
  });
  return { code, out, err, text: [...out, ...err].join('\n') };
}

const ALL = ['start', 'stop', 'status', 'doctor', 'repo', 'token', 'resume', 'update', 'open', 'install', 'uninstall', 'login', 'decisions'];

test('--help lists every command, and each command has its own --help', async () => {
  assert.deepEqual(COMMAND_NAMES, ALL, 'the commands of plan §4.1, the hidden service-run left out');
  for (const argv of [[], ['--help'], ['-h'], ['help']]) {
    const r = await cli(argv);
    assert.equal(r.code, 0);
    assert.match(r.out[0], new RegExp(`^${PRODUCT}`));
    for (const name of ALL) assert.ok(r.out.some((l) => l.startsWith(`  ${name} `)), `${name} is listed`);
    assert.doesNotMatch(r.text, /service-run/);
  }
  for (const name of [...ALL, 'service-run']) {
    for (const flag of ['--help', '-h']) {
      const r = await cli([name, flag]);
      assert.equal(r.code, 0, `${name} ${flag}`);
      assert.match(r.out[0], new RegExp(`^Usage: ground-control ${name}\\b`), `${name} ${flag}`);
      assert.ok(r.out.length > 2, `${name} says more than its usage`);
    }
  }
  const about = await cli(['help', 'update']);
  assert.equal(about.code, 0);
  assert.match(about.out[0], /^Usage: ground-control update/);
  // --help wins wherever it is, even after a value that would be wrong.
  assert.equal((await cli(['resume', 'a', 'b', '--help'])).code, 0);
});

test('plain errors and exit code 1: no such command, a flag it doesn’t take, too few or too many words', async () => {
  const cases = [
    [['frobnicate'], /^There is no command “frobnicate”\. Run ground-control --help to see them\.$/],
    [['help', 'frobnicate'], /^There is no command “frobnicate”/],
    [['start', '--fast'], /^start doesn’t take --fast\. Run ground-control start --help to see what it takes\.$/],
    [['doctor', '-x'], /^doctor doesn’t take -x\./],
    [['resume'], /^Usage: ground-control resume <job>$/],
    [['resume', 'a', 'b'], /^resume takes only <job>\. Usage: ground-control resume <job>$/],
    [['stop', 'now'], /^stop takes nothing after it\. Usage: ground-control stop$/],
    [['repo'], /^Usage: ground-control repo add <path>/],
    [['repo', 'list', 'x'], /^repo only has add for now\./],
    [['repo', 'add', '/x', '--profile'], /^--profile needs a value\./],
    [['token'], /^Usage: ground-control token set/],
    [['token', 'get'], /^token only has set\./],
    [['open'], /^Usage: ground-control open <job>/],
    [['here', '--start'], /^There is no command “here”/],
  ];
  for (const [argv, want] of cases) {
    const r = await cli(argv);
    assert.equal(r.code, 1, argv.join(' '));
    assert.equal(r.out.length, 0, `${argv.join(' ')}: errors go to stderr`);
    assert.match(r.err[0], want, argv.join(' '));
  }
  // Only known names are commands: nothing from Object's prototype.
  assert.equal((await cli(['constructor'])).code, 1);
});

test('the parser: flags, --name value and --name=value, and -- ends the options', () => {
  const spec = { usage: 'u', flags: ['here'], values: ['url'], args: { min: 0, max: 2, names: 'a b' } };
  assert.deepEqual(parseArgs('x', spec, ['--here', '--url', 'https://o', 'a']), { flags: { here: true }, values: { url: 'https://o' }, args: ['a'] });
  assert.deepEqual(parseArgs('x', spec, ['--url=https://o', '--', '--here']), { flags: {}, values: { url: 'https://o' }, args: ['--here'] });
  assert.throws(() => parseArgs('x', spec, ['--here=yes']), /x doesn’t take --here/);
});

test('--version prints the version from package.json', async () => {
  const r = await cli(['--version']);
  assert.equal(r.code, 0);
  const { version } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(r.out[0], version);
});

test('login is for a later version', async () => {
  const r = await cli(['login']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, ['Pairing with the site comes in a later version.']);
});

test('with no service running: stop says so, open and resume say how to start one, status still shows what it can', async () => {
  const stop = await cli(['stop']);
  assert.equal(stop.code, 0);
  assert.deepEqual(stop.out, [`${PRODUCT} isn’t running.`]);

  const open = await cli(['open', 'sample-job']);
  assert.equal(open.code, 1);
  assert.match(open.err[0], /isn’t running\. Start it with ground-control start \(or ground-control start --here to run it in this terminal\)\./);

  const resume = await cli(['resume', 'sample-job']);
  assert.equal(resume.code, 1);
  assert.match(resume.err[0], /isn’t running\. Start it with npm start \(ground-control start once it is installed\)/, 'G’s words, unchanged');

  const status = await cli(['status']);
  assert.equal(status.code, 0);
  assert.match(status.text, /Service {4}not running\. Start it with ground-control start/);
  assert.match(status.text, /Repos {6}none registered yet \(ground-control repo add <path>\)/);
  assert.match(status.text, /Jobs, locks and usage show here while .* is running\./);
});

test('status with the service running: port, jobs by group, locks and both meters, from its snapshot', async () => {
  const snapshot = {
    jobs: [{ slug: 'a', group: 'needs-you' }, { slug: 'b', group: 'running', lock: { kind: 'terminal', pid: 9 } }, { slug: 'c', group: 'done' }],
    planUsage: { enabled: true, fiveHour: { percent: 40 }, week: { percent: 12 } },
  };
  const asked = [];
  const r = await cli(['status'], {
    running: () => ({ pid: 77, host: '127.0.0.1', port: 4481, token: 't' }),
    fetch: async (url, init) => { asked.push([url, init.headers['X-Workshop-Token']]); return { ok: true, status: 200, json: async () => snapshot }; },
  });
  assert.equal(r.code, 0);
  assert.deepEqual(asked, [['http://127.0.0.1:4481/api/snapshot', 't']]);
  assert.match(r.text, /Service {4}running at http:\/\/127\.0\.0\.1:4481\/next\/ \(pid 77, port 4481\)/);
  assert.match(r.text, /Jobs {7}1 need you, 1 running, 0 paused, 0 idle, 0 shipping, 1 done/);
  assert.match(r.text, /Locks {6}1\n {15}b: /);
  assert.match(r.text, /Usage {6}5-hour 40 % used, week 12 % used/);
});

test('doctor prints the report, --json prints it as JSON, and the exit code says whether anything needed is missing', async () => {
  const report = (ok) => ({ ok, system: 'macOS', checks: [{ id: 'git', name: 'Git', ok, found: ok ? 'git 2.4' : 'not found', fix: ok ? null : 'brew install git' }] });
  const fake = (ok) => ({ runDoctor: async () => report(ok), formatDoctor: (rep) => rep.checks.map((c) => `${c.ok ? 'OK' : 'MISSING'}  ${c.name}  ${c.fix ?? ''}`) });
  const good = await cli(['doctor'], { deps: { doctor: fake(true) } });
  assert.equal(good.code, 0);
  assert.match(good.out[0], /^OK {2}Git/);
  const bad = await cli(['doctor', '--json'], { deps: { doctor: fake(false) } });
  assert.equal(bad.code, 1);
  assert.deepEqual(JSON.parse(bad.out.join('\n')), report(false));
});

/** A pretend lib/service.js; `installed` and `install` answer as asked, and every call is kept. */
function fakeService({ installed = false, install = { ok: true, log: '/l/ground-control.log' }, start = { ok: true } } = {}) {
  const calls = [];
  return {
    calls,
    logDir: () => '/l',
    LOG_NAME: 'ground-control.log',
    checkService: async (o) => { calls.push(['check', o.platform]); return { installed }; },
    startService: async () => { calls.push(['start']); return start; },
    installService: async (o) => { calls.push(['install', o.platform]); return install; },
    removeService: async () => { calls.push(['remove']); return { ok: true, removed: installed }; },
    superviseServer: async (o) => { calls.push(['supervise', o.port, o.restart]); return 0; },
    requestStop: () => calls.push(['request-stop']),
    stopService: async () => { calls.push(['stop']); return { ok: true }; },
  };
}

test('start: --here runs it in this terminal on PORT; without it, the service (or how to set one up)', async () => {
  const svc = fakeService();
  const here = await cli(['start', '--here', '--no-update'], { env: { PORT: '4481' }, deps: { service: svc } });
  assert.equal(here.code, 0);
  assert.deepEqual(svc.calls, [['supervise', 4481, false]]);
  assert.match(here.out[0], /in this terminal on port 4481\. Press Ctrl\+C to stop it\./);

  const none = await cli(['start', '--no-update'], { deps: { service: fakeService() } });
  assert.equal(none.code, 1);
  assert.match(none.err[0], /isn’t set up as a service on this computer\. Run ground-control install to set it up, or ground-control start --here/);

  let up = null;
  const started = await cli(['start', '--no-update'], { deps: { service: fakeService({ installed: true }) }, running: () => up, sleep: async () => { up = { pid: 5, port: 4477 }; } });
  assert.equal(started.code, 0);
  assert.match(started.out[0], /is running at http:\/\/127\.0\.0\.1:4477\/next\/ \(pid 5\)/);

  const already = await cli(['start'], { running: () => ({ pid: 5, port: 4477 }) });
  assert.equal(already.code, 0);
  assert.match(already.out[0], /is already running/);
});

test('start checks for an update first unless --no-update, and a failed check never stops it', async () => {
  let asked = 0;
  const svc = fakeService();
  const r = await cli(['start', '--here'], { deps: { service: svc, update: { update: async () => { asked++; throw new Error('gh fell over'); } } } });
  assert.equal(r.code, 0);
  assert.equal(asked, 1);
  assert.match(r.out[0], /^Update check: it couldn’t be made \(gh fell over\)\. Starting anyway\.$/);
  await cli(['start', '--here', '--no-update'], { deps: { service: svc, update: { update: async () => { asked++; return { status: 'same' }; } } } });
  assert.equal(asked, 1, '--no-update asks nothing');
});

test('install: the service is set up, or the plain no-rights message and exit 1', async () => {
  let up = null;
  const ok = await cli(['install'], { deps: { service: fakeService() }, running: () => up, sleep: async () => { up = { pid: 6, port: 4477 }; } });
  assert.equal(ok.code, 0);
  assert.match(ok.out[0], /^Installed\. .* starts by itself each time you sign in\.$/);

  const message = 'Windows didn’t let this account make the Task Scheduler task … run ground-control start --here';
  const denied = await cli(['install'], { platform: 'win32', deps: { service: fakeService({ install: { ok: false, reason: 'no-rights', message } }) } });
  assert.equal(denied.code, 1);
  assert.deepEqual(denied.err, [message]);

  const running = await cli(['install'], { deps: { service: fakeService() }, running: () => ({ pid: 8, port: 4481 }) });
  assert.equal(running.code, 1);
  assert.match(running.err[0], /is running now outside the service \(pid 8\)\. Stop it first with ground-control stop/);
});

test('uninstall removes the service and keeps the files', async () => {
  const r = await cli(['uninstall'], { deps: { service: fakeService({ installed: true }) } });
  assert.equal(r.code, 0);
  assert.equal(r.out[0], `Removed the service: ${PRODUCT} no longer starts at sign-in.`);
  assert.match(r.out[1], /Your files in ~\/\.ground-control are kept\./);
  const none = await cli(['uninstall'], { deps: { service: fakeService() } });
  assert.equal(none.out[0], 'There was no service to remove.');
});

test('update --check only says; update reports a mismatch with exit 1', async () => {
  const newer = await cli(['update', '--check'], { deps: { update: { checkForUpdate: async () => ({ status: 'newer', current: '1.5.0', latest: '1.6.0' }) } } });
  assert.equal(newer.code, 0);
  assert.match(newer.out[0], /1\.6\.0 is out \(this is 1\.5\.0\)\. Run ground-control update to move to it\./);
  const offline = await cli(['update', '--check'], { deps: { update: { checkForUpdate: async () => ({ status: 'offline', message: 'GitHub can’t be reached right now.' }) } } });
  assert.equal(offline.code, 1);
  const bad = await cli(['update'], { deps: { update: { update: async () => ({ status: 'mismatch', message: 'The download didn’t match its checksum. Nothing was changed.' }) } } });
  assert.equal(bad.code, 1);
  assert.deepEqual(bad.err, ['The download didn’t match its checksum. Nothing was changed.']);
});

test('token set: needs Orbit’s address when there is no terminal to ask in; a running service saves it', async () => {
  const noUrl = await cli(['token', 'set']);
  assert.equal(noUrl.code, 1);
  assert.match(noUrl.err[0], /^Say Orbit’s address with --url <address>/);

  const posted = [];
  const r = await cli(['token', 'set', '--url', 'https://orbit.example.com'], {
    askSecret: async (q) => { assert.match(q, /it isn’t shown as you type/); return 'orb_abcdefghijklmnopqrstuvwxyz0123456789\n'; },
    running: () => ({ pid: 1, port: 4481, token: 'w' }),
    deps: { orbit: { normalizeOrbitUrl: (u) => u, checkToken: () => {}, MCP_NAME: 'orbit-feedback' } },
    fetch: async (url, init) => { posted.push([url, JSON.parse(init.body)]); return { ok: true, status: 200, json: async () => ({ ok: true }) }; },
  });
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(posted, [['http://127.0.0.1:4481/api/orbit/token', { token: 'orb_abcdefghijklmnopqrstuvwxyz0123456789', url: 'https://orbit.example.com' }]]);
  assert.match(r.out[0], /^Saved the Orbit token and wrote the orbit-feedback entry/);
  assert.doesNotMatch(r.text, /orb_abc/, 'the token is never printed');

  const refused = await cli(['token', 'set', '--url', 'https://o'], { askSecret: async () => 'short', deps: { orbit: { normalizeOrbitUrl: (u) => u, checkToken: () => { throw new Error('That isn’t an Orbit token.'); } } } });
  assert.equal(refused.code, 1);
  assert.equal(refused.err[0], 'That isn’t an Orbit token. Nothing was saved.');
});

test('open asks the running service for the job’s folder and opens it in the terminal and the editor', async () => {
  const opened = [];
  const r = await cli(['open', 'sample-job'], {
    running: () => ({ pid: 1, port: 4481, token: 'w' }),
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ available: true, root: '/w/sample', terminalApp: 'Terminal' }) }),
    deps: { platform: { openIn: async (kind, dir) => { opened.push([kind, dir]); return { ok: true }; } } },
  });
  assert.equal(r.code, 0);
  assert.deepEqual(opened, [['terminal', '/w/sample'], ['editor', '/w/sample']]);
  assert.deepEqual(r.out, ['Opened /w/sample in Terminal.', 'Opened /w/sample in VS Code.']);
});

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString();

test('repo add: not a repository is a plain error; with no ground-control.md it asks five questions and saves a profile', async () => {
  const notRepo = await cli(['repo', 'add', tmp('gc-cli-plain-')]);
  assert.equal(notRepo.code, 1);
  assert.equal(notRepo.err[0], 'That folder isn’t a git repository.');

  const repo = tmp('gc-cli-widgets-');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'remote', 'add', 'origin', 'git@github.com:acme/widgets.git');

  const quiet = await cli(['repo', 'add', repo]);
  assert.equal(quiet.code, 1);
  assert.match(quiet.err[0], /has no ground-control\.md\. Run this in a terminal to answer five questions/);

  const stateDir = tmp('gc-cli-state-');
  const questions = [];
  const answers = ['', '', 'npm run dev -- --port {port}', '4100-4110', 'none'];
  const r = await cli(['repo', 'add', repo], { stateDir, interactive: true, ask: async (q) => { questions.push(q); return answers[questions.length - 1]; } });
  assert.equal(r.code, 0, r.text);
  assert.equal(questions.length, 5);
  assert.match(questions[0], /GitHub name, as org\/repo \[acme\/widgets\]/, 'the suggestion comes from the origin remote');
  const file = path.join(stateDir, 'profiles', `${path.basename(repo)}.md`);
  assert.match(r.out.at(-1) ?? '', /Added /);
  assert.ok(r.text.includes(file));
  const saved = parseProfile(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.ok, true, saved.errors.join(' | '));
  assert.equal(saved.profile.github, 'acme/widgets');
  assert.deepEqual(fs.readdirSync(repo).filter((n) => n !== '.git'), [], 'the repository itself is not changed');
  assert.ok(fs.readFileSync(path.join(stateDir, 'repos.json'), 'utf8').includes(repo));

  const quote = await cli(['repo', 'add', repo], { stateDir: tmp('gc-cli-state-'), interactive: true, ask: async () => 'a"b' });
  assert.equal(quote.code, 1);
  assert.match(quote.err[0], /can’t have double quotes or line breaks/);
});

test('the five answers make a profile the profile reader accepts', () => {
  const text = profileFromAnswers({ name: 'Widgets', github: 'acme/widgets', worktree: '../widgets-{slug}', command: '', ports: '3001-3099', files: ['.env.local'] }, { date: new Date('2026-10-29T00:00:00Z') });
  const r = parseProfile(text);
  assert.equal(r.ok, true, r.errors.join(' | '));
  assert.equal(r.profile.name, 'Widgets');
  assert.match(text, /2026-10-29/);
});
