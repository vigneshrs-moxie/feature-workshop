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
  await guessedDashboard?.stop();
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

// ---------- The Tester's check counts and the hand test (Task 5c, design 3.5) ----------

test('starting Try it from the page marks the hand test started; the recorder starting the app does not', { timeout: 90_000 }, async () => {
  // Its own demo dashboard, with the evidence recorder's pretend Playwright (no browser), so the
  // recorder can start the job's app as it does at a Test step.
  const own = path.join(root, 'hand-test');
  const dirs = { features: path.join(own, 'feature-work'), projects: path.join(own, 'projects'), agents: path.join(own, 'agents'), skills: path.join(own, 'skills'), state: path.join(own, 'state'), home: path.join(own, 'home') };
  for (const d of Object.values(dirs)) await fs.mkdir(d, { recursive: true });
  const slug = 'hours-column';
  const dir = path.join(dirs.features, slug);
  const worktree = path.join(own, 'worktrees', slug);
  await fs.mkdir(path.join(dir, 'evidence', 'specs'), { recursive: true });
  await fs.mkdir(worktree, { recursive: true });
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({
    schema_version: 1, slug, title: 'Hours column', route: 'small', stage: 'test', stage_state: 'working', worktree,
    repo: { path: worktree, base_branch: 'main' }, updated_at: OLD,
  }, null, 2));
  await fs.writeFile(path.join(dir, 'options.json'), JSON.stringify({ schema_version: 2, level: 2, flow: 'small', title: 'Hours column' }, null, 2));
  for (const n of [1, 2]) {
    await fs.writeFile(path.join(dir, 'evidence', 'specs', `AC-${n}.spec.mjs`), `import { test, expect } from '@playwright/test';\ntest('AC-${n}: line ${n}', async ({ page }) => {\n  await page.goto('/');\n  await expect(page).toHaveTitle(/./);\n});\n`);
  }
  const report = path.join(dir, 'test-report.md');
  await fs.writeFile(report, '# Test report\n\n- Commit under test: abc1234def5\n\n## Results\n- AC-1 PASS\n- AC-2 FAIL\n- AC-3 NOT RUN\n\n## Evidence\n\n- AC-1: Managers see the Hours column. Spec: evidence/specs/AC-1.spec.mjs\n- AC-2: The export is hidden. Spec: evidence/specs/AC-2.spec.mjs\n');
  // Written well before now: the recorder waits for a report that is still changing.
  const then = new Date(Date.now() - 60_000);
  await fs.utimes(report, then, then);

  const evidenceFixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'evidence');
  const ownOutput = [];
  const d = await startDashboard({
    env: {
      HOME: dirs.home, STARBASE_DEMO: '1', STARBASE_PLAYWRIGHT: path.join(evidenceFixture, 'fake-playwright.mjs'),
      STARBASE_FEATURES_DIR: dirs.features, STARBASE_PROJECTS_DIR: dirs.projects, STARBASE_AGENTS_DIR: dirs.agents,
      STARBASE_SKILLS_DIR: dirs.skills, STARBASE_STATE_DIR: dirs.state,
    },
    output: ownOutput,
  });
  try {
    const getOwn = async (p) => {
      const res = await fetch(`${d.base}${p}`);
      assert.equal(res.status, 200, `GET ${p}`);
      return res.json();
    };
    const postOwn = async (p, body = {}) => {
      const res = await fetch(`${d.base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Starbase-Token': d.token }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };

    // The Tester's counts, with the report's time; nobody has started the hand test.
    let job = await getOwn(`/api/job/${slug}`);
    assert.deepEqual(job.page.checks, { passed: 1, failed: 1, notRun: 1, at: then.toISOString() });
    assert.deepEqual(job.page.handTest, { startedAt: null });

    // The recorder starts the job's app to record (the page's Record; it may have begun by itself).
    const rec = await postOwn(`/api/job/${slug}/evidence/record`);
    assert.ok(rec.status === 200 || (rec.status === 409 && rec.body.code === 'busy'), JSON.stringify(rec.body));
    let recorded = rec.status === 200 ? rec.body.evidence : null;
    for (let i = 0; i < 60 && !recorded; i++) { await sleep(250); recorded = (await getOwn(`/api/job/${slug}/evidence`)).evidence; }
    assert.ok(recorded, `the recording finished:\n${ownOutput.join('').slice(-2000)}`);
    const audit = (await fs.readFile(path.join(dirs.state, 'audit.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(!audit.some((l) => l.action === 'local' && l.slug === slug), 'Try it’s start was never sent');
    job = await getOwn(`/api/job/${slug}`);
    assert.deepEqual(job.page.handTest, { startedAt: null }, 'the recorder starting the app is not the hand test');

    // Try it's app started from the page: the hand test has started, kept in Starbase's own record.
    const before = Date.now();
    const start = await postOwn(`/api/job/${slug}/local`, { action: 'start' });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    job = await getOwn(`/api/job/${slug}`);
    const at = Date.parse(job.page.handTest.startedAt);
    assert.ok(at >= before - 1000 && at <= Date.now() + 1000, job.page.handTest.startedAt);
    const sessions = JSON.parse(await fs.readFile(path.join(dirs.state, 'sessions.json'), 'utf8'));
    assert.equal(sessions[dir].tryStartedAt, job.page.handTest.startedAt);

    // The Test step carries both; another step carries neither.
    const testStep = await getOwn(`/api/job/${slug}/stage/test`);
    assert.deepEqual(testStep.checks, job.page.checks);
    assert.deepEqual(testStep.handTest, job.page.handTest);
    const buildStep = await getOwn(`/api/job/${slug}/stage/build`);
    assert.ok(!('checks' in buildStep) && !('handTest' in buildStep));
  } finally {
    await d.stop();
  }
});

test('a job from before this change has no checks and no hand test started', { timeout: 60_000 }, async () => {
  const job = await getJob('orbit-470-older-job');
  assert.equal(job.page.checks, null);
  assert.deepEqual(job.page.handTest, { startedAt: null });
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
  const sh = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: planRepo, stdio: ['ignore', 'pipe', 'ignore'], env }).toString();
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

test('a job closed as done has every plan step done; one closed as dropped keeps what its commits say (Task 4, fix round 1)', { timeout: 60_000 }, async () => {
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const close = async (slug, as) => {
    const res = await fetch(`${base}/api/job/${slug}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Starbase-Token': token }, body: JSON.stringify({ as }) });
    assert.equal(res.status, 200, JSON.stringify(await res.json()));
  };
  for (const as of ['done', 'dropped']) {
    const slug = `plan-closed-${as}`;
    const own = path.join(root, `${slug}-repo`);
    await fs.mkdir(own, { recursive: true });
    const sh = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: own, stdio: ['ignore', 'pipe', 'ignore'], env }).toString();
    sh('init', '-q', '-b', 'main');
    sh('commit', '-q', '--allow-empty', '-m', 'base');
    sh('switch', '-q', '-c', 'feature/plan');
    sh('commit', '-q', '--allow-empty', '-m', '[S1] the form');
    await writeJob(slug, {
      files: {
        'status.json': { schema_version: 1, slug, title: `Job ${slug}`, route: 'small', stage: 'implement', stage_state: 'working', branch: 'feature/plan', repo: { path: own, base_branch: 'main' }, updated_at: OLD },
        'implementation-plan.md': '### S1: The form\n### S2: The list\n',
      },
    });
    assert.deepEqual((await foundJob(slug)).page.plan.steps.map((s) => s.state), ['done', 'now']);
    await close(slug, as);
    const states = (await getJob(slug)).page.plan.steps.map((s) => s.state);
    assert.deepEqual(states, as === 'done' ? ['done', 'done'] : ['done', 'next'], as);
  }
});

