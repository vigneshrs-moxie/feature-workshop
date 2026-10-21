// The screens stage's backend: lib/docs.js (wireframesInfo, readWireframes, the Screens group in
// the Docs list) and GET /api/job/:slug/wireframes, the one route that serves an HTML file from a
// job folder, with its own content security policy and frame headers. The server runs in demo mode
// (a pretend Foreman, nothing real runs) on temp folders, so no real job, ~/.claude or
// ~/.feature-workshop is touched and no Claude usage is spent.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DocError, DOC_GROUPS, WIREFRAMES_FILE, listJobDocs, readWireframes, wireframesInfo } from '../lib/docs.js';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Screens (test)</title></head><body><section data-key="s-one" data-screen="One"><h2>One</h2></section><script>window.parent.postMessage({ type: "wireframes", version: "2", current: "s-one", screens: [] }, "*");</script></body></html>\n';

let root, featuresDir, outside, child, base;
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

test('GET /api/job/:slug/wireframes serves the page with its own policy and frame headers', async () => {
  const res = await get('/api/job/with-screens/wireframes');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await res.text(), PAGE);
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp.startsWith("default-src 'none'"), csp);
  assert.ok(csp.includes("script-src 'unsafe-inline' https://cdn.jsdelivr.net"), 'the page’s own script and the template’s two pinned libraries');
  assert.ok(csp.includes("style-src 'unsafe-inline' https://fonts.googleapis.com"), 'its own styles and the template’s fonts');
  assert.ok(csp.includes('img-src data:') && csp.includes('font-src data: https://fonts.gstatic.com'));
  assert.ok(csp.includes("frame-ancestors 'self'"), 'the dashboard may frame it, nobody else');
  assert.ok(!/connect-src/.test(csp), 'no fetches: default-src none covers it');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('GET /api/job/:slug/wireframes: 404 without a page, for a symlink, and for any other HTML file', async () => {
  for (const slug of ['no-screens', 'linked-screens', 'other-html']) {
    const r = await getJson(`/api/job/${slug}/wireframes`);
    assert.equal(r.status, 404, slug);
    assert.match(r.body.error, /no screens yet/);
  }
  assert.equal((await getJson('/api/job/nobody/wireframes')).status, 404);
  // The document route still refuses HTML: the page is served by its own route only.
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
