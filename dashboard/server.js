// Feature Workshop: local-only dashboard server.
// Listens on 127.0.0.1 only. Reads workflow files, session logs and git (read-only).
// What it changes goes through a job's Foreman session, and only when you click. The one exception
// is "Try it on your computer" (lib/local.js): on your click it runs the job's app, your commands
// and database switches in the job's own worktree.
//
// The machine half (the Foreman driver, job folders, git, Try it, usage, notifications, the Orbit
// token) is the runner (runner/index.js). Everything below talks to it only through
// runner.handle (one command of lib/protocol.js), runner.read and runner.on.

import http from 'node:http';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AGENTS } from './lib/stages.js';
import { HttpError, checkWrite, hostAllowed } from './lib/http-guard.js';
import { isWebAppPath, serveWebApp } from './lib/web-app.js';
import { EventLog, resumePoint, openStream } from './lib/events.js';
import { NUDGE_IDS } from './lib/nudges.js';
import { MAX_CHIPS } from './lib/compose.js';
import { crewHeaders } from './lib/play.js';
import { IntegrateError } from './lib/integrate.js';
import { inboxItem, scrubDeep } from './lib/orbit.js';
import { WINDOWS as TELEMETRY_WINDOWS } from './lib/telemetry.js';
import { createRunner, NOTES_MAX } from './runner/index.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 4477;
// The screens server: a job's wireframes.html is served from this SECOND origin (PORT + 1 unless
// WIREFRAMES_PORT says otherwise), so the page's own script can't reach this dashboard's document,
// storage or token however it was written. The web frames it from meta.wireframesOrigin.
const WIREFRAMES_PORT = Number(process.env.WIREFRAMES_PORT) || PORT + 1;
const WIREFRAMES_ORIGIN = `http://${HOST}:${WIREFRAMES_PORT}`;
// Set when the screens server couldn't listen (its port is taken): meta then names no origin, so
// the Screens tab frames nothing rather than whatever else answers on that port.
let screensDown = false;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
// The new UI, built from web/ (npm run web:build), served at /next.
const WEB_DIST = path.join(HERE, '..', 'web', 'dist');
const SHARED = { '/shared/compose.js': path.join(HERE, 'lib', 'compose.js') };
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const FEATURES_DIR = path.resolve(process.env.WORKSHOP_FEATURES_DIR || path.join(CLAUDE_DIR, 'feature-work'));
const PROJECTS_DIR = path.resolve(process.env.WORKSHOP_PROJECTS_DIR || path.join(CLAUDE_DIR, 'projects'));
const DEMO = Boolean(process.env.WORKSHOP_DEMO);
const TOKEN = crypto.randomBytes(24).toString('hex');

const runner = await createRunner({
  host: HOST, port: PORT, token: TOKEN, dashboardDir: HERE, claudeDir: CLAUDE_DIR,
  featuresDir: FEATURES_DIR, projectsDir: PROJECTS_DIR,
  agentsDir: path.resolve(process.env.WORKSHOP_AGENTS_DIR || path.join(CLAUDE_DIR, 'agents')),
  skillsDir: path.resolve(process.env.WORKSHOP_SKILLS_DIR || path.join(CLAUDE_DIR, 'skills')),
  stateDir: process.env.WORKSHOP_STATE_DIR || (DEMO ? path.join(path.dirname(FEATURES_DIR), 'state') : undefined),
  demo: DEMO, claudePath: process.env.WORKSHOP_CLAUDE_PATH || null,
  claudeSettingsFile: path.resolve(process.env.WORKSHOP_CLAUDE_SETTINGS || path.join(CLAUDE_DIR, 'settings.json')),
  gateParkMs: process.env.WORKSHOP_GATE_PARK_MS,
  planUsage: !DEMO && process.env.WORKSHOP_PLAN_USAGE !== 'off',
  orbitStore: DEMO || process.env.WORKSHOP_ORBIT_STORE === 'file' ? 'file' : 'auto',
  integrateDir: path.resolve(process.env.GROUND_CONTROL_DIR || path.join(os.homedir(), '.ground-control')),
  integrateRoot: path.resolve(process.env.INTEGRATE_ROOT || path.join(HERE, '..')),
});
const { read, local } = runner;
// The page on this computer: both command lists (lib/protocol.js).
const LOCAL = { from: 'local' };
// What /api/meta says about this page: its write token and the screens server's origin.
const pageMeta = () => ({ token: TOKEN, wireframesOrigin: screensDown ? null : WIREFRAMES_ORIGIN });

// ---------- HTTP ----------

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
const SECURITY_HEADERS = {
  // frame-src: the one frame this page opens is the screens server (the wireframes page, below).
  'Content-Security-Policy': `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src ${WIREFRAMES_ORIGIN}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
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
  `frame-ancestors http://127.0.0.1:${PORT} http://localhost:${PORT}`,
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

const str = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : '');

