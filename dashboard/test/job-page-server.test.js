// The job page's overview facts on GET /api/job/:slug (Part 3, Task 1), on a demo dashboard with a
// pretend Orbit on this computer: the ticket with who filed it, what we're building (the spec's Key
// points, else the first brief's) and the check lists from acceptance.md. The filer's name is kept
// in Starbase's own record, never in the job folder. No model and no real Orbit are called.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDashboard } from './helpers/dashboard.js';
import { FABLE } from '../lib/options.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'orbit', 'ticket-ORBIT-479.json');
const FAKE_TOKEN = `orbfb_${'A'.repeat(43)}`;
const OLD = '2026-10-01T10:00:00Z';
const ACCEPTANCE = '# Acceptance criteria\n\n## It works when\n1. Starbase reads a ticket with a personal token. (FR-001)\n\n## It must not\n1. Write to Orbit. (FR-002)\n';

let root, featuresDir, repo, orbit, dashboard, base, token;
const output = [];

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** A job folder written by hand, as an older Starbase left it: status.json and options.json, and any files given. */
async function writeJob(slug, { options = {}, files = {} } = {}) {
  const dir = path.join(featuresDir, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({
    schema_version: 1, slug, title: `Job ${slug}`, route: 'small', stage: 'clarify', stage_state: 'working',
    repo: { path: repo, base_branch: 'main' }, updated_at: OLD,
  }, null, 2));
  await fs.writeFile(path.join(dir, 'options.json'), JSON.stringify({ schema_version: 2, level: 2, flow: 'small', title: `Job ${slug}`, ...options }, null, 2));
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), typeof text === 'string' ? text : JSON.stringify(text));
  }
  return dir;
}

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-job-page-')));
  featuresDir = path.join(root, 'feature-work');
  repo = path.join(root, 'sample-repo');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state'), home: path.join(root, 'home') };
  for (const d of [featuresDir, repo, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  await fs.writeFile(path.join(dirs.state, 'orbit-token'), `${FAKE_TOKEN}\n`, { mode: 0o600 });

  // A job from before this change: options.json holds the ticket; no session facts, no summaries, no acceptance.md.
  await writeJob('orbit-470-older-job', { options: { ticket: { key: 'ORBIT-470', title: 'Older job', url: 'https://orbit.example.com/t/470' } } });
  // A job with briefs and their Key points but no spec yet.
  await writeJob('notes-on-customers', {
    files: {
      'briefs/001-clarify.md': '**Notes on customers** (demo)\n\n- Managers want notes.\n',
      'briefs/002-plan.md': '**The plan** (demo)\n\n- Later.\n',
      'summaries/briefs/001-clarify.json': { outcome: ['Managers add notes on customers.'], risks: ['Techs must not see them.'] },
      'summaries/briefs/002-plan.json': { outcome: ['The later brief.'] },
    },
  });

  const fixture = await fs.readFile(FIXTURE, 'utf8');
  orbit = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/feedback/v1/tickets/ORBIT-479') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fixture);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve) => orbit.listen(0, '127.0.0.1', resolve));
  dashboard = await startDashboard({
    env: {
      HOME: dirs.home, STARBASE_DEMO: '1', STARBASE_FEATURES_DIR: featuresDir, STARBASE_PROJECTS_DIR: dirs.projects, STARBASE_AGENTS_DIR: dirs.agents,
      STARBASE_SKILLS_DIR: dirs.skills, STARBASE_STATE_DIR: dirs.state, STARBASE_ORBIT_URL: `http://127.0.0.1:${orbit.address().port}`,
    },
    output,
  });
  ({ base, token } = dashboard);
});

