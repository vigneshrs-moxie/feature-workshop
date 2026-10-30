// The local end-to-end run of packet 2A: two made-up people, two made-up laptops, one site.
//
//   node hosted/e2e/two-laptops.mjs [--out <folder>] [--no-build]
//   (Playwright: PLAYWRIGHT_MODULE names its index.mjs when it isn't installed here; with
//    PLAYWRIGHT_BROWSERS_PATH=0 its browsers come from inside that package.)
//
// 1. Starts the site on http://localhost:4507 (hosted/dev.js startLocalSite): PGlite in memory, the
//    fake Google, the page built by hosted/scripts/build.js.
// 2. Signs in as two made-up people at example.test, through the sign-in page and the fake Google.
// 3. Starts two laptops: the demo's runner (WORKSHOP_DEMO=1, nothing real runs), each with its own
//    temporary home and folders, its local page on no port (laptop-host.mjs); the second keeps only
//    five of the demo's jobs. Each is paired with `ground-control login --site …`: the person opens
//    the link it prints and presses "Pair this laptop".
// 4. Checks each person sees only their own laptop's jobs, and that a job id of the other's is a 404.
// 5. Takes screenshots at 1512 and 390 px wide, in Light and Default: sign-in, the "Moxie accounts
//    only" refusal, Pair this laptop, Laptops, People, and Jobs. A console error fails the run.
// Everything it started is stopped at the end, and its temporary folders removed (not the shots).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalSite } from '../dev.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PORT = 4507;
const SITE = `http://localhost:${PORT}`;
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(arg('--out') ?? path.join(os.tmpdir(), 'gc-2a-shots'));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-2a-e2e-'));
const SECOND_LAPTOP_JOBS = ['tag-colours', 'tech-next-stops', 'nightly-export', 'route-sharing', 'price-rounding'];
const PEOPLE = {
  olive: { email: 'olive.owner@example.test', name: 'Olive Owner', laptop: 'Olive’s Mac' },
  sam: { email: 'sam.sample@example.test', name: 'Sam Sample', laptop: 'Sam’s laptop' },
};
const THEMES = [['light', 'Light'], ['default', 'Default']];
const WIDTHS = [[1512, 900], [390, 844]];

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

function startLaptop(name, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', path.join(HERE, 'laptop-loader.mjs'), path.join(ROOT, 'dashboard', 'demo', 'run-demo.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let text = '';
    const timer = setTimeout(() => reject(new Error(`${name} didn’t start:\n${text}`)), 60_000);
    const on = (d) => { text += d; if (text.includes('laptop ready')) { clearTimeout(timer); resolve(child); } };
    child.stdout.on('data', on);
    child.stderr.on('data', (d) => { text += d; });
    child.on('exit', (code) => { children.delete(child); clearTimeout(timer); if (!text.includes('laptop ready')) reject(new Error(`${name} stopped (${code}):\n${text}`)); });
  });
}

/** `ground-control login` on a laptop; onCode(code, link) while it waits. Resolves its output. */
function login(env, laptopName, onCode) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'bin', 'ground-control.js'), 'login', '--site', SITE, '--name', laptopName], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