// ---------- A branch Starbase only guessed (lib/locate.js branchGuessed): the page reads nothing from it ----------

/**
 * Its own demo dashboard, so the flow map's timing is this test's own. Two jobs, each with its branch
 * checked out in its own worktree and carrying a commit tagged [S1], each named by its status.json:
 *   visit-audit at PR #1, waiting for you: the demo's map gives it a lane with PR #1 open. A review
 *     walkthrough was built for its branch, and its Tester checked the base commit.
 *   visit-export at PR #2: the demo's map gives it PR #1 merged, so its plan is all done by the lane.
 * Then each status.json loses the branch and the job's workflow-status.md only mentions it, so the
 * branch is a guess (another job's, as far as Starbase knows). The map may still have the lane it read
 * before (it recounts at most every 15 seconds after a change, else at its minute timer), as a lane
 * can. The pure rule (lib/locate.js ownLane) is tested with a lane given in foreman.test.js.
 */
let guessed = null;
let guessedDashboard = null; // stopped in after(), even when the world's setup failed part way
function guessedWorld() {
  guessed ??= (async () => {
    const own = path.join(root, 'guessed');
    const dirs = { features: path.join(own, 'feature-work'), projects: path.join(own, 'projects'), agents: path.join(own, 'agents'), skills: path.join(own, 'skills'), state: path.join(own, 'state'), home: path.join(own, 'home'), walk: path.join(own, 'walkthroughs') };
    for (const d of Object.values(dirs)) await fs.mkdir(d, { recursive: true });
    const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
    const gRepo = path.join(own, 'repo');
    await fs.mkdir(gRepo, { recursive: true });
    const sh = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'ignore'], env: gitEnv }).toString().trim();
    sh(gRepo, 'init', '-q', '-b', 'main');
    sh(gRepo, 'commit', '-q', '--allow-empty', '-m', 'base');
    const baseSha = sh(gRepo, 'rev-parse', 'HEAD');
    /** A job whose branch, in its own worktree, has a [S1] commit; its status.json names the branch until writeStatus() is called bare. */
    async function makeJob({ slug, title, branch, folder, stage, stageState, commit }) {
      const wt = path.join(own, folder);
      sh(gRepo, 'worktree', 'add', '-q', '-b', branch, wt);
      sh(wt, 'commit', '-q', '--allow-empty', '-m', commit);
      const s1 = sh(wt, 'rev-parse', 'HEAD');
      const dir = path.join(dirs.features, slug);
      await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
      const writeStatus = (extra = {}) => fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({
        schema_version: 1, slug, title, route: 'small', stage, stage_state: stageState,
        repo: { path: gRepo, base_branch: 'main' }, updated_at: OLD, ...extra,
      }, null, 2));
      await writeStatus({ branch });
      await fs.writeFile(path.join(dir, 'options.json'), JSON.stringify({ schema_version: 2, level: 2, flow: 'small', title }, null, 2));
      await fs.writeFile(path.join(dir, 'briefs', `001-${stage}.md`), `**${title}: ${stage}** (demo)\n`);
      await fs.writeFile(path.join(dir, 'implementation-plan.md'), '# Plan\n\n### S1: The form\n### S2: The list\n');
      await fs.writeFile(path.join(dir, 'workflow-status.md'), `# ${title}\n\nStacked on the parent branch \`${branch}\` for now.\n`);
      return { slug, dir, wt, s1, branch, writeStatus };
    }
    const main = await makeJob({ slug: 'visit-audit', title: 'Visit audit', branch: 'feature/other-thing', folder: 'other-thing', stage: 'pr1', stageState: 'waiting_for_you', commit: '[S1] the form' });
    const merged = await makeJob({ slug: 'visit-export', title: 'Visit export', branch: 'feature/export-thing', folder: 'export-thing', stage: 'pr2', stageState: 'working', commit: '[S1] the export' });
    // The Tester checked the base commit: the guessed branch has moved on since.
    await fs.writeFile(path.join(main.dir, 'test-report.md'), `# Test report\n\n- Commit under test: ${baseSha}\n\n## Results\n- AC-1 PASS\n`);
    // The review-walkthrough skill's page for that branch, run in its worktree.
    await fs.mkdir(path.join(dirs.walk, 'other-thing'), { recursive: true });
    await fs.writeFile(path.join(dirs.walk, 'other-thing', 'feature-other-thing.html'), '<!doctype html><title>Walkthrough</title><p>Another job’s changes.</p>\n');
    // The finish line at PR #1 open, so the header's "where the work is" would say so from the map's lane.
    await fs.writeFile(path.join(dirs.state, 'settings.json'), JSON.stringify({ workflow: { finishLine: 'pr1-open' } }));

    const d = await startDashboard({
      env: {
        HOME: dirs.home, STARBASE_DEMO: '1', STARBASE_FEATURES_DIR: dirs.features, STARBASE_PROJECTS_DIR: dirs.projects, STARBASE_AGENTS_DIR: dirs.agents,
        STARBASE_SKILLS_DIR: dirs.skills, STARBASE_STATE_DIR: dirs.state, STARBASE_WALKTHROUGHS_DIR: dirs.walk,
      },
      output: [],
    });
    guessedDashboard = d;
    const get = async (p) => {
      const res = await fetch(`${d.base}${p}`);
      assert.equal(res.status, 200, `GET ${p}`);
      return res.json();
    };
    const found = async (slug) => ((await fetch(`${d.base}/api/job/${slug}`)).status === 200 ? get(`/api/job/${slug}`) : null);
    const refresh = () => fetch(`${d.base}/api/flow/refresh`, { method: 'POST', headers: { 'X-Starbase-Token': d.token } });
    // A change in the folder first, so the map's recount after a change has just run (it runs at most every 15 seconds).
    await fs.writeFile(path.join(main.dir, 'notes.md'), 'Seen.\n');
    await sleep(1500);
    // The branches are the jobs' own: PR #1 open and [S1] built for one, PR #1 merged for the other.
    let job = null;
    let exp = null;
    for (const end = Date.now() + 20_000; Date.now() < end; await sleep(250)) {
      job = await found(main.slug);
      exp = await found(merged.slug);
      if (job?.page?.prs?.[0]?.state === 'open' && exp?.page?.prs?.[0]?.state === 'merged') break;
      await refresh();
    }
    assert.equal(job?.page?.prs?.[0]?.state, 'open', 'the map shows PR #1 open while the branch is recorded');
    assert.deepEqual(job.page.plan.steps.map((s) => s.state), ['done', 'next'], 'its commits built [S1] while the branch is recorded');
    assert.deepEqual({ reached: job.finish?.reached, by: job.finish?.by }, { reached: true, by: 'pr1-open' }, 'the header says PR #1 is open while the branch is recorded');
    assert.deepEqual(job.repo, { name: 'repo', branch: 'feature/other-thing' }, 'a recorded branch carries no guess flag');
    assert.equal(job.worktree, main.wt, 'a recorded branch\'s worktree is the job\'s');
    assert.equal(exp?.page?.prs?.[0]?.state, 'merged', 'the map shows the other job\'s PR #1 merged while its branch is recorded');
    assert.deepEqual(exp.page.plan.steps.map((s) => s.state), ['done', 'done'], 'PR #1 merged: every step done while the branch is recorded');
    // Now both branches are only a guess.
    await main.writeStatus();
    await merged.writeStatus();
    for (const end = Date.now() + 10_000; Date.now() < end && !(job.locate?.branchGuessed && exp.locate?.branchGuessed); await sleep(100)) {
      job = await get(`/api/job/${main.slug}`);
      exp = await get(`/api/job/${merged.slug}`);
    }
    assert.deepEqual({ branch: job.branch, guessed: job.locate?.branchGuessed, located: job.locate?.worktree }, { branch: 'feature/other-thing', guessed: true, located: main.wt });
    assert.equal(exp.locate?.branchGuessed, true);
    return { d, get, slug: main.slug, dir: main.dir, repo: gRepo, wt: main.wt, baseSha, s1: main.s1, merged };
  })();
  return guessed;
}

