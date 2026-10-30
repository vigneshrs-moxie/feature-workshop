// The first mirror: my jobs (packet 2A step 5).
//   GET /api/jobs        { laptops: [{ id, name, os, online, lastSeenAt, jobs: [...] }] }: every
//                        one of my laptops with its open jobs. Never anyone else's.
//   GET /api/jobs/:id    one of my jobs; another person's (or a guessed id) is a 404, the same as
//                        one that isn't there.
// The runner's job-list replaces its rows; a status event updates one (site/routes-runner.js
// applies them, after the "never carries" check). A removed laptop's rows go with it.

import { HttpError, sendJson } from './http.js';
import { iso } from './sessions.js';

const SLUG = (v) => typeof v === 'string' && v.length > 0 && v.length <= 300 && !/[/\\\0]/.test(v) && v !== '.' && v !== '..';
const str = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null);
const when = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

/** A row as the runner sent it (runner/site-link.js jobRow), cut to size; null when it can't be one. */
function rowOf(r) {
  if (!r || typeof r !== 'object' || !SLUG(r.slug)) return null;
  return {
    slug: r.slug, title: str(r.title, 200) ?? r.slug, ticket: str(r.ticket, 40), stage: str(r.stage, 40),
    state: str(r.state, 40), stateWords: str(r.stateWords, 120), now: str(r.now, 300), updatedAt: when(r.updatedAt),
  };
}

export const jobView = (j) => ({
  id: Number(j.id), laptopId: Number(j.runner_id), slug: j.slug, title: j.title, ticket: j.ticket_key, stage: j.stage,
  state: j.state, stateWords: j.state_words, now: j.now_line, updatedAt: j.updated_at ? new Date(j.updated_at).toISOString() : null,
});

export default function jobRoutes(ctx) {
  const { db, now } = ctx;
  ctx.onRunnerRemoved = [...(ctx.onRunnerRemoved ?? []), 'DELETE FROM jobs WHERE runner_id = $1'];

  async function upsert(q, runner, row, t) {
    await q.query(
      `INSERT INTO jobs (runner_id, person_id, slug, title, ticket_key, stage, state, state_words, now_line, updated_at, mirrored_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (runner_id, slug) DO UPDATE SET title = EXCLUDED.title, ticket_key = EXCLUDED.ticket_key, stage = EXCLUDED.stage,
         state = EXCLUDED.state, state_words = EXCLUDED.state_words, now_line = EXCLUDED.now_line, updated_at = EXCLUDED.updated_at, mirrored_at = EXCLUDED.mirrored_at`,
      [runner.id, runner.personId, row.slug, row.title, row.ticket, row.stage, row.state, row.stateWords, row.now, row.updatedAt, t],
    );
  }

  ctx.applyEvent ??= {};
  ctx.applyEvent['job-list'] = async (runner, e) => {
    const rows = (Array.isArray(e.data.jobs) ? e.data.jobs : []).map(rowOf).filter(Boolean).slice(0, 1000);
    const t = iso(now());
    await db.tx(async (q) => {
      await q.query('DELETE FROM jobs WHERE runner_id = $1 AND NOT (slug = ANY($2::text[]))', [runner.id, rows.map((r) => r.slug)]);
      for (const r of rows) await upsert(q, runner, r, t);
    });
  };
  ctx.applyEvent.status = async (runner, e) => {
    const row = rowOf({ ...e.data, slug: e.job ?? e.data.slug });
    if (row) await db.tx((q) => upsert(q, runner, row, iso(now())));
  };

  return [
    {
      method: 'GET', path: '/api/jobs', auth: 'session',
      async run({ res, person }) {
        const laptops = await ctx.laptopsOf(person.id);
        const { rows } = await db.query(
          `SELECT j.* FROM jobs j JOIN runners r ON r.id = j.runner_id
            WHERE j.person_id = $1 AND r.person_id = $1 AND r.revoked_at IS NULL
            ORDER BY j.updated_at DESC NULLS LAST, j.id`,
          [person.id],
        );
        const byLaptop = new Map(laptops.map((l) => [l.id, { ...l, jobs: [] }]));
        for (const j of rows) byLaptop.get(Number(j.runner_id))?.jobs.push(jobView(j));
        sendJson(res, 200, { laptops: [...byLaptop.values()] });
      },
    },
    {
      method: 'GET', path: /^\/api\/jobs\/(\d{1,15})$/, auth: 'session',
      async run({ res, m, person }) {
        const j = (await db.query(
          'SELECT j.* FROM jobs j JOIN runners r ON r.id = j.runner_id WHERE j.id = $1 AND j.person_id = $2 AND r.person_id = $2 AND r.revoked_at IS NULL',
          [Number(m[1]), person.id],
        )).rows[0];
        if (!j) throw new HttpError(404, 'There is no job like that among yours.');
        sendJson(res, 200, { job: jobView(j) });
      },
    },
  ];
}