// ---------- Reading what the page sent (…/send and …/gate) ----------

// The gate card's body, checked: kind, the brief it answers, at most 3 answers, 20 verdicts,
// MAX_CHIPS chips and a 4,000-character note. Anything off is a 400, and nothing is sent.
const GATE_KINDS = ['approve', 'changes', 'message', 'stop'];
const GATE_NOTE_MAX = 4000;
function byId(v, max, what, each) {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, `${what}: expected them by id.`);
  const entries = Object.entries(v);
  if (entries.length > max) throw new HttpError(400, `${what}: at most ${max}.`);
  return Object.fromEntries(entries.map(([k, x]) => {
    if (k.length > 100 || !x || typeof x !== 'object' || Array.isArray(x)) throw new HttpError(400, `${what}: one of them isn’t readable.`);
    return [k, each(x)];
  }));
}
// A brief number from the page (1–99,999), or null when none is given.
function readBriefNumber(v) {
  if (v === undefined || v === null) return null;
  if (!Number.isInteger(v) || v < 1 || v > 99999) throw new HttpError(400, 'That isn’t a brief number.');
  return v;
}
function readGateBody(body) {
  const kind = GATE_KINDS.includes(body.kind) ? body.kind : null;
  if (!kind) throw new HttpError(400, 'Unknown decision: approve, changes, message or stop.');
  const briefNumber = readBriefNumber(body.briefNumber);
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') throw new HttpError(400, 'The note must be text.');
  const note = body.note ?? '';
  if (note.length > GATE_NOTE_MAX) throw new HttpError(400, `The note is too long (at most ${GATE_NOTE_MAX.toLocaleString('en')} characters).`);
  if (kind === 'changes' && !note.trim()) throw new HttpError(400, 'Say what to change.');
  const answers = byId(body.answers, 3, 'Answers', (a) => ({ ...(str(a.choice, 100) ? { choice: str(a.choice, 100) } : {}), ...(str(a.other, 1000) ? { other: str(a.other, 1000) } : {}) }));
  const verdicts = byId(body.verdicts, 20, 'Verdicts', (v) => {
    if (!['confirm', 'change'].includes(v.verdict)) throw new HttpError(400, 'Verdicts: confirm or change.');
    return { verdict: v.verdict, ...(str(v.note, 1000) ? { note: str(v.note, 1000) } : {}) };
  });
  if (body.chips !== undefined && body.chips !== null && !Array.isArray(body.chips)) throw new HttpError(400, 'Chips: expected a list.');
  const chips = body.chips ?? [];
  if (chips.length > MAX_CHIPS) throw new HttpError(400, `Chips: at most ${MAX_CHIPS}.`);
  // Chips change how the next stage runs; a stop has no next stage.
  if (kind === 'stop' && chips.length) throw new HttpError(400, 'A stop can’t carry option changes.');
  // "Edit, then approve": the reply as you edited it, sent instead of the composed one (the chips
  // still change the options). Approvals only; the same 20,000 characters as /send.
  if (body.text !== undefined && body.text !== null && typeof body.text !== 'string') throw new HttpError(400, 'The edited reply must be text.');
  tooLong(body.text, 'The edited reply');
  const edited = str(body.text ?? '').trim() || null;
  if (edited && kind !== 'approve') throw new HttpError(400, 'Only an approval can carry an edited reply.');
  return { kind, briefNumber, note, answers, verdicts, chips, edited, startAfterReset: body.startAfterReset === true };
}

// A reply (…/send text, …/gate edited text) longer than this is refused, not cut short.
const TEXT_MAX = 20000;
function tooLong(v, what) {
  if (typeof v === 'string' && v.length > TEXT_MAX) throw new HttpError(400, `${what} is too long (at most ${TEXT_MAX.toLocaleString('en')} characters).`);
}
// The most text POST /api/job/:slug/render previews at once (characters).
const RENDER_MAX = 100000;

/** What every message to a Foreman may say about how it is sent: the model, despite the limit, no terminal open. */
const sendFields = (body) => ({
  model: typeof body.model === 'string' ? body.model.slice(0, 100) : undefined,
  despiteLimit: body.despiteLimit === true ? true : undefined,
  confirmNoTerminal: body.confirmNoTerminal === true ? true : undefined,
});

/** 404 unless the job is there: every job route answers that first, before reading the rest. */
async function needJob(slug) {
  if (!(await read.hasJob(slug))) throw new HttpError(404, 'No job by that name.');
  return slug;
}

