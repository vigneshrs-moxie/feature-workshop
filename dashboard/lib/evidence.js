// Evidence at the test stage (packet L, plan G17, §11 L): for each acceptance line of an L2 or L3
// job (L1 only when its options say "always", L0 never), screenshots and a short video of the Try
// it server doing what the line says, recorded from the tester's Playwright specs. Everything lives
// in the job's private folder, under evidence/:
//
//   evidence/specs/AC-<n>.spec.mjs     the tester's specs (skills/feature/evidence.md)
//   evidence/playwright.config.mjs     written here for each recording (playwrightConfig)
//   evidence/<commit>/AC-<n>/          the pictures (01.png, 02.png, …) and the video (video.webm)
//   evidence/<commit>/report.json      Playwright's own JSON report of that recording
//   evidence/evidence.json             { version: 1, commit, at, level, criteria: [{ id, title,
//                                      status: 'passed' | 'failed' | 'skipped', reason, spec,
//                                      screenshots: [{ file, description }], video }] }
//
// The pieces, each testable without a browser:
//   evidenceWanted(options)       the level and option rules (lib/options.js evidenceOn)
//   listSpecs, evidenceLines      the specs on disk; the test report's Evidence section
//   playwrightConfig, guardModule, prepareRun   the config and the spec copies a recording runs
//   buildEvidence, collectEvidence             evidence.json from Playwright's report and output
//   recordEvidence(deps)          one recording, start to finish, with the server, the database
//                                 check and Playwright handed in (runner/evidence.js gives the real ones)
//   readEvidence, evidenceFile    what the site serves: evidence.json, and one picture or video
//                                 only when its path is a plain file inside the job's evidence/
//
// Specs are run from copies whose `@playwright/test` import is the guard module: the dashboard's
// own pinned Playwright (package.json), with every page stopped from going anywhere but this
// computer. Nothing here signs in, reads a settings file or talks to the network.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { evidenceOn, evidenceWhy, isLevel } from './options.js';
import { testedCommit } from './proof.js';

export const EVIDENCE_DIR = 'evidence';
export const EVIDENCE_FILE = 'evidence.json';
export const SPECS_DIR = 'specs';
export const CONFIG_FILE = 'playwright.config.mjs';
export const EVIDENCE_VERSION = 1;
/** How long one spec may take (ms). */
export const SPEC_LIMIT_MS = 60_000;
/** The fix line when Playwright's Chromium isn't installed (the same words as `ground-control doctor`). */
export const BROWSER_FIX = 'Run npx playwright install chromium';
export const DB_DOWN = 'The local database copy isn’t running. Start it from Try it, then press Record again.';
const SPEC_FILE = /^AC-([1-9]\d{0,3})\.spec\.mjs$/;
const COMMIT = /^[0-9a-f]{7,40}$/i;
/** The files the file route serves, by extension: pictures and videos only. */
export const SERVED_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webm': 'video/webm', '.mp4': 'video/mp4' };
const IMAGE = /^image\/(png|jpeg)$/;
const VIDEO = /^video\/(webm|mp4)$/;

export class EvidenceError extends Error {
  /** status: the HTTP status the routes answer with; fix: a line to run, when there is one. */
  constructor(status, message, { fix = null, code = null } = {}) {
    super(message);
    this.status = status;
    this.fix = fix;
    this.code = code;
  }
}

