// The runner's read of a job's Auto log (read.autoLog): a job Auto has never run on is answered
// null without reading the audit file. Temp folders only; no model is called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunner } from '../runner/index.js';
import { State } from '../lib/state.js';

const DASH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a job Auto has never run on is answered without reading the audit; one it has run on is read', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sb-autolog-read-')));
  const dirs = Object.fromEntries(['claude', 'features', 'projects', 'agents', 'skills', 'state'].map((n) => [n, path.join(root, n)]));
  for (const d of Object.values(dirs)) await fs.mkdir(d);
  const dirOf = (slug) => path.join(dirs.features, slug);
  for (const slug of ['plain-job', 'never-ran', 'ran-job']) await fs.mkdir(dirOf(slug));
  await fs.writeFile(path.join(dirs.state, 'sessions.json'), JSON.stringify({
    [dirOf('never-ran')]: { auto: { on: false, ran: false } },
    [dirOf('ran-job')]: { auto: { on: true, ran: true, since: '2026-11-11T08:00:00.000Z' } },
  }));
  await fs.writeFile(path.join(dirs.state, 'audit.jsonl'), `${JSON.stringify({ at: '2026-11-11T08:00:00.000Z', featureDir: dirOf('ran-job'), action: 'auto', what: 'on', by: 'you' })}\n`);
  const reads = [];
  const real = State.prototype.auditFor;
  State.prototype.auditFor = function spy(dir, ...rest) { reads.push(dir); return real.call(this, dir, ...rest); };
  const runner = await createRunner({
    host: '127.0.0.1', port: 1, token: 't', dashboardDir: DASH, claudeDir: dirs.claude, featuresDir: dirs.features, projectsDir: dirs.projects,
    agentsDir: dirs.agents, skillsDir: dirs.skills, stateDir: dirs.state, demo: true, claudePath: null,
    claudeSettingsFile: path.join(root, 'claude.json'), legacySettingsFile: null, planUsage: false, orbitStore: 'file',
    integrateDir: dirs.state, integrateRoot: path.join(DASH, '..'), siteLink: false, env: {},
  });
  try {
    await runner.read.features(); // load the jobs; anything it reads is not the Auto log's
    reads.length = 0;
    assert.equal(await runner.read.autoLog('plain-job'), null);
    assert.equal(await runner.read.autoLog('never-ran'), null);
    assert.deepEqual(reads, [], 'no audit read for jobs Auto has not run on');
    const rec = await runner.read.autoLog('ran-job');
    assert.equal(rec?.on, true);
    assert.deepEqual(reads, [dirOf('ran-job')]);
  } finally {
    State.prototype.auditFor = real;
    runner.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});