test('the page\'s plan shows no commits from a guessed branch', { timeout: 60_000 }, async () => {
  const w = await guessedWorld();
  const job = await w.get(`/api/job/${w.slug}`);
  assert.deepEqual(job.page.plan.steps.map((s) => s.state), ['next', 'next'], 'no step is built by the guessed branch\'s [S1]');
  for (const stop of ['plan', 'build']) {
    assert.deepEqual((await w.get(`/api/job/${w.slug}/stage/${stop}`)).plan.steps.map((s) => s.state), ['next', 'next'], stop);
  }
});

test('the page\'s pull requests are empty for a guessed branch', { timeout: 60_000 }, async () => {
  const w = await guessedWorld();
  const none = [1, 2, 3].map((n) => ({ n, number: null, title: null, url: null, state: 'not-started', review: null, checks: null, openedAt: null, updatedAt: null }));
  assert.deepEqual((await w.get(`/api/job/${w.slug}`)).page.prs, none, 'not the guessed branch\'s PR #1');
  assert.deepEqual((await w.get(`/api/job/${w.slug}/stage/ship`)).prs, none, 'the Ship step');
});

test('the Build step\'s commits are none for a guessed branch, as for a job with no branch', { timeout: 60_000 }, async () => {
  const w = await guessedWorld();
  const list = await w.get(`/api/job/${w.slug}/commits`);
  assert.deepEqual({ commits: list.commits, head: list.head ?? null, note: list.note }, { commits: [], head: null, note: 'No feature branch yet. Commits show up here once building starts.' });
  assert.notEqual(list.dir, w.wt, 'not the guessed worktree');
});

