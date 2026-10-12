// Feature Workshop: local-only dashboard server.
// Binds to 127.0.0.1 so nothing outside this machine can reach it. Read-only towards
// features, repositories and session logs.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFeatures, SessionIndex } from './lib/features.js';
import { STAGES, AGENTS } from './lib/stages.js';
import { PRICES, PRICES_AS_OF } from './lib/cost.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 4477;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const FEATURES_DIR = path.resolve(process.env.WORKSHOP_FEATURES_DIR || path.join(CLAUDE_DIR, 'feature-work'));
const PROJECTS_DIR = path.resolve(process.env.WORKSHOP_PROJECTS_DIR || path.join(CLAUDE_DIR, 'projects'));

const sessionIndex = new SessionIndex(PROJECTS_DIR);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type });
  res.end(body);
}
const sendJson = (res, status, data) => send(res, status, JSON.stringify(data), TYPES['.json']);

async function serveStatic(urlPath, res) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  try {
    const body = await fsp.readFile(file);
    send(res, 200, body, TYPES[path.extname(file)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found');
  }
}

// ---------- Data ----------

let cached = null; // { at, features }
async function features() {
  // Small cache so a burst of requests shares one scan; file changes clear it.
  if (cached && Date.now() - cached.at < 2000) return cached.features;
  const list = await loadFeatures({ featuresDir: FEATURES_DIR, sessionIndex });
  cached = { at: Date.now(), features: list };
  return list;
}

const ACTIVE = new Set(['running', 'stalled']);

function boardCard(f) {
  return {
    slug: f.slug,
    title: f.title,
    kind: f.kind,
    kindGuessed: f.kindGuessed,
    project: f.project,
    route: f.route,
    skipped: f.skipped,
    stage: f.stage,
    stageState: f.stageState,
    waitingFor: f.waitingFor,
    waitingSince: f.waitingSince,
    needsYou: f.needsYou,
    working: f.working,
    stalled: f.stalled,
    nowDoing: f.activity.filter((a) => ACTIVE.has(a.state)).map((a) => ({
      who: a.who, name: a.name, state: a.state, doing: a.doing,
      since: a.who === 'conductor' ? a.since : a.startedAt ?? a.since, lastAt: a.lastAt,
    })),
    firstQuestion: f.questions[0]?.text ?? null,
    questions: f.questions.length,
    unconfirmed: f.decidedOnYourBehalf.filter((d) => !d.confirmed).length,
    headline: f.latestBrief?.headline ?? null,
    nextProposed: f.nextProposed,
    cost: { totalUsd: f.cost.totalUsd, source: f.cost.source },
    updatedAt: f.updatedAt,
    sources: f.sources,
  };
}

const routes = {
  '/api/meta': async () => ({
    stages: STAGES,
    agents: AGENTS,
    prices: { asOf: PRICES_AS_OF, models: PRICES },
    featuresDir: FEATURES_DIR,
    demo: Boolean(process.env.WORKSHOP_DEMO),
  }),
  '/api/features': async () => {
    const list = await features();
    const totalUsd = list.reduce((a, f) => a + f.cost.totalUsd, 0);
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const spend = await sessionIndex.spendSince({ today: startOfToday.getTime(), week: startOfToday.getTime() - 6 * 86400000 });
    const agents = list.flatMap((f) => f.activity);
    const stats = {
      today: spend.today,
      week: spend.week,
      featuresUsd: totalUsd,
      needsYou: list.filter((f) => f.needsYou).length,
      workingAgents: agents.filter((a) => a.state === 'running').length,
      workingFeatures: list.filter((f) => f.working).length,
      stalled: list.filter((f) => f.stalled).length,
      inProgress: list.filter((f) => f.stageState !== 'done').length,
      done: list.filter((f) => f.stageState === 'done').length,
      projects: new Set(list.map((f) => f.project.name)).size,
    };
    return { features: list.map(boardCard), needsYou: stats.needsYou, totalUsd, stats, generatedAt: new Date().toISOString() };
  },
};

// ---------- Live updates (server-sent events) ----------

const clients = new Set();
let changeTimer = null;
function notifyChange() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    cached = null;
    for (const res of clients) res.write(`event: change\ndata: ${Date.now()}\n\n`);
  }, 800);
}
function watch(dir) {
  try {
    fs.watch(dir, { recursive: true }, notifyChange).on('error', () => {});
  } catch {
    console.warn(`Not watching ${dir} (missing or not supported); the page still refreshes every 30 seconds.`);
  }
}

function openEvents(req, res) {
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}

// ---------- Server ----------

const server = http.createServer(async (req, res) => {
  // Only answer requests addressed to this machine (blocks DNS-rebinding tricks).
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  if (host !== '127.0.0.1' && host !== 'localhost') return send(res, 421, 'Misdirected request');
  if (req.method !== 'GET') return send(res, 405, 'Method not allowed');

  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  try {
    if (urlPath === '/api/events') return openEvents(req, res);
    if (routes[urlPath]) return sendJson(res, 200, await routes[urlPath]());
    if (urlPath.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
    return serveStatic(urlPath, res);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: 'Something went wrong reading the workflow files. See the terminal.' });
  }
});

watch(FEATURES_DIR);
watch(PROJECTS_DIR);
server.listen(PORT, HOST, () => {
  console.log(`Feature Workshop running at http://${HOST}:${PORT}  (Ctrl+C to stop)`);
  console.log(`  features: ${FEATURES_DIR}`);
  console.log(`  sessions: ${PROJECTS_DIR}`);
});
