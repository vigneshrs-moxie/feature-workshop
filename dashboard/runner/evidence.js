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
//     view(slug)          { evidence, commit, wanted, why, recording, problem, progress, watch, folder, folderUrl }
//                         (progress: by line while Playwright runs, else null; each change is an
//                         `evidence` event with outcome 'progress', and one with progress null at the end;
//                         watch: true while Playwright runs, so the laptop's page can show Watch)
//     progressWords(slug) "Recording evidence: line 4 of 19" while it runs ("…: starting, 19 lines" before
//                         a line begins), else null (the Jobs card's `testing`)
//     file(slug, rel)     { abs, type, size } of one picture or video inside evidence/, else 404
//     live(slug)          { abs, type: 'image/jpeg', size, bytes } of the hidden browser's picture while it
//                         records and someone watches (each ask marks it watched for 5 s), else 404; laptop only
//     record(slug)        records for the commit the report names now (409 "Already recorded for …");
//                         one that takes longer than a moment carries on by itself ({ started: true })
//
// Playwright is the dashboard's own, pinned in package.json (@playwright/test), run as
// `node <its cli.js> test --config <evidence/playwright.config.mjs>` in the job's worktree: that is
// `npx playwright test` without npx looking anything up. STARBASE_PLAYWRIGHT names another script
// to run the same way (the tests' fake, which copies dashboard/test/fixtures/evidence/). In demo
// mode nothing real runs, so only that script can record there.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HttpError } from '../lib/http-guard.js';
import { EVIDENCE_DIR, EvidenceError, NO_LIVE, evidenceFile, evidenceWanted, liveFiles, markWatched, readEvidence, readLiveFrame, readyToRecord, recordEvidence, recordingWords, reportCommit, shortCommit } from '../lib/evidence.js';
import { fillPattern } from '../lib/profile.js';
import { killTree, shellFor } from '../lib/platform.js';
import { PRODUCT } from '../lib/brand.js';

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
  const progress = new Map(); // slug -> the recording's progress by line (lib/evidence.js), while Playwright runs
  const tried = new Set(); // `${slug}@${commit}` the change watcher already started once (Record tries again)
  let queue = Promise.resolve(); // one recording at a time: one browser, one worker

  const jobOf = async (slug) => {
    const f = (await jobs()).find((x) => x.slug === slug);
    if (!f) throw new HttpError(404, 'No job by that name.');
    return f;
  };

  /** The way Playwright runs here: the fake (STARBASE_PLAYWRIGHT), the dashboard's own, or none. */
  function playwright() {
    const own = ownPlaywright();
    if (env.STARBASE_PLAYWRIGHT) return { script: env.STARBASE_PLAYWRIGHT, url: own?.url ?? '@playwright/test' };
    if (demo || !own) return null;
    return { script: own.cli, url: own.url };
  }

  /** onLine(text): each line of Playwright's own output (stdout, where the progress reporter writes) as it comes. */
  function runPlaywright(script, { configFile, cwd, specs, onLine = null }) {
    return new Promise((resolve) => {
      let output = '';
      let partial = '';
      const child = spawn(process.execPath, [script, 'test', '--config', configFile], {
        cwd, env: { ...process.env, FORCE_COLOR: '0', PLAYWRIGHT_HTML_OPEN: 'never' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
      const limit = setTimeout(() => { if (child.pid) killTree(child.pid); }, 60_000 * (specs.length + 2));
      const keep = (d) => { output = (output + d).slice(-200_000); };
      const tell = (line) => { try { onLine?.(line); } catch { /* a reader's trouble never stops the run */ } };
      const lines = (d) => {
        partial += d;
        const all = partial.split('\n');
        partial = all.pop().slice(-200_000);
        for (const line of all) tell(line);
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d) => { keep(d); lines(d); });
      child.stderr.on('data', keep);
      child.on('error', (err) => { clearTimeout(limit); resolve({ code: null, output: `${output}\n${err.message}` }); });
      child.on('close', (code) => { clearTimeout(limit); if (partial) tell(partial); resolve({ code, output }); });
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
        throw new EvidenceError(409, demo ? 'Demo mode: nothing real runs, so no evidence is recorded.' : `Playwright isn’t installed with ${PRODUCT}. Run npm install in ${PRODUCT}’s folder, then press Record again.`);
      }
      const result = await recordEvidence({
        job: f, playwrightUrl: pw?.url, cwd,
        onStart: () => events.emit('evidence', f.slug, { slug: f.slug, outcome: 'recording', at: new Date().toISOString() }),
        onProgress: (p) => {
          progress.set(f.slug, p);
          events.emit('evidence', f.slug, { slug: f.slug, outcome: 'progress', at: new Date().toISOString(), progress: p });
        },
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
    } finally {
      // However it ended (recorded, refused, Playwright dead part way), the card and the page stop saying a line runs.
      if (progress.delete(f.slug)) events.emit('evidence', f.slug, { slug: f.slug, outcome: 'progress', at: new Date().toISOString(), progress: null });
    }
  }

  /** One recording at a time; a job already recording says so. */
  function record(f, via) {
    if (recording.has(f.slug)) return Promise.reject(new EvidenceError(409, 'Evidence for this job is being recorded now.', { code: 'busy' }));
    recording.add(f.slug);
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
        recording: recording.has(f.slug), problem: problems.get(f.slug) ?? null, progress: progress.get(f.slug) ?? null,
        watch: progress.has(f.slug),
        folder, folderUrl: pathToFileURL(folder).href + (folder.endsWith(path.sep) ? '' : '/'),
      };
    },
    /** The Jobs card's words while Playwright records the job ("Recording evidence: line 4 of 19"; lib/evidence.js recordingWords), else null. */
    progressWords(slug) {
      return recordingWords(progress.get(slug));
    },
    async file(slug, rel) {
      const f = await jobOf(slug);
      try { return await evidenceFile(f.dir, rel); } catch (err) { throw httpError(err); }
    },
    /**
     * Watch (the laptop only): the hidden browser's newest picture while Playwright records the job.
     * Each ask touches the run's watch file, so the guard saves a picture every half second for the
     * next 5 s (lib/evidence.js guardModule); the picture is answered when one was saved in the last
     * 5 s, else a 404. Both paths are the server's own (evidence/<commit>/run/), never the asker's,
     * and nothing is made when no recording runs (the run's folder goes with the run). Neither file
     * is ever used through a link, and the picture's bytes are read here (at most LIVE_MAX_BYTES).
     */
    async live(slug) {
      const f = await jobOf(slug);
      const p = progress.get(f.slug);
      if (!p?.commit) throw new HttpError(404, NO_LIVE);
      const { liveFile, watchFile } = liveFiles(path.join(f.dir, EVIDENCE_DIR), p.commit);
      // Only into the run's folder while it is there, and never through a link (lib/evidence.js markWatched).
      if (!(await markWatched(watchFile))) throw new HttpError(404, NO_LIVE);
      // Read here, from a file opened without following a link, fresh and under the cap.
      const bytes = await readLiveFrame(liveFile);
      if (!bytes || !progress.has(f.slug)) throw new HttpError(404, NO_LIVE);
      return { abs: liveFile, type: 'image/jpeg', size: bytes.length, bytes };
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

// ---------- Up to the hosted site (packet 2B) ----------

const UPLOAD_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webm': 'video/webm', '.mp4': 'video/mp4' };

/**
 * Sends a job's pictures and videos (its evidence list's, and while it records, each finished
 * line's video its progress names) to the site's private Blob store, each once (sent: a Map kept
 * by the caller, `${slug}\n${file}` -> its size and time). For each new one the site makes a
 * one-time upload link for exactly that path (ask → { url, pathname }), the file goes straight to
 * the store with a PUT (putFile: fetch), and the site is told it is there (done). The file's bytes
 * never pass through the site, and nothing but the evidence files leaves.
 */
export async function uploadEvidence({ slug, view, door, sent, ask, done, putFile, log = () => {} }) {
  const fsp = await import('node:fs/promises');
  // The evidence list's files, and each finished line's video while a recording runs (its progress).
  const groups = [
    ...(view?.evidence?.criteria ?? []).map((c) => [...(c.screenshots ?? []).map((x) => x?.file), typeof c.video === 'string' ? c.video : c.video?.file]),
    (view?.progress?.lines ?? []).map((l) => l?.video),
  ];
  for (const group of groups) {
    const files = group.filter((f) => typeof f === 'string');
    for (const file of files) {
      const type = UPLOAD_TYPES[path.extname(file).toLowerCase()];
      if (!type) continue;
      let f;
      try { f = await door.file(slug, file); } catch { continue; }
      const mark = `${f.size}:${f.mtimeMs ?? ''}`;
      const key = `${slug}\n${file}`;
      if (sent.get(key) === mark) continue;
      const a = await ask({ slug, file, type, size: f.size });
      if (a?.status !== 200 || !a.body?.url) { log(`evidence ${file}: the site didn’t give an upload link (${a?.body?.error ?? a?.status ?? 'no answer'}).`); continue; }
      if (!a.body.upload) { sent.set(key, mark); continue; } // the site has it already
      const bytes = await fsp.readFile(f.abs);
      const put = await putFile(a.body.url, { method: 'PUT', headers: { 'content-type': type }, body: bytes });
      if (!put.ok) { log(`evidence ${file}: the upload was refused (${put.status}).`); continue; }
      const d = await done({ slug, file, pathname: a.body.pathname });
      if (d?.status === 200) sent.set(key, mark);
    }
  }
}
