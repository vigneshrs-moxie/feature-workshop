// No scroll past the end of a page (spec 1.10), checked in a real browser.
//
// On every screen (Jobs, Table, Map, the Desk, Inbox, Stacks, Telemetry, Settings and its
// Workflow section, each job's page, the first job's page at each of its seven steps' addresses,
// and nightly-export's Test step, conversation and overview addresses when the app has that job)
// it checks the screen as it opens, then opens every fold on the page one after another and checks
// again after each: the overview, a "Details" or "More" row, a <summary>, and on the Test step the
// evidence fold ("Each line and its video"), Try it and Watch. On a job page it also opens the
// level menu in the page's header (opening it sends nothing; no level is picked), checks, and
// closes it. A check fails when:
//   1. the document itself scrolls, down or sideways (the app's own scroll areas do the scrolling);
//   2. a scroll area ends in empty space: it scrolls more than 48 px (plus its own bottom padding)
//      past the last thing you can see in it;
//   3. something is cut off sideways: main or a scroll area is wider inside than it shows, or a
//      box with text in a card runs past its own edge without an ellipsis or a sideways scroll;
//   4. on a job page the conversation's message list is under 160 px tall in a window 800 px tall
//      or more (only while it is shown: under 1100 px it is behind the Conversation button, and the
//      phone layout, 760 px and under, has its own conversation screen);
//   5. the screen is not there: the address could not be opened, or the page has no main, or its
//      main has no text (a blank page or a crashed route never passes).
// The check only reads: it refuses every request that is not a GET.
//
// Run it against a running app (the demo is best):
//   PORT=4493 STARBASE_DEMO=1 node dashboard/demo/run-demo.js      # in one terminal
//   npm run web:build && node web/e2e/noEmptyScroll.mjs            # in another
// Environment: BASE (default http://127.0.0.1:4493/next/), WIDTHS (comma list, default
// 1280,1512,1920), WIDTH (one width only; overrides WIDTHS), THEME (light; a theme's id, such as
// default, glass or starbase; dark means default, the dark theme; a theme the app does not put on
// fails the run), JOBS (a comma list of
// job slugs; default every job the app lists), DIST (a built app folder, such as web/dist: its
// pages and files stand in for the ones BASE serves, so a build is checked on another Starbase's
// jobs), PLAYWRIGHT (the path to playwright's index.mjs, when it isn't installed here). Every
// window is 820 px tall.
// It reports each width, then exits 1 if anything failed at any width (listing what), or 0.
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:4493/next/';
const DIST = process.env.DIST ? resolve(process.env.DIST) : null;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' };
const WIDTHS = (process.env.WIDTH || process.env.WIDTHS || '1280,1512,1920')
  .split(',').map((w) => Number(w.trim())).filter((w) => w > 0);
const HEIGHT = 820;
// "dark" is the dark theme's own id, default (web/src/theme/theme.ts THEME_PAIRS).
const THEME = ({ dark: 'default' })[process.env.THEME || 'light'] ?? (process.env.THEME || 'light');
// Every fold: a "Details" or "More" row, a <summary> (the job page's overview is one), and on the
// Test step the evidence fold, Try it and Watch (each opens something in the page).
const FOLDS = 'main .more-head, main details > summary, main .sb-test-link[aria-expanded], main .sb-test-action > button';
/** A fold is open: a <summary>'s details is, an aria-expanded control says so, Watch reads Stop watching. */
const isOpen = (el) => (el.tagName === 'SUMMARY' ? el.parentElement.open
  : el.hasAttribute('aria-expanded') ? el.getAttribute('aria-expanded') === 'true'
    : /Stop watching/.test(el.textContent || ''));
const MAX_FOLDS = 60;

/** The jobs to visit, from the app's own snapshot. */
async function jobSlugs() {
  if (process.env.JOBS) return process.env.JOBS.split(',').map((s) => s.trim()).filter(Boolean);
  const res = await fetch(new URL('/api/snapshot', BASE));
  const snap = await res.json();
  return (snap.jobs ?? []).map((j) => j.slug);
}

