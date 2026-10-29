// `ground-control doctor` (packet I step 2, lib/doctor.js): each check found and missing, and the
// right fix line for each system. Everything doctor looks at is a fake here: no program is run, no
// port is touched and nothing is installed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { formatDoctor, installLine, linuxManager, playwrightDir, runDoctor } from '../lib/doctor.js';

const byId = (report) => Object.fromEntries(report.checks.map((c) => [c.id, c]));

/** A computer with these programs on PATH (by name), these files, and these commands' answers. */
function computer({ platform = 'darwin', programs = [], files = [], dirs = {}, answers = {}, home = platform === 'win32' ? 'C:\\Users\\sam' : '/home/sam' } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const binDir = platform === 'win32' ? 'C:\\tools' : '/usr/local/bin';
  // Windows file names don't care about case (PATHEXT gives .EXE).
  const norm = (f) => (platform === 'win32' ? f.toLowerCase() : f);
  const onPath = new Set(programs.map((n) => norm(p.join(binDir, platform === 'win32' ? `${n}.exe` : n))));
  const fileSet = new Set(files.map(norm));
  const env = platform === 'win32' ? { PATH: binDir, PATHEXT: '.EXE;.CMD', LOCALAPPDATA: 'C:\\Users\\sam\\AppData\\Local' } : { PATH: binDir };
  const calls = [];
  return {
    platform, home, env, calls,
    exists: (f) => onPath.has(norm(f)) || fileSet.has(norm(f)),
    readdir: async (d) => { if (dirs[d]) return dirs[d]; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    readFile: async (f) => { const hit = files.find((x) => x === f); if (hit && answers[`file ${f}`]) return answers[`file ${f}`]; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    run: async (file, args) => {
      calls.push([file, ...args]);
      const key = `${p.basename(file).replace(/\.exe$/i, '')} ${args.join(' ')}`;
      return answers[key] ?? { code: null, missing: true, stdout: '', stderr: '' };
    },
  };
}

const everything = (platform = 'darwin') => {
  const home = platform === 'win32' ? 'C:\\Users\\sam' : '/home/sam';
  const p = platform === 'win32' ? path.win32 : path.posix;
  const claudeJson = p.join(home, '.claude.json');
  const c = computer({
    platform, home,
    programs: ['git', 'gh', 'claude', 'psql'],
    files: [claudeJson],
    dirs: { [playwrightDir({ platform, home, env: platform === 'win32' ? { LOCALAPPDATA: 'C:\\Users\\sam\\AppData\\Local' } : {} })]: ['chromium-1194', 'ffmpeg-1011'] },
    answers: {
      'git --version': { code: 0, stdout: 'git version 2.47.0\n', stderr: '' },
      'gh auth status': { code: 0, stdout: '', stderr: 'github.com\n  ✓ Logged in to github.com account sam-moxie (keyring)\n' },
      [`file ${claudeJson}`]: JSON.stringify({ oauthAccount: { accountUuid: 'u-1', emailAddress: 'sam@example.com' } }),
    },
  });
  return c;
};

const options = (c, extra = {}) => ({
  platform: c.platform, env: c.env, home: c.home, run: c.run, exists: c.exists, readdir: c.readdir, readFile: c.readFile,
  nodeVersion: '22.11.0', portInUse: async () => false, service: null,
  serviceCheck: async () => ({ installed: true, running: true }), tokenSaved: async () => true, isAdmin: async () => true,
  ...extra,
});

test('everything found: every check is OK and no fix is given', async () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const c = everything(platform);
    const report = await runDoctor(options(c));
    const bad = report.checks.filter((x) => !x.ok);
    assert.deepEqual(bad.map((x) => `${x.id}: ${x.found}`), [], platform);
    assert.equal(report.ok, true);
    assert.ok(report.checks.every((x) => x.fix === null));
    const ids = report.checks.map((x) => x.id);
    assert.deepEqual(ids.slice(0, 11), ['node', 'git', 'gh', 'gh-auth', 'claude', 'claude-login', 'playwright', 'postgres', 'orbit-token', 'port-4477', 'port-4478']);
    assert.equal(ids.includes('admin'), platform === 'win32', 'admin rights are checked on Windows only');
    const r = byId(report);
    assert.equal(r['gh-auth'].found, 'signed in as sam-moxie');
    assert.match(r.git.found, /2\.47\.0/);
  }
});

