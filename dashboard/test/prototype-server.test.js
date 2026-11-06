// The Screens tab's Publish and Pull notes: lib/prototype.js (is this laptop set up, what a job last
// published, running publish.py) and the two routes. A stand-in script takes publish.py's place
// (in a skills folder of the test's own), so nothing reaches a site. The dashboard runs in demo mode on temp
// folders, so no real job or ~/.claude is touched. Tokens here are made up.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BROKEN_FILE, DEFAULT_SITE, NOT_PRIVATE, NOT_SET_UP, prototypeInfo, prototypesSetup, publishScript, runPublish } from '../lib/prototype.js';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const MADE_UP_TOKEN = 'ptp_made-up-token-for-tests';

// publish.py's outside, by the job's name: what it prints, what it writes, how it fails.
const STUB = String.raw`
import json, os, sys, time
args = sys.argv[1:]
slug = args[args.index("--job") + 1]
assert "--json" in args
folder = os.path.join(os.environ["STARBASE_FEATURES_DIR"], slug)
if slug == "refused":
    print("warning: this line isn't the failure", file=sys.stderr)
    print("The site refused the token.", file=sys.stderr)
    sys.exit(4)
if slug == "garbled":
    print("not json")
    sys.exit(0)
if slug == "slow":
    time.sleep(1)
if "--notes" in args:
    if slug == "quiet":
        print(json.dumps({"feature": {"latest_revision": 2}, "notes": [], "choices": [], "lines": [], "since": "2026-11-05T22:10:04.120Z"}))
    else:
        print("warning: people picked differently on c-nav; every pick is listed, oldest first", file=sys.stderr)
        print(json.dumps({"feature": {"latest_revision": 3}, "notes": [{"by": {"email": "sam.sample@example.test"}}], "choices": [], "lines": ["Pick A for c-nav", "s-team (laptop): question: Who sees this?"], "since": None}))
    sys.exit(0)
url = "https://prototypes.example.test/f/" + slug
with open(os.path.join(folder, "prototype.json"), "w") as f:
    json.dump({"key": slug, "site": "https://prototypes.example.test", "url": url, "revision": 4, "published_at": "2026-11-05T21:30:00+00:00"}, f)
print(json.dumps({"key": slug, "revision": 4, "url": url, "created": False}))
`;

let root, featuresDir, home, stub, child, base, token;
const output = [];

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

async function writeJob(slug) {
  const dir = path.join(featuresDir, slug);
  await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ schema_version: 1, slug, title: `Job ${slug}`, route: 'small', stage: 'wireframe', stage_state: 'waiting_for_you', updated_at: '2026-11-05T12:00:00Z' }));
  await fs.writeFile(path.join(dir, 'wireframes.html'), '<!doctype html><title>Screens</title>');
}

