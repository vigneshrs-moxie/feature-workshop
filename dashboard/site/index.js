// The site: Ground Control's web half (plan §2, §2.1). The page, its routes and its event streams.
// It runs nothing on this computer itself: every change is one command of lib/protocol.js given to
// the runner (runner.handle), every read is runner.read, and the streams are fed from runner.on.
// So it imports no lib/driver.js, lib/local.js, lib/lock.js or child_process (a test checks).
//
// createSite({ runner, port, token, wireframesOrigin, dashboardDir }) returns the request handler
// for the dashboard's port, with:
//   .screens       the request handler for the screens server (a job's wireframes and walkthrough
//                  pages, on their own origin)
//   .screensOff()  the screens server couldn't listen: meta names no origin from now on
//
// The routes live in routes-*.js, each a list of { method, path, run } (path: the exact path or a
// pattern), mounted below from one list. The integration board, the Orbit Inbox and Telemetry
// answer every method under their own prefix ({ owns, mount }).

import fsp from 'node:fs/promises';
import path from 'node:path';
import { AGENTS } from '../lib/stages.js';
import { HttpError, checkWrite, hostAllowed } from '../lib/http-guard.js';
import { isWebAppPath, serveWebApp } from '../lib/web-app.js';
import { EventLog, resumePoint, openStream } from '../lib/events.js';
import { crewHeaders } from '../lib/play.js';
import jobRoutes from './routes-jobs.js';
import boardRoutes from './routes-board.js';
import settingsRoutes from './routes-settings.js';
import playRoutes from './routes-play.js';
import integrateRoutes from './routes-integrate.js';
import orbitRoutes from './routes-orbit.js';
import telemetryRoutes from './routes-telemetry.js';
import reposRoutes from './routes-repos.js';
import evidenceRoutes from './routes-evidence.js';

// Every list of routes, in the order they are tried.
const ROUTE_LISTS = [boardRoutes, evidenceRoutes, jobRoutes, settingsRoutes, playRoutes, reposRoutes];
// The parts that answer every method under their own prefix, tried before the lists above.
const MOUNTS = [integrateRoutes, orbitRoutes, telemetryRoutes];

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

const str = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : '');

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 256 * 1024) throw new HttpError(413, 'Too much data.');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'That wasn’t valid JSON.'); }
}

