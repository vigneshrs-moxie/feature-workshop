// Serves the new UI (built from web/ by `npm run web:build`) at /next and /next/.
// - Paths without a file extension get index.html, so links like /next/job/x still open the app.
// - Only files inside web/dist are ever read (traversal guard).
// - Hashed build assets under /next/assets/ may be cached for a year (their name changes when
//   their content does); everything else keeps the dashboard's no-store default.
// - If web/dist hasn't been built yet, a short page says how to build it.

import fsp from 'node:fs/promises';
import path from 'node:path';

export const WEB_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

export const IMMUTABLE = 'public, max-age=31536000, immutable';
// Vite names build files like index-DHFFf3mL.js (8 url-safe base64 characters).
const HASHED = /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+(\.map)?$/;

const NOT_BUILT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Feature Workshop: new view not built</title></head>
<body><h1>The new view isn't built yet</h1>
<p>In the Feature Workshop folder, run <code>npm run web:build</code>, then reload this page.</p>
<p>The classic dashboard still works at <a href="/">/</a>.</p></body></html>`;

export function isWebAppPath(urlPath) {
  return urlPath === '/next' || urlPath.startsWith('/next/');
}

// Decides what a /next request gets. `urlPath` is already percent-decoded.
// Returns { status, file?, type, cache?, body? }.
export async function resolveWebApp(urlPath, distDir) {
  const root = path.resolve(distDir);
  const index = path.join(root, 'index.html');
  if (!(await isFile(index))) return { status: 503, type: WEB_TYPES['.html'], body: NOT_BUILT };

  const rel = urlPath === '/next' ? '' : urlPath.slice('/next/'.length);
  if (rel.includes('\0')) return notFound();
  const file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) return { status: 403, type: WEB_TYPES['.txt'], body: 'Forbidden' };

  const ext = path.extname(file);
  if (rel !== '' && ext && (await isFile(file))) {
    const cache = rel.startsWith('assets/') && HASHED.test(rel) ? IMMUTABLE : undefined;
    return { status: 200, file, type: WEB_TYPES[ext] || 'application/octet-stream', cache };
  }
  // A missing file (anything with an extension) is a real 404; app routes get the page.
  if (ext && rel !== '') return notFound();
  return { status: 200, file: index, type: WEB_TYPES['.html'] };
}

// `send(res, status, body, type, extraHeaders)` is the dashboard's own sender (security headers).
export async function serveWebApp(urlPath, res, { distDir, send }) {
  const r = await resolveWebApp(urlPath, distDir);
  if (!r.file) return send(res, r.status, r.body, r.type);
  let body;
  try {
    body = await fsp.readFile(r.file);
  } catch {
    return send(res, 404, 'Not found');
  }
  return send(res, r.status, body, r.type, r.cache ? { 'Cache-Control': r.cache } : {});
}

function notFound() {
  return { status: 404, type: WEB_TYPES['.txt'], body: 'Not found' };
}

async function isFile(p) {
  try {
    return (await fsp.stat(p)).isFile();
  } catch {
    return false;
  }
}
