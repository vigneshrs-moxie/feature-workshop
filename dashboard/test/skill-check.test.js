// The stale-skill check (lib/skill-check.js) on temp folders only: never ~/.claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { hasLevelsTable, skillChecker } from '../lib/skill-check.js';

const OLD = '# Job options\n\n## Fields\n| Field | Meaning |\n|---|---|\n| `flow` | quick, small, large or auto |\n';
const NEW = `${OLD}\n## Levels\n\n| Level | Stages | Review lenses | Models |\n|---|---|---|---|\n| L0 Tweak | one build | none | Opus; Sonnet build |\n`;

async function skillsDir(text) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-skill-check-'));
  if (text !== null) {
    await fs.mkdir(path.join(dir, 'feature'), { recursive: true });
    await fs.writeFile(path.join(dir, 'feature', 'job-options.md'), text);
  }
  return dir;
}

test('skill check: the Levels table needs both its heading and its header row', () => {
  assert.equal(hasLevelsTable(NEW), true);
  assert.equal(hasLevelsTable(OLD), false);
  assert.equal(hasLevelsTable('## Levels\n\nSee the table elsewhere.\n'), false, 'a heading alone is not the table');
  assert.equal(hasLevelsTable('| Level | Stages |\n'), false, 'a table alone is not the section');
});

test('skill check: an installed skill from before levels reports levels false', async () => {
  const dir = await skillsDir(OLD);
  try {
    const r = await skillChecker(dir).check();
    assert.deepEqual(r, { installed: true, levels: false, path: path.join(dir, 'feature', 'job-options.md') });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('skill check: an up-to-date skill reports levels true, and an update is noticed', async () => {
  const dir = await skillsDir(OLD);
  try {
    const check = skillChecker(dir);
    assert.equal((await check.check()).levels, false);
    assert.equal((await check.check()).levels, false, 'cached while the file is unchanged');
    await fs.writeFile(path.join(dir, 'feature', 'job-options.md'), NEW);
    assert.equal((await check.check()).levels, true, 'a new size or time reads it again');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('skill check: no skill installed is not "out of date"', async () => {
  const dir = await skillsDir(null);
  try {
    const r = await skillChecker(dir).check();
    assert.equal(r.installed, false);
    assert.equal(r.levels, false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('skill check: a link to the file (as install.sh makes) is followed and only read', async () => {
  const src = await skillsDir(NEW);
  const dir = await skillsDir(null);
  try {
    await fs.mkdir(path.join(dir, 'feature'), { recursive: true });
    await fs.symlink(path.join(src, 'feature', 'job-options.md'), path.join(dir, 'feature', 'job-options.md'));
    const before = await fs.readFile(path.join(src, 'feature', 'job-options.md'), 'utf8');
    assert.equal((await skillChecker(dir).check()).levels, true);
    assert.equal(await fs.readFile(path.join(src, 'feature', 'job-options.md'), 'utf8'), before, 'unchanged');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(src, { recursive: true, force: true });
  }
});
