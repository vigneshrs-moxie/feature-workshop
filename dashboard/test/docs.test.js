// The Docs tab's backend: lib/docs.js (which documents a job has, reading one safely) and the
// routes GET /api/job/:slug/docs, GET /api/job/:slug/doc?file= and POST /api/job/:slug/render.
// The server runs in demo mode (a pretend Foreman, nothing real runs) on temp folders, so no real
// job, ~/.claude or ~/.feature-workshop is touched and no Claude usage is spent.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOC_MAX_BYTES, DocError, describeDoc, jsonHtml, listJobDocs, readJobDoc } from '../lib/docs.js';
import { renderMarkdown } from '../lib/markdown.js';
import { describePermission } from '../lib/permissions.js';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');

let root, featuresDir, jobDir, outside, child, base, token;
const output = [];

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port: p } = s.address();
  await new Promise((r) => s.close(r));
  return p;
}

const put = (rel, text) => fs.mkdir(path.dirname(path.join(jobDir, rel)), { recursive: true }).then(() => fs.writeFile(path.join(jobDir, rel), text));

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-docs-')));
  featuresDir = path.join(root, 'feature-work');
  outside = path.join(root, 'outside');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state'), home: path.join(root, 'home'), repo: path.join(root, 'repo') };
  for (const d of [featuresDir, outside, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });
  await fs.writeFile(path.join(outside, 'secret.md'), '# Not for the dashboard\n');
  await fs.mkdir(path.join(dirs.repo, 'docs', 'plans'), { recursive: true });
  await fs.writeFile(path.join(dirs.repo, 'docs', 'plans', 'spec.md'), '# Spec\n\nFR-001: a thing.\n');

  jobDir = path.join(featuresDir, 'doc-job');
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, 'status.json'), JSON.stringify({
    schema_version: 1, slug: 'doc-job', title: 'Doc job', route: 'small', stage: 'plan', stage_state: 'waiting_for_you', waiting_for: 'approval',
    repo: { path: dirs.repo },
    spec: { path: path.join(dirs.repo, 'docs', 'plans', 'spec.md'), version: '0.3', status: 'DRAFT' },
    artifacts: [{ name: 'Implementation plan', path: 'implementation-plan.md', version: '2' }, { name: 'Quick plan', path: path.join(jobDir, 'quick-plan.md'), version: '1' }],
    updated_at: '2026-10-16T09:00:00Z',
  }, null, 2));
  await put('implementation-plan.md', '# Plan v2\n\n| Step | What |\n|---|---|\n| S1 | Data |\n\n```js\nconst x = 1;\n```\n\n- [x] done\n- [ ] to do\n');
  await put('quick-plan.md', '# Quick plan\n');
  await put('notes.md', 'Keep it small.\n');
  await put('review.md', '# Review\n\n- **R-1 (major):** a finding.\n');
  await put('review/permissions.md', '# Permissions lens\n');
  await put('fable/005-plan.md', '# Fable at plan\n');
  await put('briefs/001-spec.md', '**Spec ready**\n');
  await put('briefs/002-plan.md', '**Plan ready**\n');
  await put('briefs/002-plan-detail.md', 'More.\n');
  await put('handoff.md', '# Handoff\n');
  await put('.hidden.md', 'hidden\n');
  await put('.private/secret.md', '# Not for the dashboard\n');
  await put('picture.png', 'not a doc');
  await put('big.md', 'x'.repeat(DOC_MAX_BYTES + 10));
  await put('bad.json', '{ not json');
  await put('extra.JSON', '{"a":1}');
  // Symlinks: a file pointing outside, and a folder pointing outside.
  await fs.symlink(path.join(outside, 'secret.md'), path.join(jobDir, 'linked.md'));
  await fs.symlink(outside, path.join(jobDir, 'fable-link'));
  await fs.mkdir(path.join(jobDir, 'briefs'), { recursive: true });
  await fs.symlink(path.join(outside, 'secret.md'), path.join(jobDir, 'briefs', '003-linked.md'));
  // review/ itself a symlink to a folder outside in a second job.
  const job2 = path.join(featuresDir, 'link-dir-job');
  await fs.mkdir(job2, { recursive: true });
  await fs.writeFile(path.join(job2, 'status.json'), JSON.stringify({ schema_version: 1, slug: 'link-dir-job', title: 'Link dir', stage: 'review', stage_state: 'working', updated_at: '2026-10-16T09:00:00Z' }));
  await fs.symlink(outside, path.join(job2, 'review'));
  // Specs the dashboard must not show (status.json, which names the spec, is AI-written): one outside
  // the repository and the job folder, one that isn't Markdown, one a symlink from inside the repo to
  // a file outside it.
  await fs.writeFile(path.join(outside, 'notes.txt'), 'Not for the dashboard\n');
  await fs.mkdir(path.join(dirs.repo, 'docs', 'specs'), { recursive: true });
  await fs.symlink(path.join(outside, 'secret.md'), path.join(dirs.repo, 'docs', 'specs', 'linked-spec.md'));
  for (const [slug, specPath] of [
    ['spec-outside', path.join(outside, 'secret.md')],
    ['spec-not-md', path.join(outside, 'notes.txt')],
    ['spec-linked', path.join(dirs.repo, 'docs', 'specs', 'linked-spec.md')],
    ['spec-in-job', 'own-spec.md'],
  ]) {
    const dir = path.join(featuresDir, slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({
      schema_version: 1, slug, title: slug, stage: 'spec', stage_state: 'working', updated_at: '2026-10-16T09:00:00Z',
      repo: { path: dirs.repo }, spec: { path: slug === 'spec-in-job' ? path.join(dir, specPath) : specPath, version: '0.1' },
    }));
    if (slug === 'spec-in-job') await fs.writeFile(path.join(dir, specPath), '# Own spec\n');
  }

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

