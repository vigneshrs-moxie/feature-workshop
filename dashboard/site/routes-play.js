// Play mode (lib/play.js): the ledger, the teapot, and the secrets and events the page finds.

import { HttpError } from '../lib/http-guard.js';

export default function playRoutes({ read, local, sendJson }) {
  const playEvent = async ({ res, body, secret }) => {
    // An easter egg found, or something the page saw you do (a theme tried), from fixed lists only.
    const id = typeof body.id === 'string' ? body.id : '';
    const kind = secret ? null : typeof body.kind === 'string' ? body.kind : '';
    return sendJson(res, 200, await local.playEvent({ secret, id, kind }));
  };
  return [
    // The play ledger (lib/play.js ledgerView): crew met, quests done, achievements, secrets found.
    // Play mode Off: only that, nothing read or built.
    { method: 'GET', path: '/api/play', run: async ({ res }) => sendJson(res, 200, await read.play()) },
    {
      method: 'GET', path: '/api/teapot',
      run: async ({ req, res, url }) => {
        if (!read.playOn()) throw new HttpError(404, 'Not found');
        // A real 418. Found from this browser or a terminal (never from another site's page), it is a
        // secret; come from the X-Crew-Note header (?from=headers), so is that one.
        const site = req.headers['sec-fetch-site'];
        if (!site || site === 'same-origin' || site === 'none') {
          await local.recordSecret('teapot');
          if (url.searchParams.get('from') === 'headers') await local.recordSecret('headers');
        }
        return sendJson(res, 418, local.teapot);
      },
    },
    { method: 'POST', path: '/api/play/secret', run: (a) => playEvent({ ...a, secret: true }) },
    { method: 'POST', path: '/api/play/event', run: (a) => playEvent({ ...a, secret: false }) },
  ];
}