test('a commit\'s changed files are never read in the worktree of a guessed branch', { timeout: 60_000 }, async () => {
  const w = await guessedWorld();
  const shown = await w.get(`/api/job/${w.slug}/commit/${w.s1}`);
  assert.equal(shown.dir, w.repo, 'read in the job\'s repository, not the guessed worktree');
});

test('the checks\' commit is never compared with a guessed branch\'s head', { timeout: 60_000 }, async () => {
  const w = await guessedWorld();
  const job = await w.get(`/api/job/${w.slug}`);
  assert.ok(job.gate, 'the job waits for you');
  assert.deepEqual({ tested: job.gate.proof?.tested, head: job.gate.proof?.head, stale: job.gate.proof?.stale }, { tested: w.baseSha, head: null, stale: false });
});

test('a guessed branch\'s review walkthrough is not the job\'s', { timeout: 60_000 }, async () => {
  const w = await guessedWorld();
  assert.equal((await w.get(`/api/job/${w.slug}`)).walkthrough ?? null, null);
  const page = await fetch(`http://127.0.0.1:${w.d.screensPort}/job/${w.slug}/walkthrough`);
  assert.equal(page.status, 404, 'the screens server serves no walkthrough for it');
});

test('the header\'s place of the work never comes from a guessed branch\'s pull request', { timeout: 60_000 }, async () => {
  const w = await guessedWorld();
  const job = await w.get(`/api/job/${w.slug}`);
  assert.equal(job.finish?.reached, false, 'not "PR #1 open from your fork" by the guessed branch\'s PR #1');
});

