// The Orbit inbox on the site (packet 2C), end to end in a browser, with screenshots.
//
//   node hosted/e2e/orbit-inbox.mjs [--out <folder>] [--no-build]
//   (Playwright: PLAYWRIGHT_MODULE names its index.mjs when it isn't installed here; with
//    PLAYWRIGHT_BROWSERS_PATH=0 its browsers come from inside that package.)
//
// 1. Starts the site on http://localhost:4511: the handler Vercel runs (site/router.js), PGlite in
//    memory, the fake Google, the page built by hosted/scripts/build.js, and a pretend Orbit
//    answered in this process (test/fake-orbit.js): nothing reaches the network.
// 2. A made-up person signs in and pairs two made-up laptops through the site's own calls (one
//    calls in, so it is online; the other never does).
// 3. At 1512 and 390 px wide, in Light: Settings → Orbit empty, a made-up token pasted, saved; the
//    cron job run with its secret; the Inbox from the site (a Start waiting for the laptop that is
//    off, a ticket already on a job); the expiry banner; Start asking which laptop.
// 4. Checks that no page, answer or stored row holds the token. A console error fails the run.
// Everything it started is stopped at the end.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../site/config.js';
import { openPglite } from '../site/db.js';
import { migrate } from '../site/migrate.js';
import { createSite } from '../site/router.js';
import { FAKE_ORBIT, fakeOrbit, testToken, ticket } from '../test/fake-orbit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PORT = 4511;
const SITE = `http://localhost:${PORT}`;
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(arg('--out') ?? path.join(os.tmpdir(), 'gc-2c-shots'));
const OLIVE = { email: 'olive.owner@example.test', name: 'Olive Owner' };
const TOKEN = testToken('olive');
const CRON_SECRET = crypto.randomBytes(32).toString('base64');
const WIDTHS = [[1512, 900], [390, 844]];

const log = (l) => console.log(`e2e: ${l}`);
const consoleErrors = [];

// Made-up tickets: a few severities, one watched, one already on a job.
const ASSIGNED = [
  ticket(512, { subject: 'Route sheet prints the wrong technician name', severity: 'critical', type: 'bug', createdAt: '2026-10-21T09:00:00.000Z' }),
  ticket(498, { subject: 'Add a filter for unpaid invoices', severity: 'high', createdAt: '2026-10-14T09:00:00.000Z' }),
  ticket(505, { subject: 'Tidy the export button on the tracker', severity: 'medium', createdAt: '2026-10-25T09:00:00.000Z' }),
  ticket(477, { subject: 'Customer notes lose their line breaks', severity: null, type: 'bug', createdAt: '2026-10-09T09:00:00.000Z' }),
  ticket(520, { subject: 'Show the next visit on the account page', severity: 'low', createdAt: '2026-10-28T09:00:00.000Z' }),
];
const WATCHING = [ticket(469, { subject: 'Speed up the day view for large branches', severity: 'high', assignedToId: null, createdAt: '2026-10-02T09:00:00.000Z' })];

