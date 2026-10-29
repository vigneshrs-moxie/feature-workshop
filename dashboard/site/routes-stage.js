// The Stage (packet M): one stop of a job and everyone who works or worked it (lib/stage-view.js).
//   GET  /api/job/:slug/stage/:stop            the StageView (web/src/api/types.ts)
//   POST /api/job/:slug/stage/:stop/terminal   { ref }: open that agent in a terminal (try-it 'follow')
// Mounted before routes-jobs.js, whose GET /api/job/:slug/... would answer these with a 404.

import { HttpError } from '../lib/http-guard.js';
import { REF_PATTERN, STOP_IDS, isStopId, stageView } from '../lib/stage-view.js';

const UNKNOWN_STOP = `There’s no stop by that name. The stops are ${STOP_IDS.slice(0, -1).join(', ')} and ${STOP_IDS.at(-1)}.`;

function readStop(raw) {
  const stop = decodeURIComponent(raw);
  if (!isStopId(stop)) throw new HttpError(400, UNKNOWN_STOP);
  return stop;
}

export default function stageRoutes({ runner, read, sendJson, needJob, LOCAL }) {
  return [
    {
      method: 'GET', path: /^\/api\/job\/([^/]+)\/stage\/([^/]+)$/,
      run: async ({ res, m }) => {
        const slug = await needJob(m[1]);
        const stop = readStop(m[2]);
        const job = await read.job(slug);
        // Try it's terminal choice; the Stage still shows without it.
        const local = await read.localView(slug).catch(() => null);
        return sendJson(res, 200, stageView(job, stop, { local, platform: process.platform }));
      },
    },
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
