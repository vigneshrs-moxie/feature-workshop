// ---------- Orbit: the Inbox (lib/orbit.js, lib/orbit-token.js) ----------
// Portal Feedback tickets read with your own read-only token (ORBIT-479): every call to Orbit is a
// GET. The token lives in the OS credential store (in demo mode, or with WORKSHOP_ORBIT_STORE=file,
// in a 600 file in the state folder) and never in an answer, a record or the audit. The token and
// the poller are the runner's (local mode only); these are the routes:
//   GET    /api/orbit/status                   token saved?, where, expiry, last poll, last error
//   GET    /api/orbit/inbox[?view=<id>][&refresh=1]  the inbox (or a saved view's tickets)
//   GET    /api/orbit/tickets/:ref             one ticket with its timeline
//   GET    /api/orbit/tickets/:ref/references  its branches, PRs and links
//   GET    /api/orbit/views                    your saved views (the Inbox's tabs)
//   GET    /api/orbit/events                   a stream for an open Inbox: polls every 3 minutes
//                                              while one is connected, every 15 otherwise
//   POST   /api/orbit/token  { token, url, expiresInDays }   save (and wire up the Foreman's MCP entry)
//   DELETE /api/orbit/token                    forget it

import { HttpError } from '../lib/http-guard.js';
import { inboxItem, scrubDeep } from '../lib/orbit.js';

export default function orbitRoutes({ local, str, send, sendJson, readBody, checkWrite, SECURITY_HEADERS }) {
  const { status: orbitStatus, inbox: orbitInbox, client: orbit, withJobs, httpError: orbitHttpError } = local.orbit;
  const orbitStreams = new Set();

  function sendOrbitEvent(type, data) {
    const chunk = `event: ${type}\ndata: ${JSON.stringify(scrubDeep(data))}\n\n`;
    for (const res of orbitStreams) res.write(chunk);
  }
  orbitInbox.on('change', () => {
    if (!orbitStreams.size) return;
    (async () => sendOrbitEvent('inbox', { ...(await orbitStatus()), items: await withJobs(orbitInbox.view().items) }))().catch(() => {});
  });

  function openOrbitStream(req, res) {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
    res.write('retry: 5000\n\n');
    orbitStreams.add(res);
    const unwatch = orbitInbox.watch(); // a browser has the Inbox open: every 3 minutes
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); orbitStreams.delete(res); unwatch(); });
  }

  async function routeOrbit(req, res, urlPath, url) {
    let m;
    if (req.method === 'GET') {
      if (urlPath === '/api/orbit/events') return openOrbitStream(req, res);
      if (urlPath === '/api/orbit/status') return sendJson(res, 200, scrubDeep(await orbitStatus()));
      if (urlPath === '/api/orbit/inbox') {
        const status = await orbitStatus();
        if (!status.tokenPresent || !local.orbit.url()) return sendJson(res, 200, scrubDeep({ ...status, items: [] }));
        const viewId = str(url.searchParams.get('view'), 100);
        if (viewId) {
          try {
            const list = await orbitInbox.viewList(viewId);
            return sendJson(res, 200, scrubDeep({ ...status, view: viewId, items: await withJobs(list.items), checkedAt: list.checkedAt, truncated: list.truncated }));
          } catch (err) { throw orbitHttpError(err); }
        }
        // The first open (nothing read yet) or Refresh: read now; else the last list as it is.
        if (url.searchParams.get('refresh') === '1' || !orbitInbox.view().checkedAt) await orbitInbox.refresh({ full: url.searchParams.get('refresh') === '1' });
        return sendJson(res, 200, scrubDeep({ ...(await orbitStatus()), items: await withJobs(orbitInbox.view().items) }));
      }
      if (urlPath === '/api/orbit/views') {
        try { return sendJson(res, 200, scrubDeep({ views: (await orbitInbox.views()).map(({ id, name, isDefault }) => ({ id, name, isDefault })) })); } catch (err) { throw orbitHttpError(err); }
      }
      if ((m = /^\/api\/orbit\/tickets\/([^/]{1,64})(\/references)?$/.exec(urlPath))) {
        try {
          if (m[2]) return sendJson(res, 200, scrubDeep(await orbit.listReferences(m[1])));
          const body = await orbit.getTicket(m[1]);
          const t = body?.ticket?.ticket ?? body?.ticket ?? {};
          const item = Number.isInteger(t.number) ? (await withJobs([inboxItem(t, { audience: body.audience, orbitUrl: local.orbit.url() })]))[0] : null;
          return sendJson(res, 200, scrubDeep({ ...body, item }));
        } catch (err) { throw orbitHttpError(err); }
      }
      throw new HttpError(404, 'Not found.');
    }
    if (req.method !== 'POST' && req.method !== 'DELETE') return send(res, 405, 'Method not allowed');
    checkWrite(req);
    const body = await readBody(req);
    if (urlPath !== '/api/orbit/token') throw new HttpError(404, 'Not found.');
    if (req.method === 'POST') return sendJson(res, 200, scrubDeep(await local.orbit.saveToken(body)));
    return sendJson(res, 200, scrubDeep(await local.orbit.clearToken()));
  }

  return { owns: (urlPath) => urlPath.startsWith('/api/orbit/'), mount: routeOrbit };
}