export const shortCommit = (c) => String(c ?? '').slice(0, 7);
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const firstLine = (text, max = 300) => {
  const line = String(text ?? '').replace(ANSI, '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

// ---------- When ----------

/** Whether this job records evidence, and why (or why not), in plain words: { on, why }. */
export function evidenceWanted(options) {
  const level = isLevel(options?.level) ? options.level : null;
  return { on: evidenceOn(level, options?.evidence), why: evidenceWhy(level, options?.evidence) };
}

// ---------- The specs and the report's Evidence section ----------

/** The tester's specs: [{ id: 'AC-3', n: 3, file }] (file absolute), in criterion order. Plain files only. */
export async function listSpecs(evidenceDir) {
  const dir = path.join(evidenceDir, SPECS_DIR);
  const st = await fsp.lstat(dir).catch(() => null);
  if (!st?.isDirectory()) return [];
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const m = e.isFile() ? SPEC_FILE.exec(e.name) : null;
    if (m) out.push({ id: `AC-${Number(m[1])}`, n: Number(m[1]), file: path.join(dir, e.name) });
  }
  return out.sort((a, b) => a.n - b.n);
}

/**
 * The test report's Evidence section (evidence.md): one line per criterion,
 *   - AC-1: <title>. Spec: evidence/specs/AC-1.spec.mjs
 *   - AC-2: <title>. No spec: <why, in one line>
 * Returns Map<id, { n, title, spec: boolean, reason }>. Lines outside the section are ignored.
 */
export function evidenceLines(reportText) {
  const out = new Map();
  let inside = false;
  for (const raw of String(reportText ?? '').split('\n')) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) { inside = /^#{1,6}\s+evidence\b/i.test(line); continue; }
    if (!inside) continue;
    const m = /^[-*]\s+\**AC-([1-9]\d{0,3})\**\s*[:.–—-]\s*(.*)$/i.exec(line);
    if (!m) continue;
    const rest = m[2];
    const cut = /\s*(?:[.;:]\s*|\s[–—-]\s*|\s+)(no spec|spec)\s*:\s*/i.exec(rest);
    const title = (cut ? rest.slice(0, cut.index) : rest).replace(/[.\s]+$/, '').trim();
    const spec = cut ? cut[1].toLowerCase() === 'spec' : null;
    const reason = cut && !spec ? rest.slice(cut.index + cut[0].length).replace(/\s+/g, ' ').trim() : null;
    out.set(`AC-${Number(m[1])}`, { n: Number(m[1]), title: title.slice(0, 300) || null, spec, reason: reason ? reason.slice(0, 300) : null });
  }
  return out;
}

// ---------- The run: its config, its spec copies and the guard ----------

/** The Playwright config for one recording: video and screenshots on, one worker, Chromium only. */
export function playwrightConfig({ testDir, outputDir, reportFile, baseURL, specs = 1 }) {
  const j = (v) => JSON.stringify(v);
  return `// Written by the dashboard for one evidence recording (lib/evidence.js). It is written again
// for every recording, so a change here doesn't last.
export default {
  testDir: ${j(testDir)},
  testMatch: /AC-\\d+\\.spec\\.mjs$/,
  outputDir: ${j(outputDir)},
  timeout: ${SPEC_LIMIT_MS},
  globalTimeout: ${SPEC_LIMIT_MS * Math.max(1, specs) + 60_000},
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  reporter: [['json', { outputFile: ${j(reportFile)} }], ['line']],
  use: { baseURL: ${j(baseURL)}, video: 'on', screenshot: 'on', trace: 'off', headless: true, viewport: { width: 1280, height: 800 } },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
};
`;
}

/**
 * The module the spec copies import instead of `@playwright/test`: the dashboard's own Playwright
 * (playwrightUrl), whose `page` stops any navigation of the page to anything but this computer.
 */
export function guardModule(playwrightUrl) {
  const u = JSON.stringify(playwrightUrl);
  return `// Written by the dashboard (lib/evidence.js): the specs' @playwright/test, with every page kept on this computer.
import { test as base, expect } from ${u};
export * from ${u};
const HERE = new Set(['127.0.0.1', 'localhost', '[::1]']);
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/*', (route) => {
      const req = route.request();
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        let host = '';
        try { host = new URL(req.url()).hostname; } catch { /* not an address */ }
        if (!HERE.has(host)) return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    await use(page);
  },
});
export { expect };
export default test;
`;
}

