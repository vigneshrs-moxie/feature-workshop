import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { envValue, setEnvKeys, envChanges, LocalRunner } from '../lib/local.js';
import { State } from '../lib/state.js';

test('local settings file: reads and edits only the keys it means to', () => {
  const text = 'A=1\nexport AUTH_URL="http://localhost:3000"\n# comment\nDEV_BYPASS_AUTH=false # off\nDATABASE_URL=postgres://u:p@localhost:5432/db\n';
  assert.equal(envValue(text, 'AUTH_URL'), 'http://localhost:3000');
  assert.equal(envValue(text, 'DEV_BYPASS_AUTH'), 'false');
  assert.equal(envValue(text, 'MISSING'), null);
  const { values, notes } = envChanges(text, 3002);
  assert.deepEqual(values, { AUTH_URL: 'http://localhost:3002', DEV_BYPASS_AUTH: 'true' }, 'the database address keeps its own port');
  assert.deepEqual(notes, []);
  const out = setEnvKeys(text, { ...values, NEW_KEY: 'x' });
  assert.match(out, /^export AUTH_URL=http:\/\/localhost:3002$/m);
  assert.match(out, /^DEV_BYPASS_AUTH=true$/m);
  assert.match(out, /^DATABASE_URL=postgres:\/\/u:p@localhost:5432\/db$/m);
  assert.match(out, /^# comment$/m);
  assert.match(out, /^NEW_KEY=x$/m);
  assert.deepEqual(envChanges('AUTH_URL=https://orbit.example.com\n', 3001).values, {}, 'a real site is left alone');
});

test('local: finds the app folder, gives each job its own port, refuses unignored settings files', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-local-')));
  const repo = path.join(root, 'main');
  const wt = path.join(root, 'orbit-x');
  for (const dir of [repo, wt]) {
    await fs.mkdir(path.join(dir, 'app'), { recursive: true });
    await fs.writeFile(path.join(dir, 'app', 'package.json'), JSON.stringify({ scripts: { dev: 'next dev', check: 'true' } }));
  }
  await fs.writeFile(path.join(repo, 'app', '.env.local'), 'AUTH_URL=http://localhost:3000\nDEV_BYPASS_AUTH=false\n');
  execFileSync('git', ['-C', wt, 'init', '-q']);
  const local = new LocalRunner({ state: new State(path.join(root, 'state')) });
  const f = { slug: 'x', title: 'X', worktree: wt, repoPath: repo, branch: 'feature/x' };

  const w = await local.where(f);
  assert.equal(w.app.dir, path.join(wt, 'app'));
  assert.equal(w.mainApp, path.join(repo, 'app'));
  assert.ok(local.presets(w).some((p) => p.id === 'check'));
  const port = await local.portFor('x');
  assert.ok(port >= 3001);
  assert.equal(await local.portFor('x'), port, 'the same job keeps its port');
  assert.notEqual(await local.portFor('y'), port, 'another job gets another port');

  await assert.rejects(local.setupEnv(f), /isn’t ignored by git/);
  await fs.writeFile(path.join(wt, '.gitignore'), '.env*\n');
  const r = await local.setupEnv(f);
  assert.equal(r.copied, true);
  const written = await fs.readFile(path.join(wt, 'app', '.env.local'), 'utf8');
  assert.match(written, new RegExp(`AUTH_URL=http://localhost:${port}`));
  assert.match(written, /DEV_BYPASS_AUTH=true/);
  assert.match(await fs.readFile(path.join(repo, 'app', '.env.local'), 'utf8'), /localhost:3000/, 'the main folder’s file is untouched');
  assert.equal((await local.view(f)).env.ready, true);

  assert.equal((await local.where({ slug: 'z' })).reason.includes('no worktree'), true);
  await fs.rm(root, { recursive: true, force: true });
});
