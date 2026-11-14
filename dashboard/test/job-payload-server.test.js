// The new job page's routes on the runner (the job page rebuild, Task 4): GET /api/job/:slug/page
// and /item answered from the warm cache (lib/job-payload-cache.js), the `job-page` event when a
// job's payload really changes, the site link leaving that event alone, the website's payload, and
// the speed on the made-up 200-item job. A demo runner in this process, temp folders only: no model,
// no Orbit, no Postgres.

import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createRunner } from '../runner/index.js';
import { createSite } from '../site/index.js';
import jobPageRoutes from '../site/routes-job-page.js';
import { createSiteLink, siteTokenStore, writeSiteFile } from '../runner/site-link.js';
import { jobRecord } from '../runner/mirror.js';
import { jobPageCache, itemSources } from '../lib/job-payload-cache.js';
import { buildJobPage, mirrorJobPage, LOCAL_ONLY } from '../lib/job-payload.js';
import { EVENT_TYPES } from '../lib/protocol.js';
import { renderMarkdown } from '../lib/markdown.js';
import { longJobPage, longJobSource } from './fixtures/long-job.js';

const DASH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD = '2026-10-01T10:00:00Z';
const SLUG = 'notes-on-customers';
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

let root, dirs, repo, runner, hooks, server, base;

async function writeJob(slug, files) {
  const dir = path.join(dirs.features, slug);
  await fsp.mkdir(path.join(dir, 'briefs'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'status.json'), JSON.stringify({
    schema_version: 1, slug, title: 'Notes on customers', route: 'small', stage: 'plan', stage_state: 'working',
    repo: { path: repo, base_branch: 'main' }, updated_at: OLD,
  }, null, 2));
  await fsp.writeFile(path.join(dir, 'options.json'), JSON.stringify({ schema_version: 2, level: 2, flow: 'small', title: 'Notes on customers' }, null, 2));
  for (const [rel, text] of Object.entries(files)) {
    await fsp.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fsp.writeFile(path.join(dir, rel), text);
  }
  return dir;
}

before(async () => {
  root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'starbase-job-payload-')));
  dirs = Object.fromEntries(['claude', 'features', 'projects', 'agents', 'skills', 'state'].map((n) => [n, path.join(root, n)]));
  repo = path.join(root, 'sample-repo');
  for (const d of [...Object.values(dirs), repo]) await fsp.mkdir(d, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  await writeJob(SLUG, {
    'briefs/001-clarify.md': '**Notes on customers** (demo)\n\n- Managers want notes.\n',
    'briefs/002-plan.md': '**The plan** (demo)\n\n- Two screens.\n',
    'implementation-plan.md': '# Implementation plan\n\n1. The notes table.\n',
  });
  runner = await createRunner({
    testHooks: (hooks = {}),
    host: '127.0.0.1', port: 1, token: 't', dashboardDir: DASH, claudeDir: dirs.claude, featuresDir: dirs.features, projectsDir: dirs.projects,
    agentsDir: dirs.agents, skillsDir: dirs.skills, stateDir: dirs.state, demo: true, claudePath: null,
    claudeSettingsFile: path.join(root, 'claude.json'), legacySettingsFile: null, planUsage: false, orbitStore: 'file',
    integrateDir: dirs.state, integrateRoot: path.join(DASH, '..'), siteLink: false, env: {},
  });
  let handler = null;
  server = http.createServer((req, res) => handler(req, res));
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  handler = createSite({ runner, port, token: 't', wireframesOrigin: 'http://127.0.0.1:1', dashboardDir: DASH });
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) await new Promise((r) => { server.close(r); server.closeAllConnections?.(); });
  await runner?.stop();
  if (root) await fsp.rm(root, { recursive: true, force: true });
});

/**
 * A page's event stream (GET /api/events?v=2), as the web app opens it: its first event is `viewer`
 * { id }, with seq 0 and no SSE id. Returns the id, every frame read so far, and close().
 */
async function openViewer() {
  const frames = [];
  let req;
  const id = await new Promise((resolve, reject) => {
    req = http.get(`${base}/api/events?v=2`, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let at;
        while ((at = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, at);
          buf = buf.slice(at + 2);
          frames.push(frame);
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (data) { const e = JSON.parse(data); if (e.type === 'viewer') resolve(e.data.id); }
        }
      });
    });
    req.on('error', reject);
  });
  return { id, frames, close: () => req.destroy() };
}