const slugs = await jobSlugs();
/** The job's seven steps, in order (web/src/components/stops/stops.ts). */
const STEPS = ['spec', 'investigate', 'plan', 'build', 'test', 'review', 'ship'];
/** The demo's job with a recording under way: its Test step, its conversation and its overview. */
const RECORDING_JOB = 'nightly-export';
const SCREENS = [
  ['Jobs', '#/'],
  ['Table', '#/table'],
  ['Map', '#/map'],
  ['Desk', '#/desk'],
  ['Inbox', '#/inbox'],
  ['Stacks', '#/stacks'],
  ['Telemetry', '#/telemetry'],
  ['Settings', '#/settings'],
  ['Settings → Workflow', '#/settings/workflow'],
  ...slugs.map((s) => [`Job ${s}`, `#/job/${s}`]),
  ...(slugs.length ? STEPS.map((stop) => [`Job ${slugs[0]} at ${stop}`, `#/job/${slugs[0]}/stage/${stop}`]) : []),
  ...(slugs.includes(RECORDING_JOB) ? [
    [`Job ${RECORDING_JOB} at test`, `#/job/${RECORDING_JOB}/stage/test`],
    [`Job ${RECORDING_JOB}: conversation`, `#/job/${RECORDING_JOB}/conversation`],
    [`Job ${RECORDING_JOB}: overview`, `#/job/${RECORDING_JOB}/overview`],
  ] : []),
];

