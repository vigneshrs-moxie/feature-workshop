// Ground Control's side of Portal Feedback (ORBIT-479): read the person's tickets with their own
// read-only token, and nothing else. Every request this file makes is a GET to /api/feedback/v1;
// there is no write path, and a test (orbit.test.js) greps dashboard/lib to keep it that way.
//
//   the token     setToken / clearToken: validated, kept in the OS credential store
//                 (lib/orbit-token.js), and wired into Claude Code's MCP settings for the Foreman
//                 as ${ORBIT_FEEDBACK_TOKEN} (never the token itself)
//   ticket keys   parseTicketKey / canonicalKey: ORBIT-479, orbit-479, orbit479, #479, 479
//   the client    orbitClient: the four v1 GETs, paging, 401 and 429
//   the inbox     OrbitInbox: polls what's assigned to you and what you watch, every 3 minutes
//                 while a browser has the Inbox open, every 15 otherwise; keeps the last list
//
// Paths, the store, fetch and the clock are injectable, so tests never touch ~/.claude, the
// Keychain or a real Orbit.

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';

// ---------- Tokens ----------

export const TOKEN_PREFIX = 'orbfb_';
/** The prefix plus 32 random bytes in base64url (43 characters), as Orbit mints them. */
export const TOKEN_PATTERN = /^orbfb_[A-Za-z0-9_-]{43}$/;
/** The Claude Code MCP server name the Foreman reads tickets through, and the variable it reads the token from. */
export const MCP_NAME = 'orbit-feedback';
export const TOKEN_ENV = 'ORBIT_FEEDBACK_TOKEN';

export class OrbitError extends Error {
  /** kind: 'token' (bad or missing token), 'auth' (401), 'scope' (403), 'not-found', 'rate' (429), 'network', 'http', 'settings'. */
  constructor(message, { kind = 'http', status = null, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'OrbitError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** The pasted token, trimmed, or an OrbitError saying what is wrong with it in plain words. */
export function checkToken(raw) {
  const token = typeof raw === 'string' ? raw.trim().replace(/^Bearer\s+/i, '') : '';
  if (!token) throw new OrbitError('Paste your Orbit token first.', { kind: 'token' });
  if (!token.startsWith(TOKEN_PREFIX)) throw new OrbitError('That is not an Orbit feedback token: it should start with orbfb_. Make one on Orbit’s API tokens page.', { kind: 'token' });
  if (!TOKEN_PATTERN.test(token)) throw new OrbitError('That token is the wrong length or has a stray character. Copy it again from Orbit, all of it.', { kind: 'token' });
  return token;
}

/**
 * Orbit's address as typed (https://orbit.example.com, with or without a trailing slash), or an
 * OrbitError. https only, except on this computer (http://127.0.0.1 or localhost, for a local Orbit).
 */
export function normalizeOrbitUrl(raw) {
  let u;
  try { u = new URL(String(raw ?? '').trim()); } catch { throw new OrbitError('Orbit’s address should look like https://orbit.example.com.', { kind: 'settings' }); }
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new OrbitError('Orbit’s address must start with https:// (http:// only for one on this computer).', { kind: 'settings' });
  if (u.username || u.password || u.search || u.hash) throw new OrbitError('Orbit’s address should be just the site, like https://orbit.example.com.', { kind: 'settings' });
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/** The MCP entry the Foreman's Claude Code session reads tickets through. The token is a variable, never the value. */
export function mcpEntry(orbitUrl) {
  return { type: 'http', url: `${orbitUrl}/api/mcp/feedback`, headers: { Authorization: `Bearer \${${TOKEN_ENV}}` } };
}

async function readJsonFile(file) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return { data: {}, mode: 0o600 }; throw err; }
  let data;
  try { data = text.trim() ? JSON.parse(text) : {}; } catch { throw new OrbitError(`${file} isn’t valid JSON, so it was left alone. Fix it, then save the token again.`, { kind: 'settings' }); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new OrbitError(`${file} isn’t a settings object, so it was left alone.`, { kind: 'settings' });
  const mode = (await fs.stat(file)).mode & 0o777;
  return { data, mode };
}

async function writeJsonFile(file, data, mode) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode });
  await fs.rename(tmp, file);
}

