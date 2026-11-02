// The laptop's half of the hosted site (packet 2A, plan §2.4, decision G34): pairing this laptop
// once, and the link the runner and the site talk over. HTTPS only, no WebSocket.
//
// Pairing (`starbase login --site <url>`, `starbase logout`: bin/starbase.js):
//   pairWithSite()     asks the site for a pairing, prints the link and the code, waits for the
//                      person to press "Pair this laptop" on the site, then keeps the runner token
//                      in this computer's credential store (siteTokenStore: the Keychain, Windows
//                      Credential Manager or the Secret Service, as the Orbit token is kept) and the
//                      site's address in <state folder>/site.json. A login on a laptop already
//                      paired rotates its token.
//                      Run with a new --site (the site's address changed: setup page section 6), it
//                      replaces the stored address and token: the queue and the ids done for the
//                      old address are dropped, and the old address is told to forget its token
//                      (when it is the same site behind a redirect, the login already rotated it).
//   unpairFromSite()   tells the site to forget this laptop's token, then forgets it here too.
//
// The link (createSiteLink, started by runner/index.js; idle until site.json names a site and the
// store has a token, and it notices a login or logout by itself):
//   up      POST /api/runner/events: batches of events made by lib/protocol.js makeEvent (so
//           already scrubbed, and never a diff, env, token or source), at most 256 KB each,
//           retried with backoff. Every event waits in <state folder>/site-queue.jsonl until the
//           site has it, so nothing is lost while offline or across a restart.
//           On connect: hello (name, OS, version) and job-list (every open job as one row:
//           slug, title, ticket, stage, state, the now line, updated). Then a status event for each
//           job whose row changed, and a new job-list when one comes or goes.
//   down    GET /api/runner/commands?wait=25, a long-poll. Each command is checked by
//           parseCommand (from: 'site': only REMOTE_COMMANDS; anything else is refused, as from
//           the local page), run through runner.handle, and answered at
//           /api/runner/commands/:id/result with { ok, error } only: the answer's data stays
//           here. Delivery is at least once; the ids done (with their answers) are kept in
//           <state folder>/site-done.json, so a repeat is answered again, never run again.
//   seen    the site counts a laptop online while it was seen in the last 60 seconds; the
//           long-poll calls in at least every 25.
//
// The full mirror (packet 2B):
//   records  after job-list, every part of the job record (runner/mirror.js: the board, each open
//           job's page, documents, decisions and evidence, the stacks and their parts) as `record`
//           events, then a `synced` mark. Afterwards only what changed: a runner event about a job
//           looks at that job again, a `change` at the board and every job whose card moved, and
//           everything is looked at again every five minutes. A part that is gone goes up as null.
//   evidence  each picture and video goes to the site's private Blob store, straight from here, with
//           a one-time signed upload link the site makes for that one path (runner/evidence.js).
//   decisions  a command from the site may carry what it was decided on (madeOn, lib/made-on.js):
//           it runs only when that still holds here, just before it runs; otherwise nothing runs and
//           the answer says the job changed (stale). Every such decision writes an audit line here
//           (who, from the site, what it was made on, how it ended) and sends the same up as an
//           `audit` event; decisions made on this laptop go up as `audit` events too, from 'laptop'.
//   answers  a command that asks for its answer (answerKey: the live diff) has the answer sealed
//           to that key (lib/sealed.js), so only the page that asked can read it. It is kept in
//           memory only, never in site-done.json.
//
// Team Telemetry (packet 2E): the usage upload, numbers only ("Team Telemetry: the usage upload" below).
//
// Nothing secret is ever printed, logged or written outside the credential store: site.json holds
// the address, this laptop's own random device id and who it was paired for.

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tokenStore } from '../lib/orbit-token.js';
import { slugTicketKey } from '../lib/orbit.js';
import { makeEvent, parseCommand, PROTOCOL_VERSION } from '../lib/protocol.js';
import { stillMadeOn } from '../lib/made-on.js';
import { seal } from '../lib/sealed.js';
import { enrichView, partPage, stackCard, usageByJob } from '../lib/stack-parts.js';
import { USAGE_FILE, UsageLog, parseLine, usageDir } from '../lib/usage-log.js';
import { cleanRecord } from '../lib/insights.js';
import { STAGE_IDS } from '../lib/stages.js';
import { boardRecord, decisionsRecord, docRecord, docsRecord, evidenceRecord, fit, jobRecord, partRecord, stackRecord, stacksRecord } from './mirror.js';
import { uploadEvidence } from './evidence.js';

/** Where the runner token is kept: its own names in the same stores as the Orbit token. */
// oldService: its name before Starbase (G36), still read (lib/orbit-token.js renamedStore).
export const SITE_TOKEN_NAMES = Object.freeze({ service: 'Starbase site token', account: 'runner', file: 'site-token', oldService: 'Ground Control site token' });
export const SITE_FILE = 'site.json';
export const QUEUE_FILE = 'site-queue.jsonl';
export const DONE_FILE = 'site-done.json';
/** The most one batch of events may be (the site refuses more). */
export const BATCH_BYTES = 256 * 1024;
const MAX_QUEUED = 5000;
const MAX_DONE = 500;

export class SiteError extends Error {
  constructor(message) { super(message); this.plain = true; }
}

/** The runner token's store for this computer (prefer 'file' in demo mode and tests). */
export const siteTokenStore = ({ stateDir, prefer = 'auto', ...rest }) => tokenStore({ stateDir, prefer, names: SITE_TOKEN_NAMES, ...rest });

/** site.json, or null: { url, deviceId, runnerId, name, pairedAt, person }. */
export function readSiteFile(stateDir) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(stateDir, SITE_FILE), 'utf8'));
    return s && typeof s.url === 'string' ? s : null;
  } catch { return null; }
}

