// The seven speed rules of the new job page (docs/plans/2026-11-13-job-page-plan.md, "Speed rules"),
// each checked and each printing its number, on the demo's made-up 200-item job
// (orbit-906-crew-schedule-export-long, test/fixtures/long-job.js) in a real browser at 1512 px.
//
//   1  Opening the job from Jobs paints the header, Your move and the steps within 150 ms of the click
//      (from a fresh load of Jobs, and again from Jobs after the page was open).
//   2  A step, a document, a message and the conversation each show within 100 ms of the pick, at the
//      95th percentile over 30 picks of each.
//   3  No layout shift he did not cause (PerformanceObserver `layout-shift`, hadRecentInput false)
//      over two minutes with a message arriving every 10 s, the conversation open and read half way
//      down; the line he reads does not move either.
//   4  Go shows `Sent` within 50 ms of the click; when the server refuses, his picks are back.
//   5  Idle for 60 s: no React commit and no request but the event stream. Then one message arrives:
//      only the conversation's count and the conversation's lines redraw.
//   6  The page's job request (`/page`) answers under 100 ms from a warm cache, and opening the page
//      starts no git, ps or psql and reads no agent log.
//   7  No transition or animation over 120 ms in the new page's CSS (web/src/jobpage/**/*.css and
//      every theme rule naming .jp2): read from the files, then measured in the page in every theme.
//
// It needs the demo with its speed hooks (dashboard/demo/speed-hooks.js: per-request counts of
// programs started and log reads, and /talk, which makes a made-up reply arrive):
//   TMPDIR=<a temp folder> PORT=4495 WIREFRAMES_PORT=4496 SPEED_HOOKS_PORT=4497 \
//     node --import ./dashboard/demo/speed-hooks.js dashboard/demo/run-demo.js        # one terminal
//   node web/e2e/jobSpeed.mjs                                                          # another
// React commits are counted through React's own devtools hook (installed before the app loads; no
// change to the app). Every POST is refused here: Go's is answered 409 after 1.2 s (rule 4), any
// other is aborted, so nothing he could do is done; the only change made is the demo's /talk.
//
// Environment: BASE (http://127.0.0.1:4495/next/), HOOKS (http://127.0.0.1:4497), LABEL (a word for
// the table, e.g. quiet or loaded), ONLY (a comma list of rule numbers), SHIFT_SECONDS (120),
// IDLE_SECONDS (60), PICKS (30), PLAYWRIGHT (the path to playwright's index.mjs).
// Prints one line per measure and a table; exits 1 if any rule missed.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://127.0.0.1:4495/next/';
const HOOKS = process.env.HOOKS || 'http://127.0.0.1:4497';
const ORIGIN = new URL(BASE).origin;
const LABEL = process.env.LABEL || 'quiet';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map((s) => Number(s.trim()))) : null;
const SHIFT_SECONDS = Number(process.env.SHIFT_SECONDS || 120);
const IDLE_SECONDS = Number(process.env.IDLE_SECONDS || 60);
const PICKS = Number(process.env.PICKS || 30);
const SLUG = 'orbit-906-crew-schedule-export-long';
const TITLE = 'Crew schedule export (long)';
const WIDTH = 1512;
const HEIGHT = 1000;

const results = [];
const record = (rule, what, number, limit, pass, note = '') => {
  results.push({ rule, what, number, limit, pass, note });
  console.log(`  [${pass ? 'pass' : 'MISS'}] rule ${rule}: ${what}: ${number} (limit ${limit})${note ? ` · ${note}` : ''}`);
};
const want = (n) => !ONLY || ONLY.has(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : x);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(s.length * p) - 1)]; };
const median = (xs) => pct(xs, 0.5);
const stats = (xs) => `median ${round(median(xs))}, p95 ${round(pct(xs, 0.95))}, worst ${round(Math.max(...xs))} ms over ${xs.length}`;
const hooks = async (p) => { const res = await fetch(`${HOOKS}${p}`); if (!res.ok) throw new Error(`${p}: ${res.status} ${await res.text()}`); return res.json(); };

// ---------- 7, from the files ----------

/** Every rule of a stylesheet, nested @media included: { selector, body }. */
function rulesOf(css) {
  const out = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const walk = (s) => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) break;
      const head = s.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
      const body = s.slice(open + 1, j - 1);
      if (head.startsWith('@')) { if (/^@(media|supports|layer|container)/.test(head)) walk(body); }
      else out.push({ selector: head.replace(/\s+/g, ' '), body });
      i = j;
    }
  };
  walk(text);
  return out;
}

