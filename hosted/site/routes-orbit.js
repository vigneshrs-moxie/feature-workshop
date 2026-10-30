// The Orbit inbox on the hosted site (packet 2C, decision G11). Each person's own read-only Orbit
// token is kept here, encrypted (lib/token-store.js), and the cron job reads their inbox with it
// (lib/poller.js), so tickets are waiting even while the laptop is closed. Only your own, always.
//   GET    /api/orbit/status            whether a token is saved, until when, the last read and its
//                                       problem; never the token
//   POST   /api/orbit/token  { token, expiresInDays }   checked with one call to Orbit, then kept
//   DELETE /api/orbit/token             Remove: the token and the inbox read with it
//   GET    /api/orbit/inbox[?refresh=1] the stored inbox, in the shape the laptop's Inbox reads
//                                       (dashboard/site/routes-orbit.js), with "you're already on
//                                       this" from the mirror and each ticket's Start on its way.
//                                       refresh=1 (the open Inbox, at most once a minute) reads it
//                                       from Orbit first
//   POST   /api/orbit/start  { key, laptopId? }         queues a start command for one of your
//                                       laptops (ctx.queueCommand); with more than one, laptopId
//                                       says which (409 choose-laptop otherwise)
//   DELETE /api/orbit/start/:id         cancels a Start the laptop hasn't picked up yet
// The ticket's page, its links and saved views stay with the laptop: the site's token is for the
// inbox only (plan §3.2). The Foreman still reads the ticket itself, with the laptop's own token.

import { OrbitError, canonicalKey, checkToken, scrub, scrubDeep } from '../../dashboard/lib/orbit.js';
import { CRON_EVERY_MS, REFRESH_MS, createPoller, orbitUrlOf } from '../lib/poller.js';
import { createTokenStore } from '../lib/token-store.js';
import { HttpError, sendJson } from './http.js';
import { iso } from './sessions.js';

/** A Start shows on its ticket for a day; one that worked shows until the job reaches the mirror. */
const START_SHOWN_MS = 24 * 60 * 60 * 1000;
const STARTED_SHOWN_MS = 15 * 60 * 1000;
const LIFETIMES = [7, 30, 90];
const ORBIT_STATUS = { token: 400, auth: 400, scope: 400, settings: 503, rate: 429, network: 502, http: 502 };

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

