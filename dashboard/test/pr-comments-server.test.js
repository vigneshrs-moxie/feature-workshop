// PR comments on the new job page through the real dashboard (Task 21, R3), in demo mode: the demo's flow map gives
// the job an open PR #1 and a fake gh (STARBASE_GH) has a review, two line comments (one his own) in one thread
// each, a conversation comment and a failed check. Pull now reads at once; every unanswered comment is a row (his
// own and the ones there before Starbase first looked included); Fix these sends one message quoting the ticked
// comments and marks them Fixing; Leave marks Left; Fix it sends a check's failing lines; Post it posts through
// lib/gh-write.js and the row says posted. A commit from another branch is "not on this branch". Nothing real is
// read or written: the folders are temporary and gh is a script that records each call.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const DASHBOARD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(DASHBOARD, 'server.js');

async function freePort() {
  for (;;) {
    const s = net.createServer();
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    const { port } = s.address();
    await new Promise((r) => s.close(r));
    if (![4477, 4479, 4485].includes(port)) return port;
  }
}

const roots = [];
const children = new Set();
after(async () => {
  for (const c of children) {
    if (c.exitCode !== null) continue;
    const gone = new Promise((r) => c.once('exit', r));
    c.kill('SIGTERM'); // only dashboards this test started
    await gone;
  }
  for (const r of roots) await fs.rm(r, { recursive: true, force: true });
});

