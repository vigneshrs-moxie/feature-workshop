// What the link and mirror tests share: a made-up person with a paired laptop, a pretend runner,
// and that runner's link to the in-process site.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSiteLink, siteTokenStore, writeSiteFile } from '../../dashboard/runner/site-link.js';
import { browser, signIn, SITE } from './helpers.js';

export const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gc-2a-link-'));

export async function until(check, { ms = 8000, what = 'the condition' } = {}) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** A signed-in made-up person and a laptop paired for them: { person, token, runnerId }. */
export async function paired(s, email, name = 'Test Laptop', { person = null } = {}) {
  if (!person) { person = browser(s.fetch); await signIn(person, { email }); }
  const post = async (p, body) => (await s.fetch(`${SITE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const st = await post('/api/pair/start', { name, os: 'macOS', deviceId: `device-${`${email}-${name}`.replace(/\W/g, '')}`.slice(0, 64) });
  assert.equal((await person.send('POST', `/api/pair/${st.code}/approve`, {})).status, 200);
  const fin = await post('/api/pair/finish', { secret: st.secret });
  return { person, token: fin.token, runnerId: fin.runner.id };
}

/** A pretend runner: its open jobs as the board's cards, the commands it was asked to run. */
export function fakeRunner(cards = []) {
  const ee = new EventEmitter();
  const r = {
    cards, handled: [],
    read: { features: async () => ({ features: r.cards }) },
    async handle(cmd) { r.handled.push(cmd); return { ok: true }; },
    on(type, fn) { ee.on(type, fn); return () => ee.off(type, fn); },
    changed() { ee.emit('change'); },
  };
  return r;
}

export const card = (slug, extra = {}) => ({ slug, title: `Job ${slug}`, stage: 'build', lane: 'working', laneReason: 'Working', nowDoing: [{ name: 'Builder', doing: 'Writing the tests' }], updatedAt: '2026-10-30T15:00:00.000Z', ...extra });

export async function laptop(s, token, { runner = fakeRunner(), fetch = s.fetch, stateDir = tmp(), waitSeconds = 1, log = () => {} } = {}) {
  writeSiteFile(stateDir, { url: SITE, deviceId: 'device-test-0001', runnerId: 1, name: 'Test Laptop' });
  const store = await siteTokenStore({ stateDir, prefer: 'file' });
  await store.set(token);
  const link = createSiteLink({ runner, stateDir, store, fetch, waitSeconds, debounceMs: 20, watchEveryMs: 0, log, version: '0.1.0' });
  return { link: link.start(), runner, stateDir, store };
}

