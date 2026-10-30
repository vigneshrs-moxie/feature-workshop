// Pairing a laptop, once, with a one-time code (`ground-control login --site <url>`).
//   POST /api/pair/start   { name, os, deviceId, version }      the laptop asks; public
//        → { code, secret, link, expiresAt, pollEvery }        an 8-character code (no look-alike
//                                                              letters), a long secret, the link
//   GET  /api/pair/:code                                        the signed-in person sees the
//                                                              laptop's name, OS and the code
//   POST /api/pair/:code/approve                                "Pair this laptop" (same origin)
//   POST /api/pair/finish  { secret }                           the laptop polls: 202 while
//        → { token, runner, person, site }                     waiting, then its runner token once
//   POST /api/runner/logout                                     `ground-control logout`: this
//                                                              laptop's token stops working
//
// The runner token is 32 random bytes made at finish and handed over once; the site keeps its
// SHA-256 only. A code lives ten minutes and works once. A login on a laptop already paired for
// the same person (the same deviceId) rotates that laptop's token rather than adding another.
//
// ctx.auth.runner: "Authorization: Bearer <token>" → the laptop's runner, its last-seen time noted.

import crypto from 'node:crypto';
import { randomToken, sha256 } from './google.js';
import { HttpError, sendJson } from './http.js';
import { iso } from './sessions.js';

/** No 0/O, 1/I/L: a code read off one screen and checked against another. */
export const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;
export const PAIR_MINUTES = 10;
/** How long after approval the laptop may still collect its token. */
const COLLECT_MINUTES = 30;
const MAX_WAITING = 100;
/** One address may start at most this many pairings a minute (packet 2B), so nobody fills MAX_WAITING. */
export const STARTS_PER_MINUTE = 5;

/** Who is asking: the first address Vercel's proxy names (x-forwarded-for), else the connection's. */
export function callerAddress(req) {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return (fwd || String(req.headers['x-real-ip'] ?? '').trim() || req.socket?.remoteAddress || 'unknown').slice(0, 100);
}
const SEEN_EVERY = 10 * 1000;

export function newCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)];
  return out;
}
/** A code as typed or linked: spaces and dashes dropped, upper case. Null when it can't be one. */
export const normalCode = (v) => {
  const c = String(v ?? '').replace(/[\s-]/g, '').toUpperCase();
  return c.length === CODE_LENGTH && [...c].every((ch) => CODE_LETTERS.includes(ch)) ? c : null;
};

const text = (v, max, what) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new HttpError(400, `Send ${what}, at most ${max} characters.`);
  return v.trim();
};

