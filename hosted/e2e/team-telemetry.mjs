// Team Telemetry end to end (packet 2E): two made-up people's laptops send their usage, and both see
// one picture of the shared limit, with some Other use; each sees only their own jobs' graphs.
//
//   node hosted/e2e/team-telemetry.mjs [--out <folder>] [--no-build]
//   (Playwright: PLAYWRIGHT_MODULE names its index.mjs when it isn't installed here; with
//    PLAYWRIGHT_BROWSERS_PATH=0 its browsers come from inside that package.)
//
// 1. The site on http://localhost:4515 (hosted/dev.js startLocalSite: PGlite in memory, the fake
//    Google, the page from hosted/scripts/build.js); two made-up people sign in.
// 2. Two laptops, each paired for its person: the real site link (dashboard/runner/site-link.js)
//    with a pretend runner, a usage log in its own temporary home (never the real one) and its
//    usage upload. The week's lines are made up: both people's jobs through the working day, Raj's
//    Claude Code use outside the app in the afternoon, and Other use in the evenings (the meters rise
//    with nobody's lines).
// 3. Checks: both see the same shared picture; it names nobody's jobs; each sees their own two graphs
//    and gets a 404 for the other's.
// 4. Shots at 1512 and 390 px, in Light and Default, of each person's Telemetry. A console error fails
//    the run. Everything it started is stopped at the end and its temporary folders removed (not the shots).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startLocalSite } from '../dev.js';
import { createSiteLink, siteTokenStore, writeSiteFile } from '../../dashboard/runner/site-link.js';
import { planWeekStart, parts } from '../../dashboard/lib/telemetry.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PORT = 4515;
const SITE = `http://localhost:${PORT}`;
const TZ = 'America/Phoenix';
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(arg('--out') ?? path.join(os.tmpdir(), 'gc-2e-shots'));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-2e-e2e-'));
const PEOPLE = {
  raj: { email: 'raj.example@example.test', name: 'Raj Example', laptop: 'Raj’s Mac' },
  sam: { email: 'sam.example@example.test', name: 'Sam Example', laptop: 'Sam’s laptop' },
};
const THEMES = [['light', 'Light'], ['default', 'Default']];
const WIDTHS = [[1512, 900], [390, 844]];
const MIN = 60e3;
const H = 3600e3;

const log = (l) => console.log(`e2e: ${l}`);
const consoleErrors = [];
const links = [];

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
    await new Promise((r) => setTimeout(r, 300));
  }
}

