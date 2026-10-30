// The environment variables' new names and the old ones they replace (packet Y, decision G36):
// every old name, its new one, and that the old one still works while the new one is unset.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KEEP_OLD_TOO, OLD_NAMES, envOf, withOldNames } from '../lib/env-names.js';
import { stateDirFor } from '../lib/state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every old name and its new one', () => {
  assert.deepEqual(OLD_NAMES, {
    STARBASE_DIR: 'GROUND_CONTROL_DIR',
    STARBASE_USER: 'GROUND_CONTROL_USER',
    STARBASE_RELEASE_REPO: 'GROUND_CONTROL_RELEASE_REPO',
    STARBASE_ORBIT_URL: 'GROUND_CONTROL_ORBIT_URL',
    STARBASE_NO_SERVICE: 'GROUND_CONTROL_NO_SERVICE',
    STARBASE_FROM: 'GROUND_CONTROL_FROM',
    STARBASE_STATE_DIR: 'WORKSHOP_STATE_DIR',
    STARBASE_DEMO: 'WORKSHOP_DEMO',
    STARBASE_DEMO_NO_AUTO: 'WORKSHOP_DEMO_NO_AUTO',
    STARBASE_FEATURES_DIR: 'WORKSHOP_FEATURES_DIR',
    STARBASE_PROJECTS_DIR: 'WORKSHOP_PROJECTS_DIR',
    STARBASE_AGENTS_DIR: 'WORKSHOP_AGENTS_DIR',
    STARBASE_SKILLS_DIR: 'WORKSHOP_SKILLS_DIR',
    STARBASE_WALKTHROUGHS_DIR: 'WORKSHOP_WALKTHROUGHS_DIR',
    STARBASE_ORBIT_STORE: 'WORKSHOP_ORBIT_STORE',
    STARBASE_GH: 'WORKSHOP_GH',
    STARBASE_PLAYWRIGHT: 'WORKSHOP_PLAYWRIGHT',
    STARBASE_PLAN_USAGE: 'WORKSHOP_PLAN_USAGE',
    STARBASE_EXTRA_REPOS: 'WORKSHOP_EXTRA_REPOS',
    STARBASE_GATE_PARK_MS: 'WORKSHOP_GATE_PARK_MS',
    STARBASE_STACK_TICK_MS: 'WORKSHOP_STACK_TICK_MS',
    STARBASE_CLAUDE_SETTINGS: 'WORKSHOP_CLAUDE_SETTINGS',
    STARBASE_CLAUDE_PATH: 'WORKSHOP_CLAUDE_PATH',
    STARBASE_URL: 'WORKSHOP_URL',
  });
  assert.deepEqual(KEEP_OLD_TOO, ['STARBASE_FEATURES_DIR'], 'the /feature skill’s folder, for an older copy of the skill');
});

test('the code reads only names in the table, and none of the old ones outside it', () => {
  const read = execFileSync('git', ['-C', ROOT, 'grep', '-h', '-o', '-E', 'STARBASE_[A-Z][A-Z0-9_]*', '--', 'bin', 'dashboard', 'hosted', 'web/vite.config.ts', 'web/e2e', 'install.sh', 'install.ps1', '.github'], { encoding: 'utf8' });
  const names = [...new Set(read.split('\n').filter(Boolean))].sort();
  assert.ok(names.length > 10);
  for (const n of names) assert.ok(n in OLD_NAMES, `${n} is in OLD_NAMES`);
});

test('withOldNames: an old name fills its unset new one; a set new one wins; the old one is kept', () => {
  const env = withOldNames({ WORKSHOP_DEMO: '1', WORKSHOP_STATE_DIR: '/old/state', STARBASE_STATE_DIR: '/new/state', GROUND_CONTROL_USER: 'sam', STARBASE_GH: '' , WORKSHOP_GH: '/fake/gh' });
  assert.equal(env.STARBASE_DEMO, '1');
  assert.equal(env.STARBASE_STATE_DIR, '/new/state');
  assert.equal(env.WORKSHOP_STATE_DIR, '/old/state');
  assert.equal(env.STARBASE_USER, 'sam');
  assert.equal(env.STARBASE_GH, '/fake/gh', 'an empty new name counts as unset');
  for (const [now, was] of Object.entries(OLD_NAMES)) {
    assert.equal(withOldNames({ [was]: 'x' })[now], 'x', `${was} → ${now}`);
  }
});

test('withOldNames: the jobs folder is given to an older /feature skill under its old name too', () => {
  const env = withOldNames({ STARBASE_FEATURES_DIR: '/jobs' });
  assert.equal(env.WORKSHOP_FEATURES_DIR, '/jobs');
  assert.equal(withOldNames({ STARBASE_PROJECTS_DIR: '/p' }).WORKSHOP_PROJECTS_DIR, undefined, 'only the names in KEEP_OLD_TOO');
});

test('envOf reads the new name, else the old one', () => {
  assert.equal(envOf({ STARBASE_DEMO: '1', WORKSHOP_DEMO: '' }, 'STARBASE_DEMO'), '1');
  assert.equal(envOf({ WORKSHOP_DEMO: '1' }, 'STARBASE_DEMO'), '1');
  assert.equal(envOf({}, 'STARBASE_DEMO'), undefined);
});

test('the state folder by an old name still works', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'starbase-env-'));
  assert.equal(stateDirFor(withOldNames({ WORKSHOP_STATE_DIR: '/x/state' }), home), path.resolve('/x/state'));
  assert.equal(stateDirFor(withOldNames({ WORKSHOP_DEMO: '1', WORKSHOP_FEATURES_DIR: '/x/features' }), home), path.join(path.resolve('/x'), 'state'));
});

test('a program started with only the old names reads them (the server’s first import)', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(pathToFileURL(path.join(ROOT, 'dashboard/lib/env-boot.js')).href)}; console.log(process.env.STARBASE_DEMO, process.env.STARBASE_FEATURES_DIR);`], {
    encoding: 'utf8', env: { PATH: process.env.PATH, WORKSHOP_DEMO: '1', WORKSHOP_FEATURES_DIR: '/jobs' },
  });
  assert.equal(out.trim(), '1 /jobs');
});