/** Runs in the page: every failure on the screen as it stands now, as short lines. */
function check() {
  const out = [];
  const de = document.documentElement;
  const name = (e) => {
    if (e === de) return 'the document';
    const cls = [...e.classList].slice(0, 3).join('.');
    return `${e.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
  };
  const shown = (e) => !e.checkVisibility || e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const scrollsY = (s) => s.overflowY === 'auto' || s.overflowY === 'scroll';

  // 1. The document scrolls. The lowest piece placed absolutely names the likely cause: a scroll
  // area clips everything else in it.
  if (de.scrollWidth > innerWidth + 1) out.push(`the document scrolls sideways: ${de.scrollWidth} wide in ${innerWidth}`);
  if (de.scrollHeight > innerHeight + 1) {
    let low = null;
    let lowBottom = innerHeight;
    for (const n of document.body.querySelectorAll('*')) {
      if (getComputedStyle(n).position !== 'absolute') continue;
      const b = n.getBoundingClientRect().bottom + scrollY;
      if (b > lowBottom + 0.5) { low = n; lowBottom = b; }
    }
    const why = low ? `, lowest ${name(low)} (${getComputedStyle(low).position}) in ${name(low.parentElement)} at ${Math.round(lowBottom)}` : '';
    out.push(`the document scrolls: ${de.scrollHeight} in ${innerHeight}${why}`);
  }

  const areas = [...document.querySelectorAll('body *')].filter((e) => {
    const s = getComputedStyle(e);
    return (scrollsY(s) || s.overflowX === 'auto' || s.overflowX === 'scroll') && e.clientHeight > 0 && shown(e);
  });

  // 2. A scroll area ends in empty space. Content is text, an image, a form control or a box with
  // a border, clipped by every overflow box between it and the scroll area. It is measured with
  // the area scrolled to its end, where a sticky footer (the Desk's buttons, a step page's message
  // box) sits in its own place at the end and not stuck to the window's foot; then put back.
  // Two blind spots: a bordered box counts whole, so empty space inside a tall bordered box at the
  // end is not seen; and empty space between the content and a sticky footer that ends the area
  // is not measured, since the footer itself is the last content.
  for (const sc of areas) {
    if (!scrollsY(getComputedStyle(sc)) || sc.scrollHeight <= sc.clientHeight + 1) continue;
    const was = sc.scrollTop;
    sc.scrollTop = sc.scrollHeight;
    const r0 = sc.getBoundingClientRect();
    const top = r0.top + sc.clientTop - sc.scrollTop;
    let last = 0;
    let lastEl = null;
    // The area's own text (a log in a <pre>) counts too.
    for (const t of sc.childNodes) {
      if (t.nodeType !== 3 || !t.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      const b = Math.max(...[...range.getClientRects()].map((r) => r.bottom), -Infinity);
      if (b - top > last) { last = b - top; lastEl = sc; }
    }
    for (const n of sc.querySelectorAll('*')) {
      if (!shown(n)) continue;
      const s = getComputedStyle(n);
      if (s.position === 'fixed') continue;
      const text = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      const control = /^(IMG|SVG|CANVAS|VIDEO|INPUT|TEXTAREA|SELECT|BUTTON|IFRAME|HR)$/i.test(n.tagName);
      const bordered = ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== 'none');
      if (!text && !control && !bordered) continue;
      const r = n.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue; // a screen-reader label, or nothing
      let bottom = r.bottom;
      let topEdge = r.top;
      let gone = false;
      for (let p = n.parentElement; p && p !== sc; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (ps.overflowY === 'visible') continue;
        const pr = p.getBoundingClientRect();
        bottom = Math.min(bottom, pr.bottom);
        topEdge = Math.max(topEdge, pr.top);
        if (bottom <= topEdge) { gone = true; break; }
      }
      if (gone) continue;
      if (bottom - top > last) { last = bottom - top; lastEl = n; }
    }
    sc.scrollTop = was;
    const pad = parseFloat(getComputedStyle(sc).paddingBottom) || 0;
    const tail = Math.round(sc.scrollHeight - last);
    if (tail > pad + 48) out.push(`${name(sc)} scrolls ${tail - Math.round(pad)} px past its last content (${lastEl ? name(lastEl) : 'none'}): ${sc.scrollHeight} in ${sc.clientHeight}`);
  }

  // 3. Cut off sideways. Code, diffs and tables scroll sideways on purpose (their scroll bar is
  // the way to read them): code blocks and diffs, and a table's own scroll wrapper, are left out.
  // Every other scroll area counts, main and the page itself too, even when a table is inside.
  const SIDEWAYS_OK = 'pre, code, table, .code-lines, .part-diff, .doc-source, .perm-preview, .perm-preview-page';
  const TABLE_WRAPS = '.table-wrap, .home-table-scroll, .tele-table-wrap, .route-table-wrap';
  for (const sc of [document.querySelector('main'), ...areas].filter(Boolean)) {
    if (sc.matches(SIDEWAYS_OK) || sc.matches(TABLE_WRAPS) || !shown(sc)) continue;
    if (sc.scrollWidth > sc.clientWidth + 1) out.push(`${name(sc)} is cut off sideways: ${sc.scrollWidth} wide in ${sc.clientWidth}`);
  }
  // A box with text in a card that runs past its own edge. Inline boxes have no width of their
  // own, so their block parent stands for them; only the innermost box that overflows is listed.
  // Only text counts: a key hint, a tooltip or a menu placed on a box's corner on purpose is
  // positioned absolutely, so text inside such a piece is left out; so is anything inside a box
  // that scrolls sideways or ends in an ellipsis.
  const CARD = '[class*="card"], .more, .job-side-card, .job-convo, .job-details, .desk-console, .sb-job-top, .fold, .sb-panel, .sb-convo';
  const placed = (t, box) => {
    for (let p = t.parentElement; p && p !== box; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.position === 'absolute' || s.position === 'fixed' || s.textOverflow === 'ellipsis' || s.overflowX === 'auto' || s.overflowX === 'scroll') return true;
    }
    return false;
  };
  const textPastEdge = (box) => {
    const edge = box.getBoundingClientRect().left + box.clientLeft + box.clientWidth + 1;
    const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      if (!t.textContent.trim() || placed(t, box)) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      if ([...range.getClientRects()].some((r) => r.width > 0 && r.right > edge)) return true;
    }
    return false;
  };
  const wide = [...document.querySelectorAll('main *')].filter((e) => {
    if (!e.parentElement?.closest(CARD) || !shown(e) || !e.textContent.trim()) return false;
    if (e.closest(SIDEWAYS_OK) || e.closest('.sr-only')) return false;
    const s = getComputedStyle(e);
    if (s.display === 'inline' || s.display === 'contents' || e.clientWidth === 0) return false;
    if (s.textOverflow === 'ellipsis' || s.overflowX === 'auto' || s.overflowX === 'scroll') return false;
    return e.scrollWidth > e.clientWidth + 1 && textPastEdge(e);
  });
  for (const e of wide) {
    if (wide.some((o) => o !== e && e.contains(o))) continue;
    out.push(`${name(e)} in ${name(e.parentElement.closest(CARD))} runs out sideways: ${e.scrollWidth} wide in ${e.clientWidth} ("${e.textContent.trim().slice(0, 40)}")`);
  }

  // 4. A squeezed conversation on a job page: its message list, while it is shown.
  const thread = document.querySelector('.sb-convo-list');
  if (thread && shown(thread) && innerHeight >= 800 && thread.clientHeight < 160) out.push(`the conversation's message list is ${thread.clientHeight} px tall in a ${innerHeight} px window`);
  return out;
}

const browser = await chromium.launch();

async function runAt(WIDTH) {
  const problems = [];
  let checks = 0;
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.addInitScript((t) => {
    try { localStorage.setItem('workshop.theme', t); } catch { /* storage off */ }
  }, THEME);
  // Read only: nothing the check does may send, approve, start, stop or mark anything.
  const base = new URL(BASE);
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') return route.abort();
    const url = new URL(req.url());
    if (DIST && url.origin === base.origin && url.pathname.startsWith(base.pathname)) {
      const file = join(DIST, url.pathname.slice(base.pathname.length) || 'index.html');
      const body = await readFile(file).catch(() => null);
      if (body) return route.fulfill({ body, contentType: TYPES[extname(file)] ?? 'application/octet-stream' });
    }
    return route.continue();
  });

  const record = async (screen, when) => {
    checks += 1;
    for (const p of await page.evaluate(check)) problems.push(`${screen}, ${when}: ${p}`);
  };

  let themeChecked = false;
  for (const [screen, hash] of SCREENS) {
    const opened = await page.goto(BASE + hash, { waitUntil: 'networkidle' }).then((r) => (r && !r.ok() ? `the address answered ${r.status()}` : null), (err) => `the address could not be opened (${String(err.message).split('\n')[0]})`);
    if (opened) { checks += 1; problems.push(`${screen}: ${opened}`); continue; }
    await page.waitForTimeout(700);
    // 5. The screen must be there: a main with text in it.
    const main = await page.evaluate(() => { const m = document.querySelector('main'); return m ? (m.innerText || '').trim().length : -1; });
    if (main <= 0) { checks += 1; problems.push(`${screen}: ${main < 0 ? 'the page has no main' : 'the page\'s main has no text'}`); continue; }
    // The theme asked for is the one on the page (the app skips an id it does not know).
    if (!themeChecked) {
      themeChecked = true;
      const on = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (on !== THEME) throw new Error(`THEME=${process.env.THEME || 'light'} asks for the theme "${THEME}", but the page shows "${on}": not a theme the app puts on.`);
    }
    // A first-visit guide: close it.
    const skip = page.locator('.guide button', { hasText: 'Skip' });
    if (await skip.count()) { await skip.first().click().catch(() => {}); await page.waitForTimeout(200); }
    await record(screen, 'as opened');
    // Every fold, one after another; a fold opened can show more folds, so count them each time.
    for (let i = 0; i < MAX_FOLDS; i++) {
      const folds = page.locator(FOLDS);
      if (i >= (await folds.count())) break;
      const fold = folds.nth(i);
      if (!(await fold.isVisible().catch(() => false))) continue;
      const open = await fold.evaluate(isOpen);
      if (open) continue;
      const label = ((await fold.textContent().catch(() => '')) || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      await fold.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(250);
      await record(screen, `with "${label}" open`);
    }
    // The level menu in the job page's header: open, check, close. Opening sends nothing.
    const chip = page.locator('main .sb-job-top .level-chip:enabled');
    if (await chip.count() && await chip.first().isVisible().catch(() => false)) {
      await chip.first().click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(250);
      await record(screen, 'with the level menu open');
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(150);
    }
  }
  await page.close();
  return { problems, checks };
}

let failed = 0;
for (const WIDTH of WIDTHS) {
  const at = await runAt(WIDTH).catch((err) => ({ broke: err.message }));
  if (at.broke) { await browser.close(); console.log(`${WIDTH} px: ${at.broke}`); process.exit(1); }
  const { problems, checks } = at;
  if (problems.length) {
    failed += 1;
    const list = [...new Set(problems)];
    console.log(`${WIDTH} px: ${list.length} failures:\n${list.map((p) => `  ${p}`).join('\n')}`);
  } else {
    console.log(`${WIDTH} px: no empty scroll: ${checks} checks on ${SCREENS.length} screens (${THEME}).`);
  }
}
await browser.close();
console.log(failed ? `Failed at ${failed} of ${WIDTHS.length} widths.` : `No empty scroll at ${WIDTHS.join(', ')} px.`);
process.exit(failed ? 1 : 0);