const GET = {
  '/api/meta': () => read.meta(pageMeta()),
  // Notifications outside the browser: how they reach macOS here, and the last 50.
  '/api/notifications': () => read.notifications(),
  // The flow map (Home): each repo's jobs on their way to staging and main (lib/flow.js).
  '/api/flow': () => read.flow(),
  // Everything the new UI needs to draw itself, in one call. `seq` is the newest live event at the
  // moment the snapshot started: open /api/events?v=2&since=<seq>&epoch=<epoch> to carry on from
  // it. Events that also made it into the snapshot may arrive again; applying them twice is harmless.
  '/api/snapshot': async () => {
    const seq = events.seq;
    return { v: 2, seq, epoch: events.epoch, ...(await read.snapshot(pageMeta())) };
  },
  '/api/features': () => read.features(),
  '/api/runs': () => read.runs(),
  // The play ledger (lib/play.js ledgerView): crew met, quests done, achievements, secrets found.
  '/api/play': () => read.play(),
  // Your "Always allow" rules.
  '/api/rules': () => read.rules(),
  '/api/repos': () => read.repos(),
  '/api/costs': () => read.costs(),
};

async function routeGet(urlPath, url, req, res) {
  if (GET[urlPath]) return sendJson(res, 200, await GET[urlPath]());
  if (urlPath === '/api/teapot' && read.playOn()) {
    // A real 418. Found from this browser or a terminal (never from another site's page), it is a
    // secret; come from the X-Crew-Note header (?from=headers), so is that one.
    const site = req.headers['sec-fetch-site'];
    if (!site || site === 'same-origin' || site === 'none') {
      await local.recordSecret('teapot');
      if (url.searchParams.get('from') === 'headers') await local.recordSecret('headers');
    }
    return sendJson(res, 418, local.teapot);
  }
  const day = new Date().toISOString().slice(0, 10);
  if (urlPath === '/api/costs/export.csv') return send(res, 200, await read.costsCsv(), TYPES['.csv'], { 'Content-Disposition': `attachment; filename="feature-costs-${day}.csv"` });
  if (urlPath === '/api/costs/export.md') return send(res, 200, await read.costsMarkdown(), TYPES['.md'], { 'Content-Disposition': `attachment; filename="feature-costs-${day}.md"` });
  if (urlPath === '/api/history') {
    const p = url.searchParams;
    return sendJson(res, 200, await read.history({ q: p.get('q'), repo: p.get('repo'), linked: p.get('linked'), dashboard: p.get('dashboard'), test: p.get('test') }));
  }
  const hm = /^\/api\/history\/([0-9a-f-]{36})$/.exec(urlPath);
  if (hm) return sendJson(res, 200, await read.historyDetail(hm[1]));
  const dm = /^\/api\/jobs\/([^/]+)\/decisions\.md$/.exec(urlPath);
  if (dm) {
    // The job's decisions.md (lib/decisions.js), written again first so it has every decision so
    // far. As JSON for the Decisions tab (the text and "Copy for the ticket"), else the file itself.
    const d = await read.decisionsFile(decodeURIComponent(dm[1]));
    if (!String(req.headers.accept ?? '').includes('application/json')) return send(res, 200, d.text, 'text/plain; charset=utf-8', { 'Cache-Control': 'no-store' });
    return sendJson(res, 200, d);
  }
  let m = /^\/api\/job\/([^/]+)(\/.*)?$/.exec(urlPath);
  if (m) {
    const slug = await needJob(m[1]);
    const sub = m[2] ?? '';
    // "Load older": only the thread items before the given one.
    if (!sub && url.searchParams.has('before')) return sendJson(res, 200, await read.threadBefore(slug, str(url.searchParams.get('before'), 300)));
    if (!sub) return sendJson(res, 200, await read.job(slug));
    if (sub === '/notes') return sendJson(res, 200, await read.notes(slug));
    // The Decisions tab: every choice you made on this job, newest first (lib/decisions.js).
    if (sub === '/decisions') return sendJson(res, 200, await read.decisions(slug));
    if (sub === '/docs') return sendJson(res, 200, await read.docs(slug));
    if (sub === '/wireframes') {
      // The screens page is never served from this origin: an HTML file a model wrote would share
      // the dashboard's document, storage and token. The screens server (below) serves it instead.
      throw new HttpError(410, `The screens page is served from its own address: ${WIREFRAMES_ORIGIN}/job/<slug>/wireframes (meta.wireframesOrigin).`);
    }
    if (sub === '/doc') return sendJson(res, 200, await read.doc(slug, url.searchParams.get('file') ?? ''));
    if ((m = /^\/ids\/([^/]+)$/.exec(sub))) return sendJson(res, 200, await read.ids(slug, decodeURIComponent(m[1])));
    if (sub === '/local') return sendJson(res, 200, await read.localView(slug, { fresh: url.searchParams.get('fresh') === '1' }));
    if (sub === '/commits') return sendJson(res, 200, await read.commits(slug));
    // One commit's diff, for the live view: answered to the asker only.
    if ((m = /^\/commit\/([0-9a-fA-F]{4,40})$/.exec(sub))) return sendJson(res, 200, await runner.handle({ type: 'fetch-diff', slug, commit: m[1] }, LOCAL));
  }
  if (urlPath.startsWith('/api/')) throw new HttpError(404, 'Not found');
  if (isWebAppPath(urlPath)) return serveWebApp(urlPath, res, { distDir: WEB_DIST, send });
  return serveStatic(urlPath, res);
}

