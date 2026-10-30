// Settings → Laptops: your paired laptops.
//   GET    /api/laptops        name, OS, when paired, last seen, and online or not (seen in the
//                              last 60 seconds: a runner calls in at least every 25)
//   DELETE /api/laptops/:id    Remove: its token stops working at once, and its jobs leave the site
// Only your own; anyone else's laptop is a 404, the same as one that isn't there.

import { HttpError, sendJson } from './http.js';
import { iso } from './sessions.js';

export const ONLINE_MS = 60 * 1000;

export default function laptopRoutes(ctx) {
  const { db, now } = ctx;

  /** A laptop leaves the site: no token, and nothing of it mirrored any more. */
  ctx.removeRunner = async (runnerId) => {
    await db.tx(async (q) => {
      await q.query('UPDATE runners SET revoked_at = $2, token_hash = NULL WHERE id = $1 AND revoked_at IS NULL', [runnerId, iso(now())]);
      for (const sql of ctx.onRunnerRemoved ?? []) await q.query(sql, [runnerId]);
    });
  };

  ctx.laptopView = (r, t = now()) => {
    const seen = r.last_seen_at ? new Date(r.last_seen_at).getTime() : null;
    return {
      id: Number(r.id), name: r.name, os: r.os, version: r.version || null,
      pairedAt: new Date(r.paired_at).toISOString(), lastSeenAt: seen ? iso(seen) : null,
      online: seen !== null && t - seen < ONLINE_MS,
    };
  };

  /** Your laptops (not removed), newest first. */
  ctx.laptopsOf = async (personId) => {
    const { rows } = await db.query('SELECT id, name, os, version, paired_at, last_seen_at FROM runners WHERE person_id = $1 AND revoked_at IS NULL ORDER BY paired_at DESC, id DESC', [personId]);
    const t = now();
    return rows.map((r) => ctx.laptopView(r, t));
  };

  return [
    {
      method: 'GET', path: '/api/laptops', auth: 'session',
      async run({ res, person }) { sendJson(res, 200, { laptops: await ctx.laptopsOf(person.id), onlineSeconds: ONLINE_MS / 1000 }); },
    },
    {
      method: 'DELETE', path: /^\/api\/laptops\/(\d{1,15})$/, auth: 'session',
      async run({ req, res, m, person }) {
        await ctx.readJson(req);
        const id = Number(m[1]);
        const mine = (await db.query('SELECT id FROM runners WHERE id = $1 AND person_id = $2 AND revoked_at IS NULL', [id, person.id])).rows[0];
        if (!mine) throw new HttpError(404, 'There is no laptop like that among yours.');
        await ctx.removeRunner(id);
        sendJson(res, 200, { laptops: await ctx.laptopsOf(person.id) });
      },
    },
  ];
}
