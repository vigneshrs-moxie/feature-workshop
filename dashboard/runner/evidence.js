// The runner's evidence recorder (packet L): once the tester has written test-report.md and its
// specs for the commit under test, and the job's level and options say yes (lib/evidence.js
// evidenceWanted), it records the evidence: Try it for the job on its own port with the sign-in
// skip from the profile's filesToCopy (lib/local.js), the profile's database check, Playwright with
// the config lib/evidence.js writes, the pictures and videos into evidence/<commit>/AC-<n>/ and
// evidence/evidence.json, and the dev server stopped again if it started it. Once per commit. Each
// recording, done or not, sends one `evidence` event and writes one audit line (action 'evidence').
//
//   evidenceRunner({ jobs, local, state, events, on, demo, env, onAutoDbProblem, autoTimes })
//     jobs()     the runner's job records (features())
//     local      its LocalRunner (Try it)
//     on         its event door: a 'change' (a job folder changed) looks for jobs ready to record
//
// An Auto job (its record on) whose app has a database key in the profile records only on Auto's
// own database (lib/local.js autoDatabase), made afresh inside the one-at-a-time queue, never on
// his: the app starts with Auto's address (startServer's databaseUrl), is asked once, and must
// connect to Auto's database within 30 s (AUTO_DB_NOT_USED). His Try it server for the job is never
// stopped for it (AUTO_TRY_IT_RUNNING). No saved original yet: the Test step says it waits
// (AUTO_DB_WAITING) and it looks again. A migration that fails goes to the Foreman (onAutoDbProblem).
// Its Playwright run starts inside the sandbox its app runs in (lib/db-door.js): a spec is the job's
// own code, and could open a database connection.
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
//
// The demo's recording under way (demo mode only, `demo` as the server was started): a job folder
// with evidence/demo-progress.json shows that progress in view() while nothing really records it,
// and live() answers evidence/demo-live.jpg beside it (dashboard/demo/run-demo.js writes both for
// Nightly Export). Outside demo mode both files are ignored.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HttpError } from '../lib/http-guard.js';
import { EVIDENCE_DIR, EvidenceError, NO_LIVE, evidenceFile, evidenceForView, evidenceWanted, liveFiles, markWatched, readEvidence, readLiveFrame, readyToRecord, recordEvidence, recordingWords, reportCommit, shortCommit } from '../lib/evidence.js';
import { guessedWorktree, guessWords } from '../lib/locate.js';
import { fillPattern } from '../lib/profile.js';
import { killTree, shellFor } from '../lib/platform.js';
import { PRODUCT } from '../lib/brand.js';
import { AUTO_NO_FENCE, AUTO_RECORDING_APP, AUTO_TRY_IT_RUNNING, AutoDbError } from '../lib/local.js';
import { sandboxed } from '../lib/db-door.js';

const require = createRequire(import.meta.url);
const SERVER_WAIT_MS = 180_000;

// ---------- An Auto job's recording, on Auto's own database (lib/local.js autoDatabase) ----------