const tokens = Object.fromEntries([...readFileSync(path.join(HERE, '../src/theme/tokens.css'), 'utf8').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const toMs = (t) => {
  const v = t.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_, name, fb) => tokens[name] ?? fb ?? '0s');
  const m = /^(-?[\d.]+)(ms|s)$/.exec(v.trim());
  return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : null;
};
/** The longest motion a declaration asks for: duration plus delay, in ms (0 for none). */
function longestMotion(prop, value) {
  const items = value.split(/,(?![^(]*\))/).map((x) => x.trim());
  let worst = 0;
  for (const item of items) {
    if (/^none\b/.test(item)) continue;
    const times = (item.match(/(?:var\([^)]*\)|-?[\d.]+m?s)\b/g) ?? []).map(toMs).filter((x) => x !== null);
    let total;
    if (/-(duration|delay)$/.test(prop)) total = times[0] ?? 0;
    else total = (times[0] ?? 0) + (times[1] ?? 0);
    worst = Math.max(worst, total);
  }
  return worst;
}

function staticMotion() {
  const files = [];
  const pageDir = path.join(HERE, '../src/jobpage');
  for (const f of readdirSync(pageDir, { recursive: true })) if (String(f).endsWith('.css')) files.push({ file: path.join(pageDir, String(f)), all: true });
  const themeDir = path.join(HERE, '../src/theme');
  for (const f of readdirSync(themeDir, { recursive: true })) if (String(f).endsWith('.css')) files.push({ file: path.join(themeDir, String(f)), all: false });
  const found = [];
  let ruleCount = 0;
  for (const { file, all } of files) {
    for (const r of rulesOf(readFileSync(file, 'utf8'))) {
      if (!all && !/\.jp2/.test(r.selector)) continue;
      ruleCount++;
      for (const m of r.body.matchAll(/(?:^|;|\s)((?:transition|animation)(?:-duration|-delay)?)\s*:\s*([^;]+)/g)) {
        const ms = longestMotion(m[1], m[2]);
        found.push({ where: `${path.relative(path.join(HERE, '..'), file)} ${r.selector.slice(0, 80)}`, prop: m[1], ms });
      }
    }
  }
  return { found, ruleCount, files: files.filter((f) => f.all).length };
}

// ---------- the browser ----------

const browser = await chromium.launch();