async function routePost(urlPath, req, res) {
  checkWrite(req.headers, { port: PORT, token: TOKEN });
  const body = await readBody(req);
  let m;
  if (urlPath === '/api/presence') {
    // The page is visible: notifications that it shows anyway don't pop on macOS meanwhile.
    local.presence(body.visible);
    return sendJson(res, 200, { ok: true });
  }
  if (urlPath === '/api/notifications/test') return sendJson(res, 200, await local.testNotification());
  // Fetch both remotes and read the PRs now (read-only), instead of waiting for the next 10-minute refresh.
  if (urlPath === '/api/flow/refresh') return sendJson(res, 202, local.refreshFlow());
  if ((m = /^\/api\/job\/([^/]+)\/render$/.exec(urlPath))) {
    // Markdown you are writing (the drawer's notes Preview), rendered by the same sanitising renderer
    // as every document. Nothing is saved or sent anywhere; a POST only so the text isn't in a URL.
    const slug = await needJob(m[1]);
    if (typeof body.text !== 'string') throw new HttpError(400, 'The text to preview must be text.');
    if (body.text.length > RENDER_MAX) throw new HttpError(413, `Too long to preview (at most ${RENDER_MAX.toLocaleString('en')} characters).`);
    return sendJson(res, 200, await read.render(slug, body.text));
  }
  if ((m = /^\/api\/job\/([^/]+)\/send$/.exec(urlPath))) {
    const slug = await needJob(m[1]);
    tooLong(body.text, 'The message');
    const text = str(body.text).trim();
    if (!text) throw new HttpError(400, 'The message is empty.');
    // gateBrief: a gate reply composed while a reply was in progress (…/gate gave the text back) and
    // sent now; it still answers that brief, so it must still be the current one (as …/gate checks).
    const gateBrief = readBriefNumber(body.gateBrief);
    const kind = str(body.kind, 20) || 'message';
    return sendJson(res, 200, await runner.handle({ type: 'reply', slug, via: 'box', text, kind, gateBrief, ...sendFields(body) }, LOCAL));
  }
  if ((m = /^\/api\/job\/([^/]+)\/nudge\/([\w-]+)\/(dismiss|yes)$/.exec(urlPath))) {
    // A hand-off nudge on the Desk (lib/nudges.js): dismiss it, or send its one sentence to the Foreman.
    const slug = await needJob(m[1]);
    if (!NUDGE_IDS.includes(m[2])) throw new HttpError(404, 'No nudge by that name.');
    return sendJson(res, 200, await runner.handle({ type: 'nudge', slug, nudge: m[2], answer: m[3], ...sendFields(body) }, LOCAL));
  }
  if ((m = /^\/api\/job\/([^/]+)\/gate$/.exec(urlPath))) {
    // A decision from the gate card: answers, verdicts, next-step chips and a note (readGateBody),
    // composed into the reply by the runner.
    const slug = await needJob(m[1]);
    const g = readGateBody(body);
    const type = { approve: 'approve', changes: 'send-back', stop: 'stop', message: 'reply' }[g.kind];
    const command = {
      type, slug, briefNumber: g.briefNumber, note: g.note, answers: g.answers, verdicts: g.verdicts, chips: g.chips, startAfterReset: g.startAfterReset,
      ...(type === 'reply' ? { via: 'card' } : {}), ...(g.edited ? { text: g.edited } : {}), ...sendFields(body),
    };
    return sendJson(res, 200, await runner.handle(command, LOCAL));
  }
  if ((m = /^\/api\/job\/([^/]+)\/takeover$/.exec(urlPath))) return sendJson(res, 200, await runner.handle({ type: 'take-over', slug: await needJob(m[1]) }, LOCAL));
  if ((m = /^\/api\/job\/([^/]+)\/repo$/.exec(urlPath))) {
    const slug = await needJob(m[1]);
    return sendJson(res, 200, await runner.handle({ type: 'repo', slug, repoPath: str(body.repoPath, 1000), branch: str(body.branch, 200).trim() || null }, LOCAL));
  }
  if (urlPath === '/api/settings') {
    const { notify, workflow, play, policy } = body;
    return sendJson(res, 200, await runner.handle({ type: 'settings', notify, workflow, play, policy, recheckAuto: body.recheckAuto === true ? true : undefined }, LOCAL));
  }
  // One job's own permission setting; null clears it (the job follows your global setting again).
  if ((m = /^\/api\/job\/([^/]+)\/policy$/.exec(urlPath))) return sendJson(res, 200, await runner.handle({ type: 'policy', slug: await needJob(m[1]), policy: body.policy }, LOCAL));
  if ((m = /^\/api\/job\/([^/]+)\/(close|reopen)$/.exec(urlPath))) {
    const slug = await needJob(m[1]);
    if (m[2] === 'reopen') return sendJson(res, 200, await runner.handle({ type: 'reopen', slug }, LOCAL));
    const command = { type: 'close', slug, as: body.as === 'dropped' ? 'dropped' : 'done', note: str(body.note, 300).trim() || null, removeWorktree: body.removeWorktree === true };
    return sendJson(res, 200, await runner.handle(command, LOCAL));
  }
  if ((m = /^\/api\/job\/([^/]+)\/options$/.exec(urlPath))) {
    const slug = await needJob(m[1]);
    // The new UI's options editor sends the updated_at it loaded; the classic page sends none.
    const command = { type: 'options', slug, options: body.options, level: body.level, ...(Object.hasOwn(body, 'updated_at') ? { updated_at: body.updated_at ?? null } : {}) };
    return sendJson(res, 200, await runner.handle(command, LOCAL));
  }
  if ((m = /^\/api\/job\/([^/]+)\/local$/.exec(urlPath))) {
    // "Try it on your computer".
    const slug = await needJob(m[1]);
    const word = (v) => (typeof v === 'string' ? v.slice(0, 20) : undefined);
    const command = {
      type: 'try-it', slug, action: str(body.action, 20), preset: str(body.preset, 40), command: str(body.command, 4000),
      where: body.where === 'root' ? 'root' : 'app', what: word(body.what), name: word(body.name), db: str(body.db, 20),
    };
    return sendJson(res, 200, await runner.handle(command, LOCAL));
  }
  if (urlPath === '/api/usage/resume') return sendJson(res, 200, await runner.handle({ type: 'usage-resume' }, LOCAL));
  // The top bar's usage meters: read the plan's usage now instead of at the next minute.
  if (urlPath === '/api/usage/check') return sendJson(res, 200, await local.checkPlanUsage());
  if (urlPath === '/api/usage/auto') return sendJson(res, 200, await runner.handle({ type: 'settings', autoResume: body.on === true }, LOCAL));
  if ((m = /^\/api\/runs\/([\w-]+)\/stop$/.exec(urlPath))) {
    if (m[1].length > 128) throw new HttpError(404, 'That reply already finished.');
    return sendJson(res, 200, await runner.handle({ type: 'pause', runId: m[1] }, LOCAL));
  }
  if ((m = /^\/api\/runs\/([\w-]+)\/steer$/.exec(urlPath))) {
    // Steer: add a message to a reply in progress (see lib/driver.js). Its states arrive as 'steer' events.
    const text = str(body.text).trim();
    if (!text) throw new HttpError(400, 'The message is empty.');
    if (m[1].length > 128) throw new HttpError(404, 'That reply already finished. Send your message as a new one.', { code: 'finished' });
    return sendJson(res, 200, await runner.handle({ type: 'steer', runId: m[1], text }, LOCAL));
  }
  if ((m = /^\/api\/permissions\/([\w-]+)$/.exec(urlPath))) {
    const decision = ['allow', 'allow-run', 'deny'].includes(body.decision) ? body.decision : null;
    if (!decision) throw new HttpError(400, 'Choose allow or deny.');
    const answers = body.answers && typeof body.answers === 'object' ? Object.fromEntries(Object.entries(body.answers).map(([k, v]) => [str(k, 500), str(v, 2000)])) : null;
    if (m[1].length > 128) throw new HttpError(404, 'That request was already answered or has expired.');
    const command = decision === 'deny'
      ? { type: 'deny', requestId: m[1], note: str(body.note, 2000), answers }
      : { type: 'allow', requestId: m[1], note: str(body.note, 2000), answers, scope: decision === 'allow-run' ? 'run' : 'once' };
    return sendJson(res, 200, await runner.handle(command, LOCAL));
  }
  // "Always allow…": save a rule you confirmed, and (with permissionId) allow the request it was drafted from.
  if (urlPath === '/api/rules') return sendJson(res, 200, await runner.handle({ type: 'rules', action: 'add', rule: body.rule, permissionId: str(body.permissionId, 100) || null }, LOCAL));
  if (urlPath === '/api/play/secret' || urlPath === '/api/play/event') {
    // An easter egg found, or something the page saw you do (a theme tried), from fixed lists only.
    const secret = urlPath === '/api/play/secret';
    const id = typeof body.id === 'string' ? body.id : '';
    const kind = secret ? null : typeof body.kind === 'string' ? body.kind : '';
    return sendJson(res, 200, await local.playEvent({ secret, id, kind }));
  }
  if (urlPath === '/api/jobs') {
    // A new job. A ticket's job starts with a status.json of schema version 2 holding the ticket
    // block (the runner's start: lib/options.js startFromTicket(), packet B).
    const from = body.fromSession?.id ? { id: str(body.fromSession.id, 40), mode: body.fromSession.mode === 'continue' ? 'continue' : 'summary' } : undefined;
    const command = {
      type: 'start', description: str(body.description, 600), repoPath: str(body.repoPath, 1000), options: body.options, model: body.model,
      kind: body.kind === 'bug' ? 'bug' : 'feature', ticket: body.ticket, fromSession: from, despiteLimit: body.despiteLimit === true ? true : undefined,
    };
    return sendJson(res, 200, await runner.handle(command, LOCAL));
  }
  throw new HttpError(404, 'Not found');
}

