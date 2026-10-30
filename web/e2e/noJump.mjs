// Nothing jumps when something folds, hides or opens (packet R, rule 2), checked in a real browser.
//
// On Jobs, a Job, the Desk, Telemetry and Settings → Look it presses every fold, hide and open
// control on the page (a "Details" or "More" row, a <summary>, any button with aria-expanded, a
// graph's Fold and Hide), once to change it and once to put it back. Each time, everything above
// the control's own item and everything in another column must stay exactly where it was; only
// the item itself and what is under it in its own column may move.
//
// Run it against a running app (the demo is best):
//   PORT=4493 WORKSHOP_DEMO=1 node dashboard/demo/run-demo.js      # in one terminal
//   node web/e2e/noJump.mjs                                         # in another
// Environment: BASE (default http://127.0.0.1:4493/next/), WIDTHS (comma list, default
// 1280,1512,1728), WIDTH (one width only; overrides WIDTHS), THEME (light),
// PLAYWRIGHT (the path to playwright's index.mjs, when it isn't installed here).
// It reports each width, then exits 1 if anything moved at any width (listing what), or 0.
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:4493/next/';
const WIDTHS = (process.env.WIDTH || process.env.WIDTHS || '1280,1512,1728')
  .split(',').map((w) => Number(w.trim())).filter((w) => w > 0);
const THEME = process.env.THEME || 'light';
const SCREENS = [
  ['Jobs', '#/'],
  ['Job', '#/job/customer-merge'],
  ['Desk', '#/desk'],
  ['Telemetry', '#/telemetry'],
  ['Settings', '#/settings/look'],
];
const TOGGLES = '.more-head, details > summary, button[aria-expanded]:not([aria-haspopup]):not([role="combobox"]), [data-fold], [data-hide]';
const ITEM = '.more, details, .tele-card, .hidden-slot, .fold, .job-card, .thread, li, section';
const LANDMARKS = '.page-title, .next-bar, .lane-head, .job-card, .more-head, details > summary, .tele-card, .hidden-slot, .desk-console, .job-convo, .settings-rail, .look-heading, .btn';

const browser = await chromium.launch();

async function runAt(WIDTH) {
  const problems = [];
  let pressed = 0;
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 1000 } });
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('workshop.theme', t);
      localStorage.setItem('gc.guide.seen', JSON.stringify(['jobs', 'desk', 'stage', 'job', 'inbox', 'telemetry', 'stack', 'stacks', 'review']));
    } catch { /* storage off */ }
  }, THEME);

  for (const [name, hash] of SCREENS) {
    await page.goto(BASE + hash, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
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
          // Places are measured from the page's own top-left, so scrolling never counts as moving.
          const o = (document.querySelector('.page-inner') ?? document.body).getBoundingClientRect();
          return [...(document.querySelector(".page-inner") ?? document).querySelectorAll(LANDMARKS)].map((el, n) => {
            const b = el.getBoundingClientRect();
            const r = { left: b.left - o.left, right: b.right - o.left, top: b.top - o.top, bottom: b.bottom - o.top, width: b.width };
            const above = r.bottom <= item.top + 0.5;
            const aside = r.right <= item.left + 0.5 || r.left >= item.right - 0.5;
            const inside = own ? own.contains(el) || el.contains(own) : false;
            return { n, x: r.left, y: r.top, keep: (above || aside) && !inside && r.width > 0, what: `${el.className || el.tagName}`.toString().slice(0, 60) };
          });
        }, [ITEM, LANDMARKS]);
        await toggle.click({ trial: false }).catch(() => {});
        await page.waitForTimeout(260);
        const after = await page.evaluate((LANDMARKS) => {
          const o = (document.querySelector('.page-inner') ?? document.body).getBoundingClientRect();
          return [...(document.querySelector(".page-inner") ?? document).querySelectorAll(LANDMARKS)].map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.left - o.left, y: r.top - o.top };
          });
        }, LANDMARKS);
        if (after.length === before.length) {
          for (const b of before) {
            const a = after[b.n];
            if (b.keep && a && (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5)) {
              problems.push(`${name}: pressing control ${i} (${round}) moved ${b.what} from ${Math.round(b.x)},${Math.round(b.y)} to ${Math.round(a.x)},${Math.round(a.y)}`);
            }
          }
        }
        pressed += 1;
        await page.keyboard.press('Escape').catch(() => {});
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
    for (const [first, second] of [['Fold', 'Unfold'], ['Hide', null]]) {
      const card = page.locator('.tele-graph-col > *').nth(i);
      const id = await card.getAttribute('data-graph');
      if (!id) continue;
      const before = await where();
      const me = before.find((p) => p.id === id);
      await page.locator(`[data-graph="${id}"] .tele-card-menu > button`).click();
      await page.getByRole('menuitem', { name: first }).click();
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
        await page.getByRole('menuitem', { name: second }).click();
      } else {
        await page.getByRole('group', { name: /, hidden$/ }).getByRole('button', { name: 'Show' }).click();
      }
      await page.waitForTimeout(200);
      pressed += 1;
    }
  }
  await page.close();
  return { problems, pressed };
}

let failed = 0;
for (const WIDTH of WIDTHS) {
  const { problems, pressed } = await runAt(WIDTH);
  if (problems.length) {
    failed += 1;
    const list = [...new Set(problems)];
    console.log(`${WIDTH} px: things moved (${list.length}):\n${list.slice(0, 60).map((p) => `  ${p}`).join('\n')}`);
  } else {
    console.log(`${WIDTH} px: nothing moved: ${pressed} presses on ${SCREENS.length} screens (${THEME}).`);
  }
}
await browser.close();
console.log(failed ? `Failed at ${failed} of ${WIDTHS.length} widths.` : `Nothing moved at ${WIDTHS.join(', ')} px.`);
process.exit(failed ? 1 : 0);
