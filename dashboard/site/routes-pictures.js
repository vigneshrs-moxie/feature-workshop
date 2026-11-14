// Pasted pictures (job page rebuild, Task 17 fix round 1): a picture he pastes into the message box
// to pin a note on is saved in the job's own folder (lib/pictures.js), so the note can name the file
// for the Foreman. Laptop only: the website keeps pasted pictures in the browser.
//   POST /api/job/:slug/pictures          { data: <the picture, base64> } → { path: 'pictures/<sha256>.<ext>', size }
//                                         token-checked and JSON like every write; its own body limit
//                                         (a 10 MB picture is about 13.4 MB as base64)
//   GET  /api/job/:slug/pictures/<name>   the picture, by its own name only
// A mount, so it reads its own (larger) body; everything else about a write is checkWrite's.

import fs from 'node:fs';
import { HttpError } from '../lib/http-guard.js';
import { PICTURE_MAX } from '../lib/pictures.js';

const PATH = /^\/api\/job\/([^/]+)\/pictures(?:\/([^/]+))?$/;
/** The JSON body's most: the picture as base64 and a little more. */
const BODY_MAX = Math.ceil(PICTURE_MAX / 3) * 4 + 1024;

async function readBig(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > BODY_MAX) throw new HttpError(413, 'The picture is too big: at most 10 MB.');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'That wasn’t valid JSON.'); }
}

export default function picturesRoutes({ local, needJob, sendJson, checkWrite, SECURITY_HEADERS }) {
  const door = () => {
    if (!local?.pictures) throw new HttpError(404, 'Pictures are kept on your laptop.');
    return local.pictures;
  };
  async function mount(req, res, urlPath) {
    const m = PATH.exec(urlPath);
    if (req.method === 'GET' && m?.[2]) {
      const slug = await needJob(m[1]);
      const f = await door().file(slug, m[2]);
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': f.type, 'Content-Length': String(f.size) });
      return new Promise((resolve) => {
        const stream = fs.createReadStream(f.abs);
        stream.on('error', () => { res.destroy(); resolve(); });
        stream.on('end', resolve);
        stream.pipe(res);
      });
    }
    if (req.method !== 'POST' || !m || m[2]) throw new HttpError(req.method === 'GET' ? 404 : 405, req.method === 'GET' ? 'Not found' : 'Method not allowed');
    checkWrite(req);
    const body = await readBig(req);
    const slug = await needJob(m[1]);
    if (typeof body.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) throw new HttpError(400, 'The picture must come as base64.');
    return sendJson(res, 200, await door().save(slug, Buffer.from(body.data, 'base64')));
  }
  return { owns: (urlPath) => PATH.test(urlPath), mount };
}