// A fake gh: answers from fixture.json, writes each call to calls.jsonl, refuses anything else.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const here = path.dirname(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(path.join(here, 'calls.jsonl'), JSON.stringify(args) + '\\n');
const fx = JSON.parse(fs.readFileSync(path.join(here, 'fixture.json'), 'utf8'));
const get = args[0] === 'api' && args[1] === '--method' && args[2] === 'GET';
let out = null;
if (args[0] === 'pr' && args[1] === 'view' && args.includes('statusCheckRollup,headRefOid')) out = JSON.stringify(fx.rollup);
else if (get && /\\/pulls\\/\\d+\\/comments/.test(args[3])) out = JSON.stringify(fx.comments);
else if (get && /\\/pulls\\/\\d+\\/reviews/.test(args[3])) out = JSON.stringify(fx.reviews);
else if (get && /\\/issues\\/\\d+\\/comments/.test(args[3])) out = JSON.stringify(fx.issue);
else if (get && args[3] === 'user') out = JSON.stringify({ login: 'you' });
else if (args[0] === 'run' && args[1] === 'view' && args[2] === '4242' && args.includes('--log-failed')) out = fx.log;
else if (args[0] === 'api' && args[1] === '--method' && args[2] === 'POST' && /\\/pulls\\/\\d+\\/comments\\/901\\/replies$/.test(args[3])) out = JSON.stringify({ id: 990 });
if (out === null) { process.stderr.write('fake gh: not expected: ' + args.join(' ') + '\\n'); process.exit(1); }
process.stdout.write(out);
`;

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim();

async function makeJob() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-prc-server-')));
  roots.push(root);
  const featuresDir = path.join(root, 'feature-work');
  const repo = path.join(root, 'sample-repo');
  const ghDir = path.join(root, 'gh');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state'), home: path.join(root, 'home') };
  for (const d of [featuresDir, repo, ghDir, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  // The repository: the job's branch with one commit, and another branch with a commit that is not the job's.
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'commit', '--allow-empty', '-q', '-m', 'base');
  const baseSha = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', '-b', 'feature/sample-job');
  await fs.mkdir(path.join(repo, 'web', 'src'), { recursive: true });
  await fs.writeFile(path.join(repo, 'web', 'src', 'App.tsx'), 'import x\nimport y\nlet a = 1\nexport a\n');
  git(repo, 'add', 'web/src/App.tsx');
  git(repo, 'commit', '-q', '-m', 'Add the app');
  const head = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', '-b', 'feature/other', baseSha);
  git(repo, 'commit', '--allow-empty', '-q', '-m', 'Someone else’s work');
  const other = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'main');

  const job = path.join(featuresDir, 'sample-job');
  await fs.mkdir(path.join(job, 'briefs'), { recursive: true });
  await fs.writeFile(path.join(job, 'status.json'), JSON.stringify({
    schema_version: 1, slug: 'sample-job', title: 'Sample job', route: 'small', stage: 'pr1', stage_state: 'in_progress',
    repo: { path: repo }, branch: 'feature/sample-job', base_sha: baseSha, updated_at: '2026-11-14T10:00:00Z',
  }, null, 2));
  await fs.writeFile(path.join(dirs.state, 'sessions.json'), JSON.stringify({ [job]: { sessionId: 'sess-pr-comments', cwd: repo, model: 'claude-opus-5-5' } }));
  await fs.writeFile(path.join(ghDir, 'fixture.json'), JSON.stringify({
    rollup: { headRefOid: head, statusCheckRollup: [{ name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/acme/sample-repo/actions/runs/4242/job/9' }] },
    comments: [
      { id: 901, user: { login: 'ana', type: 'User' }, path: 'web/src/App.tsx', line: 3, body: 'Please use a const here.', html_url: 'https://github.com/acme/sample-repo/pull/1#discussion_r901', created_at: '2026-11-13T10:00:00Z' },
      { id: 902, user: { login: 'you', type: 'User' }, path: 'web/src/App.tsx', line: 4, body: 'My own note: export it by name.', html_url: 'https://github.com/acme/sample-repo/pull/1#discussion_r902', created_at: '2026-11-13T10:01:00Z' },
    ],
    reviews: [{ id: 55, user: { login: 'bo', type: 'User' }, state: 'CHANGES_REQUESTED', body: 'A few things first.', html_url: 'x', submitted_at: '2026-11-13T09:59:00Z' }],
    issue: [{ id: 77, user: { login: 'raj', type: 'User' }, body: 'Why two queries?', html_url: 'https://github.com/acme/sample-repo/pull/1#issuecomment-77', created_at: '2026-11-13T10:05:00Z' }],
    log: 'lint\tRun lint\tsrc/a.js: x is unused\nlint\tRun lint\t##[error]Process completed with exit code 1.\n',
  }));
  const gh = path.join(ghDir, 'gh.cjs');
  await fs.writeFile(gh, FAKE_GH, { mode: 0o755 });
  const env = {
    HOME: dirs.home, USERPROFILE: dirs.home, STARBASE_DEMO: '1', STARBASE_FEATURES_DIR: featuresDir, STARBASE_PROJECTS_DIR: dirs.projects,
    STARBASE_AGENTS_DIR: dirs.agents, STARBASE_SKILLS_DIR: dirs.skills, STARBASE_STATE_DIR: dirs.state, STARBASE_GH: gh,
  };
  const audit = () => (fsSync.existsSync(path.join(dirs.state, 'audit.jsonl')) ? fsSync.readFileSync(path.join(dirs.state, 'audit.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const ghCalls = () => (fsSync.existsSync(path.join(ghDir, 'calls.jsonl')) ? fsSync.readFileSync(path.join(ghDir, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { env, audit, ghCalls, job, other, head };
}

async function startDashboard(env) {
  const port = await freePort();
  let wport = await freePort();
  while (wport === port) wport = await freePort();
  const output = [];
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env, PORT: String(port), WIREFRAMES_PORT: String(wport) }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The dashboard didn't start:\n${output.join('')}`)), 15000);
    child.stdout.on('data', (d) => { output.push(String(d)); if (output.join('').includes('Starbase running')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', (d) => output.push(String(d)));
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`The dashboard exited (${code}):\n${output.join('')}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const token = (await (await fetch(`${base}/api/meta`)).json()).token;
  const get = async (p) => { const res = await fetch(base + p); return { status: res.status, body: await res.json() }; };
  const write = async (p, body = {}) => {
    const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Starbase-Token': token }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const waitFor = async (fn, what, ms = 20000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.\n${output.join('')}`);
      await sleep(100);
    }
  };
  return { get, write, waitFor, output };
}

