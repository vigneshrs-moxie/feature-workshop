// Nothing jumps when something folds, hides or opens (packet R, rule 2), checked in a real browser.
// A landmark's place is taken inside the scroll area it scrolls with (the job page's work column and
// conversation scroll by themselves), so a scroll is never a move but a move inside it still is.
//
// On Jobs, the Desk, Telemetry and Settings → Look it presses every fold, hide and open control on
// the page (a "Details" or "More" row, a <summary>, any button with aria-expanded, a graph's Fold and
// Hide), once to change it and once to put it back. Each time, everything above the control's own
// item and everything in another column must stay exactly where it was; only the item itself and
// what is under it in its own column may move.
//
// Run it against a running app (the demo is best):
//   PORT=4493 STARBASE_DEMO=1 node dashboard/demo/run-demo.js      # in one terminal
//   node web/e2e/noJump.mjs                                         # in another
// On a phone (under 600 px) the graphs start folded, so each is unfolded first and folded back.
// Environment: BASE (default http://127.0.0.1:4493/next/), WIDTHS (comma list, default
// 1280,1512,1728; add 390 for a phone), WIDTH (one width only; overrides WIDTHS), THEME (light),
// PLAYWRIGHT (the path to playwright's index.mjs, when it isn't installed here).
// It reports each width, then exits 1 if anything moved at any width (listing what), or 0.
//
// The job page (jobpage/JobPage2.tsx) at its addresses: the made-up long job
// (orbit-905-crew-schedule-export) as it opens, at its Review step and with the conversation, the
// ticket and goal, the decisions, the details, the plan, Changes, Checks and Findings in the reader;
// nightly-export (working) and customer-merge. It presses the page's folds (the ask's More, the
// conversation's lines and "n small events", the Findings and Checks folds; never Start the app,
// never a menu), and the same rule holds: only the item and what is under it in its own column may
// move. From 1100 px (two panes) each step is picked and then the step that was open is picked
// again: the header, Your move, the steps' list, every step row above the change, the reader's title
// row and the message box must stay where they were. Under 1100 px a step or a row opens the reader
// over the pane (or the phone's own screen), so only the folds are pressed. It refuses every request
// that is not a GET.
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:4493/next/';
const WIDTHS = (process.env.WIDTH || process.env.WIDTHS || '1280,1512,1728')
  .split(',').map((w) => Number(w.trim())).filter((w) => w > 0);
const THEME = process.env.THEME || 'light';
/** The demo's made-up long job (the job page's fixture job). */
const LONG_JOB = 'orbit-905-crew-schedule-export';
const SCREENS = [
  ['Jobs', '#/'],
  ['Job: long job', `#/job/${LONG_JOB}`],
  ['Job: long job at Review', `#/job/${LONG_JOB}/stage/review`],
  ['Job: conversation', `#/job/${LONG_JOB}/conversation`],
  ['Job: ticket and goal', `#/job/${LONG_JOB}/overview`],
  ['Job: decisions', `#/job/${LONG_JOB}/read/decisions/decisions`],
  ['Job: details', `#/job/${LONG_JOB}/read/details/details`],
  ['Job: the plan', `#/job/${LONG_JOB}/read/doc/implementation-plan.md`],
  ['Job: Changes', `#/job/${LONG_JOB}/read/changes/changes`],
  ['Job: Checks', `#/job/${LONG_JOB}/read/checks/checks`],
  ['Job: Findings', `#/job/${LONG_JOB}/read/findings/findings`],
  ['Job: nightly-export', '#/job/nightly-export'],
  ['Job: customer-merge', '#/job/customer-merge'],
  ['Desk', '#/desk'],
  ['Telemetry', '#/telemetry'],
  ['Settings', '#/settings/look'],
];
/** A job page's screen: its own folds, items and landmarks (below); every other page has the general ones. */
const isJob = (hash) => hash.startsWith('#/job/');
// The job page's folds only: its step rows and job rows open things (handled below or not at all),
// and Start the app (aria-expanded too) would start something.
const JOB_TOGGLES = '.jp2-card-more, .jp2-cv-sm-h, .jp2-cv-line, .jp2-fd-fold, .jp2-fd-line, .jp2-fd-rest, main details > summary';
const PAGE_TOGGLES = '.more-head, details > summary, button[aria-expanded]:not([aria-haspopup]):not([role="combobox"]), [data-fold], [data-hide]';
const JOB_ITEM = '.jp2-card, .jp2-step, .jp2-cv-item, .jp2-cv-group, details, li, section';
const PAGE_ITEM = '.more, details, .tele-card, .hidden-slot, .fold, .job-card, .thread, li, section';
// On the job page, landmarks whose number a fold never changes (a changed number skips the compare).
const JOB_LANDMARKS = '.jp2-head, .jp2-ym, .jp2-card, .jp2-st, .jp2-st-row, .jp2-jrs, .jp2-jr, .jp2-mbw, .jp2-rv-top, .jp2-reader, .jp2-cv-gh, .jp2-cv-line, .jp2-fd-line, .jp2-fd-fold';
const PAGE_LANDMARKS = '.page-title, .next-bar, .lane-head, .job-card, .more-head, details > summary, .tele-card, .hidden-slot, .desk-console, .job-convo, .settings-rail, .look-heading, .btn';
/** On a job page, what a step's pick must leave where it was. */
const PICK_STAYS = [
  ['the header', '.jp2-head'],
  ['Your move', '.jp2-ym'],
  ['the steps\' list', '.jp2-st'],
  ['the reader\'s title row', '.jp2-rv-top'],
  ['the message box', '.jp2-mbw'],
];
const STEP_TABS = '.jp2-st-row';
/** The job page's two panes start here; under it a step pick opens another screen. */
const TWO_PANES_PX = 1100;

