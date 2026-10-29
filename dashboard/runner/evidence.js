// The runner's evidence recorder (packet L): once the tester has written test-report.md and its
// specs for the commit under test, and the job's level and options say yes (lib/evidence.js
// evidenceWanted), it records the evidence: Try it for the job on its own port with the sign-in
// skip from the profile's filesToCopy (lib/local.js), the profile's database check, Playwright with
// the config lib/evidence.js writes, the pictures and videos into evidence/<commit>/AC-<n>/ and
// evidence/evidence.json, and the dev server stopped again if it started it. Once per commit. Each
// recording, done or not, sends one `evidence` event and writes one audit line (action 'evidence').
//
//   evidenceRunner({ jobs, local, state, events, on, demo, env })
//     jobs()     the runner's job records (features())
//     local      its LocalRunner (Try it)
//     on         its event door: a 'change' (a job folder changed) looks for jobs ready to record
//   returns the door the site's routes use (site/routes-evidence.js, through runner.local.evidence):
//     view(slug)          { evidence, commit, wanted, why, recording, problem, folder, folderUrl }
//     file(slug, rel)     { abs, type, size } of one picture or video inside evidence/, else 404
//     record(slug)        records for the commit the report names now (409 "Already recorded for …");
//                         one that takes longer than a moment carries on by itself ({ started: true })
//
// Playwright is the dashboard's own, pinned in package.json (@playwright/test), run as
// `node <its cli.js> test --config <evidence/playwright.config.mjs>` in the job's worktree: that is
// `npx playwright test` without npx looking anything up. WORKSHOP_PLAYWRIGHT names another script
// to run the same way (the tests' fake, which copies dashboard/test/fixtures/evidence/). In demo
// mode nothing real runs, so only that script can record there.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HttpError } from '../lib/http-guard.js';
import { EVIDENCE_DIR, EvidenceError, evidenceFile, evidenceWanted, readEvidence, readyToRecord, recordEvidence, reportCommit, shortCommit } from '../lib/evidence.js';
import { fillPattern } from '../lib/profile.js';
import { killTree, shellFor } from '../lib/platform.js';

const require = createRequire(import.meta.url);
const SERVER_WAIT_MS = 180_000;

/** The dashboard's own Playwright: its command line and the URL its specs import. */
function ownPlaywright() {
  try {
    return { cli: require.resolve('@playwright/test/cli'), url: import.meta.resolve('@playwright/test') };
  } catch {
    return null;
  }
}

const httpError = (err) => (err instanceof EvidenceError ? new HttpError(err.status, err.message, { ...(err.fix ? { fix: err.fix } : {}), ...(err.code ? { code: err.code } : {}) }) : err);