const tokenFile = (text, mode = 0o600) => fs.writeFile(path.join(home, '.claude', 'prototypes.json'), text, { mode }).then(() => fs.chmod(path.join(home, '.claude', 'prototypes.json'), mode));
const post = (p) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Starbase-Token': token }, body: '{}' });
const postJson = async (p) => { const res = await post(p); return { status: res.status, body: await res.json().catch(() => null) }; };
const meta = async () => (await fetch(`${base}/api/meta`)).json();

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-prototype-')));
  featuresDir = path.join(root, 'feature-work');
  home = path.join(root, 'home');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state') };
  for (const d of [featuresDir, path.join(home, '.claude'), ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  stub = path.join(dirs.skills, 'wireframe', 'publish.py');
  await fs.mkdir(path.dirname(stub));
  await fs.writeFile(stub, STUB);
  for (const slug of ['add-export', 'quiet', 'refused', 'garbled', 'slow']) await writeJob(slug);

  const port = await freePort();
  const screensPort = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), WIREFRAMES_PORT: String(screensPort), HOME: home, USERPROFILE: home, STARBASE_DEMO: '1',
      STARBASE_FEATURES_DIR: featuresDir, STARBASE_PROJECTS_DIR: dirs.projects, STARBASE_AGENTS_DIR: dirs.agents,
      STARBASE_SKILLS_DIR: dirs.skills, STARBASE_STATE_DIR: dirs.state,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The dashboard didn't start:\n${output.join('')}`)), 15000);
    child.stdout.on('data', (d) => { output.push(String(d)); if (output.join('').includes('Starbase running') && output.join('').includes('screens:')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', (d) => output.push(String(d)));
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`The dashboard exited (${code}):\n${output.join('')}`)); });
  });
  token = (await meta()).token;
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM'); // exactly the dashboard this test started
    await gone;
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('set up: the site from the file and never the token; missing, open to others or broken says why', async () => {
  const dir = await fs.mkdtemp(path.join(root, 'claude-'));
  const file = path.join(dir, 'prototypes.json');
  assert.deepEqual(await prototypesSetup(dir), { prototypes: null, prototypesWhy: NOT_SET_UP });
  await fs.writeFile(file, JSON.stringify({ site: 'https://prototypes.example.test/', token: MADE_UP_TOKEN }), { mode: 0o600 });
  const ready = await prototypesSetup(dir);
  assert.deepEqual(ready, { prototypes: { site: 'https://prototypes.example.test' }, prototypesWhy: null });
  assert.ok(!JSON.stringify(ready).includes(MADE_UP_TOKEN));
  await fs.chmod(file, 0o644);
  // Windows has no such bits to read, so there the file is taken as it is, as publish.py does.
  assert.deepEqual(await prototypesSetup(dir, { platform: 'win32' }), ready);
  if (process.platform !== 'win32') assert.deepEqual(await prototypesSetup(dir), { prototypes: null, prototypesWhy: NOT_PRIVATE });
  await fs.chmod(file, 0o600);
  await fs.writeFile(file, JSON.stringify({ token: MADE_UP_TOKEN }));
  assert.equal((await prototypesSetup(dir)).prototypes.site, DEFAULT_SITE, 'site is optional in the file');
  await fs.writeFile(file, 'not json');
  assert.deepEqual(await prototypesSetup(dir), { prototypes: null, prototypesWhy: BROKEN_FILE });
});

test('a job’s record: only a web link and a revision count; a link to something else is no record', async () => {
  const dir = await fs.mkdtemp(path.join(root, 'job-'));
  const file = path.join(dir, 'prototype.json');
  assert.equal(await prototypeInfo(dir), null);
  await fs.writeFile(file, JSON.stringify({ url: 'https://prototypes.example.test/f/a', revision: 4, published_at: '2026-11-05T21:30:00+00:00', last_pull: 'x' }));
  assert.deepEqual(await prototypeInfo(dir), { url: 'https://prototypes.example.test/f/a', revision: 4, publishedAt: '2026-11-05T21:30:00+00:00' });
  await fs.writeFile(file, JSON.stringify({ url: 'javascript:alert(1)', revision: 4 }));
  assert.equal(await prototypeInfo(dir), null);
  await fs.writeFile(file, 'not json');
  assert.equal(await prototypeInfo(dir), null);
});

test('the script is the wireframe skill’s; a missing one says so; a slow one stops', async () => {
  assert.equal(publishScript('/s'), path.join('/s', 'wireframe', 'publish.py'));
  await assert.rejects(runPublish({ slug: 'a', action: 'publish', script: path.join(root, 'none.py'), featuresDir }), (e) => e.status === 502 && /no publish\.py/.test(e.message));
  await assert.rejects(runPublish({ slug: 'slow', action: 'publish', script: stub, featuresDir, timeout: 100 }), (e) => e.status === 502 && /didn’t answer/.test(e.message));
});

test('with no token file: meta says why, and both routes refuse without running anything', async () => {
  const m = await meta();
  assert.equal(m.prototypes, null);
  assert.equal(m.prototypesWhy, NOT_SET_UP);
  const r = await postJson('/api/jobs/add-export/prototype/publish');
  assert.equal(r.status, 409);
  assert.equal(r.body.error, NOT_SET_UP);
  await assert.rejects(fs.stat(path.join(featuresDir, 'add-export', 'prototype.json')));
});

