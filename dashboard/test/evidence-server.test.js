// Evidence at the test stage, end to end on a demo dashboard (packet L): no browser and no network.
// Playwright is replaced by the fake in dashboard/test/fixtures/evidence/ (STARBASE_PLAYWRIGHT),
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
import { evidenceRunner } from '../runner/evidence.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'evidence');
const OLD = '2026-10-01T10:00:00Z';

let root, featuresDir, stateDir, dashboard, base, token, hold;
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
  // The fake playwright holds after a recording's first line until this file is there: here from
  // the start, so only the tests that take it away see a recording part way.
  hold = path.join(root, 'hold');
  await fs.writeFile(hold, 'go');
  dashboard = await startDashboard({
    env: {
      HOME: dirs.home, STARBASE_DEMO: '1', STARBASE_PLAYWRIGHT: path.join(FIXTURE, 'fake-playwright.mjs'), STARBASE_FAKE_HOLD: hold,
      STARBASE_FEATURES_DIR: featuresDir, STARBASE_PROJECTS_DIR: dirs.projects, STARBASE_AGENTS_DIR: dirs.agents,
      STARBASE_SKILLS_DIR: dirs.skills, STARBASE_STATE_DIR: dirs.state,
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
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(withToken ? { 'X-Starbase-Token': token } : {}) }, body: JSON.stringify(body),
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
  const seen = (await eventsFor(800, epoch)).filter((e) => e.type === 'evidence' && e.job === 'hours-column' && e.data.outcome !== 'progress');
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

// ---------- Recording progress by line (the hold: STARBASE_FAKE_HOLD) ----------

/** The job's evidence view once `ok` says so. */
async function viewWhen(slug, ok, what) {
  for (let i = 0; i < 80; i++) {
    const view = await getJson(`/api/job/${slug}/evidence`);
    if (ok(view)) return view;
    await pause(250);
  }
  assert.fail(`${what} (${slug}):\n${output.join('').slice(-2000)}`);
}
const cardOf = async (slug) => (await getJson('/api/snapshot')).jobs.find((j) => j.slug === slug);
// The hold file, written whole (a rename), so the fake never reads it half written.
async function setHold(text) {
  await fs.writeFile(`${hold}.next`, text);
  await fs.rename(`${hold}.next`, hold);
}
const runningFirst = (v) => v.progress?.lines?.[0]?.state === 'running';
/**
 * Let a held recording go and see it end, so no later test finds it still in the queue (one recording
 * at a time): every held test does this in its finally, so one that fails part way holds up no other.
 * At once when the job never recorded.
 */
async function letGo(slug) {
  await setHold('go');
  await viewWhen(slug, (v) => !v.recording && v.progress == null, 'the recording never ended');
}

test('evidence server: while it records, the view says which line of how many and each line’s state', async () => {
  await fs.rm(hold, { force: true }); // the next recording holds once its first line begins
  try {
    await writeJob('held-job', { level: 2 }); // the change watcher records it by itself
    const view = await viewWhen('held-job', runningFirst, 'no recording part way');
    assert.equal(view.recording, true);
    assert.equal(view.progress.line, 1);
    assert.equal(view.progress.of, 3);
    assert.equal(view.progress.commit, 'abc1234def5');
    assert.deepEqual(view.progress.lines.map((l) => [l.id, l.state]), [['AC-1', 'running'], ['AC-2', 'waiting'], ['AC-3', 'waiting']]);
    assert.ok(view.progress.lines.every((l) => l.video === null));
    // The Jobs card and its lane say the same.
    const card = await cardOf('held-job');
    assert.equal(card.testing, 'Recording evidence: line 1 of 3');
    assert.equal(card.lane, 'working');
    assert.equal(card.laneReason, 'Recording evidence: line 1 of 3');
  } finally {
    await letGo('held-job');
  }
});

test('evidence server: when the recording ends the progress is gone', async () => {
  // Its own job, held part way and then let go (final fixes C4: no test depends on another's job).
  await fs.rm(hold, { force: true });
  try {
    await writeJob('ended-job', { level: 2 });
    await viewWhen('ended-job', runningFirst, 'no recording part way');
  } finally {
    await letGo('ended-job');
  }
  const view = await viewWhen('ended-job', (v) => v.evidence && !v.recording, 'the held recording never ended');
  assert.equal(view.progress, null);
  assert.equal((await cardOf('ended-job')).testing, null);
  const { epoch } = await getJson('/api/snapshot');
  const seen = (await eventsFor(800, epoch)).filter((e) => e.type === 'evidence' && e.job === 'ended-job');
  assert.ok(seen.some((e) => e.data.outcome === 'progress' && e.data.progress?.line === 1 && e.data.progress.lines[0].state === 'running'), 'each change is sent');
  assert.equal(seen.at(-1).data.outcome, 'progress');
  assert.equal(seen.at(-1).data.progress, null, 'the last one says it is gone');
  assert.equal(seen.filter((e) => e.data.progress === null).length, 1, 'once');
});

test('evidence server: when the recording dies the progress is gone and the problem is said', async () => {
  await fs.rm(hold, { force: true });
  try {
    await writeJob('dying-job', { level: 2 });
    await viewWhen('dying-job', runningFirst, 'no recording part way');
    assert.equal((await cardOf('dying-job')).testing, 'Recording evidence: line 1 of 3');
    await setHold('exit 1'); // Playwright stops part way, before it writes its report
    const view = await viewWhen('dying-job', (v) => v.problem && !v.recording, 'the recording never ended');
    assert.equal(view.progress, null);
    assert.equal(view.evidence, null);
    assert.match(view.problem.message, /^Playwright stopped before it wrote its report, so nothing was recorded/);
    assert.doesNotMatch(view.problem.message, /@@starbase/);
    const card = await cardOf('dying-job');
    assert.equal(card.testing, null);
    assert.doesNotMatch(card.laneReason, /Recording evidence/);
    const { epoch } = await getJson('/api/snapshot');
    const seen = (await eventsFor(800, epoch)).filter((e) => e.type === 'evidence' && e.job === 'dying-job');
    assert.deepEqual(seen.slice(-2).map((e) => [e.data.outcome, e.data.progress]), [['not-recorded', undefined], ['progress', null]]);
  } finally {
    await letGo('dying-job');
  }
});

test('evidence server: a line’s video is there as soon as the line ends', async () => {
  await fs.rm(hold, { force: true });
  try {
    await writeJob('video-job', { level: 2 });
    await viewWhen('video-job', runningFirst, 'no recording part way');
    await setHold('one'); // the first line ends, then the fake holds again before the next begins
    const view = await viewWhen('video-job', (v) => v.progress?.lines?.[0]?.video, 'the first line’s video never came');
    // Before the run's end: still recording, no evidence.json yet.
    assert.equal(view.recording, true);
    assert.equal(view.evidence, null);
    assert.deepEqual(view.progress.lines.map((l) => [l.id, l.state, l.video]), [
      ['AC-1', 'passed', 'abc1234def5/AC-1/video.webm'], ['AC-2', 'waiting', null], ['AC-3', 'waiting', null],
    ]);
    // At the place it has at the end, served by the file route.
    const res = await get(fileUrl('video-job', view.progress.lines[0].video));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'video/webm');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), await fs.readFile(path.join(FIXTURE, 'output', 'AC-1-chromium', 'video.webm')));
    await setHold('go');
    const done = await viewWhen('video-job', (v) => v.evidence && !v.recording, 'the recording never ended');
    assert.equal(done.evidence.criteria[0].video, 'abc1234def5/AC-1/video.webm', 'the same place at the end');
    assert.equal((await get(fileUrl('video-job', done.evidence.criteria[0].video))).status, 200);
  } finally {
    await letGo('video-job');
  }
});