/** The slugs the flow map has a lane for now (GET /api/flow). */
const laneSlugs = async (w) => (await w.get('/api/flow')).repos.flatMap((r) => r.lanes ?? []).map((l) => l.slug);

test('the plan is all done by a merged PR #1 only while the branch is recorded, never by a guessed branch\'s lane', { timeout: 60_000 }, async () => {
  const w = await guessedWorld();
  // What a revert would wrongly read is still there: the map kept the lane it read while the branch was recorded.
  assert.ok((await laneSlugs(w)).includes(w.merged.slug), 'the map still has the guessed job\'s lane');
  const job = await w.get(`/api/job/${w.merged.slug}`);
  assert.deepEqual(job.page.plan.steps.map((s) => s.state), ['next', 'next'], 'not "all done" by the guessed branch\'s merged PR #1, nor built by its [S1]');
  assert.equal(job.page.prs[0].state, 'not-started');
});

test('the job\'s details name no worktree found only through a guessed branch, so Mark done offers none', { timeout: 60_000 }, async () => {
  const w = await guessedWorld();
  const job = await w.get(`/api/job/${w.slug}`);
  assert.equal(job.worktree ?? null, null);
  assert.equal(job.locate.worktree, w.wt, 'where the guess was found is still told (BranchGuess reads locate)');
});

