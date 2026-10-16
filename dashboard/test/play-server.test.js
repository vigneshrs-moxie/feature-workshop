// The Play layer through the real dashboard: the play settings (POST /api/settings, meta),
// GET /api/play, POST /api/play/secret and /api/play/event (token, fixed lists), the 'play' live
// event when an achievement unlocks, and play.json rebuilt from the audit when it is lost.
// Demo mode on temp folders: no real job, ~/.claude or ~/.feature-workshop is touched and no
// Claude usage is spent.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');

let root, stateDir, featuresDir, dirs, child, base, token;
const output = [];

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

async function start() {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  output.length = 0;
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), HOME: dirs.home, WORKSHOP_DEMO: '1',
      WORKSHOP_FEATURES_DIR: featuresDir, WORKSHOP_PROJECTS_DIR: dirs.projects, WORKSHOP_AGENTS_DIR: dirs.agents,
      WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: stateDir,
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
}

async function stop() {
  if (child && child.exitCode === null) {
    const gone = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM'); // exactly the dashboard this test started
    await gone;
  }
}

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-play-server-')));
  featuresDir = path.join(root, 'feature-work');
  stateDir = path.join(root, 'state');
  dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), home: path.join(root, 'home') };
  for (const d of [featuresDir, stateDir, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  // One job whose first PR exists (a quest done) with a clean review, one still going.
  const done = path.join(featuresDir, 'shipped-job');
  await fs.mkdir(done, { recursive: true });
  await fs.writeFile(path.join(done, 'status.json'), JSON.stringify({
    schema_version: 1, slug: 'shipped-job', title: 'Shipped job', route: 'small', stage: 'pr1', stage_state: 'working',
    // Local noon, so it is never a Night Owl, whatever the time zone.
    prs: [{ number: 1, url: 'https://github.com/example/repo/pull/1', state: 'open' }], updated_at: new Date(2026, 9, 15, 12).toISOString(),
  }, null, 2));
  await fs.writeFile(path.join(done, 'review.md'), '# Review v2\n\n**Result:** 0 blockers, 0 majors, 0 minors\n');
  const going = path.join(featuresDir, 'going-job');
  await fs.mkdir(going, { recursive: true });
  await fs.writeFile(path.join(going, 'status.json'), JSON.stringify({ schema_version: 1, slug: 'going-job', title: 'Going job', stage: 'plan', stage_state: 'working', updated_at: '2026-10-15T10:00:00Z' }, null, 2));
  await start();
});