/** Run one command line through the shell: resolves { code, output } (code null when it couldn't start). */
function runShell(command, { cwd, timeoutMs = 15_000 } = {}) {
  return new Promise((resolve) => {
    const sh = shellFor(command);
    let output = '';
    let child;
    try { child = spawn(sh.file, sh.args, { cwd, ...sh.options, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (err) { resolve({ code: null, output: err.message }); return; }
    const timer = setTimeout(() => { if (child.pid) killTree(child.pid); }, timeoutMs);
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: null, output: `${output}${err.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, output }); });
  });
}

export function evidenceRunner({ jobs, local, state, events, on, demo = false, env = process.env }) {
  const recording = new Set(); // slugs being recorded now
  const problems = new Map(); // slug -> { commit, message, fix, at }: the last recording that couldn't finish
  const tried = new Set(); // `${slug}@${commit}` the change watcher already started once (Record tries again)
  let queue = Promise.resolve(); // one recording at a time: one browser, one worker

  const jobOf = async (slug) => {
    const f = (await jobs()).find((x) => x.slug === slug);
    if (!f) throw new HttpError(404, 'No job by that name.');
    return f;
  };

  /** The way Playwright runs here: the fake (WORKSHOP_PLAYWRIGHT), the dashboard's own, or none. */
  function playwright() {
    const own = ownPlaywright();
    if (env.WORKSHOP_PLAYWRIGHT) return { script: env.WORKSHOP_PLAYWRIGHT, url: own?.url ?? '@playwright/test' };
    if (demo || !own) return null;
    return { script: own.cli, url: own.url };
  }

  function runPlaywright(script, { configFile, cwd, specs }) {
    return new Promise((resolve) => {
      let output = '';
      const child = spawn(process.execPath, [script, 'test', '--config', configFile], {
        cwd, env: { ...process.env, FORCE_COLOR: '0', PLAYWRIGHT_HTML_OPEN: 'never' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
      const limit = setTimeout(() => { if (child.pid) killTree(child.pid); }, 60_000 * (specs.length + 2));
      const keep = (d) => { output = (output + d).slice(-200_000); };
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
      child.on('error', (err) => { clearTimeout(limit); resolve({ code: null, output: `${output}\n${err.message}` }); });
      child.on('close', (code) => { clearTimeout(limit); resolve({ code, output }); });
    });
  }

  /** Try it for the job: its port, its settings file (with the sign-in skip) and its dev server. */
  function serverFor(f) {
    let startedHere = false;
    return {
      async start() {
        const w = await local.where(f);
        if (!w.app) throw new EvidenceError(409, w.reason ?? 'This job’s worktree has no app to start (a package.json with a "dev" script), so there is nothing to record.');
        const port = await local.portFor(f.slug);
        const envFile = await local.envStatus(w, port);
        // The profile's settings file, with the job's port and the sign-in skip: Try it's Set up.
        if (envFile && !envFile.ready && !demo) {
          try { await local.setupEnv(f); } catch (err) { throw new EvidenceError(409, `Try it couldn’t set up this job’s settings file: ${err.message}`); }
          const again = await local.envStatus(w, port);
          if (again && again.signInSkipped === false) throw new EvidenceError(409, `The sign-in skip is off in ${again.file}, so the specs would meet the sign-in page. Turn it on with Set up in Try it, then press Record again.`);
        }
        const running = local.jobs.get(f.slug)?.server;
        if (!(running && ['starting', 'running'].includes(running.status))) {
          try { await local.startServer(f); } catch (err) { throw new EvidenceError(409, err.message); }
          startedHere = true;
        }
        const until = Date.now() + SERVER_WAIT_MS;
        for (;;) {
          const s = local.jobs.get(f.slug)?.server;
          if (s?.status === 'running') break;
          if (!s || !['starting', 'running'].includes(s.status)) throw new EvidenceError(409, 'The app stopped before it was ready. Its output is in Try it.');
          if (Date.now() > until) throw new EvidenceError(504, 'The app didn’t answer within 3 minutes, so nothing was recorded. Its output is in Try it.');
          await new Promise((r) => setTimeout(r, 500));
        }
        return { baseURL: fillPattern(w.tryIt.url, { port }), startedHere, cwd: w.root };
      },
      stop: async () => { if (startedHere) await local.stopServerAndWait(f.slug); },
    };
  }

  /**
   * The profile's database check: its own command (database.check, e.g. pg_isready) when it names
   * one, else Try it's own look at the local copy (the database the profile's settings file points
   * at: down when it can't be read or isn't there). It says nothing when the app has no local database.
   */
  async function dbCheckFor(f) {
    if (demo) return null;
    const hit = f.repoPath && local.registry ? await local.registry.profileFor(f.repoPath).catch(() => null) : null;
    const command = hit?.ok ? hit.profile?.database?.check : null;
    if (command) return async () => ({ ok: (await runShell(command, { cwd: f.repoPath })).code === 0 });
    return async () => {
      const db = await local.dbView(f, { fresh: true }).catch(() => null);
      if (!db) return null; // no local database to check
      const down = db.gone || (db.available === false && /Couldn’t read the local database|doesn’t exist on this computer/.test(String(db.reason ?? '')));
      return { ok: !down };
    };
  }

  async function recordNow(f, via) {
    const pw = playwright();
    const server = serverFor(f);
    let cwd = f.worktree ?? f.repoPath;
    const at = new Date().toISOString();
    try {
      if (!pw && evidenceWanted(f.options).on) {
        throw new EvidenceError(409, demo ? 'Demo mode: nothing real runs, so no evidence is recorded.' : 'Playwright isn’t installed with the dashboard. Run npm install in the dashboard’s folder, then press Record again.');
      }
      const result = await recordEvidence({
        job: f, playwrightUrl: pw?.url, cwd,
        server: { start: async () => { const s = await server.start(); cwd = s.cwd ?? cwd; return s; }, stop: server.stop },
        dbCheck: await dbCheckFor(f),
        run: (opts) => runPlaywright(pw.script, { ...opts, cwd }),
      });
      problems.delete(f.slug);
      const ev = result.evidence;
      const count = (s) => ev.criteria.filter((c) => c.status === s).length;
      const summary = { commit: ev.commit, passed: count('passed'), failed: count('failed'), skipped: count('skipped') };
      await state.audit({ action: 'evidence', featureDir: f.dir, slug: f.slug, outcome: 'recorded', via, ...summary });
      events.emit('evidence', f.slug, { slug: f.slug, outcome: 'recorded', at: ev.at, ...summary });
      return ev;
    } catch (err) {
      const e = err instanceof EvidenceError ? err : new EvidenceError(500, `The recording stopped: ${String(err?.message ?? err).split('\n')[0]}`);
      // "Already recorded" and "not for this job" are answers, not problems.
      if (!['already', 'not-wanted'].includes(e.code)) {
        problems.set(f.slug, { commit: await reportCommit(f.dir), message: e.message, fix: e.fix ?? null, at });
        await state.audit({ action: 'evidence', featureDir: f.dir, slug: f.slug, outcome: 'not-recorded', via, reason: e.message });
        events.emit('evidence', f.slug, { slug: f.slug, outcome: 'not-recorded', at, reason: e.message, fix: e.fix ?? null });
      }
      if (!(err instanceof EvidenceError)) console.error(`evidence (${f.slug}):`, err);
      throw e;
    }
  }

  /** One recording at a time; a job already recording says so. */
  function record(f, via) {
    if (recording.has(f.slug)) return Promise.reject(new EvidenceError(409, 'Evidence for this job is being recorded now.', { code: 'busy' }));
    recording.add(f.slug);
    events.emit('evidence', f.slug, { slug: f.slug, outcome: 'recording', at: new Date().toISOString() });
    const job = queue.then(() => recordNow(f, via)).finally(() => { recording.delete(f.slug); });
    queue = job.catch(() => {});
    return job;
  }

  // ---------- After the tester: a job folder changed ----------
  let looking = false;
  let again = false;
  async function lookForReady() {
    if (looking) { again = true; return; }
    looking = true;
    try {
      do {
        again = false;
        for (const f of await jobs()) {
          if (f.closed || f.stage !== 'test' || recording.has(f.slug)) continue;
          const ready = await readyToRecord(f).catch(() => null);
          if (!ready || tried.has(`${f.slug}@${ready.commit}`)) continue;
          tried.add(`${f.slug}@${ready.commit}`);
          record(f, 'auto').catch(() => {});
        }
      } while (again);
    } finally {
      looking = false;
    }
  }
  // The report may still be settling: look once now and once a few seconds later.
  on('change', () => {
    lookForReady().catch((err) => console.error('evidence:', err.message));
    setTimeout(() => lookForReady().catch(() => {}), 3000).unref?.();
  });

  return {
    async view(slug) {
      const f = await jobOf(slug);
      const evidence = await readEvidence(f.dir);
      const wanted = evidenceWanted(f.options);
      const folder = evidence ? path.join(f.dir, EVIDENCE_DIR, evidence.commit) : path.join(f.dir, EVIDENCE_DIR);
      return {
        evidence, commit: await reportCommit(f.dir), wanted: wanted.on, why: wanted.why,
        recording: recording.has(f.slug), problem: problems.get(f.slug) ?? null,
        folder, folderUrl: pathToFileURL(folder).href + (folder.endsWith(path.sep) ? '' : '/'),
      };
    },
    async file(slug, rel) {
      const f = await jobOf(slug);
      try { return await evidenceFile(f.dir, rel); } catch (err) { throw httpError(err); }
    },
    /**
     * Record now. A quick answer (already recorded, not for this job, the database copy down…) comes
     * back as it is; a recording that takes longer goes on by itself: { started: true }, and its
     * `evidence` event says when it is done.
     */
    async record(slug, { waitMs = 1500 } = {}) {
      const f = await jobOf(slug);
      let job;
      try { job = record(f, 'page'); } catch (err) { throw httpError(err); }
      const quick = await Promise.race([job.then((ev) => ({ ev }), (err) => ({ err })), new Promise((r) => { setTimeout(() => r(null), waitMs).unref?.(); })]);
      if (!quick) { job.catch(() => {}); return { ok: true, started: true }; }
      if (quick.err) throw httpError(quick.err);
      return { ok: true, started: false, evidence: quick.ev };
    },
    shortCommit,
  };
}