// ---------- The laptop's Jobs card hears the progress (fix round 1) ----------

/**
 * One job's v2 events as they come, as the laptop page reads them: on each `change` for the job the
 * page fetches the snapshot again, so its card is fetched right then (entry.card, a promise).
 */
function watchJob(slug, epoch) {
  const seen = [];
  const req = http.get(`${base}/api/events?v=2&since=0&epoch=${epoch}`, (res) => {
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const data = buf.slice(0, i).split('\n').find((l) => l.startsWith('data: '));
        buf = buf.slice(i + 2);
        if (!data) continue;
        const e = JSON.parse(data.slice(6));
        if (e.job !== slug) continue;
        seen.push(e.type === 'change' ? { e, card: cardOf(slug) } : { e });
      }
    });
  });
  req.on('error', () => {});
  return { seen, stop: () => req.destroy() };
}
/** The first `change` for the job after the first evidence event `after` matches, once it is there. */
async function changeAfter(w, after, what) {
  for (let n = 0; n < 400; n++) {
    const i = w.seen.findIndex((x) => x.e.type === 'evidence' && after(x.e.data));
    const change = i >= 0 ? w.seen.slice(i + 1).find((x) => x.e.type === 'change') : null;
    if (change) return change;
    await pause(50);
  }
  return assert.fail(`${what}:\n${JSON.stringify(w.seen.map((x) => [x.e.type, x.e.data?.outcome, x.e.data?.progress?.line ?? x.e.data?.progress]))}`);
}

test('evidence server: the laptop’s card hears each line as it moves, and the end of the recording', async () => {
  const w = watchJob('heard-job', (await getJson('/api/snapshot')).epoch);
  try {
    await fs.rm(hold, { force: true });
    try {
      await writeJob('heard-job', { level: 2 });
      await viewWhen('heard-job', runningFirst, 'no recording part way');
      const moved = await changeAfter(w, (d) => d.progress?.line === 1, 'no change after the line moved to 1');
      assert.equal((await moved.card).testing, 'Recording evidence: line 1 of 3');
    } finally {
      await letGo('heard-job');
    }
    const ended = await changeAfter(w, (d) => d.outcome === 'progress' && d.progress === null, 'no change after the progress was gone');
    const card = await ended.card;
    assert.equal(card.testing, null);
    assert.doesNotMatch(card.laneReason, /Recording evidence/);
  } finally {
    w.stop();
  }
});

test('evidence server: the laptop’s card hears the end of a recording that dies part way', async () => {
  const w = watchJob('heard-dying-job', (await getJson('/api/snapshot')).epoch);
  try {
    await fs.rm(hold, { force: true });
    try {
      await writeJob('heard-dying-job', { level: 2 });
      await viewWhen('heard-dying-job', runningFirst, 'no recording part way');
      await setHold('exit 1');
      const ended = await changeAfter(w, (d) => d.outcome === 'progress' && d.progress === null, 'no change after the progress was gone');
      const card = await ended.card;
      assert.equal(card.testing, null);
      assert.doesNotMatch(card.laneReason, /Recording evidence/);
      assert.ok((await getJson('/api/job/heard-dying-job/evidence')).problem, 'the problem is said');
    } finally {
      await letGo('heard-dying-job');
    }
  } finally {
    w.stop();
  }
});

// ---------- Watch: the hidden browser's picture (Task 6) ----------

const liveUrl = (slug) => `/api/job/${slug}/evidence/live`;
const runDirOf = (slug) => path.join(featuresDir, slug, 'evidence', 'abc1234def5', 'run');
const there = (f) => fs.access(f).then(() => true, () => false);
/** A GET from this computer, with the Host header a page elsewhere (a rebound name) would send. */
const getAs = (p, host) => new Promise((resolve, reject) => {
  const req = http.get(base + p, { headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode); });
  req.on('error', reject);
});

test('evidence server: the live route answers the newest frame while a recording is watched, and 404 after it ends', async () => {
  await fs.rm(hold, { force: true });
  try {
    await writeJob('watched-job', { level: 2 });
    const view = await viewWhen('watched-job', runningFirst, 'no recording part way');
    assert.equal(view.watch, true, 'Watch is there while it records');
    const first = await get(liveUrl('watched-job'));
    assert.equal(first.status, 404, 'nobody watched yet, so there is no picture');
    assert.equal((await first.json()).error, 'No live picture right now.');
    assert.ok(await there(path.join(runDirOf('watched-job'), 'watching')), 'asking marks it watched');
    let res = null;
    for (let i = 0; i < 40; i++) {
      res = await get(liveUrl('watched-job'));
      if (res.status === 200) break;
      await res.arrayBuffer();
      await pause(250);
    }
    assert.equal(res.status, 200, `no frame while watched:\n${output.join('').slice(-2000)}`);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin', 'no other origin may show it');
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xd8], 'a JPEG');
    assert.equal(Number(res.headers.get('content-length')), bytes.length);
    // Only at the laptop's own address.
    assert.equal(await getAs(liveUrl('watched-job'), 'starbase.example.test'), 421);
    // Another job that isn't recording has none, and asking marks nothing.
    assert.equal((await get(liveUrl('tiny-tweak'))).status, 404);
    assert.equal(await there(path.join(featuresDir, 'tiny-tweak', 'evidence', 'abc1234def5')), false);
    assert.equal((await get(liveUrl('no-such-job'))).status, 404);
  } finally {
    await letGo('watched-job');
  }
  const done = await viewWhen('watched-job', (v) => v.evidence && !v.recording, 'the watched recording never ended');
  assert.equal(done.watch, false, 'no Watch once it ended');
  const after = await get(liveUrl('watched-job'));
  assert.equal(after.status, 404);
  assert.equal((await after.json()).error, 'No live picture right now.');
  assert.equal(await there(runDirOf('watched-job')), false, 'the picture and the watch mark went with the run');
  assert.ok(!JSON.stringify(done).includes('live.jpg'), 'the evidence names no live picture');
});

test('evidence server: nobody watching, no frame is written', async () => {
  await fs.rm(hold, { force: true });
  try {
    await writeJob('unwatched-job', { level: 2 });
    await viewWhen('unwatched-job', runningFirst, 'no recording part way');
    await pause(1200); // more than two of the fake's half-second looks, the view read in between
    await getJson('/api/job/unwatched-job/evidence');
    assert.ok(await there(path.join(runDirOf('unwatched-job'), 'guard.mjs')), 'the run is there');
    assert.equal(await there(path.join(runDirOf('unwatched-job'), 'live.jpg')), false, 'no frame');
    assert.equal(await there(path.join(runDirOf('unwatched-job'), 'watching')), false, 'reading the view marks nothing');
  } finally {
    await letGo('unwatched-job');
  }
  await viewWhen('unwatched-job', (v) => v.evidence && !v.recording, 'the recording never ended');
});

// ---------- Watch, hardened (Task 6 fix round 1) ----------

/** GET the live picture as a browser page would, with its Sec-Fetch-Site (none: no header, as a terminal). */
const liveAs = (slug, site) => new Promise((resolve, reject) => {
  const req = http.get(base + liveUrl(slug), { headers: site ? { 'Sec-Fetch-Site': site } : {} }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], cacheControl: res.headers['cache-control'], body: Buffer.concat(chunks) }));
  });
  req.on('error', reject);
});
const mtimeOf = async (f) => (await fs.lstat(f)).mtimeMs;
const backdate = async (f, ms) => { const t = new Date(Date.now() - ms); await fs.utimes(f, t, t); };
/** A held recording of a new job, part way; done() lets it finish and waits for its end. */
async function heldRecording(slug) {
  await fs.rm(hold, { force: true });
  await writeJob(slug, { level: 2 });
  await viewWhen(slug, runningFirst, 'no recording part way');
  return () => letGo(slug);
}