/** Adds (or replaces) mcpServers['orbit-feedback'] in Claude Code's settings file, keeping everything else. */
export async function writeMcpEntry(settingsFile, orbitUrl) {
  const { data, mode } = await readJsonFile(settingsFile);
  const servers = data.mcpServers && typeof data.mcpServers === 'object' && !Array.isArray(data.mcpServers) ? data.mcpServers : {};
  data.mcpServers = { ...servers, [MCP_NAME]: mcpEntry(orbitUrl) };
  await writeJsonFile(settingsFile, data, mode);
}

/** Takes mcpServers['orbit-feedback'] out again (and mcpServers, if nothing else is left). True when it was there. */
export async function removeMcpEntry(settingsFile) {
  let read;
  try { read = await readJsonFile(settingsFile); } catch { return false; } // unreadable: not ours to touch
  const { data, mode } = read;
  if (!data.mcpServers || typeof data.mcpServers !== 'object' || !(MCP_NAME in data.mcpServers)) return false;
  const { [MCP_NAME]: _gone, ...rest } = data.mcpServers;
  if (Object.keys(rest).length) data.mcpServers = rest; else delete data.mcpServers;
  await writeJsonFile(settingsFile, data, mode);
  return true;
}

/**
 * Saves a pasted token: checks it, keeps it in `store` (lib/orbit-token.js), and writes the
 * Foreman's MCP entry for `orbitUrl` into `claudeSettingsFile`. Returns { store: kind }.
 */
export async function setToken(raw, { store, claudeSettingsFile, orbitUrl }) {
  const token = checkToken(raw);
  const url = normalizeOrbitUrl(orbitUrl);
  await store.set(token);
  await writeMcpEntry(claudeSettingsFile, url);
  rememberSecret(token);
  return { store: store.kind };
}

/** Forgets the token: out of the store, and the MCP entry out of Claude Code's settings. */
export async function clearToken({ store, claudeSettingsFile }) {
  await store.clear();
  const removed = await removeMcpEntry(claudeSettingsFile);
  return { removed };
}

/** The variable a Foreman session needs for the MCP entry: { ORBIT_FEEDBACK_TOKEN } when a token is saved, else {}. */
export async function sessionEnv(store) {
  const token = await store.get().catch(() => null);
  return token ? { [TOKEN_ENV]: token } : {};
}

// ---------- Ticket keys ----------

/** The number in ORBIT-123, orbit-123, orbit123, #123 or 123 (Orbit's own lenient rule), else null. */
export function parseTicketKey(raw) {
  const m = /^(?:orbit-?)?#?(\d{1,9})$/i.exec(String(raw ?? '').trim());
  return m ? Number(m[1]) : null;
}

export const ticketKey = (n) => `ORBIT-${n}`;

/** ORBIT-123 for any lenient form, else null. */
export function canonicalKey(raw) {
  const n = parseTicketKey(raw);
  return n === null ? null : ticketKey(n);
}

// ---------- Secrets seen this run ----------

// Tokens saved while the dashboard runs: scrub() hides them by value as well as by shape.
const knownSecrets = new Set();
export function rememberSecret(value) { if (typeof value === 'string' && value.length >= 12) knownSecrets.add(value); }
export const rememberedSecrets = () => [...knownSecrets];

// ---------- The client: four GETs, nothing else ----------

export const API_BASE = '/api/feedback/v1';
/** Orbit's page size for the tickets list. */
export const PAGE_SIZE = 50;
const MAX_PAGES = 20; // 1000 tickets: more than any inbox; the list says when it stopped short
const TIMEOUT_MS = 15_000;
// After a 429 without a Retry-After, every request waits this long; never more than MAX_WAIT_MS.
const WAIT_429_MS = 60_000;
const MAX_WAIT_MS = 15 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Retry-After in milliseconds (seconds or an HTTP date), else null. */
export function retryAfterMs(header, now = Date.now()) {
  if (header === null || header === undefined || header === '') return null;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, MAX_WAIT_MS);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.min(Math.max(0, at - now), MAX_WAIT_MS);
}

/** YYYY-MM-DD for `from=`: the day before `since` (UTC), so Orbit's own time zone can't skip an hour. */
export function fromDay(since) {
  return new Date(new Date(since).getTime() - 86_400_000).toISOString().slice(0, 10);
}

/** A ticket's last change: activityAt on the team's rows, updatedAt on a participant's. */
export const changedAt = (row) => row?.activityAt ?? row?.updatedAt ?? null;

