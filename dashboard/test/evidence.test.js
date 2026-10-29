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
import { fileURLToPath } from 'node:url';
import {
  BROWSER_FIX, CONFIG_FILE, DB_DOWN, EvidenceError, buildEvidence, evidenceFile, evidenceLines, evidenceWanted, guardedSpec,
  listSpecs, playwrightConfig, prepareRun, readEvidence, readyToRecord, recordEvidence,
} from '../lib/evidence.js';
import { defaultsForLevel, describeOptions, evidenceOn, normalize, optionsAtLevel } from '../lib/options.js';

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