test('evidence server: a later ask keeps it watched past the mark’s first 5 seconds; another site’s page can’t start it', async () => {
  const done = await heldRecording('rewatched-job');
  try {
    const mark = path.join(runDirOf('rewatched-job'), 'watching');
    assert.equal((await liveAs('rewatched-job')).status, 404, 'the first ask: no picture yet');
    assert.ok(await there(mark));
    // The mark is older than 5 seconds (nobody asked for a while): the next ask makes it fresh again.
    await backdate(mark, 6000);
    await liveAs('rewatched-job', 'same-origin');
    assert.ok(Date.now() - (await mtimeOf(mark)) < 3000, 'touched again by the later ask');
    let got = null;
    for (let i = 0; i < 40 && got?.status !== 200; i++) { got = await liveAs('rewatched-job', 'same-origin'); if (got.status !== 200) await pause(250); }
    assert.equal(got.status, 200, 'pictures come again');
    assert.equal(got.type, 'image/jpeg');
    // Another site's page (an <img> or a no-cors fetch), or the app under test on another port: a 404, and the mark is left as it was.
    await backdate(mark, 6000);
    const before = await mtimeOf(mark);
    for (const site of ['cross-site', 'same-site', 'none']) {
      const r = await liveAs('rewatched-job', site);
      assert.equal(r.status, 404, site);
      assert.equal(JSON.parse(r.body).error, 'No live picture right now.');
    }
    assert.equal(await mtimeOf(mark), before, 'not touched');
  } finally {
    await done();
  }
});

test('evidence server: a link at run/watching or run/live.jpg is refused and what it points at is untouched', async () => {
  const done = await heldRecording('linked-job');
  try {
    const run = runDirOf('linked-job');
    const target = path.join(root, 'linked-target.jpg');
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 0xff, 0xd9]);
    await fs.writeFile(target, jpeg);
    await backdate(target, 60_000);
    const targetTime = await mtimeOf(target);
    // A link where the watch mark goes.
    await fs.symlink(target, path.join(run, 'watching'));
    assert.equal((await liveAs('linked-job')).status, 404);
    assert.equal(await mtimeOf(target), targetTime, 'its times are left alone');
    assert.ok((await fs.lstat(path.join(run, 'watching'))).isSymbolicLink());
    await fs.rm(path.join(run, 'watching'));
    // A link where the picture goes, pointing at a fresh file. A folder where the fake writes beside
    // it keeps the fake from saving a real picture over the link.
    await fs.mkdir(path.join(run, 'live.jpg.part'));
    await fs.utimes(target, new Date(), new Date());
    const fresh = await mtimeOf(target);
    await fs.symlink(target, path.join(run, 'live.jpg'));
    for (let i = 0; i < 3; i++) {
      const r = await liveAs('linked-job');
      assert.equal(r.status, 404, 'never served through the link');
      assert.equal(r.type, 'application/json; charset=utf-8');
      await pause(300);
    }
    assert.ok((await fs.lstat(path.join(run, 'live.jpg'))).isSymbolicLink());
    assert.deepEqual(await fs.readFile(target), jpeg, 'its words are left alone');
    assert.equal(await mtimeOf(target), fresh);
  } finally {
    await done();
  }
});

test('evidence server: run/ already gone while the run is still listed answers 404 and makes nothing', async () => {
  const done = await heldRecording('gone-run-job');
  try {
    await fs.rm(runDirOf('gone-run-job'), { recursive: true, force: true });
    const r = await liveAs('gone-run-job');
    assert.equal(r.status, 404);
    assert.equal(JSON.parse(r.body).error, 'No live picture right now.');
    assert.equal(await there(runDirOf('gone-run-job')), false, 'no folder is made for the mark');
    assert.equal((await getJson('/api/job/gone-run-job/evidence')).recording, true, 'the run is still listed');
  } finally {
    await done();
  }
});

// ---------- Try it while a recording holds the app (final fixes C3) ----------

const HELD_WORDS = 'The evidence recording is using this app. It stops by itself when the recording ends.';
const tryIt = async (slug, action) => {
  const res = await post(`/api/job/${slug}/local`, { action });
  return { status: res.status, body: await res.json() };
};
const appOf = async (slug) => (await getJson(`/api/job/${slug}/local`)).server?.status ?? null;

test('Stop is refused while a recording holds the app', async () => {
  const done = await heldRecording('stop-held-job');
  try {
    assert.equal(await appOf('stop-held-job'), 'running', 'the recorder started the app');
    const r = await tryIt('stop-held-job', 'stop');
    assert.equal(r.status, 409);
    assert.equal(r.body.error, HELD_WORDS);
    assert.equal(await appOf('stop-held-job'), 'running', 'the app is untouched');
  } finally {
    await done();
  }
  assert.equal(await appOf('stop-held-job'), 'stopped', 'the recorder stops the app it started, at the end');
});

test('Start while a recording holds the app leaves it running after the recording', async () => {
  const done = await heldRecording('start-held-job');
  try {
    const r = await tryIt('start-held-job', 'start');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'running', 'he gets the running app');
    const job = await getJson('/api/job/start-held-job');
    assert.ok(job.page.handTest.startedAt, 'the hand test is marked started');
  } finally {
    await done();
  }
  assert.equal(await appOf('start-held-job'), 'running', 'the recorder left it running: it is his now');
  assert.deepEqual(await tryIt('start-held-job', 'stop'), { status: 200, body: { ok: true } });
});

test('after the recording ends Stop works again', async () => {
  const done = await heldRecording('stop-after-job');
  try {
    assert.equal((await tryIt('stop-after-job', 'stop')).status, 409);
  } finally {
    await done();
  }
  assert.equal((await tryIt('stop-after-job', 'start')).status, 200);
  assert.deepEqual(await tryIt('stop-after-job', 'stop'), { status: 200, body: { ok: true } });
  assert.equal(await appOf('stop-after-job'), 'stopped');
});

// ---------- The demo's recording under way (demo mode only; dashboard/demo/run-demo.js) ----------

const DEMO_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7, 0xff, 0xd9]);
const demoProgress = () => ({
  commit: 'c4f1e2a9b07', startedAt: new Date(Date.now() - 180_000).toISOString(), line: 4, of: 19,
  lines: Array.from({ length: 19 }, (_, i) => ({ id: `AC-${i + 1}`, title: `Line ${i + 1}`, state: i < 3 ? 'passed' : i === 3 ? 'running' : 'waiting', video: null, at: null })),
});
/** The demo's two files in a job folder's evidence/, as run-demo.js writes them; the picture a minute old. */
async function writeDemoFiles(dir, progress = demoProgress()) {
  await fs.mkdir(path.join(dir, 'evidence'), { recursive: true });
  await fs.writeFile(path.join(dir, 'evidence', 'demo-progress.json'), JSON.stringify(progress));
  await fs.writeFile(path.join(dir, 'evidence', 'demo-live.jpg'), DEMO_JPEG);
  await backdate(path.join(dir, 'evidence', 'demo-live.jpg'), 60_000);
}
/** A job folder of its own, outside the dashboard's jobs, and the evidence door alone on it, in demo mode or not. */
async function doorJob(name, { demo }) {
  const dir = path.join(root, 'door-jobs', name);
  await fs.mkdir(dir, { recursive: true });
  const door = evidenceRunner({
    jobs: async () => [{ slug: name, dir, options: { schema_version: 2, level: 2, flow: 'small' } }],
    local: {}, state: { audit: async () => {} }, events: { emit: () => {} }, on: () => {}, demo, env: {},
  });
  return { dir, door };
}
const noLive = (err) => err.status === 404 && err.message === 'No live picture right now.';

