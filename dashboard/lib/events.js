// Live updates for the new UI (/api/events?v=2), alongside the old stream which stays as it is.
//
// Every event is an envelope { v: 2, type, job, data, seq }:
//   type  what happened ('run', 'permission', 'permission-gone', 'thread', 'usage', 'change', ...)
//   job   the job's slug when the event is about one job, else null
//   seq   a number that only goes up while the dashboard runs
//
// The last 500 events (apart from live-only ones, see emit) are kept so a page that lost its
// connection can catch up: it reconnects with Last-Event-ID (the browser does this by itself) or
// ?since=<seq>. Each SSE id is
// "<epoch>.<seq>", where epoch is random per dashboard start, so a page that last talked to an
// earlier run of the dashboard is told to start over instead of being given the wrong events.
// When catching up isn't possible (too far behind, or another epoch) the page gets one 'resync'
// event: fetch /api/snapshot again, then carry on from its seq.

import { randomBytes } from 'node:crypto';

export const RING_SIZE = 500;

export class EventLog {
  constructor({ size = RING_SIZE, epoch = randomBytes(4).toString('hex') } = {}) {
    this.size = size;
    this.epoch = epoch;
    this.seq = 0; // the seq of the newest event (0: none yet)
    this.ring = [];
    this.dropped = 0; // the seq of the newest event pushed out of the ring (0: none yet)
    this.subscribers = new Set();
  }

  /**
   * Record an event and pass it to every open stream. Returns the envelope.
   * replay: false sends it to open streams only, without keeping it for catching up. For chatty
   * events that are no use later (output lines from a local dev server): they would push the
   * events that matter out of the ring. A page that was away simply misses them.
   */
  emit(type, job = null, data = {}, { replay = true } = {}) {
    const event = { v: 2, type, job: job ?? null, data: data ?? {}, seq: ++this.seq };
    if (replay) {
      this.ring.push(event);
      if (this.ring.length > this.size) this.dropped = this.ring.shift().seq;
    }
    for (const fn of this.subscribers) {
      try { fn(event); } catch { /* one broken stream doesn't stop the others */ }
    }
    return event;
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /**
   * The events after `since`. { events } when they can all be given, or { resync: reason } when
   * the page must fetch a fresh snapshot. epoch: the epoch the page's seq came from (null: this one).
   */
  since(since, epoch = null) {
    if (epoch && epoch !== this.epoch) return { resync: 'restarted' };
    if (!Number.isInteger(since) || since < 0) return { resync: 'unknown' };
    if (since > this.seq) return { resync: 'restarted' };
    // Behind only if an event it hasn't seen was pushed out of the ring (live-only events don't count).
    if (since < this.dropped) return { resync: 'too-far-behind' };
    return { events: this.ring.filter((e) => e.seq > since) };
  }

  /** The SSE id of an event (or of the newest one). */
  id(seq = this.seq) { return `${this.epoch}.${seq}`; }
}

/**
 * Where a reconnecting page wants to carry on from: the Last-Event-ID header ("<epoch>.<seq>")
 * wins over ?since=<seq>[&epoch=<epoch>]. Returns null for a fresh connection.
 */
export function resumePoint(headers = {}, searchParams = new URLSearchParams()) {
  const parse = (s) => (/^\d{1,15}$/.test(s) ? Number(s) : -1);
  const last = String(headers['last-event-id'] ?? '').trim();
  if (last) {
    const m = /^([0-9a-f]{1,32})\.(\d{1,15})$/.exec(last);
    return m ? { since: Number(m[2]), epoch: m[1] } : { since: -1, epoch: null };
  }
  const since = searchParams.get('since');
  if (since === null || since === '') return null;
  const epoch = searchParams.get('epoch');
  return { since: parse(since), epoch: epoch && /^[0-9a-f]{1,32}$/.test(epoch) ? epoch : null };
}

export function sseFrame(log, event) {
  return `id: ${log.id(event.seq)}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Open a v2 stream on res. Catching up and subscribing happen in the same tick, so no event
 * falls in between. Returns a function that closes the subscription (also run when the response closes).
 */
export function openStream(_req, res, { log, headers = {}, resume = null, pingMs = 25000 }) {
  res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  if (resume) {
    const back = log.since(resume.since, resume.epoch);
    if (back.resync) {
      // Not stored in the ring: it's only for this page. Its id lets the next reconnect carry on from now.
      const event = { v: 2, type: 'resync', job: null, data: { reason: back.resync, epoch: log.epoch }, seq: log.seq };
      res.write(sseFrame(log, event));
    } else {
      for (const e of back.events) res.write(sseFrame(log, e));
    }
  }
  const unsubscribe = log.subscribe((e) => res.write(sseFrame(log, e)));
  const ping = setInterval(() => res.write(': ping\n\n'), pingMs);
  ping.unref?.();
  const close = () => { clearInterval(ping); unsubscribe(); };
  res.on?.('close', close); // the page went away (or the dashboard is closing)
  return close;
}
