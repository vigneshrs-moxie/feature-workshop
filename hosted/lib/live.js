// Live updates on the hosted site (packet 2B): what changed for a person, numbered, in site_events.
//
//   emit(personId, type, job)       one change: 'change' (the board: fetch the snapshot again) or
//                                   'thread' (one job's page: fetch it again). The page's store
//                                   applies them as it does the laptop's own (web/src/state/reducer.ts)
//   latest(personId)                the newest number (the snapshot carries it as seq)
//   stream(req, res, { personId, since })
//                                   GET /api/events: server-sent events, `id: <epoch>.<seq>`, from
//                                   just after `since` (or Last-Event-ID). A browser more than 500
//                                   behind, or from another numbering, gets one 'resync'.
//                                   Each stream ends by itself before Vercel's time limit for the
//                                   function (STREAM_MS, under vercel.json's 60 s), first saying
//                                   `event: bye`; the page's stream (views/Hosted/hostedStream.ts)
//                                   opens the next one from where it was, with no reconnect shown.
//   poll(personId, since)           the same, once, for the page's every-5-seconds fallback
//
// Several function instances may run at once (Fluid compute): a change made in this instance wakes
// its streams at once; one made in another is found within a second.

import { EventEmitter } from 'node:events';
import { iso } from '../site/sessions.js';

/** The hosted site's epoch (one numbering for good, kept in Postgres): hex, as the laptop's are. */
export const HOSTED_EPOCH = '2b';
export const STREAM_MS = 50 * 1000;
const POLL_MS = 1000;
const PING_MS = 15 * 1000;
const BACKLOG = 500;
const KEEP_DAYS = 7;

/** Where a browser wants to carry on from: Last-Event-ID, else ?since. null: from now. */
export function resumeFrom(req, url) {
  const last = String(req.headers['last-event-id'] ?? '').trim();
  const m = /^([0-9a-f]{1,32})\.(\d{1,15})$/.exec(last);
  if (m) return { since: Number(m[2]), epoch: m[1] };
  const since = url.searchParams.get('since');
  if (since === null || !/^\d{1,15}$/.test(since)) return null;
  return { since: Number(since), epoch: url.searchParams.get('epoch') };
}

export function liveEvents({ db, now, timers, onClose }) {
  const wakes = new EventEmitter();
  wakes.setMaxListeners(0);
  let closing = false;
  onClose?.(() => { closing = true; wakes.emit('close'); });

  const event = (r) => ({ v: 2, type: r.type, job: r.job ?? null, data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data, seq: Number(r.seq) });
  const frame = (e) => `id: ${HOSTED_EPOCH}.${e.seq}\ndata: ${JSON.stringify(e)}\n\n`;

  async function emit(personId, type, job = null, data = {}) {
    const r = await db.query('INSERT INTO site_events (person_id, type, job, data, at) VALUES ($1, $2, $3, $4, $5) RETURNING seq', [personId, type, job, JSON.stringify(data), iso(now())]);
    wakes.emit(`p${personId}`);
    return Number(r.rows[0].seq);
  }

  async function latest(personId) {
    const r = await db.query('SELECT COALESCE(max(seq), 0)::bigint AS seq FROM site_events WHERE person_id = $1', [personId]);
    return Number(r.rows[0].seq);
  }

  /** The events after `since`, or { resync } when it is too far back to catch up. */
  async function after(personId, since) {
    const { rows } = await db.query('SELECT seq, type, job, data FROM site_events WHERE person_id = $1 AND seq > $2 ORDER BY seq LIMIT $3', [personId, since, BACKLOG + 1]);
    if (rows.length > BACKLOG) return { resync: 'behind' };
    return { events: rows.map(event) };
  }

  async function prune() {
    await db.query('DELETE FROM site_events WHERE at < $1', [iso(now() - KEEP_DAYS * 24 * 60 * 60 * 1000)]);
  }

  function pause(personId, ms, req) {
    return new Promise((resolve) => {
      const done = () => { wakes.off(`p${personId}`, done); wakes.off('close', done); req.off?.('close', done); resolve(); };
      wakes.once(`p${personId}`, done);
      wakes.once('close', done);
      req.once?.('close', done);
      timers.sleep(ms).then(done);
    });
  }

  async function stream(req, res, { personId, resume, headers = {}, maxMs = STREAM_MS }) {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 1000\n\n');
    let gone = false;
    req.once?.('close', () => { gone = true; });
    let seq = resume ? resume.since : await latest(personId);
    if (resume && resume.epoch && resume.epoch !== HOSTED_EPOCH) {
      const at = await latest(personId);
      res.write(frame({ v: 2, type: 'resync', job: null, data: { reason: 'epoch', epoch: HOSTED_EPOCH }, seq: at }));
      seq = at;
    }
    const until = timers.now() + maxMs;
    let pinged = timers.now();
    while (!gone && !closing && timers.now() < until) {
      const back = await after(personId, seq);
      if (back.resync) {
        const at = await latest(personId);
        res.write(frame({ v: 2, type: 'resync', job: null, data: { reason: back.resync, epoch: HOSTED_EPOCH }, seq: at }));
        seq = at;
      } else {
        for (const e of back.events) { res.write(frame(e)); seq = e.seq; }
      }
      if (timers.now() - pinged >= PING_MS) { res.write(': ping\n\n'); pinged = timers.now(); }
      await pause(personId, Math.max(0, Math.min(POLL_MS, until - timers.now())), req);
    }
    if (!gone) res.write(`event: bye\ndata: ${JSON.stringify({ seq })}\n\n`);
    res.end();
  }

  async function poll(personId, since) {
    const back = since === null ? { events: [] } : await after(personId, since);
    const seq = await latest(personId);
    if (back.resync) return { events: [{ v: 2, type: 'resync', job: null, data: { reason: back.resync, epoch: HOSTED_EPOCH }, seq }], seq };
    return { events: back.events, seq };
  }

  return { emit, latest, after, stream, poll, prune };
}
