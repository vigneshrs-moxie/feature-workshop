import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { Registry, BUNDLED_DIR, REPOS_FILE, recentRepos, reposDoor } from '../lib/repos.js';
import { PROFILE_FILE } from '../lib/profile.js';

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
  assert.deepEqual(await reg.orgs(), [{ remote: 'moxie', org: 'Moxie-Pest-Control-Phoenix' }]);

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
