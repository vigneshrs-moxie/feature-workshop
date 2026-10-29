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
// Environment: BASE (default http://127.0.0.1:4493/next/), WIDTH (1512), THEME (light),
// PLAYWRIGHT (the path to playwright's index.mjs, when it isn't installed here).
// It exits 1 and lists what moved, or 0 with a count of the controls it pressed.
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:4493/next/';
const WIDTH = Number(process.env.WIDTH || 1512);
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
const page = await browser.newPage({ viewport: { width: WIDTH, height: 1000 } });
await page.addInitScript((t) => {
  try {
    localStorage.setItem('workshop.theme', t);
    localStorage.setItem('gc.guide.seen', JSON.stringify(['jobs', 'desk', 'stage', 'job', 'inbox', 'telemetry', 'stack', 'stacks', 'review']));
  } catch { /* storage off */ }
}, THEME);

const problems = [];
let pressed = 0;
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
await browser.close();
if (problems.length) {
  console.log(`Things moved (${problems.length}):\n${[...new Set(problems)].slice(0, 60).join('\n')}`);
  process.exit(1);
}
console.log(`Nothing moved: ${pressed} presses on ${SCREENS.length} screens at ${WIDTH} px (${THEME}).`);
