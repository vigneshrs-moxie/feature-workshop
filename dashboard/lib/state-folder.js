// The state folder: where Starbase keeps its own small state (lib/state.js has what is in it), and
// its moves from the names it had before. Default: ~/.starbase (STARBASE_STATE_DIR overrides it).
//   ~/.ground-control (packets I to X): the first start of Starbase renames it to ~/.starbase and
//     leaves a link by the old name (moveToStarbase);
//   ~/.feature-workshop (before packet I): its files are moved across once (moveOldState).
// prepareStateFolder does both, in order. Its own module with nothing but node: and the name, so any
// file can ask where the state is (lib/usage-log.js, which the site half reads) without importing
// the rest of state.js.

import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PRODUCT } from './brand.js';


/** The state folder's name in the home folder (G36), and the two it had before (G31, and before that). */
export const STATE_FOLDER = '.starbase';
export const GC_STATE_FOLDER = '.ground-control';
export const OLD_STATE_FOLDER = '.feature-workshop';
/** The note left in ~/.feature-workshop once its files have moved. */
export const MOVED_NOTE = 'MOVED.txt';
/** The note left in ~/.ground-control when a link by that name can't be made (Windows without the rights). */
export const MOVED_TO_STARBASE = 'MOVED-TO-STARBASE.txt';
/** The note in ~/.starbase that says the old ~/.ground-control was found beside it and left alone (said once). */
export const LEFT_ALONE_NOTE = 'OLD-FOLDER-LEFT-ALONE.txt';
// service.json belongs to the copy that wrote it: a stopped one's is stale, a running one's is its own.
const NOT_MOVED = new Set([MOVED_NOTE, 'service.json', 'stop-request']);

/** ~/.starbase: the state folder when STARBASE_STATE_DIR doesn't name one. */
export const defaultStateDir = (home = os.homedir()) => path.join(home, STATE_FOLDER);

const pidAliveHere = (pid) => {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
};

const isDirAt = (p) => { try { return fsSync.statSync(p).isDirectory(); } catch { return false; } };
const isLinkAt = (p) => { try { return fsSync.lstatSync(p).isSymbolicLink(); } catch { return false; } };
const existsAt = (p) => { try { fsSync.lstatSync(p); return true; } catch { return false; } };
const sameFolder = (a, b) => { try { return fsSync.realpathSync(a) === fsSync.realpathSync(b); } catch { return false; } };
const emptyDir = (p) => { try { return fsSync.readdirSync(p).length === 0; } catch { return false; } };

/** Makes the link ~/.ground-control → ~/.starbase (a junction on Windows, which needs no special rights). */
const makeLink = (target, at, platform = process.platform) => fsSync.symlinkSync(target, at, platform === 'win32' ? 'junction' : 'dir');

/**
 * The one-time rename of ~/.ground-control to ~/.starbase (packet Y, G36). It happens when
 * ~/.ground-control is a folder of its own (not the link this leaves, and without the note) and
 * ~/.starbase isn't there yet (an empty ~/.starbase counts as not there):
 *   1. ~/.ground-control is renamed to ~/.starbase (one rename on the same disk: nothing is copied,
 *      and a copy of Ground Control still running keeps its open files);
 *   2. a link ~/.ground-control → ~/.starbase is left, so that copy keeps finding its files by the
 *      old name (where the link can't be made, MOVED-TO-STARBASE.txt is left in a new, otherwise
 *      empty ~/.ground-control instead; this never fails because of the link);
 *   3. one audit line `state-moved` in ~/.starbase/audit.jsonl: "Moved ~/.ground-control to ~/.starbase".
 * When both folders are there it merges nothing: ~/.starbase is used, and `bothThere` says so (the
 * caller tells the person once; LEFT_ALONE_NOTE in ~/.starbase remembers that it did).
 *
 * Returns { moved: true, from, to, linked, message } when it moved; else { skipped } with
 * 'no-old-folder' | 'moved-before' | 'both-there' (and `firstTime`) | 'old-folder-is-a-link' |
 * 'rename-failed' (and `error`: the state stays in ~/.ground-control). Never throws.
 */