/** In every page: React's devtools hook (commits and what rendered), layout shifts, and the timer helper. */
function initPage() {
  try {
    localStorage.setItem('sb.jobPage', 'new');
    localStorage.setItem('workshop.theme', window.__speedTheme ?? 'light');
    localStorage.setItem('gc.guide.seen', JSON.stringify(['jobs', 'desk', 'stage', 'job', 'job-page-2', 'inbox', 'telemetry', 'stack', 'stacks', 'review', 'review-round']));
  } catch { /* storage off */ }

  // React's commits, through its devtools hook (React calls it in production builds too).
  const rc = { commits: 0, detail: false, rendered: [] };
  window.__rc = rc;
  const COMPONENT = new Set([0, 1, 11, 14, 15]);
  const HOST = new Set([5, 26, 27]);
  const nameOf = (f) => { const t = f.type; return (t && (t.displayName || t.name || t.type?.displayName || t.type?.name || t.render?.name)) || `tag${f.tag}`; };
  const hostOf = (f) => {
    // Its own first element, else the nearest element above it.
    const stack = [f.child];
    while (stack.length) { const c = stack.shift(); if (!c) continue; if (HOST.has(c.tag)) return c.stateNode; stack.push(c.child, c.sibling); if (stack.length > 4000) break; }
    let p = f.return; while (p && !HOST.has(p.tag)) p = p.return; return p?.stateNode ?? null;
  };
  const describe = (el) => (el instanceof Element ? `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : ''}` : String(el));
  const walk = (next, prev, out) => {
    if (COMPONENT.has(next.tag) && (!prev || (next.flags & 1) === 1)) out.push(next);
    if (prev && next.child === prev.child) return; // nothing under it was worked on
    for (let c = next.child; c; c = c.sibling) walk(c, c.alternate, out);
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(), supportsFiber: true, isDisabled: false,
    inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    onCommitFiberRoot(_id, root) {
      rc.commits++;
      if (!rc.detail) return;
      const out = [];
      try { walk(root.current, root.current.alternate, out); } catch { /* a shape this walk does not know */ }
      rc.rendered.push(out.slice(0, 400).map((f) => { const h = hostOf(f); return { name: nameOf(f), host: describe(h), el: h }; }));
    },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {}, checkDCE() {},
  };

  // Layout shifts he did not cause.
  window.__shifts = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__shifts.push({ t: e.startTime, value: e.value, sources: (e.sources ?? []).map((s) => (s.node instanceof Element ? `${s.node.tagName.toLowerCase()}.${[...s.node.classList].slice(0, 3).join('.')}` : s.node?.nodeName ?? '?')) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* no layout-shift entries in this browser */ }

  // From a click to the frame that shows what was asked for (checked at each frame, timed after its paint).
  const preds = {
    open: (title) => {
      const t = document.querySelector('.jp2-head .jp2-title');
      return Boolean(t && t.textContent.includes(title) && document.querySelector('.jp2-ym') && document.querySelectorAll('.jp2-st-row').length >= 7);
    },
    reader: (was) => {
      const title = document.querySelector('.jp2-rv-title')?.textContent ?? '';
      const body = document.querySelector('.jp2-rv-body');
      if (title === was || !body) return false;
      if ([...body.querySelectorAll('[role="status"]')].some((s) => /^(Reading|Loading)/.test(s.textContent.trim()))) return false;
      return body.textContent.trim().length > 0;
    },
    line: (id) => {
      const full = document.querySelector(`li.jp2-cv-item[data-id="${CSS.escape(id)}"] .jp2-cv-full`);
      return Boolean(full && full.textContent.trim().length > 0);
    },
    conversation: () => document.querySelectorAll('[data-view="conversation"] .jp2-cv-line').length > 0,
    sent: () => Boolean(document.querySelector('.jp2-ym-sent')),
  };
  window.__arm = (kind, arg) => {
    let t0 = null;
    const onClick = (e) => { if (t0 === null) t0 = e.timeStamp; };
    window.addEventListener('click', onClick, true);
    window.__wait = new Promise((resolve) => {
      const started = performance.now();
      const tick = () => {
        if (performance.now() - started > 8000) { window.removeEventListener('click', onClick, true); resolve(Infinity); return; }
        if (t0 !== null && preds[kind](arg)) {
          window.removeEventListener('click', onClick, true);
          const mc = new MessageChannel();
          mc.port1.onmessage = () => resolve(performance.now() - t0);
          mc.port2.postMessage(0);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  };
}

async function newPage({ theme = 'light', width = WIDTH, goRefused = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: HEIGHT } });
  await ctx.addInitScript((t) => { window.__speedTheme = t; }, theme);
  await ctx.addInitScript(initPage);
  // GET only, but for the demo's own fakes: Go's POST is refused late (rule 4), any other is aborted.
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.continue();
    if (goRefused && /\/api\/job\/[^/]+\/gate/.test(req.url())) {
      await sleep(1200);
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'The speed check refused this Go.', code: 'speed-check' }) }).catch(() => {});
    }
    return route.abort();
  });
  // The hidden themes are unlocked for this page only (as themeSweep.mjs does).
  await ctx.route(/\/api\/play(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    try { const res = await route.fetch(); const json = await res.json(); json.unlocks = { ...(json.unlocks ?? {}), crt: true, gold: true }; await route.fulfill({ response: res, json }); } catch { await route.continue().catch(() => {}); }
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  return { ctx, page, errors };
}

/** Times a click: from its event to the painted frame that shows `kind`. */
async function timed(page, kind, arg, click) {
  await page.evaluate(([k, a]) => window.__arm(k, a), [kind, arg]);
  await click();
  return page.evaluate(() => window.__wait);
}

const jobLink = (page) => page.locator(`a.job-card-title[href="#/job/${SLUG}"]`).first();
async function jobsLoaded(page) {
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await jobLink(page).waitFor();
  await page.waitForTimeout(500);
}
async function openJob(page) {
  await jobsLoaded(page);
  const ms = await timed(page, 'open', TITLE, () => jobLink(page).click());
  await page.waitForTimeout(1200);
  return ms;
}
const readerTitle = (page) => page.evaluate(() => document.querySelector('.jp2-rv-title')?.textContent ?? '');

// ---------- the checks ----------

async function rule1() {
  console.log('Rule 1: opening the job from Jobs (header, Your move, steps)');
  const cold = [];
  const again = [];
  const pageTimes = [];
  for (let i = 0; i < 5; i++) {
    const { ctx, page } = await newPage();
    cold.push(await openJob(page));
    for (let j = 0; j < 2; j++) {
      await page.getByRole('link', { name: 'Jobs', exact: true }).click();
      await jobLink(page).waitFor();
      await page.waitForTimeout(600);
      again.push(await timed(page, 'open', TITLE, () => jobLink(page).click()));
      await page.waitForTimeout(800);
    }
    pageTimes.push(...await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\/api\/job\/[^/]+\/page/.test(e.name)).map((e) => e.responseEnd - e.startTime)));
    await ctx.close();
  }
  const all = [...cold, ...again];
  record(1, 'open from a fresh Jobs', stats(cold), '150 ms each', Math.max(...cold) <= 150);
  record(1, 'open again from Jobs', stats(again), '150 ms each', Math.max(...again) <= 150);
  return { all, pageTimes };
}