export default function orbitRoutes(ctx) {
  const { db, config, now } = ctx;
  const tokens = createTokenStore({ db, config, now });
  const poller = createPoller({
    db, tokens, config, now,
    fetch: (...args) => ctx.fetch(...args),
    clock: () => ctx.timers.now(),
    log: (line) => (ctx.log ?? console.log)(line),
  });
  /** The cron job's (site/routes-cron.js) way in. */
  ctx.orbitInbox = { tokens, poller };

  /** What this site lacks to keep tokens and read Orbit, by setting name. */
  const setup = () => [...(tokens.problem() ? ['TOKEN_KEY'] : []), ...(orbitUrlOf(config) ? [] : ['ORBIT_BASE_URL'])];

  async function status(personId) {
    const row = await tokens.row(personId);
    const t = now();
    const expired = Boolean(row?.expiresAt && Date.parse(row.expiresAt) <= t);
    const refused = Boolean(row?.refusedAt);
    const waitUntil = row?.waitUntil ? Date.parse(row.waitUntil) : 0;
    return {
      tokenPresent: Boolean(row), store: row ? 'site' : null, url: orbitUrlOf(config),
      savedAt: row?.savedAt ?? null, expiresAt: row?.expiresAt ?? null,
      // Past its date, or refused by Orbit (or the site's key changed): the Inbox's one banner.
      expired: expired || refused, refused,
      lastPoll: row?.polledAt ?? null, lastTryAt: row?.triedAt ?? null,
      lastError: expired || refused ? null : row?.error ?? null, errorKind: expired || refused ? 'auth' : row?.errorKind ?? null,
      everyMs: CRON_EVERY_MS, refreshMs: REFRESH_MS, watchers: 0, waitingMs: Math.max(0, waitUntil - t),
      setup: setup(),
    };
  }

  /** My open jobs on the mirror by ticket: ORBIT-<n> → { slug, title, state, laptop }. */
  async function jobsByTicket(personId) {
    const { rows } = await db.query(
      `SELECT j.ticket_key, j.slug, j.title, j.state, r.name AS laptop FROM jobs j JOIN runners r ON r.id = j.runner_id
        WHERE j.person_id = $1 AND r.person_id = $1 AND r.revoked_at IS NULL AND j.ticket_key IS NOT NULL
        ORDER BY j.updated_at DESC NULLS LAST, j.id`,
      [personId],
    );
    const out = new Map();
    for (const r of rows) {
      const key = canonicalKey(r.ticket_key);
      if (key && !out.has(key)) out.set(key, { slug: r.slug, title: r.title, state: r.state ?? null, laptop: r.laptop });
    }
    return out;
  }

  /** Each ticket's latest Start, as the card says it: ORBIT-<n> → { id, state, laptop, … }. */
  async function startsByTicket(personId) {
    const t = now();
    const { rows } = await db.query(
      `SELECT DISTINCT ON (s.ticket_key) s.id, s.ticket_key, s.created_at, s.command_id,
              r.id AS runner_id, r.name, r.os, r.version, r.paired_at, r.last_seen_at, r.revoked_at,
              c.delivered_at, c.done_at, c.ok, c.error
         FROM inbox_starts s JOIN runners r ON r.id = s.runner_id LEFT JOIN commands c ON c.id = s.command_id
        WHERE s.person_id = $1 AND r.person_id = $1 AND s.created_at > $2
        ORDER BY s.ticket_key, s.created_at DESC, s.id DESC`,
      [personId, iso(t - START_SHOWN_MS)],
    );
    const out = new Map();
    for (const r of rows) {
      if (r.revoked_at || !r.command_id) continue; // the laptop was removed, or the command with it
      const laptop = ctx.laptopView({ id: r.runner_id, name: r.name, os: r.os, version: r.version, paired_at: r.paired_at, last_seen_at: r.last_seen_at }, t);
      const base = { id: Number(r.id), laptop: { id: laptop.id, name: laptop.name, online: laptop.online }, at: new Date(r.created_at).toISOString() };
      if (r.done_at && r.ok) {
        if (t - new Date(r.done_at).getTime() < STARTED_SHOWN_MS) out.set(r.ticket_key, { ...base, state: 'started' });
      } else if (r.done_at) out.set(r.ticket_key, { ...base, state: 'failed', error: scrub(String(r.error ?? 'The laptop couldn’t start it.')).slice(0, 500) });
      else out.set(r.ticket_key, { ...base, state: laptop.online ? 'sending' : 'waiting', handedOut: Boolean(r.delivered_at) });
    }
    return out;
  }

  async function items(personId) {
    const [{ rows }, jobs, starts] = await Promise.all([
      db.query('SELECT item FROM orbit_inbox WHERE person_id = $1 ORDER BY number', [personId]),
      jobsByTicket(personId),
      startsByTicket(personId),
    ]);
    return rows.map((r) => {
      const item = parse(r.item);
      const job = jobs.get(item.key) ?? null;
      return { ...item, job, start: job ? null : starts.get(item.key) ?? null };
    });
  }

  async function inboxAnswer(personId) {
    return scrubDeep({ ...(await status(personId)), items: await items(personId) });
  }

  return [
    {
      method: 'GET', path: '/api/orbit/status', auth: 'session',
      async run({ res, person }) { sendJson(res, 200, scrubDeep(await status(person.id))); },
    },
    {
      method: 'POST', path: '/api/orbit/token', auth: 'session',
      async run({ req, res, person }) {
        const b = await ctx.readJson(req, { max: 4096 });
        const problem = tokens.problem();
        if (problem) throw new HttpError(503, problem.message, { setup: setup() });
        if (!orbitUrlOf(config)) throw new HttpError(503, 'ORBIT_BASE_URL isn’t set in Vercel, so the site can’t reach Orbit yet.', { setup: setup() });
        let token;
        try { token = checkToken(b.token); } catch (err) { throw new HttpError(400, err.message, { kind: 'token' }); }
        const days = LIFETIMES.includes(b.expiresInDays) ? b.expiresInDays : null;
        try { await poller.checkToken(token); } catch (err) {
          if (err instanceof OrbitError) throw new HttpError(ORBIT_STATUS[err.kind] ?? 502, err.message, { kind: err.kind });
          throw err;
        }
        await tokens.save(person.id, token, { expiresAt: days ? iso(now() + days * 86_400_000) : null });
        sendJson(res, 200, scrubDeep(await status(person.id)));
      },
    },
    {
      method: 'DELETE', path: '/api/orbit/token', auth: 'session',
      async run({ req, res, person }) {
        await ctx.readJson(req);
        await tokens.remove(person.id);
        sendJson(res, 200, scrubDeep(await status(person.id)));
      },
    },
    {
      method: 'GET', path: '/api/orbit/inbox', auth: 'session',
      async run({ res, url, person }) {
        if (url.searchParams.get('refresh') === '1') {
          const st = await status(person.id);
          if (st.tokenPresent && !st.expired && !st.setup.length) await poller.pollPerson(person.id, { gapMs: REFRESH_MS });
        }
        sendJson(res, 200, await inboxAnswer(person.id));
      },
    },
    {
      method: 'POST', path: '/api/orbit/start', auth: 'session',
      async run({ req, res, person }) {
        const b = await ctx.readJson(req, { max: 4096 });
        const key = canonicalKey(b.key);
        if (!key) throw new HttpError(400, 'That isn’t a ticket key: use ORBIT- and the number, like ORBIT-479.');
        const row = (await db.query('SELECT item FROM orbit_inbox WHERE person_id = $1 AND ticket_key = $2', [person.id, key])).rows[0];
        if (!row) throw new HttpError(404, `${key} isn’t in your inbox on the site. Read your inbox again, then press Start.`);
        const item = parse(row.item);
        const job = (await jobsByTicket(person.id)).get(key);
        if (job) throw new HttpError(409, `You’re already on this: ${job.title}.`, { code: 'already-on' });
        const pending = (await startsByTicket(person.id)).get(key);
        if (pending && (pending.state === 'sending' || pending.state === 'waiting')) {
          throw new HttpError(409, `${key} is already on its way to ${pending.laptop.name}.`, { code: 'already-starting' });
        }
        const laptops = await ctx.laptopsOf(person.id);
        if (!laptops.length) throw new HttpError(409, 'Pair a laptop first: run ground-control login --site with this site’s address on it.', { code: 'no-laptop' });
        let laptop;
        if (b.laptopId !== undefined && b.laptopId !== null) {
          laptop = laptops.find((l) => l.id === Number(b.laptopId));
          if (!laptop) throw new HttpError(404, 'There is no laptop like that among yours.');
        } else if (laptops.length === 1) laptop = laptops[0];
        else throw new HttpError(409, 'Choose which laptop starts it.', { code: 'choose-laptop', laptops });
        const title = String(item.title ?? '').replace(/\s+/g, ' ').trim();
        const command = {
          type: 'start',
          description: `${key}: ${title}`.slice(0, 600),
          ticket: { key, title: title.slice(0, 300) || null, url: typeof item.url === 'string' ? item.url : null },
          kind: item.type === 'bug' ? 'bug' : 'feature',
        };
        const commandId = await ctx.queueCommand(laptop.id, command, { by: person.id });
        await db.query('INSERT INTO inbox_starts (person_id, ticket_key, runner_id, command_id, created_at) VALUES ($1, $2, $3, $4, $5)', [person.id, key, laptop.id, commandId, iso(now())]);
        const start = (await startsByTicket(person.id)).get(key) ?? null;
        sendJson(res, 200, scrubDeep({ start, items: await items(person.id) }));
      },
    },
    {
      method: 'DELETE', path: /^\/api\/orbit\/start\/(\d{1,15})$/, auth: 'session',
      async run({ req, res, m, person }) {
        await ctx.readJson(req);
        const s = (await db.query(
          `SELECT s.id, s.command_id, c.delivered_at, c.done_at FROM inbox_starts s LEFT JOIN commands c ON c.id = s.command_id
            WHERE s.id = $1 AND s.person_id = $2`,
          [Number(m[1]), person.id],
        )).rows[0];
        if (!s) throw new HttpError(404, 'There is no Start like that among yours.');
        if (s.done_at || s.delivered_at) throw new HttpError(409, 'Your laptop has picked it up already, so it can’t be cancelled from here.', { code: 'handed-out' });
        await db.tx(async (q) => {
          // Only while it still waits: the laptop may be taking it at this very moment.
          if (s.command_id && !(await q.query('DELETE FROM commands WHERE id = $1 AND delivered_at IS NULL AND done_at IS NULL', [s.command_id])).rowCount) {
            throw new HttpError(409, 'Your laptop has picked it up already, so it can’t be cancelled from here.', { code: 'handed-out' });
          }
          await q.query('DELETE FROM inbox_starts WHERE id = $1', [s.id]);
        });
        sendJson(res, 200, scrubDeep({ items: await items(person.id) }));
      },
    },
  ];
}
