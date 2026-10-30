// The small HTTP pieces every route uses: errors with a status and plain words, JSON answers with
// the site's safety headers, the request body (with a size cap), and cookies.

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Every answer from /api/*: never cached, never sniffed, no referrer leaves the page. */
export const API_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

/**
 * The page's own policy (the same as the local dashboard's, without the screens frame). On Vercel
 * hosted/vercel.json sends it with the static files; the local server sends it from here.
 */
export const PAGE_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export function send(res, status, body = '', type = 'text/plain; charset=utf-8', extra = {}) {
  if (res.headersSent) { res.end(); return; }
  const headers = { ...API_HEADERS, ...extra };
  if (body !== null && status !== 204 && status !== 304) headers['Content-Type'] = type;
  res.writeHead(status, headers);
  res.end(status === 204 ? undefined : body);
}

export const sendJson = (res, status, data, extra = {}) => send(res, status, JSON.stringify(data), 'application/json; charset=utf-8', extra);

/** A redirect (sign-in's hops), with the cookies to set. */
export function redirect(res, location, cookies = []) {
  res.writeHead(302, { ...API_HEADERS, Location: location, ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
  res.end();
}

/**
 * The JSON body, at most `max` bytes. On Vercel the Node helpers may already have read the stream
 * (req.body, a getter that parses on first use); then that is used instead.
 */
export async function readJson(req, { max = 64 * 1024 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new HttpError(413, `That is too much at once: at most ${Math.round(max / 1024)} KB.`);
    chunks.push(c);
  }
  let text = Buffer.concat(chunks).toString('utf8');
  if (!size && Number(req.headers['content-length'] ?? 0) > 0) {
    let pre;
    try { pre = req.body; } catch { throw new HttpError(400, 'That wasn’t valid JSON.'); }
    if (Buffer.isBuffer(pre)) text = pre.toString('utf8');
    else if (typeof pre === 'string') text = pre;
    else if (pre && typeof pre === 'object') text = JSON.stringify(pre);
    if (Buffer.byteLength(text) > max) throw new HttpError(413, `That is too much at once: at most ${Math.round(max / 1024)} KB.`);
  }
  if (!text.trim()) return {};
  let body;
  try { body = JSON.parse(text); } catch { throw new HttpError(400, 'That wasn’t valid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Send a JSON object.');
  return body;
}

/** The request's cookies, by name. */
export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!name || Object.hasOwn(out, name)) continue;
    try { out[name] = decodeURIComponent(part.slice(eq + 1).trim()); } catch { /* a malformed value: skip it */ }
  }
  return out;
}

/**
 * One Set-Cookie value: always HttpOnly, Secure and SameSite=Lax. Browsers keep Secure cookies
 * from http://localhost too (a secure context), so the local server needs no exception.
 */
export function cookie(name, value, { maxAge, path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'Secure', 'SameSite=Lax'];
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return parts.join('; ');
}
