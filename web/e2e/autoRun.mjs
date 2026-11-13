// Auto runs a demo job to PR #1 with no click, and refuses a database command without stopping, checked in a real browser.
//
// The demo seeds three jobs in Auto at their quick-plan gate (dashboard/demo/run-demo.js):
//   "Auto demo"               Auto answers every step and card with the demo's stand-in Approver until PR #1 is open.
//   "Auto demo: migrate"      its build asks to run npm run db:migrate: Auto refuses that card with the database
//                             note, and the job still runs to PR #1.
//   "Ticket count in the tab" (auto-yours) he wrote to it while the step waited, so Auto leaves the
//                             step to him. This script does not check it; its title never matches
//                             "Auto demo", so there is still exactly one "Auto demo" card.
// This script only looks. It refuses every request that is not a GET, so nothing on the page can answer
// a step for Auto: if "Auto demo" gets to PR #1, Auto did it. It checks that
//   1. "Auto demo" shows PR #1 open within 120 s, with no click and no request that changes anything,
//      and its job page has the Auto switch and "What Auto decided" in its header (.sb-job-top);
//   2. "What Auto decided" on its card lists one entry per approval (the summary counts them), each
//      with the Approver's reason, and says Auto finished;
//   3. "Auto demo: migrate", on the Jobs page's Auto tab, is a row in Ready for you to try (within 120 s)
//      and not in Needs you; on its job page, "What Auto decided" lists a refusal (an entry with
//      data-kind="refuse", chose "Refused: …") whose Why: is the database note's reason
//      (REFUSE_REASONS.database in dashboard/lib/auto.js), and says Auto finished.
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
// The database row of REFUSE_REASONS (dashboard/lib/auto.js), less the product's name at its start.
const DB_WHY = /applies this job's migrations to Auto's own copy of the database when the job's turn to test comes\./;
const WHYS = ['The recommended answer, as the brief proposes.', 'An ordinary step of this job.'];

const problems = [];
const fail = (what) => { problems.push(what); console.log(`  FAIL ${what}`); };
const ok = (what) => console.log(`  ok   ${what}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: 1000 } });
await page.addInitScript((t) => {
  try {
    localStorage.setItem('workshop.theme', t);
    localStorage.setItem('gc.guide.seen', JSON.stringify(['jobs', 'desk', 'stage', 'job', 'job-page-2', 'inbox', 'telemetry', 'stack', 'stacks', 'review', 'review-round']));
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

  // 1b. The job page itself has the Auto switch and What Auto decided in its header, before we leave
  // it. (Auto goes off by itself once PR #1 is open, so the switch is there but not ticked now.)
  const pageSwitch = page.locator('main .sb-job-top').getByRole('checkbox', { name: /Auto: run to PR #1/ });
  if ((await pageSwitch.count()) !== 1) fail(`the job page has ${await pageSwitch.count()} Auto switches in its header, expected 1`);
  else ok('the job page has the Auto switch');
  const pageWhat = page.locator('main .sb-job-top').getByRole('button', { name: 'What Auto decided' });
  if ((await pageWhat.count()) !== 1) fail(`the job page has ${await pageWhat.count()} "What Auto decided" buttons in its header, expected 1`);
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

  // 3. The migrate job: its database card refused, and still at PR #1, under Ready for you to try.
  await page.getByRole('tab', { name: 'Auto', exact: true }).click();
  const readyRow = page.locator('section.lane-ready .sb-auto-row', { hasText: 'Auto demo: migrate' });
  const readyFrom = Date.now();
  while (Date.now() - readyFrom < WAIT_MS && (await readyRow.count()) === 0) await page.waitForTimeout(1000);
  if ((await readyRow.count()) !== 1) fail(`expected one "Auto demo: migrate" row in Ready for you to try, found ${await readyRow.count()}`);
  else ok('the migrate job is in Ready for you to try');
  const needsRow = page.locator('section.lane-needs-you .sb-auto-row', { hasText: 'Auto demo: migrate' });
  if ((await needsRow.count()) !== 0) fail('the migrate job is also in Needs you');
  else ok('the migrate job is not in Needs you');
  await page.goto(`${BASE}#/job/auto-demo-migrate`, { waitUntil: 'networkidle' });
  const migrateWhat = page.locator('main .sb-job-top').getByRole('button', { name: 'What Auto decided' });
  if ((await migrateWhat.count()) !== 1) fail(`the migrate job page has ${await migrateWhat.count()} "What Auto decided" buttons in its header, expected 1`);
  else {
    await migrateWhat.click();
    await page.locator('.auto-entry').first().waitFor({ timeout: 10_000 }).catch(() => {});
    const refusals = await page.locator('.auto-entry[data-kind="refuse"]').allInnerTexts();
    const summary = (await page.locator('.auto-summary').innerText().catch(() => '')).replace(/\s+/g, ' ');
    if (refusals.length !== 1) fail(`What Auto decided on the migrate job lists ${refusals.length} refusals, expected 1`);
    else if (!/Refused: /.test(refusals[0]) || !DB_WHY.test(refusals[0].replace(/\s+/g, ' '))) fail(`the refusal does not say Refused: with the database reason (it says: ${refusals[0].replace(/\s+/g, ' ').slice(0, 300)})`);
    else ok('What Auto decided on the migrate job lists the database refusal');
    if (!/Auto finished: PR #1 is open\./.test(summary)) fail(`the migrate job's summary does not say Auto finished (it says: ${summary})`);
    else ok('the migrate job\'s summary says Auto finished: PR #1 is open.');
    await page.keyboard.press('Escape');
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
console.log('\nautoRun: Auto ran "Auto demo" to PR #1 with no click, and ran "Auto demo: migrate" to PR #1 with its database command refused.');
