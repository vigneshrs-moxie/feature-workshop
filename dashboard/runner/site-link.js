// The laptop's half of the hosted site (packet 2A, plan §2.4, decision G34): pairing this laptop
// once, and the link the runner and the site talk over. HTTPS only, no WebSocket.
//
// Pairing (`ground-control login --site <url>`, `ground-control logout`: bin/ground-control.js):
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

/** Where the runner token is kept: its own names in the same stores as the Orbit token. */
export const SITE_TOKEN_NAMES = Object.freeze({ service: 'Ground Control site token', account: 'runner', file: 'site-token' });
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
  try { u = new URL(String(raw ?? '').trim()); } catch { throw new SiteError('That isn’t a web address. Give the site’s address, like https://feature-workshop.example.com.'); }
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
 * `ground-control login --site <url>`: resolves { runner, person, rotated }.
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
    if (r.status !== 202) throw new SiteError(r.body?.error ?? `The pairing stopped (the site answered ${r.status}). Run ground-control login again.`);
    if (waited >= waitMs) throw new SiteError('Nobody pressed “Pair this laptop” within 10 minutes, so the code has run out. Run ground-control login again.');
    await sleep(every);
  }
}

/**
 * `ground-control logout`: the site forgets this laptop's token, then this laptop forgets it.
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

/**
 * The link. runner: { read, handle, on } (runner/index.js). store: siteTokenStore(). fetch, timers
 * ({ now, sleep }) and waitSeconds are for tests. Resolves nothing; start() and stop() are sync.
 */
export function createSiteLink({ runner, stateDir, store, fetch: fetchFn = globalThis.fetch, log = (l) => console.error(l), version = '', waitSeconds = 25, timers = REAL_TIMERS, debounceMs = 1000, watchEveryMs = 2000 }) {
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
    log('site link: the site no longer knows this laptop. Run ground-control login --site <the site’s address> to pair it again.');
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
    changeTimer = setTimeout(() => { jobsChanged().catch((err) => log(`site link: ${err.message}`)); }, debounceMs);
    changeTimer.unref?.();
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

  async function runOne({ id, command }) {
    let result = done.get(id);
    if (!result) {
      const parsed = parseCommand(command, { from: 'site' });
      if (!parsed.ok) result = { ok: false, error: parsed.error };
      else {
        try {
          await runner.handle(command, { from: 'site' });
          result = { ok: true };
        } catch (err) {
          result = { ok: false, error: String(err?.message ?? err).slice(0, 2000) };
        }
      }
      done.set(id, result);
      saveDone();
      out.emit('command', id, result);
    }
    const r = await call('POST', `/api/runner/commands/${encodeURIComponent(id)}/result`, result).catch(() => null);
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
          if (c && typeof c.id === 'string') await runOne(c);
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
    offRunner = [runner.on('change', onChange), runner.on('run', onChange)];
    await send('hello', { name: file.name ?? thisLaptop().name, os: thisLaptop().os, version, protocol: PROTOCOL_VERSION });
    await sendJobList();
    commandLoop(gen).catch((err) => log(`site link: ${err.message}`));
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
