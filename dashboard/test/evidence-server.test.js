// Evidence at the test stage, end to end on a demo dashboard (packet L): no browser and no network.
// Playwright is replaced by the fake in dashboard/test/fixtures/evidence/ (WORKSHOP_PLAYWRIGHT),
// which copies that folder's pictures, videos and JSON report where the real one would write them.
// An L2 job gets evidence.json with pictures and a video per acceptance line, once per commit; an
// L0 job gets none; a report written while the dashboard runs is recorded by itself; the file
// route serves inside the job's evidence/ folder and nothing outside it.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDashboard } from './helpers/dashboard.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'evidence');
const OLD = '2026-10-01T10:00:00Z';

let root, featuresDir, stateDir, dashboard, base, token;
const output = [];

const REPORT = (commit) => `# Test report

- Branch: feature/hours-column
- Commit under test: ${commit}

## Results
- AC-1 PASS
- AC-2 FAIL

## Evidence

- AC-1: Managers see the Hours column. Spec: evidence/specs/AC-1.spec.mjs
- AC-2: The export button is hidden from technicians. Spec: evidence/specs/AC-2.spec.mjs
- AC-3: The export API refuses other offices. No spec: API only; the route test covers it.
`;
const SPEC = (n) => `import { test, expect } from '@playwright/test';\ntest('AC-${n}: criterion ${n}', async ({ page }) => {\n  await page.goto('/');\n  await expect(page).toHaveTitle(/./);\n});\n`;

/** A job waiting at its test gate, with a worktree, its options and (unless report is null) its report and two specs. */
async function writeJob(slug, { level, report = REPORT('abc1234def5') }) {
  const dir = path.join(featuresDir, slug);
  const worktree = path.join(root, 'worktrees', slug);
  await fs.mkdir(path.join(dir, 'evidence', 'specs'), { recursive: true });
  await fs.mkdir(worktree, { recursive: true });
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({
    schema_version: 1, slug, title: `Job ${slug}`, route: 'small', stage: 'test', stage_state: 'working', worktree,
    repo: { path: worktree, base_branch: 'main' }, updated_at: OLD,
  }, null, 2));
  await fs.writeFile(path.join(dir, 'options.json'), JSON.stringify({ schema_version: 2, level, flow: 'small', title: `Job ${slug}` }, null, 2));
  for (const n of [1, 2]) await fs.writeFile(path.join(dir, 'evidence', 'specs', `AC-${n}.spec.mjs`), SPEC(n));
  if (report) {
    await fs.writeFile(path.join(dir, 'test-report.md'), report);
    // Written well before now: the recorder waits for a report that is still changing.
    const then = new Date(Date.now() - 60_000);
    await fs.utimes(path.join(dir, 'test-report.md'), then, then);
  }
  return dir;
}

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-evidence-server-')));
  featuresDir = path.join(root, 'feature-work');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state'), home: path.join(root, 'home') };
  for (const d of [featuresDir, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  stateDir = dirs.state;
  await writeJob('hours-column', { level: 2, report: null });
  await writeJob('tiny-tweak', { level: 0 });
  await writeJob('later-report', { level: 3, report: null });
  dashboard = await startDashboard({
    env: {
      HOME: dirs.home, WORKSHOP_DEMO: '1', WORKSHOP_PLAYWRIGHT: path.join(FIXTURE, 'fake-playwright.mjs'),
      WORKSHOP_FEATURES_DIR: featuresDir, WORKSHOP_PROJECTS_DIR: dirs.projects, WORKSHOP_AGENTS_DIR: dirs.agents,
      WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: dirs.state,
    },
    output,
  });
  ({ base, token } = dashboard);
});

