// What the runner does when Auto's database couldn't be made for an Auto job's recording because of
// one of the job's migrations (runner/evidence.js onAutoDbProblem):
//   'migration'   the migration failed: the job's Foreman is sent autoMigrationMessage(err) as
//                 Starbase's own message (kind 'auto-migration', lib/auto.js OWN_SENDS), the way the
//                 status-fix send goes (lib/driver.js): now when no reply runs, else once that reply
//                 ends well (not after a stop, an error or a usage limit). Not while Auto is off for
//                 the job, and not while Auto is stopped on it (the job is his then): asked when
//                 the problem comes and again just before the reply would start.
//                 Not sent: one `auto_migration_not_sent` audit line saying why.
//   'not-landed'  the migration ended well but isn't in Auto's copy, so it may have run on his
//                 database: Auto stops on the job (its own stop path) with AUTO_NOT_LANDED_STOP.
//                 When that stop writes nothing (Auto already stopped on the job, or switched off
//                 during the recording), he is still told: a Needs you notice with that sentence.
//                 Nothing is sent to the Foreman.
// Any other code: nothing. The answer is { sent: true } (or { stopped: true }), or { sent: false }
// (a later recording of the same commit may try again).
//
//   autoDbProblems({ driver, state, autoOn, autoStopped, stopAuto, notify })
//     driver     lib/driver.js's Driver (activeRunFor, feedbackSession, start, its 'run' events)
//     state      audit()
//     autoOn(f)  whether Auto is on for the job now
//     autoStopped(f)  whether Auto is stopped on the job now (autoQuestions gives the runner both)
//     stopAuto(f, reason)  Auto's stop on the job (runner/auto.js stopWith): true when it wrote the stop
//     notify(n)  a notice to him ({ level, title, body, slug, key }), as Auto's own

import { Busy } from '../lib/driver.js';
import { AUTO_NOT_LANDED_STOP, autoMigrationMessage } from './evidence.js';

const ACTIVE = new Set(['starting', 'running', 'waiting_permission', 'stopping']); // lib/driver.js's

/**
 * The two questions about a job's Auto, read from the job's saved session (sessionFor(dir): lib/state.js): is it on,
 * and is it stopped on the job. For the runner, which hands both to autoDbProblems.
 */
export const autoQuestions = (sessionFor) => ({
  autoOn: async (f) => (await sessionFor(f.dir))?.auto?.on === true,
  autoStopped: async (f) => Boolean((await sessionFor(f.dir))?.auto?.stopped),
});

export function autoDbProblems({ driver, state, autoOn = async () => true, autoStopped = async () => false, stopAuto = async () => false, notify = () => {} }) {
  const notSent = async (f, err, reason) => {
    await state.audit({ action: 'auto_migration_not_sent', featureDir: f.dir, slug: f.slug, migration: err.migration, reason: String(reason?.message ?? reason).slice(0, 300) });
    return { sent: false };
  };
  // Why the message may not go now, or null: Auto is off for the job, or on but stopped on it.
  const held = async (f) => (!(await autoOn(f)) ? 'Auto is off for this job.' : (await autoStopped(f)) ? 'Auto is stopped on this job.' : null);

  async function send(f, err) {
    const why = await held(f);
    if (why) return notSent(f, err, why);
    const active = driver.activeRunFor({ featureDir: f.dir });
    if (active) {
      return new Promise((resolve) => {
        const ended = (run) => {
          if (run.id !== active.id || ACTIVE.has(run.status)) return;
          driver.off('run', ended);
          resolve(run.status === 'done' ? send(f, err) : notSent(f, err, `The Foreman’s reply ended ${run.status} first.`));
        };
        driver.on('run', ended);
      });
    }
    const s = await driver.feedbackSession(f.dir);
    if (s?.refused || !s?.sessionId) return notSent(f, err, s?.refused ?? 'No Foreman session here.');
    // Asked again just before the reply would start: Auto may have stopped, or gone off, since the first look.
    const late = await held(f);
    if (late) return notSent(f, err, late);
    try {
      await driver.start({ featureDir: f.dir, slug: s.slug, title: s.title, cwd: s.cwd, sessionId: s.sessionId, model: s.model, text: autoMigrationMessage(err), kind: 'auto-migration', additionalDirectories: s.additionalDirectories });
      return { sent: true };
    } catch (e) {
      // A reply began meanwhile: it goes once that one ends.
      if (e instanceof Busy && driver.activeRunFor({ featureDir: f.dir })) return send(f, err);
      return notSent(f, err, e);
    }
  }

  return async function onAutoDbProblem(f, err) {
    if (err?.code === 'not-landed') {
      const wrote = await stopAuto(f, AUTO_NOT_LANDED_STOP);
      // The alarm is never lost: with no stop written, the notice still goes.
      if (!wrote) notify({ level: 'needs', title: f.title, body: AUTO_NOT_LANDED_STOP, slug: f.slug, key: `auto-not-landed:${f.slug}:${new Date().toISOString()}` });
      return { stopped: true };
    }
    if (err?.code !== 'migration') return null;
    return send(f, err);
  };
}
