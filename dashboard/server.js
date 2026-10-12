// Feature Workshop: local-only dashboard server.
// Binds to 127.0.0.1 so nothing outside this machine can reach it.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 4477;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = path.resolve(PUBLIC_DIR, rel);
  // Refuse anything that escapes the public folder.
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

const server = http.createServer((req, res) => {
  // Only answer requests addressed to this machine (blocks DNS-rebinding tricks).
  const host = (req.headers.host || '').split(':')[0];
  if (host !== '127.0.0.1' && host !== 'localhost') {
    res.writeHead(421).end('Misdirected request');
    return;
  }
  if (req.method !== 'GET') {
    res.writeHead(405).end('Method not allowed');
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Feature Workshop running at http://${HOST}:${PORT}  (Ctrl+C to stop)`);
});