const post = async (p, body) => (await fetch(`${SITE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

/** Pairs a pretend laptop for the person signed in in `context`: its runner token. */
async function pair(context, name) {
  const st = await post('/api/pair/start', { name, os: 'macOS', deviceId: `device-e2e-${name.replace(/\W/g, '')}` });
  const ok = await context.request.post(`${SITE}/api/pair/${st.code}/approve`, { data: {}, headers: { origin: SITE } });
  if (!ok.ok()) throw new Error(`pairing ${name} wasn’t approved (${ok.status()})`);
  const fin = await post('/api/pair/finish', { secret: st.secret });
  if (!fin.token) throw new Error(`pairing ${name} didn’t finish`);
  return fin.token;
}

/**
 * The made-up week, from Wednesday 16:00 to now: usage lines for both laptops (with the meters as the
 * laptop read them), Raj's Claude Code replies outside the app, and the meters now.
 */
function madeUpWeek(now) {
  const from = planWeekStart(now, { timeZone: TZ });
  const resets = new Date(from + 7 * 24 * H).toISOString();
  // Rates scaled to how far into the week it is, so the shots show a week part used whatever the day.
  const scale = 2 / Math.max(2, (now - from) / (24 * H));
  const ratio = 0.45 * scale; // percent of the week per dollar
  const lines = { raj: [], sam: [] };
  const replies = [];
  const jobs = { raj: ['orbit-512-route-sharing', 'add-export', 'price-rounding'], sam: ['nightly-report', 'orbit-530-login-banner'] };
  const stages = ['plan', 'implement', 'implement', 'test', 'review'];
  let known = 0;
  let other = 0;
  let step = 0;
  const fiveOf = (t) => { const k = Math.floor((t - from) / (5 * H)); return { start: from + k * 5 * H, resetsAt: new Date(from + (k + 1) * 5 * H).toISOString() }; };
  const fiveSpend = [];
  for (let t = from + 30 * MIN; t < now - 5 * MIN; t += 10 * MIN, step++) {
    const h = Number(parts(t, TZ, { hour: '2-digit', hourCycle: 'h23' }).hour);
    if (h >= 19 && h < 23) { other += 0.3 * scale; fiveSpend.push({ t, pct: 0.3 * scale }); continue; } // claude.ai and the Claude app, in the evening
    if (h < 8 || h >= 19) continue;
    if (h >= 13 && h < 16 && step % 2 === 0) {
      const usd = 0.35 + (step % 5) * 0.05;
      replies.push({ t: new Date(t - 3 * MIN).toISOString(), user: 'raj-example', usd, family: step % 4 ? 'opus' : 'sonnet', tokens: { input: 900, output: 600, cacheRead: 40000, cacheWrite5m: 1200, cacheWrite1h: 0 }, sidechain: false });
      known += usd;
      fiveSpend.push({ t, pct: usd * ratio });
    }
    const who = step % 3 === 0 ? 'sam' : 'raj';
    const usd = 0.3 + ((step * 7) % 10) * 0.07;
    known += usd;
    fiveSpend.push({ t, pct: usd * ratio });
    const five = fiveOf(t);
    const fivePct = Math.round(fiveSpend.filter((x) => x.t >= five.start && x.t <= t).reduce((s, x) => s + x.pct, 0) * 2.2);
    const list = jobs[who];
    lines[who].push({
      t: new Date(t).toISOString(), user: `${who}-example`, account: null, job: list[Math.floor(step / 3) % list.length], ticket: null, stage: stages[step % stages.length], section: null,
      worker: step % 4 ? 'foreman' : 'implementer', model: who === 'sam' && step % 2 ? 'claude-sonnet-4-5' : 'claude-opus-4-1', tokens: { input: 1500, output: 800, cacheRead: 60000, cacheWrite5m: 2000, cacheWrite1h: 0 },
      costUsd: Math.round(usd * 1e4) / 1e4, costSource: 'estimate', turn: `turn-${who}-${step}`, session: `session-${who}-${Math.floor(step / 12)}`, cliTotalUsd: null,
      meters: { week: { percent: Math.min(100, Math.floor(known * ratio + other)), resetsAt: resets }, fiveHour: { percent: Math.min(100, fivePct), resetsAt: five.resetsAt } },
    });
  }
  const five = fiveOf(now);
  const planUsage = {
    enabled: true, checkedAt: new Date(now - 2 * MIN).toISOString(),
    week: { percent: Math.min(100, Math.floor(known * ratio + other)), resetsAt: resets },
    fiveHour: { percent: Math.min(100, Math.round(fiveSpend.filter((x) => x.t >= five.start).reduce((s, x) => s + x.pct, 0) * 2.2)), resetsAt: five.resetsAt },
  };
  return { lines, replies, planUsage, jobs };
}

/** A pretend runner whose site link is the real one, with its own usage log in a temporary home. */
async function laptop(key, token, { lines, replies, planUsage, jobs, counting }) {
  const home = path.join(WORK, key);
  const stateDir = path.join(home, 'state');
  const usageDir = path.join(home, 'usage');
  fs.mkdirSync(usageDir, { recursive: true });
  fs.writeFileSync(path.join(usageDir, 'usage.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, { mode: 0o600 });
  writeSiteFile(stateDir, { url: SITE, deviceId: `device-e2e-${key}`, runnerId: 0, name: PEOPLE[key].laptop });
  const store = await siteTokenStore({ stateDir, prefer: 'file' });
  await store.set(token);
  const titles = { 'orbit-512-route-sharing': 'Route sharing', 'add-export': 'Add export', 'price-rounding': 'Price rounding', 'nightly-report': 'Nightly report', 'orbit-530-login-banner': 'Login banner' };
  const cards = jobs.map((slug) => ({ slug, title: titles[slug], stage: 'implement', lane: 'working', laneReason: 'Working', nowDoing: [], updatedAt: new Date().toISOString() }));
  const runner = {
    read: {
      features: async () => ({ features: cards }),
      snapshot: async () => ({ planUsage }),
      claudeCodeReplies: async () => (counting ? { state: 'ready', replies } : { state: 'off', replies: null }),
    },
    handle: async () => ({ ok: true }),
    on: () => () => {},
  };
  const link = createSiteLink({ runner, stateDir, store, waitSeconds: 5, watchEveryMs: 0, usageDir, log: (l) => log(`${key}’s laptop: ${l}`) });
  links.push(link);
  return link.start();
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
  const site = await startLocalSite({ port: PORT, dataDir: null, quiet: true, env: { AUTH_FAKE: '1', ALLOWED_DOMAIN: 'example.test', OWNER_EMAIL: PEOPLE.raj.email } });
  log(`site at ${SITE}`);
  const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  const browser = await pw.chromium.launch();
  try {
    const contextFor = async ({ theme = 'light', width = 1512, height = 900 } = {}) => {
      const c = await browser.newContext({ viewport: { width, height }, timezoneId: TZ });
      await c.addInitScript((t) => { try { localStorage.setItem('workshop.theme', t); localStorage.setItem('gc.guide.seen', JSON.stringify(['hosted-jobs', 'team-telemetry'])); } catch { /* none */ } }, theme);
      c.on('page', (p) => p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${p.url()}: ${m.text()}`); }));
      return c;
    };

    // 1. Two people sign in.
    const ctx = {};
    for (const [key, p] of Object.entries(PEOPLE)) {
      ctx[key] = await contextFor();
      const page = await ctx[key].newPage();
      await signIn(page, p);
      await page.getByRole('heading', { name: 'Jobs', exact: true }).waitFor();
      await page.close();
      log(`${p.name} signed in`);
    }

    // 2. Two laptops, paired, sending the week's usage.
    const week = madeUpWeek(Date.now());
    const tokens = { raj: await pair(ctx.raj, PEOPLE.raj.laptop), sam: await pair(ctx.sam, PEOPLE.sam.laptop) };
    await laptop('raj', tokens.raj, { lines: week.lines.raj, replies: week.replies, planUsage: week.planUsage, jobs: week.jobs.raj, counting: true });
    await laptop('sam', tokens.sam, { lines: week.lines.sam, replies: [], planUsage: week.planUsage, jobs: week.jobs.sam, counting: false });
    const want = week.lines.raj.length + week.lines.sam.length + week.replies.length + 2;
    const team = async (who) => (await (await ctx[who].request.get(`${SITE}/api/telemetry/team?tz=${encodeURIComponent(TZ)}`)).json());
    await until(async () => {
      const t = await team('raj');
      const have = t.lines;
      return have >= week.lines.raj.length + week.lines.sam.length + week.replies.length - 10 && t.meters.week ? t : null;
    }, `both laptops’ usage (${want} lines)`, 60_000);
    log('both laptops’ usage is on the site');

    // 3. The checks.
    const check = (ok, what) => { if (!ok) throw new Error(`Check failed: ${what}`); log(`ok: ${what}`); };
    const [tr, ts] = [await team('raj'), await team('sam')];
    // Fetched moments apart on the real clock: the "as of" time aside, the same.
    const same = (b) => JSON.stringify({ ...b, me: null, to: null, people: b.people.map((p) => ({ ...p, you: null })), graphs: b.graphs.map((g) => (g.id === 'limit' ? { ...g, data: { ...g.data, to: null } } : g)) });
    check(same(tr) === same(ts), 'Raj and Sam see the same shared picture');
    const split = tr.limits.week;
    check(split.state === 'split', `the week is split by person (${split.sentence})`);
    const names = split.people.map((p) => p.user).sort();
    check(names.join() === 'Raj Example,Sam Example', 'both people are named');
    check(split.other > 0, `there is some Other use (${split.other}%)`);
    const sum = split.people.reduce((s, p) => s + p.app + p.claudeCode, 0) + split.other + split.unknown;
    check(sum === split.total && split.total + split.free === 100, `the parts add up to the total (${sum}% used, ${split.free}% free)`);
    check(split.people.find((p) => p.user === 'Raj Example').claudeCode > 0, 'Raj’s Claude Code use outside the app is counted by name');
    const text = JSON.stringify(tr);
    check(!/route-sharing|Route sharing|nightly-report|Nightly report|ORBIT-512/.test(text), 'the shared picture names nobody’s jobs');
    const ids = Object.fromEntries(tr.people.map((p) => [p.name, p.id]));
    const rajOwn = await ctx.raj.request.get(`${SITE}/api/telemetry/people/${ids['Raj Example']}`);
    const rajBody = await rajOwn.json();
    check(rajOwn.status() === 200 && JSON.stringify(rajBody).includes('Route sharing'), `Raj sees his own jobs’ graphs, with their names (${rajBody.graphs?.[0]?.data?.jobs?.map((j) => j.label).join(', ') ?? rajBody.error})`);
    check((await ctx.sam.request.get(`${SITE}/api/telemetry/people/${ids['Raj Example']}`)).status() === 404, 'Raj’s own graphs, asked for by Sam, are a 404');
    check((await ctx.raj.request.get(`${SITE}/api/telemetry/people/${ids['Sam Example']}`)).status() === 404, 'Sam’s own graphs, asked for by Raj, are a 404');

    // 4. The shots.
    // The page scrolls inside its own frame: the window grows to the whole page first, so the shot has all of it.
    const shot = async (page, name, width) => {
      await page.waitForTimeout(300);
      const h = await page.evaluate(() => Math.max(...[document.documentElement, document.body, ...document.querySelectorAll('main, .page, .app')].map((e) => e.scrollHeight)));
      await page.setViewportSize({ width, height: Math.min(h + 24, 9000) });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    };
    for (const [theme, themeName] of THEMES) {
      for (const [width, height] of WIDTHS) {
        const tag = `${width}-${themeName.toLowerCase()}`;
        for (const who of ['raj', 'sam']) {
          const c = await contextFor({ theme, width, height });
          await c.addCookies((await ctx[who].cookies()).filter((k) => k.name === 'gc_session'));
          const page = await c.newPage();
          await page.goto(`${SITE}/#/telemetry`);
          await page.getByRole('heading', { name: 'The shared account' }).waitFor();
          await page.locator('#tele-graph-by-day').waitFor();
          await shot(page, `telemetry-${who}-${tag}`, width);
          await c.close();
        }
        log(`shots at ${width} px in ${themeName}`);
      }
    }
    if (consoleErrors.length) throw new Error(`Console errors:\n${consoleErrors.join('\n')}`);
    log(`done: ${fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length} shots in ${OUT}`);
  } finally {
    for (const l of links) l.stop();
    await browser.close().catch(() => {});
    await site.close();
    fs.rmSync(WORK, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), (err) => { console.error(`e2e: ${err.message}`); process.exitCode = 1; for (const l of links) l.stop(); setTimeout(() => process.exit(1), 500); });
