// The D9 scenario end to end (packet 2B): a gate approved from a phone while the laptop is closed.
//
//   node hosted/e2e/phone-approval.mjs [--out <folder>] [--no-build]
//   (Playwright: PLAYWRIGHT_MODULE names its index.mjs when it isn't installed here; with
//    PLAYWRIGHT_BROWSERS_PATH=0 its browsers come from inside that package.)
//
// 1. The site on http://localhost:4509 (hosted/dev.js startLocalSite: PGlite in memory, the fake
//    Google, the fake Blob store, the page from hosted/scripts/build.js); a made-up person signs in.
// 2. A laptop: the demo's runner (nothing real runs; e2e/laptop-host.mjs), paired with
//    `ground-control login --site …`. Its record reaches the site, with a Foreman waiting at a gate.
// 3. The laptop closes: its process is suspended (SIGSTOP), as a sleeping laptop's is, and the site
//    says it is offline once it hasn't been seen for a minute.
// 4. On a phone-width page (390 px), the Desk shows that gate; Go is pressed.
// 5. The card says "waiting for your laptop", with Cancel; nothing has run.
// 6. The laptop wakes (SIGCONT): the runner picks the approval up, checks it still holds, runs it,
//    and the job moves on; the site shows it done.
// Shots at 390 and 1512 px, in Light, of each step. A console error fails the run. Everything it
// started is stopped at the end and its temporary folders removed (not the shots).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalSite } from '../dev.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PORT = 4509;
const SITE = `http://localhost:${PORT}`;
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(arg('--out') ?? path.join(os.tmpdir(), 'gc-2b-shots'));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-2b-e2e-'));
const PERSON = { email: 'olive.owner@example.test', name: 'Olive Owner', laptop: 'Olive’s Mac' };
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1512, height: 900 };

const log = (l) => console.log(`e2e: ${l}`);
const children = new Set();
const consoleErrors = [];

function laptopEnv(name) {
  const home = path.join(WORK, name, 'home');
  const tmp = path.join(WORK, name, 'tmp');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, TMPDIR: tmp, TEMP: tmp, TMP: tmp, PORT: String(PORT), WORKSHOP_STATE_DIR: path.join(tmp, 'feature-workshop-demo', 'state'), WORKSHOP_ORBIT_STORE: 'file', WORKSHOP_DEMO: '1' };
  for (const k of ['GROUND_CONTROL_DIR', 'WORKSHOP_FEATURES_DIR', 'WORKSHOP_PROJECTS_DIR', 'WORKSHOP_SKILLS_DIR', 'WORKSHOP_AGENTS_DIR']) delete env[k];
  return env;
}

function startLaptop(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', path.join(HERE, 'laptop-loader.mjs'), path.join(ROOT, 'dashboard', 'demo', 'run-demo.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let text = '';
    const timer = setTimeout(() => reject(new Error(`the laptop didn’t start:\n${text}`)), 60_000);
    const on = (d) => { text += d; if (text.includes('laptop ready')) { clearTimeout(timer); resolve(child); } };
    child.stdout.on('data', on);
    child.stderr.on('data', (d) => { text += d; });
    child.on('exit', (code) => { children.delete(child); clearTimeout(timer); if (!text.includes('laptop ready')) reject(new Error(`the laptop stopped (${code}):\n${text}`)); });
  });
}

function login(env, onCode) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'bin', 'ground-control.js'), 'login', '--site', SITE, '--name', PERSON.laptop], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let text = '';
    let told = false;
    child.stdout.on('data', (d) => {
      text += d;
      const code = /same code: ([A-Z0-9]{8})/.exec(text)?.[1];
      const link = /(http:\/\/\S+\/#\/pair\/[A-Z0-9]{8})/.exec(text)?.[1];
      if (code && link && !told) { told = true; onCode(code, link).catch((err) => { child.kill(); reject(err); }); }
    });
    child.stderr.on('data', (d) => { text += d; });
    child.on('exit', (c) => { children.delete(child); if (c === 0) resolve(text); else reject(new Error(`login failed (${c}):\n${text}`)); });
  });
}