async function rule2() {
  console.log(`Rule 2: picks (${PICKS} of each)`);
  const { ctx, page } = await newPage();
  await openJob(page);
  const out = {};
  // Steps: each pick a different step than the last.
  const steps = page.locator('.jp2-st-row');
  const n = await steps.count();
  out.step = [];
  const slow = [];
  const note = (kind, label, ms, i) => { if (ms >= 100) slow.push(`${kind} ${label} (pick ${i + 1}) ${round(ms)} ms`); return ms; };
  for (let i = 0; i < PICKS; i++) {
    const at = (i + 1) % n;
    const was = await readerTitle(page);
    const label = (await steps.nth(at).locator('.jp2-st-name').textContent()).trim();
    out.step.push(note('step', label, await timed(page, 'reader', was, () => steps.nth(at).click()), i));
    await page.waitForTimeout(150);
  }
  // Documents: the open step's outputs and the Ticket and goal and Decisions rows, in turn.
  await steps.nth(n - 2).click(); // Review, the open step: its outputs listed under it
  await page.waitForTimeout(400);
  // (Each pick shows something other than what the reader shows: the Review step itself shows its first output.)
  const docs = [
    () => page.locator('.jp2-jr', { hasText: 'Ticket and goal' }).first(),
    () => page.locator('.jp2-st-out').nth(0),
    () => page.locator('.jp2-jr', { hasText: 'Decisions' }).first(),
    () => page.locator('.jp2-st-out').nth(1),
  ];
  out.document = [];
  for (let i = 0; i < PICKS; i++) {
    const was = await readerTitle(page);
    const ms = await timed(page, 'reader', was, () => docs[i % docs.length]().click());
    out.document.push(note('document', await readerTitle(page), ms, i));
    await page.waitForTimeout(150);
  }
  // The conversation, from a document each time.
  out.conversation = [];
  const convoRow = () => page.locator('.jp2-jr', { hasText: 'Conversation' }).first();
  for (let i = 0; i < PICKS; i++) {
    await docs[i % 2 === 0 ? 0 : 2]().click();
    await page.waitForTimeout(250);
    out.conversation.push(note('conversation', '', await timed(page, 'conversation', null, () => convoRow().click()), i));
    await page.waitForTimeout(150);
  }
  // Messages: replies spread over the whole conversation, each opened in place (then closed again).
  await page.waitForTimeout(500);
  const ids = await page.evaluate(() => [...document.querySelectorAll('li.jp2-cv-item.is-reply')].filter((li) => li.querySelector('.jp2-cv-line')?.getAttribute('aria-expanded') !== 'true').map((li) => li.dataset.id));
  const chosen = Array.from({ length: Math.min(PICKS, ids.length) }, (_, i) => ids[Math.floor((i * ids.length) / Math.min(PICKS, ids.length))]);
  out.message = [];
  for (const id of chosen) {
    const line = page.locator(`li.jp2-cv-item[data-id="${id}"] > .jp2-cv-line`);
    await line.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    out.message.push(note('message', id, await timed(page, 'line', id, () => line.click()), out.message.length));
    await page.waitForTimeout(150);
    await line.click();
    await page.waitForTimeout(100);
  }
  await ctx.close();
  for (const kind of ['step', 'document', 'message', 'conversation']) {
    const xs = out[kind];
    const mine = slow.filter((x) => x.startsWith(kind));
    record(2, `${kind} pick`, stats(xs), 'p95 100 ms', xs.length >= Math.min(PICKS, 10) && pct(xs, 0.95) < 100, mine.length ? `100 ms or more: ${mine.slice(0, 6).join(', ')}` : '');
  }
  // The rule's second sentence: no pick waits on a slow server answer, so not one pick of any kind is 100 ms or more.
  record(2, 'picks of 100 ms or more, of any kind', String(slow.length), '0 (no pick waits on a slow server answer)', slow.length === 0, slow.slice(0, 6).join(', '));
  return out;
}

