// The link, the site's half (plan §2.4, G34): HTTPS from the runner, no WebSocket.
//   POST /api/runner/events                 { events: [...] }, at most 256 KB: each checked again
//        → { accepted, refused: [{ eid, error }] }   (site/events.js), stored, then applied (the
//                                                    job mirror, step 5)
//   GET  /api/runner/commands?wait=25       the long-poll: held until a command is queued for this
//        → { commands: [{ id, command }] }  runner, or up to 25 seconds, then an empty list
//   POST /api/runner/commands/:id/result    { ok, error?, stale?, sealed? } the runner's answer:
//                                           stale (packet 2B) when the job moved on and nothing ran;
//                                           sealed, a live answer sealed to the asking request's key
// Every call needs the runner's token (ctx.auth.runner), which also marks the laptop seen: a
// runner always has a long-poll open, so it is seen at least every 25 seconds while it runs.
//
// ctx.queueCommand(runnerId, command, { by, madeOn, byName, answerKey }) is how the site gives a
// runner something to do (madeOn, byName and answerKey, packet 2B, travel beside the command):
// only a REMOTE_COMMANDS command passes (lib/protocol.js parseCommand, from: 'site'); it is
// checked again as it is handed out. Delivery is at least once: a command handed out and not
// answered within 30 seconds is handed out again, and the runner skips ids it has done.
// A waiting long-poll is woken at once by a command queued in the same instance; another
// instance's is found within a second (the poll below), since Fluid compute may run several.

import { EventEmitter } from 'node:events';
import { parseCommand } from '../../dashboard/lib/protocol.js';
import { randomToken } from './google.js';
import { HttpError, sendJson } from './http.js';
import { checkStoredEvent } from './events.js';
import { iso } from './sessions.js';

export const MAX_WAIT_S = 25;
export const BATCH_BYTES = 256 * 1024;
export const REDELIVER_MS = 30 * 1000;
/** A command's answer may carry a sealed live answer (a diff): at most this much (Vercel's body limit is 4.5 MB). */
export const RESULT_BYTES = 4 * 1024 * 1024;
const POLL_MS = 1000;
const EVENT_DAYS = 7;