/** The ref for a URL: ORBIT-<n> for any lenient form, a UUID as is; else an OrbitError. */
export function ticketRef(raw) {
  const s = String(raw ?? '').trim();
  if (UUID.test(s)) return s.toLowerCase();
  const key = canonicalKey(s);
  if (!key) throw new OrbitError('That isn’t a ticket key: use ORBIT- and the number, like ORBIT-479.', { kind: 'not-found', status: 404 });
  return key;
}

const STATUS_WORDS = {
  401: 'Your Orbit token expired or was revoked. Make a new one on Orbit’s API tokens page and paste it in Settings.',
  403: 'Your Orbit token can’t read this: it needs the tickets:read and views:read scopes, and views are for the feedback team only.',
  404: 'Orbit has no ticket by that key that you can see.',
};

/**
 * A client for one Orbit, as the person whose token it is. `baseUrl` and `getToken` may change
 * while it runs (Settings), so both are read on every request. Every method is a GET.
 *   listTickets(query, { since })   every page of the tracker query (50 at a time); with `since`,
 *                                   only tickets changed since then (`datefield=updated&from=<day>`,
 *                                   then to the minute here)
 *   getTicket(ref)                  one ticket, with its timeline
 *   listReferences(ref)             its branches, PRs and links
 *   listViews()                     your saved tracker views
 * A 429 pauses every request until Retry-After (or a minute) has passed: they fail at once with
 * kind 'rate' until then, without asking Orbit.
 */