export function createSite({ runner, port, token, wireframesOrigin, dashboardDir }) {
  const { read, local } = runner;
  const PUBLIC_DIR = path.join(dashboardDir, 'public');
  // The new UI, built from web/ (npm run web:build), served at /next.
  const WEB_DIST = path.join(dashboardDir, '..', 'web', 'dist');
  const SHARED = { '/shared/compose.js': path.join(dashboardDir, 'lib', 'compose.js') };
  // Set when the screens server couldn't listen (its port is taken): meta then names no origin, so
  // the Screens tab frames nothing rather than whatever else answers on that port.
  let screensDown = false;

  const SECURITY_HEADERS = {
    // frame-src: the one frame this page opens is the screens server (the wireframes page, below).
    'Content-Security-Policy': `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src ${wireframesOrigin}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  // The wireframes page's own policy (the screens server's GET /job/:slug/wireframes): what
  // feature-wireframe's template loads and nothing more. KEEP IN STEP with the skill's template.html
  // and build.py. frame-ancestors names this dashboard by both names hostAllowed accepts; it is the
  // one frame header (X-Frame-Options would say SAMEORIGIN, which the second origin is not).
  const WIREFRAMES_CSP = [
    "default-src 'none'",
    "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "img-src data:",
    "font-src data: https://fonts.gstatic.com",
    `frame-ancestors http://127.0.0.1:${port} http://localhost:${port}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  // The screens server's headers: no token, no Play, no opener or resource policy (the page is a
  // cross-origin frame by design); just the policy above and the plain safety headers.
  const WIREFRAMES_HEADERS = { 'Content-Security-Policy': WIREFRAMES_CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
  // Play mode's easter-egg headers (the crew's names, the Clacks Overhead); none while it is Off.
  const CREW_HEADERS = crewHeaders(Object.values(AGENTS).map((a) => a.name));
  const playHeaders = () => (read.playOn() ? CREW_HEADERS : {});
  function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, ...playHeaders(), 'Content-Type': type, ...extra });
    res.end(body);
  }
  const sendJson = (res, status, data) => send(res, status, JSON.stringify(data), TYPES['.json']);

  async function serveStatic(urlPath, res) {
    if (SHARED[urlPath]) return send(res, 200, await fsp.readFile(SHARED[urlPath]), TYPES['.js']);
    const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
    const file = path.resolve(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
    try {
      send(res, 200, await fsp.readFile(file), TYPES[path.extname(file)] || 'application/octet-stream');
    } catch {
      send(res, 404, 'Not found');
    }
  }

  // ---------- Live updates (server-sent events) ----------

  // The new UI's stream (?v=2): every event the runner sends up, numbered for resuming (lib/events.js).
  const events = new EventLog();
  runner.on('*', (type, job, data, opts) => events.emit(type, job, data, opts));
  // The classic page's stream (/api/events).
  const clients = new Set();
  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
    for (const res of clients) res.write(payload);
  }
  runner.on('legacy', broadcast);

  function openEvents(req, res) {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
  }

  // ---------- The routes ----------

  /** What every route file gets. */
  const ctx = {
    runner, read, local, events, str, send, sendJson, readBody, TYPES, SECURITY_HEADERS, wireframesOrigin,
    // The page on this computer: both command lists (lib/protocol.js).
    LOCAL: { from: 'local' },
    /** What /api/meta says about this page: its write token and the screens server's origin. */
    pageMeta: () => ({ token, wireframesOrigin: screensDown ? null : wireframesOrigin }),
    /** A change must carry the page's token, from this page's own address, as JSON (lib/http-guard.js). */
    checkWrite: (req) => checkWrite(req.headers, { port, token }),
    /** 404 unless the job is there: every job route answers that first, before reading the rest. */
    async needJob(slug) {
      if (!(await read.hasJob(slug))) throw new HttpError(404, 'No job by that name.');
      return slug;
    },
  };
  const routes = ROUTE_LISTS.flatMap((list) => list(ctx));
  const mounts = MOUNTS.map((mount) => mount(ctx));
  const find = (method, urlPath) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      if (typeof r.path === 'string') { if (r.path === urlPath) return { r, m: null }; continue; }
      const m = r.path.exec(urlPath);
      if (m) return { r, m };
    }
    return null;
  };

  async function route(req, res, urlPath, url) {
    if (req.method === 'GET') {
      const hit = find('GET', urlPath);
      if (hit) return hit.r.run({ req, res, url, m: hit.m });
      if (urlPath.startsWith('/api/')) throw new HttpError(404, 'Not found');
      if (isWebAppPath(urlPath)) return serveWebApp(urlPath, res, { distDir: WEB_DIST, send });
      return serveStatic(urlPath, res);
    }
    if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return send(res, 405, 'Method not allowed');
    // Every change: the token and the body first, then the route (so a wrong path without the token is a 403).
    ctx.checkWrite(req);
    const body = await readBody(req);
    const hit = find(req.method, urlPath);
    if (!hit) throw new HttpError(404, 'Not found');
    return hit.r.run({ req, res, url, m: hit.m, body });
  }

  async function handler(req, res) {
    if (!hostAllowed(req.headers.host)) return send(res, 421, 'Misdirected request');
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, 'Bad request'); }
    let urlPath;
    try { urlPath = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Bad request'); }
    try {
      if (req.method === 'GET' && urlPath === '/api/events' && url.searchParams.get('v') === '2') {
        return openStream(req, res, { log: events, headers: SECURITY_HEADERS, resume: resumePoint(req.headers, url.searchParams) });
      }
      if (req.method === 'GET' && urlPath === '/api/events') return openEvents(req, res);
      for (const mount of mounts) if (mount.owns(urlPath)) return await mount.mount(req, res, urlPath, url);
      return await route(req, res, urlPath, url);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message, ...err.extra });
      console.error(err);
      return sendJson(res, 500, { error: 'Something went wrong. The details are in the terminal running the dashboard.' });
    }
  }

  // ---------- The screens server ----------
  // Its own origin (wireframesOrigin): one route, GET /job/:slug/wireframes, the job's
  // wireframes.html from its folder (lib/docs.js readWireframes: the one HTML file ever served from
  // there, never a symlink, nothing too big) under the page's own policy. The page may run its own
  // inline script and styles, show data: images and load the fonts and the two pinned libraries its
  // template names, and nothing else: no fetches, no other frames, no forms. Only this dashboard may
  // frame it. Being another origin, its script can't read the dashboard's document, storage or token,
  // and nothing here hands out the token or anything else: every other path is 404.
  const WIREFRAMES_ROUTE = /^\/job\/([^/]+)\/(wireframes|walkthrough)$/;
  const sendScreens = (res, status, body, type = 'text/plain; charset=utf-8') => { res.writeHead(status, { ...WIREFRAMES_HEADERS, 'Content-Type': type }); res.end(body); };
  async function screens(req, res) {
    if (!hostAllowed(req.headers.host)) return sendScreens(res, 421, 'Misdirected request');
    let urlPath;
    let download = false;
    try {
      const u = new URL(req.url, 'http://localhost');
      urlPath = decodeURIComponent(u.pathname);
      download = u.searchParams.get('download') === '1';
    } catch { return sendScreens(res, 400, 'Bad request'); }
    const m = req.method === 'GET' ? WIREFRAMES_ROUTE.exec(urlPath) : null;
    if (!m) return sendScreens(res, 404, 'Not found');
    try {
      const page = await read.screen(m[1], m[2], { forDownload: download });
      // ?download=1 on the walkthrough: the file as it was built, saved rather than shown, to send to a teammate.
      if (download && page.fileName) {
        res.writeHead(200, { ...WIREFRAMES_HEADERS, 'Content-Type': TYPES['.html'], 'Content-Disposition': `attachment; filename="${page.fileName}"` });
        return res.end(page.html);
      }
      return sendScreens(res, 200, page.html, TYPES['.html']);
    } catch (err) {
      if (err instanceof HttpError) return sendScreens(res, err.status, JSON.stringify({ error: err.message }), TYPES['.json']);
      console.error(err);
      return sendScreens(res, 500, JSON.stringify({ error: 'Something went wrong. The details are in the terminal running the dashboard.' }), TYPES['.json']);
    }
  }

  handler.screens = screens;
  /** The screens server couldn't listen: meta names no origin, and open pages fetch a fresh snapshot (with that meta). */
  handler.screensOff = () => {
    screensDown = true;
    local.changed();
  };
  return handler;
}
