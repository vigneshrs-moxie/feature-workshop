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
//   GET  /api/job/:slug/pr/:n?read=old          one PR's line and the GitHub read it comes from (Task 20; Task 21
//                                     adds its comment rows): { n, line, github, rows, verdict, reading };
//                                     read=old (the page opening a job): GitHub is read in the background when
//                                     the last read is over two minutes old. The payload's request never reads it.
//   POST /api/job/:slug/pr/:n/pull              Pull now: GitHub is read now, in the background → { reading: true }
//   POST /api/job/:slug/pr/:n/go { id, check, confirmNoTerminal? }   his yes to the line's next action: its
//                                     fixed sentence goes to the Foreman when the line still says the same
//                                     (lib/pr-lines.js), else 409 and nothing is sent → { ok, sent, text, run }
//   POST /api/job/:slug/pr/:n/fix { ids }        Fix these (Task 21): one message quoting each ticked comment goes to
//                                     the Foreman; the rows show Fixing → { ok, sent, text, run }
//   POST /api/job/:slug/pr/:n/ask { ids }        What is he asking?: the same comments, to be explained in words
//   POST /api/job/:slug/pr/:n/leave { ids }      Leave: the rows show Left; nothing is sent
//   POST /api/job/:slug/pr/:n/fix-check { name } Fix it: a failed check's failing lines go to the Foreman
//   POST /api/job/:slug/pr/:n/reply { id, body } Post it: his reply posted on GitHub (lib/gh-write.js, his yes) → { ok, posted }
//                                     (lib/pr-comments.js; only rows the page was shown: else 409 and nothing goes)
// The PR routes are this computer's only (the runner's `local.prs`): on the website they are a 404.
// viewer: the id of the page's event stream (its first event, `viewer` { id }, from /api/events?v=2).
// It tells the runner this job is open, so changes rebuild it at once; without it the job is rebuilt
// only behind its next request. Anything that is not such an id is ignored.
// No needJob first: it reads the job list, which can load every job again. An unknown job is the
// cache's 404, in the same words. Mounted before routes-jobs.js, whose GET /api/job/:slug/... would
// answer these with a 404.

import { HttpError } from '../lib/http-guard.js';
import { PRODUCT } from '../lib/brand.js';

const NO_ID = 'Say which part of the job to show (?id=…).';
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const viewerOf = (url) => {
  const v = url.searchParams.get('viewer');
  return v && /^[0-9a-f]{16,32}$/.test(v) ? v : null;
};

const PR = /^\/api\/job\/([^/]+)\/pr\/([1-3])/;
const ROW_ID = /^[cri]\d{1,20}$/;
/** The ticked rows' ids: 1 to 100 of them, each a comment's id (`c901`, `r55`, `i77`). */
const idsOf = (body) => {
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === 'string' && ROW_ID.test(x)) : [];
  if (!ids.length || ids.length !== body.ids.length || ids.length > 100) throw new HttpError(400, 'Say which comments (ids).');
  return [...new Set(ids)];
};
const prsOf = (local) => {
  if (!local?.prs) throw new HttpError(404, `Pull requests are read and acted on from ${PRODUCT} on your own computer.`);
  return local.prs;
};

export default function jobPageRoutes({ read, sendJson, local }) {
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
    {
      method: 'GET', path: new RegExp(`${PR.source}$`),
      run: async ({ res, url, m }) => sendJson(res, 200, await prsOf(local).view(m[1], Number(m[2]), { readIfOld: url.searchParams.get('read') === 'old' })),
    },
    {
      method: 'POST', path: new RegExp(`${PR.source}\\/pull$`),
      run: async ({ res, m }) => sendJson(res, 200, await prsOf(local).pull(m[1])),
    },
    {
      method: 'POST', path: new RegExp(`${PR.source}\\/go$`),
      run: async ({ res, m, body }) => {
        const id = str(body?.id, 40);
        const check = str(body?.check, 40);
        if (!id || !/^[0-9a-f]{12}$/.test(check)) throw new HttpError(400, 'Say which action and the check the line gave (id, check).');
        // replies (Task 21, a review round's Push the fixes): his edits of the round's drafted replies, by comment id.
        const replies = {};
        for (const [k, v] of Object.entries(body?.replies && typeof body.replies === 'object' ? body.replies : {}).slice(0, 100)) {
          if (ROW_ID.test(k) && typeof v === 'string' && v.trim()) replies[k] = v.slice(0, 60000);
        }
        return sendJson(res, 200, await prsOf(local).go(m[1], Number(m[2]), { id, check, confirmNoTerminal: body?.confirmNoTerminal === true, replies }));
      },
    },
    {
      method: 'POST', path: new RegExp(`${PR.source}\\/(fix|ask|leave)$`),
      run: async ({ res, m, body }) => sendJson(res, 200, await prsOf(local).comments(m[1], Number(m[2]), m[3], { ids: idsOf(body), confirmNoTerminal: body?.confirmNoTerminal === true })),
    },
    {
      method: 'POST', path: new RegExp(`${PR.source}\\/fix-check$`),
      run: async ({ res, m, body }) => {
        const name = str(body?.name, 200);
        if (!name) throw new HttpError(400, 'Say which check (name).');
        return sendJson(res, 200, await prsOf(local).fixCheck(m[1], Number(m[2]), { name, confirmNoTerminal: body?.confirmNoTerminal === true }));
      },
    },
    {
      method: 'POST', path: new RegExp(`${PR.source}\\/reply$`),
      run: async ({ res, m, body }) => {
        const id = str(body?.id, 30);
        const text = str(body?.body, 60000).trim();
        if (!ROW_ID.test(id) || !text) throw new HttpError(400, 'Say which comment and the reply (id, body).');
        return sendJson(res, 200, await prsOf(local).reply(m[1], Number(m[2]), { id, body: text }));
      },
    },
  ];
}
