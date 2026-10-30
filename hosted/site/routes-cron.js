// The one cron job (vercel.json "crons": /api/cron/inbox every 3 minutes). Packet 2C fills it
// with the Orbit inbox poller; until then it answers 204. Vercel Cron calls it with
// "Authorization: Bearer <CRON_SECRET>"; anything else, or no CRON_SECRET set, is a 401.

import { send } from './http.js';

export default function cronRoutes() {
  return [
    { method: 'GET', path: '/api/cron/inbox', auth: 'cron', ready: false, run: ({ res }) => send(res, 204) },
  ];
}