export function orbitClient({ baseUrl, getToken, fetchFn = globalThis.fetch, now = () => Date.now() }) {
  let waitUntil = 0;
  const base = () => (typeof baseUrl === 'function' ? baseUrl() : baseUrl);

  async function get(pathname, params = null) {
    if (now() < waitUntil) {
      throw new OrbitError('Orbit asked Ground Control to slow down; it tries again in a moment.', { kind: 'rate', status: 429, retryAfterMs: waitUntil - now() });
    }
    const url = base();
    if (!url) throw new OrbitError('Orbit’s address isn’t set yet. Add it in Settings with your token.', { kind: 'settings' });
    const token = await getToken();
    if (!token) throw new OrbitError('No Orbit token yet. Paste one in Settings.', { kind: 'token' });
    const qs = params && [...params].length ? `?${params}` : '';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetchFn(`${url}${API_BASE}${pathname}${qs}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'error', // a redirect could carry the token somewhere else
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new OrbitError(err?.name === 'AbortError' ? 'Orbit did not answer in time.' : 'Could not reach Orbit. Check its address and your connection.', { kind: 'network' });
    } finally { clearTimeout(timer); }
    if (res.status === 429) {
      const wait = retryAfterMs(res.headers?.get?.('retry-after'), now()) ?? WAIT_429_MS;
      waitUntil = now() + wait;
      throw new OrbitError('Orbit asked Ground Control to slow down; it tries again in a moment.', { kind: 'rate', status: 429, retryAfterMs: wait });
    }
    if (!res.ok) {
      const kind = res.status === 401 ? 'auth' : res.status === 403 ? 'scope' : res.status === 404 ? 'not-found' : 'http';
      throw new OrbitError(STATUS_WORDS[res.status] ?? `Orbit answered ${res.status}.`, { kind, status: res.status });
    }
    try { return await res.json(); } catch { throw new OrbitError('Orbit sent something that isn’t JSON.', { kind: 'http', status: res.status }); }
  }

  async function listTickets(query = '', { since = null } = {}) {
    const params = new URLSearchParams(typeof query === 'string' ? query.replace(/^\?/, '') : query);
    params.delete('page');
    if (since) { params.set('datefield', 'updated'); params.set('from', fromDay(since)); }
    const tickets = [];
    let first = null;
    let truncated = false;
    for (let page = 1; ; page++) {
      params.set('page', String(page));
      const body = await get('/tickets', params);
      first ??= body;
      const rows = Array.isArray(body?.tickets) ? body.tickets : [];
      tickets.push(...rows);
      const total = Number(body?.total) || 0;
      if (rows.length < PAGE_SIZE || tickets.length >= total) break;
      if (page >= MAX_PAGES) { truncated = true; break; }
    }
    const cutoff = since ? Math.floor(new Date(since).getTime() / 60_000) * 60_000 : null;
    const kept = cutoff === null ? tickets : tickets.filter((t) => Date.parse(changedAt(t)) >= cutoff);
    return { audience: first?.audience ?? 'tech', total: Number(first?.total) || kept.length, ignored: first?.ignored ?? [], statusCounts: first?.statusCounts ?? {}, tickets: kept, truncated };
  }

  return {
    listTickets,
    getTicket: async (ref) => get(`/tickets/${encodeURIComponent(ticketRef(ref))}`),
    listReferences: async (ref) => get(`/tickets/${encodeURIComponent(ticketRef(ref))}/references`),
    listViews: () => get('/views'),
    /** Milliseconds until Orbit's Retry-After has passed (0 when nothing waits). */
    waiting: () => Math.max(0, waitUntil - now()),
  };
}

// ---------- The inbox: polled, cached, one request at a time ----------

/** Every status but resolved and closed (Orbit's UNFINISHED_STATUSES). */
export const OPEN_STATUSES = ['open', 'backlog', 'planning', 'ready_for_development', 'in_progress', 'code_review', 'testing', 'uat', 'ready_for_release'];
/** What the inbox reads: tickets assigned to you, and tickets you watch, open ones only. */
export const INBOX_QUERIES = [
  { id: 'assigned', query: `assignee=me&status=${OPEN_STATUSES.join(',')}` },
  { id: 'watching', query: `watched=me&status=${OPEN_STATUSES.join(',')}` },
];
export const OPEN_EVERY_MS = 3 * 60_000; // a browser has the Inbox open
export const IDLE_EVERY_MS = 15 * 60_000; // nobody is looking
// Between full reads only what changed is fetched; a full read catches tickets that left the list.
export const FULL_EVERY_MS = 60 * 60_000;
const VIEW_LIST_MS = 60_000; // a saved view's tickets, fetched when its tab opens
const VIEWS_MS = 24 * 60 * 60_000; // the saved views themselves: daily, and after a new token

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * One inbox row from an Orbit row (the team's TrackerRow or a participant's ParticipantRow).
 * `why`: ['assigned', 'watching'] (which inbox list it came from; empty for a saved view's list).
 * Priority and severity are null where Orbit doesn't show them (a participant's rows).
 */
export function inboxItem(row, { why = [], audience = 'tech', orbitUrl = null } = {}) {
  const key = ticketKey(row.number);
  const assignedToYou = why.includes('assigned');
  const assignee = assignedToYou ? { name: 'You', you: true }
    : row.assignee?.name ? { name: row.assignee.name, you: false }
      : row.assignedToId ? { name: 'Someone else', you: false } : null;
  return {
    key, number: row.number, id: row.id ?? null, title: String(row.subject ?? ''), type: row.type ?? null, status: row.status ?? null,
    priority: audience === 'tech' ? row.priority ?? null : null,
    severity: audience === 'tech' ? row.severity ?? null : null,
    createdAt: row.createdAt ?? null, changedAt: changedAt(row), assignee, why: [...why],
    url: orbitUrl ? `${orbitUrl}${audience === 'tech' ? '/admin/feedback/' : '/feedback/'}${key}` : null,
  };
}

/** Inbox order: severity (critical first, untriaged last), then priority, then the latest change first. */
export function sortItems(items) {
  const rank = (v, order) => (v && v in order ? order[v] : 9);
  return [...items].sort((a, b) => rank(a.severity, SEVERITY_ORDER) - rank(b.severity, SEVERITY_ORDER)
    || rank(a.priority, PRIORITY_ORDER) - rank(b.priority, PRIORITY_ORDER)
    || String(b.changedAt ?? '').localeCompare(String(a.changedAt ?? '')));
}

/**
 * The inbox poller. Emits 'change' with view() whenever the list, its time or its error changes.
 *   start() / stop()   poll now (when due) and on the cadence, or not at all
 *   watch()            a browser opened the Inbox: the cadence is OPEN_EVERY_MS until the
 *                      returned function is called (IDLE_EVERY_MS once nobody watches)
 *   refresh({ full })  poll now; while one runs, callers share it (one request in flight)
 *   reset()            forget everything (the token was cleared or replaced)
 * The last list is kept with its time, so the Inbox still shows it while Orbit is out of reach.
 */
export class OrbitInbox extends EventEmitter {
  constructor({ client, orbitUrl = () => null, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, queries = INBOX_QUERIES } = {}) {
    super();
    Object.assign(this, { client, orbitUrl, now, setTimer, clearTimer, queries });
    this.watchers = 0;
    this.running = false;
    this.timer = null;
    this.busy = null;
    this.#clear();
  }

  #clear() {
    this.rows = new Map(); // number → { row, audience, why: Set }
    this.checkedAt = null; // when the last good poll started (ISO)
    this.fullAt = 0;
    this.lastTryAt = null; // when the last poll, good or not, started (ms)
    this.error = null;
    this.errorKind = null;
    this.viewLists = new Map(); // view id → { at, items, error }
    this.savedViews = null; // { at, views }
  }

  everyMs() { return this.watchers > 0 ? OPEN_EVERY_MS : IDLE_EVERY_MS; }

  view() {
    const url = this.orbitUrl();
    const items = [...this.rows.values()].map((r) => inboxItem(r.row, { why: [...r.why].sort(), audience: r.audience, orbitUrl: url }));
    return {
      items: sortItems(items), checkedAt: this.checkedAt, error: this.error, errorKind: this.errorKind,
      lastTryAt: this.lastTryAt ? new Date(this.lastTryAt).toISOString() : null,
      everyMs: this.everyMs(), watchers: this.watchers, waitingMs: this.client.waiting?.() ?? 0, polling: this.running,
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.#schedule();
  }

  stop() {
    this.running = false;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }

  reset() {
    this.stop();
    this.#clear();
    this.emit('change', this.view());
  }

  watch() {
    this.watchers++;
    if (this.watchers === 1) this.#schedule();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.watchers = Math.max(0, this.watchers - 1);
      if (this.watchers === 0) this.#schedule();
    };
  }

  refresh({ full = false } = {}) {
    this.busy ??= this.#poll(full).finally(() => { this.busy = null; this.#schedule(); });
    return this.busy;
  }

  #schedule() {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    if (!this.running || this.busy) return; // a poll in flight schedules the next when it ends
    const due = this.lastTryAt === null ? this.now() : this.lastTryAt + this.everyMs();
    const wait = Math.max(0, due - this.now(), this.client.waiting?.() ?? 0);
    this.timer = this.setTimer(() => { this.timer = null; this.refresh().catch(() => {}); }, wait);
    this.timer?.unref?.();
  }

  async #poll(forceFull) {
    const before = JSON.stringify(this.view());
    const started = this.now();
    this.lastTryAt = started;
    const full = forceFull || !this.checkedAt || started - this.fullAt >= FULL_EVERY_MS;
    const since = full ? null : this.checkedAt;
    try {
      const next = full ? new Map() : new Map([...this.rows].map(([n, r]) => [n, { ...r, why: new Set(r.why) }]));
      for (const q of this.queries) {
        const list = await this.client.listTickets(q.query, { since });
        for (const row of list.tickets) {
          if (!Number.isInteger(row?.number)) continue;
          const had = next.get(row.number);
          next.set(row.number, { row, audience: list.audience, why: new Set([...(had?.why ?? []), q.id]) });
        }
      }
      this.rows = next;
      this.checkedAt = new Date(started).toISOString();
      if (full) this.fullAt = started;
      this.error = null;
      this.errorKind = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Could not read the inbox.';
      this.errorKind = err?.kind ?? 'http';
    }
    const view = this.view();
    if (JSON.stringify(view) !== before) this.emit('change', view);
    return view;
  }

  /** Your saved views, for the Inbox's tabs: read daily (and after a new token). */
  async views() {
    if (this.savedViews && this.now() - this.savedViews.at < VIEWS_MS) return this.savedViews.views;
    const body = await this.client.listViews();
    const views = (Array.isArray(body?.views) ? body.views : []).map((v) => ({ id: String(v.id), name: String(v.name ?? 'Untitled view'), query: String(v.query ?? ''), isDefault: v.isDefault === true }));
    this.savedViews = { at: this.now(), views };
    return views;
  }

  /** A saved view's tickets, read when its tab opens (kept for a minute). */
  async viewList(id) {
    const hit = this.viewLists.get(id);
    if (hit && this.now() - hit.at < VIEW_LIST_MS) return hit;
    const view = (await this.views()).find((v) => v.id === id);
    if (!view) throw new OrbitError('That saved view is gone. Its tab goes when the list of views is read again.', { kind: 'not-found', status: 404 });
    const list = await this.client.listTickets(view.query);
    const url = this.orbitUrl();
    const entry = { at: this.now(), checkedAt: new Date(this.now()).toISOString(), items: list.tickets.filter((r) => Number.isInteger(r?.number)).map((r) => inboxItem(r, { audience: list.audience, orbitUrl: url })), truncated: list.truncated };
    this.viewLists.set(id, entry);
    return entry;
  }
}