async function routePut(urlPath, req, res) {
  checkWrite(req.headers, { port: PORT, token: TOKEN });
  const body = await readBody(req);
  const m = /^\/api\/job\/([^/]+)\/notes$/.exec(urlPath);
  if (m) {
    // The job's notes (notes.md), saved whole from the job drawer. Audited by size only.
    const slug = await needJob(m[1]);
    if (typeof body.text !== 'string') throw new HttpError(400, 'The notes must be text.');
    if (body.text.length > NOTES_MAX) throw new HttpError(413, `The notes are too long (at most ${NOTES_MAX.toLocaleString('en')} characters).`);
    return sendJson(res, 200, await runner.handle({ type: 'notes', slug, text: body.text }, LOCAL));
  }
  throw new HttpError(404, 'Not found');
}

async function routeDelete(urlPath, req, res) {
  checkWrite(req.headers, { port: PORT, token: TOKEN });
  await readBody(req);
  const m = /^\/api\/rules\/([\w-]{1,100})$/.exec(urlPath);
  if (m) return sendJson(res, 200, await runner.handle({ type: 'rules', action: 'remove', id: m[1] }, LOCAL));
  throw new HttpError(404, 'Not found');
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

// ---------- The integration board (packet Z): /api/integrate/* (lib/integrate.js) ----------
// The packet worktrees of the repository this dashboard runs from, and "Merge next" into its main
// checkout (INTEGRATE_ROOT overrides which repository). Its settings live in
// ~/.ground-control/integrate.json (GROUND_CONTROL_DIR overrides the folder). Never pushes.
//   GET  /api/integrate              the packets, the order, packets at once, the last result
//   GET  /api/integrate/stream       the running step's output, live (server-sent events)
//   POST /api/integrate/order        { order: ['Z', 'C', …] }  save the order
//   POST /api/integrate/slots        { slots: 3 }              save "packets at once"
//   POST /api/integrate/merge-next   start Merge next (202; the result comes on the stream)
//   POST /api/integrate/run-tests    { id }  run both test suites in that packet's worktree (202)
const integrator = local.integrator;
const integrateClients = new Set();
const integrateSend = (data) => { const line = `data: ${JSON.stringify(data)}\n\n`; for (const c of integrateClients) c.write(line); };
integrator.on('line', (e) => integrateSend({ type: 'line', ...e }));
integrator.on('step', (step) => integrateSend({ type: 'step', step }));
integrator.on('done', (result) => integrateSend({ type: 'done', result }));
async function routeIntegrate(req, res, urlPath) {
  try {
    if (req.method === 'GET' && urlPath === '/api/integrate') return sendJson(res, 200, await integrator.view());
    if (req.method === 'GET' && urlPath === '/api/integrate/stream') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`retry: 3000\n\ndata: ${JSON.stringify({ type: 'hello', step: integrator.running, log: integrator.log.join('') })}\n\n`);
      integrateClients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); integrateClients.delete(res); });
      return undefined;
    }
    if (req.method !== 'POST') throw new HttpError(req.method === 'GET' ? 404 : 405, req.method === 'GET' ? 'Not found' : 'Method not allowed');
    checkWrite(req.headers, { port: PORT, token: TOKEN });
    const body = await readBody(req);
    if (urlPath === '/api/integrate/order') return sendJson(res, 200, await integrator.saveOrder(body.order));
    if (urlPath === '/api/integrate/slots') return sendJson(res, 200, await integrator.saveSlots(body.slots));
    if (urlPath === '/api/integrate/merge-next') {
      integrator.mergeNext().done.catch((err) => console.error('integrate:', err));
      return sendJson(res, 202, { started: true, step: integrator.running });
    }
    if (urlPath === '/api/integrate/run-tests') {
      const { done } = await integrator.runPacketTests(typeof body.id === 'string' ? body.id : '');
      done.catch((err) => console.error('integrate:', err));
      return sendJson(res, 202, { started: true, step: integrator.running });
    }
    throw new HttpError(404, 'Not found');
  } catch (err) {
    if (err instanceof IntegrateError) throw new HttpError(err.status, err.message);
    throw err;
  }
}
// ---------- end of the integration board ----------