after(async () => {
  await dashboard?.stop();
  if (orbit) await new Promise((resolve) => { orbit.close(resolve); orbit.closeAllConnections?.(); });
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const getJob = async (slug) => {
  const res = await fetch(`${base}/api/job/${slug}`);
  assert.equal(res.status, 200, `GET /api/job/${slug}`);
  return res.json();
};

/** The ticket job, started once through POST /api/jobs and shared by the tests that read it. */
let started = null;
function startTicketJob() {
  started ??= (async () => {
    const res = await fetch(`${base}/api/jobs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Starbase-Token': token },
      body: JSON.stringify({ description: 'ORBIT-479: Read-only feedback API', repoPath: repo, ticket: { key: 'ORBIT-479', title: 'Read-only feedback API', url: 'https://orbit.example.com/t/479' } }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    return { slug: body.slug, dir: path.join(featuresDir, body.slug) };
  })();
  return started;
}

/** Every file under a folder, with its text. */
async function filesUnder(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await filesUnder(p));
    else if (e.isFile()) out.push({ p, text: await fs.readFile(p, 'utf8') });
  }
  return out;
}

test('a ticket job’s page has the ticket with who filed it, what we’re building from the spec summary and the check lists', { timeout: 60_000 }, async () => {
  const { slug, dir } = await startTicketJob();
  await fs.mkdir(path.join(dir, 'summaries'), { recursive: true });
  await fs.writeFile(path.join(dir, 'summaries', 'spec.v0.3.json'), JSON.stringify({ outcome: ['Starbase reads Orbit tickets.'], risks: ['A token that can write.'] }));
  await fs.writeFile(path.join(dir, 'acceptance.md'), ACCEPTANCE);
  // The answer is read again once the folder's change is seen.
  let job = await getJob(slug);
  const end = Date.now() + 10_000;
  while (Date.now() < end && !(job.page?.check && job.page?.building)) { await sleep(100); job = await getJob(slug); }
  assert.deepEqual(job.page.ticket, {
    key: 'ORBIT-479', title: 'Read-only feedback API', url: 'https://orbit.example.com/t/479',
    filedBy: 'Pat Reporter', filedAt: '2026-10-01T09:00:00.000Z',
    description: 'Starbase should read tickets with a personal token and never write.',
  });
  assert.equal(job.page.building.from, 'spec');
  assert.equal(job.page.building.version, '0.3');
  assert.deepEqual(job.page.building.outcome, ['Starbase reads Orbit tickets.']);
  assert.deepEqual(job.page.building.risks, ['A token that can write.']);
  assert.equal(job.page.check.worksWhen.length, 1);
  assert.deepEqual(job.page.check, { version: null, worksWhen: ['Starbase reads a ticket with a personal token.'], mustNot: ['Write to Orbit.'] });
});

test('the filer’s name is in no file of the job folder', { timeout: 60_000 }, async () => {
  const { slug, dir } = await startTicketJob();
  assert.equal((await getJob(slug)).page.ticket.filedBy, 'Pat Reporter', 'Starbase knows the name');
  const files = await filesUnder(dir);
  assert.ok(files.some((f) => f.p.endsWith('ticket.md')), 'ticket.md was written');
  for (const f of files) assert.ok(!f.text.includes('Pat Reporter') && !f.text.includes('pat@example.com'), f.p);
});

test('a job from before this change still has a page', { timeout: 60_000 }, async () => {
  const job = await getJob('orbit-470-older-job');
  assert.deepEqual(job.page.ticket, { key: 'ORBIT-470', title: 'Older job', url: 'https://orbit.example.com/t/470', filedBy: null, filedAt: null, description: null });
  assert.equal(job.page.building, null);
  assert.equal(job.page.check, null);
});

test('before there is a spec, what we’re building comes from the first brief’s summary', { timeout: 60_000 }, async () => {
  const job = await getJob('notes-on-customers');
  assert.equal(job.page.ticket, null, 'no ticket');
  assert.deepEqual(job.page.building, { from: 'brief', version: null, outcome: ['Managers add notes on customers.'], risks: ['Techs must not see them.'] });
  assert.equal(job.page.check, null);
});

test('a restart keeps the filer’s name out of the archived folder, and the new start reads it again', { timeout: 60_000 }, async () => {
  const { slug } = await startTicketJob();
  const post = async (p, body) => {
    const res = await fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Starbase-Token': token }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  // The demo Foreman's reply is stopped first: a restart waits for no reply.
  const active = new Set(['starting', 'running', 'waiting_permission', 'stopping']);
  for (let i = 0; i < 200; i++) {
    const runs = (await (await fetch(`${base}/api/runs`)).json()).runs.filter((r) => r.slug === slug && active.has(r.status));
    if (!runs.length) break;
    for (const r of runs) if (r.status !== 'stopping') await post(`/api/runs/${r.id}/stop`, {});
    await sleep(100);
  }
  const res = await post(`/api/job/${slug}/restart`, { model: FABLE });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const archived = await filesUnder(path.join(featuresDir, '.restarted'));
  assert.ok(archived.some((f) => f.p.endsWith('session-record.json')), 'the session record was archived');
  for (const f of archived) assert.ok(!f.text.includes('Pat Reporter'), f.p);
  assert.equal((await getJob(res.body.slug)).page.ticket.filedBy, 'Pat Reporter');
});

test('a job’s page has each step’s times and documents (Task 2)', { timeout: 60_000 }, async () => {
  const STEPS = ['spec', 'investigate', 'plan', 'build', 'test', 'review', 'ship'];
  // Not started by Starbase (no new-job line), at Clarify: the Spec step has no start and no end yet.
  const job = await getJob('notes-on-customers');
  assert.ok(job.briefs.every((b) => typeof b.at === 'string'), 'each brief has its file’s time');
  assert.deepEqual(Object.keys(job.page.times), STEPS);
  for (const stop of STEPS) assert.deepEqual(job.page.times[stop], { startedAt: null, endedAt: null }, stop);
  const files = (stop) => job.page.docs[stop].map((d) => d.file);
  assert.deepEqual(Object.keys(job.page.docs), [...STEPS, 'none']);
  assert.deepEqual(files('spec'), ['briefs/001-clarify.md']);
  assert.deepEqual(files('plan'), ['briefs/002-plan.md']);
  assert.ok(files('none').includes('status.json') && files('none').includes('options.json'));
  // Started by Starbase: once the Foreman says it is at the Spec, that step starts at the new-job line.
  const { slug, dir } = await startTicketJob();
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({
    schema_version: 1, slug, title: 'Read-only feedback API', route: 'small', stage: 'spec', stage_state: 'working',
    repo: { path: repo, base_branch: 'main' }, updated_at: new Date().toISOString(),
  }));
  let ticketJob = await getJob(slug);
  const end = Date.now() + 10_000;
  while (Date.now() < end && ticketJob.stage !== 'spec') { await sleep(100); ticketJob = await getJob(slug); }
  const startLine = ticketJob.audit.find((e) => e.action === 'new-job');
  assert.ok(startLine?.at, 'the new-job line is in the job’s audit');
  assert.deepEqual(ticketJob.page.times.spec, { startedAt: startLine.at, endedAt: null });
});

test('a closed job’s last step ends at the closed time; an open one’s has no end (Task 2, fix round 1)', { timeout: 60_000 }, async () => {
  const slug = 'closed-at-ship';
  await writeJob(slug, {
    files: {
      'status.json': { schema_version: 1, slug, title: `Job ${slug}`, route: 'small', stage: 'pr1', stage_state: 'working', repo: { path: repo, base_branch: 'main' }, updated_at: OLD },
      'briefs/001-pr1.md': '**PR #1** (demo)\n',
    },
  });
  // The new folder is found once the dashboard reads the features folder again.
  const end = Date.now() + 20_000;
  while (Date.now() < end && (await fetch(`${base}/api/job/${slug}`)).status !== 200) await sleep(200);
  let job = await getJob(slug);
  assert.equal(job.stage, 'pr1');
  assert.equal(job.page.times.ship.endedAt, null, 'open: the step it is at has no end');
  const res = await fetch(`${base}/api/job/${slug}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Starbase-Token': token }, body: JSON.stringify({ as: 'dropped' }) });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  job = await getJob(slug);
  assert.equal(job.page.times.ship.endedAt, body.closed.at);
});

// ---------- Plan, Build, Review and Ship facts (Task 4) ----------

/** Wait for a job folder written after start to be found, then answer its job. */
async function foundJob(slug) {
  const end = Date.now() + 20_000;
  while (Date.now() < end && (await fetch(`${base}/api/job/${slug}`)).status !== 200) await sleep(200);
  return getJob(slug);
}

test('an old job’s page has no plan steps and no findings, and three pull requests not started (Task 4)', { timeout: 60_000 }, async () => {
  // Review Focus 1: a plan with no ### S1 headings, no review.md, no PRs in status.json, no branch.
  const slug = 'older-plan-job';
  await writeJob(slug, { files: { 'implementation-plan.md': '# Plan\n\n## Step 1\n1. Build the form.\n' } });
  const job = await foundJob(slug);
  assert.equal(job.page.plan, null);
  assert.equal(job.page.review, null);
  assert.deepEqual(job.page.prs.map((p) => [p.n, p.state]), [[1, 'not-started'], [2, 'not-started'], [3, 'not-started']]);
  // The rest of the page is whole.
  assert.ok(job.page.times && job.page.docs);
});

test('a job at Build has its plan’s steps by its commits, and its review’s findings (Task 4)', { timeout: 60_000 }, async () => {
  // Its own repository: a base commit on main, then the branch with [S1] built.
  const planRepo = path.join(root, 'plan-repo');
  await fs.mkdir(planRepo, { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const sh = (...args) => execFileSync('git', args, { cwd: planRepo, stdio: ['ignore', 'pipe', 'ignore'], env }).toString();
  sh('init', '-q', '-b', 'main');
  sh('commit', '-q', '--allow-empty', '-m', '[S2] an older job’s step on main: not this job’s');
  sh('switch', '-q', '-c', 'feature/plan');
  sh('commit', '-q', '--allow-empty', '-m', '[S1] the form');
  const slug = 'plan-at-build';
  await writeJob(slug, {
    files: {
      'status.json': { schema_version: 1, slug, title: `Job ${slug}`, route: 'small', stage: 'implement', stage_state: 'working', branch: 'feature/plan', repo: { path: planRepo, base_branch: 'main' }, updated_at: OLD },
      'implementation-plan.md': '# Plan\n\n### S1: The form\n### S2: The list\n### S3: The tests\n',
      'review.md': '# Review\n\n| Severity | Lens | Finding | Status |\n|---|---|---|---|\n| Major | errors | A failed save is silent | |\n',
    },
  });
  const job = await foundJob(slug);
  assert.equal(job.stage, 'implement');
  assert.deepEqual(job.page.plan.steps, [{ id: 'S1', name: 'The form', state: 'done' }, { id: 'S2', name: 'The list', state: 'now' }, { id: 'S3', name: 'The tests', state: 'next' }]);
  assert.deepEqual(job.page.review.rows, [{ lens: 'feature-review-errors', severity: 'major', text: 'A failed save is silent', status: 'open' }]);
  assert.equal(typeof job.page.review.at, 'string');
  assert.equal(job.page.prs.length, 3);
  // The Code tab's commits carry their files.
  const commits = await (await fetch(`${base}/api/job/${slug}/commits`)).json();
  assert.equal(commits.commits[0].subject, '[S1] the form');
  assert.ok(commits.commits.every((c) => Array.isArray(c.files)), 'each commit lists its files');
});
