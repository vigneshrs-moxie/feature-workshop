import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { Registry, BUNDLED_DIR, REPOS_FILE, recentRepos, reposDoor } from '../lib/repos.js';
import { PROFILE_FILE } from '../lib/profile.js';
import { ORG_REMOTES, ORG_URL, hardLine, setProfileOrgs } from '../lib/hard-lines.js';

const ORBIT_URL = 'https://github.com/Moxie-Pest-Control-Phoenix/moxie-portal.git';
const g = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString();

// A main checkout with remotes (no network: nothing is fetched), one commit, and a worktree next to it.
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-repos-')));
  const orbit = path.join(root, 'moxie-portal');
  const other = path.join(root, 'other');
  for (const dir of [orbit, other]) {
    await fs.mkdir(dir);
    g(dir, 'init', '-q', '-b', 'main');
    g(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'start');
  }
  g(orbit, 'remote', 'add', 'origin', 'https://github.com/someone/moxie-portal-fork.git');
  g(orbit, 'remote', 'add', 'moxie', ORBIT_URL);
  g(other, 'remote', 'add', 'origin', 'git@github.com:acme/widgets.git');
  const wt = path.join(root, 'orbit-orbit-7-x');
  g(orbit, 'worktree', 'add', '-q', '-b', 'feature/orbit-7-x', wt);
  return { root, orbit, other, wt, state: path.join(root, 'state') };
}

const profileText = (name, extra = '') => `---\nname: ${name}\ngithub: acme/widgets\nremotes:\n  fork: origin\n  org: upstream\ntryIt:\n  ports: 4100-4110\n${extra}---\nNotes.\n`;

test('registry: add, list, remove; a profile with errors is refused line by line', async () => {
  const fx = await fixture();
  const reg = new Registry({ dir: fx.state });
  assert.deepEqual(await reg.listRepos(), []);

  const none = await reg.addRepo(fx.other);
  assert.equal(none.ok, false);
  assert.match(none.errors[0], /has no ground-control\.md in its root/);
  assert.match((await reg.addRepo('relative/path')).errors[0], /full path/);
  assert.match((await reg.addRepo(path.join(fx.root, 'nope'))).errors[0], /doesn’t exist/);

  const bad = path.join(fx.root, 'bad.md');
  await fs.writeFile(bad, '---\nname: Widgets\ngithub: nope\ntryIt:\n  ports: 9\n---\n');
  const refused = await reg.addRepo(fx.other, { profileFile: bad });
  assert.equal(refused.ok, false);
  assert.equal(refused.errors.length, 2);
  assert.match(refused.errors[0], /^github must look like org\/repo/);
  assert.match(refused.errors[1], /^ports \(under tryIt\) must look like 3001-3099/);

  const good = path.join(fx.root, 'widgets.md');
  await fs.writeFile(good, profileText('Widgets'));
  const added = await reg.addRepo(path.join(fx.other, '.'), { profileFile: good });
  assert.equal(added.ok, true, added.errors?.join(' | '));
  assert.equal(added.repo.path, fx.other);
  assert.equal(added.repo.ports, '4100-4110');
  assert.equal(added.repo.profileSource, 'registry');
  assert.match((await reg.addRepo(fx.other, { profileFile: good })).errors[0], /already in the list/);

  // Orbit: no file of its own, so the bundled profile that names its GitHub repository is used.
  const orbit = await reg.addRepo(fx.orbit);
  assert.equal(orbit.ok, true, orbit.errors?.join(' | '));
  assert.equal(orbit.repo.name, 'Orbit');
  assert.equal(orbit.repo.profileFile, path.join(BUNDLED_DIR, 'orbit.md'));

  const saved = JSON.parse(await fs.readFile(path.join(fx.state, REPOS_FILE), 'utf8'));
  assert.deepEqual(saved, [
    { path: fx.other, github: 'acme/widgets', profile: good },
    { path: fx.orbit, github: 'Moxie-Pest-Control-Phoenix/moxie-portal', profile: 'profiles/orbit.md' },
  ]);
  const list = await reg.listRepos();
  assert.deepEqual(list.map((r) => [r.name, r.github, r.ports, r.ok]), [['Widgets', 'acme/widgets', '4100-4110', true], ['Orbit', 'Moxie-Pest-Control-Phoenix/moxie-portal', '3001-3099', true]]);

  assert.equal((await reg.removeRepo(fx.other)).ok, true);
  assert.match((await reg.removeRepo(fx.other)).errors[0], /isn’t in the list/);
  assert.deepEqual((await reg.listRepos()).map((r) => r.name), ['Orbit']);
  assert.deepEqual(await reg.orgs(), [{ remote: 'moxie', fork: 'origin', org: 'Moxie-Pest-Control-Phoenix' }]);

  // A broken repos.json: nothing is changed, and the page is told which file.
  await fs.writeFile(path.join(fx.state, REPOS_FILE), '{ not json');
  assert.equal((await reg.list()).unreadable, path.join(fx.state, REPOS_FILE));
  assert.match((await reg.addRepo(fx.other, { profileFile: good })).errors[0], /can’t be read, so nothing was changed/);
  await fs.rm(fx.root, { recursive: true, force: true });
});