after(async () => {
  await dashboard?.stop(); // exactly the dashboard this test started, and what it started
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const get = (p, headers = {}) => fetch(base + p, { headers });
const getJson = async (p) => (await get(p)).json();
const post = (p, body = {}, { withToken = true } = {}) => fetch(base + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(withToken ? { 'X-Workshop-Token': token } : {}) }, body: JSON.stringify(body),
});
const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });
// Every v2 event of this dashboard run, read for `ms` milliseconds.
function eventsFor(ms, epoch) {
  return new Promise((resolve) => {
    const seen = [];
    const req = http.get(`${base}/api/events?v=2&since=0&epoch=${epoch}`, (res) => {
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
    setTimeout(() => { req.destroy(); resolve(seen); }, ms);
  });
}
const fileUrl = (slug, rel) => `/api/job/${slug}/evidence/file?path=${encodeURIComponent(rel)}`;

test('evidence server: before recording, the strip’s view says whether the job records evidence and why', async () => {
  const l2 = await getJson('/api/job/hours-column/evidence');
  assert.equal(l2.evidence, null);
  assert.equal(l2.wanted, true);
  assert.equal(l2.commit, null, 'no test report yet');
  assert.match(l2.folderUrl, /^file:\/\/.*\/hours-column\/evidence\/$/);
  const l0 = await getJson('/api/job/tiny-tweak/evidence');
  assert.equal(l0.wanted, false);
  assert.equal(l0.why, 'An L0 tweak never records evidence.');
  assert.equal((await get('/api/job/no-such-job/evidence')).status, 404);
});

test('evidence server: Record needs the page’s token', async () => {
  assert.equal((await post('/api/job/hours-column/evidence/record', {}, { withToken: false })).status, 403);
});

/** The job's evidence once it is there (the recorder may have started by itself). */
async function evidenceOf(slug) {
  for (let i = 0; i < 60; i++) {
    const view = await getJson(`/api/job/${slug}/evidence`);
    if (view.evidence) return view.evidence;
    await pause(250);
  }
  assert.fail(`no evidence for ${slug}:\n${output.join('').slice(-2000)}`);
}

test('evidence server: an L2 job gets evidence.json with pictures and a video per acceptance line, once per commit', async () => {
  await fs.writeFile(path.join(featuresDir, 'hours-column', 'test-report.md'), REPORT('abc1234def5'));
  // Record at once (the page's Record); when the recorder saw the report first, it says it is busy.
  const res = await post('/api/job/hours-column/evidence/record');
  const body = await res.json();
  assert.ok(res.status === 200 || (res.status === 409 && body.code === 'busy'), JSON.stringify(body));
  const ev = res.status === 200 ? body.evidence : await evidenceOf('hours-column');
  assert.equal(ev.version, 1);
  assert.equal(ev.commit, 'abc1234def5');
  assert.equal(ev.level, 2);
  assert.deepEqual(ev.criteria.map((c) => [c.id, c.status]), [['AC-1', 'passed'], ['AC-2', 'failed'], ['AC-3', 'skipped']]);
  for (const c of ev.criteria.filter((x) => x.status !== 'skipped')) {
    assert.ok(c.screenshots.length >= 1, `${c.id} has pictures`);
    assert.ok(c.screenshots.every((s) => s.description), `${c.id}: every picture has words`);
    assert.equal(c.video, `abc1234def5/${c.id}/video.webm`);
  }
  assert.equal(ev.criteria[2].reason, 'Nothing to see: API only; the route test covers it.');
  // On disk, in the job folder.
  const saved = JSON.parse(await fs.readFile(path.join(featuresDir, 'hours-column', 'evidence', 'evidence.json'), 'utf8'));
  assert.deepEqual(saved, ev);
  // The view the strip reads.
  const view = await getJson('/api/job/hours-column/evidence');
  assert.deepEqual(view.evidence, ev);
  assert.equal(view.recording, false);
  assert.match(view.folderUrl, /\/hours-column\/evidence\/abc1234def5\/$/);
  // Once per commit.
  const again = await post('/api/job/hours-column/evidence/record');
  assert.equal(again.status, 409);
  assert.equal((await again.json()).error, 'Already recorded for abc1234');
  // One audit line for the recording (none for the refusal).
  const audit = (await fs.readFile(path.join(stateDir, 'audit.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.action === 'evidence' && l.slug === 'hours-column');
  assert.deepEqual(audit.map((l) => [l.outcome, l.commit, l.passed, l.failed, l.skipped]), [['recorded', 'abc1234def5', 1, 1, 1]]);
  // One evidence event saying it was recorded (after the one saying it started).
  const { epoch } = await getJson('/api/snapshot');
  const seen = (await eventsFor(800, epoch)).filter((e) => e.type === 'evidence' && e.job === 'hours-column');
  assert.deepEqual(seen.map((e) => e.data.outcome), ['recording', 'recorded']);
  assert.equal(seen[1].data.commit, 'abc1234def5');
});

test('evidence server: an L0 job gets none, whatever it asks', async () => {
  const res = await post('/api/job/tiny-tweak/evidence/record');
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'An L0 tweak never records evidence.');
  await assert.rejects(fs.access(path.join(featuresDir, 'tiny-tweak', 'evidence', 'evidence.json')));
  assert.equal((await getJson('/api/job/tiny-tweak/evidence')).evidence, null);
});

test('evidence server: a report the tester writes while the dashboard runs is recorded by itself', async () => {
  const dir = path.join(featuresDir, 'later-report');
  await fs.writeFile(path.join(dir, 'test-report.md'), REPORT('fed9876cba1'));
  const ev = await evidenceOf('later-report');
  assert.equal(ev.commit, 'fed9876cba1');
  assert.equal(ev.level, 3);
  assert.equal(ev.criteria.length, 3);
});

test('evidence server: the file route serves pictures and videos inside the job’s evidence/ folder and nothing else', async () => {
  const ev = (await getJson('/api/job/hours-column/evidence')).evidence;
  const shot = ev.criteria[0].screenshots[0].file;
  const png = await get(fileUrl('hours-column', shot));
  assert.equal(png.status, 200);
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await png.arrayBuffer()), await fs.readFile(path.join(FIXTURE, 'output', 'AC-1-chromium', '01.png')));
  // A video answers a byte range, so it can be scrubbed.
  const video = ev.criteria[0].video;
  const whole = await fs.readFile(path.join(FIXTURE, 'output', 'AC-1-chromium', 'video.webm'));
  const part = await get(fileUrl('hours-column', video), { Range: 'bytes=0-9' });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-type'), 'video/webm');
  assert.equal(part.headers.get('content-range'), `bytes 0-9/${whole.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), whole.subarray(0, 10));
  // Outside the folder, a symlink out of it, another job's, not a picture or video: all 404.
  const dir = path.join(featuresDir, 'hours-column');
  await fs.writeFile(path.join(dir, 'outside.png'), 'not evidence');
  await fs.symlink(path.join(dir, 'outside.png'), path.join(dir, 'evidence', 'link.png'));
  for (const p of ['../outside.png', '../test-report.md', '../../tiny-tweak/evidence/specs/AC-1.spec.mjs', `${dir}/outside.png`, 'link.png', 'evidence.json', 'specs/AC-1.spec.mjs', '']) {
    const res = await get(fileUrl('hours-column', p));
    assert.equal(res.status, 404, p || '(empty)');
  }
  // Another job's picture through this job's route isn't there either.
  assert.equal((await get(fileUrl('tiny-tweak', shot))).status, 404);
});