test('the job\'s card says its branch is a guess', { timeout: 60_000 }, async () => {
  const w = await guessedWorld();
  assert.deepEqual((await w.get(`/api/job/${w.slug}`)).repo, { name: 'repo', branch: 'feature/other-thing', branchGuessed: true });
  const card = (await w.get('/api/snapshot')).jobs.find((j) => j.slug === w.slug);
  assert.deepEqual(card.repo, { name: 'repo', branch: 'feature/other-thing', branchGuessed: true }, 'the board\'s card too');
});

// Last of the guessed world's tests: it confirms the guess.
test('This is the job\'s branch tells every open page the job changed, and the job gets its lane back at once', { timeout: 60_000 }, async () => {
  const w = await guessedWorld();
  const { seq, epoch } = await w.get('/api/snapshot');
  const seen = [];
  const req = http.get(`${w.d.base}/api/events?v=2&since=${seq}&epoch=${epoch}`, (res) => {
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const data = buf.slice(0, i).split('\n').find((l) => l.startsWith('data: '));
        buf = buf.slice(i + 2);
        if (data) seen.push(JSON.parse(data.slice(6)));
      }
    });
  });
  req.on('error', () => {});
  try {
    // Start from a map with no lane for the job, so only the handler's own recount can give it back
    // in time: a change in the job's folder first (the map's recount after a change then waits 15
    // seconds), then a recount, which drops the guessed job's lane.
    await fs.writeFile(path.join(w.dir, 'notes.md'), 'Seen again.\n');
    for (let n = 0; n < 100 && !seen.some((e) => e.type === 'change'); n++) await sleep(50);
    assert.ok(seen.some((e) => e.type === 'change'), 'the folder\'s change was seen');
    const refreshed = await fetch(`${w.d.base}/api/flow/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Starbase-Token': w.d.token }, body: '{}' });
    assert.equal(refreshed.status, 202, await refreshed.text());
    for (let n = 0; n < 100 && (await laneSlugs(w)).includes(w.slug); n++) await sleep(50);
    assert.equal((await laneSlugs(w)).includes(w.slug), false, 'the map has no lane for the guessed job');
    assert.equal((await w.get(`/api/job/${w.slug}`)).page.prs[0].state, 'not-started');
    seen.length = 0;
    const res = await fetch(`${w.d.base}/api/job/${w.slug}/repo`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Starbase-Token': w.d.token }, body: JSON.stringify({ repoPath: w.repo, branch: 'feature/other-thing' }) });
    assert.equal(res.status, 200, await res.text());
    for (let n = 0; n < 60 && !seen.some((e) => e.type === 'change'); n++) await sleep(50);
    assert.ok(seen.some((e) => e.type === 'change'), `a change is broadcast: ${JSON.stringify(seen.map((e) => e.type))}`);
    // The map recounts now, not at its minute timer: PR #1 open again, from the job's own branch.
    let job = null;
    for (const end = Date.now() + 5_000; Date.now() < end; await sleep(100)) {
      job = await w.get(`/api/job/${w.slug}`);
      if (job.page.prs[0].state === 'open') break;
    }
    assert.deepEqual({ guessed: job.locate.branchGuessed, source: job.locate.branchSource, pr1: job.page.prs[0].state }, { guessed: false, source: 'your choice', pr1: 'open' });
  } finally {
    req.destroy();
  }
});