const get = async (p) => {
  const res = await fetch(`${base}${p}`);
  return { status: res.status, body: await res.json() };
};

/**
 * Spies on everything that would start a program (git, ps, psql: child_process) and on every read
 * under the agents' log folder (projects), plus the runner's one load of every job (which reads
 * every agent's log). Returns the counts and a restore().
 */
function spies() {
  const calls = { spawn: [], logReads: [], loads: 0 };
  const logs = dirs.projects;
  const underLogs = (p) => typeof p === 'string' && p.startsWith(logs);
  for (const name of ['spawn', 'execFile', 'exec', 'fork', 'spawnSync', 'execFileSync', 'execSync']) {
    mock.method(childProcess, name, function spy(...args) { calls.spawn.push([name, args[0]]); throw new Error(`${name} during a request`); });
  }
  for (const name of ['readFile', 'open', 'readdir']) {
    const real = fsp[name];
    mock.method(fsp, name, function spy(p, ...rest) { if (underLogs(String(p))) calls.logReads.push(String(p)); return real.call(this, p, ...rest); });
  }
  for (const name of ['readFileSync', 'createReadStream', 'readdirSync', 'openSync']) {
    const real = fs[name];
    mock.method(fs, name, function spy(p, ...rest) { if (underLogs(String(p))) calls.logReads.push(String(p)); return real.call(this, p, ...rest); });
  }
  syncBuiltinESMExports();
  const was = hooks.featuresLoaded;
  hooks.featuresLoaded = () => { calls.loads++; };
  return {
    calls,
    restore() { mock.restoreAll(); syncBuiltinESMExports(); hooks.featuresLoaded = was; },
  };
}

test('the page: the first request waits for the job’s first build; after that, page and item run no git, ps, psql, agent-log read or rebuild', { timeout: 60_000 }, async () => {
  const first = await get(`/api/job/${SLUG}/page`);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.slug, SLUG);
  assert.ok(first.body.v >= 1);
  assert.equal(first.body.hosted, false);
  assert.deepEqual(first.body.thread.map((l) => l.kind), ['brief', 'brief']);
  const builds = hooks.jobPages.stats().builds;
  const spy = spies();
  try {
    // The spies see what they are meant to: a git call through lib/git.js, a read under the logs folder.
    const git = await import('../lib/git.js');
    await git.isGitRepo(repo).catch(() => false);
    await fsp.readFile(path.join(dirs.projects, 'none.jsonl')).catch(() => null);
    assert.ok(spy.calls.spawn.length > 0, 'the child_process spy sees lib/git.js');
    assert.equal(spy.calls.logReads.length, 1, 'the log spy sees a read under the logs folder');
    spy.calls.spawn.length = 0;
    spy.calls.logReads.length = 0;
    await sleep(1600); // past the runner's 1.5 s job list: a request that asked for it would load every job again
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      assert.equal((await get(`/api/job/${SLUG}/page`)).status, 200);
      assert.equal((await get(`/api/job/${SLUG}/page?v=${first.body.v}`)).status, 200);
      assert.equal((await get(`/api/job/${SLUG}/item?id=${encodeURIComponent(first.body.thread[1].id)}`)).status, 200);
    }
    const ms = performance.now() - t0;
    assert.deepEqual(spy.calls.spawn, [], 'no program started (git, ps, psql)');
    assert.deepEqual(spy.calls.logReads, [], 'no agent log read');
    assert.equal(spy.calls.loads, 0, 'no load of every job');
    assert.equal(hooks.jobPages.stats().builds, builds, 'no rebuild');
    assert.ok(ms < 60 * 100, `60 requests took ${Math.round(ms)} ms`);
  } finally { spy.restore(); }
});

test('?v= the current version answers { same: true, v }', async () => {
  const { body } = await get(`/api/job/${SLUG}/page`);
  assert.deepEqual((await get(`/api/job/${SLUG}/page?v=${body.v}`)).body, { same: true, v: body.v });
  assert.equal((await get(`/api/job/${SLUG}/page?v=${body.v - 1}`)).body.slug, SLUG);
  assert.equal((await get(`/api/job/${SLUG}/page?v=nonsense`)).body.slug, SLUG);
});