export function moveToStarbase({ home = os.homedir(), now = () => new Date(), link = makeLink, platform = process.platform } = {}) {
  const from = path.join(home, GC_STATE_FOLDER);
  const to = defaultStateDir(home);
  if (!existsAt(from)) return { skipped: 'no-old-folder' };
  if (isLinkAt(from)) return { skipped: sameFolder(from, to) ? 'moved-before' : 'old-folder-is-a-link' };
  if (!isDirAt(from)) return { skipped: 'no-old-folder' };
  if (existsAt(path.join(from, MOVED_TO_STARBASE))) return { skipped: 'moved-before' };
  if (existsAt(to) && !(isDirAt(to) && !isLinkAt(to) && emptyDir(to))) {
    const note = path.join(to, LEFT_ALONE_NOTE);
    const firstTime = isDirAt(to) && !existsAt(note);
    if (firstTime) {
      try {
        fsSync.writeFileSync(note, [
          `${PRODUCT} found ${from} beside this folder on ${now().toISOString()} and left it alone: nothing in it was moved or merged.`,
          `${PRODUCT} uses this folder (${to}). Once you have checked that nothing you need is left in ${from}, you can delete it.`,
          '',
        ].join('\n'), { mode: 0o600 });
      } catch { /* it is said again next time */ }
    }
    return { skipped: 'both-there', from, to, firstTime };
  }
  try {
    if (existsAt(to)) fsSync.rmdirSync(to); // empty: made by something that ran before the move
    fsSync.renameSync(from, to);
  } catch (err) {
    return { skipped: 'rename-failed', from, to, error: `${from} couldn’t be renamed to ${to} (${err.code ?? err.message}).` };
  }
  let linked = true;
  try { link(to, from, platform); } catch {
    linked = false;
    try {
      fsSync.mkdirSync(from, { recursive: true, mode: 0o700 });
      fsSync.writeFileSync(path.join(from, MOVED_TO_STARBASE), [
        `${PRODUCT} moved this folder to ${to} on ${now().toISOString()}.`,
        `Everything that was here is there now. ${PRODUCT} doesn’t read this folder any more; you can delete it.`,
        '',
      ].join('\n'), { mode: 0o600 });
    } catch { /* the audit line still says it */ }
  }
  const message = `Moved ~/${GC_STATE_FOLDER} to ~/${STATE_FOLDER}`;
  const entry = { at: now().toISOString(), action: 'state-moved', from, to, message, linked };
  try { fsSync.appendFileSync(path.join(to, 'audit.jsonl'), `${JSON.stringify(entry)}\n`, { mode: 0o600 }); } catch { /* the terminal line still says it */ }
  return { moved: true, from, to, linked, message };
}

/**
 * The one-time move from ~/.feature-workshop into the state folder (packet I step 7; since packet Y
 * that is ~/.starbase, after moveToStarbase has run). It happens
 * when the old folder exists, has not been moved before (no MOVED.txt in it), and the new folder has
 * no settings.json yet. Each file or folder in the old folder is moved across unless the new folder
 * already has one by that name (integrate.json and usage.jsonl live there already): that one is
 * kept, and the old one stays where it was. Then one audit line `state-moved` goes into the new
 * folder's audit.jsonl and MOVED.txt is left in the old folder saying where everything went.
 *
 * Not while a copy of Ground Control from before the move is still running from the old folder
 * (its service.json names a live process): its files would move out from under it. It happens on
 * the first start after that one has stopped.
 *
 * Returns { moved: [names], kept: [names], from, to } when it moved, else null with `why`
 * in { skipped }. Never throws: a move that fails partway says so in `error`.
 */
export function moveOldState({ home = os.homedir(), now = () => new Date(), alive = pidAliveHere } = {}) {
  const from = path.join(home, OLD_STATE_FOLDER);
  const to = defaultStateDir(home);
  const isDir = (p) => { try { return fsSync.statSync(p).isDirectory(); } catch { return false; } };
  const has = (p) => { try { fsSync.lstatSync(p); return true; } catch { return false; } };
  if (!isDir(from)) return { skipped: 'no-old-folder' };
  if (has(path.join(from, MOVED_NOTE))) return { skipped: 'moved-before' };
  if (has(path.join(to, 'settings.json'))) return { skipped: 'already-set-up' };
  try {
    const old = JSON.parse(fsSync.readFileSync(path.join(from, 'service.json'), 'utf8'));
    if (Number.isInteger(old?.pid) && old.pid !== process.pid && alive(old.pid)) return { skipped: 'old-copy-running', pid: old.pid };
  } catch { /* none, or unreadable: nothing is running from there */ }

  fsSync.mkdirSync(to, { recursive: true, mode: 0o700 });
  const moved = [];
  const kept = [];
  let error = null;
  for (const name of fsSync.readdirSync(from).sort()) {
    if (NOT_MOVED.has(name)) continue;
    const src = path.join(from, name);
    const dest = path.join(to, name);
    if (has(dest)) { kept.push(name); continue; }
    try {
      try { fsSync.renameSync(src, dest); } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        fsSync.cpSync(src, dest, { recursive: true, preserveTimestamps: true });
        fsSync.rmSync(src, { recursive: true, force: true });
      }
      moved.push(name);
    } catch (err) {
      error = `${name} couldn’t be moved (${err.code ?? err.message}).`;
      break;
    }
  }
  const at = now().toISOString();
  const entry = { at, action: 'state-moved', from, to, moved, kept, ...(error ? { error } : {}) };
  try { fsSync.appendFileSync(path.join(to, 'audit.jsonl'), `${JSON.stringify(entry)}\n`, { mode: 0o600 }); } catch { /* the note below still says it */ }
  const lines = [
    `${PRODUCT} moved its files from this folder to ${to} on ${at}.`,
    '',
    moved.length ? `Moved: ${moved.join(', ')}.` : 'Nothing needed moving.',
    ...(kept.length ? [`Left here, because ${to} already had its own copy: ${kept.join(', ')}.`] : []),
    ...(error ? [`Stopped early: ${error} Whatever is still here wasn’t moved; move it by hand.`] : []),
    '',
    `${PRODUCT} doesn’t read this folder any more. Once you have checked that nothing you need is left, you can delete it.`,
    '',
  ];
  try { fsSync.writeFileSync(path.join(from, MOVED_NOTE), lines.join('\n'), { mode: 0o600 }); } catch { /* the audit line still says it */ }
  return { moved, kept, from, to, ...(error ? { error } : {}) };
}