export default function pairRoutes(ctx) {
  const { db, config, now } = ctx;

  ctx.auth.runner = async (req) => {
    const m = /^Bearer ([\w-]{20,200})$/.exec(String(req.headers.authorization ?? ''));
    const unpaired = () => new HttpError(401, 'This laptop isn’t paired with the site any more. Run ground-control login --site <the site’s address> on it.', { unpaired: true });
    if (!m) throw unpaired();
    const row = (await db.query('SELECT id, person_id, name, os, last_seen_at FROM runners WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(m[1])])).rows[0];
    if (!row) throw unpaired();
    const t = now();
    if (!row.last_seen_at || t - new Date(row.last_seen_at).getTime() > SEEN_EVERY) await db.query('UPDATE runners SET last_seen_at = $2 WHERE id = $1', [row.id, iso(t)]);
    return { id: Number(row.id), personId: Number(row.person_id), name: row.name, os: row.os };
  };

  async function pairingByCode(raw) {
    const code = normalCode(raw);
    const row = code ? (await db.query('SELECT * FROM pairings WHERE code = $1', [code])).rows[0] : null;
    if (!row) throw new HttpError(404, 'There is no pairing with that code. Check the code the laptop shows, or run ground-control login on it again.');
    return row;
  }
  const stateOf = (p, t = now()) => (p.finished_at ? 'paired' : p.approved_by ? 'approved' : new Date(p.expires_at).getTime() <= t ? 'expired' : 'waiting');

  return [
    {
      method: 'POST', path: '/api/pair/start', auth: 'public',
      async run({ req, res }) {
        const b = await ctx.readJson(req, { max: 4096 });
        const name = text(b.name, 100, 'the laptop’s name');
        const os = text(b.os, 60, 'the laptop’s operating system');
        const version = typeof b.version === 'string' ? b.version.slice(0, 40) : '';
        if (typeof b.deviceId !== 'string' || !/^[\w-]{8,64}$/.test(b.deviceId)) throw new HttpError(400, 'Send the laptop’s device id.');
        const t = now();
        const address = sha256(callerAddress(req));
        await db.query('DELETE FROM pair_starts WHERE at < $1', [iso(t - PAIR_MINUTES * 60 * 1000)]);
        const recent = (await db.query('SELECT count(*)::int AS n FROM pair_starts WHERE address_hash = $1 AND at > $2', [address, iso(t - 60 * 1000)])).rows[0].n;
        if (recent >= STARTS_PER_MINUTE) throw new HttpError(429, 'Too many pairings from here in the last minute. Wait a minute, then run ground-control login again.');
        await db.query('INSERT INTO pair_starts (address_hash, at) VALUES ($1, $2)', [address, iso(t)]);
        await db.query('DELETE FROM pairings WHERE expires_at < $1 AND finished_at IS NULL', [iso(t - 24 * 60 * 60 * 1000)]);
        const waiting = (await db.query('SELECT count(*)::int AS n FROM pairings WHERE expires_at > $1 AND finished_at IS NULL', [iso(t)])).rows[0].n;
        if (waiting >= MAX_WAITING) throw new HttpError(429, 'Too many laptops are waiting to pair right now. Try again in ten minutes.');
        const secret = randomToken(32);
        for (let tries = 0; ; tries++) {
          const code = newCode();
          try {
            await db.query(
              'INSERT INTO pairings (code, secret_hash, device_id, name, os, version, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
              [code, sha256(secret), b.deviceId, name, os, version, iso(t), iso(t + PAIR_MINUTES * 60 * 1000)],
            );
            return sendJson(res, 200, { code, secret, link: `${config.siteUrl}/#/pair/${code}`, expiresAt: iso(t + PAIR_MINUTES * 60 * 1000), pollEvery: 2 });
          } catch (err) {
            if (tries < 4 && /duplicate|unique/i.test(String(err.message))) continue;
            throw err;
          }
        }
      },
    },
    {
      method: 'POST', path: '/api/pair/finish', auth: 'public',
      async run({ req, res }) {
        const b = await ctx.readJson(req, { max: 4096 });
        if (typeof b.secret !== 'string' || b.secret.length > 200) throw new HttpError(400, 'Send the pairing’s secret.');
        const t = now();
        const out = await db.tx(async (q) => {
          const p = (await q.query('SELECT * FROM pairings WHERE secret_hash = $1 FOR UPDATE', [sha256(b.secret)])).rows[0];
          if (!p) throw new HttpError(404, 'The site doesn’t know this pairing. Run ground-control login again.');
          if (p.finished_at) throw new HttpError(410, 'This pairing was used already. Run ground-control login again.', { used: true });
          if (!p.approved_by) {
            if (new Date(p.expires_at).getTime() <= t) throw new HttpError(410, 'Nobody paired this laptop within ten minutes, so the code has run out. Run ground-control login again.', { expired: true });
            return null;
          }
          if (t - new Date(p.created_at).getTime() > COLLECT_MINUTES * 60 * 1000) throw new HttpError(410, 'This pairing ran out before the laptop collected it. Run ground-control login again.', { expired: true });
          const token = randomToken(32);
          const existing = (await q.query('SELECT id FROM runners WHERE person_id = $1 AND device_id = $2 AND revoked_at IS NULL', [p.approved_by, p.device_id])).rows[0];
          let runnerId;
          if (existing) {
            runnerId = Number(existing.id);
            await q.query('UPDATE runners SET token_hash = $2, name = $3, os = $4, version = $5, paired_at = $6 WHERE id = $1', [runnerId, sha256(token), p.name, p.os, p.version, iso(t)]);
          } else {
            runnerId = Number((await q.query(
              'INSERT INTO runners (person_id, device_id, name, os, version, token_hash, paired_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
              [p.approved_by, p.device_id, p.name, p.os, p.version, sha256(token), iso(t)],
            )).rows[0].id);
          }
          await q.query('UPDATE pairings SET finished_at = $2, runner_id = $3 WHERE id = $1', [p.id, iso(t), runnerId]);
          const person = (await q.query('SELECT id, email, name, role FROM people WHERE id = $1', [p.approved_by])).rows[0];
          return { token, runner: { id: runnerId, name: p.name, os: p.os, rotated: Boolean(existing) }, person: ctx.personView({ id: Number(person.id), email: person.email, name: person.name, role: person.role }), site: config.siteUrl };
        });
        if (!out) return sendJson(res, 202, { waiting: true });
        sendJson(res, 200, out);
      },
    },
    {
      method: 'GET', path: /^\/api\/pair\/([A-Za-z0-9-]{1,20})$/, auth: 'session',
      async run({ res, m }) {
        const p = await pairingByCode(m[1]);
        sendJson(res, 200, { code: p.code, name: p.name, os: p.os, state: stateOf(p), expiresAt: new Date(p.expires_at).toISOString() });
      },
    },
    {
      method: 'POST', path: /^\/api\/pair\/([A-Za-z0-9-]{1,20})\/approve$/, auth: 'session',
      async run({ req, res, m, person }) {
        await ctx.readJson(req);
        const p = await pairingByCode(m[1]);
        const state = stateOf(p);
        if (state === 'expired') throw new HttpError(410, 'This code has run out (codes last ten minutes). Run ground-control login on the laptop again.');
        if (state === 'paired') throw new HttpError(410, 'This code was used already. Run ground-control login on the laptop again.');
        if (state === 'approved' && Number(p.approved_by) !== person.id) throw new HttpError(409, 'Someone else paired this laptop already.');
        await db.query('UPDATE pairings SET approved_by = $2, approved_at = $3 WHERE id = $1 AND approved_by IS NULL', [p.id, person.id, iso(now())]);
        sendJson(res, 200, { code: p.code, name: p.name, os: p.os, state: 'approved' });
      },
    },
    {
      method: 'POST', path: '/api/runner/logout', auth: 'runner',
      async run({ req, res, runner }) {
        await ctx.readJson(req);
        await ctx.removeRunner(runner.id);
        sendJson(res, 200, { ok: true });
      },
    },
  ];
}
