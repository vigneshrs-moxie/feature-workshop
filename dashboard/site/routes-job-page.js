// The new job page's reads (the job page rebuild, Task 4), answered from the runner's warm cache
// (lib/job-payload-cache.js): no database query, no psql, no git and no read of an agent's log on a
// request (plan "Speed rules" 6). On the website the mirror answers them from the mirrored record.
//   GET /api/job/:slug/page?v=<n>&viewer=<id>     the page's payload (lib/job-payload.js), or
//                                     { same: true, v } when n is the current v
//   GET /api/job/:slug/item?id=<id>&viewer=<id>   one body: { id, kind, version, html, text, meta }
//                                     (a reply, a brief, a document, the decisions list)
//   GET /api/job/:slug/work?viewer=<id>           Details: { rows, costs, note } (lib/work-rows.js); reads
//                                     each crew member's log only here, once while it is unchanged.
//                                     On the website: what the mirror has, or no rows and a reason
// viewer: the id of the page's event stream (its first event, `viewer` { id }, from /api/events?v=2).
// It tells the runner this job is open, so changes rebuild it at once; without it the job is rebuilt
// only behind its next request. Anything that is not such an id is ignored.
// No needJob first: it reads the job list, which can load every job again. An unknown job is the
// cache's 404, in the same words. Mounted before routes-jobs.js, whose GET /api/job/:slug/... would
// answer these with a 404.

import { HttpError } from '../lib/http-guard.js';

const NO_ID = 'Say which part of the job to show (?id=…).';
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const viewerOf = (url) => {
  const v = url.searchParams.get('viewer');
  return v && /^[0-9a-f]{16,32}$/.test(v) ? v : null;
};

export default function jobPageRoutes({ read, sendJson }) {
  return [
    {
      method: 'GET', path: /^\/api\/job\/([^/]+)\/page$/,
      run: async ({ res, url, m }) => {
        const raw = url.searchParams.get('v');
        const v = raw !== null && /^\d{1,15}$/.test(raw) ? Number(raw) : null;
        return sendJson(res, 200, await read.jobPage(m[1], v, { viewer: viewerOf(url) }));
      },
    },
    {
      method: 'GET', path: /^\/api\/job\/([^/]+)\/item$/,
      run: async ({ res, url, m }) => {
        const id = str(url.searchParams.get('id') ?? '', 1000);
        if (!id) throw new HttpError(400, NO_ID);
        return sendJson(res, 200, await read.jobItem(m[1], id, { viewer: viewerOf(url) }));
      },
    },
    {
      method: 'GET', path: /^\/api\/job\/([^/]+)\/work$/,
      run: async ({ res, url, m }) => sendJson(res, 200, await read.jobWork(m[1], { viewer: viewerOf(url) })),
    },
  ];
}
