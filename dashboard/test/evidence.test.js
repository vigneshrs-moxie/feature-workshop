// Evidence at the test stage (packet L, lib/evidence.js), with no browser and no network: the level
// and option rules, the Playwright config a recording writes, evidence.json built from a fixture of
// Playwright's JSON report and output folder (dashboard/test/fixtures/evidence/, run through its
// fake playwright script), once per commit, a database copy that's down, a missing browser, and the
// file route's rule that nothing outside the job's evidence/ folder is served.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BROWSER_FIX, CONFIG_FILE, DB_DOWN, EvidenceError, buildEvidence, evidenceFile, evidenceLines, evidenceWanted, guardedSpec,
  listSpecs, playwrightConfig, prepareRun, readEvidence, readyToRecord, recordEvidence,
  parseProgressLine, progressReporter, recordingWords, guardModule, markWatched, readLiveFrame, LIVE_MAX_BYTES,
} from '../lib/evidence.js';
import { defaultsForLevel, describeOptions, evidenceOn, normalize, optionsAtLevel } from '../lib/options.js';
import { describeDoc, listJobDocs, readJobDoc } from '../lib/docs.js';
import { loadFeatures, SessionIndex } from '../lib/features.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'evidence');
const FAKE = path.join(FIXTURE, 'fake-playwright.mjs');
const roots = [];
after(async () => { for (const r of roots) await fs.rm(r, { recursive: true, force: true }); });

async function tmp(name) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `gc-evidence-${name}-`)));
  roots.push(root);
  return root;
}

const REPORT = `# Test report

- Branch: feature/hours-column
- Commit under test: abc1234def5

## Results
- AC-1 PASS

## Evidence

- AC-1: Managers see the Hours column. Spec: evidence/specs/AC-1.spec.mjs
- AC-2: The export button is hidden from technicians. Spec: evidence/specs/AC-2.spec.mjs
- AC-3: The export API refuses other offices. No spec: API only; the route test covers it.
`;
const SPEC = (n, title) => `import { test, expect } from '@playwright/test';\ntest('AC-${n}: ${title}', async ({ page }) => {\n  await page.goto('/');\n  await expect(page).toHaveTitle(/./);\n});\n`;