/** The app answered but nothing connected to Auto's database: it uses another one (plan's words). */
export const AUTO_DB_NOT_USED = "The app didn't connect to Auto's database, so nothing was recorded.";
/** The Test step's line while there is no saved original of his database to copy (plan's words). */
export const AUTO_DB_WAITING = `Waiting for a copy of your database. ${PRODUCT} makes it when nothing is connected to it.`;
/** A new backend on his database while Auto's app started: maybe the app, so nothing is recorded (lead's words). */
export const AUTO_DB_HIS_NEW = "Something new connected to your database while Auto's app was starting, so no recording was made. Auto will try again.";
/** Something already on Auto's fresh copy before its app started (an old app reconnecting): nothing is recorded (implementer's words). */
export const AUTO_DB_TAKEN = "Something was still connected to Auto's copy of the database, so no recording was made. Auto will try again.";
/** After this many refusals in a row for a commit (AUTO_DB_HIS_NEW or AUTO_DB_TAKEN), Auto stops on the job instead of trying again. */
export const AUTO_DB_TRIES = 3;
/** Auto's stop after AUTO_DB_TRIES of AUTO_DB_HIS_NEW (lead's words). */
export const AUTO_DB_HIS_NEW_STOP = "Something new connected to your database each of the 3 times Auto's app started, so no recording was made. If that was your own app or a query of yours, switch Auto on again.";
/** Auto's stop after AUTO_DB_TRIES of AUTO_DB_TAKEN (lead's words). */
export const AUTO_DB_TAKEN_STOP = "Something stayed connected to Auto's copy of the database through 3 tries, so no recording was made. Stop whatever is using it, then switch Auto on again.";
/** A migration that exited well but isn't in Auto's copy: Auto stops on the job with this reason (lead's words). */
export const AUTO_NOT_LANDED_STOP = 'A migration from this job did not land on Auto\'s copy of the database. It may have run on yours. Check your database before this job goes on.';
/**
 * The note on a recording during which the door refused a session (lib/db-door.js): Auto's app asked
 * for another database than its own copy. The recording is kept. refusal: lib/local.js autoRefusal's
 * { asked, hint } (lead's words).
 */
export function autoRefusedNote({ asked, hint }) {
  return `Auto’s app asked for the database ${asked} and ${PRODUCT} refused it: Auto only uses its own copy.${hint ? ` A setting in ${hint.file} (${hint.key}) may be what names it.` : ''}`;
}
/** How the recording waits for the app to connect to Auto's database, and when a waiting job is looked at again. */
export const AUTO_DB_TIMES = Object.freeze({ connectEveryMs: 500, connectForMs: 30_000, lookAgainMs: 60_000, sessionsSettleMs: 1100 });

/** The message to the job's Foreman for a migration that failed on Auto's database (plan's words; the skills name its first and last words). */
export function autoMigrationMessage(err) {
  return `${PRODUCT} couldn't apply ${err.migration} to Auto's copy of the database:\n${err.tail ?? ''}\nFix it, then raise the brief into Test again.`;
}

/** The dashboard's own Playwright: its command line and the URL its specs import. */
function ownPlaywright() {
  try {
    return { cli: require.resolve('@playwright/test/cli'), url: import.meta.resolve('@playwright/test') };
  } catch {
    return null;
  }
}

const httpError = (err) => (err instanceof EvidenceError ? new HttpError(err.status, err.message, { ...(err.fix ? { fix: err.fix } : {}), ...(err.code ? { code: err.code } : {}) }) : err);

// ---------- The demo's recording under way (demo mode only) ----------

/** The demo's progress and picture, in a job's evidence/ folder (run-demo.js writes them). */
export const DEMO_PROGRESS_FILE = 'demo-progress.json';
export const DEMO_LIVE_FILE = 'demo-live.jpg';
const DEMO_PROGRESS_MAX_BYTES = 64 * 1024;
const DEMO_LINES_MAX = 200;
const LINE_STATES = new Set(['waiting', 'running', 'passed', 'failed', 'skipped']);

/**
 * One of the demo's files in the job's evidence/ folder, by the server's own name for it: its path
 * when evidence/ is a real folder (not a link) and the file a plain file (not a link), else null.
 */
async function demoPath(jobDir, name) {
  const root = path.join(path.resolve(jobDir), EVIDENCE_DIR);
  const dir = await fsp.lstat(root).catch(() => null);
  if (!dir?.isDirectory()) return null;
  const file = path.join(root, name);
  const st = await fsp.lstat(file).catch(() => null);
  return st?.isFile() ? file : null;
}

/**
 * The demo's progress (evidence/demo-progress.json) in the shape a recording's has (lib/evidence.js):
 * { commit, startedAt, line, of, lines: [{ id, title, state, video, at }] }, or null when the file is
 * missing, a link, too big or not that shape. Read from a file opened without following a link.
 */