after(async () => {
  await stop();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const write = async (p, body = {}, { auth = true } = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Workshop-Token': token } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const getJson = async (p) => (await fetch(base + p)).json();

// The v2 events kept for catching up, read once (the ring replays them from since=0).
function eventsSince(epoch, ms = 400) {
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

test('play settings: Subtle, first PR and no sounds by default, in meta and the snapshot', async () => {
  const meta = await getJson('/api/meta');
  assert.deepEqual(meta.settings.play, { mode: 'subtle', questDone: 'first-pr', sounds: false });
  const snap = await getJson('/api/snapshot');
  assert.deepEqual(snap.meta.settings.play, { mode: 'subtle', questDone: 'first-pr', sounds: false });
});

test('play settings: saved through POST /api/settings, checked, and announced', async () => {
  assert.equal((await write('/api/settings', { play: { mode: 'full' } }, { auth: false })).status, 403);
  for (const bad of [{ mode: 'loud' }, { questDone: 'merged' }, { sounds: 'yes' }, { xp: 1 }, 'full', {}]) {
    const r = await write('/api/settings', { play: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.ok(r.body.error);
  }
  const set = await write('/api/settings', { play: { mode: 'full', sounds: true } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.play, { mode: 'full', questDone: 'first-pr', sounds: true });
  assert.equal(set.body.policy, 'hands-off', 'the permission setting is untouched');
  const both = await write('/api/settings', { play: { questDone: 'marked-done' }, policy: 'ask-all' });
  assert.equal(both.status, 200);
  assert.equal(both.body.policy, 'ask-all');
  assert.equal(both.body.play.questDone, 'marked-done');
  assert.equal((await getJson('/api/meta')).settings.play.mode, 'full');
  const saved = JSON.parse(await fs.readFile(path.join(stateDir, 'settings.json'), 'utf8'));
  assert.deepEqual(saved.play, { mode: 'full', questDone: 'marked-done', sounds: true });
  // Back to the defaults for the tests that follow.
  await write('/api/settings', { play: { mode: 'subtle', questDone: 'first-pr', sounds: false }, policy: 'hands-off' });
});

test('GET /api/play: the quest done and the clean review, from the job records', async () => {
  const v = await getJson('/api/play');
  assert.equal(v.mode, 'subtle');
  assert.equal(v.quests.done, 1);
  assert.equal(v.quests.recent[0].slug, 'shipped-job');
  const got = v.achievements.filter((a) => a.unlockedAt).map((a) => a.id).sort();
  assert.deepEqual(got, ['clean-sweep', 'first-quest']);
  assert.equal(v.achievements.filter((a) => !a.secret).length, 10);
  assert.deepEqual(v.secrets, { found: [], total: 13 });
  assert.equal(v.crewTotal, 15);
  await fs.access(path.join(stateDir, 'play.json'));
});

test('POST /api/play/secret: token and fixed ids only, recorded once', async () => {
  assert.equal((await write('/api/play/secret', { id: 'teapot' }, { auth: false })).status, 403);
  assert.equal((await write('/api/play/secret', { id: 'free-xp' })).status, 400);
  assert.equal((await write('/api/play/secret', { id: { toString: 'teapot' } })).status, 400);
  const first = await write('/api/play/secret', { id: 'teapot' });
  assert.equal(first.status, 200);
  assert.equal(first.body.recorded, true);
  assert.deepEqual(first.body.secrets, { found: ['teapot'], total: 13 });
  assert.equal((await write('/api/play/secret', { id: 'teapot' })).body.recorded, false, 'only once');
  const audit = (await fs.readFile(path.join(stateDir, 'audit.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(audit.filter((e) => e.action === 'play-secret').length, 1);
  const v = await getJson('/api/play');
  assert.ok(v.achievements.find((a) => a.id === 'secret-teapot').unlockedAt);
});

test('POST /api/play/event: themes tried, from the fixed list; all five make an Explorer and a play event', async () => {
  assert.equal((await write('/api/play/event', { kind: 'theme', id: 'blueprint' }, { auth: false })).status, 403);
  assert.equal((await write('/api/play/event', { kind: 'xp', id: 'blueprint' })).status, 400);
  assert.equal((await write('/api/play/event', { kind: 'theme', id: 'hot-pink' })).status, 400);
  assert.equal((await write('/api/play/event', { kind: 'constructor', id: 'blueprint' })).status, 400);
  for (const id of ['neon-arcade', 'blueprint', 'pixel-crew', 'sunset-paper', 'candy-pop']) {
    const r = await write('/api/play/event', { kind: 'theme', id });
    assert.equal(r.status, 200);
    assert.equal(r.body.recorded, true);
  }
  const v = await getJson('/api/play');
  assert.ok(v.achievements.find((a) => a.id === 'explorer').unlockedAt);
  const { epoch } = await getJson('/api/snapshot');
  const play = (await eventsSince(epoch)).filter((e) => e.type === 'play');
  const ids = play.map((e) => e.data.achievement.id);
  assert.ok(ids.includes('explorer'), `play events: ${ids}`);
  assert.ok(ids.includes('secret-teapot'));
  const explorer = play.find((e) => e.data.achievement.id === 'explorer').data.achievement;
  assert.equal(explorer.name, 'Explorer');
  assert.ok(explorer.unlockedAt);
});

test('with Play mode Off nothing is recorded', async () => {
  await write('/api/settings', { play: { mode: 'off' } });
  const r = await write('/api/play/secret', { id: 'konami' });
  assert.equal(r.status, 200);
  assert.equal(r.body.recorded, false);
  assert.equal((await write('/api/play/secret', { id: 'nope' })).status, 400, 'still checked');
  await write('/api/settings', { play: { mode: 'subtle' } });
  assert.deepEqual((await getJson('/api/play')).secrets.found, ['teapot']);
});

test('play.json lost: rebuilt from the audit log at start, with the same unlocks', async () => {
  const before = (await getJson('/api/play')).achievements.filter((a) => a.unlockedAt).map((a) => [a.id, a.unlockedAt]);
  await stop();
  await fs.rm(path.join(stateDir, 'play.json'));
  await start();
  const after = (await getJson('/api/play')).achievements.filter((a) => a.unlockedAt).map((a) => [a.id, a.unlockedAt]);
  assert.deepEqual(after.map(([id]) => id).sort(), before.map(([id]) => id).sort());
  const time = (list, id) => list.find(([x]) => x === id)[1];
  for (const id of ['explorer', 'secret-teapot', 'first-quest']) assert.equal(time(after, id), time(before, id), id);
  await fs.access(path.join(stateDir, 'play.json'));
});
