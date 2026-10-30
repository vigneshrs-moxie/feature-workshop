// Settings → People.
//   GET  /api/people              everyone who has signed in, with their role (any signed-in person)
//   POST /api/people/:id/role     { role: 'manager' | 'member' }  the owner only
// The owner's own role isn't changed here, and nobody else can be made owner: there is one, the
// first sign-in with OWNER_EMAIL. Roles change nothing about whose jobs anyone sees.

import { HttpError, sendJson } from './http.js';

const ROLES = ['manager', 'member'];

export default function peopleRoutes(ctx) {
  const { db } = ctx;
  async function list(meId) {
    const { rows } = await db.query('SELECT id, email, name, role, last_sign_in_at FROM people ORDER BY (role = \'owner\') DESC, lower(name), email');
    return rows.map((r) => ({ ...ctx.personView({ id: Number(r.id), email: r.email, name: r.name, role: r.role }), lastSignInAt: r.last_sign_in_at ? new Date(r.last_sign_in_at).toISOString() : null, you: Number(r.id) === meId }));
  }
  return [
    {
      method: 'GET', path: '/api/people', auth: 'session',
      async run({ res, person }) { sendJson(res, 200, { people: await list(person.id), you: ctx.personView(person) }); },
    },
    {
      method: 'POST', path: /^\/api\/people\/(\d{1,15})\/role$/, auth: 'owner',
      async run({ req, res, m, person }) {
        const body = await ctx.readJson(req);
        if (!ROLES.includes(body.role)) throw new HttpError(400, 'A role is “manager” or “member”.');
        const id = Number(m[1]);
        if (id === person.id) throw new HttpError(400, 'You are the owner; your own role stays as it is.');
        const r = await db.query("UPDATE people SET role = $2 WHERE id = $1 AND role <> 'owner' RETURNING id", [id, body.role]);
        if (!r.rows.length) throw new HttpError(404, 'There is nobody like that to change.');
        sendJson(res, 200, { people: await list(person.id) });
      },
    },
  ];
}
