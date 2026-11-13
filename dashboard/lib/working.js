// Whether a job's work is still going on: one rule for the board card and the job detail (runner
// boardCard, jobDetail, stillRunning) and the job page's state word (lib/job-payload.js stateOf).
// Only what Starbase itself knows decides it: an active run of this Starbase's driver, the job's
// pauses, its last recorded run end, when this Starbase started and the job's lock. No process scan
// and no disk here, so it is cheap on every snapshot.
//
//   A paused job (by a restart or the usage limit) is never working: nothing of it runs.
//   A crew row works only with a live process behind it: an active run, or another live process
//   holding the job's lock (a terminal). Without either:
//   - on a job Starbase ran (a run end on record), a row that stopped before that end ended with it,
//     and a row from before this Starbase started ended when the last Starbase stopped (its runs
//     die with it, and a crash records no end);
//   - any row silent for STALE_WORKER_MS counts as stopped. A job run only in a terminal records no
//     end, so its recent rows count while they are recent, from before the start or not.

/** A log that stops mid-task never shows its end: after this much silence, with no live process behind it, it counts as stopped. */
export const STALE_WORKER_MS = 30 * 60_000;

/**
 * Whether a crew row still has a live process behind it. Pure.
 * row: { state ('running' | 'finished' | 'stopped'), lastAt (ISO) }
 * job: { active: an active run of this job (this Starbase's driver), paused: by a restart or the usage limit,
 *        endedAt: the job's last run-ended time (ISO) or null, startedAt: when this Starbase started (ISO),
 *        locked: another live process holds the job's lock (a boolean, or a function asked only when it decides) }
 */
export function rowWorking(row, job = {}, now = Date.now()) {
  if (row?.state !== 'running') return false;
  if (job.active) return true;
  if (job.paused) return false;
  let lock;
  const locked = () => (lock ??= Boolean(typeof job.locked === 'function' ? job.locked() : job.locked));
  const at = Date.parse(row.lastAt ?? '');
  if (job.endedAt && Number.isFinite(at)) {
    if (at <= Date.parse(job.endedAt)) return false;
    if (at < Date.parse(job.startedAt ?? '') && !locked()) return false;
  }
  if (Number.isFinite(at) && now - at < STALE_WORKER_MS) return true;
  return locked();
}

/** Whether a job is working: an active run, or a crew row still working (rowWorking); a paused job never is. */
export function jobWorking({ active = false, paused = false, working = false } = {}) {
  return Boolean(active) || (!paused && Boolean(working));
}

/** Whether a board card (runner boardCard) says its job is paused: a stopped reply, the usage limit or a restart. */
export function cardPaused(card) {
  return Boolean(card?.paused || card?.limitPaused || card?.restartPaused);
}