async function signIn(page) {
  await page.goto(`${SITE}/`);
  await page.getByRole('link', { name: /Sign in with Google/ }).click();
  await page.waitForURL(/\/fake-google\/authorize/);
  await page.fill('input[name=email]', OLIVE.email);
  await page.fill('input[name=name]', OLIVE.name);
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function main() {
  if (!process.argv.includes('--no-build')) {
    log('building the page for the site');
    await new Promise((resolve, reject) => {
      const b = spawn(process.execPath, [path.join(ROOT, 'hosted', 'scripts', 'build.js'), '--no-migrate'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, VERCEL: '' } });
      b.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('the build failed'))));
    });
  }
  fs.mkdirSync(OUT, { recursive: true });

  // 1. The site, with the pretend Orbit behind its fetch.
  const orbit = fakeOrbit();
  orbit.person(TOKEN, { assigned: ASSIGNED, watching: WATCHING });
  const db = await openPglite();
  await migrate(db);
  const config = readConfig({
    AUTH_FAKE: '1', PORT: String(PORT), SITE_URL: SITE, ALLOWED_DOMAIN: 'example.test', OWNER_EMAIL: OLIVE.email,
    SESSION_SECRET: crypto.randomBytes(32).toString('base64'), CRON_SECRET, TOKEN_KEY: crypto.randomBytes(32).toString('base64'), ORBIT_BASE_URL: FAKE_ORBIT,
  });
  const answers = [];
  const siteFetch = (input, init) => (String(input).startsWith(FAKE_ORBIT) ? orbit.fetch(input, init) : globalThis.fetch(input, init));
  const site = createSite({ db, config, fetch: siteFetch, staticDir: path.join(HERE, '..', 'public') });
  const logs = [];
  site.ctx.log = (line) => { logs.push(line); };
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      const chunks = [];
      const write = res.write.bind(res);
      const end = res.end.bind(res);
      res.write = (c, ...a) => { if (c) chunks.push(Buffer.from(c)); return write(c, ...a); };
      res.end = (c, ...a) => { if (c && typeof c !== 'function') chunks.push(Buffer.from(c)); answers.push(Buffer.concat(chunks).toString('utf8')); return end(c, ...a); };
    }
    return site(req, res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve); });
  log(`site at ${SITE}`);

  const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  const browser = await pw.chromium.launch();
  const post = async (p, body, headers = {}) => (await globalThis.fetch(`${SITE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })).json();
  try {
    const contextFor = async ({ width = 1512, height = 900 } = {}) => {
      const c = await browser.newContext({ viewport: { width, height } });
      await c.addInitScript(() => { try { localStorage.setItem('workshop.theme', 'light'); localStorage.setItem('gc.guide.seen', JSON.stringify(['hosted-jobs', 'hosted-inbox'])); } catch { /* none */ } });
      c.on('page', (p) => p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${p.url()}: ${m.text()}`); }));
      return c;
    };

    // 2. Sign in; pair two laptops through the site's own calls.
    const main = await contextFor();
    const page = await main.newPage();
    await signIn(page);
    await page.getByRole('heading', { name: 'Jobs', exact: true }).waitFor();
    const laptops = {};
    for (const [key, name, os] of [['mac', 'Olive’s Mac', 'macOS'], ['spare', 'Olive’s spare laptop', 'Windows']]) {
      const st = await post('/api/pair/start', { name, os, deviceId: `device-e2e-${key}` });
      const ok = await main.request.post(`${SITE}/api/pair/${st.code}/approve`, { data: {}, headers: { origin: SITE } });
      if (!ok.ok()) throw new Error(`pairing ${name}: ${ok.status()}`);
      const fin = await post('/api/pair/finish', { secret: st.secret });
      laptops[key] = { id: fin.runner.id, token: fin.token, name };
    }
    const callIn = async (l) => globalThis.fetch(`${SITE}/api/runner/commands?wait=0`, { headers: { authorization: `Bearer ${l.token}` } });
    // The Mac is on and has a job on ORBIT-498; the spare laptop never calls in.
    await callIn(laptops.mac);
    await post('/api/runner/events', { events: [{ eid: 'e2e-1', type: 'job-list', job: null, data: { jobs: [{ slug: 'orbit-498-unpaid-invoice-filter', title: 'ORBIT-498: Add a filter for unpaid invoices', ticket: 'ORBIT-498', stage: 'plan', state: 'needs-you', stateWords: 'Needs you: the plan', now: 'Needs you: the plan', updatedAt: new Date().toISOString() }] } }] }, { authorization: `Bearer ${laptops.mac.token}` });
    log('two laptops paired, the Mac online with one job');
    const cron = async () => { const r = await globalThis.fetch(`${SITE}/api/cron/inbox`, { headers: { authorization: `Bearer ${CRON_SECRET}` } }); if (r.status !== 204) throw new Error(`cron answered ${r.status}`); };
    if ((await globalThis.fetch(`${SITE}/api/cron/inbox`)).status !== 401) throw new Error('the cron job answered without its secret');
    const check = (ok, what) => { if (!ok) throw new Error(`Check failed: ${what}`); log(`ok: ${what}`); };
    const shot = async (p, name) => { await p.waitForTimeout(300); await p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }); };

    // 3. The shots, at each width.
    for (const [width, height] of WIDTHS) {
      const c = await contextFor({ width, height });
      await c.addCookies((await main.cookies()).filter((k) => k.name === 'gc_session'));
      const p = await c.newPage();
      await c.request.delete(`${SITE}/api/orbit/token`, { data: {}, headers: { origin: SITE } });
      await db.query('DELETE FROM inbox_starts');
      await db.query('DELETE FROM commands');

      await p.goto(`${SITE}/#/settings/orbit`);
      await p.getByLabel('Your token').waitFor();
      await shot(p, `orbit-settings-empty-${width}`);
      await p.getByLabel('Your token').fill(TOKEN);
      await p.getByRole('radio', { name: '30 days' }).click();
      await p.getByRole('button', { name: 'Save the token' }).click();
      await p.getByText(/^Saved · expires /).waitFor();
      check(!(await p.content()).includes('orbfb_'), `the saved page at ${width} px holds no token`);
      await shot(p, `orbit-settings-saved-${width}`);

      await cron();
      await callIn(laptops.mac);
      const queued = await c.request.post(`${SITE}/api/orbit/start`, { data: { key: 'ORBIT-505', laptopId: laptops.spare.id }, headers: { origin: SITE } });
      if (!queued.ok()) throw new Error(`Start on the spare laptop: ${queued.status()} ${await queued.text()}`);
      await p.goto(`${SITE}/#/inbox`);
      await p.getByText('Route sheet prints the wrong technician name').first().waitFor();
      // What is on its way, or already on a job, is under Can wait: open it for the shot.
      const more = p.locator('.inbox-wait .more-head');
      if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
      await p.getByText('Starts when your laptop is back').first().waitFor();
      await shot(p, `inbox-${width}`);
      if (width < 600) { await more.evaluate((el) => el.scrollIntoView({ block: 'start' })); await p.waitForTimeout(200); await p.screenshot({ path: path.join(OUT, `inbox-can-wait-${width}.png`) }); }

      await db.query('UPDATE orbit_tokens SET refused_at = now()');
      await p.reload();
      await p.getByText(/Your Orbit token expired\. Paste a new one in/).waitFor();
      await shot(p, `inbox-expired-${width}`);
      await db.query('UPDATE orbit_tokens SET refused_at = NULL');

      await p.reload();
      await callIn(laptops.mac);
      await p.getByRole('button', { name: 'Start a job on ORBIT-512' }).first().click();
      await p.getByRole('dialog', { name: 'Which laptop starts ORBIT-512?' }).waitFor();
      await p.waitForTimeout(300);
      await p.screenshot({ path: path.join(OUT, `inbox-choose-laptop-${width}.png`) }); // the sheet over the page, as it is seen
      await p.getByRole('button', { name: 'Start on Olive’s Mac' }).click();
      await p.getByText(/Starting on Olive’s Mac…|Started on Olive’s Mac/).first().waitFor();
      await c.close();
      log(`shots at ${width} px`);
    }

    // 4. No token anywhere.
    const rows = [];
    for (const { tablename } of (await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows) rows.push(JSON.stringify((await db.query(`SELECT * FROM "${tablename}"`)).rows));
    check(![...rows, ...answers, ...logs].some((t) => t.includes('orbfb_')), `no orbfb_ in ${rows.length} tables, ${answers.length} answers and ${logs.length} log lines`);
    check(orbit.requests.every((r) => r.method === 'GET'), 'every call to Orbit was a GET');
    if (consoleErrors.length) throw new Error(`Console errors:\n${consoleErrors.join('\n')}`);
    log(`done: ${fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length} shots in ${OUT}`);
  } finally {
    await browser.close().catch(() => {});
    await site.close();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await db.close();
  }
}

main().then(() => process.exit(0), (err) => { console.error(`e2e: ${err.message}`); process.exitCode = 1; setTimeout(() => process.exit(1), 500); });
