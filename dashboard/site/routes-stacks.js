// ---------- Stacks (packet K): /api/stacks/* (runner/stacks.js, lib/stack.js) ----------
// A big job split into sections that run side by side, merged in order into the stack's branch,
// pushed only on your go. The queue and the merges are the runner's (local mode only): this is the
// Stack page's half.
//   GET  /api/stacks                       every stack in a line each, and the global cap
//   GET  /api/stacks/:slug                 one stack: its steps, its sections in merge order, what's next
//   POST /api/stacks/cap                   { cap: 3 }  sections at once across every stack (Settings → Workflow)
//   POST /api/stacks/:slug/approve-plan    { cap?, autoIntegrate?, model?, effort? }  approve stack.md: the sections start
//   POST /api/stacks/:slug/settings        { cap?, autoIntegrate?, model?, effort? }
//   POST /api/stacks/:slug/merge           { section? }  your yes to merging the next section (202; the view shows it)
//   POST /api/stacks/:slug/send-back       { section?, note? }  back to a section's Foreman, or a plan change to the coordinator
//   POST /api/stacks/:slug/push            { go: true | false, note? }  pushing waits for this, always
//   POST /api/stacks/:slug/check           look at the stack now (it looks every few seconds anyway)

import { HttpError } from '../lib/http-guard.js';

const ONE = /^\/api\/stacks\/([a-z0-9][a-z0-9._-]{0,199})(?:\/([a-z-]+))?$/;
const ACTIONS = new Set(['approve-plan', 'settings', 'merge', 'send-back', 'push', 'check']);

export default function stacksRoutes({ local, sendJson, readBody, checkWrite }) {
  const stacks = local?.stacks ?? null;

  async function routeStacks(req, res, urlPath) {
    try {
      if (!stacks) throw new HttpError(404, 'Stacks run only on the dashboard on your own computer.');
      if (req.method === 'GET') {
        if (urlPath === '/api/stacks') return sendJson(res, 200, await stacks.list());
        const m = ONE.exec(urlPath);
        if (m && !m[2]) return sendJson(res, 200, await stacks.view(m[1]));
        throw new HttpError(404, 'Not found');
      }
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
      checkWrite(req);
      const body = await readBody(req);
      if (urlPath === '/api/stacks/cap') return sendJson(res, 200, { settings: await stacks.setGlobalCap(body.cap), ...(await stacks.list()) });
      const m = ONE.exec(urlPath);
      if (!m || !m[2] || !ACTIONS.has(m[2])) throw new HttpError(404, 'Not found');
      const [, slug, action] = m;
      if (action === 'approve-plan') return sendJson(res, 200, await stacks.approvePlan(slug, body));
      if (action === 'settings') return sendJson(res, 200, await stacks.settings(slug, body));
      if (action === 'merge') return sendJson(res, 202, await stacks.merge(slug, body));
      if (action === 'send-back') return sendJson(res, 200, await stacks.sendBack(slug, body));
      if (action === 'push') return sendJson(res, 200, await stacks.push(slug, body));
      await stacks.view(slug); // 404 when there is no such stack
      await stacks.tick();
      return sendJson(res, 200, await stacks.view(slug));
    } catch (err) {
      throw stacks ? stacks.httpError(err) : err;
    }
  }

  return { owns: (urlPath) => urlPath === '/api/stacks' || urlPath.startsWith('/api/stacks/'), mount: routeStacks };
}
