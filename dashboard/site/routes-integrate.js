// ---------- The integration board (packet Z): /api/integrate/* (lib/integrate.js) ----------
// The packet worktrees of the repository this dashboard runs from, and "Merge next" into its main
// checkout (INTEGRATE_ROOT overrides which repository). Its settings live in
// ~/.ground-control/integrate.json (GROUND_CONTROL_DIR overrides the folder). Never pushes.
//   GET  /api/integrate              the packets, the order, packets at once, the last result
//   GET  /api/integrate/stream       the running step's output, live (server-sent events)
//   POST /api/integrate/order        { order: ['Z', 'C', …] }  save the order
//   POST /api/integrate/slots        { slots: 3 }              save "packets at once"
//   POST /api/integrate/merge-next   start Merge next (202; the result comes on the stream)
//   POST /api/integrate/run-tests    { id }  run both test suites in that packet's worktree (202)
// The board itself is the runner's (local mode only): this is its page's half.

import { HttpError } from '../lib/http-guard.js';

export default function integrateRoutes({ local, sendJson, readBody, checkWrite, SECURITY_HEADERS }) {
  const integrator = local.integrator;
  const integrateClients = new Set();
  const integrateSend = (data) => { const line = `data: ${JSON.stringify(data)}\n\n`; for (const c of integrateClients) c.write(line); };
  integrator.on('line', (e) => integrateSend({ type: 'line', ...e }));
  integrator.on('step', (step) => integrateSend({ type: 'step', step }));
  integrator.on('done', (result) => integrateSend({ type: 'done', result }));

  async function routeIntegrate(req, res, urlPath) {
    try {
      if (req.method === 'GET' && urlPath === '/api/integrate') return sendJson(res, 200, await integrator.view());
      if (req.method === 'GET' && urlPath === '/api/integrate/stream') {
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(`retry: 3000\n\ndata: ${JSON.stringify({ type: 'hello', step: integrator.running, log: integrator.log.join('') })}\n\n`);
        integrateClients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 25000);
        req.on('close', () => { clearInterval(ping); integrateClients.delete(res); });
        return undefined;
      }
      if (req.method !== 'POST') throw new HttpError(req.method === 'GET' ? 404 : 405, req.method === 'GET' ? 'Not found' : 'Method not allowed');
      checkWrite(req);
      const body = await readBody(req);
      if (urlPath === '/api/integrate/order') return sendJson(res, 200, await integrator.saveOrder(body.order));
      if (urlPath === '/api/integrate/slots') return sendJson(res, 200, await integrator.saveSlots(body.slots));
      if (urlPath === '/api/integrate/merge-next') {
        integrator.mergeNext().done.catch((err) => console.error('integrate:', err));
        return sendJson(res, 202, { started: true, step: integrator.running });
      }
      if (urlPath === '/api/integrate/run-tests') {
        const { done } = await integrator.runPacketTests(typeof body.id === 'string' ? body.id : '');
        done.catch((err) => console.error('integrate:', err));
        return sendJson(res, 202, { started: true, step: integrator.running });
      }
      throw new HttpError(404, 'Not found');
    } catch (err) {
      throw local.integrateHttpError(err);
    }
  }

  return { owns: (urlPath) => urlPath === '/api/integrate' || urlPath.startsWith('/api/integrate/'), mount: routeIntegrate };
}
