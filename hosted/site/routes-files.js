// Evidence on the hosted site (packet 2B): screenshots and videos in the private Blob store
// (lib/blob.js), each only ever shown to its owner.
//
// The laptop (auth: its runner token):
//   POST /api/runner/evidence/upload  { slug, file, type, size }  → { upload, url, pathname }
//        a one-time signed PUT link for exactly evidence/<person>/<laptop>/<job>/<file>, that type
//        and that size, for ten minutes; only for a file this laptop's own evidence list names, a
//        picture or a video, at most 50 MB. upload false: the store has it already.
//   POST /api/runner/evidence/done    { slug, file, pathname }  the file is there (checked in the store)
// The page (auth: the signed-in person):
//   GET  /api/job/:slug/evidence             the job's evidence list, from the mirror
//   GET  /api/job/:slug/evidence/file?path=  a short-lived signed link (302) to one of your own
//                                            files; anyone else's, or one not there yet, is a 404
//   POST /api/job/:slug/evidence/record      recording runs on the laptop
// These come before the job routes in routes-mirror.js, which would answer them with a 404.

import { makeBlob, BlobNotSetUp } from '../lib/blob.js';
import { HttpError, API_HEADERS, sendJson } from './http.js';
import { iso } from './sessions.js';

export const MAX_FILE = 50 * 1024 * 1024;
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webm': 'video/webm', '.mp4': 'video/mp4' };
const FILE = /^(?!.*\.\.)[\w.-]+(?:\/[\w.-]+){0,4}$/;
const SLUG = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200 && /^[\w.-]+$/.test(v) && v !== '.' && v !== '..';

/** Every file an evidence list names. */
function named(view) {
  const out = new Set();
  for (const c of view?.evidence?.criteria ?? []) {
    for (const s of c.screenshots ?? []) if (typeof s?.file === 'string') out.add(s.file);
    const v = typeof c.video === 'string' ? c.video : c.video?.file;
    if (typeof v === 'string') out.add(v);
  }
  return out;
}

