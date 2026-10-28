// How much of the Claude plan's 5-hour and weekly limits is used, read once a minute for the top
// bar's usage meters. The same numbers Claude Code's /usage shows: GET api.anthropic.com/api/oauth/usage
// with the Claude Code sign-in you already have (macOS Keychain "Claude Code-credentials", else
// ~/.claude/.credentials.json). Read-only: nothing is sent but the request itself, and the token is
// never logged, stored or passed on. Off in demo mode and when WORKSHOP_PLAN_USAGE=off.
//
// The token, the clock and fetch are injectable, so tests never touch the network or the Keychain.
// After each good read the warnings at 80 %, 90 % and full are worked out (lib/usage-warnings.js);
// each one fired is also emitted as 'warning'.

import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { activeWarnings, UsageWarnings } from './usage-warnings.js';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const EVERY_MS = 60_000;
const TIMEOUT_MS = 10_000;
// A failed read is only worth showing when the numbers are old: Claude often answers 429 to one
// read and 200 to the next. A sign-in problem shows at once (it won't fix itself).
export const STALE_MS = 5 * 60_000;
// After a 429, the minute's reads wait this long (or Claude's Retry-After, up to MAX_WAIT_MS).
const WAIT_429_MS = 5 * 60_000;
const MAX_WAIT_MS = 15 * 60_000;

/** The Claude Code sign-in's access token, or null. Keychain first (macOS), then the credentials file. */
export async function readClaudeToken({ home = os.homedir(), platform = process.platform } = {}) {
  const pick = (raw) => {
    try { return JSON.parse(raw)?.claudeAiOauth?.accessToken || null; } catch { return null; }
  };
  if (platform === 'darwin') {
    const raw = await new Promise((resolve) => {
      execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000 }, (err, out) => resolve(err ? null : String(out).trim()));
    });
    const token = raw && pick(raw);
    if (token) return token;
  }
  try { return pick(await fs.readFile(path.join(home, '.claude', '.credentials.json'), 'utf8')); } catch { return null; }
}

const meter = (m) => {
  if (!m || typeof m !== 'object' || typeof m.utilization !== 'number') return null;
  const resetsAt = typeof m.resets_at === 'string' && !Number.isNaN(Date.parse(m.resets_at)) ? new Date(m.resets_at).toISOString() : null;
  return { percent: Math.max(0, Math.min(100, Math.round(m.utilization))), resetsAt };
};

/** The two meters the page shows, from the usage report; null for one the plan doesn't have. */
export function parseUsage(body) {
  return { fiveHour: meter(body?.five_hour), week: meter(body?.seven_day) };
}

export class PlanUsage extends EventEmitter {
  constructor({ getToken = readClaudeToken, fetchFn = globalThis.fetch, now = () => Date.now(), setTick = setInterval, clearTick = clearInterval, enabled = true, warnings = new UsageWarnings() } = {}) {
    super();
    Object.assign(this, { getToken, fetchFn, now, setTick, clearTick, enabled, warnings });
    this.last = null; // { fiveHour, week, checkedAt }
    this.error = null; // a short reason in words, or null
    this.lasting = false; // the error is one that won't fix itself (no sign-in, an expired one)
    this.waitUntil = 0; // after a 429, the timed reads skip until then
    this.tick = null;
    this.busy = null;
  }

  view() {
    return {
      enabled: this.enabled,
      fiveHour: this.last?.fiveHour ?? null,
      week: this.last?.week ?? null,
      checkedAt: this.last?.checkedAt ?? null,
      error: this.shownError(),
      // The banner's warnings (80 %, 90 %, full) from the last good reading, each with its text.
      warnings: activeWarnings(this.last, new Date(this.now())),
    };
  }

  /** The error, when it matters: a lasting one, no reading yet, or a last good reading STALE_MS old. */
  shownError() {
    if (!this.error) return null;
    if (this.lasting || !this.last) return this.error;
    return this.now() - Date.parse(this.last.checkedAt) >= STALE_MS ? this.error : null;
  }

  start() {
    if (!this.enabled || this.tick) return;
    this.check().catch(() => {});
    this.tick = this.setTick(() => { if (this.now() >= this.waitUntil) this.check().catch(() => {}); }, EVERY_MS);
    this.tick?.unref?.();
  }

  stop() { this.clearTick(this.tick); this.tick = null; }

  /** Reads the usage now (one at a time). Emits 'change' with the view when anything differs. */
  check() {
    if (!this.enabled) return Promise.resolve(this.view());
    this.busy ??= this.#read().finally(() => { this.busy = null; });
    return this.busy;
  }

  async #read() {
    const before = JSON.stringify(this.view());
    try {
      const token = await this.getToken();
      if (!token) { this.lasting = true; throw new Error('No Claude Code sign-in found on this computer.'); }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let res;
      try {
        res = await this.fetchFn(USAGE_URL, { headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' }, signal: ctrl.signal });
      } finally { clearTimeout(timer); }
      if (res.status === 429) {
        const secs = Number(res.headers?.get?.('retry-after'));
        this.waitUntil = this.now() + (secs > 0 ? Math.min(secs * 1000, MAX_WAIT_MS) : WAIT_429_MS);
      }
      this.lasting = res.status === 401;
      if (!res.ok) throw new Error(res.status === 401 ? 'The Claude sign-in has expired: run claude once to refresh it.' : `Claude answered ${res.status}.`);
      const meters = parseUsage(await res.json());
      this.last = { ...meters, checkedAt: new Date(this.now()).toISOString() };
      this.error = null;
      this.lasting = false;
      this.waitUntil = 0;
      // The warnings at 80 %, 90 % and full: only after a good read, and never in the way of the meters.
      try { for (const w of (await this.warnings?.onRead(meters)) ?? []) this.emit('warning', w); } catch { /* told next read */ }
    } catch (err) {
      this.error = err?.name === 'AbortError' ? 'Claude did not answer in time.' : (err instanceof Error ? err.message : 'Could not read the usage.');
    }
    const view = this.view();
    if (JSON.stringify(view) !== before) this.emit('change', view);
    return view;
  }
}