const getJson = async (p) => { const res = await fetch(base + p); return { status: res.status, body: await res.json().catch(() => null), raw: res }; };
const docUrl = (slug, file) => `/api/job/${slug}/doc?file=${encodeURIComponent(file)}`;
const post = async (p, body, { auth = true } = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Workshop-Token': token } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('docs lib: names and groups by path', () => {
  assert.deepEqual(describeDoc('implementation-plan.md').group, 'plan');
  assert.equal(describeDoc('briefs/002-plan.md').name, 'Brief #2 · plan');
  assert.equal(describeDoc('briefs/002-plan.md').group, 'briefs');
  assert.equal(describeDoc('review/permissions.md').name, 'Review: permissions');
  assert.equal(describeDoc('fable/005-plan.md').name, 'Fable second look #5 · plan');
  assert.equal(describeDoc('fable/005-plan.md').group, 'review');
  assert.equal(describeDoc('notes.md').group, 'notes');
  assert.equal(describeDoc('workflow-status.md').group, 'notes');
  assert.equal(describeDoc('refined-spec.md').group, 'plan');
  assert.equal(describeDoc('handoff.md').group, 'other');
  assert.equal(describeDoc('status.json').group, 'other');
});

test('docs lib: lists plain .md/.json files at the top and in briefs/review/fable, never hidden files or symlinks', async () => {
  const docs = await listJobDocs(jobDir, { spec: { path: path.join(root, 'repo', 'docs', 'plans', 'spec.md'), version: '0.3' }, recorded: [{ name: 'Implementation plan', path: 'implementation-plan.md', version: '2' }, { name: 'Quick plan', path: path.join(jobDir, 'quick-plan.md'), version: '1' }] });
  const files = docs.map((d) => d.file);
  for (const f of ['spec', 'implementation-plan.md', 'quick-plan.md', 'notes.md', 'review.md', 'review/permissions.md', 'fable/005-plan.md', 'briefs/001-spec.md', 'briefs/002-plan.md', 'handoff.md', 'status.json']) assert.ok(files.includes(f), f);
  for (const f of ['.hidden.md', 'picture.png', 'linked.md', 'briefs/003-linked.md']) assert.ok(!files.includes(f), `${f} is left out`);
  assert.ok(!files.some((f) => f.startsWith('fable-link')), 'a symlinked folder is not read');
  // Grouped in order, briefs newest first, versions from the records (relative or absolute path).
  const groups = docs.map((d) => d.group);
  assert.deepEqual([...new Set(groups)], ['plan', 'briefs', 'review', 'notes', 'other']);
  assert.equal(docs[0].file, 'spec');
  assert.equal(docs[0].version, '0.3');
  assert.equal(docs.find((d) => d.file === 'implementation-plan.md').version, '2');
  assert.equal(docs.find((d) => d.file === 'quick-plan.md').version, '1');
  assert.deepEqual(docs.filter((d) => d.group === 'briefs').map((d) => d.file), ['briefs/002-plan.md', 'briefs/002-plan-detail.md', 'briefs/001-spec.md']);
  assert.equal(docs.find((d) => d.file === 'status.json').type, 'json');
  assert.match(docs.find((d) => d.file === 'notes.md').updatedAt, /^\d{4}-\d\d-\d\dT/);
});

