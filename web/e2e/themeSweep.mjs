// Every screen, every overlay, in every theme (packet X), checked in a real browser.
//
// For each theme, at each width (1512 and 390 px) and in each Play mode (Full and Off), it visits
// every screen (Jobs in its three layouts, Map, Table, the Desk, the Inbox, a Job, the Stage,
// Screens, the Crew-dex, Achievements, Stacks, the build stack, a stack's Board, Map and Timeline, a
// Part page, Telemetry, every Settings section, the floor lab, Not found, the classic page and
// #/gallery, which has every control in every state: hover, pressed, focus, disabled, busy, empty,
// error), and opens every kind of overlay (a Peek, a dialog, a Select menu, a menu, a tooltip, the
// command search, the keys sheet, a toast, the level sheet, Merge's confirm, a permission card and
// the next-step bar, which are on the Job pages). It records, per visit:
//   console    every console error and uncaught page error;
//   text       words under 4.5:1 (3:1 for large text), measured against the pixels really behind
//              them: a screenshot with the words made transparent (the "bare" view), so text on a
//              see-through pane is measured over the aurora, not over a token. Words off the screen
//              are read from styles instead (marked "styles"). Disabled controls are exempt (WCAG);
//   hidden     words that are in the page but not on the screen (covered, or drawn in the colour behind);
//   overlay    a menu, tooltip, sheet or toast with no solid enough backing (under 90% opaque with
//              no blur of 8 px or more); its words are measured like any others;
//   mark       status dots, chip and lane icons, checkbox and radio boxes under 3:1;
//   control    a button, field, choice or segmented control whose edge and fill both melt into the
//              page (under 1.1:1; text fields, kept quiet on purpose, under 1.05:1);
//   focus      a keyboard focus ring that can't be seen (Tab through the first eight controls on a
//              few screens, in the first Play mode only, as rings don't change with Play: under
//              3:1 against the same pixels without the focus, or round under half of the control);
//   drawn      graph, map and dot shapes in an svg under 3:1 against what the graph sits on (svg
//              words: 4.5:1); gridlines, tracks and other quiet parts are left out by class name;
//   layout     sideways scroll on the page, words cut off without an ellipsis, things sticking out
//              of the window.
// It also checks Follow the system: each pair's dark and light member, on load and live.
// It writes a screenshot per visit and a contact sheet per theme and Play mode, plus
// findings.json and findings.md (theme, screen, element, what's wrong, the numbers), and ends
// with "Every theme passes" or the list.
//
// Run it against the demo (it changes the demo's Play mode while it runs, and puts it back):
//   PORT=4503 WORKSHOP_DEMO=1 node dashboard/demo/run-demo.js       # in one terminal
//   npm run web:build                                               # first, so /next is current
//   node web/e2e/themeSweep.mjs                                     # in another
// Environment:
//   BASE      the new app (default http://127.0.0.1:4503/next/)
//   THEMES    all (default) or a comma list of ids
//   WIDTHS    comma list (default 1512,390)
//   PLAY      comma list of Play modes (default full,off)
//   SCREENS   a comma list of words; only visits whose name contains one run (e.g. Job,Peek)
//   OUT       where the screenshots, sheets and findings go (default $TMPDIR/theme-sweep)
//   JOBS      themes run side by side (default 3)
//   FOCUS=0   skip the focus-ring check; SHEETS=0 skip the contact sheets
//   RESUME=1  keep each theme, width and Play mode already checked in OUT/runs (a stopped sweep goes on)
//   PLAYWRIGHT  the path to playwright's index.mjs, when it isn't installed here
// It exits 1 when anything fails. Nothing it does reaches GitHub or a model: the demo is pretend.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from './lib/png.mjs';
import { controlVisibility, focusRing, markContrast, shapeContrast, textContrast } from './lib/pixels.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://127.0.0.1:4503/next/';
const ORIGIN = new URL(BASE).origin;
const OUT = process.env.OUT || path.join(tmpdir(), 'theme-sweep');
const JOBS = Number(process.env.JOBS || 3);
const FOCUS = process.env.FOCUS !== '0';
const SHEETS = process.env.SHEETS !== '0';
const TIMING = process.env.TIMING === '1';
const RESUME = process.env.RESUME === '1';

