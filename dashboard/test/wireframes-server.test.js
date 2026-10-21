// The screens stage's backend: lib/docs.js (wireframesInfo, readWireframes, the Screens group in
// the Docs list) and the screens server, a second origin (WIREFRAMES_PORT, PORT + 1 by default) with
// one route, GET /job/:slug/wireframes, the only way an HTML file from a job folder is ever served,
// with its own content security policy; nothing else and no token there. The server runs in demo mode
// (a pretend Foreman, nothing real runs) on temp folders, so no real job, ~/.claude or
// ~/.feature-workshop is touched and no Claude usage is spent.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { DocError, DOC_GROUPS, WIREFRAMES_FILE, listJobDocs, readWireframes, wireframesInfo } from '../lib/docs.js';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Screens (test)</title></head><body><section data-key="s-one" data-screen="One"><h2>One</h2></section><script>window.parent.postMessage({ type: "wireframes", version: "2", current: "s-one", screens: [] }, "*");</script></body></html>\n';

let root, featuresDir, outside, child, base, screens;
const output = [];

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

const status = (slug, extra = {}) => JSON.stringify({ schema_version: 1, slug, title: `Job ${slug}`, route: 'small', stage: 'wireframe', stage_state: 'waiting_for_you', waiting_for: 'answers', updated_at: '2026-10-21T09:00:00Z', ...extra });

async function writeJob(slug, { files = {}, extra = {} } = {}) {
  const dir = path.join(featuresDir, slug);
  await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'status.json'), status(slug, extra));
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(dir, name), text);
  return dir;
}

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-wireframes-')));
  featuresDir = path.join(root, 'feature-work');
  outside = path.join(root, 'outside');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state'), home: path.join(root, 'home') };
  for (const d of [featuresDir, outside, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  await fs.writeFile(path.join(outside, 'wireframes.html'), '<p>Not for the dashboard</p>');

  // A job with screens: the version from status.json's artifacts entry.
  await writeJob('with-screens', {
    files: { 'wireframes.html': PAGE, 'wireframes.json': JSON.stringify({ schema_version: 1, version: 2, screens: [{ key: 's-one', name: 'One', states: [] }], choices: [], questions: [] }) },
    extra: { artifacts: [{ name: 'Wireframes', path: 'wireframes.html', version: '2', based_on: 'spec v0.2' }] },
  });
  // The version from wireframes.json alone (status.json names no artifact).
  await writeJob('json-version', { files: { 'wireframes.html': PAGE, 'wireframes.json': JSON.stringify({ version: 3 }) } });
  // No screens at all.
  await writeJob('no-screens', { extra: { stage: 'spec' } });
  // wireframes.html as a symlink to a file outside the folder: never served.
  const linked = await writeJob('linked-screens');
  await fs.symlink(path.join(outside, 'wireframes.html'), path.join(linked, 'wireframes.html'));
  // Another HTML file in the folder: never served either (only the one name is).
  await writeJob('other-html', { files: { 'index.html': PAGE } });

  const port = await freePort();
  const screensPort = await freePort();
  base = `http://127.0.0.1:${port}`;
  screens = `http://127.0.0.1:${screensPort}`;
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), WIREFRAMES_PORT: String(screensPort), HOME: dirs.home, WORKSHOP_DEMO: '1',
      WORKSHOP_FEATURES_DIR: featuresDir, WORKSHOP_PROJECTS_DIR: dirs.projects, WORKSHOP_AGENTS_DIR: dirs.agents,
      WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: dirs.state,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The dashboard didn't start:\n${output.join('')}`)), 15000);
    child.stdout.on('data', (d) => { output.push(String(d)); if (output.join('').includes('Feature Workshop running') && output.join('').includes('screens:')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', (d) => output.push(String(d)));
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`The dashboard exited (${code}):\n${output.join('')}`)); });
  });
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM'); // exactly the dashboard this test started
    await gone;
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const get = (p) => fetch(base + p);
const getJson = async (p) => { const res = await get(p); return { status: res.status, body: await res.json().catch(() => null) }; };

test('docs lib: wireframesInfo finds the page and its version, from status.json first, then wireframes.json', async () => {
  const a = await wireframesInfo(path.join(featuresDir, 'with-screens'), [{ name: 'Wireframes', path: 'wireframes.html', version: '2' }]);
  assert.equal(a.version, '2');
  assert.ok(a.updatedAt && a.size > 0);
  assert.equal((await wireframesInfo(path.join(featuresDir, 'json-version'))).version, '3');
  assert.equal(await wireframesInfo(path.join(featuresDir, 'no-screens')), null);
  assert.equal(await wireframesInfo(path.join(featuresDir, 'linked-screens')), null, 'a symlink is not a page');
  assert.equal(await wireframesInfo(path.join(featuresDir, 'other-html')), null, 'only wireframes.html counts');
});

test('docs lib: readWireframes serves the one file, never a symlink, nothing too big', async () => {
  const page = await readWireframes(path.join(featuresDir, 'with-screens'));
  assert.equal(page.html, PAGE);
  await assert.rejects(readWireframes(path.join(featuresDir, 'no-screens')), (e) => e instanceof DocError && e.status === 404);
  await assert.rejects(readWireframes(path.join(featuresDir, 'linked-screens')), (e) => e instanceof DocError && e.status === 404);
  await assert.rejects(readWireframes(path.join(featuresDir, 'with-screens'), { maxBytes: 10 }), (e) => e instanceof DocError && e.status === 413);
  assert.equal(WIREFRAMES_FILE, 'wireframes.html');
});

