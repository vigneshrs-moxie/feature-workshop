// What the hosted tests share: a site on a fresh in-memory PGlite, reached through an in-process
// fetch (no port is opened: the request goes straight to the router's handler), a clock the tests
// move, and a browser-like cookie jar per made-up person.

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { readConfig } from '../site/config.js';
import { openPglite } from '../site/db.js';
import { migrate } from '../site/migrate.js';
import { createSite } from '../site/router.js';

export const SITE = 'http://localhost:4507';

export const TEST_ENV = Object.freeze({
  AUTH_FAKE: '1',
  SITE_URL: SITE,
  ALLOWED_DOMAIN: 'example.test',
  OWNER_EMAIL: 'olive.owner@example.test',
  SESSION_SECRET: 'test-session-secret-not-a-real-one-000000',
  CRON_SECRET: 'test-cron-secret-not-a-real-one-0000000',
});

/**
 * fetch() for one handler, in this process. A request to `origin` goes to the handler as a Node
 * request and response; anything else goes to `fallback` (which throws unless given), so a test
 * can never reach the network by mistake.
 */
export function inProcessFetch(getHandler, { origin = SITE, fallback = null } = {}) {
  return async function fetchIn(input, init = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    if (url.origin !== origin) {
      if (fallback) return fallback(input, init);
      throw new Error(`A test tried to reach ${url.origin}: only the site itself is allowed.`);
    }
    const headers = {};
    new Headers(init.headers ?? {}).forEach((v, k) => { headers[k] = v; });
    let body = init.body ?? null;
    if (body instanceof URLSearchParams) { body = body.toString(); headers['content-type'] ??= 'application/x-www-form-urlencoded'; }
    const buf = body === null ? Buffer.alloc(0) : Buffer.from(body);
    if (buf.length) headers['content-length'] = String(buf.length);
    headers.host ??= url.host;
    const req = Readable.from(buf.length ? [buf] : []);
    Object.assign(req, { method: (init.method ?? 'GET').toUpperCase(), url: url.pathname + url.search, headers });
    return new Promise((resolve, reject) => {
      const res = new EventEmitter();
      const chunks = [];
      let status = 200;
      let out = {};
      res.headersSent = false;
      res.writeHead = (s, h = {}) => { status = s; out = { ...out, ...h }; res.headersSent = true; return res; };
      res.setHeader = (k, v) => { out[k] = v; };
      res.getHeader = (k) => out[k];
      res.write = (c) => { chunks.push(Buffer.from(c)); return true; };
      res.end = (c) => {
        if (c !== undefined && c !== null) chunks.push(Buffer.from(c));
        const h = new Headers();
        for (const [k, v] of Object.entries(out)) for (const one of [].concat(v)) h.append(k, String(one));
        const bodyOut = [204, 304].includes(status) ? null : Buffer.concat(chunks);
        res.emit('finish');
        resolve(new Response(bodyOut, { status, headers: h }));
      };
      init.signal?.addEventListener('abort', () => { req.emit('close'); res.emit('close'); reject(init.signal.reason ?? new Error('aborted')); });
      Promise.resolve(getHandler()(req, res)).catch(reject);
    });
  };
}

/** A site on a fresh database. env: overrides of TEST_ENV. clock: { t } in ms, moved by the test. */
export async function makeSite({ env = {}, clock = { t: Date.parse('2026-10-30T16:00:00Z') } } = {}) {
  const db = await openPglite();
  await migrate(db);
  const config = readConfig({ ...TEST_ENV, ...env });
  let site = null;
  const fetch = inProcessFetch(() => site);
  site = createSite({ db, config, fetch, now: () => clock.t });
  return {
    site, db, config, clock, fetch,
    async close() { await site.close(); await db.close(); },
  };
}

/** A browser for one person: keeps the site's cookies and sends the page's own Origin on changes. */
export function browser(fetchFn, { origin = SITE } = {}) {
  const jar = new Map();
  const keep = (res) => {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const gone = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (gone || !value) jar.delete(name); else jar.set(name, value);
    }
  };
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  async function go(pathOrUrl, init = {}) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${origin}${pathOrUrl}`;
    const headers = { ...(init.headers ?? {}) };
    if (jar.size && url.startsWith(origin)) headers.cookie = cookieHeader();
    const res = await fetchFn(url, { ...init, headers, redirect: 'manual' });
    if (url.startsWith(origin)) keep(res);
    return res;
  }
  return {
    jar,
    get: (p, init = {}) => go(p, init),
    async json(p) { const r = await go(p); return { status: r.status, body: r.status === 204 ? null : await r.json() }; },
    async send(method, p, body = {}, { headers = {} } = {}) {
      const r = await go(p, { method, headers: { 'content-type': 'application/json', origin, ...headers }, body: JSON.stringify(body) });
      return { status: r.status, body: [204].includes(r.status) ? null : await r.json().catch(() => null) };
    },
  };
}

/** Signs a browser in through the fake Google. Resolves where the site sent it at the end. */
export async function signIn(b, { email, name = '', fakeCase = '', returnTo = null } = {}) {
  const start = await b.get(`/api/auth/start${returnTo ? `?return=${encodeURIComponent(returnTo)}` : ''}`);
  assert.equal(start.status, 302);
  const google = new URL(start.headers.get('location'));
  assert.equal(google.origin + google.pathname, `${SITE}/fake-google/authorize`);
  const cont = new URL(`${SITE}/fake-google/continue`);
  for (const [k, v] of google.searchParams) cont.searchParams.set(k, v);
  cont.searchParams.set('email', email);
  if (name) cont.searchParams.set('name', name);
  if (fakeCase) cont.searchParams.set('case', fakeCase);
  const back = await b.get(cont.toString());
  assert.equal(back.status, 302);
  const callback = back.headers.get('location');
  const done = await b.get(callback);
  assert.equal(done.status, 302);
  return { location: done.headers.get('location'), callback, google };
}

