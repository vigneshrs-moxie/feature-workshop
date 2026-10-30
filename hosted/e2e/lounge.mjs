// The Lounge's shots (packet 2D): three made-up people on one site, one online with two jobs, one
// away, one off, seen by the one online.
//
//   node hosted/e2e/lounge.mjs [--out <folder>] [--no-build] [--every-theme]
//   (Playwright: PLAYWRIGHT_MODULE names its index.mjs when it isn't installed here; with
//    PLAYWRIGHT_BROWSERS_PATH=0 its browsers come from inside that package.)
//
// 1. The site on http://localhost:4513 (hosted/dev.js startLocalSite: PGlite in memory, the fake
//    Google, the page from hosted/scripts/build.js).
// 2. Three made-up people at example.test sign in through the fake Google and pair a laptop each
//    (pretend laptops: their events go straight to the site, as runner/site-link.js sends them).
//    Olive's laptop sends two running jobs and keeps calling in: online. Mia's calls in too but
//    nothing has happened there for 40 minutes: away. Sam's stopped calling in three hours ago: off.
//    (The times are set back in the site's database, so nobody waits.)
// 3. Shots at 1512 and 390 px, in Light and Default, with Play full and off (--every-theme: in each
//    of the nine themes anyone can pick; the two hidden ones need a Play unlock the site doesn't
//    keep). Each checks the page
//    doesn't scroll sideways, and that Olive's own job is a link and Mia's is not. A console error
//    or a failed request fails the run.
// Everything it started is stopped at the end (not the shots).

import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalSite } from '../dev.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PORT = 4513;
const SITE = `http://localhost:${PORT}`;
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(arg('--out') ?? path.join(os.tmpdir(), 'gc-2d-shots'));
const MIN = 60 * 1000;
const PEOPLE = {
  olive: { email: 'olive.owner@example.test', name: 'Olive Owner', laptop: 'Olive’s Mac' },
  mia: { email: 'mia.member@example.test', name: 'Mia Member', laptop: 'Mia’s laptop' },
  sam: { email: 'sam.sample@example.test', name: 'Sam Sample', laptop: 'Sam’s laptop' },
};
const EVERY = ['default', 'neon-arcade', 'blueprint', 'pixel-crew', 'sunset-paper', 'candy-pop', 'glass', 'light', 'light-glass'];
const THEMES = process.argv.includes('--every-theme') ? EVERY.map((t) => [t, t]) : [['light', 'Light'], ['default', 'Default']];
const WIDTHS = [[1512, 900], [390, 844]];
const PLAYS = ['full', 'off'];

const log = (l) => console.log(`e2e: ${l}`);
const consoleErrors = [];