test('registry: repoFor finds the repository from a worktree or a folder inside it; its own ground-control.md wins', async () => {
  const fx = await fixture();
  const reg = new Registry({ dir: fx.state });
  assert.equal((await reg.addRepo(fx.orbit)).ok, true);
  assert.equal((await reg.repoFor(fx.wt))?.path, fx.orbit, 'a worktree of it');
  await fs.mkdir(path.join(fx.wt, 'app', 'src'), { recursive: true });
  assert.equal((await reg.repoFor(path.join(fx.wt, 'app', 'src')))?.path, fx.orbit, 'a folder in the worktree');
  assert.equal((await reg.repoFor(path.join(fx.orbit, 'docs')))?.path, fx.orbit, 'a folder in the checkout');
  assert.equal(await reg.repoFor(fx.other), null);

  const hit = await reg.profileFor(fx.wt);
  assert.equal(hit.ok, true);
  assert.equal(hit.source, 'registry');
  assert.equal(hit.profile.name, 'Orbit');
  assert.equal(await reg.worktreeFor(fx.orbit, 'orbit-7-x'), fx.wt, 'the worktree is where the profile says');
  assert.equal(await reg.worktreeFor(fx.other, 'x'), path.join(fx.root, 'orbit-x'), 'no profile: the general case');

  await fs.writeFile(path.join(fx.orbit, PROFILE_FILE), profileText('Orbit, its own'));
  const own = await reg.profileFor(fx.wt);
  assert.equal(own.source, 'repo');
  assert.equal(own.profile.name, 'Orbit, its own');
  assert.equal((await reg.listRepos())[0].profileSource, 'repo');

  // An unregistered repository that carries its own file still has a profile (not on the list).
  await fs.writeFile(path.join(fx.other, PROFILE_FILE), profileText('Widgets'));
  const loose = await reg.profileFor(fx.other);
  assert.equal(loose.repo, null);
  assert.equal(loose.profile.name, 'Widgets');
  await fs.rm(fx.root, { recursive: true, force: true });
});

test('registry: on a first start Orbit is registered from the recent repositories, once; a removed one stays removed', async () => {
  const fx = await fixture();
  const reg = new Registry({ dir: fx.state });
  const sessionIndex = { allSessions: async () => [{ parsed: { cwd: fx.wt, lastAt: '2026-10-28T10:00:00Z' } }, { parsed: { cwd: fx.other, lastAt: '2026-10-27T10:00:00Z' } }] };
  const door = reposDoor(reg, { recent: () => recentRepos(sessionIndex, [], { registry: reg }) });
  const first = await door.list();
  assert.deepEqual(first.repos.map((r) => [r.path, r.name]), [[fx.orbit, 'Orbit']]);
  assert.equal(first.unreadable, null);
  // recentRepos marks which ones are registered (the worktree's checkout is its own top here).
  const recent = await recentRepos({ allSessions: async () => [{ parsed: { cwd: fx.orbit } }, { parsed: { cwd: fx.other } }] }, [], { registry: reg });
  assert.deepEqual(recent.map((r) => [path.basename(r.path), r.registered]), [['moxie-portal', true], ['other', false]]);

  assert.equal((await door.remove(fx.orbit)).ok, true);
  assert.deepEqual((await door.list()).repos, [], 'not registered again: it is no longer a first start');
  assert.deepEqual(await reg.seed([fx.orbit]), []);
  await fs.rm(fx.root, { recursive: true, force: true });
});

