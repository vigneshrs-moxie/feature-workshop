// The restart replay (plan §2.1, packet G step 5): what the runner rebuilds at start, before the
// routes open, from the state folder's audit.jsonl and sessions.json.
//
// At stop the runner writes one audit line `service-stop` naming each reply it paused
// ({ paused: [{ runId, slug, featureDir, sessionId, model, cwd, kind }] }).
// At start, for each job not closed, replay() works out:
//   its last session      the session the Foreman was in (sessions.json, else the audit)
//   whether a reply was cut off
//     'clean'  the last service-stop after the job's last send names it: the reply was paused by a
//              clean stop and carries on by itself (the runner resumes it once the job's lock is
//              free and no usage limit holds)
//     'crash'  the job's last send has no `run-ended` and no service-stop came after it, though a
//              service-start came before it (a runner that writes service-stop sent it): Ground
//              Control stopped while the Foreman was working. Nothing is resumed; the job shows
//              paused, with a thread note, until you send or resume. replay() writes one audit
//              line `service-cut-off` for it, once (later restarts carry the pause over).
//   its gate              the briefs already answered (lib/gate.js answeredBriefs)
//   its status-check count the status.json tries since the last valid write (lib/driver.js), so a
//              restart doesn't hand the Foreman three fresh tries
// then it writes one audit line `service-start` ({ pid, resumes, paused }).
//
// A job whose lock another live process holds (lib/lock.js heldElsewhere) is that process's
// business: a reply with no end isn't counted as cut off, and a clean stop's reply waits for the
// lock to be free before it carries on (the runner tries again every few seconds).

import fs from 'node:fs';
import path from 'node:path';
import { heldElsewhere } from '../lib/lock.js';
import { answeredBriefs } from '../lib/gate.js';

/** The message the Foreman gets when a reply paused by a clean stop carries on. */
export const RESTART_TEXT = 'Ground Control restarted. Carry on from where you were.';
/** The thread note for a reply cut off by a crash (or a kill): nothing carries on by itself. */
export const CRASH_NOTE = 'Ground Control stopped while the Foreman was working. Resume to carry on.';
/** The thread note in place of the carry-on message the runner sent after a clean restart. */
export const RESTART_NOTE = 'Ground Control restarted, so it told the Foreman to carry on.';
/** The audit `send` kind of that carry-on message. */
export const RESUME_KIND = 'resume-after-restart';

const isDir = (dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } };

const named = (stop, send) => (stop?.paused ?? []).find((p) => (send.runId && p.runId === send.runId) || (!p.runId && p.featureDir === send.featureDir)) ?? null;

/**
 * What one job's audit lines (oldest first, this job's only) and the service lines around them say.
 * service: every service-start and service-stop line, oldest first. Pure: no disk.
 */
export function replayJob(jobAudit, service, { session = null, held = false } = {}) {
  let lastSend = -1;
  for (let i = jobAudit.length - 1; i >= 0; i -= 1) if (jobAudit[i].action === 'send') { lastSend = i; break; }
  const send = lastSend >= 0 ? jobAudit[lastSend] : null;
  const after = send ? jobAudit.slice(lastSend + 1) : [];
  const ended = send ? after.some((e) => e.action === 'run-ended' && e.runId === send.runId) : true;
  const closedSince = after.some((e) => e.action === 'close');

  // The status-check count: the tries since the last valid write or your answer on its card.
  let statusTries = 0;
  let statusErrors = [];
  for (const e of jobAudit) {
    if (e.action === 'status_valid' || e.action === 'status_invalid_answer') { statusTries = 0; statusErrors = []; }
    else if (e.action === 'status_invalid') { if (Number.isInteger(e.attempt)) statusTries = e.attempt; statusErrors = Array.isArray(e.errors) ? e.errors : []; }
  }

  let cutOff = null;
  let stopEntry = null;
  let cutOffAt = null;
  let carried = false;
  if (send && !closedSince) {
    const at = String(send.at ?? '');
    const stopsAfter = service.filter((s) => s.action === 'service-stop' && String(s.at ?? '') >= at);
    const startedBefore = service.some((s) => s.action === 'service-start' && String(s.at ?? '') <= at);
    const crashLine = [...after].reverse().find((e) => e.action === 'service-cut-off') ?? null;
    if (crashLine) { cutOff = 'crash'; carried = true; cutOffAt = crashLine.at ?? null; }
    else if (stopsAfter.length) {
      stopEntry = named(stopsAfter.at(-1), send);
      if (stopEntry) { cutOff = 'clean'; cutOffAt = stopsAfter.at(-1).at ?? null; }
    } else if (!ended && startedBefore && !held) cutOff = 'crash';
  }

  const sessionId = stopEntry?.sessionId ?? session?.sessionId ?? send?.sessionId ?? null;
  return {
    featureDir: send?.featureDir ?? jobAudit[0]?.featureDir ?? null,
    slug: send?.slug ?? stopEntry?.slug ?? jobAudit.find((e) => e.slug)?.slug ?? null,
    sessionId,
    cwd: stopEntry?.cwd ?? session?.cwd ?? null,
    model: stopEntry?.model ?? session?.model ?? send?.model ?? null,
    runId: send?.runId ?? null,
    cutOff, cutOffAt, carried,
    gate: { answered: answeredBriefs(jobAudit) },
    statusTries, statusErrors,
  };
}