async function readDemoProgress(jobDir) {
  const file = await demoPath(jobDir, DEMO_PROGRESS_FILE);
  if (!file) return null;
  let fh;
  let raw;
  try {
    fh = await fsp.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const st = await fh.stat();
    if (!st.isFile() || st.size < 2 || st.size > DEMO_PROGRESS_MAX_BYTES) return null;
    raw = JSON.parse(await fh.readFile('utf8'));
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => {});
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.lines) || !raw.lines.length || raw.lines.length > DEMO_LINES_MAX) return null;
  const text = (v, max) => (typeof v === 'string' && v ? v.slice(0, max) : null);
  const lines = [];
  for (const l of raw.lines) {
    if (!l || typeof l !== 'object' || typeof l.id !== 'string' || !/^AC-[1-9]\d{0,3}$/.test(l.id) || !LINE_STATES.has(l.state)) return null;
    lines.push({ id: l.id, title: text(l.title, 300) ?? l.id, state: l.state, video: null, at: text(l.at, 40) });
  }
  const count = (v) => (Number.isInteger(v) && v >= 0 && v <= lines.length ? v : null);
  const line = count(raw.line);
  const of = count(raw.of) || lines.length;
  if (line === null) return null;
  return { commit: text(raw.commit, 40), startedAt: text(raw.startedAt, 40), line, of, lines };
}

/**
 * The demo's picture for Watch (evidence/demo-live.jpg): { abs, type, size, bytes }, or null. Read as
 * the real picture is (lib/evidence.js readLiveFrame: opened without following a link, a plain file
 * of at most LIVE_MAX_BYTES), but it is a still, so any age will do.
 */
async function readDemoFrame(jobDir) {
  const file = await demoPath(jobDir, DEMO_LIVE_FILE);
  const bytes = file ? await readLiveFrame(file, { now: Number.NEGATIVE_INFINITY }) : null;
  return bytes ? { abs: file, type: 'image/jpeg', size: bytes.length, bytes } : null;
}

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

/**
 * onAutoDbProblem(f, err): Auto's database couldn't be made for an Auto job's recording because of a
 * migration (AutoDbError 'migration': the runner sends the Foreman autoMigrationMessage(err); 'not-landed':
 * the runner stops Auto on the job with AUTO_NOT_LANDED_STOP). Once per commit; a result of
 * { sent: false } lets a later recording of that commit try again. stopAuto(f, reason): Auto's stop on
 * the job (after AUTO_DB_TRIES refusals in a row for AUTO_DB_HIS_NEW or AUTO_DB_TAKEN).
 * autoTimes: AUTO_DB_TIMES (tests shorten them). spawnFn: what starts the browser run (tests look
 * at the command it is given).
 */