test('evidence door: outside demo mode a job folder’s demo-progress.json and demo-live.jpg change nothing', async () => {
  const plain = await doorJob('plain-job', { demo: false });
  const withFiles = await doorJob('files-job', { demo: false });
  await writeDemoFiles(withFiles.dir);
  const view = await withFiles.door.view('files-job');
  assert.equal(view.recording, false);
  assert.equal(view.progress, null);
  assert.equal(view.watch, false);
  const strip = ({ folder, folderUrl, ...rest }) => rest;
  assert.deepEqual(strip(view), strip(await plain.door.view('plain-job')), 'the same as a folder without them');
  await assert.rejects(withFiles.door.live('files-job'), noLive);
});

test('evidence door, demo mode: the same files are a recording under way, line 4 of 19, and Watch answers the picture', async () => {
  const { dir, door } = await doorJob('demo-job', { demo: true });
  const before = await door.view('demo-job');
  assert.equal(before.recording, false, 'no files: nothing records');
  await assert.rejects(door.live('demo-job'), noLive);
  await writeDemoFiles(dir);
  const view = await door.view('demo-job');
  assert.equal(view.recording, true);
  assert.equal(view.watch, true);
  assert.equal(view.progress.line, 4);
  assert.equal(view.progress.of, 19);
  assert.equal(view.progress.lines.length, 19);
  assert.deepEqual(view.progress.lines[3], { id: 'AC-4', title: 'Line 4', state: 'running', video: null, at: null });
  const frame = await door.live('demo-job');
  assert.equal(frame.type, 'image/jpeg');
  assert.ok(frame.bytes.equals(DEMO_JPEG), 'the picture, though a minute old: it is a still');
  assert.equal(frame.size, DEMO_JPEG.length);
  // The picture alone, with no progress beside it, is no recording.
  await fs.rm(path.join(dir, 'evidence', 'demo-progress.json'));
  await assert.rejects(door.live('demo-job'), noLive);
});

test('evidence door, demo mode: a link at either file, a link for the evidence folder, or a file not in the shape is never read', async () => {
  const outside = path.join(root, 'door-outside');
  await writeDemoFiles(outside);
  // Links at the two files, pointing at real ones outside.
  const linked = await doorJob('linked-files', { demo: true });
  await fs.mkdir(path.join(linked.dir, 'evidence'), { recursive: true });
  await fs.symlink(path.join(outside, 'evidence', 'demo-progress.json'), path.join(linked.dir, 'evidence', 'demo-progress.json'));
  assert.equal((await linked.door.view('linked-files')).progress, null);
  await fs.rm(path.join(linked.dir, 'evidence', 'demo-progress.json'));
  await fs.writeFile(path.join(linked.dir, 'evidence', 'demo-progress.json'), JSON.stringify(demoProgress()));
  await fs.symlink(path.join(outside, 'evidence', 'demo-live.jpg'), path.join(linked.dir, 'evidence', 'demo-live.jpg'));
  assert.equal((await linked.door.view('linked-files')).progress.line, 4, 'the plain progress file is read');
  await assert.rejects(linked.door.live('linked-files'), noLive, 'never through the link');
  // The evidence folder itself a link to a folder with both files.
  const folder = await doorJob('linked-folder', { demo: true });
  await fs.symlink(path.join(outside, 'evidence'), path.join(folder.dir, 'evidence'));
  assert.equal((await folder.door.view('linked-folder')).progress, null);
  await assert.rejects(folder.door.live('linked-folder'), noLive);
  // Not the shape: a line past the end, a line id that isn't AC-<n>, a state not known, no lines, not JSON.
  const odd = await doorJob('odd-progress', { demo: true });
  for (const bad of [{ ...demoProgress(), line: 20 }, { ...demoProgress(), lines: [{ id: '../x', title: 'x', state: 'running' }] },
    { ...demoProgress(), lines: [{ id: 'AC-1', title: 'x', state: 'dancing' }] }, { ...demoProgress(), lines: [] }]) {
    await writeDemoFiles(odd.dir, bad);
    const v = await odd.door.view('odd-progress');
    assert.equal(v.progress, null, JSON.stringify(bad).slice(0, 80));
    assert.equal(v.recording, false);
    await assert.rejects(odd.door.live('odd-progress'), noLive);
  }
  await fs.writeFile(path.join(odd.dir, 'evidence', 'demo-progress.json'), '{ not json');
  assert.equal((await odd.door.view('odd-progress')).progress, null);
});

test('evidence server, demo mode: the demo’s recording shows on the job’s evidence view, and its picture on the live route', async () => {
  const dir = await writeJob('demo-recording-job', { level: 2, report: null });
  await writeDemoFiles(dir);
  const view = await viewWhen('demo-recording-job', (v) => v.recording, 'the demo’s recording on the view');
  assert.equal(view.progress.line, 4);
  assert.equal(view.progress.of, 19);
  assert.equal(view.watch, true);
  const r = await liveAs('demo-recording-job', 'same-origin');
  assert.equal(r.status, 200);
  assert.equal(r.type, 'image/jpeg');
  assert.ok(r.body.equals(DEMO_JPEG));
  assert.equal(r.cacheControl, 'no-store', 'never kept by the browser, as the real picture');
  assert.equal((await liveAs('demo-recording-job', 'cross-site')).status, 404, 'another site’s page still can’t ask');
});

// ---------- Parked fixes: a guessed branch is refused before anything says a recording started ----------

test('Record on a guessed branch refuses before anything says a recording started', async () => {
  const { guessedWorktree, guessWords } = await import('../lib/locate.js');
  const slug = 'guessed-branch-job';
  const dir = path.join(root, 'door-jobs', slug);
  const worktree = path.join(root, 'door-jobs', 'someone-elses-worktree');
  await fs.mkdir(path.join(dir, 'evidence', 'specs'), { recursive: true });
  await fs.mkdir(worktree, { recursive: true });
  await fs.writeFile(path.join(dir, 'test-report.md'), REPORT('abc1234def5'));
  for (const n of [1, 2]) await fs.writeFile(path.join(dir, 'evidence', 'specs', `AC-${n}.spec.mjs`), SPEC(n));
  // The branch only guessed (lib/locate.js): its worktree may be another job's.
  const f = { slug, dir, options: { schema_version: 2, level: 2, flow: 'small' }, worktree, statusWorktree: null, locate: { branch: 'feature/other-thing', branchGuessed: true, worktree } };
  assert.equal(guessedWorktree(f), worktree);
  const emitted = [];
  const started = [];
  const door = evidenceRunner({
    jobs: async () => [f],
    // Try it as the real one answers a guessed worktree (lib/local.js where()).
    local: {
      where: async (job) => (guessedWorktree(job) ? { reason: guessWords(job) } : { root: job.worktree, app: null }),
      startServer: async (job) => { started.push(job.slug); },
      dbView: async () => null, // no local database to check
      jobs: new Map(),
    },
    state: { audit: async () => {} }, events: { emit: (_name, _slug, data) => emitted.push(data) }, on: () => {},
    env: { STARBASE_PLAYWRIGHT: path.join(FIXTURE, 'fake-playwright.mjs') },
  });
  await assert.rejects(door.record(slug), (err) => err.status === 409 && err.message === guessWords(f));
  assert.deepEqual(emitted.map((e) => e.outcome), ['not-recorded'], 'never "recording", only the refusal');
  assert.equal(emitted[0].reason, guessWords(f));
  assert.deepEqual(started, [], 'no server started');
  assert.equal((await door.view(slug)).problem?.message, guessWords(f));
});