/**
 * The replay: reads the state folder, writes the `service-cut-off` lines a crash leaves and the
 * `service-start` line, and returns each open job's record (see the top of the file), by job folder.
 * isHeld(dir): another live process holds the job's lock (lib/lock.js heldElsewhere by default).
 */
export async function replay({ state, featuresDir = null, pid = process.pid, isHeld = (dir) => Boolean(heldElsewhere(dir)), write = true } = {}) {
  const audit = await state.auditAll();
  const sessions = await state.allSessions();
  const service = audit.filter((e) => e.action === 'service-start' || e.action === 'service-stop');
  const byJob = new Map();
  for (const e of audit) {
    if (!e.featureDir) continue;
    if (!byJob.has(e.featureDir)) byJob.set(e.featureDir, []);
    byJob.get(e.featureDir).push(e);
  }
  for (const dir of Object.keys(sessions)) if (!byJob.has(dir)) byJob.set(dir, []);

  const jobs = new Map();
  for (const [dir, lines] of byJob) {
    const session = sessions[dir] ?? null;
    if (session?.closed) continue; // marked done or dropped: left alone
    if (featuresDir && !isInside(dir, featuresDir)) continue;
    if (!isDir(dir)) continue; // the folder is gone
    let held = false;
    try { held = isHeld(dir); } catch { held = false; }
    const job = replayJob(lines, service, { session, held });
    job.featureDir = dir;
    if (job.cutOff === 'clean' && !job.sessionId) job.cutOff = null; // no session to carry on
    jobs.set(dir, job);
  }

  if (write) {
    const resumes = [...jobs.values()].filter((j) => j.cutOff === 'clean');
    const paused = [...jobs.values()].filter((j) => j.cutOff === 'crash');
    await state.audit({ action: 'service-start', pid, resumes: resumes.map((j) => j.slug), paused: paused.map((j) => j.slug) });
    for (const j of paused) {
      if (j.carried) continue;
      await state.audit({ action: 'service-cut-off', featureDir: j.featureDir, slug: j.slug, runId: j.runId, sessionId: j.sessionId });
      j.carried = true;
    }
  }
  return jobs;
}

/**
 * The thread with the restart's own items (lib/thread.js buildThread leaves them out or shows them
 * as yours): a `service-cut-off` line becomes the crash note, and the carry-on message the runner
 * sent by itself after a clean restart (its `resumed` line says via 'auto') becomes a note instead
 * of a message from you. A resume you asked for stays yours. Ids stay stable.
 */
export function withRestartNotes(thread, audit) {
  const auto = new Set(audit.filter((e) => e.action === 'resumed' && e.via === 'auto').map((e) => e.runId));
  const autoAt = new Set(audit.filter((e) => e.action === 'send' && e.kind === RESUME_KIND && auto.has(e.runId)).map((e) => e.at));
  const out = thread.map((it) => (it.kind === 'you' && it.sendKind === RESUME_KIND && autoAt.has(it.at)
    ? { id: it.id.replace(/^you:/, 'note:'), kind: 'note', at: it.at, text: RESTART_NOTE }
    : it));
  let added = false;
  for (const e of audit) {
    if (e.action !== 'service-cut-off') continue;
    out.push({ id: `note:cut-off:${e.runId ?? e.at}`, kind: 'note', at: e.at, text: CRASH_NOTE });
    added = true;
  }
  if (added) out.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  return out;
}

function isInside(p, dir) {
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
