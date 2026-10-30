// Signing in with Google, and out.
//   GET  /api/auth/start?return=/#/pair/ABCD2345   off to Google (state, nonce, PKCE); `return` is
//                                                   where to land afterwards (this site's own page only)
//   GET  /api/auth/callback                         Google's answer: every check, then a session
//   POST /api/auth/logout { everywhere? }           this browser's session ends (or all of yours)
//
// The callback refuses, with no session, a state that isn't this browser's (the gc_signin cookie
// set at the start), one used before or older than ten minutes, and any ID token that fails
// site/google.js verify(). A refusal lands on #/sign-in?problem=<code>, where the page says why
// in words; "domain" is "This site is for Moxie accounts only".
//
// People: the first sign-in with OWNER_EMAIL becomes the owner (one at most); everyone else
// starts as a member. Roles change nothing about whose jobs you see.

import { googleClient, pkceChallenge, randomToken, sha256, SignInRefused } from './google.js';
import { fakeGoogle } from './fake-google.js';
import { cookie, HttpError, parseCookies, redirect, sendJson } from './http.js';
import { iso, sessionStore } from './sessions.js';

const SIGNIN_COOKIE = 'gc_signin';
const SIGNIN_MINUTES = 10;
const RETURN = /^\/(#\/[A-Za-z0-9/_\-?=&.]*)?$/;

export const safeReturn = (v) => (typeof v === 'string' && v.length <= 200 && RETURN.test(v) ? v : '/');

export default function authRoutes(ctx) {
  const { db, config, now } = ctx;
  const google = googleClient({ config, fetch: ctx.fetch, now });
  const sessions = sessionStore({ db, config, now });
  ctx.sessions = sessions;
  if (config.authFake) (ctx.extraHandlers ??= []).push(fakeGoogle({ config, now }));

  ctx.auth.session = async (req, res) => {
    const s = await sessions.find(req, res);
    if (!s) throw new HttpError(401, 'Sign in first.', { signIn: true });
    return s;
  };
  ctx.auth.optionalSession = (req, res) => (config.missing.length ? null : sessions.find(req, res));
  ctx.personView = (p) => ({ id: p.id, name: p.name || p.email.split('@')[0], email: p.email, role: p.role });

  const refused = (res, code) => redirect(res, `/#/sign-in?problem=${encodeURIComponent(code)}`, [cookie(SIGNIN_COOKIE, '', { maxAge: 0, path: '/api/auth' })]);

  /** The person for these claims: found by Google's sub, kept up to date; the owner made once. */
  async function personFor(claims) {
    const t = iso(now());
    return db.tx(async (q) => {
      const found = (await q.query('SELECT id, role FROM people WHERE google_sub = $1', [claims.sub])).rows[0];
      let id;
      if (found) {
        id = Number(found.id);
        await q.query('UPDATE people SET email = $2, name = $3, last_sign_in_at = $4 WHERE id = $1', [id, claims.email, claims.name, t]);
      } else {
        // An address can move to a new Google account only by its owner re-creating it; refuse quietly to merge.
        const sameEmail = (await q.query('SELECT id FROM people WHERE email = $1', [claims.email])).rows[0];
        if (sameEmail) throw new SignInRefused('account', 'That address belongs to another Google account the site already knows. Ask the site’s owner.');
        id = Number((await q.query("INSERT INTO people (google_sub, email, name, role, created_at, last_sign_in_at) VALUES ($1, $2, $3, 'member', $4, $4) RETURNING id", [claims.sub, claims.email, claims.name, t])).rows[0].id);
      }
      if (config.ownerEmail && claims.email === config.ownerEmail) {
        const owner = (await q.query("SELECT id FROM people WHERE role = 'owner'")).rows[0];
        if (!owner) await q.query("UPDATE people SET role = 'owner' WHERE id = $1", [id]);
      }
      return id;
    });
  }

  return [
    {
      method: 'GET', path: '/api/auth/start', auth: 'public',
      async run({ res, url }) {
        const state = randomToken(32);
        const nonce = randomToken(32);
        const verifier = randomToken(48);
        const t = now();
        await db.query('DELETE FROM sign_ins WHERE created_at < $1', [iso(t - 24 * 60 * 60 * 1000)]);
        await db.query('INSERT INTO sign_ins (state_hash, nonce, verifier, return_to, created_at) VALUES ($1, $2, $3, $4, $5)', [sha256(state), nonce, verifier, safeReturn(url.searchParams.get('return')), iso(t)]);
        let to;
        try { to = await google.authorizeUrl({ state, nonce, challenge: pkceChallenge(verifier) }); } catch (err) {
          if (err instanceof SignInRefused) return refused(res, err.code);
          throw err;
        }
        redirect(res, to, [cookie(SIGNIN_COOKIE, state, { maxAge: SIGNIN_MINUTES * 60, path: '/api/auth' })]);
      },
    },
    {
      method: 'GET', path: '/api/auth/callback', auth: 'public',
      async run({ req, res, url }) {
        const q = url.searchParams;
        if (q.get('error')) return refused(res, 'cancelled');
        const state = q.get('state') ?? '';
        const code = q.get('code') ?? '';
        const mine = parseCookies(req.headers.cookie)[SIGNIN_COOKIE] ?? '';
        if (!state || !code || state !== mine) return refused(res, 'state');
        const t = now();
        // Used once: the row is taken in the same statement that checks it.
        const row = (await db.query(
          'UPDATE sign_ins SET used_at = $2 WHERE state_hash = $1 AND used_at IS NULL AND created_at > $3 RETURNING nonce, verifier, return_to',
          [sha256(state), iso(t), iso(t - SIGNIN_MINUTES * 60 * 1000)],
        )).rows[0];
        if (!row) return refused(res, 'state');
        try {
          const idToken = await google.exchange(code, row.verifier);
          const claims = await google.verify(idToken, row.nonce);
          const personId = await personFor(claims);
          const sessionCookie = await sessions.create(personId);
          redirect(res, safeReturn(row.return_to), [sessionCookie, cookie(SIGNIN_COOKIE, '', { maxAge: 0, path: '/api/auth' })]);
        } catch (err) {
          if (err instanceof SignInRefused) return refused(res, err.code);
          throw err;
        }
      },
    },
    {
      method: 'POST', path: '/api/auth/logout', auth: 'session',
      async run({ req, res, session, person }) {
        const body = await ctx.readJson(req);
        if (body.everywhere === true) await sessions.revokeAll(person.id); else await sessions.revoke(session.idHash);
        sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessions.clearCookie() });
      },
    },
  ];
}