/** A spec's text with its `@playwright/test` import pointed at the guard module. */
export function guardedSpec(text, guardPath = '../guard.mjs') {
  const to = JSON.stringify(guardPath);
  return String(text)
    .replace(/(\bfrom\s*)(['"])@playwright\/test\2/g, (_, from) => `${from}${to}`)
    .replace(/(\bimport\s*\(\s*)(['"])@playwright\/test\2(\s*\))/g, (_, a, _q, b) => `${a}${to}${b}`);
}

/**
 * Write one recording's files: the config in evidence/, the spec copies and the guard in
 * evidence/<commit>/run/. Returns { configFile, runDir, outputDir, reportFile }.
 */
export async function prepareRun({ evidenceDir, commit, specs, baseURL, playwrightUrl }) {
  const commitDir = path.join(evidenceDir, commit);
  const runDir = path.join(commitDir, 'run');
  const specDir = path.join(runDir, 'specs');
  const outputDir = path.join(runDir, 'output');
  const reportFile = path.join(commitDir, 'report.json');
  await fsp.rm(runDir, { recursive: true, force: true });
  await fsp.mkdir(specDir, { recursive: true });
  await fsp.rm(reportFile, { force: true });
  await fsp.writeFile(path.join(runDir, 'guard.mjs'), guardModule(playwrightUrl));
  for (const s of specs) await fsp.writeFile(path.join(specDir, path.basename(s.file)), guardedSpec(await fsp.readFile(s.file, 'utf8')));
  const configFile = path.join(evidenceDir, CONFIG_FILE);
  await fsp.writeFile(configFile, playwrightConfig({ testDir: specDir, outputDir, reportFile, baseURL, specs: specs.length }));
  return { configFile, runDir, outputDir, reportFile };
}

/** Whether Playwright's output (or report) says its browser isn't installed. */
export function browsersMissing(text) {
  return /Executable doesn['’]t exist|browserType\.launch:.*(?:not found|doesn['’]t exist)|Looks like Playwright .*was just installed|npx playwright install/i.test(String(text ?? ''));
}

// ---------- From Playwright's report to evidence.json ----------

/** Every test in a Playwright JSON report: [{ file, title, result }] (the last result of each). */
function reportTests(report) {
  const out = [];
  const walk = (suite, file) => {
    const f = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) out.push({ file: spec.file ?? f, title: spec.title ?? '', result: (t.results ?? []).at(-1) ?? null });
    }
    for (const s of suite.suites ?? []) walk(s, f);
  };
  for (const s of report?.suites ?? []) walk(s, s.file);
  return out;
}

const STATUS = { passed: 'passed', skipped: 'skipped', failed: 'failed', timedOut: 'failed', interrupted: 'failed' };

/**
 * A failed check's error in one line: the lines before Playwright's call log, without its colours
 * ("expect(locator).toBeVisible() failed · Locator: getByRole('heading', { name: 'Team' }) · …").
 */
function failure(message) {
  const head = String(message ?? '').replace(ANSI, '').split(/\n\s*Call log:/)[0];
  const text = head.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ').replace(/^Error:\s*/, '');
  if (!text) return 'It failed.';
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}

/** The criterion id of a report entry: its spec's file name (AC-<n>.spec.mjs), else its title. */
function idOf(entry) {
  const m = SPEC_FILE.exec(path.basename(String(entry.file ?? ''))) ?? /^AC-([1-9]\d{0,3})\b/.exec(entry.title);
  return m ? `AC-${Number(m[1])}` : null;
}

const inside = (p, dir) => {
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * evidence.json for one recording, and the files to copy into evidence/<commit>/AC-<n>/:
 * { evidence, copies: [{ from, to }] } (to relative to evidence/). report: Playwright's JSON report
 * (null when it wrote none); specs: listSpecs; lines: evidenceLines; outputDir: where Playwright
 * wrote (only files inside it are copied). Pure: it reads no files.
 */
export function buildEvidence({ report, specs, lines, commit, level, at, outputDir }) {
  const byId = new Map();
  for (const t of reportTests(report)) { const id = idOf(t); if (id && !byId.has(id)) byId.set(id, t); }
  const loadError = firstLine(report?.errors?.[0]?.message ?? '');
  const ids = new Map();
  for (const s of specs) ids.set(s.id, s.n);
  for (const [id, l] of lines) ids.set(id, l.n);
  const copies = [];
  const criteria = [...ids].sort((a, b) => a[1] - b[1]).map(([id]) => {
    const spec = specs.find((s) => s.id === id) ?? null;
    const line = lines.get(id) ?? null;
    const t = byId.get(id) ?? null;
    const title = line?.title || (t ? t.title.replace(/^AC-\d+\s*[:.–—-]?\s*/, '').trim() : '') || id;
    const row = { id, title, status: 'skipped', reason: null, spec: spec ? `${EVIDENCE_DIR}/${SPECS_DIR}/${path.basename(spec.file)}` : null, screenshots: [], video: null };
    if (!spec) return { ...row, reason: `Nothing to see${line?.reason ? `: ${line.reason}` : '.'}` };
    if (!t?.result) return { ...row, status: 'failed', reason: `The spec didn’t run${loadError ? `: ${loadError}` : '.'}` };
    const r = t.result;
    row.status = STATUS[r.status] ?? 'failed';
    if (row.status === 'failed') row.reason = r.status === 'timedOut' ? `It took longer than ${SPEC_LIMIT_MS / 1000} seconds.` : failure(r.error?.message ?? r.errors?.[0]?.message ?? '');
    if (row.status === 'skipped') row.reason = 'The spec skipped itself.';
    let shot = 0;
    for (const a of r.attachments ?? []) {
      if (!a?.path || !inside(a.path, outputDir)) continue;
      const type = String(a.contentType ?? '');
      if (IMAGE.test(type)) {
        const ext = type === 'image/jpeg' ? '.jpg' : '.png';
        const to = `${commit}/${id}/${String(++shot).padStart(2, '0')}${ext}`;
        copies.push({ from: a.path, to });
        // Playwright's own picture at the end is named "screenshot"; the spec's are named for what they show.
        row.screenshots.push({ file: to, description: a.name && a.name !== 'screenshot' ? String(a.name).slice(0, 300) : 'How the page looked when the check ended' });
      } else if (VIDEO.test(type) && !row.video) {
        const to = `${commit}/${id}/video${type === 'video/mp4' ? '.mp4' : '.webm'}`;
        copies.push({ from: a.path, to });
        row.video = to;
      }
    }
    return row;
  });
  return { evidence: { version: EVIDENCE_VERSION, commit, at, level: isLevel(level) ? level : null, criteria }, copies };
}

/** Write an evidence.json safely (a temporary file, then a rename). */
async function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fsp.rename(tmp, file);
}

/**
 * Build evidence.json from the run's report and output, copy the pictures and videos into
 * evidence/<commit>/AC-<n>/, and write it. Returns the evidence.
 */
export async function collectEvidence({ evidenceDir, commit, specs, lines, level, at, report, outputDir }) {
  const { evidence, copies } = buildEvidence({ report, specs, lines, commit, level, at, outputDir });
  const dirs = new Set(evidence.criteria.map((c) => path.join(evidenceDir, commit, c.id)));
  for (const d of dirs) { await fsp.rm(d, { recursive: true, force: true }); await fsp.mkdir(d, { recursive: true }); }
  const missing = new Set();
  for (const c of copies) {
    const st = await fsp.lstat(c.from).catch(() => null);
    if (!st?.isFile()) { missing.add(c.to); continue; }
    await fsp.copyFile(c.from, path.join(evidenceDir, c.to));
  }
  // A picture or video Playwright named but didn't leave behind isn't listed.
  for (const c of evidence.criteria) {
    c.screenshots = c.screenshots.filter((s) => !missing.has(s.file));
    if (c.video && missing.has(c.video)) c.video = null;
  }
  await writeJson(path.join(evidenceDir, EVIDENCE_FILE), evidence);
  return evidence;
}

// ---------- Reading it back (the site's routes) ----------

/** A job's evidence.json, or null when there is none (or it isn't a plain, readable file). */
export async function readEvidence(jobDir) {
  const file = path.join(jobDir, EVIDENCE_DIR, EVIDENCE_FILE);
  const st = await fsp.lstat(file).catch(() => null);
  if (!st?.isFile() || st.size > 2 * 1024 * 1024) return null;
  try {
    const raw = JSON.parse(await fsp.readFile(file, 'utf8'));
    return raw && typeof raw === 'object' && raw.version === EVIDENCE_VERSION && Array.isArray(raw.criteria) ? raw : null;
  } catch { return null; }
}

/**
 * One picture or video of a job's evidence: { abs, type, size } when `rel` (relative to the job's
 * evidence/ folder) is a plain picture or video file whose real path lies inside that folder.
 * Anything else (outside it, through a symlink, hidden, another kind of file, missing) is a 404.
 */
export async function evidenceFile(jobDir, rel) {
  const nope = () => new EvidenceError(404, 'That file isn’t there.');
  const p = String(rel ?? '');
  if (!p || p.length > 500 || p.includes('\0') || path.isAbsolute(p) || /^[a-z]:/i.test(p)) throw nope();
  if (p.split(/[\\/]/).some((part) => part === '..' || part.startsWith('.'))) throw nope();
  const type = SERVED_TYPES[path.extname(p).toLowerCase()];
  if (!type) throw nope();
  const root = path.join(path.resolve(jobDir), EVIDENCE_DIR);
  const abs = path.resolve(root, p);
  if (!inside(abs, root)) throw nope();
  const st = await fsp.lstat(abs).catch(() => null);
  if (!st?.isFile()) throw nope();
  const [realRoot, realFile] = await Promise.all([fsp.realpath(root), fsp.realpath(abs)]).catch(() => [null, null]);
  if (!realRoot || !realFile || !inside(realFile, realRoot)) throw nope();
  return { abs: realFile, type, size: st.size };
}

// ---------- One recording ----------

/**
 * Record the evidence of one job for the commit its test report names. Everything that touches
 * the computer is handed in:
 *   server.start()   starts Try it for the job (or finds it running): { baseURL, startedHere }
 *   server.stop()    stops it again (called only when start said startedHere)
 *   dbCheck()        { ok } : whether the local database copy is up (null: there is no check)
 *   run({ configFile, cwd, specs })   runs Playwright: { code, output }
 *   playwrightUrl    the URL of the dashboard's @playwright/test (the guard imports it)
 *   onStart()        called once the checks pass and the recording really starts (not for a refusal)
 * Returns { ok: true, evidence } or throws EvidenceError (status and plain words; fix when there is a line to run).
 */
export async function recordEvidence({ job, server, dbCheck = null, run, playwrightUrl, cwd, now = () => new Date(), onStart = () => {} }) {
  const wanted = evidenceWanted(job.options);
  if (!wanted.on) throw new EvidenceError(409, wanted.why, { code: 'not-wanted' });
  const reportText = await fsp.readFile(path.join(job.dir, 'test-report.md'), 'utf8').catch(() => null);
  const commit = testedCommit(reportText);
  if (!reportText || !commit || !COMMIT.test(commit)) throw new EvidenceError(409, 'The test report doesn’t name the commit it tested yet, so there is nothing to record against.', { code: 'no-commit' });
  const evidenceDir = path.join(job.dir, EVIDENCE_DIR);
  const had = await readEvidence(job.dir);
  if (had?.commit && (had.commit.startsWith(commit) || commit.startsWith(had.commit))) throw new EvidenceError(409, `Already recorded for ${shortCommit(commit)}`, { code: 'already' });
  const specs = await listSpecs(evidenceDir);
  const lines = evidenceLines(reportText);
  const level = job.options?.level ?? null;
  await fsp.mkdir(evidenceDir, { recursive: true });
  // Nothing to see anywhere: no server, no browser, just the rows saying why.
  if (!specs.length) {
    if (!lines.size) throw new EvidenceError(409, 'The tester wrote no specs and the test report has no Evidence section, so there is nothing to record.', { code: 'no-specs' });
    onStart();
    return { ok: true, evidence: await collectEvidence({ evidenceDir, commit, specs, lines, level, at: now().toISOString(), report: null, outputDir: evidenceDir }) };
  }
  if (dbCheck) {
    const db = await dbCheck();
    if (db && !db.ok) throw new EvidenceError(503, DB_DOWN, { code: 'database-down' });
  }
  onStart();
  const started = await server.start();
  let prepared = null;
  try {
    prepared = await prepareRun({ evidenceDir, commit, specs, baseURL: started.baseURL, playwrightUrl });
    const ran = await run({ configFile: prepared.configFile, cwd, specs });
    const reportJson = await fsp.readFile(prepared.reportFile, 'utf8').then((t) => JSON.parse(t), () => null);
    const errors = JSON.stringify(reportJson?.errors ?? []) + JSON.stringify(reportTests(reportJson).map((t) => t.result?.error?.message ?? ''));
    if (browsersMissing(ran.output) || browsersMissing(errors)) {
      throw new EvidenceError(503, `Playwright’s Chromium isn’t installed on this computer. ${BROWSER_FIX}, then press Record again.`, { fix: BROWSER_FIX, code: 'no-browser' });
    }
    if (!reportJson) {
      const last = firstLine(String(ran.output ?? '').replace(ANSI, '').split('\n').filter((l) => l.trim()).at(-1) ?? '');
      throw new EvidenceError(500, `Playwright stopped before it wrote its report, so nothing was recorded${last ? `: ${last}` : '.'}`, { code: 'no-report' });
    }
    const evidence = await collectEvidence({ evidenceDir, commit, specs, lines, level, at: now().toISOString(), report: reportJson, outputDir: prepared.outputDir });
    return { ok: true, evidence };
  } finally {
    if (prepared) await fsp.rm(prepared.runDir, { recursive: true, force: true }).catch(() => {});
    if (started.startedHere) await server.stop().catch(() => {});
  }
}

/**
 * What is ready to record for a job now: { commit, specs } when the test report names a commit,
 * there are specs or an Evidence section, and evidence.json isn't for that commit yet; else null.
 * quietMs: the report must not have changed for this long (it may still be being written).
 */
export async function readyToRecord(job, { quietMs = 2000, now = Date.now() } = {}) {
  if (!evidenceWanted(job.options).on) return null;
  const file = path.join(job.dir, 'test-report.md');
  const st = await fsp.stat(file).catch(() => null);
  if (!st?.isFile() || (quietMs > 0 && now - st.mtimeMs < quietMs)) return null; // still being written
  const text = await fsp.readFile(file, 'utf8').catch(() => null);
  const commit = testedCommit(text);
  if (!commit || !COMMIT.test(commit)) return null;
  const had = await readEvidence(job.dir);
  if (had?.commit && (had.commit.startsWith(commit) || commit.startsWith(had.commit))) return null;
  const specs = await listSpecs(path.join(job.dir, EVIDENCE_DIR));
  if (!specs.length && !evidenceLines(text).size) return null;
  return { commit, specs: specs.length };
}

/** The commit a job's test report names now (for the strip's "From an earlier commit"), or null. */
export async function reportCommit(jobDir) {
  return testedCommit(await fsp.readFile(path.join(jobDir, 'test-report.md'), 'utf8').catch(() => null));
}