/**
 * Where the state is right now, without moving anything:
 *   ~/.ground-control while it is still waiting for its rename (a folder of its own, or a link
 *   that isn't to ~/.starbase, and no ~/.starbase with anything in it);
 *   ~/.feature-workshop while it is still waiting for its one-time move (it exists, has no
 *   MOVED.txt, there is no ~/.ground-control waiting, and ~/.starbase has no settings.json);
 *   else ~/.starbase.
 */
export function stateDirNow(home = os.homedir()) {
  const gc = path.join(home, GC_STATE_FOLDER);
  const fw = path.join(home, OLD_STATE_FOLDER);
  const to = defaultStateDir(home);
  const starbaseInUse = isDirAt(to) && !emptyDir(to);
  const gcWaiting = isDirAt(gc) && !sameFolder(gc, to) && !existsAt(path.join(gc, MOVED_TO_STARBASE)) && !starbaseInUse;
  if (gcWaiting) return gc;
  const fwWaiting = isDirAt(fw) && !existsAt(path.join(fw, MOVED_NOTE)) && !existsAt(path.join(to, 'settings.json'));
  return fwWaiting ? fw : to;
}

/**
 * Gets the default state folder ready before anything is written to it, and says what happened:
 * moveToStarbase, then moveOldState. Returns { dir, lines }: the folder in use now (stateDirNow) and
 * the plain sentences for the terminal (none when nothing happened). The server and the CLI call it
 * first, when no STARBASE_STATE_DIR (or demo mode) names another folder.
 */
export function prepareStateFolder({ home = os.homedir(), now, link, platform, alive } = {}) {
  const lines = [];
  const a = moveToStarbase({ home, now, link, platform });
  if (a.moved) lines.push(`${a.message}${a.linked ? ', and left a link by the old name, so a copy that is still running keeps finding its files' : `; a note is left in ~/${GC_STATE_FOLDER}`}.`);
  else if (a.skipped === 'both-there' && a.firstTime) lines.push(`~/${GC_STATE_FOLDER} and ~/${STATE_FOLDER} are both there, so nothing was merged: ${PRODUCT} uses ~/${STATE_FOLDER} and left ~/${GC_STATE_FOLDER} alone.`);
  else if (a.skipped === 'rename-failed') lines.push(`${a.error} ${PRODUCT} keeps using ~/${GC_STATE_FOLDER} for now and tries again at the next start.`);
  // ~/.feature-workshop moves only into ~/.starbase, never while ~/.ground-control is still in use.
  const gcInUse = a.skipped === 'rename-failed' || a.skipped === 'old-folder-is-a-link';
  const b = gcInUse ? { skipped: 'ground-control-in-use' } : moveOldState({ home, ...(now ? { now } : {}), ...(alive ? { alive } : {}) });
  if (b.moved) lines.push(`Moved ${b.moved.length} item${b.moved.length === 1 ? '' : 's'} from ${b.from} to ${b.to}${b.kept.length ? ` (kept the copies already there of ${b.kept.join(', ')})` : ''}${b.error ? `; ${b.error}` : ''}. A note is left in the old folder.`);
  else if (b.skipped === 'old-copy-running') lines.push(`${path.join(home, OLD_STATE_FOLDER)} is still in use by another copy of ${PRODUCT} (pid ${b.pid}), so this one uses it too; it moves to ~/${STATE_FOLDER} on the first start after that copy stops.`);
  return { dir: stateDirNow(home), lines };
}

/**
 * The state folder by the host's rule (dashboard/server.js): STARBASE_STATE_DIR, else in demo mode
 * the folder `state` next to STARBASE_FEATURES_DIR, else stateDirNow().
 */
export function stateDirFor(env = process.env, home = os.homedir()) {
  if (env.STARBASE_STATE_DIR) return path.resolve(env.STARBASE_STATE_DIR);
  if (env.STARBASE_DEMO) {
    const features = path.resolve(env.STARBASE_FEATURES_DIR || path.join(home, '.claude', 'feature-work'));
    return path.join(path.dirname(features), 'state');
  }
  return stateDirNow(home);
}