test('registry: with no list yet, the first look at an Orbit job registers Orbit on the way; another repository leaves no list', async () => {
  const fx = await fixture();
  const reg = new Registry({ dir: fx.state });
  assert.equal(await reg.profileFor(fx.other), null);
  await assert.rejects(fs.stat(path.join(fx.state, REPOS_FILE)), 'nothing written for a repository no profile names');
  const hit = await reg.profileFor(fx.wt);
  assert.equal(hit?.profile?.name, 'Orbit');
  assert.deepEqual((await reg.entries()).map((e) => e.path), [fx.orbit]);
  await fs.rm(fx.root, { recursive: true, force: true });
});

test('registry: a profile file that changes is read again on the next use, with no restart', async () => {
  const fx = await fixture();
  const reg = new Registry({ dir: fx.state });
  const file = path.join(fx.root, 'widgets.md');
  await fs.writeFile(file, profileText('Widgets'));
  assert.equal((await reg.addRepo(fx.other, { profileFile: file })).ok, true);
  assert.deepEqual((await reg.profileFor(fx.other)).profile.tryIt.ports, { first: 4100, last: 4110 });
  assert.equal((await reg.profileFor(fx.other)).profile, (await reg.profileFor(fx.other)).profile, 'unchanged: the same reading, not read again');

  await fs.writeFile(file, profileText('Widgets').replace('4100-4110', '4200-4299'));
  const later = new Date(Date.now() + 5000);
  await fs.utimes(file, later, later);
  assert.deepEqual((await reg.profileFor(fx.other)).profile.tryIt.ports, { first: 4200, last: 4299 });

  await fs.writeFile(file, profileText('Widgets').replace('4100-4110', 'soon'));
  const laterStill = new Date(Date.now() + 10000);
  await fs.utimes(file, laterStill, laterStill);
  const broken = await reg.profileFor(fx.other);
  assert.equal(broken.ok, false);
  assert.match(broken.errors[0], /ports \(under tryIt\) must look like 3001-3099/);
  assert.equal((await reg.listRepos())[0].ok, false);
  assert.match((await reg.checkProfile({ path: fx.other })).errors[0], /must look like 3001-3099/);
  assert.equal((await reg.checkProfile({ profileFile: path.join(BUNDLED_DIR, 'orbit.md') })).ok, true);
  await fs.rm(fx.root, { recursive: true, force: true });
});

test('hard lines: moxie and github.com/moxie… are a floor that never goes; each registered profile adds its org remote and GitHub org', async () => {
  const fx = await fixture();
  const reg = new Registry({ dir: fx.state });
  const file = path.join(fx.root, 'widgets.md');
  await fs.writeFile(file, profileText('Widgets'));
  setProfileOrgs([]); // what the tests above registered
  assert.equal(ORG_URL.test('https://github.com/acme/widgets.git'), false);
  assert.equal((await reg.addRepo(fx.other, { profileFile: file })).ok, true);
  await reg.refreshHardLines();
  assert.deepEqual(ORG_REMOTES, ['moxie', 'upstream']);
  assert.equal(ORG_URL.test('git@github.com:acme/widgets.git'), true);
  assert.equal(ORG_URL.test('https://github.com/Moxie-Pest-Control-Phoenix/moxie-portal.git'), true, 'the floor');
  assert.equal(ORG_URL.test('https://github.com/someone/widgets.git'), false, 'a fork is not the org');
  assert.ok(ORG_URL instanceof RegExp);
  assert.equal(hardLine('Bash', { command: 'git push upstream feature/x' })?.decision, 'deny');
  assert.equal(hardLine('Bash', { command: 'git push https://github.com/acme/widgets.git feature/x' })?.decision, 'deny');
  assert.equal(hardLine('Bash', { command: 'git push origin feature/x' })?.decision, 'ask');

  // A name a profile uses for its fork is never taken as an org remote; the floor stays when the list empties.
  setProfileOrgs([{ remote: 'origin', fork: 'origin', org: null }, { remote: 'moxie', fork: 'mine', org: 'x' }]);
  assert.deepEqual(ORG_REMOTES, ['moxie']);
  assert.equal((await reg.removeRepo(fx.other)).ok, true);
  await reg.refreshHardLines();
  assert.deepEqual(ORG_REMOTES, ['moxie']);
  assert.equal(ORG_URL.test('git@github.com:acme/widgets.git'), false);
  assert.equal(ORG_URL.test('git@github.com:moxie-pest-control-phoenix/moxie-portal.git'), true);
  assert.equal(hardLine('Bash', { command: 'git push moxie feature/x' })?.decision, 'deny');
  await fs.rm(fx.root, { recursive: true, force: true });
});