test('docs lib: the Docs list has a Screens group with "Wireframes" and its version', async () => {
  assert.ok(DOC_GROUPS.includes('screens'));
  const docs = await listJobDocs(path.join(featuresDir, 'with-screens'), { recorded: [{ name: 'Wireframes', path: 'wireframes.html', version: '2' }] });
  const page = docs.find((d) => d.file === 'wireframes.html');
  assert.deepEqual({ name: page.name, group: page.group, version: page.version, type: page.type }, { name: 'Wireframes', group: 'screens', version: '2', type: 'html' });
  const data = docs.find((d) => d.file === 'wireframes.json');
  assert.deepEqual({ group: data.group, version: data.version, type: data.type }, { group: 'screens', version: '2', type: 'json' });
  assert.ok(!(await listJobDocs(path.join(featuresDir, 'other-html'))).some((d) => d.type === 'html'), 'index.html is not listed');
  assert.ok(!(await listJobDocs(path.join(featuresDir, 'linked-screens'))).some((d) => d.type === 'html'), 'a symlinked page is not listed');
});

test('the screens server serves the page from its own origin, with its own policy, and meta names that origin', async () => {
  const meta = (await getJson('/api/meta')).body;
  assert.equal(meta.wireframesOrigin, screens, 'the web frames <wireframesOrigin>/job/<slug>/wireframes');
  const res = await fetch(`${screens}/job/with-screens/wireframes`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await res.text(), PAGE);
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp.startsWith("default-src 'none'"), csp);
  assert.ok(csp.includes("script-src 'unsafe-inline' https://cdn.jsdelivr.net"), 'the page’s own script and the template’s two pinned libraries');
  assert.ok(csp.includes("style-src 'unsafe-inline' https://fonts.googleapis.com"), 'its own styles and the template’s fonts');
  assert.ok(csp.includes('img-src data:') && csp.includes('font-src data: https://fonts.gstatic.com'));
  const { port } = new URL(base);
  assert.ok(csp.includes(`frame-ancestors http://127.0.0.1:${port} http://localhost:${port}`), `the dashboard may frame it, by either of its names, nobody else: ${csp}`);
  assert.ok(!/connect-src/.test(csp), 'no fetches: default-src none covers it');
  assert.equal(res.headers.get('x-frame-options'), null, 'frame-ancestors is the one frame header (SAMEORIGIN would refuse the dashboard, another origin)');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  for (const [name, value] of res.headers) assert.ok(!/token/i.test(name) && !/token/i.test(value), `no token in the headers: ${name}`);
  // The dashboard's own pages may frame that origin and nothing else.
  const page = await get('/');
  assert.match(page.headers.get('content-security-policy') ?? '', new RegExp(`frame-src ${screens.replace(/[.]/g, '\\.')}(;|$)`));
});

test('the screens server answers nothing else: 404 for every other path and method, no token, no other job files; 421 for another host', async () => {
  for (const p of ['/', '/api/meta', '/api/features', '/api/job/with-screens', '/job/with-screens', '/job/with-screens/wireframes.json', '/job/with-screens/doc?file=wireframes.json', '/next/', '/job/with-screens/wireframes/']) {
    const r = await fetch(screens + p);
    assert.equal(r.status, 404, p);
    assert.ok(!/token/i.test(await r.text()), `no token in the body: ${p}`);
  }
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await fetch(`${screens}/job/with-screens/wireframes`, { method, headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404, method);
  // fetch won't send another Host, so plain http does (a DNS-rebinding request names another host).
  const withHost = (host) => new Promise((resolve, reject) => http.get(`${screens}/job/with-screens/wireframes`, { headers: { host } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject));
  assert.equal(await withHost('evil.example'), 421);
  assert.equal(await withHost(`localhost:${new URL(screens).port}`), 200, 'localhost is this machine too');
});

test('the screens server: 404 without a page, for a symlink, and for any other HTML file; the dashboard’s old route is gone (410)', async () => {
  for (const slug of ['no-screens', 'linked-screens', 'other-html']) {
    const r = await fetch(`${screens}/job/${slug}/wireframes`);
    assert.equal(r.status, 404, slug);
    assert.match((await r.json()).error, /no screens yet/);
  }
  assert.equal((await fetch(`${screens}/job/nobody/wireframes`)).status, 404);
  // The page is never served from the dashboard's own origin any more: a model-written HTML file
  // there could read the dashboard's document, storage and token.
  const old = await getJson('/api/job/with-screens/wireframes');
  assert.equal(old.status, 410);
  assert.match(old.body.error, /served from its own address/);
  // The document route still refuses HTML: the page is served by the screens server only.
  const doc = await getJson('/api/job/with-screens/doc?file=wireframes.html');
  assert.equal(doc.status, 400);
  const other = await getJson('/api/job/other-html/doc?file=index.html');
  assert.equal(other.status, 400);
});

test('the Docs list and the job card say the job has screens, with the version', async () => {
  const { body } = await getJson('/api/job/with-screens/docs');
  const page = body.docs.find((d) => d.file === 'wireframes.html');
  assert.deepEqual({ name: page.name, group: page.group, version: page.version, type: page.type }, { name: 'Wireframes', group: 'screens', version: '2', type: 'html' });
  const features = (await getJson('/api/features')).body;
  const list = Array.isArray(features) ? features : features.features ?? features.jobs;
  const card = list.find((c) => c.slug === 'with-screens');
  assert.equal(card.wireframes.version, '2');
  assert.equal(list.find((c) => c.slug === 'no-screens').wireframes, null);
  assert.equal(list.find((c) => c.slug === 'json-version').wireframes.version, '3');
  const detail = (await getJson('/api/job/with-screens')).body;
  assert.equal(detail.wireframes.version, '2');
});