export function evidenceRunner({ jobs, local, state, events, on, demo = false, env = process.env, onAutoDbProblem = () => {}, stopAuto = async () => false, autoTimes = AUTO_DB_TIMES, spawnFn = spawn }) {
  const recording = new Set(); // slugs being recorded now
  const problems = new Map(); // slug -> { commit, message, fix, at }: the last recording that couldn't finish
  const progress = new Map(); // slug -> the recording's progress by line (lib/evidence.js), while Playwright runs
  const tried = new Set(); // `${slug}@${commit}` the change watcher already started once (Record tries again)
  const holding = new Map(); // slug -> the recorder's app (serverFor), from its start() to the recording's end: Try it may not stop it
  const told = new Set(); // `${slug}@${commit}` whose failed migration the Foreman was sent
  const lookingAgain = new Set(); // slugs waiting for Auto's database, with a look again set
  const refusals = new Map(); // `${slug}@${commit}` -> refusals in a row for something new on his database or something on Auto's
  const autoHolding = new Set(); // slugs whose app an Auto recording holds (on Auto's database): his Try it Start is refused
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

  /**
   * onLine(text): each line of Playwright's own output (stdout, where the progress reporter writes) as it comes.
   * profile: an Auto recording's sandbox profile (its app's, lib/db-door.js): the same command is
   * started inside the sandbox, since a spec is the job's own code and could open a database
   * connection. Its environment is as ever: the browser talks to the app, not to a database.
   */
  function runPlaywright(script, { configFile, cwd, specs, onLine = null, profile = null }) {
    return new Promise((resolve) => {
      let output = '';
      let partial = '';
      const usual = { file: process.execPath, args: [script, 'test', '--config', configFile] };
      const run = profile ? sandboxed(usual.file, usual.args, profile) : usual;
      const child = spawnFn(run.file, run.args, {
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

  /**
   * Try it for the job: its port, its settings file (with the sign-in skip) and its dev server.
   * handOver(): Try it's Start while the recording holds the app makes it the owner's, so stop()
   * leaves it running (even when the start that made it is still under way here).
   * onAutoDb: an Auto job whose app names a database: Auto's database is made afresh (autoDatabase,
   * which throws AutoDbError), nothing may be connected to it yet, the app starts on it, and it must
   * connect to it while nothing new connects to his (usesAutoDb). His Try it server running for the
   * job is never stopped for it: the recording is refused (cannotStart, before it says it records).
   * An app on Auto's database is never handed over. copied(): called once Auto's copy is ready.
   */
  function serverFor(f, { onAutoDb = false, copied = () => {} } = {}) {
    let startedHere = false;
    let releaseHis = () => {};
    let handed = false;
    let profile = null; // on Auto's database: the sandbox profile its app was started under
    const tryItRuns = () => { const r = local.jobs.get(f.slug)?.server; return Boolean(r && ['starting', 'running'].includes(r.status)); };
    return {
      handOver() { if (!onAutoDb) handed = true; },
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
        const runs = Boolean(running && ['starting', 'running'].includes(running.status));
        let databaseUrl = null;
        let his = null;
        if (onAutoDb) {
          if (runs) throw new EvidenceError(409, AUTO_TRY_IT_RUNNING);
          databaseUrl = (await local.autoDatabase(f, { env })).url; // before the app starts
          // A fresh copy has nobody on it: anything there now (an old app reconnecting) would pass the check below.
          if ((await local.autoConnections(f)) > 0) throw new EvidenceError(409, AUTO_DB_TAKEN, { code: 'auto-db-retry' });
          // Held until the recording's finally (releaseHis); Postgres counts sessions up to a second late.
          releaseHis = await local.holdHisReads(f);
          await settleSessions();
          his = { backends: new Set(await local.hisBackends(f)), sessions: await local.hisSessions(f) };
          copied();
        }
        if (onAutoDb || !runs) {
          try { await local.startServer(f, ...(onAutoDb ? [{ databaseUrl }] : [])); } catch (err) { throw new EvidenceError(409, err.message); }
          startedHere = true;
          if (onAutoDb) profile = local.autoProfile(f.slug);
        }
        try {
          const until = Date.now() + SERVER_WAIT_MS;
          for (;;) {
            const s = local.jobs.get(f.slug)?.server;
            if (s?.status === 'running') break;
            if (!s || !['starting', 'running'].includes(s.status)) throw new EvidenceError(409, 'The app stopped before it was ready. Its output is in Try it.');
            if (Date.now() > until) throw new EvidenceError(504, 'The app didn’t answer within 3 minutes, so nothing was recorded. Its output is in Try it.');
            await new Promise((r) => setTimeout(r, 500));
          }
          const baseURL = fillPattern(w.tryIt.url, { port });
          if (onAutoDb) await usesAutoDb(f, baseURL, his);
          return { baseURL, startedHere, cwd: w.root };
        } catch (err) {
          // The app on Auto's database goes with the refusal (the recording's finally never runs for a start that failed).
          if (onAutoDb && startedHere && !handed) await local.stopServerAndWait(f.slug).catch(() => {});
          throw err;
        }
      },
      releaseHis: () => releaseHis(),
      // On Auto's database: the fence its app runs in, for the browser run (null: none, or not Auto's).
      profile: () => profile,
      // The record's notes: on Auto's database, what its app asked the door for and was refused.
      notes: () => { const refusal = onAutoDb && startedHere ? local.autoRefusal(f.slug) : null; return refusal ? [autoRefusedNote(refusal)] : []; },
      stop: async () => { if (startedHere && !handed) await local.stopServerAndWait(f.slug); },
      // A branch only guessed (lib/locate.js): Try it's where() refuses it with these words, so say them before the start.
      cannotStart: () => (f.worktree && guessedWorktree(f) ? guessWords(f) : onAutoDb && tryItRuns() ? AUTO_TRY_IT_RUNNING : null),
    };
  }

  /**
   * One GET of the app's address, then for the whole window (connectForMs, a look every
   * connectEveryMs): what is connected to Auto's database, and which backends are on HIS database
   * (through the admin database, client backends only), and at its end the sessions his database has
   * had against those before the app started (pg_stat_database, when the server keeps them). At the end: nothing ever on Auto's, the app uses another database
   * (AUTO_DB_NOT_USED); a backend on his that wasn't there before the app started (before), maybe the
   * app's (AUTO_DB_HIS_NEW, and it is tried again). He may have connected himself in those seconds:
   * that only puts the recording off.
   */
  const settleSessions = () => (autoTimes.sessionsSettleMs > 0 ? new Promise((r) => { setTimeout(r, autoTimes.sessionsSettleMs); }) : Promise.resolve());
  async function usesAutoDb(f, baseURL, his) {
    const before = his.backends;
    await fetch(baseURL, { signal: AbortSignal.timeout(SERVER_WAIT_MS), redirect: 'manual' }).then((r) => r.arrayBuffer()).catch(() => {});
    let onAuto = false;
    let hisNew = false;
    for (const until = Date.now() + autoTimes.connectForMs; ;) {
      if ((await local.autoConnections(f).catch(() => 0)) > 0) onAuto = true;
      if ((await local.hisBackends(f)).some((pid) => !before.has(pid))) hisNew = true;
      if (Date.now() >= until) break;
      await new Promise((r) => setTimeout(r, autoTimes.connectEveryMs));
    }
    // Every session his database had, however short (none of Starbase's own: those wait, holdHisReads).
    if (his.sessions !== null) {
      await settleSessions();
      const now = await local.hisSessions(f);
      if (now !== null && now > his.sessions) hisNew = true;
    }
    if (!onAuto) throw new EvidenceError(409, AUTO_DB_NOT_USED, { code: 'auto-db-not-used' });
    if (hisNew) throw new EvidenceError(409, AUTO_DB_HIS_NEW, { code: 'auto-db-retry' });
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

  /**
   * Whether this recording is an Auto job's on Auto's database: the job's Auto record says on now (as
   * the recording starts; switched off later, it finishes as it began) and its app names a database
   * anywhere (lib/local.js namesADatabase). Never in demo mode (nothing real runs there).
   */
  async function onAutoDbFor(f) {
    if (demo) return false;
    const now = (await jobs().catch(() => [])).find((x) => x.slug === f.slug) ?? f;
    if (now.auto?.on !== true) return false;
    // Decided by the address, not the profile: an app that names any database records on Auto's or not at all.
    return local.namesADatabase(f, env); // Starbase's own environment (the runner's)
  }

  async function recordNow(f, via) {
    const pw = playwright();
    const onAutoDb = await onAutoDbFor(f);
    const sayRecording = () => events.emit('evidence', f.slug, { slug: f.slug, outcome: 'recording', at: new Date().toISOString() });
    // On Auto's database it says it records once Auto's copy is ready, not while it waits for one.
    const server = serverFor(f, { onAutoDb, copied: sayRecording });
    let cwd = f.worktree ?? f.repoPath;
    const at = new Date().toISOString();
    try {
      if (!pw && evidenceWanted(f.options).on) {
        throw new EvidenceError(409, demo ? 'Demo mode: nothing real runs, so no evidence is recorded.' : `Playwright isn’t installed with ${PRODUCT}. Run npm install in ${PRODUCT}’s folder, then press Record again.`);
      }
      const result = await recordEvidence({
        job: f, playwrightUrl: pw?.url, cwd,
        onStart: () => { if (!onAutoDb) sayRecording(); },
        onProgress: (p) => {
          progress.set(f.slug, p);
          events.emit('evidence', f.slug, { slug: f.slug, outcome: 'progress', at: new Date().toISOString(), progress: p });
        },
        // From here to the end (lib/evidence.js stops the app in its finally), the recording holds the app.
        server: { start: async () => { holding.set(f.slug, server); if (onAutoDb) autoHolding.add(f.slug); const s = await server.start(); cwd = s.cwd ?? cwd; return s; }, stop: server.stop, cannotStart: server.cannotStart },
        // On Auto's database his is never looked at: making Auto's copy says whether the server is there.
        dbCheck: onAutoDb ? null : await dbCheckFor(f),
        // An Auto recording's browser run goes under the fence its app runs in (the specs are the job's code); with no fence, no run.
        run: (opts) => {
          if (!onAutoDb) return runPlaywright(pw.script, { ...opts, cwd });
          const profile = server.profile();
          if (!profile) throw new EvidenceError(409, AUTO_NO_FENCE);
          return runPlaywright(pw.script, { ...opts, cwd, profile });
        },
        notes: server.notes,
      });
      problems.delete(f.slug);
      for (const k of [...refusals.keys()]) if (k.startsWith(`${f.slug}@`)) refusals.delete(k);
      const ev = result.evidence;
      const count = (s) => ev.criteria.filter((c) => c.status === s).length;
      const summary = { commit: ev.commit, passed: count('passed'), failed: count('failed'), skipped: count('skipped') };
      await state.audit({ action: 'evidence', featureDir: f.dir, slug: f.slug, outcome: 'recorded', via, ...summary });
      events.emit('evidence', f.slug, { slug: f.slug, outcome: 'recorded', at: ev.at, ...summary });
      return ev;
    } catch (err) {
      // No copy of his database to make Auto's from yet, or another switch didn't end: not a failure. The
      // Test step says it waits, the next change looks again, and so does a timer.
      // So is something on Auto's copy before its app, or something new on his while it started.
      // The third such refusal in a row for the commit is not tried again: Auto stops on the job and says why.
      if (err instanceof EvidenceError && err.code === 'auto-db-retry') {
        const key = `${f.slug}@${await reportCommit(f.dir)}`;
        const n = (refusals.get(key) ?? 0) + 1;
        refusals.set(key, n);
        if (n >= AUTO_DB_TRIES) {
          refusals.delete(key);
          const stopped = new EvidenceError(409, err.message === AUTO_DB_TAKEN ? AUTO_DB_TAKEN_STOP : AUTO_DB_HIS_NEW_STOP, { code: 'auto-db-stopped' });
          Promise.resolve().then(() => stopAuto(f, stopped.message)).catch((e2) => console.error(`evidence (${f.slug}): Auto wasn’t stopped:`, e2?.message ?? e2));
          err = stopped;
        }
      }
      if ((err instanceof AutoDbError && ['no-original', 'busy'].includes(err.code)) || (err instanceof EvidenceError && err.code === 'auto-db-retry')) {
        const message = err.code === 'no-original' ? AUTO_DB_WAITING : err.message;
        const commit = await reportCommit(f.dir);
        problems.set(f.slug, { commit, message, fix: null, at, waiting: true });
        tried.delete(`${f.slug}@${commit}`);
        if (!lookingAgain.has(f.slug)) {
          lookingAgain.add(f.slug);
          setTimeout(() => { lookingAgain.delete(f.slug); lookForReady().catch(() => {}); }, autoTimes.lookAgainMs).unref?.();
        }
        events.emit('evidence', f.slug, { slug: f.slug, outcome: 'waiting', at, reason: message });
        throw new EvidenceError(409, message, { code: 'auto-db-waiting' });
      }
      // A migration that failed on Auto's database is the job's to fix: its Foreman is told. One that ended
      // well but isn't in Auto's copy may have run on his: Auto stops on the job. Once per commit; not done, tried again later.
      if (err instanceof AutoDbError && ['migration', 'not-landed'].includes(err.code)) {
        const key = `${f.slug}@${await reportCommit(f.dir)}`;
        if (!told.has(key)) {
          told.add(key);
          Promise.resolve().then(() => onAutoDbProblem(f, err))
            .then((r) => { if (r?.sent === false) told.delete(key); })
            .catch((e2) => { told.delete(key); console.error(`evidence (${f.slug}): Auto's database problem wasn’t passed on:`, e2?.message ?? e2); });
        }
      }
      // A migration that may have run on his database: the Test step says so in the stop's own words.
      const e = err instanceof EvidenceError ? err
        : err instanceof AutoDbError ? new EvidenceError(409, err.code === 'not-landed' ? AUTO_NOT_LANDED_STOP : err.message, { code: `auto-${err.code}` })
          : new EvidenceError(500, `The recording stopped: ${String(err?.message ?? err).split('\n')[0]}`);
      // "Already recorded" and "not for this job" are answers, not problems.
      if (!['already', 'not-wanted'].includes(e.code)) {
        problems.set(f.slug, { commit: await reportCommit(f.dir), message: e.message, fix: e.fix ?? null, at });
        await state.audit({ action: 'evidence', featureDir: f.dir, slug: f.slug, outcome: 'not-recorded', via, reason: e.message });
        events.emit('evidence', f.slug, { slug: f.slug, outcome: 'not-recorded', at, reason: e.message, fix: e.fix ?? null });
      }
      if (!(err instanceof EvidenceError) && !(err instanceof AutoDbError)) console.error(`evidence (${f.slug}):`, err);
      throw e;
    } finally {
      holding.delete(f.slug);
      autoHolding.delete(f.slug);
      server.releaseHis(); // Starbase's own reads of his database go again
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
      const evidence = evidenceForView(await readEvidence(f.dir)); // its notes cleaned for the page (lib/evidence.js)
      const wanted = evidenceWanted(f.options);
      const folder = evidence ? path.join(f.dir, EVIDENCE_DIR, evidence.commit) : path.join(f.dir, EVIDENCE_DIR);
      // In demo mode only, and only while nothing really records the job: the demo's recording under way.
      const demoProgress = demo && !recording.has(f.slug) && !progress.has(f.slug) ? await readDemoProgress(f.dir) : null;
      return {
        evidence, commit: await reportCommit(f.dir), wanted: wanted.on, why: wanted.why,
        recording: recording.has(f.slug) || demoProgress !== null, problem: problems.get(f.slug) ?? null, progress: progress.get(f.slug) ?? demoProgress,
        watch: progress.has(f.slug) || demoProgress !== null,
        folder, folderUrl: pathToFileURL(folder).href + (folder.endsWith(path.sep) ? '' : '/'),
      };
    },
    /** Whether a recording holds the job's app now (from the recorder's start of it to the recording's end): Try it's Stop is refused. */
    holdsApp(slug) {
      return holding.has(slug);
    },
    /** Why his Try it Start is refused now (an Auto recording runs the job's app on Auto's database), else null. */
    startRefusal(slug) {
      return autoHolding.has(slug) ? AUTO_RECORDING_APP : null;
    },
    /** Try it's Start while a recording holds the app: the app is the owner's now, and the recording leaves it running at its end. */
    handAppOver(slug) {
      holding.get(slug)?.handOver();
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
     * In demo mode only, with no real recording of the job: the demo's still picture, while its
     * progress file is there (readDemoFrame), else the 404.
     */
    async live(slug) {
      const f = await jobOf(slug);
      const p = progress.get(f.slug);
      if (!p?.commit) {
        const demoFrame = demo && !recording.has(f.slug) && (await readDemoProgress(f.dir)) ? await readDemoFrame(f.dir) : null;
        if (demoFrame) return demoFrame;
        throw new HttpError(404, NO_LIVE);
      }
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
