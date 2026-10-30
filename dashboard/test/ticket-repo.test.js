// Packet 2C: a ticket's Start from the hosted site names no folder, so the runner picks the
// repository (lib/repos.js ticketRepo): the one registered for Orbit, else the only one; never a guess.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Registry, ticketRepo } from '../lib/repos.js';

const g = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString();

async function repo(root, name, remote) {
  const dir = path.join(root, name);
  await fs.mkdir(dir);
  g(dir, 'init', '-q', '-b', 'main');
  g(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'start');
  g(dir, 'remote', 'add', 'origin', remote);
  return dir;
}

const profile = (name) => `---\nname: ${name}\ngithub: acme/${name.toLowerCase()}\nremotes:\n  fork: origin\n  org: upstream\n---\n`;

test('ticketRepo: the registered Orbit repository; else the only one; none, or several that aren’t Orbit, is null', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-ticket-repo-')));
  try {
    const orbit = await repo(root, 'moxie-portal', 'https://github.com/Moxie-Pest-Control-Phoenix/moxie-portal.git');
    const widgets = await repo(root, 'widgets', 'git@github.com:acme/widgets.git');
    const gadgets = await repo(root, 'gadgets', 'git@github.com:acme/gadgets.git');
    for (const n of ['Widgets', 'Gadgets']) await fs.writeFile(path.join(root, `${n}.md`), profile(n));
    const reg = new Registry({ dir: path.join(root, 'state') });
    assert.equal(await ticketRepo(reg), null, 'nothing registered');
    assert.equal(await ticketRepo(null), null);

    assert.equal((await reg.addRepo(widgets, { profileFile: path.join(root, 'Widgets.md') })).ok, true);
    assert.equal(await ticketRepo(reg), widgets, 'the only one');
    assert.equal((await reg.addRepo(gadgets, { profileFile: path.join(root, 'Gadgets.md') })).ok, true);
    assert.equal(await ticketRepo(reg), null, 'two, neither Orbit: not a guess');
    assert.equal((await reg.addRepo(orbit)).ok, true, 'Orbit’s bundled profile');
    assert.equal(await ticketRepo(reg), orbit);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