export function writeSiteFile(stateDir, data) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = path.join(stateDir, SITE_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export const removeSiteFile = (stateDir) => fs.rmSync(path.join(stateDir, SITE_FILE), { force: true });

/** The site's address, checked: https, or http only for this computer itself. */
export function normalizeSiteUrl(raw) {
  let u;
  try { u = new URL(String(raw ?? '').trim()); } catch { throw new SiteError('That isn’t a web address. Give the site’s address, like https://starbase.example.com.'); }
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new SiteError('The site’s address must start with https:// (http:// only for localhost).');
  if (u.username || u.password) throw new SiteError('The site’s address must not carry a name or password.');
  return u.origin;
}

/** This computer as the site lists it. */
export function thisLaptop({ platform = process.platform, hostname = os.hostname() } = {}) {
  const osName = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[platform] ?? platform;
  const name = String(hostname || 'This laptop').replace(/\.local$/i, '').slice(0, 100) || 'This laptop';
  return { name, os: osName };
}

async function callSite(fetchFn, url, init) {
  let res;
  try { res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 20_000) }); } catch {
    throw new SiteError(`The site at ${new URL(url).origin} couldn’t be reached. Check the address and your connection, then try again.`);
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

/**
 * `starbase login --site <url>`: resolves { runner, person, rotated }.
 * out(line) prints; sleep(ms) waits (tests pass a fake); waitMs: how long to wait for the person.
 */
export async function pairWithSite({ siteUrl, stateDir, store, fetch: fetchFn = globalThis.fetch, out = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), version = '', name, os: osName, waitMs = 10 * 60 * 1000 }) {
  const url = normalizeSiteUrl(siteUrl);
  const before = readSiteFile(stateDir);
  const oldToken = before ? await store.get().catch(() => null) : null;
  const deviceId = before?.deviceId && /^[\w-]{8,64}$/.test(before.deviceId) ? before.deviceId : crypto.randomUUID();
  const me = { ...thisLaptop(), ...(name ? { name } : {}), ...(osName ? { os: osName } : {}) };
  const start = await callSite(fetchFn, `${url}/api/pair/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...me, deviceId, version }) });
  if (start.status !== 200 || !start.body?.code) throw new SiteError(start.body?.error ?? `The site didn’t start a pairing (it answered ${start.status}).`);
  const { code, secret, link } = start.body;
  out(`Pairing this laptop (${me.name}, ${me.os}) with ${url}.`);
  out('  1. Open this link and sign in with your Moxie Google account:');
  out(`       ${link}`);
  out(`  2. Check the site shows the same code: ${code}`);
  out('  3. Press “Pair this laptop” there.');
  out('Waiting for you… The code works for 10 minutes. Ctrl+C stops.');
  const every = Math.max(1, Number(start.body.pollEvery) || 2) * 1000;
  for (let waited = 0; ; waited += every) {
    const r = await callSite(fetchFn, `${url}/api/pair/finish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret }) });
    if (r.status === 200 && typeof r.body?.token === 'string') {
      const moved = before && before.url !== url ? before.url : null;
      // A new address: what waited for the old one isn't sent on, and the ids done start afresh.
      if (moved) for (const f of [QUEUE_FILE, DONE_FILE]) fs.rmSync(path.join(stateDir, f), { force: true });
      await store.set(r.body.token);
      writeSiteFile(stateDir, { url, deviceId, runnerId: r.body.runner.id, name: r.body.runner.name, pairedAt: new Date().toISOString(), person: { name: r.body.person.name, email: r.body.person.email } });
      if (moved && oldToken && oldToken !== r.body.token) {
        // Best effort: the old address forgets the old token (a 401 means it already has).
        await callSite(fetchFn, `${moved}/api/runner/logout`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${oldToken}` }, body: '{}', timeoutMs: 10_000 }).catch(() => null);
      }
      return { runner: r.body.runner, person: r.body.person, rotated: Boolean(r.body.runner.rotated), movedFrom: moved };
    }
    if (r.status !== 202) throw new SiteError(r.body?.error ?? `The pairing stopped (the site answered ${r.status}). Run starbase login again.`);
    if (waited >= waitMs) throw new SiteError('Nobody pressed “Pair this laptop” within 10 minutes, so the code has run out. Run starbase login again.');
    await sleep(every);
  }
}

/**
 * `starbase logout`: the site forgets this laptop's token, then this laptop forgets it.
 * Resolves { told: whether the site heard, url } (null when this laptop wasn't paired).
 */
export async function unpairFromSite({ stateDir, store, fetch: fetchFn = globalThis.fetch }) {
  const site = readSiteFile(stateDir);
  const token = await store.get();
  if (!site && !token) return null;
  let told = false;
  if (site && token) {
    try {
      const r = await callSite(fetchFn, `${site.url}/api/runner/logout`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{}', timeoutMs: 10_000 });
      told = r.status === 200 || r.status === 401;
    } catch { told = false; }
  }
  await store.clear();
  removeSiteFile(stateDir);
  for (const f of [QUEUE_FILE, DONE_FILE]) fs.rmSync(path.join(stateDir, f), { force: true });
  return { told, url: site?.url ?? null };
}


// ---------- Team Telemetry: the usage upload (packet 2E) ----------
// While the link is up, this laptop's usage numbers go to the site, so everyone on the shared Claude
// account sees one picture of its limit (hosted/lib/team-usage.js has the wire and the site's check):
//   app         the usage log's lines (lib/usage-log.js), cleaned as Telemetry cleans them first
//               (lib/insights.js cleanRecord: demo and test-folder lines gone, a resumed session's
//               cost taken by difference): time, job slug, stage, model, tokens, cost, both meters.
//               Never the person (the site takes the laptop's), the ticket, section, session, turn,
//               worker, account or any folder.
//   claudeCode  your Claude Code replies outside the app (packet U), when the runner offers them
//               (runner.read.claudeCodeReplies) and they are counted here: time, model family,
//               tokens, cost. Without that, the site is told 'not-sent' and says so.
//   readings    the plan meters as the runner last read them, every few minutes, so the shared gauge
//               moves even while nobody's job is working.
// Each line has an id, a hash of the line made here, so a line sent twice is kept once on the site.
// What has been sent is kept in <state folder>/site-usage.json (how far each kind got): a restart
// or a stretch offline sends what is new since, nothing twice. The first upload sends the last
// USAGE_SEND_DAYS days. Nothing is queued on disk: the usage log itself is the queue.
export const USAGE_STATE_FILE = 'site-usage.json';
export const USAGE_SEND_DAYS = 60;
export const USAGE_EVERY_MS = 60_000;
export const READING_EVERY_MS = 5 * 60_000;
// Read this far back before what was sent, so a resumed session's cost is still taken by difference.
const USAGE_OVERLAP_MS = 7 * 24 * 3600e3;
const USAGE_CHUNK = 400;
const SLUG_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const MODEL_OK = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/;
const STAGE_OK = new Set(STAGE_IDS);
const FAMILY_OK = new Set(['opus', 'sonnet', 'haiku', 'fable', 'other']);
const lineId = (...bits) => crypto.createHash('sha256').update(bits.map((b) => String(b ?? '')).join('|')).digest('hex').slice(0, 24);
const whole = (n) => (Number.isFinite(+n) && +n > 0 ? Math.round(+n) : 0);
const wireTokens = (t) => ({ input: whole(t?.input), output: whole(t?.output), cacheRead: whole(t?.cacheRead), cacheWrite5m: whole(t?.cacheWrite5m), cacheWrite1h: whole(t?.cacheWrite1h) });
const wireMeter = (m) => (m && typeof m.percent === 'number' && Number.isFinite(m.percent)
  ? { percent: m.percent, resetsAt: m.resetsAt && Number.isFinite(Date.parse(m.resetsAt)) ? new Date(Date.parse(m.resetsAt)).toISOString() : null } : null);
const wireUsd = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 1e6) / 1e6 : 0);

/** The cleaned record's rows (lib/insights.js cleanRecord) as the site takes them: numbers and short names only. */
export function usageWire(rows) {
  return rows.map((r) => ({
    id: lineId('app', r.turn, r.worker, r.model, r.stage, r.t, r.session, r.job),
    t: new Date(r.ms ?? Date.parse(r.t)).toISOString(),
    job: typeof r.job === 'string' && SLUG_OK.test(r.job) ? r.job : null,
    stage: STAGE_OK.has(r.stage) ? r.stage : null,
    model: typeof r.model === 'string' && MODEL_OK.test(r.model) ? r.model : null,
    tokens: wireTokens(r.tokens), usd: wireUsd(r.usd),
    meters: { week: wireMeter(r.week), fiveHour: wireMeter(r.fiveHour) },
  }));
}

/** Your Claude Code replies outside the app (lib/claude-code-usage.js view()) as the site takes them. */
export function claudeCodeWire(replies) {
  return (replies ?? []).filter((r) => Number.isFinite(Date.parse(r?.t))).map((r) => {
    const t = new Date(Date.parse(r.t)).toISOString();
    const tokens = wireTokens(r.tokens);
    const family = FAMILY_OK.has(r.family) ? r.family : 'other';
    return { id: lineId('cc', t, family, tokens.input, tokens.output, tokens.cacheRead, tokens.cacheWrite5m, tokens.cacheWrite1h, r.sidechain ? 1 : 0), t, family, tokens, usd: wireUsd(r.usd) };
  });
}

/** The plan meters' last reading (lib/plan-usage.js view()) as one reading for the site, or null. */
export function readingWire(planUsage) {
  const at = Date.parse(planUsage?.checkedAt);
  const week = wireMeter(planUsage?.week);
  const fiveHour = wireMeter(planUsage?.fiveHour);
  if (!Number.isFinite(at) || (!week && !fiveHour)) return null;
  const t = new Date(at).toISOString();
  return { id: lineId('reading', t), t, meters: { week, fiveHour } };
}

const COUNTING_OF = { ready: 'counted', off: 'off', reading: 'reading' };

/**
 * The upload's state: how far each kind got (`t`, and the ids sent at exactly that time), for one
 * site address. A new address starts again.
 */
function usageState(stateDir, url) {
  const file = path.join(stateDir, USAGE_STATE_FILE);
  const fresh = () => ({ url, app: { t: -Infinity, ids: [] }, claudeCode: { t: -Infinity, ids: [] }, reading: { t: -Infinity, ids: [] }, counting: null });
  let s;
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { s = null; }
  const okKind = (k) => k && (typeof k.t === 'number' || k.t === null) && Array.isArray(k.ids);
  if (!s || s.url !== url || !okKind(s.app) || !okKind(s.claudeCode) || !okKind(s.reading)) s = fresh();
  for (const k of ['app', 'claudeCode', 'reading']) if (s[k].t === null) s[k].t = -Infinity;
  return {
    s,
    save() {
      const out = JSON.stringify({ ...s, app: { ...s.app, t: Number.isFinite(s.app.t) ? s.app.t : null }, claudeCode: { ...s.claudeCode, t: Number.isFinite(s.claudeCode.t) ? s.claudeCode.t : null }, reading: { ...s.reading, t: Number.isFinite(s.reading.t) ? s.reading.t : null } });
      fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${out}\n`, { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
  };
}
const isNew = (k, l) => { const t = Date.parse(l.t); return t > k.t || (t === k.t && !k.ids.includes(l.id)); };
function advance(k, list) {
  if (!list.length) return;
  const top = Math.max(...list.map((l) => Date.parse(l.t)));
  const at = list.filter((l) => Date.parse(l.t) === top).map((l) => l.id);
  k.ids = top === k.t ? [...new Set([...k.ids, ...at])] : at;
  k.t = top;
}

/** Batches of at most maxBytes, the oldest lines first, each kind in its own order. */
export function usageBatches({ app, claudeCode, readings, counting }, maxBytes = BATCH_BYTES) {
  const out = [];
  const lists = { app: [...app], claudeCode: [...claudeCode], readings: [...readings] };
  const size = (b) => Buffer.byteLength(JSON.stringify(b));
  do {
    const b = { app: [], claudeCode: [], readings: [], counting };
    for (const k of ['readings', 'app', 'claudeCode']) {
      while (lists[k].length && b[k].length < USAGE_CHUNK) {
        b[k].push(lists[k][0]);
        if (size(b) > maxBytes) { b[k].pop(); break; }
        lists[k].shift();
      }
    }
    if (!b.app.length && !b.claudeCode.length && !b.readings.length && out.length) break;
    out.push(b);
    if (!b.app.length && !b.claudeCode.length && !b.readings.length) break;
  } while (lists.app.length || lists.claudeCode.length || lists.readings.length);
  return out;
}

/** A signature of the usage log's files (names, sizes, times), so an unchanged log isn't read again. */
async function usageSignature(dir) {
  const names = (await fs.promises.readdir(dir).catch(() => [])).filter((n) => n === USAGE_FILE || /^usage-.+\.jsonl$/.test(n)).sort();
  const bits = [];
  for (const n of names) { const st = await fs.promises.stat(path.join(dir, n)).catch(() => null); if (st) bits.push(`${n}:${st.size}:${st.mtimeMs}`); }
  return bits.join('\n');
}

/**
 * One round of the upload: what is new of each kind goes to the site. call(method, path, body) is
 * the link's; read: the runner's reads. Resolves { sent: { app, claudeCode, readings }, unpaired }.
 * Throws when the site couldn't take it (the caller waits and tries again).
 */
export function usageUploader({ stateDir, url, dir, read, call, now = () => Date.now(), log = () => {}, readingEveryMs = READING_EVERY_MS }) {
  const st = usageState(stateDir, url);
  let lastSig = null;
  let lastReadingLook = -Infinity;
  return async function round() {
    const s = st.s;
    const t = now();
    const floor = t - USAGE_SEND_DAYS * 24 * 3600e3;
    const sig = await usageSignature(dir);
    let app = [];
    if (sig !== lastSig) {
      const since = Math.max(floor, Number.isFinite(s.app.t) ? s.app.t - USAGE_OVERLAP_MS : floor);
      const lines = await new UsageLog({ dir }).read({ since });
      app = usageWire(cleanRecord(lines, { now: t }).rows).filter((l) => Date.parse(l.t) >= floor && isNew(s.app, l));
    }
    let claudeCode = [];
    let counting = 'not-sent';
    if (typeof read.claudeCodeReplies === 'function') {
      const cc = await read.claudeCodeReplies({ since: Math.max(floor, Number.isFinite(s.claudeCode.t) ? s.claudeCode.t : floor) }).catch(() => null);
      counting = COUNTING_OF[cc?.state] ?? 'not-sent';
      if (counting === 'counted') claudeCode = claudeCodeWire(cc.replies).filter((l) => Date.parse(l.t) >= floor && isNew(s.claudeCode, l));
    }
    let readings = [];
    if (t - lastReadingLook >= readingEveryMs && typeof read.snapshot === 'function') {
      lastReadingLook = t;
      const snap = await read.snapshot({ token: null, wireframesOrigin: null }).catch(() => null);
      const r = readingWire(snap?.planUsage);
      if (r && isNew(s.reading, r)) readings = [r];
    }
    const sent = { app: 0, claudeCode: 0, readings: 0 };
    // Nothing new, and nothing new to say (a laptop with no use yet says nothing at all).
    const sameSay = counting === s.counting || (s.counting === null && counting === 'not-sent');
    if (!app.length && !claudeCode.length && !readings.length && sameSay) { lastSig = sig; return { sent, unpaired: false }; }
    for (const b of usageBatches({ app, claudeCode, readings, counting })) {
      const r = await call('POST', '/api/runner/usage', b);
      if (r?.status === 401) return { sent, unpaired: true };
      if (r?.status !== 200) throw new Error(`the site didn’t take the usage numbers (${r?.status ?? 'no answer'}); they go again in a moment.`);
      for (const x of r.body?.refused ?? []) log(`site link: the site refused a usage line: ${x.error}`);
      advance(s.app, b.app);
      advance(s.claudeCode, b.claudeCode);
      advance(s.reading, b.readings);
      s.counting = counting;
      st.save();
      sent.app += b.app.length;
      sent.claudeCode += b.claudeCode.length;
      sent.readings += b.readings.length;
    }
    lastSig = sig;
    return { sent, unpaired: false };
  };
}

// ---------- The link ----------

const REAL_TIMERS = { now: () => Date.now(), sleep: (ms) => new Promise((r) => { setTimeout(r, ms).unref?.(); }) };
const cut = (v, n = 300) => (typeof v === 'string' ? (v.length > n ? `${v.slice(0, n - 1)}…` : v) : null);

/** One open job as the site keeps it (nothing else of the job leaves the laptop here). */
export function jobRow(card) {
  const now = card.nowDoing?.[0];
  const nowLine = now?.doing ? `${now.name ?? 'Foreman'}: ${now.doing}` : card.laneReason ?? card.headline ?? null;
  return {
    slug: card.slug,
    title: cut(card.title || card.slug, 200),
    ticket: slugTicketKey(card.slug) ?? null,
    stage: cut(card.stage ?? null, 40),
    state: cut(card.lane ?? card.stageState ?? null, 40),
    stateWords: cut(card.laneReason ?? null, 120),
    now: cut(nowLine),
    updatedAt: typeof card.updatedAt === 'string' ? card.updatedAt : null,
  };
}

/**
 * The on-disk queue of events waiting for the site: one JSON line each. add, batch (the oldest
 * that fit in one request), drop (the first n, once the site has them). One file, one writer.
 */
export function eventQueue(file, { max = MAX_QUEUED, log = () => {} } = {}) {
  let lock = Promise.resolve();
  const locked = (fn) => { const p = lock.then(fn, fn); lock = p.catch(() => {}); return p; };
  const readLines = () => {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
    return text.split('\n').filter(Boolean);
  };
  const writeLines = (lines) => {
    if (!lines.length) { fs.rmSync(file, { force: true }); return; }
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${lines.join('\n')}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  return {
    file,
    add: (event) => locked(() => {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
      const lines = readLines();
      if (lines.length > max) { log(`site link: more than ${max} events waiting; the oldest ${lines.length - max} are dropped.`); writeLines(lines.slice(lines.length - max)); }
    }),
    size: () => readLines().length,
    /** { events, count }: count lines from the front (some may be unreadable and skipped). */
    batch: (maxBytes = BATCH_BYTES) => locked(() => {
      const events = [];
      let bytes = Buffer.byteLength('{"events":[]}');
      let count = 0;
      for (const line of readLines()) {
        let e;
        try { e = JSON.parse(line); } catch { count++; continue; }
        const b = Buffer.byteLength(line) + 1;
        if (bytes + b > maxBytes) {
          if (!events.length) { log('site link: one event was bigger than a batch may be, so it was dropped.'); count++; }
          break;
        }
        bytes += b;
        events.push(e);
        count++;
      }
      return { events, count };
    }),
    drop: (n) => locked(() => { writeLines(readLines().slice(n)); }),
  };
}

/** Audit lines that are decisions, for the site's audit copy. */
const DECISION_LINE = (e) => (e?.action === 'send' && (['approve', 'changes', 'stop'].includes(e.kind) || Number.isInteger(e.gateBrief)))
  || e?.action === 'permission' || (e?.action === 'stack' && e.event === 'merge-yes');
/** A refusal that means the job moved on meanwhile (nothing ran). */
const MOVED_ON = (err) => (err?.status === 409 && (err.extra?.code === 'stale-brief' || /moved on|only in order|no longer/i.test(err.message ?? '')))
  || (err?.status === 404 && /already answered|expired/i.test(err.message ?? ''));
const FULL_EVERY_MS = 5 * 60 * 1000;
const hashOf = (v) => crypto.createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 32);

/**
 * The link. runner: { read, handle, on, local } (runner/index.js; local: its stacks and evidence
 * doors, when there). store: siteTokenStore(). audit(line): this laptop's audit log; onAudit(fn):
 * every line it writes. fetch, timers ({ now, sleep }) and waitSeconds are for tests. Resolves
 * nothing; start() and stop() are sync.
 */
export function createSiteLink({ runner, stateDir, store, fetch: fetchFn = globalThis.fetch, log = (l) => console.error(l), version = '', waitSeconds = 25, timers = REAL_TIMERS, debounceMs = 1000, watchEveryMs = 2000, audit = null, onAudit = null, putFile = null, usageEveryMs = USAGE_EVERY_MS, usageDir: usageFolder = null }) {
  const queue = eventQueue(path.join(stateDir, QUEUE_FILE), { log });
  const doneFile = path.join(stateDir, DONE_FILE);
  const out = new EventEmitter();
  let done = new Map();
  try { done = new Map(JSON.parse(fs.readFileSync(doneFile, 'utf8'))); } catch { done = new Map(); }
  let site = null; // { url, token } while connected
  let generation = 0;
  let running = false;
  let state = 'idle';
  const aborts = new Set();
  const wakeups = new Set();
  let sent = new Map(); // slug -> the row last queued
  let offRunner = [];
  let changeTimer = null;
  let watching = false;

  const setState = (s, why = null) => { if (state !== s) { state = s; out.emit('state', s, why); } };
  const sleep = (ms) => new Promise((resolve) => {
    const wake = () => { wakeups.delete(wake); resolve(); };
    wakeups.add(wake);
    timers.sleep(ms).then(wake);
  });
  const backoff = (n) => Math.min(60_000, 1000 * 2 ** Math.min(n, 6)) * (0.75 + Math.random() * 0.5);

  async function call(method, p, body, { timeoutMs = 20_000 } = {}) {
    const ac = new AbortController();
    aborts.add(ac);
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    timer.unref?.();
    try {
      const res = await fetchFn(`${site.url}${p}`, {
        method, signal: ac.signal,
        headers: { authorization: `Bearer ${site.token}`, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      return { status: res.status, body: json };
    } finally {
      clearTimeout(timer);
      aborts.delete(ac);
    }
  }

  function unpaired() {
    log('site link: the site no longer knows this laptop. Run starbase login --site <the site’s address> to pair it again.');
    disconnect('unpaired');
  }

  /** Makes one event for the wire and puts it in the queue. */
  async function send(type, data, job = null) {
    const made = makeEvent(type, data, { job });
    if (!made.ok) { log(`site link: an event wasn’t sent: ${made.error}`); return; }
    await queue.add({ eid: `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`, ...made.event });
    kick();
  }

  async function currentRows() {
    const r = await runner.read.features();
    return (r.features ?? []).filter((c) => !c.closed && c.slug).map(jobRow);
  }

  async function sendJobList() {
    const rows = await currentRows();
    sent = new Map(rows.map((r) => [r.slug, JSON.stringify(r)]));
    await send('job-list', { jobs: rows });
  }

  async function jobsChanged() {
    if (!site) return;
    const rows = await currentRows();
    const now = new Map(rows.map((r) => [r.slug, JSON.stringify(r)]));
    const comeOrGone = rows.some((r) => !sent.has(r.slug)) || [...sent.keys()].some((slug) => !now.has(slug));
    if (comeOrGone) { await sendJobList(); return; }
    for (const r of rows) {
      if (sent.get(r.slug) === now.get(r.slug)) continue;
      sent.set(r.slug, now.get(r.slug));
      await send('status', r, r.slug);
    }
  }

  function onChange() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      jobsChanged().catch((err) => log(`site link: ${err.message}`));
      records.sync().catch((err) => log(`site link: the record couldn’t be read: ${err.message}`));
    }, debounceMs);
    changeTimer.unref?.();
  }
  /** Any runner event: a job's own marks that job to look at again; the rest, the board. */
  function onRunnerEvent(type, job) {
    if (job) records.dirty(job);
    if (type !== 'change' && type !== 'run') onChange();
  }

  // ---- the full mirror (runner/mirror.js) ----
  let me = null; // who this laptop was paired for (site.json)
  const records = recordSync();
  function recordSync() {
    let sent = new Map(); // `${kind}\n${key}` -> hash last sent
    let ofJob = new Map(); // slug -> the ids of its parts sent
    let cards = new Map(); // slug -> its card as last seen
    let docEntries = new Map(); // `${slug}\n${file}` -> its Docs list entry as last seen
    let evidenceSent = new Map(); // `${slug}\n${file}` -> uploaded
    const dirtyJobs = new Set();
    let lastFull = -Infinity;
    let uploads = [];
    let evidenceChain = Promise.resolve();
    let running = null;
    let again = false;
    const live = stackLive();

    async function put(kind, key, value, job = null, ids = null) {
      const id = `${kind}\n${key}`;
      ids?.add(id);
      const v = value === null ? null : fit(kind, value);
      const h = hashOf(v);
      if (sent.get(id) === h) return;
      sent.set(id, h);
      await send('record', { kind, key, value: v }, job);
    }
    async function gone(id, job = null) {
      if (!sent.has(id)) return;
      sent.delete(id);
      const [kind, ...rest] = id.split('\n');
      await send('record', { kind, key: rest.join('\n'), value: null }, job);
    }

    async function jobParts(slug) {
      const ids = new Set();
      const detail = await runner.read.job(slug).catch(() => null);
      if (!detail) return ids;
      await put('job', slug, jobRecord(detail), slug, ids);
      const docs = await runner.read.docs?.(slug).catch(() => null);
      if (docs) {
        await put('docs', slug, docsRecord(docs), slug, ids);
        for (const entry of docs.docs ?? []) {
          if (typeof entry?.file !== 'string') continue;
          const dk = `${slug}\n${entry.file}`;
          const was = docEntries.get(dk);
          const now = JSON.stringify(entry);
          const id = `doc\n${dk}`;
          if (was === now && sent.has(id)) { ids.add(id); continue; }
          docEntries.set(dk, now);
          const doc = await runner.read.doc?.(slug, entry.file).catch(() => null);
          if (doc) await put('doc', dk, docRecord(doc), slug, ids);
        }
      }
      const decisions = await runner.read.decisions?.(slug).catch(() => null);
      if (decisions) await put('decisions', slug, decisionsRecord(decisions), slug, ids);
      const door = runner.local?.evidence;
      const ev = door ? await door.view(slug).catch(() => null) : null;
      if (ev) {
        await put('evidence', slug, evidenceRecord(ev), slug, ids);
        uploads.push({ slug, view: ev, door }); // once the site has the list (after this look's events are sent)
      }
      return ids;
    }

    async function stackParts() {
      const stacks = runner.local?.stacks;
      if (!stacks?.list) return new Set();
      const ids = new Set();
      const list = await stacks.list().catch(() => null);
      if (!list) return ids;
      const l = await live();
      await put('stacks', '', stacksRecord({ ...list, stacks: (list.stacks ?? []).map((x) => stackCard(x, l)) }), null, ids);
      for (const one of list.stacks ?? []) {
        const raw = await stacks.view(one.slug).catch(() => null);
        if (!raw) continue;
        const view = enrichView(raw, l);
        await put('stack', one.slug, stackRecord(view), null, ids);
        for (let n = 1; n <= (view.parts?.length ?? 0); n++) {
          const page = partPage(view, n);
          if (!page) continue;
          const changes = raw.readChanges ? await raw.readChanges.files(page.part.name).catch(() => null) : null;
          await put('stack-part', `${one.slug}/${n}`, partRecord({ ...page, changes: changes ?? { files: [], added: 0, removed: 0, error: 'Your laptop lists this part’s changed files.' } }), null, ids);
        }
      }
      return ids;
    }

    /** Evidence files, after the site has this look's evidence lists (the queue sent): each file straight to Blob. */
    async function sendEvidence(list) {
      const end = timers.now() + 15_000;
      while (site && queue.size() > 0 && timers.now() < end) await sleep(50);
      if (!site || queue.size() > 0) return;
      for (const u of list) {
        await uploadEvidence({ ...u, sent: evidenceSent, ask: (body) => call('POST', '/api/runner/evidence/upload', body), done: (body) => call('POST', '/api/runner/evidence/done', body), putFile: putFile ?? fetchFn, log })
          .catch((err) => log(`site link: evidence wasn’t uploaded: ${err.message}`));
      }
    }

    async function syncOnce(full) {
      const snap = await runner.read.snapshot({ token: null, wireframesOrigin: null });
      await put('board', '', boardRecord(snap));
      const open = (snap.jobs ?? []).filter((c) => c?.slug && !c.closed && !c.starting);
      const openSlugs = new Set(open.map((c) => c.slug));
      for (const c of open) {
        const now = JSON.stringify(c);
        const look = full || dirtyJobs.has(c.slug) || cards.get(c.slug) !== now || !ofJob.has(c.slug);
        cards.set(c.slug, now);
        if (!look) continue;
        dirtyJobs.delete(c.slug);
        const ids = await jobParts(c.slug);
        for (const id of ofJob.get(c.slug) ?? []) if (!ids.has(id)) await gone(id, c.slug);
        ofJob.set(c.slug, ids);
      }
      for (const [slug, ids] of [...ofJob]) {
        if (openSlugs.has(slug)) continue;
        for (const id of ids) await gone(id, slug);
        ofJob.delete(slug);
        cards.delete(slug);
      }
      const stackIds = await stackParts();
      for (const id of [...sent.keys()]) if (/^(stacks|stack|stack-part)\n/.test(id) && !stackIds.has(id)) await gone(id);
    }

    return {
      reset() { sent = new Map(); ofJob = new Map(); cards = new Map(); docEntries = new Map(); dirtyJobs.clear(); lastFull = -Infinity; },
      dirty(slug) { dirtyJobs.add(slug); },
      /** Looks at the record and sends what changed; one look at a time (asking during one queues one more). */
      async sync({ full = false } = {}) {
        if (!site || !runner.read.snapshot) return;
        if (running) { again = true; return running; }
        running = (async () => {
          try {
            do {
              again = false;
              const whole = full || timers.now() - lastFull > FULL_EVERY_MS;
              await syncOnce(whole);
              if (whole) lastFull = timers.now();
              // Uploads go on beside the link (a video mustn't hold up a decision), one look at a time.
              if (uploads.length) { const list = uploads.splice(0); evidenceChain = evidenceChain.then(() => sendEvidence(list)).catch(() => {}); }
              full = false;
            } while (again && site);
          } finally { running = null; }
        })();
        return running;
      },
    };
  }

  /** The stack pages' live half (as site/routes-stacks.js liveReader): the jobs' cards and Telemetry's record by job. */
  function stackLive() {
    return async () => {
      let cardsBySlug = new Map();
      try { cardsBySlug = new Map(((await runner.read.features())?.features ?? []).map((c) => [c.slug, c])); } catch { /* none */ }
      let usage = usageByJob([]);
      try {
        const file = path.join(usageDir({ stateDir }), USAGE_FILE);
        const text = fs.readFileSync(file, 'utf8');
        usage = usageByJob(text.split('\n').map(parseLine).filter(Boolean));
      } catch { /* none yet */ }
      return { cards: cardsBySlug, usage, now: Date.now() };
    };
  }

  // ---- the audit copy ----
  let siteRunning = null; // the site's decision running now: { slug, by, madeOn, id }
  function onAuditLine(e) {
    if (!site || !DECISION_LINE(e)) return;
    const fromSite = siteRunning && siteRunning.slug === e.slug;
    if (fromSite) return; // the site's own decision is sent up once, with its outcome (runOne)
    const madeOn = Number.isInteger(e.gateBrief) ? { kind: 'gate', slug: e.slug, brief: e.gateBrief }
      : e.action === 'permission' ? { kind: 'permission', slug: e.slug, tool: e.tool ?? null }
        : e.action === 'stack' ? { kind: 'stack', slug: e.slug, section: e.section ?? null } : { kind: 'job', slug: e.slug };
    const action = e.action === 'send' ? ({ approve: 'approve', changes: 'send-back', stop: 'stop' }[e.kind] ?? 'reply') : e.action === 'permission' ? (e.decision === 'deny' ? 'deny' : 'allow') : 'stack-merge';
    send('audit', { at: e.at ?? new Date().toISOString(), from: 'laptop', who: me?.name ?? 'You, on this laptop', action, job: e.slug ?? null, madeOn, outcome: 'ran' }, e.slug ?? null).catch(() => {});
  }

  // ---- up: the queue to the site ----
  let flushing = false;
  let flushAgain = false;
  function kick() {
    if (!site) return;
    if (flushing) { flushAgain = true; return; }
    flushing = true;
    flushLoop(generation).catch((err) => log(`site link: ${err.message}`)).finally(() => { flushing = false; if (flushAgain && site) { flushAgain = false; kick(); } });
  }
  async function flushLoop(gen) {
    let failures = 0;
    while (site && gen === generation) {
      flushAgain = false;
      const { events, count } = await queue.batch(BATCH_BYTES);
      if (!count) return;
      if (!events.length) { await queue.drop(count); continue; }
      let r = null;
      try { r = await call('POST', '/api/runner/events', { events }); } catch { r = null; }
      if (gen !== generation) return;
      if (r?.status === 200) {
        failures = 0;
        await queue.drop(count);
        for (const x of r.body?.refused ?? []) log(`site link: the site refused an event: ${x.error}`);
        setState('connected');
        out.emit('flushed', events.length);
        continue;
      }
      if (r?.status === 401) return unpaired();
      setState('offline');
      await sleep(backoff(failures++));
    }
  }

  // ---- down: commands from the site ----
  function saveDone() {
    const keep = [...done].slice(-MAX_DONE);
    done = new Map(keep);
    try {
      const tmp = `${doneFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(keep), { mode: 0o600 });
      fs.renameSync(tmp, doneFile);
    } catch (err) { log(`site link: couldn’t note a command as done: ${err.message}`); }
  }

  /** Whether a decision still holds here, now (lib/made-on.js). */
  async function checkMadeOn(madeOn) {
    const job = madeOn?.slug && madeOn.kind !== 'permission' && madeOn.kind !== 'stack' ? await runner.read.job(madeOn.slug).catch(() => null) : null;
    const permissions = madeOn?.kind === 'permission' ? ((await runner.read.runs?.().catch(() => null))?.permissions ?? []) : [];
    return stillMadeOn(madeOn, { job, permissions });
  }

  const sealedAnswers = new Map(); // id -> the sealed answer (memory only, for a repeat delivery)
  async function runOne({ id, command, madeOn = null, by = null, answerKey = null }) {
    let result = done.get(id);
    if (!result) {
      const parsed = parseCommand(command, { from: 'site' });
      const slug = command?.slug ?? madeOn?.slug ?? null;
      if (!parsed.ok) result = { ok: false, error: parsed.error };
      else {
        const check = madeOn ? await checkMadeOn(madeOn) : { ok: true };
        if (!check.ok) result = { ok: false, stale: true, error: `${check.why} Nothing was run.` };
        else {
          siteRunning = madeOn ? { slug, by, madeOn, id } : null;
          try {
            const answer = await runner.handle(command, { from: 'site' });
            result = { ok: true };
            if (typeof answerKey === 'string' && answerKey) sealedAnswers.set(id, seal(answerKey, answer ?? null));
          } catch (err) {
            result = { ok: false, error: String(err?.message ?? err).slice(0, 2000), ...(madeOn && MOVED_ON(err) ? { stale: true } : {}) };
          } finally { siteRunning = null; }
        }
      }
      done.set(id, result);
      saveDone();
      out.emit('command', id, result);
      if (madeOn) {
        const outcome = result.ok ? 'ran' : result.stale ? 'changed' : 'failed';
        const line = { action: 'site-decision', slug, type: command?.type ?? null, from: 'site', by: by?.name ?? null, madeOn, outcome, command: id, ...(result.ok ? {} : { error: result.error }) };
        try { await audit?.(line); } catch (err) { log(`site link: couldn’t write the audit line: ${err.message}`); }
        await send('audit', { at: new Date().toISOString(), from: 'site', who: by?.name ?? 'Someone on the site', action: command?.type ?? 'decision', job: slug, madeOn, outcome, command: id }, slug);
      }
      if (sealedAnswers.size > 50) sealedAnswers.delete(sealedAnswers.keys().next().value);
    }
    const sealed = sealedAnswers.get(id);
    const r = await call('POST', `/api/runner/commands/${encodeURIComponent(id)}/result`, sealed ? { ...result, sealed } : result).catch(() => null);
    if (r?.status === 401) unpaired();
  }

  async function commandLoop(gen) {
    let failures = 0;
    while (site && gen === generation) {
      let r = null;
      const asked = timers.now();
      try { r = await call('GET', `/api/runner/commands?wait=${waitSeconds}`, undefined, { timeoutMs: (waitSeconds + 15) * 1000 }); } catch { r = null; }
      if (gen !== generation) return;
      if (r?.status === 200) {
        failures = 0;
        setState('connected');
        out.emit('polled');
        const commands = r.body?.commands ?? [];
        for (const c of commands) {
          if (gen !== generation) return;
          if (c && typeof c.id === 'string') await runOne(c).catch((err) => log(`site link: ${err.message}`));
        }
        // A site that answers "nothing" at once (not waiting) is asked again a second later, not in a tight loop.
        if (!commands.length && timers.now() - asked < 1000) await sleep(1000);
        continue;
      }
      if (r?.status === 401) return unpaired();
      setState('offline');
      await sleep(backoff(failures++));
    }
  }

  // ---- team Telemetry: the usage upload (usageUploader above), beside the link while it is up ----
  async function usageLoop(gen) {
    const round = usageUploader({ stateDir, url: site.url, dir: usageFolder ?? usageDir({ stateDir }), read: runner.read, call, now: timers.now, log });
    let failures = 0;
    while (site && gen === generation) {
      try {
        const r = await round();
        if (gen !== generation) return;
        if (r.unpaired) { unpaired(); return; }
        failures = 0;
        if (r.sent.app + r.sent.claudeCode + r.sent.readings) out.emit('usage', r.sent);
      } catch (err) {
        if (gen !== generation) return;
        if (failures++ === 0) log(`site link: ${err.message}`);
      }
      await sleep(failures ? Math.max(usageEveryMs, backoff(failures)) : usageEveryMs);
    }
  }

  // ---- connecting ----
  async function connect() {
    const file = readSiteFile(stateDir);
    const token = file ? await store.get() : null;
    if (!running) return;
    if (!file || !token) { if (site) disconnect('idle'); return; }
    if (site && site.url === file.url && site.token === token) return;
    if (site) disconnect('idle');
    site = { url: file.url, token };
    const gen = ++generation;
    setState('connecting');
    me = file.person ?? null;
    offRunner = [runner.on('change', onChange), runner.on('run', onChange), runner.on('*', onRunnerEvent)];
    if (onAudit) offRunner.push(onAudit(onAuditLine) ?? (() => {}));
    await send('hello', { name: file.name ?? thisLaptop().name, os: thisLaptop().os, version, protocol: PROTOCOL_VERSION });
    await sendJobList();
    records.reset();
    // A runner with a snapshot (every real one) mirrors its whole record, then says so.
    if (runner.read.snapshot) {
      await records.sync({ full: true }).catch((err) => log(`site link: the record couldn’t be read: ${err.message}`));
      if (gen !== generation) return;
      await send('record', { kind: 'synced', key: '', value: { at: new Date(timers.now()).toISOString() } });
    }
    commandLoop(gen).catch((err) => log(`site link: ${err.message}`));
    usageLoop(gen).catch((err) => log(`site link: ${err.message}`));
  }

  function disconnect(why) {
    site = null;
    generation++;
    for (const off of offRunner) off();
    offRunner = [];
    clearTimeout(changeTimer);
    for (const ac of aborts) ac.abort();
    for (const w of [...wakeups]) w();
    setState(why);
  }

  const siteFile = path.join(stateDir, SITE_FILE);
  const onSiteFile = () => { connect().catch((err) => log(`site link: ${err.message}`)); };

  return {
    events: out,
    get state() { return state; },
    get connected() { return Boolean(site); },
    queued: () => queue.size(),
    start() {
      if (running) return this;
      running = true;
      if (watchEveryMs) { fs.watchFile(siteFile, { interval: watchEveryMs, persistent: false }, onSiteFile); watching = true; }
      onSiteFile();
      return this;
    },
    /** Checks site.json and the token again now (login and logout do this by themselves via the watch). */
    recheck: () => connect(),
    stop() {
      running = false;
      if (watching) { fs.unwatchFile(siteFile, onSiteFile); watching = false; }
      disconnect('stopped');
    },
  };
}