test('docs lib: reading refuses traversal, symlinks, other types and big files', async () => {
  const refused = async (rel, status) => {
    await assert.rejects(readJobDoc(jobDir, rel), (err) => err instanceof DocError && err.status === status, rel);
  };
  await refused('../link-dir-job/status.json', 404);
  await refused('../../outside/secret.md', 404);
  await refused(path.join(outside, 'secret.md'), 404);
  await refused('linked.md', 404);
  await refused('fable-link/secret.md', 404);
  await refused('briefs/003-linked.md', 404);
  await refused('picture.png', 400);
  await refused('status.json\0.md', 404);
  await refused('big.md', 413);
  await refused('missing.md', 404);
  // Hidden files and folders are refused, as the list leaves them out.
  await refused('.hidden.md', 404);
  await refused('.private/secret.md', 404);
  await refused('briefs/.x.md', 404);
  const ok = await readJobDoc(jobDir, 'notes.md');
  assert.equal(ok.text, 'Keep it small.\n');
  assert.equal(ok.size, 15);
});

test('docs lib: JSON shows indented and escaped; invalid JSON as written', () => {
  assert.equal(jsonHtml('{"a":"<b>"}'), '<pre class="json-doc"><code>{\n  &quot;a&quot;: &quot;&lt;b&gt;&quot;\n}</code></pre>');
  assert.equal(jsonHtml('{ not <json'), '<pre class="json-doc"><code>{ not &lt;json</code></pre>');
});

test('markdown: task lists get fixed checkboxes; nothing from the text becomes markup', () => {
  const html = renderMarkdown('- [x] done\n- [ ] <b>to do</b>\n- plain\n');
  assert.match(html, /<li class="task-item"><input class="task-box" type="checkbox" disabled checked aria-label="Done"> done<\/li>/);
  assert.match(html, /<input class="task-box" type="checkbox" disabled aria-label="Not done"> &lt;b&gt;to do&lt;\/b&gt;/);
  assert.match(html, /<li>plain<\/li>/);
  assert.match(renderMarkdown('[ ] not in a list'), /<p>\[ \] not in a list<\/p>/);
});

