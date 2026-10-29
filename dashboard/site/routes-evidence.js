// A job's evidence (packet L): the screenshots and videos recorded from the tester's Playwright
// specs at the test stage (lib/evidence.js). The recorder is the runner's (it starts Try it and
// Playwright), so these routes reach it through runner.local.evidence, a small door with view, file
// and record (runner/evidence.js).
//   GET  /api/job/:slug/evidence                 evidence.json as { evidence }, with the commit the
//                                                test report names now, whether the job records
//                                                evidence and why, a recording in progress, the last
//                                                problem, and the evidence folder's address
//   GET  /api/job/:slug/evidence/file?path=…     one picture or video, only when the path is a plain
//                                                file inside that job's evidence/ folder (else 404);
//                                                a video answers byte ranges, so it can be scrubbed
//   POST /api/job/:slug/evidence/record          record again for the commit the report names now
//                                                (token-checked like every write; 409 "Already
//                                                recorded for abc1234"); 202 when it carries on by
//                                                itself, its `evidence` event saying when it is done

import fs from 'node:fs';
import { HttpError } from '../lib/http-guard.js';

const NOT_READY = 'This dashboard can’t record evidence yet. Restart it, and if this stays, tell whoever looks after it.';
const VIEW = /^\/api\/job\/([^/]+)\/evidence$/;
const FILE = /^\/api\/job\/([^/]+)\/evidence\/file$/;
const RECORD = /^\/api\/job\/([^/]+)\/evidence\/record$/;

/** The first range of a Range header, clamped to the file: { start, end } or null (the whole file), or 'bad'. */
function rangeOf(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!m || (!m[1] && !m[2])) return header ? 'bad' : null;
  let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  let end = m[1] && m[2] ? Number(m[2]) : size - 1;
  if (!m[1]) end = size - 1;
  end = Math.min(end, size - 1);
  if (!Number.isSafeInteger(start) || start > end || start >= size) return 'bad';
  return { start, end };
}

export default function evidenceRoutes({ local, needJob, sendJson, SECURITY_HEADERS }) {
  const door = () => {
    const evidence = local?.evidence;
    if (!evidence) throw new HttpError(503, NOT_READY);
    return evidence;
  };
  const slugOf = async (m) => needJob(decodeURIComponent(m[1]));
  return [
    { method: 'GET', path: VIEW, run: async ({ res, m }) => sendJson(res, 200, await door().view(await slugOf(m))) },
    {
      method: 'GET', path: FILE,
      run: async ({ req, res, url, m }) => {
        const slug = await slugOf(m);
        const file = await door().file(slug, url.searchParams.get('path') ?? '');
        const range = file.type.startsWith('video/') ? rangeOf(req.headers.range, file.size) : null;
        const headers = { ...SECURITY_HEADERS, 'Content-Type': file.type, 'Accept-Ranges': file.type.startsWith('video/') ? 'bytes' : 'none' };
        if (range === 'bad') {
          res.writeHead(416, { ...headers, 'Content-Range': `bytes */${file.size}` });
          return res.end();
        }
        const part = range ?? { start: 0, end: file.size - 1 };
        res.writeHead(range ? 206 : 200, { ...headers, 'Content-Length': String(Math.max(0, part.end - part.start + 1)), ...(range ? { 'Content-Range': `bytes ${part.start}-${part.end}/${file.size}` } : {}) });
        if (file.size === 0) return res.end();
        return new Promise((resolve) => {
          const stream = fs.createReadStream(file.abs, { start: part.start, end: part.end });
          stream.on('error', () => { res.destroy(); resolve(); });
          stream.on('end', resolve);
          stream.pipe(res);
        });
      },
    },
    {
      method: 'POST', path: RECORD,
      run: async ({ res, m }) => {
        const slug = await slugOf(m);
        const r = await door().record(slug);
        return sendJson(res, r.started ? 202 : 200, { ok: true, started: r.started, ...(await door().view(slug)) });
      },
    },
  ];
}
