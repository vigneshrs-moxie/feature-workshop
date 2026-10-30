// Evidence files on the site (packet 2B): the private Vercel Blob store `site-files`
// (docs/hosting/vercel-setup.md 2.4), or a fake one in tests and on a laptop.
//
//   uploadUrl(pathname, { type, size })   a signed PUT link for exactly that path, that type and at
//                                         most that size, for ten minutes: the laptop uploads straight
//                                         to the store with it (the bytes never pass through the site)
//   readUrl(pathname)                     a signed GET link for that path, for five minutes: the site
//                                         hands it only to the file's owner (routes-files.js)
//   exists(pathname)                      { size, contentType } or null
//   remove(pathnames)                     gone (a removed laptop's files)
//
// The real store: @vercel/blob's issueSignedToken and presignUrl. On Vercel the SDK authenticates
// with Vercel's own short-lived OIDC token and the store's BLOB_STORE_ID (both set by connecting
// the store to the project), so the site keeps no long-lived Blob key. A token is issued per path,
// scoped to that path and those operations, and reused until shortly before it ends.
//
// The fake: the same four calls, the files in memory, the signed links served by this site itself
// under /fake-blob/ (HMAC-signed, with the same path, type, size and time limits). Never in a
// production build: there, without a connected store, evidence says it isn't set up.

import crypto from 'node:crypto';

export const UPLOAD_MS = 10 * 60 * 1000;
export const READ_MS = 5 * 60 * 1000;
const TOKEN_MS = 60 * 60 * 1000;

export class BlobNotSetUp extends Error {}

/** Which store this site uses: 'real' (a connected store), 'fake' (not production) or null. */
export function blobKind({ production, env = process.env }) {
  if (env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN) return 'real';
  return production ? null : 'fake';
}

export function makeBlob({ config, env = process.env, now = () => Date.now(), sdk = null }) {
  const kind = blobKind({ production: config.production, env });
  if (kind === 'real') return realBlob({ now, sdk });
  if (kind === 'fake') return fakeBlob({ siteUrl: config.siteUrl, now });
  const no = () => { throw new BlobNotSetUp('File storage isn’t connected to the site yet, so screenshots and videos stay on your laptop.'); };
  return { kind: 'none', uploadUrl: no, readUrl: no, exists: async () => null, remove: async () => {}, handler: null };
}

function realBlob({ now, sdk }) {
  let lib = sdk;
  const load = async () => (lib ??= await import('@vercel/blob'));
  const tokens = new Map(); // `${op}:${pathname}` -> issued token
  async function tokenFor(op, pathname, extra = {}) {
    const key = `${op}:${pathname}:${JSON.stringify(extra)}`;
    const had = tokens.get(key);
    if (had && had.validUntil - now() > 2 * 60 * 1000) return had;
    const { issueSignedToken } = await load();
    const t = await issueSignedToken({ pathname, operations: [op], validUntil: now() + TOKEN_MS, ...extra });
    tokens.set(key, t);
    if (tokens.size > 500) tokens.delete(tokens.keys().next().value);
    return t;
  }
  return {
    kind: 'real',
    async uploadUrl(pathname, { type, size }) {
      const { presignUrl } = await load();
      const limits = { allowedContentTypes: [type], maximumSizeInBytes: size };
      const t = await tokenFor('put', pathname, limits);
      const { presignedUrl } = await presignUrl(t, { operation: 'put', pathname, access: 'private', ...limits, addRandomSuffix: false, allowOverwrite: true, validUntil: now() + UPLOAD_MS });
      return presignedUrl;
    },
    async readUrl(pathname) {
      const { presignUrl } = await load();
      const t = await tokenFor('get', pathname);
      const { presignedUrl } = await presignUrl(t, { operation: 'get', pathname, access: 'private', validUntil: now() + READ_MS });
      return presignedUrl;
    },
    async exists(pathname) {
      const { head } = await load();
      try { const h = await head(pathname); return { size: h.size, contentType: h.contentType }; } catch { return null; }
    },
    async remove(pathnames) {
      if (!pathnames.length) return;
      const { del } = await load();
      await del(pathnames).catch(() => {});
    },
    handler: null,
  };
}

/** The fake store, with its own signed links under /fake-blob/ on this site. */
export function fakeBlob({ siteUrl, now }) {
  const key = crypto.randomBytes(32);
  const files = new Map(); // pathname -> { bytes, contentType }
  const sign = (parts) => crypto.createHmac('sha256', key).update(parts.join('\n')).digest('base64url');
  const link = (op, pathname, limits = {}, ms) => {
    const exp = String(now() + ms);
    const u = new URL(`${siteUrl}/fake-blob/${pathname.split('/').map(encodeURIComponent).join('/')}`);
    u.searchParams.set('op', op);
    u.searchParams.set('exp', exp);
    if (limits.type) u.searchParams.set('type', limits.type);
    if (limits.size !== undefined) u.searchParams.set('max', String(limits.size));
    u.searchParams.set('sig', sign([op, pathname, exp, limits.type ?? '', String(limits.size ?? '')]));
    return u.toString();
  };
  const handler = {
    owns: (p) => p.startsWith('/fake-blob/'),
    async handle(req, res, url) {
      const pathname = decodeURIComponent(url.pathname.slice('/fake-blob/'.length));
      const q = url.searchParams;
      const op = q.get('op');
      const ok = q.get('sig') === sign([op, pathname, q.get('exp') ?? '', q.get('type') ?? '', q.get('max') ?? '']) && Number(q.get('exp')) > now();
      const end = (status, body = '') => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); };
      if (!ok) return end(403, 'This link isn’t valid, or it has run out.');
      if (req.method === 'PUT' && op === 'put') {
        const type = String(req.headers['content-type'] ?? '');
        if (type !== q.get('type')) return end(400, 'That type isn’t allowed here.');
        const chunks = [];
        let size = 0;
        for await (const c of req) { size += c.length; if (size > Number(q.get('max'))) return end(413, 'Too big.'); chunks.push(c); }
        files.set(pathname, { bytes: Buffer.concat(chunks), contentType: type });
        return end(200, JSON.stringify({ pathname }));
      }
      if (req.method === 'GET' && op === 'get') {
        const f = files.get(pathname);
        if (!f) return end(404, 'Not found');
        res.writeHead(200, { 'Content-Type': f.contentType, 'Content-Length': String(f.bytes.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(f.bytes);
      }
      return end(405, 'Not this way.');
    },
  };
  return {
    kind: 'fake',
    files,
    uploadUrl: async (pathname, { type, size }) => link('put', pathname, { type, size }, UPLOAD_MS),
    readUrl: async (pathname) => link('get', pathname, {}, READ_MS),
    exists: async (pathname) => { const f = files.get(pathname); return f ? { size: f.bytes.length, contentType: f.contentType } : null; },
    remove: async (pathnames) => { for (const p of pathnames) files.delete(p); },
    handler,
  };
}
