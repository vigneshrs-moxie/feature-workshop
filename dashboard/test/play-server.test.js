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
import { startDashboard } from './helpers/dashboard.js';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');

let root, stateDir, featuresDir, dirs, dashboard, base, token;
const output = [];
const SESSION = '0f1e2d3c-4b5a-4968-8776-655443322110';
const PR_AT = new Date(2026, 9, 15, 12).toISOString();

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

async function start() {
  output.length = 0;
  dashboard = await startDashboard({
    env: {
      HOME: dirs.home, WORKSHOP_DEMO: '1',
      WORKSHOP_FEATURES_DIR: featuresDir, WORKSHOP_PROJECTS_DIR: dirs.projects, WORKSHOP_AGENTS_DIR: dirs.agents,
      WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: stateDir,
    },
    output,
  });
  ({ base } = dashboard);
  token = (await (await fetch(`${base}/api/meta`)).json()).token;
}

async function stop() {
  await dashboard?.stop(); // exactly the dashboard this test started, and what it started
}

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-play-server-')));
  featuresDir = path.join(root, 'feature-work');
  stateDir = path.join(root, 'state');
  dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), home: path.join(root, 'home') };
  for (const d of [featuresDir, stateDir, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  // Settings from before the finish line: the old quest rule "first PR" moves to finishLine 'pr1-open'
  // at start, so an open PR #1 is a quest done here, as it was.
  await fs.writeFile(path.join(stateDir, 'settings.json'), JSON.stringify({ policy: 'hands-off', play: { mode: 'subtle', questDone: 'first-pr', sounds: false } }));
  // One job whose first PR exists (a quest done) with a clean first lens review, one still going.
  const done = path.join(featuresDir, 'shipped-job');
  await fs.mkdir(done, { recursive: true });
  await fs.writeFile(path.join(done, 'status.json'), JSON.stringify({
    schema_version: 1, slug: 'shipped-job', title: 'Shipped job', route: 'small', stage: 'pr1', stage_state: 'working', session_id: SESSION,
    prs: [{ number: 1, url: 'https://github.com/example/repo/pull/1', state: 'open' }], updated_at: new Date(2026, 9, 15, 13).toISOString(),
  }, null, 2));
  await fs.writeFile(path.join(done, 'review.md'), '# Review v1\n\n**Result:** 0 blockers, 0 majors, 0 minors\n');
  // Its Foreman session: started at 11:00 local, the PR created at noon (so never a Night Owl,
  // whatever the time zone), and one review lens (the Fuse) that ran.
  const proj = path.join(dirs.projects, '-tmp-repo');
  await fs.mkdir(path.join(proj, SESSION, 'subagents'), { recursive: true });
  const line = (o) => JSON.stringify({ sessionId: SESSION, cwd: '/tmp/repo', ...o });
  await fs.writeFile(path.join(proj, `${SESSION}.jsonl`), [
    line({ type: 'user', timestamp: new Date(2026, 9, 15, 11).toISOString(), message: { role: 'user', content: '/feature shipped-job' } }),
    line({ type: 'pr-link', timestamp: PR_AT, prUrl: 'https://github.com/example/repo/pull/1', prNumber: 1, prRepository: 'example/repo' }),
  ].join('\n') + '\n');
  await fs.writeFile(path.join(proj, SESSION, 'subagents', 'agent-a1.jsonl'), [
    line({ type: 'user', isSidechain: true, timestamp: new Date(2026, 9, 15, 11, 30).toISOString(), message: { role: 'user', content: 'Review the change.' } }),
    line({ type: 'assistant', isSidechain: true, timestamp: new Date(2026, 9, 15, 11, 40).toISOString(), message: { id: 'm1', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' } }),
  ].join('\n') + '\n');
  await fs.writeFile(path.join(proj, SESSION, 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'feature-review-errors', description: 'Errors lens' }));
  const going = path.join(featuresDir, 'going-job');
  await fs.mkdir(going, { recursive: true });
  await fs.writeFile(path.join(going, 'status.json'), JSON.stringify({ schema_version: 1, slug: 'going-job', title: 'Going job', stage: 'plan', stage_state: 'working', updated_at: '2026-10-15T10:00:00Z' }, null, 2));
  // One whose PR #1 is merged and nothing runs on: past the finish line, waiting on other people (Shipping).
  const merged = path.join(featuresDir, 'merged-job');
  await fs.mkdir(merged, { recursive: true });
  await fs.writeFile(path.join(merged, 'status.json'), JSON.stringify({
    schema_version: 1, slug: 'merged-job', title: 'Merged job', stage: 'pr2', stage_state: 'blocked',
    prs: [{ number: 1, url: 'https://github.com/example/repo/pull/2', state: 'merged' }], updated_at: new Date(2026, 9, 14, 9).toISOString(),
  }, null, 2));
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

test('play settings: Subtle and no sounds by default, in meta and the snapshot; the old quest rule moved to the finish line', { timeout: 60_000 }, async () => {
  const meta = await getJson('/api/meta');
  assert.deepEqual(meta.settings.play, { mode: 'subtle', sounds: false });
  assert.deepEqual(meta.settings.workflow, { finishLine: 'pr1-open', wireframes: 'auto', clarify: 'auto', autoLevel: false }, 'play.questDone first-pr → workflow.finishLine pr1-open; screens and clarify default to Auto');
  assert.deepEqual(meta.finishLines.map((f) => f.id), ['pr1-open', 'pr1-merged', 'staging', 'main', 'marked']);
  assert.ok(meta.finishLines.every((f) => f.label && f.hint));
  const snap = await getJson('/api/snapshot');
  assert.deepEqual(snap.meta.settings.play, { mode: 'subtle', sounds: false });
  const saved = JSON.parse(await fs.readFile(path.join(stateDir, 'settings.json'), 'utf8'));
  assert.equal(saved.play.questDone, undefined, 'written back without the old field');
  assert.deepEqual(saved.workflow, { finishLine: 'pr1-open' });
});

test('finish line: every card says whether it crossed it; a job past it is Shipping', { timeout: 60_000 }, async () => {
  const cards = (await getJson('/api/features')).features;
  assert.deepEqual(cards.find((c) => c.slug === 'shipped-job').finish, { reached: true, at: null, by: 'pr1-open', landed: null });
  assert.deepEqual(cards.find((c) => c.slug === 'merged-job').finish, { reached: true, at: null, by: 'pr1-open', landed: null });
  assert.deepEqual(cards.find((c) => c.slug === 'going-job').finish, { reached: false, at: null, by: null, landed: null });
  const jobs = (await getJson('/api/snapshot')).jobs;
  assert.equal(jobs.find((j) => j.slug === 'merged-job').group, 'shipping');
  assert.equal(jobs.find((j) => j.slug === 'shipped-job').group, 'running', 'its review lens is still at work: running outranks shipping');
  assert.notEqual(jobs.find((j) => j.slug === 'going-job').group, 'shipping');
});

test('finish line: saved through POST /api/settings { workflow }, checked, and announced', { timeout: 60_000 }, async () => {
  for (const bad of [{ finishLine: 'whenever' }, { line: 'main' }, 'main', [], null]) {
    const r = await write('/api/settings', { workflow: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.ok(r.body.error);
  }
  const epoch = (await getJson('/api/snapshot')).epoch;
  const set = await write('/api/settings', { workflow: { finishLine: 'pr1-merged' } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.workflow, { finishLine: 'pr1-merged', wireframes: 'auto', clarify: 'auto', autoLevel: false });
  // Screens and clarify defaults for new jobs: checked, saved beside the finish line, which stays.
  for (const bad of [{ wireframes: 'sometimes' }, { clarify: true }, {}]) assert.equal((await write('/api/settings', { workflow: bad })).status, 400, JSON.stringify(bad));
  const defaults = await write('/api/settings', { workflow: { wireframes: 'always', clarify: 'off' } });
  assert.deepEqual(defaults.body.workflow, { finishLine: 'pr1-merged', wireframes: 'always', clarify: 'off', autoLevel: false });
  await write('/api/settings', { workflow: { wireframes: 'auto', clarify: 'auto' } });
  assert.equal((await getJson('/api/meta')).settings.workflow.finishLine, 'pr1-merged');
  // An open PR #1 is no longer past the line: the card and its group follow.
  const cards = (await getJson('/api/features')).features;
  assert.equal(cards.find((c) => c.slug === 'shipped-job').finish.reached, false);
  assert.deepEqual(cards.find((c) => c.slug === 'merged-job').finish, { reached: true, at: null, by: 'pr1-merged', landed: null }, 'status.json says PR #1 is merged');
  assert.equal((await getJson('/api/snapshot')).jobs.find((j) => j.slug === 'merged-job').group, 'shipping');
  const seen = await eventsSince(epoch, 300);
  assert.ok(seen.some((e) => e.type === 'settings' && e.data.workflow?.finishLine === 'pr1-merged'), 'the settings event carries it');
  assert.ok(seen.some((e) => e.type === 'change'), 'the pages fetch the jobs again');
  // Back, for the tests that follow.
  await write('/api/settings', { workflow: { finishLine: 'pr1-open' } });
});

test('play settings: saved through POST /api/settings, checked, and announced', { timeout: 60_000 }, async () => {
  assert.equal((await write('/api/settings', { play: { mode: 'full' } }, { auth: false })).status, 403);
  for (const bad of [{ mode: 'loud' }, { questDone: 'merged' }, { sounds: 'yes' }, { xp: 1 }, 'full', {}]) {
    const r = await write('/api/settings', { play: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.ok(r.body.error);
  }
  const set = await write('/api/settings', { play: { mode: 'full', sounds: true } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.play, { mode: 'full', sounds: true });
  assert.equal(set.body.policy, 'hands-off', 'the permission setting is untouched');
  const both = await write('/api/settings', { play: { sounds: false }, policy: 'ask-all' });
  assert.equal(both.status, 200);
  assert.equal(both.body.policy, 'ask-all');
  assert.equal(both.body.play.sounds, false);
  assert.equal((await getJson('/api/meta')).settings.play.mode, 'full');
  const saved = JSON.parse(await fs.readFile(path.join(stateDir, 'settings.json'), 'utf8'));
  assert.deepEqual(saved.play, { mode: 'full', sounds: false });
  // Back to the defaults for the tests that follow.
  await write('/api/settings', { play: { mode: 'subtle', sounds: false }, policy: 'hands-off' });
});

test('GET /api/play: the quest done and the clean review, from the job records', { timeout: 60_000 }, async () => {
  const v = await getJson('/api/play');
  assert.equal(v.mode, 'subtle');
  assert.equal(v.quests.done, 2, 'shipped-job and merged-job, both past PR #1 open');
  assert.equal(v.quests.recent[0].slug, 'shipped-job');
  assert.equal(v.quests.recent[0].doneAt, PR_AT, 'when the session log says the PR was created');
  assert.ok(v.crew['feature-review-errors'], 'the lens that ran is met');
  const got = v.achievements.filter((a) => a.unlockedAt).map((a) => a.id).sort();
  assert.deepEqual(got, ['clean-sweep', 'first-quest']);
  assert.equal(v.achievements.filter((a) => !a.secret).length, 10);
  assert.deepEqual(v.secrets, { found: [], total: 13 });
  assert.equal(v.crewTotal, 15);
  await fs.access(path.join(stateDir, 'play.json'));
});

test('POST /api/play/secret: token and fixed ids only, recorded once', { timeout: 60_000 }, async () => {
  assert.equal((await write('/api/play/secret', { id: 'sandwich' }, { auth: false })).status, 403);
  assert.equal((await write('/api/play/secret', { id: 'free-xp' })).status, 400);
  assert.equal((await write('/api/play/secret', { id: { toString: 'sandwich' } })).status, 400);
  // The dashboard's own finds are never the page's to claim.
  for (const id of ['teapot', 'headers', 'hex-sommelier']) assert.equal((await write('/api/play/secret', { id })).status, 400, id);
  const first = await write('/api/play/secret', { id: 'sandwich' });
  assert.equal(first.status, 200);
  assert.equal(first.body.recorded, true);
  assert.deepEqual(first.body.secrets, { found: ['sandwich'], total: 13 });
  assert.equal((await write('/api/play/secret', { id: 'sandwich' })).body.recorded, false, 'only once');
  const audit = (await fs.readFile(path.join(stateDir, 'audit.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(audit.filter((e) => e.action === 'play-secret').length, 1);
  const v = await getJson('/api/play');
  assert.ok(v.achievements.find((a) => a.id === 'secret-sandwich').unlockedAt);
});

test('GET /api/teapot: a real 418; the crew headers point at it, and following them finds two secrets', { timeout: 60_000 }, async () => {
  const meta = await fetch(`${base}/api/meta`);
  assert.equal(meta.headers.get('x-clacks-overhead'), 'GNU Terry Pratchett');
  assert.match(meta.headers.get('x-crew'), /^Foreman, Scribe, Sleuth, .*Oracle$/);
  assert.match(meta.headers.get('x-crew-note'), /\/api\/teapot\?from=headers/);
  // From another site's page: still a teapot, but nothing is recorded.
  const cross = await fetch(`${base}/api/teapot?from=headers`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(cross.status, 418);
  // Nor from a page on another port of this machine.
  assert.equal((await fetch(`${base}/api/teapot?from=headers`, { headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 418);
  assert.deepEqual((await getJson('/api/play')).secrets.found, ['sandwich']);
  const plain = await fetch(`${base}/api/teapot`);
  assert.equal(plain.status, 418);
  assert.deepEqual(await plain.json(), { status: 418, error: 'I’m a teapot', short: true, stout: true, handle: 'here', spout: 'here', brewing: 'Earl Grey, hot', rfc: 'RFC 2324, section 2.3.2' });
  assert.deepEqual((await getJson('/api/play')).secrets.found, ['sandwich', 'teapot']);
  assert.equal((await fetch(`${base}/api/teapot?from=headers`)).status, 418);
  assert.deepEqual((await getJson('/api/play')).secrets.found, ['sandwich', 'teapot', 'headers']);
});

test('POST /api/play/event: themes tried, from the fixed list; all five make an Explorer and a play event', { timeout: 60_000 }, async () => {
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
  const play = (await eventsSince(epoch)).filter((e) => e.type === 'play' && e.data.achievement);
  const ids = play.map((e) => e.data.achievement.id);
  assert.ok(ids.includes('explorer'), `play events: ${ids}`);
  assert.ok(ids.includes('secret-sandwich'));
  assert.ok(ids.includes('secret-teapot'));
  const explorer = play.find((e) => e.data.achievement.id === 'explorer').data.achievement;
  assert.equal(explorer.name, 'Explorer');
  assert.ok(explorer.unlockedAt);
});

test('with Play mode Off nothing is recorded', { timeout: 60_000 }, async () => {
  await write('/api/settings', { play: { mode: 'off' } });
  const r = await write('/api/play/secret', { id: 'konami' });
  assert.equal(r.status, 200);
  assert.equal(r.body.recorded, false);
  assert.equal((await write('/api/play/secret', { id: 'nope' })).status, 400, 'still checked');
  // No teapot and no crew headers either: Off is the dashboard as it was.
  const pot = await fetch(`${base}/api/teapot`);
  assert.equal(pot.status, 404);
  assert.equal(pot.headers.get('x-crew'), null);
  assert.equal(pot.headers.get('x-clacks-overhead'), null);
  await write('/api/settings', { play: { mode: 'subtle' } });
  assert.deepEqual((await getJson('/api/play')).secrets.found, ['sandwich', 'teapot', 'headers']);
});

test('Play mode Off is nothing: GET says only that, play.json is left alone; back on, it catches up without unlock events', { timeout: 60_000 }, async () => {
  const file = path.join(stateDir, 'play.json');
  await getJson('/api/play');
  await new Promise((r) => setTimeout(r, 1800)); // let any refresh already scheduled finish
  await write('/api/settings', { play: { mode: 'off' } });
  const before = await fs.readFile(file, 'utf8');
  assert.deepEqual(await getJson('/api/play'), { mode: 'off' });

  // An L3 job reaches its first PR while Play is Off.
  const boss = path.join(featuresDir, 'boss-job');
  await fs.mkdir(boss, { recursive: true });
  await fs.writeFile(path.join(boss, 'options.json'), JSON.stringify({ schema: 2, level: 3 }));
  await fs.writeFile(path.join(boss, 'status.json'), JSON.stringify({
    schema_version: 1, slug: 'boss-job', title: 'Boss job', stage: 'pr1', stage_state: 'working',
    prs: [{ number: 1, url: 'https://github.com/example/repo/pull/2', state: 'open' }], updated_at: new Date(2026, 9, 15, 14).toISOString(),
  }, null, 2));
  await new Promise((r) => setTimeout(r, 1800)); // longer than the refresh delay
  assert.equal(await fs.readFile(file, 'utf8'), before, 'nothing rebuilt or written while Off');
  assert.deepEqual(await getJson('/api/play'), { mode: 'off' });

  // On again: one refresh finds the quest, and no 'play' event announces what was missed.
  const { epoch } = await getJson('/api/snapshot');
  await write('/api/settings', { play: { mode: 'subtle' } });
  const v = await getJson('/api/play');
  assert.equal(v.quests.done, 3);
  assert.ok(v.achievements.find((a) => a.id === 'boss-slayer').unlockedAt);
  await new Promise((r) => setTimeout(r, 1800));
  const news = (await eventsSince(epoch)).filter((e) => e.type === 'play');
  const ids = news.filter((e) => e.data.achievement).map((e) => e.data.achievement.id);
  assert.ok(!ids.includes('boss-slayer'), `play events: ${ids}`);
  assert.ok(!news.some((e) => e.data.quest?.slug === 'boss-job'), 'no quest event for what was missed');
});

test('play.json lost: rebuilt from the audit log at start, with the same unlocks', { timeout: 60_000 }, async () => {
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

test('POST /api/play/event: a hidden theme counts only once unlocked (CRT Terminal by the Konami code, Gold at 10 quests)', { timeout: 60_000 }, async () => {
  const crt = await write('/api/play/event', { kind: 'theme', id: 'crt' });
  assert.equal(crt.status, 409, 'CRT Terminal is still locked');
  assert.match(crt.body.error, /locked/);
  assert.equal((await write('/api/play/event', { kind: 'theme', id: 'gold' })).status, 409, 'Gold needs 10 quests');
  assert.deepEqual((await getJson('/api/play')).unlocks, { crt: false, gold: false });
  assert.equal((await write('/api/play/secret', { id: 'konami' })).body.recorded, true);
  assert.deepEqual((await getJson('/api/play')).unlocks, { crt: true, gold: false });
  const now = await write('/api/play/event', { kind: 'theme', id: 'crt' });
  assert.equal(now.status, 200);
  assert.equal(now.body.recorded, true);
  assert.ok(now.body.themesTried.includes('crt'));
  assert.equal((await write('/api/play/event', { kind: 'theme', id: 'gold' })).status, 409);
  // Explorer is about the five originals: trying CRT Terminal changes nothing there.
  assert.ok((await getJson('/api/play')).achievements.find((a) => a.id === 'explorer').unlockedAt);
});

test('a quest done while Play is on is a play event with the quest, for the page to celebrate', { timeout: 60_000 }, async () => {
  const { epoch } = await getJson('/api/snapshot');
  const dir = path.join(featuresDir, 'fresh-quest');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({
    schema_version: 1, slug: 'fresh-quest', title: 'Fresh quest', kind: 'bug', stage: 'pr1', stage_state: 'working',
    prs: [{ number: 1, url: 'https://github.com/example/repo/pull/3', state: 'open' }], updated_at: new Date(2026, 9, 15, 15).toISOString(),
  }, null, 2));
  let quest = null;
  for (let i = 0; i < 20 && !quest; i++) {
    await new Promise((r) => setTimeout(r, 400));
    quest = (await eventsSince(epoch, 200)).find((e) => e.type === 'play' && e.data.quest?.slug === 'fresh-quest') ?? null;
  }
  assert.ok(quest, 'a play event for the quest');
  assert.equal(quest.job, 'fresh-quest');
  assert.equal(quest.data.quest.rule, 'pr1-open');
  assert.equal(quest.data.quest.by, 'pr1-open');
  assert.ok(quest.data.quest.doneAt);
});
