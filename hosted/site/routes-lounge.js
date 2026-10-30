// The Lounge (packet 2D, decision G13): one shared page where the team sees, per person, very little.
//   GET /api/lounge   { activeMinutes, people: [{ id, name, you, presence, lastActiveAt, jobs }] }
//     name          from Google (people.name); '' when the account has none (the page says so)
//     presence      'online'  active in the last 15 minutes, with a laptop on (or on this site)
//                   'away'    a laptop is on (seen in the last minute), but nothing for 15 minutes
//                   'off'     no laptop on, and not on this site in the last 15 minutes
//     lastActiveAt  the last time something happened: one of their jobs moved, a laptop of theirs
//                   came on, they made a decision (on the laptop or here), signed in, or had this
//                   page open. Never later than now (a laptop's clock may run ahead).
//     jobs          what is running on their laptops that are on now (open, not done): each with
//                   its ticket key, title and stage, by title. Your own also carry their slug, so
//                   the page links them to the job; nobody else's is a link.
// Nothing else, on purpose (G13: to avoid surveillance): no email, no briefs, conversations, costs,
// decisions, laptop names or file names. Everyone signed in gets the same answer, whatever their
// role: a manager sees nothing extra. hosted/test/lounge.test.js lists every field, so a new one
// fails until it is decided on.
//
// Asking marks you as having the site open (lounge_seen, at most once a minute): a session's own
// last_seen_at is written only hourly, too coarse to say whether someone is around.

import { sendJson } from './http.js';
import { ONLINE_MS } from './routes-laptops.js';
import { iso } from './sessions.js';

export const ACTIVE_MS = 15 * 60 * 1000;
const SEEN_EVERY_MS = 60 * 1000;
const MAX_JOBS = 50;

const ms = (v) => (v ? new Date(v).getTime() : null);
const latest = (...ts) => ts.reduce((a, b) => (b !== null && b !== undefined && (a === null || b > a) ? b : a), null);

export default function loungeRoutes(ctx) {
  const { db, now } = ctx;

  /** Each person's latest time from one query of (person_id, at) rows, capped at t. */
  async function latestBy(sql, params, t) {
    const out = new Map();
    for (const r of (await db.query(sql, params)).rows) {
      const at = Math.min(ms(r.at), t);
      if (Number.isFinite(at)) out.set(Number(r.person_id), latest(out.get(Number(r.person_id)) ?? null, at));
    }
    return out;
  }

  async function lounge(meId) {
    const t = now();
    const people = (await db.query('SELECT id, name FROM people')).rows;
    const runners = (await db.query('SELECT id, person_id, last_seen_at FROM runners WHERE revoked_at IS NULL')).rows;
    const on = new Set(runners.filter((r) => r.last_seen_at && t - ms(r.last_seen_at) < ONLINE_MS).map((r) => Number(r.id)));
    const laptopOn = new Set(runners.filter((r) => on.has(Number(r.id))).map((r) => Number(r.person_id)));
    const jobs = (await db.query(
      `SELECT j.person_id, j.runner_id, j.slug, j.title, j.ticket_key, j.stage, j.state, j.updated_at
         FROM jobs j JOIN runners r ON r.id = j.runner_id AND r.person_id = j.person_id
        WHERE r.revoked_at IS NULL`,
    )).rows;

    // Activity from the laptops: a job moved, a laptop came on, a decision made there.
    const laptopActive = await latestBy(
      `SELECT r.person_id, s.hello_at AS at FROM record_syncs s JOIN runners r ON r.id = s.runner_id WHERE r.revoked_at IS NULL
       UNION ALL SELECT person_id, max(at) AS at FROM audit WHERE from_where = 'laptop' GROUP BY person_id`, [], t);
    for (const j of jobs) {
      const at = ms(j.updated_at);
      if (at !== null) laptopActive.set(Number(j.person_id), latest(laptopActive.get(Number(j.person_id)) ?? null, Math.min(at, t)));
    }
    // Activity on this site: signed in, had the Lounge open, a decision made here.
    const siteActive = await latestBy(
      `SELECT person_id, max(greatest(created_at, last_seen_at)) AS at FROM sessions GROUP BY person_id
       UNION ALL SELECT person_id, seen_at AS at FROM lounge_seen
       UNION ALL SELECT person_id, max(at) AS at FROM audit WHERE from_where = 'site' GROUP BY person_id`, [], t);

    const running = new Map();
    for (const j of jobs) {
      if (!on.has(Number(j.runner_id)) || j.state === 'done') continue;
      const pid = Number(j.person_id);
      if (!running.has(pid)) running.set(pid, []);
      running.get(pid).push(j);
    }

    const recent = (at) => at !== null && t - at < ACTIVE_MS;
    const rows = people.map((p) => {
      const id = Number(p.id);
      const you = id === meId;
      const fromLaptop = laptopActive.get(id) ?? null;
      const fromSite = siteActive.get(id) ?? null;
      const last = latest(fromLaptop, fromSite);
      const presence = (laptopOn.has(id) && recent(last)) || recent(fromSite) ? 'online' : laptopOn.has(id) ? 'away' : 'off';
      const mine = (running.get(id) ?? [])
        .sort((a, b) => a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug))
        .slice(0, MAX_JOBS)
        .map((j) => ({ ticket: j.ticket_key ?? null, title: j.title, stage: j.stage ?? null, ...(you ? { slug: j.slug } : {}) }));
      return { id, name: p.name ?? '', you, presence, lastActiveAt: last === null ? null : iso(last), jobs: mine };
    });
    // By name, the same order for everyone, so nobody's place moves as they come and go.
    rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id - b.id);
    return { activeMinutes: ACTIVE_MS / 60_000, people: rows };
  }

  return [
    {
      method: 'GET', path: '/api/lounge', auth: 'session',
      async run({ res, person }) {
        const t = now();
        await db.query(
          `INSERT INTO lounge_seen (person_id, seen_at) VALUES ($1, $2)
           ON CONFLICT (person_id) DO UPDATE SET seen_at = EXCLUDED.seen_at WHERE lounge_seen.seen_at < $3`,
          [person.id, iso(t), iso(t - SEEN_EVERY_MS)],
        );
        sendJson(res, 200, await lounge(person.id));
      },
    },
  ];
}