async function signIn(page, { email, name }) {
  await page.goto(`${SITE}/`);
  await page.getByRole('link', { name: /Sign in with Google/ }).click();
  await page.waitForURL(/\/fake-google\/authorize/);
  await page.fill('input[name=email]', email);
  if (name) await page.fill('input[name=name]', name);
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function until(check, what, ms = 45_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

const jobsOf = async (context) => (await (await context.request.get(`${SITE}/api/jobs`)).json()).laptops;

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
  const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  const browser = await pw.chromium.launch();
  try {
    const contextFor = async ({ theme = 'light', width = 1512, height = 900 } = {}) => {
      const c = await browser.newContext({ viewport: { width, height } });
      await c.addInitScript((t) => { try { localStorage.setItem('workshop.theme', t); localStorage.setItem('gc.guide.seen', JSON.stringify(['hosted-jobs'])); } catch { /* none */ } }, theme);
      c.on('page', (p) => p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${p.url()}: ${m.text()}`); }));
      return c;
    };

    // 2. Two people sign in.
    const ctx = {};
    for (const [key, p] of Object.entries(PEOPLE)) {
      ctx[key] = await contextFor();
      const page = await ctx[key].newPage();
      await signIn(page, p);
      await page.getByRole('heading', { name: 'Jobs', exact: true }).waitFor();
      log(`${p.name} signed in`);
    }

    // 3. Two laptops, each paired by its person.
    const envs = { olive: laptopEnv('laptop-a'), sam: { ...laptopEnv('laptop-b'), E2E_KEEP_JOBS: SECOND_LAPTOP_JOBS.join(',') } };
    await Promise.all([startLaptop('laptop A', envs.olive), startLaptop('laptop B', envs.sam)]);
    log('two laptops running');
    for (const key of ['olive', 'sam']) {
      const p = PEOPLE[key];
      const out = await login(envs[key], p.laptop, async (code, link) => {
        const page = await ctx[key].newPage();
        await page.goto(link);
        await page.getByText(code, { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Pair this laptop' }).click();
        await page.getByText(/Paired\./).first().waitFor();
        await page.close();
      });
      log(`${p.laptop} paired: ${out.trim().split('\n').at(-2)}`);
    }

    // 4. Each sees only their own.
    const mine = {};
    for (const key of ['olive', 'sam']) {
      mine[key] = await until(async () => { const l = await jobsOf(ctx[key]); return l.length === 1 && l[0].jobs.length > 0 && l; }, `${PEOPLE[key].name}’s jobs`);
    }
    mine.olive = await jobsOf(ctx.olive);
    mine.sam = await jobsOf(ctx.sam);
    const check = (ok, what) => { if (!ok) throw new Error(`Check failed: ${what}`); log(`ok: ${what}`); };
    check(mine.olive.length === 1 && mine.olive[0].name === PEOPLE.olive.laptop, 'Olive sees one laptop, her own');
    check(mine.sam.length === 1 && mine.sam[0].name === PEOPLE.sam.laptop, 'Sam sees one laptop, his own');
    const oliveSlugs = mine.olive[0].jobs.map((j) => j.slug);
    const samSlugs = mine.sam[0].jobs.map((j) => j.slug);
    check(samSlugs.every((s) => SECOND_LAPTOP_JOBS.includes(s)), `Sam sees only his laptop’s jobs (${samSlugs.length}: ${samSlugs.join(', ')})`);
    check(oliveSlugs.length > SECOND_LAPTOP_JOBS.length, `Olive sees her laptop’s ${oliveSlugs.length} jobs`);
    check(mine.olive[0].jobs.every((j) => j.laptopId === mine.olive[0].id) && mine.sam[0].jobs.every((j) => j.laptopId === mine.sam[0].id), 'every job is on its own person’s laptop');
    const samsJob = mine.sam[0].jobs[0];
    check((await ctx.olive.request.get(`${SITE}/api/jobs/${samsJob.id}`)).status() === 404, 'Sam’s job id, guessed by Olive, is a 404');
    check((await ctx.sam.request.get(`${SITE}/api/jobs/${mine.olive[0].jobs[0].id}`)).status() === 404, 'Olive’s job id, guessed by Sam, is a 404');
    check(mine.olive[0].online && mine.sam[0].online, 'both laptops show online');

    // 5. The shots.
    const shot = async (page, name) => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }); };
    const signedInAs = async (who, opts) => {
      const c = await contextFor(opts);
      await c.addCookies((await ctx[who].cookies()).filter((k) => k.name === 'gc_session'));
      return c;
    };
    for (const [theme, themeName] of THEMES) {
      for (const [width, height] of WIDTHS) {
        const tag = `${width}-${themeName.toLowerCase()}`;
        const opts = { theme, width, height };
        const out = await contextFor(opts);
        const page = await out.newPage();
        await page.goto(`${SITE}/`);
        await page.getByRole('link', { name: /Sign in with Google/ }).waitFor();
        await shot(page, `sign-in-${tag}`);
        await signIn(page, { email: 'pat.outside@elsewhere.test', name: 'Pat Outside' });
        await page.getByText('This site is for Moxie accounts only').waitFor();
        await shot(page, `refused-${tag}`);
        await out.close();

        const olive = await signedInAs('olive', opts);
        const op = await olive.newPage();
        const st = await (await olive.request.post(`${SITE}/api/pair/start`, { data: { name: 'Olive’s spare laptop', os: 'Windows', deviceId: `device-shot-${tag}` } })).json();
        await op.goto(st.link);
        await op.getByRole('button', { name: 'Pair this laptop' }).waitFor();
        await shot(op, `pair-${tag}`);
        await op.goto(`${SITE}/#/`);
        await op.getByText(mine.olive[0].jobs[0].title).first().waitFor();
        await shot(op, `jobs-${tag}`);
        await op.goto(`${SITE}/#/settings/laptops`);
        await op.getByText(PEOPLE.olive.laptop).first().waitFor();
        await shot(op, `laptops-${tag}`);
        await op.goto(`${SITE}/#/settings/people`);
        await op.getByRole('list', { name: 'People' }).waitFor();
        await shot(op, `people-${tag}`);
        await op.goto(`${SITE}/#/desk`);
        await op.getByText('Open this on your laptop for now').waitFor();
        await shot(op, `later-${tag}`);
        await olive.close();

        const sam = await signedInAs('sam', opts);
        const sp = await sam.newPage();
        await sp.goto(`${SITE}/#/`);
        await sp.getByText(samsJob.title).first().waitFor();
        await shot(sp, `jobs-sam-${tag}`);
        await sam.close();
        log(`shots at ${width} px in ${themeName}`);
      }
    }
    if (consoleErrors.length) throw new Error(`Console errors:\n${consoleErrors.join('\n')}`);
    log(`done: ${fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length} shots in ${OUT}`);
  } finally {
    await browser.close().catch(() => {});
    for (const c of children) c.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 800));
    for (const c of children) c.kill('SIGKILL');
    await site.close();
    fs.rmSync(WORK, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), (err) => { console.error(`e2e: ${err.message}`); process.exitCode = 1; for (const c of children) c.kill('SIGKILL'); setTimeout(() => process.exit(1), 500); });