test('Try it reads the profile: Orbit as before (app/, 3001 on, the same command, app/.env.local); another profile its own folder, ports, command and files', async () => {
  const { LocalRunner } = await import('../lib/local.js');
  const { State } = await import('../lib/state.js');
  const fx = await fixture();
  // Orbit: app/ with a Next.js dev script and a settings file in the main checkout.
  for (const dir of [fx.orbit, fx.wt]) {
    await fs.mkdir(path.join(dir, 'app'), { recursive: true });
    await fs.writeFile(path.join(dir, 'app', 'package.json'), JSON.stringify({ scripts: { dev: 'next dev --turbopack' } }));
  }
  await fs.writeFile(path.join(fx.orbit, 'app', '.env.local'), 'AUTH_URL=http://localhost:3000\nDEV_BYPASS_AUTH=false\nDATABASE_URL=postgres://u@localhost:5432/orbit\n');
  await fs.writeFile(path.join(fx.wt, '.gitignore'), '.env*\n');
  const state = new State(fx.state);
  const local = new LocalRunner({ state });
  assert.equal(local.registry.dir, fx.state, 'the state folder’s registry');
  const f = { slug: 'orbit-7-x', title: 'X', worktree: fx.wt, repoPath: fx.orbit, branch: 'feature/orbit-7-x' };
  const w = await local.where(f);
  assert.equal(w.profile?.name, 'Orbit', 'registered on the way: a first start');
  assert.equal(w.app.rel, 'app');
  assert.deepEqual(w.files.map((x) => [x.from, x.to]), [['app/.env.local', 'app/.env.local']]);
  const port = await local.portFor(f.slug);
  assert.ok(port >= 3001 && port <= 3099);
  const r = await local.setupEnv(f);
  assert.deepEqual(r.changed.sort(), ['AUTH_URL', 'DEV_BYPASS_AUTH']);
  const written = await fs.readFile(path.join(fx.wt, 'app', '.env.local'), 'utf8');
  assert.match(written, new RegExp(`^AUTH_URL=http://localhost:${port}$`, 'm'));
  assert.match(written, /^DEV_BYPASS_AUTH=true$/m);
  assert.equal((await local.envStatus(w, port)).file, 'app/.env.local');
  assert.equal((await local.envStatus(w, port)).ready, true);

  const demo = new LocalRunner({ state, demo: true });
  const started = await demo.startServer(f);
  assert.equal(started.command, `npm run dev -- -p ${started.port} -H 127.0.0.1`, 'the command Try it ran for Orbit before');
  assert.equal(started.url, `http://localhost:${started.port}`);

  // Another repository with a profile of its own: web/, ports 4100-4110, its command, its file and keys.
  const wt2 = path.join(fx.root, 'widgets-wt');
  g(fx.other, 'worktree', 'add', '-q', '-b', 'feature/w', wt2);
  for (const dir of [fx.other, wt2]) {
    await fs.mkdir(path.join(dir, 'web'), { recursive: true });
    await fs.writeFile(path.join(dir, 'web', 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
  }
  await fs.writeFile(path.join(fx.other, 'web', '.env'), 'PUBLIC_URL=http://127.0.0.1:5173/\nSKIP_LOGIN=no\nAUTH_URL=http://localhost:1\n');
  await fs.writeFile(path.join(wt2, '.gitignore'), '.env\n');
  await fs.writeFile(path.join(fx.other, PROFILE_FILE), profileText('Widgets', 'filesToCopy:\n  - from: web/.env\n    to: web/.env\n    portKeys:\n      - PUBLIC_URL\n    signInSkip: SKIP_LOGIN\n').replace('tryIt:\n', 'tryIt:\n  app: web\n  command: "npm start -- --port {port}"\n  url: "http://127.0.0.1:{port}/"\n'));
  assert.equal((await local.registry.addRepo(fx.other)).ok, true);
  const g2 = { slug: 'w', title: 'W', worktree: wt2, repoPath: fx.other, branch: 'feature/w' };
  const w2 = await local.where(g2);
  assert.equal(w2.app.rel, 'web');
  const p2 = await local.portFor('w');
  assert.ok(p2 >= 4100 && p2 <= 4110, `port ${p2} is in the profile’s range`);
  const r2 = await local.setupEnv(g2);
  assert.deepEqual(r2.changed.sort(), ['PUBLIC_URL', 'SKIP_LOGIN'], 'only the profile’s keys: AUTH_URL is left alone');
  const env2 = await fs.readFile(path.join(wt2, 'web', '.env'), 'utf8');
  assert.match(env2, new RegExp(`^PUBLIC_URL=http://127.0.0.1:${p2}/$`, 'm'));
  assert.match(env2, /^AUTH_URL=http:\/\/localhost:1$/m);
  const s2 = await demo.startServer(g2);
  assert.equal(s2.command, `npm start -- --port ${s2.port}`);
  assert.equal(s2.url, `http://127.0.0.1:${s2.port}/`);

  // A job in a repository with no profile: the general case, and where() says there is no profile.
  const loose = { slug: 'loose', worktree: wt2, repoPath: path.join(fx.root, 'not-a-repo') };
  const w3 = await local.where(loose);
  assert.equal(w3.profile, null);
  assert.ok((await local.portFor('loose')) >= 3001);
  await fs.rm(fx.root, { recursive: true, force: true });
});

test('a full port range: an older job’s port it isn’t using is handed on; otherwise a plain error', async () => {
  const { LocalRunner } = await import('../lib/local.js');
  const { State } = await import('../lib/state.js');
  const fx = await fixture();
  const state = new State(fx.state);
  await fs.writeFile(path.join(fx.other, PROFILE_FILE), profileText('Widgets').replace('4100-4110', '4100-4101'));
  const local = new LocalRunner({ state, demo: true });
  assert.equal((await local.registry.addRepo(fx.other)).ok, true);
  const job = (slug) => ({ slug, worktree: fx.other, repoPath: fx.other });
  for (const s of ['a', 'b']) await local.where(job(s));
  assert.deepEqual([await local.portFor('a'), await local.portFor('b')], [4100, 4101]);
  await local.startServer(job('a'));
  await local.where(job('c'));
  assert.equal(await local.portFor('c'), 4101, 'b isn’t running, so its port goes to c');
  await local.startServer(job('c'));
  await local.where(job('d'));
  await assert.rejects(local.portFor('d'), /Every port from 4100 to 4101 is taken, so this job has none/);
  await fs.rm(fx.root, { recursive: true, force: true });
});

test('ticket slugs and branches fill the profile’s patterns; the flow map takes the org’s GitHub name from the profile', async () => {
  const { ticketSlug, ticketBranch } = await import('../lib/options.js');
  const { loadProfile } = await import('../lib/profile.js');
  const { gatherRepo } = await import('../lib/flow.js');
  const orbit = (await loadProfile(path.join(BUNDLED_DIR, 'orbit.md'))).profile;
  const t = { key: 'ORBIT-479', title: 'Feedback API and MCP' };
  assert.equal(ticketSlug(t, orbit), 'orbit-479-feedback-api-and-mcp');
  assert.equal(ticketSlug(t, orbit), ticketSlug(t), 'Orbit’s profile and the general case agree');
  assert.equal(ticketBranch('bug', 'orbit-479-x', { profile: orbit }), 'fix/orbit-479-x');
  const other = { slug: 'w{n}-{title}', branch: 'work/{kind}/{n}', kinds: { feature: 'feat', bug: 'bugfix' } };
  assert.equal(ticketSlug(t, other), 'w479-feedback-api-and-mcp');
  assert.equal(ticketBranch('feature', 'w479', { profile: other, ticket: t }), 'work/feat/479');

  const calls = [];
  const remotes = 'up\thttps://github.com/acme/widgets.git (push)\nmine\thttps://github.com/me/widgets.git (push)\n';
  const fakeGit = async (dir, args) => (args[0] === 'remote' ? { ok: true, out: remotes } : { ok: false, out: '' });
  const facts = await gatherRepo({
    repo: '/r', jobs: [], fetch: true, git: fakeGit,
    gh: async (args) => { calls.push(args); return { ok: true, out: '[]' }; },
    profileFor: async () => ({ github: 'acme/widgets-renamed', remotes: { org: 'up', fork: 'mine' } }),
  });
  assert.equal(calls[0][calls[0].indexOf('--repo') + 1], 'acme/widgets-renamed');
  assert.equal(facts.org?.remote ?? null, 'up');
});