async function rule3() {
  console.log(`Rule 3: ${SHIFT_SECONDS} s with a message arriving every 10 s`);
  const { ctx, page } = await newPage();
  await openJob(page);
  await page.locator('.jp2-jr', { hasText: 'Conversation' }).first().click();
  await page.waitForTimeout(1500);
  // Read half way down the conversation.
  await page.evaluate(() => { const b = document.querySelector('.jp2-rv-body[data-view="conversation"]'); if (b) b.scrollTop = (b.scrollHeight - b.clientHeight) / 2; });
  await page.mouse.move(5, HEIGHT - 5); // nothing under the pointer, and no input from here on
  await page.waitForTimeout(2000);
  const anchor = await page.evaluate(() => {
    const b = document.querySelector('.jp2-rv-body[data-view="conversation"]');
    const mid = b.getBoundingClientRect().top + b.clientHeight / 2;
    const li = [...b.querySelectorAll('.jp2-cv-line')].find((l) => { const r = l.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid; }) ?? [...b.querySelectorAll('.jp2-cv-line')].find((l) => l.getBoundingClientRect().top >= mid);
    window.__anchor = li;
    return li?.dataset.cvKey ?? null;
  });
  const t0 = await page.evaluate(() => performance.now());
  const countOf = () => page.evaluate(() => {
    const row = [...document.querySelectorAll('.jp2-jr')].find((r) => /^\s*Conversation/.test(r.textContent));
    const m = /(\d+)/.exec(row?.querySelector('.jp2-jr-more')?.textContent ?? '');
    return m ? Number(m[1]) : NaN;
  });
  const before = await countOf();
  const anchorTop = () => page.evaluate(() => window.__anchor?.getBoundingClientRect().top ?? null);
  const top0 = await anchorTop();
  let moved = 0;
  const talks = Math.floor(SHIFT_SECONDS / 10);
  for (let i = 0; i < talks; i++) {
    await hooks(`/talk?slug=${SLUG}`);
    await sleep(10_000);
    const top = await anchorTop();
    if (top !== null && top0 !== null) moved = Math.max(moved, Math.abs(top - top0));
  }
  const after = await countOf();
  const shifts = await page.evaluate((t) => window.__shifts.filter((s) => s.t >= t), t0);
  await ctx.close();
  const total = shifts.reduce((a, s) => a + s.value, 0);
  const arrived = Number.isFinite(after - before) ? after - before : 'unknown';
  const where = [...new Set(shifts.flatMap((s) => s.sources))].slice(0, 6).join(', ');
  record(3, 'layout shifts not caused by input', `${shifts.length} (score ${total.toFixed(5)})`, '0', shifts.length === 0, `${arrived} of ${talks} messages arrived${where ? `; moved: ${where}` : ''}`);
  record(3, 'the line he reads moved', `${round(moved)} px`, '0 px', moved < 0.5 && arrived !== 0, `anchor ${anchor}`);
  return { shifts, moved, arrived, talks };
}

async function rule4() {
  console.log('Rule 4: Go shows Sent at once; a refused Go gives his picks back');
  const { ctx, page } = await newPage({ goRefused: true });
  await openJob(page);
  const ym = page.locator('.jp2-ym');
  // His own picks: the second option of the first question (not the recommended one).
  await ym.locator('input[data-jp-opt]').nth(1).check();
  await page.waitForTimeout(300);
  const picks = () => page.evaluate(() => [...document.querySelectorAll('.jp2-ym input[data-jp-opt]')].map((i) => `${i.dataset.q}:${i.value}:${i.checked ? 1 : 0}`).join(' '));
  const mine = await picks();
  const times = [];
  let back = 0;
  const trials = 10;
  for (let i = 0; i < trials; i++) {
    const go = ym.getByRole('button', { name: /^Go\b/ });
    times.push(await timed(page, 'sent', null, () => go.click()));
    await page.locator('.jp2-ym-sent').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
    await ym.locator('input[data-jp-opt]').first().waitFor();
    await page.waitForTimeout(300);
    if ((await picks()) === mine) back++;
  }
  await ctx.close();
  record(4, '`Sent` after Go', stats(times), '50 ms each', Math.max(...times) <= 50);
  record(4, 'his picks back after a refused Go', `${back} of ${trials}`, `${trials} of ${trials}`, back === trials);
  return { times, back };
}