/** A browser-less person: the site's cookies, and the page's own Origin on changes. */
function person() {
  const jar = new Map();
  const go = async (p, init = {}) => {
    const url = p.startsWith('http') ? p : `${SITE}${p}`;
    const headers = { ...(init.headers ?? {}) };
    if (jar.size && url.startsWith(SITE)) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(url, { ...init, headers, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      const v = pair.slice(eq + 1).trim();
      if (v && !/max-age=0/i.test(line)) jar.set(pair.slice(0, eq).trim(), v); else jar.delete(pair.slice(0, eq).trim());
    }
    return res;
  };
  return {
    jar, go,
    post: async (p, body) => { const r = await go(p, { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`); return r.json(); },
  };
}

async function signIn(b, { email, name }) {
  const start = await b.go('/api/auth/start');
  const google = new URL(start.headers.get('location'));
  const cont = new URL(`${SITE}/fake-google/continue`);
  for (const [k, v] of google.searchParams) cont.searchParams.set(k, v);
  cont.searchParams.set('email', email);
  cont.searchParams.set('name', name);
  const back = await b.go(cont.toString());
  const done = await b.go(back.headers.get('location'));
  if (done.status !== 302 || !b.jar.has('gc_session')) throw new Error(`${name} couldn’t sign in (${done.status}).`);
}

async function pair(b, laptop, deviceId) {
  const raw = async (p, body) => (await fetch(`${SITE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const st = await raw('/api/pair/start', { name: laptop, os: 'macOS', deviceId });
  await b.post(`/api/pair/${st.code}/approve`, {});
  const fin = await raw('/api/pair/finish', { secret: st.secret });
  if (!fin.token) throw new Error(`${laptop} didn’t pair: ${JSON.stringify(fin)}`);
  return { token: fin.token, runnerId: fin.runner.id };
}

let eids = 0;
async function up(token, events) {
  const r = await fetch(`${SITE}/api/runner/events`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ events: events.map(([type, data, job = null]) => ({ v: 1, eid: `e-shots-${++eids}`, type, job, data })) }),
  });
  const body = await r.json();
  if (!r.ok || body.refused?.length) throw new Error(`events refused: ${JSON.stringify(body)}`);
}
const callIn = (token) => fetch(`${SITE}/api/runner/commands?wait=0`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.arrayBuffer());
const row = (slug, title, extra = {}) => ({ slug, title, ticket: null, stage: 'implement', state: 'working', stateWords: 'Working', now: 'Builder: Writing the tests', updatedAt: new Date().toISOString(), ...extra });

async function main() {
  if (!process.argv.includes('--no-build')) {
    log('building the page for the site');
    await new Promise((resolve, reject) => {
      const b = spawn(process.execPath, [path.join(ROOT, 'hosted', 'scripts', 'build.js'), '--no-migrate'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, VERCEL: '' } });
      b.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('the build failed'))));
    });
  }
  fs.mkdirSync(OUT, { recursive: true });
  const site = await startLocalSite({ port: PORT, dataDir: null, quiet: true, env: { AUTH_FAKE: '1', ALLOWED_DOMAIN: 'example.test', OWNER_EMAIL: PEOPLE.olive.email } });
  log(`site at ${SITE}`);
  let keepOn = null;
  let browser = null;
  try {
    // 2. Three people, a laptop each.
    const b = {};
    const laptops = {};
    for (const [key, p] of Object.entries(PEOPLE)) {
      b[key] = person();
      await signIn(b[key], p);
      laptops[key] = await pair(b[key], p.laptop, `device-shots-${key}`);
      log(`${p.name} signed in, ${p.laptop} paired`);
    }
    const ago = (m) => new Date(Date.now() - m * MIN).toISOString();
    await up(laptops.olive.token, [
      ['hello', { name: PEOPLE.olive.laptop, os: 'macOS', version: '0.1.0' }],
      ['job-list', { jobs: [
        row('orbit-479-tidy-button', 'Tidy the job card button', { ticket: 'ORBIT-479', stage: 'review', state: 'in-review', updatedAt: ago(3) }),
        row('orbit-503-export-csv', 'Export the route list as a spreadsheet', { ticket: 'ORBIT-503', stage: 'implement', updatedAt: ago(1) }),
      ] }],
    ]);
    await up(laptops.mia.token, [['job-list', { jobs: [row('orbit-512-settings-tidy', 'Tidy the settings page', { ticket: 'ORBIT-512', stage: 'plan', state: 'resting', updatedAt: ago(45) })] }]]);
    await up(laptops.sam.token, [['hello', { name: PEOPLE.sam.laptop, os: 'Windows', version: '0.1.0' }], ['job-list', { jobs: [row('route-sharing', 'Route sharing', { stage: 'test', updatedAt: ago(200) })] }]]);
    // Set the times back: Mia was last on the site 40 minutes ago; Sam three hours ago, laptop too.
    const db = site.db;
    const idOf = async (key) => (await db.query('SELECT id FROM people WHERE email = $1', [PEOPLE[key].email])).rows[0].id;
    await db.query('UPDATE sessions SET created_at = $2, last_seen_at = $2 WHERE person_id = $1', [await idOf('mia'), ago(40)]);
    await db.query('UPDATE sessions SET created_at = $2, last_seen_at = $2 WHERE person_id = $1', [await idOf('sam'), ago(180)]);
    await db.query('UPDATE runners SET last_seen_at = $2 WHERE id = $1', [laptops.sam.runnerId, ago(180)]);
    await db.query('UPDATE record_syncs SET hello_at = $2 WHERE runner_id = $1', [laptops.sam.runnerId, ago(180)]);
    // Olive's and Mia's laptops keep calling in, as a runner's long-poll does.
    const beat = () => Promise.all([callIn(laptops.olive.token), callIn(laptops.mia.token)]);
    await beat();
    keepOn = setInterval(() => { beat().catch(() => {}); }, 15_000);

    const seen = await (await b.olive.go('/api/lounge')).json();
    const presence = Object.fromEntries(seen.people.map((p) => [p.name, `${p.presence} (${p.jobs.length})`]));
    const want = { 'Olive Owner': 'online (2)', 'Mia Member': 'away (1)', 'Sam Sample': 'off (0)' };
    const sorted = (o) => JSON.stringify(Object.entries(o).sort());
    if (sorted(presence) !== sorted(want)) throw new Error(`The Lounge isn’t as set up: ${JSON.stringify(presence)}`);
    log(`ok: ${JSON.stringify(presence)}`);

    // 3. The shots, as Olive.
    const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
    browser = await pw.chromium.launch();
    const cookie = { name: 'gc_session', value: b.olive.jar.get('gc_session'), url: SITE };
    for (const [theme, themeName] of THEMES) {
      for (const [width, height] of WIDTHS) {
        for (const play of PLAYS) {
          const phone = width < 600;
          const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone });
          await c.addInitScript((t) => { try { localStorage.setItem('workshop.theme', t); localStorage.setItem('gc.guide.seen', JSON.stringify(['hosted-jobs', 'lounge'])); } catch { /* none */ } }, theme);
          await c.addCookies([cookie]);
          const page = await c.newPage();
          page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${page.url()}: ${m.text()}`); });
          page.on('response', (r) => { if (r.status() >= 400) consoleErrors.push(`${r.request().method()} ${new URL(r.url()).pathname}: ${r.status()}`); });
          await page.goto(`${SITE}/?play=${play}#/lounge`);
          await page.getByRole('listitem', { name: 'Sam Sample: Off' }).waitFor();
          const olive = page.getByRole('listitem', { name: 'Olive Owner: Online' });
          if ((await olive.getByRole('link', { name: 'Tidy the job card button' }).count()) !== 1) throw new Error('Olive’s own job isn’t a link.');
          if ((await page.getByRole('listitem', { name: 'Mia Member: Away' }).getByRole('link').count()) !== 0) throw new Error('Mia’s job is a link for Olive.');
          if ((await page.locator(`.lounge-person.play-${play}`).count()) !== 3) throw new Error(`The cards aren’t in Play ${play}.`);
          const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          if (wide > 1) throw new Error(`The Lounge scrolls sideways by ${wide} px at ${width} px (${themeName}, Play ${play}).`);
          const name = `lounge-${width}-${themeName.toLowerCase()}-play-${play}`;
          await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
          log(`shot ${name}`);
          await c.close();
        }
      }
    }
    if (consoleErrors.length) throw new Error(`Console errors or failed requests:\n${consoleErrors.join('\n')}`);
    log(`done: shots in ${OUT}`);
  } finally {
    if (keepOn) clearInterval(keepOn);
    await browser?.close();
    await site.close();
  }
}

main().then(() => process.exit(0), (err) => { console.error(`e2e: failed: ${err.stack ?? err}`); process.exit(1); });