// ---------- Orbit: the Inbox (lib/orbit.js, lib/orbit-token.js) ----------
// Portal Feedback tickets read with your own read-only token (ORBIT-479): every call to Orbit is a
// GET. The token lives in the OS credential store (in demo mode, or with WORKSHOP_ORBIT_STORE=file,
// in a 600 file in the state folder) and never in an answer, a record or the audit. Routes:
//   GET    /api/orbit/status                   token saved?, where, expiry, last poll, last error
//   GET    /api/orbit/inbox[?view=<id>][&refresh=1]  the inbox (or a saved view's tickets)
//   GET    /api/orbit/tickets/:ref             one ticket with its timeline
//   GET    /api/orbit/tickets/:ref/references  its branches, PRs and links
//   GET    /api/orbit/views                    your saved views (the Inbox's tabs)
//   GET    /api/orbit/events                   a stream for an open Inbox: polls every 3 minutes
//                                              while one is connected, every 15 otherwise
//   POST   /api/orbit/token  { token, url, expiresInDays }   save (and wire up the Foreman's MCP entry)
//   DELETE /api/orbit/token                    forget it
const { status: orbitStatus, inbox: orbitInbox, client: orbit, withJobs, httpError: orbitHttpError } = local.orbit;
const orbitStreams = new Set();