// The themes, read from theme.ts so a new one is swept without a change here.
const THEME_SRC = readFileSync(path.join(HERE, '../src/theme/theme.ts'), 'utf8');
const ALL = [...THEME_SRC.matchAll(/\{ id: '([a-z-]+)', label: '([^']+)'.*?scheme: '(dark|light)'(, unlock: '([a-z]+)')?/g)].map((m) => ({ id: m[1], label: m[2], scheme: m[3], unlock: m[5] ?? null }));
const PAIRS = [...THEME_SRC.matchAll(/\['([a-z-]+)', '([a-z-]+)'\],/g)].map((m) => [m[1], m[2]]);
const ORDER = ['glass', 'light-glass'];
const wanted = (process.env.THEMES || 'all').trim();
const THEMES = (wanted === 'all' ? ALL : ALL.filter((t) => wanted.split(',').map((s) => s.trim()).includes(t.id)))
  .sort((a, b) => (ORDER.includes(b.id) ? 1 : 0) - (ORDER.includes(a.id) ? 1 : 0));
const WIDTHS = (process.env.WIDTHS || '1512,390').split(',').map(Number).filter(Boolean);
const PLAYS = (process.env.PLAY || 'full,off').split(',').map((s) => s.trim()).filter(Boolean);
const ONLY = process.env.SCREENS ? process.env.SCREENS.split(',').map((s) => s.trim().toLowerCase()) : null;
const GUIDES = ['jobs', 'desk', 'stage', 'job', 'inbox', 'telemetry', 'stack', 'stacks', 'review', 'review-round'];

// ---------- What to visit ----------
const click = (sel) => async (page) => { await page.locator(sel).filter({ visible: true }).first().click(); };
const role = (r, name) => async (page) => { await page.getByRole(r, { name }).filter({ visible: true }).first().click(); };
const tab = (name) => async (page) => { await page.getByRole('tab', { name, exact: true }).first().click().catch(() => page.getByRole('button', { name, exact: true }).first().click()); };

/** Screens: the page as it loads (plus a tab or a layout). `play: 'full'` only exists with Play on. */
const SCREEN_VISITS = [
  { name: 'Jobs, lanes', hash: '#/', focus: true },
  { name: 'Jobs, list', hash: '#/', store: { 'gc.jobs.layout': 'list' } },
  { name: 'Jobs, floor', hash: '#/', store: { 'gc.jobs.layout': 'floor' }, play: 'full', wait: 2500, scrolls: 1 },
  { name: 'Map', hash: '#/map' },
  { name: 'Table', hash: '#/table' },
  { name: 'Desk', hash: '#/desk', focus: true },
  { name: 'Inbox', hash: '#/inbox' },
  { name: 'Job', hash: '#/job/customer-merge', focus: true },
  { name: 'Job, permission card', hash: '#/job/tag-colours' },
  { name: 'Job, working', hash: '#/job/nightly-export' },
  { name: 'Stage', hash: '#/job/customer-merge/stage/build' },
  { name: 'Screens', hash: '#/job/tag-filter-screens/screens', wait: 1500 },
  { name: 'Crew-dex', hash: '#/crew', play: 'full' },
  { name: 'Achievements', hash: '#/achievements', play: 'full' },
  { name: 'Stacks', hash: '#/stacks' },
  { name: 'Build stack', hash: '#/stacks/build' },
  { name: 'Stack, board', hash: '#/stack/invoice-export', focus: true },
  { name: 'Stack, map', hash: '#/stack/invoice-export', act: tab('Map') },
  { name: 'Stack, timeline', hash: '#/stack/invoice-export', act: tab('Timeline') },
  { name: 'Part page', hash: '#/stack/invoice-export/part/7' },
  { name: 'Telemetry', hash: '#/telemetry', focus: true, scrolls: 5 },
  ...['permissions', 'notifications', 'look', 'keys', 'workflow', 'repos', 'play', 'rules'].map((s) => ({ name: `Settings, ${s}`, hash: `#/settings/${s}`, focus: s === 'look' })),
  { name: 'Floor lab', hash: '#/floor-lab', play: 'full', wait: 2500, scrolls: 1 },
  { name: 'Not found', hash: '#/no-such-page', play: 'full' },
  { name: 'Classic page', url: '/', wait: 1500 },
  // The gallery has no Play layer: it is swept with Play full only.
  { name: 'Gallery', hash: '#/gallery', scrolls: 12, focus: true, play: 'full' },
];

/** Overlays: opened by a click or a key; only the overlay's own words are measured. */
const failWrites = async (page) => {
  await page.route(/\/api\//, (route) => (route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'A pretend failure from the theme sweep.' }) })).catch(() => {}));
};
const OVERLAY_VISITS = [
  { name: 'Peek', hash: '#/?peek=customer-notes-tab', scope: '.peek' },
  { name: 'Dialog (New job)', hash: '#/', act: async (p) => { await p.keyboard.press('c'); }, scope: '.sheet' },
  { name: 'Select menu', hash: '#/job/customer-merge', act: click('.composer .select, button.select'), scope: '.select-menu' },
  { name: 'Menu', hash: '#/', act: role('button', /^(Settings and more|Menu)$/), scope: '[role="menu"]' },
  { name: 'Menu, hover', hash: '#/', act: async (p) => { await role('button', /^(Settings and more|Menu)$/)(p); await p.locator('[role="menu"] [role="menuitem"]').nth(1).hover(); }, scope: '[role="menu"]', noTips: true },
  { name: 'Job menu', hash: '#/job/nightly-export', act: role('button', 'Job menu'), scope: '.job-menu-list' },
  { name: 'Tooltip', hash: '#/', act: async (p) => { await p.locator('[title]').filter({ visible: true }).first().hover(); await p.waitForTimeout(700); }, scope: '[role="tooltip"]' },
  { name: 'Command search', hash: '#/', act: async (p) => { await p.keyboard.press('ControlOrMeta+k'); }, scope: '.palette' },
  { name: 'Keys sheet', hash: '#/', act: async (p) => { await p.keyboard.press('Shift+?'); }, scope: '.sheet' },
  { name: 'Toast', hash: '#/job/nightly-export', act: async (p) => { await failWrites(p); await p.keyboard.press('ControlOrMeta+k'); await p.locator('.palette-input').fill('Ask about everything'); await p.waitForTimeout(150); await p.keyboard.press('Enter'); await p.waitForTimeout(600); }, scope: '.toast', expectErrors: /status of 500/, after: async (p) => { await p.unroute(/\/api\//); } },
  { name: 'Level sheet', hash: '#/stack/invoice-export/part/7', act: click('.part-level-choose'), scope: '.sheet' },
  // No part is next to merge in the demo, so this page is told part 5 is (only this page sees it), and
  // every write fails: the confirm opens and is looked at, nothing is merged.
  { name: 'Confirm (Merge)', hash: '#/stack/invoice-export/part/5', before: async (p) => { await failWrites(p); await p.route(/\/api\/stacks\/invoice-export(\/part\/5)?(\?.*)?$/, async (route) => { if (route.request().method() !== 'GET') return route.fallback(); try { const res = await route.fetch(); const json = await res.json(); const v = json.stack ?? json; Object.assign(v, { nextToMerge: 'csv-export', autoIntegrate: false, busy: null }); await route.fulfill({ response: res, json }); } catch { /* the page moved on */ } }); }, act: async (p) => { await p.getByRole('button', { name: /^Merge part 5/ }).filter({ visible: true }).first().click(); }, scope: '.sheet', expectErrors: /status of 500/, after: async (p) => { await p.unroute(/\/api\//); await p.unroute(/\/api\/stacks\/invoice-export(\/part\/5)?(\?.*)?$/); } },
  { name: 'Hover, job card', hash: '#/', act: async (p) => { await p.locator('.job-card, .job-row').filter({ visible: true }).first().hover(); }, scope: '.job-card:hover, .job-row:hover', noTips: true },
  { name: 'Hover, settings row', hash: '#/settings/look', act: async (p) => { await p.locator('.settings-rail-row').filter({ visible: true }).nth(1).hover(); }, scope: '.settings-rail-row:hover', noTips: true },
];

const VISITS = [...SCREEN_VISITS, ...OVERLAY_VISITS.map((v) => ({ ...v, overlay: true }))]
  .filter((v) => !ONLY || ONLY.some((w) => v.name.toLowerCase().includes(w)));

// ---------- The demo's Play mode ----------
async function api(method, p, body) {
  const meta = await (await fetch(`${ORIGIN}/api/meta`)).json();
  const res = await fetch(ORIGIN + p, { method, headers: { 'content-type': 'application/json', 'x-workshop-token': meta.token }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status}`);
  return res.json();
}

// ---------- One theme at one width and one Play mode ----------
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const findings = [];
const shotsIndex = [];
const add = (f) => findings.push(f);

/** One run's results on disk, so a long sweep can stop and go on (RESUME=1 keeps what is there). */
const runFile = (play, width, theme) => path.join(OUT, 'runs', `play-${play}-${width}-${theme}.json`);

async function runTheme(browser, theme, width, play) {
  const file = runFile(play, width, theme.id);
  if (RESUME && existsSync(file)) {
    const old = JSON.parse(readFileSync(file, 'utf8'));
    findings.push(...old.findings);
    shotsIndex.push(...old.shots);
    return;
  }
  const mark = { f: findings.length, s: shotsIndex.length };
  const height = width < 600 ? 844 : 945;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: theme.scheme });
  await ctx.addInitScript({ path: path.join(HERE, 'lib/inpage.js') });
  await ctx.addInitScript(([t, g]) => {
    try {
      if (!sessionStorage.getItem('sweep.init')) {
        sessionStorage.setItem('sweep.init', '1');
        localStorage.setItem('workshop.theme', t);
        localStorage.setItem('workshop.themeFollow', 'off');
        localStorage.setItem('gc.guide.seen', JSON.stringify(g));
        localStorage.removeItem('gc.jobs.layout');
      }
    } catch { /* storage off */ }
  }, [theme.id, GUIDES]);
  // The hidden themes: the ledger says they are unlocked (only this page sees it; the demo's own ledger is untouched).
  await ctx.route(/\/api\/play(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    try {
      const res = await route.fetch();
      const json = await res.json();
      json.unlocks = { ...(json.unlocks ?? {}), crt: true, gold: true };
      await route.fulfill({ response: res, json });
    } catch { /* the page moved on */ }
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  let errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => errors.push(`page error: ${String(e).slice(0, 240)}`));
  const where = { play, width, theme: theme.id };
  const dir = path.join(OUT, 'shots', `play-${play}`, String(width), theme.id);
  mkdirSync(dir, { recursive: true });
  let n = 0;

  for (const v of VISITS) {
    if (v.play && v.play !== play) continue;
    n += 1;
    errors = [];
    const screen = v.name;
    const t0 = Date.now();
    try {
      const store = { 'gc.jobs.layout': null, ...(v.store ?? {}) };
      if (!page.url().startsWith(ORIGIN)) await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.evaluate((s) => { for (const [k, val] of Object.entries(s)) { if (val === null) localStorage.removeItem(k); else localStorage.setItem(k, val); } }, store);
      if (v.before) await v.before(page);
      const url = v.url ? ORIGIN + v.url : `${BASE}?sweep=${n}${v.hash}`;
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(v.wait ?? 700);
      await page.evaluate(() => window.__sweep?.still());
      // The pointer rests in the bottom corner, not wherever the last visit's click left it.
      { const vs = page.viewportSize(); await page.mouse.move(vs.width - 2, vs.height - 2); }
      if (v.noTips) await page.evaluate(() => window.__sweep.tips(false));
      if (v.act) { await v.act(page); await page.waitForTimeout(450); }
      const got = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (got !== theme.id) add({ ...where, screen, kind: 'theme', path: 'html', what: `data-theme is "${got}", not "${theme.id}"` });
      if (v.scope && !(await page.locator(v.scope).count())) {
        add({ ...where, screen, kind: 'overlay', path: v.scope, what: 'did not open' });
      }
      const file = path.join(dir, `${String(n).padStart(2, '0')}-${slug(screen)}.png`);
      const t1 = Date.now();
      await measure(page, v, { ...where, screen }, file);
      const t2 = Date.now();
      if (FOCUS && v.focus && play === PLAYS[0]) await focusCheck(page, { ...where, screen });
      if (TIMING) console.log(`  ${theme.id} ${width} ${screen}: load ${t1 - t0} ms, measure ${t2 - t1} ms, focus ${Date.now() - t2} ms`);
      if (v.after) await v.after(page);
      shotsIndex.push({ ...where, screen, file });
    } catch (err) {
      add({ ...where, screen, kind: 'sweep', path: '', what: `could not check: ${String(err.message || err).split('\n')[0].slice(0, 200)}` });
      if (v.after) await v.after(page).catch(() => {});
    }
    for (const e of [...new Set(errors)].filter((x) => !(v.expectErrors && v.expectErrors.test(x)))) add({ ...where, screen, kind: 'console', path: '', what: e });
  }
  await ctx.close().catch(() => {});
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ findings: findings.slice(mark.f).filter((f) => f.theme === theme.id && f.width === width && f.play === play), shots: shotsIndex.slice(mark.s).filter((x) => x.theme === theme.id && x.width === width && x.play === play) }));
}

async function shoot(page) {
  return page.screenshot({ animations: 'disabled', caret: 'hide', timeout: 30000 });
}

async function measure(page, v, where, file) {
  const scope = v.overlay ? v.scope : null;
  const positions = v.overlay ? 1 : (v.scrolls ?? 3);
  const done = new Set();
  const offscreen = new Map();
  let first = true;
  for (let i = 0; i < positions; i++) {
    if (!v.overlay) {
      const more = await page.evaluate((i) => window.__sweep.scrollStep(i), i);
      if (!more) break;
      await page.waitForTimeout(i ? 200 : 50);
    }
    const data = await page.evaluate((s) => window.__sweep.collect({ scope: s }), scope);
    const shotBuf = await shoot(page);
    if (first) writeFileSync(file, shotBuf);
    await page.evaluate((s) => window.__sweep.bare(true, s), scope);
    const bareBuf = await shoot(page);
    await page.evaluate(() => window.__sweep.bare(false));
    const shot = decodePng(shotBuf), bareShot = decodePng(bareBuf);

    for (const t of data.texts) {
      const key = `${t.path}|${t.sample}|${Math.round(t.docY)}`;
      if (done.has(key)) continue;
      if (!t.inView || t.occluded || t.gradient) { if (!t.gradient && !t.occluded) offscreen.set(key, t); continue; }
      done.add(key); offscreen.delete(key);
      const m = textContrast(t, shot, bareShot);
      if (!m) continue;
      if (m.mid >= 2.5 && m.drawn < 1.3 && /[\p{L}\p{N}].*[\p{L}\p{N}]/u.test(t.sample)) add({ ...where, kind: 'hidden', path: t.path, sample: t.sample, what: `words not on screen: drawn ${m.drawn}:1 against what is behind (expected about ${m.mid}:1)`, fg: m.fg, bg: m.bg });
      else if (m.contrast + 1e-6 < t.need) add({ ...where, kind: 'text', path: t.path, sample: t.sample, ratio: m.contrast, worst: m.worst, need: t.need, fg: m.fg, bg: m.bg, what: `text ${m.contrast}:1 (worst ${m.worst}:1), needs ${t.need}:1` });
    }
    for (const mk of data.marks) {
      const key = `${mk.path}|${Math.round(mk.box.x)}|${Math.round(mk.box.y + data.scrollY)}`;
      if (done.has(key)) continue;
      done.add(key);
      const m = markContrast(mk, bareShot);
      if (m && m.ratio + 1e-6 < 3) add({ ...where, kind: 'mark', path: mk.path, sample: `${mk.kind} (${mk.tries.map((t) => t.k).join('/')})`, ratio: m.ratio, need: 3, fg: m.fg, bg: m.bg, what: `${mk.kind} ${m.ratio}:1, needs 3:1` });
    }
    for (const c of data.controls) {
      const key = `ctl|${c.path}|${Math.round(c.box.x)}|${Math.round(c.box.y + data.scrollY)}`;
      if (done.has(key)) continue;
      done.add(key);
      const m = controlVisibility(c, bareShot);
      const need = c.field ? 1.05 : 1.1;
      if (m && m.best < need) add({ ...where, kind: 'control', path: c.path, sample: c.label, ratio: m.best, need, fg: m.edgeColour, bg: m.outside, what: `can't be told from the page: edge ${m.edge}:1, fill ${m.fill}:1 against ${m.outside}` });
    }
    for (const s of data.shapes) {
      const key = `svg|${s.path}|${Math.round(s.box.x)}|${Math.round(s.box.y + data.scrollY)}`;
      if (done.has(key)) continue;
      done.add(key);
      const m = shapeContrast(s, bareShot);
      if (m && m.ratio + 1e-6 < s.need) add({ ...where, kind: 'drawn', path: s.path, sample: s.text ?? s.k, ratio: m.ratio, need: s.need, fg: m.fg, bg: m.bg, what: `${s.text !== null ? 'svg words' : 'drawn ' + s.k} ${m.ratio}:1, needs ${s.need}:1` });
    }
    if (first) {
      for (const o of data.overlays) {
        if (o.alpha < 0.9 && o.blur < 8 && !o.image) add({ ...where, kind: 'overlay', path: o.path, what: `see-through: ${Math.round(o.alpha * 100)}% opaque, blur ${o.blur} px` });
      }
      if (!v.overlay) {
        if (data.hscroll) add({ ...where, kind: 'layout', path: 'page', what: `scrolls sideways by ${data.hscroll} px` });
        for (const c of data.cut) add({ ...where, kind: 'layout', path: c.path, sample: c.sample, what: `words cut off by ${c.by} px (${c.dir}), no ellipsis` });
        for (const o of data.out) add({ ...where, kind: 'layout', path: o.path, what: `sticks out of the window (${o.left}..${o.right} px)` });
      }
    }
    first = false;
  }
  for (const t of offscreen.values()) {
    if (t.styleImg) continue;
    if (t.styleRatio + 1e-6 < t.need) add({ ...where, kind: 'text', path: t.path, sample: t.sample, ratio: t.styleRatio, need: t.need, what: `text ${t.styleRatio}:1 from styles (off screen), needs ${t.need}:1` });
  }
  if (!v.overlay) await page.evaluate(() => window.__sweep.scrollStep(0));
}

async function focusCheck(page, where) {
  await page.evaluate(() => { window.__sweep.scrollStep(0); document.activeElement?.blur?.(); window.__sweep.tips(false); });
  await page.mouse.move(0, 0);
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);
    const f = await page.evaluate(() => window.__sweep.focused());
    if (!f || !f.visible || seen.has(f.path + f.box.x + f.box.y)) continue;
    seen.add(f.path + f.box.x + f.box.y);
    const vw = page.viewportSize();
    const x = Math.max(0, Math.floor(f.box.x - 20)), y = Math.max(0, Math.floor(f.box.y - 20));
    const clip = { x, y, width: Math.min(vw.width - x, Math.ceil(f.box.w + 40)), height: Math.min(vw.height - y, Math.ceil(f.box.h + 40)) };
    if (clip.width < 4 || clip.height < 4) continue;
    const a = decodePng(await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }));
    await page.evaluate(() => window.__sweep.unfocus());
    const b = decodePng(await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }));
    await page.evaluate(() => window.__sweep.refocus());
    const m = focusRing(f.box, clip, a, b);
    if (m.max < 3 || m.coverage < 0.5) add({ ...where, kind: 'focus', path: f.path, sample: f.label, ratio: m.max, what: `focus ring hard to see: strongest change ${m.max}:1, round ${Math.round(m.coverage * 100)}% of it` });
  }
  await page.evaluate(() => window.__sweep.tips(true));
}

// ---------- Follow the system ----------
async function followCheck(browser) {
  for (const [dark, light] of PAIRS) {
    for (const [scheme, pick, want] of [['light', dark, light], ['dark', light, dark]]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
      await ctx.addInitScript(([t]) => { localStorage.setItem('workshop.theme', t); localStorage.setItem('workshop.themeFollow', 'on'); }, [pick]);
      const page = await ctx.newPage();
      await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' }).catch(() => {});
      const got = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (got !== want) add({ play: '-', width: 1280, theme: pick, screen: 'Follow the system', kind: 'follow', path: 'html', what: `${scheme} system: "${got}", expected "${want}"` });
      await page.emulateMedia({ colorScheme: scheme === 'light' ? 'dark' : 'light' });
      await page.waitForTimeout(300);
      const live = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      const wantLive = scheme === 'light' ? dark : light;
      if (live !== wantLive) add({ play: '-', width: 1280, theme: pick, screen: 'Follow the system', kind: 'follow', path: 'html', what: `switched live to the ${scheme === 'light' ? 'dark' : 'light'} system: "${live}", expected "${wantLive}"` });
      await ctx.close();
    }
  }
}

// ---------- Contact sheets ----------
async function contactSheets(browser) {
  mkdirSync(path.join(OUT, 'sheets'), { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const sheets = [];
  for (const theme of THEMES) for (const play of PLAYS) {
    const mine = shotsIndex.filter((s) => s.theme === theme.id && s.play === play);
    if (!mine.length) continue;
    const count = (w) => findings.filter((f) => f.theme === theme.id && f.play === play && f.width === w).length;
    const body = WIDTHS.map((w) => {
      const list = mine.filter((s) => s.width === w);
      return `<h2>${w} px · ${count(w)} findings</h2><div class="grid w${w < 600 ? 's' : 'l'}">${list.map((s) => {
        const bad = findings.filter((f) => f.theme === theme.id && f.play === play && f.width === w && f.screen === s.screen).length;
        return `<figure><img src="file://${s.file}"><figcaption>${esc(s.screen)}${bad ? ` <b>${bad}</b>` : ''}</figcaption></figure>`;
      }).join('')}</div>`;
    }).join('');
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:16px;font:13px system-ui;background:#f4f4f5;color:#111}h1{font-size:20px;margin:0 0 8px}h2{font-size:15px;margin:16px 0 8px}
      .grid{display:grid;gap:10px}.wl{grid-template-columns:repeat(5,1fr)}.ws{grid-template-columns:repeat(10,1fr)}
      figure{margin:0}img{width:100%;display:block;border:1px solid #bbb}figcaption{padding:2px 0}b{color:#b00}</style>
      <h1>${esc(theme.label)} (${theme.id}) · Play ${play}</h1>${body}`;
    const htmlFile = path.join(OUT, 'sheets', `${theme.id}-play-${play}.html`);
    writeFileSync(htmlFile, html);
    await page.goto(`file://${htmlFile}`, { waitUntil: 'load' });
    const png = path.join(OUT, 'sheets', `${theme.id}-play-${play}.png`);
    await page.screenshot({ path: png, fullPage: true });
    sheets.push(png);
  }
  await page.close();
  return sheets;
}

// ---------- Run ----------
mkdirSync(OUT, { recursive: true });
// A late answer to a page that has moved on must not end a long sweep.
process.on('unhandledRejection', (err) => console.log(`  (ignored: ${String(err?.message ?? err).split('\n')[0]})`));
const browser = await chromium.launch(process.env.SWIFTSHADER === '1' ? { args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] } : {});
const before = (await api('GET', '/api/meta')).settings?.play?.mode ?? 'off';
const started = Date.now();
try {
  for (const play of PLAYS) {
    await api('POST', '/api/settings', { play: { mode: play } });
    for (const width of WIDTHS) {
      const queue = THEMES.filter((t) => !(t.unlock && play === 'off'));
      for (const t of THEMES) if (t.unlock && play === 'off') console.log(`  ${t.id}: not available with Play off (by design: a hidden theme needs Play on), skipped`);
      const workers = Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
        for (let t = queue.shift(); t; t = queue.shift()) {
          const t0 = Date.now();
          await runTheme(browser, t, width, play);
          const mine = findings.filter((f) => f.theme === t.id && f.width === width && f.play === play).length;
          console.log(`Play ${play} · ${width} px · ${t.id.padEnd(12)} ${mine ? `${mine} findings` : 'passes'} (${Math.round((Date.now() - t0) / 1000)} s)`);
        }
      });
      await Promise.all(workers);
    }
  }
  if (!ONLY) await followCheck(browser);
} finally {
  await api('POST', '/api/settings', { play: { mode: before } }).catch(() => {});
}
const sheets = SHEETS ? await contactSheets(browser) : [];
await browser.close();

// One row per distinct problem: the same theme, screen, element, kind and colours count once (n).
const groups = new Map();
for (const f of findings) {
  const key = [f.theme, f.screen, f.kind, f.path, f.what.replace(/[\d.]+/g, '#'), f.fg, f.bg].join('|');
  const g = groups.get(key);
  if (g) { g.n += 1; if (!g.where.includes(`${f.play}/${f.width}`)) g.where.push(`${f.play}/${f.width}`); } else groups.set(key, { ...f, n: 1, where: [`${f.play}/${f.width}`] });
}
const rows = [...groups.values()];
writeFileSync(path.join(OUT, 'findings.json'), JSON.stringify(rows, null, 2));
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
writeFileSync(path.join(OUT, 'findings.md'), [
  `# Theme sweep findings (${new Date().toISOString()})`, '',
  `Themes: ${THEMES.map((t) => t.id).join(', ')} · widths ${WIDTHS.join(', ')} · Play ${PLAYS.join(', ')} · ${VISITS.length} visits each.`, '',
  '| theme | screen | kind | element | words | what is wrong | fg | bg | seen at (play/width) | n |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((f) => `| ${cell(f.theme)} | ${cell(f.screen)} | ${cell(f.kind)} | \`${cell(f.path)}\` | ${cell(f.sample)} | ${cell(f.what)} | ${cell(f.fg)} | ${cell(f.bg)} | ${f.where.join(' ')} | ${f.n} |`),
].join('\n'));

const byTheme = new Map(THEMES.map((t) => [t.id, 0]));
for (const r of rows) byTheme.set(r.theme, (byTheme.get(r.theme) ?? 0) + 1);
console.log('');
for (const [t, c] of byTheme) console.log(`${t.padEnd(12)} ${c ? `${c} distinct findings` : 'passes'}`);
const kinds = {};
for (const r of rows) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
console.log(`By kind: ${Object.entries(kinds).map(([k, c]) => `${k} ${c}`).join(', ') || 'none'}`);
console.log(`Screenshots: ${path.join(OUT, 'shots')}`);
if (sheets.length) console.log(`Contact sheets: ${path.join(OUT, 'sheets')}`);
console.log(`Findings: ${path.join(OUT, 'findings.md')} (${Math.round((Date.now() - started) / 60000)} min)`);
console.log(rows.length ? `${rows.length} distinct findings; see the list.` : 'Every theme passes.');
process.exit(rows.length ? 1 : 0);
