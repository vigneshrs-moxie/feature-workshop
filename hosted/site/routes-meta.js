// GET /api/meta: what the page needs before anything else. mode 'hosted' tells the web app to
// use the session cookie (not the local page token) and the hosted screens; `person` is who is
// signed in, or null (then the page shows "Sign in with Google"). `missing` names the settings this
// deployment lacks (names only), so a half set-up site says what to set instead of failing oddly.

import { PRODUCT } from '../../dashboard/lib/brand.js';
import { PROTOCOL_VERSION } from '../../dashboard/lib/protocol.js';
import { sendJson } from './http.js';

export default function metaRoutes(ctx) {
  return [
    {
      method: 'GET', path: '/api/meta', auth: 'public', ready: false,
      async run({ req, res }) {
        const s = await ctx.auth.optionalSession?.(req, res) ?? null;
        sendJson(res, 200, {
          mode: 'hosted',
          product: PRODUCT,
          protocol: PROTOCOL_VERSION,
          person: s ? ctx.personView(s.person) : null,
          signIn: '/api/auth/start',
          fakeSignIn: ctx.config.authFake,
          missing: ctx.config.missing,
          noDatabase: ctx.config.noDatabase,
        });
      },
    },
  ];
}