test('publish, then the job carries the link; notes come back as lines, without anyone’s address', async () => {
  await tokenFile(JSON.stringify({ site: 'https://prototypes.example.test', token: MADE_UP_TOKEN }));
  const m = await meta();
  assert.deepEqual(m.prototypes, { site: 'https://prototypes.example.test' });
  assert.ok(!JSON.stringify(m).includes(MADE_UP_TOKEN), 'meta never holds the token');

  const published = await postJson('/api/jobs/add-export/prototype/publish');
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(published.body.revision, 4);
  assert.equal(published.body.url, 'https://prototypes.example.test/f/add-export');
  assert.deepEqual(published.body.warnings, []);

  // The job's record catches up on the next refresh, which runs a moment after a change.
  let job;
  for (let i = 0; i < 40 && !job?.prototype; i++) {
    job = await (await fetch(`${base}/api/job/add-export`)).json();
    if (!job.prototype) await new Promise((r) => setTimeout(r, 50));
  }
  assert.deepEqual(job.prototype, { url: 'https://prototypes.example.test/f/add-export', revision: 4, publishedAt: '2026-11-05T21:30:00+00:00' });

  const notes = await postJson('/api/jobs/add-export/prototype/notes');
  assert.equal(notes.status, 200, JSON.stringify(notes.body));
  assert.deepEqual(notes.body, {
    lines: ['Pick A for c-nav', 's-team (laptop): question: Who sees this?'], since: null, revision: 3,
    warnings: ['people picked differently on c-nav; every pick is listed, oldest first'],
  });
  assert.deepEqual((await postJson('/api/jobs/quiet/prototype/notes')).body, { lines: [], since: '2026-11-05T22:10:04.120Z', revision: 2, warnings: [] });
});

test('a failure is a 502 with the script’s one line; an unreadable answer says so; two at once are refused', async () => {
  await tokenFile(JSON.stringify({ token: MADE_UP_TOKEN }));
  const refused = await postJson('/api/jobs/refused/prototype/publish');
  assert.equal(refused.status, 502);
  assert.equal(refused.body.error, 'The site refused the token.');
  const garbled = await postJson('/api/jobs/garbled/prototype/publish');
  assert.equal(garbled.status, 502);
  assert.match(garbled.body.error, /can’t read/);
  const [one, two] = await Promise.all([postJson('/api/jobs/slow/prototype/publish'), postJson('/api/jobs/slow/prototype/publish')]);
  assert.deepEqual([one.status, two.status].sort(), [200, 409]);
  assert.equal((await post('/api/jobs/no-such-job/prototype/publish')).status, 404);
  assert.equal((await post('/api/jobs/add-export/prototype/delete')).status, 404);
});

test('the demo never publishes: with no script in a skills folder of its own, publishing is off and says so', async () => {
  const { DEMO_OFF } = await import('../lib/prototype.js');
  const port = await freePort();
  const empty = path.join(root, 'demo-skills');
  await fs.mkdir(empty);
  const demo = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), WIREFRAMES_PORT: String(await freePort()), HOME: home, USERPROFILE: home, STARBASE_DEMO: '1',
      STARBASE_FEATURES_DIR: featuresDir, STARBASE_PROJECTS_DIR: path.join(root, 'projects'), STARBASE_AGENTS_DIR: path.join(root, 'agents'),
      STARBASE_SKILLS_DIR: empty, STARBASE_STATE_DIR: path.join(root, 'demo-state'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve) => { let seen = ''; demo.stdout.on('data', (d) => { seen += d; if (seen.includes('Starbase running')) resolve(); }); });
    const m = await (await fetch(`http://127.0.0.1:${port}/api/meta`)).json();
    assert.equal(m.prototypes, null);
    assert.equal(m.prototypesWhy, DEMO_OFF);
  } finally {
    const gone = new Promise((r) => demo.once('exit', r));
    demo.kill('SIGTERM'); // exactly the dashboard this test started
    await gone;
  }
});
