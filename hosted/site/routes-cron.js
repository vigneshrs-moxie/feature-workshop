// The one cron job (vercel.json "crons": /api/cron/inbox every 3 minutes): the Orbit inbox poller
// (lib/poller.js runCron, set up by site/routes-orbit.js). Vercel Cron calls it with
// "Authorization: Bearer <CRON_SECRET>"; anything else, or no CRON_SECRET set, is a 401.
// Vercel calls it on production only and never retries a failed run, and may now and then call
// one run twice: each person's read is claimed first, so a second run skips them, and a missed
// run is caught up by the next (it reads what changed since the last read that worked).
// It answers 204 either way; what it did is one line in the function's log (counts only).

import { send } from './http.js';

export default function cronRoutes(ctx) {
  return [
    {
      method: 'GET', path: '/api/cron/inbox', auth: 'cron', ready: false,
      async run({ res }) {
        // A deployment without the database or the settings has nothing to read with.
        if (ctx.db && !ctx.config.noDatabase && !ctx.config.missing.length && ctx.orbitInbox) await ctx.orbitInbox.poller.runCron();
        send(res, 204);
      },
    },
  ];
}