async function rule5() {
  console.log(`Rule 5: idle ${IDLE_SECONDS} s, then one message arriving`);
  const { ctx, page } = await newPage();
  const requests = [];
  page.on('request', (r) => requests.push({ at: Date.now(), url: r.url() }));
  await openJob(page);
  await page.locator('.jp2-jr', { hasText: 'Conversation' }).first().click();
  await page.mouse.move(5, HEIGHT - 5);
  await page.waitForTimeout(5000);
  // Every commit and every change to the page from here on, each put down to where it drew: the job
  // page (inside .jp2) or the app around it (the top bar, the shell).
  await page.evaluate(() => {
    window.__rc.detail = true; window.__rc.rendered = [];
    window.__muts = [];
    window.__mo = new MutationObserver((list) => { for (const m of list) window.__muts.push(m.target instanceof Element ? m.target : m.target.parentElement); });
    window.__mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    window.__zones = (allowedSel) => {
      const jp = document.querySelector('.jp2');
      const allowed = allowedSel();
      const inJob = (el) => el instanceof Element && jp && jp.contains(el);
      const ok = (el) => el instanceof Element && allowed.some((a) => a === el || a.contains(el));
      const describe = (el) => (el instanceof Element ? `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''}` : String(el));
      const commits = window.__rc.rendered;
      const comps = commits.flat();
      const name = (c) => `${c.name}@${c.host}`;
      const out = {
        commits: commits.length,
        jobCommits: commits.filter((list) => list.some((c) => inJob(c.el))).length,
        components: comps.length,
        jobOther: [...new Set(comps.filter((c) => inJob(c.el) && !ok(c.el)).map(name))],
        shell: [...new Set(comps.filter((c) => !inJob(c.el)).map(name))],
        jobMuts: [...new Set(window.__muts.filter((el) => inJob(el) && !ok(el)).map(describe))],
        shellMuts: [...new Set(window.__muts.filter((el) => el && !inJob(el)).map(describe))],
        okMuts: window.__muts.filter((el) => ok(el)).length,
      };
      window.__rc.rendered = []; window.__muts = [];
      return out;
    };
  });
  const from = Date.now();
  await page.waitForTimeout(IDLE_SECONDS * 1000);
  const idle = await page.evaluate(() => window.__zones(() => []));
  const asked = requests.filter((r) => r.at >= from && !/\/api\/events/.test(r.url)).map((r) => `${new URL(r.url).pathname}`);
  const byPath = Object.entries(asked.reduce((m, p) => ({ ...m, [p]: (m[p] ?? 0) + 1 }), {})).map(([p, n]) => `${p} ×${n}`).join(', ');
  const few = (xs, n = 10) => `${xs.slice(0, n).join(', ')}${xs.length > n ? ` (+${xs.length - n})` : ''}`;
  record(5, `React commits in ${IDLE_SECONDS} s idle`, String(idle.commits), '0', idle.commits === 0,
    idle.commits ? `${idle.jobCommits} drew in the job page${idle.jobOther.length ? ` (${few(idle.jobOther, 6)})` : ''}; app around it: ${few(idle.shell, 8)}` : '');
  record(5, `React commits in ${IDLE_SECONDS} s idle that drew in the job page`, String(idle.jobCommits), '0', idle.jobCommits === 0, idle.jobMuts.length ? `changed: ${few(idle.jobMuts, 6)}` : '');
  record(5, `requests in ${IDLE_SECONDS} s idle (but the event stream)`, String(asked.length), '0', asked.length === 0, byPath);

  // One message arriving: only the conversation's count (its row, and the reader's "n items") and its lines may redraw.
  const lines0 = await page.evaluate(() => document.querySelectorAll('[data-view="conversation"] .jp2-cv-item').length);
  await page.evaluate(() => window.__zones(() => [])); // a clean start
  await hooks(`/talk?slug=${SLUG}`);
  const landed = await page.waitForFunction((n) => document.querySelectorAll('[data-view="conversation"] .jp2-cv-item').length > n, lines0, { timeout: 15_000 }).then(() => true, () => false);
  await page.waitForTimeout(2500);
  const seen = await page.evaluate(() => window.__zones(() => [
    [...document.querySelectorAll('.jp2-jr')].find((r) => /^\s*Conversation/.test(r.textContent)),
    document.querySelector('.jp2-rv-body[data-view="conversation"]'),
    document.querySelector('.jp2-cv-tools'),
    document.querySelector('[data-view="conversation"]') ? document.querySelector('.jp2-rv-meta') : null,
  ].filter(Boolean)));
  await ctx.close();
  const arrived = landed ? `arrived; ${seen.commits} commits, ${seen.components} components drawn, ${seen.okMuts} changes in the conversation's count and lines` : 'DID NOT ARRIVE';
  record(5, 'one arriving message: job page parts drawn other than the conversation count and lines', String(seen.jobOther.length), '0', landed && seen.jobOther.length === 0,
    `${arrived}${seen.jobOther.length ? `; drawn: ${few(seen.jobOther)}` : ''}${seen.jobMuts.length ? `; changed: ${few(seen.jobMuts, 6)}` : ''}`);
  record(5, 'one arriving message: app parts around the job page drawn', String(seen.shell.length), '0', landed && seen.shell.length === 0,
    `${seen.shell.length ? few(seen.shell) : ''}${seen.shellMuts.length ? `; changed: ${few(seen.shellMuts, 6)}` : ''}`);
  return { idle, asked, seen };
}