/** A job folder at the test stage: options, the report and two specs. */
async function makeJob({ level = 2, evidence = 'auto', report = REPORT, specs = [1, 2] } = {}) {
  const dir = path.join(await tmp('job'), 'hours-column');
  await fs.mkdir(path.join(dir, 'evidence', 'specs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'test-report.md'), report);
  for (const n of specs) await fs.writeFile(path.join(dir, 'evidence', 'specs', `AC-${n}.spec.mjs`), SPEC(n, `criterion ${n}`));
  return { dir, slug: 'hours-column', options: { ...defaultsForLevel(level), evidence } };
}

/** The fake playwright, run as the runner runs the real one. */
const fakeRun = (env = {}) => async ({ configFile, cwd }) => new Promise((resolve) => {
  execFile(process.execPath, [FAKE, 'test', '--config', configFile], { cwd, env: { ...process.env, ...env } }, (err, stdout, stderr) => resolve({ code: err ? err.code ?? 1 : 0, output: `${stdout}${stderr}` }));
});

/** A pretend Try it: counts starts and stops. */
function fakeServer({ running = false } = {}) {
  const calls = { start: 0, stop: 0 };
  return { calls, start: async () => { calls.start++; return { baseURL: 'http://localhost:3007', startedHere: !running }; }, stop: async () => { calls.stop++; } };
}

const record = (job, extra = {}) => recordEvidence({ job, server: extra.server ?? fakeServer(), run: extra.run ?? fakeRun(), dbCheck: extra.dbCheck ?? null, playwrightUrl: 'file:///nowhere/playwright/index.mjs', cwd: job.dir, now: () => new Date('2026-10-28T12:00:00Z') });

test('evidence: L0 never, L1 only with "always", L2 and L3 by default, "off" turns it off', () => {
  for (const choice of ['auto', 'always', 'off', 'nonsense']) assert.equal(evidenceOn(0, choice), false, `L0 with ${choice}`);
  assert.equal(evidenceOn(1, 'auto'), false);
  assert.equal(evidenceOn(1, 'always'), true);
  assert.equal(evidenceOn(1, 'off'), false);
  for (const level of [2, 3]) {
    assert.equal(evidenceOn(level, 'auto'), true);
    assert.equal(evidenceOn(level, undefined), true, 'no option: Auto');
    assert.equal(evidenceOn(level, 'off'), false);
  }
  assert.equal(evidenceOn(null, 'always'), false, 'no level yet: none');
  assert.match(evidenceWanted({ level: 0, evidence: 'always' }).why, /L0 tweak never/);
  assert.match(evidenceWanted({ level: 1 }).why, /only when its options say “always”/);
  assert.equal(evidenceWanted({ level: 3, evidence: 'auto' }).on, true);
});

test('evidence: the option is kept through a save and a level change, and only a choice other than Auto is spelled out', () => {
  assert.equal(normalize({ level: 2 }).evidence, 'auto');
  assert.equal(normalize({ level: 1, evidence: 'always' }).evidence, 'always');
  assert.equal(normalize({ level: 2, evidence: 'sometimes' }).evidence, 'auto', 'an unknown choice is Auto');
  assert.equal(normalize({ level: 2 }, { previous: { level: 2, evidence: 'off' } }).evidence, 'off', 'a page that doesn’t send it keeps the job’s');
  assert.equal(optionsAtLevel({ ...defaultsForLevel(1), evidence: 'always' }, 2).evidence, 'always');
  assert.ok(!describeOptions(normalize({ level: 2 })).some((l) => l.startsWith('Evidence')), 'Auto says nothing');
  assert.ok(describeOptions(normalize({ level: 1, evidence: 'always' })).some((l) => l.startsWith('Evidence: always.')));
  assert.ok(describeOptions(normalize({ level: 3, evidence: 'off' })).includes('Evidence: off. No screenshots or video at the test stage.'));
});

test('evidence: the report’s Evidence section names each criterion, with its spec or why it has none', () => {
  const lines = evidenceLines(`${REPORT}\n## Afterwards\n- AC-9: not evidence. Spec: x\n`);
  assert.deepEqual([...lines.keys()], ['AC-1', 'AC-2', 'AC-3'], 'only lines inside the section');
  assert.deepEqual(lines.get('AC-1'), { n: 1, title: 'Managers see the Hours column', spec: true, reason: null });
  assert.deepEqual(lines.get('AC-3'), { n: 3, title: 'The export API refuses other offices', spec: false, reason: 'API only; the route test covers it.' });
});

test('evidence: the config has video and screenshots on, one worker, 60 seconds a spec, Chromium only, the base address; the spec copies import the guard', async () => {
  const job = await makeJob();
  const specs = await listSpecs(path.join(job.dir, 'evidence'));
  assert.deepEqual(specs.map((s) => s.id), ['AC-1', 'AC-2']);
  const run = await prepareRun({ evidenceDir: path.join(job.dir, 'evidence'), commit: 'abc1234def5', specs, baseURL: 'http://localhost:3007', playwrightUrl: 'file:///gc/node_modules/@playwright/test/index.mjs' });
  assert.equal(run.configFile, path.join(job.dir, 'evidence', CONFIG_FILE), 'the config is written into evidence/');
  const config = (await import(`${new URL(`file://${run.configFile}`).href}?t=${Date.now()}`)).default;
  assert.equal(config.workers, 1);
  assert.equal(config.timeout, 60_000);
  assert.equal(config.retries, 0);
  assert.deepEqual(config.use.baseURL, 'http://localhost:3007');
  assert.equal(config.use.video, 'on');
  assert.equal(config.use.screenshot, 'on');
  assert.deepEqual(config.projects, [{ name: 'chromium', use: { browserName: 'chromium' } }]);
  assert.equal(config.testDir, path.join(job.dir, 'evidence', 'abc1234def5', 'run', 'specs'));
  assert.ok(config.reporter.some((r) => r[0] === 'json' && r[1].outputFile === run.reportFile));
  const copy = await fs.readFile(path.join(config.testDir, 'AC-1.spec.mjs'), 'utf8');
  assert.match(copy, /from "\.\.\/guard\.mjs"/);
  assert.doesNotMatch(copy, /@playwright\/test/);
  const guard = await fs.readFile(path.join(run.runDir, 'guard.mjs'), 'utf8');
  assert.match(guard, /file:\/\/\/gc\/node_modules\/@playwright\/test\/index\.mjs/);
  assert.match(guard, /isNavigationRequest\(\)/, 'pages are kept on this computer');
  assert.equal(guardedSpec("const { test } = await import('@playwright/test');"), 'const { test } = await import("../guard.mjs");');
  assert.match(playwrightConfig({ testDir: 'a', outputDir: 'b', reportFile: 'c', baseURL: 'http://127.0.0.1:3001' }), /browserName: 'chromium'/);
});

test('evidence: evidence.json from Playwright’s report and output, pictures and video per criterion, nothing from outside the output folder', async () => {
  const job = await makeJob();
  const r = await record(job);
  assert.equal(r.ok, true);
  const ev = await readEvidence(job.dir);
  assert.deepEqual(ev, r.evidence);
  assert.equal(ev.version, 1);
  assert.equal(ev.commit, 'abc1234def5');
  assert.equal(ev.level, 2);
  assert.equal(ev.at, '2026-10-28T12:00:00.000Z');
  assert.deepEqual(ev.criteria.map((c) => [c.id, c.status]), [['AC-1', 'passed'], ['AC-2', 'failed'], ['AC-3', 'skipped']]);
  const [one, two, three] = ev.criteria;
  assert.equal(one.title, 'Managers see the Hours column');
  assert.deepEqual(one.screenshots, [
    { file: 'abc1234def5/AC-1/01.png', description: 'The home page, signed in as the dev user' },
    { file: 'abc1234def5/AC-1/02.png', description: 'The Team page, with the Hours column next to Name' },
    { file: 'abc1234def5/AC-1/03.png', description: 'How the page looked when the check ended' },
  ], 'the spec’s pictures with their words; the outside one is left out');
  assert.equal(one.video, 'abc1234def5/AC-1/video.webm');
  assert.equal(one.spec, 'evidence/specs/AC-1.spec.mjs');
  assert.equal(two.reason, "expect(locator).toBeHidden() failed · Locator: getByRole('button', { name: 'Export' }) · Expected: hidden");
  assert.equal(two.screenshots.length, 1);
  assert.equal(two.video, 'abc1234def5/AC-2/video.webm');
  assert.deepEqual(three, { id: 'AC-3', title: 'The export API refuses other offices', status: 'skipped', reason: 'Nothing to see: API only; the route test covers it.', spec: null, screenshots: [], video: null });
  for (const c of ev.criteria) for (const f of [...c.screenshots.map((s) => s.file), ...(c.video ? [c.video] : [])]) await fs.access(path.join(job.dir, 'evidence', f));
  await assert.rejects(fs.access(path.join(job.dir, 'evidence', 'abc1234def5', 'run')), 'the run’s copies and raw output are cleaned up');
  const calls = (await fs.readFile(path.join(job.dir, 'evidence', 'calls.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(calls.map((c) => c.args), [['test', '--config', path.join(job.dir, 'evidence', CONFIG_FILE)]]);
});

test('evidence: buildEvidence copies only files inside the output folder and marks a spec that didn’t run as failed', () => {
  const out = buildEvidence({
    report: { suites: [], errors: [{ message: 'SyntaxError: Unexpected token (AC-1.spec.mjs:3)' }] },
    specs: [{ id: 'AC-1', n: 1, file: '/job/evidence/specs/AC-1.spec.mjs' }], lines: new Map(), commit: 'abc1234', level: 2, at: 'now', outputDir: '/out',
  });
  assert.deepEqual(out.copies, []);
  assert.equal(out.evidence.criteria[0].status, 'failed');
  assert.equal(out.evidence.criteria[0].reason, 'The spec didn’t run: SyntaxError: Unexpected token (AC-1.spec.mjs:3)');
});

test('evidence: once per commit; a second ask for the same commit says “Already recorded for abc1234”', async () => {
  const job = await makeJob();
  await record(job);
  const server = fakeServer();
  await assert.rejects(record(job, { server }), (err) => err instanceof EvidenceError && err.status === 409 && err.message === 'Already recorded for abc1234');
  assert.equal(server.calls.start, 0, 'no server started for it');
  assert.equal(await readyToRecord(job, { quietMs: 0 }), null, 'nothing more to record');
  // A new commit under test: recorded again.
  await fs.writeFile(path.join(job.dir, 'test-report.md'), REPORT.replace('abc1234def5', 'fed9876cba1'));
  assert.deepEqual(await readyToRecord(job, { quietMs: 0 }), { commit: 'fed9876cba1', specs: 2 });
  assert.equal((await record(job)).evidence.commit, 'fed9876cba1');
});

test('evidence: a database copy that’s down stops it before the server starts, in plain words', async () => {
  const job = await makeJob();
  const server = fakeServer();
  await assert.rejects(record(job, { server, dbCheck: async () => ({ ok: false }) }), (err) => err.status === 503 && err.message === DB_DOWN);
  assert.equal(DB_DOWN, 'The local database copy isn’t running. Start it from Try it, then press Record again.');
  assert.equal(server.calls.start, 0);
  assert.equal(await readEvidence(job.dir), null, 'nothing written');
  // Up: it records.
  assert.equal((await record(job, { dbCheck: async () => ({ ok: true }) })).ok, true);
});

test('evidence: a missing browser gives the fix line instead of an error, and the server it started is stopped', async () => {
  const job = await makeJob();
  const server = fakeServer();
  await assert.rejects(record(job, { server, run: fakeRun({ FAKE_PLAYWRIGHT: 'no-browser' }) }), (err) => err.fix === BROWSER_FIX && err.message.includes(BROWSER_FIX) && !/Executable/.test(err.message));
  assert.deepEqual(server.calls, { start: 1, stop: 1 });
  // A server that was already running is left running.
  const running = fakeServer({ running: true });
  await assert.rejects(record(job, { server: running, run: fakeRun({ FAKE_PLAYWRIGHT: 'no-browser' }) }));
  assert.deepEqual(running.calls, { start: 1, stop: 0 });
});

test('evidence: L0 and an L1 job without “always” record nothing; no commit or no specs say so', async () => {
  await assert.rejects(record(await makeJob({ level: 0, evidence: 'always' })), (err) => err.code === 'not-wanted' && /L0/.test(err.message));
  await assert.rejects(record(await makeJob({ level: 1 })), (err) => err.code === 'not-wanted');
  assert.equal((await record(await makeJob({ level: 1, evidence: 'always' }))).ok, true);
  await assert.rejects(record(await makeJob({ report: '# Test report\n' })), (err) => err.code === 'no-commit');
  await assert.rejects(record(await makeJob({ report: '- Commit under test: abc1234def5\n', specs: [] })), (err) => err.code === 'no-specs');
  // Only criteria with nothing to see: rows saying why, and no server or browser.
  const server = fakeServer();
  const r = await recordEvidence({ job: await makeJob({ specs: [] }), server, run: async () => assert.fail('no run'), playwrightUrl: 'x', cwd: '.' });
  assert.deepEqual(r.evidence.criteria.map((c) => c.status), ['skipped', 'skipped', 'skipped']);
  assert.equal(server.calls.start, 0);
});

test('evidence: the file route serves a picture or video inside the job’s evidence/ folder and nothing else', async () => {
  const job = await makeJob();
  await record(job);
  const ok = await evidenceFile(job.dir, 'abc1234def5/AC-1/01.png');
  assert.equal(ok.type, 'image/png');
  assert.equal((await evidenceFile(job.dir, 'abc1234def5/AC-1/video.webm')).type, 'video/webm');
  // Outside the folder, a symlink out of it, hidden, another kind of file, missing: all 404.
  await fs.writeFile(path.join(job.dir, 'secret.png'), 'x');
  await fs.symlink(path.join(job.dir, 'secret.png'), path.join(job.dir, 'evidence', 'link.png'));
  await fs.symlink(job.dir, path.join(job.dir, 'evidence', 'up'));
  await fs.writeFile(path.join(job.dir, 'evidence', '.hidden.png'), 'x');
  for (const p of ['../secret.png', '../test-report.md', 'abc1234def5/../../secret.png', '/etc/hosts', path.join(job.dir, 'secret.png'), 'link.png', 'up/secret.png', '.hidden.png', 'evidence.json', 'specs/AC-1.spec.mjs', 'abc1234def5/AC-9/01.png', '', 'a\0b.png', 'C:\\x.png']) {
    await assert.rejects(evidenceFile(job.dir, p), (err) => err instanceof EvidenceError && err.status === 404, p || '(empty)');
  }
});

test('review files: review/facts.md and facts-r<n>.md are “Review facts (round n)”, listed after the lenses’ reviews; evidence.json is “Evidence”', async () => {
  assert.deepEqual(describeDoc('review/facts.md'), { name: 'Review facts (round 1)', group: 'review', order: 301 });
  assert.equal(describeDoc('review/facts-r2.md').name, 'Review facts (round 2)');
  assert.equal(describeDoc('review/permissions.md').name, 'Review: permissions', 'a lens’s review keeps its name');
  assert.equal(describeDoc('review/facts-check.md').name, 'Review: facts check', 'only the facts files');
  assert.equal(describeDoc('evidence/evidence.json').name, 'Evidence');

  const job = await makeJob();
  await record(job);
  await fs.mkdir(path.join(job.dir, 'review'), { recursive: true });
  for (const f of ['facts.md', 'facts-r2.md', 'permissions.md', 'ui.md']) await fs.writeFile(path.join(job.dir, 'review', f), `# ${f}\n`);
  const docs = await listJobDocs(job.dir);
  const review = docs.filter((d) => d.group === 'review').map((d) => d.name);
  assert.deepEqual(review, ['Test report', 'Evidence', 'Review: permissions', 'Review: ui', 'Review facts (round 1)', 'Review facts (round 2)']);
  assert.equal(docs.find((d) => d.name === 'Evidence').type, 'json');
  assert.match((await readJobDoc(job.dir, 'evidence/evidence.json')).text, /"commit": "abc1234def5"/);
  assert.ok(!docs.some((d) => d.file.startsWith('evidence/') && d.file !== 'evidence/evidence.json'), 'nothing else from evidence/');

  // The job's card lists the same, from lib/features.js.
  const features = await loadFeatures({ featuresDir: path.dirname(job.dir), sessionIndex: new SessionIndex(await tmp('projects')) });
  const names = features.find((f) => f.slug === 'hours-column').artifacts.map((a) => a.name);
  assert.ok(names.includes('Evidence'));
  assert.deepEqual(names.filter((n) => n.startsWith('Review')).slice(-2), ['Review facts (round 1)', 'Review facts (round 2)'], 'the facts come after the lenses’ reviews');
  assert.ok(!names.includes('Review: facts'));

  // A symlinked evidence/ folder isn't followed.
  const other = await makeJob();
  await fs.rm(path.join(other.dir, 'evidence'), { recursive: true });
  await fs.symlink(path.join(job.dir, 'evidence'), path.join(other.dir, 'evidence'));
  assert.ok(!(await listJobDocs(other.dir)).some((d) => d.name === 'Evidence'));
});

test('evidence: the config names the progress reporter', async () => {
  const job = await makeJob();
  const specs = await listSpecs(path.join(job.dir, 'evidence'));
  const run = await prepareRun({ evidenceDir: path.join(job.dir, 'evidence'), commit: 'abc1234def5', specs, baseURL: 'http://localhost:3007', playwrightUrl: 'file:///gc/node_modules/@playwright/test/index.mjs' });
  const progressFile = path.join(run.runDir, 'progress.mjs');
  const config = (await import(`${pathToFileURL(run.configFile).href}?t=${Date.now()}`)).default;
  assert.ok(config.reporter.some((r) => r[0] === progressFile), 'the reporter list names run/progress.mjs');
  assert.ok(config.reporter.some((r) => r[0] === 'json'), 'the JSON report is still written');
  assert.equal(await fs.readFile(progressFile, 'utf8'), progressReporter());
  // The reporter prints one line when a test starts and one when it ends.
  const Reporter = (await import(`${pathToFileURL(progressFile).href}?t=${Date.now()}`)).default;
  const printed = [];
  const reporter = new Reporter({ write: (text) => printed.push(text) });
  const t = { title: 'AC-4: Managers see the Hours column', location: { file: path.join(config.testDir, 'AC-4.spec.mjs') } };
  reporter.onTestBegin(t, {});
  reporter.onTestEnd(t, { status: 'timedOut', attachments: [{ name: 'video', contentType: 'video/webm', path: '/out/AC-4-chromium/video.webm' }] });
  reporter.onTestBegin({ title: 'not an acceptance line', location: { file: '/x/helper.spec.mjs' } }, {});
  assert.deepEqual(printed.join('').split('\n').map(parseProgressLine).filter(Boolean), [
    { at: 'begin', id: 'AC-4', title: 'Managers see the Hours column', status: null, video: null },
    { at: 'end', id: 'AC-4', title: 'Managers see the Hours column', status: 'failed', video: '/out/AC-4-chromium/video.webm' },
  ]);
});

test('evidence: parseProgressLine reads a line and ignores everything else', () => {
  assert.deepEqual(parseProgressLine('@@starbase {"at":"begin","id":"AC-1","title":"Managers see the Hours column","status":null,"video":null}'),
    { at: 'begin', id: 'AC-1', title: 'Managers see the Hours column', status: null, video: null });
  assert.deepEqual(parseProgressLine('  @@starbase {"at":"end","id":"AC-12","title":"x","status":"skipped","video":"/out/v.webm"}\r'),
    { at: 'end', id: 'AC-12', title: 'x', status: 'skipped', video: '/out/v.webm' });
  for (const line of [
    'Running 2 tests using 1 worker', '', '@@starbase', '@@starbase not json', '@@starbase [1,2]', 'said @@starbase {"at":"begin","id":"AC-1"}',
    '@@starbase {"at":"middle","id":"AC-1"}', '@@starbase {"at":"begin","id":"AC-0"}', '@@starbase {"at":"begin","id":"login"}', '@@starbase {"at":"begin"}',
    null, undefined, 42,
  ]) assert.equal(parseProgressLine(line), null, String(line));
  // A status or video of the wrong kind is left out, not taken on trust.
  assert.deepEqual(parseProgressLine('@@starbase {"at":"end","id":"AC-2","title":7,"status":"exploded","video":{"x":1}}'),
    { at: 'end', id: 'AC-2', title: null, status: null, video: null });
});

test('evidence: the run keeps its working folder', async () => {
  const job = await makeJob();
  const calls = [];
  const run = async (opts) => { calls.push(opts); return fakeRun()(opts); };
  await recordEvidence({ job, server: fakeServer(), run, playwrightUrl: 'file:///nowhere/playwright/index.mjs', cwd: job.dir });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, job.dir);
  assert.equal(typeof calls[0].onLine, 'function', 'and is handed the reader of its lines');
  const fake = (await fs.readFile(path.join(job.dir, 'evidence', 'calls.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(fake[0].cwd, job.dir);
});

test('evidence: a recording says which line it is on, as each line begins and ends', async () => {
  const job = await makeJob();
  const seen = [];
  // The fake playwright's output, each line handed on as it comes.
  const run = async (opts) => {
    const ran = await fakeRun()(opts);
    for (const line of ran.output.split('\n')) opts.onLine(line);
    return ran;
  };
  let t = 0;
  const now = () => new Date(Date.UTC(2026, 9, 28, 12, 0, t++));
  await recordEvidence({ job, server: fakeServer(), run, playwrightUrl: 'x', cwd: job.dir, now, onProgress: (p) => seen.push(p) });
  const states = seen.map((p) => [p.line, p.of, p.lines.map((l) => l.state).join(' ')]);
  assert.deepEqual(states, [
    [0, 3, 'waiting waiting waiting'],
    [1, 3, 'running waiting waiting'],
    [1, 3, 'passed waiting waiting'],
    [2, 3, 'passed running waiting'],
    [2, 3, 'passed failed waiting'],
  ]);
  const first = seen[0];
  assert.equal(first.commit, 'abc1234def5');
  assert.equal(typeof first.startedAt, 'string');
  assert.deepEqual(first.lines.map((l) => [l.id, l.title, l.video, l.at]), [
    ['AC-1', 'Managers see the Hours column', null, null],
    ['AC-2', 'The export button is hidden from technicians', null, null],
    ['AC-3', 'The export API refuses other offices', null, null],
  ]);
  const last = seen.at(-1);
  assert.ok(last.lines[0].at && last.lines[1].at && last.lines[1].at > last.lines[0].at, 'each line’s time is when its state last changed');
  // Each ended line's video is copied at once to its place at the end (Task 5b); a line with no spec has none.
  assert.deepEqual(last.lines.map((l) => l.video), ['abc1234def5/AC-1/video.webm', 'abc1234def5/AC-2/video.webm', null]);
  assert.equal(seen[1].lines[0].video, null, 'none while the line runs');
  assert.notEqual(seen[1], seen[2], 'each change is a new object');
});

test('evidence: a line’s video is copied only from inside the run’s output', async () => {
  const job = await makeJob();
  const seen = [];
  const outside = path.join(job.dir, 'outside.webm');
  await fs.writeFile(outside, 'not from this run');
  const run = async (opts) => {
    const ran = await fakeRun()(opts);
    const output = path.join(job.dir, 'evidence', 'abc1234def5', 'run', 'output');
    await fs.symlink(outside, path.join(output, 'AC-2-chromium', 'link.webm'));
    const end = (id, video) => `@@starbase ${JSON.stringify({ at: 'end', id, title: id, status: 'passed', video })}`;
    opts.onLine(end('AC-1', outside)); // outside the output
    opts.onLine(end('AC-2', path.join(output, 'AC-2-chromium', 'link.webm'))); // a symlink out of it
    opts.onLine(end('AC-1', path.join(output, 'AC-1-chromium', '01.png'))); // not a video
    return ran;
  };
  await recordEvidence({ job, server: fakeServer(), run, playwrightUrl: 'x', cwd: job.dir, onProgress: (p) => seen.push(p) });
  assert.equal(seen.length, 4);
  assert.ok(seen.every((p) => p.lines.every((l) => l.video === null)), 'none named');
});

test('evidence: a line that comes after the run ended changes nothing', async () => {
  const job = await makeJob();
  const seen = [];
  let late = null;
  const line = (at, id, status = null) => `@@starbase ${JSON.stringify({ at, id, title: id, status, video: null })}`;
  // Playwright's `error` ended the run; its `close` brings one more line afterwards.
  const run = async (opts) => {
    const ran = await fakeRun()(opts);
    opts.onLine(line('begin', 'AC-1'));
    late = new Promise((resolve) => { setTimeout(() => { opts.onLine(line('end', 'AC-1', 'passed')); opts.onLine(line('begin', 'AC-2')); resolve(); }, 20); });
    return ran;
  };
  await recordEvidence({ job, server: fakeServer(), run, playwrightUrl: 'x', cwd: job.dir, onProgress: (p) => seen.push(p) });
  const atEnd = seen.length;
  await late;
  await new Promise((r) => { setTimeout(r, 50); });
  assert.equal(atEnd, 2, 'the start and the line that came in time');
  assert.equal(seen.length, atEnd, 'nothing after the run ended');
});

test('evidence: the words say the line once it has begun, and never one that hasn’t', () => {
  assert.equal(recordingWords(null), null);
  assert.equal(recordingWords(undefined), null);
  assert.equal(recordingWords({ line: 0, of: 3 }), 'Recording evidence: starting, 3 lines');
  assert.equal(recordingWords({ line: 0, of: 1 }), 'Recording evidence: starting, 1 line');
  assert.equal(recordingWords({ line: 1, of: 3 }), 'Recording evidence: line 1 of 3');
  assert.equal(recordingWords({ line: 4, of: 19 }), 'Recording evidence: line 4 of 19');
});

// ---------- Watch: the hidden browser's picture (Task 6) ----------

const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });
const exists = (f) => fs.access(f).then(() => true, () => false);
async function until(ok, what, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end;) { if (await ok()) return; await pause(50); }
  assert.fail(what);
}

test('evidence: the guard saves frames only while someone watches', async () => {
  const dir = await tmp('guard');
  const liveFile = path.join(dir, 'live.jpg');
  const watchFile = path.join(dir, 'watching');
  // A stand-in for Playwright: test.extend hands its fixtures back, so the page fixture runs here with no browser.
  const pw = pathToFileURL(path.join(dir, 'playwright.mjs')).href;
  await fs.writeFile(path.join(dir, 'playwright.mjs'), 'export const test = { extend: (fixtures) => ({ fixtures }) };\nexport const expect = () => {};\n');
  const text = guardModule(pw, { liveFile, watchFile });
  assert.ok(text.includes(JSON.stringify(liveFile)) && text.includes(JSON.stringify(watchFile)), 'it names both files');
  const from = [...text.matchAll(/\bfrom\s+(["'])([^"']*)\1/g)].map((m) => m[2]);
  assert.deepEqual([...new Set(from)].sort(), ['node:fs', pw].sort(), 'it imports only Playwright and node:fs');
  assert.doesNotMatch(text, /\bimport\s*\(|\brequire\s*\(/);
  await fs.writeFile(path.join(dir, 'guard.mjs'), text);
  const { test: guarded } = await import(pathToFileURL(path.join(dir, 'guard.mjs')).href);
  const shots = [];
  let failures = 1; // the first picture can't be saved (the page is busy): it is skipped
  const page = {
    route: async () => {}, mainFrame: () => null,
    screenshot: async (opts) => { shots.push(opts); if (failures-- > 0) throw new Error('Target page, context or browser has been closed'); return Buffer.from(`frame ${shots.length}`); },
  };
  await guarded.fixtures.page({ page }, async () => {
    await pause(1200);
    assert.equal(shots.length, 0, 'nobody watching: no picture is taken');
    assert.equal(await exists(liveFile), false);
    await fs.writeFile(watchFile, ''); // someone presses Watch on the laptop
    await until(() => exists(liveFile), 'no frame while someone watched');
    assert.ok(shots.length >= 2, 'the failed one was skipped and the next one saved');
    assert.ok(shots.every((o) => o.type === 'jpeg' && o.quality === 60), JSON.stringify(shots));
    assert.match(await fs.readFile(liveFile, 'utf8'), /^frame \d+$/);
    assert.deepEqual((await fs.readdir(dir)).filter((f) => f.startsWith('live')), ['live.jpg'], 'written beside it, then renamed');
    // Nobody has asked for 5 seconds: no more pictures.
    const old = new Date(Date.now() - 6000);
    await fs.utimes(watchFile, old, old);
    await pause(700);
    const quiet = shots.length;
    await pause(1100);
    assert.equal(shots.length, quiet, 'a stale watch takes no pictures');
    await fs.writeFile(watchFile, ''); // watched again as the test ends
  });
  const atEnd = shots.length;
  await pause(1100);
  assert.equal(shots.length, atEnd, 'the timer stops when the test ends');
});

test('evidence: a recording’s guard watches run/watching and saves to run/live.jpg', async () => {
  const job = await makeJob();
  const specs = await listSpecs(path.join(job.dir, 'evidence'));
  const run = await prepareRun({ evidenceDir: path.join(job.dir, 'evidence'), commit: 'abc1234def5', specs, baseURL: 'http://localhost:3007', playwrightUrl: 'file:///gc/pw.mjs' });
  const guard = await fs.readFile(path.join(run.runDir, 'guard.mjs'), 'utf8');
  assert.ok(guard.includes(JSON.stringify(path.join(run.runDir, 'live.jpg'))));
  assert.ok(guard.includes(JSON.stringify(path.join(run.runDir, 'watching'))));
  assert.equal(await exists(path.join(run.runDir, 'watching')), false, 'nobody watches yet');
});

// ---------- Watch, hardened (Task 6 fix round 1): never through a link, a size cap ----------

test('evidence: the watch mark is made or touched as a plain file, never through a link', async () => {
  const dir = await tmp('mark');
  const mark = path.join(dir, 'watching');
  assert.equal(await markWatched(mark), true, 'made when it isn’t there');
  assert.ok((await fs.lstat(mark)).isFile());
  // A whole second: Node 22 sets and reads a time through float seconds, so a time with
  // milliseconds can come back 0.001 ms off and the exact check below would fail by chance.
  const old = new Date(Math.floor((Date.now() - 60_000) / 1000) * 1000);
  await fs.utimes(mark, old, old);
  assert.equal(await markWatched(mark), true);
  assert.ok(Date.now() - (await fs.stat(mark)).mtimeMs < 5000, 'touched again: fresh');
  // A link a spec left there: refused, and what it points at keeps its times and its words.
  const target = path.join(dir, 'precious.txt');
  await fs.writeFile(target, 'keep me');
  await fs.utimes(target, old, old);
  const linked = path.join(dir, 'linked');
  await fs.symlink(target, linked);
  assert.equal(await markWatched(linked), false);
  assert.equal((await fs.stat(target)).mtimeMs, old.getTime());
  assert.equal(await fs.readFile(target, 'utf8'), 'keep me');
  assert.ok((await fs.lstat(linked)).isSymbolicLink());
  // A dangling link, a folder, or no run folder at all: refused, nothing made.
  const dangling = path.join(dir, 'dangling');
  await fs.symlink(path.join(dir, 'nowhere.txt'), dangling);
  assert.equal(await markWatched(dangling), false);
  assert.equal(await exists(path.join(dir, 'nowhere.txt')), false);
  await fs.mkdir(path.join(dir, 'a-folder'));
  assert.equal(await markWatched(path.join(dir, 'a-folder')), false);
  assert.equal(await markWatched(path.join(dir, 'gone', 'watching')), false);
  assert.equal(await exists(path.join(dir, 'gone')), false);
});

test('evidence: a live frame is read only from a plain, fresh file under the cap, never through a link', async () => {
  const dir = await tmp('frame');
  const frame = path.join(dir, 'live.jpg');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  await fs.writeFile(frame, jpeg);
  assert.deepEqual(await readLiveFrame(frame), jpeg);
  assert.ok(LIVE_MAX_BYTES >= 1024 * 1024 && LIVE_MAX_BYTES <= 5 * 1024 * 1024, 'a sane cap');
  // Too old.
  const old = new Date(Date.now() - 6000);
  await fs.utimes(frame, old, old);
  assert.equal(await readLiveFrame(frame), null);
  // A link to another file, however fresh: never read.
  const target = path.join(dir, 'secret.jpg');
  await fs.writeFile(target, jpeg);
  const linked = path.join(dir, 'linked.jpg');
  await fs.symlink(target, linked);
  assert.equal(await readLiveFrame(linked), null);
  // Empty, too big, a folder, missing: none.
  await fs.writeFile(path.join(dir, 'empty.jpg'), '');
  assert.equal(await readLiveFrame(path.join(dir, 'empty.jpg')), null);
  await fs.writeFile(path.join(dir, 'big.jpg'), Buffer.alloc(LIVE_MAX_BYTES + 1, 1));
  assert.equal(await readLiveFrame(path.join(dir, 'big.jpg')), null);
  await fs.mkdir(path.join(dir, 'folder.jpg'));
  assert.equal(await readLiveFrame(path.join(dir, 'folder.jpg')), null);
  assert.equal(await readLiveFrame(path.join(dir, 'missing.jpg')), null);
});

// ---------- Parked fixes: the live picture whole or not at all; the guard's busy and stopped ----------

test('evidence: a live frame is sent whole, or not at all when the file ends short', async () => {
  const dir = await tmp('frame-short');
  const frame = path.join(dir, 'live.jpg');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  await fs.writeFile(frame, jpeg);
  // A read may give fewer bytes than asked: stand in for that on every open file for a moment.
  const probe = await fs.open(frame);
  const proto = Object.getPrototypeOf(probe);
  await probe.close();
  const realRead = proto.read;
  try {
    proto.read = function (buf, off, len, pos) { return realRead.call(this, buf, off, Math.min(len, 4), pos); };
    assert.deepEqual(await readLiveFrame(frame), jpeg, 'four bytes a read: still the whole picture');
    proto.read = function (buf, off, len, pos) {
      return pos >= 4 ? Promise.resolve({ bytesRead: 0, buffer: buf }) : realRead.call(this, buf, off, Math.min(len, 4 - pos), pos);
    };
    assert.equal(await readLiveFrame(frame), null, 'the file ended after four bytes: no picture');
  } finally {
    proto.read = realRead;
  }
});

async function guardedPage(name, screenshot) {
  const dir = await tmp(name);
  const liveFile = path.join(dir, 'live.jpg');
  const watchFile = path.join(dir, 'watching');
  const pw = pathToFileURL(path.join(dir, 'playwright.mjs')).href;
  await fs.writeFile(path.join(dir, 'playwright.mjs'), 'export const test = { extend: (fixtures) => ({ fixtures }) };\nexport const expect = () => {};\n');
  await fs.writeFile(path.join(dir, 'guard.mjs'), guardModule(pw, { liveFile, watchFile }));
  await fs.writeFile(watchFile, ''); // watched from the start
  const { test: guarded } = await import(pathToFileURL(path.join(dir, 'guard.mjs')).href);
  const page = { route: async () => {}, mainFrame: () => null, screenshot };
  return { dir, liveFile, run: (body) => guarded.fixtures.page({ page }, body) };
}

test('evidence: the guard never takes a picture while the last one is still being taken (busy)', async () => {
  let inFlight = 0;
  let most = 0;
  let shots = 0;
  const g = await guardedPage('guard-busy', async () => {
    shots += 1; inFlight += 1; most = Math.max(most, inFlight);
    await pause(1300); // slower than the 500 ms between ticks
    inFlight -= 1;
    return Buffer.from(`frame ${shots}`);
  });
  await g.run(async () => { await until(async () => shots >= 2, 'a second picture after the slow first'); });
  assert.equal(most, 1, 'never two at once');
});

test('evidence: a picture still being taken when the test ends is never written (stopped)', async () => {
  // The picture comes back when the test says so: after the end (final fixes C5c, no race against a timer).
  let started = false;
  let release;
  const late = new Promise((resolve) => { release = resolve; });
  const g = await guardedPage('guard-stopped', () => { started = true; return late; });
  await g.run(async () => { await until(async () => started, 'a picture started'); });
  // Every write the guard makes goes through fs.promises.writeFile: note them while the late picture lands.
  const wrote = [];
  const realWrite = fs.writeFile;
  try {
    fs.writeFile = (file, ...rest) => { wrote.push(String(file)); return realWrite.call(fs, file, ...rest); };
    release(Buffer.from('late'));
    // Past every step that follows the picture's return (a write, had the guard made one, has begun by now).
    await new Promise((resolve) => { setImmediate(resolve); });
  } finally {
    fs.writeFile = realWrite;
  }
  assert.deepEqual(wrote.filter((f) => f.startsWith(g.liveFile)), [], 'nothing written after the end');
  assert.equal(await exists(g.liveFile), false, 'no live.jpg');
  assert.deepEqual((await fs.readdir(g.dir)).filter((f) => f.startsWith('live')), [], 'and no live.jpg.part');
});
