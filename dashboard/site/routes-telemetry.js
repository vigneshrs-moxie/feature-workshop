// ---------- Telemetry (packets T and P): /api/telemetry (lib/usage-log.js, lib/telemetry.js, lib/insights.js) ----------
//   GET /api/telemetry?window=5h|week|30d   for the window:
//       graphs    the ten insight graphs, in order, each with its id (so the page folds and hides
//                 them by id), number, finding, What to do line, table and who sees it (private:
//                 your own jobs; common: the whole account, no job names)
//       limits    the two meters split into this app's people and Other use (estimated), with the
//                 note on what Other use means
//       sources   whether the audit log and the job list were there (graphs 6 to 8 need them)
//       meters    the plan meters now; file: where usage.jsonl is
//   The window defaults to this week. usage.jsonl is the runner's.

import { HttpError } from '../lib/http-guard.js';
import { WINDOWS as TELEMETRY_WINDOWS } from '../lib/telemetry.js';

export default function telemetryRoutes({ read, sendJson }) {
  async function routeTelemetry(req, res, urlPath, url) {
    if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
    if (urlPath !== '/api/telemetry') throw new HttpError(404, 'Not found.');
    const window = url.searchParams.get('window') || 'week';
    if (!TELEMETRY_WINDOWS.includes(window)) throw new HttpError(400, 'The window is one of 5h, week or 30d.');
    const body = await read.telemetry({ window });
    // Older runners hand back no graphs or sources: say so plainly rather than leave them out.
    return sendJson(res, 200, { graphs: [], sources: { audit: false, jobs: false }, ...body });
  }
  return { owns: (urlPath) => urlPath === '/api/telemetry' || urlPath.startsWith('/api/telemetry/'), mount: routeTelemetry };
}
