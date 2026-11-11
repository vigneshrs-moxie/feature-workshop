// The runner's Start as the website sends it: a repository named in the command is matched by this
// laptop itself. A name it doesn't know is a 400 in words and no job is made. Temp folders only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunner } from '../runner/index.js';

const DASH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a start from the website naming a repository this laptop does not have answers 400 and starts no job', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starbase-site-start-'));
  const dirs = Object.fromEntries(['claude', 'features', 'projects', 'agents', 'skills', 'state'].map((n) => [n, path.join(root, n)]));
  for (const d of Object.values(dirs)) await fs.mkdir(d);
  const runner = await createRunner({
    host: '127.0.0.1', port: 1, token: 't', dashboardDir: DASH, claudeDir: dirs.claude, featuresDir: dirs.features, projectsDir: dirs.projects,
    agentsDir: dirs.agents, skillsDir: dirs.skills, stateDir: dirs.state, demo: true, claudePath: null,
    claudeSettingsFile: path.join(root, 'claude.json'), legacySettingsFile: null, planUsage: false, orbitStore: 'file',
    integrateDir: dirs.state, integrateRoot: path.join(DASH, '..'), siteLink: false, env: {},
  });
  try {
    await assert.rejects(
      runner.handle({ type: 'start', description: 'Tidy the visit notes', repo: 'nope' }, { from: 'site' }),
      (err) => err.status === 400 && /^This laptop doesn't have a repository called "nope"/.test(err.message),
    );
    assert.deepEqual(await fs.readdir(dirs.features), [], 'no job folder was made');
  } finally {
    runner.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});