// ---------- Task 9: an Auto job records on Auto's database (Part C) ----------
// The evidence door alone on a real Try it (lib/local.js) with the fake Postgres tools (fixtures/fake-pg),
// the stand-in app (fixtures/auto-db-app, which reads its .env.local as Next.js does) and the fake Playwright.

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_PG = path.join(TEST_DIR, 'fixtures', 'fake-pg');
const AUTO_APP = path.join(TEST_DIR, 'fixtures', 'auto-db-app');
const AUTO_PROFILE = {
  name: 'App', github: null, tryIt: { app: 'app', ports: { first: 47350, last: 47399 }, url: 'http://127.0.0.1:{port}' },
  filesToCopy: [{ from: '{app}/.env.local', to: '{app}/.env.local' }], database: { urlKey: 'DATABASE_URL' },
};
const HIS_ADDRESS = 'postgres://u:s3cret-pw@localhost:5432/app?schema=public';
const dbNameOf = (url) => decodeURIComponent(new URL(url).pathname.slice(1));

/**
 * Auto's world: a main checkout with his settings file, and per job a worktree with the stand-in app
 * (its .env.local naming his database), two migrations (his database has the first) and a job folder
 * at the test step with a report and two specs. auto: the jobs' Auto record. override: the app reads
 * its settings file over what it is given. migrate: 'fake' for fixtures/fake-pg's migrate. settings: his
 * settings file. profile: the repository's.
 */