test('markdown: links: headings get anchors, //host is dropped, every link with a scheme opens in a new tab', () => {
  const html = renderMarkdown('# Plan\n\n## Steps\n\n## Steps\n\n[a](//evil.test/x) [b](/\\evil.test) [c](https://example.com) [d](mailto:a@b.test) [e](#steps) [f](findings.md)');
  assert.match(html, /<h1 id="h-plan">Plan<\/h1>/);
  assert.match(html, /<h2 id="h-steps">Steps<\/h2>\n<h2 id="h-steps-2">Steps<\/h2>/);
  assert.doesNotMatch(html, /href="\/[\\/%]/, 'protocol-relative links are not links');
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">c<\/a>/);
  assert.match(html, /<a href="mailto:a@b\.test" target="_blank" rel="noopener noreferrer">d<\/a>/);
  assert.match(html, /<a href="#steps">e<\/a>/);
  assert.match(html, /<a href="findings\.md">f<\/a>/);
  // Heading ids start again for every document.
  assert.match(renderMarkdown('## Steps'), /<h2 id="h-steps">/);
});

test('permissions: a Markdown file being written comes rendered (sanitised) only for the card; other writes never', () => {
  const md = describePermission('Write', { file_path: '/w/plan.md', content: '# Plan\n\n<script>x</script>' }, { renderPreview: true });
  assert.match(md.previewHtml, /<h1 id="h-plan">Plan<\/h1>/);
  assert.doesNotMatch(md.previewHtml, /<script/);
  assert.equal(md.preview, '# Plan\n\n<script>x</script>');
  assert.equal(describePermission('Write', { file_path: '/w/plan.md', content: '# Plan' }).previewHtml, undefined, 'the audit lines render nothing');
  assert.equal(describePermission('Write', { file_path: '/w/a.js', content: '# x' }, { renderPreview: true }).previewHtml, undefined);
});

test('permissions: instructions files and files outside the job folder start on their source; a cut preview says so', () => {
  const job = '/home/u/.claude/feature-work/merge';
  const start = (file) => describePermission('Write', { file_path: file, content: '# x' }, { featureDir: job, cwd: '/repo', renderPreview: true }).previewStart ?? 'page';
  assert.equal(start(`${job}/implementation-plan.md`), 'page');
  assert.equal(start(`${job}/briefs/003-build.md`), 'page');
  for (const file of [`${job}/CLAUDE.md`, `${job}/notes/AGENTS.md`, '/repo/skills/x/SKILL.md', `${job}/.claude/rules.md`, '/repo/.claude/agents/a.md', '/home/u/.claude/CLAUDE.md', '/repo/docs/plans/spec.md', 'docs/plan.md', '/home/u/.claude/feature-work/other/plan.md']) {
    assert.equal(start(file), 'source', file);
  }
  assert.equal(describePermission('Write', { file_path: `${job}/plan.md`, content: '# x' }).previewStart, 'source', 'no job folder known: source');
  const long = describePermission('Write', { file_path: `${job}/plan.md`, content: 'x'.repeat(3000) }, { featureDir: job });
  assert.equal(long.previewCut, 2500);
  assert.equal(long.preview, `${'x'.repeat(2500)}…`);
  assert.equal(describePermission('Write', { file_path: `${job}/plan.md`, content: 'short' }, { featureDir: job }).previewCut, undefined);
  assert.equal(describePermission('Bash', { command: 'y'.repeat(4001) }).previewCut, 4000);
});

test('route /docs: the job’s documents, grouped, with versions', async () => {
  const { status, body } = await getJson('/api/job/doc-job/docs');
  assert.equal(status, 200);
  const files = body.docs.map((d) => d.file);
  assert.ok(files.includes('spec') && files.includes('implementation-plan.md') && files.includes('fable/005-plan.md'));
  assert.ok(!files.includes('linked.md'));
  assert.equal(body.docs.find((d) => d.file === 'implementation-plan.md').version, '2');
  // A job whose review/ folder is a symlink lists nothing from it.
  const linked = await getJson('/api/job/link-dir-job/docs');
  assert.equal(linked.status, 200);
  assert.ok(!linked.body.docs.some((d) => d.file.startsWith('review/')));
  assert.equal((await getJson('/api/job/no-such-job/docs')).status, 404);
});

test('route /doc: html, text and time; refuses traversal, symlinks, types and size', async () => {
  const { status, body } = await getJson(docUrl('doc-job', 'implementation-plan.md'));
  assert.equal(status, 200);
  assert.equal(body.name, 'Implementation plan');
  assert.equal(body.type, 'md');
  assert.match(body.html, /<div class="table-wrap"><table>/);
  assert.match(body.html, /<pre><code class="language-js">/);
  assert.match(body.html, /class="task-box"/);
  assert.match(body.text, /^# Plan v2/);
  assert.match(body.updatedAt, /^\d{4}-/);
  const spec = await getJson(docUrl('doc-job', 'spec'));
  assert.equal(spec.status, 200);
  assert.match(spec.body.html, /id-link/);
  assert.equal(spec.body.text, '# Spec\n\nFR-001: a thing.\n');
  const json = await getJson(docUrl('doc-job', 'status.json'));
  assert.equal(json.body.type, 'json');
  assert.match(json.body.html, /^<pre class="json-doc"><code>\{\n {2}&quot;schema_version&quot;: 1,/);
  assert.equal((await getJson(docUrl('doc-job', 'fable/005-plan.md'))).body.name, 'Fable second look #5 · plan');
  for (const [file, want] of [
    ['../link-dir-job/status.json', 404], ['../../outside/secret.md', 404], [path.join(outside, 'secret.md'), 404],
    ['linked.md', 404], ['fable-link/secret.md', 404], ['briefs/003-linked.md', 404], ['picture.png', 400], ['big.md', 413], ['', 400],
    ['.private/secret.md', 404],
  ]) {
    const r = await getJson(docUrl('doc-job', file));
    assert.equal(r.status, want, file);
    assert.doesNotMatch(JSON.stringify(r.body), /Not for the dashboard/, file);
  }
  assert.equal((await getJson(docUrl('link-dir-job', 'review/secret.md'))).status, 404, 'through a symlinked folder');
  // The type is read whatever the case of the extension.
  const upper = await getJson(docUrl('doc-job', 'extra.JSON'));
  assert.equal(upper.status, 200);
  assert.equal(upper.body.type, 'json');
  assert.match(upper.body.html, /^<pre class="json-doc">/);
});

test('route /doc and /docs: the spec only when it is a .md inside the job’s repository or its folder', async () => {
  for (const slug of ['spec-outside', 'spec-not-md', 'spec-linked']) {
    const one = await getJson(docUrl(slug, 'spec'));
    assert.equal(one.status, 404, slug);
    assert.doesNotMatch(JSON.stringify(one.body), /Not for the dashboard/, slug);
    const list = await getJson(`/api/job/${slug}/docs`);
    assert.equal(list.status, 200, slug);
    assert.ok(!list.body.docs.some((d) => d.file === 'spec'), `${slug}: not listed`);
  }
  const own = await getJson(docUrl('spec-in-job', 'spec'));
  assert.equal(own.status, 200);
  assert.equal(own.body.text, '# Own spec\n');
  assert.ok((await getJson('/api/job/spec-in-job/docs')).body.docs.some((d) => d.file === 'spec'));
});

test('route /render: renders with the sanitising renderer, needs the token, capped', async () => {
  const ok = await post('/api/job/doc-job/render', { text: '## Hi\n\n<script>alert(1)</script> FR-001' });
  assert.equal(ok.status, 200);
  assert.match(ok.body.html, /<h2 id="h-hi">Hi<\/h2>/);
  assert.doesNotMatch(ok.body.html, /<script/);
  assert.match(ok.body.html, /href="#\/job\/doc-job\/id\/FR-001"/);
  assert.equal((await post('/api/job/doc-job/render', { text: 'x' }, { auth: false })).status, 403);
  assert.equal((await post('/api/job/doc-job/render', { text: 42 })).status, 400);
  assert.equal((await post('/api/job/doc-job/render', { text: 'x'.repeat(100001) })).status, 413);
  assert.equal((await post('/api/job/no-such-job/render', { text: 'x' })).status, 404);
  // Nothing is written: the job folder is as it was.
  assert.equal(await fs.readFile(path.join(jobDir, 'notes.md'), 'utf8'), 'Keep it small.\n');
});