function sendOrbitEvent(type, data) {
  const chunk = `event: ${type}\ndata: ${JSON.stringify(scrubDeep(data))}\n\n`;
  for (const res of orbitStreams) res.write(chunk);
}
orbitInbox.on('change', () => {
  if (!orbitStreams.size) return;
  (async () => sendOrbitEvent('inbox', { ...(await orbitStatus()), items: await withJobs(orbitInbox.view().items) }))().catch(() => {});
});

function openOrbitStream(req, res) {
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
  res.write('retry: 5000\n\n');
  orbitStreams.add(res);
  const unwatch = orbitInbox.watch(); // a browser has the Inbox open: every 3 minutes
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); orbitStreams.delete(res); unwatch(); });
}

async function routeOrbit(req, res, urlPath, url) {
  let m;
  if (req.method === 'GET') {
    if (urlPath === '/api/orbit/events') return openOrbitStream(req, res);
    if (urlPath === '/api/orbit/status') return sendJson(res, 200, scrubDeep(await orbitStatus()));
    if (urlPath === '/api/orbit/inbox') {
      const status = await orbitStatus();
      if (!status.tokenPresent || !local.orbit.url()) return sendJson(res, 200, scrubDeep({ ...status, items: [] }));
      const viewId = str(url.searchParams.get('view'), 100);
      if (viewId) {
        try {
          const list = await orbitInbox.viewList(viewId);
          return sendJson(res, 200, scrubDeep({ ...status, view: viewId, items: await withJobs(list.items), checkedAt: list.checkedAt, truncated: list.truncated }));
        } catch (err) { throw orbitHttpError(err); }
      }
      // The first open (nothing read yet) or Refresh: read now; else the last list as it is.
      if (url.searchParams.get('refresh') === '1' || !orbitInbox.view().checkedAt) await orbitInbox.refresh({ full: url.searchParams.get('refresh') === '1' });
      return sendJson(res, 200, scrubDeep({ ...(await orbitStatus()), items: await withJobs(orbitInbox.view().items) }));
    }
    if (urlPath === '/api/orbit/views') {
      try { return sendJson(res, 200, scrubDeep({ views: (await orbitInbox.views()).map(({ id, name, isDefault }) => ({ id, name, isDefault })) })); } catch (err) { throw orbitHttpError(err); }
    }
    if ((m = /^\/api\/orbit\/tickets\/([^/]{1,64})(\/references)?$/.exec(urlPath))) {
      try {
        if (m[2]) return sendJson(res, 200, scrubDeep(await orbit.listReferences(m[1])));
        const body = await orbit.getTicket(m[1]);
        const t = body?.ticket?.ticket ?? body?.ticket ?? {};
        const item = Number.isInteger(t.number) ? (await withJobs([inboxItem(t, { audience: body.audience, orbitUrl: local.orbit.url() })]))[0] : null;
        return sendJson(res, 200, scrubDeep({ ...body, item }));
      } catch (err) { throw orbitHttpError(err); }
    }
    throw new HttpError(404, 'Not found.');
  }
  if (req.method !== 'POST' && req.method !== 'DELETE') return send(res, 405, 'Method not allowed');
  checkWrite(req.headers, { port: PORT, token: TOKEN });
  const body = await readBody(req);
  if (urlPath !== '/api/orbit/token') throw new HttpError(404, 'Not found.');
  if (req.method === 'POST') return sendJson(res, 200, scrubDeep(await local.orbit.saveToken(body)));
  return sendJson(res, 200, scrubDeep(await local.orbit.clearToken()));
}

