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
//   unpairFromSite()   tells the site to forget this laptop's token, then forgets it here too.
//
// The link (createSiteLink, started by runner/index.js when site.json names a site; added in the
// next step).
//
// Nothing secret is ever printed, logged or written outside the credential store: site.json holds
// the address, this laptop's own random device id and who it was paired for.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tokenStore } from '../lib/orbit-token.js';

/** Where the runner token is kept: its own names in the same stores as the Orbit token. */
export const SITE_TOKEN_NAMES = Object.freeze({ service: 'Ground Control site token', account: 'runner', file: 'site-token' });
export const SITE_FILE = 'site.json';

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
      await store.set(r.body.token);
      writeSiteFile(stateDir, { url, deviceId, runnerId: r.body.runner.id, name: r.body.runner.name, pairedAt: new Date().toISOString(), person: { name: r.body.person.name, email: r.body.person.email } });
      return { runner: r.body.runner, person: r.body.person, rotated: Boolean(r.body.runner.rotated) };
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
  return { told, url: site?.url ?? null };
}

