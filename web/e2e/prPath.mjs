// The PR path end to end (plan Phase 4 ends; Tasks 20–22), on the demo with a fake gh, in a real browser at 1512
// and 390 px: open, comment, fix, reply, push. Nothing reaches GitHub: gh is web/e2e/lib/fakeGh.cjs (STARBASE_GH),
// which records every call and answers from a scripted PR state; the fork is a local bare repository.
//
// It starts its own demo (dashboard/demo/run-demo.js, TMPDIR inside OUT, its own PORT), sets up one job and plays
// GitHub around it, step by step:
//   1  Bulk Archive (a job at Build, not in Auto mode, three commits): the asks row leads with `Push and open PR #1`;
//      its click opens the reader's Ship with the line open: what goes (the commits, the branch, the title) and
//      `Starbase will ask you once more when the Foreman pushes and when it opens the PR.`; nothing is sent until
//      his yes, which sends the line's fixed sentence to the demo Foreman (it then asks for its push with a card).
//   2  PR #1 opens (the branch pushed to the bare fork, the job at PR #1). Three comments arrive (a line comment, a
//      review, a conversation comment): Pull now → `read just now`, Your move `PR #1 · 3 new comments`; then one of
//      his own login: 4. The PR view lists the rows, ticked.
//   3  Fix these → the rows say Fixing at once; the demo Foreman (dashboard/demo/fake-query.js) commits once per
//      comment and answers with the `--- Comments answered ---` block → `Fixed in <sha>` (opens that commit, on the
//      branch) and a drafted reply, editable.
//   4  Copy and Open on GitHub first; Post it posts his edited words once; a double click posts once.
//   5  `Push the fixes (n commits)` in exactly two places (the Ship line and the PR view's bar); what goes; his yes
//      sends the fixed sentence.
//   6  A review round on PR #2 (the job at PR #2, a reviewer asks for changes, the round made ready): the line's
//      Push the fixes says the round's own steps, the follow-up PR #1 and its merge among them.
//   7  gh signed out, then offline (STARBASE_DEMO_GH_DOWN for the demo's flow map, the fake gh's mode for the
//      comment read): the lines say so, no button; no Post it.
//   Then every fake gh call is listed: there must be no write that did not follow his click.
//
// Run (the build first, so /next is current):
//   nice -n 15 npm run web:build
//   node web/e2e/prPath.mjs
// Environment: OUT (where the demo, the fork, the gh log and the screenshots go; default $TMPDIR/pr-path),
// PORT (4511), WIDTHS (1512,390), KEEP=1 (leave the demo running at the end, at PR #1 with its rows, a new
// comment and a failed check, for themeSweep.mjs / contrast.mjs with PR_JOB=bulk-archive; its pid is printed;
// KEEP_AT=pr2 leaves it at PR #2 with the review round ready instead), STOP_AT=1 (stop after step 1),
// PLAYWRIGHT (playwright's index.mjs).
// Prints one line per check and exits 1 if any failed.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.resolve(process.env.OUT || path.join(os.tmpdir(), 'pr-path'));
const PORT = Number(process.env.PORT || 4511);
const WIDTHS = (process.env.WIDTHS || '1512,390').split(',').map(Number);
const KEEP = process.env.KEEP === '1';
const BASE = `http://127.0.0.1:${PORT}`;
const APP = `${BASE}/next/`;
const SLUG = 'bulk-archive';
const BRANCH = 'feature/bulk-archive';
const TMP = path.join(OUT, 'tmp');
const GH = path.join(OUT, 'gh');
const SHOTS = path.join(OUT, 'shots');
const GH_DOWN = path.join(OUT, 'gh-down.txt');
const RUN = Date.now().toString(36); // the fork and the worktree are new each run (nothing here is deleted)
const FORK = path.join(TMP, `fork-${RUN}.git`);
const WT = path.join(TMP, `wt-bulk-archive-${RUN}`);
for (const d of [OUT, TMP, GH, SHOTS]) mkdirSync(d, { recursive: true });
for (const f of ['calls.jsonl']) writeFileSync(path.join(GH, f), '');
writeFileSync(GH_DOWN, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- What is checked ----------

const results = [];
const clicks = []; // { at, what }: his clicks that may write to GitHub
function check(step, what, pass, note = '') {
  results.push({ step, what, pass: Boolean(pass), note });
  console.log(`  [${pass ? 'pass' : 'FAIL'}] ${step} · ${what}${note ? ` · ${note}` : ''}`);
}
const ghCalls = () => readFileSync(path.join(GH, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ghWrites = () => ghCalls().filter((c) => c.write);

// ---------- The fake GitHub ----------

let ghState = { mode: 'ok', login: 'you', prs: {} };
const saveGh = () => writeFileSync(path.join(GH, 'state.json'), JSON.stringify(ghState, null, 2));
const readGh = () => { ghState = JSON.parse(readFileSync(path.join(GH, 'state.json'), 'utf8')); return ghState; };
saveGh();
const user = (login) => ({ login, type: 'User' });
const green = [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/acme/acme-portal/actions/runs/11/job/1' }];

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Demo', GIT_AUTHOR_EMAIL: 'demo@example.com', GIT_COMMITTER_NAME: 'Demo', GIT_COMMITTER_EMAIL: 'demo@example.com' } }).toString().trim();

// ---------- The demo ----------

const demoLog = path.join(OUT, 'demo.log');
writeFileSync(demoLog, '');
const logFd = openSync(demoLog, 'a');
const demo = spawn('nice', ['-n', '10', process.execPath, path.join(ROOT, 'dashboard/demo/run-demo.js')], {
  cwd: ROOT, stdio: ['ignore', logFd, logFd], detached: KEEP,
  env: { ...process.env, TMPDIR: TMP, PORT: String(PORT), WIREFRAMES_PORT: String(PORT + 1), STARBASE_GH: path.join(HERE, 'lib/fakeGh.cjs'), FAKE_GH_DIR: GH, STARBASE_DEMO_GH_DOWN: GH_DOWN },
});
if (KEEP) demo.unref();
let stopped = false;
const stopDemo = () => { if (!stopped && !KEEP) { stopped = true; demo.kill('SIGTERM'); } };
process.on('exit', stopDemo);
for (let i = 0; ; i++) {
  if (readFileSync(demoLog, 'utf8').includes('Starbase running')) break;
  if (i > 120 || demo.exitCode !== null) { console.error(readFileSync(demoLog, 'utf8')); process.exit(1); }
  await sleep(500);
}
const DEMO = path.join(TMP, 'starbase-demo');
const ACME = path.join(DEMO, 'acme-portal');
const JOB = path.join(DEMO, 'feature-work', SLUG);
const token = (await (await fetch(`${BASE}/api/meta`)).json()).token;
const get = async (p) => (await fetch(BASE + p)).json();
const post = async (p, body = {}) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Starbase-Token': token }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
async function waitFor(fn, what, ms = 30000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(250);
  }
}
const status = () => JSON.parse(readFileSync(path.join(JOB, 'status.json'), 'utf8'));
const writeStatus = (s) => writeFileSync(path.join(JOB, 'status.json'), JSON.stringify(s, null, 2));
const pageOf = () => get(`/api/job/${SLUG}/page`);
const prView = (n) => get(`/api/job/${SLUG}/pr/${n}`);
async function stopRuns() {
  for (const r of (await get('/api/runs')).runs ?? []) {
    if (r.slug === SLUG && ['running', 'starting', 'waiting', 'waiting_permission'].includes(r.status)) await post(`/api/runs/${r.id}/stop`);
  }
  await waitFor(async () => !((await get('/api/runs')).runs ?? []).some((r) => r.slug === SLUG && ['running', 'starting', 'waiting', 'waiting_permission'].includes(r.status)), 'the Foreman to stop');
  await sleep(600);
}
const prNumber = async (n) => (await get('/api/flow')).repos.flatMap((r) => r.lanes).find((l) => l.slug === SLUG)?.[`pr${n}`]?.number ?? null;

// The job: its own worktree of the demo repository, whose fork (origin) is a local bare repository.
git(TMP, 'init', '--bare', '-q', '-b', 'main', FORK);
git(ACME, 'remote', 'add', 'origin', FORK);
git(ACME, 'push', '-q', 'origin', 'main');
git(ACME, 'worktree', 'add', '-q', WT, BRANCH);
writeStatus({ ...status(), worktree: WT });
console.log(`Demo on ${BASE} (pid ${demo.pid}); out ${OUT}`);

// ---------- The browser ----------

const browser = await chromium.launch();
async function open(width, hash) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 945 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.errors = [];
  page.posts = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('request', (r) => { if (r.method() === 'POST') page.posts.push({ at: Date.now(), url: r.url().replace(BASE, ''), body: r.postData() }); });
  await page.goto(APP + hash, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const vis = (page, sel) => page.locator(sel).filter({ visible: true });
const textOf = async (page, sel) => (await vis(page, sel).allInnerTexts()).join(' | ');
const buttons = (page, label) => page.locator('button, a').filter({ visible: true, hasText: label });
async function clickHis(page, locator, what) { clicks.push({ at: Date.now(), what }); await locator.click(); }

try {
  // ---------- 1. Push and open PR #1 ----------
  // His yes is given at the first width, after every other width has been looked at.
  for (const width of [...WIDTHS.slice(1), WIDTHS[0]]) {
    const w = `${width}`;
    let page = await open(width, `#/job/${SLUG}`);
    await page.waitForTimeout(800);
    await shot(page, `1-${w}-job`);
    const lead = vis(page, '.jp2-asks button').filter({ hasText: 'Push and open PR #1' });
    check('1', `${w}: the asks row leads with Push and open PR #1`, (await lead.count()) >= 1, (await textOf(page, '.jp2-asks')).replace(/\n/g, ' · '));
    {
      // Ship picked on a job at Build: what the reader shows.
      await vis(page, '.jp2-st-row').filter({ hasText: 'Ship' }).first().click();
      await page.waitForTimeout(700);
      await shot(page, `1-${w}-ship-picked`);
      if (width >= 760) {
        const shipText = await textOf(page, '.jp2-notyet');
        const lineThere = (await buttons(page, 'Push and open PR #1').count()) > 0;
        check('1', `${w}: Ship picked on a job at Build shows the PR line`, lineThere, lineThere ? '' : `the reader says “${shipText}” and the asks row drops the lead`);
      } else {
        // The phone's Ship screen lists PR #1, #2, #3; PR #1 opens its own screen with its line.
        await vis(page, 'button, a').filter({ hasText: /^PR #1/ }).first().click();
        await page.waitForTimeout(800);
        const lineThere = (await buttons(page, 'Push and open PR #1').count()) > 0;
        check('1', `${w}: Ship → PR #1 on the phone shows the line with its button`, lineThere, (await textOf(page, '.jp2-prl')).replace(/\n/g, ' · ').slice(0, 160));
        await shot(page, `1-${w}-ship-pr1`);
      }
      // Back on Build: the lead again (a fresh page, so the pick is gone).
      await page.close();
      page = await open(width, `#/job/${SLUG}`);
    }
    const postsBefore = page.posts.length;
    await buttons(page, 'Push and open PR #1').first().click();
    await page.waitForTimeout(700);
    const says = await vis(page, '.jp2-prl-says li').allInnerTexts();
    await shot(page, `1-${w}-says`);
    check('1', `${w}: the first click opens the line with what goes`, says.length > 3, says.join(' / ').slice(0, 300));
    check('1', `${w}: says lists the commits, from where to where and the title`, says.some((s) => /^Pushes 3 commits from feature\/bulk-archive to your fork \(origin\):$/.test(s)) && says.filter((s) => /^[0-9a-f]{7} /.test(s)).length === 3 && says.some((s) => s.startsWith('Opens PR #1: you:feature/bulk-archive → feature/bulk-archive on acme/acme-portal')) && says.includes('Title: Bulk Archive'));
    check('1', `${w}: says ends with “Starbase will ask you once more…” (not in Auto)`, says.at(-1) === 'Starbase will ask you once more when the Foreman pushes and when it opens the PR.', says.at(-1));
    check('1', `${w}: nothing sent by the first click`, page.posts.slice(postsBefore).filter((p) => /\/pr\/1\/go$/.test(p.url) || /\/send$/.test(p.url)).length === 0);
    const yes = vis(page, '.jp2-prl-acts button').filter({ hasText: 'Push and open' });
    check('1', `${w}: the yes reads Push and open, beside Cancel`, (await yes.count()) === 1 && (await vis(page, '.jp2-prl-acts button').filter({ hasText: 'Cancel' }).count()) === 1);
    const focusIsYes = await page.evaluate(() => document.activeElement?.textContent === 'Push and open');
    check('1', `${w}: the focus is not on the yes`, !focusIsYes);
    if (width !== WIDTHS[0]) { await page.close(); continue; }
    // His yes.
    const line = (await pageOf()).prs[0];
    check('1', 'Push and open only after the branch has commits: 3 here', line.next?.label === 'Push and open PR #1');
    await clickHis(page, yes.first(), 'Push and open');
    await page.waitForTimeout(800);
    const go = page.posts.filter((p) => /\/pr\/1\/go$/.test(p.url));
    check('1', `${w}: one POST …/pr/1/go with the line's id and check`, go.length === 1 && JSON.parse(go[0].body).check === line.next.check && JSON.parse(go[0].body).id === 'push-open', go.map((p) => p.body).join(' '));
    check('1', `${w}: the line says Sent`, (await textOf(page, '.jp2-prl-done')).includes('Sent · the Foreman pushes to your fork and opens PR #1'), await textOf(page, '.jp2-prl-done'));
    const thread = await waitFor(async () => { const d = await get(`/api/job/${SLUG}`); return d.thread?.some((t) => t.kind === 'you' && t.text === line.next.sends) ? d.thread : null; }, 'the sentence in the conversation', 15000).catch(() => null);
    check('1', `${w}: the demo Foreman got the fixed sentence word for word`, Boolean(thread), line.next.sends.slice(0, 90) + '…');
    const sentLine = (await pageOf()).prs[0];
    check('1', 'while the Foreman works on it, the line has no button and says Sent to the Foreman', !sentLine.next && sentLine.why === 'Sent to the Foreman', JSON.stringify([sentLine.next?.label ?? null, sentLine.why]));
    // The demo Foreman asks for its routine checks first (a card he allows on the Desk), then for the push.
    const card = await waitFor(async () => {
      const cards = ((await get('/api/snapshot')).permissions ?? []).filter((p) => p.slug === SLUG);
      const push = cards.find((p) => /git push/.test(JSON.stringify(p.input ?? {})));
      if (push) return push;
      for (const p of cards) await post(`/api/permissions/${p.requestId ?? p.id}`, { decision: 'allow' });
      return null;
    }, 'the push card', 30000).catch(() => null);
    check('1', `${w}: the Foreman's push still asks with a card (as the line said)`, Boolean(card), card ? JSON.stringify(card.input).slice(0, 100) : '');
    const still = (await pageOf()).prs[0];
    check('1', 'the push card still waiting: the line still has no second Push and open', !still.next, JSON.stringify([still.next?.label ?? null, still.why, (await pageOf()).steps.find((x) => x.state === 'current')?.id]));
    check('1', 'no gh write so far', ghWrites().length === 0);
    await page.waitForTimeout(500);
    await shot(page, `1-${w}-sent`);
    for (const pw of WIDTHS.slice(1)) {
      const p2 = await open(pw, `#/job/${SLUG}/read/ship/ship`);
      await p2.waitForTimeout(800);
      const again = await buttons(p2, /^Push and open/).count();
      check('1', `${pw}: a page opened while the push card waits offers no second Push and open`, again === 0, (await textOf(p2, '.jp2-prl')).replace(/\n/g, ' · ').slice(0, 160));
      await shot(p2, `1-${pw}-while-card`);
      await p2.close();
    }
    await page.close();
  }
  if (process.env.STOP_AT === '1') throw new Error('STOP_AT=1: stopped after step 1');
  await stopRuns();

  // ---------- 2. PR #1 open; comments arrive ----------
  git(WT, 'push', '-q', 'origin', BRANCH); // what the Foreman's push did
  writeStatus({ ...status(), stage: 'pr1', stage_state: 'in_progress', waiting_for: null });
  await post('/api/flow/refresh');
  const N1 = await waitFor(() => prNumber(1), 'PR #1 on the flow map');
  const head1 = git(WT, 'rev-parse', 'HEAD');
  const url1 = `https://github.com/acme/acme-portal/pull/${N1}`;
  const view1 = { number: N1, state: 'OPEN', isDraft: false, reviewDecision: 'REVIEW_REQUIRED', reviewRequests: [], mergeable: 'MERGEABLE', headRefOid: head1, headRefName: BRANCH, baseRefName: BRANCH, statusCheckRollup: green, url: url1, title: 'Bulk Archive', mergedAt: null, mergedBy: null, closedAt: null };
  ghState.prs[N1] = { view: view1, reviews: [], comments: [], issues: [] };
  saveGh();
  const t0 = Date.now() - 60_000;
  const iso = (dt) => new Date(t0 + dt).toISOString();
  ghState.prs[N1].comments.push({ id: 7101, user: user('raj-moxie'), path: 'app/tickets/archive.js', line: 3, body: 'Please name the button by what it does: archiveTicketsButton.', html_url: `${url1}#discussion_r7101`, diff_hunk: '@@ -1 +1,3 @@\n export const ARCHIVED = \'archived\';\n+\n+export const archiveButton = \'<button>Archive</button>\';', created_at: iso(1000) });
  ghState.prs[N1].reviews.push({ id: 6101, user: user('raj-moxie'), state: 'COMMENTED', body: 'Looks close. Two small things first.', html_url: `${url1}#pullrequestreview-6101`, submitted_at: iso(2000), commit_id: head1 });
  ghState.prs[N1].issues.push({ id: 8101, user: user('ana'), body: 'Does archiving also hide the ticket from search?', html_url: `${url1}#issuecomment-8101`, created_at: iso(3000) });
  saveGh();

  {
    const page = await open(WIDTHS[0], `#/job/${SLUG}`);
    await shot(page, `2-${WIDTHS[0]}-pr-open`);
    const lineText = await textOf(page, '.jp2-prl-line');
    check('2', 'PR #1 line says open', /PR #1\s*open/.test(lineText), lineText.slice(0, 120));
    const pull = buttons(page, 'Pull now').first();
    check('2', 'Pull now shows by the lines', (await buttons(page, 'Pull now').count()) >= 1);
    await pull.click();
    const moved = await waitFor(async () => ((await textOf(page, '.jp2-ym')).includes('PR #1 · 3 new comments') ? true : null), 'Your move’s PR line', 20000).catch(() => false);
    check('2', 'Your move shows `PR #1 · 3 new comments`', moved, await textOf(page, '.jp2-ym'));
    check('2', 'the read line says `read just now`', (await textOf(page, '.jp2-prl-read')).includes('read just now'), await textOf(page, '.jp2-prl-read'));
    await shot(page, `2-${WIDTHS[0]}-3-new`);
    // One of his own login arrives.
    ghState.prs[N1].comments.push({ id: 7102, user: user('you'), path: 'app/tickets/archive.js', line: 1, body: 'Note to self: check the archived constant is exported once.', html_url: `${url1}#discussion_r7102`, diff_hunk: '@@ -1 +1,3 @@\n export const ARCHIVED = \'archived\';', created_at: iso(4000) });
    saveGh();
    await buttons(page, 'Pull now').first().click();
    const four = await waitFor(async () => ((await textOf(page, '.jp2-ym')).includes('PR #1 · 4 new comments') ? true : null), 'four', 20000).catch(() => false);
    check('2', 'his own comment is a row too: `PR #1 · 4 new comments`', four, await textOf(page, '.jp2-ym'));
    await vis(page, '.jp2-ym button, .jp2-ym a').filter({ hasText: 'new comment' }).first().click();
    await page.waitForTimeout(900);
    check('2', 'the Your move line opens the PR view', page.url().includes(`/read/pr/1`), page.url());
    await waitFor(async () => ((await vis(page, '.jp2-prc').count()) >= 4 ? true : null), 'the rows', 10000).catch(() => null);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.jp2-prc:not(.jp2-prc-check)')].map((e) => ({ who: e.querySelector('.jp2-prc-who')?.textContent, where: e.querySelector('.jp2-prc-w')?.textContent, st: e.querySelector('.jp2-prc-st')?.textContent, ticked: e.querySelector('input[type=checkbox]')?.checked, code: e.querySelector('.jp2-prc-code')?.textContent ?? null })));
    check('2', 'the PR view lists 4 rows, all ticked, all New', rows.length === 4 && rows.every((r) => r.ticked && r.st === 'New'), JSON.stringify(rows.map((r) => [r.who, r.where, r.st, r.ticked])));
    check('2', 'his own row says (you)', rows.some((r) => r.who === 'you (you)'));
    check('2', 'a line comment shows its three code lines', rows.some((r) => r.code && r.code.includes('archiveButton')), rows.map((r) => r.code).join(' ¦ ').slice(0, 200));
    const bar = await textOf(page, '.jp2-prc-bar');
    check('2', 'the bar reads `4 ticked · Fix these · What is he asking? · Leave`', /^4 ticked\s*\|?\s*Fix these\s*\|?\s*What is he asking\?\s*\|?\s*Leave/.test(bar.replace(/\n/g, ' | ')), bar);
    check('2', 'the verdict is drawn', (await textOf(page, '.jp2-prv-verdict')).length > 0, await textOf(page, '.jp2-prv-verdict'));
    check('2', 'no gh write', ghWrites().length === 0);
    await shot(page, `2-${WIDTHS[0]}-pr-view`);

    // ---------- 3. Fix these ----------
    const before = page.posts.length;
    await vis(page, '.jp2-prc-bar button').filter({ hasText: 'Fix these' }).click();
    await page.waitForTimeout(300);
    const states = await page.evaluate(() => [...document.querySelectorAll('.jp2-prc:not(.jp2-prc-check) .jp2-prc-st')].map((e) => e.textContent));
    check('3', 'Fix these: the rows say Fixing at once', states.length === 4 && states.every((s) => s === 'Fixing'), states.join(', '));
    check('3', 'one POST …/pr/1/fix with the four ids', page.posts.slice(before).filter((p) => /\/pr\/1\/fix$/.test(p.url)).length === 1);
    await shot(page, `3-${WIDTHS[0]}-fixing`);
    const fixed = await waitFor(async () => { const v = await prView(1); return v.rows?.filter((r) => r.state === 'fixed').length === 3 ? v : null; }, 'the Foreman’s answers', 40000).catch(() => null);
    check('3', 'the demo Foreman answered with the block: 3 fixed, 1 answered', Boolean(fixed) && fixed.rows.find((r) => r.id === 'i8101')?.state === 'answered', fixed ? JSON.stringify(fixed.rows.map((r) => [r.id, r.state, r.commit])) : 'no answer');
    await page.waitForTimeout(1500);
    await shot(page, `3-${WIDTHS[0]}-fixed`);
    let fixedBtns = vis(page, 'button.jp2-prc-fixed');
    let fixedWords = await fixedBtns.allInnerTexts();
    const chips = await vis(page, '.jp2-prc-st').allInnerTexts();
    check('3', 'rows say `Fixed in <sha>` as buttons (page open while the Foreman committed)', fixedWords.length === 3 && fixedWords.every((t) => /^Fixed in [0-9a-f]{7}$/.test(t)), chips.join(', '));
    if (fixedWords.length !== 3) {
      // The same rows on a page opened after the commits.
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      fixedBtns = vis(page, 'button.jp2-prc-fixed');
      fixedWords = await fixedBtns.allInnerTexts();
      check('3', 'rows say `Fixed in <sha>` as buttons (after a reload)', fixedWords.length === 3 && fixedWords.every((t) => /^Fixed in [0-9a-f]{7}$/.test(t)), (await vis(page, '.jp2-prc-st').allInnerTexts()).join(', '));
    }
    const sha = /([0-9a-f]{7})$/.exec(fixedWords[0] ?? '')?.[1];
    let onBranch = false;
    try { git(WT, 'merge-base', '--is-ancestor', sha, BRANCH); onBranch = true; } catch { /* not */ }
    check('3', `the commit ${sha} is on the branch`, onBranch);
    const drafts = await vis(page, 'textarea.jp2-prc-ta').count();
    check('3', 'each answered row has its drafted reply, editable', drafts === 4 && (await vis(page, 'textarea.jp2-prc-ta[readonly]').count()) === 0, `${drafts} drafts`);
    await fixedBtns.first().click();
    await page.waitForTimeout(1200);
    const changes = await textOf(page, '.jp2-rv-h, .jp2-reader');
    check('3', '`Fixed in` opens that commit’s diff', page.url().includes('/read/changes/') && changes.includes(sha) && !/not on this branch/.test(changes), `${page.url().split('#')[1]} · ${changes.slice(0, 120)}`);
    await shot(page, `3-${WIDTHS[0]}-fixed-commit`);
    await page.goBack();
    await page.waitForTimeout(900);
    if (!page.url().includes('/read/pr/1')) { await page.goto(APP + `#/job/${SLUG}/read/pr/1`, { waitUntil: 'networkidle' }); await page.waitForTimeout(900); }

    // ---------- 4. Copy, Open on GitHub, Post it ----------
    const rowA = vis(page, '.jp2-prc').filter({ hasText: 'archiveTicketsButton' }).first();
    const acts = await rowA.locator('.jp2-prc-ra button, .jp2-prc-ra a').allInnerTexts();
    check('4', 'Copy and Open on GitHub come first, Post it after', acts.join(',') === 'Copy,Open on GitHub,Post it', acts.join(', '));
    const href = await rowA.locator('.jp2-prc-ra a').filter({ hasText: 'Open on GitHub' }).getAttribute('href').catch(() => null);
    check('4', 'Open on GitHub goes to the comment', href === `${url1}#discussion_r7101`, href);
    const mine = 'Renamed it to archiveTicketsButton, thanks Raj.';
    await rowA.locator('textarea').fill(mine);
    await rowA.locator('button').filter({ hasText: 'Copy' }).click();
    await page.waitForTimeout(300);
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    check('4', 'Copy copies his edited words', clip === mine, clip);
    check('4', 'no gh write before Post it', ghWrites().length === 0);
    await clickHis(page, rowA.locator('button').filter({ hasText: 'Post it' }), 'Post it (row A)');
    await waitFor(async () => (ghWrites().length >= 1 ? true : null), 'the post', 10000).catch(() => null);
    await page.waitForTimeout(1500);
    let w = ghWrites();
    check('4', 'Post it: exactly one gh write, his edited words', w.length === 1 && w[0].args.includes(`body=${mine}`) && /\/pulls\/\d+\/comments\/7101\/replies$/.test(w[0].args[3]), JSON.stringify(w.map((x) => x.args.slice(2, 4).concat(x.args.slice(-1)))));
    check('4', 'the row says Posted, no second Post it', (await rowA.locator('.jp2-prc-posted').count()) === 1 && (await rowA.locator('button').filter({ hasText: 'Post it' }).count()) === 0);
    const rowB = vis(page, '.jp2-prc').filter({ hasText: 'Looks close' }).first();
    clicks.push({ at: Date.now(), what: 'Post it ×2 (row B)' });
    await rowB.locator('button').filter({ hasText: 'Post it' }).dblclick();
    await page.waitForTimeout(2500);
    w = ghWrites();
    check('4', 'a double click on Post it posts once', w.length === 2, `${w.length} writes`);
    await shot(page, `4-${WIDTHS[0]}-posted`);

    // ---------- 5. Push the fixes ----------
    await post(`/api/job/${SLUG}/pr/1/pull`);
    await waitFor(async () => ((await pageOf()).prs[0].next?.id === 'push-fixes' ? true : null), 'Push the fixes', 20000).catch(() => null);
    await page.waitForTimeout(800);
    const pf = buttons(page, /^Push the fixes \(\d+ commits?\)$/);
    const where = await pf.evaluateAll((els) => els.map((e) => (e.closest('.jp2-prc-bar') ? 'PR view bar' : e.closest('.jp2-st') ? 'Ship line (steps)' : e.closest('.jp2-asks') ? 'asks row' : e.closest('.jp2-prv') ? 'PR view line' : e.className)));
    check('5', '`Push the fixes (3 commits)` in exactly two places: the Ship line and the PR view’s bar', where.length === 2 && where.includes('PR view bar') && where.includes('Ship line (steps)'), `${(await pf.allInnerTexts()).join(', ')} · ${where.join(', ')}`);
    await shot(page, `5-${WIDTHS[0]}-push-fixes`);
    const line = (await pageOf()).prs[0];
    await vis(page, '.jp2-prc-bar button').filter({ hasText: /^Push the fixes/ }).click();
    await page.waitForTimeout(600);
    const says = await vis(page, '.jp2-prc-bar .jp2-prl-says li').allInnerTexts();
    check('5', 'says lists what goes: 3 commits to the fork, so PR #1 has them', says[0] === `Pushes 3 commits from ${BRANCH} to your fork (origin), so PR #1 (#${N1}) has them:` && says.filter((s) => /^[0-9a-f]{7} /.test(s)).length === 3, says.join(' / '));
    check('5', 'says ends with “Starbase will ask you once more when the Foreman pushes.”', says.at(-1) === 'Starbase will ask you once more when the Foreman pushes.', says.at(-1));
    await shot(page, `5-${WIDTHS[0]}-push-fixes-says`);
    const yes = vis(page, '.jp2-prc-bar .jp2-prl-acts button').filter({ hasText: /^Push$/ });
    check('5', 'the yes reads Push', (await yes.count()) === 1);
    await clickHis(page, yes, 'Push the fixes: Push');
    await page.waitForTimeout(800);
    const sent = await waitFor(async () => { const d = await get(`/api/job/${SLUG}`); return d.thread?.some((t) => t.kind === 'you' && t.text === line.next.sends) ? true : null; }, 'the sentence', 15000).catch(() => false);
    check('5', 'his yes sends the fixed sentence to the Foreman', sent, line.next.sends.slice(0, 120));
    check('5', 'the sentence names the exact commit and says do not reply or resolve', new RegExp(`git push origin ${git(WT, 'rev-parse', 'HEAD')}:refs/heads/${BRANCH}`).test(line.next.sends) && /reply|resolve/i.test(line.next.sends), line.next.sends);
    check('5', 'Push the fixes wrote nothing to GitHub itself', ghWrites().length === 2);
    await shot(page, `5-${WIDTHS[0]}-sent`);
    check('-', 'no console errors at 1512', page.errors.length === 0, page.errors.slice(0, 3).join(' ¦ '));
    await page.close();
  }
  await stopRuns();

  // ---------- 390 px: the same PR, on the phone ----------
  if (WIDTHS.includes(390)) {
    const page = await open(390, `#/job/${SLUG}`);
    await shot(page, '2-390-job');
    const phoneLine = await textOf(page, '.jp2-prl-phone');
    check('2', '390: the phone’s PR line says the comments', /PR #1/.test(phoneLine) && /Comments/.test(phoneLine), phoneLine);
    await page.goto(APP + `#/job/${SLUG}/read/pr/1`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await shot(page, '3-390-pr-view');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('-', '390: the PR view has no sideways scroll', overflow <= 0, `${overflow} px`);
    const pf = await buttons(page, /^Push the fixes/).count();
    check('5', '390: Push the fixes shows in the PR view’s bar', pf >= 1, `${pf}`);
    check('-', '390: no console errors', page.errors.length === 0, page.errors.slice(0, 3).join(' ¦ '));
    await page.close();
  }

  // ---------- 6. A review round on PR #2 ----------
  {
    git(WT, 'push', '-q', 'origin', BRANCH); // the Foreman's push of the fixes
    writeStatus({ ...status(), stage: 'pr2', stage_state: 'in_progress', waiting_for: null });
    await post('/api/flow/refresh');
    const N2 = await waitFor(() => prNumber(2), 'PR #2 on the flow map');
    const head2 = git(WT, 'rev-parse', 'HEAD');
    const url2 = `https://github.com/acme/acme-portal/pull/${N2}`;
    readGh();
    ghState.prs[N2] = {
      view: { ...view1, number: N2, headRefOid: head2, baseRefName: 'staging', url: url2, reviewDecision: 'CHANGES_REQUESTED' },
      reviews: [{ id: 6201, user: user('raj-moxie'), state: 'CHANGES_REQUESTED', body: 'One thing before staging.', submitted_at: new Date().toISOString(), commit_id: head2, html_url: `${url2}#pullrequestreview-6201` }],
      comments: [{ id: 7201, user: user('raj-moxie'), path: 'app/tickets/archive.js', line: 3, position: 1, body: 'Please keep the old name as an alias.', pull_request_review_id: 6201, commit_id: head2, created_at: new Date().toISOString(), html_url: `${url2}#discussion_r7201` }],
      issues: [],
    };
    saveGh();
    await post('/api/flow/refresh');
    const asked = await waitFor(async () => ((await get(`/api/review/${SLUG}`)).state === 'asked' ? true : null), 'round 1 on PR #2', 30000).catch(() => false);
    check('6', 'a reviewer’s Request changes on PR #2 opens a round', asked, JSON.stringify((await get(`/api/review/${SLUG}`)).bar ?? null).slice(0, 160));
    if (asked) {
      clicks.push({ at: Date.now(), what: 'Fix with the Foreman (round)' });
      await post(`/api/review/${SLUG}/fix`, {});
      await sleep(2500);
      await stopRuns();
      writeFileSync(path.join(WT, 'archive-alias.txt'), 'alias\n');
      git(WT, 'add', 'archive-alias.txt');
      git(WT, 'commit', '-q', '-m', 'Keep the old name as an alias (review: c7201)');
      const fix = git(WT, 'rev-parse', '--short=7', 'HEAD');
      const st = status();
      st.prs = [{ number: 2, rounds: [{ round: 1, state: 'ready', doing: null, next: null, checks: 'npm test passes.', items: [
        { id: 'c7201', kind: 'change', plan: 'fix', state: 'fixed', commit: fix, reply: `Fixed in ${fix}: the old name stays as an alias.` },
        { id: 'r6201', kind: 'change', plan: 'answer', state: 'answered', reply: 'Thanks: done.' },
      ] }] }];
      writeStatus(st);
      const ready = await waitFor(async () => ((await get(`/api/review/${SLUG}`)).state === 'ready' ? true : null), 'the round ready', 20000).catch(() => false);
      check('6', 'the round is ready to send back', ready);
      await post(`/api/job/${SLUG}/pr/2/pull`);
      await waitFor(async () => ((await pageOf()).prs[1].next?.id === 'push-fixes' ? true : null), 'Push the fixes on PR #2', 20000).catch(() => null);
      const page = await open(WIDTHS[0], `#/job/${SLUG}/read/pr/2`);
      await page.waitForTimeout(800);
      const btn = vis(page, '.jp2-prc-bar button').filter({ hasText: /^Push the fixes/ });
      check('6', 'PR #2’s view has Push the fixes in its bar', (await btn.count()) === 1);
      if (await btn.count()) {
        await btn.click();
        await page.waitForTimeout(600);
        const says = await vis(page, '.jp2-prc-bar .jp2-prl-says li').allInnerTexts();
        check('6', 'says lists the round’s steps, the follow-up PR #1 and its merge among them', says.some((s) => /follow-up PR #1/.test(s) && /merge it once its checks pass/.test(s)), says.join(' / '));
        check('6', 'says lists where each reply goes', says.some((s) => /^\s*Reply to raj-moxie on app\/tickets\/archive\.js:3/.test(s)), says.filter((s) => /Reply/.test(s)).join(' / '));
        const goWord = await vis(page, '.jp2-prc-bar .jp2-prl-acts button').first().innerText();
        check('6', 'the yes reads Send back', goWord === 'Send back', goWord);
        await shot(page, `6-${WIDTHS[0]}-round-says`);
        await vis(page, '.jp2-prc-bar .jp2-prl-acts button').filter({ hasText: 'Cancel' }).click();
      }
      check('6', 'no gh write in the round case (no yes given)', ghWrites().length === 2);
      await page.close();
    }
  }

  // ---------- 7. gh signed out, then offline ----------
  for (const [mode, words, expect] of [['signed-out', 'To get started with GitHub CLI, please run:  gh auth login', /gh isn’t signed in: run gh auth login/], ['offline', 'error connecting to api.github.com', /GitHub didn’t answer/]]) {
    readGh();
    ghState.mode = mode;
    saveGh();
    writeFileSync(GH_DOWN, words);
    const page = await open(WIDTHS[0], `#/job/${SLUG}/read/pr/2`);
    await buttons(page, 'Pull now').first().click().catch(() => null);
    await waitFor(async () => ((await textOf(page, '.jp2-prl-read')).match(expect) ? true : null), `the ${mode} words`, 20000).catch(() => null);
    await page.waitForTimeout(800);
    const read = await textOf(page, '.jp2-prl-read');
    check('7', `${mode}: the lines say so`, expect.test(read), read);
    const acting = await page.locator('.jp2-prl-b, .jp2-prc-bar .jp2-prl button').filter({ visible: true, hasText: /^(Push|Open PR|Request review)/ }).count();
    check('7', `${mode}: no PR action button`, acting === 0, `${acting}`);
    const whys = await textOf(page, '.jp2-prl-s');
    check('7', `${mode}: the line says why there is no button`, /No button while GitHub isn’t answering/.test(whys), whys);
    check('7', `${mode}: no Post it`, (await buttons(page, 'Post it').count()) === 0);
    await shot(page, `7-${WIDTHS[0]}-${mode}`);
    await page.close();
  }
  readGh();
  ghState.mode = 'ok';
  saveGh();
  writeFileSync(GH_DOWN, '');

  // ---------- Every gh call ----------
  const calls = ghCalls();
  const writes = calls.filter((c) => c.write);
  const kinds = {};
  for (const c of calls) { const k = c.args[0] === 'api' ? `api ${c.args[1] === 'graphql' ? 'graphql' : `${c.args[2]} ${String(c.args[3]).replace(/\d+/g, 'N').replace(/\?.*/, '')}`}` : c.args.slice(0, 2).join(' '); kinds[k] = (kinds[k] ?? 0) + 1; }
  console.log('\nfake gh calls:', calls.length, 'reads', calls.length - writes.length, 'writes', writes.length);
  for (const [k, n] of Object.entries(kinds).sort()) console.log(`  ${n}\t${k}`);
  for (const wr of writes) {
    const by = clicks.filter((c) => c.at <= Date.parse(wr.at)).at(-1);
    console.log(`  write ${wr.at} ${wr.args.slice(0, 4).join(' ')} ${wr.args.at(-1)} ← ${by ? by.what : 'NO CLICK'}`);
  }
  check('gh', 'every gh write followed a Post it click', writes.length > 0 && writes.every((wr) => { const by = clicks.filter((c) => c.at <= Date.parse(wr.at)).at(-1); return by && /Post it/.test(by.what); }));
  writeFileSync(path.join(OUT, 'gh-calls.json'), JSON.stringify(calls, null, 2));
} catch (err) {
  console.error(err);
  check('!', 'the run finished', false, String(err?.message ?? err));
} finally {
  if (KEEP && !process.env.STOP_AT && process.env.KEEP_AT !== 'pr2') {
    // Back to PR #1 with its rows, for the theme and contrast runs: one more comment (a New row, ticked, and the
    // bar) and a failed check (its row and Fix it) on top of the Fixed, Answered and Posted rows.
    try {
      readGh();
      const pr1 = Object.values(ghState.prs).find((p) => p.view.baseRefName === BRANCH);
      pr1.issues.push({ id: 8102, user: user('raj-moxie'), body: 'One more: the confirm says “Archive 3 tickets?”, please keep the count in it.', html_url: `${pr1.view.url}#issuecomment-8102`, created_at: new Date().toISOString() });
      pr1.view.statusCheckRollup = [...green, { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/acme/acme-portal/actions/runs/4242/job/9' }];
      pr1.log = { 4242: 'lint\tRun lint\tapp/tickets/select.js: ids is unused\nlint\tRun lint\t##[error]Process completed with exit code 1.\n' };
      saveGh();
      writeStatus({ ...status(), stage: 'pr1' });
      await post('/api/flow/refresh');
      await post(`/api/job/${SLUG}/pr/1/pull`);
    } catch (err) { console.error('KEEP:', err); }
  } else if (KEEP && process.env.KEEP_AT === 'pr2') {
    try { await post('/api/flow/refresh'); await post(`/api/job/${SLUG}/pr/2/pull`); } catch (err) { console.error('KEEP:', err); }
  }
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length} of ${results.length} checks pass.${KEEP ? ` The demo is still running (pid ${demo.pid}, ${BASE}).` : ''}`);
  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  stopDemo();
  process.exit(failed.length ? 1 : 0);
}
