// The hosted site's one router (packet 2A). Vercel runs it as one Node function (api/index.js; the
// rewrite in vercel.json sends every /api/* there); the local server (dev.js) runs exactly the same
// handler under node:http, so tests and a laptop use the code Vercel runs.
//
// createSite({ db, config, fetch, now, staticDir }) → handler(req, res), with .close().
//   db         site/db.js: Postgres in production, PGlite in tests and on a laptop
//   config     site/config.js readConfig()
//   fetch      how the site reaches Google (the fake one in tests)
//   now        the clock (tests move it)
//   staticDir  the built page (the local server only; on Vercel the CDN serves it)
//   timers     { now, sleep(ms) }: real time, for the long-poll's wait (tests pass instant ones)
//
// The routes live in routes-*.js, each a list of { method, path, auth, run }:
//   path   an exact path, or a RegExp whose groups the route reads (ctx.m)
//   auth   'public'   anyone (the sign-in hops, /api/meta, the laptop's pairing calls)
//          'session'  a signed-in person (ctx.person); a change also needs the same origin
//          'owner'    the same, and the person is the owner
//          'runner'   a paired laptop's runner token (ctx.runner)
//          'cron'     Vercel Cron's CRON_SECRET
//   ready  false for the few routes that answer before the site is set up (/api/meta, the cron job);
//          every other route answers 503 naming the missing settings until they are all set
// A change (POST, PUT, DELETE) must be JSON. The fake Google (site/fake-google.js) answers under
// /fake-google/ only when AUTH_FAKE=1, which a production build refuses (site/config.js).

import fsp from 'node:fs/promises';
import path from 'node:path';
import { HttpError, PAGE_CSP, readJson, send, sendJson } from './http.js';
import metaRoutes from './routes-meta.js';
import cronRoutes from './routes-cron.js';
import authRoutes from './routes-auth.js';
import peopleRoutes from './routes-people.js';
import laptopRoutes from './routes-laptops.js';
import pairRoutes from './routes-pair.js';
import runnerRoutes from './routes-runner.js';
import jobRoutes from './routes-jobs.js';
import orbitRoutes from './routes-orbit.js';

const WRITES = new Set(['POST', 'PUT', 'DELETE']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

/** The lists of routes, in the order they are tried. Later steps add theirs. */
export const ROUTE_LISTS = [authRoutes, metaRoutes, cronRoutes, peopleRoutes, laptopRoutes, pairRoutes, runnerRoutes, jobRoutes, orbitRoutes];

const REAL_TIMERS = { now: () => Date.now(), sleep: (ms) => new Promise((r) => { setTimeout(r, ms).unref?.(); }) };

export function createSite({ db, config, fetch: fetchFn = globalThis.fetch, now = () => Date.now(), staticDir = null, extraRoutes = [], timers = REAL_TIMERS }) {
  const closers = [];
  const ctx = {
    db, config, now, timers, fetch: fetchFn, readJson,
    /** Something to stop when the site closes (timers, waiting requests). */
    onClose: (fn) => closers.push(fn),
  };
  // What each kind of caller must show (filled in by the sign-in and pairing parts).
  ctx.auth = {
    session: async () => { throw new HttpError(401, 'Sign in first.', { signIn: true }); },
    runner: async () => { throw new HttpError(401, 'This laptop isn’t paired with the site. Run ground-control login --site <the site’s address>.'); },
  };
  const routes = [...ROUTE_LISTS, ...extraRoutes].flatMap((list) => list(ctx));
  const extraHandlers = ctx.extraHandlers ?? [];

  function find(method, urlPath) {
    let pathMatched = false;
    for (const r of routes) {
      const m = typeof r.path === 'string' ? (r.path === urlPath ? [urlPath] : null) : r.path.exec(urlPath);
      if (!m) continue;
      pathMatched = true;
      if (r.method === method) return { r, m };
    }
    return pathMatched ? 'method' : null;
  }

  /** A change from a signed-in browser must come from this site's own pages. */
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (origin) {
      if (origin !== config.siteOrigin) throw new HttpError(403, 'This change must come from the site’s own page. Reload the page and try again.');
      return;
    }
    const site = req.headers['sec-fetch-site'];
    if (site !== 'same-origin') throw new HttpError(403, 'This change must come from the site’s own page. Reload the page and try again.');
  }

  async function authorize(r, req, res, call) {
    if (r.auth === 'public') return;
    if (r.auth === 'cron') {
      const want = config.cronSecret;
      if (!want || req.headers.authorization !== `Bearer ${want}`) throw new HttpError(401, 'Only the site’s scheduled job may call this.');
      return;
    }
    if (r.auth === 'runner') { call.runner = await ctx.auth.runner(req, res); return; }
    if (r.auth === 'session' || r.auth === 'owner') {
      const s = await ctx.auth.session(req, res);
      call.person = s.person;
      call.session = s.session;
      if (WRITES.has(req.method)) sameOrigin(req);
      if (r.auth === 'owner' && s.person.role !== 'owner') throw new HttpError(403, 'Only the site’s owner can do this.');
      return;
    }
    throw new Error(`A route without a known auth: ${r.method} ${r.path}`);
  }

  async function serveStatic(urlPath, res) {
    const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
    const file = path.resolve(staticDir, rel);
    if (!file.startsWith(path.resolve(staticDir) + path.sep)) return send(res, 404, 'Not found');
    let body;
    try { body = await fsp.readFile(file); } catch { return send(res, 404, 'Not found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Content-Security-Policy': PAGE_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cache-Control': rel === 'index.html' ? 'no-store' : 'public, max-age=300',
    });
    res.end(body);
  }

  // Requests still being answered: close() waits for them, so nothing touches a closed database.
  const inflight = new Set();
  async function handler(req, res) {
    const p = answer(req, res);
    inflight.add(p);
    try { return await p; } finally { inflight.delete(p); }
  }

  async function answer(req, res) {
    let url;
    let urlPath;
    try {
      url = new URL(req.url, config.siteUrl);
      urlPath = decodeURIComponent(url.pathname);
    } catch { return send(res, 400, 'Bad request'); }
    try {
      for (const h of extraHandlers) if (h.owns(urlPath)) return await h.handle(req, res, url);
      if (!urlPath.startsWith('/api/')) {
        if (staticDir && (req.method === 'GET' || req.method === 'HEAD')) return await serveStatic(urlPath, res);
        return send(res, 404, 'Not found');
      }
      const hit = find(req.method, urlPath);
      if (!(hit?.r?.ready === false) && config.noDatabase) {
        throw new HttpError(503, 'This deployment has no database, so the site doesn’t work here. The site runs at its own address.', { noDatabase: true });
      }
      if (!(hit?.r?.ready === false) && config.missing.length) {
        throw new HttpError(503, `The site isn’t set up yet. These settings are missing in Vercel: ${config.missing.join(', ')}.`, { missing: config.missing });
      }
      if (hit === 'method') throw new HttpError(405, 'That address doesn’t take this kind of request.');
      if (!hit) throw new HttpError(404, 'There is nothing at this address.');
      if (WRITES.has(req.method) && !String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
      const call = { req, res, url, m: hit.m, person: null, session: null, runner: null };
      await authorize(hit.r, req, res, call);
      return await hit.r.run(call);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message, ...err.extra });
      console.error(err);
      return sendJson(res, 500, { error: 'Something went wrong on the site. Try again in a moment.' });
    }
  }

  handler.ctx = ctx;
  handler.close = async () => {
    for (const fn of closers.splice(0)) await fn();
    await Promise.allSettled([...inflight]);
  };
  return handler;
}
