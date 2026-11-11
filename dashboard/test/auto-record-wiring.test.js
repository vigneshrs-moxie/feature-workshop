// Task 7b: the Auto record's wiring that needs no running Foreman: the laptop's route
// GET /api/job/:slug/auto, and the Approver's cost read only for a job whose Auto has run.
// Temp folders only; no model is called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunner } from '../runner/index.js';
import { State } from '../lib/state.js';
import { HttpError } from '../lib/http-guard.js';
import jobRoutes from '../site/routes-jobs.js';

const DASH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AT = '2026-11-11T08:00:00.000Z';

async function boot() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sb-auto-wiring-')));
  const dirs = Object.fromEntries(['claude', 'features', 'projects', 'agents', 'skills', 'state'].map((n) => [n, path.join(root, n)]));
  for (const d of Object.values(dirs)) await fs.mkdir(d);
  const dirOf = (slug) => path.join(dirs.features, slug);
  for (const slug of ['plain-job', 'never-ran', 'ran-job']) await fs.mkdir(dirOf(slug));
  await fs.writeFile(path.join(dirs.state, 'sessions.json'), JSON.stringify({
    [dirOf('never-ran')]: { auto: { on: false, ran: false } },
    [dirOf('ran-job')]: { auto: { on: true, ran: true, since: AT } },
  }));
  const line = (o) => `${JSON.stringify({ at: AT, featureDir: dirOf('ran-job'), slug: 'ran-job', ...o })}\n`;
  await fs.writeFile(path.join(dirs.state, 'audit.jsonl'),
    line({ action: 'auto', what: 'on', by: 'you', stage: null, asked: '', chose: '', why: '' })
    + line({ action: 'auto', what: 'gate', stage: 'plan', briefNumber: 1, asked: 'Plan v1', chose: 'Approved', why: 'It matches.', risk: 'low', costUsd: 0.25 }));
  const runner = await createRunner({
    host: '127.0.0.1', port: 1, token: 't', dashboardDir: DASH, claudeDir: dirs.claude, featuresDir: dirs.features, projectsDir: dirs.projects,
    agentsDir: dirs.agents, skillsDir: dirs.skills, stateDir: dirs.state, demo: true, claudePath: null,
    claudeSettingsFile: path.join(root, 'claude.json'), legacySettingsFile: null, planUsage: false, orbitStore: 'file',
    integrateDir: dirs.state, integrateRoot: path.join(DASH, '..'), siteLink: false, env: {},
  });
  return { root, dirs, dirOf, runner };
}

test('GET /api/job/:slug/auto answers the five fields, and 404 for an unknown job', async () => {
  const { root, runner } = await boot();
  try {
    const needJob = async (slug) => { if (!(await runner.read.features()).features.some((f) => f.slug === slug)) throw new HttpError(404, 'No such job.'); return slug; };
    const routes = jobRoutes({ runner, read: runner.read, send: () => {}, sendJson: (res, status, body) => { res.out = { status, body }; }, needJob, wireframesOrigin: '', LOCAL: { from: 'local' } });
    const get = async (slug) => {
      const url = new URL(`http://x/api/job/${slug}/auto`);
      const route = routes.find((r) => r.method === 'GET' && r.path.test(url.pathname));
      const m = route.path.exec(url.pathname);
      const res = {};
      await route.run({ res, url, m });
      return res.out;
    };
    const ran = await get('ran-job');
    assert.equal(ran.status, 200);
    assert.deepEqual(Object.keys(ran.body).sort(), ['entries', 'on', 'stopped', 'summary', 'tag']);
    assert.equal(ran.body.on, true);
    assert.equal(ran.body.entries.length, 1);
    assert.equal(ran.body.entries[0].chose, 'Approved');
    assert.equal(ran.body.summary.length, 3);
    // Auto has never run: the same five fields, nothing decided (the page shows its empty line).
    const none = await get('plain-job');
    assert.equal(none.status, 200);
    assert.deepEqual(Object.keys(none.body).sort(), ['entries', 'on', 'stopped', 'summary', 'tag']);
    assert.deepEqual(none.body.entries, []);
    assert.equal(none.body.on, false);
    await assert.rejects(get('no-such-job'), (err) => err instanceof HttpError && err.status === 404);
  } finally { runner.stop(); await fs.rm(root, { recursive: true, force: true }); }
});

test('the Approver\'s cost is read from the audit only for a job whose Auto has run', async () => {
  const { root, runner, dirOf } = await boot();
  const reads = [];
  const real = State.prototype.auditFor;
  try {
    await runner.read.features();
    await new Promise((r) => setTimeout(r, 1600)); // the runner reads the jobs at most every 1.5 seconds
    State.prototype.auditFor = function spy(dir, ...rest) { reads.push(dir); return real.call(this, dir, ...rest); };
    const board = await runner.read.features();
    assert.ok(!reads.includes(dirOf('plain-job')) && !reads.includes(dirOf('never-ran')), 'no audit read for jobs Auto never ran on');
    assert.ok(reads.includes(dirOf('ran-job')));
    State.prototype.auditFor = real;
    const ran = (await runner.read.job('ran-job')).costDetail;
    assert.ok(Math.abs(ran.totalUsd - 0.25) < 1e-9);
    assert.ok(ran.agents.some((a) => a.agentType === 'approver' && Math.abs(a.usd - 0.25) < 1e-9));
    assert.equal((await runner.read.job('plain-job')).costDetail.agents.some((a) => a.agentType === 'approver'), false);
    assert.ok(Math.abs(board.features.find((f) => f.slug === 'ran-job').cost.totalUsd - 0.25) < 1e-9);
  } finally { State.prototype.auditFor = real; runner.stop(); await fs.rm(root, { recursive: true, force: true }); }
});