// ---------- Telemetry (packet T): /api/telemetry (lib/usage-log.js, lib/telemetry.js) ----------
//   GET /api/telemetry?window=5h|week|30d   the five graphs' data (lib/telemetry.js), each with its
//       sentence and whether it is private (your own jobs) or common (the shared account), plus the
//       plan meters now. The window defaults to this week.
async function routeTelemetry(req, res, urlPath, url) {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
  if (urlPath !== '/api/telemetry') throw new HttpError(404, 'Not found.');
  const window = url.searchParams.get('window') || 'week';
  if (!TELEMETRY_WINDOWS.includes(window)) throw new HttpError(400, 'The window is one of 5h, week or 30d.');
  return sendJson(res, 200, await read.telemetry({ window }));
}
// ---------- end of Telemetry ----------

const server = http.createServer(async (req, res) => {
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
    if (urlPath === '/api/integrate' || urlPath.startsWith('/api/integrate/')) return await routeIntegrate(req, res, urlPath); // the integration board
    if (urlPath.startsWith('/api/orbit/')) return await routeOrbit(req, res, urlPath, url);
    if (urlPath === '/api/telemetry' || urlPath.startsWith('/api/telemetry/')) return await routeTelemetry(req, res, urlPath, url); // Telemetry
    if (req.method === 'GET') return await routeGet(urlPath, url, req, res);
    if (req.method === 'POST') return await routePost(urlPath, req, res);
    if (req.method === 'PUT') return await routePut(urlPath, req, res);
    if (req.method === 'DELETE') return await routeDelete(urlPath, req, res);
    return send(res, 405, 'Method not allowed');
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message, ...err.extra });
    console.error(err);
    return sendJson(res, 500, { error: 'Something went wrong. The details are in the terminal running the dashboard.' });
  }
});

// The screens server (WIREFRAMES_ORIGIN): one route, GET /job/:slug/wireframes, the job's
// wireframes.html from its folder (lib/docs.js readWireframes: the one HTML file ever served from
// there, never a symlink, nothing too big) under the page's own policy. The page may run its own
// inline script and styles, show data: images and load the fonts and the two pinned libraries its
// template names, and nothing else: no fetches, no other frames, no forms. Only this dashboard may
// frame it. Being another origin, its script can't read the dashboard's document, storage or token,
// and nothing here hands out the token or anything else: every other path is 404.
const WIREFRAMES_ROUTE = /^\/job\/([^/]+)\/(wireframes|walkthrough)$/;
const sendScreens = (res, status, body, type = 'text/plain; charset=utf-8') => { res.writeHead(status, { ...WIREFRAMES_HEADERS, 'Content-Type': type }); res.end(body); };
const screensServer = http.createServer(async (req, res) => {
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
});

// The screens server starts with the dashboard (its own origin; see WIREFRAMES_PORT). When it can't
// listen (the port is taken), the dashboard runs without it: meta.wireframesOrigin is null, and the
// 'change' event makes open pages fetch a fresh snapshot (with that meta) so their Screens tab stops
// framing the port.
screensServer.on('error', (err) => {
  screensDown = true;
  console.error(`screens server: couldn’t listen at ${WIREFRAMES_ORIGIN} (${err.code ?? err.message}); the Screens tab is off. Set WIREFRAMES_PORT to a free port and restart.`);
  local.changed();
});

await runner.start({
  listen: () => new Promise((resolve) => {
    server.listen(PORT, HOST, () => {
      console.log(`Feature Workshop running at http://${HOST}:${PORT}  (Ctrl+C to stop)`);
      console.log(`  jobs:     ${FEATURES_DIR}`);
      console.log(`  sessions: ${PROJECTS_DIR}`);
      if (DEMO) console.log('  demo mode: a pretend Foreman answers; nothing real runs.');
      resolve();
    });
    screensServer.listen(WIREFRAMES_PORT, HOST, () => {
      console.log(`  screens:  ${WIREFRAMES_ORIGIN} (a job’s wireframes page, framed by the dashboard)`);
    });
  }),
});

// Stopping the dashboard pauses any reply in progress; sessions stay resumable.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    Promise.resolve(runner.stop()).catch((err) => console.error(err)).finally(() => {
      screensServer.close(); // the screens server stops with the dashboard
      setTimeout(() => process.exit(0), 400);
    });
  });
}