async function autoWorld({ slugs = ['auto-job'], auto = { on: true }, original = true, connections = 0, override = false, both = false, migrate = null, profile = AUTO_PROFILE, settings = `DATABASE_URL=${HIS_ADDRESS}\n`, appSettings = `DATABASE_URL=${HIS_ADDRESS}\n`, times = {} } = {}) {
  const { LocalRunner } = await import('../lib/local.js');
  const { State } = await import('../lib/state.js');
  const { pathToFileURL } = await import('node:url');
  const top = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'starbase-auto-db-')));
  const repo = path.join(top, 'main');
  await fs.mkdir(path.join(repo, 'app'), { recursive: true });
  await fs.writeFile(path.join(repo, 'app', '.env.local'), settings);
  const list = [];
  for (const slug of slugs) {
    const wt = path.join(top, `wt-${slug}`);
    await fs.mkdir(path.join(wt, 'app'), { recursive: true });
    for (const file of await fs.readdir(AUTO_APP)) await fs.copyFile(path.join(AUTO_APP, file), path.join(wt, 'app', file));
    const pkg = JSON.parse(await fs.readFile(path.join(wt, 'app', 'package.json'), 'utf8'));
    if (override) pkg.scripts.dev = 'node dev.mjs --override';
    if (both) pkg.scripts.dev = 'node dev.mjs --both';
    if (migrate === 'fake') pkg.scripts['db:migrate'] = `node ${JSON.stringify(path.join(FAKE_PG, 'migrate'))}`;
    await fs.writeFile(path.join(wt, 'app', 'package.json'), JSON.stringify(pkg));
    await fs.writeFile(path.join(wt, 'app', '.env.local'), appSettings);
    for (const m of ['0001_a', '0002_b']) await fs.mkdir(path.join(wt, 'app', 'prisma', 'migrations', m), { recursive: true });
    const dir = path.join(top, 'jobs', slug);
    await fs.mkdir(path.join(dir, 'evidence', 'specs'), { recursive: true });
    for (const n of [1, 2]) await fs.writeFile(path.join(dir, 'evidence', 'specs', `AC-${n}.spec.mjs`), SPEC(n));
    await fs.writeFile(path.join(dir, 'test-report.md'), REPORT('abc1234def5'));
    const then = new Date(Date.now() - 60_000);
    await fs.utimes(path.join(dir, 'test-report.md'), then, then);
    list.push({ slug, dir, title: `Job ${slug}`, stage: 'test', options: { schema_version: 2, level: 2, flow: 'small' }, worktree: wt, repoPath: repo, branch: `feature/${slug}`, auto: auto && { ...auto } });
  }
  const stateFile = path.join(top, 'pg.json');
  const logFile = path.join(top, 'pg.log');
  const databases = { app: { ledger: ['0001_a'], connections } };
  if (original) databases.app__original = { ledger: ['0001_a'], connections: 0 };
  await fs.writeFile(stateFile, JSON.stringify({ version: 170000, databases }));
  await fs.writeFile(logFile, '');
  Object.assign(process.env, { FAKE_PG_STATE: stateFile, FAKE_PG_LOG: logFile });
  delete process.env.FAKE_PG_FAIL;
  // Playwright: the fake, each run counted.
  const runsFile = path.join(top, 'playwright-runs');
  const pw = path.join(top, 'pw.mjs');
  await fs.writeFile(pw, `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(runsFile)}, 'ran\\n');\nawait import(${JSON.stringify(pathToFileURL(path.join(FIXTURE, 'fake-playwright.mjs')).href)});\n`);
  const registry = { profileFor: async () => ({ ok: true, profile, file: path.join(repo, 'starbase.md'), source: 'repo' }) };
  const local = new LocalRunner({ state: new State(path.join(top, 'state')), registry, pgTool: async (name) => path.join(FAKE_PG, name) });
  // What Auto's database steps did, in order (autoDatabase begun and ended, each app stopped).
  const steps = [];
  const made = local.autoDatabase.bind(local);
  local.autoDatabase = async (f, o) => { steps.push(`copy ${f.slug}`); try { return await made(f, o); } finally { steps.push(`copied ${f.slug}`); } };
  const stopWait = local.stopServerAndWait.bind(local);
  local.stopServerAndWait = async (slug, ms) => { const r = await stopWait(slug, ms); steps.push(`stopped ${slug}`); return r; };
  const handlers = {};
  const emitted = [];
  const audits = [];
  const sends = [];
  const stops = [];
  const door = evidenceRunner({
    jobs: async () => list, local, state: { audit: async (l) => { audits.push(l); } },
    events: { emit: (_name, _slug, data) => emitted.push(data) }, on: (name, fn) => { handlers[name] = fn; },
    env: { STARBASE_PLAYWRIGHT: pw },
    onAutoDbProblem: (f, err) => { sends.push({ slug: f.slug, kind: 'auto-migration', err }); },
    stopAuto: async (f, reason) => { stops.push({ slug: f.slug, reason }); return true; },
    autoTimes: { connectEveryMs: 100, connectForMs: 1500, lookAgainMs: 400, ...times },
  });
  const log = async () => (await fs.readFile(logFile, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const pg = async () => JSON.parse(await fs.readFile(stateFile, 'utf8')).databases;
  const runs = async () => (await fs.readFile(runsFile, 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
  const done = async () => {
    for (const j of list) await stopWait(j.slug).catch(() => {});
    await fs.rm(top, { recursive: true, force: true });
  };
  return { top, list, local, door, handlers, emitted, audits, sends, stops, steps, log, pg, runs, done };
}

/** Every command in the log is on Auto's database, with the original only ever a copy's source (and his, only to save a missing original). */
function onAutoOnly(entries, { savedOriginal = false } = {}) {
  let saves = 0;
  for (const e of entries) {
    const where = JSON.stringify(e);
    if (e.tool === 'psql') assert.ok(['postgres', 'app__auto'].includes(e.args[e.args.indexOf('-d') + 1]), where);
    if (e.tool === 'dropdb') assert.equal(e.args.at(-1), 'app__auto', where);
    if (e.tool === 'createdb') {
      const from = e.args[e.args.indexOf('-T') + 1];
      if (savedOriginal && from === 'app' && e.args.at(-1) === 'app__original') { saves++; continue; }
      assert.deepEqual([from, e.args.at(-1)], ['app__original', 'app__auto'], where);
    }
    if (e.tool === 'migrate') assert.equal(dbNameOf(e.url), 'app__auto', where);
  }
  assert.equal(saves, savedOriginal ? 1 : 0);
}
const settle = (ms) => new Promise((r) => { setTimeout(r, ms); });
async function untilTrue(ok, what, ms = 30_000) {
  for (const until = Date.now() + ms; Date.now() < until;) { if (await ok()) return; await settle(100); }
  assert.fail(what);
}

test('an Auto job\'s recording makes Auto\'s database, starts the app on it and records', { timeout: 60_000 }, async () => {
  const w = await autoWorld();
  try {
    const before = await w.pg();
    const r = await w.door.record('auto-job', { waitMs: 50_000 });
    assert.equal(r.evidence.commit, 'abc1234def5');
    assert.equal(await w.runs(), 1, 'Playwright ran once');
    assert.deepEqual(w.steps, ['copy auto-job', 'copied auto-job', 'stopped auto-job'], 'the copy before the app; the app stopped at the end');
    const server = w.local.jobs.get('auto-job').server;
    assert.equal(server.db, 'auto');
    assert.equal(server.status, 'stopped');
    const after = await w.pg();
    assert.deepEqual(after.app__auto.ledger, ['0001_a', '0002_b']);
    assert.equal(after.app__auto.connections, 0, 'the app connected to Auto\'s database, and let go when it stopped');
    assert.deepEqual(after.app, before.app, 'his database is as it was');
    assert.deepEqual(after.app__original, before.app__original);
    onAutoOnly(await w.log());
    assert.equal((await w.door.view('auto-job')).problem, null);
  } finally { await w.done(); }
});

test('the recording refuses an app that connects elsewhere', { timeout: 60_000 }, async () => {
  const { AUTO_DB_NOT_USED } = await import('../runner/evidence.js');
  const w = await autoWorld({ override: true });
  try {
    const before = await w.pg();
    await assert.rejects(w.door.record('auto-job', { waitMs: 50_000 }), (err) => err.status === 409 && err.message === AUTO_DB_NOT_USED);
    assert.equal(await w.runs(), 0, 'no Playwright run');
    const view = await w.door.view('auto-job');
    assert.equal(view.problem.message, AUTO_DB_NOT_USED);
    assert.equal(view.evidence, null);
    assert.equal(w.local.jobs.get('auto-job').server.status, 'stopped', 'the app is stopped');
    onAutoOnly(await w.log());
    const after = await w.pg();
    assert.deepEqual(after.app.ledger, before.app.ledger, 'his database got no migration');
    assert.equal(after.app.connections, 0, 'the app had connected to his, and let go');
    assert.deepEqual(w.emitted.at(-1).outcome, 'not-recorded');
  } finally { await w.done(); }
});

test('a migration that fails goes back to the Foreman once', { timeout: 60_000 }, async () => {
  const { autoMigrationMessage } = await import('../runner/evidence.js');
  const w = await autoWorld({ migrate: 'fake' });
  try {
    process.env.FAKE_PG_FAIL = '0002_b';
    for (let i = 0; i < 2; i++) {
      await assert.rejects(w.door.record('auto-job', { waitMs: 50_000 }), (err) => err.status === 409 && /0002_b/.test(err.message));
    }
    // A second look by the change watcher at the same commit sends nothing either.
    w.handlers.change();
    await settle(1500);
    assert.equal(w.sends.length, 1, 'one send');
    assert.equal(w.sends[0].kind, 'auto-migration');
    const text = autoMigrationMessage(w.sends[0].err);
    assert.ok(text.startsWith('Starbase couldn\'t apply 0002_b to Auto\'s copy of the database:\n'), text);
    assert.ok(text.endsWith('\nFix it, then raise the brief into Test again.'), text);
    assert.match(text, /error line 25/);
    const problem = (await w.door.view('auto-job')).problem;
    for (const words of [text, problem.message]) assert.doesNotMatch(words, /s3cret-pw|postgres:\/\//, 'no address and no password');
    assert.equal(await w.runs(), 0);
    assert.deepEqual(w.list[0].auto, { on: true }, 'the job\'s Auto record is not stopped');
    assert.equal(w.local.jobs.get('auto-job')?.server ?? null, null, 'the app never started');
  } finally { delete process.env.FAKE_PG_FAIL; await w.done(); }
});

test('with no saved original the recording waits and tries again', { timeout: 60_000 }, async () => {
  const { AUTO_DB_WAITING } = await import('../runner/evidence.js');
  const w = await autoWorld({ original: false, connections: 1 });
  try {
    assert.equal(AUTO_DB_WAITING, 'Waiting for a copy of your database. Starbase makes it when nothing is connected to it.');
    w.handlers.change();
    await untilTrue(async () => (await w.door.view('auto-job')).problem?.message === AUTO_DB_WAITING, 'no waiting line');
    const view = await w.door.view('auto-job');
    assert.equal(view.problem.waiting, true);
    assert.ok(!w.emitted.some((e) => e.outcome === 'not-recorded'), 'not shown as failed');
    assert.ok(!w.audits.some((a) => a.outcome === 'not-recorded'));
    assert.ok(!w.emitted.some((e) => e.outcome === 'recording'), 'it never said it was recording while it waits');
    assert.equal(await w.runs(), 0);
    // He stops his app: the next look (the timer) saves the original and records.
    const state = JSON.parse(await fs.readFile(process.env.FAKE_PG_STATE, 'utf8'));
    state.databases.app.connections = 0;
    await fs.writeFile(process.env.FAKE_PG_STATE, JSON.stringify(state));
    await untilTrue(async () => { const v = await w.door.view('auto-job'); return v.evidence && !v.recording; }, 'never recorded after waiting');
    assert.equal((await w.door.view('auto-job')).problem, null);
    assert.ok((await w.pg()).app__original, 'the original was saved');
    onAutoOnly(await w.log(), { savedOriginal: true });
  } finally { await w.done(); }
});

test('a job not in Auto records as today', { timeout: 60_000 }, async () => {
  const w = await autoWorld({ auto: null });
  try {
    const r = await w.door.record('auto-job', { waitMs: 50_000 });
    assert.equal(r.evidence.commit, 'abc1234def5');
    assert.ok(!w.steps.some((s) => s.startsWith('copy')), 'no autoDatabase call');
    assert.equal(w.local.jobs.get('auto-job').server.db, null);
    assert.equal((await w.pg()).app__auto, undefined);
  } finally { await w.done(); }
});

test('Auto switched off during a recording: it finishes on Auto\'s database, and the next job\'s copy starts after it', { timeout: 90_000 }, async () => {
  const w = await autoWorld({ slugs: ['first-job', 'next-job'] });
  const holdFile = path.join(w.top, 'hold');
  process.env.STARBASE_FAKE_HOLD = holdFile; // Playwright holds after the first line begins
  try {
    const first = w.door.record('first-job', { waitMs: 100 });
    assert.equal((await first).started, true);
    await untilTrue(async () => (await w.door.view('first-job')).progress?.lines?.[0]?.state === 'running', 'the first recording never got going');
    w.list[0].auto = { ...w.list[0].auto, on: false }; // switched off part way
    const next = w.door.record('next-job', { waitMs: 100 });
    assert.equal((await next).started, true);
    await settle(800);
    assert.deepEqual(w.steps, ['copy first-job', 'copied first-job'], 'the next job\'s copy waits');
    assert.equal(w.local.jobs.get('first-job').server.db, 'auto');
    assert.equal(w.local.jobs.get('first-job').server.status, 'running', 'it carries on on Auto\'s database');
    await fs.writeFile(holdFile, 'go');
    const ended = async (slug) => { const v = await w.door.view(slug); return v.evidence && !v.recording; };
    await untilTrue(async () => (await ended('first-job')) && ended('next-job'), 'both never recorded');
    assert.deepEqual(w.steps, ['copy first-job', 'copied first-job', 'stopped first-job', 'copy next-job', 'copied next-job', 'stopped next-job']);
    onAutoOnly(await w.log());
  } finally { delete process.env.STARBASE_FAKE_HOLD; await w.done(); }
});

test('an Auto job whose app has no database Starbase can copy records nothing, says why and does not try again', { timeout: 60_000 }, async () => {
  const w = await autoWorld({ settings: 'OTHER=1\n' });
  try {
    const why = 'Your main folder’s .env.local has no DATABASE_URL.';
    w.handlers.change(); // the change watcher records it by itself
    await untilTrue(async () => (await w.door.view('auto-job')).problem?.message === why, 'the reason never showed');
    w.handlers.change();
    await settle(4000); // past the watcher's second look and Auto's look-again time
    assert.deepEqual(w.steps, ['copy auto-job', 'copied auto-job'], 'no second try');
    assert.equal(await w.runs(), 0);
    assert.equal(w.local.jobs.get('auto-job')?.server ?? null, null, 'the app never started');
    assert.deepEqual(await w.log(), []);
  } finally { await w.done(); }
});

test('an Auto job whose app names no database anywhere records as today', { timeout: 60_000 }, async () => {
  const { database, ...noKey } = AUTO_PROFILE;
  const w = await autoWorld({ profile: noKey, settings: 'OTHER=1\n', appSettings: 'NEXT_PUBLIC_X=1\n' });
  try {
    const r = await w.door.record('auto-job', { waitMs: 50_000 });
    assert.equal(r.evidence.commit, 'abc1234def5');
    assert.deepEqual(w.steps.filter((s) => s.startsWith('copy')), [], 'no autoDatabase call');
    assert.equal(w.local.jobs.get('auto-job').server.db, null);
  } finally { await w.done(); }
});

test('an Auto job whose profile has no database section but whose settings name a database records on Auto\'s copy or not at all, never on his', { timeout: 60_000 }, async () => {
  const { database, ...noKey } = AUTO_PROFILE;
  const w = await autoWorld({ profile: noKey });
  try {
    const before = await w.pg();
    await assert.rejects(w.door.record('auto-job', { waitMs: 50_000 }), (err) => err.status === 409);
    assert.ok(w.steps.includes('copy auto-job'), 'Auto\'s copy was asked for');
    assert.equal(await w.runs(), 0, 'no Playwright run');
    assert.equal(w.local.jobs.get('auto-job')?.server ?? null, null, 'the app never started');
    assert.ok((await w.door.view('auto-job')).problem.message, 'the Test step says why');
    assert.deepEqual(await w.pg(), before, 'his database got no connection and no change');
  } finally { await w.done(); }
});

test('his Try it server running for an Auto job: the recording is refused, no copy is made, and his server is left running', { timeout: 60_000 }, async () => {
  const { AUTO_TRY_IT_RUNNING } = await import('../lib/local.js');
  const w = await autoWorld();
  try {
    await w.local.startServer(w.list[0]);
    await untilTrue(() => w.local.jobs.get('auto-job').server.status === 'running', 'his app never ran');
    await assert.rejects(w.door.record('auto-job', { waitMs: 50_000 }), (err) => err.status === 409 && err.message === AUTO_TRY_IT_RUNNING);
    assert.equal((await w.door.view('auto-job')).problem.message, AUTO_TRY_IT_RUNNING);
    assert.deepEqual(w.steps, [], 'no copy, nothing stopped');
    assert.ok(!w.emitted.some((e) => e.outcome === 'recording'), 'refused before it says it records');
    assert.equal(w.local.jobs.get('auto-job').server.status, 'running', 'his server is left running');
    assert.equal(await w.runs(), 0);
  } finally { await w.done(); }
});

// ---------- Task 9 fix round 1 ----------

test('his Try it Start while an Auto recording holds the app is refused with the line, never handed over, and the recording ends and stops its app', { timeout: 90_000 }, async () => {
  const { AUTO_RECORDING_APP } = await import('../lib/local.js');
  const w = await autoWorld();
  const holdFile = path.join(w.top, 'hold');
  process.env.STARBASE_FAKE_HOLD = holdFile;
  try {
    assert.equal((await w.door.record('auto-job', { waitMs: 100 })).started, true);
    await untilTrue(async () => (await w.door.view('auto-job')).progress?.lines?.[0]?.state === 'running', 'the recording never got going');
    assert.equal(w.door.startRefusal('auto-job'), AUTO_RECORDING_APP, 'what the start action says');
    await assert.rejects(w.local.startServer(w.list[0]), (err) => err.message === AUTO_RECORDING_APP);
    w.door.handAppOver('auto-job'); // even if it were asked: an app on Auto's database is never his
    await fs.writeFile(holdFile, 'go');
    await untilTrue(async () => { const v = await w.door.view('auto-job'); return v.evidence && !v.recording; }, 'the recording never ended');
    assert.equal(w.local.jobs.get('auto-job').server.status, 'stopped', 'the recording stopped its app');
    assert.equal(w.door.startRefusal('auto-job'), null, 'his Start works again');
  } finally { delete process.env.STARBASE_FAKE_HOLD; await w.done(); }
});

test('a migration that did not land on Auto\'s copy: nothing recorded, Auto is told to stop on the job, nothing goes to the Foreman', { timeout: 60_000 }, async () => {
  const w = await autoWorld({ migrate: 'fake' });
  process.env.FAKE_PG_SILENT = '0002_b';
  try {
    await assert.rejects(w.door.record('auto-job', { waitMs: 50_000 }), (err) => err.status === 409 && /did not land/.test(err.message));
    await settle(200);
    assert.equal(w.sends.length, 1);
    assert.equal(w.sends[0].err.code, 'not-landed', 'passed on as not-landed: the runner stops Auto (runner/auto-db-problems.js)');
    assert.equal(await w.runs(), 0);
    assert.equal(w.local.jobs.get('auto-job')?.server ?? null, null, 'the app never started');
  } finally { delete process.env.FAKE_PG_SILENT; await w.done(); }
});

test('an app that connects to Auto\'s copy and to his database is stopped, nothing is recorded, and it is tried again', { timeout: 60_000 }, async () => {
  const { AUTO_DB_HIS_NEW } = await import('../runner/evidence.js');
  assert.equal(AUTO_DB_HIS_NEW, 'Something new connected to your database while Auto\'s app was starting, so no recording was made. Auto will try again.');
  const w = await autoWorld({ both: true });
  try {
    w.handlers.change();
    await untilTrue(async () => (await w.door.view('auto-job')).problem?.message === AUTO_DB_HIS_NEW, 'the new connection was never seen');
    assert.equal(await w.runs(), 0, 'no Playwright run');
    assert.equal(w.local.jobs.get('auto-job').server.status, 'stopped');
    assert.equal((await w.door.view('auto-job')).problem.waiting, true, 'it is tried again');
    assert.ok(!w.emitted.some((e) => e.outcome === 'not-recorded'));
    // The look again comes by itself.
    const turns = w.steps.filter((x) => x === 'copy auto-job').length;
    await untilTrue(() => w.steps.filter((x) => x === 'copy auto-job').length > turns, 'never tried again');
  } finally { await w.done(); }
});

test('something already on Auto\'s fresh copy before its app starts: no app, nothing recorded, tried again', { timeout: 60_000 }, async () => {
  const { AUTO_DB_TAKEN } = await import('../runner/evidence.js');
  const w = await autoWorld();
  try {
    const made = w.local.autoDatabase;
    w.local.autoDatabase = async (f, o) => {
      const r = await made(f, o);
      const state = JSON.parse(await fs.readFile(process.env.FAKE_PG_STATE, 'utf8'));
      state.databases.app__auto.connections = 1; // an old app reconnecting
      await fs.writeFile(process.env.FAKE_PG_STATE, JSON.stringify(state));
      return r;
    };
    await assert.rejects(w.door.record('auto-job', { waitMs: 50_000 }), (err) => err.status === 409 && err.message === AUTO_DB_TAKEN);
    const view = await w.door.view('auto-job');
    assert.equal(view.problem.message, AUTO_DB_TAKEN);
    assert.equal(view.problem.waiting, true);
    assert.equal(w.local.jobs.get('auto-job')?.server ?? null, null, 'the app never started');
    assert.equal(await w.runs(), 0);
  } finally { await w.done(); }
});

// ---------- Task 9 fix round 2 ----------

/** The fake database state, changed in place. */
async function pgChange(change) {
  const state = JSON.parse(await fs.readFile(process.env.FAKE_PG_STATE, 'utf8'));
  change(state.databases);
  await fs.writeFile(process.env.FAKE_PG_STATE, JSON.stringify(state));
}
/** Runs during(n) at the window's n-th look at Auto's database (the first is the check before the app starts). */
function atLook(w, during) {
  const ask = w.local.autoConnections.bind(w.local);
  let n = 0;
  w.local.autoConnections = async (f) => { n++; await during(n); return ask(f); };
}

test('R6: a session that opens and closes on his database between two looks is caught', { timeout: 60_000 }, async () => {
  const { AUTO_DB_HIS_NEW } = await import('../runner/evidence.js');
  const w = await autoWorld({ times: { lookAgainMs: 600_000 } });
  try {
    atLook(w, async (n) => { if (n === 3) await pgChange((dbs) => { dbs.app.sessions = (dbs.app.sessions ?? 0) + 1; }); });
    await assert.rejects(w.door.record('auto-job', { waitMs: 50_000 }), (err) => err.message === AUTO_DB_HIS_NEW);
    assert.equal(await w.runs(), 0);
  } finally { await w.done(); }
});

test('R6: Starbase\'s own read of his database during the window waits for its end and is never taken for the app\'s', { timeout: 60_000 }, async () => {
  const w = await autoWorld({ times: { lookAgainMs: 600_000 } });
  try {
    let read = null;
    atLook(w, async (n) => { if (n === 3) read = w.local.dbView(w.list[0], { fresh: true }); });
    const r = await w.door.record('auto-job', { waitMs: 50_000 });
    assert.equal(r.evidence.commit, 'abc1234def5');
    assert.ok(read, 'the read was asked for during the window');
    assert.equal((await read).name, 'app', 'and answered after it');
  } finally { await w.done(); }
});

/** Something stays on Auto's fresh copy while taken() says so: an old app reconnecting. */
function holdAutoCopy(w, taken) {
  const made = w.local.autoDatabase;
  w.local.autoDatabase = async (f, o) => {
    const r = await made(f, o);
    if (taken()) await pgChange((dbs) => { dbs.app__auto.connections = 1; });
    return r;
  };
}

test('R7: the third refusal in a row is not tried again: Auto stops on the job with the reason', { timeout: 90_000 }, async () => {
  const { AUTO_DB_TAKEN, AUTO_DB_TAKEN_STOP, AUTO_DB_HIS_NEW_STOP } = await import('../runner/evidence.js');
  assert.equal(AUTO_DB_HIS_NEW_STOP, 'Something new connected to your database each of the 3 times Auto\'s app started, so no recording was made. If that was your own app or a query of yours, switch Auto on again.');
  assert.equal(AUTO_DB_TAKEN_STOP, 'Something stayed connected to Auto\'s copy of the database through 3 tries, so no recording was made. Stop whatever is using it, then switch Auto on again.');
  const w = await autoWorld({ times: { lookAgainMs: 600_000 } });
  try {
    holdAutoCopy(w, () => true);
    for (let i = 0; i < 2; i++) await assert.rejects(w.door.record('auto-job', { waitMs: 50_000 }), (err) => err.message === AUTO_DB_TAKEN);
    assert.deepEqual(w.stops, []);
    await assert.rejects(w.door.record('auto-job', { waitMs: 50_000 }), (err) => err.message === AUTO_DB_TAKEN_STOP);
    await settle(100);
    assert.deepEqual(w.stops, [{ slug: 'auto-job', reason: AUTO_DB_TAKEN_STOP }]);
    const view = await w.door.view('auto-job');
    assert.equal(view.problem.message, AUTO_DB_TAKEN_STOP);
    assert.notEqual(view.problem.waiting, true, 'not waiting to try again');
  } finally { await w.done(); }
});

test('R7: a recording that succeeds resets the count', { timeout: 90_000 }, async () => {
  const { AUTO_DB_TAKEN } = await import('../runner/evidence.js');
  const w = await autoWorld({ times: { lookAgainMs: 600_000 } });
  try {
    let taken = true;
    holdAutoCopy(w, () => taken);
    for (let i = 0; i < 2; i++) await assert.rejects(w.door.record('auto-job', { waitMs: 50_000 }), (err) => err.message === AUTO_DB_TAKEN);
    taken = false;
    assert.equal((await w.door.record('auto-job', { waitMs: 50_000 })).evidence.commit, 'abc1234def5');
    await fs.rm(path.join(w.list[0].dir, 'evidence', 'evidence.json')); // the same commit once more
    taken = true;
    for (let i = 0; i < 2; i++) await assert.rejects(w.door.record('auto-job', { waitMs: 50_000 }), (err) => err.message === AUTO_DB_TAKEN);
    assert.deepEqual(w.stops, [], 'two in a row since the success: no stop');
  } finally { await w.done(); }
});

test('R8: on a job whose Auto already stopped, a migration that did not land still says so in the stop\'s own words', { timeout: 60_000 }, async () => {
  const { AUTO_NOT_LANDED_STOP } = await import('../runner/evidence.js');
  const w = await autoWorld({ migrate: 'fake', auto: { on: true, stopped: { reason: 'earlier', rule: 'blocked', at: OLD } } });
  process.env.FAKE_PG_SILENT = '0002_b';
  try {
    await assert.rejects(w.door.record('auto-job', { waitMs: 50_000 }), (err) => err.message === AUTO_NOT_LANDED_STOP);
    assert.equal((await w.door.view('auto-job')).problem.message, AUTO_NOT_LANDED_STOP);
    await settle(100);
    assert.equal(w.sends[0]?.err.code, 'not-landed', 'passed on: the runner stops Auto, or tells him when there is nothing to stop');
  } finally { delete process.env.FAKE_PG_SILENT; await w.done(); }
});