export default function fileRoutes(ctx) {
  const { db, now } = ctx;
  const blob = () => (ctx.blob ??= makeBlob({ config: ctx.config, now }));
  if (blob().handler) (ctx.extraHandlers ??= []).push(blob().handler);
  const records = () => ctx.mirror.records;
  ctx.onRunnerRemoved = [...(ctx.onRunnerRemoved ?? []), 'DELETE FROM evidence_files WHERE runner_id = $1'];

  async function check(runner, b) {
    if (!SLUG(b.slug)) throw new HttpError(400, 'Send the job’s name.');
    if (typeof b.file !== 'string' || !FILE.test(b.file)) throw new HttpError(400, 'Send the file as the evidence list names it.');
    const view = await records().ofRunner(runner.id, 'evidence', b.slug);
    if (!view || !named(view).has(b.file)) throw new HttpError(404, 'This job’s evidence doesn’t name that file.');
    return { pathname: `evidence/${runner.personId}/${runner.id}/${b.slug}/${b.file}` };
  }

  return [
    {
      method: 'POST', path: '/api/runner/evidence/upload', auth: 'runner',
      async run({ req, res, runner }) {
        const b = await ctx.readJson(req, { max: 4096 });
        const { pathname } = await check(runner, b);
        const type = TYPES[String(b.file).slice(String(b.file).lastIndexOf('.')).toLowerCase()];
        if (!type || b.type !== type) throw new HttpError(400, 'Only pictures (PNG, JPEG) and videos (WebM, MP4) are kept.');
        if (!Number.isSafeInteger(b.size) || b.size < 1 || b.size > MAX_FILE) throw new HttpError(413, `A file may be at most ${MAX_FILE / 1024 / 1024} MB.`);
        const had = (await db.query('SELECT size, uploaded_at FROM evidence_files WHERE runner_id = $1 AND job = $2 AND file = $3', [runner.id, b.slug, b.file])).rows[0];
        if (had?.uploaded_at && Number(had.size) === b.size) return sendJson(res, 200, { upload: false, url: null, pathname });
        let url;
        try { url = await blob().uploadUrl(pathname, { type, size: b.size }); } catch (err) {
          if (err instanceof BlobNotSetUp) throw new HttpError(503, err.message, { code: 'no-blob' });
          throw err;
        }
        await db.query(
          `INSERT INTO evidence_files (runner_id, person_id, job, file, pathname, content_type, size, asked_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (runner_id, job, file) DO UPDATE SET pathname = EXCLUDED.pathname, content_type = EXCLUDED.content_type, size = EXCLUDED.size, asked_at = EXCLUDED.asked_at, uploaded_at = NULL`,
          [runner.id, runner.personId, b.slug, b.file, pathname, type, b.size, iso(now())],
        );
        sendJson(res, 200, { upload: true, url, pathname });
      },
    },
    {
      method: 'POST', path: '/api/runner/evidence/done', auth: 'runner',
      async run({ req, res, runner }) {
        const b = await ctx.readJson(req, { max: 4096 });
        const { pathname } = await check(runner, b);
        if (b.pathname !== pathname) throw new HttpError(400, 'That isn’t where this file goes.');
        const there = await blob().exists(pathname);
        if (!there) throw new HttpError(409, 'The store doesn’t have that file. Upload it again.');
        await db.query('UPDATE evidence_files SET uploaded_at = $4, size = $5 WHERE runner_id = $1 AND job = $2 AND file = $3', [runner.id, b.slug, b.file, iso(now()), there.size]);
        await ctx.mirror.live.emit(runner.personId, 'thread', b.slug);
        sendJson(res, 200, { ok: true });
      },
    },
    {
      method: 'GET', path: /^\/api\/job\/([^/]+)\/evidence$/, auth: 'session',
      async run({ res, m, person }) {
        const rec = await records().get(person.id, 'evidence', m[1]);
        if (!rec && !(await records().get(person.id, 'job', m[1]))) throw new HttpError(404, 'No job by that name.');
        const { rows } = await db.query('SELECT file FROM evidence_files WHERE person_id = $1 AND job = $2 AND runner_id = $3 AND uploaded_at IS NOT NULL', [person.id, m[1], rec?.runnerId ?? 0]);
        const view = rec?.value ?? { evidence: null, commit: null, wanted: false, why: null, recording: false, problem: null };
        sendJson(res, 200, { ...view, folder: null, folderUrl: null, hosted: true, onSite: rows.map((r) => r.file) });
      },
    },
    {
      method: 'GET', path: /^\/api\/job\/([^/]+)\/evidence\/file$/, auth: 'session',
      async run({ res, url, m, person }) {
        const file = url.searchParams.get('path') ?? '';
        const row = (await db.query(
          `SELECT f.pathname FROM evidence_files f JOIN runners r ON r.id = f.runner_id
            WHERE f.person_id = $1 AND r.person_id = $1 AND r.revoked_at IS NULL AND f.job = $2 AND f.file = $3 AND f.uploaded_at IS NOT NULL
            ORDER BY f.uploaded_at DESC LIMIT 1`,
          [person.id, m[1], file],
        )).rows[0];
        if (!row) throw new HttpError(404, 'That file isn’t on the site, or it is still on its way from your laptop.');
        let link;
        try { link = await blob().readUrl(row.pathname); } catch (err) {
          if (err instanceof BlobNotSetUp) throw new HttpError(503, err.message, { code: 'no-blob' });
          throw err;
        }
        res.writeHead(302, { ...API_HEADERS, Location: link, 'Cache-Control': 'private, no-store' });
        res.end();
      },
    },
    { method: 'POST', path: /^\/api\/job\/([^/]+)\/evidence\/record$/, auth: 'session', async run() { throw new HttpError(409, 'Evidence is recorded on your laptop. Open the job there to record again.', { code: 'on-laptop' }); } },
  ];
}