test('the item: an answered brief’s body is rendered once, then kept', async () => {
  const { body } = await get(`/api/job/${SLUG}/page`);
  const answered = body.thread.find((l) => l.kind === 'brief' && l.answered === true);
  assert.ok(answered, 'brief 1 is answered: a newer brief came');
  const before = hooks.jobPages.stats().renders;
  const one = await get(`/api/job/${SLUG}/item?id=${encodeURIComponent(answered.id)}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.id, answered.id);
  assert.equal(one.body.kind, 'brief');
  assert.equal(one.body.version, answered.hash);
  assert.match(one.body.html, /Notes on customers/);
  assert.match(one.body.text, /Managers want notes/);
  assert.equal(one.body.meta.file, 'briefs/001-clarify.md');
  await get(`/api/job/${SLUG}/item?id=${encodeURIComponent(answered.id)}`);
  await get(`/api/job/${SLUG}/item?id=${encodeURIComponent(answered.id)}`);
  assert.equal(hooks.jobPages.stats().renders, before + 1);
});

test('an unknown job is a 404 on both routes; an unknown item a 404; an item with no id a 400', async () => {
  for (const p of ['/api/job/no-such-job/page', '/api/job/no-such-job/item?id=x']) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.match(r.body.error, /No job by that name/);
  }
  assert.equal((await get(`/api/job/${SLUG}/item?id=reply%3Anope`)).status, 404);
  assert.equal((await get(`/api/job/${SLUG}/item`)).status, 400);
  assert.equal(hooks.jobPages.has('no-such-job'), false);
});

test('the event stream names itself first (viewer { id }, seq 0, no SSE id); a page that sends it watches the job until the stream closes', { timeout: 60_000 }, async () => {
  const viewer = await openViewer();
  try {
    assert.match(viewer.id, /^[0-9a-f]{16}$/);
    const frame = viewer.frames.find((f) => f.includes('"viewer"'));
    assert.doesNotMatch(frame, /^id:/m, 'no SSE id: the resume point stays the last real event');
    assert.equal(JSON.parse(/^data: (.*)$/m.exec(frame)[1]).seq, 0, 'seq 0: the old store never applies it');
    assert.equal(hooks.jobPages.stats().viewers, 0);
    await get(`/api/job/${SLUG}/page?viewer=${viewer.id}`);
    assert.equal(hooks.jobPages.stats().viewers, 1);
    await get(`/api/job/${SLUG}/page?viewer=${'0'.repeat(16)}`);
    assert.equal(hooks.jobPages.stats().viewers, 1, 'an id no open stream has watches nothing');
  } finally { viewer.close(); }
  const end = Date.now() + 5000;
  while (Date.now() < end && hooks.jobPages.stats().viewers) await sleep(20);
  assert.equal(hooks.jobPages.stats().viewers, 0, 'gone with its stream');
});

test('a document rewritten without a new version moves v: its output carries its text’s hash, the item’s version', { timeout: 60_000 }, async () => {
  const viewer = await openViewer();
  try {
    const { body } = await get(`/api/job/${SLUG}/page?viewer=${viewer.id}`);
    const out = body.steps.flatMap((st) => st.outputs).find((o) => o.id === 'implementation-plan.md');
    assert.ok(out, JSON.stringify(body.steps.map((st) => st.outputs.map((o) => o.id))));
    assert.match(out.hash, /^[0-9a-f]{12}$/);
    assert.equal((await get(`/api/job/${SLUG}/item?id=implementation-plan.md`)).body.version, out.hash);
    assert.equal(body.rows.conversation.more, false);
    await fsp.writeFile(path.join(dirs.features, SLUG, 'implementation-plan.md'), '# Implementation plan\n\n1. The notes table.\n2. The export.\n');
    hooks.jobPages.touch(SLUG); // the file's change point (fs.watch → thread), which this runner, not started, does not watch
    let now = body;
    const end = Date.now() + 10_000;
    while (Date.now() < end && now.v === body.v) { await sleep(50); now = (await get(`/api/job/${SLUG}/page?viewer=${viewer.id}`)).body; }
    assert.equal(now.v, body.v + 1);
    const after = now.steps.flatMap((st) => st.outputs).find((o) => o.id === 'implementation-plan.md');
    assert.equal(after.version, out.version, 'the same version number');
    assert.notEqual(after.hash, out.hash);
    const item = (await get(`/api/job/${SLUG}/item?id=implementation-plan.md`)).body;
    assert.equal(item.version, after.hash);
    assert.match(item.text, /The export/);
  } finally { viewer.close(); }
});

test('a job no open page watches is not rebuilt on its changes: it rebuilds behind its next request', { timeout: 60_000 }, async () => {
  await get(`/api/job/${SLUG}/page`);
  const end0 = Date.now() + 5000;
  while (Date.now() < end0 && hooks.jobPages.stats().viewers) await sleep(20);
  const builds = hooks.jobPages.stats().builds;
  hooks.jobPages.touch(SLUG);
  hooks.jobPages.touch(SLUG);
  await sleep(1300);
  assert.equal(hooks.jobPages.stats().builds, builds, 'nobody watches it');
  await get(`/api/job/${SLUG}/page`);
  const end = Date.now() + 5000;
  while (Date.now() < end && hooks.jobPages.stats().builds === builds) await sleep(20);
  assert.equal(hooks.jobPages.stats().builds, builds + 1, 'rebuilt behind the request');
});

test('a change to the job rebuilds its page: v goes up and a job-page event { slug, v } is sent', { timeout: 60_000 }, async () => {
  assert.ok(EVENT_TYPES.includes('job-page'));
  const viewer = await openViewer();
  const { body } = await get(`/api/job/${SLUG}/page?viewer=${viewer.id}`);
  const seen = [];
  const off = runner.on('job-page', (job, data) => seen.push({ job, data }));
  try {
    // Marking it done writes an audit line for the job: the runner's thread change point.
    await runner.handle({ type: 'close', slug: SLUG, as: 'done' }, { from: 'local' });
    const end = Date.now() + 15_000;
    while (Date.now() < end && !seen.length) await sleep(50);
    assert.ok(seen.length, 'a job-page event');
    assert.equal(seen.at(-1).job, SLUG);
    assert.deepEqual(seen.at(-1).data, { slug: SLUG, v: body.v + 1 });
    const now = await get(`/api/job/${SLUG}/page`);
    assert.equal(now.body.v, body.v + 1);
    assert.equal(now.body.state, 'done');
  } finally { off(); viewer.close(); }
});

test('the site link takes no notice of job-page: it reads no job again for it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starbase-job-page-link-'));
  writeSiteFile(dir, { url: 'https://starbase.example.test', deviceId: 'device-test-0099', runnerId: 1, name: 'Test Laptop' });
  const store = await siteTokenStore({ stateDir: dir, prefer: 'file' });
  await store.set('runner-token-for-a-test-only');
  const ee = new EventEmitter();
  const card = { slug: 'job-a', title: 'Job A', stage: 'plan', group: 'working' };
  let reads = 0;
  const fake = {
    read: { features: async () => ({ features: [card] }), snapshot: async () => ({ jobs: [card] }), job: async () => { reads++; return card; } },
    on(type, fn) { ee.on(type, fn); return () => ee.off(type, fn); },
  };
  const fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/api/runner/commands') await sleep(300);
    return { status: 200, json: async () => (u.pathname === '/api/runner/events' ? { refused: [] } : { commands: [] }) };
  };
  const link = createSiteLink({ runner: fake, stateDir: dir, store, fetch, waitSeconds: 1, debounceMs: 10, watchEveryMs: 0, log: () => {}, version: '0.1.0' }).start();
  const until = async (check, what) => { for (let i = 0; i < 200 && !check(); i++) await sleep(25); assert.ok(check(), what); };
  try {
    await until(() => reads >= 1, 'the first full record');
    await sleep(200);
    const at = reads;
    ee.emit('*', 'job-page', 'job-a', { slug: 'job-a', v: 2 });
    await sleep(300);
    assert.equal(reads, at, 'job-page reads nothing again');
    ee.emit('*', 'thread', 'job-a', {});
    await until(() => reads > at, 'a thread event does read the job again');
  } finally { link.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the website’s payload: the same shape from the mirrored job record, hosted, without the laptop-only fields', () => {
  const { facts, payload } = longJobPage({ size: 52 });
  const record = jobRecord({ ...facts.card, ...facts.detail, thread: facts.thread });
  const site = mirrorJobPage(record, { row: { lane: facts.lane, laneReason: facts.laneReason }, v: 5 });
  assert.deepEqual(LOCAL_ONLY, ['drive', 'lock', 'local']);
  assert.deepEqual(Object.keys(site).sort(), Object.keys(payload).filter((k) => !LOCAL_ONLY.includes(k)).sort());
  for (const k of LOCAL_ONLY) assert.equal(k in site, false, k);
  assert.equal(site.hosted, true);
  assert.equal(site.v, 5);
  assert.equal(site.rows.conversation.more, false);
  assert.equal(mirrorJobPage({ ...record, threadMore: true }).rows.conversation.more, true, 'the record cut to the newest 60 says so');
  assert.ok(site.steps.flatMap((st) => st.outputs).filter((o) => o.kind === 'doc').every((o) => o.hash === null), 'no text on the record: no hash');
  assert.equal(site.state, payload.state);
  assert.deepEqual(site.steps.map((s) => [s.id, s.state]), payload.steps.map((s) => [s.id, s.state]));
  assert.deepEqual(site.move?.kind, payload.move?.kind);
  // The Foreman's replies stay on the laptop: their lines are small notes saying so, with no words of the reply.
  const replyIds = new Set(payload.thread.filter((l) => l.kind === 'reply').map((l) => l.id));
  for (const l of site.thread.filter((x) => replyIds.has(x.id))) {
    assert.equal(l.kind, 'small');
    assert.match(l.headline, /The Foreman replied here/);
  }
});

test('speed on the made-up 200-item job: page warm under 100 ms, item under 50 ms', { timeout: 120_000 }, async (t) => {
  const job = longJobPage({ size: 200 });
  const src = longJobSource({ size: 200 });
  const briefTexts = new Map(src.briefs.map((b) => [b.file, b.text]));
  const docs = src.docs.map((d) => ({ file: d.file, name: d.file, type: /\.json$/.test(d.file) ? 'json' : 'md', text: d.text, updatedAt: d.updatedAt, size: d.text.length, summary: null }));
  const slug = job.payload.slug;
  const cache = jobPageCache({
    build: async (s) => (s === slug ? { payload: buildJobPage(job.facts), sources: itemSources({ payload: job.payload, thread: job.facts.thread, briefTexts, docs, decided: job.facts.detail.decidedOnYourBehalf, render: (text) => renderMarkdown(text) }) } : null),
  });
  // The page's routes as the site mounts them (site/routes-job-page.js), on a bare server: the site's
  // other route lists need the whole runner, and these two need only read.jobPage and read.jobItem.
  const routes = jobPageRoutes({
    read: { jobPage: (s, v) => cache.page(s, v), jobItem: (s, id) => cache.item(s, id) },
    sendJson: (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); },
  });
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    for (const r of routes) {
      const m = r.path.exec(p);
      if (!m) continue;
      try { return await r.run({ req, res, url, m }); } catch (err) { res.writeHead(err.status ?? 500); return res.end(JSON.stringify({ error: err.message })); }
    }
    res.writeHead(404);
    return res.end('{}');
  });
  await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
  const port = srv.address().port;
  const at = (p) => `http://127.0.0.1:${port}${p}`;
  const time = async (p) => { const t0 = performance.now(); const res = await fetch(at(p)); const body = await res.text(); return { ms: performance.now() - t0, status: res.status, size: body.length, body }; };
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  try {
    const cold = await time(`/api/job/${slug}/page`);
    assert.equal(cold.status, 200);
    assert.equal(JSON.parse(cold.body).thread.length, 200);
    const page = [];
    for (let i = 0; i < 50; i++) page.push((await time(`/api/job/${slug}/page`)).ms);
    const same = [];
    for (let i = 0; i < 50; i++) same.push((await time(`/api/job/${slug}/page?v=1`)).ms);
    // Every conversation item once (its first render), then the longest reply again (kept).
    const firstItem = [];
    for (const line of job.payload.thread) {
      const r = await time(`/api/job/${slug}/item?id=${encodeURIComponent(line.id)}`);
      assert.equal(r.status, 200, line.id);
      firstItem.push(r.ms);
    }
    const longest = job.payload.thread.filter((l) => l.kind === 'reply').map((l) => l.id).at(-1);
    const kept = [];
    for (let i = 0; i < 50; i++) kept.push((await time(`/api/job/${slug}/item?id=${encodeURIComponent(longest)}`)).ms);
    const r = (x) => Math.round(x * 10) / 10;
    const line = `page ${Math.round(cold.size / 1024)} KB: cold ${r(cold.ms)} ms, warm median ${r(median(page))} max ${r(Math.max(...page))}; same median ${r(median(same))}; item first render median ${r(median(firstItem))} max ${r(Math.max(...firstItem))}; item kept median ${r(median(kept))} max ${r(Math.max(...kept))}`;
    t.diagnostic(line);
    console.log(`[job page speed] ${line}`);
    assert.ok(median(page) < 100, `page warm median ${median(page)} ms`);
    assert.ok(median(firstItem) < 50, `item first render median ${median(firstItem)} ms`);
    assert.ok(median(kept) < 50, `item kept median ${median(kept)} ms`);
  } finally {
    cache.close();
    await new Promise((res) => { srv.close(res); srv.closeAllConnections?.(); });
  }
});

test('Task 10 fix round 1: a document only the reader reaches (a step’s `more`) is served by the item route, with its hash', { timeout: 60_000 }, async () => {
  const slug = 'notes-lens-rounds';
  await writeJob(slug, {
    'review.md': '# Review (combined)\n\nNothing open.\n',
    'review/errors-r1.md': '# Errors, round 1\n\nOne finding.\n',
  });
  await sleep(1600); // past the runner's 1.5 s job list, so it lists the new job
  const { status, body } = await get(`/api/job/${slug}/page`);
  assert.equal(status, 200, JSON.stringify(body));
  const review = body.steps.find((st) => st.id === 'review');
  assert.ok(!review.outputs.some((o) => o.id === 'review/errors-r1.md'), 'not listed on the left');
  const more = review.more.find((o) => o.id === 'review/errors-r1.md');
  assert.ok(more, JSON.stringify(review.more));
  assert.match(more.hash, /^[0-9a-f]{12}$/);
  const item = (await get(`/api/job/${slug}/item?id=${encodeURIComponent('review/errors-r1.md')}`)).body;
  assert.equal(item.version, more.hash);
  assert.match(item.text, /One finding/);
});

test('Task 12: the ticket and goal is served by the item route (id ticket) from the job’s page facts', { timeout: 60_000 }, async () => {
  const slug = 'notes-ticket-goal';
  await writeJob(slug, { 'acceptance.md': '# Acceptance\n\n## It works when\n\n1. A manager can add a note.\n\n## It must not\n\n1. Show a note to another office.\n' });
  await sleep(1600); // past the runner's 1.5 s job list, so it lists the new job
  assert.equal((await get(`/api/job/${slug}/page`)).status, 200);
  const item = await get(`/api/job/${slug}/item?id=ticket`);
  assert.equal(item.status, 200, JSON.stringify(item.body));
  assert.equal(item.body.kind, 'ticket');
  assert.match(item.body.text, /This job did not start from an Orbit ticket\./);
  assert.match(item.body.text, /### It works when\n\n1\. A manager can add a note\./);
  assert.match(item.body.html, /<h2[^>]*>What to check<\/h2>/);
});

test('Task 12 fix round 1: a document’s older version is copied into the job’s versions/ at a rebuild, listed on its output, served by the item route; requests write nothing', { timeout: 60_000 }, async () => {
  const slug = 'notes-versions';
  const dir = await writeJob(slug, { 'implementation-plan.md': '# Implementation plan v1\n\n1. The notes table.\n' });
  const status = async (version) => {
    const st = JSON.parse(await fsp.readFile(path.join(dir, 'status.json'), 'utf8'));
    st.artifacts = [{ name: 'Implementation plan', path: 'implementation-plan.md', version }];
    await fsp.writeFile(path.join(dir, 'status.json'), JSON.stringify(st, null, 2));
  };
  await status('1');
  await sleep(1600); // past the runner's 1.5 s job list, so it lists the new job
  const viewer = await openViewer();
  try {
    const { body } = await get(`/api/job/${slug}/page?viewer=${viewer.id}`);
    const out = body.steps.flatMap((st) => st.outputs).find((o) => o.id === 'implementation-plan.md');
    assert.equal(out.version, '1');
    assert.deepEqual(out.versions, [], 'nothing older yet');
    assert.equal(await fsp.readFile(path.join(dir, 'versions', 'implementation-plan.v1.md'), 'utf8'), '# Implementation plan v1\n\n1. The notes table.\n');
    // The bodies with no line or output of their own carry their hash on the payload.
    assert.equal(body.hashes.ticket, (await get(`/api/job/${slug}/item?id=ticket`)).body.version);
    assert.equal(body.hashes.decisions, (await get(`/api/job/${slug}/item?id=decisions`)).body.version);
    await fsp.writeFile(path.join(dir, 'implementation-plan.md'), '# Implementation plan v2\n\n1. The notes table.\n2. The export.\n');
    await status('2');
    await sleep(1600);
    hooks.jobPages.touch(slug);
    let now = body;
    const end = Date.now() + 10_000;
    while (Date.now() < end && now.v === body.v) { await sleep(50); now = (await get(`/api/job/${slug}/page?viewer=${viewer.id}`)).body; }
    const after = now.steps.flatMap((st) => st.outputs).find((o) => o.id === 'implementation-plan.md');
    assert.equal(after.version, '2');
    assert.deepEqual(after.versions, [{ n: '1', id: 'versions/implementation-plan.v1.md' }]);
    const v1 = (await get(`/api/job/${slug}/item?id=${encodeURIComponent('versions/implementation-plan.v1.md')}`)).body;
    assert.equal(v1.kind, 'doc');
    assert.match(v1.text, /Implementation plan v1/);
    assert.equal(v1.meta.version, '1');
    assert.equal(v1.meta.of, 'implementation-plan.md');
    // Requests read from the cache: no copy is written or rewritten by them.
    const files = async () => Promise.all((await fsp.readdir(path.join(dir, 'versions'))).sort().map(async (n) => [n, (await fsp.stat(path.join(dir, 'versions', n))).mtimeMs]));
    const before = await files();
    for (let i = 0; i < 3; i++) {
      await get(`/api/job/${slug}/page?viewer=${viewer.id}`);
      await get(`/api/job/${slug}/item?id=${encodeURIComponent('versions/implementation-plan.v1.md')}`);
    }
    assert.deepEqual(await files(), before);
    assert.deepEqual(before.map(([n]) => n), ['implementation-plan.v1.md', 'implementation-plan.v2.md']);
  } finally { viewer.close(); }
});

test('Task 12 fix round 2: a write in a job’s versions/ folder starts no rebuild; any other file of the job does', { timeout: 60_000 }, async () => {
  const slug = 'notes-versions-watch';
  await writeJob(slug, { 'implementation-plan.md': '# Implementation plan\n' });
  await sleep(1600); // past the runner's 1.5 s job list, so it lists the new job
  const viewer = await openViewer();
  try {
    await get(`/api/job/${slug}/page?viewer=${viewer.id}`);
    await sleep(1200); // anything the first build set going settles
    const before = hooks.jobPages.stats().builds;
    hooks.featuresWatch('rename', path.join(slug, 'versions', 'implementation-plan.v1.md'));
    hooks.featuresWatch('change', path.join(slug, 'versions', 'implementation-plan.v1.md.1.abcd1234.tmp'));
    await sleep(1500); // past the thread (300 ms), change (700 ms) and rebuild (150 ms) waits
    assert.equal(hooks.jobPages.stats().builds, before, 'a copy is no change of the job');
    hooks.featuresWatch('change', path.join(slug, 'implementation-plan.md'));
    const end = Date.now() + 5000;
    while (Date.now() < end && hooks.jobPages.stats().builds === before) await sleep(50);
    assert.ok(hooks.jobPages.stats().builds > before, 'a document of the job is');
  } finally { viewer.close(); }
});

test('Task 23 fix round (speed rule 2): the commit list of a job the page watches comes from its page build: no git on the request, and a new commit is in it after the next rebuild', { timeout: 60_000 }, async () => {
  const slug = 'commits-from-the-page';
  const g = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8' }).trim();
  await fsp.writeFile(path.join(repo, 'a.txt'), 'a\n');
  g('add', '-A'); g('commit', '-q', '-m', 'start');
  const baseSha = g('rev-parse', 'HEAD');
  g('switch', '-q', '-c', 'feature/commits-from-the-page');
  await fsp.writeFile(path.join(repo, 'b.txt'), 'b\n');
  g('add', '-A'); g('commit', '-q', '-m', 'feat: the first commit');
  g('switch', '-q', '-');
  const dir = await writeJob(slug, { 'implementation-plan.md': '# Plan\n\n1. One step.\n' });
  const status = JSON.parse(await fsp.readFile(path.join(dir, 'status.json'), 'utf8'));
  await fsp.writeFile(path.join(dir, 'status.json'), JSON.stringify({ ...status, stage: 'implement', branch: 'feature/commits-from-the-page', base_sha: baseSha }, null, 2));
  const viewer = await openViewer();
  try {
    // (The runner's job list is kept 1.5 s, and a slug just found missing answers 404 for 5 s.)
    let first = await get(`/api/job/${slug}/page?viewer=${viewer.id}`);
    const until = Date.now() + 15_000;
    while (first.status === 404 && Date.now() < until) { await sleep(250); first = await get(`/api/job/${slug}/page?viewer=${viewer.id}`); }
    assert.equal(first.status, 200, JSON.stringify(first.body));
    // The list is read behind the page's answer (fix round 2): ready once that read lands.
    await hooks.jobPages.commitsReady(slug);
    await sleep(1600); // past the runner's 1.5 s job list: a route that asked for it would load every job again
    const spy = spies();
    let one;
    try { one = await get(`/api/job/${slug}/commits`); } finally { spy.restore(); }
    assert.equal(one.status, 200, JSON.stringify(one.body));
    assert.deepEqual(one.body.commits.map((c) => c.subject), ['feat: the first commit']);
    assert.deepEqual(one.body.commits[0].files.map((f) => f.path), ['b.txt']);
    assert.deepEqual(spy.calls.spawn, [], 'no git on the request: the list was read at the page build');
    // The newest commit's diff too (what Changes shows first): read at the build, answered without git.
    const spyDiff = spies();
    let diff;
    try { diff = await get(`/api/job/${slug}/commit/${one.body.commits[0].sha}`); } finally { spyDiff.restore(); }
    assert.equal(diff.status, 200, JSON.stringify(diff.body));
    assert.deepEqual(diff.body.patchFiles.map((f) => f.path), ['b.txt']);
    assert.deepEqual(spyDiff.calls.spawn, [], 'no git for the newest commit\'s diff');
    assert.equal(spy.calls.loads + spyDiff.calls.loads, 0, 'no load of every job (no job-list check before the kept answer)');
    // Fix round 2 (M1): a rebuild while the branch has not moved keeps the list it has, reading nothing.
    const lists = hooks.commitLists;
    const builds = hooks.jobPages.stats().builds;
    hooks.jobPages.touch(slug);
    const until2 = Date.now() + 10_000;
    while (Date.now() < until2 && hooks.jobPages.stats().builds === builds) await sleep(20);
    await sleep(100);
    await hooks.jobPages.commitsReady(slug);
    assert.equal(hooks.commitLists, lists, 'no read of the branch for an unmoved branch');
    // A new commit on the branch, then the job's change point: the next rebuild reads the list again.
    g('switch', '-q', 'feature/commits-from-the-page');
    await fsp.writeFile(path.join(repo, 'c.txt'), 'c\n');
    g('add', '-A'); g('commit', '-q', '-m', 'feat: the second commit');
    g('switch', '-q', '-');
    // Before the rebuild, the ref files have moved: the route reads the branch itself (git), not the old list.
    const stale = await get(`/api/job/${slug}/commits`);
    assert.equal(stale.body.commits.length, 2, 'never the list from before the commit');
    hooks.jobPages.touch(slug);
    const end = Date.now() + 10_000;
    while (Date.now() < end && hooks.jobPages.commits(slug)?.list.commits.length !== 2) await sleep(20);
    const spy2 = spies();
    let two;
    try { two = await get(`/api/job/${slug}/commits`); } finally { spy2.restore(); }
    assert.deepEqual(two.body.commits.map((c) => c.subject), ['feat: the second commit', 'feat: the first commit']);
    assert.deepEqual(spy2.calls.spawn, []);
  } finally { viewer.close(); }
});

test('Task 21 final wave: a page’s GitHub read (Pull now, the opening read) loads no job list behind its answer: the watchers take the one held', { timeout: 60_000 }, async () => {
  assert.equal((await get(`/api/job/${SLUG}/page`)).status, 200);
  assert.equal((await get(`/api/job/${SLUG}`)).status, 200); // the job list is held now
  await new Promise((r) => setTimeout(r, 1700)); // older than the list's usual 1.5 s
  const was = hooks.featuresLoaded;
  let loads = 0;
  hooks.featuresLoaded = () => { loads++; };
  try {
    const before = (await get('/api/flow')).body.fetchedAt;
    const res = await fetch(`${base}/api/job/${SLUG}/pr/1/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Starbase-Token': 't' }, body: '{}' });
    assert.equal(res.status, 200);
    let read = false;
    for (let i = 0; i < 200 && !read; i++) { const f = (await get('/api/flow')).body; read = f.fetchedAt !== before && !f.refreshing; if (!read) await new Promise((r) => setTimeout(r, 50)); }
    assert.ok(read, 'the read ended');
    await new Promise((r) => setTimeout(r, 300)); // the watchers after the read
    assert.equal(loads, 0, 'no load of every job (and every agent’s log) for one page’s read');
  } finally { hooks.featuresLoaded = was; }
});