test('Windows with nothing: winget lines, and the service check says why there is no service', async () => {
  const c = computer({ platform: 'win32' });
  const report = await runDoctor(options(c, {
    nodeVersion: '20.11.1', tokenSaved: async () => false, isAdmin: async () => false,
    serviceCheck: async () => ({ installed: false, running: null }),
  }));
  const r = byId(report);
  assert.equal(report.ok, false);
  assert.equal(r.node.fix, 'winget install -e --id OpenJS.NodeJS.LTS');
  assert.equal(r.node.found, 'Node 20.11.1');
  assert.equal(r.git.fix, 'winget install -e --id Git.Git');
  assert.equal(r.gh.fix, 'winget install -e --id GitHub.cli');
  assert.equal(r.postgres.fix, 'winget install -e --id PostgreSQL.PostgreSQL');
  assert.equal(r['gh-auth'].fix, 'gh auth login');
  assert.equal(r['gh-auth'].found, 'GitHub CLI isn’t installed yet');
  assert.equal(r.claude.fix, 'npm install -g @anthropic-ai/claude-code');
  assert.equal(r.playwright.fix, 'npx playwright install chromium');
  assert.equal(r.playwright.needed, false, 'only a warning until packet L');
  assert.equal(r['orbit-token'].fix, 'ground-control token set');
  assert.match(r.service.found, /no administrator rights/);
  assert.match(r.service.fix, /^ground-control start --here/);
  assert.equal(r.admin.ok, false);
  assert.equal(r.admin.found, 'no');
  assert.match(r.admin.fix, /Run as administrator/);
  for (const id of ['node', 'git', 'gh', 'gh-auth', 'claude', 'postgres', 'playwright']) assert.equal(r[id].runnable, true, `${id}'s fix can be offered by the installer`);
  for (const id of ['claude-login', 'orbit-token', 'service', 'admin']) assert.equal(r[id].runnable, false, `${id}'s fix is not a line to run blind`);
  assert.ok(!c.calls.some(([file]) => /winget|npm|brew/.test(file)), 'doctor never installs anything itself');
});

test('macOS with nothing: brew lines', async () => {
  const c = computer({ platform: 'darwin' });
  const r = byId(await runDoctor(options(c, { serviceCheck: async () => ({ installed: false, running: false }) })));
  assert.equal(r.git.fix, 'brew install git');
  assert.equal(r.gh.fix, 'brew install gh');
  assert.equal(r.postgres.fix, 'brew install postgresql@17');
  assert.equal(r.node.ok, true);
  assert.match(r.service.fix, /^ground-control install/);
  assert.equal(r.service.found, 'not installed');
});

test('Linux: the lines are for the package manager this computer has', async () => {
  const dnf = computer({ platform: 'linux', programs: ['dnf'] });
  const r = byId(await runDoctor(options(dnf, { nodeVersion: '18.19.0' })));
  assert.equal(r.node.fix, 'sudo dnf install -y nodejs');
  assert.equal(r.git.fix, 'sudo dnf install -y git');
  assert.equal(r.postgres.fix, 'sudo dnf install -y postgresql-server postgresql');
  assert.equal(linuxManager({ env: { PATH: '/usr/bin' }, exists: (f) => f === '/usr/bin/pacman' }), 'pacman');
  assert.equal(installLine('gh', { platform: 'linux', manager: 'pacman' }), 'sudo pacman -S github-cli');
  assert.equal(linuxManager({ env: { PATH: '/nowhere' }, exists: () => false }), 'apt-get', 'apt-get when none is found');
  assert.equal(installLine('git', { platform: 'linux' }), 'sudo apt-get install -y git');
});

