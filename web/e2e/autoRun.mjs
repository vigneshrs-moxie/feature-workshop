// Auto runs a demo job to PR #1 with no click, and stops on a database change, checked in a real browser.
//
// The demo seeds two jobs in Auto at their quick-plan gate (dashboard/demo/run-demo.js):
//   "Auto demo"          Auto answers every step and card with the demo's stand-in Approver until PR #1 is open.
//   "Auto demo: migrate" its description is a database change, so Auto stops at once.
// This script only looks. It refuses every request that is not a GET, so nothing on the page can answer
// a step for Auto: if "Auto demo" gets to PR #1, Auto did it. It checks that
//   1. "Auto demo" shows PR #1 open within 120 s, with no click and no request that changes anything,
//      and its job page has the Auto switch and "What Auto decided" in its head;
//   2. "What Auto decided" on its card lists one entry per approval (the summary counts them), each
//      with the Approver's reason, and says Auto finished;
//   3. "Auto demo: migrate" is in the Needs you group with "Auto stopped: a database change needs you."
//      (AUTO_STOP_REASONS.database in dashboard/lib/auto-rules.js).
//
// Run it against a running demo (a minute or so after it starts; the demo runs the jobs on its own):
//   PORT=4493 STARBASE_DEMO=1 node dashboard/demo/run-demo.js      # in one terminal
//   npm run web:build && node web/e2e/autoRun.mjs                  # in another
// Environment: BASE (default http://127.0.0.1:4493/next/), WIDTH (default 1512), THEME (light),
// PLAYWRIGHT (the path to playwright's index.mjs, when it isn't installed here).
// It exits 1 if anything fails (listing what), or 0.
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:4493/next/';
const WIDTH = Number(process.env.WIDTH) || 1512;
const THEME = process.env.THEME || 'light';
const WAIT_MS = 120_000;
const STOP = 'Auto stopped: a database change needs you.';
const WHYS = ['The recommended answer, as the brief proposes.', 'An ordinary step of this job.'];

const problems = [];
const fail = (what) => { problems.push(what); console.log(`  FAIL ${what}`); };
const ok = (what) => console.log(`  ok   ${what}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: 1000 } });
await page.addInitScript((t) => {
  try {
    localStorage.setItem('workshop.theme', t);
    localStorage.setItem('gc.guide.seen', JSON.stringify(['jobs', 'desk', 'stage', 'job', 'inbox', 'telemetry', 'stack', 'stacks', 'review', 'review-round']));
  } catch { /* storage off */ }
}, THEME);
let refused = 0;
const refusedWhat = [];
await page.route('**/*', (route) => {
  if (route.request().method() === 'GET' || route.request().method() === 'HEAD') return route.continue();
  if (new URL(route.request().url()).pathname === '/api/presence') return route.abort(); // the page saying it is open: not a decision
  refused++;
  refusedWhat.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
  return route.abort();
});

try {
  // 1. PR #1 open, with nobody clicking.
  await page.goto(`${BASE}#/job/auto-demo`, { waitUntil: 'networkidle' });
  const started = Date.now();
  let seen = false;
  while (Date.now() - started < WAIT_MS) {
    const text = await page.locator('main').innerText().catch(() => '');
    if (/PR #1 open/.test(text)) { seen = true; break; }
    await page.waitForTimeout(1000);
  }
  if (seen) ok(`Auto demo shows PR #1 open after ${Math.round((Date.now() - started) / 1000)} s of waiting`);
  else fail(`Auto demo did not show "PR #1 open" within ${WAIT_MS / 1000} s`);
  if (refused) fail(`${refused} request(s) that change something were refused: ${refusedWhat.join(', ')}`);

  // 1b. The job page itself has the Auto switch and What Auto decided, before we leave it. (Auto goes
  // off by itself once PR #1 is open, so the switch is there but not ticked now.)
  const pageSwitch = page.locator('main .page-head').getByRole('checkbox', { name: /Auto: run to PR #1/ });
  if ((await pageSwitch.count()) !== 1) fail(`the job page has ${await pageSwitch.count()} Auto switches in its head, expected 1`);
  else ok('the job page has the Auto switch');
  const pageWhat = page.locator('main .page-head').getByRole('button', { name: 'What Auto decided' });
  if ((await pageWhat.count()) !== 1) fail(`the job page has ${await pageWhat.count()} "What Auto decided" buttons in its head, expected 1`);
  else ok('the job page has What Auto decided');

  // 2. What Auto decided, on the Jobs page card.
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const card = page.locator('.job-card', { hasText: 'Auto demo' }).filter({ hasNotText: 'Auto demo: migrate' });
  if ((await card.count()) !== 1) fail(`expected one "Auto demo" card on Jobs, found ${await card.count()}`);
  else {
    const button = card.getByRole('button', { name: 'What Auto decided' });
    await button.click();
    await page.locator('.auto-entry').first().waitFor({ timeout: 10_000 }).catch(() => {});
    const entries = await page.locator('.auto-entry').allInnerTexts();
    const summary = (await page.locator('.auto-summary').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const counted = Number(/Auto made (\d+) decisions?/.exec(summary)?.[1] ?? NaN);
    if (entries.length < 3) fail(`What Auto decided lists ${entries.length} entries, expected the plan, the test and the review approvals and the cards between`);
    else if (counted !== entries.length) fail(`the summary counts ${counted} decisions but ${entries.length} entries are listed`);
    else ok(`What Auto decided lists ${entries.length} entries, one per approval`);
    const noReason = entries.filter((e) => !WHYS.some((w) => e.includes(w)));
    if (noReason.length) fail(`${noReason.length} entries without the Approver's reason`);
    else ok('every entry gives the Approver\'s reason');
    if (!/Auto finished: PR #1 is open\./.test(summary)) fail(`the summary does not say Auto finished (it says: ${summary})`);
    else ok('the summary says Auto finished: PR #1 is open.');
    await page.keyboard.press('Escape');
  }

  // 3. The migrate job: stopped, and waiting in Needs you.
  const migrate = page.locator('.job-card', { hasText: 'Auto demo: migrate' });
  if ((await migrate.count()) !== 1) fail(`expected one "Auto demo: migrate" card, found ${await migrate.count()}`);
  else {
    const text = (await migrate.innerText()).replace(/\s+/g, ' ');
    const cls = (await migrate.getAttribute('class')) ?? '';
    if (!text.includes(STOP)) fail(`the migrate card does not say "${STOP}" (it says: ${text.slice(0, 200)})`);
    else ok(`the migrate card says "${STOP}"`);
    if (!cls.includes('lane-needs-you')) fail(`the migrate card is not in Needs you (its class: ${cls})`);
    else ok('the migrate card is in Needs you');
  }
  if (refused) fail(`${refused} request(s) that change something were refused: ${refusedWhat.join(', ')}`);
} catch (err) {
  fail(`the script broke: ${err.message.split('\n')[0]}`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.log(`\nautoRun: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('\nautoRun: Auto ran "Auto demo" to PR #1 with no click, and stopped "Auto demo: migrate" on a database change.');