async function rule6() {
  console.log('Rule 6: the page request, and what a page open starts on the server');
  // What the server does while the page opens: the first open since the demo started (its build is
  // allowed to run inline: the plan's accepted cold case), an open again, and an open after 20 s on
  // Jobs while the demo's other jobs change.
  const { ctx, page } = await newPage();
  const scenes = [];
  const openWatched = async (name, before) => {
    await jobsLoaded(page);
    if (before) await before();
    await hooks('/io/reset');
    await jobLink(page).click();
    await page.locator('.jp2-st-row').first().waitFor();
    await page.waitForTimeout(2500);
    const io = await hooks('/io');
    const say = ([k, v]) => `${k}: ${v.spawns.length ? `${v.spawns.length} programs (${[...new Set(v.spawns)].slice(0, 3).join(', ')})` : ''}${v.logReads.length ? ` ${v.logReads.length} log reads` : ''}`.trim();
    const busy = Object.entries(io.requests).filter(([, v]) => v.spawns.length || v.logReads.length);
    // Before the answer: the page waited on it. After: a rebuild behind the answer (the cache's design), told apart.
    // The page's own requests (its job's routes) are the open; any other request in the window (the app
    // shell's snapshot after a demo job changed, the demo's own sends) is told apart, and rule 5 counts it.
    const own = ([k]) => k.includes(`/api/job/${SLUG}/`);
    const bad = busy.filter((e) => own(e) && !e[0].endsWith('(after its answer)')).map(say);
    const behind = busy.filter((e) => own(e) && e[0].endsWith('(after its answer)')).map(say);
    const other = busy.filter((e) => !own(e)).map(say);
    scenes.push({ name, bad, behind, other, keys: Object.keys(io.requests) });
  };
  await openWatched('first open since the demo started');
  await openWatched('open again');
  await openWatched('open after 20 s on Jobs', () => page.waitForTimeout(20_000));
  await ctx.close();
  const [first, ...warm] = scenes;
  const info = (s) => `${s.bad.length ? s.bad.join('; ') : 'nothing before the answers'}${s.behind.length ? `; behind the answer: ${s.behind.join('; ')}` : ''}${s.other.length ? `; not the page's own: ${s.other.join('; ')}` : ''}`;
  console.log(`  (info) ${first.name}: ${info(first)} (the plan's accepted cold case)`);
  for (const s of warm) {
    record(6, `${s.name}: requests that started a program or read a log`, String(s.bad.length), '0', s.bad.length === 0, s.bad.join('; ').slice(0, 400));
    if (s.behind.length || s.other.length) console.log(`  (info) ${s.name}: ${info(s)}`);
  }

  // The request itself, from a warm cache: the whole payload and the `same` answer.
  const t = async (p) => { const t0 = performance.now(); const res = await fetch(`${ORIGIN}${p}`); await res.text(); return { ms: performance.now() - t0, res }; };
  const v = (await (await fetch(`${ORIGIN}/api/job/${SLUG}/page`)).json()).v;
  const whole = [];
  const same = [];
  for (let i = 0; i < 50; i++) whole.push((await t(`/api/job/${SLUG}/page`)).ms);
  for (let i = 0; i < 50; i++) same.push((await t(`/api/job/${SLUG}/page?v=${v}`)).ms);
  record(6, '`page` (whole payload), warm', stats(whole), 'p95 100 ms', pct(whole, 0.95) < 100);
  record(6, '`page?v=` (same), warm', stats(same), 'p95 100 ms', pct(same, 0.95) < 100);
  return { scenes, whole, same };
}