test('GitHub CLI there but signed out, and Claude Code there but signed out', async () => {
  const c = computer({ platform: 'darwin', programs: ['gh', 'claude'], answers: { 'gh auth status': { code: 1, stdout: '', stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login' } } });
  const r = byId(await runDoctor(options(c)));
  assert.equal(r.gh.ok, true);
  assert.equal(r['gh-auth'].ok, false);
  assert.equal(r['gh-auth'].found, 'not signed in');
  assert.equal(r['gh-auth'].fix, 'gh auth login');
  assert.equal(r.claude.ok, true);
  assert.equal(r['claude-login'].ok, false);
  assert.match(r['claude-login'].fix, /\/login/);

  const keyed = byId(await runDoctor(options({ ...c, env: { ...c.env, ANTHROPIC_API_KEY: 'sk-x' } })));
  assert.equal(keyed['claude-login'].ok, true, 'a key in the environment counts as signed in');
});

test('ports: free, Ground Control’s own, or another program’s (with the line that shows which)', async () => {
  const c = everything('darwin');
  const busy = async () => true;
  let r = byId(await runDoctor(options(c, { portInUse: busy, service: { port: 4477, pid: 321 } })));
  assert.equal(r['port-4477'].ok, true);
  assert.equal(r['port-4477'].found, 'used by Ground Control (pid 321)');
  assert.equal(r['port-4478'].ok, true, 'its screens page is the next port');
  r = byId(await runDoctor(options(c, { portInUse: async (p) => p === 4477, service: null })));
  assert.equal(r['port-4477'].ok, false);
  assert.equal(r['port-4477'].found, 'in use by another program');
  assert.match(r['port-4477'].fix, /^lsof -nP -iTCP:4477 -sTCP:LISTEN/);
  assert.equal(r['port-4478'].ok, true);
  const w = byId(await runDoctor(options(everything('win32'), { portInUse: busy, service: null })));
  assert.match(w['port-4478'].fix, /^netstat -ano \| findstr :4478/);
});

test('the service: installed and running, installed and stopped, not installed', async () => {
  const c = everything('linux');
  let r = byId(await runDoctor(options(c, { serviceCheck: async () => ({ installed: true, running: false }) })));
  assert.equal(r.service.found, 'installed, not running');
  assert.equal(r.service.fix, 'ground-control start');
  r = byId(await runDoctor(options(c, { serviceCheck: async () => ({ installed: true, running: null }), service: { port: 4477, pid: 9 } })));
  assert.equal(r.service.ok, true, 'running: service.json says so where the manager can’t');
  r = byId(await runDoctor(options(everything('win32'), { serviceCheck: async () => ({ installed: true, running: null }), service: { port: 4477, pid: 9 }, isAdmin: async () => false })));
  assert.equal(r.admin.ok, true, 'no admin rights needed once the service is installed');
});

test('postgres in the usual folders counts, not only on PATH', async () => {
  const c = computer({ platform: 'win32', dirs: { 'C:\\Program Files\\PostgreSQL': ['16'] }, files: ['C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe'] });
  const r = byId(await runDoctor(options({ ...c, env: { ...c.env, ProgramFiles: 'C:\\Program Files' } })));
  assert.equal(r.postgres.ok, true);
  assert.equal(r.postgres.found, 'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe');
});

test('the report in words: OK, MISSING or WARNING on every line, never colour alone', async () => {
  const c = computer({ platform: 'darwin', programs: ['git'] , answers: { 'git --version': { code: 0, stdout: 'git version 2.40.0', stderr: '' } } });
  const lines = formatDoctor(await runDoctor(options(c, { tokenSaved: async () => false })));
  assert.equal(lines[0], 'Ground Control doctor (macOS)');
  assert.ok(lines.some((l) => /^ {2}OK {7}Git/.test(l)));
  assert.ok(lines.some((l) => /^ {2}MISSING {2}GitHub CLI /.test(l)));
  assert.ok(lines.some((l) => /^ {2}WARNING {2}Orbit token saved/.test(l)));
  assert.ok(lines.some((l) => /Fix: brew install gh$/.test(l)));
  assert.match(lines.at(-1), /missing and \d+ warnings\. Doctor never installs anything itself/);
  assert.ok(!lines.join('\n').includes('\u001b['), 'no colour codes');
});