export default function runnerRoutes(ctx) {
  const { db, now } = ctx;
  const timers = ctx.timers;
  const wakes = new EventEmitter();
  wakes.setMaxListeners(0);
  let closing = false;
  ctx.onClose(() => { closing = true; wakes.emit('close'); });
  /** Waits up to ms for command id's sealed answer to arrive in this instance (another's is found by polling). */
  ctx.answerArrived = (id, ms) => new Promise((resolve) => {
    const done = () => { wakes.off(`a${id}`, done); wakes.off('close', done); resolve(); };
    wakes.once(`a${id}`, done);
    wakes.once('close', done);
    timers.sleep(ms).then(done);
  });
  ctx.onRunnerRemoved = [...(ctx.onRunnerRemoved ?? []), 'DELETE FROM commands WHERE runner_id = $1 AND done_at IS NULL'];
  /** What each applied event does on the site (the mirror adds to it). */
  ctx.applyEvent ??= {};
  // hello: the runner's version and OS as it is now (the name stays the one it was paired with).
  ctx.applyEvent.hello = async (runner, e) => {
    const version = typeof e.data.version === 'string' ? e.data.version.slice(0, 40) : '';
    const os = typeof e.data.os === 'string' && e.data.os.trim() ? e.data.os.trim().slice(0, 60) : runner.os;
    await db.query('UPDATE runners SET version = $2, os = $3 WHERE id = $1', [runner.id, version, os]);
  };

  ctx.queueCommand = async (runnerId, raw, { by = null, madeOn = null, byName = null, answerKey = null } = {}) => {
    const parsed = parseCommand(raw, { from: 'site' });
    if (!parsed.ok) throw new HttpError(400, parsed.error, { code: 'bad-command' });
    const id = `c_${randomToken(16)}`;
    await db.query(
      'INSERT INTO commands (id, runner_id, command, queued_by, created_at, made_on, by_name, answer_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, runnerId, JSON.stringify(parsed.command), by, iso(now()), madeOn ? JSON.stringify(madeOn) : null, byName, answerKey],
    );
    wakes.emit(`r${runnerId}`);
    return id;
  };

  /** The commands to hand out now, marked handed out. */
  async function take(runnerId) {
    const t = now();
    return db.tx(async (q) => {
      const { rows } = await q.query(
        `SELECT id, command, made_on, by_name, answer_key FROM commands
          WHERE runner_id = $1 AND done_at IS NULL AND (delivered_at IS NULL OR delivered_at < $2)
          ORDER BY created_at, id LIMIT 20 FOR UPDATE SKIP LOCKED`,
        [runnerId, iso(t - REDELIVER_MS)],
      );
      const out = [];
      for (const r of rows) {
        const command = typeof r.command === 'string' ? JSON.parse(r.command) : r.command;
        const again = parseCommand(command, { from: 'site' });
        if (!again.ok) {
          // Never handed out: it isn't on the list (it can only have been written around queueCommand).
          await q.query('UPDATE commands SET done_at = $2, ok = false, error = $3 WHERE id = $1', [r.id, iso(t), `Not sent: ${again.error}`]);
          continue;
        }
        await q.query('UPDATE commands SET delivered_at = $2, deliveries = deliveries + 1 WHERE id = $1', [r.id, iso(t)]);
        const madeOn = typeof r.made_on === 'string' ? JSON.parse(r.made_on) : r.made_on;
        out.push({ id: r.id, command: again.command, ...(madeOn ? { madeOn } : {}), ...(r.by_name ? { by: { name: r.by_name } } : {}), ...(r.answer_key ? { answerKey: r.answer_key } : {}) });
      }
      return out;
    });
  }

  /** Waits up to ms, or until a command is queued for this runner here, or the request goes. */
  function pause(runnerId, ms, req) {
    return new Promise((resolve) => {
      const done = () => { wakes.off(`r${runnerId}`, done); wakes.off('close', done); req.off?.('close', done); resolve(); };
      wakes.once(`r${runnerId}`, done);
      wakes.once('close', done);
      req.once?.('close', done);
      timers.sleep(ms).then(done);
    });
  }

  return [
    {
      method: 'GET', path: '/api/runner/commands', auth: 'runner',
      async run({ req, res, url, runner }) {
        const asked = Number(url.searchParams.get('wait') ?? MAX_WAIT_S);
        const waitMs = Math.max(0, Math.min(MAX_WAIT_S, Number.isFinite(asked) ? asked : MAX_WAIT_S)) * 1000;
        const until = timers.now() + waitMs;
        let gone = false;
        req.once?.('close', () => { gone = true; });
        for (;;) {
          const commands = await take(runner.id);
          if (commands.length) return sendJson(res, 200, { commands });
          const left = until - timers.now();
          if (left <= 0 || gone || closing) return sendJson(res, 200, { commands: [] });
          await pause(runner.id, Math.min(POLL_MS, left), req);
          // A runner that hung up takes nothing: what it would miss stays queued for its next call.
          if (gone || closing) return sendJson(res, 200, { commands: [] });
        }
      },
    },
    {
      method: 'POST', path: /^\/api\/runner\/commands\/(c_[\w-]{10,40})\/result$/, auth: 'runner',
      async run({ req, res, m, runner }) {
        const b = await ctx.readJson(req, { max: RESULT_BYTES });
        if (typeof b.ok !== 'boolean') throw new HttpError(400, 'Say whether the command worked (ok).');
        const error = typeof b.error === 'string' ? b.error.slice(0, 2000) : null;
        const r = await db.query('UPDATE commands SET done_at = COALESCE(done_at, $3), ok = COALESCE(ok, $4), error = COALESCE(error, $5) WHERE id = $1 AND runner_id = $2 RETURNING id, answer_key', [m[1], runner.id, iso(now()), b.ok, error]);
        if (!r.rows.length) throw new HttpError(404, 'There is no command like that for this laptop.');
        // A live answer: kept sealed only until the request that asked collects it (packet 2B).
        if (r.rows[0].answer_key && b.sealed && typeof b.sealed === 'object') {
          await db.query('INSERT INTO command_answers (command_id, sealed, at) VALUES ($1, $2, $3) ON CONFLICT (command_id) DO NOTHING', [m[1], JSON.stringify(b.sealed), iso(now())]);
          wakes.emit(`a${m[1]}`);
        }
        for (const fn of ctx.onCommandResult ?? []) await fn(runner, m[1], { ok: b.ok, error, stale: b.stale === true });
        sendJson(res, 200, { ok: true });
      },
    },
    {
      method: 'POST', path: '/api/runner/events', auth: 'runner',
      async run({ req, res, runner }) {
        const b = await ctx.readJson(req, { max: BATCH_BYTES });
        if (!Array.isArray(b.events)) throw new HttpError(400, 'Send { events: [...] }.');
        const refused = [];
        let accepted = 0;
        const t = iso(now());
        for (const raw of b.events) {
          const c = checkStoredEvent(raw);
          if (!c.ok) { refused.push({ eid: typeof raw?.eid === 'string' ? raw.eid.slice(0, 64) : null, error: c.error }); continue; }
          const ins = await db.query(
            'INSERT INTO events (runner_id, eid, type, job, data, received_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (runner_id, eid) DO NOTHING RETURNING id',
            [runner.id, c.event.eid, c.event.type, c.event.job, JSON.stringify(c.event.data), t],
          );
          accepted++;
          if (!ins.rows.length) continue; // sent before: stored and applied then
          const apply = ctx.applyEvent[c.event.type];
          if (apply) await apply(runner, c.event);
        }
        for (const fn of ctx.afterEvents ?? []) await fn(runner);
        await db.query('DELETE FROM events WHERE runner_id = $1 AND received_at < $2', [runner.id, iso(now() - EVENT_DAYS * 24 * 60 * 60 * 1000)]);
        sendJson(res, 200, { accepted, refused });
      },
    },
  ];
}