async function rule7() {
  console.log('Rule 7: motion over 120 ms');
  const { found, ruleCount, files } = staticMotion();
  const over = found.filter((f) => f.ms > 120);
  record(7, `CSS motion (${files} job page sheets + theme rules naming .jp2: ${ruleCount} rules, ${found.length} declarations)`, `longest ${Math.max(0, ...found.map((f) => f.ms))} ms`, '120 ms', over.length === 0,
    over.map((f) => `${f.where} ${f.prop} ${f.ms} ms`).join('; '));
  // In the page, as each theme draws it (shared controls inside the page included), at 1512 and 900 px.
  const themeSrc = readFileSync(path.join(HERE, '../src/theme/theme.ts'), 'utf8');
  const list = themeSrc.slice(themeSrc.indexOf('export const THEMES'), themeSrc.indexOf('];', themeSrc.indexOf('export const THEMES')));
  const themes = list.split('\n').map((l) => /\{\s*id:\s*'([^']+)'/.exec(l)?.[1]).filter(Boolean);
  const worst = [];
  for (const theme of themes) {
    for (const width of [1512, 900]) {
      const { ctx, page } = await newPage({ theme, width });
      await jobsLoaded(page);
      await jobLink(page).click();
      await page.locator('.jp2-st-row').first().waitFor();
      await page.waitForTimeout(800);
      const found2 = await page.evaluate(() => {
        const ms = (list) => list.split(',').map((x) => { const v = parseFloat(x); return /ms$/.test(x.trim()) ? v : v * 1000; });
        const out = [];
        for (const el of [document.querySelector('.jp2'), ...document.querySelectorAll('.jp2 *')]) {
          if (!el) continue;
          const s = getComputedStyle(el);
          const td = ms(s.transitionDuration), tl = ms(s.transitionDelay);
          const tr = Math.max(...td.map((d, i) => d + (tl[i % tl.length] ?? 0)));
          const an = s.animationName !== 'none' ? Math.max(...ms(s.animationDuration).map((d, i) => d + (ms(s.animationDelay)[i] ?? 0))) : 0;
          const m = Math.max(tr, an);
          if (m > 120) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')} ${s.transitionProperty !== 'all' || tr > 120 ? `transition ${s.transitionProperty} ${s.transitionDuration}/${s.transitionDelay}` : ''}${an > 120 ? ` animation ${s.animationName} ${s.animationDuration}` : ''} = ${m} ms`);
        }
        return [...new Set(out)];
      });
      if (found2.length) worst.push(`${theme} ${width}px: ${found2.slice(0, 4).join('; ')}`);
      await ctx.close();
    }
  }
  record(7, `motion as drawn in the page (${themes.length} themes × 1512, 900 px)`, `${worst.length} theme/width pairs over`, '0', worst.length === 0, worst.slice(0, 8).join(' | '));
  return { found, worst };
}

// ---------- run ----------

console.log(`Speed checks (${LABEL}) on ${BASE}, ${SLUG}, ${WIDTH}×${HEIGHT}`);
await hooks('/io').catch((err) => { console.error(`The demo's speed hooks are not there (${HOOKS}): start the demo as this file's top says. ${err.message}`); process.exit(2); });
const t0 = Date.now();
let r1 = null;
// Rule 6 first: its first open must be the first since the demo started.
if (want(6)) await rule6().catch((err) => record(6, 'ran', `failed: ${err.message.split('\n')[0]}`, '-', false));
if (want(1)) r1 = await rule1().catch((err) => { record(1, 'ran', `failed: ${err.message.split('\n')[0]}`, '-', false); return null; });
if (want(1) && want(6) && r1?.pageTimes?.length) record(6, '`page` as the browser timed it in rule 1', stats(r1.pageTimes), 'p95 100 ms', pct(r1.pageTimes, 0.95) < 100);
if (want(2)) await rule2().catch((err) => record(2, 'ran', `failed: ${err.message.split('\n')[0]}`, '-', false));
if (want(4)) await rule4().catch((err) => record(4, 'ran', `failed: ${err.message.split('\n')[0]}`, '-', false));
if (want(5)) await rule5().catch((err) => record(5, 'ran', `failed: ${err.message.split('\n')[0]}`, '-', false));
if (want(3)) await rule3().catch((err) => record(3, 'ran', `failed: ${err.message.split('\n')[0]}`, '-', false));
if (want(7)) await rule7().catch((err) => record(7, 'ran', `failed: ${err.message.split('\n')[0]}`, '-', false));
await browser.close();

console.log(`\nSpeed table (${LABEL}, ${Math.round((Date.now() - t0) / 1000)} s):`);
console.log('| rule | measure | number | limit | result |');
console.log('|---|---|---|---|---|');
for (const r of results) console.log(`| ${r.rule} | ${r.what} | ${r.number} | ${r.limit} | ${r.pass ? 'pass' : 'MISS'}${r.note ? ` (${r.note.replace(/\|/g, '/')})` : ''} |`);
const missed = results.filter((r) => !r.pass);
console.log(missed.length ? `\n${missed.length} of ${results.length} measures missed.` : `\nAll ${results.length} measures pass.`);
process.exit(missed.length ? 1 : 0);
