// The job page's PR lines through the real dashboard (Task 20, R2): GET /api/job/:slug/pr/:n, Pull now,
// and his yes to a line's next action (POST …/pr/:n/go), which sends that action's fixed sentence to the
// Foreman only while the line still says the same. Demo mode (a pretend Foreman and a pretend flow map,
// lib/flow.js's shape from demo/fake-flow.js); one job's branch is in a real temp git repository so the
// commits a push carries are read from git. No real job, GitHub, ~/.claude or state folder is touched.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startDashboard } from './helpers/dashboard.js';
import jobPageRoutes from '../site/routes-job-page.js';

let root, dashboard, base, token;
const output = [];
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim();

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-prlines-')));
  const featuresDir = path.join(root, 'feature-work');
  const repo = path.join(root, 'sample-repo');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state'), home: path.join(root, 'home') };
  for (const d of [featuresDir, repo, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  // The repository: main, then feature/push-job two commits past what the fork has (refs/remotes/origin).
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, 'commit', '--allow-empty', '-q', '-m', 'base');
  const baseSha = sh(repo, 'rev-parse', 'HEAD');
  sh(repo, 'checkout', '-q', '-b', 'feature/push-job');
  sh(repo, 'commit', '--allow-empty', '-q', '-m', 'Add the damage table');
  sh(repo, 'commit', '--allow-empty', '-q', '-m', 'Show the damage list');
  sh(repo, 'update-ref', 'refs/remotes/origin/feature/push-job', baseSha);
  // feature/moved-job: one commit past the fork's copy (a commit lands on it between his look and his yes).
  sh(repo, 'checkout', '-q', '-b', 'feature/moved-job', baseSha);
  sh(repo, 'commit', '--allow-empty', '-q', '-m', 'Count the damages');
  sh(repo, 'update-ref', 'refs/remotes/origin/feature/moved-job', baseSha);
  sh(repo, 'checkout', '-q', 'main');
  const job = async (slug, extra) => {
    await fs.mkdir(path.join(featuresDir, slug, 'briefs'), { recursive: true });
    await fs.writeFile(path.join(featuresDir, slug, 'status.json'), JSON.stringify({
      schema_version: 1, slug, title: `Job ${slug}`, route: 'small', stage_state: 'blocked', waiting_for: null,
      repo: { path: repo }, branch: `feature/${slug}`, base_sha: baseSha, updated_at: '2026-10-20T10:00:00Z', ...extra,
    }, null, 2));
  };
  // PR #1 open (the pretend map opens it at pr1), two commits not on the fork: Push update (2 commits).
  await job('push-job', { stage: 'pr1', prs: [{ number: 1, url: 'https://github.com/example/acme/pull/44', state: 'open' }] });
  // PR #1 merged, PR #2 open with no approval: Request review.
  await job('review-job', { stage: 'pr2', prs: [{ number: 1, state: 'merged' }, { number: 2, state: 'open' }] });
  // The same, for a reply that ends in error (its folder is made read-only in that test).
  await job('review-error', { stage: 'pr2', prs: [{ number: 1, state: 'merged' }, { number: 2, state: 'open' }] });
  await job('moved-job', { stage: 'pr1', prs: [{ number: 1, url: 'https://github.com/example/acme/pull/45', state: 'open' }] });
  dashboard = await startDashboard({
    env: {
      HOME: dirs.home, STARBASE_DEMO: '1',
      STARBASE_FEATURES_DIR: featuresDir, STARBASE_PROJECTS_DIR: dirs.projects, STARBASE_AGENTS_DIR: dirs.agents,
      STARBASE_SKILLS_DIR: dirs.skills, STARBASE_STATE_DIR: dirs.state,
    },
    output,
  });
  ({ base } = dashboard);
  token = (await (await fetch(`${base}/api/meta`)).json()).token;
});