async function until(check, what, ms = 60_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((r) => setTimeout(r, 500));
  }
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
  const site = await startLocalSite({ port: PORT, dataDir: null, quiet: true, env: { AUTH_FAKE: '1', ALLOWED_DOMAIN: 'example.test', OWNER_EMAIL: PERSON.email } });
  log(`site at ${SITE}`);
  const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  const browser = await pw.chromium.launch();
  let laptop = null;
  try {
    const contextFor = async (size) => {
      const c = await browser.newContext({ viewport: size, deviceScaleFactor: size.width < 600 ? 2 : 1, isMobile: size.width < 600, hasTouch: size.width < 600 });
      await c.addInitScript(() => { try { localStorage.setItem('workshop.theme', 'light'); localStorage.setItem('gc.guide.seen', JSON.stringify(['hosted-jobs', 'desk', 'job', 'stack', 'stage'])); } catch { /* none */ } });
      c.on('page', (p) => {
        p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${p.url()}: ${m.text()}`); });
        p.on('response', (r) => { if (r.status() >= 400) consoleErrors.push(`${r.request().method()} ${new URL(r.url()).pathname}: ${r.status()}`); });
      });
      return c;
    };
    const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }); log(`shot ${name}`); };
    const noSideScroll = async (page, where) => {
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (wide > 1) throw new Error(`${where}: the page scrolls sideways by ${wide} px at ${page.viewportSize().width} px.`);
    };

    // 1. Sign in (on the desktop), and keep the cookie for the phone.
    const desk = await contextFor(DESKTOP);
    const dp = await desk.newPage();
    await dp.goto(`${SITE}/`);
    await dp.getByRole('link', { name: /Sign in with Google/ }).click();
    await dp.waitForURL(/\/fake-google\/authorize/);
    await dp.fill('input[name=email]', PERSON.email);
    await dp.fill('input[name=name]', PERSON.name);
    await dp.getByRole('button', { name: 'Continue' }).click();
    await dp.getByRole('heading', { name: 'Jobs', exact: true }).waitFor();
    log(`${PERSON.name} signed in`);

    // 2. The laptop, paired; its record on the site.
    const env = laptopEnv('laptop');
    laptop = await startLaptop(env);
    await login(env, async (code, link) => {
      const p = await desk.newPage();
      await p.goto(link);
      await p.getByText(code, { exact: true }).waitFor();
      await p.getByRole('button', { name: 'Pair this laptop' }).click();
      await p.getByText(/Paired\./).first().waitFor();
      await p.close();
    });
    log('laptop paired');
    const api = async (p) => (await desk.request.get(`${SITE}${p}`)).json();
    const snap = await until(async () => { const s = await api('/api/snapshot'); return s.jobs?.some((j) => j.group === 'needs-you') && s; }, 'the laptop’s record');
    // The Desk's first decision: the oldest job waiting at a gate.
    const first = await until(async () => {
      const queue = (await api('/api/snapshot')).jobs.filter((j) => j.group === 'needs-you').sort((a, b) => String(a.waitingSince ?? '').localeCompare(String(b.waitingSince ?? '')));
      for (const j of queue) { const d = await api(`/api/job/${encodeURIComponent(j.slug)}`); if (d.gate) return { slug: j.slug, title: j.title, brief: d.gate.briefNumber, stage: d.stage }; }
      return null;
    }, 'a job at a gate');
    log(`${snap.jobs.length} jobs mirrored; the Desk opens on ${first.slug} (brief ${first.brief}, ${first.stage})`);
    await dp.goto(`${SITE}/#/desk`);
    await dp.getByText(/Laptop online/).first().waitFor();
    await shot(dp, '1-desk-online-1512');
    await dp.goto(`${SITE}/#/job/${encodeURIComponent(first.slug)}`);
    await dp.getByText(/Laptop online/).first().waitFor();
    await shot(dp, '1-job-online-1512');

    // 3. The laptop closes.
    laptop.kill('SIGSTOP');
    log('laptop closed (suspended); waiting for the site to see it off');
    await until(async () => { const l = (await api('/api/laptops')).laptops[0]; return l && !l.online; }, 'the laptop to show offline', 120_000);

    // 4. The phone: the Desk, one decision at a time; Go.
    const phone = await contextFor(PHONE);
    await phone.addCookies((await desk.cookies()).filter((k) => k.name === 'gc_session'));
    const pp = await phone.newPage();
    await pp.goto(`${SITE}/#/desk`);
    await pp.getByText(/Laptop offline/).first().waitFor();
    const go = pp.locator('.desk-call-go');
    await go.waitFor();
    await noSideScroll(pp, 'the Desk');
    const box = await go.boundingBox();
    if (!box || box.height < 44) throw new Error(`Go is ${box?.height ?? 0} px tall at 390 px; it must be at least 44.`);
    const noBox = await pp.locator('.desk-call-no').boundingBox();
    if (!noBox || noBox.height < 44) throw new Error(`No go is ${noBox?.height ?? 0} px tall at 390 px.`);
    await shot(pp, '2-desk-offline-390');
    // The brief as a sheet.
    await pp.locator('.desk-details-row').click();
    await pp.getByRole('dialog', { name: 'Details' }).waitFor();
    await shot(pp, '2-desk-brief-sheet-390');
    await pp.getByRole('button', { name: 'Close' }).first().click();
    await go.click();

    // 5. The card waits.
    await pp.getByText(/waiting for your laptop\. It runs when the laptop is back\./).first().waitFor();
    await pp.getByRole('button', { name: 'Cancel' }).waitFor();
    await noSideScroll(pp, 'the waiting card');
    await shot(pp, '3-desk-waiting-390');
    const waiting = (await api('/api/decisions')).decisions[0];
    if (waiting?.state !== 'waiting' || waiting.job !== first.slug) throw new Error(`The decision isn’t waiting: ${JSON.stringify(waiting)}`);
    log(`ok: the approval for ${first.slug} waits for the laptop`);
    await dp.goto(`${SITE}/#/job/${encodeURIComponent(first.slug)}`);
    await dp.getByText(/waiting for your laptop/).first().waitFor();
    await shot(dp, '3-job-waiting-1512');

    // 6. The laptop wakes; the job moves on.
    laptop.kill('SIGCONT');
    log('laptop woke');
    const done = await until(async () => { const d = (await api('/api/decisions')).decisions.find((x) => x.id === waiting.id); return ['done', 'failed', 'changed'].includes(d?.state) && d; }, 'the laptop to run the approval', 120_000);
    if (done.state !== 'done') throw new Error(`The approval didn’t run: ${done.state}: ${done.words}`);
    const moved = await until(async () => { const d = await api(`/api/job/${encodeURIComponent(first.slug)}`); return (!d.gate || d.gate.briefNumber !== first.brief || d.stage !== first.stage) && d; }, 'the job to move on');
    log(`ok: the approval ran; ${first.slug} moved on (${moved.gate ? `brief ${moved.gate.briefNumber}` : 'no gate'}, ${moved.stage})`);
    const audit = (await api('/api/decisions')).audit.filter((a) => a.job === first.slug).map((a) => `${a.from}:${a.outcome}`);
    for (const want of ['site:queued', 'site:sent', 'site:done', 'site:ran']) if (!audit.includes(want)) throw new Error(`The audit lacks ${want}: ${audit.join(', ')}`);
    log(`ok: audited on both sides (${audit.join(', ')})`);
    await pp.getByText(/Laptop online/).first().waitFor({ timeout: 30_000 });
    await shot(pp, '4-desk-after-390');
    await dp.goto(`${SITE}/#/job/${encodeURIComponent(first.slug)}`);
    await dp.getByText(/Laptop online/).first().waitFor();
    await shot(dp, '4-job-after-1512');
    await pp.goto(`${SITE}/#/job/${encodeURIComponent(first.slug)}`);
    await pp.getByText(/Laptop online/).first().waitFor();
    await noSideScroll(pp, 'the job page');
    await shot(pp, '4-job-after-390');
    await pp.goto(`${SITE}/#/stacks`);
    await pp.waitForTimeout(1500);
    await shot(pp, '5-stacks-390');
    await dp.goto(`${SITE}/#/stacks`);
    await dp.waitForTimeout(1500);
    await shot(dp, '5-stacks-1512');

    if (consoleErrors.length) throw new Error(`Console errors:\n${consoleErrors.join('\n')}`);
    log(`done: D9 holds; ${fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length} shots in ${OUT}`);
  } finally {
    await browser.close().catch(() => {});
    for (const c of children) { try { c.kill('SIGCONT'); } catch { /* gone */ } c.kill('SIGTERM'); }
    await new Promise((r) => setTimeout(r, 800));
    for (const c of children) c.kill('SIGKILL');
    await site.close();
    fs.rmSync(WORK, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), (err) => { console.error(`e2e: ${err.message}`); process.exitCode = 1; for (const c of children) { try { c.kill('SIGCONT'); } catch { /* gone */ } c.kill('SIGKILL'); } setTimeout(() => process.exit(1), 500); });
