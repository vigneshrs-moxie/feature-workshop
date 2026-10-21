import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { checkRepo } from '../lib/repos.js';
import { State, migrateSettings, workflowSettings } from '../lib/state.js';
import { Driver } from '../lib/driver.js';
import { makeFakeQuery } from '../demo/fake-query.js';

test('checkRepo: only absolute paths to real git repositories', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-repo-'));
  assert.equal((await checkRepo('relative/path')).ok, false);
  assert.match((await checkRepo(path.join(dir, 'missing'))).reason, /doesn’t exist/);
  assert.match((await checkRepo(dir)).reason, /isn’t a git repository/);
  execFileSync('git', ['-C', dir, 'init', '-q']);
  await fs.mkdir(path.join(dir, 'sub'));
  const ok = await checkRepo(path.join(dir, 'sub'));
  assert.equal(ok.ok, true);
  assert.equal(await fs.realpath(ok.path), await fs.realpath(dir), 'a subfolder resolves to the repository root');
  await fs.rm(dir, { recursive: true, force: true });
});

test('state: the workflow settings, and the quest rule moved to the finish line once', async () => {
  assert.deepEqual(workflowSettings(undefined), { finishLine: 'pr1-merged', wireframes: 'auto', clarify: 'auto' });
  assert.deepEqual(workflowSettings({ finishLine: 'staging' }), { finishLine: 'staging', wireframes: 'auto', clarify: 'auto' });
  assert.deepEqual(workflowSettings({ finishLine: 'whenever' }), { finishLine: 'pr1-merged', wireframes: 'auto', clarify: 'auto' });
  // The pure move: play.questDone → workflow.finishLine, and the old field goes.
  assert.deepEqual(migrateSettings({ play: { mode: 'full', questDone: 'first-pr', sounds: true } }), { settings: { play: { mode: 'full', sounds: true }, workflow: { finishLine: 'pr1-open' } }, changed: true });
  assert.deepEqual(migrateSettings({ play: { questDone: 'marked-done' } }).settings, { play: {}, workflow: { finishLine: 'marked' } });
  assert.deepEqual(migrateSettings({ play: { questDone: 'first-pr' }, workflow: { finishLine: 'main' } }).settings, { play: {}, workflow: { finishLine: 'main' } }, 'a finish line already chosen wins');
  assert.deepEqual(migrateSettings({ policy: 'ask-all' }), { settings: { policy: 'ask-all' }, changed: false });
  // Through the file: read once, written back once, and read as the new shape afterwards.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-state-'));
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ policy: 'hands-off', play: { mode: 'subtle', questDone: 'marked-done', sounds: false } }));
  const s = await new State(dir).getSettings();
  assert.equal(s.workflow.finishLine, 'marked');
  assert.deepEqual(s.play, { mode: 'subtle', sounds: false });
  const saved = JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'));
  assert.deepEqual(saved.workflow, { finishLine: 'marked' });
  assert.equal(saved.play.questDone, undefined);
  const fresh = new State(await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-state-')));
  assert.equal((await fresh.getSettings()).workflow.finishLine, 'pr1-merged', 'the default with no file');
});

test('state: remembers sessions, takeovers and the last reply per job', async () => {
  const state = new State(await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-state-')));
  await state.setSession('/f/a', { sessionId: 's1', cwd: '/r' });
  await state.setSession('/f/a', { takenOverAt: '2026-10-12T10:00:00Z' });
  assert.equal((await new State(state.dir).sessionFor('/f/a')).sessionId, 's1', 'persists across restarts');
  assert.equal((await state.sessionFor('/f/a')).takenOverAt, '2026-10-12T10:00:00Z');
  await state.audit({ action: 'run-ended', featureDir: '/f/a', status: 'done', reply: 'one' });
  await state.audit({ action: 'run-ended', featureDir: '/f/a', status: 'stopped', reply: 'two' });
  await state.audit({ action: 'run-ended', featureDir: '/f/b', status: 'done' });
  const ends = await state.lastRunEnds();
  assert.equal(ends['/f/a'].status, 'stopped');
  assert.equal(ends['/f/b'].status, 'done');
  assert.equal((await state.auditFor('/f/a')).length, 2);
});

test('demo: the pretend Foreman asks once, then moves the job to its next stage', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-demo-'));
  const dir = path.join(root, 'feature-work', 'widget');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ schema_version: 1, slug: 'widget', title: 'Widget', route: 'small', stage: 'plan', stage_state: 'waiting_for_you', brief: { number: 3 } }));
  const driver = new Driver({ queryFn: makeFakeQuery({ featuresDir: path.join(root, 'feature-work') }), state: new State(path.join(root, 'state')), projectsDir: '/nonexistent' });
  driver.idleGraceMs = 30;
  driver.on('permission', (p) => driver.decide(p.id, { decision: 'allow' }));
  const run = await driver.start({ featureDir: dir, slug: 'widget', title: 'Widget', cwd: root, text: `I approve. Private folder: ${dir}` });
  const done = await new Promise((resolve) => driver.on('run', (r) => { if (r.id === run.id && ['done', 'error', 'stopped'].includes(r.status)) resolve(r); }));
  assert.equal(done.status, 'done');
  const s = JSON.parse(await fs.readFile(path.join(dir, 'status.json'), 'utf8'));
  assert.equal(s.stage, 'implement');
  assert.equal(s.stage_state, 'waiting_for_you');
  assert.equal(s.brief.number, 4);
  assert.ok((await fs.readdir(path.join(dir, 'briefs'))).includes('004-implement.md'));
  await fs.rm(root, { recursive: true, force: true });
});