after(async () => {
  await dashboard?.stop();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const post = async (p, body = {}, { auth = true } = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Starbase-Token': token } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const get = async (p) => { const res = await fetch(base + p); return { status: res.status, body: await res.json() }; };

async function waitFor(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.\n${output.join('')}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
/** The line once the map has read GitHub and the cache has rebuilt with it. */
const lineOnce = (slug, n, ok) => waitFor(async () => { const r = await get(`/api/job/${slug}/pr/${n}`); return r.status === 200 && ok(r.body) ? r.body : null; }, `${slug} PR #${n}`);

test('server: a PR line from GitHub with its one next action; a stale yes is refused and nothing is sent', { timeout: 60_000 }, async () => {
  await get('/api/job/push-job/page');
  const v = await lineOnce('push-job', 1, (b) => b.line.next);
  assert.equal(v.line.state, 'open');
  assert.equal(v.line.next.id, 'push-update');
  assert.equal(v.line.next.label, 'Push update (2 commits)');
  assert.deepEqual(v.line.next.says.slice(1, 3), [
    `${sh(path.join(root, 'sample-repo'), 'rev-parse', '--short=7', 'feature/push-job')} Show the damage list`,
    `${sh(path.join(root, 'sample-repo'), 'rev-parse', '--short=7', 'feature/push-job~1')} Add the damage table`,
  ]);
  assert.ok(v.github.at, 'read from GitHub');
  // The demo's jobs are not in auto mode: the PR steps' go-ahead won't cover the Foreman's push, and the line says so.
  assert.equal(v.line.next.says.at(-1), 'Starbase will ask you once more when the Foreman pushes.');
  assert.match(v.line.next.sends, new RegExp(`git push origin ${sh(path.join(root, 'sample-repo'), 'rev-parse', 'feature/push-job')}:refs/heads/feature/push-job`), 'exactly the commit he saw');
  assert.equal((await get('/api/job/push-job/pr/4')).status, 404);
  assert.equal((await post('/api/job/push-job/pr/1/go', { id: 'push-update', check: v.line.next.check }, { auth: false })).status, 403, 'a yes needs the page token');
  assert.equal((await post('/api/job/push-job/pr/1/go', { id: 'push-update' })).status, 400, 'no check: refused');
  const stale = await post('/api/job/push-job/pr/1/go', { id: 'push-update', check: '0123456789ab' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'pr-moved');
  assert.match(stale.body.error, /Nothing was sent/);
  const wrong = await post('/api/job/push-job/pr/1/go', { id: 'push-open', check: v.line.next.check });
  assert.equal(wrong.status, 409, 'another action than the line’s');
  const detail = (await get('/api/job/push-job')).body;
  assert.ok(!detail.audit.some((e) => e.action === 'pr-line'), 'nothing sent');
  assert.ok(!detail.thread.some((t) => t.kind === 'you'));
});

test('server: his yes sends the line’s exact sentence to the Foreman once; the line then says it was sent', { timeout: 60_000 }, async () => {
  const v = await lineOnce('push-job', 1, (b) => b.line.next);
  const r = await post('/api/job/push-job/pr/1/go', { id: v.line.next.id, check: v.line.next.check });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.text, v.line.next.sends);
  assert.match(r.body.text, /^Please push feature\/push-job to origin as it is now: 2 commits PR #1 \(#\d+\) doesn’t have yet/);
  // A second yes while the first is on its way: refused, nothing sent twice.
  const again = await post('/api/job/push-job/pr/1/go', { id: v.line.next.id, check: v.line.next.check });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'pr-sent');
  const detail = await waitFor(async () => { const d = (await get('/api/job/push-job')).body; return d.thread.some((t) => t.kind === 'you') ? d : null; }, 'the message in the thread');
  const you = detail.thread.find((t) => t.kind === 'you');
  assert.ok(you.text.endsWith(`\n\n${v.line.next.sends}`), you.text);
  assert.equal(you.sendKind, 'nudge', 'Starbase’s fixed words, not his own');
  const line = detail.audit.find((e) => e.action === 'pr-line');
  assert.deepEqual([line.pr, line.id, line.text, line.runId], [1, 'push-update', v.line.next.sends, r.body.run.id]);
  const after = await lineOnce('push-job', 1, (b) => b.line.next === null);
  assert.equal(after.line.why, 'Sent to the Foreman');
  assert.equal(detail.audit.filter((e) => e.action === 'pr-line').length, 1, 'sent once');
});

test('server: Request review sends the nudge’s sentence and the Desk does not ask again', { timeout: 60_000 }, async () => {
  await get('/api/job/review-job/page');
  const v = await lineOnce('review-job', 2, (b) => b.line.next);
  assert.equal(v.line.next.label, 'Request review');
  const r = await post('/api/job/review-job/pr/2/go', { id: 'request-review', check: v.line.next.check });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.text, 'Please request Raj’s review on PR #2.');
  const card = (await get('/api/snapshot')).body.jobs.find((j) => j.slug === 'review-job');
  assert.deepEqual(card.nudges, [], 'the Desk’s nudge for it is gone (sent)');
  const after = await lineOnce('review-job', 2, (b) => b.line.next === null);
  assert.equal(after.line.why, 'Sent to the Foreman');
});

test('server: Pull now reads GitHub (the flow map’s read) and answers at once; the page opening reads it only when the last read is old', { timeout: 60_000 }, async () => {
  await waitFor(async () => (await get('/api/flow')).body.github?.triedAt, 'the first read');
  const opening = await get('/api/job/review-job/pr/1?read=old');
  assert.equal(opening.status, 200);
  assert.equal(opening.body.reading, false, 'read under two minutes ago: not again');
  const was = (await get('/api/flow')).body.github?.triedAt ?? null;
  await new Promise((r) => setTimeout(r, 20));
  const r = await post('/api/job/review-job/pr/1/pull');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { reading: true });
  await waitFor(async () => { const g = (await get('/api/flow')).body.github; return g?.triedAt && g.triedAt !== was ? g : null; }, 'a new GitHub read');
  assert.equal((await post('/api/job/no-such-job/pr/1/pull')).status, 404);
});

const ACTIVE = ['starting', 'running', 'waiting_permission', 'stopping'];

test('fix round 1: a commit that lands between his look and his yes: refused, nothing sent, and the line shows the new commit', { timeout: 60_000 }, async () => {
  await get('/api/job/moved-job/page');
  const v = await lineOnce('moved-job', 1, (b) => b.line.next);
  assert.equal(v.line.next.label, 'Push update (1 commit)');
  const repo = path.join(root, 'sample-repo');
  const tree = sh(repo, 'rev-parse', 'feature/moved-job^{tree}');
  const sha = sh(repo, 'commit-tree', tree, '-p', 'feature/moved-job', '-m', 'A late commit');
  sh(repo, 'update-ref', 'refs/heads/feature/moved-job', sha);
  const r = await post('/api/job/moved-job/pr/1/go', { id: v.line.next.id, check: v.line.next.check });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, 'pr-moved');
  const detail = (await get('/api/job/moved-job')).body;
  assert.ok(!detail.audit.some((e) => e.action === 'pr-line'), 'nothing sent');
  // A page that rebuilds the job sees the new commit (any change point does it; Pull now is one).
  await post('/api/job/moved-job/pr/1/pull');
  const after = await lineOnce('moved-job', 1, (b) => b.line.next?.label === 'Push update (2 commits)');
  assert.equal(after.line.next.says[1], `${sha.slice(0, 7)} A late commit`);
});

test('fix round 1: a Request review whose reply ends in error gives the button back and the Desk its nudge', { timeout: 90_000 }, async () => {
  await get('/api/job/review-error/page');
  const v = await lineOnce('review-error', 2, (b) => b.line.next);
  const dir = path.join(root, 'feature-work', 'review-error');
  // Nothing in the job's folder can be written, so the pretend Foreman's first write fails and the reply ends in error.
  await fs.chmod(path.join(dir, 'status.json'), 0o444);
  await fs.chmod(path.join(dir, 'briefs'), 0o555);
  await fs.chmod(dir, 0o555);
  try {
    const r = await post('/api/job/review-error/pr/2/go', { id: 'request-review', check: v.line.next.check });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ended = await waitFor(async () => {
      const { runs, permissions } = (await get('/api/runs')).body;
      for (const p of permissions.filter((x) => x.slug === 'review-error')) await post(`/api/permissions/${p.id}`, { decision: 'allow' });
      const run = runs.find((x) => x.id === r.body.run.id);
      return run && !ACTIVE.includes(run.status) ? run : null;
    }, 'the reply to end', 30000);
    assert.equal(ended.status, 'error', JSON.stringify(ended));
    await waitFor(async () => ((await get('/api/snapshot')).body.jobs.find((j) => j.slug === 'review-error')?.nudges ?? []).some((n) => n.id === 'pr2-review'), 'the Desk’s nudge back');
    const back = await lineOnce('review-error', 2, (b) => b.line.next?.id === 'request-review');
    assert.equal(back.line.why, null);
  } finally {
    await fs.chmod(dir, 0o755);
    await fs.chmod(path.join(dir, 'briefs'), 0o755);
    await fs.chmod(path.join(dir, 'status.json'), 0o644);
  }
});

test('routes: on the website (no runner’s local part) the PR routes are a 404 in plain words', async () => {
  const routes = jobPageRoutes({ read: {}, sendJson: () => {}, local: null });
  const view = routes.find((r) => r.method === 'GET' && r.path.test('/api/job/x/pr/1'));
  await assert.rejects(view.run({ res: null, m: ['', 'x', '1'] }), (err) => err.status === 404 && /on your own computer/.test(err.message));
});
