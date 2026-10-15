// The new UI's route (/next): files from web/dist, index fallback, traversal guard, MIME types
// and caching. Runs a tiny local server around lib/web-app.js on a temp folder; no SDK, no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { isWebAppPath, serveWebApp, IMMUTABLE } from '../lib/web-app.js';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { ...HEADERS, 'Content-Type': type, ...extra });
  res.end(body);
}

let tmp;
let dist;
let distDir; // swapped per test: the built folder or a missing one
let server;
let port;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-web-'));
  dist = path.join(tmp, 'dist');
  await fs.mkdir(path.join(dist, 'assets'), { recursive: true });
  await fs.writeFile(path.join(dist, 'index.html'), '<!doctype html><title>Feature Workshop</title>');
  await fs.writeFile(path.join(dist, 'favicon.ico'), 'ico');
  await fs.writeFile(path.join(dist, 'logo.png'), 'png');
  for (const name of ['index-DHFFf3mL.js', 'index-DHFFf3mL.js.map', 'index-Ab12_-Cd.css', 'inter-Zz9Yx8Wv.woff2', 'inter-Zz9Yx8Wv.woff', 'shot-Qq1Ww2Ee.webp', 'worker-Pp0Oo9Ii.mjs', 'plain.js']) {
    await fs.writeFile(path.join(dist, 'assets', name), name);
  }
  await fs.writeFile(path.join(tmp, 'secret.txt'), 'outside dist');
  distDir = dist;
  server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!isWebAppPath(urlPath)) return send(res, 418, 'not ours');
    serveWebApp(urlPath, res, { distDir, send });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await fs.rm(tmp, { recursive: true, force: true });
});

const get = async (p) => {
  const r = await fetch(`http://127.0.0.1:${port}${p}`);
  return { status: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control'), body: await r.text() };
};

// fetch() normalises "..", so traversal attempts go over a raw socket.
function rawGet(p) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write(`GET ${p} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    let data = '';
    sock.on('data', (d) => { data += d; });
    sock.on('end', () => resolve({ status: Number(data.split(' ')[1]), body: data.split('\r\n\r\n').slice(1).join('\r\n\r\n') }));
    sock.on('error', reject);
  });
}

test('only /next and /next/... belong to the new UI', () => {
  assert.equal(isWebAppPath('/next'), true);
  assert.equal(isWebAppPath('/next/'), true);
  assert.equal(isWebAppPath('/next/assets/a.js'), true);
  assert.equal(isWebAppPath('/nextish'), false);
  assert.equal(isWebAppPath('/'), false);
  assert.equal(isWebAppPath('/api/next'), false);
});

test('/next and /next/ serve the app page, never cached', async () => {
  for (const p of ['/next', '/next/']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.type, /^text\/html/);
    assert.match(r.body, /Feature Workshop/);
    assert.equal(r.cache, 'no-store');
  }
});

test('app routes without a file extension fall back to the page', async () => {
  for (const p of ['/next/job/demo-x', '/next/settings', '/next/assets/']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.body, /Feature Workshop/, p);
  }
});

test('missing files are a 404, not the page', async () => {
  for (const p of ['/next/assets/missing-AAAAAAAA.js', '/next/nope.png', '/next/robots.txt']) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.doesNotMatch(r.body, /Feature Workshop/, p);
  }
});

test('MIME types for build output, fonts and icons', async () => {
  const expect = {
    '/next/assets/index-DHFFf3mL.js': 'text/javascript; charset=utf-8',
    '/next/assets/worker-Pp0Oo9Ii.mjs': 'text/javascript; charset=utf-8',
    '/next/assets/index-DHFFf3mL.js.map': 'application/json; charset=utf-8',
    '/next/assets/index-Ab12_-Cd.css': 'text/css; charset=utf-8',
    '/next/assets/inter-Zz9Yx8Wv.woff2': 'font/woff2',
    '/next/assets/inter-Zz9Yx8Wv.woff': 'font/woff',
    '/next/assets/shot-Qq1Ww2Ee.webp': 'image/webp',
    '/next/favicon.ico': 'image/x-icon',
    '/next/logo.png': 'image/png',
  };
  for (const [p, type] of Object.entries(expect)) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.equal(r.type, type, p);
  }
});

test('long-lived cache only for hashed files under /next/assets/', async () => {
  assert.equal((await get('/next/assets/index-DHFFf3mL.js')).cache, IMMUTABLE);
  assert.equal((await get('/next/assets/inter-Zz9Yx8Wv.woff2')).cache, IMMUTABLE);
  assert.equal((await get('/next/assets/plain.js')).cache, 'no-store', 'unhashed asset');
  assert.equal((await get('/next/favicon.ico')).cache, 'no-store', 'outside assets/');
  assert.equal((await get('/next/')).cache, 'no-store', 'the page itself');
});

test('nothing outside web/dist can be read', async () => {
  for (const p of ['/next/../secret.txt', '/next/assets/../../secret.txt', '/next/%2e%2e/secret.txt', '/next/..%2fsecret.txt', '/next/%2e%2e%2f%2e%2e%2fpackage.json']) {
    const r = await rawGet(p);
    // 418: the URL parser already folded the ".." away, so the path left /next altogether.
    assert.ok([403, 404, 418].includes(r.status), `${p} -> ${r.status}`);
    assert.doesNotMatch(r.body, /outside dist/, p);
  }
  // An encoded slash survives URL parsing and decodes to "/next/../..", so the guard itself answers.
  assert.equal((await rawGet('/next/%2e%2e%2f%2e%2e%2fpackage.json')).status, 403);
  const nul = await rawGet('/next/index.html%00.png');
  assert.equal(nul.status, 404);
});

test('a friendly page when web/dist has not been built', async () => {
  distDir = path.join(tmp, 'not-built');
  try {
    for (const p of ['/next/', '/next/assets/index-DHFFf3mL.js']) {
      const r = await get(p);
      assert.equal(r.status, 503, p);
      assert.match(r.type, /^text\/html/);
      assert.match(r.body, /npm run web:build/);
    }
  } finally {
    distDir = dist;
  }
});