test('server: Pull now reads at once; every unanswered comment is a row; Fix these, Leave, Fix it and Post it', { timeout: 120_000 }, async () => {
  const { env, audit, ghCalls, other, head } = await makeJob();
  const d = await startDashboard(env);
  // The page has the job (the read is only for jobs the new page has), then Pull now.
  assert.equal((await d.get('/api/job/sample-job/page')).status, 200);
  const before = (await d.get('/api/job/sample-job/pr/1')).body;
  assert.ok(Array.isArray(before.rows));
  const pulled = await d.write('/api/job/sample-job/pr/1/pull');
  assert.deepEqual(pulled.body, { reading: true });
  const v = await d.waitFor(async () => { const r = (await d.get('/api/job/sample-job/pr/1')).body; return r.rows?.length ? r : null; }, 'the rows');
  assert.ok(Date.now() - Date.parse(v.readAt) < 60_000, 'read just now');
  assert.deepEqual(v.rows.map((r) => [r.id, r.author, r.mine, r.state]), [['r55', 'bo', false, 'new'], ['c901', 'ana', false, 'new'], ['c902', 'you', true, 'new'], ['i77', 'raj', false, 'new']]);
  const c901 = v.rows.find((r) => r.id === 'c901');
  assert.equal(c901.file, 'web/src/App.tsx');
  assert.equal(c901.line, 3);
  assert.equal(c901.body, 'Please use a const here.');
  assert.deepEqual(c901.context, ['import y', 'let a = 1', 'export a'], 'the three code lines, from the PR’s head in the worktree');
  assert.deepEqual(v.checks.map((c) => [c.name, c.state]), [['lint', 'failed']]);
  assert.match(v.checks[0].log, /x is unused/);
  assert.equal(v.verdict.state, 'changes_requested');
  assert.deepEqual({ fresh: v.line.comments.fresh, total: v.line.comments.total }, { fresh: 4, total: 4 });
  const page = (await d.get('/api/job/sample-job/page')).body;
  assert.deepEqual(page.prMove, { n: 1, fresh: 4, since: '2026-11-13T09:59:00Z' });
  assert.ok(!JSON.stringify(page).includes('Please use a const'), 'the rows are a body, never in the payload');

  // A comment the page wasn't shown: nothing goes.
  const stale = await d.write('/api/job/sample-job/pr/1/fix', { ids: ['c999'] });
  assert.equal(stale.status, 409);
  assert.equal((await d.write('/api/job/sample-job/pr/1/fix', { ids: [] })).status, 400);

  // Fix these: one message, quoting each ticked comment; the rows say Fixing.
  const fix = await d.write('/api/job/sample-job/pr/1/fix', { ids: ['c901', 'i77'] });
  assert.equal(fix.status, 200, JSON.stringify(fix.body));
  assert.match(fix.body.text, /^Please fix these 2 review comments on PR #1/);
  assert.ok(fix.body.text.includes('c901 · web/src/App.tsx line 3 · ana\n   > Please use a const here.'));
  assert.ok(fix.body.text.includes('i77 · conversation · raj\n   > Why two queries?'));
  const fixing = await d.waitFor(async () => { const r = (await d.get('/api/job/sample-job/pr/1')).body; return r.rows.find((x) => x.id === 'c901')?.state === 'fixing' ? r : null; }, 'Fixing');
  assert.equal(fixing.rows.find((x) => x.id === 'i77').state, 'fixing');
  assert.equal(fixing.rows.find((x) => x.id === 'r55').state, 'new');
  const line = audit().find((e) => e.action === 'pr-comments' && e.what === 'fix');
  assert.deepEqual(line.ids, ['c901', 'i77']);
  const detail = (await d.get('/api/job/sample-job')).body;
  assert.ok(detail.thread.some((t) => t.kind === 'you' && String(t.text).includes('--- PR comments (2) ---')), 'his message in the conversation');

  // Leave: Left, nothing sent.
  assert.equal((await d.write('/api/job/sample-job/pr/1/leave', { ids: ['r55'] })).status, 200);
  await d.waitFor(async () => (await d.get('/api/job/sample-job/pr/1')).body.rows.find((x) => x.id === 'r55')?.state === 'left', 'Left');

  // Post it: through lib/gh-write.js, in the thread of the line comment; the row says posted.
  const posted = await d.write('/api/job/sample-job/pr/1/reply', { id: 'c901', body: 'Done: it is a const now.' });
  assert.equal(posted.status, 200, JSON.stringify(posted.body));
  const replyCall = ghCalls().find((c) => c[1] === '--method' && c[2] === 'POST');
  assert.match(replyCall[3], /\/pulls\/\d+\/comments\/901\/replies$/);
  assert.deepEqual(replyCall.slice(4), ['-f', 'body=Done: it is a const now.']);
  assert.ok(audit().some((e) => e.action === 'gh-write' && e.what === 'reply' && e.ok === true), 'the write is audited with his yes');
  const after = await d.waitFor(async () => { const r = (await d.get('/api/job/sample-job/pr/1')).body; return r.rows.find((x) => x.id === 'c901')?.reply?.posted ? r : null; }, 'Posted');
  assert.equal(after.rows.find((x) => x.id === 'c901').reply.posted, 'Done: it is a const now.');
  // Every other gh call was a read.
  for (const c of ghCalls()) if (c !== replyCall && !(c[1] === '--method' && c[2] === 'POST')) assert.ok((c[0] === 'api' && c[2] === 'GET') || c[0] === 'pr' || c[0] === 'run', `a read: ${c.join(' ')}`);
  assert.equal(ghCalls().filter((c) => c[2] === 'POST').length, 1, 'one write: his Post it');

  // Fix it: the failed check's failing lines go to the Foreman (once its last reply ended); the check says Fixing.
  // The pretend Foreman asks one permission per reply: allowed here, so its reply ends.
  const free = async () => {
    for (const p of (await d.get('/api/snapshot')).body.permissions.filter((x) => x.slug === 'sample-job' && !x.feedbackCard && !x.roundCard)) await d.write(`/api/permissions/${p.id}`, { decision: 'allow' });
    const r = (await d.get('/api/job/sample-job')).body.run;
    return !r || !['starting', 'running', 'waiting_permission', 'stopping'].includes(r.status);
  };
  await d.waitFor(free, 'the Foreman’s reply to end', 30000);
  const check = await d.write('/api/job/sample-job/pr/1/fix-check', { name: 'lint' });
  assert.equal(check.status, 200, JSON.stringify(check.body));
  assert.match(check.body.text, /^A check failed on PR #1 \(#\d+\): lint\./);
  assert.match(check.body.text, /x is unused/);
  await d.waitFor(async () => (await d.get('/api/job/sample-job/pr/1')).body.checks[0]?.state === 'fixing', 'the check Fixing');
  assert.equal((await d.write('/api/job/sample-job/pr/1/fix-check', { name: 'test' })).status, 409, 'not a failing check: nothing sent');

  // A commit the job's branch has shows; one from another branch is "not on this branch".
  const mine = await d.get(`/api/job/sample-job/commit/${head}`);
  assert.equal(mine.status, 200);
  const theirs = await d.get(`/api/job/sample-job/commit/${other}`);
  assert.equal(theirs.status, 404);
  assert.equal(theirs.body.code, 'no-commit');
  assert.match(theirs.body.error, /is not on this branch\./);
});
