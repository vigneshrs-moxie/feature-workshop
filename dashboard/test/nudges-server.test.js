// Hand-off nudges through the real dashboard (lib/nudges.js, server.js): each card carries its
// `nudges`; POST /api/job/:slug/nudge/:id/dismiss remembers a dismissal for that job; …/yes sends
// the nudge's sentence to the job's Foreman as a message from the box would, audited. Starts the
// dashboard in demo mode (a pretend Foreman, nothing real runs) on temp folders: no real job,
// ~/.claude or ~/.feature-workshop is touched and no Claude usage is spent.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const URL1 = 'https://github.com/example/acme-portal/pull/44';
const URL2 = 'https://github.com/example/acme-portal/pull/45';

let root, child, base, token;
const output = [];

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-nudges-')));
  const featuresDir = path.join(root, 'feature-work');
  const repo = path.join(root, 'sample-repo');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state'), home: path.join(root, 'home') };
  for (const d of [featuresDir, repo, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  const job = async (slug, extra) => {
    await fs.mkdir(path.join(featuresDir, slug, 'briefs'), { recursive: true });
    await fs.writeFile(path.join(featuresDir, slug, 'status.json'), JSON.stringify({
      schema_version: 1, slug, title: `Job ${slug}`, route: 'small', stage_state: 'blocked', waiting_for: null,
      repo: { path: repo }, branch: `feature/${slug}`, updated_at: '2026-10-20T10:00:00Z', ...extra,
    }, null, 2));
  };
  // PR #1 open from the fork: "Self-review and merge PR #1" (a link). Before the default finish line.
  await job('pr1-job', { stage: 'pr1', prs: [{ number: 1, label: 'fork → org branch', url: URL1, state: 'open' }] });
  // PR #1 merged, PR #2 open: "Ask Raj for a review?" (yes asks the Foreman). Past the default line.
  const pr2 = { stage: 'pr2', prs: [{ number: 1, url: URL1, state: 'merged' }, { number: 2, url: URL2, state: 'open' }] };
  await job('pr2-job', pr2);
  await job('pr2-other', pr2);
  await job('plain-job', { stage: 'plan', stage_state: 'working' });

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), HOME: dirs.home, WORKSHOP_DEMO: '1',
      WORKSHOP_FEATURES_DIR: featuresDir, WORKSHOP_PROJECTS_DIR: dirs.projects, WORKSHOP_AGENTS_DIR: dirs.agents,
      WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: dirs.state,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The dashboard didn't start:\n${output.join('')}`)), 15000);
    child.stdout.on('data', (d) => { output.push(String(d)); if (output.join('').includes('Feature Workshop running')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', (d) => output.push(String(d)));
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`The dashboard exited (${code}):\n${output.join('')}`)); });
  });
  token = (await (await fetch(`${base}/api/meta`)).json()).token;
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM'); // exactly the dashboard this test started
    await gone;
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const post = async (p, body = {}, { auth = true } = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Workshop-Token': token } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const get = async (p) => (await fetch(base + p)).json();
const cardOf = async (slug) => (await get('/api/snapshot')).jobs.find((j) => j.slug === slug);

async function waitFor(fn, what, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.\n${output.join('')}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('server: every card carries its nudges, after the finish line or not', async () => {
  const pr1 = await cardOf('pr1-job');
  // The link: the demo flow map's PR once it is read, the record's until then.
  assert.deepEqual(pr1.nudges.map((n) => [n.id, n.kind, /^https:\/\/github\.com\/.+\/pull\/\d+$/.test(n.link), n.action, n.afterLine]), [['pr1-merge', 'link', true, null, false]]);
  assert.equal(pr1.nudges[0].title, 'Self-review and merge PR #1 on GitHub');
  const pr2 = await cardOf('pr2-job');
  assert.deepEqual(pr2.nudges.map((n) => [n.id, n.kind, n.link, n.action, n.afterLine]), [['pr2-review', 'ask', null, { send: 'Please request Raj’s review on PR #2.' }, true]]);
  assert.equal(pr2.group, 'shipping', 'past the default finish line (PR #1 merged)');
  assert.deepEqual((await cardOf('plain-job')).nudges, []);
});

test('server: dismiss remembers the nudge for that job alone, and is audited', async () => {
  assert.equal((await post('/api/job/pr2-job/nudge/pr2-review/dismiss', {}, { auth: false })).status, 403, 'a write needs the page token');
  assert.equal((await post('/api/job/pr2-job/nudge/nonsense/dismiss')).status, 404);
  assert.equal((await post('/api/job/no-such-job/nudge/pr2-review/dismiss')).status, 404);
  const r = await post('/api/job/pr2-job/nudge/pr2-review/dismiss');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, dismissed: ['pr2-review'] });
  assert.deepEqual((await cardOf('pr2-job')).nudges, [], 'gone from the card');
  assert.equal((await cardOf('pr2-other')).nudges.length, 1, 'the other job keeps its own');
  const again = await post('/api/job/pr2-job/nudge/pr2-review/dismiss');
  assert.deepEqual(again.body.dismissed, ['pr2-review'], 'dismissing twice stores it once');
  const detail = await get('/api/job/pr2-job');
  assert.ok(detail.audit.some((e) => e.action === 'nudge-dismissed' && e.nudge === 'pr2-review'), JSON.stringify(detail.audit));
});

test('server: yes sends the nudge’s sentence to the Foreman as a message, audited like a gate reply', async () => {
  assert.equal((await post('/api/job/pr1-job/nudge/pr1-merge/yes')).status, 400, 'a link nudge has nothing to send');
  const stale = await post('/api/job/pr2-other/nudge/pr2-open/yes');
  assert.equal(stale.status, 409, 'PR #2 is already open: that nudge no longer applies');
  assert.equal(stale.body.code, 'stale-nudge');
  const r = await post('/api/job/pr2-other/nudge/pr2-review/yes');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sent, true);
  assert.equal(r.body.text, 'Please request Raj’s review on PR #2.');
  assert.ok(r.body.run?.id);
  const detail = await waitFor(async () => { const d = await get('/api/job/pr2-other'); return d.thread.some((t) => t.kind === 'you') ? d : null; }, 'the message in the thread');
  const you = detail.thread.find((t) => t.kind === 'you');
  // A job with no Foreman session yet gets the /feature header first, as a message from the box does.
  assert.ok(you.text.endsWith('\n\nPlease request Raj’s review on PR #2.'), you.text);
  assert.equal(you.sendKind, 'nudge');
  const line = detail.audit.find((e) => e.action === 'nudge');
  assert.equal(line.nudge, 'pr2-review');
  assert.equal(line.runId, r.body.run.id);
  assert.ok(detail.audit.some((e) => e.action === 'send' && e.kind === 'nudge' && e.text === you.text), 'the send line, as a gate reply has one');
});
