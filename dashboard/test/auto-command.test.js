// The auto command on the laptop: whatever a body carries, the audit line for turning Auto on says
// the person did it (by: 'you'), never Auto. Real runner on temp folders; no model is called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunner } from '../runner/index.js';

const DASH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('an auto command whose body says by: auto is refused or recorded as you, never as Auto', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sb-auto-cmd-')));
  const dirs = Object.fromEntries(['claude', 'features', 'projects', 'agents', 'skills', 'state'].map((n) => [n, path.join(root, n)]));
  for (const d of Object.values(dirs)) await fs.mkdir(d);
  await fs.mkdir(path.join(dirs.features, 'a-job'));
  const runner = await createRunner({
    host: '127.0.0.1', port: 1, token: 't', dashboardDir: DASH, claudeDir: dirs.claude, featuresDir: dirs.features, projectsDir: dirs.projects,
    agentsDir: dirs.agents, skillsDir: dirs.skills, stateDir: dirs.state, demo: true, claudePath: null,
    claudeSettingsFile: path.join(root, 'claude.json'), legacySettingsFile: null, planUsage: false, orbitStore: 'file',
    integrateDir: dirs.state, integrateRoot: path.join(DASH, '..'), siteLink: false, env: {},
  });
  const audit = async () => (await fs.readFile(path.join(dirs.state, 'audit.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  try {
    // A body that carries by is refused by the command's own check, from the site and from the laptop's page, and nothing is written.
    for (const from of ['site', 'local']) {
      await assert.rejects(runner.handle({ type: 'auto', slug: 'a-job', on: true, by: 'auto' }, { from }), /doesn’t take “by”/);
    }
    assert.deepEqual(await audit(), []);
    // The plain command records you, never Auto.
    await runner.handle({ type: 'auto', slug: 'a-job', on: true }, { from: 'site' });
    const lines = (await audit()).filter((l) => l.action === 'auto' && l.what === 'on');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].by, 'you');
  } finally {
    runner.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});