/**
 * True once the page has nothing left saying it is loading (a status line starting "Loading" or
 * "Reading": the job's overview, who worked on the open step, its commits). Moving between job
 * pages only changes the address's hash, so there is no network idle to wait for, and a busy
 * server answers after any fixed wait: without this a page was checked half-loaded (no overview
 * fold yet) and its checks were silently fewer.
 */
async function settled(page, ms = 10_000) {
  return page.waitForFunction(() => ![...document.querySelectorAll('main [role="status"]')]
    .some((e) => e.checkVisibility() && /^(Loading|Reading)\b/.test((e.textContent || '').trim())), null, { timeout: ms })
    .then(() => true, () => false);
}

const browser = await chromium.launch();

async function runAt(WIDTH) {
  const problems = [];
  let pressed = 0;
  let skipped = 0;
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 1000 } });
  await page.addInitScript(([t]) => {
    try {
      localStorage.setItem('workshop.theme', t);
      localStorage.setItem('gc.guide.seen', JSON.stringify(['jobs', 'desk', 'stage', 'job', 'job-page-2', 'inbox', 'telemetry', 'stack', 'stacks', 'review', 'review-round']));
    } catch { /* storage off */ }
  }, [THEME]);
  // Read only: a fold never sends, and nothing pressed here may.
  await page.route('**/*', (route) => (route.request().method() === 'GET' ? route.continue() : route.abort()));
  // A landmark's place, measured so that a scroll is never a move: inside the scroll area it scrolls
  // with (the job page's work column, the conversation's list), its place in that area's content;
  // outside any, from the page's own top-left (.page-inner on the older pages, else the body).
  await page.addInitScript(() => {
    window.__spot = (el) => {
      let c = el.parentElement;
      while (c && c !== document.body && c !== document.documentElement) {
        const s = getComputedStyle(c);
        if (/(auto|scroll)/.test(`${s.overflowY} ${s.overflowX}`)) break;
        c = c.parentElement;
      }
      const b = el.getBoundingClientRect();
      if (!c || c === document.body || c === document.documentElement) {
        const o = (document.querySelector('.page-inner') ?? document.body).getBoundingClientRect();
        return { x: b.left - o.left, y: b.top - o.top };
      }
      const cr = c.getBoundingClientRect();
      return { x: b.left - cr.left + c.scrollLeft, y: b.top - cr.top + c.scrollTop };
    };
  });

  for (const [name, hash] of SCREENS) {
    const onJob = isJob(hash);
    const TOGGLES = onJob ? JOB_TOGGLES : PAGE_TOGGLES;
    const ITEM = onJob ? JOB_ITEM : PAGE_ITEM;
    const LANDMARKS = onJob ? JOB_LANDMARKS : PAGE_LANDMARKS;
    // The job page is opened from Jobs each time: while it stays mounted, an address change under 1100 px
    // leaves the reader closed, so a screen reached by its address alone would be checked unseen.
    if (onJob) await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
    await page.goto(BASE + hash, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    if (!(await settled(page))) problems.push(`${name}: still loading after 10 s`);
    const count = await page.locator(TOGGLES).count();
    for (let i = 0; i < Math.min(count, 40); i++) {
      const toggle = page.locator(TOGGLES).nth(i);
      if (!(await toggle.isVisible().catch(() => false))) continue;
      for (const round of ['change', 'put back']) {
        // Every landmark's place, and which ones must stay put: above the item, or in another column.
        const before = await toggle.evaluate((t, [ITEM, LANDMARKS]) => {
          const o0 = (document.querySelector('.page-inner') ?? document.body).getBoundingClientRect();
          const ib = (t.parentElement?.closest(ITEM) ?? t).getBoundingClientRect();
          const item = { left: ib.left - o0.left, right: ib.right - o0.left, top: ib.top - o0.top };
          const own = t.parentElement?.closest(ITEM);
          // Which landmarks must stay: judged on screen, as he sees them now. Where each is: __spot, so
          // a scroll (Playwright's own, to reach the control, or a clamp after a fold) never counts.
          const o = (document.querySelector('.page-inner') ?? document.body).getBoundingClientRect();
          return [...(document.querySelector(".page-inner") ?? document).querySelectorAll(LANDMARKS)].map((el, n) => {
            const b = el.getBoundingClientRect();
            const r = { left: b.left - o.left, right: b.right - o.left, top: b.top - o.top, bottom: b.bottom - o.top, width: b.width };
            const above = r.bottom <= item.top + 0.5;
            const aside = r.right <= item.left + 0.5 || r.left >= item.right - 0.5;
            const inside = own ? own.contains(el) || el.contains(own) : false;
            const at = window.__spot(el);
            return { n, x: at.x, y: at.y, keep: (above || aside) && !inside && r.width > 0, what: `${el.className || el.tagName}`.toString().slice(0, 60) };
          });
        }, [ITEM, LANDMARKS]);
        await toggle.click({ trial: false }).catch(() => {});
        await page.waitForTimeout(260);
        const after = await page.evaluate((LANDMARKS) => [...(document.querySelector('.page-inner') ?? document).querySelectorAll(LANDMARKS)].map((el) => window.__spot(el)), LANDMARKS);
        if (after.length !== before.length) skipped += 1;
        else {
          for (const b of before) {
            const a = after[b.n];
            if (b.keep && a && (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5)) {
              problems.push(`${name}: pressing control ${i} (${round}) moved ${b.what} from ${Math.round(b.x)},${Math.round(b.y)} to ${Math.round(a.x)},${Math.round(a.y)}`);
            }
          }
        }
        pressed += 1;
        // (Not on the job page: there Escape leaves the reader under 1100 px, and its folds open no menu.)
        if (!onJob) await page.keyboard.press('Escape').catch(() => {});
      }
    }
    // A job page: pick each step, then pick back the one that was open (two panes only).
    const tabs = page.locator(STEP_TABS);
    const steps = onJob ? await tabs.count() : 0;
    if (steps && WIDTH >= TWO_PANES_PX && await tabs.first().isVisible().catch(() => false)) {
      const places = () => page.evaluate((STAYS) => {
        const o = (document.querySelector('.page-inner') ?? document.body).getBoundingClientRect();
        return STAYS.map(([what, sel]) => {
          const el = document.querySelector(sel);
          if (!el || !el.getClientRects().length) return { what, x: null, y: null };
          const r = el.getBoundingClientRect();
          return { what, x: r.left - o.left, y: r.top - o.top };
        });
      }, PICK_STAYS);
      /** Which step is open now: its place in the row. */
      const openAt = async () => (await tabs.evaluateAll((ts) => ts.map((t) => t.getAttribute('aria-selected') === 'true' || t.getAttribute('aria-expanded') === 'true'))).indexOf(true);
      /** Every step row's place on screen. */
      const rowsAt = () => tabs.evaluateAll((ts) => ts.map((t) => { const r = t.getBoundingClientRect(); return { x: r.left, y: r.top, name: (t.querySelector('.jp2-st-name')?.textContent ?? '').trim() }; }));
      // From the top of the work column (the loop above may have left it scrolled). The page never
      // scrolls on a pick; each tab is brought into view before its place is taken, so the click
      // itself scrolls nothing, and what is measured is what he sees on screen.
      await page.evaluate(() => { const w = document.querySelector('.jp2-lscroll'); if (w) w.scrollTop = 0; });
      for (let i = 0; i < steps; i++) {
        const was = await openAt();
        if (i === was) continue;
        for (const [round, at] of [['pick', i], ['pick back', was]]) {
          if (at < 0) continue;
          await tabs.nth(at).scrollIntoViewIfNeeded().catch(() => {});
          const before = await places();
          const rowsBefore = await rowsAt();
          const openBefore = await openAt();
          await tabs.nth(at).click().catch(() => {});
          await page.waitForTimeout(400);
          await settled(page); // the new step's view is in: "after" is the layout he ends up with
          const after = await places();
          // Every step row down to the higher of the two that changed stays where it was.
          const rowsAfter = await rowsAt();
          const upTo = Math.min(at, openBefore < 0 ? at : openBefore);
          for (let r = 0; r <= upTo && r < rowsBefore.length; r++) {
            const b = rowsBefore[r];
            const a = rowsAfter[r];
            if (a && (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5)) problems.push(`${name}: ${round} ${rowsBefore[at]?.name ?? at} moved the step row ${b.name} from ${Math.round(b.x)},${Math.round(b.y)} to ${Math.round(a.x)},${Math.round(a.y)}`);
          }
          for (const b of before) {
            const a = after.find((p) => p.what === b.what);
            if (b.x === null || !a || a.x === null) continue;
            if (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5) {
              const step = rowsBefore[at]?.name || `step ${at}`;
              problems.push(`${name}: ${round} ${step} moved ${b.what} from ${Math.round(b.x)},${Math.round(b.y)} to ${Math.round(a.x)},${Math.round(a.y)}`);
            }
          }
          pressed += 1;
        }
      }
    }
  }
  // Telemetry's graph menus: Fold then Unfold, and Hide then Show, on each card; nothing in the other
  // columns or above the card may move.
  await page.goto(BASE + '#/telemetry', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const where = () => page.evaluate(() => {
    const o = document.querySelector('.page-inner').getBoundingClientRect();
    return [...document.querySelectorAll('.tele-card, .hidden-slot, .tele-dials, .tele-who')].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute('data-graph') || el.getAttribute('aria-label') || el.className, x: r.left - o.left, y: r.top - o.top, r: r.right - o.left, b: r.bottom - o.top };
    });
  });
  const cards = await page.locator('.tele-card').count();
  for (let i = 0; i < cards; i++) {
    for (const pair of [['Fold', 'Unfold'], ['Hide', null]]) {
      const card = page.locator('.tele-graph-col > *').nth(i);
      const id = await card.getAttribute('data-graph');
      if (!id) continue;
      // On a phone the graphs start folded (simple by default): then it is Unfold first, Fold after.
      const folded = await card.evaluate((el) => el.classList.contains('is-folded'));
      const [first, second] = pair[0] === 'Fold' && folded ? ['Unfold', 'Fold'] : pair;
      const before = await where();
      const me = before.find((p) => p.id === id);
      await page.locator(`[data-graph="${id}"] .tele-card-menu > button`).click();
      await page.getByRole('menuitem', { name: first, exact: true }).click();
      await page.waitForTimeout(200);
      const after = await where();
      for (const b of before) {
        const a = after.find((p) => p.id === b.id);
        const keep = b.id !== id && (b.b <= me.y + 0.5 || b.r <= me.x + 0.5 || b.x >= me.r - 0.5);
        if (keep && a && (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5)) problems.push(`Telemetry: ${first} on ${id} moved ${b.id}`);
      }
      pressed += 1;
      if (second) {
        await page.locator(`[data-graph="${id}"] .tele-card-menu > button`).click();
        await page.getByRole('menuitem', { name: second, exact: true }).click();
      } else {
        await page.getByRole('group', { name: /, hidden$/ }).getByRole('button', { name: 'Show' }).click();
      }
      await page.waitForTimeout(200);
      pressed += 1;
    }
  }
  await page.close();
  return { problems, pressed, skipped };
}

let failed = 0;
for (const WIDTH of WIDTHS) {
  const { problems, pressed, skipped } = await runAt(WIDTH);
  const notCompared = skipped ? ` (${skipped} presses changed how many landmarks there are, so they were not compared)` : '';
  if (problems.length) {
    failed += 1;
    const list = [...new Set(problems)];
    console.log(`${WIDTH} px: things moved (${list.length}) in ${pressed} presses${notCompared}:\n${list.slice(0, 60).map((p) => `  ${p}`).join('\n')}`);
  } else {
    console.log(`${WIDTH} px: nothing moved: ${pressed} presses on ${SCREENS.length} screens (${THEME})${notCompared}.`);
  }
}
await browser.close();
console.log(failed ? `Failed at ${failed} of ${WIDTHS.length} widths.` : `Nothing moved at ${WIDTHS.join(', ')} px.`);
process.exit(failed ? 1 : 0);
