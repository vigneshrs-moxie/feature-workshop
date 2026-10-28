// Ground Control's side of Portal Feedback (ORBIT-479): read the person's tickets with their own
// read-only token, and nothing else. Every request this file makes is a GET to /api/feedback/v1;
// there is no write path, and a test (orbit.test.js) greps dashboard/lib to keep it that way.
//
//   the token     setToken / clearToken: validated, kept in the OS credential store
//                 (lib/orbit-token.js), and wired into Claude Code's MCP settings for the Foreman
//                 as ${ORBIT_FEEDBACK_TOKEN} (never the token itself)
//   ticket keys   parseTicketKey / canonicalKey: ORBIT-479, orbit-479, orbit479, #479, 479
//
// Paths, the store, fetch and the clock are injectable, so tests never touch ~/.claude, the
// Keychain or a real Orbit.

import { randomUUID } from 'node:crypto';
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
