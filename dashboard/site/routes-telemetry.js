// ---------- Telemetry (packet T): /api/telemetry (lib/usage-log.js, lib/telemetry.js) ----------
//   GET /api/telemetry?window=5h|week|30d   the five graphs' data (lib/telemetry.js), each with its
//       sentence and whether it is private (your own jobs) or common (the shared account), plus the
//       plan meters now. The window defaults to this week. usage.jsonl is the runner's.

import { HttpError } from '../lib/http-guard.js';
import { WINDOWS as TELEMETRY_WINDOWS } from '../lib/telemetry.js';

export default function telemetryRoutes({ read, sendJson }) {
  async function routeTelemetry(req, res, urlPath, url) {
    if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
    if (urlPath !== '/api/telemetry') throw new HttpError(404, 'Not found.');
    const window = url.searchParams.get('window') || 'week';
    if (!TELEMETRY_WINDOWS.includes(window)) throw new HttpError(400, 'The window is one of 5h, week or 30d.');
    return sendJson(res, 200, await read.telemetry({ window }));
  }
  return { owns: (urlPath) => urlPath === '/api/telemetry' || urlPath.startsWith('/api/telemetry/'), mount: routeTelemetry };
}
