// A step's crew member in a terminal (packet M; lib/stage-view.js), from the job page's Details:
//   POST /api/job/:slug/stage/:stop/terminal   { ref }: open that agent in a terminal (try-it 'follow')
// The step's own view (GET /api/job/:slug/stage/:stop) went with the old job page (plan Task 26): the
// job page reads GET /api/job/:slug/page and /work (site/routes-job-page.js).
// Mounted before routes-jobs.js, whose /api/job/:slug/... routes would answer this one with a 404.

import { HttpError } from '../lib/http-guard.js';
import { REF_PATTERN, STOP_IDS, isStopId } from '../lib/stage-view.js';

const UNKNOWN_STOP = `There’s no stop by that name. The stops are ${STOP_IDS.slice(0, -1).join(', ')} and ${STOP_IDS.at(-1)}.`;

function readStop(raw) {
  const stop = decodeURIComponent(raw);
  if (!isStopId(stop)) throw new HttpError(400, UNKNOWN_STOP);
  return stop;
}

export default function stageRoutes({ runner, sendJson, needJob, LOCAL }) {
  return [
    {
      // The write guard (token, origin, JSON) has already run for every POST (site/index.js).
      method: 'POST', path: /^\/api\/job\/([^/]+)\/stage\/([^/]+)\/terminal$/,
      run: async ({ res, m, body }) => {
        const slug = await needJob(m[1]);
        readStop(m[2]);
        const ref = typeof body.ref === 'string' ? body.ref : '';
        if (!REF_PATTERN.test(ref)) throw new HttpError(400, 'That isn’t one of this job’s agents.');
        return sendJson(res, 200, await runner.handle({ type: 'try-it', slug, action: 'follow', what: ref }, LOCAL));
      },
    },
  ];
}
